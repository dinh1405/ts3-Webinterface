import { useEffect, useId, useSyncExternalStore } from 'react';
import { useBlocker } from 'react-router';
import { useT } from '../i18n';
import { ConfirmDialog } from '../components/ui';

/*
 * Schutz vor ungespeicherten Änderungen: Seiten melden ihren Zustand über `useUnsavedChanges(dirty)`,
 * das Layout rendert einmal `<UnsavedGuard />`, der Navigation innerhalb der App (react-router) und das
 * Schließen des Tabs (beforeunload) abfängt, solange irgendein Formular geändert ist.
 */
const dirty = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version++; listeners.forEach((fn) => fn()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => version;

/** Meldet, ob die aufrufende Komponente ungespeicherte Änderungen hat. */
export function useUnsavedChanges(isDirty: boolean) {
  const id = useId();
  useEffect(() => {
    if (isDirty) dirty.add(id); else dirty.delete(id);
    notify();
    return () => { if (dirty.delete(id)) notify(); };
  }, [isDirty, id]);
}

/** Gibt es aktuell ungespeicherte Änderungen? (rendert bei Änderung neu) */
export function useAnyUnsaved(): boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return dirty.size > 0;
}

/** Dialog „Ungespeicherte Änderungen – verlassen?“; einmal im Layout einbinden. */
export function UnsavedGuard() {
  const { t } = useT();
  const any = useAnyUnsaved();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => any && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!any) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [any]);
  // Wird der Zustand sauber (gespeichert/verworfen), während der Dialog offen ist, Navigation freigeben
  useEffect(() => { if (blocker.state === 'blocked' && !any) blocker.reset(); }, [any, blocker]);
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.state === 'blocked' && blocker.reset()}
      onConfirm={() => { if (blocker.state === 'blocked') { dirty.clear(); notify(); blocker.proceed(); } }}
      title={t('ui.unsavedTitle')}
      message={t('ui.unsavedMessage')}
      confirmLabel={t('ui.leave')}
      tone="warning"
    />
  );
}
