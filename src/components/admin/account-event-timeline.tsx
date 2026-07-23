import type { SubscriptionEventRow } from "@/lib/admin/types"

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** `admin_action_change_plan` → "Admin action change plan". Raw
 *  Stripe event types (`setup_intent.setup_failed`) get the same
 *  treatment so both read as plain text instead of a code identifier. */
function prettifyEventType(eventType: string): string {
  const words = eventType.replace(/[._]/g, " ").split(" ").filter(Boolean)
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

export function AccountEventTimeline({ events }: { events: SubscriptionEventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#22242A] bg-[#141417] p-8 text-center text-sm text-white/40">
        Nenhum evento registrado para esta conta ainda.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => (
        <li key={event.id} className="rounded-xl border border-[#22242A] bg-[#141417] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-white">
              {prettifyEventType(event.event_type)}
            </span>
            <span className="text-xs text-white/40">{fmtDateTime(event.processed_at)}</span>
          </div>
          {event.payload && Object.keys(event.payload).length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-white/40 hover:text-white/60">
                ver payload
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[#0A0A0B] p-3 text-[11px] leading-relaxed text-white/60">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}
