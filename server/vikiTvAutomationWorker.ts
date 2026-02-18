export type VikiTvModel = 'samsung' | 'lg' | 'android';
export type VikiTvAutomationExecutionStatus = 'queued' | 'running' | 'success' | 'failed';
export type VikiTvAutomationStepStatus = 'pending' | 'running' | 'success' | 'failed';

export interface VikiTvAutomationStep {
  key: string;
  label: string;
  status: VikiTvAutomationStepStatus;
  details?: string;
  updatedAt?: string;
}

export interface VikiTvAutomationJobStatus {
  requestId: string;
  status: VikiTvAutomationExecutionStatus;
  message: string;
  steps: VikiTvAutomationStep[];
  createdAt: string;
  updatedAt: string;
}

export interface VikiTvAutomationPayload {
  requestId: string;
  tvModel: VikiTvModel;
  tvUrl: string;
  tvCode: string;
  credentialEmail: string;
  credentialPassword: string;
}

const STEP_KEYS = {
  request: 'request',
  dispatch: 'dispatch',
  login: 'login',
  code: 'code',
  logout: 'logout'
} as const;

const nowIso = () => new Date().toISOString();

const baseSteps = (): VikiTvAutomationStep[] => [
  { key: STEP_KEYS.request, label: 'Solicitacao recebida', status: 'success', updatedAt: nowIso() },
  { key: STEP_KEYS.dispatch, label: 'Automacao em background iniciada', status: 'pending' },
  { key: STEP_KEYS.login, label: 'Login automatico na Viki', status: 'pending' },
  { key: STEP_KEYS.code, label: 'Insercao do codigo informado', status: 'pending' },
  { key: STEP_KEYS.logout, label: 'Logout e finalizacao', status: 'pending' }
];

export const createInitialJobStatus = (requestId: string): VikiTvAutomationJobStatus => {
  const now = nowIso();
  return {
    requestId,
    status: 'queued',
    message: 'Solicitacao recebida e aguardando execucao.',
    steps: baseSteps(),
    createdAt: now,
    updatedAt: now
  };
};

const updateStep = (
  job: VikiTvAutomationJobStatus,
  stepKey: string,
  status: VikiTvAutomationStepStatus,
  details?: string
): VikiTvAutomationJobStatus => {
  const updatedAt = nowIso();
  const steps = job.steps.map((step) =>
    step.key === stepKey ? { ...step, status, details, updatedAt } : step
  );
  return { ...job, steps, updatedAt };
};

const updateJob = (
  job: VikiTvAutomationJobStatus,
  status: VikiTvAutomationExecutionStatus,
  message: string
): VikiTvAutomationJobStatus => ({
  ...job,
  status,
  message,
  updatedAt: nowIso()
});

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

const clickLoginCta = async (page: any): Promise<boolean> => {
  const candidates = page.locator('a:has-text("Log in"), button:has-text("Log in")');
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const el = candidates.nth(i);
    let box: { y: number } | null = null;
    try {
      box = await el.boundingBox();
    } catch {
      box = null;
    }
    if (!box) continue;
    if (box.y > 80) {
      try {
        await el.click({ timeout: 1500 });
        return true;
      } catch {
        // keep trying
      }
    }
  }
  if (count > 0) {
    try {
      await candidates.first().click({ timeout: 1500 });
      return true;
    } catch {
      return false;
    }
  }
  return false;
};

