import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import babiesRoutes from './routes/babies.js';
import sleepRoutes from './routes/sleep.js';
import eventsRoutes from './routes/events.js';
import careRoutes from './routes/care.js';
import insightsRoutes from './routes/insights.js';
import videoRoutes from './routes/video.js';
import feedbackRoutes from './routes/feedback.js';

const app = express();
app.set('trust proxy', true); // Cloud Run sits behind a proxy; needed for real client IPs

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'blair-api' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/babies', babiesRoutes);
app.use('/api/babies', sleepRoutes);
app.use('/api/babies', eventsRoutes);
app.use('/api/babies', careRoutes);
app.use('/api/babies', insightsRoutes);
app.use('/api/babies', videoRoutes);
app.use('/api/feedback', feedbackRoutes);

// In production, serve the frontend static files
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, '..', 'public');
app.use(express.static(staticDir));
// Unknown API paths are a 404, not the SPA shell
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'No such API route' });
});
// SPA fallback: serve index.html for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`blAIr API running on port ${config.port}`);
});
