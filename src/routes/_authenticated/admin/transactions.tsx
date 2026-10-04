import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { adminRefundFn } from "@/lib/razorpay.functions";
import { billedAmount } from "@/lib/money";
import { useAdminTransactions } from "@/lib/admin-queries";
import { AdminSection, AdminCard, AdminButton, Pill, inr } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/transactions")({
  head: () => ({
    meta: [
      { title: "Transactions & refunds · Usop admin" },
      {
        name: "description",
        content: "Monitor every Usop booking and payment, and issue refunds through Razorpay.",
      },
    ],
  }),
  component: AdminTransactions,
});

function AdminTransactions() {
  const { data: rows = [], isLoading } = useAdminTransactions();
  const qc = useQueryClient();

  const adminRefund = useServerFn(adminRefundFn);

  // Refunds always go through Razorpay on the server (same cap and audit as automatic refunds).
  async function refund(paymentId: string, maxPaise: number) {
    const input = prompt(`Refund amount in ₹ (max ${(maxPaise / 100).toFixed(2)})`);
    if (!input) return;
    const rupees = Number(input);
    if (!Number.isFinite(rupees) || rupees <= 0 || Math.floor(rupees * 100) > maxPaise)
      return toast.error("Invalid amount");
    const reason = prompt("Refund reason?")?.trim();
    if (!reason) return toast.error("A reason is required");
    try {
      const res = await adminRefund({ data: { paymentId, amountPaise: Math.floor(rupees * 100), reason } });
      toast.success(`Refund of ${inr(res.queuedPaise / 100)} sent to Razorpay`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refund failed");
    }
    qc.invalidateQueries({ queryKey: ["admin-transactions"] });
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <AdminSection title={`Latest transactions (${rows.length})`}>
      {rows.map((r) => {
        const total = billedAmount(r);
        return (
          <AdminCard key={r.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{r.slot?.name ?? "Deleted slot"}</span>
              <Pill tone={r.status === "cancelled" ? "danger" : "muted"}>{r.status}</Pill>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {new Date(r.start_time).toLocaleString()} → {new Date(r.end_time).toLocaleTimeString()}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-foreground">{inr(total)}</span>
              {r.promo_code && <Pill tone="warn">{r.promo_code}</Pill>}
              {r.payment ? (
                <Pill tone={r.payment.status === "captured" ? "success" : "muted"}>
                  {r.payment.status}
                </Pill>
              ) : (
                <Pill>unpaid</Pill>
              )}
              {r.payment && r.payment.refunded_amount_paise > 0 && (
                <Pill tone="danger">
                  refunded {inr(r.payment.refunded_amount_paise / 100)}
                </Pill>
              )}
            </div>
            {r.payment && ["captured", "partially_refunded"].includes(r.payment.status) && r.payment.refunded_amount_paise < r.payment.amount_paise && (
              <div className="mt-3">
                <AdminButton
                  variant="ghost"
                  onClick={() => refund(r.payment!.id, r.payment!.amount_paise - r.payment!.refunded_amount_paise)}
                >
                  Issue refund
                </AdminButton>
              </div>
            )}
          </AdminCard>
        );
      })}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No transactions yet.</p>}
    </AdminSection>
  );
}
