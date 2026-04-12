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
  request: 'request',
  dispatch: 'dispatch',
  login: 'login',
  openSettings: 'open_settings',
  changePassword: 'change_password',
  verifyLogin: 'verify_login',
  logout: 'logout'
} as const;

const BASE_URL = 'https://www.viki.com';
const VIKI_TV_LOGIN_PATH = '/samsungtv';
const VIKI_ACCOUNT_SETTINGS_PATH = '/user-account-settings#account';

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const baseSteps = (): VikiPasswordAutomationStep[] => [
  { key: STEP_KEYS.request, label: 'Solicitacao recebida', status: 'success', updatedAt: nowIso() },
  { key: STEP_KEYS.dispatch, label: 'Automacao em background iniciada', status: 'pending' },
  { key: STEP_KEYS.login, label: 'Login na Viki com senha atual', status: 'pending' },
  { key: STEP_KEYS.openSettings, label: 'Abertura de configuracoes da conta', status: 'pending' },
  { key: STEP_KEYS.changePassword, label: 'Troca da senha na Viki', status: 'pending' },
  { key: STEP_KEYS.verifyLogin, label: 'Validacao de login com nova senha', status: 'pending' },
  { key: STEP_KEYS.logout, label: 'Logout e finalizacao', status: 'pending' }
];

export const createInitialPasswordJobStatus = (requestId: string): VikiPasswordAutomationJobStatus => {
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

const firstVisibleLocator = async (locator: any) => {
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    try {
      if (await item.isVisible()) return item;
    } catch {
      // ignore
    }
  }
  return null;
};

const clickFirstVisible = async (page: any, selectors: string[], label?: string): Promise<boolean> => {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const item = await firstVisibleLocator(locator);
    if (!item) continue;
    try {
      await item.click({ timeout: 3000 });
      return true;
    } catch {
      // try next selector
    }
  }

  if (label) throw new Error(`Nao foi possivel clicar em: ${label}`);
  return false;
};

const clickSubmitButton = async (page: any, label?: string): Promise<boolean> => {
  const EXACT_LABELS = ['Continue', 'Continuar', 'Prosseguir', 'Entrar', 'Log in', 'Sign in', 'Fazer login'];
  for (const text of EXACT_LABELS) {
    const loc = page.getByRole('button', { name: text, exact: true })
      .or(page.getByRole('link', { name: text, exact: true }));
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      try {
        if (await el.isVisible()) {
          await el.click({ timeout: 3000 });
          return true;
        }
      } catch { /* next */ }
    }
  }
  
  // Fallback para button[type="submit"]
  const submitLoc = page.locator('button[type="submit"]');
  const submitCount = await submitLoc.count();
  for (let i = 0; i < submitCount; i++) {
     const subEl = submitLoc.nth(i);
     try {
       if (await subEl.isVisible()) {
          await subEl.click({ timeout: 3000 });
          return true;
       }
     } catch { /* next */ }
  }

  if (label) throw new Error(`Nao foi possivel clicar em: ${label}`);
  return false;
};


/**
 * Clica no bot\u00e3o/link de login usando match EXATO de texto (EN/PT).
 * Evita clicar acidentalmente em links como "entrar\u00e3o em vigor" (pol\u00edtica de privacidade).
 */
