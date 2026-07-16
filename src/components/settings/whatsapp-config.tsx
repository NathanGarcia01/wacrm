'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { MetaPricingSection } from './meta-pricing-section';
import { WhatsAppChannelList } from './whatsapp-channel-list';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';

/**
 * Settings → WhatsApp. Multi-channel: the connection form used to be a
 * single account-wide row (whatsapp_config); it's now a list of
 * independent numbers (whatsapp_channels), each with its own credentials
 * and registration status — see WhatsAppChannelList. The webhook callback
 * URL and Meta pricing stay account-level since they aren't per-number.
 */
export function WhatsAppConfig() {
  const t = useTranslations('settings.whatsapp');

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success(t('webhookUrlCopied'));
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <WhatsAppChannelList />

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('webhookConfigTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('webhookConfigDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('webhookCallbackUrlLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrl}
                    className="bg-muted border-border text-muted-foreground font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyWebhookUrl}
                    className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <MetaPricingSection />
        </div>

        {/* Setup Instructions Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">
                {t('setupInstructionsTitle')}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('setupInstructionsDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        1
                      </span>
                      {t('step1Title')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>
                        {t('step1Item1Prefix')} <span className="text-primary">developers.facebook.com</span>
                      </li>
                      <li>{t('step1Item2')}</li>
                      <li>{t('step1Item3')}</li>
                      <li>{t('step1Item4')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        2
                      </span>
                      {t('step2Title')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step2Item1')}</li>
                      <li>{t('step2Item2')}</li>
                      <li>{t('step2Item3')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        3
                      </span>
                      {t('step3Title')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step3Item1')}</li>
                      <li>
                        {t('step3Item2Prefix')}{' '}
                        <strong className="text-foreground">{t('phoneNumberIdLabel')}</strong>
                      </li>
                      <li>
                        {t('step3Item3Prefix')}{' '}
                        <strong className="text-foreground">{t('wabaIdLabel')}</strong>
                      </li>
                      <li>
                        {t('step3Item4Prefix')}{' '}
                        <strong className="text-foreground">{t('accessTokenLabel')}</strong>{' '}
                        {t('step3Item4Suffix')}
                      </li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        4
                      </span>
                      {t('step4Title')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step4Item1')}</li>
                      <li>{t('step4Item2')}</li>
                      <li>
                        {t('step4Item3Prefix')}{' '}
                        <strong className="text-foreground">{t('webhookCallbackUrlLabel')}</strong>{' '}
                        {t('step4Item3Suffix')}
                      </li>
                      <li>
                        {t('step4Item4Prefix')}{' '}
                        <strong className="text-foreground">{t('verifyTokenLabel')}</strong>{' '}
                        {t('step4Item4Suffix')}
                      </li>
                      <li>{t('step4Item5')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4 pt-4 border-t border-border">
                <a
                  href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  {t('docsLink')}
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
