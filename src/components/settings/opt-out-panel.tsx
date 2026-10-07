'use client';

import { useTranslations } from 'next-intl';

import { SettingsPanelHead } from './settings-panel-head';
import { OptOutKeywordsSettings } from './opt-out-keywords-settings';
import { BlockedPhonesSettings } from './blocked-phones-settings';

/**
 * Settings → Vendas → Bloqueio de marketing. Mesma convenção de
 * attendance-settings.tsx/sales-goals-panel.tsx: uma seção do rail,
 * dois cards empilhados — palavras-chave/enforcement e a lista de
 * telefones bloqueados.
 */
export function OptOutPanel() {
  const t = useTranslations('settings.optOut');

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <OptOutKeywordsSettings />
      <BlockedPhonesSettings />
    </section>
  );
}
