import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

let key = '';

// Helper to extract key
function extractKey(filePath) {
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf8');
    const match = content.match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

key = extractKey('.env') || extractKey('.env.production') || extractKey('.env.local');

if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not found in env files.');
  process.exit(1);
}

process.env.SUPABASE_SERVICE_ROLE_KEY = key;

console.log('Found service role key, running upload-viki-mobile-video.mjs...');
// Exec the script with node and pass env
try {
  const output = execSync('node scripts/upload-viki-mobile-video.mjs public/media/wetv/como-conectar-no-celular.mp4 wetv/como-conectar-no-celular.mp4', {
    env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: key },
    encoding: 'utf8'
  });
  console.log(output);
} catch (e) {
  console.error('Error during upload:', e.stdout || e.stderr || e.message);
  process.exit(1);
}
