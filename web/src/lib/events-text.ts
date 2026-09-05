import type { Ts3Event } from '../api/types';
import { t, td } from '../i18n';

/** Übersetzt ein TS3-Ereignis aus seinen Parametern; Fallback ist der (englische) Servertext. */
export function describeEvent(e: Ts3Event): string {
  const p = (e.params ?? {}) as Record<string, string | undefined>;
  switch (e.type) {
    case 'client.connect': return t('event.client.connect', { nickname: p.nickname ?? '?' });
    case 'client.disconnect':
    case 'client.kicked':
    case 'client.banned': {
      const by = p.invoker ? t('event.by', { invoker: p.invoker }) : '';
      const reason = p.reason ? t('event.reason', { reason: p.reason }) : '';
      return t(`event.${e.type}`, { nickname: p.nickname ?? '?' }) + by + reason;
    }
    case 'client.moved': return t('event.client.moved', { nickname: p.nickname ?? '?', channel: p.channel ?? '?' });
    case 'chat': return t('event.chat', { scope: td(`event.scope.${p.scope}`, undefined, p.scope ?? ''), nickname: p.nickname ?? '?', msg: p.msg ?? '' });
    case 'server.edit': return t('event.server.edit', { invoker: p.invoker ?? '?', keys: p.keys ? `: ${p.keys}` : '' });
    case 'channel.create':
    case 'channel.edit':
    case 'channel.delete':
    case 'channel.move': return t(`event.${e.type}`, { name: p.name ?? '?', invoker: p.invoker ?? '?' });
    case 'query.connected': return t('event.query.connected');
    case 'query.disconnected': return t('event.query.disconnected');
    default: return e.message;
  }
}

/** Statusdetail der Prozesssteuerung (Schlüssel vom Server oder Freitext). */
export function describeProcessDetail(detail: string | null | undefined): string {
  if (!detail) return '';
  return td(`procDetail.${detail}`, undefined, detail);
}
