import { describe, it, expect } from "vitest";
import { isPreviewHost, isMap3DEnabled } from "../src/lib/map3d-support";
import {
  APPROX_MAX_OFFSET_M,
  LOCKED_LIMITS,
  boundsAround,
  cameraPolicy,
} from "../src/lib/map3d-camera";

const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

describe("preview host matcher", () => {
  it.each([
    "localhost",
    "id-preview--b8a81be6.lovable.app",
    "project--abc.lovable.app",
    "abc-devserver-xyz.lovableproject.com",
    "LOCALHOST",
  ])("allows %s", (h) => expect(isPreviewHost(h)).toBe(true));
  it.each([
    "usop.in",
    "www.usop.in",
    "lovable.app",
    "lovableproject.com",
    "evil-lovable.app.example.com",
    "lovable.app.example.com",
    "evillovable.app",
    "x.lovable.app.evil.com",
    "localhost.evil.com",
    "",
  ])("rejects %s", (h) => expect(isPreviewHost(h)).toBe(false));
});

describe("isMap3DEnabled override", () => {
  it("?map3d=1 turns on for the session on preview hosts, ?map3d=0 clears", () => {
    const s = mem();
    expect(isMap3DEnabled("x.lovable.app", "", s, false)).toBe(false);
    expect(isMap3DEnabled("x.lovable.app", "?map3d=1", s, false)).toBe(true);
    expect(isMap3DEnabled("x.lovable.app", "", s, false)).toBe(true);
    expect(isMap3DEnabled("x.lovable.app", "?map3d=0", s, false)).toBe(false);
    expect(isMap3DEnabled("x.lovable.app", "", s, false)).toBe(false);
  });
  it("is ignored on usop.in and other hosts, even with stored override", () => {
    const s = mem();
    isMap3DEnabled("localhost", "?map3d=1", s, false); // stored
    for (const h of ["www.usop.in", "usop.in", "evil-lovable.app.example.com"]) {
      expect(isMap3DEnabled(h, "?map3d=1", s, false)).toBe(false);
      expect(isMap3DEnabled(h, "", s, false)).toBe(false);
    }
  });
  it("build-time flag on wins everywhere", () => {
    expect(isMap3DEnabled("www.usop.in", "?map3d=0", mem(), true)).toBe(true);
  });
  it("works without storage", () => {
    expect(isMap3DEnabled("localhost", "?map3d=1", null, false)).toBe(false);
  });
});

describe("locked circle covers the real spot", () => {
  it("max offset constant matches the generator (150-300 m + 3-decimal rounding)", () => {
    const halfStep = 0.0005 * 111320; // 55.66 m, worst case per axis
    expect(APPROX_MAX_OFFSET_M).toBeGreaterThanOrEqual(300 + Math.SQRT2 * halfStep);
  });
  it("radius >= max offset + 15 m margin", () => {
    expect(LOCKED_LIMITS.circleRadiusM).toBeGreaterThanOrEqual(APPROX_MAX_OFFSET_M + 15);
  });
  it("simulated generator output always lands inside the circle and the bounds", () => {
    for (let i = 0; i < 20000; i++) {
      const lat = 8 + ((i * 7919) % 2800) / 100; // India latitudes
      const lng = 70 + ((i * 104729) % 2500) / 100;
      const dist = 150 + (i % 151);
      const ang = ((i * 37) % 360) * (Math.PI / 180);
      const aLat = Math.round((lat + (dist * Math.cos(ang)) / 111320) * 1000) / 1000;
      const aLng =
        Math.round((lng + (dist * Math.sin(ang)) / (111320 * Math.cos((lat * Math.PI) / 180))) * 1000) / 1000;
      const dy = (aLat - lat) * 111320;
      const dx = (aLng - lng) * 111320 * Math.cos((lat * Math.PI) / 180);
      const off = Math.hypot(dx, dy);
      expect(off).toBeLessThanOrEqual(APPROX_MAX_OFFSET_M);
      const b = cameraPolicy({ approx: { lat: aLat, lng: aLng }, unlocked: false }).bounds;
      expect(b).toEqual(boundsAround({ lat: aLat, lng: aLng }, LOCKED_LIMITS.boundsKm));
    }
  });
  it("bounds half-width (800 m) is larger than the circle radius", () => {
    expect(LOCKED_LIMITS.boundsKm * 1000).toBeGreaterThan(LOCKED_LIMITS.circleRadiusM);
  });
});
