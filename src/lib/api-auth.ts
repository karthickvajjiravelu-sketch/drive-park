// Bearer-token auth + JSON helpers for /api/public/* routes used by the mobile app.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
type UserCtx = { supabase: SupabaseClient<Database>; userId: string };

const ALLOWED_ORIGINS = ["https://www.usop.in", "https://usop.in"];

export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export const json = (request: Request, body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors(request) });

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Validate `Authorization: Bearer <supabase access token>` and build a user-scoped client. */
export async function authenticate(request: Request): Promise<UserCtx> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError("Missing bearer token", 401);
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("Authorization", `Bearer ${token}`);
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (error || !sub) throw new HttpError("Invalid or expired token", 401);
  return { supabase, userId: sub };
}

type HandleOpts = { idempotent?: string };

/**
 * Wrap a handler: auth, JSON body, optional Idempotency-Key replay, consistent error responses.
 * With `idempotent`, a repeated Idempotency-Key from the same user returns the first response.
 */
export function handle(
  fn: (args: { request: Request; ctx: UserCtx; body: unknown; params: Record<string, string> }) => Promise<unknown>,
  opts: HandleOpts = {},
) {
  return async ({ request, params }: { request: Request; params: Record<string, string> }) => {
    let idem: { db: Awaited<ReturnType<typeof adminDb>>; userId: string; key: string } | null = null;
    try {
      const ctx = await authenticate(request);
      const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
      const key = request.headers.get("idempotency-key")?.trim();
      if (opts.idempotent && key) {
        if (key.length > 200) throw new HttpError("Idempotency-Key too long", 400);
        const db = await adminDb();
        const { error } = await db.from("idempotency_keys").insert({ user_id: ctx.userId, scope: opts.idempotent, key });
        if (error) {
          const { data: prev } = await db.from("idempotency_keys").select("response, status_code")
            .eq("user_id", ctx.userId).eq("scope", opts.idempotent).eq("key", key).maybeSingle();
          if (prev?.status_code) return json(request, prev.response, prev.status_code);
          throw new HttpError("A request with this Idempotency-Key is still in progress", 409);
        }
        idem = { db, userId: ctx.userId, key };
      }
      const result = await fn({ request, ctx, body, params });
      if (idem) await idem.db.from("idempotency_keys").update({ response: result as never, status_code: 200 })
        .eq("user_id", idem.userId).eq("scope", opts.idempotent!).eq("key", idem.key);
      return json(request, result);
    } catch (e) {
      // Errors are not cached: release the key so the client may retry.
      if (idem) await idem.db.from("idempotency_keys").delete().eq("user_id", idem.userId).eq("scope", opts.idempotent!).eq("key", idem.key);
      return errorResponse(request, e);
    }
  };
}

async function adminDb() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export async function errorResponse(request: Request, e: unknown) {
  const { BookingError } = await import("@/lib/bookings.server");
  const { PaymentError } = await import("@/lib/payments.server");
  const { ZodError } = await import("zod");
  if (e instanceof PaymentError) {
    const res = json(request, { error: e.message }, e.status);
    if (e.retryAfter) res.headers.set("Retry-After", String(e.retryAfter));
    return res;
  }
  if (e instanceof HttpError || e instanceof BookingError) return json(request, { error: e.message }, e.status);
  if (e instanceof ZodError) return json(request, { error: "Invalid input", issues: e.issues }, 400);
  console.error(e);
  return json(request, { error: "Internal error" }, 500);
}

export const options = ({ request }: { request: Request }) => new Response(null, { status: 204, headers: cors(request) });
