import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMyReservations } from "@/lib/queries";
import { ArrowLeft, CreditCard, Wallet as WalletIcon, Plus, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/wallet")({
  component: WalletPage,
});

type MockCard = { id: string; brand: string; last4: string; exp: string; primary: boolean };

const MOCK_CARDS_KEY = "usop-mock-cards";

function loadCards(): MockCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MOCK_CARDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* user cancelled or clipboard denied */ }
  const seed: MockCard[] = [
    { id: "c1", brand: "Visa", last4: "4242", exp: "08/28", primary: true },
  ];
  localStorage.setItem(MOCK_CARDS_KEY, JSON.stringify(seed));
  return seed;
}

function saveCards(cards: MockCard[]) {
  localStorage.setItem(MOCK_CARDS_KEY, JSON.stringify(cards));
}

function WalletPage() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<MockCard[]>(() => loadCards());
  const [adding, setAdding] = useState(false);
  const [num, setNum] = useState("");
  const [exp, setExp] = useState("");
  const { data: reservations = [] } = useMyReservations();

  const totalSpent = reservations.filter(r => r.status !== "cancelled").reduce((s, r) => s + Number(r.total_price || 0), 0);
  const wallet = Math.max(0, 500 - (totalSpent % 500));

  function addCard(e: React.FormEvent) {
    e.preventDefault();
    const digits = num.replace(/\D/g, "");
    if (digits.length < 12) { toast.error("Enter a valid card number"); return; }
    const brand = /^4/.test(digits) ? "Visa" : /^5/.test(digits) ? "Mastercard" : "Card";
    const next = [...cards, { id: crypto.randomUUID(), brand, last4: digits.slice(-4), exp, primary: cards.length === 0 }];
    setCards(next); saveCards(next);
    setNum(""); setExp(""); setAdding(false);
    toast.success("Card added (mock)");
  }
  function makePrimary(id: string) {
    const next = cards.map(c => ({ ...c, primary: c.id === id }));
    setCards(next); saveCards(next);
  }
  function remove(id: string) {
    const next = cards.filter(c => c.id !== id);
    if (next.length && !next.some(c => c.primary)) next[0].primary = true;
    setCards(next); saveCards(next);
  }

  return (
    <div className="pb-24">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-6 rounded-b-3xl">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate({ to: "/profile" })}
            className="w-10 h-10 rounded-full bg-white/10 grid place-items-center"><ArrowLeft className="w-5 h-5"/></button>
          <h1 className="text-2xl font-black">Wallet</h1>
        </div>
        <div className="mt-5 rounded-2xl bg-primary text-primary-foreground p-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
            <WalletIcon className="w-4 h-4"/>Usop credits
          </div>
          <div className="mt-2 text-4xl font-black">₹{wallet}</div>
          <div className="mt-1 text-xs opacity-70">Mock balance · earn credits from cancellations & referrals</div>
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
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Payment methods</h2>
          {!adding && (
            <button onClick={() => setAdding(true)}
              className="text-xs font-bold text-primary-foreground bg-primary px-3 py-1.5 rounded-full flex items-center gap-1">
              <Plus className="w-3.5 h-3.5"/>Add
            </button>
          )}
        </div>

        {adding && (
          <form onSubmit={addCard} className="rounded-2xl bg-card border border-border p-4 space-y-3 mb-3">
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Card number</span>
              <input value={num} onChange={e => setNum(e.target.value.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").slice(0, 19))}
                inputMode="numeric" placeholder="4242 4242 4242 4242"
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 font-mono"/>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Expiry (MM/YY)</span>
              <input value={exp} onChange={e => setExp(e.target.value)} placeholder="08/28"
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5"/>
            </label>
            <p className="text-[10px] text-muted-foreground">Demo only — no real charges. Cards saved locally.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdding(false)}
                className="flex-1 rounded-xl border border-border py-2 text-sm font-semibold">Cancel</button>
              <button type="submit" className="flex-1 rounded-xl bg-primary py-2 text-sm font-bold text-primary-foreground">Save card</button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {cards.length === 0 && !adding && (
            <p className="text-center text-sm text-muted-foreground py-6">No payment methods yet.</p>
          )}
          {cards.map(c => (
            <div key={c.id} className="rounded-2xl bg-card border border-border p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-black text-white grid place-items-center"><CreditCard className="w-5 h-5"/></div>
              <div className="flex-1">
                <div className="font-bold text-sm">{c.brand} •••• {c.last4}</div>
                <div className="text-xs text-muted-foreground">Exp {c.exp || "—"}</div>
              </div>
              {c.primary ? (
                <span className="text-[10px] font-black uppercase text-primary-foreground bg-primary px-2 py-1 rounded-full flex items-center gap-1"><Check className="w-3 h-3"/>Primary</span>
              ) : (
                <button onClick={() => makePrimary(c.id)} className="text-[10px] font-bold text-muted-foreground uppercase">Set primary</button>
              )}
              <button onClick={() => remove(c.id)} className="text-[10px] font-bold text-destructive uppercase">Remove</button>
            </div>
          ))}
        </div>

        <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Recent transactions</h2>
        <div className="space-y-2">
          {reservations.slice(0, 10).map(r => (
            <div key={r.id} className="flex items-center justify-between rounded-xl bg-card border border-border p-3 text-sm">
              <div className="min-w-0">
                <div className="font-semibold truncate">{r.slot?.name ?? "Booking"}</div>
                <div className="text-xs text-muted-foreground">{new Date(r.start_time).toLocaleDateString()} · <span className="capitalize">{r.status}</span></div>
              </div>
              <div className={`font-black ${r.status === "cancelled" ? "line-through text-muted-foreground" : ""}`}>₹{r.total_price}</div>
            </div>
          ))}
          {reservations.length === 0 && <p className="text-center text-xs text-muted-foreground py-4">No transactions yet.</p>}
        </div>
      </div>
    </div>
  );
}
