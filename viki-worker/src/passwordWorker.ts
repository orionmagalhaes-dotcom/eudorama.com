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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const clickByText = async (page: any, values: string[]): Promise<boolean> => {
	const targets = values.map((item) => item.toLowerCase());
	return page.evaluate((texts: string[]) => {
		const doc = (globalThis as any).document;
		if (!doc) return false;
		const elements = Array.from(doc.querySelectorAll('button,a,[role="button"]')) as any[];
		for (const element of elements) {
			const text = String(element?.textContent || '').trim().toLowerCase();
			if (!text) continue;
			if (texts.some((candidate) => text.includes(candidate))) {
				element.click();
				return true;
			}
		}
		return false;
	}, targets);
};

const clickLoginCta = async (page: any): Promise<boolean> => {
	return page.evaluate(() => {
		const doc = (globalThis as any).document;
		if (!doc) return false;
		const elements = Array.from(doc.querySelectorAll('a,button,[role="button"]')) as any[];
		const logins = elements.filter((element) => /log in/i.test(String(element?.textContent || '').trim()));
		if (logins.length === 0) return false;

		const preferred = logins.find((element) => {
			const rect = element.getBoundingClientRect();
			return rect.y > 80 && rect.width > 40 && rect.height > 20;
		});

		(preferred || logins[0]).click();
		return true;
	});
};

const firstSelector = async (page: any, selectors: string[]): Promise<string | null> => {
	for (const selector of selectors) {
		const found = await page.$(selector);
		if (found) return selector;
	}
	return null;
};

