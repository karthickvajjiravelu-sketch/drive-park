import type { Slot } from "@/lib/queries";
import { Shield, Video, Accessibility, Ruler } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AmenityKey = "covered" | "cctv" | "disabled_access";

export const AMENITIES: { key: AmenityKey; label: string; icon: LucideIcon }[] = [
  { key: "covered", label: "Covered", icon: Shield },
  { key: "cctv", label: "CCTV", icon: Video },
  { key: "disabled_access", label: "Accessible", icon: Accessibility },
];

export function slotAmenities(slot: Pick<Slot, "covered" | "cctv" | "disabled_access">) {
  return AMENITIES.filter((a) => slot[a.key]);
}

export { Ruler };

export type CancellationPolicy = "flexible" | "moderate" | "strict";

export const POLICY_META: Record<
  CancellationPolicy,
  { label: string; blurb: string; hoursBefore: number }
> = {
  flexible: { label: "Flexible", blurb: "Full refund up to booking start.", hoursBefore: 0 },
  moderate: {
    label: "Moderate",
    blurb: "Full refund if cancelled 24h before start.",
    hoursBefore: 24,
  },
  strict: {
    label: "Strict",
    blurb: "Full refund only if cancelled 48h before start.",
    hoursBefore: 48,
  },
};

export function refundEligible(policy: CancellationPolicy, startTimeIso: string): boolean {
  const meta = POLICY_META[policy];
  const start = new Date(startTimeIso).getTime();
  return start - Date.now() >= meta.hoursBefore * 3600e3;
}
