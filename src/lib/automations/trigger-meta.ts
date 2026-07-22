import type { AutomationTriggerType } from '@/types'

export interface TriggerMeta {
  /** Key into the `automations.builder` messages namespace — the builder's
   *  trigger-picker labels are reused here for the list row pill so the
   *  wording doesn't drift between the two surfaces. `null` for a
   *  legacy/unrecognized trigger type, where `rawLabel` is shown verbatim
   *  instead (there's no sensible translation for an unknown value). */
  labelKey:
    | 'triggerNewMessageReceived'
    | 'triggerFirstInboundMessage'
    | 'triggerFirstOutboundMessage'
    | 'triggerKeywordMatch'
    | 'triggerNewContactCreated'
    | 'triggerConversationAssigned'
    | 'triggerTagAdded'
    | 'triggerTimeBased'
    | 'triggerConversationOpened'
    | 'triggerConversationClosed'
    | 'triggerDealStageChanged'
    | 'triggerDealWon'
    | 'triggerDealLost'
    | null
  rawLabel?: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    labelKey: 'triggerNewMessageReceived',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    labelKey: 'triggerFirstInboundMessage',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  first_outbound_message: {
    labelKey: 'triggerFirstOutboundMessage',
    pillClass: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  },
  keyword_match: {
    labelKey: 'triggerKeywordMatch',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    labelKey: 'triggerNewContactCreated',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    labelKey: 'triggerConversationAssigned',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    labelKey: 'triggerTagAdded',
    pillClass: 'border-gold/30 bg-gold-soft text-gold',
  },
  time_based: {
    labelKey: 'triggerTimeBased',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
  },
  conversation_opened: {
    labelKey: 'triggerConversationOpened',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  conversation_closed: {
    labelKey: 'triggerConversationClosed',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
  },
  deal_stage_changed: {
    labelKey: 'triggerDealStageChanged',
    pillClass: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  },
  deal_won: {
    labelKey: 'triggerDealWon',
    pillClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  deal_lost: {
    labelKey: 'triggerDealLost',
    pillClass: 'border-red-500/30 bg-red-500/10 text-red-300',
  },
}

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      labelKey: null,
      rawLabel: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
    }
  )
}

/** Translator shape needed to render relative-time strings — pass
 *  `useTranslations('automations.relativeTime')` from the caller since
 *  this is a plain module (can't call the hook itself). */
type RelativeTimeT = (key: string, values?: Record<string, string | number | Date>) => string

export function formatRelative(iso: string | null | undefined, t: RelativeTimeT): string {
  if (!iso) return t('never')
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return t('never')
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return t('justNow')
  if (diffSec < 3600) return t('minutesAgo', { count: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return t('hoursAgo', { count: Math.floor(diffSec / 3600) })
  if (diffSec < 2_592_000) return t('daysAgo', { count: Math.floor(diffSec / 86400) })
  return new Date(iso).toLocaleDateString()
}
