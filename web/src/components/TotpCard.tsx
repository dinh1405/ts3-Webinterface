import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { Copy, Download, ShieldCheck, ShieldOff, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { TotpStatus } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, Field, FullPageSpinner, Modal, Alert } from './ui';

type Dialog = null | 'setup-password' | 'setup-scan' | 'recovery' | 'disable' | 'new-codes';

/** Mein Konto → Zwei-Faktor-Authentifizierung (TOTP): einrichten, Wiederherstellungscodes, deaktivieren. */
export function TotpCard() {
  const { t } = useT();
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'totp'], queryFn: () => api.get<TotpStatus>('/api/auth/totp') });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (!setup) { setQr(null); return; }
    QRCode.toDataURL(setup.otpauth, { width: 220, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }).then(setQr).catch(() => setQr(null));
  }, [setup]);

  const close = () => { setDialog(null); setPassword(''); setCode(''); };
  const done = () => { close(); setSetup(null); setCodes(null); qc.invalidateQueries({ queryKey: ['me', 'totp'] }); refresh(); };

  const start = useMutation({
    mutationFn: () => api.post<{ secret: string; otpauth: string }>('/api/auth/totp/setup', { password }),
    onSuccess: (d) => { setSetup(d); setPassword(''); setDialog('setup-scan'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/api/auth/totp/enable', { code }),
    onSuccess: (d) => { setCodes(d.recoveryCodes); setCode(''); setDialog('recovery'); toast.success(t('account.totp.enabledToast')); qc.invalidateQueries({ queryKey: ['me', 'totp'] }); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disable = useMutation({
    mutationFn: () => api.post('/api/auth/totp/disable', { password, code }),
    onSuccess: () => { toast.success(t('account.totp.disabledToast')); done(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const regen = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/api/auth/totp/recovery-codes', { password, code }),
    onSuccess: (d) => { setCodes(d.recoveryCodes); setPassword(''); setCode(''); setDialog('recovery'); qc.invalidateQueries({ queryKey: ['me', 'totp'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const copyCodes = async () => {
    try { await navigator.clipboard.writeText((codes ?? []).join('\n')); toast.success(t('account.totp.copied')); } catch { toast.error(t('common.error')); }
  };
  const downloadCodes = () => {
    const blob = new Blob([`${t('account.totp.recoveryTitle')} – ${t('layout.appName')}\n\n${(codes ?? []).join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ts3-webinterface-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (q.isLoading || !q.data) return <Card title={t('account.totp.title')}><FullPageSpinner /></Card>;
  const s = q.data;
  const low = s.enabled && s.recoveryCodesLeft <= 3;

  return (
    <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-indigo-400" /> {t('account.totp.title')}</span>}>
      <p className="text-sm text-slate-400">{t('account.totp.intro')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {s.enabled ? <Badge tone="success" dot>{t('account.totp.enabled', { date: formatDate(s.enabledAt) })}</Badge> : <Badge tone="neutral">{t('account.totp.disabled')}</Badge>}
        {s.enabled && <span className={low ? 'text-xs text-amber-300' : 'text-xs text-slate-500'}>{t('account.totp.codesLeft', { count: s.recoveryCodesLeft })}{low && ` – ${t('account.totp.codesLow')}`}</span>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {!s.enabled && <Button variant="primary" icon={ShieldCheck} onClick={() => setDialog('setup-password')}>{t('account.totp.setup')}</Button>}
        {s.enabled && <Button icon={RefreshCw} onClick={() => setDialog('new-codes')}>{t('account.totp.newCodes')}</Button>}
        {s.enabled && <Button variant="danger" icon={ShieldOff} onClick={() => setDialog('disable')}>{t('account.totp.disable')}</Button>}
      </div>

      {/* Schritt 1: Passwort bestätigen */}
      <Modal open={dialog === 'setup-password'} onClose={close} title={t('account.totp.setup')} size="sm"
        footer={<><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button><Button variant="primary" loading={start.isPending} disabled={!password} onClick={() => start.mutate()}>{t('common.next')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (password) start.mutate(); }} className="space-y-3">
          <p className="text-sm text-slate-400">{t('account.totp.confirmPassword')}</p>
          <Field label={t('account.currentPassword')}><input className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </form>
      </Modal>

      {/* Schritt 2: QR scannen und Code bestätigen */}
      <Modal open={dialog === 'setup-scan'} onClose={() => { close(); setSetup(null); }} title={t('account.totp.setup')} size="md"
        footer={<><Button variant="ghost" onClick={() => { close(); setSetup(null); }}>{t('common.cancel')}</Button><Button variant="primary" loading={enable.isPending} disabled={code.replace(/\s/g, '').length !== 6} onClick={() => enable.mutate()}>{t('account.totp.activate')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (code.replace(/\s/g, '').length === 6) enable.mutate(); }} className="space-y-4">
          <p className="text-sm text-slate-400">{t('account.totp.scan')}</p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {qr ? <img src={qr} alt="QR" width={220} height={220} className="rounded-lg bg-white p-2" /> : <div className="h-[220px] w-[220px] animate-pulse rounded-lg bg-slate-800" />}
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <p className="label">{t('account.totp.secret')}</p>
              <code className="block break-all rounded-lg border border-slate-800 bg-slate-950/60 p-2 font-mono text-xs tracking-wider text-slate-200">{setup?.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              <p className="text-xs text-slate-500">{t('account.totp.enterCode')}</p>
            </div>
          </div>
          <Field label={t('account.totp.code')}><input className="input font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        </form>
      </Modal>

      {/* Wiederherstellungscodes (nach Aktivierung oder Neuerzeugung) */}
      <Modal open={dialog === 'recovery'} onClose={done} title={t('account.totp.recoveryTitle')} size="sm"
        footer={<Button variant="primary" onClick={done}>{t('account.totp.done')}</Button>}>
        <Alert tone="warning" compact>{t('account.totp.recoveryIntro')}</Alert>
        <ul className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-sm text-slate-100">
          {(codes ?? []).map((c) => <li key={c}>{c}</li>)}
        </ul>
        <div className="mt-3 flex gap-2">
          <Button size="sm" icon={Copy} onClick={copyCodes}>{t('account.totp.copy')}</Button>
          <Button size="sm" icon={Download} onClick={downloadCodes}>{t('account.totp.download')}</Button>
        </div>
      </Modal>

      {/* Deaktivieren / neue Codes: Passwort + Code */}
      <Modal open={dialog === 'disable' || dialog === 'new-codes'} onClose={close} title={dialog === 'disable' ? t('account.totp.disable') : t('account.totp.newCodes')} size="sm"
        footer={<><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button><Button variant={dialog === 'disable' ? 'danger' : 'primary'} loading={disable.isPending || regen.isPending} disabled={!password || !code} onClick={() => (dialog === 'disable' ? disable.mutate() : regen.mutate())}>{dialog === 'disable' ? t('account.totp.disable') : t('account.totp.newCodes')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (!password || !code) return; if (dialog === 'disable') disable.mutate(); else regen.mutate(); }} className="space-y-3">
          <p className="text-sm text-slate-400">{dialog === 'disable' ? t('account.totp.disableIntro') : t('account.totp.newCodesIntro')}</p>
          <Field label={t('account.currentPassword')}><input className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label={t('account.totp.codeOrRecovery')}><input className="input font-mono" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        </form>
      </Modal>
    </Card>
  );
}
