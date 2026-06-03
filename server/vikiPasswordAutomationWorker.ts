import { createVikiPatchrightContext } from './vikiPatchrightBrowser.ts';

export type VikiPasswordAutomationExecutionStatus = 'queued' | 'running' | 'success' | 'failed';
export type VikiPasswordAutomationStepStatus = 'pending' | 'running' | 'success' | 'failed';

export interface VikiPasswordAutomationStep {
  key: string;
  label: string;
  status: VikiPasswordAutomationStepStatus;
  details?: string;
  updatedAt?: string;
}

export interface VikiPasswordAutomationJobStatus {
  requestId: string;
  status: VikiPasswordAutomationExecutionStatus;
  message: string;
  steps: VikiPasswordAutomationStep[];
  createdAt: string;
  updatedAt: string;
}

export interface VikiPasswordAutomationPayload {
  requestId: string;
  credentialEmail: string;
  currentPassword: string;
  newPassword: string;
}

const STEP_KEYS = {
  dispatch: 'dispatch',
  login: 'login',
  openSettings: 'openSettings',
  changePassword: 'changePassword',
  verifyLogin: 'verifyLogin',
  logout: 'logout'
};

const baseSteps = () => [
  { key: STEP_KEYS.dispatch, label: 'Inicializacao e IP', status: 'pending' },
  { key: STEP_KEYS.login, label: 'Autenticacao (API/Web)', status: 'pending' },
  { key: STEP_KEYS.openSettings, label: 'Acesso as Configuracoes', status: 'pending' },
  { key: STEP_KEYS.changePassword, label: 'Troca da senha na Viki', status: 'pending' },
  { key: STEP_KEYS.verifyLogin, label: 'Finalizacao', status: 'pending' }
];

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

const clickFirstText = async (page: any, texts: string[]): Promise<boolean> => {
  for (const text of texts) {
    const loc = page.getByText(text, { exact: false });
    const count = await loc.count();
    for (let i = 0; i < count; i += 1) {
      try {
        await loc.nth(i).click({ timeout: 1500 });
        return true;
      } catch {
        // try next match
      }
    }
  }
  return false;
};

const clickExactText = async (page: any, texts: string[]): Promise<boolean> => {
  for (const text of texts) {
    const loc = page.getByRole('button', { name: text, exact: true })
      .or(page.getByRole('link', { name: text, exact: true }));
    const count = await loc.count();
    for (let i = 0; i < count; i += 1) {
      try {
        await loc.nth(i).click({ timeout: 1500 });
        return true;
      } catch {
        // try next match
      }
    }
  }
  return false;
};

const clickLoginCta = async (page: any): Promise<boolean> => {
  const labels = ['Log in', 'Entrar', 'Iniciar sessão', 'Iniciar sessao', 'Fazer login', 'Sign in'];
  for (const label of labels) {
    const loc = page.getByRole('link', { name: label, exact: true })
      .or(page.getByRole('button', { name: label, exact: true }));
    const count = await loc.count();
    for (let i = 0; i < count; i += 1) {
      const el = loc.nth(i);
      let box: { y: number } | null = null;
      try { box = await el.boundingBox(); } catch { box = null; }
      if (!box) continue;
      try {
        await el.click({ timeout: 2000 });
        return true;
      } catch {
        // try next match
      }
    }
  }

  const hrefLoc = page.locator('a[href*="/sign-in"]:not([href*="/legal"]), a[href*="/web-sign-in"]:not([href*="/legal"])');
  if (await hrefLoc.count()) {
    try {
      await hrefLoc.first().click({ timeout: 2000 });
      return true;
    } catch {
      // ignore
    }
  }
  return false;
};

const parseProxyConfig = (rawValue: string): { server: string; username?: string; password?: string } | null => {
  const raw = rawValue.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (!parsed.hostname || !parsed.port) return null;
    return {
      server: `${parsed.protocol || 'http:'}//${parsed.hostname}:${parsed.port}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined
    };
  } catch {
    const parts = raw.split(':');
    if (parts.length < 4) return null;
    const [host, port, username, ...passwordParts] = parts;
    if (!host || !port || !username || passwordParts.length === 0) return null;
    return {
      server: `http://${host}:${port}`,
      username,
      password: passwordParts.join(':')
    };
  }
};

