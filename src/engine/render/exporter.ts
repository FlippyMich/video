/**
 * In-browser video export.
 *
 * Uses WebCodecs to encode H.264 and mp4-muxer to write the container, so a
 * finished MP4 comes out of the browser with no server and no upload. That
 * matters for the audience: a school laptop should not have to send children's
 * work to somebody else's computer to render it.
 *
 * Falls back to a frame-sequence download where WebCodecs is missing (Safari
 * before 16.4, older Firefox), rather than silently producing nothing.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { ExportPreset, Project } from '../types';
import { Player } from './player';

export interface ExportOptions {
  preset: ExportPreset;
  /** Burn the captions into the picture. */
  subtitles?: boolean;
  overlays?: boolean;
  chromaKey?: boolean;
  /** Render only part of the film. */
  from?: number;
  to?: number;
  onProgress?: (done: number, total: number, fps: number) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  frames: number;
  seconds: number;
}

export function canExportVideo(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Pick an H.264 profile/level string for the frame size.
 *
 * Encoders reject a level that can't hold the resolution, and the failure comes
 * back as a bare "not supported" — so the level is derived rather than hardcoded.
 */
function avcCodec(width: number, height: number): string {
  const mb = Math.ceil(width / 16) * Math.ceil(height / 16);
  // High profile (0x64), no constraints, then the level as hex.
  const level = mb > 8192 ? 0x33 : mb > 5120 ? 0x32 : mb > 3600 ? 0x29 : 0x28;
  return `avc1.6400${level.toString(16)}`;
}

export async function exportVideo(project: Project, options: ExportOptions): Promise<ExportResult> {
  if (!canExportVideo()) {
    throw new Error(
      'This browser cannot encode video yet. Chrome, Edge and Safari 16.4+ can; ' +
      'in other browsers, export the frames instead.',
    );
  }

  const { preset } = options;
  const fps = preset.fps;
  const from = options.from ?? 0;
  const to = Math.min(options.to ?? project.meta.duration, project.meta.duration);
  const totalFrames = Math.max(1, Math.round((to - from) * fps));

  const player = new Player(project, {
    width: preset.width,
    height: preset.height,
    quality: 'best',
    subtitles: options.subtitles ?? false,
    overlays: options.overlays ?? true,
    chromaKey: options.chromaKey ?? preset.id.includes('greenscreen'),
  });

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: preset.width,
      height: preset.height,
      frameRate: fps,
    },
    fastStart: 'in-memory',
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e instanceof Error ? e : new Error(String(e)); },
  });

  encoder.configure({
    codec: avcCodec(preset.width, preset.height),
    width: preset.width,
    height: preset.height,
    bitrate: preset.bitrate,
    framerate: fps,
    latencyMode: 'quality',
  });

  const started = performance.now();
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (encodeError) throw encodeError;

      const t = from + i / fps;
      player.render(t, 1 / fps);

      const frame = new VideoFrame(player.output, {
        timestamp: Math.round((i / fps) * 1_000_000),
        duration: Math.round(1_000_000 / fps),
      });
      // A keyframe every two seconds: seeking in an editor is miserable without
      // them, and the size cost at this bitrate is negligible.
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      // Let the encoder drain. Without this the queue grows unbounded and a
      // long film exhausts memory before it finishes.
      if (encoder.encodeQueueSize > 8) {
        await new Promise<void>((resolve) => {
          const check = () => (encoder.encodeQueueSize <= 4 ? resolve() : setTimeout(check, 4));
          check();
        });
      }

      if (i % 5 === 0 || i === totalFrames - 1) {
        const elapsed = (performance.now() - started) / 1000;
        options.onProgress?.(i + 1, totalFrames, (i + 1) / Math.max(0.001, elapsed));
        // Yield to the UI so the progress bar actually moves.
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    await encoder.flush();
    muxer.finalize();
    const buffer = (muxer.target as ArrayBufferTarget).buffer;
    const blob = new Blob([buffer], { type: 'video/mp4' });

    const slug = project.meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'film';
    return {
      blob,
      filename: `${slug}-${preset.id}.mp4`,
      frames: totalFrames,
      seconds: (performance.now() - started) / 1000,
    };
  } finally {
    encoder.close();
    player.dispose();
  }
}

/** Render one frame as a PNG — for thumbnails and posters. */
export async function exportStill(
  project: Project,
  time: number,
  width = 1920,
  height = 1080,
  opts: { subtitles?: boolean; overlays?: boolean } = {},
): Promise<Blob> {
  const player = new Player(project, {
    width, height, quality: 'best',
    subtitles: opts.subtitles ?? false,
    overlays: opts.overlays ?? false,
  });
  try {
    player.render(time, 1 / 30);
    return await new Promise<Blob>((resolve, reject) => {
      player.output.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the frame'))), 'image/png');
    });
  } finally {
    player.dispose();
  }
}

/** Captions as a WebVTT file, for uploading alongside the video. */
export function subtitlesToVTT(project: Project): string {
  const stamp = (t: number) => {
    const h = String(Math.floor(t / 3600)).padStart(2, '0');
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(t % 60)).padStart(2, '0');
    const ms = String(Math.round((t % 1) * 1000)).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  };
  const cues = [...project.subtitles].sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length - 1; i++) {
    cues[i] = { ...cues[i], end: Math.min(cues[i].end, cues[i + 1].start - 0.02) };
  }
  return ['WEBVTT', '', ...cues
    .filter((c) => c.end > c.start)
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`)].join('\n');
}
