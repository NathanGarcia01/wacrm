"use client"

import { useMemo, useState } from "react"
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
import { Switch } from "@/components/ui/switch"
import type { TicketDashboardFilterOptions } from "@/lib/reports/types"
import type { TicketDashboardPeriodKey, TicketDashboardPeriodRange } from "@/lib/reports/ticket-dashboard-period"

const PERIOD_OPTIONS: { value: TicketDashboardPeriodKey; labelKey: "today" | "d7" | "d30" | "custom" }[] = [
  { value: "today", labelKey: "today" },
  { value: "7d", labelKey: "d7" },
  { value: "30d", labelKey: "d30" },
  { value: "custom", labelKey: "custom" },
]

const ALL = "all"

export function AttendanceFilters({
  period,
  onPeriodChange,
  userId,
  onUserChange,
  departmentId,
  onDepartmentChange,
  channelId,
  onChannelChange,
  businessHours,
  onBusinessHoursChange,
  options,
}: {
  period: TicketDashboardPeriodRange
  onPeriodChange: (next: { period: TicketDashboardPeriodKey; from?: string; to?: string }) => void
  userId: string | null
  onUserChange: (v: string | null) => void
  departmentId: string | null
  onDepartmentChange: (v: string | null) => void
  channelId: string | null
  onChannelChange: (v: string | null) => void
  businessHours: boolean
  onBusinessHoursChange: (v: boolean) => void
  options: TicketDashboardFilterOptions
}) {
  const t = useTranslations("reports.attendanceFilters")

  // Local drafts so typing in the date inputs doesn't refetch on
  // every keystroke — only "Aplicar" (or switching into custom mode)
  // commits the range. Same convention as PeriodFilter.
  const [draftFrom, setDraftFrom] = useState(period.fromDate)
  const [draftTo, setDraftTo] = useState(period.toDate)

  const periodItems = useMemo(
    () => Object.fromEntries(PERIOD_OPTIONS.map((o) => [o.value, t(o.labelKey)])),
    [t],
  )
  const userItems = useMemo(() => {
    const items: Record<string, string> = { [ALL]: t("allUsers") }
    for (const a of options.agents) items[a.userId] = a.name
    return items
  }, [t, options.agents])
  const departmentItems = useMemo(() => {
    const items: Record<string, string> = { [ALL]: t("allDepartments") }
    for (const d of options.departments) items[d.id] = d.name
    return items
  }, [t, options.departments])
  const channelItems = useMemo(() => {
    const items: Record<string, string> = { [ALL]: t("allChannels") }
    for (const c of options.channels) items[c.id] = c.name
    return items
  }, [t, options.channels])

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("periodLabel")}</label>
        <Select
          items={periodItems}
          value={period.key}
          onValueChange={(v) => {
            const key = v as TicketDashboardPeriodKey
            if (key === "custom") {
              onPeriodChange({ period: "custom", from: draftFrom, to: draftTo })
            } else {
              onPeriodChange({ period: key })
            }
          }}
        >
          <SelectTrigger className="w-40 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
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
          <Button size="sm" onClick={() => onPeriodChange({ period: "custom", from: draftFrom, to: draftTo })}>
            {t("apply")}
          </Button>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("userLabel")}</label>
        <Select
          items={userItems}
          value={userId ?? ALL}
          onValueChange={(v) => onUserChange(v === ALL ? null : v)}
        >
          <SelectTrigger className="w-44 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allUsers")}</SelectItem>
            {options.agents.map((a) => (
              <SelectItem key={a.userId} value={a.userId}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("departmentLabel")}</label>
        <Select
          items={departmentItems}
          value={departmentId ?? ALL}
          onValueChange={(v) => onDepartmentChange(v === ALL ? null : v)}
        >
          <SelectTrigger className="w-44 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allDepartments")}</SelectItem>
            {options.departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("channelLabel")}</label>
        <Select
          items={channelItems}
          value={channelId ?? ALL}
          onValueChange={(v) => onChannelChange(v === ALL ? null : v)}
        >
          <SelectTrigger className="w-44 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allChannels")}</SelectItem>
            {options.channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 pb-1.5">
        <Switch checked={businessHours} onCheckedChange={(v) => onBusinessHoursChange(!!v)} />
        <span className="text-sm text-foreground">
          {businessHours ? t("businessHoursOn") : t("businessHoursOff")}
        </span>
      </div>
    </div>
  )
}
