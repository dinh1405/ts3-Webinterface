import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryStatus, Ts3Event } from '../api/types';
import { useAuth } from './auth';

interface EventsState {
  events: Ts3Event[];
  queryStatus: QueryStatus | null;
  streamConnected: boolean;
}

const EventsContext = createContext<EventsState>({ events: [], queryStatus: null, streamConnected: false });

const MAX_EVENTS = 200;

/** Hält eine SSE-Verbindung zu /api/events und invalidiert bei TS3-Ereignissen die betroffenen Abfragen. */
export function EventsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [events, setEvents] = useState<Ts3Event[]>([]);
  const [queryStatus, setQueryStatus] = useState<QueryStatus | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const invalidateTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!user) {
      setEvents([]);
      setStreamConnected(false);
      return;
    }
    const es = new EventSource('/api/events');
    const scheduleInvalidate = () => {
      if (invalidateTimer.current) return;
      invalidateTimer.current = window.setTimeout(() => {
        invalidateTimer.current = null;
        qc.invalidateQueries({ queryKey: ['clients'] });
        qc.invalidateQueries({ queryKey: ['status'] });
      }, 800);
    };
    es.onopen = () => setStreamConnected(true);
    es.onerror = () => setStreamConnected(false);
    es.addEventListener('hello', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { status: QueryStatus; recent: Ts3Event[] };
      setQueryStatus(data.status);
      setEvents(data.recent);
    });
    es.addEventListener('status', (e) => {
      setQueryStatus(JSON.parse((e as MessageEvent).data));
      qc.invalidateQueries({ queryKey: ['status'] });
    });
    es.addEventListener('ts3event', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as Ts3Event;
      setEvents((prev) => [ev, ...prev].slice(0, MAX_EVENTS));
      if (ev.type.startsWith('client.') || ev.type.startsWith('channel.') || ev.type.startsWith('query.')) scheduleInvalidate();
      if (ev.type === 'server.edit') qc.invalidateQueries({ queryKey: ['settings'] });
      if (ev.type === 'client.banned') qc.invalidateQueries({ queryKey: ['bans'] });
    });
    return () => {
      es.close();
      if (invalidateTimer.current) window.clearTimeout(invalidateTimer.current);
      invalidateTimer.current = null;
    };
  }, [user, qc]);

  const value = useMemo(() => ({ events, queryStatus, streamConnected }), [events, queryStatus, streamConnected]);
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEvents() {
  return useContext(EventsContext);
}
