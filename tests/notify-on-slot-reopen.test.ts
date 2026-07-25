/**
 * Integration test for the `notify_on_slot_reopen` trigger.
 *
 * Verifies that when a slot's status transitions from 'full' -> 'open':
 *   1. Every driver waitlisted for that slot (rows in `slot_notify`) gets a
 *      `slot_reopened` notification.
 *   2. Drivers NOT on the waitlist (or waitlisted for other slots) receive nothing.
 *   3. The waitlist rows are consumed (deleted) after notifications are inserted.
 *
 * Requires PG* env vars (PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT) pointing
 * at the Supabase Postgres instance with write + delete privileges on
 * public.slots, public.slot_notify, and public.notifications (e.g. the
 * `postgres` service role — NOT the read-only sandbox user). Run: `bun run test`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const client = new Client({ ssl: { rejectUnauthorized: false } });

// Fixture IDs — random per run so parallel runs don't collide.
const ownerId = randomUUID();
const driverA = randomUUID();
const driverB = randomUUID();
const driverC = randomUUID(); // not waitlisted for the slot under test
const slotId = randomUUID();
const otherSlotId = randomUUID();

async function q(sql: string, params: unknown[] = []) {
  return client.query(sql, params);
}

beforeAll(async () => {
  if (!process.env.PGHOST) {
    throw new Error("PGHOST not set — this test needs Supabase DB access.");
  }
  await client.connect();

  // Seed two slots owned by `ownerId`, initially full.
  await q(
    `INSERT INTO public.slots (id, owner_id, name, approx_area, full_address, lat, lng, status)
     VALUES ($1,$2,'Test Slot','area','addr',0,0,'full'),
            ($3,$2,'Other Slot','area','addr',0,0,'full')`,
    [slotId, ownerId, otherSlotId],
  );

  // driverA + driverB waitlisted for slotId; driverC waitlisted for a DIFFERENT slot.
  await q(
    `INSERT INTO public.slot_notify (driver_id, slot_id) VALUES
       ($1,$2), ($3,$2), ($4,$5)`,
    [driverA, slotId, driverB, driverC, otherSlotId],
  );
});

afterAll(async () => {
  // Clean up everything we created, in FK-safe order.
  await q(`DELETE FROM public.notifications WHERE user_id = ANY($1::uuid[])`, [
    [driverA, driverB, driverC],
  ]);
  await q(`DELETE FROM public.slot_notify WHERE slot_id = ANY($1::uuid[])`, [
    [slotId, otherSlotId],
  ]);
  await q(`DELETE FROM public.slots WHERE id = ANY($1::uuid[])`, [[slotId, otherSlotId]]);
  await client.end();
});

describe("notify_on_slot_reopen trigger", () => {
  it("notifies exactly the drivers waitlisted for the reopened slot", async () => {
    // Flip status full -> open, which fires the trigger.
    await q(`UPDATE public.slots SET status = 'open' WHERE id = $1`, [slotId]);

    const { rows: notifs } = await q(
      `SELECT user_id, type, link FROM public.notifications
       WHERE user_id = ANY($1::uuid[]) AND type = 'slot_reopened'`,
      [[driverA, driverB, driverC]],
    );

    const recipients = notifs.map((r) => r.user_id).sort();
    expect(recipients).toEqual([driverA, driverB].sort());

    // Each notif should link to the slot page.
    for (const n of notifs) {
      expect(n.link).toBe(`/slot/${slotId}`);
      expect(n.type).toBe("slot_reopened");
    }

    // driverC (waitlisted for a different, still-full slot) must NOT be notified.
    expect(recipients).not.toContain(driverC);

    // Waitlist entries for the reopened slot must be consumed;
    // entries for the other slot remain.
    const { rows: remaining } = await q(
      `SELECT slot_id FROM public.slot_notify WHERE slot_id = ANY($1::uuid[])`,
      [[slotId, otherSlotId]],
    );
    expect(remaining.map((r) => r.slot_id)).toEqual([otherSlotId]);
  });

  it("does not re-notify on no-op updates (status stays 'open')", async () => {
    const before = await q(
      `SELECT count(*)::int AS n FROM public.notifications
       WHERE user_id = ANY($1::uuid[]) AND type = 'slot_reopened'`,
      [[driverA, driverB]],
    );

    await q(`UPDATE public.slots SET name = name WHERE id = $1`, [slotId]);

    const after = await q(
      `SELECT count(*)::int AS n FROM public.notifications
       WHERE user_id = ANY($1::uuid[]) AND type = 'slot_reopened'`,
      [[driverA, driverB]],
    );

    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
