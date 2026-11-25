import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket,
  type ConnectionState
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

// Logger silencioso para não poluir o terminal
const logger = pino({ level: 'silent' });

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
      auth: state,
      logger,
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      emitOwnEvents: false,
      browser: ['EuDorama Servidor', 'Chrome', '124.0.0.0']
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
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!sock || currentStatus !== 'connected') {
    return {
      success: false,
      error: 'WhatsApp não está conectado no servidor. Por favor, conecte via QR Code no painel.'
    };
  }

  const jid = formatPhoneToJid(phoneNumber);
  if (!jid) {
    return { success: false, error: `Número de telefone inválido: "${phoneNumber}"` };
  }

  if (!messageText || !messageText.trim()) {
    return { success: false, error: 'A mensagem está vazia.' };
  }

  try {
    // Pequena pausa humanizada para evitar taxa de envio robótica
    await new Promise((resolve) => setTimeout(resolve, 800));

    const result = await sock.sendMessage(jid, { text: messageText });
    return {
      success: true,
      messageId: result?.key?.id || undefined
    };
  } catch (err: any) {
    console.error(`[WhatsApp Server] Erro ao enviar para ${phoneNumber}:`, err?.message || err);
    return {
      success: false,
      error: err?.message || 'Falha ao enviar mensagem pelo WhatsApp'
    };
  }
}
