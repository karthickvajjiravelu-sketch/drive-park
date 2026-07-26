/**
 * Integration test for the `reservations_no_overlap` exclusion constraint.
 *
 * Verifies that:
 *   1. A second reservation overlapping an existing non-cancelled one on the
 *      same slot is rejected by Postgres.
 *   2. Adjacent (non-overlapping) reservations on the same slot are allowed.
 *   3. Overlapping a CANCELLED reservation is allowed.
 *
 * Requires PG* env vars pointing at Supabase Postgres with write privileges
 * on public.slots and public.reservations. Run: `bun run test`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const client = new Client({ ssl: { rejectUnauthorized: false } });

const ownerId = randomUUID();
const driverA = randomUUID();
const driverB = randomUUID();
const slotId = randomUUID();

async function q(sql: string, params: unknown[] = []) {
  return client.query(sql, params);
}

beforeAll(async () => {
  if (!process.env.PGHOST) {
    throw new Error("PGHOST not set — this test needs Supabase DB access.");
  }
  await client.connect();
  await q(
    `INSERT INTO public.slots (id, owner_id, name, approx_area, full_address, lat, lng, status)
     VALUES ($1,$2,'Overlap Slot','area','addr',0,0,'open')`,
    [slotId, ownerId],
  );
});

afterAll(async () => {
  await q(`DELETE FROM public.reservations WHERE slot_id = $1`, [slotId]);
  await q(`DELETE FROM public.slots WHERE id = $1`, [slotId]);
  await client.end();
});

describe("reservations_no_overlap exclusion constraint", () => {
  it("rejects a second reservation that overlaps an existing upcoming one", async () => {
    await q(
      `INSERT INTO public.reservations
         (driver_id, slot_id, start_time, end_time, status, total_price, rate_type)
       VALUES ($1,$2, now() + interval '1 hour', now() + interval '3 hour',
               'upcoming', 100, 'hourly')`,
      [driverA, slotId],
    );

    await expect(
      q(
        `INSERT INTO public.reservations
           (driver_id, slot_id, start_time, end_time, status, total_price, rate_type)
         VALUES ($1,$2, now() + interval '2 hour', now() + interval '4 hour',
                 'upcoming', 100, 'hourly')`,
        [driverB, slotId],
      ),
    ).rejects.toThrow(/reservations_no_overlap|conflicting/i);
  });

  it("allows adjacent, non-overlapping reservations (end == next start)", async () => {
    await q(`DELETE FROM public.reservations WHERE slot_id = $1`, [slotId]);
    await q(
      `INSERT INTO public.reservations
         (driver_id, slot_id, start_time, end_time, status, total_price, rate_type)
       VALUES ($1,$2, '2030-01-01 10:00+00', '2030-01-01 12:00+00',
               'upcoming', 100, 'hourly')`,
      [driverA, slotId],
    );
    await expect(
      q(
        `INSERT INTO public.reservations
           (driver_id, slot_id, start_time, end_time, status, total_price, rate_type)
         VALUES ($1,$2, '2030-01-01 12:00+00', '2030-01-01 14:00+00',
                 'upcoming', 100, 'hourly')`,
        [driverB, slotId],
      ),
    ).resolves.toBeDefined();
  });

  it("allows overlap with a CANCELLED reservation", async () => {
    await q(`DELETE FROM public.reservations WHERE slot_id = $1`, [slotId]);
    await q(
      `INSERT INTO public.reservations
         (driver_id, slot_id, start_time, end_time, status, total_price, rate_type)
       VALUES ($1,$2, '2031-01-01 10:00+00', '2031-01-01 12:00+00',
               'cancelled', 100, 'hourly')`,
      [driverA, slotId],
    );
    await expect(
      q(
        `INSERT INTO public.reservations
           (driver_id, slot_id, start_time, end_time, status, total_price, rate_type)
         VALUES ($1,$2, '2031-01-01 11:00+00', '2031-01-01 13:00+00',
                 'upcoming', 100, 'hourly')`,
        [driverB, slotId],
      ),
    ).resolves.toBeDefined();
  });
});
