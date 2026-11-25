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
    range: 'D-5 até D-1',
    color: 'blue',
    icon: Bell,
    tone: 'Informativo e gentil',
    allowed: ['Avisar a data de vencimento', 'Informar o valor', 'Oferecer ajuda para dúvidas'],
    blocked: ['❌ Pedir que pague adiantado', '❌ Criar urgência ou pressão', '❌ Mencionar promoções ou ofertas'],
    example: 'Olá! Passando com carinho para lembrar que sua assinatura vence em X dias. É só um lembrete para se organizar com calma!'
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
    range: 'D+1 até D+7',
    color: 'amber',
    icon: Heart,
    tone: 'Empático e sem pressão',
    allowed: ['Mencionar que o acesso encerrou', 'Perguntar se quer informações para renovar', 'Oferecer ajuda'],
    blocked: ['❌ Dizer "X dias em atraso"', '❌ Cobrar de forma direta', '❌ Promoções ou ofertas especiais'],
    example: 'Olá! Notamos que sua assinatura encerrou. Sabemos que a rotina é corrida! Se quiser renovar, é só me avisar.'
  },
  {
    id: 'reactivation',
    label: 'Reativação',
    range: 'D+15 até D+45',
    color: 'purple',
    icon: Gift,
    tone: 'Saudades + oferta especial',
    allowed: ['Tom de "sentimos sua falta"', 'Oferecer condição/promoção especial', 'Convidar de volta'],
    blocked: ['❌ Tom de cobrador', '❌ Mencionar dívida ou atraso'],
    example: 'Olá! Sentimos muito a sua falta! 🥰 Preparamos uma condição especial para você voltar a maratonar seus doramas preferidos!'
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
  const [activeTab, setActiveTab] = useState<'queue' | 'connection' | 'rules' | 'test' | 'logs' | 'config'>('queue');
  const [stageFilter, setStageFilter] = useState<'all' | 'due' | 'reminder' | 'followup' | 'reactivation'>('all');
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
      } else {
        setServerOnline(false);
      }
    } catch {
      setServerOnline(false);
    }
  }, [getApiUrl]);

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

        if (days >= 1 && days <= 5) {
          stage = 'reminder';
          stageLabel = days === 1 ? 'Vence Amanhã (D-1)' : `Vence em ${days}d (D-${days})`;
        } else if (days === 0) {
          stage = 'due';
          stageLabel = 'Vence Hoje (D0)';
        } else if (days >= -7 && days <= -1) {
          stage = 'followup';
          stageLabel = `Vencido há ${Math.abs(days)}d (D+${Math.abs(days)})`;
        } else if (days <= -15 && days >= -45) {
          stage = 'reactivation';
          stageLabel = `Reativação (${Math.abs(days)}d vencido)`;
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

    const interval = setInterval(() => {
      void fetchStatus();
      if (serverStatus.state === 'connecting' || serverStatus.state === 'qr_ready') {
        void fetchQrCode();
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchQueue, fetchLogs, serverStatus.state, fetchQrCode]);

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
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <Power size={14} /> Desconectar Sessão
              </button>
            ) : (
              <button
                onClick={handleConnect}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase transition-all shadow-md flex items-center gap-1.5"
              >
                <RefreshCw size={14} /> Gerar / Atualizar QR Code
              </button>
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
              { label: 'Lembretes (D-5 a D-1)', value: summary.reminder, sub: 'Sem pressão de pagamento', color: 'blue', icon: ShieldCheck },
              { label: 'Vencidos + Reativação', value: summary.followup + summary.reactivation, sub: 'Follow-up e ofertas', color: 'purple', icon: Zap }
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
          <div className="p-6 bg-gradient-to-r from-emerald-600 to-teal-700 rounded-[2.5rem] text-white shadow-lg flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-300 animate-ping" />
                <p className="text-xs font-black uppercase tracking-widest text-emerald-200">
                  Agendador Automático do Servidor
                </p>
              </div>
              <h3 className="text-xl font-black">Disparo Diário Programado — 09:30 (Brasília)</h3>
              <p className="text-xs text-emerald-100 font-semibold max-w-xl">
                O servidor envia sozinho com intervalos humanizados (10s a 18s) para blindar seu número de bloqueios.
                {serverStatus.scheduler?.lastCycleAt && (
                  <span className="block mt-1 text-emerald-200 font-bold">
                    Último ciclo: {new Date(serverStatus.scheduler.lastCycleAt).toLocaleString('pt-BR')} ({serverStatus.scheduler.lastCycleSummary?.sent || 0} enviados,{' '}
                    {serverStatus.scheduler.lastCycleSummary?.failed || 0} falhas)
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-3">
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

          {/* FILTROS */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-sm border border-gray-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'all', label: `Todos (${summary.total})`, active: 'indigo' },
                { id: 'due', label: `Vence Hoje (${summary.due})`, active: 'red' },
                { id: 'reminder', label: `Lembretes (${summary.reminder})`, active: 'blue' },
                { id: 'followup', label: `Follow-up (${summary.followup})`, active: 'amber' },
                { id: 'reactivation', label: `Reativação (${summary.reactivation})`, active: 'purple' }
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
