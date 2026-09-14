import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { FeedbackDialog } from '../common/FeedbackDialog';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const { isLoading, error, mfaChallenge, handleLogin, handleMfa } = useAuth();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const onSubmitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    handleLogin(email, password);
  };

  const onSubmitMfa = (e: React.FormEvent) => {
    e.preventDefault();
    handleMfa(mfaCode);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-3xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
          blAIr
        </h1>

        {!mfaChallenge ? (
          <form onSubmit={onSubmitLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                placeholder="nanit@email.com"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                placeholder="Password"
                required
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isLoading ? 'Signing in...' : 'Sign in with Nanit'}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmitMfa} className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Enter the verification code sent to ***{mfaChallenge.phone_suffix} via {mfaChallenge.channel}.
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Code</label>
              <input
                type="text"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-center text-2xl tracking-[0.3em] text-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                placeholder="000000"
                maxLength={6}
                required
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isLoading ? 'Verifying...' : 'Verify'}
            </button>
          </form>
        )}

        <div className="mt-8 space-y-2 text-center text-xs text-slate-500 dark:text-slate-400">
          <p>
            Better sleep scores and AI insights for your Nanit. Your email and password go straight to Nanit's API to get a session token; the token stays in this browser and nothing about your account is stored on the server.
          </p>
          <p>
            Brand new and rough around the edges.{' '}
            <button type="button" onClick={() => setFeedbackOpen(true)} className="text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400">
              Report a bug or send feedback
            </button>
          </p>
        </div>
      </div>
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