const getPatchrightProxyConfig = (): { server: string; username?: string; password?: string } | null => {
  const rawProxy =
    process.env.PATCHRIGHT_PROXY_URL ||
    process.env.VIKI_PROXY_URL ||
    process.env.DECODO_PROXY_URL ||
    '';
  return parseProxyConfig(rawProxy);
};

export const createInitialPasswordJobStatus = (requestId: string): VikiPasswordAutomationJobStatus => {
  const now = nowIso();
  return {
    requestId,
    status: 'queued',
    message: 'Solicitacao recebida pelo motor local.',
    steps: baseSteps(),
    createdAt: now,
    updatedAt: now
  };
};

const updateStep = (
  job: VikiPasswordAutomationJobStatus,
  stepKey: string,
  status: VikiPasswordAutomationStepStatus,
  details?: string
): VikiPasswordAutomationJobStatus => {
  const updatedAt = nowIso();
  const steps = job.steps.map((step) => step.key === stepKey
    ? { ...step, status, details, updatedAt }
    : step);
  return { ...job, steps, updatedAt };
};

const updateJob = (
  job: VikiPasswordAutomationJobStatus,
  status: VikiPasswordAutomationExecutionStatus,
  message: string
): VikiPasswordAutomationJobStatus => ({
  ...job,
  status,
  message,
  updatedAt: nowIso()
});

/**
 * Tentativa via API pura (Mais rapido)
 */
async function runPasswordViaApi(payload: VikiPasswordAutomationPayload): Promise<boolean> {
  try {
    const loginRes = await fetch(`https://api.viki.io/v4/sessions.json?app=100005a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: payload.credentialEmail,
        password: payload.currentPassword,
      })
    } as any);

    if (!loginRes.ok) return false;
    const data: any = await loginRes.json();
    const token = data.token;
    const userId = data.user?.id;

    if (!token || !userId) return false;

    const updateRes = await fetch(`https://api.viki.io/v4/users/${userId}.json?app=100005a`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        user: {
          password: payload.newPassword,
          current_password: payload.currentPassword
        }
      })
    } as any);

    return updateRes.ok;
  } catch {
    return false;
  }
}

/**
 * Sincroniza a nova senha com o banco de dados Supabase
 */
async function syncPasswordToDatabase(email: string, newPassword: string): Promise<void> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.VITE_SUPABASE_URL || 'https://mhiormzpctfoyjbrmxfz.supabase.co';
    const key = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';
    const supabase = createClient(url, key);
    
    console.log(`[DB Sync] Atualizando supabase para a conta ${email}...`);
    const { error } = await supabase.from('credentials').update({ password: newPassword }).eq('email', email);
    
    if (error) {
       console.error('[DB Sync Error] Erro ao sincronizar nova senha:', error.message);
    } else {
       console.log(`[DB Sync] Senha da credencial ${email} atualizada com sucesso no banco para o painel.`);
    }
  } catch (err: any) {
    console.error('[DB Sync Error] Exceção ao atualizar supabase:', err.message);
  }
}

