#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  supabaseUrl: 'https://mhiormzpctfoyjbrmxfz.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ',
  automationSettingsKey: 'charge_whatsapp_automation_v1',
  remoteSettingsEnabled: true,
  automationEnabled: true,
  wuzApiBaseUrl: 'http://localhost:8080',
  wuzApiTextPath: '/chat/send/text',
  wuzApiToken: 'COLOQUE_SEU_TOKEN_AQUI',
  wuzApiTokenHeader: 'Authorization',
  wuzApiPhoneField: 'Phone',
  wuzApiMessageField: 'Body',
  wuzApiExtraBody: {},
  timezone: 'America/Sao_Paulo',
  sendWindowStart: '08:00',
  sendWindowEnd: '18:30',
  dailyMaxMessages: 50,
  delayBetweenMessagesMs: [1200, 3500],
  requestTimeoutMs: 15000,
  retryAttempts: 3,
  retryBackoffMs: 2000,
  stateFile: resolve(SCRIPT_DIR, '.cobranca-whatsapp-state.json'),
  lockFile: resolve(SCRIPT_DIR, '.cobranca-whatsapp.lock')
};

const DEFAULT_TEMPLATES = {
  reminder:
    'Olá {{clienteNome}}! Passando para lembrar que a assinatura {{servicoNome}} vence em {{dataVencimento}}. ' +
    'O valor é {{valor}} e faltam {{diasParaVencimento}} dias. Se precisar de algo, estou por aqui.',
  due:
    'Olá {{clienteNome}}, tudo bem? Hoje vence a assinatura {{servicoNome}}. O valor é {{valor}}. ' +
    'Se já realizou o pagamento, pode desconsiderar esta mensagem.',
  followup:
    'Olá {{clienteNome}}, vimos que a assinatura {{servicoNome}} venceu em {{dataVencimento}} e já está com {{diasAtraso}} dias de atraso. ' +
    'Você quer continuar com o serviço? Se precisar, posso te ajudar.',
  reactivation:
    'Olá {{clienteNome}}, sua assinatura {{servicoNome}} venceu em {{dataVencimento}} e está com {{diasAtraso}} dias em atraso. ' +
    'Temos uma condição especial de reativação por {{valor}}. Se quiser, posso regularizar para você.'
};

const CLIENTS = [
  // Este arquivo foi preparado para receber sua lista real de clientes sem tocar em nenhuma base existente.
  // Exemplo de estrutura:
  // {
  //   nome: 'Cliente Exemplo',
  //   telefone: '5511999999999',
  //   optIn: true,
  //   assinaturas: [
  //     {
  //       servico: 'Plano Mensal',
  //       valor: 99.9,
  //       vencimento: '2026-04-10',
  //       status: 'ativo'
  //     }
  //   ]
  // }
];

const STAGE_ORDER = ['reminder', 'due', 'followup', 'reactivation'];

const STAGE_LABELS = {
  reminder: 'lembrete amigavel',
  due: 'cobranca gentil',
  followup: 'follow-up',
  reactivation: 'oferta de reativacao'
};

function createBlankState() {
  const now = new Date().toISOString();

  return {
    version: 1,
    templates: { ...DEFAULT_TEMPLATES },
    subscriptions: {},
    dailySent: {},
    meta: {
      createdAt: now,
      updatedAt: now
    }
  };
}

let RUNTIME_REMOTE_MANUAL_RESPONSES = {};

