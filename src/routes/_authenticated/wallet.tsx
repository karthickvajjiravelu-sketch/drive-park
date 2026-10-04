import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { billedAmount } from "@/lib/money";
import { useQueryClient } from "@tanstack/react-query";
import { useMyReservations, useMyPaymentMethods } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, CreditCard, Wallet as WalletIcon, Check, Smartphone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/wallet")({
  component: WalletPage,
  head: () => ({
    meta: [
      { title: "Wallet & Payment Methods | Usop" },
      {
        name: "description",
        content: "Manage your saved UPI and card payment methods, credits and parking transactions on Usop.",
      },
      { property: "og:title", content: "Wallet & Payment Methods | Usop" },
      {
        property: "og:description",
        content: "Manage saved UPI and card methods, credits and parking transactions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function WalletPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: reservations = [] } = useMyReservations();
  const { data: methods = [] } = useMyPaymentMethods();

  const totalSpent = reservations
    .reduce((s, r) => s + billedAmount(r), 0);
  const wallet = Math.max(0, 500 - (totalSpent % 500));

  const refresh = () => qc.invalidateQueries({ queryKey: ["my-payment-methods"] });

  const makeDefault = async (id: string) => {
    const { error } = await supabase.from("payment_methods").update({ is_default: true }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Default payment method updated");
    refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("payment_methods").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Payment method removed");
    refresh();
  };

  return (
    <div className="pb-24">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-6 rounded-b-3xl">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/profile" })}
            className="w-10 h-10 rounded-full bg-white/10 grid place-items-center"
            aria-label="Back to profile"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-black">Wallet</h1>
        </div>
        <div className="mt-5 rounded-2xl bg-primary text-primary-foreground p-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
            <WalletIcon className="w-4 h-4" />
            Usop credits
          </div>
          <div className="mt-2 text-4xl font-black">₹{wallet}</div>
          <div className="mt-1 text-xs opacity-70">
            Credits earned from cancellations &amp; referrals
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-white/80">
          <div className="rounded-xl bg-white/10 p-3">
            <div className="text-[10px] uppercase tracking-wider text-white/60">Lifetime spent</div>
            <div className="text-lg font-black">₹{totalSpent}</div>
          </div>
          <div className="rounded-xl bg-white/10 p-3">
            <div className="text-[10px] uppercase tracking-wider text-white/60">Bookings</div>
            <div className="text-lg font-black">{reservations.length}</div>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Payment methods
        </h2>

        <div className="rounded-2xl border border-border bg-card p-3 flex items-start gap-2 text-xs mb-3">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-muted-foreground">
            Cards and UPI IDs are saved securely by our payment gateway when you check out — Usop
            only stores a token, never your card number or CVV.
          </p>
        </div>

        <div className="space-y-2">
          {methods.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">
              No saved methods yet. Pay for a booking and choose “save for later” to add one.
            </p>
          )}
          {methods.map((m) => (
            <div
              key={m.id}
              className="rounded-2xl bg-card border border-border p-3 flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-foreground text-background grid place-items-center">
                {m.method === "upi" ? (
                  <Smartphone className="w-5 h-5" />
                ) : (
                  <CreditCard className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">
                  {m.method === "upi"
                    ? m.last4 || "UPI"
                    : `${m.network || "Card"} •••• ${m.last4 || "____"}`}
                </div>
                <div className="text-xs text-muted-foreground capitalize">{m.method}</div>
              </div>
              {m.is_default ? (
                <span className="text-[10px] font-black uppercase text-primary-foreground bg-primary px-2 py-1 rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Default
                </span>
              ) : (
                <button
                  onClick={() => makeDefault(m.id)}
                  className="text-[10px] font-bold text-muted-foreground uppercase"
                >
                  Set default
                </button>
              )}
              <button
                onClick={() => remove(m.id)}
                className="text-[10px] font-bold text-destructive uppercase"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Recent transactions
        </h2>
        <div className="space-y-2">
          {reservations.slice(0, 10).map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-xl bg-card border border-border p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-semibold truncate">{r.slot?.name ?? "Booking"}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.start_time).toLocaleDateString()} ·{" "}
                  <span className="capitalize">{r.status}</span>
                </div>
              </div>
              <div
                className={`font-black ${billedAmount(r) === 0 ? "text-muted-foreground" : ""}`}
              >
                ₹{billedAmount(r)}
                {billedAmount(r) !== Number(r.total_price) && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground line-through">₹{r.total_price}</span>
                )}
              </div>
            </div>
          ))}
          {reservations.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">No transactions yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
