#!/usr/bin/env node
/**
 * Teste bilíngue (EN/PT) de conexão Samsung TV - Viki
 * Login: clientesviki5@gmail.com | Senha: eudorama16 | Código: rkkexw
 */
import { chromium, devices } from 'playwright';

const email = 'clientesviki5@gmail.com';
const password = 'eudorama16';
const tvCode = 'rkkexw';
const tvUrl = 'https://www.viki.com/samsungtv';
const TIMEOUT = 90000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, msg) => console.log(`[${new Date().toISOString().slice(11,23)}] [${tag}] ${msg}`);

// Clica pelo texto — aceita EN e PT
const clickByTexts = async (page, texts) => {
  for (const text of texts) {
    const loc = page.getByText(text, { exact: false });
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      try { await loc.nth(i).click({ timeout: 2000 }); return true; } catch { /* next */ }
    }
  }
  return false;
};

// Clica por texto EXATO para evitar falsos positivos
const clickExactTexts = async (page, texts) => {
  for (const text of texts) {
    const loc = page.getByRole('button', { name: text, exact: true })
      .or(page.getByRole('link', { name: text, exact: true }));
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      try { await loc.nth(i).click({ timeout: 2000 }); return true; } catch { /* next */ }
    }
  }
  return false;
};

// Clica no botão de login com match EXATO (evita "entrarão em vigor")
const clickLoginLink = async (page) => {
  const EXACT_LABELS = ['Log in', 'Entrar', 'Iniciar sessão', 'Iniciar sessao', 'Fazer login', 'Sign in'];
  for (const label of EXACT_LABELS) {
    const loc = page.getByRole('link', { name: label, exact: true })
      .or(page.getByRole('button', { name: label, exact: true }));
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      try {
        if (await el.isVisible()) { await el.click({ timeout: 2000 }); return true; }
      } catch { /* next */ }
    }
  }
  // Fallback: href de sign-in excluindo /legal
  const hrefLoc = page.locator('a[href*="/sign-in"]:not([href*="/legal"]), a[href*="/web-sign-in"]:not([href*="/legal"])');
  const hrefCount = await hrefLoc.count();
  for (let i = 0; i < hrefCount; i++) {
    const el = hrefLoc.nth(i);
    try {
      if (await el.isVisible()) { await el.click({ timeout: 2000 }); return true; }
    } catch { /* next */ }
  }
  return false;
};


const fillField = async (page, selectors, value) => {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if (!(await loc.count())) continue;
    try {
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      await loc.click({ clickCount: 3, timeout: 3000 });
      await loc.fill(value, { timeout: 3000 });
      return true;
    } catch { /* next */ }
  }
  return false;
};

const isLoginFormVisible = async (page) => {
  try { return await page.locator('input[placeholder="Email"], input[type="email"]').first().isVisible(); }
  catch { return false; }
};

