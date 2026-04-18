#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const DEFAULT_SUPABASE_URL = 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';
const DEFAULT_BASE_URL = 'https://www.viki.com';
const DEFAULT_HEADFUL = true;
const DEFAULT_PERSISTENT_PROFILE = true;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_COOLDOWN_MS = 90000;
const DEFAULT_GUARD_WINDOW_MS = 150000;
const DEFAULT_HUMAN_DELAY_MIN_MS = 900;
const DEFAULT_HUMAN_DELAY_MAX_MS = 2200;
const VIKI_TV_LOGIN_PATH = '/samsungtv';
const VIKI_ACCOUNT_SETTINGS_PATH = '/user-account-settings#account';
const ARTIFACTS_DIR = path.resolve('artifacts', 'password-change');
const DEFAULT_PROFILE_BASE_DIR = path.resolve(ARTIFACTS_DIR, 'profiles');
const RUN_GUARD_FILE = path.join(ARTIFACTS_DIR, 'run-guard.json');

const usage = () => {
  console.log([
    'Uso:',
    '  node scripts/change-viki-password.mjs --email <email> --new-password <senha_nova> [opcoes]',
    '',
    'Opcoes:',
    '  --current-password <senha_atual>   Forca senha atual sem buscar no Supabase',
    '  --base-url <url>                   URL base da Viki (padrao: https://www.viki.com)',
    '  --headful                          Executa com navegador visivel (padrao)',
    '  --headless                         Forca modo headless',
    '  --no-persistent-profile            Nao usa perfil persistente',
    '  --user-data-dir <dir>              Pasta de perfil do navegador',
    '  --human-delay-min-ms <numero>      Delay humano minimo entre acoes',
    '  --human-delay-max-ms <numero>      Delay humano maximo entre acoes',
    '  --skip-db-update                   Nao atualiza senha na tabela credentials',
    '  --max-attempts <numero>            Tentativas maximas (padrao: 2)',
    '  --retry-cooldown-ms <numero>       Espera entre tentativas (padrao: 90000)',
    '  --guard-window-ms <numero>         Bloqueia repeticao rapida (padrao: 150000)',
    '  --skip-run-guard                   Ignora protecao anti-repeticao',
    '  --timeout-ms <numero>              Timeout em ms (padrao: 60000)',
    '  --help                             Mostra esta ajuda'
  ].join('\n'));
};

