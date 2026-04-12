import puppeteer from '@cloudflare/puppeteer';
import type { Env } from './index';

export const runPasswordAutomationAttempt = async (
	env: Env,
	payload: any,
	onStep: (key: string, status: any, details?: string) => Promise<void>,
	attemptInfo: string
): Promise<void> => {
	const browser = await puppeteer.launch(env.BROWSER);
	try {
		const page = await browser.newPage();
		await onStep('dispatch', 'running', `Inicializando navegador em modo smartphone. ${attemptInfo}`);

		await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
		await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
		
		await onStep('dispatch', 'success', 'Navegador iniciado.');
		await onStep('login', 'running', 'Abrindo pagina de login...');

		await page.goto('https://www.viki.com/web-sign-in?return_to=%2F', { waitUntil: 'domcontentloaded', timeout: 120000 });
		await new Promise<void>(res => setTimeout(res, 2000));

		// Login
		const emailSelectors = ['input[placeholder="Email"]', 'input[type="email"]', 'input[name*="email" i]'];
		let emailHandle = null;
		for (const sel of emailSelectors) {
			emailHandle = await page.$(sel);
			if (emailHandle) break;
		}
		if (!emailHandle) throw new Error('Campo de e-mail nao encontrado');
		await emailHandle.click({ clickCount: 3 });
		await page.keyboard.press('Backspace');
		await emailHandle.type(payload.credentialEmail, { delay: 20 });

		const passSelectors = ['input[placeholder="Password"]', 'input[type="password"]', 'input[placeholder="Senha"]'];
		let passHandle = null;
		for (const sel of passSelectors) {
			passHandle = await page.$(sel);
			if (passHandle) break;
		}
		if (!passHandle) throw new Error('Campo de senha nao encontrado');
		await passHandle.click({ clickCount: 3 });
		await page.keyboard.press('Backspace');
		await passHandle.type(payload.currentPassword || payload.credentialPassword, { delay: 20 });

		const loginTexts = ['continue', 'continuar', 'entrar', 'prosseguir', 'fazer login', 'log in', 'sign in'];
		let continueClicked = false;
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      const z = parseInt(style.zIndex, 10);
      if (z > 999 && style.position !== 'static') el.remove();
    });
  }).catch(() => {});
		for (const txt of loginTexts) {
			const btns = await page.$$('button, a');
			for (const btn of btns) {
				const text = await (await btn.getProperty('textContent'))?.jsonValue();
				if (typeof text === 'string' && text.toLowerCase().includes(txt)) {
					await btn.click();
					continueClicked = true;
					break;
				}
			}
			if (continueClicked) break;
		}
		if (!continueClicked) throw new Error('Botao Continue/Login nao encontrado');

		await new Promise<void>(res => setTimeout(res, 4000));
		const loginErrorText = await page.evaluate(() => {
			return String((globalThis as any).document?.body?.innerText || '').replace(/\s+/g, ' ');
		});
		if (/oh no, something went wrong|unexpected issue/i.test(loginErrorText)) {
			throw new Error('Viki retornou erro temporario no login');
		}
		if (/senha atual parece incorreta|wrong password|invalid password|incorrect password/i.test(loginErrorText)) {
			throw new Error('A senha atual fornecida parece estar incorreta.');
		}

		await onStep('login', 'success', 'Login executado.');
		await onStep('open_settings', 'running', 'Acessando configuracoes.');

		await page.goto('https://www.viki.com/user-account-settings#account', { waitUntil: 'domcontentloaded', timeout: 120000 });
		await new Promise<void>(res => setTimeout(res, 4000));
		
		const changePassClicked = await page.evaluate(() => {
			const texts = ['change password', 'mudar senha', 'alterar senha'];
			const items = Array.from((globalThis as any).document.querySelectorAll('button, a'));
			for (const item of items) {
				const el = item as HTMLElement;
				const t = (el.textContent || '').toLowerCase();
				const aria = (el.getAttribute('aria-label') || '').toLowerCase();
				if ((texts.some(txt => t.includes(txt)) || texts.some(txt => aria.includes(txt))) && !aria.includes('email')) {
					el.click();
					return true;
				}
			}
			return false;
		});

		if (!changePassClicked) throw new Error('Botao de alterar senha nao encontrado na pagina de configuracoes');

		await new Promise<void>(res => setTimeout(res, 2000));
		await onStep('open_settings', 'success', 'Acesso as config. concluido.');
		await onStep('change_password', 'running', 'Preenchendo alteracao de senha.');

		const filled = await page.evaluate((currPass, newPass) => {
			const doc = globalThis.document as any;
			const p1 = doc.querySelector('input[name="password"], input[name*="current" i]') as any;
			const p2 = doc.querySelector('input[name="newPassword"], input[name*="new" i]') as any;
			const p3 = doc.querySelector('input[name="passwordConfirmation"], input[name*="confirm" i]') as any;
			
			if (!p1 || !p2 || !p3) return false;
			
			const setValue = (el: HTMLInputElement, val: string) => {
				el.value = val;
				el.dispatchEvent(new Event('input', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
			};
			setValue(p1, currPass);
			setValue(p2, newPass);
			setValue(p3, newPass);

			const btns = Array.from(doc.querySelectorAll('button'));
			for (const btn of btns as any[]) {
				const txt = (btn.textContent || '').toLowerCase();
				if (txt.includes('change') || txt.includes('mudar') || txt.includes('alterar') || txt.includes('salvar') || txt.includes('save') || txt.includes('pronto')) {
					btn.click();
					return true;
				}
			}
			// Submit form explicitly if button not found by text
			p3.form?.requestSubmit?.() || p3.form?.submit?.();
			return true;
		}, payload.currentPassword || payload.credentialPassword, payload.newPassword);

		if (!filled) throw new Error('Um dos campos do formulario de nova senha nao foi encontrado');

		await new Promise<void>(res => setTimeout(res, 4000));
		const afterSubmitText = await page.evaluate(() => {
			const doc = (globalThis as any).document;
			return String(doc?.querySelector('.alert, [role="alert"], .error, .sc-4f811a15-0')?.innerText || doc?.body?.innerText || '').replace(/\s+/g, ' ');
		});

		if (/must contain|characters|caracteres|inválid|fraca|weak|incorrect/i.test(afterSubmitText) && !/success|sucesso|atualizada|changed/i.test(afterSubmitText)) {
			throw new Error('A nova senha não atende aos requisitos ou a senha atual estava errada.');
		}

		await onStep('change_password', 'success', 'Senha alterada com sucesso.');
		await onStep('logout', 'running', 'Finalizando...');
		await onStep('logout', 'success', 'Concluido.');

	} finally {
		await browser.close();
	}
};

export const runPasswordAutomation = async (env: Env, payload: any, onStep: any) => {
	const maxRetries = 2;
	for (let i = 1; i <= maxRetries; i++) {
		try {
			await runPasswordAutomationAttempt(env, payload, onStep, `(Tentativa ${i}/${maxRetries})`);
			return;
		} catch (err: any) {
			if (i < maxRetries && (err.message.includes('erro temporario') || err.message.includes('something went wrong'))) {
				await new Promise(r => setTimeout(r, 3000));
				continue;
			}
			throw err;
		}
	}
};
