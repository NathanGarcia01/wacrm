/**
 * Shared display config for message_templates.status.
 *
 * The DB stores Meta's raw enum (DRAFT / APPROVED / PENDING / REJECTED /
 * PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION) — the UI maps it to
 * a human label + dark-theme badge classes here so the template manager,
 * inbox picker, and broadcast picker stay aligned.
 */

import type { MessageTemplateStatus } from '@/types';

/**
 * No `label` here — this is a plain data module (not a component), so
 * it can't call `useTranslations`. The sole consumer (template-manager.tsx)
 * renders the label via `useTranslations('settings.templates.status')`
 * and `t(statusKey)`, where statusKey is the camelCase form below.
 */
export interface TemplateStatusDisplay {
  classes: string;
}

export const TEMPLATE_STATUS_KEY: Record<MessageTemplateStatus, string> = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'disabled',
  IN_APPEAL: 'inAppeal',
  PENDING_DELETION: 'pendingDeletion',
};

export const templateStatusConfig: Record<
  MessageTemplateStatus,
  TemplateStatusDisplay
> = {
  DRAFT: {
    classes: 'bg-slate-600/20 text-muted-foreground border-slate-600/30',
  },
  PENDING: {
    classes: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  },
  APPROVED: {
    classes: 'bg-primary/20 text-primary border-primary/30',
  },
  REJECTED: {
    classes: 'bg-red-600/20 text-red-400 border-red-600/30',
  },
  PAUSED: {
    classes: 'bg-orange-600/20 text-orange-400 border-orange-600/30',
  },
  DISABLED: {
    classes: 'bg-red-900/30 text-red-500 border-red-900/40',
  },
  IN_APPEAL: {
    classes: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  },
  PENDING_DELETION: {
    classes: 'bg-slate-700/30 text-muted-foreground border-slate-700/40',
  },
};
