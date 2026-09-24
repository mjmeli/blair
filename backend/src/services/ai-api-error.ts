export interface AiApiErrorResponse {
  status: number;
  body: { error: 'ai_error'; message: string };
}

export function aiApiErrorResponse(status: number | undefined, detail: string, keyName: string): AiApiErrorResponse {
  const apiStatus = status ?? 502;
  return {
    status: apiStatus === 429 ? 429 : 502,
    body: {
      error: 'ai_error',
      message: apiStatus === 401
        ? `The AI service rejected the API key. Check ${keyName} on the server.`
        : apiStatus === 429
          ? 'The AI service is rate-limited right now. Try again in a minute.'
          : `AI request failed: ${detail}`,
    },
  };
}
