import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const eventSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({ entity: z.object({ id: z.string(), order_id: z.string().nullable().optional(), status: z.string().optional() }).passthrough() }).optional(),
    order: z.object({ entity: z.object({ id: z.string() }).passthrough() }).optional(),
    refund: z.object({ entity: z.object({ id: z.string(), payment_id: z.string(), amount: z.number().optional() }).passthrough() }).optional(),
  }).passthrough(),
});

const RANK: Record<string, number> = { created: 0, failed: 1, authorized: 2, captured: 3, partially_refunded: 4, refunded: 5 };

export const Route = createFileRoute("/api/public/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["RAZORPAY_WEBHOOK_SECRET"];
        if (!secret) return new Response("Webhook not configured", { status: 503 });

        const raw = await request.text();
        const sig = request.headers.get("x-razorpay-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed;
        try {
          parsed = eventSchema.parse(JSON.parse(raw));
        } catch {
          return new Response("Bad payload", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { event, payload } = parsed;
        const payment = payload.payment?.entity;

        // Refund events: match the exact refund row (several refunds per payment are allowed).
        if (event === "refund.processed" || event === "refund.failed") {
          const rf = payload.refund?.entity;
          if (!rf) return new Response("ok");
          const status = event === "refund.processed" ? "processed" : "failed";
          const { data: row } = await supabaseAdmin.from("refunds").select("id, payment_id, status").eq("razorpay_refund_id", rf.id).maybeSingle();
          if (!row || row.status === "processed") return new Response("ok"); // replay or unknown
          await supabaseAdmin.from("refunds").update({ status, updated_at: new Date().toISOString() }).eq("id", row.id);
          const { syncPaymentRefunds } = await import("@/lib/payments.server");
          await syncPaymentRefunds(row.payment_id);
          return new Response("ok");
        }

        let next: "authorized" | "captured" | "failed" | null = null;
        if (event === "payment.captured" || event === "order.paid") next = "captured";
        else if (event === "payment.authorized") next = "authorized";
        else if (event === "payment.failed") next = "failed";
        else return new Response("ignored");
        const orderId = payment?.order_id ?? payload.order?.entity.id ?? null;
        const paymentId = payment?.id ?? null;
        if (!orderId) return new Response("ok");

        const { data: row } = await supabaseAdmin.from("payments").select("id, status, user_id").eq("razorpay_order_id", orderId).maybeSingle();
        if (!row) return new Response("ok");
        // Idempotent + monotonic: never downgrade (captured -> failed) or reprocess a replay.
        if ((RANK[row.status] ?? 0) >= RANK[next]) return new Response("ok");

        await supabaseAdmin.from("payments").update({
          status: next, ...(paymentId ? { razorpay_payment_id: paymentId } : {}), gateway_response: JSON.parse(raw),
        }).eq("id", row.id);

        if (row.status === "created" && (next === "captured" || next === "authorized")) {
          const { applyCapture } = await import("@/lib/payments.server");
          await applyCapture(row.id);
        }
        if (next === "captured") {
          await supabaseAdmin.from("notifications").insert({
            user_id: row.user_id, type: "payment", title: "Payment received", body: "Your parking payment was received.", link: "/reservations",
          });
        }
        return new Response("ok");
      },
    },
  },
});
