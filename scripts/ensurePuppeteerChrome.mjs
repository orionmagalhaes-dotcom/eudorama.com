import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(projectRoot, '.puppeteer-cache');

// Ensure Puppeteer uses a cache directory that will exist at runtime on Render.
process.env.PUPPETEER_CACHE_DIR = cacheDir;

const exists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

const resolveChromePath = async () => {
  try {
    const mod = await import('puppeteer');
    const exe = mod?.default?.executablePath?.() ?? mod?.executablePath?.();
    return typeof exe === 'string' ? exe : '';
  } catch {
    return '';
  }
};

const ensureChrome = async () => {
  const exe = await resolveChromePath();
  if (exe && exists(exe)) {
    console.log(`[puppeteer] Chrome already present: ${exe}`);
    return 0;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  console.log(`[puppeteer] Installing Chrome into cache dir: ${cacheDir}`);

  const puppeteerBin =
    process.platform === 'win32'
      ? path.join(projectRoot, 'node_modules', '.bin', 'puppeteer.cmd')
      : path.join(projectRoot, 'node_modules', '.bin', 'puppeteer');

  const cmd = exists(puppeteerBin) ? puppeteerBin : process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = exists(puppeteerBin) ? ['browsers', 'install', 'chrome'] : ['puppeteer', 'browsers', 'install', 'chrome'];

  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir }
  });

  return typeof res.status === 'number' ? res.status : 1;
};

process.exit(await ensureChrome());

