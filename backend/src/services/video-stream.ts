import { spawn } from 'child_process';
import { mkdir } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import * as nanit from './nanit-client.js';

const CLIPS_DIR = '/tmp/blair-clips';

/**
 * Get the RTMPS stream URL for a baby's camera.
 * Format: rtmps://media-secured.nanit.com/nanit/{baby_uid}.{access_token}
 */
export function getStreamUrl(babyUid: string, accessToken: string): string {
  return `rtmps://media-secured.nanit.com/nanit/${babyUid}.${accessToken}`;
}

/**
 * Capture a short video clip from the Nanit RTMPS stream using ffmpeg.
 * Returns the path to the saved clip file.
 *
 * @param babyUid - Baby's UID
 * @param accessToken - Nanit access token
 * @param durationSeconds - Duration to capture (default 30s)
 * @param label - Optional label for the clip filename
 */
export async function captureClip(
  babyUid: string,
  accessToken: string,
  durationSeconds: number = 30,
  label: string = 'clip',
): Promise<string> {
  await mkdir(CLIPS_DIR, { recursive: true });

  const timestamp = Date.now();
  const filename = `${babyUid}_${label}_${timestamp}.mp4`;
  const outputPath = path.join(CLIPS_DIR, filename);
  const streamUrl = getStreamUrl(babyUid, accessToken);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', streamUrl,
      '-t', String(durationSeconds),
      '-c:v', 'copy',      // Copy video without re-encoding
      '-c:a', 'aac',       // Re-encode audio to AAC
      '-movflags', '+faststart',  // Enable streaming playback
      '-y',                 // Overwrite output
      outputPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`ffmpeg spawn error: ${err.message}`));
    });

    // Safety timeout: kill ffmpeg if it takes too long
    setTimeout(() => {
      ffmpeg.kill('SIGTERM');
    }, (durationSeconds + 30) * 1000);
  });
}

/**
 * Capture a thumbnail/snapshot from the live stream.
 * Returns the path to the saved JPEG file.
 */
export async function captureSnapshot(
  babyUid: string,
  accessToken: string,
): Promise<string> {
  await mkdir(CLIPS_DIR, { recursive: true });

  const timestamp = Date.now();
  const filename = `${babyUid}_snapshot_${timestamp}.jpg`;
  const outputPath = path.join(CLIPS_DIR, filename);
  const streamUrl = getStreamUrl(babyUid, accessToken);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', streamUrl,
      '-frames:v', '1',    // Capture single frame
      '-q:v', '2',         // High quality JPEG
      '-y',
      outputPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg snapshot failed: ${stderr.slice(-500)}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`ffmpeg spawn error: ${err.message}`));
    });

    setTimeout(() => {
      ffmpeg.kill('SIGTERM');
    }, 30000);
  });
}

/**
 * Check if ffmpeg is available on the system.
 */
export async function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * List captured clips for a baby.
 */
export async function listClips(babyUid: string): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  try {
    const files = await readdir(CLIPS_DIR);
    return files
      .filter(f => f.startsWith(babyUid) && f.endsWith('.mp4'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
