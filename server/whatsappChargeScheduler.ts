import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { sendWhatsAppTextMessage, getWhatsAppStatus } from './whatsappService.ts';
import { getServicePrice } from '../services/pricingConfig.ts';
import { ClientDBRow } from '../types.ts';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const LOGS_FILE = path.resolve(process.cwd(), 'artifacts/whatsapp-charge-logs.json');

export type ReactivationCampaignStatus = {
  sentToday: number;
  pendingCount: number;
  lastRunAt?: string;
};

export type ChargeQueueItem = {
  id: string;
  clientId: string;
  clientName: string;
  phoneNumber: string;
  service: string;
  stage: 'reminder' | 'due' | 'followup';
  stageLabel: string;
  daysRemaining: number;
  expiryDateStr: string;
  price: number;
  priceFormatted: string;
  message: string;
  alreadySentToday: boolean;
  lastChargedAt?: string | null;
};

export type SchedulerLogEntry = {
  id: string;
  timestamp: string;
  phoneNumber: string;
  clientName: string;
  service: string;
  stage: string;
  status: 'success' | 'failed' | 'skipped';
  messageText?: string;
  error?: string;
};

const CONFIG_FILE = path.resolve(process.cwd(), 'artifacts/whatsapp-scheduler-config.json');

export type SchedulerState = {
  enabled: boolean;
  enableReminder: boolean;
  enableDue: boolean;
  enableFollowup: boolean;
  enableReactivation: boolean;
  targetHour: number; // ex: 15 (15:00)
  targetMinute: number; // ex: 0 (15:00)
  isRunning: boolean;
  lastCycleAt?: string;
  lastCycleSummary?: {
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  };
};

let schedulerState: SchedulerState = {
  enabled: true,
  enableReminder: true,
  enableDue: true,
  enableFollowup: true,
  enableReactivation: true,
  targetHour: 15,
  targetMinute: 0,
  isRunning: false
};

// Carrega configuração salva se existir
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const rawCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    if (rawCfg && typeof rawCfg === 'object') {
      if (typeof rawCfg.enabled === 'boolean') schedulerState.enabled = rawCfg.enabled;
      if (typeof rawCfg.enableReminder === 'boolean') schedulerState.enableReminder = rawCfg.enableReminder;
      if (typeof rawCfg.enableDue === 'boolean') schedulerState.enableDue = rawCfg.enableDue;
      if (typeof rawCfg.enableFollowup === 'boolean') schedulerState.enableFollowup = rawCfg.enableFollowup;
      if (typeof rawCfg.enableReactivation === 'boolean') schedulerState.enableReactivation = rawCfg.enableReactivation;
      if (typeof rawCfg.targetHour === 'number') schedulerState.targetHour = rawCfg.targetHour;
      if (typeof rawCfg.targetMinute === 'number') schedulerState.targetMinute = rawCfg.targetMinute;
    }
  }
} catch {}

