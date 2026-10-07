'use client';

import { useTranslations } from 'next-intl';
import { Compass } from 'lucide-react';
import { SettingsPanelHead } from './settings-panel-head';
import { ColoredCatalogSettings } from './colored-catalog-settings';

/**
 * Settings → Origens do lead (migration 086) — Fase 4, Etapa 3.
 *
 * Manual catalog for origins the system can't detect on its own
 * (indicação, feira, site, prospecção fria...). Doesn't replace the
 * automatic Meta-ad referral fields shown read-only in the contact
 * sidebar ("Origem do Contato", contact-sidebar.tsx) nor the informal
 * auto-tag convention the webhook already applies — both keep working
 * exactly as before; this is a third, separate, manually-assigned field.
 */
export function LeadOriginsSettings() {
  const t = useTranslations('settings.leadOrigins');
  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('pageTitle')} description={t('pageDescription')} />
      <ColoredCatalogSettings table="lead_origins" icon={Compass} translationNamespace="settings.leadOrigins" />
    </section>
  );
}
