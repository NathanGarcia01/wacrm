"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Gauge, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react"
import type { QualityRating } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

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

const TIER_KEY: Record<string, "tier50" | "tier250" | "tier1k" | "tier10k" | "tier100k" | "tierUnlimited"> = {
  TIER_50: "tier50",
  TIER_250: "tier250",
  TIER_1K: "tier1k",
  TIER_10K: "tier10k",
  TIER_100K: "tier100k",
  UNLIMITED: "tierUnlimited",
}

const QUALITY_ICON: Record<QualityRating, React.ReactNode> = {
  GREEN: <ShieldCheck className="h-5 w-5" />,
  YELLOW: <ShieldAlert className="h-5 w-5" />,
  RED: <ShieldAlert className="h-5 w-5" />,
  UNKNOWN: <ShieldQuestion className="h-5 w-5" />,
}

const QUALITY_CLASSES: Record<QualityRating, string> = {
  GREEN: "border-primary/30 bg-primary/10 text-primary",
  YELLOW: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  RED: "border-red-500/30 bg-red-500/10 text-red-400",
  UNKNOWN: "border-border bg-card/50 text-muted-foreground",
}

export function QualityTab() {
  const t = useTranslations("reports.qualityTab")
  const locale = useLocale() as Locale
  const tips = t.raw("tips") as string[]
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
        if (!res.ok) throw new Error(json.error ?? t("loadFailed"))
        if (!cancelled) {
          setData(json)
          setCheckedAt(new Date().toISOString())
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("loadFailed"))
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
  const qualityLabelKey =
    quality === "GREEN"
      ? "qualityGreenLabel"
      : quality === "YELLOW"
        ? "qualityYellowLabel"
        : quality === "RED"
          ? "qualityRedLabel"
          : "qualityUnknownLabel"
  const qualityDescriptionKey =
    quality === "GREEN"
      ? "qualityGreenDescription"
      : quality === "YELLOW"
        ? "qualityYellowDescription"
        : quality === "RED"
          ? "qualityRedDescription"
          : "qualityUnknownDescription"
  const tierKey = data?.messaging_limit_tier ? TIER_KEY[data.messaging_limit_tier] : null
  const tierLabel = data?.messaging_limit_tier
    ? tierKey
      ? t(tierKey)
      : data.messaging_limit_tier
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
          <p className="text-sm font-medium text-muted-foreground">{t("numberQuality")}</p>
          {loading ? (
            <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" />
          ) : (
            <div className="mt-3 space-y-2">
              <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium ${QUALITY_CLASSES[quality]}`}>
                {QUALITY_ICON[quality]}
                {t(qualityLabelKey)}
              </div>
              <p className="text-xs text-muted-foreground">{t(qualityDescriptionKey)}</p>
              {data?.display_phone_number && (
                <p className="text-xs text-muted-foreground">{t("numberLabel")} {data.display_phone_number}</p>
              )}
              {checkedAt && (
                <p className="text-xs text-muted-foreground">
                  {t("checkedAtLabel")} {new Date(checkedAt).toLocaleTimeString(localeToIntl(locale), { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">{t("messageLimit")}</p>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </div>
          {loading ? (
            <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" />
          ) : (
            <div className="mt-3 space-y-1">
              <p className="text-[28px] leading-none font-bold text-foreground">{tierLabel ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                {t("conversationsPerDayHint", { tier: data?.messaging_limit_tier ?? t("unknown") })}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <p className="mb-3 text-sm font-semibold text-foreground">{t("tipsTitle")}</p>
        <ul className="space-y-2">
          {tips.map((tip) => (
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