const parseArgs = (argv) => {
  const options = {
    email: '',
    newPassword: '',
    currentPassword: '',
    baseUrl: DEFAULT_BASE_URL,
    headful: DEFAULT_HEADFUL,
    persistentProfile: DEFAULT_PERSISTENT_PROFILE,
    userDataDir: '',
    humanDelayMinMs: DEFAULT_HUMAN_DELAY_MIN_MS,
    humanDelayMaxMs: DEFAULT_HUMAN_DELAY_MAX_MS,
    skipDbUpdate: false,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    retryCooldownMs: DEFAULT_RETRY_COOLDOWN_MS,
    guardWindowMs: DEFAULT_GUARD_WINDOW_MS,
    skipRunGuard: false,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || '').trim();
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--headful') {
      options.headful = true;
      continue;
    }

    if (arg === '--headless') {
      options.headful = false;
      continue;
    }

    if (arg === '--no-persistent-profile') {
      options.persistentProfile = false;
      continue;
    }

    if (arg === '--skip-db-update') {
      options.skipDbUpdate = true;
      continue;
    }

    if (arg === '--skip-run-guard') {
      options.skipRunGuard = true;
      continue;
    }

    const next = String(argv[i + 1] || '').trim();
    if (!next) {
      throw new Error(`Valor ausente para ${arg}`);
    }

    if (arg === '--email') {
      options.email = next;
      i += 1;
      continue;
    }

    if (arg === '--new-password') {
      options.newPassword = next;
      i += 1;
      continue;
    }

    if (arg === '--current-password') {
      options.currentPassword = next;
      i += 1;
      continue;
    }

    if (arg === '--base-url') {
      options.baseUrl = next.replace(/\/+$/, '');
      i += 1;
      continue;
    }

    if (arg === '--user-data-dir') {
      options.userDataDir = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1000) {
        throw new Error('O valor de --timeout-ms deve ser um numero >= 1000');
      }
      options.timeoutMs = parsed;
      i += 1;
      continue;
    }

    if (arg === '--max-attempts') {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3) {
        throw new Error('O valor de --max-attempts deve ser um numero entre 1 e 3');
      }
      options.maxAttempts = Math.floor(parsed);
      i += 1;
      continue;
    }

    if (arg === '--retry-cooldown-ms') {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 10000) {
        throw new Error('O valor de --retry-cooldown-ms deve ser >= 10000');
      }
      options.retryCooldownMs = Math.floor(parsed);
      i += 1;
      continue;
    }

    if (arg === '--human-delay-min-ms') {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 100) {
        throw new Error('O valor de --human-delay-min-ms deve ser >= 100');
      }
      options.humanDelayMinMs = Math.floor(parsed);
      i += 1;
      continue;
    }

    if (arg === '--human-delay-max-ms') {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 200) {
        throw new Error('O valor de --human-delay-max-ms deve ser >= 200');
      }
      options.humanDelayMaxMs = Math.floor(parsed);
      i += 1;
      continue;
    }

    if (arg === '--guard-window-ms') {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 30000) {
        throw new Error('O valor de --guard-window-ms deve ser >= 30000');
      }
      options.guardWindowMs = Math.floor(parsed);
      i += 1;
      continue;
    }

    throw new Error(`Argumento nao reconhecido: ${arg}`);
  }

  if (options.humanDelayMinMs > options.humanDelayMaxMs) {
    throw new Error('--human-delay-min-ms nao pode ser maior que --human-delay-max-ms');
  }

  return options;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let runtimeOptions = {
  humanDelayMinMs: DEFAULT_HUMAN_DELAY_MIN_MS,
  humanDelayMaxMs: DEFAULT_HUMAN_DELAY_MAX_MS
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const sanitizeForPath = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'default';

const resolveProfileDir = (email, args) => {
  if (args.userDataDir) return args.userDataDir;
  const profileKey = sanitizeForPath(email);
  return path.join(DEFAULT_PROFILE_BASE_DIR, profileKey);
};

const humanPause = async (multiplier = 1) => {
  const min = clamp(Math.floor(runtimeOptions.humanDelayMinMs * multiplier), 100, 30000);
  const max = clamp(Math.floor(runtimeOptions.humanDelayMaxMs * multiplier), min, 45000);
  const delay = Math.floor(min + Math.random() * (max - min + 1));
  await sleep(delay);
};

const extractChallengeSignal = (urlText, bodyText) => {
  const urlLower = String(urlText || '').toLowerCase();
  const bodyLower = String(bodyText || '').toLowerCase();

  if (urlLower.includes('/cdn-cgi/challenge-platform') || urlLower.includes('challenges.cloudflare.com')) {
    return 'challenge_platform';
  }
  if (/just a moment|checking your browser|verify you are human|captcha|human verification|security check|enable javascript and cookies/.test(bodyLower)) {
    return 'challenge_text';
  }
  if (/access denied|forbidden|temporarily blocked|too many requests|429/.test(bodyLower)) {
    return 'rate_limit_or_block';
  }
  return null;
};

const detectChallenge = async (page) => {
  const currentUrl = page.url();
  const bodyText = await extractBodyTextLower(page);
  const signal = extractChallengeSignal(currentUrl, bodyText);
  return {
    signal,
    url: currentUrl,
    bodyText
  };
};

const MOBILE_CONTEXT_OPTIONS = {
  viewport: { width: 412, height: 915 },
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'pt-BR'
};

const launchBrowserContext = async ({ args, email, isolatedProfile = false }) => {
  if (args.persistentProfile) {
    const baseDir = resolveProfileDir(email, args);
    const profileDir = isolatedProfile ? path.join(baseDir, 'verify') : baseDir;
    fs.mkdirSync(profileDir, { recursive: true });

    const persistentOptions = {
      headless: !args.headful,
      ...MOBILE_CONTEXT_OPTIONS
    };

    try {
      const context = await chromium.launchPersistentContext(profileDir, {
        ...persistentOptions,
        channel: 'chrome'
      });
      return {
        context,
        close: async () => {
          await context.close().catch(() => {});
        }
      };
    } catch {
      const context = await chromium.launchPersistentContext(profileDir, persistentOptions);
      return {
        context,
        close: async () => {
          await context.close().catch(() => {});
        }
      };
    }
  }

  const browser = await chromium.launch({ headless: !args.headful });
  const context = await browser.newContext(MOBILE_CONTEXT_OPTIONS);
  return {
    context,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  };
};

const ensureArtifactsDir = () => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
};

