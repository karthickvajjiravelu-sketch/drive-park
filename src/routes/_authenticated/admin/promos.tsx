import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminPromos, type PromoCode } from "@/lib/admin-queries";
import { AdminSection, AdminCard, AdminButton, Pill } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/promos")({
  head: () => ({
    meta: [
      { title: "Promo codes · Usop admin" },
      {
        name: "description",
        content: "Create, edit and deactivate promotional discount codes for Usop bookings.",
      },
    ],
  }),
  component: AdminPromos,
});

type Draft = {
  code: string;
  description: string;
  discount_type: "percent" | "flat";
  discount_value: string;
  max_discount: string;
  min_spend: string;
  usage_limit: string;
  ends_at: string;
};

const emptyDraft: Draft = {
  code: "",
  description: "",
  discount_type: "percent",
  discount_value: "10",
  max_discount: "",
  min_spend: "0",
  usage_limit: "",
  ends_at: "",
};

function AdminPromos() {
  const { data: promos = [], isLoading } = useAdminPromos();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-promos"] });

  function edit(p: PromoCode) {
    setEditingId(p.id);
    setDraft({
      code: p.code,
      description: p.description,
      discount_type: p.discount_type === "flat" ? "flat" : "percent",
      discount_value: String(p.discount_value),
      max_discount: p.max_discount == null ? "" : String(p.max_discount),
      min_spend: String(p.min_spend),
      usage_limit: p.usage_limit == null ? "" : String(p.usage_limit),
      ends_at: p.ends_at ? p.ends_at.slice(0, 10) : "",
    });
  }

  async function save() {
    const code = draft.code.trim().toUpperCase();
    if (!code) return toast.error("Code is required");
    const value = Number(draft.discount_value);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Discount must be > 0");
    if (draft.discount_type === "percent" && value > 100)
      return toast.error("Percent discount can't exceed 100");

    const payload = {
      code,
      description: draft.description.trim(),
      discount_type: draft.discount_type,
      discount_value: value,
      max_discount: draft.max_discount ? Number(draft.max_discount) : null,
      min_spend: Number(draft.min_spend || 0),
      usage_limit: draft.usage_limit ? Number(draft.usage_limit) : null,
      ends_at: draft.ends_at ? new Date(`${draft.ends_at}T23:59:59`).toISOString() : null,
    };

    setBusy(true);
    const { error } = editingId
      ? await supabase.from("promo_codes").update(payload).eq("id", editingId)
      : await supabase.from("promo_codes").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editingId ? "Promo updated" : "Promo created");
    setDraft(emptyDraft);
    setEditingId(null);
    refresh();
  }

  async function toggleActive(p: PromoCode) {
    const { error } = await supabase
      .from("promo_codes")
      .update({ active: !p.active })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(p.active ? "Deactivated" : "Activated");
    refresh();
  }

  const field = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm";

  return (
    <>
      <AdminSection title={editingId ? "Edit promo" : "New promo"}>
        <AdminCard>
          <div className="grid gap-2">
            <input
              aria-label="Promo code"
              className={field}
              placeholder="CODE"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
            />
            <input
              aria-label="Description"
              className={field}
              placeholder="Description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="Discount type"
                className={field}
                value={draft.discount_type}
                onChange={(e) =>
                  setDraft({ ...draft, discount_type: e.target.value as "percent" | "flat" })
                }
              >
                <option value="percent">Percent %</option>
                <option value="flat">Flat ₹</option>
              </select>
              <input
                aria-label="Discount value"
                className={field}
                type="number"
                placeholder="Value"
                value={draft.discount_value}
                onChange={(e) => setDraft({ ...draft, discount_value: e.target.value })}
              />
              <input
                aria-label="Maximum discount in rupees"
                className={field}
                type="number"
                placeholder="Max discount ₹"
                value={draft.max_discount}
                onChange={(e) => setDraft({ ...draft, max_discount: e.target.value })}
              />
              <input
                aria-label="Minimum spend in rupees"
                className={field}
                type="number"
                placeholder="Min spend ₹"
                value={draft.min_spend}
                onChange={(e) => setDraft({ ...draft, min_spend: e.target.value })}
              />
              <input
                aria-label="Total uses"
                className={field}
                type="number"
                placeholder="Total uses"
                value={draft.usage_limit}
                onChange={(e) => setDraft({ ...draft, usage_limit: e.target.value })}
              />
              <input
                aria-label="End date"
                className={field}
                type="date"
                value={draft.ends_at}
                onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <AdminButton onClick={save} disabled={busy}>
                {editingId ? "Save changes" : "Create promo"}
              </AdminButton>
              {editingId && (
                <AdminButton
                  variant="ghost"
                  onClick={() => {
                    setEditingId(null);
                    setDraft(emptyDraft);
                  }}
                >
                  Cancel
                </AdminButton>
              )}
            </div>
          </div>
        </AdminCard>
      </AdminSection>

      <AdminSection title={`Promo codes (${promos.length})`}>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {promos.map((p) => (
          <AdminCard key={p.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-black tracking-wide">{p.code}</span>
              <Pill tone={p.active ? "success" : "muted"}>{p.active ? "active" : "inactive"}</Pill>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{p.description}</div>
            <div className="mt-1 text-xs">
              {p.discount_type === "percent"
                ? `${p.discount_value}% off`
                : `₹${p.discount_value} off`}
              {p.max_discount ? ` (max ₹${p.max_discount})` : ""} · min spend ₹{p.min_spend} · used{" "}
              {p.used_count}
              {p.usage_limit ? `/${p.usage_limit}` : ""}
              {p.ends_at ? ` · ends ${new Date(p.ends_at).toLocaleDateString()}` : ""}
            </div>
            <div className="mt-3 flex gap-2">
              <AdminButton variant="ghost" onClick={() => edit(p)}>
                Edit
              </AdminButton>
              <AdminButton
                variant={p.active ? "danger" : "primary"}
                onClick={() => toggleActive(p)}
              >
                {p.active ? "Deactivate" : "Activate"}
              </AdminButton>
            </div>
          </AdminCard>
        ))}
        {!isLoading && promos.length === 0 && (
          <p className="text-sm text-muted-foreground">No promo codes yet.</p>
        )}
      </AdminSection>
    </>
  );
}
