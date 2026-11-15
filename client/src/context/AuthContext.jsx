import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onSessionExpired, refreshSession, setAccessToken, unwrap } from '../lib/api';
import { readJSON, remove, writeJSON } from '../lib/storage';

const AuthContext = createContext(null);
// Non-sensitive hint so guests don't trigger a pointless refresh request on every visit.
const SESSION_HINT = 'sf_session_hint';

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | guest

  const applySession = useCallback((data) => {
    setAccessToken(data.accessToken);
    setUser(data.user);
    setStatus('authenticated');
    writeJSON(SESSION_HINT, true);
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('guest');
    remove(SESSION_HINT);
    queryClient.removeQueries({ queryKey: ['me'] });
    queryClient.removeQueries({ queryKey: ['cart', 'server'] });
    queryClient.removeQueries({ queryKey: ['wishlist'] });
    queryClient.removeQueries({ queryKey: ['orders'] });
    queryClient.removeQueries({ queryKey: ['admin'] });
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    if (!readJSON(SESSION_HINT, false)) {
      setStatus('guest');
      return undefined;
    }
    refreshSession()
      .then((data) => !cancelled && applySession(data))
      .catch(() => !cancelled && clearSession());
    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession]);

  useEffect(() => onSessionExpired(clearSession), [clearSession]);

  const login = useCallback(
    async (credentials) => {
      const data = unwrap(await api.post('/auth/login', credentials));
      applySession(data);
      return data.user;
    },
    [applySession],
  );

  const register = useCallback(
    async (payload) => {
      const data = unwrap(await api.post('/auth/register', payload));
      applySession(data);
      return data.user;
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated',
      isAdmin: user?.role === 'admin',
      login,
      register,
      logout,
      setUser,
      applySession,
    }),
    [user, status, login, register, logout, applySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
