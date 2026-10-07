'use client';

import { useTranslations } from 'next-intl';
import { UserCircle2 } from 'lucide-react';
import { SettingsPanelHead } from './settings-panel-head';
import { ColoredCatalogSettings } from './colored-catalog-settings';

/** Settings → Status do cliente (migration 086) — Fase 4, Etapa 3. */
export function ContactStatusesSettings() {
  const t = useTranslations('settings.contactStatuses');
  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('pageTitle')} description={t('pageDescription')} />
      <ColoredCatalogSettings table="contact_statuses" icon={UserCircle2} translationNamespace="settings.contactStatuses" />
    </section>
  );
}
