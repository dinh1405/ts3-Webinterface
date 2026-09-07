import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { BookmarkPlus, Copy, Download, GitCompare, LayoutTemplate, Upload } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { GroupPermission, PermKind, PermPreset, PermResult } from '../api/types';
import { useT } from '../i18n';
import { diffPerms, parsePermExport, PERM_EXPORT_FORMAT } from '../lib/permdiff';
import { downloadJson, safeFileName } from '../lib/download';
import { Badge, Button, Field, Modal, Toggle } from './ui';
import { SubjectPicker, subjectKey, type SubjectRef } from './SubjectPicker';

export interface PermSubject { kind: PermKind; id: string; name: string; type?: number }
type Mode = 'merge' | 'replace';

/** Warnung, wenn ein Ersetzen die Query-/Admin-Gruppe treffen könnte (Aussperrgefahr). */
export const isSensitiveSubject = (s: PermSubject) => s.kind === 'servergroup' && (s.type === 2 || /admin|query/i.test(s.name));

type T = ReturnType<typeof useT>['t'];
export function summarizeResults(t: T, results: PermResult[], removed: string[] = []) {
  const failed = results.filter((r) => !r.ok);
  const ok = results.length - failed.length;
  if (failed.length) toast.warning(t('perms.savedPartial', { ok, failed: failed.length }), { description: failed.map((f) => `${f.name}: ${f.error}`).join('\n') });
  else toast.success(removed.length ? t('perms.tools.appliedRemoved', { count: ok, removed: removed.length }) : t('perms.saved', { count: ok }));
}