const clickLoginButton = async (page: any, label?: string): Promise<boolean> => {
  const EXACT_LABELS = ['Log in', 'Entrar', 'Iniciar sess\u00e3o', 'Iniciar sessao', 'Fazer login', 'Sign in'];
  for (const text of EXACT_LABELS) {
    const loc = page.getByRole('link', { name: text, exact: true })
      .or(page.getByRole('button', { name: text, exact: true }));
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      try {
        if (await el.isVisible()) {
          await el.click({ timeout: 2000 });
          return true;
        }
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
  if (label) throw new Error(`Nao foi possivel clicar em: ${label}`);
  return false;
};


const fillFirstVisible = async (page: any, selectors: string[], value: string, label?: string): Promise<boolean> => {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const item = await firstVisibleLocator(locator);
    if (!item) continue;
    await item.click({ clickCount: 3, timeout: 3000 });
    await item.press('Backspace');
    await item.fill(value, { timeout: 3000 });
    return true;
  }

  if (label) throw new Error(`Nao foi possivel preencher: ${label}`);
  return false;
};

const tryAcceptCookies = async (page: any) => {
  try {
    // Hack agressivo para remover o banner dos Termos de Uso (April 8) que obstrui a API
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach((el) => {
        const style = window.getComputedStyle(el);
        const z = parseInt(style.zIndex, 10);
        if (z > 999 && style.position !== 'static') {
          el.remove();
        }
      });
    }).catch(() => {});

    await clickFirstVisible(
      page,
      [
        'button:has-text("Accept all")',
        'button:has-text("Aceitar")',
        'button:has-text("I agree")',
        'button:has-text("I Agree")',
        'button:has-text("Concordo")',
        'button:has-text("Got it")',
        'button:has-text("Entendi")',
        'button:has-text("I Accept")',
        'button:has-text("Accept")',
        'button[aria-label="Close"]',
        'button[aria-label="Fechar"]'
      ]
    );
  } catch {
    // ignore
  }
};

const extractBodyTextLower = async (page: any) => {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return String(bodyText || '').replace(/\s+/g, ' ').trim().toLowerCase();
};

const isEmailFieldVisible = async (page: any) => page
  .locator('input[type="email"], input[placeholder="Email"]')
  .first()
  .isVisible()
  .catch(() => false);

const assertLoginSucceeded = async (page: any, contextLabel: string) => {
  const emailStillVisible = await isEmailFieldVisible(page);
  if (!emailStillVisible) return;

  const bodyText = await extractBodyTextLower(page);
  if (/wrong password|senha incorreta|invalid password|incorrect password/.test(bodyText)) {
    throw new Error('Login falhou: senha atual parece incorreta.');
  }
  if (/oh no, something went wrong|unexpected issue|try again in a few minutes|temporar/.test(bodyText)) {
    throw new Error(`${contextLabel} retornou erro temporario da Viki.`);
  }
  await page.screenshot({ path: 'artifacts/viki_error.png' }).catch(() => {});
  const fs = await import('fs');
  fs.writeFileSync('artifacts/error_body.txt', bodyText);
  throw new Error(`${contextLabel} nao foi concluido. Texto: ` + bodyText.substring(0, 100));
};

