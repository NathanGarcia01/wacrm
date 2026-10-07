'use client';

import { useTranslations } from 'next-intl';

import { SettingsPanelHead } from './settings-panel-head';
import { SalesGoalsSettings } from './sales-goals-settings';
import { UserSalesGoalsSettings } from './user-sales-goals-settings';

/**
 * Settings → Vendas → Meta de vendas. Mesma convenção de
 * attendance-settings.tsx: uma seção do rail, dois cards
 * empilhados — meta da conta (migration 087, accounts.sales_goal_*)
 * e meta por usuário (account_user_sales_goals).
 */
export function SalesGoalsPanel() {
  const t = useTranslations('settings.salesGoals');

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <SalesGoalsSettings />
      <UserSalesGoalsSettings />
    </section>
  );
}