const fillInput = async (page: any, selectors: string[], value: string): Promise<void> => {
	const selector = await firstSelector(page, selectors);
	if (!selector) throw new Error(`Campo nao encontrado: ${selectors[0]}`);
	await page.click(selector, { clickCount: 3 });
	await page.keyboard.press('Backspace');
	await page.type(selector, value, { delay: 20 });
};
export const runPasswordAutomationAttempt = async (
	env: Env,
	payload: any,
	onStep: (key: string, status: any, details?: string) => Promise<void>,
	attemptInfo: string
): Promise<void> => {
	let browser: any;
	let page: any;
	let launchAttempts = 3;
	
	while (launchAttempts > 0) {
		try {
			browser = await puppeteer.launch(env.BROWSER);
			await sleep(1000); // Estabilização
			page = await browser.newPage();
			break; // Sucesso
		} catch (err: any) {
			launchAttempts--;
			const is429 = err.message.includes('429');
			const isSessionError = err.message.includes('Unable to connect to existing session') || err.message.includes('reading \'accept\'');

			if (launchAttempts > 0 && (is429 || isSessionError)) {
				const reason = is429 ? 'Limite atingido' : 'Sessao instavel';
				await onStep('dispatch', 'running', `${reason}. Tentando novamente... (${3 - launchAttempts}/3)`);
				await sleep(is429 ? 10000 : 2000); 
				continue;
			}
			throw err;
		}
	}

		await onStep('dispatch', 'running', `Iniciando navegador na nuvem. ${attemptInfo}`);

		await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
		await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

		await onStep('dispatch', 'running', 'Navegador iniciado.');
		await onStep('login', 'running', 'Abrindo pagina de login...');

		// Usa a mesma rota base da TV
		await page.goto('https://www.viki.com/samsungtv', { waitUntil: 'domcontentloaded', timeout: 120000 });
		await sleep(2200);

		// Verifica se já está logado (se o botão de login não existir mas existirem elementos de logado)
		const clickedLogin = await clickLoginCta(page);
		if (!clickedLogin) {
			const isLogado = await page.evaluate(() => {
				const doc = (globalThis as any).document;
				return !!doc?.querySelector('button[aria-label*="Account" i], button[aria-label*="Profile" i], .sc-avatar, a[href*="/sign-out"]');
			});
			if (isLogado) {
				console.log('[Password] Sessao ja ativa detectada. Pulando etapa de preenchimento de login.');
				await onStep('login', 'success', 'Login ja estava ativo ou recuperado.');
			} else {
				throw new Error('Botao "Log in" nao encontrado e nenhuma sessao ativa detectada. Verifique se a pagina carregou corretamente.');
			}
		} else {
			// Prossegue com o login padrão
			await sleep(1500);
			await fillInput(page, ['input[placeholder="Email"]', 'input[type="email"]'], payload.credentialEmail);
			await fillInput(page, ['input[placeholder="Password"]', 'input[type="password"]'], payload.currentPassword || payload.credentialPassword);

			const clickedContinue = await clickByText(page, ['continue']);
			if (!clickedContinue) throw new Error('Botao Continue nao encontrado');

			await sleep(5000);

			// Só verifica erros de login se continuarmos em uma página de login
			const urlAgora = page.url();
			if (urlAgora.includes('sign-in') || urlAgora.includes('login') || urlAgora.includes('web-sign-in')) {
				const loginBody = await page.evaluate(() => {
					const doc = (globalThis as any).document;
					return String(doc?.body?.innerText || '').replace(/\s+/g, ' ');
				});
				if (/wrong password|senha incorreta|invalid password|incorrect password|invalid credentials/i.test(loginBody)) {
					throw new Error('E-mail ou Senha incorretos na Viki. Verifique as credenciais e tente novamente.');
				}
				if (/oh no, something went wrong|unexpected issue|try again in a few minutes/i.test(loginBody)) {
					throw new Error('Limite de tentativas atingido ou Erro Temporário na Viki. O acesso foi bloqueado por segurança. Tente novamente em alguns minutos.');
				}
				throw new Error('Login nao foi concluido. A pagina de login ainda esta aberta apos tentativa.');
			}

			await onStep('login', 'success', 'Login realizado com sucesso.');
		}
		await onStep('openSettings', 'running', 'Navegando para configuracoes da conta...');

		// --- CONFIGURAÇÕES ---
		await page.goto('https://www.viki.com/user-account-settings#account', { waitUntil: 'networkidle0', timeout: 80000 });
		await new Promise<void>(res => setTimeout(res, 4000));

		const changePassClicked = await page.evaluate(() => {
			// Busca todos os blocos de informação (E-mail e Senha)
			const labels = Array.from(document.querySelectorAll('div, span, p, label'));
			let senhaLabel: HTMLElement | null = null;
			
			// Localiza especificamente o texto "Senha" ou "Password"
			for (const l of labels) {
				const txt = (l.textContent || '').trim().toLowerCase();
				if (txt === 'senha' || txt === 'password') {
					senhaLabel = l as HTMLElement;
					break;
				}
			}

			if (senhaLabel) {
				// Busca o botão "Mudar" ou "Change" dentro do mesmo contexto ou próximo
				const parent = senhaLabel.parentElement?.parentElement;
				if (parent) {
					const btn = parent.querySelector('button, a, [role="button"]') as HTMLElement | null;
					if (btn && (btn.innerText.toLowerCase().includes('mudar') || btn.innerText.toLowerCase().includes('change'))) {
						btn.click();
						return 'clicked_by_proximity';
					}
				}
			}

			// Fallback caso a lógica de proximidade falhe (tentativa genérica revisada)
			const texts = ['mudar senha', 'alterar senha', 'mudar a senha'];
			const items = Array.from(document.querySelectorAll('button, a, [role="button"]'));
			for (const item of items) {
				const t = (item.textContent || '').toLowerCase();
				if (texts.some(txt => t.includes(txt))) {
					(item as any).click();
					return 'clicked_by_text_match';
				}
			}
			
			// Se o botão for apenas "Mudar" mas não for e-mail
			for (const item of items) {
				const t = (item.textContent || '').toLowerCase().trim();
				const parentText = (item.parentElement?.innerText || '').toLowerCase();
				if (t === 'mudar' && parentText.includes('senha') && !parentText.includes('email')) {
					(item as any).click();
					return 'clicked_mudar_filtered';
				}
			}

			return null;
		});

		if (!changePassClicked) {
			throw new Error('Botao "Mudar Senha" nao encontrado. Verifique se a conta usa login social ou se o layout mudou.');
		}
		console.log(`[Password] Botao de troca de senha acionado via: ${changePassClicked}`);

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