const doLoginViaTv = async (page: any, email: string, password: string) => {
  await page.goto(`${BASE_URL}${VIKI_TV_LOGIN_PATH}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await tryAcceptCookies(page);
  await sleep(1200);

  const emailVisibleBeforeClick = await isEmailFieldVisible(page);
  if (!emailVisibleBeforeClick) {
    // Usa match EXATO para evitar clicar em "entrarão em vigor" (banner de privacidade)
    await clickLoginButton(page, 'botao de login');
    await sleep(1000);
    // Pode aparecer tela de metodo (EN: "Continue with Email" | PT: "Continuar com Email")
    await clickFirstVisible(page, [
      'button:has-text("Continue with Email")', 'a:has-text("Continue with Email")',
      'button:has-text("Continuar com Email")', 'a:has-text("Continuar com Email")',
      'button:has-text("Continuar com e-mail")', 'a:has-text("Continuar com e-mail")'
    ]).catch(() => false);
    await sleep(600);
  }

  await fillFirstVisible(
    page,
    [
      'input[placeholder="Email"]',
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]'
    ],
    email,
    'campo de email'
  );

  // EN: "Password" | PT: "Senha"
  await fillFirstVisible(
    page,
    [
      'input[placeholder="Password"]',
      'input[placeholder="Senha"]',
      'input[type="password"]',
      'input[name*="password" i]',
      'input[id*="password" i]',
      'input[name*="senha" i]'
    ],
    password,
    'campo de senha'
  );

  await page.keyboard.press('Enter');
  // EN: "Continue" | PT: "Continuar", "Prosseguir", "Entrar"
  await clickSubmitButton(page).catch(() => {});

  await sleep(4500);
  await assertLoginSucceeded(page, 'Login TV');
};

const doLoginViaWebsite = async (page: any, email: string, password: string) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await tryAcceptCookies(page);

  const emailVisibleBeforeClick = await isEmailFieldVisible(page);
  if (!emailVisibleBeforeClick) {
    // Usa match EXATO para evitar clicar em "entrarão em vigor" (banner de privacidade)
    const clickedLoginCta = await clickLoginButton(page);

    if (!clickedLoginCta) {
      await page.goto(`${BASE_URL}/web-sign-in?return_to=%2F`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    }

    // EN: "Continue with Email" | PT: "Continuar com Email", "Continuar com e-mail"
    await clickFirstVisible(
      page,
      [
        'button:has-text("Continue with Email")', 'a:has-text("Continue with Email")',
        'button:has-text("Continuar com Email")', 'a:has-text("Continuar com Email")',
        'button:has-text("Continuar com e-mail")', 'a:has-text("Continuar com e-mail")'
      ]
    ).catch(() => false);
    await sleep(600);
  }

  await fillFirstVisible(
    page,
    [
      'input[placeholder="Email"]',
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]'
    ],
    email,
    'campo de email'
  );

  // EN: "Password" | PT: "Senha"
  await fillFirstVisible(
    page,
    [
      'input[placeholder="Password"]',
      'input[placeholder="Senha"]',
      'input[type="password"]',
      'input[name*="password" i]',
      'input[id*="password" i]',
      'input[name*="senha" i]'
    ],
    password,
    'campo de senha'
  );

  await page.keyboard.press('Enter');

  // EN: "Continue" | PT: "Continuar", "Prosseguir", "Entrar"
  await clickSubmitButton(page).catch(() => {});

  await sleep(4500);
  await assertLoginSucceeded(page, 'Login web');
};

const doLogin = async (page: any, email: string, password: string) => {
  try {
    await doLoginViaTv(page, email, password);
    return 'tv';
  } catch (tvError: any) {
    const message = tvError?.message || String(tvError);
    if (/senha atual parece incorreta|wrong password|invalid password|incorrect password/i.test(message)) {
      throw tvError;
    }
  }

  await doLoginViaWebsite(page, email, password);
  return 'web';
};

const openAccountSettings = async (page: any) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await tryAcceptCookies(page);

  let openedByMenu = false;
  try {
    await clickFirstVisible(
      page,
      [
        'button[aria-label*="Settings menu" i]',
        'button[aria-label*="Account" i]',
        'button[aria-label*="Profile" i]',
        'button[aria-label*="Menu" i]',
        'a[aria-label*="Settings menu" i]',
        'a[aria-label*="Account" i]',
        'a[aria-label*="Profile" i]',
        '[data-testid*="avatar" i]',
        '[data-testid*="profile" i]'
      ]
    );

    await sleep(800);

    await clickFirstVisible(
      page,
      [
        'a:has-text("Account Settings")',
        'button:has-text("Account Settings")',
        'a:has-text("Configuracoes de conta")',
        'button:has-text("Configuracoes de conta")',
        'a:has-text("Settings")',
        'button:has-text("Settings")'
      ]
    );

    await sleep(1500);
    openedByMenu = /\/user-account-settings/i.test(page.url());
  } catch {
    // fallback below
  }

  if (!openedByMenu) {
    await page.goto(`${BASE_URL}${VIKI_ACCOUNT_SETTINGS_PATH}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  }

  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  if (!/\/user-account-settings/i.test(page.url())) {
    await page.goto(`${BASE_URL}${VIKI_ACCOUNT_SETTINGS_PATH}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  }

  const bodyText = await extractBodyTextLower(page);
  if (/something's gone wrong|we can't seem to find what you were looking for/.test(bodyText)) {
    throw new Error('Nao foi possivel abrir configuracoes da conta.');
  }
};

const clickPasswordChange = async (page: any) => {
  const clickedSpecific = await clickFirstVisible(
    page,
    [
      'button[aria-label*="Change Password" i]',
      'a[aria-label*="Change Password" i]',
      'button:has-text("Change password")',
      'a:has-text("Change password")',
      'button:has-text("Change Password")',
      'a:has-text("Change Password")',
      'button:has-text("Mudar senha")',
      'button:has-text("Alterar senha")'
    ]
  );
  if (clickedSpecific) return true;

  const passwordSections = page.locator('section, div, li').filter({ hasText: /Password|Senha/i });
  const sectionCount = await passwordSections.count();
  for (let i = 0; i < sectionCount; i += 1) {
    const section = passwordSections.nth(i);
    const button = await firstVisibleLocator(
      section.locator('button, a').filter({ hasText: /Change password|Change|Mudar|Alterar|Editar/i })
    );
    if (!button) continue;

    const ariaLabel = String((await button.getAttribute('aria-label').catch(() => '')) || '').toLowerCase();
    if (ariaLabel.includes('email')) continue;

    await button.click({ timeout: 3000 });
    return true;
  }

  await clickFirstVisible(
    page,
    [
      'button:has-text("Change password")',
      'a:has-text("Change password")',
      'button:has-text("Mudar senha")',
      'a:has-text("Mudar senha")',
      'button:has-text("Alterar senha")',
      'a:has-text("Alterar senha")',
      'button:has-text("Mudar")',
      'a:has-text("Mudar")'
    ],
    'botao de mudar senha'
  );
  return true;
};

const fillPasswordChangeForm = async (page: any, currentPassword: string, newPassword: string) => {
  const filled = {
    current: false,
    next: false,
    confirm: false
  };

  filled.current = await fillFirstVisible(
    page,
    [
      'input[name="password"]',
      'input[name*="current" i]',
      'input[id*="current" i]',
      'input[placeholder*="current" i]',
      'input[placeholder*="atual" i]',
      'input[aria-label*="current" i]',
      'input[aria-label*="atual" i]'
    ],
    currentPassword
  ).catch(() => false);

  filled.next = await fillFirstVisible(
    page,
    [
      'input[name="newPassword"]',
      'input[name*="new" i]',
      'input[id*="new" i]',
      'input[placeholder*="new" i]',
      'input[placeholder*="nova" i]',
      'input[aria-label*="new" i]',
      'input[aria-label*="nova" i]'
    ],
    newPassword
  ).catch(() => false);

  filled.confirm = await fillFirstVisible(
    page,
    [
      'input[name="passwordConfirmation"]',
      'input[name*="confirm" i]',
      'input[id*="confirm" i]',
      'input[placeholder*="confirm" i]',
      'input[placeholder*="retype" i]',
      'input[placeholder*="confirmar" i]',
      'input[aria-label*="confirm" i]',
      'input[aria-label*="confirmar" i]'
    ],
    newPassword
  ).catch(() => false);

  if (!filled.current || !filled.next) {
    const visiblePasswordInputs = page.locator('input[type="password"]');
    const total = await visiblePasswordInputs.count();
    if (total < 2) {
      throw new Error('Nao foi possivel encontrar os campos de troca de senha.');
    }

    const input0 = visiblePasswordInputs.nth(0);
    const input1 = visiblePasswordInputs.nth(1);
    await input0.click({ clickCount: 3, timeout: 3000 });
    await input0.press('Backspace');
    await input0.fill(currentPassword, { timeout: 3000 });
    await input1.click({ clickCount: 3, timeout: 3000 });
    await input1.press('Backspace');
    await input1.fill(newPassword, { timeout: 3000 });

    if (total >= 3) {
      const input2 = visiblePasswordInputs.nth(2);
      await input2.click({ clickCount: 3, timeout: 3000 });
      await input2.press('Backspace');
      await input2.fill(newPassword, { timeout: 3000 });
    }
  }
};

const submitPasswordChange = async (page: any) => {
  await clickFirstVisible(
    page,
    [
      'button:has-text("Change password")',
      'button:has-text("Change Password")',
      'button:has-text("Save")',
      'button:has-text("Update")',
      'button:has-text("Confirm")',
      'button:has-text("Mudar")',
      'button:has-text("Alterar")',
      'button:has-text("Salvar")',
      'button[type="submit"]'
    ],
    'botao de confirmar troca'
  );
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

  const clickedLogout = await clickFirstVisible(page, ['button:has-text("Log Out")', 'a:has-text("Log Out")', 'button:has-text("Logout")', 'a:has-text("Logout")']);
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

const verifyLoginWithNewPassword = async (browser: any, email: string, newPassword: string): Promise<boolean> => {
  const playwrightModule = await import('playwright');
  const { devices } = playwrightModule as any;

  // Tentativas: total de 3 (inicial + 2 retries) pois a Viki pode demorar uns segundos para propagar a senha nova
  for (let attempt = 1; attempt <= 3; attempt++) {
    const context = await browser.newContext({ ...(devices['Pixel 7'] || {}) });
    const page = await context.newPage();
    try {
      if (attempt > 1) {
        await sleep(5000); // Espera 5s antes de tentar de novo se falhou a primeira
      }
      await doLogin(page, email, newPassword);
      return true;
    } catch (e) {
      console.log(`[Verify] Tentativa ${attempt} falhou para ${email}`);
      if (attempt === 3) return false;
    } finally {
      await context.close().catch(() => {});
    }
  }
  return false;
};

export const runVikiPasswordAutomationJob = async (
  payload: VikiPasswordAutomationPayload,
  onUpdate: (nextStatus: VikiPasswordAutomationJobStatus) => void
): Promise<void> => {
  let status = createInitialPasswordJobStatus(payload.requestId);

  const push = (next: VikiPasswordAutomationJobStatus) => {
    status = next;
    onUpdate(status);
  };

  push(updateJob(status, 'running', 'Automacao de troca de senha iniciada.'));
  push(updateStep(status, STEP_KEYS.dispatch, 'running', 'Inicializando navegador em modo smartphone.'));

  let browser: any = null;
  try {
    const playwrightModule = await import('playwright');
    const { chromium, devices } = playwrightModule as any;

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ...(devices['Pixel 7'] || {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    push(updateStep(status, STEP_KEYS.dispatch, 'success', 'Navegador iniciado.'));
    push(updateStep(status, STEP_KEYS.login, 'running', 'Realizando login com a senha atual.'));

    const loginFlow = await doLogin(page, payload.credentialEmail, payload.currentPassword);
    push(updateStep(status, STEP_KEYS.login, 'success', `Login realizado (fluxo ${loginFlow}).`));

    push(updateStep(status, STEP_KEYS.openSettings, 'running', 'Abrindo configuracoes de conta.'));
    await openAccountSettings(page);
    push(updateStep(status, STEP_KEYS.openSettings, 'success', 'Pagina de configuracoes aberta.'));

    push(updateStep(status, STEP_KEYS.changePassword, 'running', 'Aplicando nova senha na conta.'));
    await clickPasswordChange(page);
    await fillPasswordChangeForm(page, payload.currentPassword, payload.newPassword);
    await submitPasswordChange(page);
    await sleep(4000);

    const bodyText = await extractBodyTextLower(page);
    if (/wrong password|senha incorreta|invalid password|incorrect password/.test(bodyText)) {
      throw new Error('A senha atual foi rejeitada pela Viki.');
    }
    if (/too short|must contain|invalid|error|unexpected issue|temporar/.test(bodyText)) {
      throw new Error('A Viki rejeitou a troca de senha com a combinacao informada.');
    }
    push(updateStep(status, STEP_KEYS.changePassword, 'success', 'Senha alterada na Viki.'));

    push(updateStep(status, STEP_KEYS.verifyLogin, 'running', 'Validando login com a nova senha.'));
    const verified = await verifyLoginWithNewPassword(browser, payload.credentialEmail, payload.newPassword);
    if (!verified) {
      throw new Error('Nao foi possivel confirmar login com a nova senha.');
    }
    push(updateStep(status, STEP_KEYS.verifyLogin, 'success', 'Login confirmado com a nova senha.'));

    push(updateStep(status, STEP_KEYS.logout, 'running', 'Executando logout de seguranca.'));
    const logout = await performLogout(page);
    if (!logout.ok) throw new Error(logout.details);
    push(updateStep(status, STEP_KEYS.logout, 'success', logout.details));

    await context.close().catch(() => {});
    push(updateJob(status, 'success', 'Troca de senha concluida com sucesso.'));
  } catch (error: any) {
    const message = error?.message || 'Erro inesperado';

    const stepToFail =
      status.steps.find((step) => step.status === 'running')?.key ||
      status.steps.find((step) => step.status === 'pending')?.key ||
      STEP_KEYS.dispatch;

    push(updateStep(status, stepToFail, 'failed', message));
    push(updateJob(status, 'failed', `Falha na troca de senha: ${message}`));
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
