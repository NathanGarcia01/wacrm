import type { BlockedPhone } from '@/types';

type T = (key: string, values?: Record<string, string | number>) => string;

function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Same shape as exportDealsToCsv (src/lib/pipelines/export-csv.ts) —
 *  client-side only, browser download, BOM-prefixed for Excel. `t`
 *  must be scoped to the `settings.optOut.blockedPhones` namespace. */
export function exportBlockedPhonesToCsv(
  rows: BlockedPhone[],
  memberNames: Map<string, string>,
  t: T,
): void {
  const headers = [
    t('csv.phone'),
    t('csv.source'),
    t('csv.reason'),
    t('csv.blockedBy'),
    t('csv.blockedAt'),
    t('csv.unblockedAt'),
  ];

  const csvRows = rows.map((r) => [
    r.phone,
    t(`sourceLabels.${r.source}`),
    r.reason ?? '',
    r.blocked_by ? memberNames.get(r.blocked_by) ?? r.blocked_by : '',
    new Date(r.blocked_at).toLocaleString(),
    r.unblocked_at ? new Date(r.unblocked_at).toLocaleString() : '',
  ]);

  const csv = [headers, ...csvRows]
    .map((row) => row.map((cell) => escapeCsvField(String(cell))).join(','))
    .join('\r\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bloqueados-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
