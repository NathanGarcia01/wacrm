import type { Deal } from "@/types";

type T = (key: string) => string;

/** RFC 4180 quoting — quote every field so commas/newlines/quotes round-trip cleanly. */
function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function dealCommission(deal: Deal): number {
  return (deal.products ?? []).reduce((sum, p) => sum + (p.commission_value ?? 0), 0);
}

function statusLabel(status: Deal["status"], t: T): string {
  if (status === "won") return t("filters.statusWon");
  if (status === "lost") return t("filters.statusLost");
  return t("filters.statusOpen");
}

/**
 * Builds a CSV from the currently filtered deals and triggers a browser
 * download. Client-side only (no server round trip) — the caller
 * already has the filtered rows in memory. `t` must be scoped to the
 * `pipelines` namespace (i.e. `useTranslations("pipelines")`).
 */
export function exportDealsToCsv(deals: Deal[], t: T): void {
  const headers = [
    t("csv.title"),
    t("csv.contact"),
    t("csv.value"),
    t("csv.commission"),
    t("csv.stage"),
    t("csv.responsible"),
    t("csv.status"),
    t("csv.createdAt"),
    t("csv.closedAt"),
    t("csv.lostReason"),
  ];

  const rows = deals.map((d) => {
    const closedAt = d.status === "won" ? d.won_at : d.status === "lost" ? d.lost_at : null;
    return [
      d.title,
      d.contact?.name || d.contact?.phone || "",
      String(d.value ?? 0),
      String(dealCommission(d)),
      d.stage?.name || t("csv.noStage"),
      d.assignee?.full_name || d.assignee?.email || t("csv.unassigned"),
      statusLabel(d.status, t),
      new Date(d.created_at).toLocaleDateString(),
      closedAt ? new Date(closedAt).toLocaleDateString() : "",
      d.status === "lost" ? d.lost_reason ?? "" : "",
    ];
  });

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsvField(String(cell))).join(","))
    .join("\r\n");

  // Leading BOM so Excel (which guesses encoding from the first bytes,
  // not a declared charset) renders accented PT-BR/ES characters
  // correctly instead of mangling them as Latin-1.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
