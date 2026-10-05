/** Feature flag + device checks + advisory per-session usage guard for the 3D view. */
import { useEffect, useState } from "react";

/** Build-time flag. Never changed at runtime. */
export const MAP3D_FLAG = import.meta.env.VITE_FEATURE_MAP_3D === "true";

/* ------------- preview-only override (?map3d=1 / ?map3d=0) */

const OVERRIDE_KEY = "usop:map3d-override";

/** Hosts where the override may apply: localhost, *.lovable.app, *.lovableproject.com. */
export function isPreviewHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".lovable.app") || h.endsWith(".lovableproject.com");
}

type OverrideStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Single source of truth for "is 3D enabled here". Build flag, or on preview hosts only,
 * a session override set by ?map3d=1 (cleared by ?map3d=0). Ignored on every other host.
 */
export function isMap3DEnabled(
  hostname: string,
  search: string,
  storage: OverrideStore | null,
  flag = MAP3D_FLAG,
): boolean {
  if (flag) return true;
  if (!isPreviewHost(hostname)) return false;
  const q = new URLSearchParams(search).get("map3d");
  if (!storage) return q === "1";
  try {
    if (q === "1") storage.setItem(OVERRIDE_KEY, "1");
    else if (q === "0") storage.removeItem(OVERRIDE_KEY);
    return storage.getItem(OVERRIDE_KEY) === "1";
  } catch {
    return q === "1";
  }
}

/** Client-only evaluation. Server/SSR always gets the build-time flag. */
export function isMap3DEnabledHere(): boolean {
  if (typeof window === "undefined") return MAP3D_FLAG;
  let store: OverrideStore | null = null;
  try {
    store = window.sessionStorage;
  } catch {
    store = null;
  }
  return isMap3DEnabled(window.location.hostname, window.location.search, store);
}

/** false on the server and first render; evaluated after mount (no hydration mismatch). */
export function useMap3DEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isMap3DEnabledHere()), []);
  return on;
}

export type Map3DEnv = {
  flag: boolean;
  webgl: boolean;
  saveData?: boolean;
  effectiveType?: string;
  deviceMemory?: number;
};

export type Support = { ok: true } | { ok: false; reason: string };

/** Only positive signals block. Missing APIs (Safari/Firefox) count as OK. */
export function canUse3DWith(env: Map3DEnv): Support {
  if (!env.flag) return { ok: false, reason: "flag" };
  if (!env.webgl) return { ok: false, reason: "webgl" };
  if (env.saveData === true) return { ok: false, reason: "saveData" };
  if (env.effectiveType && ["slow-2g", "2g", "3g"].includes(env.effectiveType))
    return { ok: false, reason: "network" };
  if (typeof env.deviceMemory === "number" && env.deviceMemory < 4)
    return { ok: false, reason: "memory" };
  return { ok: true };
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function detectEnv(flag = isMap3DEnabledHere()): Map3DEnv {
  if (typeof window === "undefined") return { flag, webgl: false };
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  return {
    flag,
    webgl: hasWebGL(),
    saveData: nav.connection?.saveData,
    effectiveType: nav.connection?.effectiveType,
    deviceMemory: nav.deviceMemory,
  };
}

export const canUse3D = (flag = isMap3DEnabledHere()) => canUse3DWith(detectEnv(flag)).ok;

/* ------------- advisory usage guard (client-side only, trivially bypassed) */

export const MAX_3D_PER_SESSION = 5;
const KEY = "usop:3d-loads";
type Store = Pick<Storage, "getItem" | "setItem">;

function read(store: Store): string[] {
  try {
    const v = JSON.parse(store.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export type GuardResult = { ok: true } | { ok: false; reason: "slot" | "cap" };

export function check3DLoad(store: Store, slotId: string): GuardResult {
  const used = read(store);
  if (used.includes(slotId)) return { ok: false, reason: "slot" };
  if (used.length >= MAX_3D_PER_SESSION) return { ok: false, reason: "cap" };
  return { ok: true };
}

export function record3DLoad(store: Store, slotId: string) {
  const used = read(store);
  if (!used.includes(slotId)) used.push(slotId);
  try {
    store.setItem(KEY, JSON.stringify(used));
  } catch {
    /* storage full / blocked: advisory only */
  }
}

export const sessionStore = (): Store =>
  typeof window !== "undefined" && window.sessionStorage
    ? window.sessionStorage
    : { getItem: () => null, setItem: () => {} };

export const GUARD_TEXT = {
  slot: "You've already opened the 3D view for this space in this session.",
  cap: `3D view limit reached for this session (${MAX_3D_PER_SESSION} spaces).`,
} as const;

/** Visibility rule for the slot-page 3D button. */
export function slot3DButtonVisible(p: {
  flag: boolean;
  fullAddress?: string | null;
  supported: boolean;
}): boolean {
  return p.flag && !!p.fullAddress && p.fullAddress.trim() !== "" && p.supported;
}
