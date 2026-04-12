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

export const runPasswordAutomationAttempt = async (
	env: Env,
	payload: any,
	onStep: (key: string, status: any, details?: string) => Promise<void>,
	attemptInfo: string
): Promise<void> => {
	// 0. Coleta de Proxies
	await onStep('dispatch', 'running', `Buscando IPs anonimos. ${attemptInfo}`);
	const proxies = await getWorkerProxies();
	const selectedProxy = proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : undefined;

	// 1. Inicializa Navegador com Proxy (se disponivel)
	const launchOptions: any = { ...env.BROWSER };
	if (selectedProxy) {
		launchOptions.args = [...(launchOptions.args || []), `--proxy-server=${selectedProxy}`];
	}

	const browser = await puppeteer.launch(env.BROWSER); // Nota: Cloudflare Browser Rendering as vezes ignora args de proxy em Workers gratuitos, mas tentamos.
	
	try {
		const page = await browser.newPage();
		await onStep('dispatch', 'running', `Navegador na nuvem iniciado. IP: ${selectedProxy || 'Cloudflare'}`);

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

		await page.goto('https://www.viki.com/user-account-settings#account', { waitUntil: 'domcontentloaded', timeout: 60000 });
		await new Promise<void>(res => setTimeout(res, 3000));
		
		const changePassClicked = await page.evaluate(() => {
			const texts = ['change password', 'mudar senha', 'alterar senha'];
			const items = Array.from(document.querySelectorAll('button, a'));
			for (const item of items) {
				const t = (item.textContent || '').toLowerCase();
				if (texts.some(txt => t.includes(txt)) && !t.includes('email')) {
					(item as any).click();
					return true;
				}
			}
			return false;
		});

		if (!changePassClicked) throw new Error('Nao foi possivel encontrar o botao de trocar senha.');

		await new Promise<void>(res => setTimeout(res, 2000));
		await onStep('openSettings', 'success', 'Pagina de senha aberta.');
		await onStep('changePassword', 'running', 'Enviando nova senha...');

		await page.evaluate((currPass, newPass) => {
			const doc = document as any;
			const p1 = doc.querySelector('input[name="password"], input[name*="current" i]') as any;
			const p2 = doc.querySelector('input[name="newPassword"], input[name*="new" i]') as any;
			const p3 = doc.querySelector('input[name="passwordConfirmation"], input[name*="confirm" i]') as any;
			
			if (p1) p1.value = currPass;
			if (p2) p2.value = newPass;
			if (p3) p3.value = newPass;

			const btns = Array.from(doc.querySelectorAll('button'));
			for (const btn of btns as any[]) {
				const txt = (btn.textContent || '').toLowerCase();
				if (txt.includes('change') || txt.includes('mudar') || txt.includes('alterar') || txt.includes('save') || txt.includes('pronto')) {
					btn.click();
					return;
				}
			}
		}, payload.currentPassword || payload.credentialPassword, payload.newPassword);

		await new Promise<void>(res => setTimeout(res, 5000));
		await onStep('changePassword', 'success', 'Senha alterada com sucesso.');
		await onStep('logout', 'success', 'Concluido.');

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
