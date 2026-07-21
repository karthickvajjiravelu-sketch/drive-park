import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "set_slot_status",
  title: "Set slot open/full status",
  description: "Mark one of the landowner's own parking slots as open or full.",
  inputSchema: {
    slot_id: z.string().uuid(),
    status: z.enum(["open", "full"]),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ slot_id, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("slots")
      .update({ status })
      .eq("id", slot_id)
      .eq("owner_id", ctx.getUserId()!)
      .select("id,name,status")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Slot not found or not owned by you" }], isError: true };
    return {
      content: [{ type: "text", text: `Slot ${data.name} is now ${data.status}.` }],
      structuredContent: { slot: data },
    };
  },
});
