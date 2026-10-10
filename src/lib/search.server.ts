// Server-only: time-window search. Uses the same quoteFromData/demandFromRows rules as
// createBooking, with batched reads. Exact coordinates and addresses never leave this file.
import type { SearchWindowInput } from "@/lib/bookings.schema";
import {
  DEMAND_RADIUS_KM,
  haversineKm,
  neighbourhoodPeers,
  type OccupancyRow,
  type PeerCandidate,
} from "@/lib/pricing";
import type { SlotAvailability } from "@/lib/queries";
import {
  demandFromRows,
  quoteFromData,
  UNIT_MS,
  type QuoteReason,
  type QuoteSlot,
} from "@/lib/quote";

export const SEARCH_RESULT_CAP = 100;
export const SEARCH_RADIUS_KM = 15;
export const SEARCH_RADIUS_WIDE_KM = 30;
const MIN_RESULTS = 20;
/** Approximate coordinates sit up to ~0.4 km from the exact point. */
const APPROX_MARGIN_KM = 0.5;
/** PostgREST max rows per response; we page at this size. */
export const PAGE_SIZE = 1000;
/** Ids per `.in()` filter, keeps request URLs short. */
export const ID_CHUNK = 100;

/**
 * Read every row of a query by paging with .range() until a short page comes back.
 * `build` must return a fresh, deterministically ordered query each call.
 */
export async function fetchAllPages<T>(
  build: () => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: unknown }>;
  },
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

/** fetchAllPages over id chunks of ID_CHUNK (one `.in()` filter per chunk). */
async function fetchByIds<T>(
  ids: string[],
  build: (chunk: string[]) => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: unknown }>;
  },
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push(...(await fetchAllPages(() => build(chunk))));
  }
  return out;
}

export type WindowResult = {
  slotId: string;
  available: boolean;
  reason: QuoteReason;
  /** Rupees, GST included — the amount createBooking would charge (before promo). */
  totalPrice: number;
  label: string | null;
  peak: boolean;
  /** Distance to the given point using approximate coordinates only (km), or null. */
  approxDistanceKm: number | null;
};

type SlotRow = QuoteSlot &
  PeerCandidate & {
    lot_id: string | null;
    public_lat: number | null;
    public_lng: number | null;
  };

// Loose type so tests can pass a small fake of the admin client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Queries per search: 1 slots (all, incl. exact lat/lng for the demand neighbourhood),
 * 1 opening hours, 1 overlapping reservations, 1 holidays, +1 parking lots only when a
 * candidate belongs to a lot.
 */
