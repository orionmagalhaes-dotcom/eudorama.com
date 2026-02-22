import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createInitialJobStatus, runVikiTvAutomationJob, type VikiTvAutomationJobStatus } from './server/vikiTvAutomationWorker';

const vikiAutomationJobs = new Map<string, VikiTvAutomationJobStatus>();
const INFINITY_PAY_PAYMENT_CHECK_URL = 'https://api.infinitepay.io/invoices/public/checkout/payment_check';

const readJsonBody = async (req: any): Promise<any> => {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const sendJson = (res: any, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const vikiAutomationDevPlugin = () => ({
  name: 'viki-tv-automation-dev-api',
  configureServer(server: any) {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      const method = String(req.method || '').toUpperCase();
      const url = String(req.url || '');
      const pathOnly = url.split('?')[0];

      if (method === 'POST' && pathOnly === '/api/infinitypay/payment-check') {
        try {
          const body = await readJsonBody(req);
          const handle = String(body?.handle || '').trim();
          const orderNsu = String(body?.order_nsu || body?.orderNsu || '').trim();
          const transactionNsu = String(body?.transaction_nsu || body?.transactionNsu || '').trim();
          const slug = String(body?.slug || '').trim();

          if (!handle || !orderNsu || !transactionNsu || !slug) {
            sendJson(res, 400, { success: false, paid: false, message: 'handle, order_nsu, transaction_nsu e slug sao obrigatorios.' });
            return;
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          let upstreamResponse: any;
          try {
            upstreamResponse = await fetch(INFINITY_PAY_PAYMENT_CHECK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                handle,
                order_nsu: orderNsu,
                transaction_nsu: transactionNsu,
                slug
              }),
              signal: controller.signal
            });
          } finally {
            clearTimeout(timeout);
          }

          const upstreamText = await upstreamResponse.text().catch(() => '');
          let upstreamBody: any = null;
          try {
            upstreamBody = upstreamText ? JSON.parse(upstreamText) : null;
          } catch {
            upstreamBody = upstreamText ? { message: upstreamText.slice(0, 220) } : null;
          }

          const status = String(upstreamBody?.status || '').toUpperCase();
          const apiSuccess = typeof upstreamBody?.success === 'boolean' ? upstreamBody.success : upstreamResponse.ok;
          const paidFromFlag = typeof upstreamBody?.paid === 'boolean' ? upstreamBody.paid : null;
          const paidFromStatus = ['PAID', 'APPROVED', 'CONFIRMED', 'CAPTURED'].includes(status);
          const paid = paidFromFlag ?? paidFromStatus;

          if (!upstreamResponse.ok || !apiSuccess) {
            const apiMessage = String(upstreamBody?.error || upstreamBody?.message || '').trim();
            sendJson(res, upstreamResponse.ok ? 200 : upstreamResponse.status, {
              success: false,
              paid: false,
              status,
              message: apiMessage || `Falha ao validar pagamento (HTTP ${upstreamResponse.status}).`,
              raw: upstreamBody
            });
            return;
          }

          sendJson(res, 200, {
            success: true,
            paid,
            status,
            raw: upstreamBody
          });
          return;
        } catch (e: any) {
          sendJson(res, 502, {
            success: false,
            paid: false,
            message: e?.message || 'Falha no backend ao validar pagamento.'
          });
          return;
        }
      }

      if (method === 'POST' && pathOnly === '/api/viki-tv-automation') {
        try {
          const body = await readJsonBody(req);
          const requestId = String(body?.requestId || '').trim();
          const payload = body?.payload || {};

          if (!requestId) {
            sendJson(res, 400, { success: false, message: 'requestId ausente' });
            return;
          }

          if (!payload?.tvUrl || !payload?.tvCode || !payload?.credentialEmail || !payload?.credentialPassword) {
            sendJson(res, 400, { success: false, message: 'payload incompleto' });
            return;
          }

          const initial = createInitialJobStatus(requestId);
          vikiAutomationJobs.set(requestId, initial);

          void runVikiTvAutomationJob(
            {
              requestId,
              tvModel: payload.tvModel,
              tvUrl: payload.tvUrl,
              tvCode: payload.tvCode,
              credentialEmail: payload.credentialEmail,
              credentialPassword: payload.credentialPassword
            },
            (updated) => {
              vikiAutomationJobs.set(requestId, updated);
            }
          );

          const queued = vikiAutomationJobs.get(requestId)!;
          sendJson(res, 200, {
            success: true,
            requestId,
            status: queued.status,
            executionStatus: queued.status,
            message: queued.message,
            steps: queued.steps
          });
          return;
        } catch (e: any) {
          sendJson(res, 500, { success: false, message: e?.message || 'erro interno' });
          return;
        }
      }

      if (method === 'GET' && pathOnly === '/api/viki-tv-automation/status') {
        try {
          const parsed = new URL(url, 'http://localhost');
          const requestId = String(parsed.searchParams.get('requestId') || '').trim();
          if (!requestId) {
            sendJson(res, 400, { success: false, message: 'requestId ausente' });
            return;
          }

          const status = vikiAutomationJobs.get(requestId);
          if (!status) {
            sendJson(res, 404, { success: false, message: 'requestId nao encontrado' });
            return;
          }

          sendJson(res, 200, {
            success: status.status === 'success',
            requestId: status.requestId,
            status: status.status,
            executionStatus: status.status,
            message: status.message,
            steps: status.steps
          });
          return;
        } catch (e: any) {
          sendJson(res, 500, { success: false, message: e?.message || 'erro interno' });
          return;
        }
      }

      next();
    });
  }
});

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react(), vikiAutomationDevPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
