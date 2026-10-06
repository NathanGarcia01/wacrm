import {
  Coins,
  FileText,
  Headset,
  KeyRound,
  Languages,
  LayoutGrid,
  MessageSquareText,
  Package,
  Palette,
  PlugZap,
  Plug,
  Shield,
  Star,
  Tags,
  User,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'preferences',
  'whatsapp',
  'templates',
  'fields',
  'deals',
  'products',
  'quickReplies',
  'attendance',
  'nps',
  'members',
  'api',
  'integrations',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/**
 * Rail grouping. `adminOnly` items are hidden for non-admins.
 *
 * No `label` here — this is a plain data module (not a component), so
 * it can't call `useTranslations`. Consumers render the label via
 * `useTranslations('settings.sections')` and `t(id)` — every id below
 * matches a key in that namespace across messages/{pt,en,es}.json.
 */
export interface SectionMeta {
  id: SettingsSection;
  icon: LucideIcon;
  group: 'top' | 'account' | 'cadastros' | 'atendimento' | 'vendas' | 'avancado';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', icon: User, group: 'account' },
  security: { id: 'security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', icon: Palette, group: 'account' },
  preferences: { id: 'preferences', icon: Languages, group: 'account' },
  fields: { id: 'fields', icon: Tags, group: 'cadastros' },
  products: { id: 'products', icon: Package, group: 'cadastros' },
  whatsapp: { id: 'whatsapp', icon: PlugZap, group: 'atendimento' },
  templates: { id: 'templates', icon: FileText, group: 'atendimento' },
  quickReplies: {
    id: 'quickReplies',
    icon: MessageSquareText,
    group: 'atendimento',
  },
  attendance: { id: 'attendance', icon: Headset, group: 'atendimento' },
  nps: { id: 'nps', icon: Star, group: 'atendimento' },
  deals: { id: 'deals', icon: Coins, group: 'vendas' },
  members: { id: 'members', icon: UsersRound, group: 'avancado' },
  api: { id: 'api', icon: KeyRound, group: 'avancado' },
  integrations: { id: 'integrations', icon: Plug, group: 'avancado' },
};

/** `groupKey` resolves via `useTranslations('settings.railGroups')`;
 *  `null` means "top" — no group heading.
 *
 *  Order here is the reorg from Fase 4, Etapa 1: Minha Conta stays
 *  first (personal settings, not one of the 4 named business groups
 *  from the plan) — Cadastros/Atendimento/Vendas/Avançado are the new
 *  split of what used to be a single flat "workspace" bucket. */
export const RAIL_GROUPS: {
  groupKey: 'account' | 'cadastros' | 'atendimento' | 'vendas' | 'avancado' | null;
  group: SectionMeta['group'];
}[] = [
  { groupKey: null, group: 'top' },
  { groupKey: 'account', group: 'account' },
  { groupKey: 'cadastros', group: 'cadastros' },
  { groupKey: 'atendimento', group: 'atendimento' },
  { groupKey: 'vendas', group: 'vendas' },
  { groupKey: 'avancado', group: 'avancado' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). `billing` is `/api/billing/portal`'s
 * Stripe return URL (`?tab=billing`) — there's no dedicated billing
 * panel, the actual "Manage subscription" link lives on the Overview
 * landing, so that's where it lands instead of silently falling
 * through to the same default by accident. Anything else unknown
 * falls back to the Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (raw === 'billing') return 'overview';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