function parseJsonSafe(raw, fallback = null) {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function fetchRemoteAutomationSettings() {
  if (!CONFIG.remoteSettingsEnabled) {
    return null;
  }

  const supabaseUrl = String(CONFIG.supabaseUrl || '').trim().replace(/\/+$/, '');
  const supabaseKey = String(CONFIG.supabaseAnonKey || '').trim();

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const endpoint = `${supabaseUrl}/rest/v1/history_settings?select=value&key=eq.${encodeURIComponent(
    CONFIG.automationSettingsKey
  )}&limit=1`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(CONFIG.requestTimeoutMs) || 15000));

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json().catch(() => []);
    const rawValue = Array.isArray(data) ? data[0]?.value : null;
    if (!rawValue) {
      return null;
    }

    return parseJsonSafe(String(rawValue), null);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function applyRemoteAutomationSettings(state, remoteSettings) {
  if (!remoteSettings || typeof remoteSettings !== 'object') {
    return state;
  }

  const nextState = ensureStateShape(state);
  const remoteConfig = remoteSettings.config && typeof remoteSettings.config === 'object' ? remoteSettings.config : {};
  const remoteTemplates = remoteSettings.templates && typeof remoteSettings.templates === 'object' ? remoteSettings.templates : {};
  const remoteManualResponses = remoteSettings.manualResponses && typeof remoteSettings.manualResponses === 'object'
    ? remoteSettings.manualResponses
    : {};

  if (typeof remoteSettings.enabled === 'boolean') {
    CONFIG.automationEnabled = remoteSettings.enabled;
  }

  const applyString = (key, value) => {
    if (typeof value === 'string' && value.trim()) {
      CONFIG[key] = value.trim();
    }
  };

  applyString('timezone', remoteConfig.timezone);
  applyString('sendWindowStart', remoteConfig.sendWindowStart);
  applyString('sendWindowEnd', remoteConfig.sendWindowEnd);
  const remoteConfigValue = (primary, legacy) => remoteConfig?.[primary] ?? remoteConfig?.[legacy];

  applyString('wuzApiBaseUrl', remoteConfigValue('wuzApiBaseUrl', 'uazApiBaseUrl'));
  applyString('wuzApiTextPath', remoteConfigValue('wuzApiTextPath', 'uazApiTextPath'));
  applyString('wuzApiToken', remoteConfigValue('wuzApiToken', 'uazApiToken'));
  applyString('wuzApiTokenHeader', remoteConfigValue('wuzApiTokenHeader', 'uazApiTokenHeader'));
  applyString('wuzApiPhoneField', remoteConfigValue('wuzApiPhoneField', 'uazApiPhoneField'));
  applyString('wuzApiMessageField', remoteConfigValue('wuzApiMessageField', 'uazApiMessageField'));

  if (Number.isFinite(Number(remoteConfig.dailyMaxMessages))) {
    CONFIG.dailyMaxMessages = Math.max(0, Number(remoteConfig.dailyMaxMessages));
  }

  if (Array.isArray(remoteConfig.delayBetweenMessagesMs) && remoteConfig.delayBetweenMessagesMs.length >= 2) {
    CONFIG.delayBetweenMessagesMs = [
      Math.max(0, Number(remoteConfig.delayBetweenMessagesMs[0]) || 0),
      Math.max(0, Number(remoteConfig.delayBetweenMessagesMs[1]) || 0)
    ];
  }

  if (Number.isFinite(Number(remoteConfig.requestTimeoutMs))) {
    CONFIG.requestTimeoutMs = Math.max(1000, Number(remoteConfig.requestTimeoutMs));
  }

  if (Number.isFinite(Number(remoteConfig.retryAttempts))) {
    CONFIG.retryAttempts = Math.max(1, Number(remoteConfig.retryAttempts));
  }

  if (Number.isFinite(Number(remoteConfig.retryBackoffMs))) {
    CONFIG.retryBackoffMs = Math.max(0, Number(remoteConfig.retryBackoffMs));
  }

  if (remoteConfig.wuzApiExtraBody && typeof remoteConfig.wuzApiExtraBody === 'object') {
    CONFIG.wuzApiExtraBody = remoteConfig.wuzApiExtraBody;
  } else if (remoteConfig.uazApiExtraBody && typeof remoteConfig.uazApiExtraBody === 'object') {
    CONFIG.wuzApiExtraBody = remoteConfig.uazApiExtraBody;
  }

  if (remoteTemplates && Object.keys(remoteTemplates).length > 0) {
    nextState.templates = {
      ...DEFAULT_TEMPLATES,
      ...nextState.templates,
      ...remoteTemplates
    };
  }

  RUNTIME_REMOTE_MANUAL_RESPONSES = {};
  Object.entries(remoteManualResponses).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;
    const phone = String(value.phone || '').trim();
    const service = String(value.service || '').trim();
    const dueDate = String(value.dueDate || '').trim();
    if (!phone || !service || !dueDate) return;
    const manualKey = String(key || '').trim() || buildSubscriptionKeyFromParts(phone, service, dueDate);
    RUNTIME_REMOTE_MANUAL_RESPONSES[manualKey] = true;
  });

  return nextState;
}

