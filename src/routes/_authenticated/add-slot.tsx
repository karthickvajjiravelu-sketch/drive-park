import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { SlotForm } from "@/components/SlotForm";

export const Route = createFileRoute("/_authenticated/add-slot")({
  component: AddSlot,
});

function AddSlot() {
  const navigate = useNavigate();
  return (
    <div className="pb-8">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-5 flex items-center gap-3">
        <button onClick={() => navigate({ to: "/my-slots" })}
          className="w-10 h-10 rounded-full bg-white/10 grid place-items-center"><ArrowLeft className="w-5 h-5"/></button>
        <h1 className="text-2xl font-black">Add a slot</h1>
      </div>
      <SlotForm mode={{ kind: "create" }}/>
    </div>
  );
}
