
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppCredential, ClientDBRow, User } from '../types';
import { fetchCredentials, saveCredential, deleteCredential } from '../services/credentialService';
import { getAllClients, saveClientToDB, resetAllClientPasswords, hardDeleteAllClients } from '../services/clientService';
import { 
    Plus, Trash2, Edit2, LogOut, Users, Search, AlertTriangle, X, ShieldAlert, Key, 
    Clock, CheckCircle2, RefreshCw, Phone, Mail, Lock, Loader2, Eye, EyeOff, 
    Calendar, Download, Upload, Shield, LayoutGrid, SortAsc, SortDesc, RotateCw, 
    ShieldCheck, UsersRound, ArrowUpRight, ArrowDownRight, DollarSign, MessageCircle,
    Sun, Moon, Fingerprint, Copy, Check, Zap
} from 'lucide-react';

// --- PROPS INTERFACE ---
interface AdminPanelProps {
  onLogout: () => void;
}

const SERVICES: string[] = ['Viki Pass', 'Kocowa+', 'IQIYI', 'WeTV', 'DramaBox', 'Youku'];
const PLAN_OPTIONS: { label: string; value: string }[] = [
    { label: '1 Mês', value: '1' },
    { label: '3 Meses', value: '3' },
    { label: '6 Meses', value: '6' },
    { label: '12 Meses', value: '12' },
];

const CAPACITY_LIMITS: Record<string, number> = {
    'viki pass': 6,
    'kocowa+': 7,
    'iqiyi': 15,
    'wetv': 9999,
    'dramabox': 9999,
    'youku': 9999
};

const toLocalInput = (isoString: string) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        const offset = date.getTimezoneOffset() * 60000;
        const localDate = new Date(date.getTime() - offset);
        return localDate.toISOString().slice(0, 16);
    } catch(e) { return ''; }
};

const toDateInput = (isoString: string) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        return date.toISOString().split('T')[0];
    } catch(e) { return ''; }
};

function normalizeSubscriptions(subs: any, defaultDuration: number = 1): string[] {
    let list: any[] = [];
    if (Array.isArray(subs)) {
        list = subs;
    } else if (typeof subs === 'string') {
        let cleaned = (subs as string).replace(/^\{|\}$/g, '');
        if (!cleaned) list = [];
        else if (cleaned.includes(';')) list = cleaned.split(';'); 
        else if (cleaned.includes(',')) list = cleaned.split(',');
        else if (cleaned.includes('+')) list = cleaned.split('+');
        else list = [cleaned];
    }
    
    const result: string[] = (list || [])
        .map((s: any): string => {
            let str = String(s).trim().replace(/^"|"$/g, '');
            if (!str) return '';
            const parts = str.split('|');
            const name = parts[0] || 'Desconhecido';
            const date = parts[1] || new Date().toISOString();
            const status = parts[2] || '0'; 
            const duration = (parts[3] && parts[3].trim() !== '') ? parts[3] : String(defaultDuration || 1);
            return `${name}|${date}|${status}|${duration}`;
        });

    return result.filter((s: string): boolean => s.length > 0 && s.toLowerCase() !== 'null' && s !== '""' && !s.startsWith('|'));
}

const calculateExpiry = (dateStr: string, months: number) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date(); 
    d.setMonth(d.getMonth() + (months || 1));
    return d;
};

