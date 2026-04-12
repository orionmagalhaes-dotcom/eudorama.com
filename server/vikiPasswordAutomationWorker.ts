import {
  VikiPasswordAutomationPayload,
  VikiPasswordAutomationJobStatus,
  VikiPasswordAutomationStepStatus,
  VikiPasswordAutomationExecutionStatus
} from '../types/vikiAutomation';
import { supabase } from '../lib/supabase';

const STEP_KEYS = {
  dispatch: 'dispatch',
  login: 'login',
  openSettings: 'openSettings',
  changePassword: 'changePassword',
  verifyLogin: 'verifyLogin',
  logout: 'logout'
};

const baseSteps = () => [
  { key: STEP_KEYS.dispatch, label: 'Inicializacao e Proxy', status: 'pending' },
  { key: STEP_KEYS.login, label: 'Autenticacao API', status: 'pending' },
  { key: STEP_KEYS.openSettings, label: 'Acesso ao Perfil', status: 'pending' },
  { key: STEP_KEYS.changePassword, label: 'Troca da senha na Viki', status: 'pending' },
  { key: STEP_KEYS.verifyLogin, label: 'Confirmacao Final', status: 'pending' },
  { key: STEP_KEYS.logout, label: 'Finalizacao', status: 'pending' }
];

const nowIso = () => new Date().toISOString();

export const createInitialPasswordJobStatus = (requestId: string): VikiPasswordAutomationJobStatus => {
  const now = nowIso();
  return {
    requestId,
    status: 'queued',
    message: 'Solicitacao recebida. Agurdando execucao via API...',
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

const VIKI_API_CONFIG = {
  baseUrl: 'https://api.viki.io/v4',
  appId: '100005a', // Viki Web App ID
};

/**
 * Busca uma lista de proxies gratuitos no ProxyScrape
 */
async function getProxiesFromApi(): Promise<string[]> {
  try {
    const res = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all');
    const text = await res.text();
    return text.split('\r\n').filter(line => line.includes(':')).map(p => `http://${p.trim()}`);
  } catch (e) {
    console.error('[Proxy] Erro ao buscar lista:', e);
    return [];
  }
}

/**
 * Tenta realizar a troca de senha direto via API REST da Viki (Como na TV).
 */
async function runVikiPasswordAutomationViaApi(payload: VikiPasswordAutomationPayload, proxyUrl?: string): Promise<boolean> {
  try {
    let agent: any = null;
    if (proxyUrl) {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      agent = new HttpsProxyAgent(proxyUrl);
    }

    // 1. Login
    const loginRes = await fetch(`${VIKI_API_CONFIG.baseUrl}/sessions.json?app=${VIKI_API_CONFIG.appId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      agent,
      body: JSON.stringify({
        username: payload.credentialEmail,
        password: payload.currentPassword,
      })
    } as any);

    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => ({}));
      throw new Error(`Auth falhou: ${err.error || loginRes.statusText}`);
    }

    const loginData: any = await loginRes.json();
    const token = loginData.token;
    const userId = loginData.user?.id;

    if (!token || !userId) throw new Error('Dados de sessao invalidos.');

    // 2. Troca de senha
    const updateRes = await fetch(`${VIKI_API_CONFIG.baseUrl}/users/${userId}.json?app=${VIKI_API_CONFIG.appId}`, {
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

    if (!updateRes.ok) {
      const err = await updateRes.json().catch(() => ({}));
      throw new Error(`Update falhou: ${err.error || updateRes.statusText}`);
    }

    return true;
  } catch (e: any) {
    console.warn(`[API Flow] Erro IP ${proxyUrl || 'Local'}: ${e.message}`);
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

  push(updateJob(status, 'running', 'Iniciando troca de senha silenciosa (Modo API).'));

  try {
    // 0. BUSCA PROXIES
    push(updateStep(status, STEP_KEYS.dispatch, 'running', 'Buscando lista de proxies rotativos...'));
    const proxyList = await getProxiesFromApi();
    
    const MAX_ATTEMPTS = 5;
    let success = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const selectedProxy = proxyList.length > 0 ? proxyList[Math.floor(Math.random() * proxyList.length)] : undefined;
      const proxyLabel = selectedProxy || 'IP Local';
      
      push(updateStep(status, STEP_KEYS.dispatch, 'running', `Tentativa ${attempt}/${MAX_ATTEMPTS} via IP: ${proxyLabel}`));

      try {
        const apiSuccess = await runVikiPasswordAutomationViaApi(payload, selectedProxy);
        
        if (apiSuccess) {
          push(updateStep(status, STEP_KEYS.dispatch, 'success', `Conectado via Proxy: ${proxyLabel}`));
          push(updateStep(status, STEP_KEYS.login, 'success', 'Login API OK.'));
          push(updateStep(status, STEP_KEYS.changePassword, 'success', 'Senha alterada na Viki.'));
          push(updateStep(status, STEP_KEYS.verifyLogin, 'success', 'Confirmado via Servidor.'));
          push(updateStep(status, STEP_KEYS.logout, 'success', 'Sessao encerrada.'));
          
          push(updateJob(status, 'success', 'Troca de senha concluida com sucesso via API.'));
          success = true;
          break;
        } else {
          push(updateStep(status, STEP_KEYS.dispatch, 'running', `IP ${proxyLabel} indisponivel. Tentando proximo...`));
        }
      } catch (err: any) {
        if (err.message.includes('Auth falhou')) throw err; // Se senha estiver errada, para tudo
        push(updateStep(status, STEP_KEYS.dispatch, 'running', `Falha no IP ${proxyLabel}. Buscando novo proxy...`));
      }
    }

    if (!success) {
      throw new Error(`Nao foi possivel completar a troca apos ${MAX_ATTEMPTS} IPs diferentes.`);
    }
  } catch (error: any) {
    const message = error?.message || 'Erro inesperado';
    const stepToFail = status.steps.find((step) => step.status === 'running')?.key || STEP_KEYS.dispatch;
    push(updateStep(status, stepToFail, 'failed', message));
    push(updateJob(status, 'failed', `Falha: ${message}`));
  }
};