const formatMs = (ms) => {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
};

const readRunGuard = () => {
  try {
    if (!fs.existsSync(RUN_GUARD_FILE)) return null;
    const raw = fs.readFileSync(RUN_GUARD_FILE, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const writeRunGuard = (payload) => {
  ensureArtifactsDir();
  fs.writeFileSync(RUN_GUARD_FILE, JSON.stringify(payload, null, 2), 'utf8');
};

const isTransientErrorMessage = (message) => {
  const text = String(message || '').toLowerCase();
  return /temporario|temporary|unexpected issue|something went wrong|try again in a few minutes|temporarily unavailable|timeout|timed out|429|too many requests|anti-bot|challenge|cloudflare|captcha|blocked|rate_limit/.test(text);
};

const enforceRunGuard = ({ skipRunGuard, guardWindowMs }) => {
  if (skipRunGuard) return;
  const previous = readRunGuard();
  if (!previous?.lastStartedAt) return;

  const startedAt = new Date(previous.lastStartedAt).getTime();
  if (!Number.isFinite(startedAt)) return;

  const elapsed = Date.now() - startedAt;
  if (elapsed < guardWindowMs) {
    const remaining = guardWindowMs - elapsed;
    throw new Error(
      `Execucao bloqueada para evitar tentativas em sequencia. Aguarde ${formatMs(remaining)} e tente novamente.`
    );
  }
};

const saveFailureArtifacts = async (page, attempt, stage, errorMessage) => {
  ensureArtifactsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `attempt-${attempt}-${timestamp}`;
  const screenshotPath = path.join(ARTIFACTS_DIR, `${prefix}.png`);
  const htmlPath = path.join(ARTIFACTS_DIR, `${prefix}.html`);
  const contextPath = path.join(ARTIFACTS_DIR, `${prefix}.txt`);

  let currentUrl = '';
  try {
    currentUrl = page.url();
  } catch {
    currentUrl = '';
  }

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {
    // no-op
  }

  try {
    const html = await page.content();
    fs.writeFileSync(htmlPath, html, 'utf8');
  } catch {
    // no-op
  }

  const context = [
    `timestamp=${new Date().toISOString()}`,
    `attempt=${attempt}`,
    `stage=${stage}`,
    `url=${currentUrl}`,
    `error=${errorMessage}`
  ].join('\n');
  fs.writeFileSync(contextPath, context, 'utf8');

  return { screenshotPath, htmlPath, contextPath };
};

const firstVisibleLocator = async (locator) => {
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    try {
      if (await item.isVisible()) return item;
    } catch {
      // no-op
    }
  }
  return null;
};

const clickFirstVisible = async (page, selectors, label) => {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const item = await firstVisibleLocator(locator);
    if (!item) continue;

    try {
      await humanPause(0.7);
      await item.click({ timeout: 3000 });
      await humanPause(0.5);
      return true;
    } catch {
      // try next selector
    }
  }

  if (label) {
    throw new Error(`Nao foi possivel clicar em: ${label}`);
  }
  return false;
};

const fillFirstVisible = async (page, selectors, value, label) => {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const item = await firstVisibleLocator(locator);
    if (!item) continue;
    await humanPause(0.7);
    await item.click({ clickCount: 3, timeout: 3000 });
    await item.press('Backspace');
    await item.fill(value, { timeout: 3000 });
    await humanPause(0.55);
    return true;
  }

  if (label) {
    throw new Error(`Nao foi possivel preencher: ${label}`);
  }
  return false;
};

const tryAcceptCookies = async (page) => {
  await humanPause(0.6);
  await clickFirstVisible(
    page,
    [
      'button:has-text("Accept all")',
      'button:has-text("Aceitar")',
      'button:has-text("I agree")',
      'button:has-text("Concordo")'
    ],
    ''
  ).catch(() => {});
  await humanPause(0.35);
};

const extractBodyTextLower = async (page) => {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return String(bodyText || '').replace(/\s+/g, ' ').trim().toLowerCase();
};

