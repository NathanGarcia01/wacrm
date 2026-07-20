import {
  Coins,
  FileText,
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
  group: 'top' | 'account' | 'workspace';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', icon: User, group: 'account' },
  security: { id: 'security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', icon: Palette, group: 'account' },
  preferences: { id: 'preferences', icon: Languages, group: 'account' },
  whatsapp: { id: 'whatsapp', icon: PlugZap, group: 'workspace' },
  templates: { id: 'templates', icon: FileText, group: 'workspace' },
  fields: { id: 'fields', icon: Tags, group: 'workspace' },
  deals: { id: 'deals', icon: Coins, group: 'workspace' },
  products: { id: 'products', icon: Package, group: 'workspace' },
  quickReplies: {
    id: 'quickReplies',
    icon: MessageSquareText,
    group: 'workspace',
  },
  nps: { id: 'nps', icon: Star, group: 'workspace' },
  members: { id: 'members', icon: UsersRound, group: 'workspace' },
  api: { id: 'api', icon: KeyRound, group: 'workspace' },
  integrations: { id: 'integrations', icon: Plug, group: 'workspace' },
};

/** `groupKey` resolves via `useTranslations('settings.railGroups')`;
 *  `null` means "top" — no group heading. */
export const RAIL_GROUPS: {
  groupKey: 'account' | 'workspace' | null;
  group: SectionMeta['group'];
}[] = [
  { groupKey: null, group: 'top' },
  { groupKey: 'account', group: 'account' },
  { groupKey: 'workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
