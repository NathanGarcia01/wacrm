'use client';

import { Check, Languages as LanguagesIcon, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { LOCALES, LOCALE_COOKIE_NAME, type Locale } from '@/i18n/locales';
import { cn } from '@/lib/utils';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Language select — persists to `profiles.language`, then flips the
 * `NEXT_LOCALE` cookie next-intl's server config reads (src/i18n/
 * request.ts) and refreshes so the new locale takes effect immediately.
 */
export function PreferencesPanel() {
  const { user, profile, refreshProfile } = useAuth();
  const t = useTranslations('settings.preferences');
  const [saving, setSaving] = useState<Locale | null>(null);

  const onPick = async (locale: Locale) => {
    if (!user || saving || locale === profile?.language) return;
    setSaving(locale);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ language: locale })
        .eq('user_id', user.id);
      if (error) throw new Error(error.message);

      document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
      await refreshProfile();
      toast.success(t('saved'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <LanguagesIcon className="size-4 text-muted-foreground" />
          {t('language')}
        </h3>

        <div
          role="radiogroup"
          aria-label={t('language')}
          className="grid max-w-md grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {LOCALES.map((locale) => {
            const isActive = locale === profile?.language;
            return (
              <button
                key={locale}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => onPick(locale)}
                disabled={saving !== null}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg border bg-card p-4 text-left transition-colors',
                  isActive
                    ? 'border-primary/60 ring-2 ring-primary/40'
                    : 'border-border hover:border-border hover:bg-muted/40',
                )}
              >
                <span className="text-sm font-semibold text-foreground">
                  {t(locale)}
                </span>
                {saving === locale ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : isActive ? (
                  <Check className="size-4 shrink-0 text-primary" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