const assertLoginSucceeded = async (page, contextLabel) => {
  const challenge = await detectChallenge(page);
  if (challenge.signal) {
    throw new Error(`${contextLabel} bloqueado por protecao anti-bot (${challenge.signal}).`);
  }

  const emailStillVisible = await page
    .locator('input[type="email"], input[placeholder="Email"]')
    .first()
    .isVisible()
    .catch(() => false);

  if (!emailStillVisible) {
    const currentUrl = page.url().toLowerCase();
    if (/\/sign-in|\/web-sign-in/.test(currentUrl)) {
      throw new Error(`${contextLabel} permaneceu na tela de login.`);
    }
    return;
  }

  const bodyText = await extractBodyTextLower(page);
  if (/wrong password|senha incorreta|invalid password|incorrect password/.test(bodyText)) {
    throw new Error('Login falhou: senha atual parece incorreta.');
  }
  if (/unexpected issue|something went wrong|try again in a few minutes|temporarily unavailable|temporario|too many requests|429/.test(bodyText)) {
    throw new Error(`${contextLabel} retornou erro temporario da Viki.`);
  }

  throw new Error(`${contextLabel} nao foi concluido.`);
};

const isEmailFieldVisible = async (page) =>
  page
    .locator('input[type="email"], input[placeholder="Email"]')
    .first()
    .isVisible()
    .catch(() => false);

const doLoginViaWebsite = async (page, { email, password, baseUrl, timeoutMs }) => {
  page.setDefaultTimeout(timeoutMs);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await humanPause(1.1);
  await tryAcceptCookies(page);
  const challengeAtHome = await detectChallenge(page);
  if (challengeAtHome.signal) {
    throw new Error(`Login web bloqueado por protecao anti-bot (${challengeAtHome.signal}).`);
  }

  const emailVisibleBeforeClick = await isEmailFieldVisible(page);
  if (!emailVisibleBeforeClick) {
    const clickedLoginCta = await clickFirstVisible(
      page,
      [
        'a:has-text("Log in")',
        'button:has-text("Log in")',
        'a:has-text("Entrar")',
        'button:has-text("Entrar")'
      ],
      ''
    );

    if (!clickedLoginCta) {
      await page.goto(`${baseUrl}/web-sign-in?return_to=%2F`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await humanPause(0.9);
    }

    await clickFirstVisible(
      page,
      [
        'button:has-text("Continue with Email")',
        'a:has-text("Continue with Email")',
        'button:has-text("Continue com Email")',
        'button:has-text("Continuar com Email")'
      ],
      ''
    ).catch(() => false);
  }

  await fillFirstVisible(
    page,
    [
      'input[placeholder="Email"]',
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]'
    ],
    email,
    'campo de email'
  );

  await fillFirstVisible(
    page,
    [
      'input[placeholder="Password"]',
      'input[type="password"]',
      'input[name*="password" i]',
      'input[id*="password" i]'
    ],
    password,
    'campo de senha'
  );

  await clickFirstVisible(
    page,
    [
      'button:has-text("Continue")',
      'button:has-text("Log in")',
      'button:has-text("Entrar")',
      'button[type="submit"]'
    ],
    'botao de continuar login'
  );

  await sleep(4500);
  await assertLoginSucceeded(page, 'Login web');
};

