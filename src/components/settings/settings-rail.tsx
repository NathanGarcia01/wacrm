'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';

// Width at/above which the rail is a vertical column (already in view, so
// no auto-scroll needed). Mirrors the Tailwind `lg:` breakpoint that
// drives the row→column switch in the markup below — keep the two in sync.
const RAIL_DESKTOP_MIN_PX = 1024;

/**
 * The settings left rail — grouped, vertical on desktop and a
 * horizontal scroller on narrow screens (mirrors the mockup's ≤920px
 * behaviour). The active item auto-scrolls into view when the rail is
 * horizontal so a deep-linked section is never off-screen.
 */
export function SettingsRail({
  active,
  onSelect,
  hints,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  hints?: Partial<Record<SettingsSection, ReactNode>>;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const tSections = useTranslations('settings.sections');
  const tDescriptions = useTranslations('settings.sectionDescriptions');
  const tRailGroups = useTranslations('settings.railGroups');
  const tSearch = useTranslations('settings.search');
  const [query, setQuery] = useState('');

  // When horizontal (mobile), keep the active chip in view. On desktop
  // the rail is a static column, so skip.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia(`(min-width: ${RAIL_DESKTOP_MIN_PX}px)`).matches) return;
    activeRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [active]);

  // Matches by name OR description — while searching, groups collapse
  // into one flat list (a match in "Vendas" and one in "Atendimento"
  // should both show at once, not force picking a group first).
  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return null;
    return SETTINGS_SECTIONS.filter((s) => {
      const haystack = `${tSections(s)} ${tDescriptions(s)}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, tSections, tDescriptions]);

  function renderItem(s: SettingsSection) {
    const meta = SECTION_META[s];
    const Icon = meta.icon;
    const isActive = s === active;
    return (
      <button
        key={s}
        ref={isActive ? activeRef : undefined}
        type="button"
        onClick={() => onSelect(s)}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors',
          'lg:w-full',
          isActive
            ? 'bg-primary-soft text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1">{tSections(meta.id)}</span>
        {hints?.[s] != null ? (
          <span
            className={cn(
              'hidden items-center gap-1.5 text-xs lg:inline-flex',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {hints[s]}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="lg:sticky lg:top-0">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tSearch('placeholder')}
          className="h-9 bg-card pl-8"
        />
      </div>

      {searchResults ? (
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
          {searchResults.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {tSearch('noResults', { query })}
            </p>
          ) : (
            searchResults.map(renderItem)
          )}
        </nav>
      ) : (
        <nav
          aria-label="Settings sections"
          className={cn(
            'flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            'border-b border-border',
            'lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0',
          )}
        >
          {RAIL_GROUPS.map(({ groupKey, group }) => {
            const items = SETTINGS_SECTIONS.filter(
              (s) => SECTION_META[s].group === group,
            );
            return (
              <div
                key={group}
                className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5"
              >
                {groupKey ? (
                  <div className="hidden items-baseline gap-1.5 px-3 pt-3.5 pb-1.5 lg:flex">
                    <span className="text-[11px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
                      {tRailGroups(groupKey)}
                    </span>
                    <span className="text-[11px] text-muted-foreground/70">{items.length}</span>
                  </div>
                ) : null}
                {items.map(renderItem)}
              </div>
            );
          })}
        </nav>
      )}
    </div>
  );
}
