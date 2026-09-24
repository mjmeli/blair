# blAIr

Better sleep scoring and AI insights for Nanit baby monitors.

The official Nanit app often misses when a baby actually falls asleep or wakes for the day, and its sleep score doesn't account for what's normal at a given (adjusted) age. blAIr signs into your Nanit account, pulls the same sleep data, and re-scores it:

- **Age-adjusted scoring** (duration, continuity, longest stretch, bedtime timing) with prematurity taken into account. Expected night wakes are free; only extra or unusually long ones cost points. A "why this score?" breakdown shows the math.
- **Self-settled vs. parent visits.** Nanit's camera logs when a parent approaches the crib. Each night wake is labeled self-settled, parent visit, or taken out (you can correct it). Self-settled wakes never count as extra wakes, brief ones don't break the longest stretch, and the AI won't tell you to "wait before responding" to a wake nobody responded to.
- **Naps and 24-hour view.** A day-by-day activity chart of every crib sleep (like Nanit's Activity Tracker) with nap count, daytime sleep, and wake windows against age-typical ranges. Naps outside the crib are invisible to the camera, so suspicious wake windows are flagged rather than averaged.
- **Manual night correction.** Set the real fall-asleep and wake times when Nanit gets them wrong; score, timeline, trends, alerts, and AI writeups all use the corrected window.
- **AI insights** per night that reference your actual numbers, compare against recent nights, and read the camera thumbnails from that night. Choose Claude or OpenAI for insights, two-night comparison, schedule optimization, and video analysis.
- **Baby profile** (rolls both ways, sleep sack, pacifier, notes) so the AI stops flagging things that are normal for your baby.
- Trend charts, regression alerts, milestones, and cry-type classification from clip audio (Gemini).

Live instance: https://blair-1077711142130.us-central1.run.app

It uses Nanit's unofficial API (the same one the Home Assistant integrations use) and can break without warning if Nanit changes it. Not affiliated with Nanit.

## How your data is handled

- Your Nanit email and password are sent to Nanit's API to obtain a session token. The backend does not store credentials; the token lives in your browser's localStorage.
- Stored server-side (Firestore): your sleep settings and baby profile, manual night corrections, raw sleep segments for completed nights (as a cache), the AI text generated for a night, and feedback you submit. No video or images are stored.
- AI calls are capped per baby per day.

## Architecture

```
frontend/   React 19 + Vite + Tailwind 4     -> built to static files
backend/    Express + TypeScript             -> serves the API and the built frontend
            services/nanit-client.ts          Nanit API (reverse-engineered)
            services/sleep-scorer.ts          scoring + manual annotations
            services/night-history.ts         cached, parallel multi-night loader
            services/ai.ts                    provider-neutral structured AI interface
            services/claude.ts                Claude adapter
            services/openai-adapter.ts        OpenAI adapter
            services/ai-insights.ts, night-comparison.ts, schedule-optimizer.ts,
            services/video-patterns.ts, video-analysis.ts, audio-analysis.ts
Dockerfile  multi-stage build for Cloud Run (includes ffmpeg)
```

## Running locally

Requirements: Node 22+, a Google Cloud project with Firestore (database id `blair`), and `gcloud auth application-default login` so the backend can reach Firestore.

```bash
cd backend && npm install
cd ../frontend && npm install
```

Create `backend/.env`:

```
PORT=8080
FIREBASE_PROJECT_ID=your-gcp-project
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=                 # optional; use when BLAIR_AI_PROVIDER=openai
GEMINI_API_KEY=...            # optional, only for audio analysis
BLAIR_AI_PROVIDER=anthropic   # optional: anthropic | openai; defaults to anthropic
BLAIR_AI_MODEL=claude-opus-5  # optional; OpenAI defaults to gpt-6-luna
BLAIR_AI_EFFORT=medium        # optional; OpenAI also supports none
AI_DAILY_LIMIT_PER_BABY=40    # optional
AI_DAILY_LIMIT_GLOBAL=400     # optional
ALLOWED_EMAILS=               # optional comma-separated Nanit emails; empty = anyone
RESEND_API_KEY=               # optional, emails feedback submissions
FEEDBACK_TO_EMAIL=            # where feedback goes
```

The provider, model, and effort settings form one global configuration triple for all text and image analyses. Use a model supported by the selected provider:

| Provider | Model | Effort | Example |
| --- | --- | --- | --- |
| `anthropic` | `claude-opus-5` | `medium` | Existing default |
| `openai` | `gpt-6-luna` | `none` | Lowest reasoning effort |
| `openai` | `gpt-6-luna` | `medium` | OpenAI default effort |
| `openai` | `gpt-6-sol` | `medium` | More capable OpenAI option |

Set the matching key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). The app sends requests only to the configured model; it does not automatically fall back to another model.

Then in two terminals:

```bash
cd backend && npm run dev      # http://localhost:8080
cd frontend && npm run dev     # http://localhost:3000 (proxies /api to 8080)
```

`ffmpeg` must be on your PATH for clip frame extraction and audio analysis; the Docker image installs it.

## Deploying to Cloud Run

```bash
gcloud run deploy blair --source . --project YOUR_PROJECT --region us-central1
```

Set the environment variables above on the service (they persist across deploys). Firestore is reached through the service's default credentials.

## Scoring in one paragraph

Nanit `auto_sleep` calendar entries are grouped into nights (a gap over 120 minutes starts a new night). The longest night in the window is scored out of 100: duration (35) against the ideal hours for the baby's adjusted age on that night, continuity (35) penalizing only wakes beyond the expected count and minutes beyond the normal wake duration (wakes the baby settled from without a parent visit never count as extra, and running long costs half), longest stretch (15) against an age-based expectation (self-settled wakes of 5 minutes or less don't break a stretch), and timing (15) against an age-based bedtime range widened by your own bedtime setting. Manual corrections clip or extend the detected segments before any of this runs.

## Status

Brand new, built by one parent for one baby, largely vibe-coded with Claude. Bugs and feedback are welcome through the in-app form or GitHub issues.

## License

MIT
