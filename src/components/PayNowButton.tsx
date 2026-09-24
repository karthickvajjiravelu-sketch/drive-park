import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CreditCard, Check, Loader2 } from "lucide-react";
import { useRazorpay } from "@/lib/razorpay";
import { createRazorpayOrder, verifyRazorpayPayment } from "@/lib/razorpay.functions";
import { reservationPaymentStatusQuery, useProfile } from "@/lib/queries";

type Props = {
  reservationId: string;
  amount: number;
  slotName: string;
};

export function PayNowButton({ reservationId, amount, slotName }: Props) {
  const qc = useQueryClient();
  const { ready, open } = useRazorpay();
  const { data: profile } = useProfile();
  const [busy, setBusy] = useState(false);

  const createOrder = useServerFn(createRazorpayOrder);
  const verifyPayment = useServerFn(verifyRazorpayPayment);

  const { data: payment } = useQuery(reservationPaymentStatusQuery(reservationId));
  const paid = payment?.status === "captured" || payment?.status === "authorized";

  if (paid) {
    return (
      <div className="mt-2 w-full rounded-xl bg-[var(--success,theme(colors.emerald.600))]/10 border border-primary/30 py-3 font-bold flex items-center justify-center gap-2 text-sm">
        <Check className="w-4 h-4" />
        Payment received · ₹{((payment?.amount_paise ?? 0) / 100).toFixed(2)}
      </div>
    );
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["reservation-payment", reservationId] });
    qc.invalidateQueries({ queryKey: ["my-payment-methods"] });
  };
  const pollStatus = () => {
    let n = 0;
    const t = setInterval(() => {
      refresh();
      if (++n >= 5) clearInterval(t);
    }, 2000);
  };

  const pay = async () => {
    setBusy(true);
    try {
      const order = await createOrder({ data: { reservationId, amount } });
      if (!ready || typeof window === "undefined" || !window.Razorpay) {
        throw new Error("Payment gateway is still loading. Please try again.");
      }
      open(
        {
          key: order.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          name: "Usop Parking",
          description: slotName,
          order_id: order.orderId,
          token: true,
          method: { upi: true, card: true, netbanking: false, wallet: false, emi: false, paylater: false },
          prefill: { name: profile?.name || undefined, contact: profile?.phone || undefined },
          notes: { reservation_id: reservationId },
          theme: { color: "#443A78" },
          handler: async (response) => {
            try {
              await verifyPayment({
                data: {
                  reservationId,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                },
              });
              toast.success("Payment successful — booking confirmed");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not verify payment");
            } finally {
              refresh();
              pollStatus();
              setBusy(false);
            }
          },
          modal: { ondismiss: () => { setBusy(false); pollStatus(); } },
        },
        (msg) => toast.error(`Payment failed: ${msg}`),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start payment");
      setBusy(false);
    }
  };

  return (
    <button
      onClick={pay}
      disabled={busy || !ready}
      className="mt-2 w-full rounded-xl bg-primary text-primary-foreground py-3 font-bold flex items-center justify-center gap-2 disabled:opacity-60"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
      Pay ₹{amount.toFixed(2)} · UPI or card
    </button>
  );
}