async function loadRuntimeState() {
  const localState = readState();
  const remoteSettings = await fetchRemoteAutomationSettings();
  return remoteSettings ? applyRemoteAutomationSettings(localState, remoteSettings) : localState;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function formatMoneyBR(value) {
  const numeric = typeof value === 'number' ? value : parseMoney(value);
  if (!Number.isFinite(numeric)) {
    return String(value ?? '');
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(numeric);
}

function parseMoney(value) {
  if (typeof value === 'number') {
    return value;
  }

  const normalized = String(value ?? '')
    .trim()
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  if (!normalized) {
    return NaN;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeServiceKey(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizePhoneComparable(value) {
  const digits = String(value ?? '').replace(/\D+/g, '');
  if (!digits) {
    return '';
  }

  if (digits.startsWith('55')) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

function normalizePhoneForApi(value) {
  return normalizePhoneComparable(value);
}

function isIsoDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

function parseIsoDate(value) {
  if (!isIsoDateString(value)) {
    return NaN;
  }

  const [year, month, day] = String(value).split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const check = new Date(timestamp);

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return NaN;
  }

  return timestamp;
}

function formatIsoDateBR(value) {
  if (!isIsoDateString(value)) {
    return String(value ?? '');
  }

  const [year, month, day] = String(value).split('-');
  return `${day}/${month}/${year}`;
}

function diffDaysIso(laterIso, earlierIso) {
  const later = parseIsoDate(laterIso);
  const earlier = parseIsoDate(earlierIso);

  if (!Number.isFinite(later) || !Number.isFinite(earlier)) {
    return NaN;
  }

  return Math.round((later - earlier) / 86400000);
}

function getZonedDateString(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getZonedTimeMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  return Number(parts.hour) * 60 + Number(parts.minute);
}

function parseTimeHHMM(value) {
  const match = String(value ?? '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Horario invalido: ${value}`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Horario invalido: ${value}`);
  }

  return hour * 60 + minute;
}

function isWithinSendWindow(date, config = CONFIG) {
  const currentMinutes = getZonedTimeMinutes(date, config.timezone);
  const startMinutes = parseTimeHHMM(config.sendWindowStart);
  const endMinutes = parseTimeHHMM(config.sendWindowEnd);

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

function getCurrentIsoDate(timeZone) {
  return getZonedDateString(new Date(), timeZone);
}

function stageFromDateDiff(daysUntilDue) {
  if (daysUntilDue === 5) {
    return 'reminder';
  }

  if (daysUntilDue === 0) {
    return 'due';
  }

  if (daysUntilDue === -2) {
    return 'followup';
  }

  if (daysUntilDue === -15) {
    return 'reactivation';
  }

  return null;
}

function buildSubscriptionKeyFromParts(phone, service, dueDate) {
  return [normalizePhoneComparable(phone), normalizeServiceKey(service), String(dueDate)].join('::');
}

function buildSubscriptionKey(client, subscription) {
  return buildSubscriptionKeyFromParts(client.telefone, subscription.servico, subscription.vencimento);
}

function renderTemplate(template, variables) {
  return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (match, token) => {
    if (Object.prototype.hasOwnProperty.call(variables, token)) {
      return String(variables[token]);
    }

    return match;
  });
}

function createTemplateVariables(client, subscription, currentIsoDate) {
  const dueDate = String(subscription.vencimento);
  const daysUntilDue = diffDaysIso(dueDate, currentIsoDate);
  const daysLate = Number.isFinite(daysUntilDue) ? Math.max(0, -daysUntilDue) : '';

  return {
    clienteNome: client.nome,
    clienteTelefone: normalizePhoneForApi(client.telefone),
    servicoNome: subscription.servico,
    valor: formatMoneyBR(subscription.valor),
    valorNumerico: parseMoney(subscription.valor),
    dataVencimento: formatIsoDateBR(dueDate),
    diasParaVencimento: Number.isFinite(daysUntilDue) ? daysUntilDue : '',
    diasAtraso: Number.isFinite(daysLate) ? daysLate : '',
    statusAssinatura: subscription.status,
    dataAtual: formatIsoDateBR(currentIsoDate)
  };
}

function getClientSummary(client) {
  return `${client.nome} <${normalizePhoneForApi(client.telefone)}>`;
}

function clonePlainObject(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

function ensureStateShape(rawState) {
  const base = rawState && typeof rawState === 'object' ? rawState : {};
  const templates = {
    ...DEFAULT_TEMPLATES,
    ...(base.templates && typeof base.templates === 'object' ? base.templates : {})
  };
  const subscriptions = base.subscriptions && typeof base.subscriptions === 'object' ? base.subscriptions : {};
  const dailySent = base.dailySent && typeof base.dailySent === 'object' ? base.dailySent : {};
  const meta = base.meta && typeof base.meta === 'object' ? base.meta : {};

  return {
    version: 1,
    templates,
    subscriptions,
    dailySent,
    meta: {
      createdAt: meta.createdAt || new Date().toISOString(),
      updatedAt: meta.updatedAt || new Date().toISOString()
    }
  };
}

function readState() {
  if (!existsSync(CONFIG.stateFile)) {
    return createBlankState();
  }

  const raw = readFileSync(CONFIG.stateFile, 'utf8');

  try {
    return ensureStateShape(JSON.parse(raw));
  } catch (error) {
    throw new Error(`Nao foi possivel ler o arquivo de estado ${CONFIG.stateFile}: ${error.message}`);
  }
}

function atomicWriteJson(filePath, data) {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true });

  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }

  renameSync(tempFile, filePath);
}

function writeState(state) {
  const normalized = ensureStateShape(state);
  normalized.meta.updatedAt = new Date().toISOString();
  atomicWriteJson(CONFIG.stateFile, normalized);
  return normalized;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EPERM') {
      return true;
    }

    return false;
  }
}

function isLockStale(lockFile) {
  if (!existsSync(lockFile)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(lockFile, 'utf8'));
    return !isPidAlive(Number(parsed.pid));
  } catch {
    return true;
  }
}

