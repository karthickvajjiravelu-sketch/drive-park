import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  cameraPolicy,
  clampCamera,
  boundsAround,
  circlePath,
  ownSlotIds,
  LOCKED_LIMITS,
} from "../src/lib/map3d-camera";

const approx = { lat: 13.0418, lng: 80.2341 };
const exact = { lat: 13.0391, lng: 80.2368 };
const inside = (b: ReturnType<typeof boundsAround>, p: { lat: number; lng: number }) =>
  p.lat <= b.north && p.lat >= b.south && p.lng <= b.east && p.lng >= b.west;

describe("3D camera policy (privacy)", () => {
  it("locked never uses exact coordinates even if they are passed in", () => {
    const p = cameraPolicy({ approx, exact, unlocked: false });
    expect(p.locked).toBe(true);
    expect(p.center).toEqual(approx);
    expect(p.bounds).toEqual(boundsAround(approx, LOCKED_LIMITS.boundsKm));
    expect(JSON.stringify(p)).not.toContain(String(exact.lat));
    expect(JSON.stringify(p)).not.toContain(String(exact.lng));
  });
  it("locked range >= 600 m, tilt <= 45, bounds only around the approx point", () => {
    const p = cameraPolicy({ approx, unlocked: false });
    expect(p.minRange).toBeGreaterThanOrEqual(600);
    expect(p.range).toBeGreaterThanOrEqual(600);
    expect(p.maxTilt).toBeLessThanOrEqual(45);
    expect(inside(p.bounds, approx)).toBe(true);
    expect(p.bounds.north - p.bounds.south).toBeLessThan(0.02); // ~1.6 km box
  });
  it("unlocked only when the private flag is true AND exact data exists", () => {
    expect(cameraPolicy({ approx, exact, unlocked: true }).locked).toBe(false);
    expect(cameraPolicy({ approx, exact, unlocked: true }).center).toEqual(exact);
    expect(cameraPolicy({ approx, exact: null, unlocked: true }).locked).toBe(true);
    expect(
      cameraPolicy({ approx, exact: { lat: NaN, lng: 1 }, unlocked: true }).locked,
    ).toBe(true);
    // truthy non-boolean must not unlock
    expect(
      cameraPolicy({ approx, exact, unlocked: 1 as unknown as boolean }).locked,
    ).toBe(true);
    const u = cameraPolicy({ approx, exact, unlocked: true });
    expect(u.minRange).toBe(80);
    expect(u.maxTilt).toBe(67.5);
  });
  it("clamp enforces range >= 600, tilt <= 45 and keeps the centre in bounds", () => {
    const p = cameraPolicy({ approx, unlocked: false });
    const c = clampCamera(p, { center: { lat: 14, lng: 81 }, range: 50, tilt: 80 });
    expect(c.range).toBe(600);
    expect(c.tilt).toBe(45);
    expect(inside(p.bounds, c.center)).toBe(true);
    const nan = clampCamera(p, { center: approx, range: NaN, tilt: NaN });
    expect(nan.range).toBe(600);
  });
  it("circle overlay is ~250 m around the approx point", () => {
    const ring = circlePath(approx, 250);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const q of ring) {
      const dy = (q.lat - approx.lat) * 111320;
      const dx = (q.lng - approx.lng) * 111320 * Math.cos((approx.lat * Math.PI) / 180);
      expect(Math.hypot(dx, dy)).toBeCloseTo(250, 0);
    }
  });
});

describe("map screen never requests other users' private data", () => {
  const slots = [
    { id: "a", owner_id: "me" },
    { id: "b", owner_id: "other" },
    { id: "c", owner_id: "me" },
  ];
  it("ownSlotIds returns only the caller's slots", () => {
    expect(ownSlotIds(slots, "me")).toEqual(["a", "c"]);
    expect(ownSlotIds(slots, null)).toEqual([]);
    expect(ownSlotIds(slots, undefined)).toEqual([]);
  });
  it("map.tsx only calls the private RPC through useSlotsPrivate(ownSlotIds(...))", () => {
    const src = readFileSync("src/routes/_authenticated/map.tsx", "utf8");
    expect(src).not.toMatch(/get_slots_private|withPrivate|\.rpc\(/);
    const calls = src.match(/useSlotsPrivate\(([^)]*)\)/g) ?? [];
    expect(calls).toEqual(["useSlotsPrivate(myIds)"]);
    expect(src).toMatch(/ownSlotIds\(slots, profile\?\.user_id\)/);
  });
});
