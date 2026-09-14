import { useState, useCallback } from 'react';
import * as api from '../services/api';
import type { MfaChallenge } from '../types';

export function useAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const handleLogin = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.login(email, password);
      if ('mfa_required' in result) {
        setMfaChallenge(result);
        setCredentials({ email, password });
      } else {
        window.location.href = '/';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleMfa = useCallback(async (code: string) => {
    if (!mfaChallenge || !credentials) return;
    setIsLoading(true);
    setError(null);
    try {
      await api.loginMfa(
        credentials.email,
        credentials.password,
        mfaChallenge.mfa_token,
        code,
        mfaChallenge.channel,
      );
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [mfaChallenge, credentials]);

  return { isLoading, error, mfaChallenge, handleLogin, handleMfa };
}
