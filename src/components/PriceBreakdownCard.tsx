import { useEffect, useState } from "react";
import {
  PRICE_LOCK_MS,
  SLOT_TYPE_LABELS,
  TIER_LABELS,
  formatRupees,
  type PriceBreakdown,
} from "@/lib/pricing";
import { Timer } from "lucide-react";

const DEMAND_STYLES: Record<string, string> = {
  Low: "bg-[var(--success,theme(colors.green.600))]/15 text-foreground",
  Normal: "bg-muted text-muted-foreground",
  High: "bg-accent/20 text-foreground",
  Surge: "bg-accent/35 text-foreground",
  Peak: "bg-destructive/20 text-foreground",
};

export function DemandBadge({ level }: { level: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase ${DEMAND_STYLES[level] ?? "bg-muted"}`}
    >
      Demand: {level}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** Price breakdown with a 2-minute price lock countdown. */
export function PriceBreakdownCard({
  breakdown,
  slotTypeLabel,
  onLockExpired,
}: {
  breakdown: PriceBreakdown;
  slotTypeLabel?: string;
  onLockExpired?: () => void;
}) {
  const [remaining, setRemaining] = useState(PRICE_LOCK_MS);

  useEffect(() => {
    setRemaining(Math.max(0, breakdown.computedAt + PRICE_LOCK_MS - Date.now()));
    const t = setInterval(() => {
      const left = breakdown.computedAt + PRICE_LOCK_MS - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(t);
        onLockExpired?.();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [breakdown.computedAt, onLockExpired]);

  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000)
    .toString()
    .padStart(2, "0");

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-1.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Price breakdown
        </span>
        <DemandBadge level={breakdown.demandLevel} />
      </div>

      <Row
        label={`Host hourly rate${slotTypeLabel ? ` · ${slotTypeLabel}` : ""}`}
        value={`${formatRupees(breakdown.baseRate, 0)}/hr`}
      />
      <Row
        label={`Demand · ${breakdown.occupancy.toFixed(0)}% booked`}
        value={`${breakdown.demandMultiplier}x`}
      />
      <Row
        label={`Location · ${breakdown.tier ? TIER_LABELS[breakdown.tier] : "Included in host rate"}`}
        value={`${breakdown.locationMultiplier}x`}
      />
      <Row
        label={`Time of day (avg) · ${breakdown.timeLabel}`}
        value={`${breakdown.timeMultiplier.toFixed(2)}x`}
      />
      <Row
        label={`Day (avg) · ${breakdown.dayLabel}`}
        value={`${breakdown.dayMultiplier.toFixed(2)}x`}
      />
      {breakdown.capApplied && (
        <Row
          label={`Limit applied (${breakdown.cap.min}x–${breakdown.cap.max}x)`}
          value={`${breakdown.rawMultiplier.toFixed(2)}x → ${breakdown.combinedMultiplier.toFixed(2)}x`}
        />
      )}
      <Row label="Combined multiplier" value={`${breakdown.combinedMultiplier.toFixed(2)}x`} />
      <Row
        label={`Longer-stay discount · ${breakdown.billableHours.toFixed(2)} of ${breakdown.durationHours} h billed`}
        value={`-${Math.round(breakdown.durationDiscount * 100)}%`}
      />

      <div className="border-t border-border my-2" />
      <Row label="Average price / hour" value={formatRupees(breakdown.finalPricePerHour)} />
      <Row label="Subtotal" value={formatRupees(breakdown.subtotal)} />
      <Row
        label={`GST (${Math.round(breakdown.gstRate * 100)}%)`}
        value={formatRupees(breakdown.gst)}
      />

      <div className="flex items-baseline justify-between pt-2">
        <span className="font-bold">Grand total</span>
        <span className="text-2xl font-black tabular-nums">
          {formatRupees(breakdown.grandTotal, 0)}
        </span>
      </div>

      <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
        <Timer className="w-3.5 h-3.5" />
        {remaining > 0 ? (
          <span>
            Price locked for {mm}:{ss}
          </span>
        ) : (
          <span>Refreshing price…</span>
        )}
      </div>
    </div>
  );
}

export { SLOT_TYPE_LABELS };
