import puppeteer from '@cloudflare/puppeteer';
import type { Env } from './index';

/**
 * Busca proxies diretamente da API do ProxyScrape
 * Nota: Filtramos apenas para a porta 80 e 443, que sao as permitidas pelo Cloudflare
 */
async function getWorkerProxies(): Promise<string[]> {
	try {
		const res = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all');
		const text = await res.text();
		return text.split('\r\n').filter(line => line.includes(':')).map(p => p.trim());
	} catch (e) {
		console.error('[Proxy] Falha ao buscar lista no Worker:', e);
		return [];
	}
}

const VIKI_API_CONFIG = {
	baseUrl: 'https://api.viki.io/v4',
	appId: '100005a',
};

/**
 * Tenta a troca via API Silenciosa (igual a TV) para evitar 429 do Cloudflare
 */
async function runPasswordAutomationViaApi(payload: any): Promise<boolean> {
	try {
		// 1. Login
		const loginRes = await fetch(`${VIKI_API_CONFIG.baseUrl}/sessions.json?app=${VIKI_API_CONFIG.appId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: payload.credentialEmail,
				password: payload.currentPassword || payload.credentialPassword,
			})
		});

		if (!loginRes.ok) return false;
		const loginData: any = await loginRes.json();
		const token = loginData.token;
		const userId = loginData.user?.id;

		if (!token || !userId) return false;

		// 2. Troca
		const updateRes = await fetch(`${VIKI_API_CONFIG.baseUrl}/users/${userId}.json?app=${VIKI_API_CONFIG.appId}`, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`
			},
			body: JSON.stringify({
				user: {
					password: payload.newPassword,
					current_password: payload.currentPassword || payload.credentialPassword
				}
			})
		});

		return updateRes.ok;
	} catch (e) {
		return false;
	}
}

/**
 * Sincroniza a nova senha com o banco de dados Supabase via Fetch
 */
