'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { useCan } from '@/hooks/use-can';
import type { AccountMember, RadarConversation, RadarGroup } from '@/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isSessionWindowOpen } from '@/lib/radar/classify';

const PAGE_SIZE = 50;

/** Duração "Xh Ymin" / "Xd" pro "Parado há" — coarse, mesmo espírito
 *  de formatWaitingDuration (conversation-list-status.ts), mas aqui
 *  precisa ir até dias (o grupo "cliente esfriou" fica parado por
 *  muito mais que algumas horas). */
function useIdleLabel() {
  const t = useTranslations('radar');
  return useCallback(
    (lastMessageAt: string, now: number) => {
      const minutes = Math.max(0, Math.round((now - new Date(lastMessageAt).getTime()) / 60_000));
      if (minutes < 60) return t('minutesAgo', { count: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('hoursAgo', { count: hours });
      const days = Math.floor(hours / 24);
      return t('daysAgo', { count: days });
    },
    [t],
  );
}

export function RadarTable() {
  const t = useTranslations('radar');
  const router = useRouter();
  const isAdminPlus = useCan('manage-members');

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [conversations, setConversations] = useState<RadarConversation[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [members, setMembers] = useState<AccountMember[]>([]);

  const [group, setGroup] = useState<RadarGroup | 'all'>('all');
  const [agentId, setAgentId] = useState<string>('all');
  const [minHours, setMinHours] = useState<string>('default');

  const idleLabel = useIdleLabel();
  const now = Date.now();

  useEffect(() => {
    if (!isAdminPlus) return;
    fetch('/api/account/members')
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => setMembers(data.members ?? []))
      .catch(() => {
        /* filtro de atendente só não aparece — não é crítico */
      });
  }, [isAdminPlus]);

  const buildUrl = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (group !== 'all') params.set('group', group);
      if (isAdminPlus && agentId !== 'all') params.set('agentId', agentId);
      if (minHours !== 'default') params.set('minHours', minHours);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      return `/api/radar?${params.toString()}`;
    },
    [group, agentId, minHours, isAdminPlus],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(buildUrl(0));
      if (!res.ok) throw new Error();
      const data = await res.json();
      setConversations(data.conversations ?? []);
      setHasMore(!!data.hasMore);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [buildUrl, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(conversations.length));
      if (!res.ok) throw new Error();
      const data = await res.json();
      setConversations((prev) => [...prev, ...(data.conversations ?? [])]);
      setHasMore(!!data.hasMore);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoadingMore(false);
    }
  }

  const memberName = useMemo(() => {
    const byId = new Map(members.map((m) => [m.user_id, m.full_name || m.email || '']));
    return (userId: string | null) => (userId ? byId.get(userId) ?? null : null);
  }, [members]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('groupFilterLabel')}</span>
          <Select value={group} onValueChange={(v) => setGroup((v as RadarGroup | 'all') ?? 'all')}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('groupAll')}</SelectItem>
              <SelectItem value="awaiting_us">{t('groupAwaitingUs')}</SelectItem>
              <SelectItem value="customer_cooled">{t('groupCustomerCooled')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isAdminPlus ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('agentFilterLabel')}</span>
            <Select value={agentId} onValueChange={(v) => setAgentId(v ?? 'all')}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('agentAll')}</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name || m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('minHoursFilterLabel')}</span>
          <Select value={minHours} onValueChange={(v) => setMinHours(v ?? 'default')}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{t('minHoursDefault')}</SelectItem>
              <SelectItem value="6">{t('minHours6')}</SelectItem>
              <SelectItem value="12">{t('minHours12')}</SelectItem>
              <SelectItem value="24">{t('minHours24')}</SelectItem>
              <SelectItem value="48">{t('minHours48')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : conversations.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('contactColumn')}</TableHead>
              <TableHead>{t('agentColumn')}</TableHead>
              <TableHead>{t('idleColumn')}</TableHead>
              <TableHead>{t('lastMessageColumn')}</TableHead>
              <TableHead>{t('windowColumn')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversations.map((c) => {
              const windowOpen = isSessionWindowOpen(c.last_customer_message_at, now);
              return (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/inbox?c=${c.id}`)}
                >
                  <TableCell className="font-medium">{c.contact_name || c.contact_phone}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.agent_name || memberName(c.assigned_agent_id) || t('noAgent')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.group === 'awaiting_us' ? 'destructive' : 'secondary'}>
                      {idleLabel(c.last_message_at, now)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(c.last_message_at).toLocaleString('pt-BR')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={windowOpen ? 'secondary' : 'outline'}>
                      {windowOpen ? t('windowOpen') : t('windowClosed')}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {hasMore && !loading ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="size-4 animate-spin" /> : t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
