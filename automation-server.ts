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
import {
  connectWhatsApp,
  disconnectWhatsApp,
  resetWhatsAppSession,
  getWhatsAppStatus,
  getQrCodeDataUrl,
  sendWhatsAppTextMessage,
  formatPhoneToJid
} from './server/whatsappService.ts';
import {
  getChargeQueue,
  runDailyChargeCycle,
  sendSingleCharge,
  getSchedulerState,
  getSchedulerLogs,
  updateSchedulerConfig,
  startDailyChargeScheduler,
  runReactivationCampaign,
  getReactivationStatus,
  getReactivationQueue,
  sendSingleReactivation,
  runClientPromoCampaign,
  getClientPromoStatus,
  getClientPromoQueue,
  sendSingleClientPromo
} from './server/whatsappChargeScheduler.ts';

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

  // --- ROTAS DO WHATSAPP E COBRANÇAS ---
  if (method === 'GET' && path === '/api/whatsapp/status') {
    const wsStatus = getWhatsAppStatus();
    const scheduler = getSchedulerState();
    sendJson(res, 200, { success: true, ...wsStatus, scheduler });
    return;
  }

  if (method === 'GET' && path === '/api/whatsapp/qr') {
    const qrCodeDataUrl = getQrCodeDataUrl();
    const wsStatus = getWhatsAppStatus();
    sendJson(res, 200, { success: true, qrCodeDataUrl, status: wsStatus.state, hasQr: Boolean(qrCodeDataUrl) });
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/connect') {
    const status = await connectWhatsApp();
    sendJson(res, 200, { success: true, status });
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/disconnect') {
    const result = await disconnectWhatsApp();
    sendJson(res, 200, result);
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/reset-session') {
    const result = await resetWhatsAppSession();
    sendJson(res, 200, result);
    return;
  }

  if (method === 'GET' && path === '/api/whatsapp/queue') {
    try {
      const queue = await getChargeQueue();
      sendJson(res, 200, { success: true, queue });
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro ao carregar fila de cobranças' });
    }
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/trigger-cycle') {
    void runDailyChargeCycle(true);
    sendJson(res, 202, {
      success: true,
      message: 'Ciclo de cobranças iniciado em segundo plano no servidor.'
    });
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/send-single') {
    try {
      const data = await readJsonBody(req);
      const clientId = String(data.clientId || '').trim();
      const serviceName = String(data.serviceName || '').trim();

      if (!clientId || !serviceName) {
        sendJson(res, 400, { success: false, message: 'clientId e serviceName são obrigatórios' });
        return;
      }

      const result = await sendSingleCharge(clientId, serviceName);
      sendJson(res, result.success ? 200 : 400, result);
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro ao processar envio individual' });
    }
    return;
  }

  if (method === 'GET' && path === '/api/whatsapp/logs') {
    const logs = getSchedulerLogs();
    sendJson(res, 200, { success: true, logs });
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/scheduler-config') {
    try {
      const body = await readJsonBody(req);
      updateSchedulerConfig(body);
      sendJson(res, 200, { success: true, scheduler: getSchedulerState() });
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro ao atualizar agendador' });
    }
    return;
  }

  if (method === 'GET' && path === '/api/whatsapp/reactivation-status') {
    sendJson(res, 200, { success: true, status: getReactivationStatus() });
    return;
  }

  if (method === 'GET' && path === '/api/whatsapp/reactivation-queue') {
    try {
      const queue = await getReactivationQueue();
      sendJson(res, 200, { success: true, queue });
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro ao carregar fila de reativação' });
    }
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/send-reactivation-single') {
    try {
      const data = await readJsonBody(req);
      const clientId = String(data.clientId || '').trim();
      if (!clientId) {
        sendJson(res, 400, { success: false, message: 'clientId é obrigatório' });
        return;
      }
      const result = await sendSingleReactivation(clientId);
      sendJson(res, result.success ? 200 : 400, result);
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro ao enviar mensagem promocional' });
    }
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/trigger-reactivation') {
    try {
      const result = await runReactivationCampaign(true);
      sendJson(res, 200, { success: true, ...result });
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro ao disparar campanha de reativação' });
    }
    return;
  }

  if (method === 'GET' && path === '/api/whatsapp/client-promo-status') {
    sendJson(res, 200, { success: true, status: getClientPromoStatus() });
    return;
  }

  if (method === 'GET' && path === '/api/whatsapp/client-promo-queue') {
    try {
      const queue = await getClientPromoQueue();
      sendJson(res, 200, { success: true, queue });
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro ao carregar fila de promo cliente' });
    }
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/send-client-promo-single') {
    try {
      const data = await readJsonBody(req);
      const clientId = String(data.clientId || '').trim();
      if (!clientId) {
        sendJson(res, 400, { success: false, message: 'clientId é obrigatório' });
        return;
      }
      const result = await sendSingleClientPromo(clientId);
      sendJson(res, result.success ? 200 : 400, result);
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro ao enviar promoção para cliente' });
    }
    return;
  }

  if (method === 'POST' && path === '/api/whatsapp/trigger-client-promo') {
    try {
      const result = await runClientPromoCampaign(true);
      sendJson(res, 200, { success: true, ...result });
    } catch (e: any) {
      sendJson(res, 500, { success: false, message: e?.message || 'Erro ao disparar campanha promo cliente' });
    }
    return;
  }

  // Rota de TESTE: envia mensagem de teste para um número específico com prefixo [TESTE]
  if (method === 'POST' && path === '/api/whatsapp/send-test') {
    try {
      const data = await readJsonBody(req);
      const phone = String(data.phone || '').replace(/\D/g, '').trim();
      const stage = String(data.stage || 'due');
      const clientName = String(data.clientName || 'Dorameira').trim();
      const service = String(data.service || 'Viki').trim();
      const price = String(data.price || 'R$ 24,90').trim();
      const expiryDate = String(data.expiryDate || new Date().toLocaleDateString('pt-BR')).trim();

      if (!phone || phone.length < 10) {
        sendJson(res, 400, { success: false, message: 'Número de telefone inválido (mínimo 10 dígitos)' });
        return;
      }

      const wsStatus = getWhatsAppStatus();
      if (wsStatus.state !== 'connected') {
        sendJson(res, 400, { success: false, message: 'WhatsApp não está conectado no servidor. Conecte primeiro.' });
        return;
      }

      let messageBody = '';
      if (stage === 'reminder') {
        messageBody = `Olá, ${clientName}! Tudo bem com você? ✨ Passando apenas para te avisar com carinho que a sua assinatura do *${service}* vence no dia ${expiryDate}. O valor da assinatura é de *${price}*. É apenas um lembrete para você poder se organizar com calma! Se tiver qualquer dúvida ou precisar de algo, estamos sempre à disposição por aqui. Tenha um ótimo dia e aproveite seus doramas! 🌸🍿`;
      } else if (stage === 'due') {
        messageBody = `Olá, ${clientName}! Tudo bem? Esperamos que sim! 🌸 Passando para lembrar que hoje é o dia do vencimento da sua assinatura do *${service}* no valor de *${price}*. Quer renovar hoje para manter seu acesso ativo? Se já realizou o pagamento, por favor desconsidere este recadinho. Qualquer dúvida, estou por aqui! 🍿✨`;
      } else if (stage === 'followup') {
        messageBody = `Olá, ${clientName}! Tudo bem? Notamos que o acesso à sua assinatura do *${service}* encerrou. Sabemos bem como a rotina do dia a dia é corrida! Caso queira continuar acompanhando seus doramas favoritos, me avise por aqui. Se precisar de qualquer ajuda, estou super à disposição! 💜`;
      } else if (stage === 'reactivation') {
        messageBody = `Olá, ${clientName}! Tudo bem? Sentimos muito a sua falta aqui na EuDorama! 🥰 Preparamos uma condição super especial para você voltar a maratonar seus doramas preferidos por apenas *${price}*! O que acha? Se quiser aproveitar ou se tiver qualquer dúvida, é só me responder aqui. Tenha um lindo dia! ✨🍿`;
      } else {
        messageBody = `Olá, ${clientName}! Esta é uma mensagem de teste da EuDorama. ✨`;
      }

      const fullMessage = `🧪 *[MENSAGEM DE TESTE - IGNORAR]*\n\n${messageBody}\n\n_— Teste enviado pelo painel EuDorama às ${new Date().toLocaleTimeString('pt-BR')} (Brasília)_`;

      // sendWhatsAppTextMessage já converte phone para JID internamente
      const jidPreview = formatPhoneToJid(phone);
      console.log('[Teste] Enviando para ' + phone + ' JID: ' + jidPreview);
      const result = await sendWhatsAppTextMessage(phone, fullMessage);
      console.log('[Teste] Resultado: success=' + result.success + ' id=' + result.messageId + ' err=' + result.error);

      if (result.success) {
        sendJson(res, 200, { success: true, message: 'Mensagem de teste enviada para +' + phone + '! ID: ' + (result.messageId || 'N/A'), jid: jidPreview });
      } else {
        sendJson(res, 400, { success: false, message: result.error || 'Falha ao enviar mensagem de teste' });
      }
    } catch (e) {
      sendJson(res, 500, { success: false, message: (e && e.message) || 'Erro interno ao enviar teste' });
    }
    return;
  }

  sendJson(res, 404, { success: false, message: 'Not Found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nMotor de Automacao Eudorama rodando.');
  console.log(`Porta: ${PORT}`);
  console.log('Endpoints: /api/viki-tv-automation, /api/viki-password-automation e /api/whatsapp/*');
  console.log(MOTOR_TOKEN ? 'Auth: Bearer token ativo.' : 'Auth: sem token local configurado.');

  // Tenta restaurar sessão prévia do WhatsApp se existir credenciais salvas
  void connectWhatsApp();

  // Inicia o agendador de cobranças em segundo plano no servidor
  startDailyChargeScheduler();
});
