import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { setupApi } from '../../api/setup';
import { useT } from '../../i18n';
import { formatBytes } from '../../lib/format';
import { Badge, Button, Card, ErrorBox, FullPageSpinner } from '../ui';
import { CheckLine } from './common';

export function SystemCheckPanel() {
  const { t } = useT();
  const q = useQuery({ queryKey: ['setup', 'system-check'], queryFn: () => setupApi.systemCheck(), staleTime: 30000 });
  const d = q.data;
  return (
    <Card title={t('wizard.syscheck.title')} subtitle={d ? `${d.os.name} · Node ${d.node.version} · ${d.user.name}${d.isRoot ? ' (root)' : ''}` : undefined}
      actions={<Button size="sm" variant="ghost" icon={RefreshCw} loading={q.isFetching} onClick={() => q.refetch()}>{t('common.retry')}</Button>}>
      {q.isLoading && <FullPageSpinner />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} compact />}
      {d && (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t('wizard.syscheck.tools')}</p>
            <ul>
              <CheckLine ok={d.node.ok} label={`Node.js ${d.node.version}`} detail={d.node.ok ? undefined : t('wizard.syscheck.nodeOld')} />
              <CheckLine ok={Boolean(d.tools.sqlite3)} warn label="sqlite3" detail={d.tools.sqlite3 || t('wizard.syscheck.sqliteMissing')} />
              <CheckLine ok={Boolean(d.tools.tar) && Boolean(d.tools.bzip2)} warn label="tar + bzip2" detail={d.tools.tar && d.tools.bzip2 ? undefined : t('wizard.syscheck.tarMissing')} />
              <CheckLine ok={Boolean(d.tools.sendmail)} warn label="sendmail" detail={d.tools.sendmail || t('wizard.syscheck.sendmailMissing')} />
              <CheckLine ok={Boolean(d.tools.systemctl)} warn label="systemctl" detail={d.tools.systemctl || '–'} />
              <CheckLine ok={Boolean(d.tools.docker)} warn label="docker" detail={d.tools.docker || '–'} />
              <CheckLine ok={d.sudo.available && !d.sudo.error} warn label="sudo -n" detail={d.sudo.error || (d.sudo.rules.length ? d.sudo.rules.join(' · ') : t('wizard.syscheck.noSudoRules'))} />
            </ul>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.plesk && <Badge tone="purple">Plesk</Badge>}
              {d.tools.nginx && <Badge tone="blue">nginx</Badge>}
              {(d.tools.apache2 || d.tools.httpd) && <Badge tone="blue">Apache</Badge>}
              <Badge tone={d.configFile.exists ? 'indigo' : 'slate'}>{d.configFile.exists ? t('wizard.syscheck.configFile') : t('wizard.syscheck.envOnlyConfig')}</Badge>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t('wizard.syscheck.dirs')}</p>
            <ul>
              {(['dataDir', 'backupDir', 'ts3Dir'] as const).map((k) => {
                const v = d.dirs[k];
                if (!v) return <CheckLine key={k} ok={null} label={t(`wizard.syscheck.${k}`)} detail={t('wizard.syscheck.notSet')} />;
                return <CheckLine key={k} ok={v.exists && v.writable} warn={k === 'ts3Dir'} label={<>{t(`wizard.syscheck.${k}`)}{v.owner && <span className="text-slate-500"> · {v.owner.name}</span>}{v.disk && <span className="text-slate-500"> · {t('wizard.syscheck.freeShort', { free: formatBytes(v.disk.free) })}</span>}</>} detail={`${v.path}${v.exists ? (v.writable ? '' : ` · ${t('wizard.syscheck.readOnly')}`) : ` · ${t('wizard.syscheck.missing')}`}`} />;
              })}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