function acquireLock(lockFile = CONFIG.lockFile) {
  mkdirSync(dirname(lockFile), { recursive: true });

  if (existsSync(lockFile) && isLockStale(lockFile)) {
    rmSync(lockFile, { force: true });
  }

  try {
    writeFileSync(
      lockFile,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString()
        },
        null,
        2
      ),
      { flag: 'wx', encoding: 'utf8' }
    );
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error(
        `Outro processo ja esta usando o arquivo de estado. Aguarde ou remova o lock manualmente: ${lockFile}`
      );
    }

    throw error;
  }
}

function releaseLock(lockFile = CONFIG.lockFile) {
  if (existsSync(lockFile)) {
    rmSync(lockFile, { force: true });
  }
}

function withLock(lockFile, handler) {
  acquireLock(lockFile);

  const finalize = async () => {
    releaseLock(lockFile);
  };

  return Promise.resolve()
    .then(handler)
    .finally(finalize);
}

function getSubscriptionRecord(state, key) {
  if (!state.subscriptions[key] || typeof state.subscriptions[key] !== 'object') {
    state.subscriptions[key] = {
      sentStages: {}
    };
  }

  const record = state.subscriptions[key];

  if (!record.sentStages || typeof record.sentStages !== 'object') {
    record.sentStages = {};
  }

  return record;
}

function peekSubscriptionRecord(state, key) {
  const record = state.subscriptions[key];

  if (!record || typeof record !== 'object') {
    return {
      sentStages: {}
    };
  }

  return {
    ...record,
    sentStages: record.sentStages && typeof record.sentStages === 'object' ? record.sentStages : {}
  };
}

function hasManualResponse(record, key) {
  if (record && record.response && record.response.manual === true) {
    return true;
  }

  return Boolean(key && RUNTIME_REMOTE_MANUAL_RESPONSES[key]);
}

function isStageAlreadySent(record, stage) {
  return Boolean(record && record.sentStages && record.sentStages[stage]);
}

function markStageAsSent(state, key, stage, metadata = {}) {
  const record = getSubscriptionRecord(state, key);

  record.sentStages[stage] = {
    sentAt: new Date().toISOString(),
    ...metadata
  };

  return record;
}

function markManualResponse(state, key, metadata = {}) {
  const record = getSubscriptionRecord(state, key);

  record.response = {
    manual: true,
    respondedAt: record.response?.respondedAt || new Date().toISOString(),
    markedAt: new Date().toISOString(),
    ...metadata
  };

  return record;
}

function getDailySentCount(state, isoDate) {
  return Number(state.dailySent?.[isoDate] || 0);
}

function incrementDailySent(state, isoDate) {
  state.dailySent[isoDate] = getDailySentCount(state, isoDate) + 1;
  return state.dailySent[isoDate];
}

function getTemplateSet(state) {
  return {
    ...DEFAULT_TEMPLATES,
    ...(state.templates || {})
  };
}

function validateClient(client, index) {
  if (!client || typeof client !== 'object') {
    return `Cliente na posicao ${index + 1} esta invalido.`;
  }

  if (!client.nome || !client.telefone) {
    return `Cliente na posicao ${index + 1} precisa ter nome e telefone.`;
  }

  if (!Array.isArray(client.assinaturas)) {
    return `Cliente ${client.nome} precisa ter o campo assinaturas como array.`;
  }

  return null;
}

function isActiveSubscription(subscription) {
  return normalizeText(subscription?.status) === 'ativo';
}

