// `unpaid` / `incomplete` / `incomplete_expired` all collapse into the
// "Pendente" segment here — the bar is a coarse at-a-glance visual;
// the filter pills above the table give the precise per-status view
// (including a dedicated "Não pagos" pill for `unpaid` specifically).
export function DistributionBar({ counts }: { counts: Record<string, number> }) {
  const trial = counts.trialing ?? 0
  const active = counts.active ?? 0
  const pending =
    (counts.past_due ?? 0) +
    (counts.unpaid ?? 0) +
    (counts.incomplete ?? 0) +
    (counts.incomplete_expired ?? 0)
  const canceled = counts.canceled ?? 0
  const total = trial + active + pending + canceled

  const segments = [
    { label: "Trial", value: trial, color: "#60A5FA" },
    { label: "Ativo", value: active, color: "#34D399" },
    { label: "Pendente", value: pending, color: "#FB923C" },
    { label: "Cancelado", value: canceled, color: "#9CA3AF" },
  ]

  return (
    <div className="rounded-xl border border-[#22242A] bg-[#141417] p-5">
      <p className="mb-3 text-xs font-medium text-white/50">Distribuição de contas</p>
      {total === 0 ? (
        <p className="text-xs text-white/40">Nenhuma conta ainda.</p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#0A0A0B]">
            {segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <div
                  key={s.label}
                  style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
                  title={`${s.label}: ${s.value}`}
                />
              ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-white/60">{s.label}</span>
                <span className="font-mono tabular-nums text-white">{s.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