export const runVikiPasswordAutomationJob = async (
  payload: VikiPasswordAutomationPayload,
  onUpdate: (nextStatus: VikiPasswordAutomationJobStatus) => void
): Promise<void> => {
  let status = createInitialPasswordJobStatus(payload.requestId);
  const push = (next: VikiPasswordAutomationJobStatus) => {
    status = next;
    onUpdate(status);
  };

  try {
    push(updateJob(status, 'running', 'Motor local iniciado (Modo Invisivel).'));

    push(updateStep(status, STEP_KEYS.dispatch, 'running', 'Iniciando automação...'));
    
    const MAX_ATTEMPTS = 1;
    let finalSuccess = false;
    let stopRetries = false;

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        if (stopRetries) break;
        const info = `(Tentativa ${i}/${MAX_ATTEMPTS})`;
        push(updateStep(status, STEP_KEYS.dispatch, 'running', `Preparando ambiente ${info}`));

        // 1. TENTA API PRIMEIRO
        const apiOk = await runPasswordViaApi(payload);
        if (apiOk) {
            push(updateStep(status, STEP_KEYS.login, 'success', 'Login OK (API).'));
            push(updateStep(status, STEP_KEYS.changePassword, 'success', 'Senha alterada via API.'));
            push(updateStep(status, STEP_KEYS.verifyLogin, 'success', 'Concluido com sucesso.'));
            push(updateJob(status, 'success', 'Troca concluida silenciosamente.'));
            finalSuccess = true;
            break;
        }

        // 2. FALLBACK NAVEGADOR
        push(updateStep(status, STEP_KEYS.dispatch, 'running', `${info}: Usando navegador invisível...`));
        let browser: any = null;
        let page: any = null;
        try {
            const patchrightModule = await import('patchright');
            const { chromium, devices } = patchrightModule as any;
            const proxy = getPatchrightProxyConfig();
            const browserSession = await createVikiPatchrightContext(chromium, devices, proxy);
            browser = browserSession.browser;
            const context = browserSession.context;
            page = await context.newPage();
            page.setDefaultTimeout(60000);
            let signInApiError = '';

            page.on('response', async (response: any) => {
                try {
                    if (!String(response.url()).includes('/api/users/sign-in')) return;
                    if (response.status() < 400) return;
                    const body = await response.text().catch(() => '');
                    signInApiError = `HTTP ${response.status()} ${body}`.trim();
                } catch {
                    signInApiError = 'Erro no endpoint de login da Viki.';
                }
            });

            await page.goto('https://www.viki.com/samsungtv', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(1200);

            const tvCodeInputSelector = 'input[placeholder*="Enter code" i], input[name="code"], input[name="linkingCode"], input[id="linkingCode"], input[placeholder*="código" i], input[placeholder*="codigo" i]';
            const emailAlreadyVisible = (await page.locator('input[placeholder="Email"], input[type="email"]').count()) > 0;
            const codeAlreadyVisible = (await page.locator(tvCodeInputSelector).count()) > 0;
            if (!emailAlreadyVisible && !codeAlreadyVisible) {
                const loginCtaClicked = await clickLoginCta(page);
                if (!loginCtaClicked) throw new Error('Botao Log in nao encontrado');

                try {
                    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
                } catch {
                    // Pode ser SPA/modal, igual ao fluxo de TV.
                }
                await page.waitForTimeout(1500);
                await clickFirstText(page, ['Continue with Email', 'Continuar com Email', 'Continuar com e-mail']).catch(() => false);
                await page.waitForTimeout(800);
            }

            if (!codeAlreadyVisible) {
            const emailInput = page.locator('input[placeholder="Email"], input[type="email"], input[name*="email" i]');
            const passwordInput = page.locator('input[placeholder="Password"], input[placeholder="Senha"], input[type="password"], input[name*="password" i], input[name*="senha" i]');

            if (!(await emailInput.count()) || !(await passwordInput.count())) {
                throw new Error('Formulario de login nao encontrado');
            }

            await emailInput.first().fill(payload.credentialEmail);
            await passwordInput.first().fill(payload.currentPassword);

            const continueClicked = await clickExactText(page, ['Continue', 'Continuar', 'Prosseguir', 'Entrar', 'Log in', 'Fazer login', 'Sign in']);
            if (!continueClicked) throw new Error('Botao Continue nao encontrado');

            await page.waitForTimeout(3500);
            const stillOnLoginForm = (await page.locator('input[placeholder="Email"], input[type="email"]').count()) > 0;
            if (stillOnLoginForm) {
                const bodyText = String(await page.locator('body').innerText()).replace(/\s+/g, ' ');
                if (/recaptcha_error/i.test(signInApiError)) {
                    throw new Error('Login bloqueado pela Viki: recaptcha_error. A tela mostra "There has been an unexpected issue. Please try again in a few minutes."');
                }
                if (/there has been an unexpected issue|try again in a few minutes|oh no, something went wrong/i.test(bodyText)) {
                    throw new Error(`Login bloqueado pela Viki. ${signInApiError || 'A tela pediu para tentar novamente em alguns minutos.'}`);
                }
                if (/wrong password|incorrect|invalid|senha incorreta|credenciais/i.test(bodyText)) {
                    throw new Error('E-mail ou senha atuais incorretos na Viki.');
                }
                throw new Error(`Login nao concluido na Viki. ${signInApiError || ''}`.trim());
            }
            }

            // Verifica se já está logado
            const isLogado = await page.evaluate(() => {
                const doc = document;
                return !!doc.querySelector('button[aria-label*="Account" i], button[aria-label*="Profile" i], .sc-avatar, a[href*="/sign-out"]');
            });

            if (false && !isLogado) {
                // Tenta clicar no Login
                const clickedLogin = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('a, button'));
                    const target = btns.find(b => /log in|entrar/i.test(b.textContent || ''));
                    if (target) { (target as any).click(); return true; }
                    return false;
                });

                if (clickedLogin) {
                    await sleep(2000);
                    const clickedEmailLogin = await page.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                        const target = btns.find((b) => /continue with email|continuar com email|email/i.test(b.textContent || ''));
                        if (target) { (target as any).click(); return true; }
                        return false;
                    });
                    if (clickedEmailLogin) await sleep(2000);
                    await page.locator('input[type="email"], input[placeholder="Email"]').first().fill(payload.credentialEmail);
                    await page.locator('input[type="password"], input[placeholder="Password"]').first().fill(payload.currentPassword);
                    const clickedContinue = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
                        const target = buttons.find((button) =>
                            /^continue$/i.test((button.textContent || '').trim()) &&
                            !button.disabled
                        );
                        if (target) { target.click(); return true; }
                        return false;
                    });
                    if (!clickedContinue) {
                        throw new Error('Botao Continue de login nao ficou habilitado apos preencher email e senha.');
                    }
                    await sleep(5000);

                    const urlAposLogin = page.url();
                    const loginState = await page.evaluate(() => ({
                        text: (document.body.innerText || '').replace(/\s+/g, ' '),
                        logged: !!document.querySelector('button[aria-label*="Account" i], button[aria-label*="Profile" i], .sc-avatar, a[href*="/sign-out"]')
                    }));

                    if (/recaptcha_error/i.test(signInApiError)) {
                        throw new Error('Login bloqueado pela Viki: recaptcha_error. A tela mostra "There has been an unexpected issue. Please try again in a few minutes."');
                    }
                    if (/there has been an unexpected issue|try again in a few minutes|oh no, something went wrong/i.test(loginState.text)) {
                        throw new Error(`Login bloqueado pela Viki. ${signInApiError || 'A tela pediu para tentar novamente em alguns minutos.'}`);
                    }
                    if (/wrong password|incorrect|invalid|senha incorreta|credenciais/i.test(loginState.text)) {
                        throw new Error('E-mail ou senha atuais incorretos na Viki.');
                    }
                    if (/sign-in|login|web-sign-in/i.test(urlAposLogin) || !loginState.logged) {
                        throw new Error(`Login nao foi concluido antes de abrir as configuracoes. ${signInApiError || ''}`.trim());
                    }
                }
            }

            await page.goto('https://www.viki.com/user-account-settings#account', { waitUntil: 'domcontentloaded' });
            await sleep(6000);

            const settingsTextBeforeChange = String(await page.locator('body').innerText().catch(() => '')).toLowerCase();
            if (!settingsTextBeforeChange.includes(payload.credentialEmail.toLowerCase())) {
                throw new Error(`Sessao Viki autenticada em conta diferente da solicitada. Esperado: ${payload.credentialEmail}`);
            }

            let clicked = false;
            const passwordChange = page.locator('button[aria-label="Change Password"], a[aria-label="Change Password"], [role="button"][aria-label="Change Password"]');
            if ((await passwordChange.count()) > 0) {
                await passwordChange.first().click();
                clicked = true;
            } else {
                clicked = await page.evaluate(() => {
                const blocks = Array.from(document.querySelectorAll('section, article, div, li')) as HTMLElement[];
                for (const block of blocks) {
                    const text = (block.innerText || '').replace(/\s+/g, ' ').trim();
                    if (!/\b(password|senha)\b/i.test(text)) continue;
                    if (!/\b(change|mudar|alterar)\b/i.test(text)) continue;

                    const controls = Array.from(block.querySelectorAll('button, a, [role="button"]')) as HTMLElement[];
                    const change = controls.find((el) =>
                        /\b(change|mudar|alterar)\b/i.test((el.innerText || el.textContent || '').trim()) ||
                        /change password|mudar senha|alterar senha/i.test(el.getAttribute('aria-label') || '') ||
                        /change password|mudar senha|alterar senha/i.test(el.getAttribute('title') || '')
                    );
                    if (change) {
                        change.click();
                        return true;
                    }
                }

                const fallback = Array.from(document.querySelectorAll('button, a, [role="button"]')).find((el) =>
                    /change password|mudar senha|alterar senha/i.test(el.getAttribute('aria-label') || '') ||
                    /change password|mudar senha|alterar senha/i.test(el.getAttribute('title') || '')
                ) as HTMLElement | undefined;
                if (fallback) {
                    fallback.click();
                    return true;
                }
                return false;
                });
            }

            if (!clicked) {
                console.log('[DEBUG] Botao mudar senha nao encontrado. Mantendo aberto...');
                const pageState = await page.evaluate(() => ({
                    url: location.href,
                    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 700),
                    buttons: Array.from(document.querySelectorAll('button, a, [role="button"]'))
                        .map((el) => ({
                            text: (el.textContent || '').trim(),
                            aria: el.getAttribute('aria-label'),
                            title: el.getAttribute('title'),
                        }))
                        .filter((item) => item.text || item.aria || item.title)
                        .slice(0, 30),
                }));
                throw new Error(`Botao "Mudar Senha" nao encontrado apos abrir configuracoes da conta. URL: ${pageState.url}. Texto: ${pageState.text}. Botoes: ${JSON.stringify(pageState.buttons)}`);
            }

            await sleep(2000);
            
            // Foca nos campos de input do tipo password para trocar s senhas 
            console.log('[DEBUG] Preenchendo campos de senhas (atual, nova, confirmar)...');
            const passFields = page.locator('input[type="password"]');
            await passFields.first().waitFor({ state: 'visible', timeout: 5000 });
            
            const count = await passFields.count();
            if (count >= 3) {
               // Playwright nativo dispara os eventos React necessários
               await passFields.nth(0).fill(payload.currentPassword);
               await sleep(300);
               await passFields.nth(1).fill(payload.newPassword);
               await sleep(300);
               await passFields.nth(2).fill(payload.newPassword);
            } else {
               console.log(`[DEBUG] Apenas ${count} campos de senha encontrados. Preenchimento Playwright puro falhou.`);
               // Fallback: Disparar eventos nativos de input via Javascript
               await page.evaluate((curr, next) => {
                   const inputs = Array.from(document.querySelectorAll('input'));
                   const p1 = inputs.find(i => /current/i.test(i.name) || i.placeholder.includes('atual') || i.placeholder.includes('Current'));
                   const p2 = inputs.find(i => /newPassword/i.test(i.name) || i.placeholder.includes('nova') || i.placeholder.includes('New'));
                   const p3 = inputs.find(i => /confirmation/i.test(i.name) || i.placeholder.includes('confirm') || i.placeholder.includes('Confirm'));
                   
                   if (p1) { p1.value = curr; p1.dispatchEvent(new Event('input', { bubbles: true })); }
                   if (p2) { p2.value = next; p2.dispatchEvent(new Event('input', { bubbles: true })); }
                   if (p3) { p3.value = next; p3.dispatchEvent(new Event('input', { bubbles: true })); }
               }, payload.currentPassword, payload.newPassword);
            }

            await sleep(1000);

            const submitClicked = await page.evaluate(() => {
                const isEnabled = (el: Element) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';
                const click = (el: Element, reason: string) => {
                    (el as HTMLElement).click();
                    return reason;
                };

                const direct = document.querySelector('button[data-what="change_password_confirmation_button"], [role="button"][data-what="change_password_confirmation_button"]');
                if (direct && isEnabled(direct)) return click(direct, 'data-what:change_password_confirmation_button');

                const submitTexts = [
                    'change password',
                    'alterar senha',
                    'mudar senha',
                    'modificar senha',
                    'change',
                    'alterar',
                    'mudar',
                    'salvar',
                    'save',
                    'confirmar',
                    'confirm'
                ];
                const containers = Array.from(document.querySelectorAll('#change_password_modal, [role="dialog"], form'));
                const roots = containers.length > 0 ? containers : [document.body];
                for (const root of roots) {
                    const controls = Array.from(root.querySelectorAll('button, input[type="submit"], [role="button"]'));
                    for (const control of controls) {
                        const text = String(control.textContent || (control as HTMLInputElement).value || '').trim().toLowerCase();
                        if (!text || !isEnabled(control)) continue;
                        if (submitTexts.some((candidate) => text === candidate || text.includes(candidate))) {
                            return click(control, `text:${text}`);
                        }
                    }
                }

                const form = document.querySelector('#change_password_modal form, [role="dialog"] form, form') as HTMLFormElement | null;
                if (form) {
                    form.requestSubmit();
                    return 'form.requestSubmit';
                }

                return null;
            });
            if (!submitClicked) {
                const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'))
                    .map((el) => ({
                        text: String(el.textContent || (el as HTMLInputElement).value || '').trim(),
                        dataWhat: el.getAttribute('data-what'),
                        aria: el.getAttribute('aria-label'),
                        disabled: (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true',
                    }))
                    .filter((item) => item.text || item.dataWhat || item.aria)
                    .slice(0, 40)
                );
                throw new Error(`Botao final de troca de senha nao encontrado. Controles: ${JSON.stringify(buttons)}`);
            }
            console.log(`[DEBUG] Submit de troca de senha acionado via ${submitClicked}.`);
            await sleep(8000);

            const successState = await page.evaluate(() => ({
                url: location.href,
                text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1000),
            }));
            if (!/change-password-success/i.test(successState.url) && !/password changed|account has been updated|senha alterada|senha atualizada/i.test(successState.text)) {
                throw new Error(`Viki nao confirmou a troca de senha. URL: ${successState.url}. Texto: ${successState.text}`);
            }

            push(updateStep(status, STEP_KEYS.changePassword, 'success', 'Senha alterada e confirmada pela Viki.'));
            push(updateJob(status, 'success', 'Troca concluida via navegador invisivel.'));
            finalSuccess = true;
            break;
            
            // Tenta clicar usando native Playwright primeiro (mais forte)
            try {
                const saveBtn = page.locator('button:has-text("Alterar"), button:has-text("Salvar"), button:has-text("Save"), button:has-text("Mudar"), button:has-text("Confirm")').first();
                if (await saveBtn.count() > 0) {
                    await saveBtn.click();
                    console.log('[DEBUG] Botão final clicado via Locator Playwright!');
                } else {
                    // Fallback Javascript manual
                    const saved = await page.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        const save = btns.find(b => /save|salvar|mudar|confirm|pronto|alterar/i.test(b.textContent || ''));
                        if (save) { save.click(); return true; }
                        return false;
                    });
                    
                    if (!saved) {
                        throw new Error('Botão de SAIR / SALVAR / ALTERAR não encontrado no código HTML.');
                    } else {
                        console.log('[DEBUG] Botão final clicado via JS Evaluate!');
                    }
                }
            } catch (e: any) {
                console.log('[DEBUG] Erro ao tentar clicar no botão:', e.message);
                throw e;
            }

            await sleep(5000);
            push(updateJob(status, 'success', 'Troca concluida via navegador invisivel.'));
            
            finalSuccess = true;
            break;
        } catch (err: any) {
            console.error('[Browser Error]', err.message);
            if (page) {
                try {
                    const fs = await import('fs');
                    const path = await import('path');
                    const dir = path.join('artifacts', 'password-debug', `${payload.requestId}-${Date.now()}`);
                    fs.mkdirSync(dir, { recursive: true });
                    await page.screenshot({ path: path.join(dir, 'error.png'), fullPage: true });
                    fs.writeFileSync(path.join(dir, 'error.html'), await page.content());
                    fs.writeFileSync(path.join(dir, 'error.txt'), String(err?.message || 'Erro no navegador invisivel'));
                    console.log(`[Password Debug] Screenshot salvo em ${path.join(dir, 'error.png')}`);
                } catch (captureError: any) {
                    console.error('[Password Debug] Falha ao salvar screenshot:', captureError?.message || captureError);
                }
            }
            if (/recaptcha_error|login bloqueado|try again in a few minutes|tentar novamente em alguns minutos/i.test(err?.message || '')) {
                stopRetries = true;
            }
            push(updateStep(status, STEP_KEYS.dispatch, 'failed', `${info}: ${err?.message || 'Erro no navegador invisivel'}`));
        } finally {
            if (browser) await browser.close();
        }
    }

    if (!finalSuccess) {
      const failed = status.steps.find((step) => step.status === 'failed');
      throw new Error(failed?.details || 'Todas as tentativas falharam.');
    }

    // Sincroniza Supabase para atualizar o Front e Dashboard
    await syncPasswordToDatabase(payload.credentialEmail, payload.newPassword);
    push(updateStep(status, STEP_KEYS.verifyLogin, 'success', 'Sincronizado no banco com sucesso (DB).'));
    push(updateJob(status, 'success', 'Automação na Viki Web e banco de dados finalizadas.'));

  } catch (error: any) {
    const message = error?.message || 'Erro inesperado';
    push(updateJob(status, 'failed', `Falha final no motor local: ${message}`));
  }
};