function isClientOptedIn(client) {
  return client && client.optIn === true;
}

function collectCandidates(state, currentIsoDate) {
  const candidates = [];
  const seen = new Set();

  for (let clientIndex = 0; clientIndex < CLIENTS.length; clientIndex += 1) {
    const client = CLIENTS[clientIndex];
    const validationError = validateClient(client, clientIndex);
    if (validationError) {
      console.log(`[ignorado] ${validationError}`);
      continue;
    }

    if (!isClientOptedIn(client)) {
      console.log(`[ignorado] ${getClientSummary(client)} sem opt-in`);
      continue;
    }

    for (let subscriptionIndex = 0; subscriptionIndex < client.assinaturas.length; subscriptionIndex += 1) {
      const subscription = client.assinaturas[subscriptionIndex];

      if (!subscription || typeof subscription !== 'object') {
        console.log(
          `[ignorado] Assinatura invalida em ${getClientSummary(client)} na posicao ${subscriptionIndex + 1}`
        );
        continue;
      }

      if (!isActiveSubscription(subscription)) {
        console.log(
          `[ignorado] ${client.nome} / ${subscription.servico ?? 'servico-sem-nome'} esta inativa`
        );
        continue;
      }

      if (!isIsoDateString(subscription.vencimento)) {
        console.log(
          `[ignorado] ${client.nome} / ${subscription.servico ?? 'servico-sem-nome'} tem vencimento invalido: ${subscription.vencimento}`
        );
        continue;
      }

      const daysUntilDue = diffDaysIso(subscription.vencimento, currentIsoDate);
      const stage = stageFromDateDiff(daysUntilDue);

      if (!stage) {
        continue;
      }

      const key = buildSubscriptionKey(client, subscription);
      const dedupeKey = `${key}::${stage}`;

      if (seen.has(dedupeKey)) {
        console.log(
          `[ignorado] assinatura duplicada no arquivo embutido para ${client.nome} / ${subscription.servico} / ${subscription.vencimento}`
        );
        continue;
      }

      const record = peekSubscriptionRecord(state, key);

      if (stage === 'followup' && hasManualResponse(record, key)) {
        continue;
      }

      if (isStageAlreadySent(record, stage)) {
        continue;
      }

      seen.add(dedupeKey);

      candidates.push({
        key,
        stage,
        client: clonePlainObject(client),
        subscription: clonePlainObject(subscription),
        daysUntilDue,
        currentIsoDate,
        template: getTemplateSet(state)[stage]
      });
    }
  }

  candidates.sort((a, b) => {
    const dueComparison = diffDaysIso(a.subscription.vencimento, b.subscription.vencimento);
    if (dueComparison !== 0) {
      return dueComparison;
    }

    return STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
  });

  return candidates;
}

function findMatchingSubscriptions(telefone, servico, vencimento) {
  const phoneKey = normalizePhoneComparable(telefone);
  const serviceKey = normalizeServiceKey(servico);
  const dueDateKey = String(vencimento);
  const matches = [];

  for (const client of CLIENTS) {
    if (!client || typeof client !== 'object') {
      continue;
    }

    if (normalizePhoneComparable(client.telefone) !== phoneKey) {
      continue;
    }

    const assinaturas = Array.isArray(client.assinaturas) ? client.assinaturas : [];

    for (const subscription of assinaturas) {
      if (!subscription || typeof subscription !== 'object') {
        continue;
      }

      if (normalizeServiceKey(subscription.servico) !== serviceKey) {
        continue;
      }

      if (String(subscription.vencimento) !== dueDateKey) {
        continue;
      }

      matches.push({
        client,
        subscription,
        key: buildSubscriptionKey(client, subscription)
      });
    }
  }

  return matches;
}

function formatCliUsage() {
  return [
    'Uso:',
    '  node scripts/cobranca-whatsapp.js',
    '  node scripts/cobranca-whatsapp.js --testar',
    '  node scripts/cobranca-whatsapp.js --editar',
    '  node scripts/cobranca-whatsapp.js --resposta <telefone> <servico> <YYYY-MM-DD>',
    '',
    'Observacao: o servico pode conter espacos se estiver entre aspas.'
  ].join('\n');
}

