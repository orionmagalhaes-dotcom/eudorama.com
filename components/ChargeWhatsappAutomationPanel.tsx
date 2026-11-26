import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ClientDBRow } from '../types';
import { saveClientToDB } from '../services/clientService';
import { getServicePrice } from '../services/pricingConfig';
import {
  MessageCircle,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Power,
  Send,
  Copy,
  ExternalLink,
  Settings,
  Zap,
  ShieldCheck,
  QrCode,
  Calendar,
  ChevronDown,
  ChevronUp,
  Check,
  Smartphone,
  FlaskConical,
  Info,
  Eye,
  EyeOff,
  Heart,
  Gift,
  Bell,
  AlertTriangle
} from 'lucide-react';

export type ChargePanelProps = {
  clients: ClientDBRow[];
  onClientUpdated?: (client: ClientDBRow) => void;
};

type WhatsAppServerStatus = {
  state: 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
  userPhone?: string;
  userName?: string;
  hasQr: boolean;
  lastConnectedAt?: string;
  lastDisconnectReason?: string;
  scheduler?: {
    enabled: boolean;
    enableReminder?: boolean;
    enableDue?: boolean;
    enableFollowup?: boolean;
    enableReactivation?: boolean;
    reactivationDailyLimit?: number;
    reactivationTemplate?: string;
    reactivationTemplate2?: string;
    reactivationTemplate3?: string;
    reactivationStep2Price?: number;
    reactivationStep3Price?: number;
    enableClientPromo?: boolean;
    clientPromoDailyLimit?: number;
    clientPromoTemplate?: string;
    clientPromoDiscountPercent?: number;
    clientPromoPrices?: {
      viki: number;
      iqiyi: number;
      kocowa: number;
      wetv: number;
      youku: number;
      dramabox: number;
    };
    targetHour: number;
    targetMinute: number;
    isRunning: boolean;
    lastCycleAt?: string;
    lastCycleSummary?: {
      total: number;
      sent: number;
      failed: number;
      skipped: number;
    };
  };
};

type ReactivationStep = 1 | 2 | 3 | 'completed' | 'chat_deleted' | 'converted';

type ReactivationQueueItem = {
  clientId: string;
  clientName: string;
  phoneNumber: string;
  deletedAt: string | null;
  sortTimestamp: number;
  message: string;
  alreadySent: boolean;
  sentAt: string | null;
  currentStep?: ReactivationStep;
  step1SentAt?: string | null;
  step2SentAt?: string | null;
  step3SentAt?: string | null;
  chatDeletedAt?: string | null;
  nextEligibleDate?: string | null;
  eligibleNow?: boolean;
};

const DEFAULT_REACTIVATION_TEMPLATE = `Olá, {nome}! Tudo bem? 🌸

Sou o Orion, da *EuDorama* — uma plataforma dedicada a quem ama doramas e conteúdo asiático! 😊

Faz um tempinho que você não está por aqui e sentimos muito a sua falta! Preparamos uma *condição especial* pensando em você para facilitar o seu retorno. 🎁

Você teria interesse em saber mais sobre a nossa promoção? É só me responder aqui e te explico tudo com carinho! Tenha um lindo dia! ✨🍿`;

const DEFAULT_REACTIVATION_TEMPLATE_2 = `Olá, {nome}! Tudo bem? 🌸

Passando para te apresentar a nossa promoção especial de retorno na *EuDorama*! 🎁

Você pode garantir o combo *Viki Pass + Kocowa Plus + WeTV VIP por {valor_etapa2}*! ✨

Essa promoção é válida durante *3 meses* para você aproveitar os 3 apps pagando bem menos. 💜🍿

Tem interesse em ativar? É só me responder aqui! 😊`;

const DEFAULT_REACTIVATION_TEMPLATE_3 = `Olá, {nome}! Tudo bem? 🌸

Como queremos muito te ver maratonando com a gente de novo na *EuDorama*, conseguimos aumentar ainda mais o desconto para você! 🎁✨

O combo *Viki Pass + Kocowa Plus + WeTV VIP* caiu de {valor_etapa2} para apenas *{valor_etapa3}*! 😱💜

A promoção continua válida por *3 meses* nos 3 apps, e você tem um prazo de até *7 dias* para realizar a compra com esse valor especial. ⏳🍿

Se quiser aproveitar antes que o prazo acabe, é só me responder aqui! Tenha um ótimo dia! 😊`;

const CLIENT_PROMO_APPS = [
  { key: 'viki', label: 'Viki Pass', promoPrice: 19.90, matchers: ['viki'] },
  { key: 'iqiyi', label: 'iQIYI', promoPrice: 14.90, matchers: ['iqiyi', 'iqyi'] },
  { key: 'kocowa', label: 'Kocowa', promoPrice: 9.90, matchers: ['kocowa'] },
  { key: 'wetv', label: 'WeTV', promoPrice: 9.90, matchers: ['wetv'] },
  { key: 'youku', label: 'Youku', promoPrice: 9.90, matchers: ['youku'] },
  { key: 'dramabox', label: 'DramaBox', promoPrice: 9.90, matchers: ['dramabox'] }
] as const;

const DEFAULT_CLIENT_PROMO_TEMPLATE = `Olá, {nome}! Tudo bem com você? 🌸

Aqui é o Orion, da *EuDorama*! Passando com muito carinho para agradecer por fazer parte da nossa família dorameira! 💜

Como você já é nossa cliente especial com *{apps_atuais}*, preparamos uma promoção exclusiva nos outros apps que você ainda não tem para deixar a sua maratona ainda mais completa:

{lista_ofertas}
{bloco_combo_50}
✨ Essa promoção é válida por *1 mês* e você só tem *7 dias* a partir de hoje para adquirir! ⏳🍿

Se quiser aproveitar algum deles ou o combo completo, é só me responder por aqui que ativo com todo carinho para você! Tenha um lindo dia! 😊`;

