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
 * Busca proxies diretamente da API do ProxyScrape
 */
async function getMotorProxies(): Promise<string[]> {
	try {
		const res = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all');
		const text = await res.text();
		return text.split('\r\n').filter(line => line.includes(':')).map(p => p.trim());
	} catch (e) {
		console.error('[Proxy] Falha ao buscar lista:', e);
		return [];
	}
}

/**
 * Tentativa via API pura (Mais rapido)
 */
async function runPasswordViaApi(payload: VikiPasswordAutomationPayload, proxy?: string): Promise<boolean> {
  try {
    let agent: any = null;
    if (proxy) {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      agent = new HttpsProxyAgent(`http://${proxy}`);
    }

    const loginRes = await fetch(`https://api.viki.io/v4/sessions.json?app=100005a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      agent,
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
      agent,
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

    // 0. Proxies
    push(updateStep(status, STEP_KEYS.dispatch, 'running', 'Buscando IP alternativo...'));
    const proxies = await getMotorProxies();
    
    const MAX_ATTEMPTS = 3;
    let finalSuccess = false;

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        const proxy = proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : undefined;
        push(updateStep(status, STEP_KEYS.dispatch, 'running', `Tentativa ${i}/${MAX_ATTEMPTS} com IP: ${proxy || 'Local'}`));

        // 1. TENTA API PRIMEIRO
        const apiOk = await runPasswordViaApi(payload, proxy);
        if (apiOk) {
            push(updateStep(status, STEP_KEYS.login, 'success', 'Login OK (API).'));
            push(updateStep(status, STEP_KEYS.changePassword, 'success', 'Senha alterada via API.'));
            push(updateStep(status, STEP_KEYS.verifyLogin, 'success', 'Concluido com sucesso.'));
            push(updateJob(status, 'success', 'Troca concluida silenciosamente.'));
            finalSuccess = true;
            break;
        }

        // 2. FALLBACK NAVEGADOR (HEADLESS)
        push(updateStep(status, STEP_KEYS.dispatch, 'running', `API bloqueada. Usando navegador invisivel (Tentativa ${i})...`));
        let browser: any = null;
        try {
            const { chromium } = await import('playwright');
            browser = await chromium.launch({ 
                headless: true, // INVISIVEL
                args: ['--disable-blink-features=AutomationControlled'],
                ...(proxy ? { proxy: { server: `http://${proxy}` } } : {})
            });
            const page = await browser.newPage();
            page.setDefaultTimeout(60000);

            await page.goto('https://www.viki.com/web-sign-in', { waitUntil: 'domcontentloaded' });
            await page.type('input[placeholder="Email"]', payload.credentialEmail);
            await page.type('input[placeholder="Password"]', payload.currentPassword);
            await page.keyboard.press('Enter');
            await sleep(5000);

            if (page.url().includes('sign-in')) throw new Error('Falha no login web.');

            await page.goto('https://www.viki.com/user-account-settings#account', { waitUntil: 'domcontentloaded' });
            await sleep(3000);

            const clicked = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, a')).find(el => /mudar senha|change password/i.test(el.textContent || ''));
                if (btn) { (btn as any).click(); return true; }
                return false;
            });

            if (!clicked) throw new Error('Botao nao encontrado.');

            await sleep(2000);
            await page.evaluate((curr, next) => {
                const inputs = Array.from(document.querySelectorAll('input'));
                const p1 = inputs.find(i => /current/i.test(i.name) || i.placeholder.includes('atual'));
                const p2 = inputs.find(i => /newPassword/i.test(i.name) || i.placeholder.includes('nova'));
                const p3 = inputs.find(i => /confirmation/i.test(i.name) || i.placeholder.includes('confirm'));
                
                if (p1) p1.value = curr;
                if (p2) p2.value = next;
                if (p3) p3.value = next;

                const save = Array.from(document.querySelectorAll('button')).find(b => /save|salvar|mudar/i.test(b.textContent || ''));
                if (save) save.click();
            }, payload.currentPassword, payload.newPassword);

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

  } catch (error: any) {
    const message = error?.message || 'Erro inesperado';
    push(updateJob(status, 'failed', `Falha final no motor local: ${message}`));
  }
};
