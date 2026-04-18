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

    // 0. Automação Cloudflare (Sem Proxy)
    push(updateStep(status, STEP_KEYS.dispatch, 'running', 'Iniciando automação...'));
    
    const MAX_ATTEMPTS = 3;
    let finalSuccess = false;

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        push(updateStep(status, STEP_KEYS.dispatch, 'running', `Tentativa ${i}/${MAX_ATTEMPTS} via Conexão Padrão`));

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
        push(updateStep(status, STEP_KEYS.dispatch, 'running', `API bloqueada. Usando navegador VISÍVEL (Tentativa ${i})...`));
        let browser: any = null;
        try {
            const { chromium } = await import('playwright');
            browser = await chromium.launch({ 
                headless: false, // VISÍVEL P/ DEBUG
                args: ['--disable-blink-features=AutomationControlled']
            });
            const context = await browser.newContext({
                viewport: { width: 412, height: 915 },
                userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                isMobile: true,
                hasTouch: true,
                deviceScaleFactor: 2
            });
            const page = await context.newPage();
            page.setDefaultTimeout(60000);

            await page.goto('https://www.viki.com/web-sign-in', { waitUntil: 'domcontentloaded' });
            await sleep(2000);

            // Esperar os campos renderizarem de fato
            await page.waitForLoadState('domcontentloaded');

            // Focar explicitamente no primeiro input de e-mail visível
            try {
                const emailInput = page.locator('input[type="email"], input[placeholder="Email"], input[name*="email" i]').first();
                await emailInput.waitFor({ state: 'visible', timeout: 15000 });
                await emailInput.fill(payload.credentialEmail);
            } catch (e) {
                throw new Error('Campo de e-mail invisível ou nulo na página.');
            }

            await sleep(500);

            // Focar explicitamente no input de senha
            try {
                const passInput = page.locator('input[type="password"], input[placeholder="Password"], input[placeholder="Senha"]').first();
                await passInput.waitFor({ state: 'visible', timeout: 5000 });
                await passInput.click();
                await passInput.fill(payload.currentPassword);
            } catch (e) {
                throw new Error('Campo de senha invisível ou nulo na página.');
            }

            await sleep(1000);

            // Click Continuar igual o worker
            const clickedBtn = await page.evaluate(() => {
                const texts = ['continue', 'continuar', 'entrar', 'log in', 'sign in'];
                const buttons = Array.from(document.querySelectorAll('button, a'));
                for (const btn of buttons) {
                    const t = btn.textContent?.toLowerCase() || '';
                    if (texts.some(txt => t.includes(txt))) {
                        (btn as any).click();
                        return true;
                    }
                }
                return false;
            });

            if (!clickedBtn) {
                await page.keyboard.press('Enter');
            }

            await sleep(5000);

            if (page.url().includes('sign-in')) {
                console.log('[DEBUG] Falha no login, URL ainda contem sign-in. Mantendo aberto...');
                await new Promise(() => {}); // Manter aberto indefinidamente para depuração
            }

            await page.goto('https://www.viki.com/user-account-settings#account', { waitUntil: 'domcontentloaded' });
            await sleep(3000);

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
            await page.evaluate((curr, next) => {
                const inputs = Array.from(document.querySelectorAll('input'));
                const p1 = inputs.find(i => /current/i.test(i.name) || i.placeholder.includes('atual') || i.placeholder.includes('Current'));
                const p2 = inputs.find(i => /newPassword/i.test(i.name) || i.placeholder.includes('nova') || i.placeholder.includes('New'));
                const p3 = inputs.find(i => /confirmation/i.test(i.name) || i.placeholder.includes('confirm') || i.placeholder.includes('Confirm'));
                
                if (p1) p1.value = curr;
                if (p2) p2.value = next;
                if (p3) p3.value = next;

                const btns = Array.from(document.querySelectorAll('button'));
                const save = btns.find(b => /save|salvar|mudar|confirm|pronto/i.test(b.textContent || ''));
                if (save) save.click();
            }, payload.currentPassword, payload.newPassword);

            await sleep(5000);
            push(updateJob(status, 'success', 'Troca concluida via navegador invisivel.'));
            
            console.log('[DEBUG] Processo concluído! Mantendo o navegador aberto 3 minutos para você checar as alterações...');
            await sleep(180000); // 3 minutos

            finalSuccess = true;
            break;
        } catch (err: any) {
            console.error('[Browser Error]', err.message);
        } finally {
            // Em debug visual, vamos pular o fechamento automático sumario
            // if (browser) await browser.close();
        }
    }

    if (!finalSuccess) throw new Error('Todas as tentativas falharam.');

  } catch (error: any) {
    const message = error?.message || 'Erro inesperado';
    push(updateJob(status, 'failed', `Falha final no motor local: ${message}`));
  }
};
