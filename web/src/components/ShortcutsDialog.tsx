import { useT, type Locale } from '../i18n';
import { useNavGroups } from '../lib/nav';
import { Modal } from './ui';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** Beschriftung der Modifikatortaste: ⌘ auf Apple-Geräten, sonst sprachabhängig Strg/Ctrl. */
export function modKey(locale: Locale): string {
  return isMac ? '⌘' : locale === 'de' ? 'Strg' : 'Ctrl';
}

function Keys({ keys }: { keys: string[] }) {
  return <span className="flex items-center gap-1">{keys.map((k, i) => <kbd key={i} className="kbd">{k}</kbd>)}</span>;
}

/** Übersicht der Tastenkürzel (öffnet mit „?“). */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useT();
  const groups = useNavGroups();
  const pages = groups.flatMap((g) => g.items).filter((i) => i.key);
  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title')} size="md">
      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">{t('shortcuts.general')}</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3"><dt className="text-slate-300">{t('shortcuts.palette')}</dt><dd><Keys keys={[modKey(locale), 'K']} /></dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-slate-300">{t('shortcuts.help')}</dt><dd><Keys keys={['?']} /></dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-slate-300">{t('shortcuts.close')}</dt><dd><Keys keys={['Esc']} /></dd></div>
          </dl>
        </section>
        <section>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">{t('shortcuts.nav')}</h3>
          <dl className="space-y-2 text-sm">
            {pages.map((p) => (
              <div key={p.to} className="flex items-center justify-between gap-3"><dt className="truncate text-slate-300">{p.label}</dt><dd><Keys keys={['G', p.key!.toUpperCase()]} /></dd></div>
            ))}
          </dl>
        </section>
      </div>
    </Modal>
  );
}
