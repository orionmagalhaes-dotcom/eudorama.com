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
        // next
      }
    }
  }
  return false;
};

const clickLoginCta = async (page: any): Promise<boolean> => {
  // Textos EXATOS (EN/PT) para evitar match parcial em "entrar\u00e3o em vigor"
  const LOGIN_LABELS = ['Log in', 'Entrar', 'Iniciar sess\u00e3o', 'Iniciar sessao', 'Fazer login', 'Sign in'];
  for (const label of LOGIN_LABELS) {
    const loc = page.getByRole('link', { name: label, exact: true })
      .or(page.getByRole('button', { name: label, exact: true }));
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      let box: { y: number } | null = null;
      try { box = await el.boundingBox(); } catch { box = null; }
      if (!box) continue;
      try { await el.click({ timeout: 2000 }); return true; } catch { /* next */ }
    }
  }
  // Fallback: link href de sign-in, excluindo /legal
  const hrefLoc = page.locator('a[href*="/sign-in"]:not([href*="/legal"]), a[href*="/web-sign-in"]:not([href*="/legal"])');
  if (await hrefLoc.count()) {
    try { await hrefLoc.first().click({ timeout: 2000 }); return true; } catch { /* ignore */ }
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

    const emailAlreadyVisible = (await page.locator('input[placeholder="Email"], input[type="email"]').count()) > 0;
    if (!emailAlreadyVisible) {
      const loginCtaClicked = await clickLoginCta(page);
      if (!loginCtaClicked) {
        throw new Error('Botao Log in nao encontrado');
      }
      // Aguarda nav para pagina de login concluir
      try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch {
        // pode já ter navegado ou ser SPA
      }
      await page.waitForTimeout(1500);
      // Pode aparecer tela de selecao de metodo (EN: "Continue with Email" | PT: "Continuar com Email")
      await clickFirstText(page, ['Continue with Email', 'Continuar com Email', 'Continuar com e-mail']).catch(() => false);
      await page.waitForTimeout(800);
    }

    // EN: "Email" | PT: qualquer input de email
    const emailInput = page.locator('input[placeholder="Email"], input[type="email"], input[name*="email" i]');
    // EN: "Password" | PT: "Senha"
    const passwordInput = page.locator('input[placeholder="Password"], input[placeholder="Senha"], input[type="password"], input[name*="password" i], input[name*="senha" i]');

    if (!(await emailInput.count()) || !(await passwordInput.count())) {
      throw new Error('Formulario de login nao encontrado');
    }

    await emailInput.first().fill(payload.credentialEmail);
    await passwordInput.first().fill(payload.credentialPassword);

    // EN: "Continue" | PT: "Continuar", "Prosseguir", "Entrar"
    const continueClicked = await clickExactText(page, ['Continue', 'Continuar', 'Prosseguir', 'Entrar', 'Log in', 'Fazer login', 'Sign in']);
    if (!continueClicked) throw new Error('Botao Continue nao encontrado');

    await page.waitForTimeout(3500);
    const stillOnLoginForm = (await page.locator('input[placeholder="Email"], input[type="email"]').count()) > 0;
    if (stillOnLoginForm) {
      const bodyText = await page.locator('body').innerText();
      const fs = await import('fs');
      if (!fs.existsSync('artifacts')) fs.mkdirSync('artifacts');
      fs.writeFileSync('artifacts/tv_error_body.txt', bodyText);
      throw new Error('Login nao concluido na Viki');
    }

    push(updateStep(status, STEP_KEYS.login, 'success', 'Login executado.'));
    push(updateStep(status, STEP_KEYS.code, 'running', 'Preenchendo codigo da TV.'));

    let codeInput = page.locator('input[placeholder*="Enter code" i], input[name="code"], input[name="linkingCode"], input[id="linkingCode"], input[placeholder*="código" i], input[placeholder*="codigo" i]');
    if (!(await codeInput.count())) {
      // Some sessions do not redirect automatically; force TV page reload.
      await page.goto(payload.tvUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(2200);
      codeInput = page.locator('input[placeholder*="Enter code" i], input[name="code"], input[name="linkingCode"], input[id="linkingCode"], input[placeholder*="código" i], input[placeholder*="codigo" i]');
    }
    if (!(await codeInput.count())) throw new Error('Campo de codigo da TV nao encontrado');

    await codeInput.first().fill(payload.tvCode);
    const linkClicked = await clickFirstText(page, ['Link Now', 'Conectar agora', 'Vincular Agora', 'Vincular TV']);
    if (!linkClicked) {
      await codeInput.first().press('Enter');
    } else {
      await page.waitForTimeout(500);
      await codeInput.first().press('Enter'); // Fallback
    }
    
    await page.waitForTimeout(6000); // Await HTTP response correctly

    const bodyAfterCode = String(await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    const hasErrorAlert = await page.locator('[role="alert"], .alert, .error, .sc-4f811a15-0').count() > 0;
    const invalidCode = hasErrorAlert || /Code is not valid|valid.*TV Code|não é válido|código inválido/i.test(bodyAfterCode);

    const isInputStillThere = (await codeInput.count()) > 0;
    const isSuccessText = /bem-sucedida|conectada|sucesso|success/i.test(bodyAfterCode);

    if (invalidCode || (isInputStillThere && !isSuccessText)) {
      throw new Error('O código inserido é inválido ou já expirou. Verifique o código exibido na TV e tente novamente.');
    }

    push(
      updateStep(
        status,
        STEP_KEYS.code,
        'success',
        'Codigo enviado para vinculacao.'
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
