import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  type WASocket,
  type ConnectionState,
  type proto,
  type CacheStore
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';

export type WhatsAppState = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export type WhatsAppStatus = {
  state: WhatsAppState;
  userPhone?: string;
  userName?: string;
  hasQr: boolean;
  lastConnectedAt?: string;
  lastDisconnectReason?: string;
};

const AUTH_DIR = path.resolve(process.cwd(), 'artifacts/whatsapp-auth');

let sock: WASocket | null = null;
let currentStatus: WhatsAppState = 'disconnected';
let currentQrCodeDataUrl: string | null = null;
let connectedUserPhone: string | undefined = undefined;
let connectedUserName: string | undefined = undefined;
let lastConnectedAt: string | undefined = undefined;
let lastDisconnectReason: string | undefined = undefined;
let reconnectTimer: NodeJS.Timeout | null = null;

// Logger em nível warn para registrar eventuais erros de sessão Signal / retry nos logs do PM2
const logger = pino({ level: 'warn' });

// Armazena mensagens enviadas recentemente para responder a pedidos de retry (evita "Aguardando mensagem")
const sentMessageStore = new Map<string, proto.IMessage>();
function storeSentMessage(id: string | null | undefined, message: proto.IMessage | null | undefined) {
  if (!id || !message) return;
  sentMessageStore.set(id, message);
  if (sentMessageStore.size > 500) {
    const oldestKey = sentMessageStore.keys().next().value;
    if (oldestKey) sentMessageStore.delete(oldestKey);
  }
}

// Cache em memória para contagem de retries de criptografia Signal no Baileys
const retryMap = new Map<string, unknown>();
const msgRetryCounterCache: CacheStore = {
  get: <T>(key: string): T | undefined => retryMap.get(key) as T | undefined,
  set: <T>(key: string, value: T): void => {
    retryMap.set(key, value);
    if (retryMap.size > 1000) {
      const oldestKey = retryMap.keys().next().value;
      if (oldestKey) retryMap.delete(oldestKey);
    }
  },
  del: (key: string): void => {
    retryMap.delete(key);
  },
  flushAll: (): void => {
    retryMap.clear();
  }
};

export function getWhatsAppStatus(): WhatsAppStatus {
  return {
    state: currentStatus,
    userPhone: connectedUserPhone,
    userName: connectedUserName,
    hasQr: Boolean(currentQrCodeDataUrl),
    lastConnectedAt,
    lastDisconnectReason
  };
}

export function getQrCodeDataUrl(): string | null {
  return currentQrCodeDataUrl;
}

export async function connectWhatsApp(): Promise<WhatsAppStatus> {
  if (sock && currentStatus === 'connected') {
    return getWhatsAppStatus();
  }

  if (currentStatus === 'connecting' && currentQrCodeDataUrl) {
    return getWhatsAppStatus();
  }

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  currentStatus = 'connecting';
  lastDisconnectReason = undefined;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] as [number, number, number] }));

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      emitOwnEvents: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      browser: Browsers.ubuntu('Chrome'),
      msgRetryCounterCache,
      getMessage: async (key) => {
        if (!key?.id) return undefined;
        const found = sentMessageStore.get(key.id);
        console.log(`[WhatsApp Server] getMessage(retry) id=${key.id} encontrado=${Boolean(found)}`);
        return found;
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentStatus = 'qr_ready';
        try {
          currentQrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
          console.log('[WhatsApp Server] Novo QR Code gerado pronto para leitura no painel.');
        } catch (qrErr) {
          console.error('[WhatsApp Server] Erro ao converter QR Code:', qrErr);
        }
      }

      if (connection === 'open') {
        currentStatus = 'connected';
        currentQrCodeDataUrl = null;
        lastConnectedAt = new Date().toISOString();
        const userJid = sock?.user?.id || '';
        connectedUserPhone = userJid.split(':')[0] || userJid.split('@')[0];
        connectedUserName = sock?.user?.name || 'EuDorama Atendimento';
        console.log(`[WhatsApp Server] ✅ Conectado com sucesso com o número: ${connectedUserPhone} (${connectedUserName})`);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        currentStatus = 'disconnected';
        currentQrCodeDataUrl = null;
        lastDisconnectReason = (lastDisconnect?.error as any)?.message || `Código ${statusCode}`;

        console.log(`[WhatsApp Server] Desconectado. Motivo: ${lastDisconnectReason}. Reconectar? ${shouldReconnect}`);

        if (shouldReconnect) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            console.log('[WhatsApp Server] Tentando reconectar...');
            void connectWhatsApp();
          }, 5000);
        } else {
          console.log('[WhatsApp Server] Sessão desconectada permanentemente ou aparelho desvinculado.');
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch {}
        }
      }
    });

    return getWhatsAppStatus();
  } catch (err: any) {
    currentStatus = 'disconnected';
    lastDisconnectReason = err?.message || 'Falha ao iniciar Baileys';
    console.error('[WhatsApp Server] Erro ao conectar:', err);
    return getWhatsAppStatus();
  }
}

