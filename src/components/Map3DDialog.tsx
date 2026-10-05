import { lazy, Suspense, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { CameraPolicy } from "@/lib/map3d-camera";
import {
  check3DLoad,
  record3DLoad,
  sessionStore,
  GUARD_TEXT,
  type GuardResult,
} from "@/lib/map3d-support";
import type { OverlayKind } from "@/components/SlotMap3D";

const SlotMap3D = lazy(() => import("@/components/SlotMap3D"));

export type Map3DItem = {
  id: string;
  name: string;
  approxArea: string;
  rateLabel: string;
  policy: CameraPolicy;
};

export const LOCKED_TEXT = "Approximate location. Exact address unlocks after payment.";

export default function Map3DDialog({
  items,
  initialIndex = 0,
  onClose,
  onFallback,
  closeLabel = "Back to map",
}: {
  items: Map3DItem[];
  initialIndex?: number;
  onClose: () => void;
  /** 3D failed: caller shows a message and stays on / returns to 2D. */
  onFallback: (message: string) => void;
  closeLabel?: string;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [status, setStatus] = useState("Loading 3D view…");
  const [overlay, setOverlay] = useState<OverlayKind | null>(null);
  const item = items[index];
  const guard: GuardResult = useMemo(
    () => (item ? check3DLoad(sessionStore(), item.id) : { ok: false, reason: "slot" }),
    [item],
  );

  if (!item) return null;
  const go = (d: number) => {
    setOverlay(null);
    setStatus("Loading 3D view…");
    setIndex((i) => (i + d + items.length) % items.length);
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
          aria-describedby="map3d-summary"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <DialogPrimitive.Close asChild>
              <button className="min-h-11 inline-flex items-center gap-1 px-3 rounded-full bg-secondary text-secondary-foreground font-semibold text-sm">
                <ArrowLeft className="w-4 h-4" aria-hidden />
                {closeLabel}
              </button>
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="font-bold truncate flex-1">
              3D view · {item.name}
            </DialogPrimitive.Title>
          </div>

          <div className="relative flex-1 min-h-[50vh] bg-muted">
            {guard.ok ? (
              <Suspense
                fallback={<div className="absolute inset-0 bg-muted animate-pulse" aria-hidden />}
              >
                <SlotMap3D
                  key={item.id}
                  policy={item.policy}
                  label={`3D view of ${item.name}`}
                  onOverlay={setOverlay}
                  onLoaded={() => {
                    record3DLoad(sessionStore(), item.id);
                    setStatus("3D view loaded.");
                  }}
                  onError={(m) => {
                    setStatus(m);
                    onFallback(m);
                  }}
                />
              </Suspense>
            ) : (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <p className="text-sm font-semibold">{GUARD_TEXT[guard.reason]}</p>
              </div>
            )}
          </div>

          <div id="map3d-summary" className="px-4 py-3 border-t border-border space-y-1">
            <p role="status" aria-live="polite" className="sr-only">
              {guard.ok ? status : GUARD_TEXT[guard.reason]}
            </p>
            <div className="flex items-center gap-2">
              {items.length > 1 && (
                <button
                  onClick={() => go(-1)}
                  aria-label="Previous space"
                  className="w-11 h-11 grid place-items-center rounded-full bg-secondary"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{item.name}</div>
                <div className="text-sm text-muted-foreground truncate">
                  {item.approxArea} · {item.rateLabel}
                </div>
              </div>
              {items.length > 1 && (
                <button
                  onClick={() => go(1)}
                  aria-label="Next space"
                  className="w-11 h-11 grid place-items-center rounded-full bg-secondary"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
            {item.policy.locked && (
              <p className="text-xs text-muted-foreground">
                {overlay === "circle" ? "Shaded circle shows the approximate area. " : ""}
                {LOCKED_TEXT}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              The list and the 2D map are the easiest way to browse with a keyboard or screen
              reader.
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
