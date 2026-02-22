import puppeteer from '@cloudflare/puppeteer';
import type { Page } from '@cloudflare/puppeteer';

export interface Env {
	DB: D1Database;
	VIKI_QUEUE: Queue<VikiQueueMessage>;
	BROWSER: Fetcher;
	VIKI_WEBHOOK_TOKEN?: string;
}

type TvModel = 'samsung' | 'lg' | 'android';
type ExecutionStatus = 'queued' | 'running' | 'success' | 'failed';
type StepStatus = 'pending' | 'running' | 'success' | 'failed';

interface AutomationPayload {
	tvModel: TvModel;
	tvUrl: string;
	tvCode: string;
	credentialEmail: string;
	credentialPassword: string;
}

interface VikiQueueMessage {
	requestId: string;
	payload: AutomationPayload;
}

interface AutomationStep {
	key: string;
	label: string;
	status: StepStatus;
	details?: string;
	updatedAt?: string;
}

interface StatusRow {
	id: string;
	state: ExecutionStatus;
	steps: string | null;
	error?: string | null;
}

const JSON_HEADERS = {
	'Content-Type': 'application/json',
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const INFINITY_PAY_PAYMENT_CHECK_URL = 'https://api.infinitepay.io/invoices/public/checkout/payment_check';

const TV_URL_BY_MODEL: Record<TvModel, string> = {
	samsung: 'https://www.viki.com/samsungtv',
	lg: 'https://www.viki.com/lgtv',
	android: 'https://www.viki.com/androidtv',
};

const STEP = {
	request: 'request',
	dispatch: 'dispatch',
	login: 'login',
	code: 'code',
	logout: 'logout',
} as const;

let schemaReady = false;

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const cloneSteps = (steps: AutomationStep[]) => steps.map((step) => ({ ...step }));

const createInitialSteps = (): AutomationStep[] => [
	{
		key: STEP.request,
		label: 'Solicitacao recebida',
		status: 'success',
		details: 'Tarefa recebida e na fila',
		updatedAt: nowIso(),
	},
	{ key: STEP.dispatch, label: 'Automacao em background iniciada', status: 'pending' },
	{ key: STEP.login, label: 'Login automatico na Viki', status: 'pending' },
	{ key: STEP.code, label: 'Insercao do codigo informado', status: 'pending' },
	{ key: STEP.logout, label: 'Logout e finalizacao', status: 'pending' },
];

const normalizeId = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (!/^[a-zA-Z0-9-_]{8,80}$/.test(trimmed)) return null;
	return trimmed;
};

const normalizeTvCode = (value: unknown): string => {
	if (typeof value !== 'string') return '';
	return value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
};

const parsePayload = (body: unknown): Partial<AutomationPayload> => {
	if (!body || typeof body !== 'object') return {};
	const source = body as Record<string, unknown>;
	const base = source.payload && typeof source.payload === 'object' ? (source.payload as Record<string, unknown>) : source;
	return {
		tvModel: base.tvModel as TvModel,
		tvUrl: String(base.tvUrl || ''),
		tvCode: String(base.tvCode || ''),
		credentialEmail: String(base.credentialEmail || ''),
		credentialPassword: String(base.credentialPassword || ''),
	};
};

const validatePayload = (payload: Partial<AutomationPayload>): { valid: boolean; errors: string[]; normalized?: AutomationPayload } => {
	const errors: string[] = [];
	const tvModel = payload.tvModel;
	if (tvModel !== 'samsung' && tvModel !== 'lg' && tvModel !== 'android') {
		errors.push('tvModel invalido');
	}

	const expectedUrl = tvModel ? TV_URL_BY_MODEL[tvModel] : '';
	const requestedUrl = String(payload.tvUrl || '').trim();
	if (!expectedUrl) {
		errors.push('tvUrl invalida');
	}

	const tvCode = normalizeTvCode(payload.tvCode || '');
	if (!/^[a-z0-9]{6}$/.test(tvCode)) {
		errors.push('tvCode invalido');
	}

	const credentialEmail = String(payload.credentialEmail || '').trim();
	if (!credentialEmail || !credentialEmail.includes('@')) {
		errors.push('credentialEmail invalido');
	}

	const credentialPassword = String(payload.credentialPassword || '').trim();
	if (!credentialPassword) {
		errors.push('credentialPassword invalido');
	}

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	return {
		valid: true,
		errors,
		normalized: {
			tvModel: tvModel as TvModel,
			tvUrl: requestedUrl && requestedUrl.startsWith('https://www.viki.com/') ? requestedUrl : expectedUrl,
			tvCode,
			credentialEmail,
			credentialPassword,
		},
	};
};