export async function disconnectWhatsApp(): Promise<{ success: boolean; message: string }> {
  try {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (sock) {
      try {
        await sock.logout();
      } catch {}
      try {
        sock.end(new Error('Desconectado pelo usuário via painel'));
      } catch {}
      sock = null;
    }

    currentStatus = 'disconnected';
    currentQrCodeDataUrl = null;
    connectedUserPhone = undefined;
    connectedUserName = undefined;

    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }

    return { success: true, message: 'WhatsApp desconectado com sucesso.' };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Erro ao desconectar WhatsApp' };
  }
}

export async function resetWhatsAppSession(): Promise<{ success: boolean; message: string; status: WhatsAppStatus }> {
  await disconnectWhatsApp();
  sentMessageStore.clear();
  retryMap.clear();
  const status = await connectWhatsApp();
  return {
    success: true,
    message: 'Sessão limpa com sucesso. Escaneie o novo QR Code para gerar novas chaves de criptografia.',
    status
  };
}

export function formatPhoneToJid(phone: string): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;

  let normalized = digits;
  if (!normalized.startsWith('55')) {
    if (normalized.length === 10 || normalized.length === 11) {
      normalized = `55${normalized}`;
    }
  }

  // Se o número brasileiro tiver 13 dígitos (55 + DDD de 2 + 9 dígitos começando com 9)
  // O WhatsApp frequentemente espera o JID com 12 ou 13 dígitos
  return `${normalized}@s.whatsapp.net`;
}

export async function sendWhatsAppTextMessage(
  phoneNumber: string,
  messageText: string
): Promise<{ success: boolean; messageId?: string; error?: string; jidUsed?: string }> {
  if (!sock || currentStatus !== 'connected') {
    return { success: false, error: 'WhatsApp não está conectado. Conecte via QR Code no painel.' };
  }

  if (!sock.user?.id) {
    return { success: false, error: 'Sessão do WhatsApp não está totalmente inicializada. Aguarde alguns segundos e tente novamente.' };
  }

  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) {
    return { success: false, error: `Número de telefone inválido: "${phoneNumber}"` };
  }

  if (!messageText || !messageText.trim()) {
    return { success: false, error: 'A mensagem está vazia.' };
  }

  // Verifica se o número está no WhatsApp e obtém o JID correto
  let finalJid: string;
  try {
    const normalized = digits.startsWith('55') ? digits : `55${digits}`;
    const [result] = await sock.onWhatsApp(normalized);
    if (result?.exists) {
      finalJid = result.jid;
      console.log(`[WhatsApp Server] Número verificado: ${phoneNumber} → JID: ${finalJid}`);
    } else {
      // Tenta sem o dígito 9 (números antigos brasileiros)
      const withoutNine = normalized.length === 13
        ? normalized.slice(0, 4) + normalized.slice(5)
        : null;
      if (withoutNine) {
        const [r2] = await sock.onWhatsApp(withoutNine);
        if (r2?.exists) {
          finalJid = r2.jid;
          console.log(`[WhatsApp Server] Número encontrado sem dígito 9: ${withoutNine} → JID: ${finalJid}`);
        } else {
          return { success: false, error: `Número ${phoneNumber} não está no WhatsApp (verificado com e sem dígito 9).` };
        }
      } else {
        return { success: false, error: `Número ${phoneNumber} não encontrado no WhatsApp.` };
      }
    }
  } catch (err: any) {
    // Se onWhatsApp falhar, usa o JID formatado normalmente como fallback
    console.warn(`[WhatsApp Server] Falha ao verificar número ${phoneNumber}, usando JID padrão:`, err?.message);
    finalJid = formatPhoneToJid(digits) || `${digits.startsWith('55') ? digits : '55' + digits}@s.whatsapp.net`;
  }

  try {
    // Garante sessão Signal válida sem fechar sessões abertas desnecessariamente
    try {
      await sock.assertSessions([finalJid], false);
    } catch {}

    // Pausa humanizada anti-ban
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const result = await sock.sendMessage(finalJid, { text: messageText });
    storeSentMessage(result?.key?.id, result?.message);
    console.log(`[WhatsApp Server] ✅ Mensagem enviada para ${finalJid} | ID: ${result?.key?.id}`);
    return { success: true, messageId: result?.key?.id || undefined, jidUsed: finalJid };
  } catch (err: any) {
    console.error(`[WhatsApp Server] ❌ Erro ao enviar para ${finalJid}:`, err?.message || err);
    return { success: false, error: err?.message || 'Falha ao enviar mensagem pelo WhatsApp' };
  }
}
