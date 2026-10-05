import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Box } from "lucide-react";
import { toast } from "sonner";
import { cameraPolicy } from "@/lib/map3d-camera";
import { MAP3D_FLAG, canUse3D, slot3DButtonVisible } from "@/lib/map3d-support";

const Map3DDialog = lazy(() => import("@/components/Map3DDialog"));

type SlotLike = {
  id: string;
  name: string;
  approx_area: string;
  hourly_rate: number;
  lat: number;
  lng: number;
  full_address?: string;
};

/**
 * Renders nothing unless the flag is on, the slot is unlocked (full_address came back from
 * get_slots_private, so lat/lng are exact) and the device can run 3D.
 */
export default function Slot3DButton({
  slot,
  flag = MAP3D_FLAG,
}: {
  slot: SlotLike;
  flag?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setSupported(canUse3D(flag)), [flag]);
  const unlocked = !!slot.full_address && slot.full_address.trim() !== "";
  const policy = useMemo(
    () =>
      cameraPolicy({
        approx: { lat: slot.lat, lng: slot.lng },
        exact: unlocked ? { lat: slot.lat, lng: slot.lng } : null,
        unlocked,
      }),
    [slot.lat, slot.lng, unlocked],
  );

  if (!slot3DButtonVisible({ flag, fullAddress: slot.full_address, supported })) return null;

  return (
    <div className="px-5 pt-4">
      <button
        onClick={() => setOpen(true)}
        className="min-h-11 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card font-semibold text-sm"
      >
        <Box className="w-4 h-4" aria-hidden />
        View in 3D
      </button>
      {open && (
        <Suspense fallback={null}>
          <Map3DDialog
            closeLabel="Close 3D view"
            items={[
              {
                id: slot.id,
                name: slot.name,
                approxArea: slot.approx_area,
                rateLabel: `₹${slot.hourly_rate}/hr`,
                policy,
              },
            ]}
            onClose={() => setOpen(false)}
            onFallback={(m) => {
              toast.error(m);
              setOpen(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
