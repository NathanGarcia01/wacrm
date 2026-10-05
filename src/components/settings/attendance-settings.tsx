'use client';

import { useTranslations } from 'next-intl';

import { SettingsPanelHead } from './settings-panel-head';
import { DepartmentsSettings } from './departments-settings';
import { ClosingReasonsSettings } from './closing-reasons-settings';
import { BusinessHoursSettings } from './business-hours-settings';
import { HolidaysSettings } from './holidays-settings';

/**
 * Settings → Atendimento (Fase 1, Etapa 7). Groups the four
 * attendance catalogs seeded by migration 069 — departments, closing
 * reasons, business hours, holidays — the same way "Fields & tags"
 * groups tags + custom fields: stacked cards in one section rather
 * than four separate rail entries. The closing-reasons catalog here
 * is what the future mandatory-reason close dialog (Etapa 6) will
 * read from.
 */
export function AttendanceSettings() {
  const t = useTranslations('settings.attendance');

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <DepartmentsSettings />
      <ClosingReasonsSettings />
      <BusinessHoursSettings />
      <HolidaysSettings />
    </section>
  );
}