const getDaysRemaining = (expiryDate: Date) => {
    const now = new Date();
    expiryDate.setHours(0,0,0,0);
    now.setHours(0,0,0,0);
    return Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

const getCredentialHealth = (service: string, publishedAt: string, currentUsers: number) => {
    const pubDate = new Date(publishedAt);
    const now = new Date();
    const diffTime = now.getTime() - pubDate.getTime();
    const daysActive = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const serviceLower = service.toLowerCase();
    const limit = CAPACITY_LIMITS[serviceLower] || 10;
    let expiryLimit = 30;
    if (serviceLower.includes('viki')) expiryLimit = 14;
    else if (serviceLower.includes('kocowa')) expiryLimit = 25;
    const daysRemaining = expiryLimit - daysActive;
    if (daysRemaining < 0) return { label: 'Vencida', color: 'text-red-600 bg-red-50 border-red-200', icon: <AlertTriangle size={14}/> };
    if (currentUsers >= limit && limit < 9000) return { label: 'Lotada', color: 'text-purple-600 bg-purple-50 border-purple-200', icon: <UsersRound size={14}/> };
    return { label: 'Saudável', color: 'text-green-600 bg-green-50 border-green-200', icon: <CheckCircle2 size={14}/> };
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'clients' | 'credentials' | 'buscar_login' | 'danger'>('clients'); 
  const [clientFilterStatus, setClientFilterStatus] = useState<'all' | 'charged' | 'expiring' | 'debtor'>('all');
  const [darkMode, setDarkMode] = useState(false);
  const [credentials, setCredentials] = useState<AppCredential[]>([]);
  const [clients, setClients] = useState<ClientDBRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingClient, setSavingClient] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [loginSearchQuery, setLoginSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const [credForm, setCredForm] = useState<Partial<AppCredential>>({ service: SERVICES[0], email: '', password: '', isVisible: true, publishedAt: new Date().toISOString() });
  const [credSortOrder, setCredSortOrder] = useState<'asc' | 'desc'>('desc');
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [credModalOpen, setCredModalOpen] = useState(false);
  
  const [newSubService, setNewSubService] = useState(SERVICES[0]);
  const [newSubPlan, setNewSubPlan] = useState('1'); 

  const [clientForm, setClientForm] = useState<Partial<ClientDBRow>>({
      phone_number: '', client_name: '', subscriptions: [], duration_months: 1, is_debtor: false, purchase_date: toLocalInput(new Date().toISOString()), client_password: ''
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
        const [creds, allClients] = await Promise.all([fetchCredentials(), getAllClients()]);
        setCredentials(creds.filter(c => c.service !== 'SYSTEM_CONFIG'));
        setClients(allClients);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const credentialUsage = useMemo<Record<string, number>>(() => {
    const usage: Record<string, number> = {};
    if (credentials.length === 0 || clients.length === 0) return usage;
    clients.filter(c => !c.deleted).forEach(client => {
        const subs = normalizeSubscriptions(client.subscriptions || [], client.duration_months);
        subs.forEach(sub => {
            const parts = sub.split('|');
            const sName = parts[0].trim().toLowerCase();
            const serviceCreds = credentials
                .filter(c => c.isVisible && c.service.toLowerCase().includes(sName))
                .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
            if (serviceCreds.length > 0) {
                const clientsForService = clients
                    .filter(c => !c.deleted && normalizeSubscriptions(c.subscriptions || [], c.duration_months).some(s => s.toLowerCase().includes(sName)))
                    .sort((a, b) => a.phone_number.localeCompare(b.phone_number));
                const rank = clientsForService.findIndex(c => c.id === client.id);
                if (rank !== -1) {
                    const credIndex = rank % serviceCreds.length;
                    const assigned = serviceCreds[credIndex];
                    if (assigned) usage[assigned.id] = (usage[assigned.id] || 0) + 1;
                }
            }
        });
    });
    return usage;
  }, [clients, credentials]);

  const groupedCredentials = useMemo<Record<string, AppCredential[]>>(() => {
    const groups: Record<string, AppCredential[]> = {};
    const sorted = [...credentials].sort((a, b) => {
        const timeA = new Date(a.publishedAt).getTime();
        const timeB = new Date(b.publishedAt).getTime();
        return credSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    });
    sorted.forEach(c => {
        if (!groups[c.service]) groups[c.service] = [];
        groups[c.service].push(c);
    });
    return groups;
  }, [credentials, credSortOrder]);

  const filteredClients = useMemo<ClientDBRow[]>(() => {
    let list = clients.filter(c => !c.deleted);
    
    if (clientFilterStatus === 'debtor') {
        list = list.filter(c => {
            const subs = normalizeSubscriptions(c.subscriptions || [], c.duration_months);
            return subs.some(s => getDaysRemaining(calculateExpiry(s.split('|')[1], parseInt(s.split('|')[3] || '1'))) < 0);
        });
    } else if (clientFilterStatus === 'charged') {
        list = list.filter(c => {
            const subs = normalizeSubscriptions(c.subscriptions || [], c.duration_months);
            return subs.some(s => s.split('|')[2] === '1');
        });
    } else if (clientFilterStatus === 'expiring') {
        list = list.filter(c => normalizeSubscriptions(c.subscriptions || [], c.duration_months).some(s => {
            const parts = s.split('|');
            const days = getDaysRemaining(calculateExpiry(parts[1], parseInt(parts[3] || '1')));
            return days <= 5 && days >= 0;
        }));
    }

    if (clientSearch) {
        const lower = clientSearch.toLowerCase();
        list = list.filter(c => c.phone_number.includes(lower) || c.client_name?.toLowerCase().includes(lower));
    }
    return list;
  }, [clients, clientSearch, clientFilterStatus]);

  // --- BUSCA DE LOGINS (FUZZY) ---
  const loginSearchResults = useMemo(() => {
    if (!loginSearchQuery || loginSearchQuery.length < 2) return [];
    const query = loginSearchQuery.toLowerCase();
    
    // Filtra clientes pelo nome ou telefone
    const matchedClients = clients.filter(c => 
        !c.deleted && 
        ((c.client_name?.toLowerCase().includes(query)) || (c.phone_number.includes(query)))
    );

    return matchedClients.map(client => {
        const subs = normalizeSubscriptions(client.subscriptions || [], client.duration_months);
        
        const subAccesses = subs.map(sub => {
            const parts = sub.split('|');
            const serviceName = parts[0].trim();
            const serviceLower = serviceName.toLowerCase();
            const expiry = calculateExpiry(parts[1], parseInt(parts[3] || '1'));
            const daysLeft = getDaysRemaining(expiry);

            // Descobrir qual credencial este cliente está usando para este serviço
            const serviceCreds = credentials
                .filter(c => c.isVisible && c.service.toLowerCase().includes(serviceLower))
                .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

            let assignedLogin = "Não vinculada";
            if (serviceCreds.length > 0) {
                const clientsForThisService = clients
                    .filter(c => !c.deleted && normalizeSubscriptions(c.subscriptions || [], c.duration_months).some(s => s.toLowerCase().includes(serviceLower)))
                    .sort((a, b) => a.phone_number.localeCompare(b.phone_number));
                
                const rank = clientsForThisService.findIndex(c => c.id === client.id);
                if (rank !== -1) {
                    const credIndex = rank % serviceCreds.length;
                    assignedLogin = serviceCreds[credIndex].email;
                }
            }

            return {
                serviceName,
                login: assignedLogin,
                daysLeft,
                isExpired: daysLeft < 0
            };
        });

        return {
            clientName: client.client_name || "Sem Nome",
            phoneNumber: client.phone_number,
            accesses: subAccesses
        };
    });
  }, [clients, credentials, loginSearchQuery]);

  const handleSaveClient = async () => {
    if (!clientForm.phone_number) return;
    setSavingClient(true);
    const { success } = await saveClientToDB(clientForm);
    if (success) {
      setClientModalOpen(false);
      loadData();
    }
    setSavingClient(false);
  };

  const handleSaveCred = async () => {
    if (!credForm.email || !credForm.password) return;
    setLoading(true);
    await saveCredential(credForm as AppCredential);
    setCredModalOpen(false);
    loadData();
    setLoading(false);
  };

  const handleMarkAsChargedQuick = async (client: ClientDBRow, subIndex: number) => {
    const subs = normalizeSubscriptions(client.subscriptions, client.duration_months);
    const parts = subs[subIndex].split('|');
    subs[subIndex] = `${parts[0]}|${parts[1]}|1|${parts[3] || '1'}`;
    await saveClientToDB({ ...client, subscriptions: subs });
    loadData();
  };

  const handleRenewSmart = async (client: ClientDBRow, subIndex: number) => {
    const subs = normalizeSubscriptions(client.subscriptions, client.duration_months);
    const parts = subs[subIndex].split('|');
    const serviceName = parts[0];
    const oldStartDate = parts[1];
    const months = parseInt(parts[3] || '1');
    
    const currentExpiry = calculateExpiry(oldStartDate, months);
    const today = new Date();
    
    const newStartDate = currentExpiry.getTime() < today.getTime() ? today : currentExpiry;
    
    subs[subIndex] = `${serviceName}|${newStartDate.toISOString()}|1|${months}`;
    await saveClientToDB({ ...client, subscriptions: subs });
    loadData();
  };

  // Lógica de Renovação Inteligente para uso DENTRO do modal (atualiza o estado clientForm)
  const handleModalSmartRenew = (subIndex: number) => {
    const currentSubs = [...((clientForm.subscriptions as string[] | undefined) || [])];
    if (!currentSubs[subIndex]) return;

    const parts = currentSubs[subIndex].split('|');
    const serviceName = parts[0];
    const oldStartDate = parts[1];
    const months = parseInt(parts[3] || '1');
    
    const currentExpiry = calculateExpiry(oldStartDate, months);
    const today = new Date();
    
    // Se já venceu, começa de hoje. Se ainda é válido, começa do dia que ia vencer.
    const newStartDate = currentExpiry.getTime() < today.getTime() ? today : currentExpiry;
    
    // Atualiza o sub: Nome | NovaDataInício | Cobrado(1) | MesesMantidos
    currentSubs[subIndex] = `${serviceName}|${newStartDate.toISOString()}|1|${months}`;
    
    setClientForm({
        ...clientForm,
        subscriptions: currentSubs
    });
  };

  const sendWhatsAppMessage = (phone: string, name: string, service: string, expiryDate: Date) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const daysLeft = getDaysRemaining(expiryDate);
    
    let message = "";
    if (daysLeft < 0) {
        message = `Olá ${name}! 🍿 Notamos que sua assinatura do ${service} venceu. Gostaria de renovar para continuar assistindo seus doramas favoritos conosco? Sem pressão, quando puder nos avise! 💖`;
    } else {
        message = `Olá ${name}! 👋 Passando para avisar que sua assinatura do ${service} vence em ${daysLeft} dias (${expiryDate.toLocaleDateString()}). Se quiser renovar antecipadamente para não perder o acesso, estamos à disposição! ✨`;
    }
    
    window.open(`https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 ${darkMode ? "dark bg-slate-950 text-slate-100" : "bg-indigo-50/30 text-indigo-950"}`}>
      <div className="bg-white dark:bg-slate-900 px-6 py-5 flex justify-between items-center shadow-sm sticky top-0 z-30 border-b border-indigo-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
              <div className="bg-indigo-600 p-2.5 rounded-2xl text-white shadow-lg"><ShieldAlert size={24} /></div>
              <h1 className="font-black text-xl">EuDorama Admin</h1>
          </div>
          <div className="flex items-center gap-2">
              <button onClick={() => setDarkMode(!darkMode)} className="p-2.5 rounded-xl bg-indigo-50 dark:bg-slate-800 text-indigo-600">
                  {darkMode ? <Sun size={20}/> : <Moon size={20}/>}
              </button>
              <button onClick={onLogout} className="flex items-center gap-2 text-red-500 bg-red-50 dark:bg-red-900/20 px-4 py-2.5 rounded-xl font-bold text-xs uppercase">
                  Sair
              </button>
          </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 mt-8 space-y-6">
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl shadow-sm border border-indigo-100 dark:border-slate-800">
              {[
                  {id: 'clients', icon: Users, label: 'Clientes'},
                  {id: 'buscar_login', icon: Search, label: 'Buscar Login'},
                  {id: 'credentials', icon: Key, label: 'Contas'},
                  {id: 'danger', icon: AlertTriangle, label: 'Segurança'}
              ].map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 py-3 px-4 rounded-xl text-[10px] font-black uppercase transition-all flex flex-col sm:flex-row items-center justify-center gap-1.5 ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-md' : 'text-indigo-400 hover:bg-indigo-50'}`}>
                      <tab.icon size={16} /> <span className="hidden sm:inline">{tab.label}</span>
                  </button>
              ))}
          </div>

          {activeTab === 'clients' && (
              <div className="space-y-6 animate-fade-in pb-32">
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-4">
                      <div className="flex items-center gap-3 bg-indigo-50 dark:bg-slate-800 px-5 py-4 rounded-2xl border border-indigo-100 dark:border-slate-700">
                          <Search className="text-indigo-400" size={24} />
                          <input className="bg-transparent outline-none text-base font-bold w-full" placeholder="Buscar por nome ou WhatsApp..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                          {[
                              {id: 'all', label: 'Todos', color: 'bg-indigo-600 text-white'},
                              {id: 'charged', label: 'Cobrados', color: 'bg-emerald-100 text-emerald-700'},
                              {id: 'expiring', label: 'Vencendo', color: 'bg-orange-100 text-orange-700'},
                              {id: 'debtor', label: 'Pendentes', color: 'bg-red-100 text-red-700'}
                          ].map(f => (
                              <button key={f.id} onClick={() => setClientFilterStatus(f.id as any)} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase border transition-all ${clientFilterStatus === f.id ? f.color : 'bg-white dark:bg-slate-900 text-indigo-300 border-indigo-100'}`}>{f.label}</button>
                          ))}
                      </div>
                      <button onClick={() => { setClientForm({ phone_number: '', client_name: '', subscriptions: [], client_password: '' }); setClientModalOpen(true); }} className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-100">
                          <Plus size={24}/> Novo Cliente
                      </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredClients.map((client) => (
                          <div key={client.id} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-indigo-50 dark:border-slate-800 flex flex-col hover:border-indigo-200 transition-all">
                              <div className="flex justify-between items-start mb-4">
                                  <div className="min-w-0">
                                      <h3 className="font-black text-gray-900 dark:text-white text-lg truncate leading-tight">{client.client_name || 'Sem Nome'}</h3>
                                      <p className="text-xs font-bold text-indigo-400 mt-1 flex items-center gap-1.5"><Phone size={12}/> {client.phone_number}</p>
                                  </div>
                                  <button onClick={() => { setClientForm({ ...client, subscriptions: normalizeSubscriptions(client.subscriptions, client.duration_months) }); setClientModalOpen(true); }} className="p-3 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all"><Edit2 size={18}/></button>
                              </div>
                              
                              <div className="space-y-3 mb-4">
                                  {(normalizeSubscriptions(client.subscriptions || [], client.duration_months) as string[]).map((sub, i) => {
                                      const parts = sub.split('|');
                                      const serviceName = parts[0];
                                      const expiry = calculateExpiry(parts[1], parseInt(parts[3] || '1'));
                                      const daysLeft = getDaysRemaining(expiry);
                                      const isCharged = parts[2] === '1';
                                      
                                      let statusColor = "bg-green-50 text-green-700 border-green-100"; 
                                      if (daysLeft < 0) statusColor = "bg-red-50 text-red-600 border-red-100";
                                      else if (daysLeft <= 5) statusColor = "bg-amber-50 text-amber-600 border-amber-100";
                                      
                                      return (
                                          <div key={i} className={`p-4 rounded-2xl border flex flex-col gap-3 transition-all ${statusColor}`}>
                                              <div className="flex justify-between items-center">
                                                  <div className="flex flex-col">
                                                      <span className="font-black text-xs uppercase tracking-wider">{serviceName}</span>
                                                      <span className="text-[10px] font-bold opacity-80">
                                                          {daysLeft < 0 ? 'Vencido há ' + Math.abs(daysLeft) + 'd' : `Vence em ${expiry.toLocaleDateString()} (${daysLeft}d)`}
                                                      </span>
                                                  </div>
                                                  <div className="flex gap-1.5">
                                                      <button 
                                                          onClick={() => sendWhatsAppMessage(client.phone_number, client.client_name || 'Dorameira', serviceName, expiry)}
                                                          className="p-2.5 bg-white/50 hover:bg-emerald-500 hover:text-white rounded-xl transition-all"
                                                          title="Enviar Mensagem WhatsApp"
                                                      >
                                                          <MessageCircle size={16} className="text-emerald-600 hover:text-inherit" />
                                                      </button>
                                                      {!isCharged && (
                                                        <button 
                                                            onClick={() => handleMarkAsChargedQuick(client, i)}
                                                            className="p-2.5 bg-white/50 text-indigo-600 border border-indigo-100 rounded-xl hover:bg-indigo-600 hover:text-white transition-all"
                                                            title="Marcar como Cobrado"
                                                        >
                                                            <DollarSign size={16} />
                                                        </button>
                                                      )}
                                                  </div>
                                              </div>
                                              <button 
                                                  onClick={() => handleRenewSmart(client, i)}
                                                  className="w-full py-2.5 bg-white/80 dark:bg-slate-800/80 hover:bg-indigo-600 hover:text-white rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-all shadow-sm border border-white"
                                              >
                                                  <RotateCw size={14} /> Renovar +{parts[3] || '1'} Mês
                                              </button>
                                          </div>
                                      );
                                  })}
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          )}

          {activeTab === 'buscar_login' && (
              <div className="space-y-6 animate-fade-in pb-32">
                  <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-6">
                      <div className="flex flex-col gap-2">
                        <h2 className="text-2xl font-black text-gray-900 dark:text-white">Buscar Acessos</h2>
                        <p className="text-sm text-indigo-400 font-bold uppercase tracking-widest">Localize logins de assinaturas por cliente</p>
                      </div>

                      <div className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                              <Search className="text-indigo-400 group-focus-within:text-indigo-600 transition-colors" size={24} />
                          </div>
                          <input 
                            className="w-full bg-indigo-50 dark:bg-slate-800 pl-14 pr-5 py-5 rounded-2xl font-black text-lg outline-none border-2 border-transparent focus:border-indigo-600 transition-all shadow-inner" 
                            placeholder="Nome ou WhatsApp do cliente..." 
                            value={loginSearchQuery} 
                            onChange={e => setLoginSearchQuery(e.target.value)} 
                          />
                      </div>
                  </div>

                  <div className="space-y-4">
                      {loginSearchResults.length === 0 && loginSearchQuery.length >= 2 ? (
                          <div className="text-center py-20 bg-white/50 rounded-3xl border border-dashed border-indigo-200">
                             <Fingerprint className="mx-auto w-16 h-16 text-indigo-200 mb-4" />
                             <p className="text-indigo-400 font-black uppercase tracking-tighter">Nenhum cliente encontrado</p>
                          </div>
                      ) : (
                        loginSearchResults.map((res, i) => (
                            <div key={i} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-indigo-100 dark:border-slate-800 animate-slide-up">
                                <div className="flex justify-between items-center mb-6 px-2">
                                    <div>
                                        <h4 className="font-black text-xl text-gray-900 dark:text-white leading-none">{res.clientName}</h4>
                                        <p className="text-xs font-bold text-indigo-400 mt-1 flex items-center gap-1.5"><Phone size={12}/> {res.phoneNumber}</p>
                                    </div>
                                    <div className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest">
                                        {res.accesses.length} Assinaturas
                                    </div>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-separate border-spacing-y-2">
                                        <thead>
                                            <tr className="text-[10px] font-black uppercase text-indigo-300 tracking-widest">
                                                <th className="px-4 py-2">Aplicativo</th>
                                                <th className="px-4 py-2">Status</th>
                                                <th className="px-4 py-2">E-mail de Acesso</th>
                                                <th className="px-4 py-2 text-right">Ação</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {res.accesses.map((acc, idx) => (
                                                <tr key={idx} className={`group hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors ${acc.isExpired ? 'opacity-60' : ''}`}>
                                                    <td className="px-4 py-4 rounded-l-2xl bg-gray-50 dark:bg-slate-800/50">
                                                        <span className="font-black text-sm text-gray-800 dark:text-gray-200">{acc.serviceName}</span>
                                                    </td>
                                                    <td className="px-4 py-4 bg-gray-50 dark:bg-slate-800/50">
                                                        <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase border ${acc.isExpired ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}>
                                                            {acc.isExpired ? 'Expirada' : 'Ativa'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-4 bg-gray-50 dark:bg-slate-800/50">
                                                        <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">{acc.login}</span>
                                                    </td>
                                                    <td className="px-4 py-4 rounded-r-2xl bg-gray-50 dark:bg-slate-800/50 text-right">
                                                        <button 
                                                            onClick={() => copyToClipboard(acc.login, `copy-login-${i}-${idx}`)}
                                                            className="p-2 hover:bg-white rounded-lg transition-all text-indigo-400 hover:text-indigo-600 shadow-sm"
                                                            title="Copiar Login"
                                                        >
                                                            {copiedId === `copy-login-${i}-${idx}` ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))
                      )}
                  </div>
              </div>
          )}

          {activeTab === 'credentials' && (
              <div className="space-y-6 animate-fade-in pb-32">
                  <div className="flex justify-between items-center px-2">
                        <h3 className="font-bold text-xl flex items-center gap-2"><Key className="text-indigo-600"/> Gestão de Contas</h3>
                        <button onClick={() => { setCredForm({ service: SERVICES[0], email: '', password: '', isVisible: true, publishedAt: new Date().toISOString() }); setCredModalOpen(true); }} className="bg-indigo-600 text-white px-5 py-3 rounded-xl text-xs font-black uppercase flex items-center gap-2 shadow-lg"><Plus size={20}/> Nova Conta</button>
                  </div>
                  <div className="space-y-8">
                    {Object.entries(groupedCredentials).map(([serviceName, creds]) => (
                        <div key={serviceName} className="space-y-4">
                            <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest px-2">{serviceName}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {(creds as AppCredential[]).map(c => {
                                    const count = credentialUsage[c.id] || 0;
                                    const health = getCredentialHealth(c.service, c.publishedAt, count);
                                    return (
                                        <div key={c.id} className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-indigo-50 dark:border-slate-800">
                                            <div className="flex justify-between items-center mb-4">
                                                <div className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border ${health.color}`}>{health.label}</div>
                                                <div className="flex gap-2">
                                                    <button onClick={() => { setCredForm(c); setCredModalOpen(true); }} className="text-gray-400 hover:text-indigo-600"><Edit2 size={18}/></button>
                                                    <button onClick={async () => { if(confirm("Excluir conta?")) {await deleteCredential(c.id); loadData();} }} className="text-gray-300 hover:text-red-500"><Trash2 size={18}/></button>
                                                </div>
                                            </div>
                                            <p className="font-bold text-lg text-gray-800 dark:text-white break-all">{c.email}</p>
                                            <p className="font-mono text-sm text-indigo-400 mt-1 bg-indigo-50/50 p-2 rounded-lg inline-block">{c.password}</p>
                                            <div className="mt-5 pt-4 border-t border-indigo-50 dark:border-slate-800 flex justify-between items-center text-xs font-bold text-gray-400">
                                                <span className="flex items-center gap-1.5"><Calendar size={14}/> {new Date(c.publishedAt).toLocaleDateString()}</span>
                                                <span className="flex items-center gap-1.5"><Users size={14}/> {count} ativos</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                  </div>
              </div>
          )}

          {activeTab === 'danger' && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-10 animate-fade-in text-center px-6">
                  <div className="bg-red-50 dark:bg-red-900/20 p-10 rounded-full animate-pulse"><Shield className="w-16 h-16 text-red-500" /></div>
                  <div className="w-full max-w-sm space-y-4 pb-32">
                      <h2 className="text-2xl font-black text-red-600">Zona de Perigo</h2>
                      <button onClick={async () => { if(confirm("Deseja resetar todas as senhas de clientes?")) await resetAllClientPasswords(); loadData(); }} className="w-full bg-white dark:bg-slate-900 border-2 border-red-100 text-red-500 font-black py-5 rounded-2xl text-sm uppercase shadow-sm">Resetar Senhas Clientes</button>
                      <button onClick={async () => { if(prompt("DIGITE 1202 PARA APAGAR TUDO") === "1202") await hardDeleteAllClients(); loadData(); }} className="w-full bg-red-600 text-white font-black py-5 rounded-2xl shadow-xl text-sm uppercase">Limpar Banco de Dados</button>
                  </div>
              </div>
          )}
      </main>

      {/* MODAL CLIENTE */}
      {clientModalOpen && (
          <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto border-4 border-indigo-50">
                  <div className="flex justify-between items-center mb-8">
                      <h3 className="font-black text-xl text-gray-900 dark:text-white leading-none">{clientForm.id ? 'Editar Perfil' : 'Novo Cliente'}</h3>
                      <button onClick={() => setClientModalOpen(false)} className="p-2.5 bg-indigo-50 dark:bg-slate-800 rounded-full text-indigo-400"><X size={24}/></button>
                  </div>
                  <div className="space-y-6">
                      <div className="space-y-2">
                          <label className="text-xs font-black uppercase text-indigo-400 ml-1">WhatsApp (DDD + Número)</label>
                          <input className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border-2 border-transparent focus:border-indigo-300" value={clientForm.phone_number} onChange={e => setClientForm({...clientForm, phone_number: e.target.value})} placeholder="88999991234" />
                      </div>
                      <div className="space-y-2">
                          <label className="text-xs font-black uppercase text-indigo-400 ml-1">Nome Completo</label>
                          <input className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border-2 border-transparent focus:border-indigo-300" value={clientForm.client_name} onChange={e => setClientForm({...clientForm, client_name: e.target.value})} placeholder="Ex: Maria Silva" />
                      </div>

                      {/* NOVO CAMPO: SENHA DO CLIENTE */}
                      <div className="space-y-2">
                          <label className="text-xs font-black uppercase text-indigo-400 ml-1">Senha do Dashboard</label>
                          <div className="relative group">
                              <input 
                                className="w-full bg-indigo-50 dark:bg-slate-800 p-4 pl-12 rounded-2xl font-bold text-lg outline-none border-2 border-transparent focus:border-indigo-300 transition-all" 
                                value={clientForm.client_password || ''} 
                                onChange={e => setClientForm({...clientForm, client_password: e.target.value})} 
                                placeholder="Definir senha do cliente" 
                              />
                              <Lock className="absolute left-4 top-4 text-indigo-300 group-focus-within:text-indigo-600" size={20} />
                          </div>
                          <p className="text-[10px] font-bold text-gray-400 ml-1">Esta é a senha que o cliente usa para entrar no app.</p>
                      </div>
                      
                      <div className="pt-4 space-y-5">
                          <p className="text-xs font-black uppercase text-indigo-400 tracking-widest border-b-2 border-indigo-50 pb-2">Gerenciar Assinaturas</p>
                          <div className="space-y-4">
                              {(normalizeSubscriptions(clientForm.subscriptions, clientForm.duration_months) as string[]).map((sub, i) => {
                                  const parts = sub.split('|');
                                  const serviceName = parts[0];
                                  const startDate = parts[1];
                                  const durationStr = parts[3] || String(clientForm.duration_months || 1);
                                  const duration = parseInt(durationStr);
                                  const expiryDate = calculateExpiry(startDate, duration);
                                  const isCharged = parts[2] === '1';
                                  
                                  return (
                                      <div key={i} className="flex flex-col p-5 bg-gray-50 dark:bg-slate-800 rounded-3xl border border-indigo-50 dark:border-slate-700 gap-4 shadow-sm">
                                          <div className="flex justify-between items-center">
                                              <p className="font-black text-gray-800 dark:text-white uppercase">{serviceName}</p>
                                              <div className="flex gap-2">
                                                  <button 
                                                      onClick={() => sendWhatsAppMessage(clientForm.phone_number || '', clientForm.client_name || 'Dorameira', serviceName, expiryDate)}
                                                      className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-xl"
                                                      title="Mandar cobrança WhatsApp"
                                                  >
                                                      <MessageCircle size={20} />
                                                  </button>
                                                  <button onClick={() => setClientForm({...clientForm, subscriptions: ((clientForm.subscriptions as string[] | undefined) || []).filter((_, idx) => idx !== i)})} className="p-2 text-red-400 hover:bg-red-50 rounded-xl"><Trash2 size={20} /></button>
                                              </div>
                                          </div>
                                          
                                          <div className="space-y-3">
                                              <div className="grid grid-cols-2 gap-3">
                                                  <div className="space-y-1">
                                                      <label className="text-[9px] font-black uppercase text-indigo-400 ml-1">Data de Início</label>
                                                      <input 
                                                          type="date" 
                                                          className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl text-xs font-bold outline-none border border-indigo-50" 
                                                          value={toDateInput(startDate)} 
                                                          onChange={(e) => {
                                                              const n = [...((clientForm.subscriptions as string[] | undefined) || [])];
                                                              if (n[i]) {
                                                                  const p = n[i].split('|');
                                                                  n[i] = `${p[0]}|${new Date(e.target.value).toISOString()}|${p[2]}|${p[3] || '1'}`;
                                                                  setClientForm({...clientForm, subscriptions: n});
                                                              }
                                                          }}
                                                      />
                                                  </div>
                                                  <div className="space-y-1">
                                                      <label className="text-[9px] font-black uppercase text-indigo-400 ml-1">Plano</label>
                                                      <div className="flex gap-1.5">
                                                          <select 
                                                              className="flex-1 bg-white dark:bg-slate-900 p-2 rounded-xl text-xs font-black outline-none border border-indigo-50 h-[34px]" 
                                                              value={durationStr} 
                                                              onChange={(e) => {
                                                                  const n = [...((clientForm.subscriptions as string[] | undefined) || [])];
                                                                  if (n[i]) {
                                                                      const p = n[i].split('|');
                                                                      n[i] = `${p[0]}|${p[1]}|${p[2]}|${e.target.value}`;
                                                                      setClientForm({...clientForm, subscriptions: n});
                                                                  }
                                                              }}
                                                          >
                                                              {PLAN_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                          </select>
                                                          {/* BOTÃO INTELIGENTE DE RENOVAÇÃO (DENTRO DO MODAL) */}
                                                          <button 
                                                            onClick={() => handleModalSmartRenew(i)}
                                                            className="p-1.5 bg-indigo-600 text-white rounded-xl shadow-sm hover:bg-indigo-700 transition-all active:scale-90"
                                                            title="Renovação Inteligente (Adicionar +1 Mês com lógica de continuidade)"
                                                          >
                                                            <Zap size={16} />
                                                          </button>
                                                      </div>
                                                  </div>
                                              </div>
                                              
                                              <div className="grid grid-cols-2 gap-2">
                                                  <div className="bg-indigo-50/50 dark:bg-slate-900/50 p-2.5 rounded-xl border border-indigo-100/50 flex justify-between items-center">
                                                      <span className="text-[9px] font-black text-indigo-400 uppercase">Fim</span>
                                                      <span className="text-xs font-black text-indigo-600">{expiryDate.toLocaleDateString()}</span>
                                                  </div>
                                                  <button 
                                                      onClick={() => {
                                                          const n = [...((clientForm.subscriptions as string[] | undefined) || [])];
                                                          if (n[i]) {
                                                              const p = n[i].split('|');
                                                              n[i] = `${p[0]}|${p[1]}|${isCharged ? '0' : '1'}|${p[3] || '1'}`;
                                                              setClientForm({...clientForm, subscriptions: n});
                                                          }
                                                      }}
                                                      className={`rounded-xl text-[9px] font-black uppercase border transition-all ${isCharged ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-600 border-indigo-100'}`}
                                                  >
                                                      {isCharged ? 'Cobrado ✓' : 'Marcar Cobrado'}
                                                  </button>
                                              </div>
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                          <div className="p-6 bg-indigo-50/50 dark:bg-slate-800 rounded-[2.5rem] border-2 border-dashed border-indigo-100 dark:border-slate-700 space-y-4">
                              <p className="text-[10px] font-black uppercase text-indigo-400 text-center">Adicionar Novo Aplicativo</p>
                              <div className="grid grid-cols-2 gap-3">
                                  <select className="w-full bg-white dark:bg-slate-900 p-3 rounded-2xl font-bold text-xs outline-none border border-indigo-50" value={newSubService} onChange={e => setNewSubService(e.target.value)}>
                                      {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                  <select className="w-full bg-white dark:bg-slate-900 p-3 rounded-2xl font-bold text-xs outline-none border border-indigo-50" value={newSubPlan} onChange={e => setNewSubPlan(e.target.value)}>
                                      {PLAN_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                  </select>
                              </div>
                              <button onClick={() => {
                                  setClientForm({...clientForm, subscriptions: [...((clientForm.subscriptions as string[] | undefined) || []), `${newSubService}|${new Date().toISOString()}|0|${newSubPlan}`]});
                              }} className="w-full bg-indigo-600 text-white p-4 rounded-2xl flex items-center justify-center gap-2 font-black text-xs uppercase shadow-md"><Plus size={18}/> Incluir Plano</button>
                          </div>
                      </div>
                      <button onClick={handleSaveClient} disabled={savingClient} className="w-full bg-indigo-600 text-white font-black py-5 rounded-3xl shadow-xl mt-6 active:scale-95 transition-transform">
                          {savingClient ? <Loader2 className="w-6 h-6 animate-spin mx-auto"/> : 'Salvar Alterações'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL CONTA */}
      {credModalOpen && (
          <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative border border-indigo-100">
                  <div className="flex justify-between items-center mb-8">
                      <h3 className="font-black text-xl text-gray-900 dark:text-white leading-none">{credForm.id ? 'Editar Conta' : 'Nova Conta'}</h3>
                      <button onClick={() => setCredModalOpen(false)} className="p-2.5 bg-gray-100 dark:bg-slate-800 rounded-full text-gray-400"><X size={24}/></button>
                  </div>
                  <div className="space-y-5">
                      <div className="space-y-2">
                          <label className="text-xs font-black uppercase text-indigo-400 ml-1">Serviço</label>
                          <select className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border border-indigo-100" value={credForm.service} onChange={e => setCredForm({...credForm, service: e.target.value})}>
                              {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                      </div>
                      <div className="space-y-2">
                          <label className="text-xs font-black uppercase text-indigo-400 ml-1">E-mail / Login</label>
                          <input className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border border-indigo-100" value={credForm.email} onChange={e => setCredForm({...credForm, email: e.target.value})} placeholder="email@exemplo.com" />
                      </div>
                      <div className="space-y-2">
                          <label className="text-xs font-black uppercase text-indigo-400 ml-1">Senha</label>
                          <input className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border border-indigo-100" value={credForm.password} onChange={e => setCredForm({...credForm, password: e.target.value})} placeholder="******" />
                      </div>
                      <div className="space-y-2">
                          <label className="text-xs font-black uppercase text-indigo-400 ml-1">Data de Publicação</label>
                          <input type="datetime-local" className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border border-indigo-100" value={toLocalInput(credForm.publishedAt || new Date().toISOString())} onChange={e => setCredForm({...credForm, publishedAt: new Date(e.target.value).toISOString()})} />
                      </div>
                      <button onClick={handleSaveCred} disabled={loading} className="w-full bg-indigo-600 text-white font-black py-5 rounded-3xl shadow-xl mt-6 active:scale-95 transition-transform">{loading ? <Loader2 className="animate-spin w-6 h-6 mx-auto"/> : 'Salvar Dados'}</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
