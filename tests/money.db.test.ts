/**
 * Database-level money safety tests (race conditions, caps, guards).
 * Needs PG* env vars for a role that can create auth users and SET ROLE service_role/authenticated
 * (e.g. the postgres role of a test/branch database). Opt in with RUN_DB_TESTS=1:
 *   RUN_DB_TESTS=1 bun run test:db
 * Everything is created with random ids and deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const enabled = process.env.RUN_DB_TESTS === "1" && !!process.env.PGHOST;
const mk = () => new Client({ ssl: { rejectUnauthorized: false } });
const a = mk();
const b = mk();

const host = randomUUID();
const driver = randomUUID();
const adminUser = randomUUID();
const slotId = randomUUID();
const ids: string[] = [];

async function asService<T>(c: Client, fn: () => Promise<T>) {
  await c.query("SET ROLE service_role");
  try { return await fn(); } finally { await c.query("RESET ROLE"); }
}
async function reservation(opts: { startH: number; hours: number; price?: number; hold?: boolean; status?: string }) {
  const id = randomUUID();
  ids.push(id);
  await a.query(
    `INSERT INTO reservations (id, driver_id, slot_id, start_time, end_time, status, total_price, grand_total, rate_type, payment_expires_at)
     VALUES ($1,$2,$3, now() + make_interval(mins => ($4*60)::int), now() + make_interval(mins => (($4+$5)*60)::int), $6, $7, $7, 'hourly', $8)`,
    [id, driver, slotId, opts.startH, opts.hours, opts.status ?? "upcoming", opts.price ?? 200,
     opts.hold ? new Date(Date.now() + 15 * 60e3).toISOString() : null],
  );
  return id;
}
async function payment(resId: string, status: string, paise = 20000, purpose = "booking") {
  const id = randomUUID();
  await a.query(
    `INSERT INTO payments (id, reservation_id, user_id, amount_paise, currency, status, purpose, razorpay_order_id, razorpay_payment_id)
     VALUES ($1,$2,$3,$4,'INR',$5,$6,$7,$8)`,
    [id, resId, driver, paise, status, purpose, `order_${id}`, `pay_${id}`],
  );
  return id;
}

describe.skipIf(!enabled)("money safety (database)", () => {
  beforeAll(async () => {
    await a.connect();
    await b.connect();
    for (const id of [host, driver, adminUser])
      await a.query(`INSERT INTO auth.users (id, email, aud, role) VALUES ($1, $2, 'authenticated', 'authenticated')`, [id, `${id}@test.local`]);
    await a.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [adminUser]);
    await a.query(
      `INSERT INTO slots (id, owner_id, name, approx_area, full_address, lat, lng, hourly_rate, daily_rate, monthly_rate, base_rate, approval_status)
       VALUES ($1,$2,'Test slot','Test area','1 Test St',13,80,100,800,8000,100,'approved')`, [slotId, host]);
  });
  afterAll(async () => {
    await a.query("DELETE FROM refunds WHERE reservation_id = ANY($1)", [ids]).catch(() => {});
    await a.query("DELETE FROM payments WHERE reservation_id = ANY($1)", [ids]).catch(() => {});
    await a.query("DELETE FROM reservations WHERE slot_id = $1", [slotId]).catch(() => {});
    await a.query("DELETE FROM slots WHERE id = $1", [slotId]).catch(() => {});
    await a.query("DELETE FROM auth.users WHERE id = ANY($1)", [[host, driver, adminUser]]).catch(() => {});
    await a.end();
    await b.end();
  });

  it("concurrent verify + webhook claim a capture exactly once", async () => {
    const r = await reservation({ startH: 30, hours: 2 });
    const p = await payment(r, "created");
    const claim = (c: Client) => asService(c, () => c.query("SELECT claim_payment($1,'captured',null,null) AS won", [p]));
    const [x, y] = await Promise.all([claim(a), claim(b)]);
    expect([x.rows[0].won, y.rows[0].won].filter(Boolean)).toHaveLength(1);
    const ev = await a.query("SELECT count(*)::int n FROM payment_events WHERE payment_id=$1 AND kind='payment_captured'", [p]);
    expect(ev.rows[0].n).toBe(1);
  });

  it("concurrent cancel + end refunds never exceed the captured amount", async () => {
    const r = await reservation({ startH: 30, hours: 2 });
    const p = await payment(r, "captured", 20000);
    const req = (c: Client, key: string) => asService(c, () =>
      c.query("SELECT * FROM request_refund($1,$2,15000,0,'t',$3,'test')", [r, p, key]).then(() => "ok", (e) => String(e.message)));
    const out = await Promise.all([req(a, `cancel:${r}`), req(b, `end:${r}`)]);
    expect(out.filter((o) => o === "ok")).toHaveLength(1);
    expect(out.some((o) => o.includes("REFUND_CAP"))).toBe(true);
    const sum = await a.query("SELECT COALESCE(sum(amount_paise),0)::int s FROM refunds WHERE reservation_id=$1", [r]);
    expect(sum.rows[0].s).toBeLessThanOrEqual(20000);
  });

  it("same idempotency key never creates a second refund", async () => {
    const r = await reservation({ startH: 30, hours: 2 });
    const p = await payment(r, "captured");
    await asService(a, () => a.query("SELECT * FROM request_refund($1,$2,1000,0,'t','dup-key-'||$1,'test')", [r, p]));
    const again = await asService(a, () => a.query("SELECT * FROM request_refund($1,$2,1000,0,'t','dup-key-'||$1,'test')", [r, p]));
    expect(again.rows[0].created).toBe(false);
  });

  it("an authorized-only payment cannot be refunded", async () => {
    const r = await reservation({ startH: 30, hours: 2 });
    const p = await payment(r, "authorized");
    await expect(asService(a, () => a.query("SELECT * FROM request_refund($1,$2,1000,0,'t',$3,'test')", [r, p, `k:${p}`])))
      .rejects.toThrow(/REFUND_NOT_CAPTURED/);
  });

  it("refund rows stay queued (retryable) until sent", async () => {
    const r = await reservation({ startH: 30, hours: 2 });
    const p = await payment(r, "captured");
    const res = await asService(a, () => a.query("SELECT * FROM request_refund($1,$2,1000,0,'t',$3,'test')", [r, p, `q:${p}`]));
    const row = await a.query("SELECT status FROM refunds WHERE id=$1", [res.rows[0].refund_id]);
    expect(row.rows[0].status).toBe("queued");
  });

  it("extension paid after the next slot was taken reports a conflict (and is then auto-refunded)", async () => {
    const r = await reservation({ startH: 40, hours: 1 });
    await reservation({ startH: 41, hours: 1 }); // someone books right after
    await a.query(`UPDATE reservations SET pending_extension = jsonb_build_object('minutes',60,'extra',100,
      'new_end', (end_time + interval '1 hour')::text, 'expires_at', (now() + interval '10 minutes')::text) WHERE id=$1`, [r]);
    const out = await asService(a, () => a.query("SELECT apply_extension($1) AS r", [r]));
    expect(out.rows[0].r).toBe("conflict");
    const after = await a.query("SELECT pending_extension FROM reservations WHERE id=$1", [r]);
    expect(after.rows[0].pending_extension).toBeNull();
  });

  it("only one pending extension at a time", async () => {
    const r = await reservation({ startH: 50, hours: 1 });
    const ext = JSON.stringify({ minutes: 30, extra: 50, new_end: new Date(Date.now() + 52 * 3600e3).toISOString(), expires_at: new Date(Date.now() + 600e3).toISOString() });
    const first = await asService(a, () => a.query("SELECT set_pending_extension($1,$2::jsonb) ok", [r, ext]));
    const second = await asService(a, () => a.query("SELECT set_pending_extension($1,$2::jsonb) ok", [r, ext]));
    expect(first.rows[0].ok).toBe(true);
    expect(second.rows[0].ok).toBe(false);
  });

  it("expired unpaid hold releases promo usage", async () => {
    const promo = randomUUID();
    await a.query(`INSERT INTO promo_codes (id, code, description, discount_type, discount_value, min_spend, used_count, per_user_limit)
                   VALUES ($1, $2, 't', 'flat', 10, 0, 1, 1)`, [promo, `T${promo.slice(0, 8)}`]);
    const r = await reservation({ startH: 60, hours: 1, hold: true });
    await a.query("UPDATE reservations SET payment_expires_at = now() - interval '1 minute' WHERE id=$1", [r]);
    await a.query("INSERT INTO promo_redemptions (promo_id, user_id, reservation_id, discount_amount) VALUES ($1,$2,$3,10)", [promo, driver, r]);
    await asService(a, () => a.query("SELECT expire_unpaid_reservations()"));
    const pc = await a.query("SELECT used_count FROM promo_codes WHERE id=$1", [promo]);
    const red = await a.query("SELECT count(*)::int n FROM promo_redemptions WHERE reservation_id=$1", [r]);
    expect(pc.rows[0].used_count).toBe(0);
    expect(red.rows[0].n).toBe(0);
    await a.query("DELETE FROM promo_codes WHERE id=$1", [promo]);
  });

  it("admins cannot write refund columns directly", async () => {
    const r = await reservation({ startH: 70, hours: 1 });
    const p = await payment(r, "captured");
    await a.query("BEGIN");
    try {
      await a.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adminUser, role: "authenticated" })]);
      await a.query("SET LOCAL ROLE authenticated");
      await expect(a.query("UPDATE payments SET refunded_amount_paise = 100, status='refunded' WHERE id=$1", [p])).rejects.toThrow(/payment server/);
    } finally {
      await a.query("ROLLBACK");
    }
  });

  it("parallel bookings cannot exceed the unpaid-hold cap", async () => {
    await a.query("UPDATE reservations SET payment_expires_at = NULL WHERE driver_id=$1", [driver]);
    await reservation({ startH: 80, hours: 1, hold: true });
    const ins = (c: Client, h: number) => {
      const id = randomUUID(); ids.push(id);
      return c.query(`INSERT INTO reservations (id, driver_id, slot_id, start_time, end_time, status, total_price, rate_type, payment_expires_at)
        VALUES ($1,$2,$3, now() + make_interval(hours => $4), now() + make_interval(hours => $4 + 1), 'upcoming', 100, 'hourly', now() + interval '15 minutes')`,
        [id, driver, slotId, h]).then(() => "ok", (e) => String(e.message));
    };
    const out = await Promise.all([ins(a, 90), ins(b, 92)]);
    expect(out.filter((o) => o === "ok")).toHaveLength(1);
    expect(out.some((o) => o.includes("HOLD_LIMIT"))).toBe(true);
  });

  it("webhook replays are dropped by event id", async () => {
    const id = `evt_${randomUUID()}`;
    await asService(a, () => a.query("INSERT INTO webhook_events (event_id, event) VALUES ($1,'payment.captured')", [id]));
    await expect(asService(a, () => a.query("INSERT INTO webhook_events (event_id, event) VALUES ($1,'payment.captured')", [id]))).rejects.toThrow();
    await a.query("DELETE FROM webhook_events WHERE event_id=$1", [id]);
  });

  const asDriver = async (sql: string, args: unknown[]) => {
    await a.query("BEGIN");
    try {
      await a.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: driver, role: "authenticated" })]);
      await a.query("SET LOCAL ROLE authenticated");
      return await a.query(sql, args);
    } finally {
      await a.query("ROLLBACK");
    }
  };

  it("an unpaid priced booking cannot be completed", async () => {
    const r = await reservation({ startH: 0, hours: 1, status: "active", hold: true });
    await expect(asDriver("UPDATE reservations SET status='completed' WHERE id=$1", [r])).rejects.toThrow(/pay for this booking/);
  });

  it("a paid booking cannot be cancelled directly by the driver", async () => {
    const r = await reservation({ startH: 100, hours: 1 });
    await payment(r, "captured");
    await expect(asDriver("UPDATE reservations SET status='cancelled' WHERE id=$1", [r])).rejects.toThrow(/through the app/);
  });
});
