"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Target } from "lucide-react"

import { formatCurrency } from "@/lib/currency"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { zonedToday } from "@/lib/reports/timezone"
import type { SalesGoal } from "@/lib/reports/types"

/** Days left in the goal's month (inclusive of today), counted in the
 *  ACCOUNT's timezone — not the viewer's. Only meaningful for the
 *  CURRENT month, which is the only month this card is ever shown
 *  for (see SalesGoal's doc comment). */
function daysRemainingInMonth(timeZone: string): number {
  const today = zonedToday(timeZone)
  const daysInMonth = new Date(Date.UTC(today.y, today.m, 0)).getUTCDate()
  return Math.max(1, daysInMonth - today.d + 1)
}

/** monthKey is YYYY-MM-01 (UTC date-only) — build the Date from UTC
 *  parts so no local-timezone shift can roll it into the adjacent
 *  month when formatting ("Meta de outubro" must match the account's
 *  calendar month, not the viewer's). */
function monthLabel(monthKey: string, locale: string): string {
  const [y, m] = monthKey.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1, 12))
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(d)
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export function SalesGoalCard({
  salesGoal,
  currency,
  timezone,
}: {
  salesGoal: SalesGoal
  currency: string
  timezone: string
}) {
  const t = useTranslations("reports.salesGoalCard")
  const locale = useLocale()

  const hasValueGoal = salesGoal.valueGoal != null
  const hasCountGoal = salesGoal.countGoal != null
  const hasAnyGoal = hasValueGoal || hasCountGoal

  const remaining = hasValueGoal ? Math.max(0, salesGoal.valueGoal! - salesGoal.valueActual) : 0
  const daysLeft = daysRemainingInMonth(timezone)
  const dailyPace = remaining > 0 ? remaining / daysLeft : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Target className="size-4 text-primary" />
          {t("title", { month: monthLabel(salesGoal.month, locale) })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasAnyGoal ? (
          <p className="text-sm text-muted-foreground">
            {t("notConfigured")}{" "}
            <Link href="/settings?tab=salesGoals" className="font-medium text-primary underline underline-offset-2">
              {t("notConfiguredLink")}
            </Link>
          </p>
        ) : (
          <div className="space-y-4">
            {hasValueGoal && (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("valueGoalLabel")}</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(salesGoal.valueActual, currency)} / {formatCurrency(salesGoal.valueGoal!, currency)}
                  </span>
                </div>
                <ProgressBar pct={(salesGoal.valueActual / salesGoal.valueGoal!) * 100} />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {remaining > 0
                    ? t("paceLine", {
                        remaining: formatCurrency(remaining, currency),
                        days: daysLeft,
                        pace: formatCurrency(dailyPace, currency),
                      })
                    : t("goalReached")}
                </p>
              </div>
            )}
            {hasCountGoal && (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("countGoalLabel")}</span>
                  <span className="font-medium text-foreground">
                    {salesGoal.countActual.toLocaleString()} / {salesGoal.countGoal!.toLocaleString()}
                  </span>
                </div>
                <ProgressBar pct={(salesGoal.countActual / salesGoal.countGoal!) * 100} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