function parseCliArguments(argv) {
  const args = argv.slice(2);
  const first = args[0];

  if (!first) {
    return { mode: 'run' };
  }

  if (first === '--testar') {
    if (args.length !== 1) {
      throw new Error('O comando --testar nao aceita argumentos extras.');
    }

    return { mode: 'testar' };
  }

  if (first === '--editar') {
    if (args.length !== 1) {
      throw new Error('O comando --editar nao aceita argumentos extras.');
    }

    return { mode: 'editar' };
  }

  if (first === '--resposta') {
    if (args.length < 4) {
      throw new Error('Uso invalido de --resposta. Informe telefone, servico e vencimento.');
    }

    const telefone = args[1];
    const vencimento = args[args.length - 1];
    const servico = args.slice(2, -1).join(' ').trim();

    if (!telefone || !servico || !vencimento) {
      throw new Error('Uso invalido de --resposta. Informe telefone, servico e vencimento.');
    }

    return {
      mode: 'resposta',
      telefone,
      servico,
      vencimento
    };
  }

  if (first === '--ajuda' || first === '-h' || first === '--help') {
    return { mode: 'help' };
  }

  throw new Error(`Argumento nao reconhecido: ${first}`);
}

async function promptTemplateEdit(rl, stage, currentValue) {
  const stageTitle = getStageTitle(stage);
  console.log('');
  console.log(`Template atual para ${stageTitle}:`);
  console.log('---');
  console.log(currentValue);
  console.log('---');
  console.log('Digite o novo template. Pressione Enter vazio para manter o atual.');
  console.log('Para terminar uma edicao multilinha, digite uma linha com /fim.');

  const firstLine = await rl.question('Primeira linha: ');
  if (!firstLine.trim()) {
    return currentValue;
  }

  if (firstLine.trim() === '/fim') {
    return currentValue;
  }

  const lines = [firstLine];

  while (true) {
    const nextLine = await rl.question('... ');

    if (nextLine.trim() === '/fim') {
      break;
    }

    lines.push(nextLine);
  }

  return lines.join('\n').trimEnd();
}

async function runTemplateEditor() {
  const state = readState();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log('[editar] Os templates serao salvos apenas no arquivo de estado local.');
    console.log(`[editar] Arquivo: ${CONFIG.stateFile}`);

    const templates = getTemplateSet(state);

    for (const stage of STAGE_ORDER) {
      templates[stage] = await promptTemplateEdit(rl, stage, templates[stage]);
    }

    state.templates = templates;
    writeState(state);

    console.log('[ok] Templates atualizados com sucesso.');
  } finally {
    rl.close();
  }
}

function buildManualResponseNotFoundMessage(telefone, servico, vencimento) {
  return `Nao foi encontrada nenhuma assinatura para telefone=${telefone}, servico=${servico}, vencimento=${vencimento}.`;
}

function buildManualResponseAmbiguousMessage(telefone, servico, vencimento, matches) {
  const details = matches
    .map((match) => `${match.client.nome} <${normalizePhoneForApi(match.client.telefone)}> / ${match.subscription.servico} / ${match.subscription.vencimento}`)
    .join(' | ');

  return `A combinacao telefone=${telefone}, servico=${servico}, vencimento=${vencimento} e ambigua. Correspondencias: ${details}`;
}

async function registerManualResponse({ telefone, servico, vencimento }) {
  return withLock(CONFIG.lockFile, async () => {
    const matches = findMatchingSubscriptions(telefone, servico, vencimento);

    if (matches.length === 0) {
      throw new Error(buildManualResponseNotFoundMessage(telefone, servico, vencimento));
    }

    if (matches.length > 1) {
      throw new Error(buildManualResponseAmbiguousMessage(telefone, servico, vencimento, matches));
    }

    const state = readState();
    const match = matches[0];
    const recordBefore = state.subscriptions[match.key];
    markManualResponse(state, match.key, {
      phone: normalizePhoneForApi(telefone),
      service: servico,
      dueDate: vencimento
    });
    writeState(state);

    if (hasManualResponse(recordBefore)) {
      console.log(
        `[ok] Resposta manual ja estava registrada para ${match.client.nome} / ${match.subscription.servico} / ${match.subscription.vencimento}.`
      );
    } else {
      console.log(
        `[ok] Resposta manual registrada para ${match.client.nome} / ${match.subscription.servico} / ${match.subscription.vencimento}. O follow-up de D+2 sera bloqueado.`
      );
    }
  });
}

