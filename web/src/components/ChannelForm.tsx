import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '../api/client';
import { t as tt, useT } from '../i18n';
import { Button, ErrorBox, Field, Modal, Spinner, Toggle } from './ui';

type Value = string | number | boolean;
type Info = Record<string, Value>;

/** Codec-Liste (sprachabhängig, daher Funktion). */
export const codecOptions = () => [
  { value: 0, label: 'Speex Narrowband (8 kHz)' },
  { value: 1, label: 'Speex Wideband (16 kHz)' },
  { value: 2, label: 'Speex Ultra-Wideband (32 kHz)' },
  { value: 3, label: 'CELT Mono (48 kHz)' },
  { value: 4, label: `Opus Voice (${tt('channel.recommended')})` },
  { value: 5, label: 'Opus Music' },
];
/** @deprecated nur für bestehende Importe */
export const CODECS = codecOptions();

const EDIT_KEYS = ['channelName', 'channelTopic', 'channelDescription', 'channelCodec', 'channelCodecQuality', 'channelMaxclients', 'channelMaxfamilyclients', 'channelFlagPermanent', 'channelFlagSemiPermanent', 'channelFlagDefault', 'channelFlagMaxclientsUnlimited', 'channelFlagMaxfamilyclientsUnlimited', 'channelFlagMaxfamilyclientsInherited', 'channelNeededTalkPower', 'channelNamePhonetic', 'channelCodecIsUnencrypted', 'channelIconId', 'channelBannerGfxUrl', 'channelBannerMode', 'channelDeleteDelay'];

const DEFAULTS: Info = {
  channelName: '', channelTopic: '', channelDescription: '', channelCodec: 4, channelCodecQuality: 6, channelMaxclients: -1, channelMaxfamilyclients: -1,
  channelFlagPermanent: 1, channelFlagSemiPermanent: 0, channelFlagDefault: 0, channelFlagMaxclientsUnlimited: 1, channelFlagMaxfamilyclientsUnlimited: 0, channelFlagMaxfamilyclientsInherited: 1,
  channelNeededTalkPower: 0, channelNamePhonetic: '', channelCodecIsUnencrypted: 1, channelIconId: 0, channelBannerGfxUrl: '', channelBannerMode: 0, channelDeleteDelay: 0,
};

const truthy = (v: Value | undefined) => v === true || v === 1 || v === '1';

/**
 * Kanal anlegen (mode=create, parentCid) oder bearbeiten (mode=edit, cid).
 */
