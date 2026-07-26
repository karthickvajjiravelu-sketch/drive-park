import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMessages, useReservation, useOwnerProfile } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Send, Phone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/messages/$reservationId")({
  component: MessagesPage,
});

function MessagesPage() {
  const { reservationId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: reservation } = useReservation(reservationId);
  const { data: messages = [] } = useMessages(reservationId);
  const { data: owner } = useOwnerProfile(reservation?.slot?.owner_id ?? "");
  const [text, setText] = useState("");
  const [me, setMe] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!reservationId) return;
    const ch = supabase.channel(`msg-${reservationId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `reservation_id=eq.${reservationId}` },
        () => qc.invalidateQueries({ queryKey: ["messages", reservationId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reservationId, qc]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  if (!reservation) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const slot = reservation.slot;
  const isDriver = me === reservation.driver_id;
  const recipientId = isDriver ? slot?.owner_id : reservation.driver_id;
  const hostName = owner?.name || "Host";
  const hostPhone = owner?.phone;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!me || !recipientId || !text.trim()) return;
    const body = text.trim().slice(0, 1000);
    setText("");
    const { error } = await supabase.from("messages").insert({
      reservation_id: reservationId, sender_id: me, recipient_id: recipientId, body,
    });
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["messages", reservationId] });
  }

  return (
    <div className="flex flex-col" style={{ minHeight: "100dvh" }}>
      <div className="bg-[var(--surface-dark)] text-white px-4 pt-6 pb-4 flex items-center gap-3">
        <button onClick={() => navigate({ to: "/reservations" })}
          className="w-10 h-10 rounded-full bg-white/10 grid place-items-center"><ArrowLeft className="w-5 h-5"/></button>
        <div className="min-w-0 flex-1">
          <div className="font-black truncate">{isDriver ? hostName : "Driver"}</div>
          <div className="text-xs text-white/60 truncate">{slot?.name}</div>
        </div>
        {isDriver && hostPhone && (
          <a href={`tel:${hostPhone}`} className="w-10 h-10 rounded-full bg-primary text-primary-foreground grid place-items-center">
            <Phone className="w-5 h-5"/>
          </a>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-muted/30">
        {messages.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-8">
            {isDriver ? "Send your host a message to coordinate arrival." : "No messages yet."}
          </p>
        )}
        {messages.map(m => {
          const mine = m.sender_id === me;
          return (
            <div key={m.id} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground ml-auto" : "bg-card border border-border"}`}>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
              <div className={`mt-0.5 text-[9px] ${mine ? "text-black/60" : "text-muted-foreground"}`}>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          );
        })}
      </div>

      <form onSubmit={send} className="border-t border-border bg-background p-3 flex items-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input value={text} onChange={e => setText(e.target.value)}
          placeholder="Type a message" maxLength={1000}
          className="flex-1 rounded-full border border-input bg-background px-4 py-2.5 text-sm"/>
        <button type="submit" disabled={!text.trim()}
          className="w-11 h-11 rounded-full bg-primary text-primary-foreground grid place-items-center disabled:opacity-50">
          <Send className="w-5 h-5"/>
        </button>
      </form>
    </div>
  );
}
