import { createServer } from 'http';
import { parse } from 'url';
import {
  createInitialJobStatus,
  runVikiTvAutomationJob,
  type VikiTvAutomationJobStatus,
  type VikiTvModel
} from './server/vikiTvAutomationWorker.ts';
import {
  createInitialPasswordJobStatus,
  runVikiPasswordAutomationJob,
  type VikiPasswordAutomationJobStatus
} from './server/vikiPasswordAutomationWorker.ts';

const PORT = Number(process.env.PORT || 3000);
const MOTOR_TOKEN = String(
  process.env.VIKI_MOTOR_TOKEN ||
  process.env.VIKI_WEBHOOK_TOKEN ||
  process.env.VITE_VIKI_TV_AUTOMATION_TOKEN ||
  ''
).trim();

const tvJobs = new Map<string, VikiTvAutomationJobStatus>();
const passwordJobs = new Map<string, VikiPasswordAutomationJobStatus>();

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const sendJson = (res: any, statusCode: number, body: unknown) => {
  res.statusCode = statusCode;
  Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(JSON.stringify(body));
};

const readJsonBody = async (req: any): Promise<any> => {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const isAuthorized = (req: any) => {
  if (!MOTOR_TOKEN) return true;
  return String(req.headers.authorization || '') === `Bearer ${MOTOR_TOKEN}`;
};

const normalizeTvModel = (value: unknown): VikiTvModel | null => {
  if (value === 'samsung' || value === 'lg' || value === 'android') return value;
  return null;
};

const normalizeTvCode = (value: unknown): string => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);

const server = createServer(async (req, res) => {
  const parsedUrl = parse(req.url || '', true);
  const path = parsedUrl.pathname;
  const method = String(req.method || '').toUpperCase();

  Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if ((path || '').startsWith('/api/viki-') && !isAuthorized(req)) {
    sendJson(res, 401, { success: false, message: 'Nao autorizado' });
    return;
  }

  if (method === 'POST' && path === '/api/viki-tv-automation') {
    try {
      const data = await readJsonBody(req);
      const requestId = String(data.requestId || '').trim();
      const payload = data.payload || data;
      const tvModel = normalizeTvModel(payload.tvModel);
      const tvCode = normalizeTvCode(payload.tvCode);
      const tvUrl = String(payload.tvUrl || '').trim();
      const credentialEmail = String(payload.credentialEmail || '').trim();
      const credentialPassword = String(payload.credentialPassword || '');

      if (!requestId || !tvModel || !tvUrl || !/^[a-z0-9]{6}$/.test(tvCode) || !credentialEmail || !credentialPassword) {
        sendJson(res, 400, { success: false, message: 'Payload TV incompleto ou invalido', executionStatus: 'failed' });
        return;
      }

      const initial = createInitialJobStatus(requestId);
      tvJobs.set(requestId, initial);

      void runVikiTvAutomationJob(
        {
          requestId,
          tvModel,
          tvUrl,
          tvCode,
          credentialEmail,
          credentialPassword
        },
        (updated) => {
          tvJobs.set(requestId, updated);
        }
      );

      sendJson(res, 202, {
        success: true,
        requestId: initial.requestId,
        status: initial.status,
        executionStatus: initial.status,
        message: initial.message,
        steps: initial.steps
      });
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro interno no motor TV', executionStatus: 'failed' });
    }
    return;
  }

  if (method === 'POST' && path === '/api/viki-password-automation') {
    try {
      const data = await readJsonBody(req);
      const requestId = String(data.requestId || '').trim();
      const payload = data.payload || data;

      if (!requestId || !payload?.credentialEmail || !payload?.currentPassword || !payload?.newPassword) {
        sendJson(res, 400, { success: false, message: 'Payload senha incompleto', executionStatus: 'failed' });
        return;
      }

      const initial = createInitialPasswordJobStatus(requestId);
      passwordJobs.set(requestId, initial);

      void runVikiPasswordAutomationJob(
        {
          requestId,
          credentialEmail: String(payload.credentialEmail || '').trim(),
          currentPassword: String(payload.currentPassword || ''),
          newPassword: String(payload.newPassword || '')
        },
        (updated) => {
          passwordJobs.set(requestId, updated);
        }
      );

      sendJson(res, 202, {
        success: true,
        requestId: initial.requestId,
        status: initial.status,
        executionStatus: initial.status,
        message: initial.message,
        steps: initial.steps
      });
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro interno no motor de senha', executionStatus: 'failed' });
    }
    return;
  }

  if (method === 'GET' && (path === '/api/viki-tv-automation/status' || path === '/api/viki-password-automation/status')) {
    const requestId = String(parsedUrl.query.requestId || '').trim();
    if (!requestId) {
      sendJson(res, 400, { success: false, message: 'requestId missing', executionStatus: 'failed' });
      return;
    }

    const job = tvJobs.get(requestId) || passwordJobs.get(requestId);
    if (!job) {
      sendJson(res, 404, { success: false, requestId, message: 'requestId not found', status: 'failed', executionStatus: 'failed', steps: [] });
      return;
    }

    sendJson(res, 200, {
      success: job.status === 'success',
      requestId: job.requestId,
      status: job.status,
      executionStatus: job.status,
      message: job.message,
      steps: job.steps
    });
    return;
  }

  sendJson(res, 404, { success: false, message: 'Not Found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nMotor de Automacao Eudorama rodando.');
  console.log(`Porta: ${PORT}`);
  console.log('Endpoints: /api/viki-tv-automation e /api/viki-password-automation');
  console.log(MOTOR_TOKEN ? 'Auth: Bearer token ativo.' : 'Auth: sem token local configurado.');
});
