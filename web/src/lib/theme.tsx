import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'ts3wi-theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(pref: ThemePref) {
  const mode = resolve(pref);
  const el = document.documentElement;
  el.classList.remove('light', 'dark');
  el.classList.add(mode);
  return mode;
}

/** Theme-Umschaltung (hell / dunkel / System) mit Speicherung im Browser. */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [mode, setMode] = useState<'light' | 'dark'>(() => resolve(readPref()));

  useEffect(() => {
    setMode(apply(pref));
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setMode(apply('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
    setPrefState(p);
  }, []);

  return { pref, mode, setPref, isDark: mode === 'dark' };
}