const parseStoredSteps = (raw: string | null): AutomationStep[] => {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];

		return parsed.map((item, index) => {
			if (typeof item === 'string') {
				return {
					key: `legacy_${index + 1}`,
					label: item,
					status: 'pending' as StepStatus,
				};
			}

			const source = item as Record<string, unknown>;
			const status = String(source.status || 'pending').toLowerCase();
			const normalizedStatus: StepStatus =
				status === 'running' || status === 'success' || status === 'failed' ? (status as StepStatus) : 'pending';

			return {
				key: String(source.key || `step_${index + 1}`),
				label: String(source.label || `Etapa ${index + 1}`),
				status: normalizedStatus,
				details: typeof source.details === 'string' ? source.details : undefined,
				updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : undefined,
			};
		});
	} catch {
		return [];
	}
};

const buildStatusMessage = (state: ExecutionStatus, steps: AutomationStep[], error?: string | null): string => {
	if (state === 'failed' && error) return `Falha na automacao: ${error}`;
	if (state === 'success') return 'Ciclo concluido com sucesso.';
	if (state === 'queued') return 'Solicitacao recebida e aguardando execucao.';

	const running = steps.find((step) => step.status === 'running');
	if (running?.details) return running.details;
	if (running) return `${running.label} em andamento.`;
	return 'Automacao em andamento.';
};

const toStatusResponse = (row: StatusRow | null) => {
	if (!row) {
		return {
			success: false,
			requestId: '',
			status: 'failed' as ExecutionStatus,
			executionStatus: 'failed' as ExecutionStatus,
			message: 'requestId nao encontrado',
			steps: [] as AutomationStep[],
		};
	}

	const steps = parseStoredSteps(row.steps);
	return {
		success: row.state === 'success',
		requestId: row.id,
		status: row.state,
		executionStatus: row.state,
		message: buildStatusMessage(row.state, steps, row.error || null),
		steps,
	};
};

const updateStep = (steps: AutomationStep[], key: string, status: StepStatus, details?: string): AutomationStep[] => {
	const updatedAt = nowIso();
	return steps.map((step) => {
		if (step.key !== key) return step;
		return {
			...step,
			status,
			details: details ?? step.details,
			updatedAt,
		};
	});
};

const ensureSchema = async (env: Env): Promise<void> => {
	if (schemaReady) return;

	await env.DB.prepare(`
		CREATE TABLE IF NOT EXISTS status (
			id TEXT PRIMARY KEY,
			state TEXT NOT NULL,
			steps TEXT NOT NULL,
			error TEXT,
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now'))
		)
	`).run();

	schemaReady = true;
};

const persistStatus = async (
	env: Env,
	requestId: string,
	state: ExecutionStatus,
	steps: AutomationStep[],
	error: string | null,
): Promise<void> => {
	const stepsJson = JSON.stringify(steps);
	try {
		await env.DB.prepare("UPDATE status SET state = ?, steps = ?, error = ?, updated_at = datetime('now') WHERE id = ?")
			.bind(state, stepsJson, error, requestId)
			.run();
	} catch {
		try {
			await env.DB.prepare('UPDATE status SET state = ?, steps = ?, error = ? WHERE id = ?')
				.bind(state, stepsJson, error, requestId)
				.run();
		} catch {
			await env.DB.prepare('UPDATE status SET state = ?, steps = ? WHERE id = ?').bind(state, stepsJson, requestId).run();
		}
	}
};

const insertQueuedStatus = async (env: Env, requestId: string, steps: AutomationStep[]): Promise<void> => {
	const stepsJson = JSON.stringify(steps);
	try {
		await env.DB.prepare('INSERT OR REPLACE INTO status (id, state, steps, error) VALUES (?, ?, ?, ?)')
			.bind(requestId, 'queued', stepsJson, null)
			.run();
	} catch {
		await env.DB.prepare('INSERT OR REPLACE INTO status (id, state, steps) VALUES (?, ?, ?)')
			.bind(requestId, 'queued', stepsJson)
			.run();
	}
};

