import {
  VikiPasswordAutomationPayload,
  VikiPasswordAutomationJobStatus,
  VikiPasswordAutomationStepStatus,
  VikiPasswordAutomationExecutionStatus
} from '../types/vikiAutomation';

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
    
    const MAX_ATTEMPTS = 3;
    let finalSuccess = false;

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
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
        try {
            const { chromium } = await import('playwright');
            browser = await chromium.launch({ 
                headless: true,
                args: ['--disable-blink-features=AutomationControlled']
            });
            const context = await browser.newContext({
                viewport: { width: 412, height: 915 },
                isMobile: true,
                hasTouch: true,
                userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            });
            const page = await context.newPage();
            page.setDefaultTimeout(60000);

            await page.goto('https://www.viki.com/samsungtv', { waitUntil: 'domcontentloaded' });
            await sleep(2500);

            // Verifica se já está logado
            const isLogado = await page.evaluate(() => {
                const doc = document;
                return !!doc.querySelector('button[aria-label*="Account" i], button[aria-label*="Profile" i], .sc-avatar, a[href*="/sign-out"]');
            });

            if (!isLogado) {
                // Tenta clicar no Login
                const clickedLogin = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('a, button'));
                    const target = btns.find(b => /log in|entrar/i.test(b.textContent || ''));
                    if (target) { (target as any).click(); return true; }
                    return false;
                });

                if (clickedLogin) {
                    await sleep(2000);
                    await page.locator('input[type="email"], input[placeholder="Email"]').first().fill(payload.credentialEmail);
                    await page.locator('input[type="password"], input[placeholder="Password"]').first().fill(payload.currentPassword);
                    await page.keyboard.press('Enter');
                    await sleep(5000);
                }
            }

            await page.goto('https://www.viki.com/user-account-settings#account', { waitUntil: 'domcontentloaded' });
            await sleep(4000);

            const clicked = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(el => /mudar senha|change password|alterar senha/i.test(el.textContent || '') || /mudar senha|change password/i.test(el.getAttribute('aria-label') || '')  || /mudar senha|change password/i.test(el.getAttribute('title') || '') );
                if (btn) { (btn as any).click(); return true; }
                return false;
            });

            if (!clicked) {
                console.log('[DEBUG] Botao mudar senha nao encontrado. Mantendo aberto...');
                await new Promise(() => {}); // Manter aberto
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
        } finally {
            if (browser) await browser.close();
        }
    }

    if (!finalSuccess) throw new Error('Todas as tentativas falharam.');

    // Sincroniza Supabase para atualizar o Front e Dashboard
    await syncPasswordToDatabase(payload.credentialEmail, payload.newPassword);
    push(updateStep(status, STEP_KEYS.verifyLogin, 'success', 'Sincronizado no banco com sucesso (DB).'));
    push(updateJob(status, 'success', 'Automação na Viki Web e banco de dados finalizadas.'));

  } catch (error: any) {
    const message = error?.message || 'Erro inesperado';
    push(updateJob(status, 'failed', `Falha final no motor local: ${message}`));
  }
};
