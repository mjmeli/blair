/** Turn any thrown value into a short, parent-readable message. */
export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!msg) return fallback;
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return "Couldn't reach the server. Check your connection and try again.";
  return msg;
}
