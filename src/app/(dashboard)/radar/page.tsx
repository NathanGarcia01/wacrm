'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Lock, Radar as RadarIcon } from 'lucide-react';

import { usePlanFeatures } from '@/hooks/use-feature-gate';
import { RadarTable } from '@/components/radar/radar-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Fase 2 (Radar + Follow-up seguro) — Etapa A. 100% leitura: lista
 * conversas abertas em risco (aguardando nossa resposta / cliente
 * esfriou). Clique numa linha abre a conversa na Inbox (?c=). Gate
 * de plano client-side aqui é só UX — a rota /api/radar já recusa a
 * chamada no servidor para quem não tem hasFollowup.
 */
export default function RadarPage() {
  const t = useTranslations('radar');
  const router = useRouter();
  const { hasFollowup } = usePlanFeatures();

  return (
    <div>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <RadarIcon className="size-6" />
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="mt-6">
        {hasFollowup ? (
          <RadarTable />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t('upsellTitle')}</CardTitle>
              <CardDescription>{t('upsellDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10 text-center">
                <Lock className="size-6 text-muted-foreground" />
                <Button onClick={() => router.push('/settings?tab=overview')}>{t('upsellButton')}</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
