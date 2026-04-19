import puppeteer from '@cloudflare/puppeteer';
import type { Env } from './index';

/**
 * Sincroniza a nova senha com o banco de dados Supabase via REST.
 * Lança erro se o PATCH não afetar nenhuma linha ou retornar status de falha.
 */
async function syncPasswordToDatabase(email: string, newPassword: string): Promise<void> {
	const url = 'https://mhiormzpctfoyjbrmxfz.supabase.co';
	const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

	// FIX Bug #5: verificar a resposta do PATCH — 'return=representation' retorna as linhas atualizadas
	const res = await fetch(`${url}/rest/v1/credentials?email=eq.${encodeURIComponent(email)}`, {
		method: 'PATCH',
		headers: {
			'apikey': key,
			'Authorization': `Bearer ${key}`,
			'Content-Type': 'application/json',
			'Prefer': 'return=representation',
		},
		body: JSON.stringify({ password: newPassword }),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`[DB Sync] Falha no PATCH Supabase (HTTP ${res.status}): ${body.slice(0, 200)}`);
	}

	const rows = await res.json().catch(() => []) as any[];
	if (!Array.isArray(rows) || rows.length === 0) {
		throw new Error(`[DB Sync] Nenhuma credencial encontrada no banco para o email: ${email}`);
	}

	console.log(`[DB Sync] Senha sincronizada com sucesso para ${email} (${rows.length} linha(s) atualizadas).`);
}



