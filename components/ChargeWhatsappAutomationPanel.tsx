import React, { useEffect, useMemo, useState } from 'react';
import { ClientDBRow } from '../types';
import { getHistorySettings, updateHistorySetting } from '../services/clientService';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Send,
  Users,
  Trash2,
  Zap
} from 'lucide-react';

type ChargeStage = 'reminder' | 'due' | 'followup' | 'reactivation';

type ChargeManualResponse = {
  phone: string;
  service: string;
  dueDate: string;
  respondedAt: string;
  note?: string;
};

type BulkDispatchConfig = {
  enabled: boolean;
  messageTemplate: string;
  delayMinMs: number;
  delayMaxMs: number;
  maxRecipientsPerRun: number;
  requireConsent: boolean;
};

type ChargeConfig = {
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  dailyMaxMessages: number;
  delayMinMs: number;
  delayMaxMs: number;
  requestTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  wuzApiBaseUrl: string;
  wuzApiTextPath: string;
  wuzApiToken: string;
  wuzApiTokenHeader: string;
  wuzApiPhoneField: string;
  wuzApiMessageField: string;
  wuzApiExtraBodyJson: string;
};

type BulkRecipientDraft = {
  raw: string;
  normalized: string;
  display: string;
  valid: boolean;
  error?: string;
};

type BulkDispatchLogEntry = {
  ts: string;
  phone: string;
  displayPhone: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  message: string;
  details?: string;
};

type ChargeDraft = {
  version: number;
  enabled: boolean;
  config: ChargeConfig;
  bulkDispatch: BulkDispatchConfig;
  templates: Record<ChargeStage, string>;
  manualResponses: Record<string, ChargeManualResponse>;
  updatedAt?: string;
};

type ChargePreview = {
  clienteNome: string;
  clienteTelefone?: string;
  servicoNome: string;
  dataVencimento: string;
  valor: string;
  diasParaVencimento: string;
  diasAtraso: string;
  statusAssinatura?: string;
  dataAtual?: string;
};

type AutomationCandidate = {
  key: string;
  stage: ChargeStage;
  client: ClientDBRow;
  service: string;
  expiryDate: string;
  daysUntilDue: number;
  message: string;
};

type ManualForm = {
  phone: string;
  service: string;
  dueDate: string;
  note: string;
};

type ChargePanelProps = {
  clients: ClientDBRow[];
};

const DEFAULT_BULK_DISPATCH: BulkDispatchConfig = {
  enabled: false,
  messageTemplate:
    'Ola! Esta e uma mensagem enviada a partir do painel administrativo. Se quiser responder, estamos por aqui.',
  delayMinMs: 2500,
  delayMaxMs: 6000,
  maxRecipientsPerRun: 100,
  requireConsent: true
};

const SETTINGS_KEY = 'charge_whatsapp_automation_v1';
const STAGE_ORDER: ChargeStage[] = ['reminder', 'due', 'followup', 'reactivation'];

const STAGE_LABELS: Record<ChargeStage, string> = {
  reminder: 'D-5 lembrete amigavel',
  due: 'D0 cobranca gentil',
  followup: 'D+2 follow-up',
  reactivation: 'D+15 oferta de reativacao'
};

