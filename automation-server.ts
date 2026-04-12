import { createServer } from 'http';
import { parse } from 'url';
import { 
  createInitialPasswordJobStatus, 
  runVikiPasswordAutomationJob, 
  type VikiPasswordAutomationJobStatus 
} from './server/vikiPasswordAutomationWorker.ts';

const PORT = 3000;
const passwordJobs = new Map<string, VikiPasswordAutomationJobStatus>();

const server = createServer(async (req, res) => {
  const parsedUrl = parse(req.url || '', true);
  const path = parsedUrl.pathname;
  const method = req.method;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // POST: Start Automation
  if (method === 'POST' && path === '/api/viki-password-automation') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const requestId = data.requestId;
        const payload = data.payload;

        if (!requestId || !payload?.credentialEmail || !payload?.currentPassword || !payload?.newPassword) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, message: 'Missing parameters' }));
          return;
        }

        const initial = createInitialPasswordJobStatus(requestId);
        passwordJobs.set(requestId, initial);

        // Start automation in background
        void runVikiPasswordAutomationJob(
          {
            requestId,
            credentialEmail: payload.credentialEmail,
            currentPassword: payload.currentPassword,
            newPassword: payload.newPassword
          },
          (updated) => {
            passwordJobs.set(requestId, updated);
          }
        );

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          success: true, 
          status: initial.status, 
          requestId: initial.requestId,
          steps: initial.steps 
        }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
      }
    });
    return;
  }

  // GET: Check Status
  if (method === 'GET' && path === '/api/viki-password-automation/status') {
    const requestId = parsedUrl.query.requestId as string;
    if (!requestId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, message: 'requestId missing' }));
      return;
    }

    const job = passwordJobs.get(requestId);
    if (!job) {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, message: 'requestId not found' }));
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(job));
    return;
  }

  // Not Found
  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Servidor de Automação Eudorama rodando!`);
  console.log(`📍 Porta: ${PORT}`);
  console.log(`✅ Pronto para receber trocas de senha do site eudorama.com\n`);
});
