import {
  Crown,
  Shield,
  UserCog,
  UserIcon,
  type LucideIcon,
} from 'lucide-react';

import type { AccountRole } from '@/lib/auth/roles';
import type { ChipVariant } from './settings-chip';

/**
 * Single source of truth for per-role chip metadata across settings
 * surfaces (the Overview identity chip and the Members roster/invite
 * chips). Previously duplicated in both files; hoisted here so an
 * icon or colour change lands once.
 *
 * No `label` here — this is a plain data module (not a component), so
 * it can't call `useTranslations`. Consumers render the label via
 * `useTranslations('common')` and `t('roles.' + role)`.
 *
 * `variant` drives the token-based <SettingsChip>; `className` is the
 * inline Tailwind string the Members tab applies to its own spans.
 */
export const ROLE_META: Record<
  AccountRole,
  { icon: LucideIcon; variant: ChipVariant; className: string }
> = {
  owner: {
    icon: Crown,
    variant: 'owner',
    className: 'border-gold/40 bg-gold-soft text-gold',
  },
  admin: {
    icon: Shield,
    variant: 'admin',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  agent: {
    icon: UserCog,
    variant: 'muted',
    className: 'border-border bg-muted text-muted-foreground',
  },
  viewer: {
    icon: UserIcon,
    variant: 'muted',
    // Outline-only so it stays quieter than the filled Agent chip in
    // both modes — bg-card would blend into a card surface in light mode.
    className: 'border-border bg-transparent text-muted-foreground',
  },
};