function saveConfigToFile() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(
        {
          enabled: schedulerState.enabled,
          enableReminder: schedulerState.enableReminder,
          enableDue: schedulerState.enableDue,
          enableFollowup: schedulerState.enableFollowup,
          enableReactivation: schedulerState.enableReactivation,
          targetHour: schedulerState.targetHour,
          targetMinute: schedulerState.targetMinute
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch {}
}

let recentLogs: SchedulerLogEntry[] = [];

// Carrega logs salvos se existirem
try {
  if (fs.existsSync(LOGS_FILE)) {
    const raw = fs.readFileSync(LOGS_FILE, 'utf-8');
    recentLogs = JSON.parse(raw);
    if (!Array.isArray(recentLogs)) recentLogs = [];
  }
} catch {
  recentLogs = [];
}

function saveLogsToFile() {
  try {
    const dir = path.dirname(LOGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOGS_FILE, JSON.stringify(recentLogs.slice(0, 300), null, 2), 'utf-8');
  } catch {}
}

export function getSchedulerState(): SchedulerState {
  return { ...schedulerState };
}

export function getSchedulerLogs(): SchedulerLogEntry[] {
  return [...recentLogs];
}

export type SchedulerConfigPatch = Partial<
  Pick<
    SchedulerState,
    'enabled' | 'enableReminder' | 'enableDue' | 'enableFollowup' | 'enableReactivation' | 'targetHour' | 'targetMinute'
  >
>;

export function updateSchedulerConfig(patch: SchedulerConfigPatch) {
  const cleanPatch: SchedulerConfigPatch = {};
  if (typeof patch.enabled === 'boolean') cleanPatch.enabled = patch.enabled;
  if (typeof patch.enableReminder === 'boolean') cleanPatch.enableReminder = patch.enableReminder;
  if (typeof patch.enableDue === 'boolean') cleanPatch.enableDue = patch.enableDue;
  if (typeof patch.enableFollowup === 'boolean') cleanPatch.enableFollowup = patch.enableFollowup;
  if (typeof patch.enableReactivation === 'boolean') cleanPatch.enableReactivation = patch.enableReactivation;
  if (typeof patch.targetHour === 'number' && patch.targetHour >= 0 && patch.targetHour <= 23) cleanPatch.targetHour = patch.targetHour;
  if (typeof patch.targetMinute === 'number' && patch.targetMinute >= 0 && patch.targetMinute <= 59) cleanPatch.targetMinute = patch.targetMinute;
  schedulerState = { ...schedulerState, ...cleanPatch };
  saveConfigToFile();
}

// Funções utilitárias de datas e assinaturas
function calculateExpiry(startDateStr: string, durationMonths: number = 1): Date {
  const d = new Date(startDateStr);
  if (isNaN(d.getTime())) return new Date();
  const next = new Date(d);
  next.setMonth(next.getMonth() + durationMonths);
  return next;
}

function getDaysRemaining(expiryDate: Date): number {
  const now = new Date();
  const startOfDayNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDayExpiry = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate()).getTime();
  return Math.round((startOfDayExpiry - startOfDayNow) / (1000 * 60 * 60 * 24));
}

function normalizeSubscriptions(subs: any): string[] {
  if (Array.isArray(subs)) return subs;
  if (typeof subs === 'string') {
    const cleaned = subs.replace(/^\{|\}$/g, '');
    if (!cleaned) return [];
    if (cleaned.includes(';')) return cleaned.split(';');
    if (cleaned.includes(',')) return cleaned.split(',');
    return [cleaned];
  }
  return [];
}

