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
  Smartphone
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

export const ChargeWhatsappAutomationPanel: React.FC<ChargePanelProps> = ({ clients, onClientUpdated }) => {
  const [activeTab, setActiveTab] = useState<'queue' | 'connection' | 'logs' | 'config'>('queue');
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

  // Carrega status da conexão
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/status'));
      if (res.ok) {
        const data = await res.json();
        setServerStatus(data);
        setServerOnline(true);
        if (data.scheduler?.isRunning) {
          setIsCycleRunning(true);
        } else {
          setIsCycleRunning(false);
        }
      } else {
        setServerOnline(false);
      }
    } catch {
      setServerOnline(false);
    }
  }, [getApiUrl]);

  // Carrega QR Code
  const fetchQrCode = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/qr'));
      if (res.ok) {
        const data = await res.json();
        if (data.qrCodeDataUrl) {
          setQrCodeDataUrl(data.qrCodeDataUrl);
        }
      }
    } catch {}
  }, [getApiUrl]);

  // Carrega fila de cobranças do servidor
  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/queue'));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.queue)) {
          setQueue(data.queue);
        }
      }
    } catch (err) {
      console.warn('[Painel WhatsApp] Servidor offline ou rota indisponível, gerando fila localmente.', err);
      generateLocalQueue();
    } finally {
      setLoading(false);
    }
  }, [getApiUrl, clients]);

  // Carrega logs de envio
  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/whatsapp/logs'));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      }
    } catch {}
  }, [getApiUrl]);

  // Gera fila local caso o servidor esteja sendo configurado
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
        const priceFormatted = price > 0 ? price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Valor Regular';
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

  // Polling regular a cada 8 segundos para status e QR Code
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

  // Iniciar conexão com WhatsApp
  const handleConnect = async () => {
    try {
      await fetch(getApiUrl('/api/whatsapp/connect'), { method: 'POST' });
      await fetchStatus();
      await fetchQrCode();
    } catch (e: any) {
      alert('Erro ao conectar: ' + e?.message);
    }
  };

  // Desconectar WhatsApp
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

  // Disparar ciclo completo pelo servidor
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

  // Disparo individual pelo servidor
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

  // Fallback: envio manual via WhatsApp Web
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

  // Resumo da fila
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

  // Fila filtrada
  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      if (stageFilter !== 'all' && item.stage !== stageFilter) return false;
      if (onlyPending && item.alreadySentToday) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = item.clientName.toLowerCase().includes(q);
        const matchesPhone = item.phoneNumber.includes(q);
        const matchesService = item.service.toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesService) return false;
      }
      return true;
    });
  }, [queue, stageFilter, onlyPending, searchQuery]);

  return (
    <div className="space-y-6">
      {/* BARRA SUPERIOR DE STATUS E NAVEGAÇÃO */}
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
                  Motor Local/Offline
                </span>
              )}
            </h2>
            <p className="text-xs font-semibold text-gray-500">
              Disparos 24/7 rodando na sua AWS EC2 sem precisar do seu computador ligado.
            </p>
          </div>
        </div>

        {/* NAVEGAÇÃO ENTRE ABAS */}
        <div className="flex items-center gap-2 p-1.5 bg-gray-100 dark:bg-slate-800 rounded-2xl text-xs font-black uppercase">
          <button
            onClick={() => setActiveTab('queue')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeTab === 'queue'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-800 dark:hover:text-white'
            }`}
          >
            📋 Fila de Hoje ({summary.pending})
          </button>
          <button
            onClick={() => setActiveTab('connection')}
            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'connection'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-800 dark:hover:text-white'
            }`}
          >
            <Smartphone size={14} />
            {serverStatus.state === 'connected' ? 'WhatsApp Conectado' : 'Conectar WhatsApp'}
            <span
              className={`w-2 h-2 rounded-full ${
                serverStatus.state === 'connected' ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'
              }`}
            />
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeTab === 'logs'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-800 dark:hover:text-white'
            }`}
          >
            📜 Logs de Disparo
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`p-2 rounded-xl transition-all ${
              activeTab === 'config'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-800 dark:hover:text-white'
            }`}
            title="Configurações do Servidor"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* STATUS DA CONEXÃO WHATSAPP / QR CODE */}
      {activeTab === 'connection' && (
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-sm border border-emerald-100 dark:border-slate-800 space-y-6">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-4">
            <div>
              <h3 className="text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
                Conexão com WhatsApp no Servidor
              </h3>
              <p className="text-xs text-gray-500">
                O WhatsApp roda conectado 24 horas por dia no servidor Node/EC2 usando Baileys.
              </p>
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
              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800 font-black text-xs uppercase flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  Pronto para Disparos Automáticos
                </span>
              </div>
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
                      Aguardando leitura pelo celular...
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-12 space-y-4">
                    <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                      <QrCode size={36} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
                        Nenhum QR Code ativo no momento
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Clique no botão abaixo para inicializar o WhatsApp no servidor e gerar o código.
                      </p>
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
                <h4 className="font-black text-gray-900 dark:text-white text-base">
                  Como conectar seu WhatsApp:
                </h4>
                <ol className="space-y-3 text-xs text-gray-600 dark:text-gray-300 font-semibold list-decimal list-inside">
                  <li className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl">
                    Abra o <strong>WhatsApp</strong> no celular com o número de atendimento da EuDorama.
                  </li>
                  <li className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl">
                    Toque em <strong>Configurações / Menu (⋮)</strong> e selecione{' '}
                    <strong>Aparelhos Conectados</strong>.
                  </li>
                  <li className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl">
                    Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o QR Code ao lado.
                  </li>
                  <li className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl">
                    Assim que conectar, a sessão é salva no servidor. Você{' '}
                    <strong>não precisará escanear novamente</strong> mesmo se fechar o navegador!
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA PRINCIPAL: FILA DO DIA */}
      {activeTab === 'queue' && (
        <div className="space-y-6">
          {/* CARDS DE RESUMO E DISPARADOR */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-indigo-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-400">Total na Fila</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{summary.total}</p>
                <p className="text-[11px] text-gray-400 font-bold mt-0.5">{summary.pending} pendentes de envio</p>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <Calendar size={22} />
              </div>
            </div>

            <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-red-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-red-500">Vence Hoje (D0)</p>
                <p className="text-2xl font-black text-red-600">{summary.due}</p>
                <p className="text-[11px] text-gray-400 font-bold mt-0.5">Cobrança gentil do dia</p>
              </div>
              <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
                <Clock size={22} />
              </div>
            </div>

            <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-blue-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-blue-500">Vence em Breve (D-5 a D-1)</p>
                <p className="text-2xl font-black text-blue-600">{summary.reminder}</p>
                <p className="text-[11px] text-gray-400 font-bold mt-0.5">Lembrete sem cobrança antecipada</p>
              </div>
              <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                <ShieldCheck size={22} />
              </div>
            </div>

            <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-purple-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-purple-500">Vencidos & Reativação</p>
                <p className="text-2xl font-black text-purple-600">{summary.followup + summary.reactivation}</p>
                <p className="text-[11px] text-gray-400 font-bold mt-0.5">Follow-up empático e ofertas</p>
              </div>
              <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                <Zap size={22} />
              </div>
            </div>
          </div>

          {/* CARD DE AÇÃO DO ROBÔ DIÁRIO */}
          <div className="p-6 bg-gradient-to-r from-emerald-600 to-teal-700 rounded-[2.5rem] text-white shadow-lg flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-300 animate-ping" />
                <p className="text-xs font-black uppercase tracking-widest text-emerald-200">
                  Agendador Automático do Servidor
                </p>
              </div>
              <h3 className="text-xl font-black">
                Disparo Diário Programado para 09:30 (Brasília)
              </h3>
              <p className="text-xs text-emerald-100 font-semibold max-w-xl">
                O servidor envia sozinho com intervalos humanizados (10s a 18s) para blindar seu número de bloqueios.
                {serverStatus.scheduler?.lastCycleAt && (
                  <span className="block mt-1 text-emerald-200 font-bold">
                    Último ciclo executado: {new Date(serverStatus.scheduler.lastCycleAt).toLocaleString('pt-BR')} (
                    {serverStatus.scheduler.lastCycleSummary?.sent || 0} enviados)
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={fetchQueue}
                disabled={loading}
                className="px-4 py-3 rounded-2xl bg-white/20 hover:bg-white/30 text-white font-black text-xs uppercase transition-all backdrop-blur-sm flex items-center gap-2"
                title="Atualizar lista da fila"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Atualizar
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

          {/* BARRA DE FILTROS E PESQUISA */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-sm border border-gray-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setStageFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
                  stageFilter === 'all'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-gray-900'
                }`}
              >
                Todos ({summary.total})
              </button>
              <button
                onClick={() => setStageFilter('due')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
                  stageFilter === 'due'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-gray-900'
                }`}
              >
                Vence Hoje ({summary.due})
              </button>
              <button
                onClick={() => setStageFilter('reminder')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
                  stageFilter === 'reminder'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-gray-900'
                }`}
              >
                Lembretes ({summary.reminder})
              </button>
              <button
                onClick={() => setStageFilter('followup')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
                  stageFilter === 'followup'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-gray-900'
                }`}
              >
                Follow-up ({summary.followup})
              </button>
              <button
                onClick={() => setStageFilter('reactivation')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
                  stageFilter === 'reactivation'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:text-gray-900'
                }`}
              >
                Reativação ({summary.reactivation})
              </button>
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
                className="px-4 py-2 bg-gray-50 dark:bg-slate-800 rounded-xl text-xs font-bold border border-gray-200 dark:border-slate-700 outline-none w-64"
              />
            </div>
          </div>

          {/* LISTA DE CARDS DA FILA */}
          {filteredQueue.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-12 text-center border border-dashed border-gray-200 dark:border-slate-800 space-y-2">
              <CheckCircle2 size={36} className="text-emerald-500 mx-auto" />
              <p className="text-sm font-black text-gray-800 dark:text-white">
                Nenhum cliente pendente nesta categoria hoje!
              </p>
              <p className="text-xs text-gray-400">
                Todos os clientes aplicáveis já foram notificados ou não há vencimentos no período selecionado.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredQueue.map((item) => {
                const isExpanded = expandedPreviewId === item.id;
                const isSending = sendingId === item.id;

                let stageBadgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
                if (item.stage === 'due') stageBadgeColor = 'bg-red-50 text-red-700 border-red-200';
                if (item.stage === 'followup') stageBadgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
                if (item.stage === 'reactivation') stageBadgeColor = 'bg-purple-50 text-purple-700 border-purple-200';

                return (
                  <div
                    key={item.id}
                    className={`p-5 rounded-3xl border transition-all ${
                      item.alreadySentToday
                        ? 'bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-800/40'
                        : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-800 shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-black text-gray-900 dark:text-white text-sm">{item.clientName}</p>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${stageBadgeColor}`}>
                            {item.stageLabel}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-gray-500 mt-0.5">
                          {item.phoneNumber} · <strong className="text-indigo-600 dark:text-indigo-400">{item.service}</strong> ({item.priceFormatted})
                        </p>
                        <p className="text-[11px] text-gray-400 font-bold">
                          Vencimento: {item.expiryDateStr}
                        </p>
                      </div>

                      <div>
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

                    {/* PREVIEW DA MENSAGEM */}
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-800">
                      <button
                        onClick={() => setExpandedPreviewId(isExpanded ? null : item.id)}
                        className="text-xs font-bold text-gray-500 hover:text-indigo-600 flex items-center justify-between w-full"
                      >
                        <span>Ver mensagem gerada</span>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 p-3 bg-gray-50 dark:bg-slate-800/70 rounded-2xl text-xs text-gray-700 dark:text-gray-200 font-medium whitespace-pre-wrap border border-gray-100 dark:border-slate-700">
                          {item.message}
                        </div>
                      )}
                    </div>

                    {/* BOTÕES DE DISPARO */}
                    <div className="mt-4 flex items-center justify-between gap-2">
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
                          <ExternalLink size={14} />
                          WhatsApp Web
                        </button>

                        <button
                          onClick={() => handleSendSingleViaServer(item)}
                          disabled={isSending || serverStatus.state !== 'connected'}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase flex items-center gap-1.5 transition-all shadow-md disabled:opacity-40"
                          title="Enviar imediatamente usando o servidor"
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

      {/* ABA DE LOGS */}
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
              <RefreshCw size={14} /> Atualizar Logs
            </button>
          </div>

          {logs.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-xs font-bold">
              Nenhum log registrado ainda. Os disparos do servidor aparecerão aqui automaticamente.
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
                  <div className="space-y-0.5">
                    <p className="font-bold flex items-center gap-2">
                      <span>{log.clientName}</span>
                      <span className="text-[10px] opacity-70">({log.phoneNumber})</span>
                      <span className="px-2 py-0.5 rounded-full bg-white/70 dark:bg-slate-800 text-[10px] font-black uppercase">
                        {log.stage}
                      </span>
                    </p>
                    {log.error ? (
                      <p className="text-red-600 dark:text-red-400 font-semibold text-[11px]">Erro: {log.error}</p>
                    ) : (
                      <p className="text-gray-500 dark:text-gray-400 text-[11px] truncate max-w-xl">
                        {log.messageText}
                      </p>
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
                      {new Date(log.timestamp).toLocaleTimeString('pt-BR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABA DE CONFIGURAÇÃO */}
      {activeTab === 'config' && (
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-gray-100 dark:border-slate-800 space-y-6">
          <div className="border-b border-gray-100 dark:border-slate-800 pb-3">
            <h3 className="font-black text-gray-900 dark:text-white text-base">Configurações do Servidor de Cobrança</h3>
            <p className="text-xs text-gray-400">Parâmetros de conexão e rotina automática.</p>
          </div>

          <div className="space-y-4 max-w-xl">
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600 dark:text-gray-300">
                URL Base do Motor / Servidor (Opcional)
              </label>
              <input
                type="text"
                value={motorBaseUrl}
                onChange={(e) => {
                  setMotorBaseUrl(e.target.value);
                  localStorage.setItem('whatsapp_motor_base_url', e.target.value);
                }}
                placeholder="Ex: http://localhost:3000 ou https://seu-tunnel.trycloudflare.com"
                className="w-full p-3 bg-gray-50 dark:bg-slate-800 rounded-2xl text-xs font-bold border border-gray-200 dark:border-slate-700 outline-none"
              />
              <p className="text-[11px] text-gray-400">
                Se o painel estiver rodando na mesma porta/origem que o motor, deixe vazio. Se estiver usando tunnel Cloudflare para a AWS, cole a URL do tunnel aqui.
              </p>
            </div>

            <div className="p-4 bg-indigo-50 dark:bg-slate-800/50 rounded-2xl border border-indigo-100 dark:border-slate-700 space-y-2">
              <h4 className="text-xs font-black uppercase text-indigo-700 dark:text-indigo-400">
                Como rodar o Motor 24/7 na sua AWS EC2:
              </h4>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                1. Conecte na sua EC2 via SSH: <code>ssh -i sua-chave.pem ubuntu@seu-ip</code>
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                2. Entre na pasta do projeto e inicie com PM2:
              </p>
              <pre className="p-3 bg-slate-900 text-emerald-400 rounded-xl text-xs overflow-x-auto font-mono">
                cd /home/ubuntu/eudorama.com{"\n"}
                pm2 restart "viki-motor" || pm2 start "npx tsx automation-server.ts" --name "viki-motor"{"\n"}
                pm2 save
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
