import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { sendWhatsAppTextMessage, deleteWhatsAppChat, getWhatsAppStatus } from './whatsappService.ts';
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

export const DEFAULT_REACTIVATION_TEMPLATE_2 = `Olá, {nome}! Tudo bem? 🌸

Passando para te apresentar a nossa promoção especial de retorno na *EuDorama*! 🎁

Você pode garantir o combo *Viki Pass + Kocowa Plus + WeTV VIP por R$ 29,90*! ✨

Essa promoção é válida durante *3 meses* para você aproveitar os 3 apps pagando bem menos. 💜🍿

Tem interesse em ativar? É só me responder aqui! 😊`;

export const DEFAULT_REACTIVATION_TEMPLATE_3 = `Olá, {nome}! Tudo bem? 🌸

Como queremos muito te ver maratonando com a gente de novo na *EuDorama*, conseguimos aumentar ainda mais o desconto para você! 🎁✨

O combo *Viki Pass + Kocowa Plus + WeTV VIP* caiu de R$ 29,90 para apenas *R$ 24,90*! 😱💜

A promoção continua válida por *3 meses* nos 3 apps, e você tem um prazo de até *7 dias* para realizar a compra com esse valor especial. ⏳🍿

Se quiser aproveitar antes que o prazo acabe, é só me responder aqui! Tenha um ótimo dia! 😊`;

export type ReactivationStep = 1 | 2 | 3 | 'completed' | 'chat_deleted' | 'converted';

export const CLIENT_PROMO_APPS = [
  { key: 'viki', label: 'Viki Pass', promoPrice: 19.90, matchers: ['viki'] },
  { key: 'iqiyi', label: 'iQIYI', promoPrice: 14.90, matchers: ['iqiyi', 'iqyi'] },
  { key: 'kocowa', label: 'Kocowa', promoPrice: 9.90, matchers: ['kocowa'] },
  { key: 'wetv', label: 'WeTV', promoPrice: 9.90, matchers: ['wetv'] },
  { key: 'youku', label: 'Youku', promoPrice: 9.90, matchers: ['youku'] },
  { key: 'dramabox', label: 'DramaBox', promoPrice: 9.90, matchers: ['dramabox'] }
] as const;

export const DEFAULT_CLIENT_PROMO_TEMPLATE = `Olá, {nome}! Tudo bem com você? 🌸

Aqui é o Orion, da *EuDorama*! Passando com muito carinho para agradecer por fazer parte da nossa família dorameira! 💜

Como você já é nossa cliente especial com *{apps_atuais}*, preparamos uma promoção exclusiva nos outros apps que você ainda não tem para deixar a sua maratona ainda mais completa:

{lista_ofertas}
{bloco_combo_50}
✨ Essa promoção é válida por *1 mês* e você só tem *7 dias* a partir de hoje para adquirir! ⏳🍿

Se quiser aproveitar algum deles ou o combo completo, é só me responder por aqui que ativo com todo carinho para você! Tenha um lindo dia! 😊`;

export type ClientPromoQueueItem = {
  clientId: string;
  clientName: string;
  phoneNumber: string;
  createdAt: string | null;
  sortTimestamp: number;
  ownedApps: string[];
  missingApps: Array<{ key: string; label: string; promoPrice: number; originalPrice: number }>;
  originalTotal: number;
  combo50Price: number;
  message: string;
  alreadySent: boolean;
  sentAt: string | null;
  purchasedAt: string | null;
  chatDeletedAt: string | null;
  deleteEligibleDate: string | null;
};

export type ReactivationQueueItem = {
  clientId: string;
  clientName: string;
  phoneNumber: string;
  deletedAt: string | null;
  sortTimestamp: number;
  message: string;
  alreadySent: boolean;
  sentAt: string | null;
  currentStep: ReactivationStep;
  step1SentAt: string | null;
  step2SentAt: string | null;
  step3SentAt: string | null;
  chatDeletedAt: string | null;
  nextEligibleDate: string | null;
  eligibleNow: boolean;
};

