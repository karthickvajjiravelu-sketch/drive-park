import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listOpenSlots from "./tools/list-open-slots";
import getSlot from "./tools/get-slot";
import listMyReservations from "./tools/list-my-reservations";
import listMySlots from "./tools/list-my-slots";
import setSlotStatus from "./tools/set-slot-status";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "usop-mcp",
  title: "Usop — Parking Marketplace",
  version: "0.1.0",
  instructions:
    "Tools for the Usop parking marketplace. Drivers can browse open slots and view their reservations. Landowners can view and toggle their own slots. Full address and access instructions are only revealed inside the Usop app after a confirmed booking.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listOpenSlots, getSlot, listMyReservations, listMySlots, setSlotStatus],
});
