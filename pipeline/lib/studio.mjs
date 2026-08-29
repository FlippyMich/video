/**
 * Shared plumbing for the production pipeline.
 *
 * Serves the built app over HTTP (module scripts don't load from file://),
 * launches headless Chromium, and hands back a page with `window.bloom` ready.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

export function serve(dir, port = 0) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(dir, url === '/' ? '/index.html' : url);
    if (!file.startsWith(dir)) { res.writeHead(403).end('no'); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

let chromium = null;
function getChromium() {
  if (chromium) return chromium;
  // Playwright is installed globally in this environment; fall back to a local
  // install so the pipeline also runs on a normal developer machine.
  try {
    chromium = require('/opt/node22/lib/node_modules/playwright').chromium;
  } catch {
    chromium = require('playwright').chromium;
  }
  return chromium;
}

/** Flags that get WebGL2 working on a machine with no GPU. */
export const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--enable-features=SharedArrayBuffer',
  '--js-flags=--max-old-space-size=4096',
  // Keep the 2D canvas on the CPU. The 3D pass still runs through SwiftShader,
  // but the composite canvas is what we read back every frame, and a
  // GPU-backed one turns each toDataURL into a ~2s readback stall.
  '--disable-accelerated-2d-canvas',
];

export async function openStudio({ dist = path.join(ROOT, 'dist'), headless = true, verbose = false } = {}) {
  const { server, url } = await serve(dist);
  const browser = await getChromium().launch({ headless, args: GL_ARGS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await context.newPage();
  if (verbose) {
    page.on('console', (m) => console.log(`  [page:${m.type()}]`, m.text()));
  }
  page.on('pageerror', (e) => console.error('  [page:error]', e.message));

  await page.goto(`${url}/render.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.bloomReady === true, { timeout: 60_000 });

  return {
    page,
    url,
    async close() {
      await browser.close();
      await new Promise((r) => server.close(r));
    },
  };
}

/** Human-readable seconds. */
export function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function bar(done, total, width = 34) {
  const f = Math.round((done / total) * width);
  return `[${'█'.repeat(f)}${'░'.repeat(width - f)}] ${((done / total) * 100).toFixed(1)}%`;
}
