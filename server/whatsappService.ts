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
const LABELS_FILE = path.resolve(process.cwd(), 'artifacts/whatsapp-labels.json');
const CHAT_LABELS_FILE = path.resolve(process.cwd(), 'artifacts/whatsapp-chat-labels.json');

type StoredLabel = { id: string; name: string; color: number; deleted?: boolean };
const labelsById = new Map<string, StoredLabel>();
// Chave: `${chatId}::${labelId}` -> conjunto de alvos ('chat' ou messageId)
const chatLabelAssociations = new Map<string, Set<string>>();

try {
  if (fs.existsSync(LABELS_FILE)) {
    const rawLabels = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf-8'));
    if (Array.isArray(rawLabels)) {
      rawLabels.forEach((l: StoredLabel) => {
        if (l?.id && l?.name) labelsById.set(String(l.id), l);
      });
    }
  }
} catch {}

try {
  if (fs.existsSync(CHAT_LABELS_FILE)) {
    const rawAssoc = JSON.parse(fs.readFileSync(CHAT_LABELS_FILE, 'utf-8'));
    if (rawAssoc && typeof rawAssoc === 'object') {
      Object.entries(rawAssoc).forEach(([k, targets]) => {
        if (Array.isArray(targets) && targets.length > 0) {
          chatLabelAssociations.set(k, new Set(targets.map(String)));
        }
      });
    }
  }
} catch {}

function saveLabelsToFile() {
  try {
    const dir = path.dirname(LABELS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LABELS_FILE, JSON.stringify(Array.from(labelsById.values()), null, 2), 'utf-8');
  } catch {}
}

