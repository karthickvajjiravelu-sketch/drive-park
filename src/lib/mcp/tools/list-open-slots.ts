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
  name: "list_open_slots",
  title: "List open parking slots",
  description:
    "List parking slots currently marked as open on Usop. Optionally filter by vehicle type and max hourly rate.",
  inputSchema: {
    vehicle_type: z.enum(["car", "bike", "both"]).optional().describe("Filter by vehicle type."),
    max_hourly_rate: z.number().positive().optional().describe("Only slots at or below this hourly rate."),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ vehicle_type, max_hourly_rate, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let q = supabaseForUser(ctx)
      .from("slots")
      .select("id,name,approx_area,vehicle_type,hourly_rate,daily_rate,monthly_rate,rating,covered,cctv,disabled_access")
      .eq("status", "open")
      .limit(limit ?? 20);
    if (vehicle_type) q = q.in("vehicle_type", vehicle_type === "both" ? ["both"] : [vehicle_type, "both"]);
    if (max_hourly_rate) q = q.lte("hourly_rate", max_hourly_rate);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { slots: data ?? [] },
    };
  },
});
