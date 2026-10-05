'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Building2, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import type { AccountMember, Department } from '@/types';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

interface DepartmentRow extends Department {
  memberCount: number;
}

/**
 * Settings → Atendimento → Departamentos (migration 069). Admin-only
 * writes — `departments`/`department_members` RLS already enforces
 * that server-side, `canEditSettings` here only hides the controls.
 */
export function DepartmentsSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations('settings.attendance.departments');
  const tCommon = useTranslations('common');

  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [membersDialogFor, setMembersDialogFor] = useState<Department | null>(null);
  const [accountMembers, setAccountMembers] = useState<AccountMember[]>([]);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [membersLoading, setMembersLoading] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const fetchDepartments = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data: depts } = await supabase
      .from('departments')
      .select('*')
      .order('created_at');
    const list = (depts as Department[] | null) ?? [];

    const { data: members } = await supabase
      .from('department_members')
      .select('department_id')
      .in('department_id', list.map((d) => d.id));
    const counts = new Map<string, number>();
    for (const m of (members as { department_id: string }[] | null) ?? []) {
      counts.set(m.department_id, (counts.get(m.department_id) ?? 0) + 1);
    }

    setDepartments(list.map((d) => ({ ...d, memberCount: counts.get(d.id) ?? 0 })));
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchDepartments();
    }
  }, [accountId, fetchDepartments]);

  function openCreate() {
    setEditing(null);
    setName('');
    setIsActive(true);
    setDialogOpen(true);
  }

  function openEdit(dept: Department) {
    setEditing(dept);
    setName(dept.name);
    setIsActive(dept.is_active);
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || !accountId) return;
    setSaving(true);

    const { error } = editing
      ? await supabase
          .from('departments')
          .update({ name: trimmed, is_active: isActive })
          .eq('id', editing.id)
      : await supabase
          .from('departments')
          .insert({ account_id: accountId, name: trimmed, is_active: isActive });

    setSaving(false);
    if (error) {
      toast.error(editing ? t('saveFailed') : t('createFailed'));
      return;
    }
    toast.success(editing ? t('saved') : t('created'));
    setDialogOpen(false);
    await fetchDepartments();
  }

  async function handleDelete(dept: Department) {
    if (!window.confirm(t('deleteConfirm', { name: dept.name }))) return;
    setBusyId(dept.id);
    const { error } = await supabase.from('departments').delete().eq('id', dept.id);
    setBusyId(null);
    if (error) {
      toast.error(t('deleteFailed'));
      return;
    }
    toast.success(t('deleted'));
    setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
  }

  async function openMembers(dept: Department) {
    setMembersDialogFor(dept);
    setMembersLoading(true);
    const [membersRes, deptMembersRes] = await Promise.all([
      fetch('/api/account/members', { cache: 'no-store' }).then((r) => r.json()),
      supabase.from('department_members').select('user_id').eq('department_id', dept.id),
    ]);
    setAccountMembers((membersRes?.members as AccountMember[] | undefined) ?? []);
    setMemberIds(
      new Set(((deptMembersRes.data as { user_id: string }[] | null) ?? []).map((m) => m.user_id)),
    );
    setMembersLoading(false);
  }

  async function toggleMember(userId: string, checked: boolean) {
    if (!membersDialogFor) return;
    setBusyMemberId(userId);
    const { error } = checked
      ? await supabase
          .from('department_members')
          .insert({ department_id: membersDialogFor.id, user_id: userId })
      : await supabase
          .from('department_members')
          .delete()
          .eq('department_id', membersDialogFor.id)
          .eq('user_id', userId);
    setBusyMemberId(null);
    if (error) {
      toast.error(t('memberToggleFailed'));
      return;
    }
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
    setDepartments((prev) =>
      prev.map((d) =>
        d.id === membersDialogFor.id
          ? { ...d, memberCount: d.memberCount + (checked ? 1 : -1) }
          : d,
      ),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Building2 className="size-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && (
          <div className="flex justify-end">
            <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="size-4" />
              {t('newDepartment')}
            </Button>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">{t('nameColumn')}</TableHead>
                <TableHead className="text-muted-foreground">{t('membersColumn')}</TableHead>
                <TableHead className="text-muted-foreground">{t('statusColumn')}</TableHead>
                <TableHead className="w-24 text-muted-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : departments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                departments.map((dept) => (
                  <TableRow key={dept.id} className="group border-border">
                    <TableCell className="text-sm font-medium text-foreground">{dept.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => openMembers(dept)}
                        className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline"
                      >
                        <Users className="size-3.5" />
                        {t('memberCount', { count: dept.memberCount })}
                      </button>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {dept.is_active ? t('active') : t('inactive')}
                    </TableCell>
                    <TableCell>
                      {canEdit && (
                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => openEdit(dept)}
                            aria-label={t('editAria', { name: dept.name })}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(dept)}
                            disabled={busyId === dept.id}
                            aria-label={t('deleteAria', { name: dept.name })}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                          >
                            {busyId === dept.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {!canEdit && <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p>}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? t('editTitle') : t('newTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('nameColumn')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                className="border-border bg-muted text-foreground"
              />
            </div>
            {editing && (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Switch checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
                {t('active')}
              </label>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : editing ? tCommon('save') : tCommon('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={membersDialogFor != null} onOpenChange={(open) => !open && setMembersDialogFor(null)}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('membersTitle', { name: membersDialogFor?.name ?? '' })}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('membersDescription')}
            </DialogDescription>
          </DialogHeader>
          {membersLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {accountMembers.map((member) => (
                <label
                  key={member.user_id}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
                >
                  <Checkbox
                    checked={memberIds.has(member.user_id)}
                    disabled={!canEdit || busyMemberId === member.user_id}
                    onCheckedChange={(checked) => toggleMember(member.user_id, checked === true)}
                  />
                  {member.full_name || member.email}
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setMembersDialogFor(null)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {tCommon('done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
