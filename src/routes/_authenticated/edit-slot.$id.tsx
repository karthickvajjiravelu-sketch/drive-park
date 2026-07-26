import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { SlotForm } from "@/components/SlotForm";
import { useSlot } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/edit-slot/$id")({
  component: EditSlot,
});

function EditSlot() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: slot, isLoading } = useSlot(id);

  return (
    <div className="pb-8">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-5 flex items-center gap-3">
        <button onClick={() => navigate({ to: "/my-slots" })}
          className="w-10 h-10 rounded-full bg-white/10 grid place-items-center"><ArrowLeft className="w-5 h-5"/></button>
        <h1 className="text-2xl font-black">Edit slot</h1>
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : !slot ? (
        <div className="p-6">Slot not found</div>
      ) : (
        <SlotForm mode={{ kind: "edit", slotId: id }} initial={slot}/>
      )}
    </div>
  );
}
