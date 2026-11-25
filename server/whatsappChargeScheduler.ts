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
  dailyLimit: number;
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

export const DEFAULT_REACTIVATION_TEMPLATE = `Olá, {nome}! Tudo bem? 🌸

Sou o Orion, da *EuDorama* — uma plataforma dedicada a quem ama doramas e conteúdo asiático! 😊

Faz um tempinho que você não está por aqui e sentimos muito a sua falta! Preparamos uma *condição especial* pensando em você para facilitar o seu retorno. 🎁

Você teria interesse em saber mais sobre a nossa promoção? É só me responder aqui e te explico tudo com carinho! Tenha um lindo dia! ✨🍿`;

export type ReactivationQueueItem = {
  clientId: string;
  clientName: string;
  phoneNumber: string;
  deletedAt: string | null;
  sortTimestamp: number;
  message: string;
  alreadySent: boolean;
  sentAt: string | null;
};

export type SchedulerState = {
  enabled: boolean;
  enableReminder: boolean;
  enableDue: boolean;
  enableFollowup: boolean;
  enableReactivation: boolean;
  reactivationDailyLimit: number;
  reactivationTemplate: string;
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
  reactivationDailyLimit: 2,
  reactivationTemplate: DEFAULT_REACTIVATION_TEMPLATE,
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
      if (typeof rawCfg.reactivationDailyLimit === 'number' && rawCfg.reactivationDailyLimit >= 1 && rawCfg.reactivationDailyLimit <= 100) {
        schedulerState.reactivationDailyLimit = Math.floor(rawCfg.reactivationDailyLimit);
      }
      if (typeof rawCfg.reactivationTemplate === 'string' && rawCfg.reactivationTemplate.trim()) {
        schedulerState.reactivationTemplate = rawCfg.reactivationTemplate;
      }
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
          reactivationDailyLimit: schedulerState.reactivationDailyLimit,
          reactivationTemplate: schedulerState.reactivationTemplate,
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
    | 'enabled'
    | 'enableReminder'
    | 'enableDue'
    | 'enableFollowup'
    | 'enableReactivation'
    | 'reactivationDailyLimit'
    | 'reactivationTemplate'
    | 'targetHour'
    | 'targetMinute'
  >
>;

export function updateSchedulerConfig(patch: SchedulerConfigPatch) {
  const cleanPatch: SchedulerConfigPatch = {};
  if (typeof patch.enabled === 'boolean') cleanPatch.enabled = patch.enabled;
  if (typeof patch.enableReminder === 'boolean') cleanPatch.enableReminder = patch.enableReminder;
  if (typeof patch.enableDue === 'boolean') cleanPatch.enableDue = patch.enableDue;
  if (typeof patch.enableFollowup === 'boolean') cleanPatch.enableFollowup = patch.enableFollowup;
  if (typeof patch.enableReactivation === 'boolean') cleanPatch.enableReactivation = patch.enableReactivation;
  if (typeof patch.reactivationDailyLimit === 'number' && !isNaN(patch.reactivationDailyLimit)) {
    cleanPatch.reactivationDailyLimit = Math.min(100, Math.max(1, Math.floor(patch.reactivationDailyLimit)));
  }
  if (typeof patch.reactivationTemplate === 'string') {
    cleanPatch.reactivationTemplate = patch.reactivationTemplate.trim() || DEFAULT_REACTIVATION_TEMPLATE;
  }
  if (typeof patch.targetHour === 'number' && patch.targetHour >= 0 && patch.targetHour <= 23) cleanPatch.targetHour = patch.targetHour;
  if (typeof patch.targetMinute === 'number' && patch.targetMinute >= 0 && patch.targetMinute <= 59) cleanPatch.targetMinute = patch.targetMinute;
  schedulerState = { ...schedulerState, ...cleanPatch };
  saveConfigToFile();
}

// Cobranças: TODOS os dias (inclusive sábado e domingo), das 15:00 às 19:59 (Brasília)
function isWithinBillingWindow(): { allowed: boolean; reason?: string } {
  const nowSp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const hour = nowSp.getHours();

  if (hour < 15 || hour >= 20) {
    return { allowed: false, reason: `Fora do horário de cobrança (15h às 20h Brasília, agora são ${hour}h)` };
  }
  return { allowed: true };
}

// Promoções de ex-clientes: Segunda a Sexta (SEM finais de semana), das 15:00 às 19:59 (Brasília)
function isWithinPromoWindow(): { allowed: boolean; reason?: string } {
  const nowSp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = nowSp.getDay(); // 0 = Domingo, 6 = Sábado
  const hour = nowSp.getHours();

  if (day === 0 || day === 6) {
    return { allowed: false, reason: 'Fim de semana (mensagens promocionais pausadas sábados e domingos)' };
  }
  if (hour < 15 || hour >= 20) {
    return { allowed: false, reason: `Fora do horário promocional (15h às 20h Brasília, agora são ${hour}h)` };
  }
  return { allowed: true };
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

type ChargeEntryRecord = {
  service: string;
  chargedAt: string;
  expiryKey?: string;
  stagesSent?: string[];
};

function parseChargeWhatsappEntries(raw: any): Record<string, ChargeEntryRecord> {
  if (!raw || typeof raw !== 'object') return {};
  const normalized: Record<string, ChargeEntryRecord> = {};
  Object.entries(raw).forEach(([k, v]) => {
    if (!v || typeof v !== 'object') return;
    const sKey = normalizeServiceKey(k);
    if (!sKey) return;
    normalized[sKey] = {
      service: String((v as any).service || k).trim(),
      chargedAt: String((v as any).chargedAt || '').trim(),
      expiryKey: typeof (v as any).expiryKey === 'string' ? (v as any).expiryKey : undefined,
      stagesSent: Array.isArray((v as any).stagesSent) ? (v as any).stagesSent : []
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
    // Lembrete antecipado (D-5, ou repescagem até D-1): informativo e gentil, SEM pressão de pagamento, SEM promoções
    if (daysRemaining === 1) {
      return `Olá, ${displayName}! Tudo bem com você? ✨ Passando apenas para te avisar com carinho que a sua assinatura do *${service}* vence amanhã, dia ${dataFmt}. O valor da assinatura é de *${precoFmt}*. É apenas um lembrete para você poder se organizar com calma! Se tiver qualquer dúvida ou precisar de algo, estamos sempre à disposição por aqui. Tenha um ótimo dia e aproveite seus doramas! 🌸🍿`;
    }
    return `Olá, ${displayName}! Tudo bem com você? ✨ Passando apenas para te avisar com carinho que a sua assinatura do *${service}* vence no dia ${dataFmt} (daqui a ${daysRemaining} dias). O valor da assinatura é de *${precoFmt}*. É apenas um lembrete para você poder se organizar com calma! Se tiver qualquer dúvida ou precisar de algo, estamos sempre à disposição por aqui. Tenha um ótimo dia e aproveite seus doramas! 🌸🍿`;
  }

  if (stage === 'due') {
    // D0 — convite gentil à renovação
    return `Olá, ${displayName}! Tudo bem? Esperamos que sim! 🌸 Passando para lembrar que hoje (*${dataFmt}*) é o dia do vencimento da sua assinatura do *${service}* no valor de *${precoFmt}*. Quer renovar hoje para manter seu acesso ativo e não perder seus episódios favoritos? Se já realizou o pagamento, por favor desconsidere este recadinho. Qualquer dúvida, estou por aqui para te ajudar! 🍿✨`;
  }

  // stage === 'followup' — D+2 apenas: empático, sem pressão, sem mencionar "X dias de atraso"
  return `Olá, ${displayName}! Tudo bem? Notamos que o acesso à sua assinatura do *${service}* encerrou (dia ${dataFmt}). Sabemos bem como a rotina do dia a dia é corrida! Caso queira continuar acompanhando seus doramas favoritos sem interrupções, me avise por aqui que te envio os dados para renovação. Se tiver acontecido algum imprevisto ou se precisar de alguma ajuda, estou super à disposição! 💜`;
}

// Constrói a mensagem da campanha de reativação (único lugar onde promoção é permitida)
export function buildReactivationMessage(clientName?: string | null, templateOverride?: string): string {
  const rawName = String(clientName || '').trim();
  const displayName = rawName && rawName.toLowerCase() !== 'null' && rawName.toLowerCase() !== 'sem nome'
    ? rawName
    : 'Dorameira';
  const tpl = (templateOverride || schedulerState.reactivationTemplate || DEFAULT_REACTIVATION_TEMPLATE).trim();
  return tpl.replace(/\{nome\}/gi, displayName);
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
      const expiryKey = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, '0')}-${String(expiry.getDate()).padStart(2, '0')}`;
      const serviceKey = normalizeServiceKey(serviceName);
      const lastEntry = entryMap[serviceKey];
      // Etapas já enviadas neste ciclo de vencimento (se renovou para outro mês, a lista zera)
      const stagesSentThisCycle = lastEntry?.expiryKey === expiryKey ? lastEntry.stagesSent || [] : [];

      let stage: 'reminder' | 'due' | 'followup' | null = null;
      let stageLabel = '';

      if (daysRemaining >= 1 && daysRemaining <= 5 && !stagesSentThisCycle.includes('reminder')) {
        stage = 'reminder';
        stageLabel = daysRemaining === 5 ? 'Vence em 5 dias (D-5)' : `Lembrete (D-${daysRemaining})`;
      } else if (daysRemaining <= 0 && daysRemaining >= -1 && !stagesSentThisCycle.includes('due')) {
        stage = 'due';
        stageLabel = daysRemaining === 0 ? 'Vence Hoje (D0)' : 'Vencimento (D0 - repescagem)';
      } else if (daysRemaining <= -2 && daysRemaining >= -5 && !stagesSentThisCycle.includes('followup')) {
        stage = 'followup';
        stageLabel = `Vencido há ${Math.abs(daysRemaining)} dias (D+${Math.abs(daysRemaining)})`;
      }

      if (!stage) continue;

      const price = getServicePrice(serviceName, duration);
      const priceFormatted = price > 0 ? formatCurrency(price) : 'Valor Regular';
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

  const result = await sendWhatsAppTextMessage(target.phoneNumber, target.message, { labelName: 'Cobrança' });

  if (result.success) {
    await markClientAsCharged(target.clientId, target.phoneNumber, target.service, target.stage, target.expiryDateStr);

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

// Marca no Supabase que o cliente recebeu a mensagem hoje e registra a etapa no ciclo atual
async function markClientAsCharged(
  clientId: string,
  phoneNumber: string,
  serviceName: string,
  stage?: 'reminder' | 'due' | 'followup',
  expiryDateStr?: string
) {
  try {
    const { data: client } = await supabase
      .from('clients')
      .select('game_progress, subscriptions, duration_months')
      .eq('id', clientId)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    const currentProgress = (client as any)?.game_progress || {};
    const previousServices = Array.isArray(currentProgress._charge_whatsapp_services)
      ? currentProgress._charge_whatsapp_services
      : [];
    const previousEntries = parseChargeWhatsappEntries(currentProgress._charge_whatsapp_entries);
    const serviceKey = normalizeServiceKey(serviceName);

    // Converte DD/MM/AAAA para YYYY-MM-DD para chave estável do ciclo
    let expiryKey = previousEntries[serviceKey]?.expiryKey || '';
    if (expiryDateStr && expiryDateStr.includes('/')) {
      const [dd, mm, yyyy] = expiryDateStr.split('/');
      if (dd && mm && yyyy) expiryKey = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }

    const prevStages =
      previousEntries[serviceKey]?.expiryKey === expiryKey ? previousEntries[serviceKey]?.stagesSent || [] : [];
    const nextStages = stage ? Array.from(new Set([...prevStages, stage])) : prevStages;

    if (serviceKey) {
      previousEntries[serviceKey] = {
        service: serviceName,
        chargedAt: nowIso,
        expiryKey: expiryKey || undefined,
        stagesSent: nextStages
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

// Lista ex-clientes elegíveis: APENAS quem está completamente na lixeira (deleted=true e sem nenhum app),
// ordenado das pessoas que deixaram de ser clientes mais recentemente para as demais.
export async function getReactivationQueue(): Promise<ReactivationQueueItem[]> {
  const { data: deletedClients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('deleted', true);

  if (error || !deletedClients) {
    console.error('[Reativação] Erro ao carregar ex-clientes do Supabase:', error);
    return [];
  }

  const items: ReactivationQueueItem[] = [];

  for (const c of deletedClients as ClientDBRow[]) {
    if (!c.phone_number) continue;
    const subs = normalizeSubscriptions(c.subscriptions).filter((s) => String(s || '').trim().length > 0);
    // Regra: "completamente na lixeira, sem nenhum app"
    if (subs.length > 0) continue;

    const progress = c.game_progress || {};
    const deletedAt: string | null = progress._deleted_at || c.last_active_at || c.created_at || null;
    const parsedTime = deletedAt ? new Date(deletedAt).getTime() : 0;
    const sortTimestamp = Number.isFinite(parsedTime) ? parsedTime : 0;
    const sentAt: string | null = progress._reactivation_campaign_sent_at || null;

    items.push({
      clientId: c.id,
      clientName: c.client_name || 'Dorameira',
      phoneNumber: c.phone_number,
      deletedAt,
      sortTimestamp,
      message: buildReactivationMessage(c.client_name),
      alreadySent: Boolean(sentAt),
      sentAt
    });
  }

  // Mais antigas na lixeira primeiro (das que estão há mais tempo para as mais recentes)
  return items.sort((a, b) => a.sortTimestamp - b.sortTimestamp);
}

export async function sendSingleReactivation(clientId: string): Promise<{ success: boolean; message: string }> {
  const wsStatus = getWhatsAppStatus();
  if (wsStatus.state !== 'connected') {
    return { success: false, message: 'WhatsApp não está conectado no servidor.' };
  }

  const queue = await getReactivationQueue();
  const target = queue.find((q) => q.clientId === clientId);
  if (!target) {
    return { success: false, message: 'Ex-cliente não encontrado ou não está completamente na lixeira sem apps.' };
  }
  if (target.alreadySent) {
    return { success: false, message: `${target.clientName} já recebeu a mensagem promocional anteriormente.` };
  }

  const result = await sendWhatsAppTextMessage(target.phoneNumber, target.message, { labelName: 'Promoção' });

  if (result.success) {
    reactivationState.sentToday++;
    reactivationState.lastRunAt = new Date().toISOString();

    try {
      const { data: row } = await supabase.from('clients').select('game_progress').eq('id', target.clientId).maybeSingle();
      const progress = (row as any)?.game_progress || {};
      await supabase
        .from('clients')
        .update({ game_progress: { ...progress, _reactivation_campaign_sent_at: new Date().toISOString() } })
        .eq('id', target.clientId);
    } catch (err) {
      console.error('[Reativação] Erro ao marcar cliente:', err);
    }

    recentLogs.unshift({
      id: `${Date.now()}-react-single-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      phoneNumber: target.phoneNumber,
      clientName: target.clientName,
      service: 'Campanha',
      stage: 'Reativação de Ex-cliente',
      status: 'success',
      messageText: target.message
    });
    saveLogsToFile();
    return { success: true, message: `Mensagem promocional enviada com sucesso para ${target.clientName}!` };
  } else {
    recentLogs.unshift({
      id: `${Date.now()}-react-single-fail-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      phoneNumber: target.phoneNumber,
      clientName: target.clientName,
      service: 'Campanha',
      stage: 'Reativação de Ex-cliente',
      status: 'failed',
      error: result.error
    });
    saveLogsToFile();
    return { success: false, message: result.error || 'Erro ao enviar mensagem promocional.' };
  }
}

export async function runReactivationCampaign(manualTrigger: boolean = false): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!schedulerState.enableReactivation) {
    console.log('[Reativação] Campanha desativada nas configurações. Pulando.');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  if (!manualTrigger) {
    if (!schedulerState.enabled) {
      console.log('[Reativação] Automação geral desativada. Pulando.');
      return { sent: 0, failed: 0, skipped: 0 };
    }
    const win = isWithinPromoWindow();
    if (!win.allowed) {
      console.log(`[Reativação] ${win.reason}. Pulando.`);
      return { sent: 0, failed: 0, skipped: 0 };
    }
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

  const dailyLimit = Math.max(1, schedulerState.reactivationDailyLimit || 2);
  if (reactivationState.sentToday >= dailyLimit) {
    console.log(`[Reativação] Já atingiu o limite diário de ${dailyLimit} mensagens hoje. Pulando.`);
    return { sent: 0, failed: 0, skipped: 1 };
  }

  const remaining = dailyLimit - reactivationState.sentToday;
  const fullQueue = await getReactivationQueue();
  const pendingExClients = fullQueue.filter((item) => !item.alreadySent);

  const targets = pendingExClients.slice(0, remaining);
  console.log(`[Reativação] ${pendingExClients.length} ex-clientes elegíveis (lixeira sem apps, mais antigas primeiro). Limite: ${dailyLimit}/dia. Enviando para ${targets.length}.`);

  let sent = 0, failed = 0;

  for (const target of targets) {
    if (!manualTrigger) {
      const win = isWithinPromoWindow();
      if (!win.allowed) {
        console.log(`[Reativação] Parando ciclo automático: ${win.reason}.`);
        break;
      }
    }
    const delayMs = Math.floor(Math.random() * 8000) + 10000;
    console.log(`[Reativação] Aguardando ${Math.round(delayMs / 1000)}s antes de enviar para ${target.clientName}...`);
    await new Promise((r) => setTimeout(r, delayMs));

    const result = await sendWhatsAppTextMessage(target.phoneNumber, target.message, { labelName: 'Promoção' });

    if (result.success) {
      sent++;
      reactivationState.sentToday++;

      // Marca no Supabase para nunca reenviar
      try {
        const { data: row } = await supabase.from('clients').select('game_progress').eq('id', target.clientId).maybeSingle();
        const progress = (row as any)?.game_progress || {};
        await supabase
          .from('clients')
          .update({ game_progress: { ...progress, _reactivation_campaign_sent_at: new Date().toISOString() } })
          .eq('id', target.clientId);
      } catch (err) {
        console.error('[Reativação] Erro ao marcar cliente:', err);
      }

      recentLogs.unshift({
        id: `${Date.now()}-react-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        phoneNumber: target.phoneNumber,
        clientName: target.clientName,
        service: 'Campanha',
        stage: 'Reativação de Ex-cliente',
        status: 'success',
        messageText: target.message
      });
      console.log(`[Reativação] ✅ Enviado para ${target.clientName} (${target.phoneNumber})`);
    } else {
      failed++;
      recentLogs.unshift({
        id: `${Date.now()}-react-fail-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        phoneNumber: target.phoneNumber,
        clientName: target.clientName,
        service: 'Campanha',
        stage: 'Reativação de Ex-cliente',
        status: 'failed',
        error: result.error
      });
      console.error(`[Reativação] ❌ Falha ao enviar para ${target.clientName}: ${result.error}`);
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
    dailyLimit: Math.max(1, schedulerState.reactivationDailyLimit || 2),
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

  if (!manualTrigger) {
    const win = isWithinBillingWindow();
    if (!win.allowed) {
      console.log(`[Scheduler] Ciclo automático não iniciado: ${win.reason}`);
      return {
        success: false,
        summary: { total: 0, sent: 0, failed: 0, skipped: 0 }
      };
    }
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
      if (!manualTrigger) {
        const win = isWithinBillingWindow();
        if (!win.allowed) {
          console.log(`[Scheduler] Parando ciclo automático: ${win.reason}.`);
          break;
        }
      }
      // Delay anti-ban humanizado: entre 10 e 18 segundos entre mensagens
      const delayMs = Math.floor(Math.random() * 8000) + 10000;
      console.log(`[Scheduler] Aguardando ${Math.round(delayMs / 1000)}s antes de enviar para ${item.clientName} (${item.phoneNumber})...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const sendRes = await sendWhatsAppTextMessage(item.phoneNumber, item.message, { labelName: 'Cobrança' });

      if (sendRes.success) {
        sent += 1;
        await markClientAsCharged(item.clientId, item.phoneNumber, item.service, item.stage, item.expiryDateStr);

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

// Inicia o agendador em segundo plano:
// Cobranças: todos os dias (Seg-Dom), 15h às 20h Brasília
// Promoções: Segunda a Sexta (sem fins de semana), 15h às 20h Brasília
export function startDailyChargeScheduler() {
  console.log('[Scheduler] Agendador ativado. Cobranças: todos os dias 15h-20h | Promoções: Seg-Sex 15h-20h (Brasília).');

  // Checa a cada 1 minuto se está dentro da janela permitida
  setInterval(() => {
    if (!schedulerState.enabled || schedulerState.isRunning) return;

    const win = isWithinBillingWindow();
    if (!win.allowed) return;

    // Hora de São Paulo (UTC-3)
    const nowSp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));

    // Verifica se já rodou hoje
    if (schedulerState.lastCycleAt) {
      const lastRun = new Date(schedulerState.lastCycleAt);
      const lastRunSp = new Date(lastRun.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      if (
        lastRunSp.getDate() === nowSp.getDate() &&
        lastRunSp.getMonth() === nowSp.getMonth() &&
        lastRunSp.getFullYear() === nowSp.getFullYear()
      ) {
        return; // Já rodou hoje
      }
    }

    console.log('[Scheduler] Dentro da janela permitida (15h-20h)! Iniciando ciclo diário...');
    void runDailyChargeCycle(false);
  }, 60000);
}