function saveChatLabelsToFile() {
  try {
    const dir = path.dirname(CHAT_LABELS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, string[]> = {};
    chatLabelAssociations.forEach((targets, key) => {
      if (targets.size > 0) obj[key] = Array.from(targets);
    });
    fs.writeFileSync(CHAT_LABELS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch {}
}

function getPhoneDigitsVariants(phoneOrJid: string): string[] {
  const raw = String(phoneOrJid || '').split('@')[0].split(':')[0];
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return [];
  const variants = new Set<string>([digits]);
  const without55 = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  variants.add(without55);
  variants.add(`55${without55}`);
  if (without55.length === 11 && without55[2] === '9') {
    const noNine = without55.slice(0, 2) + without55.slice(3);
    variants.add(noNine);
    variants.add(`55${noNine}`);
  } else if (without55.length === 10) {
    const withNine = without55.slice(0, 2) + '9' + without55.slice(2);
    variants.add(withNine);
    variants.add(`55${withNine}`);
  }
  return Array.from(variants);
}

export function hasChatOrMessageLabel(phoneOrJid: string, labelName: string): boolean {
  const targetNorm = normalizeLabelName(labelName);
  if (!targetNorm) return false;

  const matchingLabelIds = new Set<string>();
  for (const l of labelsById.values()) {
    if (!l.deleted && normalizeLabelName(l.name) === targetNorm) {
      matchingLabelIds.add(String(l.id));
    }
  }
  if (matchingLabelIds.size === 0) return false;

  const inputStr = String(phoneOrJid || '').trim();
  const phoneVariants = getPhoneDigitsVariants(inputStr);

  for (const [assocKey, targets] of chatLabelAssociations.entries()) {
    if (targets.size === 0) continue;
    const sepIdx = assocKey.lastIndexOf('::');
    if (sepIdx <= 0) continue;
    const chatId = assocKey.slice(0, sepIdx);
    const labelId = assocKey.slice(sepIdx + 2);
    if (!matchingLabelIds.has(labelId)) continue;

    if (inputStr && chatId === inputStr) return true;
    const chatDigits = chatId.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (chatDigits && phoneVariants.includes(chatDigits)) return true;
  }
  return false;
}

function normalizeLabelName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function ensureLabelExists(labelName: string, color: number = 5): Promise<string | null> {
  if (!sock || currentStatus !== 'connected') return null;
  const targetNorm = normalizeLabelName(labelName);
  if (!targetNorm) return null;

  for (const l of labelsById.values()) {
    if (!l.deleted && normalizeLabelName(l.name) === targetNorm) {
      return l.id;
    }
  }

  // Cria nova etiqueta no WhatsApp Business se ainda não existir
  try {
    const numericIds = Array.from(labelsById.keys())
      .map((id) => parseInt(id, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const nextId = String(Math.max(10, ...numericIds) + 1);

    await sock.addLabel('', {
      id: nextId,
      name: labelName.trim(),
      color,
      deleted: false
    });

    labelsById.set(nextId, { id: nextId, name: labelName.trim(), color, deleted: false });
    saveLabelsToFile();
    console.log(`[WhatsApp Server] 🏷️ Etiqueta "${labelName}" criada automaticamente (ID: ${nextId}).`);
    return nextId;
  } catch (err: any) {
    console.warn(`[WhatsApp Server] Não foi possível criar etiqueta "${labelName}":`, err?.message || err);
    return null;
  }
}

async function applyChatLabelByName(jid: string, labelName: string) {
  if (!sock || currentStatus !== 'connected' || !jid || !labelName) return;
  try {
    const defaultColor = normalizeLabelName(labelName) === 'promocao' ? 5 : 2;
    const labelId = await ensureLabelExists(labelName, defaultColor);
    if (!labelId) return;
    await sock.addChatLabel(jid, labelId);
    const key = `${jid}::${labelId}`;
    const set = chatLabelAssociations.get(key) || new Set<string>();
    set.add('chat');
    chatLabelAssociations.set(key, set);
    saveChatLabelsToFile();
    console.log(`[WhatsApp Server] 🏷️ Etiqueta "${labelName}" (ID: ${labelId}) aplicada em ${jid}`);
  } catch (err: any) {
    console.warn(`[WhatsApp Server] Falha ao aplicar etiqueta "${labelName}" em ${jid}:`, err?.message || err);
  }
}

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

    sock.ev.on('labels.edit', (label) => {
      if (!label?.id) return;
      labelsById.set(String(label.id), {
        id: String(label.id),
        name: String(label.name || ''),
        color: Number(label.color ?? 0),
        deleted: Boolean(label.deleted)
      });
      saveLabelsToFile();
      console.log(`[WhatsApp Server] 🏷️ Etiqueta sincronizada: "${label.name}" (ID: ${label.id}, deleted: ${Boolean(label.deleted)})`);
    });

    sock.ev.on('labels.association', ({ association, type }) => {
      if (!association?.chatId || !association?.labelId) return;
      const key = `${association.chatId}::${association.labelId}`;
      const targetId = association.type === 'label_message' ? association.messageId : 'chat';
      if (type === 'add') {
        const set = chatLabelAssociations.get(key) || new Set<string>();
        set.add(targetId);
        chatLabelAssociations.set(key, set);
      } else if (type === 'remove') {
        const set = chatLabelAssociations.get(key);
        if (set) {
          set.delete(targetId);
          if (set.size === 0) chatLabelAssociations.delete(key);
        }
      }
      saveChatLabelsToFile();
    });

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

        // Aguarda sincronização inicial de etiquetas do WhatsApp Business e garante a etiqueta "Promoção"
        setTimeout(() => {
          void ensureLabelExists('Promoção', 5);
        }, 5000);
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
  messageText: string,
  options?: { labelName?: string }
): Promise<{ success: boolean; messageId?: string; messageTimestamp?: number; error?: string; jidUsed?: string }> {
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
    const msgTs = Number(result?.messageTimestamp) || Math.floor(Date.now() / 1000);
    console.log(`[WhatsApp Server] ✅ Mensagem enviada para ${finalJid} | ID: ${result?.key?.id}`);
    if (options?.labelName) {
      await applyChatLabelByName(finalJid, options.labelName);
    }
    return { success: true, messageId: result?.key?.id || undefined, messageTimestamp: msgTs, jidUsed: finalJid };
  } catch (err: any) {
    console.error(`[WhatsApp Server] ❌ Erro ao enviar para ${finalJid}:`, err?.message || err);
    return { success: false, error: err?.message || 'Falha ao enviar mensagem pelo WhatsApp' };
  }
}

export async function deleteWhatsAppChat(
  phoneNumber: string,
  options?: { jid?: string; lastMessageId?: string; lastMessageTimestamp?: number }
): Promise<{ success: boolean; error?: string; jidUsed?: string; skippedProtectedLabel?: boolean }> {
  if (!sock || currentStatus !== 'connected') {
    return { success: false, error: 'WhatsApp não está conectado. Conecte via QR Code no painel.' };
  }

  if (!sock.user?.id) {
    return { success: false, error: 'Sessão do WhatsApp não está totalmente inicializada.' };
  }

  // Proteção absoluta: conversas/mensagens etiquetadas com "ACOMPANHAR" nunca podem ser excluídas
  if (hasChatOrMessageLabel(phoneNumber, 'ACOMPANHAR') || (options?.jid && hasChatOrMessageLabel(options.jid, 'ACOMPANHAR'))) {
    console.log(`[WhatsApp Server] 🛡️ Exclusão bloqueada: conversa de ${options?.jid || phoneNumber} possui etiqueta "ACOMPANHAR".`);
    return {
      success: false,
      skippedProtectedLabel: true,
      error: 'Conversa protegida pela etiqueta ACOMPANHAR (não excluída).'
    };
  }

  let finalJid = options?.jid || '';
  if (!finalJid) {
    const digits = String(phoneNumber || '').replace(/\D/g, '');
    if (!digits || digits.length < 10) {
      return { success: false, error: `Número de telefone inválido: "${phoneNumber}"` };
    }
    try {
      const normalized = digits.startsWith('55') ? digits : `55${digits}`;
      const [result] = await sock.onWhatsApp(normalized);
      if (result?.exists) {
        finalJid = result.jid;
      } else {
        const withoutNine = normalized.length === 13 ? normalized.slice(0, 4) + normalized.slice(5) : null;
        if (withoutNine) {
          const [r2] = await sock.onWhatsApp(withoutNine);
          if (r2?.exists) finalJid = r2.jid;
        }
      }
    } catch {}
    if (!finalJid) {
      finalJid = formatPhoneToJid(digits) || `${digits.startsWith('55') ? digits : '55' + digits}@s.whatsapp.net`;
    }
  }

  if (hasChatOrMessageLabel(finalJid, 'ACOMPANHAR')) {
    console.log(`[WhatsApp Server] 🛡️ Exclusão bloqueada: JID ${finalJid} possui etiqueta "ACOMPANHAR".`);
    return {
      success: false,
      skippedProtectedLabel: true,
      jidUsed: finalJid,
      error: 'Conversa protegida pela etiqueta ACOMPANHAR (não excluída).'
    };
  }

  try {
    const lastMessages =
      options?.lastMessageId && options?.lastMessageTimestamp
        ? [
            {
              key: { remoteJid: finalJid, id: options.lastMessageId, fromMe: true },
              messageTimestamp: options.lastMessageTimestamp
            }
          ]
        : { lastMessageTimestamp: options?.lastMessageTimestamp || Math.floor(Date.now() / 1000) };

    await sock.chatModify({ delete: true, lastMessages }, finalJid);
    console.log(`[WhatsApp Server] 🗑️ Conversa apagada automaticamente no WhatsApp: ${finalJid}`);
    return { success: true, jidUsed: finalJid };
  } catch (err: any) {
    console.error(`[WhatsApp Server] ❌ Erro ao apagar conversa ${finalJid}:`, err?.message || err);
    return { success: false, error: err?.message || 'Falha ao apagar conversa pelo WhatsApp' };
  }
}