const DEFAULT_TEMPLATES: Record<ChargeStage, string> = {
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

const DEFAULT_DRAFT: ChargeDraft = {
  version: 1,
  enabled: true,
  config: {
    timezone: 'America/Sao_Paulo',
    sendWindowStart: '08:00',
    sendWindowEnd: '18:30',
    dailyMaxMessages: 50,
    delayMinMs: 1200,
    delayMaxMs: 3500,
    requestTimeoutMs: 15000,
    retryAttempts: 3,
    retryBackoffMs: 2000,
    wuzApiBaseUrl: 'http://localhost:8080',
    wuzApiTextPath: '/chat/send/text',
    wuzApiToken: 'COLOQUE_SEU_TOKEN_AQUI',
    wuzApiTokenHeader: 'Authorization',
    wuzApiPhoneField: 'Phone',
    wuzApiMessageField: 'Body',
    wuzApiExtraBodyJson: '{}'
  },
  bulkDispatch: { ...DEFAULT_BULK_DISPATCH },
  templates: { ...DEFAULT_TEMPLATES },
  manualResponses: {}
};

const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

const normalizePhone = (value: string) => {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
};

const normalizeService = (value: string) => normalizeText(value).replace(/\s+/g, ' ');

const normalizeWhatsAppPhone = (value: string) => {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';

  if (digits.startsWith('55')) {
    if (digits.length === 12 || digits.length === 13) return digits;
    return '';
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return '';
};

const formatWhatsAppPhone = (value: string) => {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';

  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    if (local.length === 8) return `+55 ${ddd} ${local.slice(0, 4)}-${local.slice(4)}`;
    if (local.length === 9) return `+55 ${ddd} ${local.slice(0, 5)}-${local.slice(5)}`;
    return `+55 ${ddd} ${local}`;
  }

  return `+${digits}`;
};

const parseBulkRecipients = (raw: string): BulkRecipientDraft[] => {
  const chunks = String(raw || '')
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const seen = new Set<string>();

  return chunks.map((chunk) => {
    const normalized = normalizeWhatsAppPhone(chunk);
    if (!normalized) {
      return {
        raw: chunk,
        normalized: '',
        display: chunk,
        valid: false,
        error: 'Use o formato WhatsApp com DDD, por exemplo +55 88 9221-4180.'
      };
    }

    if (seen.has(normalized)) {
      return {
        raw: chunk,
        normalized,
        display: formatWhatsAppPhone(normalized),
        valid: false,
        error: 'Numero duplicado.'
      };
    }

    seen.add(normalized);

    return {
      raw: chunk,
      normalized,
      display: formatWhatsAppPhone(normalized),
      valid: true
    };
  });
};

const buildBulkDispatchVariables = (recipient: BulkRecipientDraft, index: number, total: number) => {
  const now = new Date();
  return {
    telefone: recipient.normalized,
    telefoneFormatado: recipient.display,
    indice: String(index + 1),
    total: String(total),
    dataAtual: now.toLocaleDateString('pt-BR'),
    horaAtual: now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    })
  };
};

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseJsonSafe = <T,>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const parseDateValue = (value?: string | Date) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const trimmed = String(value).trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const local = new Date(year, month, day);
    return Number.isNaN(local.getTime()) ? null : local;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateInput = (value?: string | Date) => {
  const date = parseDateValue(value);
  if (!date) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const formatMoneyBR = (value: string | number) => {
  const numeric = typeof value === 'number' ? value : Number(String(value || '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return String(value || '');
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeric);
};

const formatDateBR = (value?: string) => {
  const date = parseDateValue(value);
  if (!date) return String(value || '');
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
};

const diffDaysIso = (laterIso: string, earlierIso: string) => {
  const later = parseDateValue(laterIso);
  const earlier = parseDateValue(earlierIso);
  if (!later || !earlier) return NaN;

  const laterUtc = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierUtc = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((laterUtc - earlierUtc) / 86400000);
};

const calculateExpiry = (startDate: string, durationMonths: number) => {
  const base = new Date(startDate);
  if (Number.isNaN(base.getTime())) return null;
  const expiry = new Date(base);
  expiry.setDate(expiry.getDate() + Math.max(1, durationMonths) * 30);
  return expiry;
};

const parseSubscriptionStrings = (raw: ClientDBRow['subscriptions']) => {
  const list: string[] = Array.isArray(raw)
    ? raw.map((item) => String(item || ''))
    : typeof raw === 'string'
      ? [raw]
      : [];

  return list
    .map((item) => item.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .map((item) => {
      const parts = item.split('|');
      return {
        service: String(parts[0] || '').trim(),
        startDate: String(parts[1] || '').trim(),
        durationMonths: Math.max(1, parseInt(parts[3] || '1', 10) || 1)
      };
    })
    .filter((item) => item.service.length > 0);
};

const buildManualResponseKey = (phone: string, service: string, dueDate: string) =>
  [normalizePhone(phone), normalizeService(service), dueDate].join('::');

const renderTemplate = (template: string, vars: Record<string, string | number>) =>
  String(template || '').replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });

const createDefaultPreview = (): ChargePreview => {
  const future = new Date();
  future.setDate(future.getDate() + 5);
  return {
    clienteNome: 'Cliente Exemplo',
    servicoNome: 'Plano Mensal',
    dataVencimento: toDateInput(future),
    valor: '99,90',
    diasParaVencimento: '5',
    diasAtraso: '2'
  };
};

const createDefaultManualForm = (): ManualForm => ({
  phone: '',
  service: '',
  dueDate: '',
  note: ''
});

const parseStoredSettings = (raw: string | undefined): ChargeDraft => {
  if (!raw) {
    return {
      ...DEFAULT_DRAFT,
      config: { ...DEFAULT_DRAFT.config },
      bulkDispatch: { ...DEFAULT_BULK_DISPATCH },
      templates: { ...DEFAULT_TEMPLATES },
      manualResponses: {}
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {
        ...DEFAULT_DRAFT,
        config: { ...DEFAULT_DRAFT.config },
        bulkDispatch: { ...DEFAULT_BULK_DISPATCH },
        templates: { ...DEFAULT_TEMPLATES },
        manualResponses: {}
      };
    }

    const config = parsed.config && typeof parsed.config === 'object' ? parsed.config : {};
    const delayRaw = Array.isArray(config.delayBetweenMessagesMs) ? config.delayBetweenMessagesMs : [];
    const extraBody = config.wuzApiExtraBody ?? config.uazApiExtraBody ?? {};
    const bulkDispatch = parsed.bulkDispatch && typeof parsed.bulkDispatch === 'object' ? parsed.bulkDispatch : {};
    const templates = parsed.templates && typeof parsed.templates === 'object' ? parsed.templates : {};
    const manualResponses = parsed.manualResponses && typeof parsed.manualResponses === 'object' ? parsed.manualResponses : {};

    return {
      version: 1,
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_DRAFT.enabled,
      config: {
        timezone: String(config.timezone || DEFAULT_DRAFT.config.timezone),
        sendWindowStart: String(config.sendWindowStart || DEFAULT_DRAFT.config.sendWindowStart),
        sendWindowEnd: String(config.sendWindowEnd || DEFAULT_DRAFT.config.sendWindowEnd),
        dailyMaxMessages: toNumber(config.dailyMaxMessages, DEFAULT_DRAFT.config.dailyMaxMessages),
        delayMinMs: toNumber(delayRaw[0] ?? config.delayMinMs, DEFAULT_DRAFT.config.delayMinMs),
        delayMaxMs: toNumber(delayRaw[1] ?? config.delayMaxMs, DEFAULT_DRAFT.config.delayMaxMs),
        requestTimeoutMs: toNumber(config.requestTimeoutMs, DEFAULT_DRAFT.config.requestTimeoutMs),
        retryAttempts: toNumber(config.retryAttempts, DEFAULT_DRAFT.config.retryAttempts),
        retryBackoffMs: toNumber(config.retryBackoffMs, DEFAULT_DRAFT.config.retryBackoffMs),
        wuzApiBaseUrl: String(config.wuzApiBaseUrl || config.uazApiBaseUrl || DEFAULT_DRAFT.config.wuzApiBaseUrl),
        wuzApiTextPath: String(config.wuzApiTextPath || config.uazApiTextPath || DEFAULT_DRAFT.config.wuzApiTextPath),
        wuzApiToken: String(config.wuzApiToken || config.uazApiToken || DEFAULT_DRAFT.config.wuzApiToken),
        wuzApiTokenHeader: String(
          config.wuzApiTokenHeader || config.uazApiTokenHeader || DEFAULT_DRAFT.config.wuzApiTokenHeader
        ),
        wuzApiPhoneField: String(config.wuzApiPhoneField || config.uazApiPhoneField || DEFAULT_DRAFT.config.wuzApiPhoneField),
        wuzApiMessageField: String(
          config.wuzApiMessageField || config.uazApiMessageField || DEFAULT_DRAFT.config.wuzApiMessageField
        ),
        wuzApiExtraBodyJson: JSON.stringify(extraBody || {}, null, 2)
      },
      bulkDispatch: {
        enabled: typeof bulkDispatch.enabled === 'boolean' ? bulkDispatch.enabled : DEFAULT_BULK_DISPATCH.enabled,
        messageTemplate: String(bulkDispatch.messageTemplate || DEFAULT_BULK_DISPATCH.messageTemplate),
        delayMinMs: toNumber(bulkDispatch.delayMinMs, DEFAULT_BULK_DISPATCH.delayMinMs),
        delayMaxMs: toNumber(bulkDispatch.delayMaxMs, DEFAULT_BULK_DISPATCH.delayMaxMs),
        maxRecipientsPerRun: toNumber(
          bulkDispatch.maxRecipientsPerRun,
          DEFAULT_BULK_DISPATCH.maxRecipientsPerRun
        ),
        requireConsent:
          typeof bulkDispatch.requireConsent === 'boolean'
            ? bulkDispatch.requireConsent
            : DEFAULT_BULK_DISPATCH.requireConsent
      },
      templates: {
        ...DEFAULT_TEMPLATES,
        reminder: String(templates.reminder || DEFAULT_TEMPLATES.reminder),
        due: String(templates.due || DEFAULT_TEMPLATES.due),
        followup: String(templates.followup || DEFAULT_TEMPLATES.followup),
        reactivation: String(templates.reactivation || DEFAULT_TEMPLATES.reactivation)
      },
      manualResponses: Object.entries(manualResponses).reduce<Record<string, ChargeManualResponse>>((acc, [key, value]) => {
        if (!value || typeof value !== 'object') return acc;
        const phone = String((value as any).phone || '').trim();
        const service = String((value as any).service || '').trim();
        const dueDate = String((value as any).dueDate || '').trim();
        const respondedAt = String((value as any).respondedAt || '').trim();
        if (!phone || !service || !dueDate) return acc;
        acc[key] = {
          phone,
          service,
          dueDate,
          respondedAt: respondedAt || new Date().toISOString(),
          note: String((value as any).note || '').trim() || undefined
        };
        return acc;
      }, {})
    };
  } catch {
    return {
      ...DEFAULT_DRAFT,
      config: { ...DEFAULT_DRAFT.config },
      bulkDispatch: { ...DEFAULT_BULK_DISPATCH },
      templates: { ...DEFAULT_TEMPLATES },
      manualResponses: {}
    };
  }
};

const buildStoredSettings = (draft: ChargeDraft) => {
    const extraBodyRaw = String(draft.config.wuzApiExtraBodyJson || '').trim() || '{}';
    const extraBody = parseJsonSafe<Record<string, unknown>>(extraBodyRaw, {});
  const delayMin = Math.max(0, Math.floor(Number(draft.config.delayMinMs) || 0));
  const delayMax = Math.max(0, Math.floor(Number(draft.config.delayMaxMs) || 0));
  const normalizedDelayMin = Math.min(delayMin, delayMax);
  const normalizedDelayMax = Math.max(delayMin, delayMax);
  const bulkDelayMin = Math.max(0, Math.floor(Number(draft.bulkDispatch.delayMinMs) || 0));
  const bulkDelayMax = Math.max(0, Math.floor(Number(draft.bulkDispatch.delayMaxMs) || 0));
  const normalizedBulkDelayMin = Math.min(bulkDelayMin, bulkDelayMax);
  const normalizedBulkDelayMax = Math.max(bulkDelayMin, bulkDelayMax);

  return {
    version: 1,
    enabled: Boolean(draft.enabled),
    config: {
      timezone: draft.config.timezone,
      sendWindowStart: draft.config.sendWindowStart,
      sendWindowEnd: draft.config.sendWindowEnd,
      dailyMaxMessages: Math.max(0, Math.floor(Number(draft.config.dailyMaxMessages) || 0)),
      delayBetweenMessagesMs: [normalizedDelayMin, normalizedDelayMax],
      requestTimeoutMs: Math.max(1000, Math.floor(Number(draft.config.requestTimeoutMs) || 15000)),
      retryAttempts: Math.max(1, Math.floor(Number(draft.config.retryAttempts) || 1)),
      retryBackoffMs: Math.max(0, Math.floor(Number(draft.config.retryBackoffMs) || 0)),
      wuzApiBaseUrl: draft.config.wuzApiBaseUrl.trim(),
      wuzApiTextPath: draft.config.wuzApiTextPath.trim(),
      wuzApiToken: draft.config.wuzApiToken.trim(),
      wuzApiTokenHeader: draft.config.wuzApiTokenHeader.trim(),
      wuzApiPhoneField: draft.config.wuzApiPhoneField.trim(),
      wuzApiMessageField: draft.config.wuzApiMessageField.trim(),
      wuzApiExtraBody: extraBody
    },
    bulkDispatch: {
      enabled: Boolean(draft.bulkDispatch.enabled),
      messageTemplate: draft.bulkDispatch.messageTemplate,
      delayMinMs: normalizedBulkDelayMin,
      delayMaxMs: normalizedBulkDelayMax,
      maxRecipientsPerRun: Math.max(0, Math.floor(Number(draft.bulkDispatch.maxRecipientsPerRun) || 0)),
      requireConsent: Boolean(draft.bulkDispatch.requireConsent)
    },
    templates: {
      reminder: draft.templates.reminder,
      due: draft.templates.due,
      followup: draft.templates.followup,
      reactivation: draft.templates.reactivation
    },
    manualResponses: draft.manualResponses,
    updatedAt: new Date().toISOString()
  };
};

const findManualResponseMatches = (
  clients: ClientDBRow[],
  phone: string,
  service: string,
  dueDate: string
) => {
  const normalizedPhone = normalizePhone(phone);
  const normalizedService = normalizeService(service);
  const normalizedDueDate = dueDate.trim();
  const matches: Array<{ client: ClientDBRow; subscription: { service: string; expiryDate: string } }> = [];

  clients.forEach((client) => {
    if (client.deleted) return;
    if (normalizePhone(String(client.phone_number || '')) !== normalizedPhone) return;

    parseSubscriptionStrings(client.subscriptions).forEach((subscription) => {
      if (normalizeService(subscription.service) !== normalizedService) return;
      const expiry = calculateExpiry(subscription.startDate, subscription.durationMonths);
      const expiryDate = expiry ? toDateInput(expiry) : '';
      if (!expiryDate || expiryDate !== normalizedDueDate) return;
      matches.push({
        client,
        subscription: {
          service: subscription.service,
          expiryDate
        }
      });
    });
  });

  return matches;
};

const buildChargeVariables = (preview: ChargePreview) => ({
  clienteNome: preview.clienteNome,
  clienteTelefone: preview.clienteTelefone || '',
  servicoNome: preview.servicoNome,
  dataVencimento: formatDateBR(preview.dataVencimento),
  valor: formatMoneyBR(preview.valor),
  diasParaVencimento: preview.diasParaVencimento,
  diasAtraso: preview.diasAtraso,
  statusAssinatura: preview.statusAssinatura || '',
  dataAtual: preview.dataAtual ? formatDateBR(preview.dataAtual) : formatDateBR(toDateInput(new Date()))
});

const getChargeStageFromDaysUntilDue = (daysUntilDue: number): ChargeStage | null => {
  if (daysUntilDue === 5) return 'reminder';
  if (daysUntilDue === 0) return 'due';
  if (daysUntilDue === -2) return 'followup';
  if (daysUntilDue === -15) return 'reactivation';
  return null;
};

const buildAutomationCandidates = (
  clients: ClientDBRow[],
  templates: Record<ChargeStage, string>,
  manualResponses: Record<string, ChargeManualResponse>,
  currentIsoDate: string
) => {
  const candidates: AutomationCandidate[] = [];
  const seen = new Set<string>();

  clients.forEach((client) => {
    if (!client || client.deleted) return;

    parseSubscriptionStrings(client.subscriptions).forEach((subscription) => {
      const expiry = calculateExpiry(subscription.startDate, subscription.durationMonths);
      const expiryDate = expiry ? toDateInput(expiry) : '';
      if (!expiryDate) return;

      const daysUntilDue = Number(diffDaysIso(expiryDate, currentIsoDate));
      if (!Number.isFinite(daysUntilDue)) return;

      const stage = getChargeStageFromDaysUntilDue(daysUntilDue);
      if (!stage) return;

      const key = buildManualResponseKey(client.phone_number, subscription.service, expiryDate);
      const dedupeKey = `${key}::${stage}`;
      if (seen.has(dedupeKey)) return;

      if (stage === 'followup' && manualResponses[key]) {
        return;
      }

      seen.add(dedupeKey);

      const preview: ChargePreview = {
        clienteNome: client.client_name || 'Sem nome',
        clienteTelefone: client.phone_number,
        servicoNome: subscription.service,
        dataVencimento: expiryDate,
        valor: 'não informado',
        diasParaVencimento: String(daysUntilDue),
        diasAtraso: String(Math.max(0, -daysUntilDue)),
        statusAssinatura: daysUntilDue < 0 ? 'expirada' : 'ativa',
        dataAtual: currentIsoDate
      };

      candidates.push({
        key: dedupeKey,
        stage,
        client,
        service: subscription.service,
        expiryDate,
        daysUntilDue,
        message: renderTemplate(templates[stage], buildChargeVariables(preview))
      });
    });
  });

  return candidates.sort((a, b) => {
    const dueComparison = diffDaysIso(a.expiryDate, b.expiryDate);
    if (dueComparison !== 0) return dueComparison;
    return STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const randomInt = (min: number, max: number) => {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
};

const isPlaceholderWuzApiBaseUrl = (value: string) =>
  !String(value || '').trim() || /SEU_DOMINIO_OU_HOST_WUZAPI/i.test(String(value || ''));
const isPlaceholderWuzApiToken = (value: string) =>
  !String(value || '').trim() || /COLOQUE_SEU_TOKEN_AQUI/i.test(String(value || ''));

const buildWuzApiEndpoint = (baseUrl: string, textPath: string) => {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const path = String(textPath || '').trim();
  if (!base) {
    throw new Error('Configure a URL base da WuzAPI antes de enviar.');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const normalizedBase = /^https?:\/\//i.test(base) ? base : `http://${base}`;

  return `${normalizedBase}${normalizedPath}`;
};

export const ChargeWhatsappAutomationPanel: React.FC<ChargePanelProps> = ({ clients }) => {
  const [draft, setDraft] = useState<ChargeDraft>(() => ({
    ...DEFAULT_DRAFT,
    config: { ...DEFAULT_DRAFT.config },
    bulkDispatch: { ...DEFAULT_BULK_DISPATCH },
    templates: { ...DEFAULT_TEMPLATES },
    manualResponses: {}
  }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [bulkRecipientsText, setBulkRecipientsText] = useState('');
  const [bulkConsentConfirmed, setBulkConsentConfirmed] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkLogs, setBulkLogs] = useState<BulkDispatchLogEntry[]>([]);
  const [feedback, setFeedback] = useState<{ kind: 'idle' | 'success' | 'error' | 'warn'; message: string }>({
    kind: 'idle',
    message: ''
  });
  const [preview, setPreview] = useState<ChargePreview>(createDefaultPreview);
  const [manualForm, setManualForm] = useState<ManualForm>(createDefaultManualForm);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const settings = await getHistorySettings();
      const raw = settings[SETTINGS_KEY];
      setDraft(parseStoredSettings(raw));
      setFeedback({
        kind: raw ? 'success' : 'warn',
        message: raw
          ? 'Configuracao de cobranca carregada do banco de configuracoes.'
          : 'Nenhuma configuracao salva encontrada. O painel esta usando os padroes.'
      });
    } catch (error: any) {
      setDraft({
        ...DEFAULT_DRAFT,
        config: { ...DEFAULT_DRAFT.config },
        bulkDispatch: { ...DEFAULT_BULK_DISPATCH },
        templates: { ...DEFAULT_TEMPLATES },
        manualResponses: {}
      });
      setFeedback({
        kind: 'error',
        message: `Nao foi possivel carregar a configuracao: ${String(error?.message || error)}`
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const bulkRecipients = useMemo(() => parseBulkRecipients(bulkRecipientsText), [bulkRecipientsText]);
  const bulkValidRecipients = bulkRecipients.filter((recipient) => recipient.valid);
  const bulkInvalidRecipients = bulkRecipients.filter((recipient) => !recipient.valid);
  const bulkPreviewMessage = useMemo(() => {
    if (bulkValidRecipients.length > 0) {
      const sample = bulkValidRecipients[0];
      return renderTemplate(
        draft.bulkDispatch.messageTemplate,
        buildBulkDispatchVariables(sample, 0, bulkValidRecipients.length)
      );
    }

    return renderTemplate(
      draft.bulkDispatch.messageTemplate,
      buildBulkDispatchVariables(
        {
          raw: '+55 88 9221-4180',
          normalized: '558892214180',
          display: '+55 88 9221-4180',
          valid: true
        },
        0,
        1
      )
    );
  }, [bulkValidRecipients, draft.bulkDispatch.messageTemplate]);

  const previewVariables = buildChargeVariables(preview);
  const previewMessages = STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    text: renderTemplate(draft.templates[stage], previewVariables)
  }));

  const currentIsoDate = toDateInput(new Date());
  const automationCandidates = useMemo(
    () => buildAutomationCandidates(clients, draft.templates, draft.manualResponses, currentIsoDate),
    [clients, draft.templates, draft.manualResponses, currentIsoDate]
  );
  const automationSummary = useMemo(
    () =>
      automationCandidates.reduce(
        (acc, candidate) => {
          acc.total += 1;
          acc[candidate.stage] += 1;
          return acc;
        },
        { total: 0, reminder: 0, due: 0, followup: 0, reactivation: 0 }
      ),
    [automationCandidates]
  );

  const manualMatches = findManualResponseMatches(clients, manualForm.phone, manualForm.service, manualForm.dueDate);

  const warnings: string[] = [];
  if (!draft.config.wuzApiBaseUrl.trim() || isPlaceholderWuzApiBaseUrl(draft.config.wuzApiBaseUrl)) {
    warnings.push('Configure a URL da WuzAPI antes de salvar.');
  }
  if (!draft.config.wuzApiToken.trim() || isPlaceholderWuzApiToken(draft.config.wuzApiToken)) {
    warnings.push('Configure o token da WuzAPI antes de enviar.');
  }
  if (draft.config.delayMinMs > draft.config.delayMaxMs) warnings.push('O delay minimo esta maior que o delay maximo.');
  if (!/^\d{2}:\d{2}$/.test(draft.config.sendWindowStart) || !/^\d{2}:\d{2}$/.test(draft.config.sendWindowEnd)) {
    warnings.push('A janela de envio precisa estar no formato HH:MM.');
  }
  if (draft.bulkDispatch.delayMinMs > draft.bulkDispatch.delayMaxMs) {
    warnings.push('O intervalo do disparo em massa esta invertido.');
  }
  if (draft.bulkDispatch.maxRecipientsPerRun < 1) {
    warnings.push('O limite de destinatarios do disparo em massa precisa ser maior que zero.');
  }
  if (!draft.bulkDispatch.messageTemplate.trim()) {
    warnings.push('Configure a mensagem do disparo em massa.');
  }

  const persistSettings = async (nextDraft: ChargeDraft) => {
    setSaving(true);
    setFeedback({ kind: 'idle', message: '' });
    try {
      const payload = buildStoredSettings(nextDraft);
      const success = await updateHistorySetting(SETTINGS_KEY, JSON.stringify(payload));
      if (!success) {
        throw new Error('O banco recusou a atualizacao da configuracao.');
      }

      setDraft(nextDraft);
      setFeedback({
        kind: 'success',
        message: `Configuracao salva com sucesso em ${new Date().toLocaleString()}.`
      });
    } catch (error: any) {
      setFeedback({
        kind: 'error',
        message: `Nao foi possivel salvar: ${String(error?.message || error)}`
      });
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (patch: Partial<ChargeConfig>) => {
    setDraft((current) => ({
      ...current,
      config: {
        ...current.config,
        ...patch
      }
    }));
  };

  const updateTemplate = (stage: ChargeStage, value: string) => {
    setDraft((current) => ({
      ...current,
      templates: {
        ...current.templates,
        [stage]: value
      }
    }));
  };

  const loadAutomationPreview = (candidate: AutomationCandidate) => {
    setPreview({
      clienteNome: candidate.client.client_name || 'Sem nome',
      clienteTelefone: candidate.client.phone_number,
      servicoNome: candidate.service,
      dataVencimento: candidate.expiryDate,
      valor: 'não informado',
      diasParaVencimento: String(candidate.daysUntilDue),
      diasAtraso: String(Math.max(0, -candidate.daysUntilDue)),
      statusAssinatura: candidate.daysUntilDue < 0 ? 'expirada' : 'ativa',
      dataAtual: currentIsoDate
    });
    setFeedback({
      kind: 'success',
      message: `Prévia carregada para ${candidate.client.client_name || 'Sem nome'} / ${candidate.service}.`
    });
  };

  const handleSendBulkDispatch = async () => {
    if (!draft.bulkDispatch.enabled) {
      setFeedback({
        kind: 'warn',
        message: 'Ative o disparo em massa antes de enviar mensagens em lote.'
      });
      return;
    }

    if (draft.bulkDispatch.requireConsent && !bulkConsentConfirmed) {
      setFeedback({
        kind: 'warn',
        message: 'Confirme que estes contatos possuem opt-in antes de enviar.'
      });
      return;
    }

    if (isPlaceholderWuzApiBaseUrl(draft.config.wuzApiBaseUrl)) {
      setFeedback({
        kind: 'warn',
        message: 'Configure a URL da WuzAPI antes de executar o disparo em massa.'
      });
      return;
    }

    if (isPlaceholderWuzApiToken(draft.config.wuzApiToken)) {
      setFeedback({
        kind: 'warn',
        message: 'Configure o token da WuzAPI antes de executar o disparo em massa.'
      });
      return;
    }

    const validRecipients = bulkRecipients.filter((recipient) => recipient.valid);
    const invalidRecipients = bulkRecipients.filter((recipient) => !recipient.valid);
    const maxRecipients = Math.max(1, Math.floor(Number(draft.bulkDispatch.maxRecipientsPerRun) || 0));
    const nowIso = () => new Date().toISOString();
    const logsForSkipped = invalidRecipients.map<BulkDispatchLogEntry>((recipient) => ({
      ts: nowIso(),
      phone: recipient.normalized || recipient.raw,
      displayPhone: recipient.display,
      status: 'skipped',
      message: 'Numero ignorado na lista de disparo em massa.',
      details: recipient.error
    }));

    setBulkLogs(logsForSkipped);

    if (validRecipients.length === 0) {
      setFeedback({
        kind: 'warn',
        message: 'Nenhum numero valido foi encontrado na lista de disparo em massa.'
      });
      return;
    }

    if (validRecipients.length > maxRecipients) {
      setFeedback({
        kind: 'warn',
        message: `A lista possui ${validRecipients.length} numeros validos e o limite atual e ${maxRecipients}. Aumente o limite nas configuracoes ou reduza a lista.`
      });
      return;
    }

    if (!draft.bulkDispatch.messageTemplate.trim()) {
      setFeedback({
        kind: 'warn',
        message: 'Configure a mensagem do disparo em massa antes de enviar.'
      });
      return;
    }

    const confirmed = window.confirm(
      `Enviar a mensagem em massa para ${validRecipients.length} numero(s) valido(s)?\n` +
        `Numeros invalidos/duplicados serao ignorados: ${invalidRecipients.length}.`
    );

    if (!confirmed) {
      return;
    }

    const endpoint = buildWuzApiEndpoint(draft.config.wuzApiBaseUrl, draft.config.wuzApiTextPath);
    const tokenHeader = draft.config.wuzApiTokenHeader.trim() || 'Authorization';
    const token = draft.config.wuzApiToken.trim();
    const phoneField = draft.config.wuzApiPhoneField.trim() || 'Phone';
    const messageField = draft.config.wuzApiMessageField.trim() || 'Body';
    const requestTimeoutMs = Math.max(1000, Math.floor(Number(draft.config.requestTimeoutMs) || 15000));
    const retryAttempts = Math.max(1, Math.floor(Number(draft.config.retryAttempts) || 1));
    const retryBackoffMs = Math.max(0, Math.floor(Number(draft.config.retryBackoffMs) || 0));
    const bulkDelayMin = Math.max(0, Math.floor(Number(draft.bulkDispatch.delayMinMs) || 0));
    const bulkDelayMax = Math.max(0, Math.floor(Number(draft.bulkDispatch.delayMaxMs) || 0));
    const extraBodyRaw = String(draft.config.wuzApiExtraBodyJson || '').trim() || '{}';
    const parsedExtraBody = parseJsonSafe<Record<string, unknown> | null>(extraBodyRaw, null);

    if (!parsedExtraBody || typeof parsedExtraBody !== 'object' || Array.isArray(parsedExtraBody)) {
      setFeedback({
        kind: 'error',
        message: 'O JSON extra da WuzAPI precisa estar valido antes de enviar.'
      });
      return;
    }
    setBulkSending(true);
    setFeedback({ kind: 'idle', message: '' });

    let sentCount = 0;
    let failedCount = 0;

    try {
      for (let index = 0; index < validRecipients.length; index += 1) {
        const recipient = validRecipients[index];

        if (index > 0) {
          const waitMs = randomInt(bulkDelayMin, bulkDelayMax);
          setBulkLogs((current) => [
            ...current,
            {
              ts: nowIso(),
              phone: recipient.normalized,
              displayPhone: recipient.display,
              status: 'queued',
              message: `Aguardando ${waitMs}ms antes do proximo envio.`
            }
          ]);
          await sleep(waitMs);
        }

        const variables = buildBulkDispatchVariables(recipient, index, validRecipients.length);
        const message = renderTemplate(draft.bulkDispatch.messageTemplate, variables);
        const payload = {
          ...parsedExtraBody,
          [phoneField]: recipient.normalized,
          [messageField]: message
        };

        let delivered = false;
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
          const controller = new AbortController();
          const timeoutHandle = window.setTimeout(() => controller.abort(), requestTimeoutMs);

          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                [tokenHeader]: token
              },
              body: JSON.stringify(payload),
              signal: controller.signal
            });

            const responseText = await response.text();
            let responseBody: unknown = null;
            try {
              responseBody = responseText ? JSON.parse(responseText) : null;
            } catch {
              responseBody = responseText;
            }

            if (!response.ok) {
              const error = new Error(
                `HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 180)}` : ''}`
              );
              (error as any).status = response.status;
              (error as any).responseBody = responseBody;
              throw error;
            }

            delivered = true;
            sentCount += 1;
            setBulkLogs((current) => [
              ...current,
              {
                ts: nowIso(),
                phone: recipient.normalized,
                displayPhone: recipient.display,
                status: 'sent',
                message: 'Mensagem enviada com sucesso.',
                details:
                  typeof responseBody === 'string'
                    ? responseBody.slice(0, 180)
                    : responseBody
                      ? JSON.stringify(responseBody).slice(0, 180)
                      : undefined
              }
            ]);
            break;
          } catch (error: any) {
            lastError = error;
            if (attempt < retryAttempts) {
              const backoff = retryBackoffMs * attempt;
              if (backoff > 0) {
                await sleep(backoff);
              }
            }
          } finally {
            window.clearTimeout(timeoutHandle);
          }
        }

        if (!delivered) {
          failedCount += 1;
          setBulkLogs((current) => [
            ...current,
            {
              ts: nowIso(),
              phone: recipient.normalized,
              displayPhone: recipient.display,
              status: 'failed',
              message: `Falha ao enviar apos ${retryAttempts} tentativa(s).`,
              details: String((lastError as any)?.message || lastError || 'Erro desconhecido')
            }
          ]);
        }
      }

      setFeedback({
        kind: 'success',
        message: `Disparo em massa concluido: ${sentCount} enviado(s), ${failedCount} falha(s), ${invalidRecipients.length} ignorado(s).`
      });
    } catch (error: any) {
      setFeedback({
        kind: 'error',
        message: `Nao foi possivel concluir o disparo em massa: ${String(error?.message || error)}`
      });
    } finally {
      setBulkSending(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Restaurar os padroes de cobranca WhatsApp?')) return;
    await persistSettings({
      ...DEFAULT_DRAFT,
      config: { ...DEFAULT_DRAFT.config },
      bulkDispatch: { ...DEFAULT_BULK_DISPATCH },
      templates: { ...DEFAULT_TEMPLATES },
      manualResponses: {}
    });
    setBulkRecipientsText('');
    setBulkConsentConfirmed(false);
    setBulkLogs([]);
  };

  const handleCopy = async () => {
    try {
      const serialized = JSON.stringify(buildStoredSettings(draft), null, 2);
      await navigator.clipboard.writeText(serialized);
      setFeedback({ kind: 'success', message: 'Configuracao copiada para a area de transferencia.' });
    } catch (error: any) {
      setFeedback({
        kind: 'error',
        message: `Nao foi possivel copiar a configuracao: ${String(error?.message || error)}`
      });
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([JSON.stringify(buildStoredSettings(draft), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cobranca-whatsapp-config-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setFeedback({
        kind: 'error',
        message: `Nao foi possivel baixar a configuracao: ${String(error?.message || error)}`
      });
    }
  };

  const handleSaveManualResponse = async () => {
    if (manualMatches.length === 0) {
      setFeedback({
        kind: 'warn',
        message: 'Nenhuma assinatura encontrada com telefone, servico e vencimento informados.'
      });
      return;
    }

    if (manualMatches.length > 1) {
      setFeedback({
        kind: 'warn',
        message: 'A combinacao informada e ambigua. Ajuste telefone, servico ou vencimento.'
      });
      return;
    }

    const key = buildManualResponseKey(manualForm.phone, manualForm.service, manualForm.dueDate);
    const nextDraft: ChargeDraft = {
      ...draft,
      manualResponses: {
        ...draft.manualResponses,
        [key]: {
          phone: manualForm.phone.trim(),
          service: manualForm.service.trim(),
          dueDate: manualForm.dueDate.trim(),
          respondedAt: new Date().toISOString(),
          note: manualForm.note.trim() || undefined
        }
      }
    };

    await persistSettings(nextDraft);
    setManualForm(createDefaultManualForm());
  };

  const handleRemoveManualResponse = async (key: string) => {
    const nextManualResponses = { ...draft.manualResponses };
    delete nextManualResponses[key];
    await persistSettings({
      ...draft,
      manualResponses: nextManualResponses
    });
  };

  const saveAll = async () => {
    await persistSettings(draft);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-32">
      <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-black text-indigo-400 uppercase tracking-widest">Automacao de cobranca</p>
            <h2 className="text-3xl font-black text-gray-900 dark:text-white">Cobrança WhatsApp</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
              Ajuste mensagens, janela de envio, limite diario e respostas manuais sem tocar nos clientes ou no
              historico de envios.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span
              className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase ${
                draft.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
              }`}
            >
              {draft.enabled ? 'Automacao ativa' : 'Automacao pausada'}
            </span>
            <button
              onClick={saveAll}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase shadow-md disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Salvar tudo
            </button>
            <button
              onClick={loadSettings}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 text-indigo-600 text-xs font-black uppercase border border-indigo-100 dark:border-slate-700"
            >
              <RefreshCw size={14} />
              Recarregar
            </button>
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-600 text-xs font-black uppercase border border-red-100"
            >
              <Trash2 size={14} />
              Restaurar padroes
            </button>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black uppercase border border-emerald-100"
            >
              <Copy size={14} />
              Copiar JSON
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 text-xs font-black uppercase border border-gray-200 dark:border-slate-700"
            >
              <Download size={14} />
              Baixar JSON
            </button>
          </div>
        </div>

        {feedback.message && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-medium border ${
              feedback.kind === 'success'
                ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                : feedback.kind === 'error'
                  ? 'bg-red-50 border-red-100 text-red-700'
                  : feedback.kind === 'warn'
                    ? 'bg-amber-50 border-amber-100 text-amber-700'
                    : 'bg-indigo-50 border-indigo-100 text-indigo-700'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-700 font-black uppercase text-[10px] tracking-widest">
              <AlertTriangle size={14} />
              Pontos de atencao
            </div>
            <ul className="space-y-1 text-sm text-amber-800">
              {warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-indigo-50 dark:bg-slate-800 p-4 border border-indigo-100 dark:border-slate-700">
            <p className="text-[10px] font-black text-indigo-400 uppercase">Janela</p>
            <p className="font-black text-indigo-900 dark:text-white mt-1">
              {draft.config.sendWindowStart} - {draft.config.sendWindowEnd}
            </p>
          </div>
          <div className="rounded-2xl bg-indigo-50 dark:bg-slate-800 p-4 border border-indigo-100 dark:border-slate-700">
            <p className="text-[10px] font-black text-indigo-400 uppercase">Limite diario</p>
            <p className="font-black text-indigo-900 dark:text-white mt-1">{draft.config.dailyMaxMessages} mensagens</p>
          </div>
          <div className="rounded-2xl bg-indigo-50 dark:bg-slate-800 p-4 border border-indigo-100 dark:border-slate-700">
            <p className="text-[10px] font-black text-indigo-400 uppercase">Delay aleatorio</p>
            <p className="font-black text-indigo-900 dark:text-white mt-1">
              {draft.config.delayMinMs}ms a {draft.config.delayMaxMs}ms
            </p>
          </div>
          <div className="rounded-2xl bg-indigo-50 dark:bg-slate-800 p-4 border border-indigo-100 dark:border-slate-700">
            <p className="text-[10px] font-black text-indigo-400 uppercase">Respostas manuais</p>
            <p className="font-black text-indigo-900 dark:text-white mt-1">{Object.keys(draft.manualResponses).length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <Settings2 size={22} />
              </div>
              <div>
                <h3 className="text-xl font-black text-gray-900 dark:text-white">Configuracao de execucao</h3>
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
                  Ajustes que o painel salva no banco de configuracoes
                </p>
              </div>
            </div>

            <label className="flex items-center gap-3 p-4 rounded-2xl bg-indigo-50/70 dark:bg-slate-800 border border-indigo-100 dark:border-slate-700">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft((current) => ({ ...current, enabled: e.target.checked }))}
                className="w-5 h-5 accent-indigo-600"
              />
              <div>
                <p className="font-black text-gray-900 dark:text-white">Manter automacao habilitada</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Se desativado, o CLI pode respeitar essa chave para nao disparar envios.
                </p>
              </div>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">URL base da WuzAPI</label>
                <input
                  value={draft.config.wuzApiBaseUrl}
                  onChange={(e) => updateConfig({ wuzApiBaseUrl: e.target.value })}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                  placeholder="http://localhost:8080"
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 ml-1">
                  Se o WuzAPI estiver em Docker no mesmo servidor, a porta exposta normalmente e 8080.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Caminho do texto</label>
                <input
                  value={draft.config.wuzApiTextPath}
                  onChange={(e) => updateConfig({ wuzApiTextPath: e.target.value })}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 ml-1">Padrao do WuzAPI: `/chat/send/text`.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Token da WuzAPI</label>
                <div className="flex gap-2">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={draft.config.wuzApiToken}
                    onChange={(e) => updateConfig({ wuzApiToken: e.target.value })}
                    className="flex-1 bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                    placeholder="Token de autorizacao"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((current) => !current)}
                    className="px-4 rounded-2xl bg-indigo-50 dark:bg-slate-800 border border-indigo-100 dark:border-slate-700 text-indigo-600"
                  >
                    {showToken ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Header de autenticacao</label>
                <input
                  value={draft.config.wuzApiTokenHeader}
                  onChange={(e) => updateConfig({ wuzApiTokenHeader: e.target.value })}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Campo do telefone</label>
                <input
                  value={draft.config.wuzApiPhoneField}
                  onChange={(e) => updateConfig({ wuzApiPhoneField: e.target.value })}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Campo da mensagem</label>
                <input
                  value={draft.config.wuzApiMessageField}
                  onChange={(e) => updateConfig({ wuzApiMessageField: e.target.value })}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Timezone</label>
                <input
                  value={draft.config.timezone}
                  onChange={(e) => updateConfig({ timezone: e.target.value })}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Inicio da janela</label>
                  <input
                    type="time"
                    value={draft.config.sendWindowStart}
                    onChange={(e) => updateConfig({ sendWindowStart: e.target.value })}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Fim da janela</label>
                  <input
                    type="time"
                    value={draft.config.sendWindowEnd}
                    onChange={(e) => updateConfig({ sendWindowEnd: e.target.value })}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Limite diario</label>
                <input
                  type="number"
                  min="0"
                  value={draft.config.dailyMaxMessages}
                  onChange={(e) => updateConfig({ dailyMaxMessages: toNumber(e.target.value, 0) })}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Delay minimo</label>
                  <input
                    type="number"
                    min="0"
                    value={draft.config.delayMinMs}
                    onChange={(e) => updateConfig({ delayMinMs: toNumber(e.target.value, 0) })}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Delay maximo</label>
                  <input
                    type="number"
                    min="0"
                    value={draft.config.delayMaxMs}
                    onChange={(e) => updateConfig({ delayMaxMs: toNumber(e.target.value, 0) })}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Timeout da request</label>
                <input
                  type="number"
                  min="1000"
                  value={draft.config.requestTimeoutMs}
                  onChange={(e) => updateConfig({ requestTimeoutMs: toNumber(e.target.value, 15000) })}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Tentativas</label>
                  <input
                    type="number"
                    min="1"
                    value={draft.config.retryAttempts}
                    onChange={(e) => updateConfig({ retryAttempts: toNumber(e.target.value, 1) })}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Backoff</label>
                  <input
                    type="number"
                    min="0"
                    value={draft.config.retryBackoffMs}
                    onChange={(e) => updateConfig({ retryBackoffMs: toNumber(e.target.value, 0) })}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Campos extras da WuzAPI em JSON</label>
              <textarea
                value={draft.config.wuzApiExtraBodyJson}
                onChange={(e) => updateConfig({ wuzApiExtraBodyJson: e.target.value })}
                rows={5}
                className="w-full bg-slate-950 text-emerald-200 font-mono text-xs rounded-2xl px-4 py-3 border border-slate-800 outline-none focus:border-indigo-400"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <MessageCircle size={22} />
              </div>
              <div>
                <h3 className="text-xl font-black text-gray-900 dark:text-white">Templates editaveis</h3>
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
                  Variaveis disponiveis: {'{{clienteNome}}'}, {'{{servicoNome}}'}, {'{{dataVencimento}}'}, {'{{valor}}'}, {'{{diasParaVencimento}}'}, {'{{diasAtraso}}'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {STAGE_ORDER.map((stage) => (
                <div
                  key={stage}
                  className="rounded-[1.75rem] border border-indigo-100 dark:border-slate-800 bg-indigo-50/40 dark:bg-slate-800/30 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">{STAGE_LABELS[stage]}</p>
                      <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
                        {stage === 'reminder' && 'Mensagem 5 dias antes do vencimento'}
                        {stage === 'due' && 'Mensagem no dia do vencimento'}
                        {stage === 'followup' && 'Mensagem 2 dias depois se nao houver resposta'}
                        {stage === 'reactivation' && 'Mensagem 15 dias depois com oferta especial'}
                      </p>
                    </div>
                  </div>
                  <textarea
                    value={draft.templates[stage]}
                    onChange={(e) => updateTemplate(stage, e.target.value)}
                    rows={5}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-indigo-400"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                <Send size={22} />
              </div>
              <div>
                <h3 className="text-xl font-black text-gray-900 dark:text-white">Disparo em massa</h3>
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
                  Mensagem unica, intervalos configuraveis e confirmacao de opt-in
                </p>
              </div>
            </div>

            <label className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-50/60 dark:bg-slate-800 border border-emerald-100 dark:border-slate-700">
              <input
                type="checkbox"
                checked={draft.bulkDispatch.enabled}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    bulkDispatch: {
                      ...current.bulkDispatch,
                      enabled: e.target.checked
                    }
                  }))
                }
                className="w-5 h-5 accent-emerald-600"
              />
              <div>
                <p className="font-black text-gray-900 dark:text-white">Habilitar disparo em massa</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Quando ativo, o painel permite enviar a mesma mensagem para varios numeros validos.
                </p>
              </div>
            </label>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-emerald-400 ml-1">Mensagem do disparo em massa</label>
              <textarea
                value={draft.bulkDispatch.messageTemplate}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    bulkDispatch: {
                      ...current.bulkDispatch,
                      messageTemplate: e.target.value
                    }
                  }))
                }
                rows={6}
                className="w-full bg-white dark:bg-slate-950 border border-emerald-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-emerald-400"
                placeholder="Ola {{telefoneFormatado}}, esta e uma mensagem configurada para o disparo em massa."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-emerald-400 ml-1">Intervalo minimo</label>
                <input
                  type="number"
                  min="0"
                  value={draft.bulkDispatch.delayMinMs}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      bulkDispatch: {
                        ...current.bulkDispatch,
                        delayMinMs: toNumber(e.target.value, 0)
                      }
                    }))
                  }
                  className="w-full bg-white dark:bg-slate-950 border border-emerald-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-emerald-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-emerald-400 ml-1">Intervalo maximo</label>
                <input
                  type="number"
                  min="0"
                  value={draft.bulkDispatch.delayMaxMs}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      bulkDispatch: {
                        ...current.bulkDispatch,
                        delayMaxMs: toNumber(e.target.value, 0)
                      }
                    }))
                  }
                  className="w-full bg-white dark:bg-slate-950 border border-emerald-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-emerald-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-emerald-400 ml-1">Maximo por envio</label>
                <input
                  type="number"
                  min="1"
                  value={draft.bulkDispatch.maxRecipientsPerRun}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      bulkDispatch: {
                        ...current.bulkDispatch,
                        maxRecipientsPerRun: toNumber(e.target.value, 1)
                      }
                    }))
                  }
                  className="w-full bg-white dark:bg-slate-950 border border-emerald-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus:border-emerald-400"
                />
              </div>
              <label className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-50/60 dark:bg-slate-800 border border-emerald-100 dark:border-slate-700">
                <input
                  type="checkbox"
                  checked={draft.bulkDispatch.requireConsent}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      bulkDispatch: {
                        ...current.bulkDispatch,
                        requireConsent: e.target.checked
                      }
                    }))
                  }
                  className="w-5 h-5 accent-emerald-600"
                />
                <div>
                  <p className="font-black text-gray-900 dark:text-white">Exigir confirmacao de opt-in</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Mantem o disparo em massa restrito a contatos autorizados.
                  </p>
                </div>
              </label>
            </div>

            <div className="rounded-2xl border border-emerald-100 dark:border-slate-700 bg-emerald-50/40 dark:bg-slate-800/30 p-4 space-y-2">
              <p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">Variaveis do disparo</p>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-6">
                {'{{telefone}}'}, {'{{telefoneFormatado}}'}, {'{{indice}}'}, {'{{total}}'}, {'{{dataAtual}}'}, {'{{horaAtual}}'}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                <ShieldCheck size={22} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white">Resumo operacional</h3>
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Controle rapido</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-gray-50 dark:bg-slate-800">
                <span className="text-[10px] font-black uppercase text-gray-400">Status</span>
                <span
                  className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${
                    draft.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                  }`}
                >
                  {draft.enabled ? 'Ligado' : 'Desligado'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-gray-50 dark:bg-slate-800">
                <span className="text-[10px] font-black uppercase text-gray-400">Templates</span>
                <span className="text-sm font-black text-indigo-600">{STAGE_ORDER.length}</span>
              </div>
              <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-gray-50 dark:bg-slate-800">
                <span className="text-[10px] font-black uppercase text-gray-400">Respostas manuais</span>
                <span className="text-sm font-black text-indigo-600">{Object.keys(draft.manualResponses).length}</span>
              </div>
              <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-gray-50 dark:bg-slate-800">
                <span className="text-[10px] font-black uppercase text-gray-400">Ultima atualizacao</span>
                <span className="text-xs font-bold text-gray-500">
                  {draft.updatedAt ? new Date(draft.updatedAt).toLocaleString() : 'Nunca'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border border-emerald-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                <Users size={22} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white">Lista de numeros</h3>
                <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest">
                  Formato aceito: +55 88 9221-4180
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-emerald-400 ml-1">Numeros para envio</label>
              <textarea
                value={bulkRecipientsText}
                onChange={(e) => setBulkRecipientsText(e.target.value)}
                rows={8}
                className="w-full bg-white dark:bg-slate-950 border border-emerald-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-emerald-400"
                placeholder={'+55 88 9221-4180\n+55 88 9333-2211'}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-emerald-50/60 dark:bg-slate-800 p-3 border border-emerald-100 dark:border-slate-700">
                <p className="text-[10px] font-black text-emerald-400 uppercase">Total</p>
                <p className="text-lg font-black text-gray-900 dark:text-white">{bulkRecipients.length}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50/60 dark:bg-slate-800 p-3 border border-emerald-100 dark:border-slate-700">
                <p className="text-[10px] font-black text-emerald-400 uppercase">Validos</p>
                <p className="text-lg font-black text-gray-900 dark:text-white">{bulkValidRecipients.length}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50/60 dark:bg-slate-800 p-3 border border-emerald-100 dark:border-slate-700">
                <p className="text-[10px] font-black text-emerald-400 uppercase">Invalidos</p>
                <p className="text-lg font-black text-gray-900 dark:text-white">{bulkInvalidRecipients.length}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-100 dark:border-slate-700 bg-emerald-50/40 dark:bg-slate-800/40 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase text-emerald-500 tracking-widest">Previa da mensagem</p>
                <span className="text-[10px] font-black uppercase text-gray-400">texto atual</span>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-200 leading-6 whitespace-pre-wrap">{bulkPreviewMessage}</p>
            </div>

            <label className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-50/60 dark:bg-slate-800 border border-emerald-100 dark:border-slate-700">
              <input
                type="checkbox"
                checked={bulkConsentConfirmed}
                onChange={(e) => setBulkConsentConfirmed(e.target.checked)}
                className="w-5 h-5 accent-emerald-600"
              />
              <div>
                <p className="font-black text-gray-900 dark:text-white">Confirmo opt-in para esta lista</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Necessario para liberar o envio da mensagem em massa.
                </p>
              </div>
            </label>

            <button
              onClick={handleSendBulkDispatch}
              disabled={bulkSending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase shadow-md disabled:opacity-60"
            >
              {bulkSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {bulkSending ? 'Enviando...' : 'Disparar em massa'}
            </button>

            <div className="rounded-2xl border border-emerald-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase text-emerald-500 tracking-widest">Lista normalizada</p>
                <span className="text-[10px] font-black uppercase text-gray-400">{bulkRecipients.length} itens</span>
              </div>

              {bulkRecipients.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Cole os numeros aqui para ver a normalizacao antes do envio.
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {bulkRecipients.map((recipient, index) => (
                    <div
                      key={`${recipient.raw}-${index}`}
                      className={`rounded-xl border px-3 py-2 ${
                        recipient.valid
                          ? 'bg-emerald-50/60 border-emerald-100 dark:bg-slate-900 dark:border-slate-700'
                          : 'bg-red-50/60 border-red-100 dark:bg-slate-900 dark:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-black text-gray-900 dark:text-white">{recipient.display}</p>
                          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{recipient.normalized || recipient.raw}</p>
                        </div>
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${
                            recipient.valid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {recipient.valid ? 'valido' : 'invalido'}
                        </span>
                      </div>
                      {recipient.error && <p className="mt-1 text-[11px] font-semibold text-red-600">{recipient.error}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-emerald-100 dark:border-slate-700 bg-emerald-50/40 dark:bg-slate-800/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase text-emerald-500 tracking-widest">Logs da ultima execucao</p>
                <span className="text-[10px] font-black uppercase text-gray-400">{bulkLogs.length}</span>
              </div>

              {bulkLogs.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Os logs do envio aparecem aqui depois que a fila for executada.
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {bulkLogs.map((entry, index) => (
                    <div
                      key={`${entry.ts}-${index}`}
                      className={`rounded-xl border px-3 py-2 ${
                        entry.status === 'sent'
                          ? 'bg-emerald-50 border-emerald-100'
                          : entry.status === 'failed'
                            ? 'bg-red-50 border-red-100'
                            : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-black text-gray-900 dark:text-white">{entry.displayPhone}</p>
                          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{entry.message}</p>
                        </div>
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${
                            entry.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-700'
                              : entry.status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : entry.status === 'skipped'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {entry.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">{new Date(entry.ts).toLocaleString()}</p>
                      {entry.details && <p className="mt-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">{entry.details}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                <Users size={22} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white">Fila automática de cobrança</h3>
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
                  Cliente, serviço e etapa calculados a partir do vencimento
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase bg-emerald-50 text-emerald-700">
                Total {automationSummary.total}
              </span>
              <span className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase bg-indigo-50 text-indigo-700">
                D-5 {automationSummary.reminder}
              </span>
              <span className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase bg-indigo-50 text-indigo-700">
                D0 {automationSummary.due}
              </span>
              <span className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase bg-indigo-50 text-indigo-700">
                D+2 {automationSummary.followup}
              </span>
              <span className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase bg-indigo-50 text-indigo-700">
                D+15 {automationSummary.reactivation}
              </span>
            </div>

            <div className="rounded-2xl border border-dashed border-emerald-200 dark:border-slate-700 bg-emerald-50/30 dark:bg-slate-800/30 p-3">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                A fila mostra exatamente quem receberia a mensagem por serviço. Como a base atual não guarda o valor
                individual da assinatura neste painel, o campo de valor aparece como “não informado” na prévia.
              </p>
            </div>

            {automationCandidates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-indigo-200 dark:border-slate-700 py-10 text-center">
                <p className="text-sm font-bold text-gray-400">Nenhuma cobrança automática elegível hoje.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[34rem] overflow-y-auto pr-1">
                {automationCandidates.slice(0, 12).map((candidate) => {
                  const stageBadge =
                    candidate.daysUntilDue > 0
                      ? `D-${candidate.daysUntilDue}`
                      : candidate.daysUntilDue === 0
                        ? 'D0'
                        : `D+${Math.abs(candidate.daysUntilDue)}`;

                  return (
                    <div
                      key={candidate.key}
                      className="rounded-2xl border border-emerald-100 dark:border-slate-700 p-4 bg-emerald-50/40 dark:bg-slate-800/40 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-black text-gray-900 dark:text-white">
                            {candidate.client.client_name || 'Sem nome'}
                          </p>
                          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                            {formatWhatsAppPhone(candidate.client.phone_number)}
                          </p>
                          <p className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300">
                            Serviço: {candidate.service} · vence em {formatDateBR(candidate.expiryDate)}
                          </p>
                          <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                            Etapa: {STAGE_LABELS[candidate.stage]}
                          </p>
                        </div>

                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <span className="px-2.5 py-1 rounded-full bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-700 text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300">
                            {stageBadge}
                          </span>
                          <button
                            onClick={() => loadAutomationPreview(candidate)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 text-[10px] font-black uppercase"
                          >
                            <Eye size={12} />
                            Carregar na prévia
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl bg-white/80 dark:bg-slate-950/50 border border-dashed border-emerald-100 dark:border-slate-700 p-3">
                        <p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest mb-2">
                          Mensagem preparada
                        </p>
                        <p className="text-sm leading-6 text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                          {candidate.message}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {automationCandidates.length > 12 && (
                  <p className="text-xs font-bold text-gray-400 text-center">
                    Mostrando 12 de {automationCandidates.length} cobranças elegíveis.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <Zap size={22} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white">Previa das mensagens</h3>
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Teste de template</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Cliente</label>
                  <input
                    value={preview.clienteNome}
                    onChange={(e) => setPreview((current) => ({ ...current, clienteNome: e.target.value }))}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Serviço</label>
                  <input
                    value={preview.servicoNome}
                    onChange={(e) => setPreview((current) => ({ ...current, servicoNome: e.target.value }))}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Vencimento</label>
                  <input
                    type="date"
                    value={preview.dataVencimento}
                    onChange={(e) => setPreview((current) => ({ ...current, dataVencimento: e.target.value }))}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Valor</label>
                  <input
                    value={preview.valor}
                    onChange={(e) => setPreview((current) => ({ ...current, valor: e.target.value }))}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Dias para vencer</label>
                  <input
                    type="number"
                    value={preview.diasParaVencimento}
                    onChange={(e) => setPreview((current) => ({ ...current, diasParaVencimento: e.target.value }))}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Dias em atraso</label>
                  <input
                    type="number"
                    value={preview.diasAtraso}
                    onChange={(e) => setPreview((current) => ({ ...current, diasAtraso: e.target.value }))}
                    className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div className="space-y-3">
                {previewMessages.map((item) => (
                  <div
                    key={item.stage}
                    className="rounded-2xl border border-indigo-100 dark:border-slate-700 p-4 bg-indigo-50/50 dark:bg-slate-800/40 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">{item.label}</p>
                      <span className="text-[10px] font-bold text-gray-400">{item.stage}</span>
                    </div>
                    <p className="text-sm leading-6 text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
                <Clock size={22} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white">Resposta manual</h3>
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
                  Bloqueia apenas o follow-up D+2
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Telefone</label>
                <input
                  value={manualForm.phone}
                  onChange={(e) => setManualForm((current) => ({ ...current, phone: e.target.value }))}
                  placeholder="5511999999999"
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Servico</label>
                <input
                  value={manualForm.service}
                  onChange={(e) => setManualForm((current) => ({ ...current, service: e.target.value }))}
                  placeholder="Plano Mensal"
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Vencimento</label>
                <input
                  type="date"
                  value={manualForm.dueDate}
                  onChange={(e) => setManualForm((current) => ({ ...current, dueDate: e.target.value }))}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-indigo-400 ml-1">Observacao</label>
                <textarea
                  value={manualForm.note}
                  onChange={(e) => setManualForm((current) => ({ ...current, note: e.target.value }))}
                  rows={3}
                  className="w-full bg-white dark:bg-slate-950 border border-indigo-100 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-indigo-400"
                />
              </div>

              <button
                onClick={handleSaveManualResponse}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-indigo-600 text-white text-xs font-black uppercase shadow-md"
              >
                <CheckCircle2 size={14} />
                Marcar resposta manual
              </button>
            </div>

            <div className="rounded-2xl border border-indigo-100 dark:border-slate-700 bg-indigo-50/40 dark:bg-slate-800/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">Correspondencias atuais</p>
                <span className="text-[10px] font-black uppercase text-gray-400">{manualMatches.length}</span>
              </div>
              {manualMatches.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma assinatura localizada com esses dados.</p>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {manualMatches.map((match, index) => (
                    <div
                      key={`${match.client.id}-${index}`}
                      className="rounded-xl bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-700 px-3 py-2"
                    >
                      <p className="text-sm font-black text-gray-900 dark:text-white">{match.client.client_name || 'Sem nome'}</p>
                      <p className="text-[11px] font-semibold text-gray-500">{match.client.phone_number}</p>
                      <p className="text-[11px] font-bold text-indigo-600 mt-1">
                        {match.subscription.service} - vence em {formatDateBR(match.subscription.expiryDate)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <Trash2 size={22} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white">Respostas manuais salvas</h3>
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
                  Persistencia no banco de configuracoes
                </p>
              </div>
            </div>

            {Object.keys(draft.manualResponses).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-indigo-200 dark:border-slate-700 py-8 text-center">
                <p className="text-sm font-bold text-gray-400">Nenhuma resposta manual salva.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {Object.entries(draft.manualResponses)
                  .sort(([, a], [, b]) => String(b.respondedAt || '').localeCompare(String(a.respondedAt || '')))
                  .map(([key, item]) => (
                    <div
                      key={key}
                      className="rounded-2xl border border-indigo-100 dark:border-slate-700 p-4 space-y-2 bg-indigo-50/40 dark:bg-slate-800/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-black text-gray-900 dark:text-white">{item.phone}</p>
                          <p className="text-[11px] font-semibold text-gray-500">{item.service}</p>
                          <p className="text-[11px] font-bold text-indigo-600 mt-1">Vencimento: {formatDateBR(item.dueDate)}</p>
                        </div>
                        <button
                          onClick={() => void handleRemoveManualResponse(key)}
                          className="p-2 rounded-xl bg-red-50 text-red-600 border border-red-100"
                          title="Remover resposta manual"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500">
                        <Clock size={12} />
                        <span>{new Date(item.respondedAt).toLocaleString()}</span>
                      </div>
                      {item.note && <p className="text-sm text-gray-700 dark:text-gray-300">{item.note}</p>}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
