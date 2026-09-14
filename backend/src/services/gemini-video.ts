import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

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

const ANALYSIS_PROMPT = `You are a pediatric sleep specialist analyzing a baby monitor image/video. Respond with ONLY valid JSON (no markdown, no code fences) in this exact format:
{
  "crying": { "detected": true/false, "confidence": 0.0-1.0, "description": "Brief description" },
  "movement": { "level": "none"|"low"|"moderate"|"high", "description": "What you observe" },
  "coughing": { "detected": true/false, "description": "Brief description" },
  "breathing": { "pattern": "Description", "concerns": [] },
  "position": { "description": "Baby's position", "safe": true/false },
  "environment": { "lighting": "dark/dim/bright", "noise_level": "quiet/moderate/loud", "observations": [] },
  "summary": "2-3 sentence summary for a parent",
  "alerts": []
}`;

function parseAnalysis(text: string): VideoAnalysis {
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      crying: { detected: false, confidence: 0, description: 'Analysis parsing failed' },
      movement: { level: 'none', description: text.slice(0, 200) },
      coughing: { detected: false, description: '' },
      breathing: { pattern: 'Unknown', concerns: [] },
      position: { description: 'Unknown', safe: true },
      environment: { lighting: 'unknown', noise_level: 'unknown', observations: [] },
      summary: text.slice(0, 500),
      alerts: [],
    };
  }
}

/**
 * Analyze a video clip thumbnail/image using Gemini Pro.
 * Uses the thumbnail URL for fast, reliable analysis instead of downloading large video files.
 */
export async function analyzeFromThumbnail(
  thumbnailUrl: string,
  eventType: string,
  eventTitle: string,
  adjustedAgeMonths: number,
): Promise<VideoAnalysis> {
  if (!config.gemini.apiKey) {
    throw new Error('Gemini API key not configured');
  }

  console.log(`[gemini] Analyzing thumbnail for ${eventType}: ${eventTitle}`);

  // Download the thumbnail image
  const response = await fetch(thumbnailUrl);
  if (!response.ok) {
    throw new Error(`Failed to download thumbnail: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = response.headers.get('content-type') || 'image/png';

  console.log(`[gemini] Thumbnail downloaded: ${buffer.byteLength} bytes, ${mimeType}`);

  const model = genAI.getGenerativeModel({ model: config.gemini.model });

  const prompt = `${ANALYSIS_PROMPT}

The baby is ${Math.round(adjustedAgeMonths * 10) / 10} months old (adjusted age). This image is from a "${eventType}" event titled "${eventTitle}".`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType, data: base64 } },
  ]);

  console.log(`[gemini] Analysis complete`);
  return parseAnalysis(result.response.text());
}

/**
 * Analyze a video clip using Gemini Pro.
 * Downloads the clip and sends it inline.
 * For large clips, falls back to thumbnail analysis.
 */
export async function analyzeVideoClip(
  clipUrl: string,
  thumbnailUrl: string | null,
  eventType: string,
  eventTitle: string,
  adjustedAgeMonths: number,
): Promise<VideoAnalysis> {
  if (!config.gemini.apiKey) {
    throw new Error('Gemini API key not configured');
  }

  // Try downloading the clip first
  try {
    console.log(`[gemini] Downloading clip for analysis...`);
    const response = await fetch(clipUrl, { signal: AbortSignal.timeout(15000) }); // 15s timeout
    if (!response.ok) {
      throw new Error(`Clip download failed: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const sizeMb = buffer.byteLength / (1024 * 1024);
    console.log(`[gemini] Clip downloaded: ${sizeMb.toFixed(1)}MB`);

    // If clip is too large (>15MB), fall back to thumbnail
    if (sizeMb > 15) {
      console.log(`[gemini] Clip too large, falling back to thumbnail analysis`);
      if (thumbnailUrl) {
        return analyzeFromThumbnail(thumbnailUrl, eventType, eventTitle, adjustedAgeMonths);
      }
      throw new Error('Clip too large and no thumbnail available');
    }

    const mimeType = response.headers.get('content-type') || 'video/mp4';
    const base64 = Buffer.from(buffer).toString('base64');

    const model = genAI.getGenerativeModel({ model: config.gemini.model });
    const prompt = `${ANALYSIS_PROMPT}

The baby is ${Math.round(adjustedAgeMonths * 10) / 10} months old (adjusted age). This clip is from a "${eventType}" event titled "${eventTitle}".`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType, data: base64 } },
    ]);

    console.log(`[gemini] Video analysis complete`);
    return parseAnalysis(result.response.text());
  } catch (err: any) {
    console.log(`[gemini] Video analysis failed (${err.message}), trying thumbnail...`);
    // Fall back to thumbnail analysis
    if (thumbnailUrl) {
      return analyzeFromThumbnail(thumbnailUrl, eventType, eventTitle, adjustedAgeMonths);
    }
    throw err;
  }
}
