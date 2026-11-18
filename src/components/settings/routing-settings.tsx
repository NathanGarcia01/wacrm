'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Lock, Shuffle } from 'lucide-react';

import { useCan } from '@/hooks/use-can';
import { usePlanFeatures } from '@/hooks/use-feature-gate';
import type { RoutingMode } from '@/types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MemberRow {
  userId: string;
  fullName: string;
  role: string;
  capacity: number;
  isEnabled: boolean;
}

interface AuditEvent {
  id: string;
  ticketId: string;
  ticketProtocol: number | null;
  agentId: string;
  agentName: string | null;
  mode: string;
  reason: string;
  createdAt: string;
}

/**
 * Settings → Atendimento → Distribuição automática (Fase 1, Etapa 2
 * — migration 129). Gate de plano é client-side aqui (hasRouting via
 * usePlanFeatures) só para decidir o que mostrar; toda escrita é
 * revalidada no servidor (PATCH /api/settings/routing[/members]),
 * então não há como burlar o bloqueio chamando a API direto.
 */
export function RoutingSettings() {
  const t = useTranslations('settings.routing');
  const router = useRouter();
  const canEdit = useCan('edit-settings');
  const { hasRouting } = usePlanFeatures();

  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<RoutingMode>('manual');
  const [enabledAt, setEnabledAt] = useState<string | null>(null);
  const [savingMode, setSavingMode] = useState(false);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);

  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadSettings = useCallback(async () => {
    const [settingsRes, membersRes] = await Promise.all([
      fetch('/api/settings/routing'),
      fetch('/api/settings/routing/members'),
    ]);
    if (settingsRes.ok) {
      const data = await settingsRes.json();
      setMode(data.mode);
      setEnabledAt(data.enabledAt ?? null);
    }
    if (membersRes.ok) {
      const data = await membersRes.json();
      setMembers(data.members ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!canEdit || !hasRouting) return;
    setAuditLoading(true);
    fetch('/api/settings/routing/audit')
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => setAuditEvents(data.events ?? []))
      .catch(() => toast.error(t('auditLoadFailed')))
      .finally(() => setAuditLoading(false));
  }, [canEdit, hasRouting, t]);

  async function handleModeChange(next: RoutingMode) {
    setSavingMode(true);
    try {
      const res = await fetch('/api/settings/routing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMode(data.mode);
      setEnabledAt(data.enabledAt ?? null);
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSavingMode(false);
    }
  }

  async function handleMemberChange(userId: string, patch: { capacity?: number; isEnabled?: boolean }) {
    setSavingMemberId(userId);
    setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, ...patch } : m)));
    try {
      const res = await fetch('/api/settings/routing/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...patch }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error(t('memberSaveFailed'));
      loadSettings();
    } finally {
      setSavingMemberId(null);
    }
  }

  function reasonLabel(reason: string): string {
    switch (reason) {
      case 'round_robin_never_assigned':
        return t('reasonRoundRobinNeverAssigned');
      case 'round_robin_oldest':
        return t('reasonRoundRobinOldest');
      case 'load_least_busy':
        return t('reasonLoadLeastBusy');
      case 'load_tiebreak_round_robin':
        return t('reasonLoadTiebreakRoundRobin');
      default:
        return reason;
    }
  }

  if (!hasRouting) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shuffle className="size-4" />
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shuffle className="size-4" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">{t('modeTitle')}</p>
            <p className="mb-3 text-sm text-muted-foreground">{t('modeDescription')}</p>
            <Select
              value={mode}
              onValueChange={(v) => handleModeChange(v as RoutingMode)}
              disabled={!canEdit || savingMode}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">{t('modeManual')}</SelectItem>
                <SelectItem value="round_robin">{t('modeRoundRobin')}</SelectItem>
                <SelectItem value="load">{t('modeLoad')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              {mode === 'manual' && t('modeManualHint')}
              {mode === 'round_robin' && t('modeRoundRobinHint')}
              {mode === 'load' && t('modeLoadHint')}
            </p>
            {mode !== 'manual' && enabledAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('enabledSince', { date: new Date(enabledAt).toLocaleString('pt-BR') })}
              </p>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t('businessHoursPending')}</p>
          {!canEdit ? <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('membersTitle')}</CardTitle>
          <CardDescription>{t('membersDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('nameColumn')}</TableHead>
                <TableHead>{t('roleColumn')}</TableHead>
                <TableHead>{t('capacityColumn')}</TableHead>
                <TableHead>{t('participatesColumn')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">{m.role}</TableCell>
                  <TableCell>
                    {m.role === 'viewer' ? (
                      <span className="text-xs text-muted-foreground">{t('viewerHint')}</span>
                    ) : (
                      <Input
                        type="number"
                        min={1}
                        value={m.capacity}
                        disabled={!canEdit || savingMemberId === m.userId}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (!Number.isInteger(value) || value < 1) return;
                          handleMemberChange(m.userId, { capacity: value });
                        }}
                        className="w-20"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {m.role === 'viewer' ? (
                      <Badge variant="secondary">—</Badge>
                    ) : (
                      <Switch
                        checked={m.isEnabled}
                        disabled={!canEdit || savingMemberId === m.userId}
                        onCheckedChange={(checked) => handleMemberChange(m.userId, { isEnabled: checked })}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('auditTitle')}</CardTitle>
            <CardDescription>{t('auditDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {auditLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : auditEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('auditEmpty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('auditTicketColumn')}</TableHead>
                    <TableHead>{t('auditAgentColumn')}</TableHead>
                    <TableHead>{t('auditModeColumn')}</TableHead>
                    <TableHead>{t('auditReasonColumn')}</TableHead>
                    <TableHead>{t('auditWhenColumn')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditEvents.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.ticketProtocol ? `#${e.ticketProtocol}` : e.ticketId}</TableCell>
                      <TableCell>{e.agentName ?? e.agentId}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {e.mode === 'round_robin' ? t('modeRoundRobin') : t('modeLoad')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{reasonLabel(e.reason)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString('pt-BR')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
