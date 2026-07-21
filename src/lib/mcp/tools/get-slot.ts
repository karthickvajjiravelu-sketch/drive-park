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
  name: "get_slot",
  title: "Get parking slot details",
  description:
    "Get details for a single parking slot by id. Full address and access instructions are only revealed via the app after a booking is confirmed.",
  inputSchema: { slot_id: z.string().uuid().describe("The slot id.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ slot_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("slots")
      .select(
        "id,name,approx_area,vehicle_type,vehicle_size_limit,hourly_rate,daily_rate,monthly_rate,status,rating,covered,cctv,disabled_access,height_limit_cm,width_limit_cm,cancellation_policy,photos",
      )
      .eq("id", slot_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Slot not found" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { slot: data },
    };
  },
});
