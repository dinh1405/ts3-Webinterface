import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Fingerprint, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { PasskeyInfo } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate, formatRelative } from '../lib/format';
import { isUserCancel, passkeysSupported, registerPasskey } from '../lib/webauthn';
import { useT } from '../i18n';
import { Badge, Button, Card, Field, FullPageSpinner, Modal } from './ui';

interface PasskeyList { passkeys: PasskeyInfo[]; available: boolean; reason: 'insecure' | 'ipHost' | null; rpId: string }
const KEY = ['me', 'passkeys'];

/** Mein Konto → Passkeys: registrieren (Windows Hello, Touch ID, Sicherheitsschlüssel, Handy), umbenennen, entfernen. */
export function PasskeyCard() {
  const { t } = useT();
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<PasskeyList>('/api/auth/passkeys') });
  const [add, setAdd] = useState(false);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [rename, setRename] = useState<PasskeyInfo | null>(null);
  const [remove, setRemove] = useState<PasskeyInfo | null>(null);
  const supported = passkeysSupported();

  const done = () => { qc.invalidateQueries({ queryKey: KEY }); refresh(); };
  const register = useMutation({
    mutationFn: () => registerPasskey(password, name),
    onSuccess: () => { toast.success(t('account.passkey.added')); setAdd(false); setPassword(''); setName(''); done(); },
    onError: (e) => { if (!isUserCancel(e)) toast.error(errorMessage(e)); },
  });
  const renameMut = useMutation({
    mutationFn: (p: PasskeyInfo) => api.patch(`/api/auth/passkeys/${encodeURIComponent(p.id)}`, { name }),
    onSuccess: () => { setRename(null); setName(''); done(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeMut = useMutation({
    mutationFn: (p: PasskeyInfo) => api.post(`/api/auth/passkeys/${encodeURIComponent(p.id)}/delete`, { password }),
    onSuccess: () => { toast.success(t('account.passkey.removed')); setRemove(null); setPassword(''); done(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading || !q.data) return <Card title={t('account.passkey.title')}><FullPageSpinner /></Card>;
  const d = q.data;
  const blocked = !d.available ? t(d.reason === 'ipHost' ? 'account.passkey.ipHost' : 'account.passkey.insecure') : !supported ? t('account.passkey.unsupported') : null;

  return (
    <Card title={<span className="flex items-center gap-2"><Fingerprint className="h-4 w-4 text-indigo-400" /> {t('account.passkey.title')}</span>}
      actions={d.available && supported && <Button size="sm" variant="primary" icon={Plus} onClick={() => { setName(''); setPassword(''); setAdd(true); }}>{t('account.passkey.add')}</Button>}>
      <p className="text-sm text-slate-400">{t('account.passkey.intro')}</p>
      {blocked && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{blocked}</p>}
      {d.passkeys.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{t('account.passkey.none')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-800/70">
          {d.passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-slate-100">{p.name}{p.backedUp && <Badge tone="slate">{t('account.passkey.synced')}</Badge>}</p>
                <p className="text-xs text-slate-500">{t('account.passkey.created', { date: formatDate(p.createdAt) })} · {p.lastUsedAt ? t('account.passkey.lastUsed', { when: formatRelative(p.lastUsedAt) }) : t('account.passkey.neverUsed')}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={Pencil} title={t('common.rename')} onClick={() => { setName(p.name); setRename(p); }} />
                <Button size="sm" variant="ghost" icon={Trash2} title={t('common.delete')} onClick={() => { setPassword(''); setRemove(p); }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-slate-500">{t('account.passkey.hint')}</p>

      <Modal open={add} onClose={() => setAdd(false)} title={t('account.passkey.add')} size="sm"
        footer={<><Button variant="ghost" onClick={() => setAdd(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={register.isPending} disabled={!password} onClick={() => register.mutate()}>{t('account.passkey.create')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (password) register.mutate(); }} className="space-y-3">
          <p className="text-sm text-slate-400">{t('account.passkey.addIntro')}</p>
          <Field label={t('account.passkey.name')} hint={t('account.passkey.nameHint')}><input className="input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('account.passkey.namePlaceholder')} /></Field>
          <Field label={t('account.currentPassword')}><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </form>
      </Modal>

      <Modal open={Boolean(rename)} onClose={() => setRename(null)} title={t('common.rename')} size="sm"
        footer={<><Button variant="ghost" onClick={() => setRename(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={renameMut.isPending} disabled={!name.trim()} onClick={() => rename && renameMut.mutate(rename)}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (rename && name.trim()) renameMut.mutate(rename); }}>
          <Field label={t('account.passkey.name')}><input className="input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </form>
      </Modal>

      <Modal open={Boolean(remove)} onClose={() => setRemove(null)} title={t('account.passkey.removeTitle', { name: remove?.name ?? '' })} size="sm"
        footer={<><Button variant="ghost" onClick={() => setRemove(null)}>{t('common.cancel')}</Button><Button variant="danger" loading={removeMut.isPending} disabled={!password} onClick={() => remove && removeMut.mutate(remove)}>{t('common.delete')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (remove && password) removeMut.mutate(remove); }} className="space-y-3">
          <p className="text-sm text-slate-400">{t('account.passkey.removeIntro')}</p>
          <Field label={t('account.currentPassword')}><input className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </form>
      </Modal>
    </Card>
  );
}