export function ChannelFormModal({ open, onClose, mode, cid, parentCid, parentName }: { open: boolean; onClose: () => void; mode: 'create' | 'edit'; cid?: string; parentCid?: string; parentName?: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['channel', cid], queryFn: () => api.get<{ info: Info }>(`/api/channels/${cid}`), enabled: open && mode === 'edit' && Boolean(cid) });
  const [form, setForm] = useState<Info>(DEFAULTS);
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [type, setType] = useState<'permanent' | 'semi' | 'temporary'>('permanent');

  useEffect(() => {
    if (!open) return;
    if (mode === 'create') { setForm(DEFAULTS); setType('permanent'); setPassword(''); setRemovePassword(false); return; }
    if (info.data) {
      const next: Info = { ...DEFAULTS };
      for (const k of EDIT_KEYS) if (info.data.info[k] !== undefined) next[k] = info.data.info[k];
      setForm(next);
      setType(truthy(next.channelFlagPermanent) ? 'permanent' : truthy(next.channelFlagSemiPermanent) ? 'semi' : 'temporary');
      setPassword(''); setRemovePassword(false);
    }
  }, [open, mode, info.data]);

  const original = useMemo(() => {
    if (mode !== 'edit' || !info.data) return null;
    const o: Info = {};
    for (const k of EDIT_KEYS) if (info.data.info[k] !== undefined) o[k] = info.data.info[k];
    return o;
  }, [mode, info.data]);

  const set = (k: string, v: Value) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const payload: Info = { ...form };
      payload.channelFlagPermanent = type === 'permanent' ? 1 : 0;
      payload.channelFlagSemiPermanent = type === 'semi' ? 1 : 0;
      if (mode === 'create') {
        if (type === 'temporary') payload.channelFlagTemporary = 1;
        if (password) payload.channelPassword = password;
        if (parentCid && parentCid !== '0') payload.cpid = parentCid;
        return api.post<{ cid: string }>('/api/channels', payload);
      }
      const diff: Info = {};
      for (const [k, v] of Object.entries(payload)) if (!original || String(original[k] ?? '') !== String(v)) diff[k] = v;
      if (removePassword) diff.channelPassword = '';
      else if (password) diff.channelPassword = password;
      if (!Object.keys(diff).length) return Promise.resolve({ cid: cid! });
      return api.put<{ cid: string }>(`/api/channels/${cid}`, diff);
    },
    onSuccess: () => { toast.success(mode === 'create' ? t('channel.created') : t('channel.saved')); qc.invalidateQueries({ queryKey: ['clients'] }); qc.invalidateQueries({ queryKey: ['channel', cid] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const maxUnlimited = truthy(form.channelFlagMaxclientsUnlimited);
  const famInherited = truthy(form.channelFlagMaxfamilyclientsInherited);
  const famUnlimited = truthy(form.channelFlagMaxfamilyclientsUnlimited);

  return (
    <Modal open={open} onClose={onClose} title={mode === 'create' ? (parentName ? t('channel.createUnder', { parent: parentName }) : t('channel.create')) : t('channel.edit', { name: String(form.channelName || '') })} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!String(form.channelName || '').trim()} onClick={() => save.mutate()}>{mode === 'create' ? t('files.create') : t('common.save')}</Button></>}>
      {mode === 'edit' && info.isLoading && <div className="py-6 text-center"><Spinner className="mx-auto" /></div>}
      {info.error && <ErrorBox error={info.error} onRetry={() => info.refetch()} compact />}
      {(mode === 'create' || info.data) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={t('common.name')} className="md:col-span-2"><input className="input" value={String(form.channelName)} onChange={(e) => set('channelName', e.target.value)} autoFocus maxLength={40} /></Field>
          <Field label={t('channel.topic')}><input className="input" value={String(form.channelTopic)} onChange={(e) => set('channelTopic', e.target.value)} maxLength={255} /></Field>
          <Field label={t('channel.phonetic')}><input className="input" value={String(form.channelNamePhonetic)} onChange={(e) => set('channelNamePhonetic', e.target.value)} /></Field>
          <Field label={t('channel.description')} className="md:col-span-2" hint={t('channel.bbcode')}><textarea className="input" value={String(form.channelDescription)} onChange={(e) => set('channelDescription', e.target.value)} /></Field>
          <Field label={t('channel.type')}>
            <div className="flex gap-2">
              {(['permanent', 'semi', 'temporary'] as const).map((k) => <Button key={k} size="sm" variant={type === k ? 'primary' : 'secondary'} onClick={() => setType(k)}>{t(`channel.type.${k}`)}</Button>)}
            </div>
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <Toggle checked={truthy(form.channelFlagDefault)} onChange={(v) => set('channelFlagDefault', v ? 1 : 0)} label={t('channel.default')} description={t('channel.defaultHint')} />
          </div>
          <Field label={mode === 'create' ? t('channel.passwordOptional') : t('channel.newPassword')} hint={mode === 'edit' ? t('channel.passwordKeep') : undefined}><input className="input" type="password" autoComplete="new-password" value={password} disabled={removePassword} onChange={(e) => setPassword(e.target.value)} /></Field>
          {mode === 'edit' && <div className="flex items-end pb-1"><Toggle checked={removePassword} onChange={setRemovePassword} label={t('channel.removePassword')} /></div>}
          <Field label={t('channel.codec')}><select className="input" value={Number(form.channelCodec)} onChange={(e) => set('channelCodec', Number(e.target.value))}>{codecOptions().map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
          <Field label={t('channel.codecQuality')}><input className="input" type="number" min={0} max={10} value={Number(form.channelCodecQuality)} onChange={(e) => set('channelCodecQuality', Number(e.target.value))} /></Field>
          <div className="space-y-2">
            <Toggle checked={maxUnlimited} onChange={(v) => set('channelFlagMaxclientsUnlimited', v ? 1 : 0)} label={t('channel.unlimitedClients')} />
            {!maxUnlimited && <Field label={t('channel.maxClients')}><input className="input" type="number" min={0} value={Number(form.channelMaxclients) < 0 ? 0 : Number(form.channelMaxclients)} onChange={(e) => set('channelMaxclients', Number(e.target.value))} /></Field>}
          </div>
          <div className="space-y-2">
            <Toggle checked={famInherited} onChange={(v) => set('channelFlagMaxfamilyclientsInherited', v ? 1 : 0)} label={t('channel.familyInherit')} />
            {!famInherited && <Toggle checked={famUnlimited} onChange={(v) => set('channelFlagMaxfamilyclientsUnlimited', v ? 1 : 0)} label={t('channel.familyUnlimited')} />}
            {!famInherited && !famUnlimited && <Field label={t('channel.maxFamily')}><input className="input" type="number" min={0} value={Number(form.channelMaxfamilyclients) < 0 ? 0 : Number(form.channelMaxfamilyclients)} onChange={(e) => set('channelMaxfamilyclients', Number(e.target.value))} /></Field>}
          </div>
          <Field label={t('channel.talkPower')}><input className="input" type="number" min={0} value={Number(form.channelNeededTalkPower)} onChange={(e) => set('channelNeededTalkPower', Number(e.target.value))} /></Field>
          <Field label={t('channel.deleteDelay')} hint={t('channel.deleteDelayHint')}><input className="input" type="number" min={0} value={Number(form.channelDeleteDelay)} onChange={(e) => set('channelDeleteDelay', Number(e.target.value))} /></Field>
          <Field label={t('channel.iconId')} hint={t('channel.iconIdHint')}><input className="input font-mono" type="number" min={0} value={Number(form.channelIconId)} onChange={(e) => set('channelIconId', Number(e.target.value))} /></Field>
          <div className="flex items-end pb-1"><Toggle checked={truthy(form.channelCodecIsUnencrypted)} onChange={(v) => set('channelCodecIsUnencrypted', v ? 1 : 0)} label={t('channel.unencrypted')} description={t('channel.unencryptedHint')} /></div>
          <Field label={t('channel.bannerUrl')}><input className="input font-mono" value={String(form.channelBannerGfxUrl)} onChange={(e) => set('channelBannerGfxUrl', e.target.value)} /></Field>
          <Field label={t('channel.bannerMode')}><select className="input" value={Number(form.channelBannerMode)} onChange={(e) => set('channelBannerMode', Number(e.target.value))}><option value={0}>{t('channel.banner.none')}</option><option value={1}>{t('channel.banner.ignore')}</option><option value={2}>{t('channel.banner.keep')}</option></select></Field>
        </div>
      )}
    </Modal>
  );
}

