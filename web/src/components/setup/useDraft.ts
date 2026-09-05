import { useCallback, useState } from 'react';
import type { Draft } from '../../api/setup';

/** Entwurfszustand mit bequemen Teil-Updates (Assistent und Admin-Seite). */
export function useDraft(initial: Draft) {
  const [draft, setDraft] = useState<Draft>(initial);
  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const updateTs3 = useCallback((patch: Partial<Draft['ts3']>) => setDraft((d) => ({ ...d, ts3: { ...d.ts3, ...patch } })), []);
  const updateQuery = useCallback((patch: Partial<Draft['ts3']['query']>) => setDraft((d) => ({ ...d, ts3: { ...d.ts3, query: { ...d.ts3.query, ...patch } } })), []);
  return { draft, setDraft, update, updateTs3, updateQuery };
}