type ClientPromoQueueItem = {
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

type QueueItem = {
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

type LogEntry = {
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

// Regras de cada etapa de cobrança
const STAGE_RULES = [
  {
    id: 'reminder',
    label: 'Lembrete Antecipado',
    range: 'D-5 apenas',
    color: 'blue',
    icon: Bell,
    tone: 'Informativo e gentil',
    allowed: ['Avisar a data de vencimento', 'Informar o valor', 'Oferecer ajuda para dúvidas'],
    blocked: ['❌ Pedir que pague adiantado', '❌ Criar urgência ou pressão', '❌ Mencionar promoções ou ofertas'],
    example: 'Olá! Passando com carinho para lembrar que sua assinatura vence em 5 dias. É só um lembrete para se organizar com calma!'
  },
  {
    id: 'due',
    label: 'Vencimento Hoje',
    range: 'D0',
    color: 'red',
    icon: Clock,
    tone: 'Convite gentil à renovação',
    allowed: ['Convidar a renovar para manter o acesso', 'Informar valor', 'Dizer que pode ignorar se já pagou'],
    blocked: ['❌ Tom de cobrança agressivo', '❌ Ameaçar cancelamento imediato', '❌ Promoções ou descontos'],
    example: 'Olá! Hoje é o dia do vencimento da sua assinatura. Quer renovar para continuar? Se já pagou, pode ignorar este recadinho!'
  },
  {
    id: 'followup',
    label: 'Follow-up Pós-vencimento',
    range: 'D+2 apenas',
    color: 'amber',
    icon: Heart,
    tone: 'Empático e sem pressão',
    allowed: ['Mencionar que o acesso encerrou', 'Perguntar se quer informações para renovar', 'Oferecer ajuda'],
    blocked: ['❌ Dizer "X dias em atraso"', '❌ Cobrar de forma direta', '❌ Promoções ou ofertas especiais'],
    example: 'Olá! Notamos que sua assinatura encerrou. Sabemos que a rotina é corrida! Se quiser renovar, é só me avisar.'
  },
  {
    id: 'reactivation',
    label: 'Campanha de Reativação (3 Etapas)',
    range: 'Ex-clientes · Seg-Sex',
    color: 'purple',
    icon: Gift,
    tone: 'Funil de 3 mensagens com desconto progressivo',
    allowed: [
      'Msg 1: Perguntar interesse na promoção',
      'Msg 2 (1 dia útil): Viki Pass + Kocowa Plus + WeTV VIP por R$ 29,90 (3 meses)',
      'Msg 3 (1 dia útil): Desconto para R$ 24,90 (3 meses nos 3 apps, prazo 7 dias)',
      'Apagar conversa automaticamente 7 dias após Msg 3 se não houver compra'
    ],
    blocked: ['❌ Enviar para quem realizou compra após qualquer mensagem', '❌ Mencionar dívida ou atraso', '❌ Enviar em fins de semana'],
    example: 'Msg 1: Interesse na promoção -> Msg 2: 3 apps por R$ 29,90 (3 meses) -> Msg 3: R$ 24,90 (prazo 7 dias).'
  }
];

const colorMap: Record<string, Record<string, string>> = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    border: 'border-blue-200 dark:border-blue-800/40',
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
    text: 'text-blue-700 dark:text-blue-400',
    icon: 'bg-blue-100 text-blue-600'
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-950/20',
    border: 'border-red-200 dark:border-red-800/40',
    badge: 'bg-red-100 text-red-800 border-red-200',
    text: 'text-red-700 dark:text-red-400',
    icon: 'bg-red-100 text-red-600'
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    border: 'border-amber-200 dark:border-amber-800/40',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
    text: 'text-amber-700 dark:text-amber-400',
    icon: 'bg-amber-100 text-amber-600'
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-950/20',
    border: 'border-purple-200 dark:border-purple-800/40',
    badge: 'bg-purple-100 text-purple-800 border-purple-200',
    text: 'text-purple-700 dark:text-purple-400',
    icon: 'bg-purple-100 text-purple-600'
  }
};

export const ChargeWhatsappAutomationPanel: React.FC<ChargePanelProps> = ({ clients, onClientUpdated }) => {
  const [activeTab, setActiveTab] = useState<'queue' | 'promotional' | 'connection' | 'rules' | 'test' | 'logs' | 'config'>('queue');
  const [stageFilter, setStageFilter] = useState<'all' | 'due' | 'reminder' | 'followup'>('all');
  const [onlyPending, setOnlyPending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Status do servidor WhatsApp
  const [serverStatus, setServerStatus] = useState<WhatsAppServerStatus>({
    state: 'disconnected',
    hasQr: false
  });
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [expandedPreviewId, setExpandedPreviewId] = useState<string | null>(null);
  const [isCycleRunning, setIsCycleRunning] = useState(false);

  // Teste de envio
  const [testPhone, setTestPhone] = useState('');
  const [testStage, setTestStage] = useState<'reminder' | 'due' | 'followup' | 'reactivation'>('due');
  const [testClientName, setTestClientName] = useState('Dorameira');
  const [testService, setTestService] = useState('Viki');
  const [testPrice, setTestPrice] = useState('R$ 24,90');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testPreview, setTestPreview] = useState(false);

  // Estado da campanha de reativação / promocionais
  const [reactivationStatus, setReactivationStatus] = useState<{ sentToday: number; dailyLimit?: number; lastRunAt?: string } | null>(null);
  const [reactivationLoading, setReactivationLoading] = useState(false);
  const [reactivationResult, setReactivationResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [reactivationQueue, setReactivationQueue] = useState<ReactivationQueueItem[]>([]);
  const [reactivationQueueLoading, setReactivationQueueLoading] = useState(false);
  const [reactivationFilter, setReactivationFilter] = useState<'pending' | 'sent' | 'all'>('pending');
  const [reactivationSearch, setReactivationSearch] = useState('');
  const [reactivationTemplateDraft, setReactivationTemplateDraft] = useState(DEFAULT_REACTIVATION_TEMPLATE);
  const [reactivationTemplate2Draft, setReactivationTemplate2Draft] = useState(DEFAULT_REACTIVATION_TEMPLATE_2);
  const [reactivationTemplate3Draft, setReactivationTemplate3Draft] = useState(DEFAULT_REACTIVATION_TEMPLATE_3);
  const [activePromoTemplateStep, setActivePromoTemplateStep] = useState<1 | 2 | 3>(1);
  const [reactivationTemplateDirty, setReactivationTemplateDirty] = useState(false);
  const [reactivationDailyLimitDraft, setReactivationDailyLimitDraft] = useState<number>(2);
  const [reactivationExpandedId, setReactivationExpandedId] = useState<string | null>(null);
  const [sendingReactivationId, setSendingReactivationId] = useState<string | null>(null);

  // Sub-aba promocional e estado da campanha para clientes ativos ("promo cliente")
  const [promoSubTab, setPromoSubTab] = useState<'reactivation' | 'client_promo'>('reactivation');
  const [clientPromoStatus, setClientPromoStatus] = useState<{ sentToday: number; dailyLimit?: number; lastRunAt?: string } | null>(null);
  const [clientPromoLoading, setClientPromoLoading] = useState(false);
  const [clientPromoQueue, setClientPromoQueue] = useState<ClientPromoQueueItem[]>([]);
  const [clientPromoQueueLoading, setClientPromoQueueLoading] = useState(false);
  const [clientPromoFilter, setClientPromoFilter] = useState<'pending' | 'sent' | 'all'>('pending');
  const [clientPromoSearch, setClientPromoSearch] = useState('');
  const [clientPromoTemplateDraft, setClientPromoTemplateDraft] = useState(DEFAULT_CLIENT_PROMO_TEMPLATE);
  const [clientPromoTemplateDirty, setClientPromoTemplateDirty] = useState(false);
  const [clientPromoDailyLimitDraft, setClientPromoDailyLimitDraft] = useState<number>(2);
  const [clientPromoExpandedId, setClientPromoExpandedId] = useState<string | null>(null);
  const [sendingClientPromoId, setSendingClientPromoId] = useState<string | null>(null);
  const [reactivationStep2PriceDraft, setReactivationStep2PriceDraft] = useState<number>(29.9);
  const [reactivationStep3PriceDraft, setReactivationStep3PriceDraft] = useState<number>(24.9);
  const [clientPromoDiscountDraft, setClientPromoDiscountDraft] = useState<number>(30);
  const [clientPromoPricesDraft, setClientPromoPricesDraft] = useState({
    viki: 19.9,
    iqiyi: 14.9,
    kocowa: 9.9,
    wetv: 9.9,
    youku: 9.9,
    dramabox: 9.9
  });
  const [promoValuesDirty, setPromoValuesDirty] = useState(false);

  // Configuração de URL do motor
  const [motorBaseUrl, setMotorBaseUrl] = useState<string>(() => {
    return localStorage.getItem('whatsapp_motor_base_url') || '';
  });

  const getApiUrl = useCallback(
    (endpoint: string) => {
      const base = motorBaseUrl.trim().replace(/\/+$/, '');
      if (base) return `${base}${endpoint}`;
      return endpoint;
    },
    [motorBaseUrl]
  );

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/status'));
      if (res.ok) {
        const data = await res.json();
        setServerStatus(data);
        setServerOnline(true);
        setIsCycleRunning(!!data.scheduler?.isRunning);
        if (data.scheduler?.reactivationTemplate && !reactivationTemplateDirty) {
          setReactivationTemplateDraft(data.scheduler.reactivationTemplate);
        }
        if (data.scheduler?.reactivationTemplate2 && !reactivationTemplateDirty) {
          setReactivationTemplate2Draft(data.scheduler.reactivationTemplate2);
        }
        if (data.scheduler?.reactivationTemplate3 && !reactivationTemplateDirty) {
          setReactivationTemplate3Draft(data.scheduler.reactivationTemplate3);
        }
        if (typeof data.scheduler?.reactivationDailyLimit === 'number') {
          setReactivationDailyLimitDraft(data.scheduler.reactivationDailyLimit);
        }
        if (data.scheduler?.clientPromoTemplate && !clientPromoTemplateDirty) {
          setClientPromoTemplateDraft(data.scheduler.clientPromoTemplate);
        }
        if (typeof data.scheduler?.clientPromoDailyLimit === 'number') {
          setClientPromoDailyLimitDraft(data.scheduler.clientPromoDailyLimit);
        }
        if (!promoValuesDirty) {
          if (typeof data.scheduler?.reactivationStep2Price === 'number') {
            setReactivationStep2PriceDraft(data.scheduler.reactivationStep2Price);
          }
          if (typeof data.scheduler?.reactivationStep3Price === 'number') {
            setReactivationStep3PriceDraft(data.scheduler.reactivationStep3Price);
          }
          if (typeof data.scheduler?.clientPromoDiscountPercent === 'number') {
            setClientPromoDiscountDraft(data.scheduler.clientPromoDiscountPercent);
          }
          if (data.scheduler?.clientPromoPrices) {
            setClientPromoPricesDraft((prev) => ({ ...prev, ...data.scheduler.clientPromoPrices }));
          }
        }
      } else {
        setServerOnline(false);
      }
    } catch {
      setServerOnline(false);
    }
  }, [getApiUrl, reactivationTemplateDirty, clientPromoTemplateDirty, promoValuesDirty]);

  const fetchClientPromoStatus = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/client-promo-status'));
      if (res.ok) {
        const data = await res.json();
        if (data.status) setClientPromoStatus(data.status);
      }
    } catch {}
  }, [getApiUrl]);

  const generateLocalClientPromoQueue = useCallback(() => {
    const formatBrl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const items: ClientPromoQueueItem[] = [];
    clients.forEach((c) => {
      if (c.deleted || !c.phone_number) return;
      const subs = Array.isArray(c.subscriptions)
        ? c.subscriptions.filter((s) => String(s || '').trim().length > 0)
        : [];
      if (subs.length === 0) return;

      const ownedKeys = new Set<string>();
      const ownedLabels: string[] = [];
      subs.forEach((sub) => {
        const sName = String(sub.split('|')[0] || '').trim().toLowerCase();
        CLIENT_PROMO_APPS.forEach((app) => {
          if (app.matchers.some((m) => sName.includes(m)) && !ownedKeys.has(app.key)) {
            ownedKeys.add(app.key);
            ownedLabels.push(app.label);
          }
        });
      });

      const missingApps = CLIENT_PROMO_APPS
        .filter((app) => !ownedKeys.has(app.key))
        .map((app) => ({
          key: app.key,
          label: app.label,
          promoPrice: Number((clientPromoPricesDraft[app.key] ?? app.promoPrice).toFixed(2)),
          originalPrice: getServicePrice(app.label, 1)
        }));
      if (missingApps.length === 0) return;

      const originalTotal = missingApps.reduce((acc, a) => acc + a.originalPrice, 0);
      const discountPct = Math.min(95, Math.max(1, Math.round(clientPromoDiscountDraft || 30)));
      const combo50Price = Number((originalTotal * (1 - discountPct / 100)).toFixed(2));
      const progress = c.game_progress || {};
      const sentAt: string | null = progress._client_promo_sent_at || null;
      const chatDeletedAt: string | null = progress._client_promo_chat_deleted_at || null;
      const purchasedAt: string | null = progress._client_promo_purchased_at || null;

      let earliestTs = c.created_at ? new Date(c.created_at).getTime() : Number.MAX_SAFE_INTEGER;
      subs.forEach((sub) => {
        const startStr = String(sub.split('|')[1] || '').trim();
        if (startStr) {
          const t = new Date(startStr).getTime();
          if (Number.isFinite(t) && t < earliestTs) earliestTs = t;
        }
      });

      const rawName = String(c.client_name || '').trim();
      const displayName = rawName && rawName.toLowerCase() !== 'null' && rawName.toLowerCase() !== 'sem nome' ? rawName : 'Dorameira';
      const listaOfertas = missingApps.map((a) => `• *${a.label}*: ${formatBrl(a.promoPrice)}/mês`).join('\n');
      const blocoCombo50 =
        missingApps.length >= 2
          ? `\n🎁 *E se quiser levar TODOS os ${missingApps.length} apps que faltam:* você ganha *${discountPct}% de desconto* sobre o valor original — de ${formatBrl(originalTotal)} por apenas *${formatBrl(combo50Price)}*!\n`
          : `\n🎁 *Ou com ${discountPct}% de desconto do valor original:* de ${formatBrl(originalTotal)} por apenas *${formatBrl(combo50Price)}*!\n`;
      const msg = (clientPromoTemplateDraft || DEFAULT_CLIENT_PROMO_TEMPLATE)
        .trim()
        .replace(/\{nome\}/gi, displayName)
        .replace(/\{apps_atuais\}/gi, ownedLabels.join(', ') || 'seus apps')
        .replace(/\{lista_ofertas\}/gi, listaOfertas)
        .replace(/\{valor_original_combo\}/gi, formatBrl(originalTotal))
        .replace(/\{valor_combo_50\}/gi, formatBrl(combo50Price))
        .replace(/\{valor_combo\}/gi, formatBrl(combo50Price))
        .replace(/\{porcentagem_desconto\}/gi, `${discountPct}%`)
        .replace(/\{bloco_combo_50\}/gi, blocoCombo50)
        .replace(/\{bloco_combo\}/gi, blocoCombo50);

      items.push({
        clientId: c.id,
        clientName: displayName,
        phoneNumber: c.phone_number,
        createdAt: c.created_at || null,
        sortTimestamp: Number.isFinite(earliestTs) ? earliestTs : 0,
        ownedApps: ownedLabels,
        missingApps,
        originalTotal,
        combo50Price,
        message: msg,
        alreadySent: Boolean(sentAt),
        sentAt,
        purchasedAt,
        chatDeletedAt,
        deleteEligibleDate: null
      });
    });
    setClientPromoQueue(items.sort((a, b) => a.sortTimestamp - b.sortTimestamp));
  }, [clients, clientPromoTemplateDraft, clientPromoPricesDraft, clientPromoDiscountDraft]);

  const fetchClientPromoQueue = useCallback(async () => {
    setClientPromoQueueLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/client-promo-queue'));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.queue)) {
          setClientPromoQueue(data.queue);
          return;
        }
      }
      generateLocalClientPromoQueue();
    } catch {
      generateLocalClientPromoQueue();
    } finally {
      setClientPromoQueueLoading(false);
    }
  }, [getApiUrl, generateLocalClientPromoQueue]);

  const fetchReactivationStatus = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/reactivation-status'));
      if (res.ok) {
        const data = await res.json();
        if (data.status) setReactivationStatus(data.status);
      }
    } catch {}
  }, [getApiUrl]);

  const generateLocalReactivationQueue = useCallback(() => {
    const activePhones = new Set<string>();
    clients.forEach((c) => {
      const subs = Array.isArray(c.subscriptions)
        ? c.subscriptions.filter((s) => String(s || '').trim().length > 0)
        : [];
      if (!c.deleted || subs.length > 0) {
        const digits = String(c.phone_number || '').replace(/\D/g, '');
        if (digits.length >= 10) activePhones.add(digits.slice(-10));
      }
    });

    const items: ReactivationQueueItem[] = [];
    clients.forEach((c) => {
      if (!c.deleted || !c.phone_number) return;
      const subs = Array.isArray(c.subscriptions)
        ? c.subscriptions.filter((s) => String(s || '').trim().length > 0)
        : [];
      if (subs.length > 0) return;
      const digits = String(c.phone_number || '').replace(/\D/g, '');
      if (digits.length >= 10 && activePhones.has(digits.slice(-10))) return;

      const progress = c.game_progress || {};
      const deletedAt: string | null = progress._deleted_at || c.last_active_at || c.created_at || null;
      const ts = deletedAt ? new Date(deletedAt).getTime() : 0;
      const step1SentAt: string | null = progress._reactivation_campaign_sent_at || null;
      const step2SentAt: string | null = progress._reactivation_step2_sent_at || null;
      const step3SentAt: string | null = progress._reactivation_step3_sent_at || null;
      const chatDeletedAt: string | null = progress._reactivation_chat_deleted_at || null;

      let currentStep: ReactivationStep = 1;
      let tpl = reactivationTemplateDraft || DEFAULT_REACTIVATION_TEMPLATE;
      if (chatDeletedAt) {
        currentStep = 'chat_deleted';
        tpl = reactivationTemplate3Draft || DEFAULT_REACTIVATION_TEMPLATE_3;
      } else if (step3SentAt) {
        currentStep = 'completed';
        tpl = reactivationTemplate3Draft || DEFAULT_REACTIVATION_TEMPLATE_3;
      } else if (step2SentAt) {
        currentStep = 3;
        tpl = reactivationTemplate3Draft || DEFAULT_REACTIVATION_TEMPLATE_3;
      } else if (step1SentAt) {
        currentStep = 2;
        tpl = reactivationTemplate2Draft || DEFAULT_REACTIVATION_TEMPLATE_2;
      }

      const rawName = String(c.client_name || '').trim();
      const displayName = rawName && rawName.toLowerCase() !== 'null' && rawName.toLowerCase() !== 'sem nome' ? rawName : 'Dorameira';
      const v2Fmt = reactivationStep2PriceDraft.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const v3Fmt = reactivationStep3PriceDraft.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const msg = tpl
        .trim()
        .replace(/\{nome\}/gi, displayName)
        .replace(/\{valor_etapa2\}/gi, v2Fmt)
        .replace(/\{valor_etapa3\}/gi, v3Fmt)
        .replace(/\{valor\}/gi, currentStep === 3 ? v3Fmt : v2Fmt);
      items.push({
        clientId: c.id,
        clientName: displayName,
        phoneNumber: c.phone_number,
        deletedAt,
        sortTimestamp: Number.isFinite(ts) ? ts : 0,
        message: msg,
        alreadySent: currentStep === 'completed' || currentStep === 'chat_deleted',
        sentAt: step1SentAt,
        currentStep,
        step1SentAt,
        step2SentAt,
        step3SentAt,
        chatDeletedAt
      });
    });
    setReactivationQueue(items.sort((a, b) => a.sortTimestamp - b.sortTimestamp));
  }, [clients, reactivationTemplateDraft, reactivationTemplate2Draft, reactivationTemplate3Draft, reactivationStep2PriceDraft, reactivationStep3PriceDraft]);

  const fetchReactivationQueue = useCallback(async () => {
    setReactivationQueueLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/reactivation-queue'));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.queue)) {
          setReactivationQueue(data.queue);
          return;
        }
      }
      generateLocalReactivationQueue();
    } catch {
      generateLocalReactivationQueue();
    } finally {
      setReactivationQueueLoading(false);
    }
  }, [getApiUrl, generateLocalReactivationQueue]);

  const fetchQrCode = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/qr'));
      if (res.ok) {
        const data = await res.json();
        if (data.qrCodeDataUrl) setQrCodeDataUrl(data.qrCodeDataUrl);
      }
    } catch {}
  }, [getApiUrl]);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/queue'));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.queue)) setQueue(data.queue);
      }
    } catch {
      generateLocalQueue();
    } finally {
      setLoading(false);
    }
  }, [getApiUrl, clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/logs'));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) setLogs(data.logs);
      }
    } catch {}
  }, [getApiUrl]);

  const generateLocalQueue = () => {
    const list: QueueItem[] = [];
    const now = new Date();

    const normalizeSubs = (subs: any): string[] => {
      if (Array.isArray(subs)) return subs;
      if (typeof subs === 'string') {
        const cleaned = subs.replace(/^\{|\}$/g, '');
        if (!cleaned) return [];
        if (cleaned.includes(';')) return cleaned.split(';');
        if (cleaned.includes(',')) return cleaned.split(',');
        return [cleaned];
      }
      return [];
    };

    clients.forEach((client) => {
      if (client.deleted || !client.phone_number) return;
      const subs = normalizeSubs(client.subscriptions);
      const progress = client.game_progress || {};
      const entries = progress._charge_whatsapp_entries || {};

      subs.forEach((sub) => {
        const parts = sub.split('|');
        const service = String(parts[0] || '').trim();
        const startStr = String(parts[1] || '').trim();
        const duration = parseInt(parts[3] || String(client.duration_months || 1)) || 1;
        if (!service || !startStr) return;

        const d = new Date(startStr);
        if (isNaN(d.getTime())) return;
        const expiry = new Date(d);
        expiry.setMonth(expiry.getMonth() + duration);

        const days = Math.round(
          (new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate()).getTime() -
            new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
            (1000 * 60 * 60 * 24)
        );

        let stage: 'reminder' | 'due' | 'followup' | 'reactivation' | null = null;
        let stageLabel = '';

        if (days === 5) {
          stage = 'reminder';
          stageLabel = 'Vence em 5 dias (D-5)';
        } else if (days === 0) {
          stage = 'due';
          stageLabel = 'Vence Hoje (D0)';
        } else if (days === -2) {
          stage = 'followup';
          stageLabel = 'Vencido há 2 dias (D+2)';
        }

        if (!stage) return;

        const price = getServicePrice(service, duration);
        const priceFormatted =
          price > 0 ? price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Valor Regular';
        const sKey = service.toLowerCase().replace(/[^a-z0-9]/g, '');
        const lastEntry = entries[sKey];
        const lastChargedAt = lastEntry?.chargedAt || progress._charge_whatsapp_last_at || null;

        let alreadySent = false;
        if (lastChargedAt) {
          const cDate = new Date(lastChargedAt);
          if (cDate.toDateString() === now.toDateString()) alreadySent = true;
        }

        const name = client.client_name || 'Dorameira';
        const dataFmt = expiry.toLocaleDateString('pt-BR');

        let message = '';
        if (stage === 'reminder') {
          if (days === 1) {
            message = `Olá, ${name}! Tudo bem com você? ✨ Passando com carinho para lembrar que a sua assinatura do *${service}* vence amanhã, dia ${dataFmt}. É apenas um lembrete para você poder se programar com calma! Se precisar de qualquer informação ou tiver alguma dúvida, estamos à disposição por aqui. Tenha um ótimo dia e bons doramas! 🌸✨`;
          } else {
            message = `Olá, ${name}! Tudo bem com você? ✨ Passando apenas para te avisar com carinho que a sua assinatura do *${service}* vence no dia ${dataFmt} (daqui a ${days} dias). O valor da assinatura é de *${priceFormatted}*. É apenas um lembrete para você poder se organizar com calma! Se tiver qualquer dúvida ou precisar de algo, estamos sempre à disposição por aqui. Tenha um ótimo dia e aproveite seus doramas! 🌸🍿`;
          }
        } else if (stage === 'due') {
          message = `Olá, ${name}! Tudo bem? Esperamos que sim! 🌸 Passando para lembrar que hoje (*${dataFmt}*) é o dia do vencimento da sua assinatura do *${service}* no valor de *${priceFormatted}*. Quer renovar hoje para manter seu acesso ativo e não perder seus episódios favoritos? Se já realizou o pagamento, por favor desconsidere este recadinho. Qualquer dúvida, estou por aqui para te ajudar! 🍿✨`;
        } else if (stage === 'followup') {
          const diasVenc = Math.abs(days);
          const txtDias = diasVenc === 1 ? 'ontem' : `há ${diasVenc} dias`;
          message = `Olá, ${name}! Tudo bem? Notamos que o acesso à sua assinatura do *${service}* encerrou (${txtDias}, dia ${dataFmt}). Sabemos bem como a rotina do dia a dia é corrida! Caso queira continuar acompanhando seus doramas favoritos sem interrupções, me avise por aqui que te envio os dados para renovação. Se tiver acontecido algum imprevisto ou se precisar de alguma ajuda, estou super à disposição! 💜`;
        } else {
          message = `Olá, ${name}! Tudo bem? Sentimos muito a sua falta aqui na EuDorama! 🥰 Notamos que já faz um tempinho que sua assinatura do *${service}* encerrou. Preparamos uma condição super especial para você voltar a maratonar seus doramas preferidos por apenas *${priceFormatted}*! O que acha? Se quiser aproveitar ou se tiver qualquer dúvida, é só me responder aqui. Tenha um lindo dia! ✨🍿`;
        }

        list.push({
          id: `${client.id}::${sKey}::${stage}`,
          clientId: client.id,
          clientName: name,
          phoneNumber: client.phone_number,
          service,
          stage,
          stageLabel,
          daysRemaining: days,
          expiryDateStr: dataFmt,
          price,
          priceFormatted,
          message,
          alreadySentToday: alreadySent,
          lastChargedAt
        });
      });
    });

    const stageWeights = { due: 1, followup: 2, reminder: 3, reactivation: 4 };
    setQueue(
      list.sort((a, b) => {
        if (a.alreadySentToday !== b.alreadySentToday) return a.alreadySentToday ? 1 : -1;
        return (stageWeights[a.stage] || 99) - (stageWeights[b.stage] || 99);
      })
    );
  };

  useEffect(() => {
    void fetchStatus();
    void fetchQueue();
    void fetchLogs();
    void fetchReactivationStatus();
    void fetchReactivationQueue();
    void fetchClientPromoStatus();
    void fetchClientPromoQueue();

    const interval = setInterval(() => {
      void fetchStatus();
      void fetchReactivationStatus();
      void fetchClientPromoStatus();
      if (serverStatus.state === 'connecting' || serverStatus.state === 'qr_ready') {
        void fetchQrCode();
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchQueue, fetchLogs, serverStatus.state, fetchQrCode, fetchReactivationStatus, fetchReactivationQueue, fetchClientPromoStatus, fetchClientPromoQueue]);

  const handleConnect = async () => {
    try {
      await fetch(getApiUrl('/api/whatsapp/connect'), { method: 'POST' });
      await fetchStatus();
      await fetchQrCode();
    } catch (e: any) {
      alert('Erro ao conectar: ' + e?.message);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Tem certeza que deseja desconectar o WhatsApp do servidor?')) return;
    try {
      await fetch(getApiUrl('/api/whatsapp/disconnect'), { method: 'POST' });
      setQrCodeDataUrl(null);
      await fetchStatus();
    } catch (e: any) {
      alert('Erro ao desconectar: ' + e?.message);
    }
  };

  const handleResetSession = async () => {
    if (!window.confirm('Isso vai limpar a sessão atual e gerar um novo QR Code para renovar as chaves de criptografia. Continuar?')) return;
    try {
      setQrCodeDataUrl(null);
      await fetch(getApiUrl('/api/whatsapp/reset-session'), { method: 'POST' });
      await fetchStatus();
      await fetchQrCode();
      alert('Sessão limpa! Escaneie o novo QR Code abaixo.');
    } catch (e: any) {
      alert('Erro ao reiniciar sessão: ' + e?.message);
    }
  };

  const [configSaving, setConfigSaving] = useState(false);

  const handleUpdateSchedulerConfig = async (
    patch: Partial<{
      enabled: boolean;
      enableReminder: boolean;
      enableDue: boolean;
      enableFollowup: boolean;
      enableReactivation: boolean;
      reactivationDailyLimit: number;
    }>
  ) => {
    setConfigSaving(true);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/scheduler-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (res.ok && data.success && data.scheduler) {
        setServerStatus((prev) => ({ ...prev, scheduler: data.scheduler }));
      } else {
        alert('Não foi possível atualizar a configuração no servidor.');
      }
    } catch (e: any) {
      alert('Erro de conexão com o servidor: ' + e?.message);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleTriggerReactivation = async () => {
    const lim = serverStatus.scheduler?.reactivationDailyLimit ?? reactivationDailyLimitDraft ?? 2;
    if (!window.confirm(`Disparar campanha de reativação agora para até ${lim} ex-cliente(s) que ainda não receberam?`)) return;
    setReactivationLoading(true);
    setReactivationResult(null);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/trigger-reactivation'), { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setReactivationResult({ ok: true, message: `✅ Enviado para ${data.sent} ex-cliente(s). Falhas: ${data.failed}.` });
        await fetchReactivationStatus();
        await fetchReactivationQueue();
        await fetchLogs();
      } else {
        setReactivationResult({ ok: false, message: data.message || 'Erro ao disparar campanha' });
      }
    } catch (e: any) {
      setReactivationResult({ ok: false, message: 'Erro de conexão: ' + (e?.message || 'Servidor offline?') });
    } finally {
      setReactivationLoading(false);
    }
  };

  const handleSaveReactivationTemplate = async () => {
    const finalTpl1 = reactivationTemplateDraft.trim() || DEFAULT_REACTIVATION_TEMPLATE;
    const finalTpl2 = reactivationTemplate2Draft.trim() || DEFAULT_REACTIVATION_TEMPLATE_2;
    const finalTpl3 = reactivationTemplate3Draft.trim() || DEFAULT_REACTIVATION_TEMPLATE_3;
    setConfigSaving(true);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/scheduler-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reactivationTemplate: finalTpl1,
          reactivationTemplate2: finalTpl2,
          reactivationTemplate3: finalTpl3
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setReactivationTemplateDraft(finalTpl1);
        setReactivationTemplate2Draft(finalTpl2);
        setReactivationTemplate3Draft(finalTpl3);
        setReactivationTemplateDirty(false);
        if (data.scheduler) setServerStatus((prev) => ({ ...prev, scheduler: data.scheduler }));
        await fetchReactivationQueue();
        alert('Mensagens promocionais salvas no servidor!');
      } else {
        alert('Erro ao salvar mensagens promocionais.');
      }
    } catch (e: any) {
      alert('Erro de conexão com o servidor: ' + e?.message);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleSendSingleReactivation = async (item: ReactivationQueueItem) => {
    const stepLabel = typeof item.currentStep === 'number' ? ` (${item.currentStep}/3)` : '';
    if (!window.confirm(`Enviar mensagem promocional${stepLabel} agora para ${item.clientName} (${item.phoneNumber})?`)) return;
    setSendingReactivationId(item.clientId);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/send-reactivation-single'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: item.clientId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message || `Enviado para ${item.clientName}!`);
        await fetchReactivationStatus();
        await fetchReactivationQueue();
        await fetchLogs();
      } else {
        alert('Erro ao enviar: ' + (data?.message || 'Falha no envio'));
      }
    } catch (e: any) {
      alert('Erro de conexão: ' + e?.message);
    } finally {
      setSendingReactivationId(null);
    }
  };

  const handleTriggerClientPromo = async () => {
    const limit = serverStatus.scheduler?.clientPromoDailyLimit ?? clientPromoDailyLimitDraft ?? 2;
    if (!window.confirm(`Deseja disparar a promoção de apps extras ("promo cliente") para até ${limit} cliente(s) ativo(s) agora?`)) return;
    setClientPromoLoading(true);
    setReactivationResult(null);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/trigger-client-promo'), { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setReactivationResult({ ok: true, message: `Promo Clientes executada! Enviadas: ${data.sent || 0} | Falhas: ${data.failed || 0}` });
        await fetchClientPromoStatus();
        await fetchClientPromoQueue();
        await fetchLogs();
      } else {
        setReactivationResult({ ok: false, message: data.message || 'Erro ao disparar promo clientes.' });
      }
    } catch (e: any) {
      setReactivationResult({ ok: false, message: 'Erro de conexão: ' + (e?.message || 'Servidor offline?') });
    } finally {
      setClientPromoLoading(false);
    }
  };

  const handleSaveClientPromoTemplate = async () => {
    const finalTpl = clientPromoTemplateDraft.trim() || DEFAULT_CLIENT_PROMO_TEMPLATE;
    setConfigSaving(true);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/scheduler-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientPromoTemplate: finalTpl })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClientPromoTemplateDraft(finalTpl);
        setClientPromoTemplateDirty(false);
        if (data.scheduler) setServerStatus((prev) => ({ ...prev, scheduler: data.scheduler }));
        await fetchClientPromoQueue();
        alert('Mensagem "Promo Cliente" salva no servidor!');
      } else {
        alert('Erro ao salvar mensagem.');
      }
    } catch (e: any) {
      alert('Erro de conexão com o servidor: ' + e?.message);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleSavePromoValues = async () => {
    setConfigSaving(true);
    try {
      const payload = {
        reactivationStep2Price: Number(reactivationStep2PriceDraft) || 29.9,
        reactivationStep3Price: Number(reactivationStep3PriceDraft) || 24.9,
        clientPromoDiscountPercent: Math.min(95, Math.max(1, Math.round(Number(clientPromoDiscountDraft) || 30))),
        clientPromoPrices: {
          viki: Number(clientPromoPricesDraft.viki) || 19.9,
          iqiyi: Number(clientPromoPricesDraft.iqiyi) || 14.9,
          kocowa: Number(clientPromoPricesDraft.kocowa) || 9.9,
          wetv: Number(clientPromoPricesDraft.wetv) || 9.9,
          youku: Number(clientPromoPricesDraft.youku) || 9.9,
          dramabox: Number(clientPromoPricesDraft.dramabox) || 9.9
        }
      };
      const res = await fetch(getApiUrl('/api/whatsapp/scheduler-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPromoValuesDirty(false);
        if (data.scheduler) setServerStatus((prev) => ({ ...prev, scheduler: data.scheduler }));
        await Promise.all([fetchReactivationQueue(), fetchClientPromoQueue()]);
        alert('Valores e porcentagens promocionais salvos no servidor!');
      } else {
        alert('Erro ao salvar valores promocionais.');
      }
    } catch (e: any) {
      alert('Erro de conexão com o servidor: ' + e?.message);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleSendSingleClientPromo = async (item: ClientPromoQueueItem) => {
    if (!window.confirm(`Enviar promoção de apps extras (etiqueta "promo cliente") agora para ${item.clientName} (${item.phoneNumber})?`)) return;
    setSendingClientPromoId(item.clientId);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/send-client-promo-single'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: item.clientId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message || `Enviado para ${item.clientName}!`);
        await fetchClientPromoStatus();
        await fetchClientPromoQueue();
        await fetchLogs();
      } else {
        alert('Erro ao enviar: ' + (data?.message || 'Falha no envio'));
      }
    } catch (e: any) {
      alert('Erro de conexão: ' + e?.message);
    } finally {
      setSendingClientPromoId(null);
    }
  };

  const handleTriggerCycle = async () => {
    if (!window.confirm('Iniciar o ciclo de disparos automáticos no servidor agora para todos os pendentes?')) return;
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/trigger-cycle'), { method: 'POST' });
      if (res.ok) {
        setIsCycleRunning(true);
        alert('Ciclo de cobranças iniciado em segundo plano no servidor! O robô enviará com pausas seguras anti-bloqueio.');
        setTimeout(() => {
          void fetchQueue();
          void fetchLogs();
        }, 3000);
      } else {
        const data = await res.json();
        alert('Não foi possível iniciar: ' + (data?.message || 'Erro no servidor'));
      }
    } catch (e: any) {
      alert('Erro de conexão com o servidor: ' + e?.message);
    }
  };

  const handleSendSingleViaServer = async (item: QueueItem) => {
    setSendingId(item.id);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/send-single'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: item.clientId, serviceName: item.service })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Mensagem enviada com sucesso para ${item.clientName}!`);
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, alreadySentToday: true, lastChargedAt: new Date().toISOString() } : q))
        );
        void fetchLogs();
      } else {
        alert('Erro ao enviar pelo servidor: ' + (data?.message || 'Falha no envio'));
      }
    } catch (e: any) {
      alert('Erro de conexão com o servidor: ' + e?.message);
    } finally {
      setSendingId(null);
    }
  };

  const handleOpenWhatsAppWeb = async (item: QueueItem) => {
    const cleanPhone = item.phoneNumber.replace(/\D/g, '');
    window.open(`https://wa.me/55${cleanPhone}?text=${encodeURIComponent(item.message)}`, '_blank');

    const client = clients.find((c) => c.id === item.clientId);
    if (client) {
      const nowIso = new Date().toISOString();
      const sKey = item.service.toLowerCase().replace(/[^a-z0-9]/g, '');
      const prevProgress = client.game_progress || {};
      const prevEntries = prevProgress._charge_whatsapp_entries || {};
      prevEntries[sKey] = { service: item.service, chargedAt: nowIso };

      const nextProgress = {
        ...prevProgress,
        _charge_whatsapp_last_at: nowIso,
        _charge_whatsapp_last_service: item.service,
        _charge_whatsapp_entries: prevEntries
      };

      const updated = { ...client, is_contacted: true, game_progress: nextProgress };
      if (onClientUpdated) onClientUpdated(updated);
      await saveClientToDB(updated);

      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, alreadySentToday: true, lastChargedAt: nowIso } : q))
      );
    }
  };

  const handleCopyMessage = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Gera preview da mensagem de teste
  const getTestMessagePreview = () => {
    const expiry = new Date().toLocaleDateString('pt-BR');
    if (testStage === 'reminder') {
      return `Olá, ${testClientName || 'Dorameira'}! Tudo bem com você? ✨ Passando apenas para te avisar com carinho que a sua assinatura do *${testService}* vence no dia ${expiry}. O valor da assinatura é de *${testPrice}*. É apenas um lembrete para você poder se organizar com calma! Se tiver qualquer dúvida ou precisar de algo, estamos sempre à disposição por aqui. Tenha um ótimo dia e aproveite seus doramas! 🌸🍿`;
    } else if (testStage === 'due') {
      return `Olá, ${testClientName || 'Dorameira'}! Tudo bem? Esperamos que sim! 🌸 Passando para lembrar que hoje é o dia do vencimento da sua assinatura do *${testService}* no valor de *${testPrice}*. Quer renovar hoje para manter seu acesso ativo? Se já realizou o pagamento, por favor desconsidere este recadinho. Qualquer dúvida, estou por aqui para te ajudar! 🍿✨`;
    } else if (testStage === 'followup') {
      return `Olá, ${testClientName || 'Dorameira'}! Tudo bem? Notamos que o acesso à sua assinatura do *${testService}* encerrou. Sabemos bem como a rotina do dia a dia é corrida! Caso queira continuar acompanhando seus doramas favoritos, me avise por aqui. Se precisar de qualquer ajuda, estou super à disposição! 💜`;
    } else {
      return `Olá, ${testClientName || 'Dorameira'}! Tudo bem? Sentimos muito a sua falta aqui na EuDorama! 🥰 Preparamos uma condição super especial para você voltar a maratonar seus doramas preferidos por apenas *${testPrice}*! O que acha? É só me responder aqui. Tenha um lindo dia! ✨🍿`;
    }
  };

  const handleSendTest = async () => {
    if (!testPhone.trim()) {
      setTestResult({ ok: false, message: 'Informe o número de telefone para o teste.' });
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/send-test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: testPhone.replace(/\D/g, ''),
          stage: testStage,
          clientName: testClientName || 'Dorameira',
          service: testService || 'Viki',
          price: testPrice || 'R$ 24,90',
          expiryDate: new Date().toLocaleDateString('pt-BR')
        })
      });
      const data = await res.json();
      setTestResult({ ok: res.ok && data.success, message: data.message || (data.success ? 'Enviado!' : 'Falha no envio') });
    } catch (e: any) {
      setTestResult({ ok: false, message: 'Erro de conexão: ' + (e?.message || 'Servidor offline?') });
    } finally {
      setTestLoading(false);
    }
  };

  const summary = useMemo(() => {
    return queue.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.alreadySentToday) acc.sent += 1;
        else acc.pending += 1;
        if (item.stage === 'due') acc.due += 1;
        if (item.stage === 'reminder') acc.reminder += 1;
        if (item.stage === 'followup') acc.followup += 1;
        if (item.stage === 'reactivation') acc.reactivation += 1;
        return acc;
      },
      { total: 0, pending: 0, sent: 0, due: 0, reminder: 0, followup: 0, reactivation: 0 }
    );
  }, [queue]);

  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      if (stageFilter !== 'all' && item.stage !== stageFilter) return false;
      if (onlyPending && item.alreadySentToday) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (
          !item.clientName.toLowerCase().includes(q) &&
          !item.phoneNumber.includes(q) &&
          !item.service.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [queue, stageFilter, onlyPending, searchQuery]);

  const reactivationSummary = useMemo(() => {
    const pending = reactivationQueue.filter((i) => !i.alreadySent).length;
    const sent = reactivationQueue.filter((i) => i.alreadySent).length;
    return { total: reactivationQueue.length, pending, sent };
  }, [reactivationQueue]);

  const filteredReactivationQueue = useMemo(() => {
    return reactivationQueue.filter((item) => {
      if (reactivationFilter === 'pending' && item.alreadySent) return false;
      if (reactivationFilter === 'sent' && !item.alreadySent) return false;
      if (reactivationSearch.trim()) {
        const q = reactivationSearch.toLowerCase().trim();
        if (!item.clientName.toLowerCase().includes(q) && !item.phoneNumber.includes(q)) return false;
      }
      return true;
    });
  }, [reactivationQueue, reactivationFilter, reactivationSearch]);

  const clientPromoSummary = useMemo(() => {
    const pending = clientPromoQueue.filter((i) => !i.alreadySent).length;
    const sent = clientPromoQueue.filter((i) => i.alreadySent).length;
    return { total: clientPromoQueue.length, pending, sent };
  }, [clientPromoQueue]);

  const filteredClientPromoQueue = useMemo(() => {
    return clientPromoQueue.filter((item) => {
      if (clientPromoFilter === 'pending' && item.alreadySent) return false;
      if (clientPromoFilter === 'sent' && !item.alreadySent) return false;
      if (clientPromoSearch.trim()) {
        const q = clientPromoSearch.toLowerCase().trim();
        if (
          !item.clientName.toLowerCase().includes(q) &&
          !item.phoneNumber.includes(q) &&
          !item.missingApps.some((a) => a.label.toLowerCase().includes(q))
        ) {
          return false;
        }
      }
      return true;
    });
  }, [clientPromoQueue, clientPromoFilter, clientPromoSearch]);

  const stageColor = (stage: string) => {
    if (stage === 'due') return colorMap.red;
    if (stage === 'followup') return colorMap.amber;
    if (stage === 'reactivation') return colorMap.purple;
    return colorMap.blue;
  };

  return (
    <div className="space-y-6">
      {/* BARRA SUPERIOR */}
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-indigo-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 rounded-2xl">
            <MessageCircle size={26} />
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
              Cobrança Automática no Servidor
              {serverOnline === false && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">
                  Motor Offline
                </span>
              )}
              {serverOnline === true && serverStatus.state === 'connected' && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /> WhatsApp Ativo
                </span>
              )}
            </h2>
            <p className="text-xs font-semibold text-gray-500">
              Disparos 24/7 rodando na AWS EC2 sem precisar do seu computador ligado.
            </p>
          </div>
        </div>

        {/* ABAS */}
        <div className="flex items-center gap-1 p-1.5 bg-gray-100 dark:bg-slate-800 rounded-2xl text-xs font-black uppercase flex-wrap">
          {[
            { id: 'queue', label: `📋 Fila (${summary.pending})` },
            { id: 'promotional', label: `🎁 Promocionais (${reactivationSummary.pending})` },
            { id: 'connection', label: serverStatus.state === 'connected' ? '✅ WhatsApp' : '📱 Conectar' },
            { id: 'rules', label: '📏 Regras' },
            { id: 'test', label: '🧪 Testar' },
            { id: 'logs', label: '📜 Logs' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-2 rounded-xl transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            onClick={() => setActiveTab('config')}
            className={`p-2 rounded-xl transition-all ${
              activeTab === 'config'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-800 dark:hover:text-white'
            }`}
            title="Configurações"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          ABA: PROMOCIONAIS (EX-CLIENTES & CLIENTES ATIVOS)
      ══════════════════════════════════════════ */}
      {activeTab === 'promotional' && (
        <div className="space-y-6">
          {/* SELETOR DE CAMPANHA PROMOCIONAL */}
          <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-purple-100 dark:border-slate-800 shadow-sm w-fit">
            <button
              type="button"
              onClick={() => setPromoSubTab('reactivation')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-2 ${
                promoSubTab === 'reactivation'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Gift size={14} /> Ex-Clientes (Reativação · {reactivationSummary.pending})
            </button>
            <button
              type="button"
              onClick={() => setPromoSubTab('client_promo')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-2 ${
                promoSubTab === 'client_promo'
                  ? 'bg-pink-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Heart size={14} /> Clientes Ativos (Apps Extras · {clientPromoSummary.pending})
            </button>
          </div>

          {promoSubTab === 'client_promo' && (
            <div className="space-y-6">
              {/* RESUMO PROMO CLIENTE */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-pink-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-pink-500">Aguardando Envio</p>
                    <p className="text-2xl font-black text-pink-700 dark:text-pink-400">{clientPromoSummary.pending}</p>
                    <p className="text-[11px] text-gray-400 font-bold mt-0.5">Clientes ativos com apps faltando</p>
                  </div>
                  <div className="p-3 bg-pink-50 text-pink-600 rounded-2xl">
                    <Heart size={22} />
                  </div>
                </div>

                <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-indigo-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Enviadas Hoje</p>
                    <p className="text-2xl font-black text-indigo-700 dark:text-indigo-400">
                      {clientPromoStatus?.sentToday ?? 0} / {serverStatus.scheduler?.clientPromoDailyLimit ?? clientPromoDailyLimitDraft}
                    </p>
                    <p className="text-[11px] text-gray-400 font-bold mt-0.5">Etiqueta automática: promo cliente</p>
                  </div>
                  <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                    <Clock size={22} />
                  </div>
                </div>

                <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-emerald-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-emerald-500">Já Receberam</p>
                    <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{clientPromoSummary.sent}</p>
                    <p className="text-[11px] text-gray-400 font-bold mt-0.5">Apaga chat após 7d sem compra</p>
                  </div>
                  <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                    <CheckCircle2 size={22} />
                  </div>
                </div>
              </div>

              {/* CONTROLE DIÁRIO PROMO CLIENTE */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-sm border border-pink-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-black text-gray-900 dark:text-white">
                    Quantas clientes ativas devem receber "promo cliente" por dia?
                  </h4>
                  <p className="text-xs text-gray-500">
                    Oferta automática dos apps faltantes (Viki R$ {clientPromoPricesDraft.viki.toFixed(2).replace('.', ',')} · iQIYI R$ {clientPromoPricesDraft.iqiyi.toFixed(2).replace('.', ',')} · demais R$ {clientPromoPricesDraft.kocowa.toFixed(2).replace('.', ',')}) + combo {clientPromoDiscountDraft}% OFF. Válida 1 mês (7 dias para adquirir).
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {[1, 2, 5, 10, 15, 20].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={configSaving || serverOnline === false}
                      onClick={() => {
                        setClientPromoDailyLimitDraft(preset);
                        void handleUpdateSchedulerConfig({ clientPromoDailyLimit: preset });
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                        (serverStatus.scheduler?.clientPromoDailyLimit ?? clientPromoDailyLimitDraft) === preset
                          ? 'bg-pink-600 text-white shadow-sm'
                          : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-pink-100'
                      }`}
                    >
                      {preset}/dia
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={clientPromoDailyLimitDraft}
                    onChange={(e) => setClientPromoDailyLimitDraft(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                    className="w-20 px-3 py-1.5 bg-gray-50 dark:bg-slate-800 rounded-xl text-xs font-black border border-gray-200 dark:border-slate-700 text-center"
                  />
                  <button
                    type="button"
                    disabled={configSaving || serverOnline === false}
                    onClick={() => handleUpdateSchedulerConfig({ clientPromoDailyLimit: clientPromoDailyLimitDraft })}
                    className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase disabled:opacity-50"
                  >
                    Salvar
                  </button>
                </div>
              </div>

              {/* VALORES DOS APPS E PORCENTAGEM DO COMBO */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-sm border border-pink-100 dark:border-slate-800 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="text-sm font-black text-gray-900 dark:text-white">
                      Valores dos Apps (R$) e Desconto do Combo (%)
                    </h4>
                    <p className="text-xs text-gray-500">
                      Altere aqui apenas os valores de cada app e a porcentagem de desconto do combo sem precisar editar o texto da mensagem.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={configSaving || serverOnline === false}
                    onClick={handleSavePromoValues}
                    className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-xs font-black uppercase shadow-sm disabled:opacity-50"
                  >
                    {configSaving ? 'Salvando...' : 'Salvar Valores e %'}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  {(
                    [
                      { key: 'viki', label: 'Viki Pass (R$)' },
                      { key: 'iqiyi', label: 'iQIYI (R$)' },
                      { key: 'kocowa', label: 'Kocowa (R$)' },
                      { key: 'wetv', label: 'WeTV (R$)' },
                      { key: 'youku', label: 'Youku (R$)' },
                      { key: 'dramabox', label: 'DramaBox (R$)' }
                    ] as const
                  ).map((field) => (
                    <div key={field.key} className="space-y-1">
                      <label className="block text-[10px] font-black uppercase text-gray-500">{field.label}</label>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        value={clientPromoPricesDraft[field.key]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setClientPromoPricesDraft((prev) => ({ ...prev, [field.key]: isNaN(val) ? 0 : val }));
                          setPromoValuesDirty(true);
                        }}
                        className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 rounded-xl text-xs font-black border border-gray-200 dark:border-slate-700 outline-none focus:border-pink-400"
                      />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-black uppercase text-pink-600">Desconto Combo (%)</label>
                    <input
                      type="number"
                      min="1"
                      max="95"
                      value={clientPromoDiscountDraft}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setClientPromoDiscountDraft(isNaN(val) ? 1 : Math.min(95, Math.max(1, val)));
                        setPromoValuesDirty(true);
                      }}
                      className="w-full px-3 py-2 bg-pink-50 dark:bg-pink-950/30 rounded-xl text-xs font-black border border-pink-200 dark:border-pink-800 text-pink-700 dark:text-pink-300 outline-none focus:border-pink-500"
                    />
                  </div>
                </div>
              </div>

              {/* EDITOR DA MENSAGEM PROMO CLIENTE */}
              <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-pink-100 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="text-base font-black text-gray-900 dark:text-white flex items-center gap-2">
                        <Heart size={18} className="text-pink-600" />
                        Mensagem "Promo Cliente" (Editável)
                      </h3>
                      <p className="text-xs text-gray-500">
                        Variáveis: <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded font-bold">{'{nome}'}</code>{' '}
                        <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded font-bold">{'{apps_atuais}'}</code>{' '}
                        <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded font-bold">{'{lista_ofertas}'}</code>{' '}
                        <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded font-bold">{'{bloco_combo_50}'}</code>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setClientPromoTemplateDraft(DEFAULT_CLIENT_PROMO_TEMPLATE);
                        setClientPromoTemplateDirty(true);
                      }}
                      className="text-xs font-bold text-gray-500 hover:text-pink-600 underline"
                    >
                      Restaurar padrão
                    </button>
                  </div>

                  <textarea
                    rows={8}
                    value={clientPromoTemplateDraft}
                    onChange={(e) => {
                      setClientPromoTemplateDraft(e.target.value);
                      setClientPromoTemplateDirty(true);
                    }}
                    className="w-full p-3.5 bg-gray-50 dark:bg-slate-800 rounded-2xl text-xs font-semibold border border-gray-200 dark:border-slate-700 outline-none focus:border-pink-400 leading-relaxed"
                  />

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-[11px] font-bold text-gray-400">
                      {clientPromoTemplateDirty ? '⚠️ Alterações não salvas' : '✅ Sincronizado com o servidor'}
                    </span>
                    <button
                      type="button"
                      disabled={configSaving || serverOnline === false}
                      onClick={() => handleSaveClientPromoTemplate()}
                      className="px-5 py-2.5 rounded-2xl bg-pink-600 hover:bg-pink-700 text-white font-black text-xs uppercase transition-all shadow-md disabled:opacity-50"
                    >
                      {configSaving ? 'Salvando...' : 'Salvar Mensagem Promo Cliente'}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-black uppercase text-gray-500">Prévia no WhatsApp (exemplo com Viki Pass ativo)</p>
                  <div className="bg-[#e5ddd5] dark:bg-slate-700 rounded-3xl p-4 min-h-[230px]">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-tl-none p-3.5 max-w-[92%] shadow-sm">
                      <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                        {(clientPromoTemplateDraft || DEFAULT_CLIENT_PROMO_TEMPLATE)
                          .replace(/\{nome\}/gi, 'Maria')
                          .replace(/\{apps_atuais\}/gi, 'Viki Pass')
                          .replace(
                            /\{lista_ofertas\}/gi,
                            `• *iQIYI*: R$ ${clientPromoPricesDraft.iqiyi.toFixed(2).replace('.', ',')}/mês\n• *Kocowa*: R$ ${clientPromoPricesDraft.kocowa.toFixed(2).replace('.', ',')}/mês\n• *WeTV*: R$ ${clientPromoPricesDraft.wetv.toFixed(2).replace('.', ',')}/mês\n• *Youku*: R$ ${clientPromoPricesDraft.youku.toFixed(2).replace('.', ',')}/mês\n• *DramaBox*: R$ ${clientPromoPricesDraft.dramabox.toFixed(2).replace('.', ',')}/mês`
                          )
                          .replace(
                            /\{bloco_combo_50\}/gi,
                            `\n🎁 *E se quiser levar TODOS os 5 apps que faltam:* você ganha *${clientPromoDiscountDraft}% de desconto* sobre o valor original — de R$ 87,50 por apenas *R$ ${(87.5 * (1 - clientPromoDiscountDraft / 100)).toFixed(2).replace('.', ',')}*!\n`
                          )
                          .replace(/\{valor_original_combo\}/gi, 'R$ 87,50')
                          .replace(/\{valor_combo_50\}/gi, `R$ ${(87.5 * (1 - clientPromoDiscountDraft / 100)).toFixed(2).replace('.', ',')}`)}
                      </p>
                      <p className="text-[10px] text-gray-400 text-right mt-1.5">15:00 ✓✓</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* BARRA DE AÇÕES E FILTROS PROMO CLIENTE */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-sm border border-gray-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: 'pending', label: `Pendentes (${clientPromoSummary.pending})` },
                    { id: 'sent', label: `Já Enviadas (${clientPromoSummary.sent})` },
                    { id: 'all', label: `Todas (${clientPromoSummary.total})` }
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setClientPromoFilter(f.id as any)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
                        clientPromoFilter === f.id
                          ? 'bg-pink-600 text-white shadow-sm'
                          : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    value={clientPromoSearch}
                    onChange={(e) => setClientPromoSearch(e.target.value)}
                    placeholder="Buscar cliente, número ou app..."
                    className="px-4 py-2 bg-gray-50 dark:bg-slate-800 rounded-xl text-xs font-bold border border-gray-200 dark:border-slate-700 outline-none w-56"
                  />
                  <button
                    onClick={fetchClientPromoQueue}
                    disabled={clientPromoQueueLoading}
                    className="px-3.5 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-black text-xs uppercase flex items-center gap-1.5"
                  >
                    <RefreshCw size={14} className={clientPromoQueueLoading ? 'animate-spin' : ''} /> Atualizar
                  </button>
                  <button
                    onClick={handleTriggerClientPromo}
                    disabled={clientPromoLoading || serverStatus.state !== 'connected' || clientPromoSummary.pending === 0}
                    className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white font-black text-xs uppercase shadow-md disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Heart size={14} /> {clientPromoLoading ? 'Enviando...' : `Disparar ${serverStatus.scheduler?.clientPromoDailyLimit ?? clientPromoDailyLimitDraft} Próximas`}
                  </button>
                </div>
              </div>

              <div className="bg-pink-50/70 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-800/40 rounded-2xl px-4 py-3 text-xs font-semibold text-pink-900 dark:text-pink-200">
                📌 <strong>Ordem de envio:</strong> Clientes ativas ordenadas das <strong>mais antigas para as mais recentes</strong>. Etiqueta automática: <strong>promo cliente</strong>. Se não comprar nenhum app ofertado em 7 dias, a conversa é apagada automaticamente.
              </div>

              {filteredClientPromoQueue.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-12 text-center border border-dashed border-gray-200 dark:border-slate-800 space-y-2">
                  <Heart size={36} className="text-pink-400 mx-auto" />
                  <p className="text-sm font-black text-gray-800 dark:text-white">Nenhuma cliente encontrada neste filtro</p>
                  <p className="text-xs text-gray-400">Clientes que já possuem todos os 6 apps não entram na fila.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredClientPromoQueue.map((item, idx) => {
                    const isExpanded = clientPromoExpandedId === item.clientId;
                    const isSending = sendingClientPromoId === item.clientId;
                    return (
                      <div
                        key={item.clientId}
                        className={`rounded-3xl border p-5 space-y-3 transition-all ${
                          item.alreadySent
                            ? 'bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-800/40'
                            : 'bg-white dark:bg-slate-900 border-pink-100 dark:border-slate-800 shadow-sm'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {!item.alreadySent && (
                                <span className="px-2 py-0.5 rounded-full bg-pink-100 text-pink-800 text-[10px] font-black">
                                  #{idx + 1}
                                </span>
                              )}
                              <p className="font-black text-gray-900 dark:text-white text-sm">{item.clientName}</p>
                            </div>
                            <p className="text-xs font-semibold text-gray-500 mt-0.5">{item.phoneNumber}</p>
                            <p className="text-[11px] text-gray-500 font-bold mt-1">
                              Já tem: <span className="text-indigo-600">{item.ownedApps.join(', ') || '—'}</span>
                            </p>
                            <p className="text-[11px] text-gray-500 font-bold">
                              Faltam ({item.missingApps.length}):{' '}
                              <span className="text-pink-600">
                                {item.missingApps.map((a) => `${a.label} (R$ ${a.promoPrice.toFixed(2).replace('.', ',')})`).join(' · ')}
                              </span>
                            </p>
                            <p className="text-[11px] text-emerald-700 font-black">
                              Combo {clientPromoDiscountDraft}% OFF: R$ {item.combo50Price.toFixed(2).replace('.', ',')} (original R$ {item.originalTotal.toFixed(2).replace('.', ',')})
                            </p>
                          </div>

                          {item.chatDeletedAt ? (
                            <span className="px-3 py-1 rounded-full bg-gray-200 text-gray-700 font-black text-[10px] uppercase flex items-center gap-1 shrink-0">
                              <CheckCircle2 size={12} /> Conversa Apagada
                            </span>
                          ) : item.purchasedAt ? (
                            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-black text-[10px] uppercase flex items-center gap-1 shrink-0">
                              <CheckCircle2 size={12} /> Comprou!
                            </span>
                          ) : item.alreadySent ? (
                            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-black text-[10px] uppercase flex items-center gap-1 shrink-0">
                              <CheckCircle2 size={12} /> Enviado {item.sentAt ? new Date(item.sentAt).toLocaleDateString('pt-BR') : ''}
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full bg-pink-100 text-pink-800 font-black text-[10px] uppercase flex items-center gap-1 shrink-0">
                              <Clock size={12} /> Na Fila
                            </span>
                          )}
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 leading-relaxed p-3 rounded-2xl bg-pink-50/50 dark:bg-slate-800/60 border border-pink-100 dark:border-slate-700 whitespace-pre-wrap">
                            {isExpanded ? item.message : `${item.message.slice(0, 140)}...`}
                          </div>
                          <button
                            onClick={() => setClientPromoExpandedId(isExpanded ? null : item.clientId)}
                            className="text-[11px] font-bold text-pink-600 hover:text-pink-800 mt-1.5 flex items-center gap-1"
                          >
                            {isExpanded ? <><EyeOff size={12} /> Recolher mensagem</> : <><Eye size={12} /> Ver mensagem completa</>}
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <button
                            onClick={() => handleCopyMessage(item.message, `cpromo-${item.clientId}`)}
                            className="p-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-600 hover:text-pink-600 font-bold text-xs flex items-center gap-1.5"
                          >
                            {copiedId === `cpromo-${item.clientId}` ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                            {copiedId === `cpromo-${item.clientId}` ? 'Copiado!' : 'Copiar'}
                          </button>

                          {!item.alreadySent && (
                            <button
                              onClick={() => handleSendSingleClientPromo(item)}
                              disabled={isSending || serverStatus.state !== 'connected'}
                              className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white font-black text-xs uppercase flex items-center gap-1.5 shadow-md disabled:opacity-40"
                            >
                              {isSending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                              {isSending ? 'Enviando...' : 'Enviar Agora'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {promoSubTab === 'reactivation' && (
          <>
          {/* RESUMO */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-purple-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-purple-500">Aguardando Envio</p>
                <p className="text-2xl font-black text-purple-700 dark:text-purple-400">{reactivationSummary.pending}</p>
                <p className="text-[11px] text-gray-400 font-bold mt-0.5">Na lixeira sem nenhum app</p>
              </div>
              <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                <Gift size={22} />
              </div>
            </div>

            <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-indigo-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Enviadas Hoje</p>
                <p className="text-2xl font-black text-indigo-700 dark:text-indigo-400">
                  {reactivationStatus?.sentToday ?? 0} / {serverStatus.scheduler?.reactivationDailyLimit ?? reactivationDailyLimitDraft}
                </p>
                <p className="text-[11px] text-gray-400 font-bold mt-0.5">15h às 20h · Seg a Sex (sem fim de semana)</p>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <Clock size={22} />
              </div>
            </div>

            <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-emerald-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-emerald-500">Já Receberam</p>
                <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{reactivationSummary.sent}</p>
                <p className="text-[11px] text-gray-400 font-bold mt-0.5">Marcadas para não repetir</p>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                <CheckCircle2 size={22} />
              </div>
            </div>
          </div>

          {/* CONTROLE DE QUANTIDADE DIÁRIA DE PROMOÇÕES */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-sm border border-purple-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-black text-gray-900 dark:text-white">
                Quantas pessoas devem receber promoção por dia?
              </h4>
              <p className="text-xs text-gray-500">
                Envios automáticos ocorrem entre <strong>15h e 20h (Segunda a Sexta)</strong>, exceto finais de semana.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {[1, 2, 5, 10, 15, 20].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={configSaving || serverOnline === false}
                  onClick={() => {
                    setReactivationDailyLimitDraft(preset);
                    void handleUpdateSchedulerConfig({ reactivationDailyLimit: preset });
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                    (serverStatus.scheduler?.reactivationDailyLimit ?? reactivationDailyLimitDraft) === preset
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-purple-100'
                  }`}
                >
                  {preset}/dia
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={100}
                value={reactivationDailyLimitDraft}
                onChange={(e) => setReactivationDailyLimitDraft(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className="w-20 px-3 py-1.5 bg-gray-50 dark:bg-slate-800 rounded-xl text-xs font-black border border-gray-200 dark:border-slate-700 text-center"
              />
              <button
                type="button"
                disabled={configSaving || serverOnline === false}
                onClick={() => handleUpdateSchedulerConfig({ reactivationDailyLimit: reactivationDailyLimitDraft })}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </div>

          {/* VALORES DA PROMOÇÃO DE REATIVAÇÃO */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-sm border border-purple-100 dark:border-slate-800 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h4 className="text-sm font-black text-gray-900 dark:text-white">
                Valores da Promoção de Reativação (R$)
              </h4>
              <p className="text-xs text-gray-500">
                Altere apenas os valores das etapas 2 e 3 (3 apps por 3 meses).
              </p>
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase text-gray-500">2ª Mensagem (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={reactivationStep2PriceDraft}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setReactivationStep2PriceDraft(isNaN(val) ? 0 : val);
                    setPromoValuesDirty(true);
                  }}
                  className="w-28 px-3 py-2 bg-gray-50 dark:bg-slate-800 rounded-xl text-xs font-black border border-gray-200 dark:border-slate-700 outline-none focus:border-purple-400"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase text-purple-600">3ª Mensagem (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={reactivationStep3PriceDraft}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setReactivationStep3PriceDraft(isNaN(val) ? 0 : val);
                    setPromoValuesDirty(true);
                  }}
                  className="w-28 px-3 py-2 bg-purple-50 dark:bg-purple-950/30 rounded-xl text-xs font-black border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 outline-none focus:border-purple-500"
                />
              </div>
              <button
                type="button"
                disabled={configSaving || serverOnline === false}
                onClick={handleSavePromoValues}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-black uppercase shadow-sm disabled:opacity-50"
              >
                {configSaving ? 'Salvando...' : 'Salvar Valores'}
              </button>
            </div>
          </div>

          {/* EDITOR DAS 3 MENSAGENS PROMOCIONAIS */}
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-purple-100 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-base font-black text-gray-900 dark:text-white flex items-center gap-2">
                    <Gift size={18} className="text-purple-600" />
                    Funil de 3 Mensagens Promocionais
                  </h3>
                  <p className="text-xs text-gray-500">
                    Use <code className="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-bold">{'{nome}'}</code> para inserir o nome. A Msg 2 sai 1 dia útil após a 1ª; a Msg 3 sai 1 dia útil após a 2ª.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (activePromoTemplateStep === 1) setReactivationTemplateDraft(DEFAULT_REACTIVATION_TEMPLATE);
                    if (activePromoTemplateStep === 2) setReactivationTemplate2Draft(DEFAULT_REACTIVATION_TEMPLATE_2);
                    if (activePromoTemplateStep === 3) setReactivationTemplate3Draft(DEFAULT_REACTIVATION_TEMPLATE_3);
                    setReactivationTemplateDirty(true);
                  }}
                  className="text-xs font-bold text-gray-500 hover:text-purple-600 underline"
                >
                  Restaurar padrão (Msg {activePromoTemplateStep})
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  { step: 1 as const, label: '1ª Msg · Interesse' },
                  { step: 2 as const, label: '2ª Msg · R$ 29,90 (1 dia útil)' },
                  { step: 3 as const, label: '3ª Msg · R$ 24,90 (1 dia útil)' }
                ].map((tab) => (
                  <button
                    key={tab.step}
                    type="button"
                    onClick={() => setActivePromoTemplateStep(tab.step)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                      activePromoTemplateStep === tab.step
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-purple-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <textarea
                rows={7}
                value={
                  activePromoTemplateStep === 1
                    ? reactivationTemplateDraft
                    : activePromoTemplateStep === 2
                      ? reactivationTemplate2Draft
                      : reactivationTemplate3Draft
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (activePromoTemplateStep === 1) setReactivationTemplateDraft(val);
                  if (activePromoTemplateStep === 2) setReactivationTemplate2Draft(val);
                  if (activePromoTemplateStep === 3) setReactivationTemplate3Draft(val);
                  setReactivationTemplateDirty(true);
                }}
                className="w-full p-3.5 bg-gray-50 dark:bg-slate-800 rounded-2xl text-xs font-semibold border border-gray-200 dark:border-slate-700 outline-none focus:border-purple-400 leading-relaxed"
              />

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[11px] font-bold text-gray-400">
                  {reactivationTemplateDirty ? '⚠️ Alterações não salvas' : '✅ Sincronizado com o servidor'}
                </span>
                <button
                  type="button"
                  disabled={configSaving || serverOnline === false}
                  onClick={() => handleSaveReactivationTemplate()}
                  className="px-5 py-2.5 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs uppercase transition-all shadow-md disabled:opacity-50"
                >
                  {configSaving ? 'Salvando...' : 'Salvar Mensagens Promocionais'}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-black uppercase text-gray-500">
                Prévia no WhatsApp · Mensagem {activePromoTemplateStep}/3
              </p>
              <div className="bg-[#e5ddd5] dark:bg-slate-700 rounded-3xl p-4 min-h-[210px]">
                <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-tl-none p-3.5 max-w-[92%] shadow-sm">
                  <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                    {(
                      activePromoTemplateStep === 1
                        ? reactivationTemplateDraft || DEFAULT_REACTIVATION_TEMPLATE
                        : activePromoTemplateStep === 2
                          ? reactivationTemplate2Draft || DEFAULT_REACTIVATION_TEMPLATE_2
                          : reactivationTemplate3Draft || DEFAULT_REACTIVATION_TEMPLATE_3
                    )
                      .replace(/\{nome\}/gi, 'Maria')
                      .replace(/\{valor_etapa2\}/gi, reactivationStep2PriceDraft.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
                      .replace(/\{valor_etapa3\}/gi, reactivationStep3PriceDraft.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}
                  </p>
                  <p className="text-[10px] text-gray-400 text-right mt-1.5">15:00 ✓✓</p>
                </div>
              </div>
            </div>
          </div>

          {/* BARRA DE AÇÕES E FILTROS DA FILA PROMOCIONAL */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-sm border border-gray-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'pending', label: `Pendentes (${reactivationSummary.pending})`, active: 'purple' },
                { id: 'sent', label: `Já Enviadas (${reactivationSummary.sent})`, active: 'emerald' },
                { id: 'all', label: `Todas (${reactivationSummary.total})`, active: 'indigo' }
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setReactivationFilter(f.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
                    reactivationFilter === f.id
                      ? `bg-${f.active}-600 text-white shadow-sm`
                      : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={reactivationSearch}
                onChange={(e) => setReactivationSearch(e.target.value)}
                placeholder="Buscar ex-cliente ou número..."
                className="px-4 py-2 bg-gray-50 dark:bg-slate-800 rounded-xl text-xs font-bold border border-gray-200 dark:border-slate-700 outline-none w-52"
              />
              <button
                onClick={fetchReactivationQueue}
                disabled={reactivationQueueLoading}
                className="px-3.5 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-black text-xs uppercase flex items-center gap-1.5"
              >
                <RefreshCw size={14} className={reactivationQueueLoading ? 'animate-spin' : ''} /> Atualizar
              </button>
              <button
                onClick={handleTriggerReactivation}
                disabled={reactivationLoading || serverStatus.state !== 'connected' || reactivationSummary.pending === 0}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs uppercase shadow-md disabled:opacity-50 flex items-center gap-1.5"
              >
                <Gift size={14} /> {reactivationLoading ? 'Enviando...' : `Disparar ${serverStatus.scheduler?.reactivationDailyLimit ?? reactivationDailyLimitDraft} Próximas`}
              </button>
            </div>
          </div>

          {/* LISTA DAS PESSOAS QUE RECEBERÃO / RECEBERAM */}
          <div className="bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 rounded-2xl px-4 py-3 text-xs font-semibold text-purple-900 dark:text-purple-200">
            📌 <strong>Ordem de envio:</strong> Apenas ex-clientes <strong>completamente na lixeira (sem nenhum app)</strong>, ordenados das pessoas que estão <strong>há mais tempo na lixeira primeiro até as mais recentes</strong>. Os primeiros <strong>{serverStatus.scheduler?.reactivationDailyLimit ?? reactivationDailyLimitDraft}</strong> pendentes são os próximos da fila automática (15h às 20h, Seg a Sex).
          </div>

          {filteredReactivationQueue.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-12 text-center border border-dashed border-gray-200 dark:border-slate-800 space-y-2">
              <Gift size={36} className="text-purple-400 mx-auto" />
              <p className="text-sm font-black text-gray-800 dark:text-white">Nenhum ex-cliente encontrado neste filtro</p>
              <p className="text-xs text-gray-400">Somente clientes completamente na lixeira e sem nenhum app aparecem aqui.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredReactivationQueue.map((item, idx) => {
                const isExpanded = reactivationExpandedId === item.clientId;
                const isSending = sendingReactivationId === item.clientId;
                return (
                  <div
                    key={item.clientId}
                    className={`rounded-3xl border p-5 space-y-3 transition-all ${
                      item.alreadySent
                        ? 'bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-800/40'
                        : 'bg-white dark:bg-slate-900 border-purple-100 dark:border-slate-800 shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {!item.alreadySent && (
                            <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[10px] font-black">
                              #{idx + 1}
                            </span>
                          )}
                          <p className="font-black text-gray-900 dark:text-white text-sm">{item.clientName}</p>
                        </div>
                        <p className="text-xs font-semibold text-gray-500 mt-0.5">{item.phoneNumber}</p>
                        <p className="text-[11px] text-gray-400 font-bold">
                          Na lixeira desde:{' '}
                          {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString('pt-BR') : 'Data não registrada'}
                        </p>
                      </div>

                      {item.currentStep === 'chat_deleted' ? (
                        <span className="px-3 py-1 rounded-full bg-gray-200 text-gray-700 font-black text-[10px] uppercase flex items-center gap-1 shrink-0">
                          <CheckCircle2 size={12} /> Conversa Apagada
                        </span>
                      ) : item.alreadySent ? (
                        <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-black text-[10px] uppercase flex items-center gap-1 shrink-0">
                          <CheckCircle2 size={12} /> 3/3 Enviadas {item.nextEligibleDate ? `· Apaga ${item.nextEligibleDate.split('-').reverse().join('/')}` : ''}
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-800 font-black text-[10px] uppercase flex items-center gap-1 shrink-0">
                          <Clock size={12} /> Etapa {item.currentStep || 1}/3 {item.nextEligibleDate && !item.eligibleNow ? `· ${item.nextEligibleDate.split('-').reverse().join('/')}` : '· Na Fila'}
                        </span>
                      )}
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 leading-relaxed p-3 rounded-2xl bg-purple-50/50 dark:bg-slate-800/60 border border-purple-100 dark:border-slate-700 whitespace-pre-wrap">
                        {isExpanded ? item.message : `${item.message.slice(0, 130)}...`}
                      </div>
                      <button
                        onClick={() => setReactivationExpandedId(isExpanded ? null : item.clientId)}
                        className="text-[11px] font-bold text-purple-600 hover:text-purple-800 mt-1.5 flex items-center gap-1"
                      >
                        {isExpanded ? <><EyeOff size={12} /> Recolher mensagem</> : <><Eye size={12} /> Ver mensagem completa</>}
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        onClick={() => handleCopyMessage(item.message, `react-${item.clientId}`)}
                        className="p-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-600 hover:text-purple-600 font-bold text-xs flex items-center gap-1.5"
                      >
                        {copiedId === `react-${item.clientId}` ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                        {copiedId === `react-${item.clientId}` ? 'Copiado!' : 'Copiar'}
                      </button>

                      {!item.alreadySent && (
                        <button
                          onClick={() => handleSendSingleReactivation(item)}
                          disabled={isSending || serverStatus.state !== 'connected'}
                          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs uppercase flex items-center gap-1.5 shadow-md disabled:opacity-40"
                        >
                          {isSending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                          {isSending ? 'Enviando...' : 'Enviar Agora'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          ABA: CONECTAR WHATSAPP
      ══════════════════════════════════════════ */}
      {activeTab === 'connection' && (
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-sm border border-emerald-100 dark:border-slate-800 space-y-6">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-4">
            <div>
              <h3 className="text-lg font-black text-gray-900 dark:text-white">Conexão com WhatsApp no Servidor</h3>
              <p className="text-xs text-gray-500">O WhatsApp roda conectado 24h por dia no servidor EC2 usando Baileys.</p>
            </div>
            {serverStatus.state === 'connected' ? (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleResetSession}
                  className="px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold transition-all flex items-center gap-1.5"
                  title="Use se as mensagens ficarem com 'Aguardando mensagem'"
                >
                  <RefreshCw size={14} /> Reiniciar Sessão (Novo QR)
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Power size={14} /> Desconectar Sessão
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleResetSession}
                  className="px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <RefreshCw size={14} /> Limpar Sessão Antiga
                </button>
                <button
                  onClick={handleConnect}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase transition-all shadow-md flex items-center gap-1.5"
                >
                  <RefreshCw size={14} /> Gerar / Atualizar QR Code
                </button>
              </div>
            )}
          </div>

          {serverStatus.state === 'connected' ? (
            <div className="p-6 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-3xl flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-md">
                  <CheckCircle2 size={32} />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Sessão Ativa no Servidor
                  </p>
                  <p className="text-lg font-black text-gray-900 dark:text-white">
                    Número: +{serverStatus.userPhone || 'Conectado'}
                  </p>
                  <p className="text-xs text-gray-500 font-semibold">
                    Nome: {serverStatus.userName || 'EuDorama Atendimento'} · Conectado em:{' '}
                    {serverStatus.lastConnectedAt ? new Date(serverStatus.lastConnectedAt).toLocaleString('pt-BR') : 'Hoje'}
                  </p>
                </div>
              </div>
              <span className="px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800 font-black text-xs uppercase flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Pronto para Disparos Automáticos
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div className="flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-slate-800/50 rounded-3xl border-2 border-dashed border-gray-200 dark:border-slate-700">
                {qrCodeDataUrl ? (
                  <div className="space-y-3 text-center">
                    <img
                      src={qrCodeDataUrl}
                      alt="WhatsApp QR Code"
                      className="w-64 h-64 rounded-2xl shadow-lg border-4 border-white bg-white mx-auto"
                    />
                    <p className="text-xs font-bold text-gray-500 flex items-center justify-center gap-1.5">
                      <RefreshCw size={12} className="animate-spin text-emerald-600" />
                      Aguardando leitura pelo celular... (escanear rápido!)
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-12 space-y-4">
                    <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                      <QrCode size={36} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-700 dark:text-gray-300">Nenhum QR Code ativo</p>
                      <p className="text-xs text-gray-400 mt-1">Clique no botão acima para gerar o QR Code.</p>
                    </div>
                    <button
                      onClick={handleConnect}
                      className="px-5 py-3 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase hover:bg-emerald-700 transition-all shadow-md"
                    >
                      Gerar QR Code Agora
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h4 className="font-black text-gray-900 dark:text-white text-base">Como conectar seu WhatsApp:</h4>
                <ol className="space-y-3 text-xs text-gray-600 dark:text-gray-300 font-semibold list-decimal list-inside">
                  <li className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl">
                    Abra o <strong>WhatsApp</strong> no celular com o número de atendimento da EuDorama.
                  </li>
                  <li className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl">
                    Toque em <strong>Configurações / Menu (⋮)</strong> → <strong>Aparelhos Conectados</strong>.
                  </li>
                  <li className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl">
                    Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o QR Code.
                  </li>
                  <li className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl border border-emerald-100">
                    ✅ A sessão é <strong>salva no servidor</strong>. Você <strong>não precisará escanear novamente</strong> mesmo fechando o navegador!
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          ABA: REGRAS DE MENSAGEM
      ══════════════════════════════════════════ */}
      {activeTab === 'rules' && (
        <div className="space-y-4">
          <div className="bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/40 rounded-3xl p-5 flex gap-3">
            <Info size={20} className="text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-indigo-800 dark:text-indigo-300">Por que regras diferentes por etapa?</p>
              <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-1">
                Mensagens de cobrança devem ter o tom certo para cada momento. Pressionar alguém que ainda está em dia é invasivo e espanta clientes. Oferecer promoção para quem acabou de vencer pode parecer desespero. Cada etapa tem sua lógica.
              </p>
            </div>
          </div>

          {STAGE_RULES.map((rule) => {
            const col = colorMap[rule.color];
            const Icon = rule.icon;
            return (
              <div key={rule.id} className={`${col.bg} border ${col.border} rounded-3xl p-6 space-y-4`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-2xl ${col.icon}`}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className={`font-black text-base ${col.text}`}>{rule.label}</h4>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${col.badge}`}>
                        {rule.range}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-white/70 dark:bg-slate-800 text-gray-600 dark:text-gray-300">
                        Tom: {rule.tone}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-black uppercase text-gray-500 mb-2">✅ O que pode dizer:</p>
                    <ul className="space-y-1">
                      {rule.allowed.map((a) => (
                        <li key={a} className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                          <Check size={12} className="text-emerald-600 shrink-0 mt-0.5" /> {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase text-gray-500 mb-2">🚫 O que é proibido:</p>
                    <ul className="space-y-1">
                      {rule.blocked.map((b) => (
                        <li key={b} className="text-xs font-semibold text-red-700 dark:text-red-400">
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="p-3 bg-white/60 dark:bg-slate-800/50 rounded-2xl border border-white/80 dark:border-slate-700">
                  <p className="text-[10px] font-black uppercase text-gray-400 mb-1">Exemplo de mensagem:</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 italic">"{rule.example}"</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════
          ABA: TESTAR AUTOMAÇÃO
      ══════════════════════════════════════════ */}
      {activeTab === 'test' && (
        <div className="space-y-5">
          {/* Banner de aviso */}
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-3xl p-5 flex gap-3">
            <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-amber-800 dark:text-amber-300">Modo de Teste — Mensagens de Verificação</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Use para verificar se a automação está funcionando. A mensagem enviada terá o prefixo <strong>[🧪 MENSAGEM DE TESTE - IGNORAR]</strong> claramente visível para você saber que é só um teste. O WhatsApp precisa estar conectado no servidor.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* FORMULÁRIO */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-gray-100 dark:border-slate-800 shadow-sm space-y-5">
              <div className="flex items-center gap-2">
                <FlaskConical size={20} className="text-indigo-600" />
                <h3 className="font-black text-gray-900 dark:text-white">Configurar Teste</h3>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-black uppercase text-gray-600 dark:text-gray-300">
                    Número para receber o teste *
                  </label>
                  <input
                    type="text"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="Ex: 11999998888 (só números, sem +55)"
                    className="w-full p-3 bg-gray-50 dark:bg-slate-800 rounded-2xl text-sm font-bold border border-gray-200 dark:border-slate-700 outline-none focus:border-indigo-400"
                  />
                  <p className="text-[11px] text-gray-400">
                    Digite seu próprio número para receber o teste. Sem espaços, traços ou parênteses.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-black uppercase text-gray-600 dark:text-gray-300">Etapa a testar</label>
                  <select
                    value={testStage}
                    onChange={(e) => setTestStage(e.target.value as any)}
                    className="w-full p-3 bg-gray-50 dark:bg-slate-800 rounded-2xl text-sm font-bold border border-gray-200 dark:border-slate-700 outline-none focus:border-indigo-400"
                  >
                    <option value="reminder">🔔 Lembrete Antecipado (D-5 a D-1)</option>
                    <option value="due">🕐 Vence Hoje (D0)</option>
                    <option value="followup">💜 Follow-up Pós-vencimento (D+1 a D+7)</option>
                    <option value="reactivation">🎁 Reativação com Oferta (D+15 a D+45)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-black uppercase text-gray-600 dark:text-gray-300">Nome do cliente</label>
                    <input
                      type="text"
                      value={testClientName}
                      onChange={(e) => setTestClientName(e.target.value)}
                      placeholder="Ex: Dorameira"
                      className="w-full p-3 bg-gray-50 dark:bg-slate-800 rounded-2xl text-sm font-bold border border-gray-200 dark:border-slate-700 outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-black uppercase text-gray-600 dark:text-gray-300">Serviço</label>
                    <select
                      value={testService}
                      onChange={(e) => {
                        setTestService(e.target.value);
                        const prices: Record<string, string> = { Viki: 'R$ 24,90', iQIYI: 'R$ 19,90' };
                        setTestPrice(prices[e.target.value] || 'R$ 16,90');
                      }}
                      className="w-full p-3 bg-gray-50 dark:bg-slate-800 rounded-2xl text-sm font-bold border border-gray-200 dark:border-slate-700 outline-none focus:border-indigo-400"
                    >
                      <option>Viki</option>
                      <option>iQIYI</option>
                      <option>Kocowa</option>
                      <option>WeTV</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-black uppercase text-gray-600 dark:text-gray-300">Valor para simular</label>
                  <input
                    type="text"
                    value={testPrice}
                    onChange={(e) => setTestPrice(e.target.value)}
                    placeholder="Ex: R$ 24,90"
                    className="w-full p-3 bg-gray-50 dark:bg-slate-800 rounded-2xl text-sm font-bold border border-gray-200 dark:border-slate-700 outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              {/* STATUS DA CONEXÃO */}
              <div className={`p-3 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
                serverStatus.state === 'connected'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-800/40 dark:text-emerald-300'
                  : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800/40 dark:text-red-300'
              }`}>
                {serverStatus.state === 'connected' ? (
                  <><CheckCircle2 size={14} /> WhatsApp conectado — pronto para enviar</>
                ) : (
                  <><AlertCircle size={14} /> WhatsApp não conectado — vá para a aba "Conectar" primeiro</>
                )}
              </div>

              {/* RESULTADO */}
              {testResult && (
                <div className={`p-4 rounded-2xl border text-xs font-bold flex items-start gap-2 ${
                  testResult.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/20 dark:border-emerald-800/40 dark:text-emerald-200'
                    : 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/20 dark:border-red-800/40 dark:text-red-200'
                }`}>
                  {testResult.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                  {testResult.message}
                </div>
              )}

              <button
                onClick={handleSendTest}
                disabled={testLoading || serverStatus.state !== 'connected'}
                className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm uppercase transition-all shadow-md disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {testLoading ? (
                  <><RefreshCw size={16} className="animate-spin" /> Enviando teste...</>
                ) : (
                  <><FlaskConical size={16} /> Enviar Mensagem de Teste</>
                )}
              </button>
            </div>

            {/* PREVIEW DA MENSAGEM */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-gray-100 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye size={18} className="text-indigo-600" />
                  <h3 className="font-black text-gray-900 dark:text-white">Preview da Mensagem</h3>
                </div>
                <span className="text-[10px] font-black uppercase px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                  🧪 COM PREFIXO [TESTE]
                </span>
              </div>

              {/* Simulação de balão do WhatsApp */}
              <div className="bg-[#e5ddd5] dark:bg-slate-700 rounded-3xl p-4 min-h-[200px]">
                <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-tl-none p-3 max-w-[90%] shadow-sm">
                  <p className="text-[10px] font-black text-amber-600 mb-1">🧪 [MENSAGEM DE TESTE - IGNORAR]</p>
                  <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                    {getTestMessagePreview()}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-2 italic">
                    — Teste enviado pelo painel EuDorama
                  </p>
                  <p className="text-[10px] text-gray-400 text-right mt-1">
                    {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ✓✓
                  </p>
                </div>
              </div>

              <div className={`p-3 rounded-2xl border text-xs font-semibold space-y-1 ${colorMap[testStage === 'reminder' ? 'blue' : testStage === 'due' ? 'red' : testStage === 'followup' ? 'amber' : 'purple'].bg} ${colorMap[testStage === 'reminder' ? 'blue' : testStage === 'due' ? 'red' : testStage === 'followup' ? 'amber' : 'purple'].border}`}>
                <p className="font-black">
                  {STAGE_RULES.find((r) => r.id === testStage)?.label} · {STAGE_RULES.find((r) => r.id === testStage)?.range}
                </p>
                <p className="opacity-80">Tom: {STAGE_RULES.find((r) => r.id === testStage)?.tone}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          ABA: FILA DO DIA
      ══════════════════════════════════════════ */}
      {activeTab === 'queue' && (
        <div className="space-y-6">
          {/* CARDS DE RESUMO */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total na Fila', value: summary.total, sub: `${summary.pending} pendentes`, color: 'indigo', icon: Calendar },
              { label: 'Vence Hoje (D0)', value: summary.due, sub: 'Convite gentil à renovação', color: 'red', icon: Clock },
              { label: 'Lembrete D-5', value: summary.reminder, sub: 'Sem pressão — apenas informativo', color: 'blue', icon: ShieldCheck },
              { label: 'Follow-up D+2', value: summary.followup, sub: 'Empático e sem pressão', color: 'amber', icon: Heart }
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
                  <div>
                    <p className={`text-[10px] font-black uppercase tracking-wider text-${card.color}-400`}>{card.label}</p>
                    <p className={`text-2xl font-black text-${card.color}-600`}>{card.value}</p>
                    <p className="text-[11px] text-gray-400 font-bold mt-0.5">{card.sub}</p>
                  </div>
                  <div className={`p-3 bg-${card.color}-50 text-${card.color}-600 rounded-2xl`}>
                    <Icon size={22} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* CARD DO ROBÔ DIÁRIO */}
          <div className={`p-6 rounded-[2.5rem] text-white shadow-lg flex flex-wrap items-center justify-between gap-4 transition-all ${
            serverStatus.scheduler?.enabled === false
              ? 'bg-gradient-to-r from-slate-600 to-slate-700'
              : 'bg-gradient-to-r from-emerald-600 to-teal-700'
          }`}>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {serverStatus.scheduler?.enabled === false ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
                ) : (
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-300 animate-ping" />
                )}
                <p className="text-xs font-black uppercase tracking-widest text-emerald-200">
                  {serverStatus.scheduler?.enabled === false ? 'Automação Pausada' : 'Agendador Automático do Servidor'}
                </p>
              </div>
              <h3 className="text-xl font-black">
                {serverStatus.scheduler?.enabled === false
                  ? 'Disparos Automáticos Desativados'
                  : 'Cobranças: 15:00 às 20:00 (Todos os dias) · Promoções: Seg a Sex'}
              </h3>
              <p className="text-xs text-emerald-100 font-semibold max-w-xl">
                {serverStatus.scheduler?.enabled === false
                  ? 'Nenhuma mensagem automática será enviada às 15:00 até que você reative a automação abaixo.'
                  : 'O servidor envia sozinho com intervalos humanizados (10s a 18s) para blindar seu número de bloqueios.'}
                {serverStatus.scheduler?.lastCycleAt && (
                  <span className="block mt-1 text-emerald-200 font-bold">
                    Último ciclo: {new Date(serverStatus.scheduler.lastCycleAt).toLocaleString('pt-BR')} ({serverStatus.scheduler.lastCycleSummary?.sent || 0} enviados,{' '}
                    {serverStatus.scheduler.lastCycleSummary?.failed || 0} falhas)
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => handleUpdateSchedulerConfig({ enabled: serverStatus.scheduler?.enabled === false })}
                disabled={configSaving || serverOnline === false}
                className={`px-4 py-3 rounded-2xl font-black text-xs uppercase transition-all flex items-center gap-2 ${
                  serverStatus.scheduler?.enabled === false
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-md'
                    : 'bg-red-500/80 hover:bg-red-500 text-white'
                } disabled:opacity-50`}
              >
                <Power size={16} />
                {serverStatus.scheduler?.enabled === false ? 'Ativar Automação' : 'Desativar Tudo'}
              </button>

              <button
                onClick={fetchQueue}
                disabled={loading}
                className="px-4 py-3 rounded-2xl bg-white/20 hover:bg-white/30 text-white font-black text-xs uppercase transition-all backdrop-blur-sm flex items-center gap-2"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar
              </button>

              <button
                onClick={handleTriggerCycle}
                disabled={isCycleRunning || serverStatus.state !== 'connected' || summary.pending === 0}
                className="px-6 py-3.5 rounded-2xl bg-white text-emerald-800 font-black text-xs uppercase hover:bg-emerald-50 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                <Zap size={18} className="text-amber-500 fill-amber-500" />
                {isCycleRunning ? 'Disparo em Andamento...' : `Disparar ${summary.pending} Pendentes Agora`}
              </button>
            </div>
          </div>

          {/* CONTROLE POR PARTES DA AUTOMAÇÃO */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-sm border border-gray-100 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h4 className="text-sm font-black text-gray-900 dark:text-white flex items-center gap-2">
                  <Power size={16} className="text-indigo-600" />
                  Controle da Automação (Por Completo ou Por Partes)
                </h4>
                <p className="text-xs text-gray-500">
                  Ative ou desative cada etapa individualmente. As alterações são salvas imediatamente no servidor.
                </p>
              </div>
              {configSaving && (
                <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">
                  <RefreshCw size={12} className="animate-spin" /> Salvando...
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  key: 'enableReminder' as const,
                  label: '🔔 Lembrete (D-5)',
                  desc: '5 dias antes do vencimento',
                  active: serverStatus.scheduler?.enableReminder !== false
                },
                {
                  key: 'enableDue' as const,
                  label: '🕐 Vencimento (D0)',
                  desc: 'No dia do vencimento',
                  active: serverStatus.scheduler?.enableDue !== false
                },
                {
                  key: 'enableFollowup' as const,
                  label: '💜 Follow-up (D+2)',
                  desc: '2 dias após o vencimento',
                  active: serverStatus.scheduler?.enableFollowup !== false
                },
                {
                  key: 'enableReactivation' as const,
                  label: '🎁 Reativação (2/dia)',
                  desc: 'Campanha para ex-clientes',
                  active: serverStatus.scheduler?.enableReactivation !== false
                }
              ].map((part) => (
                <button
                  key={part.key}
                  type="button"
                  disabled={configSaving || serverOnline === false}
                  onClick={() => handleUpdateSchedulerConfig({ [part.key]: !part.active })}
                  className={`p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between gap-2 disabled:opacity-50 ${
                    part.active
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                      : 'bg-gray-50 dark:bg-slate-800/60 border-gray-200 dark:border-slate-700 opacity-75'
                  }`}
                >
                  <div>
                    <p className="text-xs font-black text-gray-900 dark:text-white">{part.label}</p>
                    <p className="text-[11px] text-gray-500 font-semibold">{part.desc}</p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase shrink-0 ${
                      part.active ? 'bg-emerald-600 text-white' : 'bg-gray-300 dark:bg-slate-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {part.active ? 'Ativo' : 'Desativado'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* CARD DA CAMPANHA DE REATIVAÇÃO */}
          <div className="p-5 bg-gradient-to-r from-purple-600 to-indigo-700 rounded-[2.5rem] text-white shadow-lg flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Gift size={18} className="text-purple-200" />
                <p className="text-xs font-black uppercase tracking-widest text-purple-200">
                  Campanha de Reativação de Ex-clientes
                </p>
              </div>
              <h3 className="text-base font-black">
                {serverStatus.scheduler?.reactivationDailyLimit ?? reactivationDailyLimitDraft} mensagens por dia — 15:00 às 20:00 (Seg a Sex)
              </h3>
              <p className="text-xs text-purple-100 font-semibold max-w-xl">
                O Orion entra em contato com ex-clientes que nunca receberam a campanha, apresenta a EuDorama e oferece uma promoção especial. Cada pessoa recebe apenas 1 vez.
                {reactivationStatus && (
                  <span className="block mt-1 text-purple-200 font-bold">
                    Hoje: {reactivationStatus.sentToday}/{serverStatus.scheduler?.reactivationDailyLimit ?? reactivationDailyLimitDraft} enviadas
                    {reactivationStatus.lastRunAt && ` · Último disparo: ${new Date(reactivationStatus.lastRunAt).toLocaleString('pt-BR')}`}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {reactivationResult && (
                <p className={`text-xs font-bold px-3 py-1.5 rounded-xl ${reactivationResult.ok ? 'bg-white/20 text-white' : 'bg-red-200 text-red-900'}`}>
                  {reactivationResult.message}
                </p>
              )}
              <button
                onClick={handleTriggerReactivation}
                disabled={reactivationLoading || serverStatus.state !== 'connected'}
                className="px-5 py-2.5 rounded-2xl bg-white text-purple-800 font-black text-xs uppercase hover:bg-purple-50 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                {reactivationLoading ? <><RefreshCw size={14} className="animate-spin" /> Enviando...</> : <><Gift size={14} /> Disparar Reativação Agora</>}
              </button>
            </div>
          </div>

          {/* FILTROS */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-sm border border-gray-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'all', label: `Todos (${summary.total})`, active: 'indigo' },
                { id: 'due', label: `Vence Hoje (${summary.due})`, active: 'red' },
                { id: 'reminder', label: `Lembretes D-5 (${summary.reminder})`, active: 'blue' },
                { id: 'followup', label: `Follow-up D+2 (${summary.followup})`, active: 'amber' }
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStageFilter(f.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
                    stageFilter === f.id
                      ? `bg-${f.active}-600 text-white shadow-sm`
                      : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyPending}
                  onChange={(e) => setOnlyPending(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                Apenas Pendentes
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar cliente, número ou serviço..."
                className="px-4 py-2 bg-gray-50 dark:bg-slate-800 rounded-xl text-xs font-bold border border-gray-200 dark:border-slate-700 outline-none w-56"
              />
            </div>
          </div>

          {/* LISTA DE CARDS */}
          {filteredQueue.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-12 text-center border border-dashed border-gray-200 dark:border-slate-800 space-y-2">
              <CheckCircle2 size={36} className="text-emerald-500 mx-auto" />
              <p className="text-sm font-black text-gray-800 dark:text-white">Nenhum cliente pendente nesta categoria!</p>
              <p className="text-xs text-gray-400">Todos os clientes já foram notificados ou não há vencimentos no período.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredQueue.map((item) => {
                const isExpanded = expandedPreviewId === item.id;
                const isSending = sendingId === item.id;
                const col = stageColor(item.stage);

                return (
                  <div
                    key={item.id}
                    className={`rounded-3xl border transition-all ${
                      item.alreadySentToday
                        ? 'bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-800/40'
                        : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-800 shadow-sm'
                    }`}
                  >
                    {/* Header do card */}
                    <div className="p-5 pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-black text-gray-900 dark:text-white text-sm">{item.clientName}</p>
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${col.badge}`}>
                              {item.stageLabel}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-gray-500 mt-0.5">
                            {item.phoneNumber} · <strong className="text-indigo-600 dark:text-indigo-400">{item.service}</strong>{' '}
                            · {item.priceFormatted}
                          </p>
                          <p className="text-[11px] text-gray-400 font-bold">Vencimento: {item.expiryDateStr}</p>
                        </div>
                        <div className="shrink-0">
                          {item.alreadySentToday ? (
                            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-black text-[10px] uppercase flex items-center gap-1 shadow-sm">
                              <CheckCircle2 size={12} /> Enviado Hoje
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 font-black text-[10px] uppercase flex items-center gap-1">
                              <Clock size={12} /> Pendente
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Prévia sempre visível (truncada) */}
                    <div className="px-5 mt-3">
                      <div className={`text-[11px] font-semibold text-gray-600 dark:text-gray-300 leading-relaxed p-3 rounded-2xl ${col.bg} border ${col.border}`}>
                        {isExpanded ? item.message : `${item.message.slice(0, 120)}...`}
                      </div>
                      <button
                        onClick={() => setExpandedPreviewId(isExpanded ? null : item.id)}
                        className="text-[11px] font-bold text-indigo-500 hover:text-indigo-700 mt-1.5 flex items-center gap-1"
                      >
                        {isExpanded ? <><EyeOff size={12} /> Recolher mensagem</> : <><Eye size={12} /> Ver mensagem completa</>}
                      </button>
                    </div>

                    {/* Botões */}
                    <div className="p-5 pt-4 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleCopyMessage(item.message, item.id)}
                        className="p-2.5 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-600 hover:text-indigo-600 font-bold text-xs flex items-center gap-1.5 transition-all"
                        title="Copiar mensagem"
                      >
                        {copiedId === item.id ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                        {copiedId === item.id ? 'Copiado!' : 'Copiar'}
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenWhatsAppWeb(item)}
                          className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-bold text-xs flex items-center gap-1.5 transition-all"
                          title="Abrir no WhatsApp Web"
                        >
                          <ExternalLink size={14} /> WhatsApp Web
                        </button>

                        <button
                          onClick={() => handleSendSingleViaServer(item)}
                          disabled={isSending || serverStatus.state !== 'connected'}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase flex items-center gap-1.5 transition-all shadow-md disabled:opacity-40"
                          title="Enviar via servidor EC2"
                        >
                          {isSending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                          {isSending ? 'Enviando...' : 'Enviar pelo Servidor'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          ABA: LOGS
      ══════════════════════════════════════════ */}
      {activeTab === 'logs' && (
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-gray-100 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="font-black text-gray-900 dark:text-white text-base">Histórico de Disparos do Servidor</h3>
              <p className="text-xs text-gray-400">Registros em tempo real dos envios realizados pelo robô.</p>
            </div>
            <button
              onClick={fetchLogs}
              className="p-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-600 hover:text-indigo-600 text-xs font-bold flex items-center gap-1"
            >
              <RefreshCw size={14} /> Atualizar
            </button>
          </div>

          {logs.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-xs font-bold">
              Nenhum log ainda. Os disparos do servidor aparecerão aqui automaticamente.
            </div>
          ) : (
            <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`p-3.5 rounded-2xl border text-xs flex items-center justify-between gap-4 ${
                    log.status === 'success'
                      ? 'bg-emerald-50/40 border-emerald-100 text-emerald-900 dark:bg-emerald-950/20 dark:border-emerald-800/40 dark:text-emerald-200'
                      : 'bg-red-50/40 border-red-100 text-red-900 dark:bg-red-950/20 dark:border-red-800/40 dark:text-red-200'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-bold flex items-center gap-2 flex-wrap">
                      <span>{log.clientName}</span>
                      <span className="text-[10px] opacity-70">({log.phoneNumber})</span>
                      <span className="px-2 py-0.5 rounded-full bg-white/70 dark:bg-slate-800 text-[10px] font-black uppercase">
                        {log.stage}
                      </span>
                      <span className="text-[10px] opacity-60">{log.service}</span>
                    </p>
                    {log.error ? (
                      <p className="text-red-600 dark:text-red-400 font-semibold text-[11px]">Erro: {log.error}</p>
                    ) : (
                      <p className="text-gray-500 dark:text-gray-400 text-[11px] truncate max-w-xl">{log.messageText}</p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                        log.status === 'success' ? 'bg-emerald-200 text-emerald-900' : 'bg-red-200 text-red-900'
                      }`}
                    >
                      {log.status === 'success' ? 'Sucesso' : 'Falha'}
                    </span>
                    <p className="text-[10px] text-gray-400 font-bold mt-1">
                      {new Date(log.timestamp).toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          ABA: CONFIGURAÇÕES
      ══════════════════════════════════════════ */}
      {activeTab === 'config' && (
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-gray-100 dark:border-slate-800 space-y-6">
          <div className="border-b border-gray-100 dark:border-slate-800 pb-3">
            <h3 className="font-black text-gray-900 dark:text-white text-base">Configurações do Servidor de Cobrança</h3>
            <p className="text-xs text-gray-400">Parâmetros de conexão e rotina automática.</p>
          </div>

          <div className="space-y-4 max-w-xl">
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600 dark:text-gray-300">URL Base do Motor / Servidor</label>
              <input
                type="text"
                value={motorBaseUrl}
                onChange={(e) => {
                  setMotorBaseUrl(e.target.value);
                  localStorage.setItem('whatsapp_motor_base_url', e.target.value);
                }}
                placeholder="Ex: https://viki-motor.eudorama.com"
                className="w-full p-3 bg-gray-50 dark:bg-slate-800 rounded-2xl text-xs font-bold border border-gray-200 dark:border-slate-700 outline-none"
              />
              <p className="text-[11px] text-gray-400">
                Cole aqui a URL do túnel Cloudflare: <code className="bg-gray-100 dark:bg-slate-700 px-1 py-0.5 rounded">https://viki-motor.eudorama.com</code>
              </p>
            </div>

            <div className="p-4 bg-indigo-50 dark:bg-slate-800/50 rounded-2xl border border-indigo-100 dark:border-slate-700 space-y-2">
              <h4 className="text-xs font-black uppercase text-indigo-700 dark:text-indigo-400">Comandos úteis no EC2:</h4>
              <pre className="p-3 bg-slate-900 text-emerald-400 rounded-xl text-xs overflow-x-auto font-mono">
{`# Ver status dos processos
pm2 list

# Ver logs em tempo real
pm2 logs viki-motor

# Reiniciar o motor
pm2 restart viki-motor

# Verificar se o motor responde
curl https://viki-motor.eudorama.com/api/whatsapp/status`}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
