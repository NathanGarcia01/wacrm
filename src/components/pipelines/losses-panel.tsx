"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { TrendingDown } from "lucide-react";
import type { Deal } from "@/types";
import { formatCurrency } from "@/lib/currency";
import { BarChart } from "@/components/tremor/bar-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LossesPanelProps {
  deals: Deal[];
  currency: string;
}

const CATEGORY = "Valor";

export function LossesPanel({ deals, currency }: LossesPanelProps) {
  const t = useTranslations("pipelines.losses");

  const totalValue = useMemo(
    () => deals.reduce((sum, d) => sum + (d.value ?? 0), 0),
    [deals],
  );

  const byReason = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of deals) {
      const reason = d.lost_reason?.trim() || t("noReason");
      map.set(reason, (map.get(reason) ?? 0) + (d.value ?? 0));
    }
    return [...map.entries()]
      .map(([reason, value]) => ({ reason, [CATEGORY]: value }))
      .sort((a, b) => (b[CATEGORY] as number) - (a[CATEGORY] as number));
  }, [deals, t]);

  const sortedDeals = useMemo(
    () =>
      [...deals].sort((a, b) => {
        const aDate = a.lost_at ?? a.created_at;
        const bDate = b.lost_at ?? b.created_at;
        return bDate.localeCompare(aDate);
      }),
    [deals],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <span className="text-sm">{t("totalLost")}</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-foreground">
            {deals.length.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <span className="text-sm">{t("totalLostValue")}</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-destructive">
            {formatCurrency(totalValue, currency)}
          </p>
        </div>
      </div>

      {deals.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-4 text-sm font-semibold text-foreground">{t("byReasonTitle")}</h3>
            <BarChart
              data={byReason}
              index="reason"
              categories={[CATEGORY]}
              colors={["pink"]}
              valueFormatter={(value) => formatCurrency(value, currency)}
              showLegend={false}
              yAxisWidth={64}
              className="h-64"
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">{t("tableDeal")}</TableHead>
                  <TableHead className="text-muted-foreground">{t("tableContact")}</TableHead>
                  <TableHead className="text-right text-muted-foreground">{t("tableValue")}</TableHead>
                  <TableHead className="text-muted-foreground">{t("tableReason")}</TableHead>
                  <TableHead className="text-muted-foreground">{t("tableResponsible")}</TableHead>
                  <TableHead className="text-muted-foreground">{t("tableDate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDeals.map((d) => (
                  <TableRow key={d.id} className="border-border">
                    <TableCell className="font-medium text-foreground">{d.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.contact?.name || d.contact?.phone || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-destructive">
                      {formatCurrency(d.value ?? 0, d.currency || currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.lost_reason?.trim() || t("noReason")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.assignee?.full_name || d.assignee?.email || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {new Date(d.lost_at ?? d.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
