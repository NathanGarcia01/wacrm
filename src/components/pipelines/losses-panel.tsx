"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TrendingDown, Users, Percent } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { BarChart } from "@/components/tremor/bar-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { loadLossesReport } from "@/lib/pipelines/losses-queries";
import type { LossesReportData } from "@/lib/pipelines/losses-queries";
import type { PeriodRange } from "@/lib/reports/types";
import type { PipelineStage } from "@/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LossesPanelProps {
  pipelineId: string;
  stages: PipelineStage[];
  assignedTo: string;
  period: PeriodRange | null;
  currency: string;
}

const REASON_CATEGORY = "Leads";

export function LossesPanel({ pipelineId, stages, assignedTo, period, currency }: LossesPanelProps) {
  const t = useTranslations("pipelines.losses");
  const [data, setData] = useState<LossesReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pipelineId) return;
    // Stages load asynchronously in the parent and start out empty, so
    // this must wait for them — otherwise the report is fetched once
    // with an empty stageNameById map and every deal's stage shows "—"
    // forever (the parent's `stages` state reference is otherwise
    // stable, so this doesn't cause extra refetches on unrelated
    // re-renders).
    if (stages.length === 0) return;
    let cancelled = false;
    setLoading(true);
    const db = createClient();
    const stageNameById = new Map(stages.map((s) => [s.id, s.name]));
    loadLossesReport(db, { pipelineId, period, assignedTo, stageNameById })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => console.error("[pipelines] losses report failed:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineId, period, assignedTo, stages]);

  const totalValue = data?.deals.reduce((sum, d) => sum + d.value, 0) ?? 0;

  const byReasonChart = (data?.byReason ?? []).map((r) => ({
    reason: r.reason || t("noReason"),
    [REASON_CATEGORY]: r.count,
  }));

  const wonLostBaseline = Math.max(1, data?.totalWon ?? 0, data?.totalLost ?? 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard title={t("leadsEntered")} value={data.leadsEntered.toLocaleString()} icon={Users} />
            <MetricCard
              title={t("totalLost")}
              value={data.totalLost.toLocaleString()}
              icon={TrendingDown}
            />
            <MetricCard
              title={t("totalLostValue")}
              value={formatCurrency(totalValue, currency)}
              icon={TrendingDown}
            />
            <MetricCard
              title={t("lossRate")}
              value={data.lossRatePct == null ? "—" : `${data.lossRatePct.toFixed(0)}%`}
              icon={Percent}
            />
          </>
        )}
      </div>

      {!loading && data && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-4 text-sm font-semibold text-foreground">{t("comparisonTitle")}</h3>
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{t("comparisonWon")}</span>
              <div className="relative h-7 min-w-0 flex-1 rounded-md bg-muted/40">
                <div
                  className="flex h-7 items-center justify-end rounded-md bg-primary px-2"
                  style={{ width: `${Math.max((data.totalWon / wonLostBaseline) * 100, data.totalWon > 0 ? 6 : 0)}%` }}
                >
                  <span className="font-mono text-xs font-semibold tabular-nums text-primary-foreground">
                    {data.totalWon.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{t("comparisonLost")}</span>
              <div className="relative h-7 min-w-0 flex-1 rounded-md bg-muted/40">
                <div
                  className="flex h-7 items-center justify-end rounded-md bg-destructive px-2"
                  style={{ width: `${Math.max((data.totalLost / wonLostBaseline) * 100, data.totalLost > 0 ? 6 : 0)}%` }}
                >
                  <span className="font-mono text-xs font-semibold tabular-nums text-white">
                    {data.totalLost.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && data && data.deals.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : loading ? (
        <SkeletonCard />
      ) : data ? (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-1 text-sm font-semibold text-foreground">{t("byReasonTitle")}</h3>
            <BarChart
              data={byReasonChart}
              index="reason"
              categories={[REASON_CATEGORY]}
              colors={["pink"]}
              valueFormatter={(value) => String(value)}
              showLegend={false}
              yAxisWidth={64}
              className="h-64"
            />
            <ul className="mt-2 space-y-1">
              {data.byReason.map((r) => (
                <li key={r.reason || "none"} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{r.reason || t("noReason")}</span>
                  <span className="font-mono text-foreground">
                    {t("byReasonRow", { count: r.count, pct: r.pct.toFixed(0) })}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">{t("tableDeal")}</TableHead>
                  <TableHead className="text-muted-foreground">{t("tableContact")}</TableHead>
                  <TableHead className="text-right text-muted-foreground">{t("tableValue")}</TableHead>
                  <TableHead className="text-muted-foreground">{t("tableReason")}</TableHead>
                  <TableHead className="text-muted-foreground">{t("tableStage")}</TableHead>
                  <TableHead className="text-right text-muted-foreground">{t("tableMessages")}</TableHead>
                  <TableHead className="text-right text-muted-foreground">{t("tableDaysToLoss")}</TableHead>
                  <TableHead className="text-muted-foreground">{t("tableResponsible")}</TableHead>
                  <TableHead className="text-muted-foreground">{t("tableDate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deals.map((d) => (
                  <TableRow key={d.id} className="border-border">
                    <TableCell className="font-medium text-foreground">{d.title}</TableCell>
                    <TableCell className="text-muted-foreground">{d.contactName ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">
                      {formatCurrency(d.value, d.currency || currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.lostReason || t("noReason")}</TableCell>
                    <TableCell className="text-muted-foreground">{d.stageName ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {d.messagesBeforeLoss ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {d.daysToLoss.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.assigneeName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {new Date(d.lostAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </div>
  );
}
