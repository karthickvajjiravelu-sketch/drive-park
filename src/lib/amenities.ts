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

import { REFUND_CONFIG, policyBlurb, cancellationRefundShare, type CancellationPolicy } from "@/lib/refund-policy";
export type { CancellationPolicy };

const meta = (p: CancellationPolicy, label: string) => ({
  label,
  blurb: policyBlurb(p),
  hoursBefore: REFUND_CONFIG.policies[p].fullUntilHours,
});

/** Wording is generated from src/lib/refund-policy.ts so it always matches what the server refunds. */
export const POLICY_META: Record<CancellationPolicy, { label: string; blurb: string; hoursBefore: number }> = {
  flexible: meta("flexible", "Flexible"),
  moderate: meta("moderate", "Moderate"),
  strict: meta("strict", "Strict"),
};

/** True when cancelling now would give a full refund. */
export function refundEligible(policy: CancellationPolicy, startTimeIso: string): boolean {
  return cancellationRefundShare(policy, startTimeIso) === 1;
}