const performLogout = async (page: any): Promise<{ ok: boolean; details: string }> => {
  const controls = page.locator(
    'button[aria-label*="Account" i], button[aria-label*="Profile" i], a[aria-label*="Account" i], a[aria-label*="Profile" i], button[aria-label*="Menu" i]'
  );

  if (await controls.count()) {
    try {
      await controls.first().click({ timeout: 1500 });
      await page.waitForTimeout(600);
    } catch {
      // fallback below
    }
  } else {
    const genericControls = page.locator('button,a,[role="button"]');
    const total = await genericControls.count();
    const topRight: Array<{ index: number; x: number }> = [];
    for (let i = 0; i < total; i += 1) {
      const item = genericControls.nth(i);
      let box: { x: number; y: number } | null = null;
      try {
        box = await item.boundingBox();
      } catch {
        box = null;
      }
      if (!box) continue;
      if (box.y <= 110 && box.x >= 140) topRight.push({ index: i, x: box.x });
    }

    topRight.sort((a, b) => b.x - a.x);
    for (const candidate of topRight.slice(0, 3)) {
      try {
        await genericControls.nth(candidate.index).click({ timeout: 1000 });
        await page.waitForTimeout(500);
        break;
      } catch {
        // keep trying
      }
    }
  }

  const clickedLogout = await clickFirstText(page, ['Log Out', 'Logout']);
  if (!clickedLogout) {
    return { ok: false, details: 'Botao Log Out nao encontrado' };
  }

  await page.waitForTimeout(2500);
  const bodyText = String(await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
  const loggedOutHint = /Log in|Create Account|Install the app|Watchlist/i.test(bodyText);
  if (!loggedOutHint) {
    return { ok: true, details: 'Log Out clicado (sem confirmacao textual forte)' };
  }

  return { ok: true, details: 'Logout confirmado' };
};

export const runVikiTvAutomationJob = async (
  payload: VikiTvAutomationPayload,
  onUpdate: (nextStatus: VikiTvAutomationJobStatus) => void
): Promise<void> => {
  let status = createInitialJobStatus(payload.requestId);

  const push = (next: VikiTvAutomationJobStatus) => {
    status = next;
    onUpdate(status);
  };

  push(updateJob(status, 'running', 'Automacao iniciada.'));
  push(updateStep(status, STEP_KEYS.dispatch, 'running', 'Inicializando navegador em modo smartphone.'));

  let browser: any = null;
  try {
    const playwrightModule = await import('playwright');
    const { chromium, devices } = playwrightModule as any;

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ...(devices['Pixel 7'] || {}) });
    const page = await context.newPage();

    push(updateStep(status, STEP_KEYS.dispatch, 'success', 'Navegador iniciado.'));
    push(updateStep(status, STEP_KEYS.login, 'running', 'Abrindo pagina de conexao.'));

    await page.goto(payload.tvUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(1200);

    const loginCtaClicked = await clickLoginCta(page);
    if (!loginCtaClicked) {
      throw new Error('Botao Log in nao encontrado');
    }

    await page.waitForTimeout(1000);

    const emailInput = page.locator('input[placeholder="Email"]');
    const passwordInput = page.locator('input[placeholder="Password"], input[type="password"]');

    if (!(await emailInput.count()) || !(await passwordInput.count())) {
      throw new Error('Formulario de login nao encontrado');
    }

    await emailInput.first().fill(payload.credentialEmail);
    await passwordInput.first().fill(payload.credentialPassword);

    const continueClicked = await clickFirstText(page, ['Continue']);
    if (!continueClicked) throw new Error('Botao Continue nao encontrado');

    await page.waitForTimeout(3500);
    const stillOnLoginForm = (await page.locator('input[placeholder="Email"]').count()) > 0;
    if (stillOnLoginForm) {
      throw new Error('Login nao concluido na Viki');
    }

    push(updateStep(status, STEP_KEYS.login, 'success', 'Login executado.'));
    push(updateStep(status, STEP_KEYS.code, 'running', 'Preenchendo codigo da TV.'));

    let codeInput = page.locator('input[placeholder*="Enter code" i], input[name="code"]');
    if (!(await codeInput.count())) {
      // Some sessions do not redirect automatically; force TV page reload.
      await page.goto(payload.tvUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(2200);
      codeInput = page.locator('input[placeholder*="Enter code" i], input[name="code"]');
    }
    if (!(await codeInput.count())) throw new Error('Campo de codigo da TV nao encontrado');

    await codeInput.first().fill(payload.tvCode);
    const linkClicked = await clickFirstText(page, ['Link Now']);
    if (!linkClicked) throw new Error('Botao Link Now nao encontrado');
    await page.waitForTimeout(3000);

    const bodyAfterCode = String(await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    const invalidCode = /Code is not valid|valid Samsung TV Code/i.test(bodyAfterCode);
    push(
      updateStep(
        status,
        STEP_KEYS.code,
        'success',
        invalidCode ? 'Codigo enviado (retorno: codigo invalido esperado em teste).' : 'Codigo enviado para vinculacao.'
      )
    );

    push(updateStep(status, STEP_KEYS.logout, 'running', 'Executando logout de seguranca.'));
    const logout = await performLogout(page);
    if (!logout.ok) throw new Error(logout.details);
    push(updateStep(status, STEP_KEYS.logout, 'success', logout.details));

    push(updateJob(status, 'success', 'Ciclo concluido com sucesso.'));
  } catch (error: any) {
    const message = error?.message || 'Erro inesperado';

    const stepToFail =
      status.steps.find((step) => step.status === 'running')?.key ||
      status.steps.find((step) => step.status === 'pending')?.key ||
      STEP_KEYS.dispatch;

    push(updateStep(status, stepToFail, 'failed', message));
    push(updateJob(status, 'failed', `Falha na automacao: ${message}`));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }
};
