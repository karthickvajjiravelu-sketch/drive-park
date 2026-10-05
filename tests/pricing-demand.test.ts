import { describe, it, expect } from "vitest";
import {
  calculatePrice,
  neighbourhoodPeers,
  pricingParams,
  priceWithParams,
  MIN_DEMAND_PEERS,
  MULTIPLIER_CAP,
  SPARSE_DEMAND_NOTE,
  type PeerCandidate,
} from "../src/lib/pricing";
import { pricingInputs } from "../src/lib/bookings.server";

const ist = (s: string) => new Date(`${s}+05:30`);
const SELF = { id: "self", lat: 13.05, lng: 80.24 };
/** ~0.009° latitude ≈ 1 km. */
const peer = (id: string, dLatKm: number, extra: Partial<PeerCandidate> = {}): PeerCandidate => ({
  id,
  lat: SELF.lat + dLatKm / 111.2,
  lng: SELF.lng,
  approval_status: "approved",
  archived: false,
  ...extra,
});

describe("A1 neighbourhood demand", () => {
  it("lone slot is sparse → demand 1.0 with the note", () => {
    const n = neighbourhoodPeers(SELF, [{ ...peer("self", 0) }]);
    expect(n.peerIds).toEqual(["self"]);
    expect(n.sparse).toBe(true);
    const b = calculatePrice({
      baseRate: 40,
      occupiedSlots: 0,
      totalSlots: 1,
      startTime: ist("2026-06-09T11:00:00"),
      durationHours: 1,
      demandNeutral: true,
    });
    expect(b.demandMultiplier).toBe(1);
    expect(b.demandLevel).toBe("Normal");
    expect(b.demandNote).toBe(SPARSE_DEMAND_NOTE);
  });

  it("ignores peers beyond 1 km and archived/unapproved peers", () => {
    const n = neighbourhoodPeers(SELF, [
      peer("a", 0.3),
      peer("b", 0.9),
      peer("far", 1.2),
      peer("arch", 0.2, { archived: true }),
      peer("pend", 0.2, { approval_status: "pending" }),
    ]);
    expect(n.peerIds.sort()).toEqual(["a", "b", "self"]);
    expect(n.sparse).toBe(true);
  });

  it(`${MIN_DEMAND_PEERS}+ nearby slots are not sparse`, () => {
    const n = neighbourhoodPeers(SELF, [
      peer("a", 0.1),
      peer("b", 0.2),
      peer("c", 0.3),
      peer("d", 0.4),
    ]);
    expect(n.peerIds.length).toBe(5);
    expect(n.sparse).toBe(false);
  });

  // Minimal fake of the admin client's query builder.
  function fakeDb(tables: Record<string, unknown[]>) {
    return {
      from(table: string) {
        let rows = [...(tables[table] ?? [])] as Record<string, unknown>[];
        const q: Record<string, unknown> = {};
        const chain = () => q;
        for (const m of ["select", "neq", "lt", "gt", "gte", "lte"]) q[m] = chain;
        q.eq = (col: string, v: unknown) => {
          rows = rows.filter((r) => r[col] === v);
          return q;
        };
        q.in = (col: string, vs: unknown[]) => {
          rows = rows.filter((r) => vs.includes(r[col]));
          return q;
        };
        q.maybeSingle = async () => ({ data: rows[0] ?? null });
        q.then = (res: (v: { data: unknown[] }) => unknown) => res({ data: rows });
        return q;
      },
    };
  }
  const resv = (slot_id: string, s: string, e: string) => ({
    slot_id,
    status: "upcoming",
    start_time: ist(s).toISOString(),
    end_time: ist(e).toISOString(),
    payment_expires_at: null,
  });

  it("5+ nearby slots use overlap occupancy", async () => {
    const slots = [
      { ...peer("self", 0) },
      peer("a", 0.1),
      peer("b", 0.2),
      peer("c", 0.3),
      peer("d", 0.4),
      peer("far", 3),
    ];
    const db = fakeDb({
      slots,
      reservations: [
        resv("a", "2026-06-09T11:00:00", "2026-06-09T13:00:00"),
        resv("b", "2026-06-09T12:30:00", "2026-06-09T14:00:00"),
        resv("c", "2026-06-09T12:00:00", "2026-06-09T15:00:00"),
        resv("far", "2026-06-09T12:00:00", "2026-06-09T13:00:00"),
        resv("d", "2026-06-09T20:00:00", "2026-06-09T21:00:00"), // no overlap
      ],
      public_holidays: [],
    });
    const p = await pricingInputs(
      db as never,
      { id: "self", lot_id: null },
      ist("2026-06-09T12:00:00"),
      ist("2026-06-09T14:00:00"),
    );
    expect(p.demandNeutral).toBe(false);
    expect(p.total).toBe(5);
    expect(p.occupied).toBe(3); // a, b, c — 60% → High
  });

  it("a lone live slot gets demand 1.0 through pricingInputs", async () => {
    const db = fakeDb({
      slots: [{ ...peer("self", 0) }, peer("x", 2)],
      reservations: [],
      public_holidays: [],
    });
    const p = await pricingInputs(
      db as never,
      { id: "self", lot_id: null },
      new Date(),
      new Date(Date.now() + 3600e3),
    );
    expect(p.demandNeutral).toBe(true);
    const params = pricingParams({
      baseRate: 25,
      occupiedSlots: p.occupied,
      totalSlots: p.total,
      demandNeutral: p.demandNeutral,
    });
    expect(params.demandMultiplier).toBe(1);
  });
});

describe("A3 monotonic sweep (every half-hour start for a week × 0.25–72 h × demand × cap)", () => {
  it("price never decreases with duration", { timeout: 120_000 }, () => {
    const week0 = ist("2026-06-08T00:00:00"); // Monday
    const holidays = ["2026-06-10"];
    const demandOcc: Record<number, [number, number]> = {
      0.8: [0, 10],
      1.0: [4, 10],
      1.5: [7, 10],
      2.0: [9, 10],
      3.0: [10, 10],
    };
    let violations = 0;
    let smallest: string | null = null;
    for (const capOn of [true, false]) {
      for (const [d, [occ, tot]] of Object.entries(demandOcc)) {
        const params = pricingParams({
          baseRate: 40,
          occupiedSlots: occ,
          totalSlots: tot,
          holidayDates: holidays,
        });
        expect(params.demandMultiplier).toBe(Number(d));
        if (!capOn) params.cap = { min: 0, max: Infinity };
        for (let k = 0; k < 48 * 7; k++) {
          const start = new Date(week0.getTime() + k * 1800e3);
          let prev = 0;
          for (let q = 1; q <= 288; q++) {
            const sub = priceWithParams(params, start, q * 0.25).subtotal;
            if (!(sub > prev)) {
              violations++;
              smallest ??= `start=${start.toISOString()} h=${q * 0.25} demand=${d} cap=${capOn}`;
            }
            prev = sub;
          }
        }
      }
    }
    expect(smallest).toBeNull();
    expect(violations).toBe(0);
  });

  it("cap still limits each hour", () => {
    const b = calculatePrice({
      baseRate: 40,
      tier: "T1",
      occupiedSlots: 10,
      totalSlots: 10,
      startTime: ist("2026-06-13T18:00:00"),
      durationHours: 3,
    });
    expect(b.combinedMultiplier).toBeLessThanOrEqual(MULTIPLIER_CAP.max + 1e-9);
    expect(b.capApplied).toBe("max");
  });
});