function normalizeServiceKey(service: string): string {
  return String(service || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatCurrency(val: number): string {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseChargeWhatsappEntries(raw: any): Record<string, { service: string; chargedAt: string }> {
  if (!raw || typeof raw !== 'object') return {};
  const normalized: Record<string, { service: string; chargedAt: string }> = {};
  Object.entries(raw).forEach(([k, v]) => {
    if (!v || typeof v !== 'object') return;
    const sKey = normalizeServiceKey(k);
    if (!sKey) return;
    normalized[sKey] = {
      service: String((v as any).service || k).trim(),
      chargedAt: String((v as any).chargedAt || '').trim()
    };
  });
  return normalized;
}

function wasChargedToday(chargedAtIso?: string | null): boolean {
  if (!chargedAtIso) return false;
  try {
    const chargedDate = new Date(chargedAtIso);
    if (isNaN(chargedDate.getTime())) return false;
    const now = new Date();
    // Mesmo dia civil ou menos de 20 horas atrás
    const sameDay =
      chargedDate.getFullYear() === now.getFullYear() &&
      chargedDate.getMonth() === now.getMonth() &&
      chargedDate.getDate() === now.getDate();
    const diffHours = (now.getTime() - chargedDate.getTime()) / (1000 * 60 * 60);
    return sameDay || diffHours < 20;
  } catch {
    return false;
  }
}

// Constrói a mensagem amigável e clara seguindo estritamente as regras
export function buildChargeMessage(
  clientName: string,
  service: string,
  expiryDate: Date,
  daysRemaining: number,
  price: number,
  stage: 'reminder' | 'due' | 'followup'
): string {
  const rawName = String(clientName || '').trim();
  const displayName = rawName && rawName.toLowerCase() !== 'null' && rawName.toLowerCase() !== 'sem nome'
    ? rawName
    : 'Dorameira';
  const dataFmt = expiryDate.toLocaleDateString('pt-BR');
  const precoFmt = price > 0 ? formatCurrency(price) : 'o valor regular do seu plano';

  if (stage === 'reminder') {
    // D-5 apenas: informativo e gentil, SEM pressão de pagamento, SEM promoções
    return `Olá, ${displayName}! Tudo bem com você? ✨ Passando apenas para te avisar com carinho que a sua assinatura do *${service}* vence no dia ${dataFmt} (daqui a 5 dias). O valor da assinatura é de *${precoFmt}*. É apenas um lembrete para você poder se organizar com calma! Se tiver qualquer dúvida ou precisar de algo, estamos sempre à disposição por aqui. Tenha um ótimo dia e aproveite seus doramas! 🌸🍿`;
  }

  if (stage === 'due') {
    // D0 — convite gentil à renovação
    return `Olá, ${displayName}! Tudo bem? Esperamos que sim! 🌸 Passando para lembrar que hoje (*${dataFmt}*) é o dia do vencimento da sua assinatura do *${service}* no valor de *${precoFmt}*. Quer renovar hoje para manter seu acesso ativo e não perder seus episódios favoritos? Se já realizou o pagamento, por favor desconsidere este recadinho. Qualquer dúvida, estou por aqui para te ajudar! 🍿✨`;
  }

  // stage === 'followup' — D+2 apenas: empático, sem pressão, sem mencionar "X dias de atraso"
  return `Olá, ${displayName}! Tudo bem? Notamos que o acesso à sua assinatura do *${service}* encerrou (dia ${dataFmt}). Sabemos bem como a rotina do dia a dia é corrida! Caso queira continuar acompanhando seus doramas favoritos sem interrupções, me avise por aqui que te envio os dados para renovação. Se tiver acontecido algum imprevisto ou se precisar de alguma ajuda, estou super à disposição! 💜`;
}

// Constrói a mensagem da campanha de reativação (único lugar onde promoção é permitida)
function buildReactivationMessage(clientName: string): string {
  const rawName = String(clientName || '').trim();
  const displayName = rawName && rawName.toLowerCase() !== 'null' && rawName.toLowerCase() !== 'sem nome'
    ? rawName
    : 'Dorameira';
  return `Olá, ${displayName}! Tudo bem? 🌸\n\nSou o Orion, da *EuDorama* — uma plataforma dedicada a quem ama doramas e conteúdo asiático! 😊\n\nFaz um tempinho que você não está por aqui e sentimos muito a sua falta! Preparamos uma *condição especial* pensando em você para facilitar o seu retorno. 🎁\n\nVocê teria interesse em saber mais sobre a nossa promoção? É só me responder aqui e te explico tudo com carinho! Tenha um lindo dia! ✨🍿`;
}

// Avalia a base do Supabase e retorna a fila completa do dia
export async function getChargeQueue(): Promise<ChargeQueueItem[]> {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('deleted', false);

  if (error || !clients) {
    console.error('[Scheduler] Erro ao carregar clientes do Supabase:', error);
    return [];
  }

  const queue: ChargeQueueItem[] = [];

  for (const client of clients as ClientDBRow[]) {
    if (!client.phone_number) continue;

    const subs = normalizeSubscriptions(client.subscriptions);
    const progress = client.game_progress || {};
    const entryMap = parseChargeWhatsappEntries(progress._charge_whatsapp_entries);

    for (const sub of subs) {
      const parts = sub.split('|');
      const serviceName = String(parts[0] || '').trim();
      const startDateStr = String(parts[1] || '').trim();
      const duration = parseInt(parts[3] || String(client.duration_months || 1)) || 1;

      if (!serviceName || !startDateStr) continue;

      const expiry = calculateExpiry(startDateStr, duration);
      const daysRemaining = getDaysRemaining(expiry);

      let stage: 'reminder' | 'due' | 'followup' | null = null;
      let stageLabel = '';

      if (daysRemaining === 5) {
        stage = 'reminder';
        stageLabel = 'Vence em 5 dias (D-5)';
      } else if (daysRemaining === 0) {
        stage = 'due';
        stageLabel = 'Vence Hoje (D0)';
      } else if (daysRemaining === -2) {
        stage = 'followup';
        stageLabel = 'Vencido há 2 dias (D+2)';
      }

      if (!stage) continue;

      const price = getServicePrice(serviceName, duration);
      const priceFormatted = price > 0 ? formatCurrency(price) : 'Valor Regular';
      const serviceKey = normalizeServiceKey(serviceName);
      const lastEntry = entryMap[serviceKey];
      const lastChargedAt = lastEntry?.chargedAt || progress._charge_whatsapp_last_at || null;
      const alreadySent = wasChargedToday(lastChargedAt);

      const message = buildChargeMessage(
        client.client_name,
        serviceName,
        expiry,
        daysRemaining,
        price,
        stage
      );

      queue.push({
        id: `${client.id}::${serviceKey}::${stage}`,
        clientId: client.id,
        clientName: client.client_name || 'Dorameira',
        phoneNumber: client.phone_number,
        service: serviceName,
        stage,
        stageLabel,
        daysRemaining,
        expiryDateStr: expiry.toLocaleDateString('pt-BR'),
        price,
        priceFormatted,
        message,
        alreadySentToday: alreadySent,
        lastChargedAt
      });
    }
  }

  // Ordena prioritariamente: 1º Vence hoje (D0), 2º Vencidos (D+), 3º Lembretes (D-)
  const stageWeights = { due: 1, followup: 2, reminder: 3 };
  return queue.sort((a, b) => {
    if (a.alreadySentToday !== b.alreadySentToday) return a.alreadySentToday ? 1 : -1;
    return (stageWeights[a.stage] || 99) - (stageWeights[b.stage] || 99);
  });
}

// Executa o disparo de 1 cliente específico
export async function sendSingleCharge(
  clientId: string,
  serviceName: string
): Promise<{ success: boolean; message: string }> {
  const wsStatus = getWhatsAppStatus();
  if (wsStatus.state !== 'connected') {
    return { success: false, message: 'WhatsApp não está conectado no servidor.' };
  }

  const queue = await getChargeQueue();
  const target = queue.find(
    (q) => q.clientId === clientId && normalizeServiceKey(q.service) === normalizeServiceKey(serviceName)
  );

  if (!target) {
    return { success: false, message: 'Cliente/assinatura não elegível para cobrança no momento.' };
  }

  const result = await sendWhatsAppTextMessage(target.phoneNumber, target.message);

  if (result.success) {
    await markClientAsCharged(target.clientId, target.phoneNumber, target.service);

    const logEntry: SchedulerLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      phoneNumber: target.phoneNumber,
      clientName: target.clientName,
      service: target.service,
      stage: target.stageLabel,
      status: 'success',
      messageText: target.message
    };
    recentLogs.unshift(logEntry);
    saveLogsToFile();

    return { success: true, message: `Cobrança enviada com sucesso para ${target.clientName}!` };
  } else {
    const logEntry: SchedulerLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      phoneNumber: target.phoneNumber,
      clientName: target.clientName,
      service: target.service,
      stage: target.stageLabel,
      status: 'failed',
      error: result.error
    };
    recentLogs.unshift(logEntry);
    saveLogsToFile();

    return { success: false, message: result.error || 'Erro ao enviar mensagem.' };
  }
}

// Marca no Supabase que o cliente recebeu a mensagem hoje
async function markClientAsCharged(clientId: string, phoneNumber: string, serviceName: string) {
  try {
    const { data: client } = await supabase
      .from('clients')
      .select('game_progress')
      .eq('id', clientId)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    const currentProgress = (client as any)?.game_progress || {};
    const previousServices = Array.isArray(currentProgress._charge_whatsapp_services)
      ? currentProgress._charge_whatsapp_services
      : [];
    const previousEntries = parseChargeWhatsappEntries(currentProgress._charge_whatsapp_entries);
    const serviceKey = normalizeServiceKey(serviceName);

    if (serviceKey) {
      previousEntries[serviceKey] = {
        service: serviceName,
        chargedAt: nowIso
      };
    }

    const nextProgress = {
      ...currentProgress,
      _charge_whatsapp_last_at: nowIso,
      _charge_whatsapp_last_service: serviceName,
      _charge_whatsapp_services: Array.from(new Set([...previousServices, serviceName])),
      _charge_whatsapp_entries: previousEntries
    };

    await supabase
      .from('clients')
      .update({
        is_contacted: true,
        game_progress: nextProgress
      })
      .eq('id', clientId);
  } catch (err) {
    console.error(`[Scheduler] Erro ao marcar cliente ${clientId} como cobrado:`, err);
  }
}

// --- CAMPANHA DE REATIVAÇÃO DE EX-CLIENTES ---
// Envia até 2 mensagens por dia para ex-clientes que nunca receberam a campanha.
// ÚNICO lugar onde promoção é permitida.

let reactivationState = { sentToday: 0, lastRunDate: '', lastRunAt: '' };

export async function runReactivationCampaign(manualTrigger: boolean = false): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!schedulerState.enableReactivation) {
    console.log('[Reativação] Campanha desativada nas configurações. Pulando.');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  if (!manualTrigger && !schedulerState.enabled) {
    console.log('[Reativação] Automação geral desativada. Pulando.');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const wsStatus = getWhatsAppStatus();
  if (wsStatus.state !== 'connected') {
    console.log('[Reativação] WhatsApp não conectado. Pulando campanha.');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  // Fuso horário de São Paulo para controle diário
  const nowSp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const today = `${nowSp.getFullYear()}-${String(nowSp.getMonth()).padStart(2, '0')}-${String(nowSp.getDate()).padStart(2, '0')}`;

  if (reactivationState.lastRunDate !== today) {
    reactivationState.sentToday = 0;
    reactivationState.lastRunDate = today;
  }

  if (reactivationState.sentToday >= 2) {
    console.log('[Reativação] Já enviou 2 mensagens hoje. Pulando.');
    return { sent: 0, failed: 0, skipped: 1 };
  }

  // Busca TODOS os clientes (incluindo deletados) que tenham telefone
  const { data: allClients } = await supabase.from('clients').select('*');
  if (!allClients || allClients.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  const remaining = 2 - reactivationState.sentToday;

  // Filtra ex-clientes: deletados OU com assinatura expirada há mais de 2 dias, e que ainda não receberam a campanha
  const exClients = (allClients as ClientDBRow[]).filter((c) => {
    if (!c.phone_number) return false;
    const progress = c.game_progress || {};
    if (progress._reactivation_campaign_sent_at) return false; // já recebeu, nunca reenviar
    if (c.deleted) return true;
    // cliente ativo mas com assinatura expirada há mais de 2 dias
    const subs = normalizeSubscriptions(c.subscriptions);
    return subs.some((sub) => {
      const parts = sub.split('|');
      const startStr = String(parts[1] || '').trim();
      const dur = parseInt(parts[3] || String(c.duration_months || 1)) || 1;
      if (!startStr) return false;
      const expiry = calculateExpiry(startStr, dur);
      return getDaysRemaining(expiry) < -2;
    });
  });

  const targets = exClients.slice(0, remaining);
  console.log(`[Reativação] ${exClients.length} ex-clientes elegíveis. Enviando para ${targets.length}.`);

  let sent = 0, failed = 0;

  for (const client of targets) {
    const delayMs = Math.floor(Math.random() * 8000) + 10000;
    console.log(`[Reativação] Aguardando ${Math.round(delayMs / 1000)}s antes de enviar para ${client.client_name}...`);
    await new Promise((r) => setTimeout(r, delayMs));

    const message = buildReactivationMessage(client.client_name);
    const result = await sendWhatsAppTextMessage(client.phone_number, message);

    if (result.success) {
      sent++;
      reactivationState.sentToday++;

      // Marca no Supabase para nunca reenviar
      try {
        const progress = client.game_progress || {};
        await supabase
          .from('clients')
          .update({ game_progress: { ...progress, _reactivation_campaign_sent_at: new Date().toISOString() } })
          .eq('id', client.id);
      } catch (err) {
        console.error('[Reativação] Erro ao marcar cliente:', err);
      }

      recentLogs.unshift({
        id: `${Date.now()}-react-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        phoneNumber: client.phone_number,
        clientName: client.client_name || 'Dorameira',
        service: 'Campanha',
        stage: 'Reativação de Ex-cliente',
        status: 'success',
        messageText: message
      });
      console.log(`[Reativação] ✅ Enviado para ${client.client_name} (${client.phone_number})`);
    } else {
      failed++;
      recentLogs.unshift({
        id: `${Date.now()}-react-fail-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        phoneNumber: client.phone_number,
        clientName: client.client_name || 'Dorameira',
        service: 'Campanha',
        stage: 'Reativação de Ex-cliente',
        status: 'failed',
        error: result.error
      });
      console.error(`[Reativação] ❌ Falha ao enviar para ${client.client_name}: ${result.error}`);
    }
    saveLogsToFile();
  }

  reactivationState.lastRunAt = new Date().toISOString();
  console.log(`[Reativação] Campanha finalizada. Enviados: ${sent}, Falhas: ${failed}`);
  return { sent, failed, skipped: 0 };
}

export function getReactivationStatus(): ReactivationCampaignStatus {
  return {
    sentToday: reactivationState.sentToday,
    pendingCount: 0, // calculado dinamicamente quando necessário
    lastRunAt: reactivationState.lastRunAt || undefined
  };
}

// Executa o ciclo completo de cobrança no servidor
export async function runDailyChargeCycle(manualTrigger: boolean = false): Promise<{
  success: boolean;
  summary: { total: number; sent: number; failed: number; skipped: number };
}> {
  if (schedulerState.isRunning) {
    return {
      success: false,
      summary: schedulerState.lastCycleSummary || { total: 0, sent: 0, failed: 0, skipped: 0 }
    };
  }

  const wsStatus = getWhatsAppStatus();
  if (wsStatus.state !== 'connected') {
    console.log('[Scheduler] Ciclo cancelado: WhatsApp não está conectado.');
    return {
      success: false,
      summary: { total: 0, sent: 0, failed: 0, skipped: 0 }
    };
  }

  schedulerState.isRunning = true;
  console.log(`[Scheduler] Iniciando ciclo de cobranças automáticas (Manual: ${manualTrigger})...`);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const queue = await getChargeQueue();
    const pendingItems = queue.filter((item) => {
      if (item.alreadySentToday) return false;
      if (item.stage === 'reminder' && !schedulerState.enableReminder) return false;
      if (item.stage === 'due' && !schedulerState.enableDue) return false;
      if (item.stage === 'followup' && !schedulerState.enableFollowup) return false;
      return true;
    });

    console.log(`[Scheduler] Fila total: ${queue.length} | Pendentes habilitados hoje: ${pendingItems.length}`);

    for (const item of pendingItems) {
      // Delay anti-ban humanizado: entre 10 e 18 segundos entre mensagens
      const delayMs = Math.floor(Math.random() * 8000) + 10000;
      console.log(`[Scheduler] Aguardando ${Math.round(delayMs / 1000)}s antes de enviar para ${item.clientName} (${item.phoneNumber})...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const sendRes = await sendWhatsAppTextMessage(item.phoneNumber, item.message);

      if (sendRes.success) {
        sent += 1;
        await markClientAsCharged(item.clientId, item.phoneNumber, item.service);

        recentLogs.unshift({
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: new Date().toISOString(),
          phoneNumber: item.phoneNumber,
          clientName: item.clientName,
          service: item.service,
          stage: item.stageLabel,
          status: 'success',
          messageText: item.message
        });
        console.log(`[Scheduler] ✅ Enviado com sucesso para ${item.clientName} (${item.service})`);
      } else {
        failed += 1;
        recentLogs.unshift({
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: new Date().toISOString(),
          phoneNumber: item.phoneNumber,
          clientName: item.clientName,
          service: item.service,
          stage: item.stageLabel,
          status: 'failed',
          error: sendRes.error
        });
        console.error(`[Scheduler] ❌ Falha ao enviar para ${item.clientName}: ${sendRes.error}`);
      }

      saveLogsToFile();
    }

    skipped = queue.length - pendingItems.length;
    const summary = { total: queue.length, sent, failed, skipped };

    schedulerState.lastCycleAt = new Date().toISOString();
    schedulerState.lastCycleSummary = summary;

    console.log(`[Scheduler] Ciclo finalizado! Enviados: ${sent}, Falhas: ${failed}, Ignorados (já enviados): ${skipped}`);

    // Executa a campanha de reativação de ex-clientes (2 por dia, após o ciclo principal)
    if (schedulerState.enableReactivation) {
      console.log('[Scheduler] Iniciando campanha de reativação de ex-clientes...');
      await runReactivationCampaign(manualTrigger);
    } else {
      console.log('[Scheduler] Campanha de reativação desativada nas configurações. Pulando.');
    }

    return { success: true, summary };
  } catch (err) {
    console.error('[Scheduler] Erro crítico no ciclo de cobranças:', err);
    return { success: false, summary: { total: 0, sent, failed, skipped } };
  } finally {
    schedulerState.isRunning = false;
  }
}

// Inicia o agendador em segundo plano que checa o horário diário
export function startDailyChargeScheduler() {
  console.log(`[Scheduler] Agendador de cobranças ativado. Horário diário configurado: ${String(schedulerState.targetHour).padStart(2, '0')}:${String(schedulerState.targetMinute).padStart(2, '0')} (Brasília).`);

  // Checa a cada 1 minuto se chegou o horário
  setInterval(() => {
    if (!schedulerState.enabled || schedulerState.isRunning) return;

    // Hora de São Paulo (UTC-3)
    const nowSp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const currentHour = nowSp.getHours();
    const currentMinute = nowSp.getMinutes();

    if (currentHour === schedulerState.targetHour && currentMinute === schedulerState.targetMinute) {
      // Verifica se já rodou hoje
      if (schedulerState.lastCycleAt) {
        const lastRun = new Date(schedulerState.lastCycleAt);
        const lastRunSp = new Date(lastRun.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        if (lastRunSp.getDate() === nowSp.getDate() && lastRunSp.getMonth() === nowSp.getMonth()) {
          return; // Já rodou hoje
        }
      }

      console.log('[Scheduler] Horário programado atingido! Iniciando ciclo diário...');
      void runDailyChargeCycle(false);
    }
  }, 60000);
}
