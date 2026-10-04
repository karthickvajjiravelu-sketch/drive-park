import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const eventSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({ entity: z.object({ id: z.string(), order_id: z.string().nullable().optional(), status: z.string().optional() }).passthrough() }).optional(),
    order: z.object({ entity: z.object({ id: z.string() }).passthrough() }).optional(),
    refund: z.object({ entity: z.object({ payment_id: z.string() }).passthrough() }).optional(),
  }).passthrough(),
});

const RANK: Record<string, number> = { created: 0, failed: 1, authorized: 2, captured: 3, refunded: 4 };

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

        let next: "authorized" | "captured" | "failed" | "refunded" | null = null;
        let orderId: string | null = null;
        let paymentId: string | null = payment?.id ?? null;
        if (event === "payment.captured" || event === "order.paid") {
          next = "captured";
          orderId = payment?.order_id ?? payload.order?.entity.id ?? null;
        } else if (event === "payment.authorized") {
          next = "authorized";
          orderId = payment?.order_id ?? null;
        } else if (event === "payment.failed") {
          next = "failed";
          orderId = payment?.order_id ?? null;
        } else if (event === "refund.processed") {
          next = "refunded";
          paymentId = payload.refund?.entity.payment_id ?? paymentId;
        } else {
          return new Response("ignored");
        }

        const q = supabaseAdmin.from("payments").select("id, status, user_id, reservation_id");
        const { data: row } = orderId
          ? await q.eq("razorpay_order_id", orderId).maybeSingle()
          : await q.eq("razorpay_payment_id", paymentId ?? "").maybeSingle();
        if (!row) return new Response("ok"); // unknown order; acknowledge

        // Idempotent + monotonic: never downgrade (e.g. captured -> failed)
        if ((RANK[row.status] ?? 0) >= RANK[next]) return new Response("ok");

        await supabaseAdmin
          .from("payments")
          .update({
            status: next,
            ...(paymentId ? { razorpay_payment_id: paymentId } : {}),
            gateway_response: JSON.parse(raw),
          })
          .eq("id", row.id);

        if (next === "captured" || next === "authorized") {
          await supabaseAdmin
            .from("reservations")
            .update({ payment_expires_at: null })
            .eq("id", row.reservation_id)
            .neq("status", "cancelled");
        }

        if (next === "captured") {
          await supabaseAdmin.from("notifications").insert({
            user_id: row.user_id,
            type: "payment",
            title: "Payment received",
            body: "Your parking booking is confirmed.",
            link: "/reservations",
          });
        }
        return new Response("ok");
      },
    },
  },
});
