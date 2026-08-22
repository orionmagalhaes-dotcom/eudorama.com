import { createVikiPatchrightContext } from './vikiPatchrightBrowser.ts';

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
  return parseProxyConfig(String(rawProxy || ''));
};


const performLogout = async (page: any): Promise<{ ok: boolean; details: string }> => {
  const controls = page.locator(
    'button[aria-label*="Account" i], button[aria-label*="Profile" i], a[aria-label*="Account" i], a[aria-label*="Profile" i], button[aria-label*="Menu" i]'
  );

  if (await controls.count()) {
    try {
      await controls.first().click({ timeout: 1000 });
      await page.waitForTimeout(300);
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
        await genericControls.nth(candidate.index).click({ timeout: 800 });
        await page.waitForTimeout(300);
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

  // Polling dinâmico rápido para confirmar logout
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(200);
    const bodyText = String(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (/Log in|Create Account|Install the app|Watchlist/i.test(bodyText)) {
      return { ok: true, details: 'Logout confirmado' };
    }
  }

  return { ok: true, details: 'Log Out clicado' };
};

const extractVisibleVikiTvError = async (page: any): Promise<string> => {
  return page.evaluate(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const looksLikeTvCodeError = (value) => {
      const lower = normalize(value).toLowerCase();
      if (!lower) return false;
      return (/code|tv|c[oó]digo|codigo|televis/i.test(lower) && /invalid|valid|expired|expir|inv[aá]lid|v[aá]lid|n[aã]o|nao/i.test(lower));
    };
    const selectors = ['[role="alert"]', '[aria-live]', '.alert', '.error', '[class*="error" i]', '[class*="alert" i]'];
    const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).map((element) => normalize(element.innerText || element.textContent || '')).filter(Boolean));
    const allText = normalize(candidates.join(' ') + ' ' + (document.body.innerText || ''));
    const patterns = [
      /Please enter a valid Samsung TV code\./i,
      /Please enter a valid LG TV code\./i,
      /Please enter a valid Android TV code\./i,
      /Code is not valid\.?/i,
      /O c[oó]digo[^.!?]*(?:inv[aá]lido|v[aá]lido)[^.!?]*[.!?]?/i
    ];
    for (const pattern of patterns) {
      const match = allText.match(pattern);
      if (match) return match[0];
    }
    const specific = candidates.find(looksLikeTvCodeError);
    if (specific) return specific;
    const bodySentences = normalize(document.body.innerText || '').split(/(?<=[.!?])\\s+/).map(normalize).filter(Boolean);
    return bodySentences.find(looksLikeTvCodeError) || '';
  })()`);
};

const extractVisibleVikiLoginError = async (page: any): Promise<string> => {
  return page.evaluate(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const looksLikeLoginError = (value) => {
      const lower = normalize(value).toLowerCase();
      if (!lower) return false;
      return /unexpected issue|try again|wrong password|incorrect|invalid|recaptcha|something went wrong|email or password|senha|incorret|inval/i.test(lower);
    };
    const selectors = ['[role="alert"]', '[aria-live]', '.alert', '.error', '[class*="error" i]', '[class*="alert" i]'];
    const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).map((element) => normalize(element.innerText || element.textContent || '')).filter(Boolean));
    const allText = normalize(candidates.join(' ') + ' ' + (document.body.innerText || ''));
    const patterns = [
      /Oh no, something went wrong!/i,
      /There has been an unexpected issue\. Please try again in a few minutes\./i,
      /The email or password you entered did not match our records\. Please double-check and try again\./i,
      /Your password is incorrect\./i
    ];
    for (const pattern of patterns) {
      const match = allText.match(pattern);
      if (match) return match[0];
    }
    const specific = candidates.find(looksLikeLoginError);
    if (specific) return specific;
    const bodySentences = normalize(document.body.innerText || '').split(/(?<=[.!?])\\s+/).map(normalize).filter(Boolean);
    return bodySentences.find(looksLikeLoginError) || '';
  })()`);
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
    const patchrightModule = await import('patchright');
    const { chromium, devices } = patchrightModule as any;

    const proxy = getPatchrightProxyConfig();
    const browserSession = await createVikiPatchrightContext(chromium, devices, proxy, payload.credentialEmail);
    browser = browserSession.browser;
    const context = browserSession.context;
    const page = await context.newPage();

    push(updateStep(status, STEP_KEYS.dispatch, 'success', `${proxy ? 'Navegador iniciado com proxy configurado' : 'Navegador iniciado'} usando perfil isolado da credencial.`));
    push(updateStep(status, STEP_KEYS.login, 'running', 'Abrindo pagina de conexao.'));

    await page.goto(payload.tvUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(300);

    const tvCodeInputSelector = 'input[placeholder*="Enter code" i], input[name="code"], input[name="linkingCode"], input[id="linkingCode"], input[placeholder*="código" i], input[placeholder*="codigo" i]';
    let codeInput = page.locator(tvCodeInputSelector);
    const emailAlreadyVisible = (await page.locator('input[placeholder="Email"], input[type="email"]').count()) > 0;
    const codeAlreadyVisible = (await codeInput.count()) > 0;
    if (!emailAlreadyVisible && !codeAlreadyVisible) {
      const loginCtaClicked = await clickLoginCta(page);
      if (!loginCtaClicked) {
        throw new Error('Botao Log in nao encontrado');
      }
      try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch {
        // SPA ou já navegou
      }
      await page.waitForTimeout(300);
      await clickFirstText(page, ['Continue with Email', 'Continuar com Email', 'Continuar com e-mail']).catch(() => false);
      await page.waitForTimeout(300);
    }

    if (!codeAlreadyVisible) {
      const emailInput = page.locator('input[placeholder="Email"], input[type="email"], input[name*="email" i]');
      const passwordInput = page.locator('input[placeholder="Password"], input[placeholder="Senha"], input[type="password"], input[name*="password" i], input[name*="senha" i]');

      if (!(await emailInput.count()) || !(await passwordInput.count())) {
        throw new Error('Formulario de login nao encontrado');
      }

      await emailInput.first().fill(payload.credentialEmail);
      await passwordInput.first().fill(payload.credentialPassword);

      const continueClicked = await clickExactText(page, ['Continue', 'Continuar', 'Prosseguir', 'Entrar', 'Log in', 'Fazer login', 'Sign in']);
      if (!continueClicked) throw new Error('Botao Continue nao encontrado');

      // Polling inteligente para aguardar conclusão do login
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(200);
        const codeVisibleNow = (await page.locator(tvCodeInputSelector).count().catch(() => 0)) > 0;
        const loginVisibleNow = (await page.locator('input[placeholder="Email"], input[type="email"]').count().catch(() => 0)) > 0;
        if (codeVisibleNow || !loginVisibleNow) break;
      }

      const stillOnLoginForm = (await page.locator('input[placeholder="Email"], input[type="email"]').count()) > 0;
      if (stillOnLoginForm) {
        const bodyText = await page.locator('body').innerText();
        const vikiLoginErrorText = await extractVisibleVikiLoginError(page);
        const fs = await import('fs');
        if (!fs.existsSync('artifacts')) fs.mkdirSync('artifacts');
        fs.writeFileSync('artifacts/tv_error_body.txt', bodyText);
        await page.screenshot({ path: 'artifacts/tv_error_login.png', fullPage: true }).catch(() => undefined);
        throw new Error(vikiLoginErrorText || 'Login nao concluido na Viki');
      }
    }

    push(updateStep(status, STEP_KEYS.login, 'success', 'Login executado.'));
    push(updateStep(status, STEP_KEYS.code, 'running', 'Preenchendo codigo da TV.'));

    codeInput = page.locator(tvCodeInputSelector);
    if (!(await codeInput.count())) {
      await page.goto(payload.tvUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(500);
      codeInput = page.locator(tvCodeInputSelector);
    }
    const cleanTvCode = String(payload.tvCode || '').toLowerCase().trim();
    await codeInput.first().focus().catch(() => {});
    await codeInput.first().click({ clickCount: 3 }).catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await codeInput.first().fill(cleanTvCode);
    await page.keyboard.type(cleanTvCode, { delay: 40 }).catch(() => {});

    let linkClicked = false;
    const formSubmitBtn = page.locator('form button[type="submit"], form button, button[class*="submit" i], button[class*="link" i], [data-testid*="link" i]');
    if (await formSubmitBtn.count()) {
      try {
        await formSubmitBtn.first().click({ timeout: 1500 });
        linkClicked = true;
      } catch {
        linkClicked = false;
      }
    }

    if (!linkClicked) {
      linkClicked = await clickFirstText(page, [
        'Link Now', 'Conectar agora', 'Vincular Agora', 'Vincular TV', 'Vincular agora',
        'Link TV', 'Link Device', 'Vincular'
      ]);
    }

    if (!linkClicked) {
      try {
        await codeInput.first().press('Enter', { timeout: 2000 });
      } catch {
        // Ignora caso o elemento tenha sido desativado ou sumido
      }
    }

    // Polling dinâmico rápido aguardando resposta da vinculação do código da TV
    let bodyAfterCode = '';
    let hasErrorAlert = false;
    let invalidCode = false;
    let isInputStillThere = true;
    let isSuccessText = false;

    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(250);
      bodyAfterCode = String(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      hasErrorAlert = (await page.locator('[role="alert"], .alert, .error, .sc-4f811a15-0').count().catch(() => 0)) > 0;
      invalidCode = hasErrorAlert || /Code is not valid|valid.*TV Code|não é válido|código inválido/i.test(bodyAfterCode);

      try {
        isInputStillThere = (await page.locator(tvCodeInputSelector).count()) > 0;
      } catch {
        isInputStillThere = false;
      }

      isSuccessText = /bem-sucedida|conectada|sucesso|success|linked|device linked/i.test(bodyAfterCode);

      // Avança imediatamente se houve erro, se o input sumiu (sucesso) ou se texto de sucesso apareceu
      if (invalidCode || !isInputStillThere || isSuccessText) {
        break;
      }
    }

    const vikiErrorText = await extractVisibleVikiTvError(page).catch(() => '');

    if (invalidCode || (isInputStillThere && !isSuccessText)) {
      throw new Error(vikiErrorText || 'O codigo inserido e invalido ou ja expirou. Verifique o codigo exibido na TV e tente novamente.');
    }

    push(
      updateStep(
        status,
        STEP_KEYS.code,
        'success',
        'Codigo enviado para vinculacao.'
      )
    );

    push(updateStep(status, STEP_KEYS.logout, 'running', 'Preservando sessao isolada da credencial.'));
    push(updateStep(status, STEP_KEYS.logout, 'success', 'Sessao mantida ativa para conexoes instantaneas.'));

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
