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

export type ChargeQueueItem = {
  id: string;
  clientId: string;
  clientName: string;
  phoneNumber: string;
  service: string;
  stage: 'reminder' | 'due' | 'followup' | 'reactivation';
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

export type SchedulerState = {
  enabled: boolean;
  targetHour: number; // ex: 9 (09:00)
  targetMinute: number; // ex: 30 (09:30)
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
  targetHour: 9,
  targetMinute: 30,
  isRunning: false
};

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

export function updateSchedulerConfig(patch: Partial<Pick<SchedulerState, 'enabled' | 'targetHour' | 'targetMinute'>>) {
  schedulerState = { ...schedulerState, ...patch };
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
  stage: 'reminder' | 'due' | 'followup' | 'reactivation'
): string {
  const rawName = String(clientName || '').trim();
  const displayName = rawName && rawName.toLowerCase() !== 'null' && rawName.toLowerCase() !== 'sem nome'
    ? rawName
    : 'Dorameira';
  const dataFmt = expiryDate.toLocaleDateString('pt-BR');
  const precoFmt = price > 0 ? formatCurrency(price) : 'o valor regular do seu plano';

  if (stage === 'reminder') {
    // REGRA IMPORTANTE: Se ainda faltar dias para vencer, NÃO fala sobre adiantar pagamento e NÃO dá promoções
    if (daysRemaining === 1) {
      return `Olá, ${displayName}! Tudo bem com você? ✨ Passando com carinho para lembrar que a sua assinatura do *${service}* vence amanhã, dia ${dataFmt}. É apenas um lembrete para você poder se programar com calma! Se precisar de qualquer informação ou tiver alguma dúvida, estamos à disposição por aqui. Tenha um ótimo dia e bons doramas! 🌸✨`;
    }
    return `Olá, ${displayName}! Tudo bem com você? ✨ Passando apenas para te avisar com carinho que a sua assinatura do *${service}* vence no dia ${dataFmt} (daqui a ${daysRemaining} dias). O valor da assinatura é de *${precoFmt}*. É apenas um lembrete para você poder se organizar com calma! Se tiver qualquer dúvida ou precisar de algo, estamos sempre à disposição por aqui. Tenha um ótimo dia e aproveite seus doramas! 🌸🍿`;
  }

  if (stage === 'due') {
    // Dia do vencimento
    return `Olá, ${displayName}! Tudo bem? Esperamos que sim! 🌸 Passando para lembrar que hoje (*${dataFmt}*) é o dia do vencimento da sua assinatura do *${service}* no valor de *${precoFmt}*. Quer renovar hoje para manter seu acesso ativo e não perder seus episódios favoritos? Se já realizou o pagamento, por favor desconsidere este recadinho. Qualquer dúvida, estou por aqui para te ajudar! 🍿✨`;
  }

  if (stage === 'followup') {
    // Vencido recentemente (D+1 a D+7)
    const diasVencido = Math.abs(daysRemaining);
    const textoDias = diasVencido === 1 ? 'ontem' : `há ${diasVencido} dias`;
    return `Olá, ${displayName}! Tudo bem? Notamos que o acesso à sua assinatura do *${service}* encerrou (${textoDias}, dia ${dataFmt}). Sabemos bem como a rotina do dia a dia é corrida! Caso queira continuar acompanhando seus doramas favoritos sem interrupções, me avise por aqui que te envio os dados para renovação. Se tiver acontecido algum imprevisto ou se precisar de alguma ajuda, estou super à disposição! 💜`;
  }

  // stage === 'reactivation' (D+15+)
  return `Olá, ${displayName}! Tudo bem? Sentimos muito a sua falta aqui na EuDorama! 🥰 Notamos que já faz um tempinho que sua assinatura do *${service}* encerrou. Preparamos uma condição super especial para você voltar a maratonar seus doramas preferidos por apenas *${precoFmt}*! O que acha? Se quiser aproveitar ou se tiver qualquer dúvida, é só me responder aqui. Tenha um lindo dia! ✨🍿`;
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

      let stage: 'reminder' | 'due' | 'followup' | 'reactivation' | null = null;
      let stageLabel = '';

      if (daysRemaining >= 1 && daysRemaining <= 5) {
        stage = 'reminder';
        stageLabel = daysRemaining === 1 ? 'Vence Amanhã (D-1)' : `Vence em ${daysRemaining} dias (D-${daysRemaining})`;
      } else if (daysRemaining === 0) {
        stage = 'due';
        stageLabel = 'Vence Hoje (D0)';
      } else if (daysRemaining >= -7 && daysRemaining <= -1) {
        stage = 'followup';
        stageLabel = `Vencido há ${Math.abs(daysRemaining)}d (D+${Math.abs(daysRemaining)})`;
      } else if (daysRemaining <= -15 && daysRemaining >= -45) {
        stage = 'reactivation';
        stageLabel = `Reativação (${Math.abs(daysRemaining)}d vencido)`;
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

  // Ordena prioritariamente: 1º Vence hoje (D0), 2º Vencidos (D+), 3º Lembretes (D-), 4º Reativação
  const stageWeights = { due: 1, followup: 2, reminder: 3, reactivation: 4 };
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
    const pendingItems = queue.filter((item) => !item.alreadySentToday);

    console.log(`[Scheduler] Fila total: ${queue.length} | Pendentes de envio hoje: ${pendingItems.length}`);

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