function ModeSelect({ mode, setMode, target }: { mode: Mode; setMode: (m: Mode) => void; target: PermSubject }) {
  const { t } = useT();
  return (
    <div className="space-y-2">
      <Field label={t('perms.tools.mode')}>
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="merge">{t('perms.tools.modeMerge')}</option>
          <option value="replace">{t('perms.tools.modeReplace')}</option>
        </select>
      </Field>
      <p className="text-xs text-slate-500">{mode === 'merge' ? t('perms.tools.modeMergeHint') : t('perms.tools.modeReplaceHint')}</p>
      {mode === 'replace' && isSensitiveSubject(target) && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">{t('perms.tools.sensitiveWarning', { name: target.name })}</p>}
    </div>
  );
}

/**
 * Werkzeugleiste des Rechte-Editors: Vergleichen, Kopieren von …, Vorlage anwenden/speichern, Export, Import.
 * Alle schreibenden Aktionen laufen über die bestehenden Endpunkte und melden Teilfehler je Recht.
 */
export function PermTools({ subject, perms, canWrite, onChanged }: { subject: PermSubject; perms: GroupPermission[]; canWrite: boolean; onChanged: () => void }) {
  const { t, td } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | 'compare' | 'copy' | 'apply' | 'save' | 'import'>(null);
  const [other, setOther] = useState<SubjectRef | null>(null);
  const [mode, setMode] = useState<Mode>('merge');
  const [presetId, setPresetId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imported, setImported] = useState<{ fileName: string; perms: GroupPermission[]; subject?: { name?: string; kind?: string }; error?: string } | null>(null);
  const [removeMissing, setRemoveMissing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const me: SubjectRef = { kind: subject.kind, id: subject.id, name: subject.name };
  const base = `/api/permissions/${subject.kind}/${encodeURIComponent(subject.id)}`;
  const close = () => { setDialog(null); setOther(null); setMode('merge'); setPresetId(''); setName(''); setDescription(''); setImported(null); setRemoveMissing(false); };

  const presets = useQuery({ queryKey: ['permissions', 'presets'], queryFn: () => api.get<{ presets: PermPreset[] }>('/api/permissions/presets'), enabled: dialog === 'apply', staleTime: 30000 });

  const copy = useMutation({
    mutationFn: () => api.post<{ ok: boolean; results: PermResult[]; removed: string[] }>(`${base}/copy-from`, { sourceKind: other!.kind, sourceId: other!.id, mode }),
    onSuccess: (r) => { summarizeResults(t, r.results, r.removed); close(); onChanged(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => api.post<{ ok: boolean; results: PermResult[]; removed: string[] }>(`/api/permissions/presets/${presetId}/apply`, { kind: subject.kind, id: subject.id, mode }),
    onSuccess: (r) => { summarizeResults(t, r.results, r.removed); close(); onChanged(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: () => api.post<{ preset: PermPreset }>('/api/permissions/presets', { name: name.trim(), description: description.trim(), kind: subject.kind, fromKind: subject.kind, fromId: subject.id }),
    onSuccess: (r) => { toast.success(t('perms.preset.saved', { name: r.preset.name })); qc.invalidateQueries({ queryKey: ['permissions', 'presets'] }); close(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const doImport = useMutation({
    mutationFn: async () => {
      const list = imported!.perms;
      const r = await api.put<{ ok: boolean; results: PermResult[] }>(base, { perms: list });
      let removed: string[] = [];
      if (removeMissing) {
        const wanted = new Set(list.map((p) => p.name));
        const names = perms.filter((p) => !wanted.has(p.name)).map((p) => p.name);
        if (names.length) {
          const rr = await api.post<{ ok: boolean; results: PermResult[] }>(`${base}/remove`, { names });
          removed = rr.results.filter((x) => x.ok).map((x) => x.name);
          r.results.push(...rr.results.filter((x) => !x.ok).map((x) => ({ ...x, action: 'remove' })));
        }
      }
      return { results: r.results, removed };
    },
    onSuccess: (r) => { summarizeResults(t, r.results, r.removed); close(); onChanged(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const exportFile = () => {
    downloadJson(`perms_${subject.kind}_${safeFileName(subject.name)}.json`, { format: PERM_EXPORT_FORMAT, exportedAt: new Date().toISOString(), subject: { kind: subject.kind, id: subject.id, name: subject.name }, perms });
    toast.success(t('perms.tools.exported', { count: perms.length }));
  };
  const onFile = async (file: File) => {
    try {
      const parsed = parsePermExport(await file.text());
      setImported({ fileName: file.name, perms: parsed.perms, subject: parsed.subject });
    } catch (e) {
      setImported({ fileName: file.name, perms: [], error: (e as Error).message === 'format' ? t('perms.import.badFormat') : t('perms.import.badEntry') });
    }
    setDialog('import');
  };
  const importDiff = useMemo(() => (imported && !imported.error ? diffPerms(perms, imported.perms) : null), [imported, perms]);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={GitCompare} onClick={() => setDialog('compare')}>{t('perms.tools.compare')}</Button>
        <Button size="sm" icon={Download} onClick={exportFile} disabled={perms.length === 0}>{t('perms.tools.export')}</Button>
        {canWrite && <>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          <Button size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>{t('perms.tools.import')}</Button>
          <Button size="sm" icon={Copy} onClick={() => setDialog('copy')}>{t('perms.tools.copyFrom')}</Button>
          <Button size="sm" icon={LayoutTemplate} onClick={() => setDialog('apply')}>{t('perms.tools.applyPreset')}</Button>
          <Button size="sm" icon={BookmarkPlus} onClick={() => setDialog('save')} disabled={perms.length === 0}>{t('perms.tools.savePreset')}</Button>
        </>}
      </div>

      <Modal open={dialog === 'compare'} onClose={close} title={t('perms.tools.compareTitle', { name: subject.name })} size="sm"
        footer={<><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button><Button variant="primary" disabled={!other} onClick={() => navigate(`/permissions/compare?a=${encodeURIComponent(subjectKey(me))}&b=${encodeURIComponent(subjectKey(other))}`)}>{t('perms.tools.compare')}</Button></>}>
        <p className="mb-3 text-sm text-slate-400">{t('perms.tools.compareWith')}</p>
        <SubjectPicker value={other} onChange={setOther} exclude={me} />
      </Modal>

      <Modal open={dialog === 'copy'} onClose={close} title={t('perms.tools.copyTitle', { name: subject.name })} size="sm"
        footer={<><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button><Button variant={mode === 'replace' ? 'warning' : 'primary'} disabled={!other} loading={copy.isPending} onClick={() => copy.mutate()}>{t('perms.tools.copyNow')}</Button></>}>
        <div className="space-y-4">
          <div><p className="mb-2 text-sm text-slate-400">{t('perms.tools.copySource')}</p><SubjectPicker value={other} onChange={setOther} exclude={me} /></div>
          <ModeSelect mode={mode} setMode={setMode} target={subject} />
        </div>
      </Modal>

      <Modal open={dialog === 'apply'} onClose={close} title={t('perms.tools.applyTitle', { name: subject.name })} size="sm"
        footer={<><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button><Button variant={mode === 'replace' ? 'warning' : 'primary'} disabled={!presetId} loading={apply.isPending} onClick={() => apply.mutate()}>{t('perms.tools.applyNow')}</Button></>}>
        <div className="space-y-4">
          <Field label={t('perms.preset.one')}>
            <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              <option value="">{presets.isLoading ? t('common.loading') : presets.data?.presets.length ? t('perms.picker.choose') : t('perms.preset.none')}</option>
              {presets.data?.presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({t('perms.entries', { count: p.count })}{p.kind ? ` · ${t(`perms.kind.${p.kind}`)}` : ''})</option>)}
            </select>
          </Field>
          <ModeSelect mode={mode} setMode={setMode} target={subject} />
        </div>
      </Modal>

      <Modal open={dialog === 'save'} onClose={close} title={t('perms.tools.saveTitle')} size="sm"
        footer={<><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button><Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></>}>
        <div className="space-y-4">
          <p className="text-sm text-slate-400">{t('perms.tools.saveHint', { name: subject.name, count: perms.length })}</p>
          <Field label={t('common.name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus /></Field>
          <Field label={t('perms.preset.description')}><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></Field>
        </div>
      </Modal>

      <Modal open={dialog === 'import'} onClose={close} title={t('perms.import.title')} size="lg"
        footer={<><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>{importDiff && <Button variant={removeMissing ? 'warning' : 'primary'} loading={doImport.isPending} disabled={imported!.perms.length === 0} onClick={() => doImport.mutate()}>{t('perms.import.apply', { count: imported!.perms.length })}</Button>}</>}>
        {imported?.error && <p className="text-sm text-rose-300">{imported.error}</p>}
        {imported && importDiff && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">{t('perms.import.summary', { file: imported.fileName, count: imported.perms.length })}{imported.subject?.name && <span className="text-slate-500"> · {t('perms.import.from', { name: imported.subject.name, kind: imported.subject.kind ? td(`perms.kind.${imported.subject.kind}`, undefined, imported.subject.kind) : '' })}</span>}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone="green">{t('perms.compare.added', { count: importDiff.added })}</Badge>
              <Badge tone="amber">{t('perms.compare.changed', { count: importDiff.changed })}</Badge>
              <Badge tone="slate">{t('perms.compare.same', { count: importDiff.same })}</Badge>
              <Badge tone={removeMissing ? 'red' : 'slate'}>{t('perms.compare.removed', { count: importDiff.removed })}</Badge>
            </div>
            <Toggle checked={removeMissing} onChange={setRemoveMissing} label={t('perms.import.removeMissing')} description={t('perms.import.removeMissingHint', { count: importDiff.removed })} />
            {removeMissing && isSensitiveSubject(subject) && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">{t('perms.tools.sensitiveWarning', { name: subject.name })}</p>}
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-800">
              <table className="table">
                <thead><tr><th>{t('perms.th.permission')}</th><th>{t('perms.compare.current')}</th><th>{t('perms.compare.imported')}</th></tr></thead>
                <tbody>
                  {importDiff.rows.filter((r) => r.status !== 'same').map((r) => (
                    <tr key={r.name} className={clsx(r.status === 'added' && 'bg-emerald-500/5', r.status === 'changed' && 'bg-amber-500/5', r.status === 'removed' && (removeMissing ? 'bg-rose-500/5' : 'opacity-50'))}>
                      <td className="font-mono text-xs">{r.name}</td>
                      <td className="font-mono text-xs">{r.a ? fmt(r.a) : '–'}</td>
                      <td className="font-mono text-xs">{r.b ? fmt(r.b) : (removeMissing ? <span className="text-rose-300">{t('perms.compare.willRemove')}</span> : '–')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export const fmt = (p: GroupPermission) => `${p.value}${p.skip ? ' S' : ''}${p.negate ? ' N' : ''}`;