async function main() {
  let parsed;

  try {
    parsed = parseCliArguments(process.argv);
  } catch (error) {
    console.error(`[erro] ${error.message}`);
    console.log('');
    console.log(formatCliUsage());
    process.exitCode = 1;
    return;
  }

  if (parsed.mode === 'help') {
    console.log(formatCliUsage());
    return;
  }

  if (parsed.mode === 'editar') {
    await withLock(CONFIG.lockFile, async () => {
      await runTemplateEditor();
    });
    return;
  }

  if (parsed.mode === 'resposta') {
    await registerManualResponse(parsed);
    return;
  }

  if (parsed.mode === 'testar') {
    const state = await loadRuntimeState();
    await processCandidates(state, { dryRun: true });
    return;
  }

  if (parsed.mode === 'run') {
    await withLock(CONFIG.lockFile, async () => {
      const state = await loadRuntimeState();
      await processCandidates(state, { dryRun: false });
    });
    return;
  }

  throw new Error(`Modo nao suportado: ${parsed.mode}`);
}

try {
  await main();
} catch (error) {
  console.error(`[erro] ${error.message}`);
  process.exitCode = 1;
}

function enrichCandidate(candidate) {
  const variables = createTemplateVariables(candidate.client, candidate.subscription, candidate.currentIsoDate);
  const message = renderTemplate(candidate.template, variables);

  return {
    ...candidate,
    variables,
    message
  };
}

function buildWuzApiUrl() {
  const base = String(CONFIG.wuzApiBaseUrl ?? '').trim().replace(/\/+$/, '');
  const path = String(CONFIG.wuzApiTextPath ?? '').trim();

  if (!base || /SEU_DOMINIO_OU_HOST_WUZAPI/.test(base)) {
    throw new Error('Configure CONFIG.wuzApiBaseUrl no topo do arquivo para o WuzAPI.');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const normalizedBase = /^https?:\/\//i.test(base) ? base : `http://${base}`;
  return `${normalizedBase}${normalizedPath}`;
}

function getWuzApiToken() {
  const token = String(CONFIG.wuzApiToken ?? '').trim();
  if (!token || /COLOQUE_SEU_TOKEN_AQUI/.test(token)) {
    throw new Error('Configure CONFIG.wuzApiToken no topo do arquivo para o WuzAPI.');
  }

  return token;
}

function getStageTitle(stage) {
  return STAGE_LABELS[stage] || stage;
}

function printCandidatePreview(candidate, { dryRun = true } = {}) {
  const title = getStageTitle(candidate.stage);
  const phone = normalizePhoneForApi(candidate.client.telefone);

  console.log('');
  console.log(`[${dryRun ? 'teste' : 'envio'}] ${title} | ${candidate.client.nome} | ${candidate.subscription.servico}`);
  console.log(`Telefone: ${phone}`);
  console.log(`Vencimento: ${formatIsoDateBR(candidate.subscription.vencimento)}`);
  console.log(`Valor: ${formatMoneyBR(candidate.subscription.valor)}`);
  console.log('Mensagem:');
  console.log(candidate.message);
  console.log('');
}

function buildApiPayload(candidate) {
  return {
    ...clonePlainObject(CONFIG.wuzApiExtraBody),
    [CONFIG.wuzApiPhoneField]: normalizePhoneForApi(candidate.client.telefone),
    [CONFIG.wuzApiMessageField]: candidate.message
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.requestTimeoutMs) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function sendCandidateToWuzApi(candidate) {
  const url = buildWuzApiUrl();
  const token = getWuzApiToken();
  const payload = buildApiPayload(candidate);
  const attempts = Math.max(1, Number(CONFIG.retryAttempts) || 1);
  const headers = {
    'Content-Type': 'application/json',
    [CONFIG.wuzApiTokenHeader || 'Authorization']: token
  };

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        },
        CONFIG.requestTimeoutMs
      );

      const responseText = await response.text();
      let parsedBody = null;

      try {
        parsedBody = responseText ? JSON.parse(responseText) : null;
      } catch {
        parsedBody = responseText;
      }

      if (!response.ok) {
        const error = new Error(
          `HTTP ${response.status} ao enviar para WuzAPI${responseText ? `: ${responseText.slice(0, 300)}` : ''}`
        );
        error.status = response.status;
        error.responseBody = parsedBody;
        throw error;
      }

      return {
        status: response.status,
        body: parsedBody
      };
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === attempts;
      console.error(
        `[erro] tentativa ${attempt}/${attempts} falhou para ${candidate.client.nome} / ${candidate.subscription.servico}: ${error.message}`
      );

      if (isLastAttempt) {
        throw lastError;
      }

      const backoff = Math.max(0, Number(CONFIG.retryBackoffMs) || 0) * attempt;
      if (backoff > 0) {
        await sleep(backoff);
      }
    }
  }

  throw lastError || new Error('Falha desconhecida ao enviar mensagem.');
}

