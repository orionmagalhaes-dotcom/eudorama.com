#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { chromium, devices } from 'playwright';

const DEFAULT_SUPABASE_URL = 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';
const DEFAULT_BASE_URL = 'https://www.viki.com';
const DEFAULT_TIMEOUT_MS = 60000;
const VIKI_TV_LOGIN_PATH = '/samsungtv';
const VIKI_ACCOUNT_SETTINGS_PATH = '/user-account-settings#account';

const usage = () => {
  console.log([
    'Uso:',
    '  node scripts/change-viki-password.mjs --email <email> --new-password <senha_nova> [opcoes]',
    '',
    'Opcoes:',
    '  --current-password <senha_atual>   Forca senha atual sem buscar no Supabase',
    '  --base-url <url>                   URL base da Viki (padrao: https://www.viki.com)',
    '  --headful                          Executa com navegador visivel',
    '  --skip-db-update                   Nao atualiza senha na tabela credentials',
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
    headful: false,
    skipDbUpdate: false,
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

    if (arg === '--skip-db-update') {
      options.skipDbUpdate = true;
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

    if (arg === '--timeout-ms') {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1000) {
        throw new Error('O valor de --timeout-ms deve ser um numero >= 1000');
      }
      options.timeoutMs = parsed;
      i += 1;
      continue;
    }

    throw new Error(`Argumento nao reconhecido: ${arg}`);
  }

  return options;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      await item.click({ timeout: 3000 });
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
    await item.click({ clickCount: 3, timeout: 3000 });
    await item.press('Backspace');
    await item.fill(value, { timeout: 3000 });
    return true;
  }

  if (label) {
    throw new Error(`Nao foi possivel preencher: ${label}`);
  }
  return false;
};

const tryAcceptCookies = async (page) => {
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
};

const extractBodyTextLower = async (page) => {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return String(bodyText || '').replace(/\s+/g, ' ').trim().toLowerCase();
};

const assertLoginSucceeded = async (page, contextLabel) => {
  const emailStillVisible = await page
    .locator('input[type="email"], input[placeholder="Email"]')
    .first()
    .isVisible()
    .catch(() => false);

  if (!emailStillVisible) return;

  const bodyText = await extractBodyTextLower(page);
  if (/wrong password|senha incorreta|invalid password|incorrect password/.test(bodyText)) {
    throw new Error('Login falhou: senha atual parece incorreta.');
  }
  if (/unexpected issue|try again in a few minutes|temporarily unavailable|temporario/.test(bodyText)) {
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
  await tryAcceptCookies(page);

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
  await tryAcceptCookies(page);
  await sleep(1200);

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

    await sleep(1000);
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
    await doLoginViaTv(page, params);
    return 'tv';
  } catch (tvError) {
    const message = tvError instanceof Error ? tvError.message : String(tvError);
    if (/senha atual parece incorreta|wrong password|invalid password|incorrect password/i.test(message)) {
      throw tvError;
    }
    console.log(`[warn] Login via TV falhou (${message}). Tentando fluxo web.`);
  }

  await doLoginViaWebsite(page, params);
  return 'web';
};

const openAccountSettings = async (page, { baseUrl, timeoutMs }) => {
  page.setDefaultTimeout(timeoutMs);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await tryAcceptCookies(page);

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
  }

  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});

  if (!/\/user-account-settings/i.test(page.url())) {
    await page.goto(`${baseUrl}${VIKI_ACCOUNT_SETTINGS_PATH}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
  }

  const bodyText = await extractBodyTextLower(page);
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

const verifyLoginWithNewPassword = async (browser, { email, newPassword, baseUrl, timeoutMs }) => {
  const context = await browser.newContext({ ...(devices['Pixel 7'] || {}) });
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
    await context.close();
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

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

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

  const browser = await chromium.launch({
    headless: !args.headful
  });

  const context = await browser.newContext({ ...(devices['Pixel 7'] || {}) });
  const page = await context.newPage();

  let changed = false;
  let verified = false;

  try {
    const loginFlow = await doLogin(page, {
      email: args.email,
      password: currentPassword,
      baseUrl: args.baseUrl,
      timeoutMs: args.timeoutMs
    });
    console.log(`[ok] Login realizado com a senha atual (fluxo: ${loginFlow}).`);

    await openAccountSettings(page, {
      baseUrl: args.baseUrl,
      timeoutMs: args.timeoutMs
    });
    console.log('[ok] Pagina de configuracoes da conta aberta.');

    await clickPasswordChange(page);
    console.log('[ok] Fluxo de mudanca de senha aberto.');

    await fillPasswordChangeForm(page, currentPassword, args.newPassword);
    await submitPasswordChange(page);
    changed = true;
    console.log('[ok] Formulario de troca enviado.');

    await sleep(4000);
    const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    if (/wrong password|senha incorreta|invalid password|unexpected issue|error/i.test(bodyText)) {
      throw new Error('A Viki retornou erro de senha durante a troca.');
    }

    verified = await verifyLoginWithNewPassword(browser, {
      email: args.email,
      newPassword: args.newPassword,
      baseUrl: args.baseUrl,
      timeoutMs: args.timeoutMs
    });

    if (!verified) {
      throw new Error('Nao consegui validar login com a nova senha apos a troca.');
    }

    console.log('[ok] Nova senha validada com login real.');
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (!changed || !verified) {
    throw new Error('A troca nao foi confirmada; senha no banco nao foi alterada.');
  }

  if (args.skipDbUpdate) {
    console.log('[info] --skip-db-update ativo, nao foi feito update na tabela credentials.');
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
};

try {
  await main();
  console.log('[fim] Processo concluido com sucesso.');
} catch (error) {
  console.error(`[erro] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

