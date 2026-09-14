import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Bug, Loader2, MessageSquare, X } from 'lucide-react';
import { sendFeedback } from '../../services/api';
import { errorMessage } from '../../utils/errors';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Bug report / feedback form. Goes to the maintainer without exposing their address. */
export function FeedbackDialog({ open, onClose }: Props) {
  const [kind, setKind] = useState<'bug' | 'feedback'>('feedback');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await sendFeedback({ kind, message, email: email || undefined, page: window.location.pathname, website });
      setDone(true);
      setMessage('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const close = () => { setDone(false); setError(null); onClose(); };
  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-500';

  // Portal to <body>: the nav's backdrop-blur would otherwise trap a fixed child inside it
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 px-4 pt-12 pb-12" onClick={close}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-indigo-500" />
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Feedback &amp; bugs</h2>
          </div>
          <button onClick={close} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X size={18} /></button>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700 dark:text-slate-300">Thanks, got it. If you left an email I may follow up.</p>
            <button onClick={close} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This app is brand new. Wrong scores, broken buttons, ideas: all welcome. Please don't include your Nanit password.
            </p>
            <div className="flex gap-2">
              {(['feedback', 'bug'] as const).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    kind === k ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {k === 'bug' ? <Bug size={12} /> : <MessageSquare size={12} />} {k === 'bug' ? 'Bug report' : 'Feedback'}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, 4000))}
              rows={5}
              required
              minLength={5}
              placeholder={kind === 'bug' ? 'What happened, what you expected, and which night/card it was on.' : 'What would make this more useful?'}
              className={inputClass}
            />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Your email (optional, for follow-up)"
              className={inputClass}
            />
            {/* Honeypot: hidden from people, filled by bots */}
            <input type="text" value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={sending || message.trim().length < 5}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {sending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : 'Send'}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