export const runPasswordAutomationAttempt = async (
	env: Env,
	payload: any,
	onStep: (key: string, status: any, details?: string) => Promise<void>,
	attemptInfo: string
): Promise<void> => {
	const browser = await puppeteer.launch(env.BROWSER).catch(err => {
		if (err.message.includes('429')) {
			throw new Error('Limite de navegadores do Cloudflare atingido (429). Tente novamente em alguns minutos.');
		}
		throw err;
	});

	try {
		const page = await browser.newPage();
		await onStep('dispatch', 'running', `Iniciando navegador na nuvem. ${attemptInfo}`);

		await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
		await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

		await onStep('dispatch', 'running', 'Navegador iniciado. Abrindo Viki...');
		await onStep('login', 'running', 'Abrindo pagina de login...');

		await page.goto('https://www.viki.com/web-sign-in?return_to=%2F', { waitUntil: 'domcontentloaded', timeout: 60000 });
		await new Promise<void>(res => setTimeout(res, 2000));

		// --- LOGIN ---
		await onStep('login', 'running', 'Preenchendo credenciais...');

		const emailSelectors = ['input[placeholder="Email"]', 'input[type="email"]', 'input[name*="email" i]'];
		let emailHandle = null;
		for (const sel of emailSelectors) {
			emailHandle = await page.$(sel);
			if (emailHandle) break;
		}
		if (!emailHandle) throw new Error('Campo de e-mail nao encontrado na pagina de login.');
		await emailHandle.type(payload.credentialEmail, { delay: 15 });

		const passSelectors = ['input[placeholder="Password"]', 'input[type="password"]', 'input[placeholder="Senha"]'];
		let passHandle = null;
		for (const sel of passSelectors) {
			passHandle = await page.$(sel);
			if (passHandle) break;
		}
		if (!passHandle) throw new Error('Campo de senha nao encontrado na pagina de login.');
		await passHandle.type(payload.currentPassword || payload.credentialPassword, { delay: 15 });

		// Clica em "Continue" / "Log in"
		await page.evaluate(() => {
			const texts = ['continue', 'continuar', 'log in', 'sign in', 'entrar'];
			const buttons = Array.from(document.querySelectorAll('button, a'));
			for (const btn of buttons) {
				const t = (btn.textContent || '').trim().toLowerCase();
				if (texts.some(txt => t.includes(txt))) {
					(btn as any).click();
					return;
				}
			}
		});

		await new Promise<void>(res => setTimeout(res, 5000));

		const loginBody = await page.evaluate(() => document.body.innerText || '');
		if (/wrong password|senha incorreta|invalid password|incorrect password|invalid credentials/i.test(loginBody)) {
			throw new Error('Credenciais incorretas. Verifique o email e a senha atual cadastrados.');
		}
		// Checa se ainda está na página de login (login falhou silenciosamente)
		const currentUrlAfterLogin = page.url();
		if (currentUrlAfterLogin.includes('sign-in') || currentUrlAfterLogin.includes('login')) {
			throw new Error('Login nao foi concluido. A pagina de login ainda esta aberta apos tentativa.');
		}

		await onStep('login', 'success', 'Login realizado com sucesso.');
		await onStep('openSettings', 'running', 'Navegando para configuracoes da conta...');

		// --- CONFIGURAÇÕES ---
		await page.goto('https://www.viki.com/user-account-settings#account', { waitUntil: 'networkidle0', timeout: 80000 });
		await new Promise<void>(res => setTimeout(res, 4000));

		const changePassClicked = await page.evaluate(() => {
			const texts = ['change password', 'mudar senha', 'alterar senha', 'mudar a senha'];
			const items = Array.from(document.querySelectorAll('button, a, [role="button"]'));
			for (const item of items) {
				const t = (item.textContent || '').toLowerCase();
				const aria = (item.getAttribute('aria-label') || '').toLowerCase();
				const title = (item.getAttribute('title') || '').toLowerCase();
				if (
					(texts.some(txt => t.includes(txt)) || texts.some(txt => aria.includes(txt)) || texts.some(txt => title.includes(txt))) &&
					!t.includes('email')
				) {
					(item as any).click();
					return true;
				}
			}
			const scBtn = document.querySelector('button[class*="Button"], button[class*="Account"]') as HTMLElement | null;
			if (scBtn && /senha|password/i.test(scBtn.innerText)) {
				scBtn.click();
				return true;
			}
			return false;
		});

		if (!changePassClicked) {
			throw new Error('Botao "Change Password" nao encontrado. A Viki pode ter alterado o layout ou esta conta usa login social (Google/Facebook).');
		}

		// Aguarda o formulário de senha aparecer (exige >= 3 campos: atual, nova, confirmar)
		await new Promise<void>(res => setTimeout(res, 3000));
		await page.waitForSelector('input[type="password"]', { timeout: 12000 });

		// FIX Bug #4: aguardar pelo menos 3 campos de senha (se < 3, o form ainda não abriu)
		let waitForFieldsRetries = 5;
		while (waitForFieldsRetries-- > 0) {
			const count = await page.evaluate(() => document.querySelectorAll('input[type="password"]').length);
			if (count >= 3) break;
			if (waitForFieldsRetries === 0) {
				throw new Error(`Formulario de troca de senha incompleto: apenas ${count} campo(s) encontrado(s). Esperado pelo menos 3.`);
			}
			await new Promise<void>(res => setTimeout(res, 1500));
		}

		await onStep('openSettings', 'success', 'Formulario de troca de senha aberto.');
		await onStep('changePassword', 'running', 'Preenchendo campos de senha com eventos nativos do React...');

		// FIX Bug #3 + #4: preenche os 3 campos obrigatórios usando native setter inline
		const fillResult = await page.evaluate((currPass: string, newPass: string) => {
			// Dispara todos os eventos que o React/Vue precisam reconhecer o novo valor
			const setReactInputValue = (el: HTMLInputElement, val: string) => {
				const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
				if (nativeSetter) {
					nativeSetter.call(el, val);
				} else {
					el.value = val;
				}
				el.dispatchEvent(new Event('keydown', { bubbles: true }));
				el.dispatchEvent(new Event('keypress', { bubbles: true }));
				el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: val }));
				el.dispatchEvent(new Event('keyup', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
				el.dispatchEvent(new Event('blur', { bubbles: true }));
			};

			const passInputs = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
			const count = passInputs.length;

			if (count < 3) {
				return { filled: count, error: `Apenas ${count} campo(s) de senha encontrado(s). O formulario nao esta completamente carregado.` };
			}

			// Preenche os 3 campos: senha atual, nova senha, confirmar nova senha
			setReactInputValue(passInputs[0], currPass);
			setReactInputValue(passInputs[1], newPass);
			setReactInputValue(passInputs[2], newPass);

			return { filled: 3, error: null };
		}, payload.currentPassword || payload.credentialPassword, payload.newPassword);

		if (fillResult.error) {
			throw new Error(fillResult.error);
		}
		console.log(`[Password] ${fillResult.filled} campos preenchidos com nativeInputValueSetter.`);

		// Aguarda o React re-renderizar e (espera-se) habilitar o botão
		await new Promise<void>(res => setTimeout(res, 2500));

		// FIX Bug #3: submissão correta — tenta botão habilitado com texto, depois form.requestSubmit()
		const submitResult = await page.evaluate(() => {
			const SUBMIT_TEXTS = ['change password', 'change', 'mudar senha', 'mudar', 'alterar', 'save', 'save changes', 'confirm', 'update'];
			const allBtns = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')) as HTMLElement[];

			// 1. Tenta somente botão realmente habilitado com texto correspondente
			for (const btn of allBtns) {
				const txt = (btn.textContent || (btn as any).value || '').toLowerCase().trim();
				if (SUBMIT_TEXTS.some(t => txt.includes(t)) && !(btn as HTMLButtonElement).disabled) {
					(btn as any).click();
					return `clicked_enabled:${txt}`;
				}
			}

			// 2. Tenta submeter via form.requestSubmit() — respeita validação do React
			const form = document.querySelector('form') as HTMLFormElement | null;
			if (form) {
				try {
					form.requestSubmit();
					return 'form_requestSubmit';
				} catch {
					// requestSubmit pode lançar se a validação HTML falhar — isso é esperado
					return 'form_requestSubmit_validation_failed';
				}
			}

			return null;
		});

		if (!submitResult || submitResult === 'form_requestSubmit_validation_failed') {
			throw new Error(
				submitResult === 'form_requestSubmit_validation_failed'
					? 'O formulario recusou o submit por validacao HTML (campos invalidos ou nao reconhecidos pelo React).'
					: 'Nenhum botao de submit encontrado e nenhum formulario detectado na pagina.'
			);
		}
		console.log(`[Password] Submit acionado com estrategia: ${submitResult}`);

		// FIX Bug #2: aguarda e verifica EXPLICITAMENTE se a tela exibiu confirmação de sucesso
		await new Promise<void>(res => setTimeout(res, 6000));

		const pageTextAfter = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').toLowerCase());

		const successPatterns = [
			'password changed', 'senha alterada', 'senha atualizada', 'password updated',
			'password has been changed', 'password successfully', 'successfully changed',
			'success', 'atualizado com sucesso', 'alterado com sucesso',
		];
		const errorPatterns = [
			'incorrect', 'wrong', 'invalid', 'does not match', "doesn't match",
			'nao confere', 'incorreta', 'invalida', 'senha errada', 'error', 'failed',
			'must be different', 'must not', 'too short', 'too weak',
		];

		const confirmedSuccess = successPatterns.some(p => pageTextAfter.includes(p));
		const confirmedError = errorPatterns.some(p => pageTextAfter.includes(p));

		if (confirmedError && !confirmedSuccess) {
			// Captura mensagem de erro mais específica da tela
			const errMsg = await page.evaluate(() => {
				const alertEl = document.querySelector('[role="alert"], .error, .alert, [class*="error" i], [class*="alert" i]') as HTMLElement | null;
				return alertEl?.innerText?.trim() || '';
			});
			throw new Error(`A troca de senha foi rejeitada pela Viki: "${errMsg || 'verifique os campos e tente novamente'}"`);
		}

		if (!confirmedSuccess) {
			// Não foi sucesso nem erro claro — estado ambíguo: falha segura
			throw new Error(
				'Nao foi possivel confirmar se a senha foi alterada. Nenhuma mensagem de sucesso ou erro reconhecida na tela. Tente novamente.'
			);
		}

		// FIX Bug #5: sync com verificação real da resposta
		await syncPasswordToDatabase(payload.credentialEmail, payload.newPassword);

		await onStep('changePassword', 'success', `Senha alterada e confirmada na tela. (${submitResult})`);
		await onStep('logout', 'success', 'Banco sincronizado. Concluido.');

	} finally {
		await browser.close();
	}
};

export const runPasswordAutomation = async (env: Env, payload: any, onStep: any): Promise<void> => {
	const maxRetries = 3;
	for (let i = 1; i <= maxRetries; i++) {
		try {
			await runPasswordAutomationAttempt(env, payload, onStep, `(Tentativa ${i}/${maxRetries})`);
			return;
		} catch (err: any) {
			const msg: string = err.message || '';
			// Não retentar em erros definitivos (senha errada, validação, sem confirmação)
			const isFatal =
				msg.includes('Credenciais incorretas') ||
				msg.includes('rejeitada pela Viki') ||
				msg.includes('login social') ||
				msg.includes('formulario recusou') ||
				msg.includes('nao foi possivel confirmar');

			if (i < maxRetries && !isFatal) {
				console.warn(`[Password] Tentativa ${i} falhou (${msg}). Aguardando para retry...`);
				await new Promise(r => setTimeout(r, 3000));
				continue;
			}
			throw err;
		}
	}
};
