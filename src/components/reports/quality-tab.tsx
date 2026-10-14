"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Gauge, MessageSquareOff, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react"
import type { QualityRating } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"
import type { ChannelQualityInfo } from "@/app/api/whatsapp/quality/channels/route"

function normalizeQuality(raw: string | null): QualityRating {
  if (raw === "GREEN" || raw === "YELLOW" || raw === "RED") return raw
  // Some Meta API versions have returned HIGH/MEDIUM/LOW instead.
  if (raw === "HIGH") return "GREEN"
  if (raw === "MEDIUM") return "YELLOW"
  if (raw === "LOW") return "RED"
  return "UNKNOWN"
}

const TIER_KEY: Record<
  string,
  "tier50" | "tier250" | "tier1k" | "tier2k" | "tier10k" | "tier100k" | "tierUnlimited"
> = {
  TIER_50: "tier50",
  TIER_250: "tier250",
  TIER_1K: "tier1k",
  // Meta's Oct 2025 portfolio-limit change raised the default initial
  // scaling tier from 1K to 2K — confirmed live against this account's
  // own numbers, not documented in the messaging-limits page's examples.
  TIER_2K: "tier2k",
  TIER_10K: "tier10k",
  TIER_100K: "tier100k",
  UNLIMITED: "tierUnlimited",
}

type Tone = "positive" | "warning" | "negative" | "neutral"

const TONE_CLASSES: Record<Tone, string> = {
  positive: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-gold/30 bg-gold-soft text-gold",
  negative: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-card/50 text-muted-foreground",
}

const QUALITY_TONE: Record<QualityRating, Tone> = {
  GREEN: "positive",
  YELLOW: "warning",
  RED: "negative",
  UNKNOWN: "neutral",
}

const QUALITY_ICON: Record<QualityRating, React.ReactNode> = {
  GREEN: <ShieldCheck className="h-4 w-4" />,
  YELLOW: <ShieldAlert className="h-4 w-4" />,
  RED: <ShieldAlert className="h-4 w-4" />,
  UNKNOWN: <ShieldQuestion className="h-4 w-4" />,
}

// Meta's documented status enum isn't exhaustively published (see the
// Qualidade tab bug report) — map the values we know about and fall
// back to showing the raw string for anything else, never a dash.
const STATUS_TONE: Record<string, Tone> = {
  CONNECTED: "positive",
  FLAGGED: "warning",
  PENDING: "warning",
  RESTRICTED: "negative",
  DISCONNECTED: "negative",
  BANNED: "negative",
  MIGRATED: "neutral",
  UNVERIFIED: "neutral",
}

const NAME_STATUS_TONE: Record<string, Tone> = {
  APPROVED: "positive",
  AVAILABLE_WITHOUT_REVIEW: "positive",
  PENDING_REVIEW: "warning",
  DECLINED: "negative",
  EXPIRED: "negative",
  NONE: "neutral",
}

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  )
}

/** Never a bare "—": every missing value says WHY it's missing. */
function Unavailable({ reason }: { reason: string }) {
  return <span className="text-xs text-muted-foreground">{reason}</span>
}

