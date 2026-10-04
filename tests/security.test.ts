/**
 * Security hardening checks. Each case runs in a rolled-back transaction while
 * impersonating a signed-in user (role `authenticated` + JWT claims), so the
 * real RLS policies, column grants and guard triggers are exercised.
 * Needs PG* env vars with rights to create auth users. Run: `bun run test`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const enabled = process.env.RUN_DB_TESTS === "1" && !!process.env.PGHOST;
const client = new Client({ ssl: { rejectUnauthorized: false } });

const host = randomUUID();
const driver = randomUUID();
const stranger = randomUUID();
const slotId = randomUUID();
const resId = randomUUID();

async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ]);
    await client.query("SET LOCAL ROLE authenticated");
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}
const sql = (text: string, params: unknown[] = []) => client.query(text, params);

describe.skipIf(!enabled)("security hardening", () => {
  beforeAll(async () => {
    await client.connect();
    for (const id of [host, driver, stranger]) {
      await sql(
        `INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
         VALUES ($1, $2, '{"role":"landowner"}', 'authenticated', 'authenticated')`,
        [id, `${id}@test.usop`],
      );
    }
    await sql(
      `INSERT INTO public.slots (id, owner_id, name, approx_area, full_address, access_instructions, lat, lng, status, approval_status)
       VALUES ($1,$2,'Sec Slot','area','42 Secret St','Gate code 1234',0,0,'open','approved')`,
      [slotId, host],
    );
    await sql(
      `INSERT INTO public.reservations (id, driver_id, slot_id, start_time, end_time, status, total_price, rate_type)
       VALUES ($1,$2,$3, now() + interval '1 day', now() + interval '1 day 2 hours', 'upcoming', 200, 'hourly')`,
      [resId, driver, slotId],
    );
  });

  afterAll(async () => {
    if (!enabled) return;
    await sql("DELETE FROM public.reservations WHERE id = $1", [resId]);
    await sql("DELETE FROM public.slots WHERE id = $1", [slotId]);
    await sql("DELETE FROM auth.users WHERE id = ANY($1)", [[host, driver, stranger]]);
    await client.end();
  });

  it("#1 drivers cannot insert reservations directly", async () => {
    await expect(
      asUser(driver, () =>
        sql(
          `INSERT INTO public.reservations (driver_id, slot_id, start_time, end_time, status, total_price, rate_type)
           VALUES ($1,$2, now()+interval '3 days', now()+interval '3 days 1 hour','upcoming',1,'hourly')`,
          [driver, slotId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("#2 drivers cannot lower price, move end time or self-activate", async () => {
    await expect(asUser(driver, () => sql("UPDATE public.reservations SET total_price = 1 WHERE id=$1", [resId]))).rejects.toThrow();
    await expect(asUser(driver, () => sql("UPDATE public.reservations SET end_time = end_time + interval '5 hours' WHERE id=$1", [resId]))).rejects.toThrow();
    await expect(asUser(driver, () => sql("UPDATE public.reservations SET status='active' WHERE id=$1", [resId]))).rejects.toThrow();
  });

  it("#2 drivers can cancel their own upcoming booking", async () => {
    const r = await asUser(driver, () => sql("UPDATE public.reservations SET status='cancelled' WHERE id=$1", [resId]));
    expect(r.rowCount).toBe(1);
  });

  it("#3 users cannot self-verify, unsuspend or change role", async () => {
    await expect(asUser(driver, () => sql("UPDATE public.profiles SET verified = true WHERE user_id=$1", [driver]))).rejects.toThrow();
    await expect(asUser(driver, () => sql("UPDATE public.profiles SET role = 'driver' WHERE user_id=$1", [driver]))).rejects.toThrow();
    const ok = await asUser(driver, () => sql("UPDATE public.profiles SET name = 'New Name' WHERE user_id=$1", [driver]));
    expect(ok.rowCount).toBe(1);
  });

  it("#3 new slots are forced to pending and rating can't be set", async () => {
    const status = await asUser(host, async () => {
      const r = await sql(
        `INSERT INTO public.slots (owner_id, name, approx_area, full_address, lat, lng, approval_status, rating)
         VALUES ($1,'x','a','b',0,0,'approved',5) RETURNING id`,
        [host],
      );
      await client.query("RESET ROLE");
      return (await sql("SELECT approval_status, rating FROM public.slots WHERE id=$1", [r.rows[0].id])).rows[0];
    });
    expect(status).toEqual({ approval_status: "pending", rating: "0" });
    await expect(asUser(host, () => sql("UPDATE public.slots SET approval_status='approved' WHERE id=$1", [slotId]))).rejects.toThrow();
  });

  it("#4 address is hidden from strangers but visible to the booked driver and host", async () => {
    await expect(asUser(stranger, () => sql("SELECT full_address FROM public.slots WHERE id=$1", [slotId]))).rejects.toThrow();
    const none = await asUser(stranger, () => sql("SELECT * FROM public.get_slots_private($1)", [[slotId]]));
    expect(none.rowCount).toBe(0);
    const mine = await asUser(driver, () => sql("SELECT full_address FROM public.get_slots_private($1)", [[slotId]]));
    expect(mine.rows[0]?.full_address).toBe("42 Secret St");
    const owner = await asUser(host, () => sql("SELECT full_address FROM public.get_slots_private($1)", [[slotId]]));
    expect(owner.rowCount).toBe(1);
  });

  it("#6 messages must go between the booking's driver and host", async () => {
    await expect(
      asUser(driver, () =>
        sql("INSERT INTO public.messages (reservation_id, sender_id, recipient_id, body) VALUES ($1,$2,$3,'hi')", [resId, driver, stranger]),
      ),
    ).rejects.toThrow();
    const ok = await asUser(driver, () =>
      sql("INSERT INTO public.messages (reservation_id, sender_id, recipient_id, body) VALUES ($1,$2,$3,'hi')", [resId, driver, host]),
    );
    expect(ok.rowCount).toBe(1);
  });

  it("#8 promo redemptions cannot be inserted by users", async () => {
    await expect(
      asUser(driver, () =>
        sql("INSERT INTO public.promo_redemptions (promo_id, user_id, discount_amount) VALUES ($1,$2,100)", [randomUUID(), driver]),
      ),
    ).rejects.toThrow();
  });
});