export async function searchWindow(
  db: Db,
  input: SearchWindowInput,
  now: Date = new Date(),
): Promise<WindowResult[]> {
  const start = new Date(input.startTime);
  const end = new Date(start.getTime() + input.duration * UNIT_MS[input.rateType]);

  const cols =
    "id, status, archived, is_available, approval_status, slot_type, lot_id, hourly_rate, daily_rate, monthly_rate, lat, lng, public_lat, public_lng";
  const visible = (s: SlotRow) => s.approval_status === "approved" && !s.archived && s.is_available;
  const loadSlots = async (box?: { lat: number; lng: number; km: number }) => {
    const rows = await fetchAllPages<SlotRow>(() => {
      let q = db.from("slots").select(cols);
      if (box) {
        const dLat = box.km / 111;
        const dLng = box.km / (111 * Math.max(0.1, Math.cos((box.lat * Math.PI) / 180)));
        q = q
          .gte("public_lat", box.lat - dLat)
          .lte("public_lat", box.lat + dLat)
          .gte("public_lng", box.lng - dLng)
          .lte("public_lng", box.lng + dLng);
      }
      return q.order("id");
    });
    return rows.map((s) => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) }));
  };
  const approxKm = (s: SlotRow) =>
    input.lat != null && input.lng != null && s.public_lat != null && s.public_lng != null
      ? haversineKm(
          { lat: input.lat, lng: input.lng },
          { lat: Number(s.public_lat), lng: Number(s.public_lng) },
        )
      : null;

  let slots: SlotRow[];
  let candidates: SlotRow[];
  if (input.lat != null && input.lng != null) {
    // Nearest first: box on approximate coords, widened when sparse. Exact lat/lng are only
    // loaded for slots that can be demand peers (box + DEMAND_RADIUS_KM + approx offset margin).
    const pick = async (km: number) => {
      const loaded = await loadSlots({
        lat: input.lat!,
        lng: input.lng!,
        km: km + DEMAND_RADIUS_KM + APPROX_MARGIN_KM,
      });
      const inBox = loaded.filter((s) => visible(s) && (approxKm(s) ?? Infinity) <= km);
      return { loaded, inBox };
    };
    let r = await pick(SEARCH_RADIUS_KM);
    if (r.inBox.length < MIN_RESULTS) r = await pick(SEARCH_RADIUS_WIDE_KM);
    slots = r.loaded;
    candidates = r.inBox
      .sort((a, b) => approxKm(a)! - approxKm(b)!)
      .slice(0, SEARCH_RESULT_CAP);
  } else {
    slots = await loadSlots();
    candidates = slots.filter(visible).slice(0, SEARCH_RESULT_CAP);
  }
  if (!candidates.length) return [];
  const ids = candidates.map((c) => c.id);

  const hoursRows = await fetchByIds<SlotAvailability>(ids, (chunk) =>
    db.from("slot_availability").select("*").in("slot_id", chunk).order("id"),
  );
  // Reservations on candidates plus their demand peers (same lot, or neighbourhood), so
  // availability and demand match createBooking exactly.
  const resSlotIds = new Set(ids);
  for (const c of candidates) {
    if (c.lot_id) {
      for (const s of slots) if (s.lot_id === c.lot_id) resSlotIds.add(s.id);
    } else {
      for (const pid of neighbourhoodPeers(c, slots).peerIds) resSlotIds.add(pid);
    }
  }
  const resRows = await fetchByIds<OccupancyRow & { id: string }>([...resSlotIds], (chunk) =>
    db
      .from("reservations")
      .select("id, slot_id, status, start_time, end_time, payment_expires_at")
      .in("slot_id", chunk)
      .neq("status", "cancelled")
      .lt("start_time", end.toISOString())
      .gt("end_time", start.toISOString())
      .order("id"),
  );
  const { data: holidayRows } = await db.from("public_holidays").select("date");
  const lotIds = [...new Set(candidates.map((c) => c.lot_id).filter(Boolean))] as string[];
  const lots = new Map<string, { tier: string | null; total_slots: number }>();
  if (lotIds.length) {
    const { data: lotRows } = await db
      .from("parking_lots")
      .select("id, tier, total_slots")
      .in("id", lotIds);
    for (const l of lotRows ?? []) lots.set(l.id, { tier: l.tier, total_slots: l.total_slots });
  }

  const hours = (hoursRows ?? []) as SlotAvailability[];
  const reservations = (resRows ?? []) as OccupancyRow[];
  const holidays = ((holidayRows ?? []) as { date: string }[]).map((h) => h.date);

  return candidates.map((slot) => {
    const q = quoteFromData(
      slot,
      { startTime: start, duration: input.duration, rateType: input.rateType },
      {
        hours: hours.filter((h) => h.slot_id === slot.id),
        reservations: reservations.filter((r) => r.slot_id === slot.id),
        holidays,
        demand:
          input.rateType === "hourly"
            ? demandFromRows(
                slot,
                slots,
                slot.lot_id ? (lots.get(slot.lot_id) ?? null) : null,
                reservations,
                start,
                end,
                now,
              )
            : null,
      },
      now,
    );
    const approxDistanceKm = approxKm(slot);
    return {
      slotId: slot.id,
      available: q.available,
      reason: q.reason,
      totalPrice: q.grandTotal,
      label: q.label,
      peak: q.peak,
      approxDistanceKm,
    };
  });
}
