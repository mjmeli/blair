import { GoogleGenerativeAI } from '@google/generative-ai';
import { spawn } from 'child_process';
import { mkdir, readFile, unlink, stat } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const AUDIO_DIR = '/tmp/blair-audio';

export interface AudioAnalysis {
  vocalization_detected: boolean;
  classification: 'none' | 'fussing' | 'crying' | 'screaming' | 'cooing' | 'babbling' | 'breathing' | 'other';
  intensity: 'none' | 'low' | 'moderate' | 'high';
  cry_type: 'hunger' | 'tired' | 'pain_discomfort' | 'gas' | 'overstimulated' | 'attention' | 'wake_up' | 'unknown' | null;
  confidence: number;
  duration_estimate_seconds: number;
  patterns: string[];
  description: string;
  recommendation: string;
  no_audio_track?: boolean; // true when the clip had no audio stream at all
}

function defaultAnalysis(overrides: Partial<AudioAnalysis> = {}): AudioAnalysis {
  return {
    vocalization_detected: false,
    classification: 'none',
    intensity: 'none',
    cry_type: null,
    confidence: 0,
    duration_estimate_seconds: 0,
    patterns: [],
    description: '',
    recommendation: '',
    ...overrides,
  };
}

// Run ffprobe to check whether the clip has any audio stream
function probeHasAudio(videoUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'default=nw=1:nk=1',
      videoUrl,
    ]);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && out.trim() === 'audio') resolve(true);
      else resolve(false);
    });
    proc.on('error', () => resolve(false));
    setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} resolve(false); }, 15_000);
  });
}

// Extract audio to AAC (widely supported, no extra codec libs needed beyond default ffmpeg)
async function extractAudio(videoUrl: string): Promise<{ path: string; mimeType: string; cleanup: () => Promise<void> }> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const filename = `audio_${Date.now()}_${Math.floor(Math.random() * 10000)}.m4a`;
  const outputPath = path.join(AUDIO_DIR, filename);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoUrl,
      '-vn',                        // drop video
      '-map', '0:a:0',              // first audio stream only (fails fast if none)
      '-c:a', 'aac',                // AAC encoder ships with default ffmpeg
      '-b:a', '96k',
      '-ar', '22050',
      '-ac', '1',                   // mono
      '-t', '90',                   // cap at 90s
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({
          path: outputPath,
          mimeType: 'audio/aac',
          cleanup: async () => { try { await unlink(outputPath); } catch {} },
        });
      } else {
        reject(new Error(`ffmpeg audio extract failed (${code}). stderr tail: ${stderr.slice(-1000)}`));
      }
    });

    ffmpeg.on('error', err => reject(new Error(`ffmpeg spawn error: ${err.message}`)));

    setTimeout(() => { try { ffmpeg.kill('SIGTERM'); } catch {} }, 60_000);
  });
}

export async function analyzeAudio(
  videoUrl: string,
  eventType: string,
  adjustedAgeMonths: number,
): Promise<AudioAnalysis> {
  if (!config.gemini.apiKey) throw new Error('Gemini API key not configured');

  console.log(`[audio] Probing ${eventType} clip for audio stream`);
  const hasAudio = await probeHasAudio(videoUrl);
  if (!hasAudio) {
    console.log('[audio] Clip has no audio stream — returning early');
    return defaultAnalysis({
      no_audio_track: true,
      description: 'This clip has no audio track. Nanit often records short event clips as video-only; audio analysis will only work on clips with sound.',
    });
  }

  console.log(`[audio] Extracting audio to AAC...`);
  const { path: audioPath, mimeType, cleanup } = await extractAudio(videoUrl);

  try {
    const statInfo = await stat(audioPath);
    const sizeMb = statInfo.size / (1024 * 1024);
    console.log(`[audio] Extracted ${sizeMb.toFixed(2)}MB`);
    if (statInfo.size === 0) {
      return defaultAnalysis({ no_audio_track: true, description: 'Extracted audio was empty.' });
    }

    const buffer = await readFile(audioPath);
    const base64 = buffer.toString('base64');

    const prompt = `You are a pediatric specialist trained in infant vocalization analysis. Analyze this audio clip from a baby monitor. The baby is ${Math.round(adjustedAgeMonths * 10) / 10} months old (adjusted age). This clip is from a "${eventType}" event.

Listen carefully for:
- Crying (and what type: hunger, tired, pain/discomfort, gas, overstimulated, attention-seeking, or wake-up fussing)
- Cooing, babbling, breathing sounds
- Intensity and duration
- Rhythm and patterns

Cry type distinctions (based on standard infant cry research):
- "hunger": rhythmic, low-pitched, waxes and wanes, often with sucking/lip sounds
- "tired": whiny, less rhythmic, gets worse over time, often with eye-rubbing sounds
- "pain_discomfort": sudden, sharp, high-pitched, intense and sustained
- "gas": tense, intermittent, often with leg-kicking sounds or straining
- "overstimulated": erratic, building pattern, may include turning-away sounds
- "attention": shorter, pauses to listen, restarts if no response
- "wake_up": fussy, exploratory, escalates if no intervention
- "unknown": when you can't reliably distinguish

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "vocalization_detected": true/false,
  "classification": "none"|"fussing"|"crying"|"screaming"|"cooing"|"babbling"|"breathing"|"other",
  "intensity": "none"|"low"|"moderate"|"high",
  "cry_type": "hunger"|"tired"|"pain_discomfort"|"gas"|"overstimulated"|"attention"|"wake_up"|"unknown"|null,
  "confidence": 0.0-1.0,
  "duration_estimate_seconds": number,
  "patterns": ["rhythmic","escalating","brief","etc"],
  "description": "1-2 sentence plain-english description of what you hear",
  "recommendation": "One specific thing the parent might try based on what you hear (empty string if nothing to suggest)"
}`;

    const model = genAI.getGenerativeModel({
      model: config.gemini.model,
      generationConfig: { maxOutputTokens: 2048, responseMimeType: 'application/json' },
    });

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType, data: base64 } },
    ]);

    let text = result.response.text();
    text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) text = text.slice(firstBrace, lastBrace + 1);

    try {
      return JSON.parse(text);
    } catch {
      console.error('[audio] Failed to parse Gemini response:', text.slice(0, 300));
      return defaultAnalysis({ description: 'Audio analysis could not be parsed.' });
    }
  } finally {
    await cleanup();
  }
}
