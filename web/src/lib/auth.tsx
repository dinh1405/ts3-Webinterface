import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, UNAUTHORIZED_EVENT } from '../api/client';
import type { SetupStatus, User } from '../api/types';
import { browserLocale, normalizeLocale, setLocale, storedLocale, type Locale } from '../i18n';

interface AuthState {
  user: User | null;
  loading: boolean;
  needsSetup: boolean;
  /** Systemweite Sprache (Einstellung des Administrators). */
  systemLanguage: Locale;
  version: string;
  isAdmin: boolean;
  canWrite: boolean;
  /** Prüft ein Webinterface-Recht (z. B. 'bans.manage'). */
  can: (cap: string) => boolean;
  login: (username: string, password: string) => Promise<User>;
  /** Persönliche Sprache setzen (null = Systemstandard). */
  setLanguage: (language: Locale | null) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [systemLanguage, setSystemLanguage] = useState<Locale>('de');
  const [version, setVersion] = useState('');

  const refresh = useCallback(async () => {
    try {
      const status = await api.get<SetupStatus>('/api/auth/setup-status');
      setNeedsSetup(status.needsSetup);
      const sys = normalizeLocale(status.language) ?? 'de';
      setSystemLanguage(sys);
      setVersion(status.version || '');
      // Vor der Anmeldung: zuletzt genutzte Sprache, sonst Browsersprache, sonst Systemstandard
      if (!storedLocale()) setLocale(browserLocale() ?? sys);
      if (status.needsSetup) {
        setUser(null);
        return;
      }
      const me = await api.get<{ user: User; language: string }>('/api/auth/me');
      setUser(me.user);
      const eff = normalizeLocale(me.language);
      if (eff) setLocale(eff);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ user: User }>('/api/auth/login', { username, password });
    setUser(res.user);
    setLocale(normalizeLocale(res.user.language) ?? systemLanguage);
    return res.user;
  }, [systemLanguage]);

  const setLanguage = useCallback(async (language: Locale | null) => {
    const res = await api.post<{ user: User; language: string }>('/api/auth/language', { language });
    setUser(res.user);
    setLocale(normalizeLocale(res.language) ?? systemLanguage);
  }, [systemLanguage]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      needsSetup,
      systemLanguage,
      version,
      isAdmin: user?.role === 'admin',
      canWrite: user?.role === 'admin' || user?.role === 'operator',
      can: (cap: string) => Boolean(user?.capabilities?.includes(cap)),
      login,
      setLanguage,
      logout,
      refresh,
    }),
    [user, loading, needsSetup, systemLanguage, version, login, setLanguage, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside of AuthProvider');
  return ctx;
}
