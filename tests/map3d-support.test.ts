import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  canUse3DWith,
  check3DLoad,
  record3DLoad,
  slot3DButtonVisible,
  MAX_3D_PER_SESSION,
} from "../src/lib/map3d-support";
import { importMaps3dWith } from "../src/lib/google-maps";
import Slot3DButton from "../src/components/Slot3DButton";

const base = { flag: true, webgl: true };

describe("canUse3D matrix", () => {
  it("all optional APIs undefined => allowed", () => {
    expect(canUse3DWith(base).ok).toBe(true);
  });
  it.each([
    [{ ...base, flag: false }, "flag"],
    [{ ...base, webgl: false }, "webgl"],
    [{ ...base, saveData: true }, "saveData"],
    [{ ...base, effectiveType: "slow-2g" }, "network"],
    [{ ...base, effectiveType: "2g" }, "network"],
    [{ ...base, effectiveType: "3g" }, "network"],
    [{ ...base, deviceMemory: 2 }, "memory"],
  ])("blocks on %o", (env, reason) => {
    expect(canUse3DWith(env)).toEqual({ ok: false, reason });
  });
  it.each([
    { ...base, saveData: false },
    { ...base, effectiveType: "4g" },
    { ...base, deviceMemory: 4 },
    { ...base, deviceMemory: 8, effectiveType: "4g", saveData: false },
  ])("allows %o", (env) => {
    expect(canUse3DWith(env).ok).toBe(true);
  });
});

describe("advisory usage guard", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("blocks a second load for the same slot", () => {
    const s = mem();
    expect(check3DLoad(s, "a").ok).toBe(true);
    record3DLoad(s, "a");
    expect(check3DLoad(s, "a")).toEqual({ ok: false, reason: "slot" });
  });
  it("blocks once the session cap is reached", () => {
    const s = mem();
    for (let i = 0; i < MAX_3D_PER_SESSION; i++) record3DLoad(s, `s${i}`);
    expect(check3DLoad(s, "new")).toEqual({ ok: false, reason: "cap" });
  });
  it("survives corrupt storage", () => {
    const s = mem();
    s.setItem("usop:3d-loads", "{nope");
    expect(check3DLoad(s, "a").ok).toBe(true);
  });
});

describe("loadMaps3d", () => {
  it("rejects cleanly when importLibrary throws", async () => {
    const loader = async () => ({
      maps: { importLibrary: async () => Promise.reject(new Error("denied")) },
    });
    await expect(importMaps3dWith(loader, 1000)).rejects.toThrow("denied");
  });
  it("rejects when the library lacks Map3DElement", async () => {
    const loader = async () => ({ maps: { importLibrary: async () => ({}) } });
    await expect(importMaps3dWith(loader, 1000)).rejects.toThrow("maps3d unavailable");
  });
  it("rejects on timeout", async () => {
    const loader = () => new Promise<never>(() => {});
    await expect(importMaps3dWith(loader, 20)).rejects.toThrow("timed out");
  });
});

describe("Slot3DButton visibility", () => {
  it("gate requires flag, unlocked address and support", () => {
    expect(slot3DButtonVisible({ flag: true, fullAddress: "12 Main St", supported: true })).toBe(true);
    expect(slot3DButtonVisible({ flag: false, fullAddress: "12 Main St", supported: true })).toBe(false);
    expect(slot3DButtonVisible({ flag: true, fullAddress: "", supported: true })).toBe(false);
    expect(slot3DButtonVisible({ flag: true, fullAddress: "  ", supported: true })).toBe(false);
    expect(slot3DButtonVisible({ flag: true, fullAddress: undefined, supported: true })).toBe(false);
    expect(slot3DButtonVisible({ flag: true, fullAddress: "12 Main St", supported: false })).toBe(false);
  });
  const slot = { id: "x", name: "N", approx_area: "A", hourly_rate: 40, lat: 13, lng: 80 };
  it("renders nothing (empty markup) when locked or flag off", () => {
    expect(renderToString(createElement(Slot3DButton, { slot, flag: true }))).toBe("");
    expect(
      renderToString(createElement(Slot3DButton, { slot: { ...slot, full_address: "X" }, flag: false })),
    ).toBe("");
  });
});
