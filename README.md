# blAIr

Better sleep scoring and AI insights for Nanit baby monitors.

The official Nanit app often misses when a baby actually falls asleep or wakes for the day, and its sleep score doesn't account for what's normal at a given (adjusted) age. blAIr signs into your Nanit account, pulls the same sleep data, and re-scores it:

- **Age-adjusted scoring** (duration, continuity, longest stretch, bedtime timing) with prematurity taken into account. Expected night wakes are free; only extra or unusually long ones cost points. A "why this score?" breakdown shows the math.
- **Manual night correction.** Set the real fall-asleep and wake times when Nanit gets them wrong; score, timeline, trends, alerts, and AI writeups all use the corrected window.
- **AI insights** per night that reference your actual numbers, compare against recent nights, and read the camera thumbnails from that night. Choose Claude or OpenAI for insights, two-night comparison, schedule optimization, and video analysis.
- **Baby profile** (rolls both ways, sleep sack, pacifier, notes) so the AI stops flagging things that are normal for your baby.
- Trend charts, regression alerts, milestones, and cry-type classification from clip audio (Gemini).

Live instance: https://blair-1077711142130.us-central1.run.app

It uses Nanit's unofficial API (the same one the Home Assistant integrations use) and can break without warning if Nanit changes it. Not affiliated with Nanit.

## How your data is handled

- Your Nanit email and password are sent to Nanit's API to obtain a session token. The backend does not store credentials; the token lives in your browser's localStorage.
- Stored server-side (Firestore or SQLite): your sleep settings and baby profile, manual night corrections, raw sleep segments for completed nights (as a cache), the AI text generated for a night, and feedback you submit. No video or images are stored.
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

Requirements: Node 22+. The default Firestore backend needs a Google Cloud project with a Firestore database named `blair` and application default credentials. For SQLite, use the Docker Compose setup below.

```bash
cd backend && npm install
cd ../frontend && npm install
```

Create `backend/.env`:

```
PORT=8080
STORAGE_BACKEND=firestore   # default; use sqlite for self-hosting
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

## Self-hosting with SQLite

Docker Compose runs blAIr with SQLite and does not require a Google Cloud project. The default image is `ghcr.io/mjmeli/blair:latest`, built for amd64 and arm64. From the repository directory:

```bash
cp .env.example .env
# Edit .env: set ALLOWED_EMAILS and the API key for your selected AI provider; GEMINI_API_KEY is optional.
docker compose up -d
```

Open `http://YOUR_SERVER_IP:8080`. The app uses your Nanit login through your own server. Your AI keys stay in the container environment; the selected Anthropic (Claude) or OpenAI API handles text/image analysis, and Gemini handles optional audio analysis. API usage is billed to your accounts. The default daily limits are 40 calls per baby and 400 total, and can be changed in `.env`. Serve the app over HTTPS or a private VPN when accessing it beyond the server itself.

The database is `/data/blair.db` in the container, bind-mounted to `./data` on the host. Run one blAIr container per SQLite database. To update, run `docker compose pull && docker compose up -d`. To back up, stop the container with `docker compose stop`, copy the entire `./data` directory to your backup location, then run `docker compose start`. To restore, stop the container, replace `./data` with your saved copy, and start it again. Stopping before copying keeps the SQLite WAL files consistent.

For a test branch, set `BLAIR_IMAGE=ghcr.io/mjmeli/blair:feature-sqlite-self-hosting` in `.env` and run `docker compose pull && docker compose up -d`. Use a `sha-...` or release tag to keep your NAS on a known build. Docker Hub images are also published as `mjmeli/blair` when the fork has a `DOCKERHUB_TOKEN` Actions secret; create that Docker Hub repository first and use an access token for its account.

To use Firestore on a self-hosted server, set `STORAGE_BACKEND=firestore` in your own Compose override or Docker run command, configure `FIREBASE_PROJECT_ID`, and mount Google application default credentials. The included Compose file selects SQLite. Storage backends do not sync data; switching from one to another starts with a separate dataset.

The original hosted deployment keeps its existing Google Analytics measurement ID without any build change. Analytics is disabled automatically in local frontend development. The self-hosted Compose deployment sets `DISABLE_ANALYTICS=true`; any container can set that variable at runtime to hide the consent controls and prevent GA requests, without rebuilding. When the variable is unset or false, GA remains available subject to user consent. To use a different measurement ID, set `VITE_GA_MEASUREMENT_ID` when building the frontend. The measurement ID is public, but AI keys remain server-side.

## Container CI

Every branch push publishes its sanitized branch tag and a `sha-<short-sha>` tag to `ghcr.io/<owner>/blair`; the default branch also publishes `latest`. Version tags publish the full version, major/minor tags, and `latest`. Pull requests run tests and build both architectures without publishing. Publishing to Docker Hub is optional: add the `DOCKERHUB_TOKEN` repository secret to publish matching tags as `mjmeli/blair`. Both registries use the same amd64/arm64 Dockerfile.

## Deploying to Cloud Run

```bash
gcloud run deploy blair --source . --project YOUR_PROJECT --region us-central1
```

Set the environment variables above on the service (they persist across deploys). Firestore is reached through the service's default credentials.

## Scoring in one paragraph

Nanit `auto_sleep` calendar entries are grouped into nights (a gap over 120 minutes starts a new night). The longest night in the window is scored out of 100: duration (35) against the ideal hours for the baby's adjusted age on that night, continuity (35) penalizing only wakes beyond the expected count and minutes beyond the normal wake duration, longest stretch (15) against an age-based expectation, and timing (15) against an age-based bedtime range widened by your own bedtime setting. Manual corrections clip or extend the detected segments before any of this runs.

## Status

Brand new, built by one parent for one baby, largely vibe-coded with Claude. Bugs and feedback are welcome through the in-app form or GitHub issues.

## License

MIT