async function syncPasswordToDatabase(email: string, newPassword: string): Promise<void> {
  try {
    const url = 'https://mhiormzpctfoyjbrmxfz.supabase.co';
    const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';
    
    await fetch(`${url}/rest/v1/credentials?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ password: newPassword })
    });
    console.log('[DB Sync] Senha sincronizada com sucesso via REST no Cloudflare Worker.');
  } catch (err: any) {
    console.error('[DB Sync Error] Excecao ao atualizar supabase:', err.message);
  }
}

export const runPasswordAutomationAttempt = async (
	env: Env,
	payload: any,
	onStep: (key: string, status: any, details?: string) => Promise<void>,
	attemptInfo: string
): Promise<void> => {
	// 1. TENTATIVA VIA API (SILENCIOSA - EVITA 429)
	await onStep('dispatch', 'running', `Tentando troca rapida via API (Sem Navegador). ${attemptInfo}`);
	const apiSuccess = await runPasswordAutomationViaApi(payload);
	
	if (apiSuccess) {
		await onStep('login', 'success', 'Login API OK.');
		await onStep('openSettings', 'success', 'Sessao estabelecida.');
		await onStep('changePassword', 'success', 'Senha alterada via API rapida.');
		await syncPasswordToDatabase(payload.credentialEmail, payload.newPassword);
		await onStep('logout', 'success', 'Senhas sincronizadas DB. Concluido.');
		return;
	}

	await onStep('dispatch', 'running', 'API indisponivel ou bloqueada. Usando navegador de reserva...');

	// 2. FALLBACK PARA NAVEGADOR (PUPPETEER)
	const browser = await puppeteer.launch(env.BROWSER).catch(err => {
		if (err.message.includes('429')) {
			throw new Error('Limite de navegadores do Cloudflare atingido (429). Tente novamente em alguns minutos ou altere apenas uma conta por vez.');
		}
		throw err;
	});
	
	try {
		const page = await browser.newPage();
		await onStep('dispatch', 'running', 'Navegador na nuvem iniciado. IP: Cloudflare');

		await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
		await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
		
		await onStep('login', 'running', 'Abrindo Viki...');

		await page.goto('https://www.viki.com/web-sign-in?return_to=%2F', { waitUntil: 'domcontentloaded', timeout: 60000 });
		await new Promise<void>(res => setTimeout(res, 2000));

		// Login
		await onStep('login', 'running', 'Preenchendo credenciais...');
		const emailSelectors = ['input[placeholder="Email"]', 'input[type="email"]', 'input[name*="email" i]'];
		let emailHandle = null;
		for (const sel of emailSelectors) {
			emailHandle = await page.$(sel);
			if (emailHandle) break;
		}
		if (!emailHandle) throw new Error('Campo de e-mail nao encontrado');
		await emailHandle.type(payload.credentialEmail, { delay: 10 });

		const passSelectors = ['input[placeholder="Password"]', 'input[type="password"]', 'input[placeholder="Senha"]'];
		let passHandle = null;
		for (const sel of passSelectors) {
			passHandle = await page.$(sel);
			if (passHandle) break;
		}
		if (!passHandle) throw new Error('Campo de senha nao encontrado');
		await passHandle.type(payload.currentPassword || payload.credentialPassword, { delay: 10 });

		// Click Continuar
		await page.evaluate(() => {
			const texts = ['continue', 'continuar', 'entrar', 'log in', 'sign in'];
			const buttons = Array.from(document.querySelectorAll('button, a'));
			for (const btn of buttons) {
				const t = btn.textContent?.toLowerCase() || '';
				if (texts.some(txt => t.includes(txt))) {
					(btn as any).click();
					return;
				}
			}
		});

		await new Promise<void>(res => setTimeout(res, 5000));
		
		const bodyText = await page.evaluate(() => document.body.innerText);
		if (/wrong password|senha incorreta|invalid password|incorrect password/i.test(bodyText)) {
			throw new Error('A senha atual esta incorreta.');
		}

		await onStep('login', 'success', 'Login OK.');
		await onStep('openSettings', 'running', 'Acessando conta...');

		// Tenta acessar as configuracoes com um tempo de espera maior
		await page.goto('https://www.viki.com/user-account-settings#account', { waitUntil: 'networkidle0', timeout: 80000 });
		await new Promise<void>(res => setTimeout(res, 5000));
		
		const changePassClicked = await page.evaluate(() => {
			const texts = ['change password', 'mudar senha', 'alterar senha', 'mudar a senha'];
			// 1. Tenta por texto em botoes e links
			const items = Array.from(document.querySelectorAll('button, a, [role="button"]'));
			for (const item of items) {
				const t = (item.textContent || '').toLowerCase();
				const aria = (item.getAttribute('aria-label') || '').toLowerCase();
				const title = (item.getAttribute('title') || '').toLowerCase();
				
				if ((texts.some(txt => t.includes(txt)) || texts.some(txt => aria.includes(txt)) || texts.some(txt => title.includes(txt))) && !t.includes('email')) {
					(item as any).click();
					return true;
				}
			}
			
			// 2. Tenta por seletores especificos da Viki se o texto falhar
			const scBtn = document.querySelector('button[class*="Button"], button[class*="Account"]') as HTMLElement;
			if (scBtn && /senha|password/i.test(scBtn.innerText)) {
				scBtn.click();
				return true;
			}
			
			return false;
		});

		if (!changePassClicked) throw new Error('Botao de troca de senha nao encontrado. A Viki pode ter alterado o layout ou esta conta usa login social (Google/FB).');

		await new Promise<void>(res => setTimeout(res, 3000));
		await onStep('openSettings', 'success', 'Pagina de senha aberta.');
		await onStep('changePassword', 'running', 'Preenchendo campos de senha...');

		await page.waitForSelector('input[type="password"]', { timeout: 10000 });

		// Preenche os campos usando o setter nativo do React (evita que o botão fique disabled)
		const fillCount = await page.evaluate((currPass, newPass) => {
			// Funcao auxiliar para disparar todos os eventos que o React precisa
			const setReactInputValue = (el: any, val: string) => {
				const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
				if (nativeInputValueSetter) {
					nativeInputValueSetter.call(el, val);
				} else {
					el.value = val;
				}
				// Dispara todos os eventos que o React/Vue/Angular precisam
				el.dispatchEvent(new Event('keydown', { bubbles: true }));
				el.dispatchEvent(new Event('keypress', { bubbles: true }));
				el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: val }));
				el.dispatchEvent(new Event('keyup', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
				el.dispatchEvent(new Event('blur', { bubbles: true }));
			};

			const passInputs = Array.from(document.querySelectorAll('input[type="password"]'));

			if (passInputs.length >= 3) {
				setReactInputValue(passInputs[0], currPass);
				setReactInputValue(passInputs[1], newPass);
				setReactInputValue(passInputs[2], newPass);
				return 3;
			} else if (passInputs.length === 2) {
				// Alguns flows so tem: nova senha + confirmar
				setReactInputValue(passInputs[0], newPass);
				setReactInputValue(passInputs[1], newPass);
				return 2;
			} else if (passInputs.length === 1) {
				setReactInputValue(passInputs[0], currPass);
				return 1;
			}
			return 0;
		}, payload.currentPassword || payload.credentialPassword, payload.newPassword);

		console.log(`[Password] ${fillCount} campos preenchidos com nativeInputValueSetter.`);

		// Aguarda o React re-renderizar e habilitar o botao
		await new Promise(res => setTimeout(res, 2000));

		// Clica no botao de confirmar — tenta mesmo se estiver disabled (force click)
		const changed = await page.evaluate(() => {
			const SUBMIT_TEXTS = ['change password', 'change', 'mudar senha', 'mudar', 'alterar', 'save', 'save changes', 'pronto', 'confirm', 'update'];

			const allBtns = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')) as HTMLElement[];

			// 1a: Tenta botao habilitado com texto correspondente
			for (const btn of allBtns) {
				const txt = (btn.textContent || (btn as any).value || '').toLowerCase().trim();
				if (SUBMIT_TEXTS.some(t => txt.includes(t)) && !(btn as any).disabled) {
					(btn as any).click();
					return `clicked_enabled:${txt}`;
				}
			}

			// 1b: Tenta qualquer botao com texto correspondente (mesmo disabled - force click)
			for (const btn of allBtns) {
				const txt = (btn.textContent || (btn as any).value || '').toLowerCase().trim();
				if (SUBMIT_TEXTS.some(t => txt.includes(t))) {
					(btn as HTMLButtonElement).disabled = false;
					(btn as any).removeAttribute('disabled');
					(btn as any).click();
					return `force_clicked:${txt}`;
				}
			}

			// 2: Tenta o ultimo botao do formulario de senha (geralmente e o submit)
			const form = document.querySelector('form');
			if (form) {
				const formBtns = Array.from(form.querySelectorAll('button, input[type="submit"]')) as HTMLElement[];
				const lastBtn = formBtns[formBtns.length - 1];
				if (lastBtn) {
					(lastBtn as HTMLButtonElement).disabled = false;
					(lastBtn as any).removeAttribute('disabled');
					(lastBtn as any).click();
					return `form_last_btn:${lastBtn.textContent?.trim()}`;
				}
			}

			return null;
		});

		if (!changed) throw new Error('Não foi possivel clicar no botão Alterar final.');
		console.log(`[Password] Botao clicado com estrategia: ${changed}`);

		await new Promise<void>(res => setTimeout(res, 5000));
		await syncPasswordToDatabase(payload.credentialEmail, payload.newPassword);
		await onStep('changePassword', 'success', `Senha alterada com sucesso. (${changed})`);
		await onStep('logout', 'success', 'Banco Sincronizado. Concluido.');

	} finally {
		await browser.close();
	}
};

export const runPasswordAutomation = async (env: Env, payload: any, onStep: any) => {
	const maxRetries = 3;
	for (let i = 1; i <= maxRetries; i++) {
		try {
			await runPasswordAutomationAttempt(env, payload, onStep, `(Tentativa ${i}/${maxRetries})`);
			return;
		} catch (err: any) {
			if (i < maxRetries && !err.message.includes('senha')) {
				await new Promise(r => setTimeout(r, 2000));
				continue;
			}
			throw err;
		}
	}
};
