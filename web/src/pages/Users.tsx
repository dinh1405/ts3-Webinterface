import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Copy, KeyRound, Link2, Pencil, Plus, RotateCcw, Save, Shield, Trash2, UserCog } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { CapabilityGroup, Invite, Role, User } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate, formatRelative } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, Modal, PageHeader, Toggle } from '../components/ui';

const ROLES: Role[] = ['admin', 'operator', 'viewer'];
const ROLE_TONE: Record<Role, 'red' | 'indigo' | 'slate'> = { admin: 'red', operator: 'indigo', viewer: 'slate' };
const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };
/** Rollen, die ein Benutzer vergeben darf: nur bis zur eigenen. */
const assignableRoles = (own?: Role) => ROLES.filter((r) => ROLE_RANK[r] <= ROLE_RANK[own || 'viewer']);
const canManage = (own?: Role, target?: Role) => ROLE_RANK[target || 'admin'] <= ROLE_RANK[own || 'viewer'];

export default function UsersPage() {
  const { user: me } = useAuth();
  const { t } = useT();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/api/users') });
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<User | null>(null);
  const [pw, setPw] = useState<User | null>(null);
  const [del, setDel] = useState<User | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['users'] });

  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/api/users/${id}`), onSuccess: () => { toast.success(t('users.deleted')); setDel(null); inv(); }, onError: (e) => toast.error(errorMessage(e)) });

  return (
    <div>
      <PageHeader title={t('users.title')} description={t('users.description')} actions={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>{t('users.create')}</Button>} />
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r} className="card p-4"><Badge tone={ROLE_TONE[r]}>{t(`role.${r}`)}</Badge><p className="mt-2 text-xs text-slate-400">{t(`users.roleDesc.${r}`)}</p></div>
        ))}
      </div>
      {users.isLoading && <FullPageSpinner />}
      {users.error && <ErrorBox error={users.error} onRetry={() => users.refetch()} />}
      {users.data && (
        <Card noPadding>
          {users.data.users.length === 0 ? <EmptyState icon={UserCog} title={t('users.none')} /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>{t('common.user')}</th><th>{t('account.role')}</th><th>{t('common.status')}</th><th>{t('account.lastLogin')}</th><th>{t('bans.th.created')}</th><th className="text-right">{t('common.actions')}</th></tr></thead>
                <tbody>
                  {users.data.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <p className="font-medium text-slate-100">{u.displayName || u.username} {u.id === me?.id && <span className="text-xs text-slate-500">{t('users.you')}</span>}</p>
                        {u.displayName && <p className="text-xs text-slate-500">@{u.username}</p>}
                      </td>
                      <td><Badge tone={ROLE_TONE[u.role]}>{t(`role.${u.role}`)}</Badge></td>
                      <td><Badge tone={u.active ? 'green' : 'slate'} dot>{u.active ? t('users.active') : t('users.disabled')}</Badge></td>
                      <td>{u.lastLoginAt ? <span title={formatDate(u.lastLoginAt, true)}>{formatRelative(u.lastLoginAt)}</span> : t('users.never')}</td>
                      <td>{formatDate(u.createdAt)}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {canManage(me?.role, u.role) ? <>
                            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(u)}>{t('users.edit')}</Button>
                            <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => setPw(u)}>{t('auth.password')}</Button>
                            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(u)} disabled={u.id === me?.id} />
                          </> : <span className="text-xs text-slate-500">{t('users.higherRole')}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <RolesCard />
      <InvitesCard />
      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditUserModal user={edit} onClose={() => setEdit(null)} isSelf={edit?.id === me?.id} />
      <PasswordModal user={pw} onClose={() => setPw(null)} />
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending} title={t('users.deleteConfirm')} message={t('users.deleteMsg', { username: del?.username ?? '' })} confirmLabel={t('common.delete')} />
    </div>
  );
}

interface RolesResponse { groups: CapabilityGroup[]; roles: Record<Role, string[]>; defaults: Record<Role, string[]>; canEdit: boolean }

/** Rechte je Rolle bearbeiten (Administrator hat immer alle Rechte). */
function RolesCard() {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RolesResponse>('/api/users/roles') });
  const [form, setForm] = useState<{ operator: Set<string>; viewer: Set<string> } | null>(null);
  const current = form ?? (q.data ? { operator: new Set(q.data.roles.operator), viewer: new Set(q.data.roles.viewer) } : null);
  const save = useMutation({
    mutationFn: () => api.put('/api/users/roles', { operator: [...current!.operator], viewer: [...current!.viewer] }),
    onSuccess: () => { toast.success(t('users.rolesSaved')); setForm(null); qc.invalidateQueries({ queryKey: ['roles'] }); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.post('/api/users/roles/reset'),
    onSuccess: () => { toast.success(t('users.rolesReset')); setForm(null); qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading || !current) return <Card className="mt-4" title={t('users.rolesTitle')}><FullPageSpinner /></Card>;
  if (q.error) return <Card className="mt-4" title={t('users.rolesTitle')}><ErrorBox error={q.error} onRetry={() => q.refetch()} /></Card>;
  const ro = !q.data!.canEdit;
  const toggle = (role: 'operator' | 'viewer', cap: string) => {
    const next = { operator: new Set(current.operator), viewer: new Set(current.viewer) };
    if (next[role].has(cap)) next[role].delete(cap); else next[role].add(cap);
    setForm(next);
  };
  const dirty = form !== null && (JSON.stringify([...form.operator].sort()) !== JSON.stringify([...q.data!.roles.operator].sort()) || JSON.stringify([...form.viewer].sort()) !== JSON.stringify([...q.data!.roles.viewer].sort()));
  return (
    <Card className="mt-4" title={<span className="flex items-center gap-2"><Shield className="h-4 w-4 text-indigo-400" /> {t('users.rolesTitle')}</span>}
      subtitle={ro ? t('users.rolesReadOnly') : t('users.rolesSubtitle')}
      actions={!ro && <>
        <Button size="sm" variant="ghost" icon={RotateCcw} loading={reset.isPending} onClick={() => reset.mutate()}>{t('users.defaults')}</Button>
        <Button size="sm" variant="primary" icon={Save} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('common.save')}</Button>
      </>} noPadding>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>{t('users.right')}</th><th className="w-36 text-center">{t('role.admin')}</th><th className="w-36 text-center">{t('role.operator')}</th><th className="w-36 text-center">{t('role.viewer')}</th></tr></thead>
          <tbody>
            {q.data!.groups.map((g) => (
              <RoleGroupRows key={g.key} group={g} current={current} ro={ro} toggle={toggle} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RoleGroupRows({ group, current, ro, toggle }: { group: CapabilityGroup; current: { operator: Set<string>; viewer: Set<string> }; ro: boolean; toggle: (role: 'operator' | 'viewer', cap: string) => void }) {
  const { t } = useT();
  return (
    <>
      <tr className="bg-slate-900/60"><td colSpan={4} className="text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</td></tr>
      {group.caps.map((c) => (
        <tr key={c.key}>
          <td><span className="text-slate-100">{c.label}</span>{c.danger && <Badge tone="amber" className="ml-2">{t('users.critical')}</Badge>}<p className="font-mono text-[10px] text-slate-500">{c.key}</p></td>
          <td className="text-center"><input type="checkbox" className="h-4 w-4" checked disabled /></td>
          <td className="text-center"><input type="checkbox" className="h-4 w-4" checked={current.operator.has(c.key)} disabled={ro} onChange={() => toggle('operator', c.key)} /></td>
          <td className="text-center"><input type="checkbox" className="h-4 w-4" checked={current.viewer.has(c.key)} disabled={ro} onChange={() => toggle('viewer', c.key)} /></td>
        </tr>
      ))}
    </>
  );
}

const INVITE_TONE: Record<Invite['status'], 'green' | 'slate' | 'amber' | 'red'> = { active: 'green', used: 'slate', expired: 'amber', revoked: 'red' };

function InvitesCard() {
  const { user: me } = useAuth();
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invites'], queryFn: () => api.get<{ invites: Invite[] }>('/api/invites') });
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>('viewer');
  const [expiresInHours, setExpires] = useState(24);
  const [maxUses, setMaxUses] = useState(1);
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [del, setDel] = useState<Invite | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['invites'] });
  const create = useMutation({
    mutationFn: () => api.post<{ link: string }>('/api/invites', { role, expiresInHours, maxUses, note }),
    onSuccess: (r) => { setLink(r.link); inv(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (i: Invite) => api.post(`/api/invites/${i.id}/revoke`), onSuccess: () => { toast.success(t('users.inviteRevoked')); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (i: Invite) => api.delete(`/api/invites/${i.id}`), onSuccess: () => { toast.success(t('users.inviteDeleted')); setDel(null); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t('users.linkCopied')); } catch { toast.error(t('users.copyFailed')); } };
  const close = () => { setOpen(false); setLink(null); setNote(''); };
  return (
    <Card className="mt-4" title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4 text-indigo-400" /> {t('users.invites')}</span>} subtitle={t('users.invitesSubtitle')}
      actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setOpen(true)}>{t('users.createInvite')}</Button>} noPadding>
      {q.error && <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} compact /></div>}
      {q.data && (q.data.invites.length === 0 ? <EmptyState icon={Link2} title={t('users.noInvites')} /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>{t('users.note')}</th><th>{t('account.role')}</th><th>{t('common.status')}</th><th>{t('users.used')}</th><th>{t('users.validUntil')}</th><th>{t('bans.th.created')}</th><th className="text-right"></th></tr></thead>
            <tbody>
              {q.data.invites.map((i) => (
                <tr key={i.id}>
                  <td><p className="text-slate-100">{i.note || <span className="text-slate-500">–</span>}</p><p className="font-mono text-[11px] text-slate-500">…{i.tokenPreview}</p></td>
                  <td><Badge tone={ROLE_TONE[i.role]}>{t(`role.${i.role}`)}</Badge></td>
                  <td><Badge tone={INVITE_TONE[i.status]} dot>{t(`users.inviteStatus.${i.status}`)}</Badge></td>
                  <td>{i.uses} / {i.maxUses || '∞'}{i.usedBy.length > 0 && <p className="text-[11px] text-slate-500">{i.usedBy.map((u) => u.username).join(', ')}</p>}</td>
                  <td className="text-xs">{i.expiresAt ? <span title={formatDate(i.expiresAt, true)}>{formatRelative(i.expiresAt)}</span> : t('users.unlimited')}</td>
                  <td className="text-xs">{formatDate(i.createdAt)}<p className="text-slate-500">{i.createdBy}</p></td>
                  <td><div className="flex justify-end gap-1">
                    {i.status === 'active' && <Button size="sm" variant="ghost" icon={Ban} title={t('users.revoke')} onClick={() => revoke.mutate(i)} />}
                    <Button size="sm" variant="ghost" icon={Trash2} title={t('common.delete')} onClick={() => setDel(i)} />
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <Modal open={open} onClose={close} title={t('users.createInvite')} size="sm"
        footer={link ? <Button variant="primary" onClick={close}>{t('users.done')}</Button> : <><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button><Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>{t('users.createLink')}</Button></>}>
        {link ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">{t('users.linkOnce')}</p>
            <div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={link} onFocus={(e) => e.target.select()} /><Button icon={Copy} onClick={() => copy(link)}>{t('users.copy')}</Button></div>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label={t('users.newUserRole')} hint={t('users.roleRankHint')}><select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>{assignableRoles(me?.role).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('users.validFor')}><select className="input" value={expiresInHours} onChange={(e) => setExpires(Number(e.target.value))}><option value={1}>{t('duration.1h')}</option><option value={24}>{t('users.24h')}</option><option value={168}>{t('users.7d')}</option><option value={720}>{t('duration.30d')}</option><option value={0}>{t('users.unlimited')}</option></select></Field>
              <Field label={t('users.maxUses')} hint={t('users.maxUsesHint')}><input className="input" type="number" min={0} max={1000} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} /></Field>
            </div>
            <Field label={t('users.noteOptional')} hint={t('users.noteHint')}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder={t('users.notePlaceholder')} /></Field>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} title={t('users.deleteInvite')} message={t('users.deleteInviteMsg')} confirmLabel={t('common.delete')} />
    </Card>
  );
}

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const create = useMutation({
    mutationFn: () => api.post('/api/users', { username, displayName, password, role }),
    onSuccess: () => { toast.success(t('users.created')); qc.invalidateQueries({ queryKey: ['users'] }); setUsername(''); setDisplayName(''); setPassword(''); setRole('viewer'); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('users.create')} size="sm" footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={create.isPending} onClick={() => create.mutate()} disabled={!username || password.length < 8}>{t('files.create')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('auth.username')} hint={t('auth.usernameHint')}><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></Field>
        <Field label={t('auth.displayNameOptional')}><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}><input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <RoleSelect value={role} onChange={setRole} />
      </div>
    </Modal>
  );
}

function RoleSelect({ value, onChange, disabled }: { value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  const { user: me } = useAuth();
  const { t } = useT();
  return (
    <Field label={t('account.role')} hint={t(`users.roleDesc.${value}`)}>
      <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Role)}>
        {assignableRoles(me?.role).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
      </select>
    </Field>
  );
}

function EditUserModal({ user, onClose, isSelf }: { user: User | null; onClose: () => void; isSelf: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>('viewer');
  const [displayName, setDisplayName] = useState('');
  const [active, setActive] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (user && loadedFor !== user.id) { setRole(user.role); setDisplayName(user.displayName); setActive(user.active); setLoadedFor(user.id); }
  const save = useMutation({
    mutationFn: () => api.patch(`/api/users/${user!.id}`, { role, displayName, active }),
    onSuccess: () => { toast.success(t('users.saved')); qc.invalidateQueries({ queryKey: ['users'] }); setLoadedFor(null); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={Boolean(user)} onClose={() => { setLoadedFor(null); onClose(); }} title={t('users.editTitle', { username: user?.username ?? '' })} size="sm" footer={<><Button variant="ghost" onClick={() => { setLoadedFor(null); onClose(); }}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('account.displayName')}><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <RoleSelect value={role} onChange={setRole} disabled={isSelf} />
        <Toggle checked={active} onChange={setActive} disabled={isSelf} label={t('users.accountActive')} description={t('users.accountActiveHint')} />
        {isSelf && <p className="text-xs text-slate-500">{t('users.selfNote')}</p>}
      </div>
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = useT();
  const [password, setPassword] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/api/users/${user!.id}/password`, { password }),
    onSuccess: () => { toast.success(t('users.passwordReset')); setPassword(''); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={Boolean(user)} onClose={onClose} title={t('users.setPasswordTitle', { username: user?.username ?? '' })} size="sm" footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={password.length < 8} onClick={() => save.mutate()}>{t('users.setPassword')}</Button></>}>
      <Field label={t('account.newPassword')} hint={t('users.setPasswordHint')}><input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}
