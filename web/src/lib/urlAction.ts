import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Führt einmalig eine Aktion aus einem URL-Parameter aus (z. B. `?create=1` aus der Befehlspalette)
 * und entfernt den Parameter danach aus der Adresse, damit ein Neuladen die Aktion nicht wiederholt.
 */
export function useUrlAction(param: string, handler: (value: string) => void) {
  const [params, setParams] = useSearchParams();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const value = params.get(param);
  useEffect(() => {
    if (value === null) return;
    const next = new URLSearchParams(params);
    next.delete(param);
    setParams(next, { replace: true });
    handlerRef.current(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur auf den Parameterwert reagieren
  }, [value, param]);
}