/** Kanal verschieben: neuer Elternkanal + Position. */
export function ChannelMoveModal({ open, onClose, cid, name, channels }: { open: boolean; onClose: () => void; cid: string; name: string; channels: { cid: string; pid: string; name: string; depth: number }[] }) {
  const { t } = useT();
  const qc = useQueryClient();
  const current = channels.find((c) => c.cid === cid);
  const [cpid, setCpid] = useState(current?.pid ?? '0');
  const [order, setOrder] = useState('0');
  useEffect(() => { if (open) { setCpid(current?.pid ?? '0'); setOrder('0'); } }, [open, current?.pid]);
  const siblings = channels.filter((c) => c.pid === cpid && c.cid !== cid);
  const move = useMutation({
    mutationFn: () => api.post(`/api/channels/${cid}/move`, { cpid, order: Number(order) }),
    onSuccess: () => { toast.success(t('channel.moved')); qc.invalidateQueries({ queryKey: ['clients'] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // eigener Teilbaum darf nicht Ziel sein
  const descendants = new Set<string>();
  const collect = (id: string) => { for (const c of channels) if (c.pid === id && !descendants.has(c.cid)) { descendants.add(c.cid); collect(c.cid); } };
  collect(cid);
  return (
    <Modal open={open} onClose={onClose} title={t('channel.moveTitle', { name })} size="sm" footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={move.isPending} onClick={() => move.mutate()}>{t('channel.move')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('channel.parent')}>
          <select className="input" value={cpid} onChange={(e) => { setCpid(e.target.value); setOrder('0'); }}>
            <option value="0">{t('channel.topLevel')}</option>
            {channels.filter((c) => c.cid !== cid && !descendants.has(c.cid)).map((c) => <option key={c.cid} value={c.cid}>{'  '.repeat(c.depth)}{c.name}</option>)}
          </select>
        </Field>
        <Field label={t('channel.position')}>
          <select className="input" value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="0">{t('channel.top')}</option>
            {siblings.map((c) => <option key={c.cid} value={c.cid}>{t('channel.after', { name: c.name })}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