function ChannelCard({ channel }: { channel: ChannelQualityInfo }) {
  const t = useTranslations("reports.qualityTab")

  if (channel.channelType === "evolution") {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{channel.name}</p>
          {channel.isDefault && <Badge tone="neutral">{t("defaultBadge")}</Badge>}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <MessageSquareOff className="h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium text-foreground">{t("evolutionTitle")}</p>
            <p className="text-xs">{t("evolutionDescription")}</p>
          </div>
        </div>
      </div>
    )
  }

  // Cloud API, but the Meta call for THIS number failed outright —
  // every field below is unavailable for the same one reason.
  if (channel.error) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{channel.name}</p>
          {channel.isDefault && <Badge tone="neutral">{t("defaultBadge")}</Badge>}
        </div>
        <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {t("unavailableChannelReason", { reason: channel.error })}
        </div>
      </div>
    )
  }

  const quality = normalizeQuality(channel.qualityRating)
  const tierKey = channel.messagingLimitTier ? TIER_KEY[channel.messagingLimitTier] : null
  const tierLabel = channel.messagingLimitTier ? (tierKey ? t(tierKey) : channel.messagingLimitTier) : null

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{channel.name}</p>
          <p className="text-xs text-muted-foreground">
            {channel.displayPhoneNumber ?? <Unavailable reason={t("unavailableFieldReason")} />}
          </p>
        </div>
        {channel.isDefault && <Badge tone="neutral">{t("defaultBadge")}</Badge>}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("numberQuality")}</p>
          <Badge tone={QUALITY_TONE[quality]}>
            {QUALITY_ICON[quality]}
            {t(
              quality === "GREEN"
                ? "qualityGreenLabel"
                : quality === "YELLOW"
                  ? "qualityYellowLabel"
                  : quality === "RED"
                    ? "qualityRedLabel"
                    : "qualityUnknownLabel",
            )}
          </Badge>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("numberStatus")}</p>
          {channel.status ? (
            <Badge tone={STATUS_TONE[channel.status] ?? "neutral"}>
              {/* Known values get a translated label; anything Meta adds
                  later still renders (the raw string) instead of vanishing. */}
              {(
                {
                  CONNECTED: t("statusConnected"),
                  FLAGGED: t("statusFlagged"),
                  RESTRICTED: t("statusRestricted"),
                  PENDING: t("statusPending"),
                  DISCONNECTED: t("statusDisconnected"),
                  MIGRATED: t("statusMigrated"),
                  BANNED: t("statusBanned"),
                  UNVERIFIED: t("statusUnverified"),
                } as Record<string, string>
              )[channel.status] ?? channel.status}
            </Badge>
          ) : (
            <Unavailable reason={t("unavailableFieldReason")} />
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("nameStatus")}</p>
          {channel.nameStatus ? (
            <Badge tone={NAME_STATUS_TONE[channel.nameStatus] ?? "neutral"}>
              {(
                {
                  APPROVED: t("nameStatusApproved"),
                  AVAILABLE_WITHOUT_REVIEW: t("nameStatusAvailableWithoutReview"),
                  PENDING_REVIEW: t("nameStatusPendingReview"),
                  DECLINED: t("nameStatusDeclined"),
                  EXPIRED: t("nameStatusExpired"),
                  NONE: t("nameStatusNone"),
                } as Record<string, string>
              )[channel.nameStatus] ?? channel.nameStatus}
            </Badge>
          ) : (
            <Unavailable reason={t("unavailableFieldReason")} />
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("messageLimit")}</p>
          {tierLabel ? (
            <p className="text-sm font-medium text-foreground">{tierLabel}</p>
          ) : (
            <Unavailable reason={t("unavailableFieldReason")} />
          )}
        </div>
      </div>
    </div>
  )
}

export function QualityTab() {
  const t = useTranslations("reports.qualityTab")
  const locale = useLocale() as Locale
  const tips = t.raw("tips") as string[]
  const [channels, setChannels] = useState<ChannelQualityInfo[] | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch("/api/whatsapp/quality/channels")
      .then(async (res) => {
        const json = (await res.json()) as { channels: ChannelQualityInfo[]; checkedAt: string; error?: string }
        if (!res.ok) throw new Error(json.error ?? t("loadFailed"))
        if (!cancelled) {
          setChannels(json.channels)
          setCheckedAt(json.checkedAt)
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

  // Portfolio-level limit (Meta's Oct 2025 change — shared by every
  // number in the same Business Manager) — only worth a single banner
  // when every Cloud API number that answered actually agrees on it.
  const cloudChannels = (channels ?? []).filter((c) => c.channelType === "cloud_api" && !c.error)
  const limitTiers = new Set(cloudChannels.map((c) => c.messagingLimitTier).filter((v): v is string => v != null))
  const sharedTier = limitTiers.size === 1 ? [...limitTiers][0] : null
  const sharedTierKey = sharedTier ? TIER_KEY[sharedTier] : null
  const sharedTierLabel = sharedTier ? (sharedTierKey ? t(sharedTierKey) : sharedTier) : null

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("pageSubtitle")}</p>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {sharedTierLabel && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          <Gauge className="h-4 w-4 shrink-0" />
          {t("portfolioLimitBanner", { tier: sharedTierLabel, count: cloudChannels.length })}
        </div>
      )}

      <div>
        <p className="mb-3 text-sm font-semibold text-foreground">{t("numbersTitle")}</p>
        {loading || !channels ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
          </div>
        ) : channels.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            {t("loadFailed")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {channels.map((channel) => (
              <ChannelCard key={channel.channelId} channel={channel} />
            ))}
          </div>
        )}
      </div>

      {checkedAt && (
        <p className="text-xs text-muted-foreground">
          {t("checkedAtLabel")} {new Date(checkedAt).toLocaleTimeString(localeToIntl(locale), { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}

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
