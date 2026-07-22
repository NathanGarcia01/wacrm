import { getTranslations } from 'next-intl/server'
import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  | 'welcome_receptive'
  | 'followup_24h'
  | 'deal_won_flow'
  | 'keyword_qualifier'
  | 'auto_redistribution'

const TEMPLATE_SLUGS: readonly TemplateSlug[] = [
  'welcome_message',
  'out_of_office',
  'lead_qualifier',
  'follow_up_reminder',
  'welcome_receptive',
  'followup_24h',
  'deal_won_flow',
  'keyword_qualifier',
  'auto_redistribution',
]

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

/** Translator shape needed to build the localized template definitions —
 *  pass `useTranslations('automations.templates')` from the caller since
 *  this is a plain module (can't call the hook itself). */
type TemplatesT = (key: string) => string

/**
 * Builds the quick-start template catalog with copy in the caller's
 * active locale. Callers (the automations list page and the "new from
 * template" flow) each hold their own `useTranslations` instance and
 * pass it in — the shape (`Record<TemplateSlug, AutomationTemplateDefinition>`)
 * is unchanged from the old static export, so callers still index with
 * `templates[slug]`.
 */
export function buildAutomationTemplates(
  t: TemplatesT,
): Record<TemplateSlug, AutomationTemplateDefinition> {
  return {
    welcome_message: {
      slug: 'welcome_message',
      name: t('welcomeMessage.name'),
      description: t('welcomeMessage.description'),
      // first_inbound_message (added in PR #33) catches both brand-new
      // contacts AND manually-added/imported contacts on their first-ever
      // reply, which is what a user setting up a "welcome" automation
      // almost always wants. new_contact_created would miss the
      // manually-imported case.
      trigger_type: 'first_inbound_message',
      trigger_config: {},
      steps: [
        {
          step_type: 'send_message',
          step_config: {
            text: t('welcomeMessage.text1'),
          },
        },
        {
          step_type: 'add_tag',
          step_config: { tag_id: '' },
        },
      ],
    },
    out_of_office: {
      slug: 'out_of_office',
      name: t('outOfOffice.name'),
      description: t('outOfOffice.description'),
      trigger_type: 'new_message_received',
      trigger_config: {},
      steps: [
        {
          step_type: 'condition',
          step_config: {
            subject: 'time_of_day',
            operand: '18:00-09:00',
          },
        },
        {
          step_type: 'send_message',
          step_config: {
            text: t('outOfOffice.text1'),
          },
          parent_index: 0,
          branch: 'yes',
        },
      ],
    },
    lead_qualifier: {
      slug: 'lead_qualifier',
      name: t('leadQualifier.name'),
      description: t('leadQualifier.description'),
      trigger_type: 'keyword_match',
      trigger_config: {
        keywords: ['preço', 'orçamento', 'comprar'],
        match_type: 'contains',
      },
      steps: [
        {
          step_type: 'send_message',
          step_config: {
            text: t('leadQualifier.text1'),
          },
        },
        {
          step_type: 'wait',
          step_config: { amount: 10, unit: 'minutes' },
        },
        {
          step_type: 'assign_conversation',
          step_config: { mode: 'round_robin' },
        },
      ],
    },
    follow_up_reminder: {
      slug: 'follow_up_reminder',
      name: t('followUpReminder.name'),
      description: t('followUpReminder.description'),
      trigger_type: 'new_message_received',
      trigger_config: {},
      steps: [
        {
          step_type: 'wait',
          step_config: { amount: 1, unit: 'days' },
        },
        {
          step_type: 'send_message',
          step_config: {
            text: t('followUpReminder.text1'),
          },
        },
      ],
    },
    welcome_receptive: {
      slug: 'welcome_receptive',
      name: t('welcomeReceptive.name'),
      description: t('welcomeReceptive.description'),
      trigger_type: 'new_contact_created',
      trigger_config: {},
      steps: [
        {
          step_type: 'send_message',
          step_config: { text: t('welcomeReceptive.text1') },
        },
        {
          step_type: 'add_tag',
          step_config: { tag_id: '' },
        },
        {
          step_type: 'create_deal',
          step_config: { title: '', value: 0 },
        },
      ],
    },
    followup_24h: {
      slug: 'followup_24h',
      name: t('followup24h.name'),
      description: t('followup24h.description'),
      trigger_type: 'inactivity',
      trigger_config: { hours: 24 },
      steps: [
        {
          step_type: 'send_message',
          step_config: { text: t('followup24h.text1') },
        },
        {
          step_type: 'set_conversation_pending',
          step_config: {},
        },
      ],
    },
    deal_won_flow: {
      slug: 'deal_won_flow',
      name: t('dealWonFlow.name'),
      description: t('dealWonFlow.description'),
      trigger_type: 'deal_won',
      trigger_config: {},
      steps: [
        {
          step_type: 'send_message',
          step_config: { text: t('dealWonFlow.text1') },
        },
        // close_conversation also auto-fires the NPS survey (mirrors the
        // manual-close flow) so this template needs no separate NPS step.
        {
          step_type: 'close_conversation',
          step_config: {},
        },
      ],
    },
    keyword_qualifier: {
      slug: 'keyword_qualifier',
      name: t('keywordQualifier.name'),
      description: t('keywordQualifier.description'),
      trigger_type: 'keyword_match',
      trigger_config: {
        keywords: ['preço', 'orçamento', 'comprar', 'contratar'],
        match_type: 'contains',
      },
      steps: [
        {
          step_type: 'condition',
          step_config: { subject: 'tag_presence', operand: '' },
        },
        {
          step_type: 'assign_conversation',
          step_config: { mode: 'round_robin' },
          parent_index: 0,
          branch: 'yes',
        },
        {
          step_type: 'close_conversation',
          step_config: {},
          parent_index: 0,
          branch: 'no',
        },
      ],
    },
    auto_redistribution: {
      slug: 'auto_redistribution',
      name: t('autoRedistribution.name'),
      description: t('autoRedistribution.description'),
      trigger_type: 'conversation_opened',
      trigger_config: {},
      steps: [
        {
          step_type: 'assign_conversation',
          step_config: { mode: 'round_robin' },
        },
      ],
    },
  }
}

/**
 * Server-side lookup for API routes (no React render tree, so no
 * `useTranslations`). Used by POST /api/automations' bare `{ template }`
 * fallback path — resolves via the request's `NEXT_LOCALE` cookie same as
 * any other server-rendered surface (see src/i18n/request.ts).
 */
export async function getTemplate(slug: string): Promise<AutomationTemplateDefinition | null> {
  if (!TEMPLATE_SLUGS.includes(slug as TemplateSlug)) return null
  const t = await getTranslations('automations.templates')
  return buildAutomationTemplates(t)[slug as TemplateSlug]
}
