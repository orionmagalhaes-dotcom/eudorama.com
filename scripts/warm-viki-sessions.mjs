#!/usr/bin/env node
import { chromium, devices } from 'patchright';
import { createVikiPatchrightContext } from '../server/vikiPatchrightBrowser.ts';

const SUPABASE_URL = 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickFirstText = async (page, texts) => {
  for (const text of texts) {
    const loc = page.getByText(text, { exact: false });
    const count = await loc.count();
    for (let i = 0; i < count; i += 1) {
      try {
        await loc.nth(i).click({ timeout: 1500 });
        return true;
      } catch {}
    }
  }
  return false;
};

const clickExactText = async (page, texts) => {
  for (const text of texts) {
    const loc = page.getByRole('button', { name: text, exact: true })
      .or(page.getByRole('link', { name: text, exact: true }));
    const count = await loc.count();
    for (let i = 0; i < count; i += 1) {
      try {
        await loc.nth(i).click({ timeout: 1500 });
        return true;
      } catch {}
    }
  }
  return false;
};

const clickLoginCta = async (page) => {
  const LOGIN_LABELS = ['Log in', 'Entrar', 'Iniciar sessão', 'Iniciar sessao', 'Fazer login', 'Sign in'];
  for (const label of LOGIN_LABELS) {
    const loc = page.getByRole('link', { name: label, exact: true })
      .or(page.getByRole('button', { name: label, exact: true }));
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      let box = null;
      try { box = await el.boundingBox(); } catch { box = null; }
      if (!box) continue;
      try { await el.click({ timeout: 2000 }); return true; } catch {}
    }
  }
  const hrefLoc = page.locator('a[href*="/sign-in"]:not([href*="/legal"]), a[href*="/web-sign-in"]:not([href*="/legal"])');
  if (await hrefLoc.count()) {
    try { await hrefLoc.first().click({ timeout: 2000 }); return true; } catch {}
  }
  return false;
};

async function warmCredential(cred) {
  const email = cred.email;
  const password = cred.password;
  console.log(`\n========================================`);
  console.log(`[WARM] Iniciando pre-login para: ${email}`);
  
  let session = null;
  try {
    session = await createVikiPatchrightContext(chromium, devices, null, email);
    const page = await session.context.newPage();
    
    await page.goto('https://www.viki.com/samsungtv', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(500);
    
    const tvCodeInputSelector = 'input[placeholder*="Enter code" i], input[name="code"], input[name="linkingCode"], input[id="linkingCode"], input[placeholder*="código" i], input[placeholder*="codigo" i]';
    const codeAlreadyVisible = (await page.locator(tvCodeInputSelector).count()) > 0;
    
    if (codeAlreadyVisible) {
      console.log(`✅ [ALREADY LOGGED IN] ${email} ja esta logado e com sessao pronta!`);
      return { email, status: 'already_logged_in' };
    }
    
    const emailAlreadyVisible = (await page.locator('input[placeholder="Email"], input[type="email"]').count()) > 0;
    if (!emailAlreadyVisible) {
      const ctaClicked = await clickLoginCta(page);
      if (!ctaClicked) {
        console.log(`⚠️ [WARNING] CTA Log in nao encontrado para ${email}`);
      }
      try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }); } catch {}
      await sleep(300);
      await clickFirstText(page, ['Continue with Email', 'Continuar com Email', 'Continuar com e-mail']).catch(() => false);
      await sleep(300);
    }
    
    const emailInput = page.locator('input[placeholder="Email"], input[type="email"], input[name*="email" i]');
    const passwordInput = page.locator('input[placeholder="Password"], input[placeholder="Senha"], input[type="password"], input[name*="password" i], input[name*="senha" i]');
    
    if (!(await emailInput.count()) || !(await passwordInput.count())) {
      console.log(`❌ [ERROR] Formular de login nao localizado para ${email}`);
      return { email, status: 'form_not_found' };
    }
    
    await emailInput.first().fill(email);
    await passwordInput.first().fill(password);
    
    const continueClicked = await clickExactText(page, ['Continue', 'Continuar', 'Prosseguir', 'Entrar', 'Log in', 'Fazer login', 'Sign in']);
    if (!continueClicked) {
      console.log(`❌ [ERROR] Botao de submit de login nao localizado para ${email}`);
      return { email, status: 'continue_not_found' };
    }
    
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      const codeVisible = (await page.locator(tvCodeInputSelector).count().catch(() => 0)) > 0;
      const loginVisible = (await page.locator('input[placeholder="Email"], input[type="email"]').count().catch(() => 0)) > 0;
      if (codeVisible || !loginVisible) break;
    }
    
    const codeNowVisible = (await page.locator(tvCodeInputSelector).count()) > 0;
    if (codeNowVisible) {
      console.log(`🎉 [SUCCESS] Login concluido e sessao salva para: ${email}`);
      return { email, status: 'success' };
    } else {
      console.log(`⚠️ [WARN] Login enviado para ${email}, mas tela de codigo ainda nao apareceu.`);
      return { email, status: 'submitted' };
    }
  } catch (err) {
    console.error(`❌ [EXCEPTION] Falha ao logar ${email}:`, err.message);
    return { email, status: 'error', error: err.message };
  } finally {
    if (session?.context) {
      await session.context.close().catch(() => {});
    }
  }
}

async function main() {
  console.log('Buscando credenciais Viki no Supabase...');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/credentials?select=service,email,password,is_visible`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  const data = await res.json();
  const vikiCreds = data.filter(c => c.service && c.service.toLowerCase().includes('viki') && c.email && c.password);
  
  console.log(`Encontradas ${vikiCreds.length} credenciais Viki. Efetuando pre-login em lote...`);
  
  const results = [];
  for (const cred of vikiCreds) {
    const res = await warmCredential(cred);
    results.push(res);
    await sleep(1000); // intervalo entre logins
  }
  
  console.log('\n========================================');
  console.log('RESUMO FINAL DOS LOGINS PRE-AQUECIDOS:');
  console.log(JSON.stringify(results, null, 2));
  console.log('========================================');
}

main();
