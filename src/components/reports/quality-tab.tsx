"use client"

import { useEffect, useState } from "react"
import { Gauge, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react"
import type { QualityRating } from "@/lib/reports/types"

interface QualityApiResponse {
  quality_rating: string | null
  messaging_limit_tier: string | null
  display_phone_number: string | null
}

function normalizeQuality(raw: string | null): QualityRating {
  if (raw === "GREEN" || raw === "YELLOW" || raw === "RED") return raw
  // Some Meta API versions have returned HIGH/MEDIUM/LOW instead.
  if (raw === "HIGH") return "GREEN"
  if (raw === "MEDIUM") return "YELLOW"
  if (raw === "LOW") return "RED"
  return "UNKNOWN"
}

const TIER_CONVERSATIONS: Record<string, string> = {
  TIER_50: "50 conversas/dia",
  TIER_250: "250 conversas/dia",
  TIER_1K: "1.000 conversas/dia",
  TIER_10K: "10.000 conversas/dia",
  TIER_100K: "100.000 conversas/dia",
  UNLIMITED: "Ilimitado",
}

const QUALITY_CONFIG: Record<
  QualityRating,
  { label: string; description: string; classes: string; icon: React.ReactNode }
> = {
  GREEN: {
    label: "Alta",
    description: "Seu número está com boa reputação junto à Meta. Continue respeitando os limites de envio.",
    classes: "border-primary/30 bg-primary/10 text-primary",
    icon: <ShieldCheck className="h-5 w-5" />,
  },
  YELLOW: {
    label: "Média",
    description: "A qualidade caiu um pouco. Evite disparos em massa e priorize mensagens desejadas pelos contatos.",
    classes: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    icon: <ShieldAlert className="h-5 w-5" />,
  },
  RED: {
    label: "Baixa",
    description: "Risco de banimento. Pause transmissões em massa e foque em conversas iniciadas pelos contatos.",
    classes: "border-red-500/30 bg-red-500/10 text-red-400",
    icon: <ShieldAlert className="h-5 w-5" />,
  },
  UNKNOWN: {
    label: "Desconhecida",
    description: "Não foi possível verificar a qualidade do número junto à Meta.",
    classes: "border-border bg-card/50 text-muted-foreground",
    icon: <ShieldQuestion className="h-5 w-5" />,
  },
}

const TIPS = [
  "Aqueça números novos aumentando o volume de envios aos poucos ao longo das primeiras semanas.",
  "Priorize responder conversas iniciadas pelo contato — elas não contam para os limites de disparo.",
  "Evite enviar o mesmo template repetidamente para a mesma base em curto espaço de tempo.",
  "Monitore a taxa de bloqueios/denúncias e pare disparos se ela subir.",
  "Respeite o horário comercial do fuso do destinatário ao agendar transmissões.",
]

export function QualityTab() {
  const [data, setData] = useState<QualityApiResponse | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch("/api/whatsapp/quality")
      .then(async (res) => {
        const json = (await res.json()) as QualityApiResponse & { error?: string }
        if (!res.ok) throw new Error(json.error ?? "Falha ao consultar a Meta.")
        if (!cancelled) {
          setData(json)
          setCheckedAt(new Date().toISOString())
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao consultar a Meta.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const quality = normalizeQuality(data?.quality_rating ?? null)
  const q = QUALITY_CONFIG[quality]
  const tierLabel = data?.messaging_limit_tier
    ? TIER_CONVERSATIONS[data.messaging_limit_tier] ?? data.messaging_limit_tier
    : null

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-medium text-muted-foreground">Qualidade do número</p>
          {loading ? (
            <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" />
          ) : (
            <div className="mt-3 space-y-2">
              <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium ${q.classes}`}>
                {q.icon}
                {q.label}
              </div>
              <p className="text-xs text-muted-foreground">{q.description}</p>
              {data?.display_phone_number && (
                <p className="text-xs text-muted-foreground">Número: {data.display_phone_number}</p>
              )}
              {checkedAt && (
                <p className="text-xs text-muted-foreground">
                  Verificado às {new Date(checkedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Limite de mensagens</p>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </div>
          {loading ? (
            <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" />
          ) : (
            <div className="mt-3 space-y-1">
              <p className="text-[28px] leading-none font-bold text-foreground">{tierLabel ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                Conversas iniciadas por sua conta, por dia, permitidas pela Meta ({data?.messaging_limit_tier ?? "desconhecido"}).
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <p className="mb-3 text-sm font-semibold text-foreground">Dicas para proteger sua conta</p>
        <ul className="space-y-2">
          {TIPS.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