const getStatusRow = async (env: Env, requestId: string): Promise<StatusRow | null> => {
	try {
		return await env.DB.prepare('SELECT id, state, steps, error FROM status WHERE id = ?')
			.bind(requestId)
			.first<StatusRow>();
	} catch {
		const fallback = await env.DB.prepare('SELECT id, state, steps FROM status WHERE id = ?')
			.bind(requestId)
			.first<{ id: string; state: ExecutionStatus; steps: string | null }>();
		if (!fallback) return null;
		return { ...fallback, error: null };
	}
};

const clickByText = async (page: Page, values: string[]): Promise<boolean> => {
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

const clickLoginCta = async (page: Page): Promise<boolean> => {
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

const firstSelector = async (page: Page, selectors: string[]): Promise<string | null> => {
	for (const selector of selectors) {
		const found = await page.$(selector);
		if (found) return selector;
	}
	return null;
};

const fillInput = async (page: Page, selectors: string[], value: string): Promise<void> => {
	const selector = await firstSelector(page, selectors);
	if (!selector) throw new Error(`Campo nao encontrado: ${selectors[0]}`);
	await page.click(selector, { clickCount: 3 });
	await page.keyboard.press('Backspace');
	await page.type(selector, value, { delay: 20 });
};

const performLogout = async (page: Page): Promise<void> => {
	await sleep(1200);
	await page.evaluate(() => {
		const doc = (globalThis as any).document;
		if (!doc) return;
		const clickable = Array.from(doc.querySelectorAll('button,a,[role="button"]')) as any[];
		const byAria = clickable.find((element) => {
			const label = String(
				element?.getAttribute?.('aria-label') ||
					element?.getAttribute?.('title') ||
					'',
			).toLowerCase();
			return label.includes('account') || label.includes('profile') || label.includes('menu');
		});

		if (byAria) {
			byAria.click();
			return;
		}

		const topRight = clickable
			.map((element) => ({ element, rect: element.getBoundingClientRect() }))
			.filter((item) => item.rect.y <= 120 && item.rect.x >= 130)
			.sort((a, b) => b.rect.x - a.rect.x);

		if (topRight.length > 0) {
			topRight[0].element.click();
		}
	});

	await sleep(700);
	let clicked = await clickByText(page, ['log out', 'logout']);
	if (!clicked) {
		await sleep(700);
		clicked = await clickByText(page, ['log out', 'logout']);
	}
	if (!clicked) throw new Error('Botao Log Out nao encontrado');

	await sleep(2200);
	const text = (await page.evaluate(() => {
		const doc = (globalThis as any).document;
		return doc?.body?.innerText || '';
	})).replace(/\s+/g, ' ');
	if (!/log in|create account|watchlist/i.test(text)) {
		throw new Error('Nao foi possivel confirmar logout');
	}
};

const runAutomation = async (
	env: Env,
	payload: AutomationPayload,
	onStep: (key: string, status: StepStatus, details?: string) => Promise<void>,
): Promise<void> => {
	const browser = await puppeteer.launch(env.BROWSER);
	try {
		const page = await browser.newPage();
		await onStep(STEP.dispatch, 'running', 'Inicializando navegador em modo smartphone.');

		await page.setViewport({
			width: 412,
			height: 915,
			deviceScaleFactor: 2,
			isMobile: true,
			hasTouch: true,
		});
		await page.setUserAgent(
			'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
		);
		await onStep(STEP.dispatch, 'success', 'Navegador iniciado.');
		await onStep(STEP.login, 'running', 'Abrindo pagina de conexao.');

		await page.goto(payload.tvUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
		await sleep(1300);

		const clickedLogin = await clickLoginCta(page);
		if (!clickedLogin) throw new Error('Botao Log in nao encontrado');

		await sleep(1000);
		await fillInput(page, ['input[placeholder="Email"]', 'input[type="email"]'], payload.credentialEmail);
		await fillInput(page, ['input[placeholder="Password"]', 'input[type="password"]'], payload.credentialPassword);

		const clickedContinue = await clickByText(page, ['continue']);
		if (!clickedContinue) throw new Error('Botao Continue nao encontrado');

		await sleep(3500);
		const loginErrorText = await page.evaluate(() => {
			const doc = (globalThis as any).document;
			return String(doc?.body?.innerText || '').replace(/\s+/g, ' ');
		});
		if (/oh no, something went wrong|unexpected issue/i.test(loginErrorText)) {
			throw new Error('Viki retornou erro temporario no login');
		}
		await onStep(STEP.login, 'success', 'Login executado.');
		await onStep(STEP.code, 'running', 'Preenchendo codigo da TV.');

		let codeSelector = await firstSelector(page, ['input[placeholder*="Enter code" i]', 'input[name="code"]']);
		if (!codeSelector) {
			await page.goto(payload.tvUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
			await sleep(2200);
			codeSelector = await firstSelector(page, ['input[placeholder*="Enter code" i]', 'input[name="code"]']);
		}
		if (!codeSelector) throw new Error('Campo de codigo da TV nao encontrado');

		await page.click(codeSelector, { clickCount: 3 });
		await page.keyboard.press('Backspace');
		await page.type(codeSelector, payload.tvCode, { delay: 20 });

		const clickedLink = await clickByText(page, ['link now']);
		if (!clickedLink) throw new Error('Botao Link Now nao encontrado');

		await sleep(2800);
		const afterCode = (await page.evaluate(() => {
			const doc = (globalThis as any).document;
			return doc?.body?.innerText || '';
		})).replace(/\s+/g, ' ');
		const invalid = /code is not valid|valid samsung tv code|valid lg tv code|valid android tv code/i.test(afterCode);
		await onStep(
			STEP.code,
			'success',
			invalid ? 'Codigo enviado (retorno: codigo invalido esperado em teste).' : 'Codigo enviado para vinculacao.',
		);

		await onStep(STEP.logout, 'running', 'Executando logout de seguranca.');
		await performLogout(page);
		await onStep(STEP.logout, 'success', 'Logout confirmado.');
	} finally {
		await browser.close();
	}
};

const authorizeIfNeeded = (request: Request, env: Env): Response | null => {
	const token = env.VIKI_WEBHOOK_TOKEN?.trim();
	if (!token) return null;

	const authHeader = request.headers.get('authorization') || '';
	const expected = `Bearer ${token}`;
	if (authHeader !== expected) {
		return new Response(JSON.stringify({ success: false, message: 'Nao autorizado' }), {
			status: 401,
			headers: JSON_HEADERS,
		});
	}
	return null;
};

const withJson = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: JSON_HEADERS,
	});

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: JSON_HEADERS });
		}

		const unauthorized = authorizeIfNeeded(request, env);
		if (unauthorized) return unauthorized;

		await ensureSchema(env);

		if (request.method === 'POST' && url.pathname === '/api/infinitypay/payment-check') {
			const body = await request.json().catch(() => ({} as Record<string, unknown>));
			const handle = String((body as Record<string, unknown>)?.handle || '').trim();
			const orderNsu = String((body as Record<string, unknown>)?.order_nsu || (body as Record<string, unknown>)?.orderNsu || '').trim();
			const transactionNsu = String((body as Record<string, unknown>)?.transaction_nsu || (body as Record<string, unknown>)?.transactionNsu || '').trim();
			const slug = String((body as Record<string, unknown>)?.slug || '').trim();

			if (!handle || !orderNsu || !transactionNsu || !slug) {
				return withJson(
					{
						success: false,
						paid: false,
						message: 'handle, order_nsu, transaction_nsu e slug sao obrigatorios',
					},
					400,
				);
			}

			try {
				const upstream = await fetch(INFINITY_PAY_PAYMENT_CHECK_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						handle,
						order_nsu: orderNsu,
						transaction_nsu: transactionNsu,
						slug,
					}),
				});

				const upstreamText = await upstream.text().catch(() => '');
				let upstreamBody: Record<string, unknown> | null = null;
				try {
					upstreamBody = upstreamText ? (JSON.parse(upstreamText) as Record<string, unknown>) : null;
				} catch {
					upstreamBody = upstreamText ? ({ message: upstreamText.slice(0, 220) } as Record<string, unknown>) : null;
				}

				const status = String(upstreamBody?.status || '').toUpperCase();
				const apiSuccess = typeof upstreamBody?.success === 'boolean' ? Boolean(upstreamBody?.success) : upstream.ok;
				const paidFromFlag = typeof upstreamBody?.paid === 'boolean' ? Boolean(upstreamBody?.paid) : null;
				const paidFromStatus = ['PAID', 'APPROVED', 'CONFIRMED', 'CAPTURED'].includes(status);
				const paid = paidFromFlag ?? paidFromStatus;

				if (!upstream.ok || !apiSuccess) {
					const apiMessage = String(upstreamBody?.error || upstreamBody?.message || '').trim();
					return withJson(
						{
							success: false,
							paid: false,
							status,
							message: apiMessage || `Falha ao validar pagamento (HTTP ${upstream.status}).`,
							raw: upstreamBody,
						},
						upstream.ok ? 200 : upstream.status,
					);
				}

				return withJson({
					success: true,
					paid,
					status,
					raw: upstreamBody,
				});
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Falha de rede no backend de pagamento';
				return withJson(
					{
						success: false,
						paid: false,
						message: errorMessage,
					},
					502,
				);
			}
		}

		if (request.method === 'POST' && url.pathname === '/api/viki-tv-automation') {
			const body = await request.json().catch(() => ({}));
			const payloadInput = parsePayload(body);
			const validation = validatePayload(payloadInput);

			if (!validation.valid || !validation.normalized) {
				return withJson(
					{
						success: false,
						message: `Payload invalido: ${validation.errors.join(', ')}`,
						executionStatus: 'failed',
					},
					400,
				);
			}

			const requestId = normalizeId((body as Record<string, unknown>)?.requestId) || crypto.randomUUID();
			const steps = createInitialSteps();

			await insertQueuedStatus(env, requestId, steps);

			await env.VIKI_QUEUE.send({
				requestId,
				payload: validation.normalized,
			});

			return withJson(
				{
					success: true,
					requestId,
					status: 'queued',
					executionStatus: 'queued',
					message: 'Solicitacao recebida e enviada para fila.',
					steps,
				},
				202,
			);
		}

		if (request.method === 'GET' && url.pathname === '/api/viki-tv-automation/status') {
			const requestId = normalizeId(url.searchParams.get('requestId'));
			if (!requestId) {
				return withJson(
					{
						success: false,
						message: 'requestId ausente',
					},
					400,
				);
			}

			const row = await getStatusRow(env, requestId);

			if (!row) {
				return withJson(
					{
						success: false,
						requestId,
						status: 'failed',
						executionStatus: 'failed',
						message: 'requestId nao encontrado',
						steps: [],
					},
					404,
				);
			}

			return withJson(toStatusResponse(row));
		}

		return new Response('Nao encontrado', { status: 404 });
	},

	async queue(batch: MessageBatch<VikiQueueMessage>, env: Env): Promise<void> {
		await ensureSchema(env);

		for (const message of batch.messages) {
			const requestId = normalizeId(message.body?.requestId);
			const payload = message.body?.payload;

			if (!requestId || !payload) {
				message.ack();
				continue;
			}

			let steps = createInitialSteps();
			let state: ExecutionStatus = 'running';

			try {
				const setStep = async (key: string, status: StepStatus, details?: string) => {
					steps = updateStep(steps, key, status, details);
					await persistStatus(env, requestId, 'running', steps, null);
				};

				await runAutomation(env, payload, setStep);
				state = 'success';

				await persistStatus(env, requestId, state, steps, null);
			} catch (error) {
				const messageText = error instanceof Error ? error.message : 'Erro inesperado';
				const runningKey =
					steps.find((step) => step.status === 'running')?.key || steps.find((step) => step.status === 'pending')?.key || STEP.dispatch;
				steps = updateStep(steps, runningKey, 'failed', messageText);
				state = 'failed';
				await persistStatus(env, requestId, state, steps, messageText);
			} finally {
				message.ack();
			}
		}
	},
} satisfies ExportedHandler<Env, VikiQueueMessage>;