const doLoginViaTv = async (page, { email, password, baseUrl, timeoutMs }) => {
  page.setDefaultTimeout(timeoutMs);
  await page.goto(`${baseUrl}${VIKI_TV_LOGIN_PATH}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await humanPause(1.05);
  await tryAcceptCookies(page);
  await humanPause(0.75);
  const challengeAtTv = await detectChallenge(page);
  if (challengeAtTv.signal) {
    throw new Error(`Login TV bloqueado por protecao anti-bot (${challengeAtTv.signal}).`);
  }

  const emailVisibleBeforeClick = await isEmailFieldVisible(page);
  if (!emailVisibleBeforeClick) {
    await clickFirstVisible(
      page,
      [
        'a:has-text("Log in")',
        'button:has-text("Log in")',
        'a:has-text("Entrar")',
        'button:has-text("Entrar")'
      ],
      'botao de login'
    );

    await humanPause(0.7);
  }

  await fillFirstVisible(
    page,
    [
      'input[placeholder="Email"]',
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]'
    ],
    email,
    'campo de email'
  );

  await fillFirstVisible(
    page,
    [
      'input[placeholder="Password"]',
      'input[type="password"]',
      'input[name*="password" i]',
      'input[id*="password" i]'
    ],
    password,
    'campo de senha'
  );

  await clickFirstVisible(
    page,
    [
      'button:has-text("Continue")',
      'button:has-text("Log in")',
      'button:has-text("Entrar")',
      'button[type="submit"]'
    ],
    'botao de continuar login'
  );

  await sleep(4500);
  await assertLoginSucceeded(page, 'Login TV');
};

const doLogin = async (page, params) => {
  try {
    await doLoginViaWebsite(page, params);
    return 'web';
  } catch (webError) {
    const message = webError instanceof Error ? webError.message : String(webError);
    if (/senha atual parece incorreta|wrong password|invalid password|incorrect password/i.test(message)) {
      throw webError;
    }
    if (/anti-bot|challenge|cloudflare|captcha|blocked|too many requests|429/i.test(message)) {
      throw webError;
    }
    console.log(`[warn] Login via web falhou (${message}). Tentando fluxo TV.`);
  }

  await doLoginViaTv(page, params);
  return 'tv';
};

const openAccountSettings = async (page, { baseUrl, timeoutMs }) => {
  page.setDefaultTimeout(timeoutMs);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await humanPause(1.1);
  await tryAcceptCookies(page);
  const challengeAtHome = await detectChallenge(page);
  if (challengeAtHome.signal) {
    throw new Error(`Navegacao bloqueada por protecao anti-bot (${challengeAtHome.signal}).`);
  }

  let openedByMenu = false;
  try {
    await clickFirstVisible(
      page,
      [
        'button[aria-label*="Settings menu" i]',
        'button[aria-label*="Account" i]',
        'button[aria-label*="Profile" i]',
        'button[aria-label*="Menu" i]',
        'a[aria-label*="Settings menu" i]',
        'a[aria-label*="Account" i]',
        'a[aria-label*="Profile" i]',
        '[data-testid*="avatar" i]',
        '[data-testid*="profile" i]'
      ],
      ''
    );

    await sleep(800);

    await clickFirstVisible(
      page,
      [
        'a:has-text("Account Settings")',
        'button:has-text("Account Settings")',
        'a:has-text("Configuracoes de conta")',
        'button:has-text("Configuracoes de conta")'
      ],
      ''
    );
    await sleep(1500);
    openedByMenu = /\/user-account-settings/i.test(page.url());
  } catch {
    // fallback below
  }

  if (!openedByMenu) {
    await page.goto(`${baseUrl}${VIKI_ACCOUNT_SETTINGS_PATH}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await humanPause(0.9);
  }

  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});

  if (!/\/user-account-settings/i.test(page.url())) {
    await page.goto(`${baseUrl}${VIKI_ACCOUNT_SETTINGS_PATH}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await humanPause(0.9);
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
  }

  const bodyText = await extractBodyTextLower(page);
  const challengeAtSettings = extractChallengeSignal(page.url(), bodyText);
  if (challengeAtSettings) {
    throw new Error(`Acesso a configuracoes bloqueado por protecao anti-bot (${challengeAtSettings}).`);
  }
  if (/something's gone wrong|we can't seem to find what you were looking for/.test(bodyText)) {
    throw new Error('Nao foi possivel abrir configuracoes da conta.');
  }
};

const clickPasswordChange = async (page) => {
  const clickedSpecific = await clickFirstVisible(
    page,
    [
      'button[aria-label*="Change Password" i]',
      'a[aria-label*="Change Password" i]',
      'button:has-text("Change password")',
      'a:has-text("Change password")'
    ],
    ''
  );
  if (clickedSpecific) return true;

  const passwordSections = page.locator('section, div, li').filter({ hasText: /Password|Senha/i });
  const sectionCount = await passwordSections.count();
  for (let i = 0; i < sectionCount; i += 1) {
    const section = passwordSections.nth(i);
    const button = await firstVisibleLocator(
      section.locator('button, a').filter({ hasText: /Change password|Change|Mudar|Alterar|Editar/i })
    );
    if (!button) continue;

    const ariaLabel = String((await button.getAttribute('aria-label').catch(() => '')) || '').toLowerCase();
    if (ariaLabel.includes('email')) continue;

    await button.click({ timeout: 3000 });
    return true;
  }

  return clickFirstVisible(
    page,
    [
      'button:has-text("Change password")',
      'a:has-text("Change password")',
      'button:has-text("Mudar senha")',
      'a:has-text("Mudar senha")',
      'button:has-text("Alterar senha")',
      'a:has-text("Alterar senha")'
    ],
    'botao de mudar senha'
  );
};

const fillPasswordChangeForm = async (page, currentPassword, newPassword) => {
  const filled = {
    current: false,
    next: false,
    confirm: false
  };

  filled.current = await fillFirstVisible(
    page,
    [
      'input[name="password"]',
      'input[name*="current" i]',
      'input[id*="current" i]',
      'input[placeholder*="current" i]',
      'input[placeholder*="atual" i]',
      'input[aria-label*="current" i]',
      'input[aria-label*="atual" i]'
    ],
    currentPassword,
    ''
  ).catch(() => false);

  filled.next = await fillFirstVisible(
    page,
    [
      'input[name="newPassword"]',
      'input[name*="new" i]',
      'input[id*="new" i]',
      'input[placeholder*="new" i]',
      'input[placeholder*="nova" i]',
      'input[aria-label*="new" i]',
      'input[aria-label*="nova" i]'
    ],
    newPassword,
    ''
  ).catch(() => false);

  filled.confirm = await fillFirstVisible(
    page,
    [
      'input[name="passwordConfirmation"]',
      'input[name*="confirm" i]',
      'input[id*="confirm" i]',
      'input[placeholder*="confirm" i]',
      'input[placeholder*="retype" i]',
      'input[placeholder*="confirmar" i]',
      'input[aria-label*="confirm" i]',
      'input[aria-label*="confirmar" i]'
    ],
    newPassword,
    ''
  ).catch(() => false);

  if (!filled.current || !filled.next) {
    const visiblePasswordInputs = page.locator('input[type="password"]');
    const total = await visiblePasswordInputs.count();
    if (total < 2) {
      throw new Error('Nao foi possivel encontrar os campos de troca de senha.');
    }

    const input0 = visiblePasswordInputs.nth(0);
    const input1 = visiblePasswordInputs.nth(1);
    await input0.click({ clickCount: 3, timeout: 3000 });
    await input0.press('Backspace');
    await input0.fill(currentPassword, { timeout: 3000 });
    await input1.click({ clickCount: 3, timeout: 3000 });
    await input1.press('Backspace');
    await input1.fill(newPassword, { timeout: 3000 });

    if (total >= 3) {
      const input2 = visiblePasswordInputs.nth(2);
      await input2.click({ clickCount: 3, timeout: 3000 });
      await input2.press('Backspace');
      await input2.fill(newPassword, { timeout: 3000 });
    }
  }
};

const submitPasswordChange = async (page) => {
  await clickFirstVisible(
    page,
    [
      'button:has-text("Change password")',
      'button:has-text("Change Password")',
      'button:has-text("Save")',
      'button:has-text("Update")',
      'button:has-text("Confirm")',
      'button:has-text("Mudar")',
      'button:has-text("Alterar")',
      'button:has-text("Salvar")',
      'button[type="submit"]'
    ],
    'botao de confirmar troca'
  );
};

const verifyLoginWithNewPassword = async (args, { email, newPassword, baseUrl, timeoutMs }) => {
  const session = await launchBrowserContext({ args, email, isolatedProfile: true });
  const { context } = session;
  const page = await context.newPage();
  try {
    await doLogin(page, {
      email,
      password: newPassword,
      baseUrl,
      timeoutMs
    });
    return true;
  } catch {
    return false;
  } finally {
    await session.close();
  }
};

const runPasswordChangeAttempt = async ({ attempt, args, email, currentPassword, newPassword }) => {
  const session = await launchBrowserContext({ args, email, isolatedProfile: false });
  const { context } = session;
  const page = await context.newPage();

  let stage = 'initializing';
  let changed = false;
  let verified = false;

  try {
    stage = 'login_current_password';
    const loginFlow = await doLogin(page, {
      email,
      password: currentPassword,
      baseUrl: args.baseUrl,
      timeoutMs: args.timeoutMs
    });
    console.log(`[ok] Login realizado com a senha atual (fluxo: ${loginFlow}).`);

    stage = 'open_account_settings';
    await openAccountSettings(page, {
      baseUrl: args.baseUrl,
      timeoutMs: args.timeoutMs
    });
    console.log('[ok] Pagina de configuracoes da conta aberta.');

    stage = 'open_password_change';
    await clickPasswordChange(page);
    console.log('[ok] Fluxo de mudanca de senha aberto.');

    stage = 'fill_change_form';
    await fillPasswordChangeForm(page, currentPassword, newPassword);

    stage = 'submit_change_form';
    await submitPasswordChange(page);
    changed = true;
    console.log('[ok] Formulario de troca enviado.');

    stage = 'validate_post_submit_response';
    await sleep(4000);
    const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    const hasExplicitSuccessScreen =
      /password changed|account has been updated with the new password|required to log in again|senha alterada|senha foi alterada com sucesso/.test(
        bodyText
      );
    const challengeAfterSubmit = extractChallengeSignal(page.url(), bodyText);
    if (challengeAfterSubmit) {
      throw new Error(`A Viki bloqueou a sessao apos submit (${challengeAfterSubmit}).`);
    }
    if (/wrong password|senha incorreta|invalid password|incorrect password/.test(bodyText)) {
      throw new Error('A Viki retornou erro de senha durante a troca.');
    }
    if (/same as current|different from current|igual a senha atual|must be different/.test(bodyText)) {
      throw new Error('A Viki rejeitou a troca porque a nova senha e igual a senha atual.');
    }
    if (/unexpected issue|something went wrong|try again in a few minutes|temporarily unavailable|temporario|too many requests|429/.test(bodyText)) {
      throw new Error('A Viki retornou erro temporario apos enviar a troca de senha.');
    }

    if (hasExplicitSuccessScreen) {
      verified = true;
      console.log('[ok] Tela explicita de sucesso detectada. Pulando relogin de verificacao.');
    } else {
      stage = 'verify_new_password_login';
      verified = await verifyLoginWithNewPassword(args, {
        email,
        newPassword,
        baseUrl: args.baseUrl,
        timeoutMs: args.timeoutMs
      });

      if (!verified) {
        throw new Error('Nao consegui validar login com a nova senha apos a troca.');
      }
      console.log('[ok] Nova senha validada com login real.');
    }
    return { changed, verified };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const artifacts = await saveFailureArtifacts(page, attempt, stage, errorMessage);
    console.log(`[info] Evidencias salvas em: ${artifacts.screenshotPath}`);
    console.log(`[info] Evidencias salvas em: ${artifacts.htmlPath}`);
    console.log(`[info] Evidencias salvas em: ${artifacts.contextPath}`);
    throw error;
  } finally {
    await session.close();
  }
};

const main = async () => {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  if (!args.email || !args.newPassword) {
    usage();
    throw new Error('Informe --email e --new-password.');
  }

  runtimeOptions = {
    humanDelayMinMs: args.humanDelayMinMs,
    humanDelayMaxMs: args.humanDelayMaxMs
  };

  enforceRunGuard(args);
  writeRunGuard({
    email: args.email,
    status: 'running',
    lastStartedAt: new Date().toISOString()
  });

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    let credentialRow = null;
    let currentPassword = String(args.currentPassword || '').trim();

    if (!currentPassword || !args.skipDbUpdate) {
      const { data, error } = await supabase
        .from('credentials')
        .select('id,service,email,password,published_at,is_visible')
        .eq('email', args.email)
        .limit(1);

      if (error) throw new Error(`Erro ao buscar credencial: ${error.message}`);
      if (!data || data.length === 0) throw new Error(`Credencial nao encontrada para ${args.email}`);
      credentialRow = data[0];
      if (!currentPassword) currentPassword = String(credentialRow.password || '').trim();
    }

    if (!currentPassword) {
      throw new Error('Senha atual nao encontrada. Use --current-password para informar manualmente.');
    }

    console.log(`[info] Iniciando automacao para ${args.email}`);
    console.log(`[info] Base Viki: ${args.baseUrl}`);
    console.log(`[info] Modo navegador: ${args.headful ? 'headful' : 'headless'}`);
    console.log(`[info] Perfil persistente: ${args.persistentProfile ? 'sim' : 'nao'}`);
    if (args.persistentProfile) {
      console.log(`[info] userDataDir: ${resolveProfileDir(args.email, args)}`);
    }
    console.log(`[info] Protecao anti-repeticao: ${args.skipRunGuard ? 'desativada' : `ativa (${formatMs(args.guardWindowMs)})`}`);
    console.log(`[info] Politica de retry: ${args.maxAttempts} tentativa(s), cooldown ${formatMs(args.retryCooldownMs)}.`);
    console.log(`[info] Delay humano: ${args.humanDelayMinMs}ms a ${args.humanDelayMaxMs}ms.`);

    if (currentPassword === String(args.newPassword || '').trim()) {
      console.log('[warn] A nova senha informada ja e igual a senha atual registrada. Validando login e encerrando sem trocar.');
      const ok = await verifyLoginWithNewPassword(args, {
        email: args.email,
        newPassword: args.newPassword,
        baseUrl: args.baseUrl,
        timeoutMs: args.timeoutMs
      });
      if (!ok) {
        throw new Error('A senha no painel ja e a mesma solicitada, mas o login nao foi validado na Viki.');
      }
      console.log('[ok] Login validado com a senha solicitada. Nenhuma troca necessaria.');
      writeRunGuard({
        email: args.email,
        status: 'success',
        lastStartedAt: new Date().toISOString(),
        lastFinishedAt: new Date().toISOString(),
        message: 'Senha ja estava no valor desejado.'
      });
      return;
    }

    let success = false;
    let lastError = null;

    for (let attempt = 1; attempt <= args.maxAttempts; attempt += 1) {
      console.log(`[info] Tentativa ${attempt}/${args.maxAttempts}.`);
      try {
        const result = await runPasswordChangeAttempt({
          attempt,
          args,
          email: args.email,
          currentPassword,
          newPassword: args.newPassword
        });

        if (!result.changed || !result.verified) {
          throw new Error('A troca nao foi confirmada; senha no banco nao foi alterada.');
        }
        success = true;
        break;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const transient = isTransientErrorMessage(message);
        if (!transient || attempt >= args.maxAttempts) {
          throw error;
        }
        console.log(`[warn] Falha temporaria detectada: ${message}`);
        console.log(`[info] Aguardando ${formatMs(args.retryCooldownMs)} antes da proxima tentativa para evitar bloqueio.`);
        await sleep(args.retryCooldownMs);
      }
    }

    if (!success) {
      throw lastError || new Error('Nao foi possivel concluir a troca.');
    }

    if (args.skipDbUpdate) {
      console.log('[info] --skip-db-update ativo, nao foi feito update na tabela credentials.');
      writeRunGuard({
        email: args.email,
        status: 'success',
        lastStartedAt: new Date().toISOString(),
        lastFinishedAt: new Date().toISOString(),
        message: 'Senha trocada na Viki (sem update no banco por flag).'
      });
      return;
    }

    if (!credentialRow) {
      const { data, error } = await supabase
        .from('credentials')
        .select('id,email')
        .eq('email', args.email)
        .limit(1);
      if (error) throw new Error(`Erro ao localizar credencial para update: ${error.message}`);
      if (!data || data.length === 0) throw new Error('Credencial sumiu antes do update.');
      credentialRow = data[0];
    }

    const { error: updateError } = await supabase
      .from('credentials')
      .update({
        password: args.newPassword,
        published_at: new Date().toISOString()
      })
      .eq('id', credentialRow.id);

    if (updateError) {
      throw new Error(`Senha trocada na Viki, mas falhou ao atualizar banco: ${updateError.message}`);
    }

    console.log('[ok] Senha atualizada no painel (tabela credentials).');
    writeRunGuard({
      email: args.email,
      status: 'success',
      lastStartedAt: new Date().toISOString(),
      lastFinishedAt: new Date().toISOString(),
      message: 'Troca concluida com sucesso.'
    });
  } catch (error) {
    writeRunGuard({
      email: args.email,
      status: 'failed',
      lastStartedAt: new Date().toISOString(),
      lastFinishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

try {
  await main();
  console.log('[fim] Processo concluido com sucesso.');
} catch (error) {
  console.error(`[erro] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