export type SchedulerState = {
  enabled: boolean;
  enableReminder: boolean;
  enableDue: boolean;
  enableFollowup: boolean;
  enableReactivation: boolean;
  reactivationDailyLimit: number;
  reactivationTemplate: string;
  reactivationTemplate2: string;
  reactivationTemplate3: string;
  enableClientPromo: boolean;
  clientPromoDailyLimit: number;
  clientPromoTemplate: string;
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
  reactivationTemplate2: DEFAULT_REACTIVATION_TEMPLATE_2,
  reactivationTemplate3: DEFAULT_REACTIVATION_TEMPLATE_3,
  enableClientPromo: true,
  clientPromoDailyLimit: 2,
  clientPromoTemplate: DEFAULT_CLIENT_PROMO_TEMPLATE,
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
      if (typeof rawCfg.reactivationTemplate2 === 'string' && rawCfg.reactivationTemplate2.trim()) {
        schedulerState.reactivationTemplate2 = rawCfg.reactivationTemplate2;
      }
      if (typeof rawCfg.reactivationTemplate3 === 'string' && rawCfg.reactivationTemplate3.trim()) {
        schedulerState.reactivationTemplate3 = rawCfg.reactivationTemplate3;
      }
      if (typeof rawCfg.enableClientPromo === 'boolean') schedulerState.enableClientPromo = rawCfg.enableClientPromo;
      if (typeof rawCfg.clientPromoDailyLimit === 'number' && rawCfg.clientPromoDailyLimit >= 1 && rawCfg.clientPromoDailyLimit <= 100) {
        schedulerState.clientPromoDailyLimit = Math.floor(rawCfg.clientPromoDailyLimit);
      }
      if (typeof rawCfg.clientPromoTemplate === 'string' && rawCfg.clientPromoTemplate.trim()) {
        schedulerState.clientPromoTemplate = rawCfg.clientPromoTemplate;
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
          reactivationTemplate2: schedulerState.reactivationTemplate2,
          reactivationTemplate3: schedulerState.reactivationTemplate3,
          enableClientPromo: schedulerState.enableClientPromo,
          clientPromoDailyLimit: schedulerState.clientPromoDailyLimit,
          clientPromoTemplate: schedulerState.clientPromoTemplate,
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
    | 'reactivationTemplate2'
    | 'reactivationTemplate3'
    | 'enableClientPromo'
    | 'clientPromoDailyLimit'
    | 'clientPromoTemplate'
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
  if (typeof patch.reactivationTemplate2 === 'string') {
    cleanPatch.reactivationTemplate2 = patch.reactivationTemplate2.trim() || DEFAULT_REACTIVATION_TEMPLATE_2;
  }
  if (typeof patch.reactivationTemplate3 === 'string') {
    cleanPatch.reactivationTemplate3 = patch.reactivationTemplate3.trim() || DEFAULT_REACTIVATION_TEMPLATE_3;
  }
  if (typeof patch.enableClientPromo === 'boolean') cleanPatch.enableClientPromo = patch.enableClientPromo;
  if (typeof patch.clientPromoDailyLimit === 'number' && !isNaN(patch.clientPromoDailyLimit)) {
    cleanPatch.clientPromoDailyLimit = Math.min(100, Math.max(1, Math.floor(patch.clientPromoDailyLimit)));
  }
  if (typeof patch.clientPromoTemplate === 'string') {
    cleanPatch.clientPromoTemplate = patch.clientPromoTemplate.trim() || DEFAULT_CLIENT_PROMO_TEMPLATE;
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
export function buildReactivationMessage(
  clientName?: string | null,
  templateOverride?: string,
  step: 1 | 2 | 3 = 1
): string {
  const rawName = String(clientName || '').trim();
  const displayName = rawName && rawName.toLowerCase() !== 'null' && rawName.toLowerCase() !== 'sem nome'
    ? rawName
    : 'Dorameira';
  const defaultTpl =
    step === 2
      ? schedulerState.reactivationTemplate2 || DEFAULT_REACTIVATION_TEMPLATE_2
      : step === 3
        ? schedulerState.reactivationTemplate3 || DEFAULT_REACTIVATION_TEMPLATE_3
        : schedulerState.reactivationTemplate || DEFAULT_REACTIVATION_TEMPLATE;
  const tpl = (templateOverride || defaultTpl).trim();
  return tpl.replace(/\{nome\}/gi, displayName);
}

// Avalia a base do Supabase e retorna a fila completa do dia
export async function getChargeQueue(): Promise<ChargeQueueItem[]> {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, phone_number, client_name, subscriptions, duration_months, deleted, game_progress')
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

// --- CAMPANHA DE REATIVAÇÃO DE EX-CLIENTES (FUNIL DE 3 MENSAGENS) ---
// Mensagem 1: Pergunta interesse na promoção (respeita limite diário)
// Mensagem 2: 1 dia útil depois — Viki Pass + Kocowa Plus + WeTV VIP por R$ 29,90 (válido por 3 meses)
// Mensagem 3: 1 dia útil após a 2ª — Desconto para R$ 24,90 (válido por 3 meses nos 3 apps, prazo de até 7 dias)
// Pós-campanha: 7 dias após a Mensagem 3, se não houver compra, apaga a conversa no WhatsApp automaticamente.

let reactivationState = { sentToday: 0, lastRunDate: '', lastRunAt: '' };

function getSpDateKey(date: Date = new Date()): string {
  const sp = new Date(date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return `${sp.getFullYear()}-${String(sp.getMonth() + 1).padStart(2, '0')}-${String(sp.getDate()).padStart(2, '0')}`;
}

function addBusinessDaysSp(isoTimestamp: string, businessDays: number): string {
  const parsed = new Date(isoTimestamp);
  if (isNaN(parsed.getTime())) return getSpDateKey();
  const sp = new Date(parsed.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  sp.setHours(12, 0, 0, 0);
  let added = 0;
  while (added < businessDays) {
    sp.setDate(sp.getDate() + 1);
    const dow = sp.getDay();
    if (dow !== 0 && dow !== 6) {
      added++;
    }
  }
  return `${sp.getFullYear()}-${String(sp.getMonth() + 1).padStart(2, '0')}-${String(sp.getDate()).padStart(2, '0')}`;
}

function addCalendarDaysSp(isoTimestamp: string, days: number): string {
  const parsed = new Date(isoTimestamp);
  if (isNaN(parsed.getTime())) return getSpDateKey();
  const sp = new Date(parsed.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  sp.setHours(12, 0, 0, 0);
  sp.setDate(sp.getDate() + days);
  return `${sp.getFullYear()}-${String(sp.getMonth() + 1).padStart(2, '0')}-${String(sp.getDate()).padStart(2, '0')}`;
}

function getPhoneMatchKeys(phone?: string | null): string[] {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return [];
  const keys = new Set<string>([digits]);
  const without55 = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  keys.add(without55);
  keys.add(`55${without55}`);
  if (without55.length === 11 && without55[2] === '9') {
    const noNine = without55.slice(0, 2) + without55.slice(3);
    keys.add(noNine);
    keys.add(`55${noNine}`);
  } else if (without55.length === 10) {
    const withNine = without55.slice(0, 2) + '9' + without55.slice(2);
    keys.add(withNine);
    keys.add(`55${withNine}`);
  }
  return Array.from(keys);
}

function isPhoneActiveCustomer(phone: string | null | undefined, activePhoneKeys: Set<string>): boolean {
  return getPhoneMatchKeys(phone).some((k) => activePhoneKeys.has(k));
}

function isValidPhoneCandidate(phone?: string | null): boolean {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  // Ignora números fictícios como 00000000000 ou 5500000000000
  const withoutCountry = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (/^0+$/.test(withoutCountry) || /^(\d)\1{7,}$/.test(withoutCountry)) return false;
  return true;
}

async function fetchActiveCustomerPhoneKeys(): Promise<Set<string>> {
  const activeKeys = new Set<string>();
  const { data: rows, error } = await supabase
    .from('clients')
    .select('phone_number, subscriptions, deleted');

  if (error || !rows) return activeKeys;
  for (const row of rows as Array<{ phone_number?: string; subscriptions?: any; deleted?: boolean }>) {
    const subs = normalizeSubscriptions(row.subscriptions).filter((s) => String(s || '').trim().length > 0);
    if (!row.deleted || subs.length > 0) {
      for (const k of getPhoneMatchKeys(row.phone_number)) {
        activeKeys.add(k);
      }
    }
  }
  return activeKeys;
}

// Lista ex-clientes elegíveis: APENAS quem está completamente na lixeira (deleted=true e sem nenhum app)
// e que NÃO realizou compra em nenhum cadastro com o mesmo número.
export async function getReactivationQueue(): Promise<ReactivationQueueItem[]> {
  const { data: allClients, error } = await supabase
    .from('clients')
    .select('id, phone_number, client_name, subscriptions, deleted, created_at, last_active_at, game_progress');

  if (error || !allClients) {
    console.error('[Reativação] Erro ao carregar clientes do Supabase:', error);
    return [];
  }

  const activePhoneKeys = new Set<string>();
  for (const row of allClients as ClientDBRow[]) {
    const subs = normalizeSubscriptions(row.subscriptions).filter((s) => String(s || '').trim().length > 0);
    if (!row.deleted || subs.length > 0) {
      for (const k of getPhoneMatchKeys(row.phone_number)) {
        activePhoneKeys.add(k);
      }
    }
  }

  const todaySp = getSpDateKey();
  const items: ReactivationQueueItem[] = [];

  for (const c of allClients as ClientDBRow[]) {
    if (!c.deleted) continue;
    if (!isValidPhoneCandidate(c.phone_number)) continue;
    const subs = normalizeSubscriptions(c.subscriptions).filter((s) => String(s || '').trim().length > 0);
    // Regra: "completamente na lixeira, sem nenhum app"
    if (subs.length > 0) continue;
    // Se o número realizou compra / está cadastrado como cliente ativo, para o funil de promoção
    if (isPhoneActiveCustomer(c.phone_number, activePhoneKeys)) continue;

    const progress = c.game_progress || {};
    if (progress._reactivation_campaign_invalid_phone) continue;

    const deletedAt: string | null = progress._deleted_at || c.last_active_at || c.created_at || null;
    const parsedTime = deletedAt ? new Date(deletedAt).getTime() : 0;
    const sortTimestamp = Number.isFinite(parsedTime) ? parsedTime : 0;

    const step1SentAt: string | null = progress._reactivation_campaign_sent_at || null;
    const step2SentAt: string | null = progress._reactivation_step2_sent_at || null;
    const step3SentAt: string | null = progress._reactivation_step3_sent_at || null;
    const chatDeletedAt: string | null = progress._reactivation_chat_deleted_at || null;

    let currentStep: ReactivationStep = 1;
    let nextEligibleDate: string | null = todaySp;
    let eligibleNow = true;
    let messageStep: 1 | 2 | 3 = 1;

    if (chatDeletedAt) {
      currentStep = 'chat_deleted';
      nextEligibleDate = null;
      eligibleNow = false;
      messageStep = 3;
    } else if (step3SentAt) {
      currentStep = 'completed';
      nextEligibleDate = addCalendarDaysSp(step3SentAt, 7);
      eligibleNow = todaySp >= nextEligibleDate;
      messageStep = 3;
    } else if (step2SentAt) {
      currentStep = 3;
      nextEligibleDate = addBusinessDaysSp(step2SentAt, 1);
      eligibleNow = todaySp >= nextEligibleDate;
      messageStep = 3;
    } else if (step1SentAt) {
      currentStep = 2;
      nextEligibleDate = addBusinessDaysSp(step1SentAt, 1);
      eligibleNow = todaySp >= nextEligibleDate;
      messageStep = 2;
    }

    const alreadySent = currentStep === 'completed' || currentStep === 'chat_deleted';

    items.push({
      clientId: c.id,
      clientName: c.client_name || 'Dorameira',
      phoneNumber: c.phone_number,
      deletedAt,
      sortTimestamp,
      message: buildReactivationMessage(c.client_name, undefined, messageStep),
      alreadySent,
      sentAt: step1SentAt,
      currentStep,
      step1SentAt,
      step2SentAt,
      step3SentAt,
      chatDeletedAt,
      nextEligibleDate,
      eligibleNow
    });
  }

  // Mais antigas na lixeira primeiro (das que estão há mais tempo para as mais recentes)
  return items.sort((a, b) => a.sortTimestamp - b.sortTimestamp);
}

async function saveReactivationStepProgress(
  clientId: string,
  step: 1 | 2 | 3,
  meta: { jidUsed?: string; messageId?: string; messageTimestamp?: number }
) {
  try {
    const { data: row } = await supabase.from('clients').select('game_progress').eq('id', clientId).maybeSingle();
    const progress = (row as any)?.game_progress || {};
    const nowIso = new Date().toISOString();
    const stepPatch: Record<string, any> = {};
    if (step === 1) stepPatch._reactivation_campaign_sent_at = nowIso;
    if (step === 2) stepPatch._reactivation_step2_sent_at = nowIso;
    if (step === 3) stepPatch._reactivation_step3_sent_at = nowIso;
    if (meta.jidUsed) stepPatch._reactivation_last_jid = meta.jidUsed;
    if (meta.messageId) stepPatch._reactivation_last_msg_id = meta.messageId;
    if (meta.messageTimestamp) stepPatch._reactivation_last_msg_ts = meta.messageTimestamp;

    await supabase
      .from('clients')
      .update({ game_progress: { ...progress, ...stepPatch } })
      .eq('id', clientId);
  } catch (err) {
    console.error(`[Reativação] Erro ao marcar etapa ${step} para cliente ${clientId}:`, err);
  }
}

export async function sendSingleReactivation(clientId: string): Promise<{ success: boolean; message: string }> {
  const wsStatus = getWhatsAppStatus();
  if (wsStatus.state !== 'connected') {
    return { success: false, message: 'WhatsApp não está conectado no servidor.' };
  }

  const queue = await getReactivationQueue();
  const target = queue.find((q) => q.clientId === clientId);
  if (!target) {
    return { success: false, message: 'Ex-cliente não encontrado, já realizou compra ou não está na lixeira sem apps.' };
  }
  if (target.currentStep !== 1 && target.currentStep !== 2 && target.currentStep !== 3) {
    return { success: false, message: `${target.clientName} já completou todas as 3 mensagens promocionais.` };
  }

  const stepToSend = target.currentStep;
  const result = await sendWhatsAppTextMessage(target.phoneNumber, target.message, { labelName: 'Promoção' });

  if (result.success) {
    if (stepToSend === 1) {
      reactivationState.sentToday++;
    }
    reactivationState.lastRunAt = new Date().toISOString();

    await saveReactivationStepProgress(target.clientId, stepToSend, {
      jidUsed: result.jidUsed,
      messageId: result.messageId,
      messageTimestamp: result.messageTimestamp
    });

    recentLogs.unshift({
      id: `${Date.now()}-react-single-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      phoneNumber: target.phoneNumber,
      clientName: target.clientName,
      service: 'Campanha',
      stage: `Promoção - Mensagem ${stepToSend}/3`,
      status: 'success',
      messageText: target.message
    });
    saveLogsToFile();
    return { success: true, message: `Mensagem promocional ${stepToSend}/3 enviada com sucesso para ${target.clientName}!` };
  } else {
    recentLogs.unshift({
      id: `${Date.now()}-react-single-fail-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      phoneNumber: target.phoneNumber,
      clientName: target.clientName,
      service: 'Campanha',
      stage: `Promoção - Mensagem ${stepToSend}/3`,
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

  const today = getSpDateKey();
  if (reactivationState.lastRunDate !== today) {
    reactivationState.sentToday = 0;
    reactivationState.lastRunDate = today;
  }

  const fullQueue = await getReactivationQueue();
  const activePhoneKeys = await fetchActiveCustomerPhoneKeys();

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // 1. Auto-exclusão de conversas 7 dias após a 3ª mensagem se o número não realizou nenhuma compra
  const chatsToDelete = fullQueue.filter((item) => item.currentStep === 'completed' && item.eligibleNow);
  if (chatsToDelete.length > 0) {
    console.log(`[Reativação] ${chatsToDelete.length} conversa(s) elegíveis para exclusão automática (7 dias após 3ª mensagem sem compra).`);
  }
  for (const target of chatsToDelete) {
    if (isPhoneActiveCustomer(target.phoneNumber, activePhoneKeys)) {
      skipped++;
      continue;
    }
    try {
      const { data: row } = await supabase.from('clients').select('game_progress').eq('id', target.clientId).maybeSingle();
      const progress = (row as any)?.game_progress || {};
      const delRes = await deleteWhatsAppChat(target.phoneNumber, {
        jid: progress._reactivation_last_jid,
        lastMessageId: progress._reactivation_last_msg_id,
        lastMessageTimestamp: progress._reactivation_last_msg_ts
      });

      if (delRes.success) {
        await supabase
          .from('clients')
          .update({ game_progress: { ...progress, _reactivation_chat_deleted_at: new Date().toISOString() } })
          .eq('id', target.clientId);

        recentLogs.unshift({
          id: `${Date.now()}-react-del-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: new Date().toISOString(),
          phoneNumber: target.phoneNumber,
          clientName: target.clientName,
          service: 'Campanha',
          stage: 'Promoção - Conversa Apagada (7d sem compra)',
          status: 'success'
        });
        console.log(`[Reativação] 🗑️ Conversa apagada para ${target.clientName} (${target.phoneNumber})`);
      } else {
        recentLogs.unshift({
          id: `${Date.now()}-react-del-fail-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: new Date().toISOString(),
          phoneNumber: target.phoneNumber,
          clientName: target.clientName,
          service: 'Campanha',
          stage: 'Promoção - Conversa Apagada (7d sem compra)',
          status: 'failed',
          error: delRes.error
        });
      }
      saveLogsToFile();
    } catch (err: any) {
      console.error(`[Reativação] Erro ao apagar conversa de ${target.clientName}:`, err?.message || err);
    }
  }

  // 2. Follow-ups (Etapa 3 e Etapa 2) — enviados no dia útil previsto para quem ainda não comprou
  const step3Targets = fullQueue.filter((item) => item.currentStep === 3 && item.eligibleNow);
  const step2Targets = fullQueue.filter((item) => item.currentStep === 2 && item.eligibleNow);

  // 3. Novos contatos (Etapa 1) — respeita o limite diário configurado
  const dailyLimit = Math.max(1, schedulerState.reactivationDailyLimit || 2);
  const remainingStep1 = Math.max(0, dailyLimit - reactivationState.sentToday);
  const step1Pending = fullQueue.filter((item) => item.currentStep === 1 && item.eligibleNow);
  const step1Candidates = step1Pending.slice(0, Math.min(step1Pending.length, remainingStep1 * 4));

  console.log(
    `[Reativação] Elegíveis hoje → Etapa 3: ${step3Targets.length} | Etapa 2: ${step2Targets.length} | Etapa 1 (meta ${remainingStep1}/${dailyLimit}): ${step1Pending.length}`
  );

  const sendPromoItem = async (target: ReactivationQueueItem, step: 1 | 2 | 3): Promise<boolean> => {
    if (!manualTrigger) {
      const win = isWithinPromoWindow();
      if (!win.allowed) {
        console.log(`[Reativação] Parando ciclo automático: ${win.reason}.`);
        return false;
      }
    }
    if (isPhoneActiveCustomer(target.phoneNumber, activePhoneKeys)) {
      skipped++;
      return true;
    }

    const delayMs = Math.floor(Math.random() * 8000) + 10000;
    console.log(`[Reativação] Aguardando ${Math.round(delayMs / 1000)}s antes de enviar Msg ${step}/3 para ${target.clientName}...`);
    await new Promise((r) => setTimeout(r, delayMs));

    const result = await sendWhatsAppTextMessage(target.phoneNumber, target.message, { labelName: 'Promoção' });

    if (result.success) {
      sent++;
      if (step === 1) reactivationState.sentToday++;

      await saveReactivationStepProgress(target.clientId, step, {
        jidUsed: result.jidUsed,
        messageId: result.messageId,
        messageTimestamp: result.messageTimestamp
      });

      recentLogs.unshift({
        id: `${Date.now()}-react-s${step}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        phoneNumber: target.phoneNumber,
        clientName: target.clientName,
        service: 'Campanha',
        stage: `Promoção - Mensagem ${step}/3`,
        status: 'success',
        messageText: target.message
      });
      console.log(`[Reativação] ✅ Msg ${step}/3 enviada para ${target.clientName} (${target.phoneNumber})`);
    } else {
      failed++;
      const errMsg = String(result.error || '');
      if (errMsg.includes('não está no WhatsApp') || errMsg.includes('não encontrado no WhatsApp') || errMsg.includes('inválido')) {
        try {
          const { data: row } = await supabase.from('clients').select('game_progress').eq('id', target.clientId).maybeSingle();
          const progress = (row as any)?.game_progress || {};
          await supabase
            .from('clients')
            .update({ game_progress: { ...progress, _reactivation_campaign_invalid_phone: new Date().toISOString() } })
            .eq('id', target.clientId);
        } catch {}
      }
      recentLogs.unshift({
        id: `${Date.now()}-react-s${step}-fail-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        phoneNumber: target.phoneNumber,
        clientName: target.clientName,
        service: 'Campanha',
        stage: `Promoção - Mensagem ${step}/3`,
        status: 'failed',
        error: result.error
      });
      console.error(`[Reativação] ❌ Falha ao enviar Msg ${step}/3 para ${target.clientName}: ${result.error}`);
    }
    saveLogsToFile();
    return true;
  };

  for (const target of step3Targets) {
    const keepGoing = await sendPromoItem(target, 3);
    if (!keepGoing) break;
  }

  for (const target of step2Targets) {
    const keepGoing = await sendPromoItem(target, 2);
    if (!keepGoing) break;
  }

  let step1SentThisRun = 0;
  for (const target of step1Candidates) {
    if (step1SentThisRun >= remainingStep1) break;
    const beforeSent = sent;
    const keepGoing = await sendPromoItem(target, 1);
    if (sent > beforeSent) step1SentThisRun++;
    if (!keepGoing) break;
  }

  reactivationState.lastRunAt = new Date().toISOString();
  console.log(`[Reativação] Campanha finalizada. Enviados: ${sent}, Falhas: ${failed}, Ignorados: ${skipped}`);
  return { sent, failed, skipped };
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

    // Executa a campanha de promoção de apps extras para clientes ativos
    if (schedulerState.enableClientPromo) {
      console.log('[Scheduler] Iniciando campanha promocional para clientes ativos...');
      await runClientPromoCampaign(manualTrigger);
    } else {
      console.log('[Scheduler] Campanha promocional para clientes ativos desativada nas configurações. Pulando.');
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

// --- CAMPANHA PROMOCIONAL PARA CLIENTES ATIVOS ("promo cliente") ---
// Verifica os apps que o cliente já possui e oferece os demais com valores promocionais
// + opção de levar todos os que faltam com 50% de desconto do valor original.
// Ordem: clientes mais antigos para os mais recentes.
// Se não comprar em 7 dias após o envio, apaga a conversa do WhatsApp automaticamente.

let clientPromoState = { sentToday: 0, lastRunDate: '', lastRunAt: '' };

function extractOwnedAppKeys(subs: string[]): { ownedKeys: Set<string>; ownedLabels: string[] } {
  const ownedKeys = new Set<string>();
  const ownedLabels: string[] = [];
  for (const sub of subs) {
    const serviceName = String(sub.split('|')[0] || '').trim().toLowerCase();
    if (!serviceName) continue;
    for (const app of CLIENT_PROMO_APPS) {
      if (app.matchers.some((m) => serviceName.includes(m))) {
        if (!ownedKeys.has(app.key)) {
          ownedKeys.add(app.key);
          ownedLabels.push(app.label);
        }
      }
    }
  }
  return { ownedKeys, ownedLabels };
}

export function buildClientPromoMessage(
  clientName: string | null | undefined,
  ownedApps: string[],
  missingApps: Array<{ key: string; label: string; promoPrice: number; originalPrice: number }>,
  originalTotal: number,
  combo50Price: number,
  templateOverride?: string
): string {
  const rawName = String(clientName || '').trim();
  const displayName = rawName && rawName.toLowerCase() !== 'null' && rawName.toLowerCase() !== 'sem nome'
    ? rawName
    : 'Dorameira';

  const appsAtuais = ownedApps.length > 0 ? ownedApps.join(', ') : 'seus apps';
  const listaOfertas = missingApps
    .map((app) => `• *${app.label}*: ${formatCurrency(app.promoPrice)}/mês`)
    .join('\n');

  const blocoCombo50 =
    missingApps.length >= 2
      ? `\n🎁 *E se quiser levar TODOS os ${missingApps.length} apps que faltam:* você ganha *50% de desconto* sobre o valor original — de ${formatCurrency(originalTotal)} por apenas *${formatCurrency(combo50Price)}*!\n`
      : `\n🎁 *Ou com 50% de desconto do valor original:* de ${formatCurrency(originalTotal)} por apenas *${formatCurrency(combo50Price)}*!\n`;

  const tpl = (templateOverride || schedulerState.clientPromoTemplate || DEFAULT_CLIENT_PROMO_TEMPLATE).trim();
  return tpl
    .replace(/\{nome\}/gi, displayName)
    .replace(/\{apps_atuais\}/gi, appsAtuais)
    .replace(/\{lista_ofertas\}/gi, listaOfertas)
    .replace(/\{valor_original_combo\}/gi, formatCurrency(originalTotal))
    .replace(/\{valor_combo_50\}/gi, formatCurrency(combo50Price))
    .replace(/\{bloco_combo_50\}/gi, blocoCombo50);
}

export async function getClientPromoQueue(): Promise<ClientPromoQueueItem[]> {
  const { data: activeClients, error } = await supabase
    .from('clients')
    .select('id, phone_number, client_name, subscriptions, deleted, created_at, game_progress')
    .eq('deleted', false);

  if (error || !activeClients) {
    console.error('[Promo Cliente] Erro ao carregar clientes ativos do Supabase:', error);
    return [];
  }

  const items: ClientPromoQueueItem[] = [];

  for (const c of activeClients as ClientDBRow[]) {
    if (!isValidPhoneCandidate(c.phone_number)) continue;
    const subs = normalizeSubscriptions(c.subscriptions).filter((s) => String(s || '').trim().length > 0);
    if (subs.length === 0) continue;

    const progress = c.game_progress || {};
    if (progress._client_promo_invalid_phone) continue;

    const { ownedKeys, ownedLabels } = extractOwnedAppKeys(subs);
    const missingApps = CLIENT_PROMO_APPS
      .filter((app) => !ownedKeys.has(app.key))
      .map((app) => ({
        key: app.key,
        label: app.label,
        promoPrice: app.promoPrice,
        originalPrice: getServicePrice(app.label, 1)
      }));

    // Se já tem todos os 6 apps, não precisa receber oferta
    if (missingApps.length === 0) continue;

    const originalTotal = missingApps.reduce((acc, a) => acc + a.originalPrice, 0);
    const combo50Price = Number((originalTotal * 0.5).toFixed(2));

    // Mais antigas primeiro (created_at ou data de início mais antiga das assinaturas)
    let earliestTs = c.created_at ? new Date(c.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    for (const sub of subs) {
      const startStr = String(sub.split('|')[1] || '').trim();
      if (startStr) {
        const t = new Date(startStr).getTime();
        if (Number.isFinite(t) && t < earliestTs) earliestTs = t;
      }
    }
    const sortTimestamp = Number.isFinite(earliestTs) ? earliestTs : 0;

    const sentAt: string | null = progress._client_promo_sent_at || null;
    const chatDeletedAt: string | null = progress._client_promo_chat_deleted_at || null;
    const offeredKeys: string[] = Array.isArray(progress._client_promo_offered_apps)
      ? progress._client_promo_offered_apps
      : [];
    const initialSubsCount = Number(progress._client_promo_initial_subs_count ?? subs.length);
    const boughtOfferedApp =
      Boolean(sentAt) &&
      (subs.length > initialSubsCount || offeredKeys.some((k) => ownedKeys.has(k)));
    const purchasedAt: string | null =
      progress._client_promo_purchased_at || (boughtOfferedApp ? new Date().toISOString() : null);

    const deleteEligibleDate = sentAt && !purchasedAt && !chatDeletedAt ? addCalendarDaysSp(sentAt, 7) : null;

    items.push({
      clientId: c.id,
      clientName: c.client_name || 'Dorameira',
      phoneNumber: c.phone_number,
      createdAt: c.created_at || null,
      sortTimestamp,
      ownedApps: ownedLabels,
      missingApps,
      originalTotal,
      combo50Price,
      message: buildClientPromoMessage(c.client_name, ownedLabels, missingApps, originalTotal, combo50Price),
      alreadySent: Boolean(sentAt),
      sentAt,
      purchasedAt,
      chatDeletedAt,
      deleteEligibleDate
    });
  }

  return items.sort((a, b) => a.sortTimestamp - b.sortTimestamp);
}

export async function sendSingleClientPromo(clientId: string): Promise<{ success: boolean; message: string }> {
  const wsStatus = getWhatsAppStatus();
  if (wsStatus.state !== 'connected') {
    return { success: false, message: 'WhatsApp não está conectado no servidor.' };
  }

  const queue = await getClientPromoQueue();
  const target = queue.find((q) => q.clientId === clientId);
  if (!target) {
    return { success: false, message: 'Cliente não encontrado ou já possui todos os 6 apps.' };
  }
  if (target.alreadySent) {
    return { success: false, message: `${target.clientName} já recebeu a promoção para clientes anteriormente.` };
  }

  const result = await sendWhatsAppTextMessage(target.phoneNumber, target.message, { labelName: 'promo cliente' });

  if (result.success) {
    clientPromoState.sentToday++;
    clientPromoState.lastRunAt = new Date().toISOString();

    try {
      const { data: row } = await supabase.from('clients').select('game_progress, subscriptions').eq('id', target.clientId).maybeSingle();
      const progress = (row as any)?.game_progress || {};
      const subs = normalizeSubscriptions((row as any)?.subscriptions).filter((s) => String(s || '').trim().length > 0);
      await supabase
        .from('clients')
        .update({
          game_progress: {
            ...progress,
            _client_promo_sent_at: new Date().toISOString(),
            _client_promo_offered_apps: target.missingApps.map((a) => a.key),
            _client_promo_initial_subs_count: subs.length,
            _client_promo_last_jid: result.jidUsed,
            _client_promo_last_msg_id: result.messageId,
            _client_promo_last_msg_ts: result.messageTimestamp
          }
        })
        .eq('id', target.clientId);
    } catch (err) {
      console.error('[Promo Cliente] Erro ao marcar cliente:', err);
    }

    recentLogs.unshift({
      id: `${Date.now()}-cpromo-single-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      phoneNumber: target.phoneNumber,
      clientName: target.clientName,
      service: target.missingApps.map((a) => a.label).join(', '),
      stage: 'Promo Cliente (Apps Extras)',
      status: 'success',
      messageText: target.message
    });
    saveLogsToFile();
    return { success: true, message: `Promoção enviada com sucesso para ${target.clientName} (etiqueta: promo cliente)!` };
  } else {
    recentLogs.unshift({
      id: `${Date.now()}-cpromo-single-fail-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      phoneNumber: target.phoneNumber,
      clientName: target.clientName,
      service: target.missingApps.map((a) => a.label).join(', '),
      stage: 'Promo Cliente (Apps Extras)',
      status: 'failed',
      error: result.error
    });
    saveLogsToFile();
    return { success: false, message: result.error || 'Erro ao enviar promoção para cliente.' };
  }
}

export async function runClientPromoCampaign(manualTrigger: boolean = false): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!schedulerState.enableClientPromo) {
    console.log('[Promo Cliente] Campanha desativada nas configurações. Pulando.');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  if (!manualTrigger) {
    if (!schedulerState.enabled) {
      console.log('[Promo Cliente] Automação geral desativada. Pulando.');
      return { sent: 0, failed: 0, skipped: 0 };
    }
    const win = isWithinPromoWindow();
    if (!win.allowed) {
      console.log(`[Promo Cliente] ${win.reason}. Pulando.`);
      return { sent: 0, failed: 0, skipped: 0 };
    }
  }

  const wsStatus = getWhatsAppStatus();
  if (wsStatus.state !== 'connected') {
    console.log('[Promo Cliente] WhatsApp não conectado. Pulando campanha.');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const today = getSpDateKey();
  if (clientPromoState.lastRunDate !== today) {
    clientPromoState.sentToday = 0;
    clientPromoState.lastRunDate = today;
  }

  const fullQueue = await getClientPromoQueue();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // 1. Apagar conversa 7 dias após o envio se não comprou nenhum dos apps oferecidos
  const chatsToDelete = fullQueue.filter(
    (item) => item.alreadySent && !item.purchasedAt && !item.chatDeletedAt && item.deleteEligibleDate && today >= item.deleteEligibleDate
  );
  for (const target of chatsToDelete) {
    try {
      const { data: row } = await supabase.from('clients').select('game_progress').eq('id', target.clientId).maybeSingle();
      const progress = (row as any)?.game_progress || {};
      const delRes = await deleteWhatsAppChat(target.phoneNumber, {
        jid: progress._client_promo_last_jid,
        lastMessageId: progress._client_promo_last_msg_id,
        lastMessageTimestamp: progress._client_promo_last_msg_ts
      });

      if (delRes.success) {
        await supabase
          .from('clients')
          .update({ game_progress: { ...progress, _client_promo_chat_deleted_at: new Date().toISOString() } })
          .eq('id', target.clientId);

        recentLogs.unshift({
          id: `${Date.now()}-cpromo-del-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: new Date().toISOString(),
          phoneNumber: target.phoneNumber,
          clientName: target.clientName,
          service: target.missingApps.map((a) => a.label).join(', '),
          stage: 'Promo Cliente - Conversa Apagada (7d sem compra)',
          status: 'success'
        });
        console.log(`[Promo Cliente] 🗑️ Conversa apagada para ${target.clientName} (${target.phoneNumber})`);
      } else {
        recentLogs.unshift({
          id: `${Date.now()}-cpromo-del-fail-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: new Date().toISOString(),
          phoneNumber: target.phoneNumber,
          clientName: target.clientName,
          service: target.missingApps.map((a) => a.label).join(', '),
          stage: 'Promo Cliente - Conversa Apagada (7d sem compra)',
          status: 'failed',
          error: delRes.error
        });
      }
      saveLogsToFile();
    } catch (err: any) {
      console.error(`[Promo Cliente] Erro ao apagar conversa de ${target.clientName}:`, err?.message || err);
    }
  }

  // 2. Enviar promoções para clientes ativos pendentes (mais antigas primeiro)
  const dailyLimit = Math.max(1, schedulerState.clientPromoDailyLimit || 2);
  if (clientPromoState.sentToday >= dailyLimit) {
    console.log(`[Promo Cliente] Já atingiu o limite diário de ${dailyLimit} mensagens hoje. Pulando.`);
    return { sent: 0, failed: 0, skipped: 1 };
  }

  const remaining = dailyLimit - clientPromoState.sentToday;
  const pendingClients = fullQueue.filter((item) => !item.alreadySent);
  const candidates = pendingClients.slice(0, Math.min(pendingClients.length, remaining * 4));
  console.log(`[Promo Cliente] ${pendingClients.length} clientes elegíveis (mais antigas primeiro). Meta hoje: ${remaining}.`);

  for (const target of candidates) {
    if (sent >= remaining) break;
    if (!manualTrigger) {
      const win = isWithinPromoWindow();
      if (!win.allowed) {
        console.log(`[Promo Cliente] Parando ciclo automático: ${win.reason}.`);
        break;
      }
    }

    const delayMs = Math.floor(Math.random() * 8000) + 10000;
    console.log(`[Promo Cliente] Aguardando ${Math.round(delayMs / 1000)}s antes de enviar para ${target.clientName}...`);
    await new Promise((r) => setTimeout(r, delayMs));

    const result = await sendWhatsAppTextMessage(target.phoneNumber, target.message, { labelName: 'promo cliente' });

    if (result.success) {
      sent++;
      clientPromoState.sentToday++;

      try {
        const { data: row } = await supabase.from('clients').select('game_progress, subscriptions').eq('id', target.clientId).maybeSingle();
        const progress = (row as any)?.game_progress || {};
        const subs = normalizeSubscriptions((row as any)?.subscriptions).filter((s) => String(s || '').trim().length > 0);
        await supabase
          .from('clients')
          .update({
            game_progress: {
              ...progress,
              _client_promo_sent_at: new Date().toISOString(),
              _client_promo_offered_apps: target.missingApps.map((a) => a.key),
              _client_promo_initial_subs_count: subs.length,
              _client_promo_last_jid: result.jidUsed,
              _client_promo_last_msg_id: result.messageId,
              _client_promo_last_msg_ts: result.messageTimestamp
            }
          })
          .eq('id', target.clientId);
      } catch (err) {
        console.error('[Promo Cliente] Erro ao marcar cliente:', err);
      }

      recentLogs.unshift({
        id: `${Date.now()}-cpromo-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        phoneNumber: target.phoneNumber,
        clientName: target.clientName,
        service: target.missingApps.map((a) => a.label).join(', '),
        stage: 'Promo Cliente (Apps Extras)',
        status: 'success',
        messageText: target.message
      });
      console.log(`[Promo Cliente] ✅ Enviado para ${target.clientName} (${target.phoneNumber})`);
    } else {
      failed++;
      const errMsg = String(result.error || '');
      if (errMsg.includes('não está no WhatsApp') || errMsg.includes('não encontrado no WhatsApp') || errMsg.includes('inválido')) {
        try {
          const { data: row } = await supabase.from('clients').select('game_progress').eq('id', target.clientId).maybeSingle();
          const progress = (row as any)?.game_progress || {};
          await supabase
            .from('clients')
            .update({ game_progress: { ...progress, _client_promo_invalid_phone: new Date().toISOString() } })
            .eq('id', target.clientId);
        } catch {}
      }
      recentLogs.unshift({
        id: `${Date.now()}-cpromo-fail-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        phoneNumber: target.phoneNumber,
        clientName: target.clientName,
        service: target.missingApps.map((a) => a.label).join(', '),
        stage: 'Promo Cliente (Apps Extras)',
        status: 'failed',
        error: result.error
      });
      console.error(`[Promo Cliente] ❌ Falha ao enviar para ${target.clientName}: ${result.error}`);
    }
    saveLogsToFile();
  }

  clientPromoState.lastRunAt = new Date().toISOString();
  console.log(`[Promo Cliente] Campanha finalizada. Enviados: ${sent}, Falhas: ${failed}, Ignorados: ${skipped}`);
  return { sent, failed, skipped };
}

export function getClientPromoStatus(): ReactivationCampaignStatus {
  return {
    sentToday: clientPromoState.sentToday,
    dailyLimit: Math.max(1, schedulerState.clientPromoDailyLimit || 2),
    pendingCount: 0,
    lastRunAt: clientPromoState.lastRunAt || undefined
  };
}