function logRunHeader({ currentIsoDate, dryRun, windowOpen, remainingDaily, totalCandidates }) {
  console.log(
    `[inicio] data=${formatIsoDateBR(currentIsoDate)} | modo=${dryRun ? 'teste' : 'envio'} | janela=${windowOpen ? 'aberta' : 'fechada'} | limite_restante=${remainingDaily} | candidatos=${totalCandidates}`
  );
}

function logSkippedWindow() {
  console.log(
    `[janela] fora do horario configurado (${CONFIG.sendWindowStart} - ${CONFIG.sendWindowEnd}) em ${CONFIG.timezone}. Nenhuma mensagem foi enviada.`
  );
}

function logSkippedDailyLimit(remainingDaily) {
  console.log(`[limite] limite diario atingido. Restante atual: ${remainingDaily}. Nenhuma mensagem foi enviada.`);
}

function logNoCandidates() {
  console.log('[ok] Nenhuma mensagem elegivel para hoje.');
}

async function processCandidates(state, { dryRun = false } = {}) {
  const now = new Date();
  const currentIsoDate = getZonedDateString(now, CONFIG.timezone);
  const windowOpen = isWithinSendWindow(now, CONFIG);
  const totalCandidates = collectCandidates(state, currentIsoDate);
  const dailyCount = getDailySentCount(state, currentIsoDate);
  const remainingDaily = Math.max(0, Number(CONFIG.dailyMaxMessages) - dailyCount);

  logRunHeader({
    currentIsoDate,
    dryRun,
    windowOpen,
    remainingDaily,
    totalCandidates: totalCandidates.length
  });

  if (!CONFIG.automationEnabled && !dryRun) {
    console.log('[config] Automacao desativada no painel administrativo. Nenhum envio sera realizado.');
    return {
      sent: 0,
      candidates: totalCandidates
    };
  }

  if (dryRun) {
    if (!CONFIG.automationEnabled) {
      console.log('[config] Automacao desativada no painel administrativo. Exibindo apenas a simulacao.');
    }
    if (totalCandidates.length === 0) {
      logNoCandidates();
      return {
        sent: 0,
        candidates: []
      };
    }

    for (const candidate of totalCandidates) {
      const enriched = enrichCandidate(candidate);
      printCandidatePreview(enriched, { dryRun: true });
    }

    return {
      sent: 0,
      candidates: totalCandidates
    };
  }

  if (!windowOpen) {
    logSkippedWindow();
    return {
      sent: 0,
      candidates: totalCandidates
    };
  }

  if (remainingDaily <= 0) {
    logSkippedDailyLimit(remainingDaily);
    return {
      sent: 0,
      candidates: totalCandidates
    };
  }

  if (totalCandidates.length === 0) {
    logNoCandidates();
    return {
      sent: 0,
      candidates: []
    };
  }

  buildWuzApiUrl();
  getWuzApiToken();

  let sentCount = 0;
  let remaining = remainingDaily;

  for (let index = 0; index < totalCandidates.length; index += 1) {
    if (remaining <= 0) {
      logSkippedDailyLimit(remaining);
      break;
    }

    const candidate = enrichCandidate(totalCandidates[index]);
    printCandidatePreview(candidate, { dryRun: false });

    const delayMs = randomInt(
      Number(CONFIG.delayBetweenMessagesMs?.[0] || 0),
      Number(CONFIG.delayBetweenMessagesMs?.[1] || 0)
    );

    console.log(
      `[envio] aguardando ${delayMs}ms antes de enviar ${getStageTitle(candidate.stage)} para ${candidate.client.nome}.`
    );
    await sleep(delayMs);

    try {
      const result = await sendCandidateToWuzApi(candidate);
      markStageAsSent(state, candidate.key, candidate.stage, {
        apiStatus: result.status,
        apiBody: result.body,
        messageLength: candidate.message.length
      });
      incrementDailySent(state, currentIsoDate);
      remaining -= 1;
      sentCount += 1;
      writeState(state);
      console.log(
        `[ok] ${getStageTitle(candidate.stage)} enviado para ${candidate.client.nome} (${normalizePhoneForApi(
          candidate.client.telefone
        )})`
      );
    } catch (error) {
      console.error(
        `[falha] nao foi possivel enviar ${getStageTitle(candidate.stage)} para ${candidate.client.nome}: ${error.message}`
      );
    }
  }

  return {
    sent: sentCount,
    candidates: totalCandidates
  };
}
