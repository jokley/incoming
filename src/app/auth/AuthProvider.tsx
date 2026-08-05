import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import type { AuthenticatedUser } from '../types';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  hasPermission: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await api.getCurrentUser());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unauthenticated = () => setUser(null);
    window.addEventListener('auth:unauthenticated', unauthenticated);
    return () => window.removeEventListener('auth:unauthenticated', unauthenticated);
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    hasPermission: (permission) => Boolean(user?.permissions.includes('*') || user?.permissions.includes(permission)),
    refresh,
  }), [user, loading, refresh]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-600">Anmeldung wird geprüft …</div>;
  }
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-gray-700">
        <p>Deine Sitzung ist abgelaufen oder du bist nicht angemeldet.</p>
        <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={() => window.location.assign('/')}>Anmelden</button>
      </div>
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

