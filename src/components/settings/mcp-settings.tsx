'use client';

// ============================================================
// McpSettings — Settings → Servidor MCP
//
// Fase 3B: an MCP (Model Context Protocol) server over the same API
// v1 — any MCP-aware AI client (Claude, Cursor, etc.) can connect
// using an existing `wacrm_live_…` API key as the bearer token, no
// separate credential type. This panel is purely informational — the
// URL is public knowledge (the actual secret is the API key, managed
// in Settings → API keys), so there's nothing to create/reveal here,
// unlike lead-sources or API keys themselves.
//
// Gated by `hasAPI` (Business), same dimension as the public REST API
// and lead-capture webhooks — upsell card mirrors
// lead-sources-settings.tsx / followup-settings.tsx.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bot, Copy, KeyRound, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePlanFeatures } from '@/hooks/use-feature-gate';
import { SettingsPanelHead } from './settings-panel-head';

const TOOLS: { name: string; scope: string }[] = [
  { name: 'search_contacts', scope: 'contacts:read' },
  { name: 'create_contact', scope: 'contacts:write' },
  { name: 'update_contact', scope: 'contacts:write' },
  { name: 'list_conversations', scope: 'conversations:read' },
  { name: 'list_messages', scope: 'messages:read' },
  { name: 'create_deal', scope: 'deals:write' },
  { name: 'move_deal', scope: 'deals:write' },
  { name: 'update_deal', scope: 'deals:write' },
  { name: 'list_tags', scope: 'tags:read' },
  { name: 'apply_tag', scope: 'tags:write' },
  { name: 'list_pipelines', scope: 'deals:read' },
];

export function McpSettings() {
  const t = useTranslations('settings.mcp');
  const router = useRouter();
  const { hasAPI } = usePlanFeatures();
  const [origin] = useState(() => (typeof window !== 'undefined' ? window.location.origin : ''));

  const url = origin ? `${origin}/api/v1/mcp` : '';

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  if (!hasAPI) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10 text-center">
            <Lock className="size-6 text-muted-foreground" />
            <p className="font-medium text-foreground">{t('upsellTitle')}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t('upsellDescription')}</p>
            <Button onClick={() => router.push('/settings?tab=overview')}>{t('upsellButton')}</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('urlLabel')}</Label>
            <div className="flex gap-2">
              <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={copyUrl} disabled={!url}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>

          <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
            <li>
              {t('step1Part1')}{' '}
              <Button
                variant="link"
                className="h-auto p-0 text-sm"
                onClick={() => router.push('/settings?tab=api')}
              >
                <KeyRound className="size-3.5" />
                {t('step1LinkLabel')}
              </Button>{' '}
              {t('step1Part2')}
            </li>
            <li>{t('step2')}</li>
            <li>{t('step3')}</li>
          </ol>

          <div className="rounded-md border border-border bg-muted p-3">
            <pre className="overflow-x-auto text-xs text-muted-foreground">
{`{
  "mcpServers": {
    "funilly": {
      "url": "${url || 'https://seu-dominio.exemplo.com/api/v1/mcp'}",
      "headers": { "Authorization": "Bearer wacrm_live_xxx" }
    }
  }
}`}
            </pre>
          </div>

          <p className="text-xs text-muted-foreground">{t('scopesHint')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('toolsTitle')}</CardTitle>
          <CardDescription>{t('toolsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y">
            {TOOLS.map((tool) => (
              <li key={tool.name} className="flex items-center justify-between gap-3 py-2">
                <code className="text-sm text-foreground">{tool.name}</code>
                <Badge className="border-border bg-muted text-muted-foreground text-[10px]">{tool.scope}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
