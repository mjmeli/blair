import { z } from 'zod';
import { spawn } from 'child_process';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { generateStructured, isClaudeConfigured, type ImageInput } from './claude.js';

export interface VideoAnalysis {
  crying: { detected: boolean; confidence: number; duration_estimate_seconds?: number; description: string };
  movement: { level: 'none' | 'low' | 'moderate' | 'high'; description: string };
  coughing: { detected: boolean; count?: number; description: string };
  breathing: { pattern: string; concerns: string[] };
  position: { description: string; safe: boolean };
  environment: { lighting: string; noise_level: string; observations: string[] };
  summary: string;
  alerts: string[];
}

const VideoAnalysisSchema = z.object({
  crying: z.object({
    detected: z.boolean(),
    confidence: z.number().min(0).max(1),
    description: z.string().describe('Brief description of visible crying/distress cues (open mouth, scrunched face, flailing)'),
  }),
  movement: z.object({
    level: z.enum(['none', 'low', 'moderate', 'high']),
    description: z.string().describe('What movement you observe across the frames'),
  }),
  coughing: z.object({
    detected: z.boolean(),
    description: z.string().describe('Visible coughing cues, if any'),
  }),
  breathing: z.object({
    pattern: z.string().describe('What can be inferred visually about breathing/chest movement; say "not assessable" if nothing is visible'),
    concerns: z.array(z.string()),
  }),
  position: z.object({
    description: z.string().describe("Baby's position, e.g. on back, side, stomach"),
    safe: z.boolean().describe('false if the position or surroundings look unsafe for infant sleep'),
  }),
  environment: z.object({
    lighting: z.string().describe('dark / dim / bright'),
    noise_level: z.string().describe('Cannot be heard from images; infer only from visible cues or say "unknown"'),
    observations: z.array(z.string()),
  }),
  summary: z.string().describe('2-3 sentence summary for a parent'),
  alerts: z.array(z.string()).describe('Anything a parent should act on now; empty if nothing'),
});

const SYSTEM_PROMPT = 'You are a pediatric sleep specialist reviewing baby-monitor footage. You are given still frames (or a single thumbnail); describe only what is visually evident and be explicit when something cannot be judged from images alone. Never invent sounds.';

function eventContext(eventType: string, eventTitle: string, adjustedAgeMonths: number): string {
  return `The baby is ${Math.round(adjustedAgeMonths * 10) / 10} months old (adjusted age). These images are from a "${eventType}" event titled "${eventTitle}".`;
}

async function downloadImage(url: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return {
    mimeType: response.headers.get('content-type') || 'image/png',
    data: Buffer.from(buffer).toString('base64'),
  };
}

/**
 * Analyze a single event thumbnail.
 */
export async function analyzeFromThumbnail(
  thumbnailUrl: string,
  eventType: string,
  eventTitle: string,
  adjustedAgeMonths: number,
): Promise<VideoAnalysis> {
  if (!isClaudeConfigured()) throw new Error('ANTHROPIC_API_KEY is not configured');

  console.log(`[video] Analyzing thumbnail for ${eventType}: ${eventTitle}`);
  const img = await downloadImage(thumbnailUrl);

  return generateStructured({
    label: 'thumbnail',
    schema: VideoAnalysisSchema,
    system: SYSTEM_PROMPT,
    prompt: `${eventContext(eventType, eventTitle, adjustedAgeMonths)} Analyze the single thumbnail above.`,
    images: [{ ...img, label: 'Event thumbnail' }],
  });
}

/**
 * Pull up to `maxFrames` evenly spaced JPEG frames out of a clip using ffmpeg.
 * ffmpeg reads the URL directly, so the clip is never fully buffered in memory.
 */
async function extractFrames(clipUrl: string, maxFrames: number = 8): Promise<ImageInput[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'blair-frames-'));
  try {
    // Nanit event clips are short (typically 10-30s); 1 frame every 3s gives good coverage
    // and -frames:v caps the total for longer clips.
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', clipUrl,
        '-vf', 'fps=1/3,scale=768:-2',
        '-frames:v', String(maxFrames),
        '-q:v', '4',
        '-y',
        path.join(dir, 'frame_%02d.jpg'),
      ]);
      let stderr = '';
      ffmpeg.stderr.on('data', d => { stderr += d.toString(); });
      const timer = setTimeout(() => { try { ffmpeg.kill('SIGTERM'); } catch {} }, 60_000);
      ffmpeg.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg frame extraction failed (${code}): ${stderr.slice(-500)}`));
      });
      ffmpeg.on('error', err => { clearTimeout(timer); reject(new Error(`ffmpeg spawn error: ${err.message}`)); });
    });

    const files = (await readdir(dir)).filter(f => f.endsWith('.jpg')).sort();
    const frames: ImageInput[] = [];
    for (const [i, f] of files.entries()) {
      const buf = await readFile(path.join(dir, f));
      frames.push({
        mimeType: 'image/jpeg',
        data: buf.toString('base64'),
        label: `Frame ${i + 1} of ${files.length} (t≈${i * 3}s)`,
      });
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Analyze a video clip by sampling frames from it. Falls back to the thumbnail
 * if ffmpeg fails or yields no frames.
 */
export async function analyzeVideoClip(
  clipUrl: string,
  thumbnailUrl: string | null,
  eventType: string,
  eventTitle: string,
  adjustedAgeMonths: number,
): Promise<VideoAnalysis> {
  if (!isClaudeConfigured()) throw new Error('ANTHROPIC_API_KEY is not configured');

  let frames: ImageInput[] = [];
  try {
    console.log(`[video] Extracting frames from clip for ${eventType}: ${eventTitle}`);
    frames = await extractFrames(clipUrl);
    console.log(`[video] Extracted ${frames.length} frames`);
  } catch (err: any) {
    console.log(`[video] Frame extraction failed (${err.message})`);
  }

  if (frames.length === 0) {
    if (thumbnailUrl) {
      console.log('[video] Falling back to thumbnail analysis');
      return analyzeFromThumbnail(thumbnailUrl, eventType, eventTitle, adjustedAgeMonths);
    }
    throw new Error('Could not extract frames from clip and no thumbnail available');
  }

  return generateStructured({
    label: 'clip',
    schema: VideoAnalysisSchema,
    system: SYSTEM_PROMPT,
    prompt: `${eventContext(eventType, eventTitle, adjustedAgeMonths)} The ${frames.length} frames above were sampled in order from the clip, about 3 seconds apart. Compare consecutive frames to judge movement and restlessness over time.`,
    images: frames,
  });
}