const main = async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...(devices['Pixel 7'] || {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  const result = {
    loginPageOpened: false,
    loginCtaClicked: false,
    continueWithEmailClicked: false,
    authenticated: false,
    codeFieldFound: false,
    codeSent: false,
    codeResponse: '',
    loggedOut: false,
    success: false,
    error: null,
  };

  try {
    // ---- ABRIR PAGINA TV ----
    log('tv', `Navegando para ${tvUrl}`);
    await page.goto(tvUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(1800);
    result.loginPageOpened = true;

    // ---- LOGIN CTA ----
    const emailVisible = await isLoginFormVisible(page);
    if (!emailVisible) {
      log('login', 'Clicando em Log in / Entrar...');
      result.loginCtaClicked = await clickLoginLink(page);
      if (!result.loginCtaClicked) throw new Error('Botão Log in não encontrado');

      // Aguarda navegação para página de login concluir
      try {
        await page.waitForURL(/sign-in|login|entrar/, { timeout: 12000 });
        log('login', `Navegado para: ${page.url()}`);
      } catch {
        log('login', `URL após CTA: ${page.url()} (sem nav detectada)`);
      }
      await sleep(1500);

      // Pode aparecer seletor de método (EN: "Continue with Email" | PT: "Continuar com Email")
      result.continueWithEmailClicked = await clickByTexts(page, [
        'Continue with Email', 'Continuar com Email', 'Continuar com e-mail', 'Continuar com o e-mail'
      ]);
      if (result.continueWithEmailClicked) {
        log('login', 'Opção "Continuar com Email" clicada');
        await sleep(800);
      }
    } else {
      log('login', 'Formulário de email já visível — pulando CTA');
    }

    // ---- PREENCHER EMAIL ----
    log('login', 'Preenchendo email...');
    const emailFilled = await fillField(page, [
      'input[placeholder="Email"]', 'input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]'
    ], email);
    if (!emailFilled) throw new Error('Campo de email não encontrado');

    // ---- PREENCHER SENHA ----
    log('login', 'Preenchendo senha...');
    const passwordFilled = await fillField(page, [
      'input[placeholder="Password"]',   // EN
      'input[placeholder="Senha"]',       // PT
      'input[type="password"]',
      'input[name*="password" i]',
      'input[name*="senha" i]',
      'input[id*="password" i]'
    ], password);
    if (!passwordFilled) throw new Error('Campo de senha não encontrado');

    // ---- BOTÃO CONTINUAR ----
    log('login', 'Clicando em Continue / Continuar...');
    const continued = await clickExactTexts(page, [
      'Continue', 'Continuar', 'Prosseguir', 'Log in', 'Entrar', 'Fazer login', 'Sign in'
    ]);
    if (!continued) throw new Error('Botão Continue não encontrado');

    // ---- AGUARDAR RESULTADO DO LOGIN ----
    log('login', 'Aguardando resultado do login (5s)...');
    await sleep(5000);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const bodyLower = bodyText.toLowerCase();

    if (/wrong password|senha incorreta|invalid password|incorrect password/i.test(bodyLower))
      throw new Error(`Login falhou: senha incorreta. Trecho: "${bodyText.slice(0,200)}"`);
    if (/oh no, something went wrong|unexpected issue|try again in a few minutes/i.test(bodyLower))
      throw new Error('Viki retornou erro temporário');
    if (await isLoginFormVisible(page))
      throw new Error(`Login não concluído — formulário ainda visível.\nURL: ${page.url()}\nBody: "${bodyText.slice(0,300)}"`);

    result.authenticated = true;
    log('login', `✅ Autenticado! URL: ${page.url()}`);

    // ---- CAMPO DE CÓDIGO ----
    log('code', 'Procurando campo de código...');
    let codeInput = page.locator('input[placeholder*="Enter code" i], input[name="code"], input[name="linkingCode"], input[id="linkingCode"], input[placeholder*="código" i], input[placeholder*="codigo" i]');

    if (!(await codeInput.count())) {
      log('code', 'Não encontrado — recarregando página TV...');
      await page.goto(tvUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await sleep(2500);
      codeInput = page.locator('input[placeholder*="Enter code" i], input[name="code"], input[placeholder*="code" i]');
    }

    if (!(await codeInput.count())) throw new Error('Campo de código da TV não encontrado');
    result.codeFieldFound = true;

    log('code', `Inserindo código: ${tvCode}`);
    await codeInput.first().click({ clickCount: 3 });
    await codeInput.first().fill(tvCode);

    log('code', 'Clicando em Vincular TV / Link Now...');
    const linked = await clickByTexts(page, ['Link Now', 'Conectar agora', 'Vincular Agora', 'Vincular TV']);
    if (!linked) throw new Error('Botão Link Now não encontrado');

    result.codeSent = true;
    log('code', 'Aguardando resposta (4s)...');
    await page.waitForTimeout(4000);

    const bodyAfterCode = String(await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    const codeInvalid = /Code is not valid|valid Samsung TV Code|não é válido|código inválido/i.test(bodyAfterCode);
    result.codeResponse = codeInvalid ? 'Código inválido (esperado em teste)' : 'Código enviado para vinculação';
    log('code', result.codeResponse);

    // ---- LOGOUT ----
    log('logout', 'Executando logout...');
    const accountMenu = page.locator('button[aria-label*="Account" i], button[aria-label*="Profile" i], button[aria-label*="Menu" i], [data-testid*="avatar" i]');
    if (await accountMenu.count()) {
      await accountMenu.first().click({ timeout: 3000 }).catch(() => {});
      await sleep(700);
    }
    // EN: "Log Out" | PT: "Sair", "Encerrar sessão"
    const logoutDone = await clickByTexts(page, ['Log Out', 'Logout', 'Sair', 'Encerrar sessão', 'Encerrar']);
    result.loggedOut = logoutDone;
    if (logoutDone) { await sleep(2000); log('logout', '✅ Logout efetuado'); }
    else log('logout', '⚠️  Botão Log Out não encontrado — continuando sem logout');

    result.success = true;

  } catch (err) {
    result.error = err.message;
    log('ERRO', err.message);
    try {
      await page.screenshot({ path: './test-tv-connect-erro.png', fullPage: true });
      log('debug', 'Screenshot salvo: test-tv-connect-erro.png');
      const html = await page.content();
      const fs = await import('fs');
      fs.writeFileSync('./test-tv-connect-erro.html', html);
      log('debug', 'HTML salvo: test-tv-connect-erro.html');
    } catch { /* ignore */ }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log('\n========== RESULTADO ==========');
  console.log(JSON.stringify(result, null, 2));
  console.log('================================');
  if (!result.success) process.exitCode = 1;
};

await main();
