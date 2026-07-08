"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { PeriodKey, PeriodRange } from "@/lib/reports/types"

const OPTIONS: { value: PeriodKey; labelKey: "today" | "week" | "month" | "custom" }[] = [
  { value: "today", labelKey: "today" },
  { value: "week", labelKey: "week" },
  { value: "month", labelKey: "month" },
  { value: "custom", labelKey: "custom" },
]

export function PeriodFilter({
  period,
  onChange,
}: {
  period: PeriodRange
  onChange: (next: { period: PeriodKey; from?: string; to?: string }) => void
}) {
  const t = useTranslations("reports.periodFilter")
  // Local drafts so typing in the date inputs doesn't refetch on
  // every keystroke — only "Aplicar" (or switching into custom mode)
  // commits the range.
  const [draftFrom, setDraftFrom] = useState(period.fromDate)
  const [draftTo, setDraftTo] = useState(period.toDate)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("label")}</label>
        <Select
          value={period.key}
          onValueChange={(v) => {
            const key = v as PeriodKey
            if (key === "custom") {
              onChange({ period: "custom", from: draftFrom, to: draftTo })
            } else {
              onChange({ period: key })
            }
          }}
        >
          <SelectTrigger className="w-48 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {t(o.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {period.key === "custom" && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("from")}</label>
            <Input
              type="date"
              value={draftFrom}
              max={draftTo}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="bg-card"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("to")}</label>
            <Input
              type="date"
              value={draftTo}
              min={draftFrom}
              onChange={(e) => setDraftTo(e.target.value)}
              className="bg-card"
            />
          </div>
          <Button size="sm" onClick={() => onChange({ period: "custom", from: draftFrom, to: draftTo })}>
            {t("apply")}
          </Button>
        </>
      )}
    </div>
  )
}
