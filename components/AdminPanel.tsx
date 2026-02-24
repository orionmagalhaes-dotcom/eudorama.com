
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppCredential, ClientDBRow, User } from '../types';
import { fetchCredentials, saveCredential, deleteCredential } from '../services/credentialService';
import { getAllClients, saveClientToDB, resetAllClientPasswords, hardDeleteAllClients, getHistoryLogs, clearHistoryLogs, updateHistorySetting, getHistorySettings, enforceHistoryRetention, supabase } from '../services/clientService';
import {
    Plus, Trash2, Edit2, LogOut, Users, Search, AlertTriangle, X, ShieldAlert, Key,
    Clock, CheckCircle2, RefreshCw, Phone, Mail, Lock, Loader2, Eye, EyeOff,
    Calendar, Download, Upload, Shield, LayoutGrid, SortAsc, SortDesc, RotateCw,
    ShieldCheck, UsersRound, ArrowUpRight, ArrowDownRight, MessageCircle,
    Sun, Moon, Fingerprint, Copy, Check, Zap, BarChart3, TrendingUp, Wallet, PieChart, Undo2, TrendingDown, Settings2,
    Activity, Banknote, CreditCard, Eraser, ListFilter, ArrowUpDown, Wifi, Filter, ChevronRight, History
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

// CAPACITY_LIMITS moved to financeConfig.ts for single source of truth

import { getServicePrice } from '../services/pricingConfig';
import { getAccountCost, getCostSplit, getRevenueSplit, DEFAULT_AD_SPEND_PER_DAY, DAYS_IN_MONTH, formatCurrency, getCapacityLimit } from '../services/financeConfig';

const toLocalInput = (isoString: string) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        const offset = date.getTimezoneOffset() * 60000;
        const localDate = new Date(date.getTime() - offset);
        return localDate.toISOString().slice(0, 16);
    } catch (e) { return ''; }
};

const toDateInput = (isoString: string) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        return date.toISOString().split('T')[0];
    } catch (e) { return ''; }
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
            const date = parts[1] || '1970-01-01T00:00:00.000Z'; // Use stable old date instead of new Date()
            const status = parts[2] || '0';
            const duration = (parts[3] && parts[3].trim() !== '') ? parts[3] : String(defaultDuration || 1);
            const tolerance = parts[4] || '';
            // 6th field: original payment date (for renewal calculations)
            // If not present, use the current date as original payment date
            const originalPaymentDate = parts[5] || date;
            return `${name}|${date}|${status}|${duration}|${tolerance}|${originalPaymentDate}`;
        });

    return result.filter((s: string): boolean => s.length > 0 && s.toLowerCase() !== 'null' && s !== '""' && !s.startsWith('|'));
}

const calculateExpiry = (dateStr: string, months: number) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date();
    const daysToAdd = (months || 1) * 30;
    d.setDate(d.getDate() + daysToAdd);
    return d;
};

const getDaysRemaining = (expiryDate: Date) => {
    const now = new Date();
    expiryDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    return Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

const safeDateMs = (value?: string | null) => {
    if (!value) return 0;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? 0 : ms;
};

const getExpiringSortMeta = (client: ClientDBRow) => {
    const subs = normalizeSubscriptions(client.subscriptions || [], client.duration_months);
    const expiring = subs
        .map((s) => {
            const parts = s.split('|');
            const startMs = safeDateMs(parts[1]);
            const duration = parseInt(parts[3] || '1');
            const expiry = calculateExpiry(parts[1], duration);
            const days = getDaysRemaining(expiry);
            return { startMs, expiryMs: expiry.getTime(), days };
        })
        .filter((item) => item.days <= 5 && item.days >= 0);

    if (expiring.length === 0) {
        return {
            nearestExpiryMs: Number.MAX_SAFE_INTEGER,
            inclusionMs: safeDateMs(client.created_at) || safeDateMs(client.purchase_date)
        };
    }

    const nearestExpiryMs = Math.min(...expiring.map((item) => item.expiryMs));
    const latestSubStartMs = Math.max(...expiring.map((item) => item.startMs));
    const inclusionMs = Math.max(latestSubStartMs, safeDateMs(client.created_at), safeDateMs(client.purchase_date));
    return { nearestExpiryMs, inclusionMs };
};

const getChargeTagMeta = (client: Partial<ClientDBRow>) => {
    const gp = client.game_progress || {};
    const lastAt = gp?._charge_whatsapp_last_at || null;
    const lastAtMs = safeDateMs(lastAt);
    const hasSent = Boolean(client.is_contacted || lastAtMs);
    return {
        hasSent,
        label: hasSent && lastAtMs ? `Cobranca enviada em ${new Date(lastAtMs).toLocaleDateString()}` : 'Cobranca enviada'
    };
};

const getCredentialHealth = (service: string, publishedAt: string, currentUsers: number) => {
    const pubDate = new Date(publishedAt);
    const now = new Date();
    const diffTime = now.getTime() - pubDate.getTime();
    const daysActive = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const serviceLower = service.toLowerCase();
    const limit = getCapacityLimit(service);
    let expiryLimit = 30;
    if (serviceLower.includes('viki')) expiryLimit = 14;
    else if (serviceLower.includes('kocowa')) expiryLimit = 25;
    const daysRemaining = expiryLimit - daysActive;
    if (daysRemaining < 0) return { label: 'Vencida', color: 'text-red-600 bg-red-50 border-red-200', icon: <AlertTriangle size={14} /> };
    // Superlotada: at or above the capacity limit
    if (currentUsers >= limit && limit < 9000) return { label: 'Superlotada', color: 'text-orange-600 bg-orange-50 border-orange-200', icon: <UsersRound size={14} /> };
    return { label: 'Saudável', color: 'text-green-600 bg-green-50 border-green-200', icon: <CheckCircle2 size={14} /> };
};

const CREDENTIAL_ASSIGNMENT_SNAPSHOT_KEY = 'credential_assignment_snapshot_v2';
const CREDENTIAL_EXIT_HISTORY_KEY = 'credential_exit_history_v2';

type CredentialClientEntry = {
    clientId: string;
    name: string;
    phoneNumber: string;
    startDate: string;
    expiryDate: Date;
    daysLeft: number;
    reason: string;
    serviceName: string;
};

type CredentialExitEntry = {
    eventKey: string;
    clientId: string;
    name: string;
    phoneNumber: string;
    serviceLower: string;
    serviceName: string;
    reason: string;
    leftAt: string;
};

type CredentialAssignmentCurrentEntry = {
    clientId: string;
    clientName: string;
    phoneNumber: string;
    serviceLower: string;
    serviceName: string;
    credentialId: string;
    credentialVersion: string;
    credentialPublishedAt: string;
};

type CredentialAssignmentSnapshotEntry = CredentialAssignmentCurrentEntry & {
    assignedAt: string;
};

type CredentialCardDetails = {
    versionKey: string;
    entries: CredentialClientEntry[];
    exitedEntries: CredentialExitEntry[];
    hasExpired: boolean;
    expiredClient?: { name: string; phoneNumber: string; expiryDate: Date; daysLeft: number };
};

const getCredentialVersionKey = (credential: Pick<AppCredential, 'id' | 'publishedAt'>) => {
    return `${credential.id}::${safeDateMs(credential.publishedAt)}`;
};

const matchesCredentialService = (credentialService: string, serviceLower: string) => {
    const dbService = (credentialService || '').toLowerCase().trim();
    const subService = (serviceLower || '').toLowerCase().trim();
    if (!dbService || !subService) return false;
    return dbService.includes(subService) || subService.includes(dbService);
};

const parseHistoryMap = <T,>(rawValue: string | undefined, fallback: T): T => {
    if (!rawValue) return fallback;
    try {
        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== 'object') return fallback;
        return parsed as T;
    } catch {
        return fallback;
    }
};

const buildAssignmentSignature = (map: Record<string, { credentialVersion: string }>) => {
    const keys = Object.keys(map).sort();
    return keys.map(k => `${k}|${map[k].credentialVersion}`).join('||');
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ onLogout }) => {
    const [activeTab, setActiveTab] = useState<'clients' | 'credentials' | 'buscar_login' | 'danger' | 'finances' | 'trash' | 'history'>('clients');
    const [clientFilterStatus, setClientFilterStatus] = useState<'all' | 'expiring' | 'debtor' | 'tolerance'>('all');
    const [clientSortByExpiry, setClientSortByExpiry] = useState(false);
    const [darkMode, setDarkMode] = useState(false);
    const [credentials, setCredentials] = useState<AppCredential[]>([]);
    const [clients, setClients] = useState<ClientDBRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [savingClient, setSavingClient] = useState(false);
    const [clientSearch, setClientSearch] = useState('');
    const [loginSearchQuery, setLoginSearchQuery] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // States para o novo filtro de vencimentos
    const [dateStart, setDateStart] = useState('');
    const [dateEnd, setDateEnd] = useState('');
    const [groupedVencimentos, setGroupedVencimentos] = useState<any[]>([]);
    const [totalPeriod, setTotalPeriod] = useState(0);
    const [orionPeriod, setOrionPeriod] = useState(0);
    const [iohannaPeriod, setIohannaPeriod] = useState(0);

    const [projectionMonths, setProjectionMonths] = useState<number>(1);
    const [statsReferenceDate, setStatsReferenceDate] = useState<number>(() => {
        const saved = localStorage.getItem('admin_stats_reference');
        if (saved) return parseInt(saved);
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    });
    const [isConfirmingReset, setIsConfirmingReset] = useState(false);

    const [credForm, setCredForm] = useState<Partial<AppCredential>>({ service: SERVICES[0], email: '', password: '', isVisible: true, publishedAt: new Date().toISOString() });
    const [credSortOrder, setCredSortOrder] = useState<'asc' | 'desc'>('desc');
    const [expandedCreds, setExpandedCreds] = useState<Record<string, boolean>>({});
    const [clientModalOpen, setClientModalOpen] = useState(false);
    const [credModalOpen, setCredModalOpen] = useState(false);

    const [newSubService, setNewSubService] = useState(SERVICES[0]);
    const [newSubPlan, setNewSubPlan] = useState('1');
    const [daysToAddInputs, setDaysToAddInputs] = useState<Record<number, number>>({});

    const [clientForm, setClientForm] = useState<Partial<ClientDBRow>>({
        phone_number: '', client_name: '', subscriptions: [], duration_months: 1, is_debtor: false, purchase_date: toLocalInput(new Date().toISOString()), client_password: '', observation: ''
    });

    // History State
    const [historyLogs, setHistoryLogs] = useState<any[]>([]);
    const [retentionDays, setRetentionDays] = useState('7');
    const [historyLoading, setHistoryLoading] = useState(false);
    const [credentialAssignmentSnapshot, setCredentialAssignmentSnapshot] = useState<Record<string, CredentialAssignmentSnapshotEntry>>({});
    const [credentialExitHistory, setCredentialExitHistory] = useState<Record<string, CredentialExitEntry[]>>({});
    const [credentialTrackingReady, setCredentialTrackingReady] = useState(false);
    const reconcileSignatureRef = useRef('');

    // Ad Spend State (persisted in localStorage)
    const [adSpendEnabled, setAdSpendEnabled] = useState<boolean>(() => {
        const saved = localStorage.getItem('admin_ad_spend_enabled');
        return saved ? saved === 'true' : true;
    });
    const [adSpendPerDay, setAdSpendPerDay] = useState<number>(() => {
        const saved = localStorage.getItem('admin_ad_spend_per_day');
        return saved ? parseFloat(saved) : DEFAULT_AD_SPEND_PER_DAY;
    });

    // Persist ad spend settings
    useEffect(() => {
        localStorage.setItem('admin_ad_spend_enabled', String(adSpendEnabled));
    }, [adSpendEnabled]);
    useEffect(() => {
        localStorage.setItem('admin_ad_spend_per_day', String(adSpendPerDay));
    }, [adSpendPerDay]);

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [creds, allClients, logs, settings] = await Promise.all([fetchCredentials(), getAllClients(), getHistoryLogs(), getHistorySettings()]);

            // --- AUTO CLEANUP LOGIC ---
            // 1. Remove subscriptions expired > 5 days ago
            // 2. Trash clients with no active subs (if they had some before and now act empty)

            const now = new Date();
            const fiveDaysAgo = new Date();
            fiveDaysAgo.setDate(now.getDate() - 5);

            const updates: Promise<any>[] = [];

            allClients.forEach(client => {
                const subs = normalizeSubscriptions(client.subscriptions, client.duration_months);

                // LOGIC 1: RESTORE TRASHED CLIENTS WITH ACTIVE SUBS
                if (client.deleted) {
                    const hasActiveSub = subs.some(s => {
                        const parts = s.split('|');
                        const duration = parseInt(parts[3] || '1');
                        const expiry = calculateExpiry(parts[1], duration);
                        // If it expires in the future (or very recently), it's active.
                        // Using a looser check here to be safe: Expiry > fiveDaysAgo
                        return expiry.getTime() >= fiveDaysAgo.getTime();
                    });

                    if (hasActiveSub) {
                        console.log(`[SAFETY RESTORE] Restaurando ${client.client_name} da lixeira (Assinatura Ativa).`);
                        updates.push(saveClientToDB({ ...client, deleted: false }));
                    }
                    return; // Next client
                }

                // LOGIC 2: CLEANUP ACTIVE CLIENTS
                if (subs.length === 0) return; // Already empty

                let changed = false;
                const activeSubs = subs.filter(s => {
                    const parts = s.split('|');
                    const duration = parseInt(parts[3] || '1');
                    const expiry = calculateExpiry(parts[1], duration);

                    // IF expiry is BEFORE fiveDaysAgo, remove it.
                    if (expiry.getTime() < fiveDaysAgo.getTime()) {
                        changed = true;
                        return false; // Remove
                    }
                    return true; // Keep
                });

                if (changed) {
                    if (activeSubs.length === 0) {
                        // Move to trash if no subs left
                        // KEEP the original subscriptions so admin can see history in trash
                        console.log(`[CLEANUP] Movendo ${client.client_name} para lixeira (Sem assinaturas).`);
                        updates.push(saveClientToDB({ ...client, deleted: true }));
                    } else {
                        // Just update subs
                        console.log(`[CLEANUP] Removendo assinaturas antigas de ${client.client_name}.`);
                        updates.push(saveClientToDB({ ...client, subscriptions: activeSubs }));
                    }
                }
            });

            if (updates.length > 0) {
                await Promise.all(updates);
                // Reload to reflect changes
                const refreshed = await getAllClients();
                setClients(refreshed);
            } else {
                setClients(allClients);
            }

            setCredentials(creds.filter(c => c.service !== 'SYSTEM_CONFIG'));
            setHistoryLogs(logs);
            setCredentialAssignmentSnapshot(parseHistoryMap<Record<string, CredentialAssignmentSnapshotEntry>>(settings[CREDENTIAL_ASSIGNMENT_SNAPSHOT_KEY], {}));
            setCredentialExitHistory(parseHistoryMap<Record<string, CredentialExitEntry[]>>(settings[CREDENTIAL_EXIT_HISTORY_KEY], {}));
            setCredentialTrackingReady(true);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    const handleConsultVencimentos = () => {
        if (!dateStart || !dateEnd) return;
        const start = new Date(dateStart);
        start.setHours(0, 0, 0, 0);
        const end = new Date(dateEnd);
        end.setHours(23, 59, 59, 999);

        const activeClients = clients.filter(c => !c.deleted);
        const clientMap: Record<string, any> = {};
        let globalSum = 0;
        let orionPeriodRevenue = 0;
        let iohannaPeriodRevenue = 0;

        activeClients.forEach(client => {
            const subs = normalizeSubscriptions(client.subscriptions, client.duration_months);
            subs.forEach(sub => {
                const parts = sub.split('|');
                const sName = parts[0];
                const startDate = parts[1];
                const duration = parseInt(parts[3] || '1');
                const expiry = calculateExpiry(startDate, duration);

                if (expiry >= start && expiry <= end) {
                    const price = getServicePrice(sName, duration);
                    const split = getRevenueSplit(sName);

                    if (!clientMap[client.phone_number]) {
                        clientMap[client.phone_number] = {
                            name: client.client_name || 'Sem Nome',
                            phone: client.phone_number,
                            vencimentos: [],
                            totalUser: 0
                        };
                    }

                    clientMap[client.phone_number].vencimentos.push({
                        service: sName,
                        expiry: expiry,
                        price: price,
                        isMonthly: duration === 1
                    });

                    clientMap[client.phone_number].totalUser += price;
                    globalSum += price;
                    orionPeriodRevenue += price * split.orion;
                    iohannaPeriodRevenue += price * split.iohanna;
                }
            });
        });

        const finalResults = Object.values(clientMap).sort((a, b) => a.name.localeCompare(b.name));
        setGroupedVencimentos(finalResults);
        setTotalPeriod(globalSum);
        setOrionPeriod(orionPeriodRevenue);
        setIohannaPeriod(iohannaPeriodRevenue);
    };

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text.trim());
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const financeStats = useMemo(() => {
        const activeClients = clients.filter(c => !c.deleted);

        let grossRevenue = 0;
        let pendingRevenue = 0;
        const serviceBreakdown: Record<string, { count: number, monthlyCount: number, revenue: number, pending: number }> = {};

        SERVICES.forEach(s => serviceBreakdown[s] = { count: 0, monthlyCount: 0, revenue: 0, pending: 0 });

        // Admin revenue tracking
        let orionRevenue = 0;
        let iohannaRevenue = 0;

        // Count active monthly subscriptions for revenue
        activeClients.forEach(client => {
            const subs = normalizeSubscriptions(client.subscriptions, client.duration_months);
            subs.forEach(sub => {
                const parts = sub.split('|');
                const duration = parseInt(parts[3] || '1');

                // Only count monthly subscriptions (duration = 1 month)
                if (duration !== 1) return;

                const sName = parts[0];
                const startDate = parts[1];
                const price = getServicePrice(sName, duration);

                const expiry = calculateExpiry(startDate, duration);
                const daysLeft = getDaysRemaining(expiry);

                if (serviceBreakdown[sName]) {
                    // Only count non-expired subscriptions for revenue
                    if (daysLeft >= 0) {
                        grossRevenue += price;
                        serviceBreakdown[sName].revenue += price;

                        // Calculate admin revenue split
                        const split = getRevenueSplit(sName);
                        orionRevenue += price * split.orion;
                        iohannaRevenue += price * split.iohanna;
                    } else {
                        pendingRevenue += price;
                        serviceBreakdown[sName].pending += price;
                    }
                    serviceBreakdown[sName].count++;
                    serviceBreakdown[sName].monthlyCount++;
                }
            });
        });

        // --- ACCOUNT COSTS ---
        // Count credentials by service to calculate costs
        const accountCosts: Record<string, { count: number, costPerAccount: number, totalCost: number }> = {};
        let totalAccountCosts = 0;
        let orionCosts = 0;
        let iohannaCosts = 0;

        credentials.forEach(cred => {
            if (!cred.isVisible) return;
            const serviceName = cred.service;
            const cost = getAccountCost(serviceName);

            if (cost > 0) {
                if (!accountCosts[serviceName]) {
                    accountCosts[serviceName] = { count: 0, costPerAccount: cost, totalCost: 0 };
                }
                accountCosts[serviceName].count++;
                accountCosts[serviceName].totalCost += cost;
                totalAccountCosts += cost;

                // Calculate cost split per admin
                const split = getCostSplit(serviceName);
                orionCosts += cost * split.orion;
                iohannaCosts += cost * split.iohanna;
            }
        });

        // --- AD SPEND ---
        const monthlyAdSpend = adSpendEnabled ? adSpendPerDay * DAYS_IN_MONTH : 0;
        // Ad spend split: Orion 70%, Iohanna 30%
        const orionAdSpend = monthlyAdSpend * 0.70;
        const iohannaAdSpend = monthlyAdSpend * 0.30;

        // --- NET PROFIT ---
        const orionProfit = orionRevenue - orionCosts - orionAdSpend;
        const iohannaProfit = iohannaRevenue - iohannaCosts - iohannaAdSpend;
        const totalProfit = grossRevenue - totalAccountCosts - monthlyAdSpend;

        // Count new and lost subscriptions from HISTORY LOGS since reset date
        // Only count monthly subscriptions (look for "30 dias" in log details)
        let newSubscriptionsSinceReset = 0;
        let churnedSubscriptionsSinceReset = 0;

        historyLogs.forEach(log => {
            const logTime = new Date(log.created_at).getTime();
            // Only count logs after the reset date
            if (logTime <= statsReferenceDate) return;

            const details = log.details || '';
            // Only count if it's a 30-day (monthly) subscription
            const isMonthly = details.includes('30 dias');
            if (!isMonthly) return;

            if (log.action === 'Assinatura Adicionada') {
                newSubscriptionsSinceReset++;
            } else if (log.action === 'Assinatura Removida' || log.action === 'Cliente Removido') {
                churnedSubscriptionsSinceReset++;
            }
        });

        const totalSubscriptionsCounted = Object.values(serviceBreakdown).reduce((acc, curr) => acc + curr.monthlyCount, 0);

        const churnRate = totalSubscriptionsCounted > 0 ? (churnedSubscriptionsSinceReset / (totalSubscriptionsCounted + churnedSubscriptionsSinceReset)) * 100 : 0;
        const avgTicket = totalSubscriptionsCounted > 0 ? grossRevenue / totalSubscriptionsCounted : 0;
        const projection = grossRevenue + (newSubscriptionsSinceReset * avgTicket * projectionMonths);

        return {
            grossRevenue,
            pendingRevenue,
            totalClients: totalSubscriptionsCounted,
            newClientsThisMonth: newSubscriptionsSinceReset,
            churnCount: churnedSubscriptionsSinceReset,
            churnRate,
            serviceBreakdown,
            projection,
            averageTicket: avgTicket,
            // NEW: Costs and Admin splits
            accountCosts,
            totalAccountCosts,
            monthlyAdSpend,
            totalProfit,
            orion: {
                revenue: orionRevenue,
                costs: orionCosts,
                adSpend: orionAdSpend,
                profit: orionProfit
            },
            iohanna: {
                revenue: iohannaRevenue,
                costs: iohannaCosts,
                adSpend: iohannaAdSpend,
                profit: iohannaProfit
            }
        };
    }, [clients, projectionMonths, statsReferenceDate, historyLogs, credentials, adSpendEnabled, adSpendPerDay]);


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

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return 'Sem data';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return 'Sem data';
        return d.toLocaleDateString();
    };

    const credentialAssignmentData = useMemo(() => {
        const details: Record<string, CredentialCardDetails> = {};
        const assignments: Record<string, CredentialAssignmentCurrentEntry> = {};
        if (credentials.length === 0 || clients.length === 0) return { details, assignments };

        const sortedCredentials = [...credentials]
            .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

        sortedCredentials.forEach(credential => {
            const versionKey = getCredentialVersionKey(credential);
            const persistedExits = Array.isArray(credentialExitHistory[versionKey]) ? credentialExitHistory[versionKey] : [];
            details[credential.id] = {
                versionKey,
                entries: [],
                exitedEntries: [...persistedExits].sort((a, b) => new Date(b.leftAt).getTime() - new Date(a.leftAt).getTime()),
                hasExpired: false
            };
        });

        const visibleServiceCreds = sortedCredentials.filter(c => c.isVisible && !(c.email || '').toLowerCase().includes('demo'));
        if (visibleServiceCreds.length === 0) return { details, assignments };

        const getAssignedCredential = (client: ClientDBRow, serviceCreds: AppCredential[]) => {
            const phoneHash = client.phone_number.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const credIndex = phoneHash % serviceCreds.length;
            return serviceCreds[credIndex];
        };

        const getSubscriptionDetail = (subscriptions: string[], client: ClientDBRow, serviceLower: string) => {
            for (const sub of subscriptions) {
                const parts = sub.split('|');
                const name = (parts[0] || '').trim();
                if (!name) continue;
                const nameLower = name.toLowerCase();
                if (!nameLower.includes(serviceLower)) continue;
                const startDate = parts[1] || client.purchase_date;
                const duration = parseInt(parts[3] || String(client.duration_months || 1));
                return { serviceName: name, startDate, duration };
            }
            return null;
        };

        const sortedClients = [...clients].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        sortedClients.forEach(client => {
            const subscriptions = normalizeSubscriptions(client.subscriptions || [], client.duration_months);
            if (subscriptions.length === 0) return;

            const serviceKeys = new Set<string>();
            subscriptions.forEach(sub => {
                const parts = sub.split('|');
                const name = (parts[0] || '').trim().toLowerCase();
                if (name) serviceKeys.add(name);
            });

            serviceKeys.forEach(serviceLower => {
                const detail = getSubscriptionDetail(subscriptions, client, serviceLower);
                if (!detail) return;

                const serviceCreds = visibleServiceCreds
                    .filter(c => matchesCredentialService(c.service, serviceLower))
                    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
                if (serviceCreds.length === 0) return;

                const assigned = getAssignedCredential(client, serviceCreds);
                if (!assigned) return;

                const expiryDate = calculateExpiry(detail.startDate, detail.duration);
                const daysLeft = getDaysRemaining(expiryDate);
                if (daysLeft < 0 && new Date(assigned.publishedAt).getTime() > expiryDate.getTime()) return;

                if (!details[assigned.id]) {
                    details[assigned.id] = {
                        versionKey: getCredentialVersionKey(assigned),
                        entries: [],
                        exitedEntries: [],
                        hasExpired: false
                    };
                }

                if (!client.deleted) {
                    details[assigned.id].entries.push({
                        clientId: client.id,
                        name: client.client_name || 'Sem Nome',
                        phoneNumber: client.phone_number,
                        startDate: detail.startDate,
                        expiryDate,
                        daysLeft,
                        reason: 'Distribuicao automatica (hash do telefone)',
                        serviceName: detail.serviceName
                    });

                    const associationKey = `${client.id}::${serviceLower}`;
                    assignments[associationKey] = {
                        clientId: client.id,
                        clientName: client.client_name || 'Sem Nome',
                        phoneNumber: client.phone_number,
                        serviceLower,
                        serviceName: detail.serviceName,
                        credentialId: assigned.id,
                        credentialVersion: getCredentialVersionKey(assigned),
                        credentialPublishedAt: assigned.publishedAt
                    };
                }

                if (daysLeft < 0 && !details[assigned.id].hasExpired) {
                    details[assigned.id].hasExpired = true;
                    details[assigned.id].expiredClient = { name: client.client_name || 'Sem Nome', phoneNumber: client.phone_number, expiryDate, daysLeft };
                }
            });
        });

        return { details, assignments };
    }, [clients, credentials, credentialExitHistory]);

    const credentialClientDetails = credentialAssignmentData.details;
    const currentCredentialAssignments = credentialAssignmentData.assignments;

    useEffect(() => {
        if (!credentialTrackingReady) return;

        const previousSnapshot = credentialAssignmentSnapshot || {};
        const currentAssignments = currentCredentialAssignments || {};
        const previousSignature = buildAssignmentSignature(previousSnapshot);
        const currentSignature = buildAssignmentSignature(currentAssignments);
        const reconcileSignature = `${previousSignature}>>${currentSignature}`;

        if (reconcileSignatureRef.current === reconcileSignature) return;
        reconcileSignatureRef.current = reconcileSignature;
        if (previousSignature === currentSignature) return;

        const nowIso = new Date().toISOString();
        const clientsById = new Map<string, ClientDBRow>();
        clients.forEach(client => clientsById.set(client.id, client));

        const getSubscriptionDetail = (client: ClientDBRow, serviceLower: string) => {
            const subscriptions = normalizeSubscriptions(client.subscriptions || [], client.duration_months);
            for (const sub of subscriptions) {
                const parts = sub.split('|');
                const name = (parts[0] || '').trim();
                if (!name) continue;
                if (!name.toLowerCase().includes(serviceLower)) continue;
                const startDate = parts[1] || client.purchase_date;
                const duration = parseInt(parts[3] || String(client.duration_months || 1));
                return { startDate, duration };
            }
            return null;
        };

        const getExitReason = (entry: CredentialAssignmentSnapshotEntry) => {
            const client = clientsById.get(entry.clientId);
            if (!client) return 'Cliente removido do banco';
            if (client.deleted) return 'Cliente excluido da credencial (lixeira)';
            const detail = getSubscriptionDetail(client, entry.serviceLower);
            if (!detail) return 'Assinatura removida ou alterada';
            const expiryDate = calculateExpiry(detail.startDate, detail.duration);
            const daysLeft = getDaysRemaining(expiryDate);
            if (daysLeft < 0 && new Date(entry.credentialPublishedAt).getTime() > expiryDate.getTime()) return 'Assinatura venceu antes desta credencial';
            return 'Sem acesso por outra regra';
        };

        const nextExitHistory: Record<string, CredentialExitEntry[]> = { ...credentialExitHistory };
        let exitHistoryChanged = false;

        Object.entries(previousSnapshot).forEach(([associationKey, previousEntry]) => {
            if (currentAssignments[associationKey]) return;

            const eventKey = `${associationKey}::${previousEntry.credentialVersion}::${previousEntry.assignedAt}`;
            const existing = Array.isArray(nextExitHistory[previousEntry.credentialVersion]) ? nextExitHistory[previousEntry.credentialVersion] : [];
            if (existing.some(item => item.eventKey === eventKey)) return;

            const event: CredentialExitEntry = {
                eventKey,
                clientId: previousEntry.clientId,
                name: previousEntry.clientName || 'Sem Nome',
                phoneNumber: previousEntry.phoneNumber,
                serviceLower: previousEntry.serviceLower,
                serviceName: previousEntry.serviceName || previousEntry.serviceLower,
                reason: getExitReason(previousEntry),
                leftAt: nowIso
            };
            nextExitHistory[previousEntry.credentialVersion] = [event, ...existing];
            exitHistoryChanged = true;
        });

        const nextSnapshot: Record<string, CredentialAssignmentSnapshotEntry> = {};
        Object.entries(currentAssignments).forEach(([associationKey, currentEntry]) => {
            const previous = previousSnapshot[associationKey];
            nextSnapshot[associationKey] = {
                ...currentEntry,
                assignedAt: previous && previous.credentialVersion === currentEntry.credentialVersion ? previous.assignedAt : nowIso
            };
        });

        const snapshotChanged = buildAssignmentSignature(nextSnapshot) !== previousSignature;
        if (!snapshotChanged && !exitHistoryChanged) return;

        if (snapshotChanged) setCredentialAssignmentSnapshot(nextSnapshot);
        if (exitHistoryChanged) setCredentialExitHistory(nextExitHistory);

        (async () => {
            if (snapshotChanged) await updateHistorySetting(CREDENTIAL_ASSIGNMENT_SNAPSHOT_KEY, JSON.stringify(nextSnapshot));
            if (exitHistoryChanged) await updateHistorySetting(CREDENTIAL_EXIT_HISTORY_KEY, JSON.stringify(nextExitHistory));
        })().catch(console.error);
    }, [clients, credentialAssignmentSnapshot, credentialExitHistory, credentialTrackingReady, currentCredentialAssignments]);

    const filteredClients = useMemo<ClientDBRow[]>(() => {
        const hasSearch = clientSearch && clientSearch.trim().length > 0;

        // Step 1: Start with the right base list
        // If actively searching, include ALL clients. Otherwise, hide deleted.
        let list = hasSearch ? [...clients] : clients.filter(c => !c.deleted);

        // Step 2: Apply text search filter
        if (hasSearch) {
            const query = clientSearch.toLowerCase().trim();
            list = list.filter(c =>
                (c.phone_number && c.phone_number.includes(query)) ||
                (c.client_name && c.client_name.toLowerCase().includes(query))
            );
        }

        // Step 3: Apply category filters (always exclude deleted from category views)
        if (clientFilterStatus === 'debtor') {
            list = list.filter(c => {
                if (c.deleted) return false;
                const subs = normalizeSubscriptions(c.subscriptions || [], c.duration_months);
                return subs.some(s => getDaysRemaining(calculateExpiry(s.split('|')[1], parseInt(s.split('|')[3] || '1'))) < 0);
            });
        } else if (clientFilterStatus === 'expiring') {
            list = list.filter(c => {
                if (c.deleted) return false;
                return normalizeSubscriptions(c.subscriptions || [], c.duration_months).some(s => {
                    const parts = s.split('|');
                    const days = getDaysRemaining(calculateExpiry(parts[1], parseInt(parts[3] || '1')));
                    return days <= 5 && days >= 0;
                });
            });
        } else if (clientFilterStatus === 'tolerance') {
            list = list.filter(c => {
                if (c.deleted) return false;
                const now = new Date();
                now.setHours(0, 0, 0, 0);

                return normalizeSubscriptions(c.subscriptions || [], c.duration_months).some(s => {
                    const parts = s.split('|');
                    const toleranceDate = parts[4] ? new Date(parts[4]) : null;
                    if (!toleranceDate || Number.isNaN(toleranceDate.getTime())) return false;
                    toleranceDate.setHours(23, 59, 59, 999);
                    return toleranceDate.getTime() >= now.getTime();
                });
            });
        }

        // Step 4: Apply sorting
        if (clientFilterStatus === 'expiring') {
            list = [...list].sort((a, b) => {
                const aMeta = getExpiringSortMeta(a);
                const bMeta = getExpiringSortMeta(b);
                if (aMeta.nearestExpiryMs !== bMeta.nearestExpiryMs) return aMeta.nearestExpiryMs - bMeta.nearestExpiryMs;
                return bMeta.inclusionMs - aMeta.inclusionMs;
            });
        } else if (clientFilterStatus === 'tolerance') {
            list = [...list].sort((a, b) => {
                const now = new Date();
                now.setHours(0, 0, 0, 0);

                const getNearestToleranceMs = (client: ClientDBRow) => {
                    const toleranceDates = normalizeSubscriptions(client.subscriptions || [], client.duration_months)
                        .map((s) => {
                            const parts = s.split('|');
                            const toleranceDate = parts[4] ? new Date(parts[4]) : null;
                            if (!toleranceDate || Number.isNaN(toleranceDate.getTime())) return Number.MAX_SAFE_INTEGER;
                            toleranceDate.setHours(23, 59, 59, 999);
                            return toleranceDate.getTime() >= now.getTime() ? toleranceDate.getTime() : Number.MAX_SAFE_INTEGER;
                        })
                        .filter((ms) => ms !== Number.MAX_SAFE_INTEGER);

                    return toleranceDates.length > 0 ? Math.min(...toleranceDates) : Number.MAX_SAFE_INTEGER;
                };

                return getNearestToleranceMs(a) - getNearestToleranceMs(b);
            });
        } else if (clientSortByExpiry) {
            list = [...list].sort((a, b) => {
                const getMinDays = (c: ClientDBRow) => {
                    if (c.deleted) return 99999;
                    const subs = normalizeSubscriptions(c.subscriptions, c.duration_months);
                    if (subs.length === 0) return 9999;
                    const days = subs.map(s => getDaysRemaining(calculateExpiry(s.split('|')[1], parseInt(s.split('|')[3] || '1'))));
                    return Math.min(...days);
                };
                return getMinDays(a) - getMinDays(b);
            });
        }

        return list;
    }, [clients, clientSearch, clientFilterStatus, clientSortByExpiry]);

    const deletedClientsList = useMemo(() => {
        return clients.filter(c => c.deleted);
    }, [clients]);

    const loginSearchResults = useMemo(() => {
        if (!loginSearchQuery || loginSearchQuery.length < 2) return [];
        const query = loginSearchQuery.toLowerCase();
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
                const serviceCreds = credentials
                    .filter(c => c.isVisible && c.service.toLowerCase().includes(serviceLower))
                    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

                let assignedLogin = "Não vinculada";
                let assignedPassword = "-";
                if (serviceCreds.length > 0) {
                    const clientsForThisService = clients
                        .filter(c => !c.deleted && normalizeSubscriptions(c.subscriptions || [], client.duration_months).some(s => s.toLowerCase().includes(serviceLower)))
                        .sort((a, b) => a.phone_number.localeCompare(b.phone_number));
                    const rank = clientsForThisService.findIndex(c => c.id === client.id);
                    if (rank !== -1) {
                        const credIndex = rank % serviceCreds.length;
                        assignedLogin = serviceCreds[credIndex].email;
                        assignedPassword = serviceCreds[credIndex].password || "-";
                    }
                }
                return { serviceName, login: assignedLogin, password: assignedPassword, daysLeft, isExpired: daysLeft < 0 };
            });
            return { clientName: client.client_name || "Sem Nome", phoneNumber: client.phone_number, accesses: subAccesses };
        });
    }, [clients, credentials, loginSearchQuery]);

    const handleSaveClient = async () => {
        if (!clientForm.phone_number) return;
        setSavingClient(true);
        const { success, msg } = await saveClientToDB(clientForm);
        if (success) {
            setClientModalOpen(false);
            loadData();
        } else {
            alert("Erro ao salvar: " + msg);
        }
        setSavingClient(false);
    };

    const handleSoftDeleteClient = async (client: ClientDBRow) => {
        if (!confirm(`Mover ${client.client_name || client.phone_number} para a lixeira?`)) return;
        setLoading(true);
        const { success, msg } = await saveClientToDB({ ...client, deleted: true });
        if (success) {
            loadData();
        } else {
            alert("Erro ao mover para lixeira: " + msg);
        }
        setLoading(false);
    };

    const handleRestoreClient = async (client: ClientDBRow) => {
        setLoading(true);
        const { success, msg } = await saveClientToDB({ ...client, deleted: false });
        if (success) {
            loadData();
        } else {
            alert("Erro ao restaurar: " + msg);
        }
        setLoading(false);
    };

    const handleSaveCred = async () => {
        if (!credForm.email || !credForm.password) return;
        setLoading(true);
        const existing = credForm.id ? credentials.find(c => c.id === credForm.id) : null;
        let publishedAt = credForm.publishedAt || new Date().toISOString();
        if (existing) {
            const emailChanged = existing.email !== credForm.email;
            const passwordChanged = existing.password !== credForm.password;
            if (emailChanged || passwordChanged) {
                publishedAt = new Date().toISOString();
            } else if (!credForm.publishedAt) {
                publishedAt = existing.publishedAt;
            }
        }
        await saveCredential({ ...(credForm as AppCredential), publishedAt });
        setCredModalOpen(false);
        loadData();
        setLoading(false);
    };

    const handleRenewSmart = async (client: ClientDBRow, subIndex: number) => {
        const subs = normalizeSubscriptions(client.subscriptions, client.duration_months);
        const parts = subs[subIndex].split('|');
        const serviceName = parts[0];
        const months = parseInt(parts[3] || '1');
        const nextStartDate = calculateExpiry(parts[1], months);
        const nextIso = nextStartDate.toISOString();
        subs[subIndex] = `${serviceName}|${nextIso}|0|${months}||${nextIso}`;
        await saveClientToDB({ ...client, subscriptions: subs });
        loadData();
    };

    const handleModalSmartRenew = (subIndex: number) => {
        const currentSubs = [...((clientForm.subscriptions as string[] | undefined) || [])];
        if (!currentSubs[subIndex]) return;
        const parts = currentSubs[subIndex].split('|');
        const serviceName = parts[0];
        const months = parseInt(parts[3] || '1');
        const nextStartDate = calculateExpiry(parts[1], months);
        const nextIso = nextStartDate.toISOString();
        currentSubs[subIndex] = `${serviceName}|${nextIso}|0|${months}||${nextIso}`;
        setClientForm({ ...clientForm, subscriptions: currentSubs });
    };

    // Add days to a subscription in the modal form (works for any subscription, not just expired)
    const handleModalAddDays = (subIndex: number, daysToAdd: number) => {
        if (!daysToAdd || daysToAdd <= 0) return;
        const currentSubs = [...((clientForm.subscriptions as string[] | undefined) || [])];
        if (!currentSubs[subIndex]) return;

        const parts = currentSubs[subIndex].split('|');
        const currentStartDate = new Date(parts[1]);

        // Add days to the expiry by adjusting the start date forward
        // This effectively extends the subscription period
        const newStartDate = new Date(currentStartDate);
        newStartDate.setDate(newStartDate.getDate() + daysToAdd);

        // Preserve original payment date (6th field) - this is the key for renewal calculations
        const originalPaymentDate = parts[5] || parts[1];
        currentSubs[subIndex] = `${parts[0]}|${newStartDate.toISOString()}|${parts[2]}|${parts[3] || '1'}|${parts[4] || ''}|${originalPaymentDate}`;
        setClientForm({ ...clientForm, subscriptions: currentSubs });
    };

    const handleAddTolerance = async (client: ClientDBRow, subIndex: number, days: number = 3) => {
        const subs = normalizeSubscriptions(client.subscriptions, client.duration_months);
        const parts = subs[subIndex].split('|');
        // parts: [0]Service, [1]Date, [2]Status, [3]Duration, [4]Tolerance, [5]OriginalPaymentDate

        const now = new Date();
        const newToleranceDate = new Date(now);
        newToleranceDate.setDate(now.getDate() + days);

        // Preserve other fields including original payment date, update tolerance (5th index)
        subs[subIndex] = `${parts[0]}|${parts[1]}|${parts[2]}|${parts[3] || '1'}|${newToleranceDate.toISOString()}|${parts[5] || parts[1]}`;

        await saveClientToDB({ ...client, subscriptions: subs });
        alert(`Tolerância de ${days} dias adicionada com sucesso!`);
        loadData();
    };

    const handleResetProjection = () => {
        if (!isConfirmingReset) {
            setIsConfirmingReset(true);
            setTimeout(() => setIsConfirmingReset(false), 4000);
        } else {
            const now = Date.now();
            setProjectionMonths(1);
            setStatsReferenceDate(now);
            localStorage.setItem('admin_stats_reference', now.toString());
            setIsConfirmingReset(false);
        }
    };

    const handleDownloadBackup = () => {
        if (clients.length === 0) return alert("Nenhum dado para baixar.");
        const dataStr = JSON.stringify(clients, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `backup_eudorama_clientes_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!confirm("Isso atualizará os dados existentes. Deseja continuar?")) return;
        setLoading(true);
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const importedData = JSON.parse(event.target?.result as string);
                if (Array.isArray(importedData)) {
                    const { error } = await supabase.from('clients').upsert(importedData);
                    if (error) throw error;
                    alert(`Sucesso! ${importedData.length} registros importados.`);
                    loadData();
                } else { alert("Formato de arquivo inválido."); }
            } catch (err: any) { alert("Erro ao importar: " + err.message); }
            setLoading(false);
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // --- HISTORY LOGIC ---

    const loadHistory = async () => {
        setHistoryLoading(true);
        const logs = await getHistoryLogs();
        const settings = await getHistorySettings();
        setHistoryLogs(logs);
        if (settings['retention_days']) setRetentionDays(settings['retention_days']);
        setHistoryLoading(false);
    };

    const handleSaveRetention = async (days: string) => {
        setRetentionDays(days);
        await updateHistorySetting('retention_days', days);
        await enforceHistoryRetention();
        loadHistory(); // Reload to show effect of cleanup immediately if any
        alert(`Histórico será mantido por ${days} dias.`);
    };

    const handleClearHistory = async () => {
        if (!confirm("Tem certeza que deseja apagar TODO o histórico? Essa ação é irreversível.")) return;
        setHistoryLoading(true);
        const success = await clearHistoryLogs();
        if (success) {
            setHistoryLogs([]);
            alert("Histórico apagado com sucesso.");
        } else {
            alert("Erro ao apagar histórico.");
        }
        setHistoryLoading(false);
    };

    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory();
        }
    }, [activeTab]);

    useEffect(() => {
        // Enforce on mount once
        enforceHistoryRetention();
    }, []);

    const sendWhatsAppMessage = async (phone: string, name: string, service: string, expiryDate: Date, client?: Partial<ClientDBRow>) => {
        const cleanPhone = phone.replace(/\D/g, '');
        const daysLeft = getDaysRemaining(expiryDate);
        let message = daysLeft < 0
            ? `Ola ${name}! Notamos que sua assinatura do ${service} venceu. Quer renovar para continuar assistindo seus doramas favoritos?`
            : `Ola ${name}! Sua assinatura do ${service} vence em ${daysLeft} dias (${expiryDate.toLocaleDateString()}). Se quiser renovar antes para nao perder o acesso, estamos a disposicao.`;
        window.open(`https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');

        if (!client?.id || !client.phone_number) return;

        const nowIso = new Date().toISOString();
        const currentProgress = client.game_progress || {};
        const previousServices = Array.isArray(currentProgress._charge_whatsapp_services) ? currentProgress._charge_whatsapp_services : [];
        const nextProgress = {
            ...currentProgress,
            _charge_whatsapp_last_at: nowIso,
            _charge_whatsapp_last_service: service,
            _charge_whatsapp_services: Array.from(new Set([...previousServices, service]))
        };

        setClients(prev => prev.map(c => c.id === client.id ? { ...c, is_contacted: true, game_progress: nextProgress } : c));
        await saveClientToDB({
            id: client.id,
            phone_number: client.phone_number,
            is_contacted: true,
            game_progress: nextProgress
        });
    };

    return (
        <div className={`min-h-screen font-sans transition-colors duration-300 ${darkMode ? 'dark bg-slate-950 text-white' : 'bg-indigo-50/30 text-indigo-950'}`}>
            <div className="bg-white dark:bg-slate-900 px-6 py-5 flex justify-between items-center shadow-sm sticky top-0 z-30 border-b border-indigo-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 p-2.5 rounded-2xl text-white shadow-lg"><ShieldAlert size={24} /></div>
                    <h1 className="font-black text-xl text-indigo-900 dark:text-white">EuDorama Admin</h1>
                    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-100 dark:border-emerald-800">
                        <Wifi size={12} className="animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Realtime Ativo</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setDarkMode(!darkMode)} className="p-2.5 rounded-xl bg-indigo-50 dark:bg-slate-800 text-indigo-600">
                        {darkMode ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                    <button onClick={onLogout} className="flex items-center gap-2 text-red-500 bg-red-50 dark:bg-red-900/20 px-4 py-2.5 rounded-xl font-bold text-xs uppercase">
                        Sair
                    </button>
                </div>
            </div>

            <main className="max-w-5xl mx-auto px-4 mt-8 space-y-6">
                <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl shadow-sm border border-indigo-100 dark:border-slate-800 overflow-x-auto scrollbar-hide">
                    {[
                        { id: 'clients', icon: Users, label: 'Clientes' },
                        { id: 'finances', icon: BarChart3, label: 'Finanças' },
                        { id: 'buscar_login', icon: Search, label: 'Buscar Login' },
                        { id: 'credentials', icon: Key, label: 'Contas' },
                        { id: 'trash', icon: Trash2, label: 'Lixeira' },
                        { id: 'history', icon: History, label: 'Histórico' },
                        { id: 'danger', icon: AlertTriangle, label: 'Segurança' }
                    ].map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 min-w-fit py-3 px-5 rounded-xl text-[10px] font-black uppercase transition-all flex flex-col sm:flex-row items-center justify-center gap-1.5 ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-md' : 'text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-800'}`}>
                            <tab.icon size={16} /> <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {activeTab === 'clients' && (
                    <div className="space-y-6 animate-fade-in pb-32">
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-4">
                            <div className="flex justify-between items-center px-1">
                                <p className="text-xs font-black text-indigo-400 uppercase tracking-widest">Base de Dados</p>
                                <div className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase">Total: {clients.filter(c => !c.deleted).length} Clientes</div>
                            </div>
                            <div className="flex items-center gap-3 bg-indigo-50 dark:bg-slate-800 px-5 py-4 rounded-2xl border border-indigo-100 dark:border-slate-700">
                                <Search className="text-indigo-400" size={24} />
                                <input className="bg-transparent outline-none text-base font-bold w-full text-indigo-900 dark:text-white" placeholder="Buscar por nome ou WhatsApp..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
                            </div>
                            <div className="flex flex-wrap gap-2 items-center">
                                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide flex-1">
                                    {[
                                        { id: 'all', label: 'Todos', color: 'bg-indigo-600 text-white' },
                                        { id: 'expiring', label: 'Vencimento Proximo', color: 'bg-orange-100 text-orange-700' },
                                        { id: 'debtor', label: 'Vencidos', color: 'bg-red-100 text-red-700' },
                                        { id: 'tolerance', label: 'Em tolerância', color: 'bg-indigo-100 text-indigo-700' }
                                    ].map(f => (
                                        <button key={f.id} onClick={() => setClientFilterStatus(f.id as any)} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase border transition-all whitespace-nowrap ${clientFilterStatus === f.id ? f.color : 'bg-white dark:bg-slate-900 text-indigo-300 border-indigo-100 dark:border-slate-800'}`}>{f.label}</button>
                                    ))}
                                </div>

                                <div className="flex gap-2">
                                    <button onClick={handleDownloadBackup} className="p-2.5 rounded-xl border flex items-center gap-2 text-[10px] font-black uppercase transition-all bg-white dark:bg-slate-900 text-indigo-600 border-indigo-100 dark:border-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-800" title="Baixar Backup JSON"><Download size={14} /> <span className="hidden sm:inline">Backup</span></button>
                                    <label className="p-2.5 rounded-xl border flex items-center gap-2 text-[10px] font-black uppercase transition-all bg-white dark:bg-slate-900 text-purple-600 border-indigo-100 dark:border-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/20 cursor-pointer" title="Importar Backup JSON"><Upload size={14} /> <span className="hidden sm:inline">Importar</span><input type="file" accept=".json" className="hidden" onChange={handleImportBackup} /></label>
                                    <button onClick={() => setClientSortByExpiry(!clientSortByExpiry)} className={`p-2.5 rounded-xl border flex items-center gap-2 text-[10px] font-black uppercase transition-all ${clientSortByExpiry ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-slate-900 text-indigo-400 border-indigo-100 dark:border-slate-800'}`} title="Ordenar por Vencimento Próximo"><ArrowUpDown size={14} /> <span className="hidden sm:inline">Vencimento</span></button>
                                </div>
                            </div>
                            <button onClick={() => { setClientForm({ phone_number: '', client_name: '', subscriptions: [], client_password: '' }); setClientModalOpen(true); }} className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-100"><Plus size={24} /> Novo Cliente</button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredClients.map((client) => (
                                <div key={client.id} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-indigo-50 dark:border-slate-800 flex flex-col hover:border-indigo-200 dark:hover:border-slate-700 transition-all">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="min-w-0">
                                            <h3 className={`font-black text-gray-900 dark:text-white text-lg truncate leading-tight ${client.deleted ? 'line-through opacity-50' : ''}`}>{client.client_name || 'Sem Nome'}</h3>
                                            <p className="text-xs font-bold text-indigo-400 mt-1 flex items-center gap-1.5">
                                                <Phone size={12} /> {client.phone_number}
                                                {client.deleted && <span className="bg-red-600 text-white px-2 py-0.5 rounded-md text-[9px] uppercase tracking-widest ml-2">Lixeira</span>}
                                                {getChargeTagMeta(client).hasSent && <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md text-[9px] uppercase tracking-widest ml-2">{getChargeTagMeta(client).label}</span>}
                                                {clientFilterStatus === 'expiring' && getExpiringSortMeta(client).inclusionMs > 0 && (
                                                    <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md text-[9px] uppercase tracking-widest ml-2">
                                                        Incluido: {new Date(getExpiringSortMeta(client).inclusionMs).toLocaleDateString()}
                                                    </span>
                                                )}
                                                {client.observation && <span title={client.observation} className="text-amber-500 cursor-help"><AlertTriangle size={14} /></span>}
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            {client.deleted ? (
                                                <>
                                                    <button onClick={() => { setClientForm({ ...client, subscriptions: normalizeSubscriptions(client.subscriptions, client.duration_months) }); setClientModalOpen(true); }} className="px-4 py-3 rounded-xl bg-purple-100 text-purple-700 font-black text-xs uppercase hover:bg-purple-200 transition-all flex items-center gap-2" title="Ver Detalhes">
                                                        <Eye size={16} /> Ver
                                                    </button>
                                                    <button onClick={() => handleRestoreClient(client)} className="px-4 py-3 rounded-xl bg-orange-100 text-orange-700 font-black text-xs uppercase hover:bg-orange-200 transition-all flex items-center gap-2">
                                                        <Undo2 size={16} /> Restaurar
                                                    </button>
                                                </>
                                            ) : (
                                                <button onClick={() => { setClientForm({ ...client, subscriptions: normalizeSubscriptions(client.subscriptions, client.duration_months) }); setClientModalOpen(true); }} className="p-3 rounded-xl bg-indigo-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all"><Edit2 size={18} /></button>
                                            )}
                                            <button onClick={() => handleSoftDeleteClient(client)} className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white transition-all"><Trash2 size={18} /></button>
                                        </div>
                                    </div>

                                    <div className="space-y-3 mb-4">
                                        {(normalizeSubscriptions(client.subscriptions || [], client.duration_months) as string[]).map((sub, i) => {
                                            const parts = sub.split('|');
                                            const serviceName = parts[0];
                                            const expiry = calculateExpiry(parts[1], parseInt(parts[3] || '1'));
                                            const daysLeft = getDaysRemaining(expiry);

                                            // Tolerance Check
                                            const toleranceDate = parts[4] ? new Date(parts[4]) : null;
                                            if (toleranceDate) toleranceDate.setHours(23, 59, 59, 999);
                                            const now = new Date();
                                            const isInTolerance = toleranceDate && toleranceDate.getTime() >= now.getTime();
                                            const toleranceDaysLeft = toleranceDate ? Math.ceil((toleranceDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;

                                            let statusColor = daysLeft < 0
                                                ? (isInTolerance ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/30" : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-900/30")
                                                : (daysLeft <= 5 ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900/30" : "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900/30");

                                            return (
                                                <div key={i} className={`p-4 rounded-2xl border flex flex-col gap-3 transition-all ${statusColor}`}>
                                                    <div className="flex justify-between items-center">
                                                        <div className="flex flex-col">
                                                            <span className="font-black text-xs uppercase tracking-wider">{serviceName}</span>
                                                            <span className="text-[10px] font-bold opacity-80">
                                                                {isInTolerance
                                                                    ? `Em Tolerância (${toleranceDaysLeft}d)`
                                                                    : (daysLeft < 0 ? 'Vencido há ' + Math.abs(daysLeft) + 'd' : `Vence em ${expiry.toLocaleDateString()} (${daysLeft}d)`)}
                                                            </span>
                                                        </div>
                                                        <div className="flex gap-1.5">
                                                            <button onClick={() => { void sendWhatsAppMessage(client.phone_number, client.client_name || 'Dorameira', serviceName, expiry, client); }} className="p-2.5 bg-white/50 dark:bg-slate-800/50 hover:bg-emerald-500 hover:text-white rounded-xl transition-all"><MessageCircle size={16} className="text-emerald-600 dark:text-emerald-400 hover:text-inherit" /></button>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button onClick={() => handleRenewSmart(client, i)} className="flex-1 py-2.5 bg-white/80 dark:bg-slate-800/80 hover:bg-indigo-600 hover:text-white rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-all shadow-sm border border-white dark:border-slate-700"><RotateCw size={14} /> Renovar</button>
                                                        {daysLeft < 0 && (
                                                            <button onClick={() => {
                                                                const daysStr = prompt("Quantos dias de tolerância?", "3");
                                                                if (daysStr) {
                                                                    const days = parseInt(daysStr);
                                                                    if (!isNaN(days) && days > 0) handleAddTolerance(client, i, days);
                                                                }
                                                            }} className="px-3 py-2.5 bg-amber-100 text-amber-700 hover:bg-amber-200 rounded-xl text-[10px] font-black uppercase transition-all shadow-sm border border-amber-200" title="Adicionar dias de tolerância">
                                                                +Dias
                                                            </button>
                                                        )}
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

                {activeTab === 'finances' && (
                    <div className="space-y-8 animate-fade-in pb-32">
                        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border-4 border-indigo-600/10 dark:border-indigo-500/10 shadow-sm space-y-6">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-3 bg-indigo-600 text-white rounded-2xl shadow-lg shadow-indigo-200"><Filter size={24} /></div>
                                <div>
                                    <h3 className="text-xl font-black text-gray-900">Consulta de Vencimentos</h3>
                                    <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Recebimentos agrupados por cliente e período</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-gray-400 ml-1">Data de Início</label>
                                    <input
                                        type="date"
                                        className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-transparent focus:border-indigo-600 outline-none font-bold"
                                        value={dateStart}
                                        onChange={e => setDateStart(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-gray-400 ml-1">Data de Fim</label>
                                    <input
                                        type="date"
                                        className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-transparent focus:border-indigo-600 outline-none font-bold"
                                        value={dateEnd}
                                        onChange={e => setDateEnd(e.target.value)}
                                    />
                                </div>
                                <button
                                    onClick={handleConsultVencimentos}
                                    className="bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 active:scale-95"
                                >
                                    Consultar Vencimentos
                                </button>
                            </div>

                            {groupedVencimentos.length > 0 && (
                                <div className="mt-8 space-y-8 animate-slide-up">
                                    <div className="bg-indigo-600 p-6 rounded-[2rem] text-white shadow-xl">
                                        <div className="flex justify-between items-center mb-4">
                                            <div>
                                                <p className="text-[10px] font-black uppercase text-indigo-200">Previsão Total do Período</p>
                                                <h4 className="text-4xl font-black">R$ {totalPeriod.toFixed(2).replace('.', ',')}</h4>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] font-black uppercase text-indigo-200">Clientes Ativos</p>
                                                <h4 className="text-2xl font-black">{groupedVencimentos.length}</h4>
                                            </div>
                                        </div>

                                        {/* ADMIN SPLIT - PERÍODO */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4 border-t border-indigo-500">
                                            {/* ORION */}
                                            <div className="bg-white/10 rounded-2xl p-4 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 bg-blue-500 rounded-xl flex items-center justify-center text-white font-black text-sm">O</div>
                                                    <span className="font-black text-sm">Orion</span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-center">
                                                    <div>
                                                        <p className="text-[8px] font-bold text-indigo-200 uppercase">Receita</p>
                                                        <p className="font-bold text-sm">R$ {formatCurrency(orionPeriod)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-bold text-indigo-200 uppercase">Custos</p>
                                                        <p className="font-bold text-sm text-red-300">- R$ {formatCurrency(financeStats.orion.costs + financeStats.orion.adSpend)}</p>
                                                    </div>
                                                    <div className="bg-white/10 rounded-xl py-1">
                                                        <p className="text-[8px] font-bold text-emerald-200 uppercase">Líquido</p>
                                                        <p className="font-black text-sm text-emerald-300">R$ {formatCurrency(orionPeriod - financeStats.orion.costs - financeStats.orion.adSpend)}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* IOHANNA */}
                                            <div className="bg-white/10 rounded-2xl p-4 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 bg-pink-500 rounded-xl flex items-center justify-center text-white font-black text-sm">I</div>
                                                    <span className="font-black text-sm">Iohanna</span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-center">
                                                    <div>
                                                        <p className="text-[8px] font-bold text-indigo-200 uppercase">Receita</p>
                                                        <p className="font-bold text-sm">R$ {formatCurrency(iohannaPeriod)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-bold text-indigo-200 uppercase">Custos</p>
                                                        <p className="font-bold text-sm text-red-300">- R$ {formatCurrency(financeStats.iohanna.costs + financeStats.iohanna.adSpend)}</p>
                                                    </div>
                                                    <div className="bg-white/10 rounded-xl py-1">
                                                        <p className="text-[8px] font-bold text-emerald-200 uppercase">Líquido</p>
                                                        <p className="font-black text-sm text-emerald-300">R$ {formatCurrency(iohannaPeriod - financeStats.iohanna.costs - financeStats.iohanna.adSpend)}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        {groupedVencimentos.map((clientData, idx) => (
                                            <div key={idx} className="bg-gray-50 dark:bg-slate-800/50 rounded-[2rem] overflow-hidden border border-gray-100 dark:border-slate-800 shadow-sm">
                                                <div className="bg-white dark:bg-slate-900 px-6 py-4 flex justify-between items-center border-b border-gray-100 dark:border-slate-800">
                                                    <div>
                                                        <h4 className="font-black text-gray-900 dark:text-white flex items-center gap-2">
                                                            <ChevronRight size={18} className="text-indigo-600" />
                                                            {clientData.name}
                                                        </h4>
                                                        <p className="text-[10px] font-bold text-gray-400 ml-6">{clientData.phone}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-[10px] font-black text-indigo-400 uppercase block">Total Cliente</span>
                                                        <span className="font-black text-indigo-600">R$ {clientData.totalUser.toFixed(2).replace('.', ',')}</span>
                                                    </div>
                                                </div>

                                                <div className="p-4 overflow-x-auto">
                                                    <table className="w-full text-left">
                                                        <thead>
                                                            <tr className="text-[9px] font-black uppercase text-gray-400 tracking-[0.1em]">
                                                                <th className="px-4 py-2">Aplicativo</th>
                                                                <th className="px-4 py-2">Vencimento</th>
                                                                <th className="px-4 py-2 text-right">Preço</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                                            {clientData.vencimentos.map((v, vIdx) => (
                                                                <tr key={vIdx} className="text-sm">
                                                                    <td className="px-4 py-3 font-bold text-gray-700 dark:text-gray-300">
                                                                        <div className="flex items-center gap-2">
                                                                            <div className={`w-2 h-2 rounded-full ${v.isMonthly ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                                                            {v.service}
                                                                            {!v.isMonthly && <span className="text-[8px] bg-gray-200 text-gray-600 px-1 rounded">NÃO MENSAL</span>}
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-gray-500 font-medium">
                                                                        {v.expiry.toLocaleDateString()}
                                                                    </td>
                                                                    <td className={`px-4 py-3 text-right font-black ${v.isMonthly ? 'text-indigo-600' : 'text-gray-400'}`}>
                                                                        R$ {v.price.toFixed(2).replace('.', ',')}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {groupedVencimentos.length === 0 && dateStart && dateEnd && (
                                <div className="text-center py-10 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                                    <p className="text-gray-400 font-bold uppercase tracking-widest text-sm">Nenhum vencimento encontrado neste período.</p>
                                </div>
                            )}
                        </div>

                        <div className="space-y-4">
                            <div className="flex flex-col gap-1 px-4">
                                <h3 className="text-xl font-black text-gray-900 dark:text-white">Resumo Geral Mensal</h3>
                                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Baseado em assinaturas recorrentes de 1 mês</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden group">
                                    <div className="absolute -right-4 -top-4 opacity-10 group-hover:rotate-12 transition-transform"><Banknote size={120} className="text-white" /></div>
                                    <p className="text-[10px] font-black text-white/60 uppercase tracking-widest">Faturamento Mensal Recebido</p>
                                    <h4 className="text-4xl font-black text-white mt-1">R$ {financeStats.grossRevenue.toFixed(2).replace('.', ',')}</h4>
                                    <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-indigo-100">
                                        <CheckCircle2 size={14} /> <span>Soma das assinaturas de 1 mês ativas</span>
                                    </div>
                                </div>

                                <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-orange-100 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                                    <div className="absolute -right-4 -top-4 opacity-5 group-hover:rotate-12 transition-transform"><Clock size={120} className="text-orange-500" /></div>
                                    <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest">Saldo Mensal Pendente</p>
                                    <h4 className="text-4xl font-black text-orange-600 mt-1">R$ {financeStats.pendingRevenue.toFixed(2).replace('.', ',')}</h4>
                                    <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-orange-400">
                                        <AlertTriangle size={14} /> <span>Assinaturas mensais vencidas</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-indigo-100 dark:border-slate-800 shadow-sm space-y-6">
                            <div className="flex flex-col gap-1">
                                <h3 className="text-xl font-black text-gray-900 dark:text-white">Detalhamento Mensal por App</h3>
                                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Métricas de assinaturas de 1 mês por serviço</p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-separate border-spacing-y-2">
                                    <thead>
                                        <tr className="text-[10px] font-black uppercase text-indigo-300 tracking-widest">
                                            <th className="px-4 py-2">Serviço</th>
                                            <th className="px-4 py-2">Assinantes Mensais</th>
                                            <th className="px-4 py-2 text-right">Vencido (Mensal)</th>
                                            <th className="px-4 py-2 text-right">Total Mensal</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(financeStats.serviceBreakdown).map(([name, data]: [string, any]) => (
                                            <tr key={name} className="group hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                                                <td className="px-4 py-4 rounded-l-2xl bg-gray-50 dark:bg-slate-800/50"><span className="font-black text-sm text-gray-800 dark:text-gray-200">{name}</span></td>
                                                <td className="px-4 py-4 bg-gray-50 dark:bg-slate-800/50"><span className="font-bold text-sm text-indigo-600">{data.monthlyCount}</span></td>
                                                <td className="px-4 py-4 bg-gray-50 dark:bg-slate-800/50 text-right font-bold text-orange-400 italic text-xs">R$ {data.pending.toFixed(2).replace('.', ',')}</td>
                                                <td className="px-4 py-4 rounded-r-2xl bg-gray-50 dark:bg-slate-800/50 text-right font-black text-indigo-600">R$ {data.revenue.toFixed(2).replace('.', ',')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-indigo-100 dark:border-slate-800 shadow-sm space-y-8">
                            <div className="flex justify-between items-center">
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-xl font-black text-gray-900 dark:text-white">Projeção Mensal e Escala</h3>
                                    <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Análise baseada em assinaturas de 1 mês</p>
                                </div>
                                <button onClick={handleResetProjection} className={`flex items-center gap-2 px-6 py-4 rounded-full text-[10px] font-black uppercase transition-all shadow-md border-2 ${isConfirmingReset ? 'bg-red-600 text-white border-red-700 animate-pulse' : 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100 active:scale-95'}`}>{isConfirmingReset ? <AlertTriangle size={16} /> : <Eraser size={16} />}{isConfirmingReset ? "CONFIRMAR?" : "RESETAR PROJEÇÃO"}</button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between p-5 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100">
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm text-emerald-600"><Users size={24} /></div>
                                            <div><p className="text-[10px] font-black uppercase text-emerald-700">Novas Assinaturas (Mês)</p><h5 className="text-xl font-black text-emerald-900 dark:text-emerald-100">+{financeStats.newClientsThisMonth}</h5></div>
                                        </div>
                                        <div className="text-emerald-600"><TrendingUp size={28} /></div>
                                    </div>
                                    <div className="flex items-center justify-between p-5 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-100">
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm text-red-600"><UsersRound size={24} /></div>
                                            <div><p className="text-[10px] font-black uppercase text-red-700">Assinaturas Canceladas / Churn</p><h5 className="text-xl font-black text-red-900 dark:text-red-100">-{financeStats.churnCount} Assinaturas</h5></div>
                                        </div>
                                        <div className="text-red-600 text-xs font-black uppercase">{financeStats.churnRate.toFixed(1)}% Taxa</div>
                                    </div>
                                </div>

                                <div className="bg-indigo-50 dark:bg-slate-800 p-8 rounded-3xl border border-indigo-100 flex flex-col justify-center text-center space-y-4">
                                    <p className="text-xs font-black text-indigo-400 uppercase tracking-widest">Estimativa de Faturamento Mensal ({projectionMonths} {projectionMonths === 1 ? 'mês' : 'meses'})</p>
                                    <h4 className="text-4xl font-black text-indigo-900 dark:text-indigo-100">R$ {financeStats.projection.toFixed(2).replace('.', ',')}</h4>
                                    <p className="text-xs text-indigo-400 font-bold max-w-[200px] mx-auto">Cálculo baseado no ticket médio mensal de R$ {financeStats.averageTicket.toFixed(2)} e saldo líquido de crescimento.</p>
                                    <div className="pt-4 flex justify-center gap-2">
                                        {[1, 3, 6, 12].map(m => (
                                            <button key={m} onClick={() => setProjectionMonths(m)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${projectionMonths === m ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 shadow-sm border border-indigo-50'}`}>{m === 12 ? '1Y' : `${m}M`}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* CUSTOS DAS CONTAS */}
                        {Object.keys(financeStats.accountCosts).length > 0 && (
                            <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-red-100 dark:border-red-900/20 shadow-sm space-y-6">
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-xl font-black text-gray-900 dark:text-white">💰 Custos das Contas</h3>
                                    <p className="text-xs font-bold text-red-400 uppercase tracking-widest">Valor pago mensalmente pelas contas de streaming</p>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-separate border-spacing-y-2">
                                        <thead>
                                            <tr className="text-[10px] font-black uppercase text-red-300 tracking-widest">
                                                <th className="px-4 py-2">Serviço</th>
                                                <th className="px-4 py-2">Qtd Contas</th>
                                                <th className="px-4 py-2 text-right">Custo/Conta</th>
                                                <th className="px-4 py-2 text-right">Custo Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(financeStats.accountCosts).map(([name, data]: [string, any]) => (
                                                <tr key={name} className="group hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-colors">
                                                    <td className="px-4 py-4 rounded-l-2xl bg-red-50/50 dark:bg-red-900/10"><span className="font-black text-sm text-gray-800 dark:text-gray-200">{name}</span></td>
                                                    <td className="px-4 py-4 bg-red-50/50 dark:bg-red-900/10"><span className="font-bold text-sm text-red-600">{data.count}</span></td>
                                                    <td className="px-4 py-4 bg-red-50/50 dark:bg-red-900/10 text-right font-bold text-red-400 text-xs">R$ {formatCurrency(data.costPerAccount)}</td>
                                                    <td className="px-4 py-4 rounded-r-2xl bg-red-50/50 dark:bg-red-900/10 text-right font-black text-red-600">R$ {formatCurrency(data.totalCost)}</td>
                                                </tr>
                                            ))}
                                            <tr className="bg-red-100 dark:bg-red-900/30">
                                                <td colSpan={3} className="px-4 py-4 rounded-l-2xl font-black text-red-800 dark:text-red-200 uppercase text-xs">Total Custos Contas</td>
                                                <td className="px-4 py-4 rounded-r-2xl text-right font-black text-red-700 dark:text-red-300 text-lg">R$ {formatCurrency(financeStats.totalAccountCosts)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* GASTOS COM ANÚNCIOS */}
                        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-amber-100 dark:border-amber-900/20 shadow-sm space-y-6">
                            <div className="flex justify-between items-center">
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-xl font-black text-gray-900 dark:text-white">📢 Gastos com Anúncios</h3>
                                    <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">Investimento em marketing e tráfego pago</p>
                                </div>
                                <button
                                    onClick={() => setAdSpendEnabled(!adSpendEnabled)}
                                    className={`px-6 py-3 rounded-full text-xs font-black uppercase transition-all ${adSpendEnabled ? 'bg-amber-500 text-white shadow-lg shadow-amber-200' : 'bg-gray-100 text-gray-400'}`}
                                >
                                    {adSpendEnabled ? 'Ativado' : 'Desativado'}
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase text-gray-400 ml-1">Valor por Dia (R$)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={adSpendPerDay}
                                        onChange={e => setAdSpendPerDay(parseFloat(e.target.value) || 0)}
                                        disabled={!adSpendEnabled}
                                        className={`w-full bg-gray-50 dark:bg-slate-800 p-4 rounded-2xl border-2 border-transparent focus:border-amber-500 outline-none font-bold text-lg ${!adSpendEnabled && 'opacity-50'}`}
                                    />
                                </div>
                                <div className="bg-amber-50 dark:bg-amber-900/20 p-5 rounded-2xl flex flex-col justify-center">
                                    <p className="text-[10px] font-black uppercase text-amber-600">Gasto Mensal (30 dias)</p>
                                    <p className="text-2xl font-black text-amber-700 dark:text-amber-300">R$ {formatCurrency(financeStats.monthlyAdSpend)}</p>
                                </div>
                                <div className="bg-gray-50 dark:bg-slate-800 p-5 rounded-2xl flex flex-col justify-center">
                                    <p className="text-[10px] font-black uppercase text-gray-400">Divisão por Admin</p>
                                    <p className="text-sm font-bold text-gray-600">Orion: R$ {formatCurrency(financeStats.orion.adSpend)}</p>
                                    <p className="text-sm font-bold text-gray-600">Iohanna: R$ {formatCurrency(financeStats.iohanna.adSpend)}</p>
                                </div>
                            </div>
                        </div>

                        {/* DIVISÃO POR ADMINISTRADOR */}
                        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-emerald-100 dark:border-emerald-900/20 shadow-sm space-y-6">
                            <div className="flex flex-col gap-1">
                                <h3 className="text-xl font-black text-gray-900 dark:text-white">👥 Divisão por Administrador</h3>
                                <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Receitas, custos e lucro líquido de cada sócio</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* ORION */}
                                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 rounded-3xl border border-blue-100 dark:border-blue-800 space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-lg">O</div>
                                        <div>
                                            <h4 className="font-black text-blue-900 dark:text-blue-100">Orion</h4>
                                            <p className="text-[10px] font-bold text-blue-400 uppercase">70% Viki, Kocowa, IQIYI, DramaBox</p>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center p-3 bg-white/50 dark:bg-slate-800/50 rounded-xl">
                                            <span className="text-xs font-bold text-gray-500">Receita</span>
                                            <span className="font-black text-emerald-600">+ R$ {formatCurrency(financeStats.orion.revenue)}</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-white/50 dark:bg-slate-800/50 rounded-xl">
                                            <span className="text-xs font-bold text-gray-500">Custos Contas</span>
                                            <span className="font-black text-red-500">- R$ {formatCurrency(financeStats.orion.costs)}</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-white/50 dark:bg-slate-800/50 rounded-xl">
                                            <span className="text-xs font-bold text-gray-500">Anúncios</span>
                                            <span className="font-black text-amber-500">- R$ {formatCurrency(financeStats.orion.adSpend)}</span>
                                        </div>
                                        <div className={`flex justify-between items-center p-4 rounded-xl ${financeStats.orion.profit >= 0 ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                                            <span className="text-xs font-black uppercase text-gray-600">Lucro Líquido</span>
                                            <span className={`font-black text-xl ${financeStats.orion.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>R$ {formatCurrency(financeStats.orion.profit)}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* IOHANNA */}
                                <div className="bg-gradient-to-br from-pink-50 to-purple-50 dark:from-pink-900/20 dark:to-purple-900/20 p-6 rounded-3xl border border-pink-100 dark:border-pink-800 space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 bg-pink-600 rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-lg">I</div>
                                        <div>
                                            <h4 className="font-black text-pink-900 dark:text-pink-100">Iohanna</h4>
                                            <p className="text-[10px] font-bold text-pink-400 uppercase">70% Youku, WeTV</p>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center p-3 bg-white/50 dark:bg-slate-800/50 rounded-xl">
                                            <span className="text-xs font-bold text-gray-500">Receita</span>
                                            <span className="font-black text-emerald-600">+ R$ {formatCurrency(financeStats.iohanna.revenue)}</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-white/50 dark:bg-slate-800/50 rounded-xl">
                                            <span className="text-xs font-bold text-gray-500">Custos Contas</span>
                                            <span className="font-black text-red-500">- R$ {formatCurrency(financeStats.iohanna.costs)}</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-white/50 dark:bg-slate-800/50 rounded-xl">
                                            <span className="text-xs font-bold text-gray-500">Anúncios</span>
                                            <span className="font-black text-amber-500">- R$ {formatCurrency(financeStats.iohanna.adSpend)}</span>
                                        </div>
                                        <div className={`flex justify-between items-center p-4 rounded-xl ${financeStats.iohanna.profit >= 0 ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                                            <span className="text-xs font-black uppercase text-gray-600">Lucro Líquido</span>
                                            <span className={`font-black text-xl ${financeStats.iohanna.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>R$ {formatCurrency(financeStats.iohanna.profit)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* RESUMO GERAL */}
                            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-6 rounded-3xl text-white shadow-xl">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-emerald-100">Receita Total</p>
                                        <p className="text-2xl font-black">R$ {formatCurrency(financeStats.grossRevenue)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-emerald-100">Custos Contas</p>
                                        <p className="text-2xl font-black">- R$ {formatCurrency(financeStats.totalAccountCosts)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-emerald-100">Anúncios</p>
                                        <p className="text-2xl font-black">- R$ {formatCurrency(financeStats.monthlyAdSpend)}</p>
                                    </div>
                                    <div className="bg-white/20 rounded-2xl p-3">
                                        <p className="text-[10px] font-black uppercase text-white">Lucro Líquido Total</p>
                                        <p className="text-3xl font-black">R$ {formatCurrency(financeStats.totalProfit)}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'trash' && (
                    <div className="space-y-6 animate-fade-in pb-32">
                        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-red-100 dark:border-red-900/20 shadow-sm space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-red-50 text-red-500 rounded-2xl"><Trash2 size={24} /></div>
                                <div>
                                    <h3 className="text-xl font-black text-gray-900 dark:text-white leading-none">Lixeira de Clientes</h3>
                                    <p className="text-xs font-bold text-red-400 uppercase tracking-widest mt-1">Clientes removidos da base ativa</p>
                                </div>
                            </div>
                        </div>

                        {deletedClientsList.length === 0 ? (
                            <div className="text-center py-20 bg-gray-50 dark:bg-slate-900 rounded-[2.5rem] border-2 border-dashed border-gray-200 dark:border-slate-800">
                                <Trash2 className="w-16 h-16 text-gray-200 dark:text-slate-800 mx-auto mb-4" />
                                <p className="text-gray-400 font-bold uppercase tracking-widest text-sm">Lixeira vazia</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {deletedClientsList.map(client => (
                                    <div key={client.id} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-red-100 dark:border-red-900/30 flex flex-col hover:border-red-200 dark:hover:border-red-800 transition-all opacity-90 hover:opacity-100">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="min-w-0">
                                                <h3 className="font-black text-gray-900 dark:text-white text-lg truncate leading-tight line-through opacity-60">{client.client_name || 'Sem Nome'}</h3>
                                                <p className="text-xs font-bold text-red-400 mt-1 flex items-center gap-1.5">
                                                    <Phone size={12} /> {client.phone_number}
                                                    <span className="bg-red-600 text-white px-2 py-0.5 rounded-md text-[9px] uppercase tracking-widest ml-2">Removido</span>
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => { setClientForm({ ...client, subscriptions: normalizeSubscriptions(client.subscriptions, client.duration_months) }); setClientModalOpen(true); }} className="px-4 py-3 rounded-xl bg-purple-100 text-purple-700 font-black text-xs uppercase hover:bg-purple-200 transition-all flex items-center gap-2" title="Ver Detalhes">
                                                    <Eye size={16} /> Ver
                                                </button>
                                                <button onClick={() => handleRestoreClient(client)} className="px-4 py-3 rounded-xl bg-indigo-100 text-indigo-700 font-black text-xs uppercase hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-2" title="Restaurar">
                                                    <Undo2 size={16} /> Restaurar
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-3 mb-4">
                                            {(normalizeSubscriptions(client.subscriptions || [], client.duration_months) as string[]).map((sub, i) => {
                                                const parts = sub.split('|');
                                                const serviceName = parts[0];
                                                const expiry = calculateExpiry(parts[1], parseInt(parts[3] || '1'));
                                                const daysLeft = getDaysRemaining(expiry);

                                                // Tolerance Check
                                                const toleranceDate = parts[4] ? new Date(parts[4]) : null;
                                                const now = new Date();
                                                if (toleranceDate) toleranceDate.setHours(23, 59, 59, 999);
                                                const isInTolerance = toleranceDate && toleranceDate.getTime() >= now.getTime();
                                                const toleranceDaysLeft = toleranceDate ? Math.ceil((toleranceDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;

                                                let statusColor = daysLeft < 0
                                                    ? (isInTolerance ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/30" : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-900/30")
                                                    : (daysLeft <= 5 ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900/30" : "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900/30");

                                                return (
                                                    <div key={i} className={`p-4 rounded-2xl border flex flex-col gap-3 transition-all ${statusColor} opacity-75`}>
                                                        <div className="flex justify-between items-center">
                                                            <div className="flex flex-col">
                                                                <span className="font-black text-xs uppercase tracking-wider">{serviceName}</span>
                                                                <span className="text-[10px] font-bold opacity-80">
                                                                    {isInTolerance
                                                                        ? `Em Tolerância (${toleranceDaysLeft}d)`
                                                                        : (daysLeft < 0 ? 'Vencido há ' + Math.abs(daysLeft) + 'd' : `Vence em ${expiry.toLocaleDateString()} (${daysLeft}d)`)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
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
                                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none"><Search className="text-indigo-400 group-focus-within:text-indigo-600 transition-colors" size={24} /></div>
                                <input className="w-full bg-indigo-50 dark:bg-slate-800 pl-14 pr-5 py-5 rounded-2xl font-black text-lg outline-none border-2 border-transparent focus:border-indigo-600 transition-all shadow-inner" placeholder="Nome ou WhatsApp do cliente..." value={loginSearchQuery} onChange={e => setLoginSearchQuery(e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-4">
                            {loginSearchResults.length === 0 && loginSearchQuery.length >= 2 ? (
                                <div className="text-center py-20 bg-white/50 rounded-3xl border border-dashed border-indigo-200"><Fingerprint className="mx-auto w-16 h-16 text-indigo-200 mb-4" /><p className="text-indigo-400 font-black uppercase tracking-tighter">Nenhum cliente encontrado</p></div>
                            ) : (
                                loginSearchResults.map((res, i) => (
                                    <div key={i} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-indigo-100 dark:border-slate-800 animate-slide-up">
                                        <div className="flex justify-between items-center mb-6 px-2"><div><h4 className="font-black text-xl text-gray-900 dark:text-white leading-none">{res.clientName}</h4><p className="text-xs font-bold text-indigo-400 mt-1 flex items-center gap-1.5"><Phone size={12} /> {res.phoneNumber}</p></div><div className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest">{res.accesses.length} Assinaturas</div></div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-separate border-spacing-y-2">
                                                <thead>
                                                    <tr className="text-[10px] font-black uppercase text-indigo-300 tracking-widest">
                                                        <th className="px-4 py-2">Aplicativo</th>
                                                        <th className="px-4 py-2">Status</th>
                                                        <th className="px-4 py-2">E-mail de Acesso</th>
                                                        <th className="px-4 py-2">Senha</th>
                                                        <th className="px-4 py-2 text-right">Acao</th>
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
                                                            <td className="px-4 py-4 bg-gray-50 dark:bg-slate-800/50">
                                                                <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">{acc.password}</span>
                                                            </td>
                                                            <td className="px-4 py-4 rounded-r-2xl bg-gray-50 dark:bg-slate-800/50 text-right">
                                                                <button
                                                                    onClick={() => copyToClipboard(`Login: ${acc.login} | Senha: ${acc.password}`, `copy-login-${i}-${idx}`)}
                                                                    className="p-2 hover:bg-white rounded-lg transition-all text-indigo-400 hover:text-indigo-600 shadow-sm"
                                                                    title="Copiar Login e Senha"
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
                        <div className="flex justify-between items-center px-2"><h3 className="font-bold text-xl flex items-center gap-2"><Key className="text-indigo-600" /> Gestão de Contas</h3><button onClick={() => { setCredForm({ service: SERVICES[0], email: '', password: '', isVisible: true, publishedAt: new Date().toISOString() }); setCredModalOpen(true); }} className="bg-indigo-600 text-white px-5 py-3 rounded-xl text-xs font-black uppercase flex items-center gap-2 shadow-lg"><Plus size={20} /> Nova Conta</button></div>
                        <div className="space-y-8">
                            {Object.entries(groupedCredentials).map(([serviceName, creds]) => (
                                <div key={serviceName} className="space-y-4">
                                    <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest px-2">{serviceName}</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {(creds as AppCredential[]).map(c => {
                                            const details = credentialClientDetails[c.id];
                                            const entries = details?.entries || [];
                                            const count = entries.length;
                                            const health = getCredentialHealth(c.service, c.publishedAt, count);
                                            const isExpanded = !!expandedCreds[c.id];
                                            const hasExpired = details?.hasExpired;
                                            const expiredClient = details?.expiredClient;
                                            const exitedEntries = details?.exitedEntries || [];
                                            const sortedEntries = [...entries].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
                                            return (
                                                <div key={c.id} className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-indigo-50 dark:border-slate-800">
                                                    <div className="flex justify-between items-center mb-4">
                                                        <div className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border ${health.color}`}>{health.label}</div>
                                                        <div className="flex gap-2 items-center">
                                                            <button onClick={() => setExpandedCreds(prev => ({ ...prev, [c.id]: !prev[c.id] }))} className="text-indigo-400 hover:text-indigo-600 p-1.5 rounded-lg bg-indigo-50/60">
                                                                <ChevronRight size={18} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                            </button>
                                                            <button onClick={() => { setCredForm(c); setCredModalOpen(true); }} className="text-gray-400 hover:text-indigo-600"><Edit2 size={18} /></button>
                                                            <button onClick={async () => { if (confirm("Excluir conta?")) { await deleteCredential(c.id); loadData(); } }} className="text-gray-300 hover:text-red-500"><Trash2 size={18} /></button>
                                                        </div>
                                                    </div>
                                                    {hasExpired && expiredClient && (
                                                        <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-200 rounded-2xl p-3 text-[10px] font-black uppercase flex items-center gap-2 border border-red-100">
                                                            <AlertTriangle size={14} />
                                                            <span>Cliente vencido nesta credencial: {expiredClient.name} • venceu em {expiredClient.expiryDate.toLocaleDateString()}</span>
                                                        </div>
                                                    )}
                                                    <p className="font-bold text-lg text-gray-800 dark:text-white break-all">{c.email}</p>
                                                    <p className="font-mono text-sm text-indigo-400 dark:text-indigo-300 mt-1 bg-indigo-50/50 dark:bg-indigo-900/30 p-2 rounded-lg inline-block">{c.password}</p>
                                                    <div className="mt-5 pt-4 border-t border-indigo-50 dark:border-slate-800 flex justify-between items-center text-xs font-bold text-gray-400 dark:text-gray-500">
                                                        <span className="flex items-center gap-1.5"><Calendar size={14} /> {new Date(c.publishedAt).toLocaleDateString()}</span>
                                                        <span className="flex items-center gap-1.5"><Users size={14} /> {count} ativos</span>
                                                    </div>
                                                    {isExpanded && (
                                                        <div className="mt-4 bg-indigo-50/60 dark:bg-slate-800/60 rounded-2xl p-4 border border-indigo-100">
                                                            <div className="flex justify-between items-center mb-3">
                                                                <span className="text-[10px] font-black uppercase text-indigo-400">Clientes conectados</span>
                                                                <span className="text-[10px] font-black uppercase text-indigo-600">{entries.length} clientes</span>
                                                            </div>
                                                            <div className="space-y-3">
                                                                {sortedEntries.length === 0 ? (
                                                                    <div className="text-[10px] font-black uppercase text-indigo-300">Nenhum cliente conectado</div>
                                                                ) : (
                                                                    sortedEntries.map((entry, idx) => (
                                                                        <div key={`${entry.clientId}-${idx}`} className="bg-white/80 dark:bg-slate-900/70 rounded-xl p-3 border border-indigo-100 flex flex-col gap-1.5">
                                                                            <div className="flex justify-between items-center">
                                                                                <div className="text-xs font-black text-gray-900 dark:text-white">{entry.name}</div>
                                                                                <div className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${entry.daysLeft < 0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                                                                                    {entry.daysLeft < 0 ? 'Vencida' : 'Ativa'}
                                                                                </div>
                                                                            </div>
                                                                            <div className="text-[10px] font-bold text-indigo-400 flex items-center gap-1.5"><Phone size={12} /> {entry.phoneNumber}</div>
                                                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9px] font-black uppercase text-indigo-400">
                                                                                <div className="flex items-center gap-1.5"><Calendar size={12} /> Enviada: {formatDate(entry.startDate)}</div>
                                                                                <div className="flex items-center gap-1.5"><Clock size={12} /> Vence: {entry.expiryDate.toLocaleDateString()}</div>
                                                                                <div className="flex items-center gap-1.5"><Users size={12} /> {entry.reason}</div>
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                )}
                                                            </div>
                                                            {exitedEntries.length > 0 && (
                                                                <div className="mt-4 pt-3 border-t border-indigo-100 space-y-2">
                                                                    <div className="flex justify-between items-center">
                                                                        <span className="text-[10px] font-black uppercase text-red-400">Saidas desta credencial</span>
                                                                        <span className="text-[10px] font-black uppercase text-red-500">{exitedEntries.length} registros</span>
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        {exitedEntries.map((entry, idx) => (
                                                                            <div key={`${entry.eventKey}-${idx}`} className="bg-red-50/70 rounded-xl p-3 border border-red-100 flex flex-col gap-1.5">
                                                                                <div className="flex justify-between items-center">
                                                                                    <div className="text-xs font-black text-gray-900 dark:text-white">{entry.name}</div>
                                                                                    <div className="text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border bg-red-50 text-red-600 border-red-200">Saiu</div>
                                                                                </div>
                                                                                <div className="text-[10px] font-bold text-red-400 flex items-center gap-1.5"><Phone size={12} /> {entry.phoneNumber}</div>
                                                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9px] font-black uppercase text-red-400">
                                                                                    <div className="flex items-center gap-1.5"><Clock size={12} /> Saiu: {new Date(entry.leftAt).toLocaleString()}</div>
                                                                                    <div className="flex items-center gap-1.5"><Users size={12} /> {entry.serviceName}</div>
                                                                                    <div className="flex items-center gap-1.5"><AlertTriangle size={12} /> {entry.reason}</div>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
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
                            <h2 className="text-2xl font-black text-red-600">Zona de Segurança</h2>

                            {/* Demo Credential Update Section */}
                            <div className="bg-indigo-50 dark:bg-slate-800 p-6 rounded-3xl space-y-4 text-left border border-indigo-100">
                                <p className="text-xs font-black uppercase text-indigo-600 tracking-widest">Credenciais Demo (6789)</p>

                                {/* Update All Button */}
                                <button
                                    onClick={async () => {
                                        // Generate unique fictitious credentials for all services with current timestamp
                                        const timestamp = Date.now();
                                        const publishedAt = new Date().toISOString();
                                        const newCreds: Record<string, { email: string, password: string, publishedAt: string }> = {};
                                        SERVICES.forEach((service, idx) => {
                                            const suffix = (timestamp + idx).toString(36).slice(-6).toUpperCase();
                                            newCreds[service.toLowerCase()] = {
                                                email: `demo.${service.toLowerCase().replace(/[^a-z]/g, '')}${suffix}@eudorama.com`,
                                                password: `PASS-${suffix}-DEMO`,
                                                publishedAt
                                            };
                                        });
                                        // Save to Supabase (shared across all browsers)
                                        await updateHistorySetting('demo_credentials_map', JSON.stringify(newCreds));
                                        // TRIGGER REALTIME: Force update the clients table for demo user to ensure listeners fire
                                        await supabase.from('clients').update({ last_active: new Date().toISOString() }).eq('phone_number', '6789');
                                        alert('✅ Todas as credenciais demo foram atualizadas no banco! A notificação aparecerá para a conta demo.');
                                    }}
                                    className="w-full bg-indigo-600 text-white font-black py-3 rounded-2xl text-xs uppercase shadow-md hover:bg-indigo-700 transition-all"
                                >
                                    🔄 Gerar Novos Fictícios (Todas)
                                </button>

                                {/* Per-Service Selectors */}
                                <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                                    {SERVICES.map(service => {
                                        const serviceCreds = credentials.filter(c => c.service.toLowerCase().includes(service.toLowerCase()));

                                        return (
                                            <div key={service} className="flex items-center gap-2 bg-white dark:bg-slate-900 p-3 rounded-xl border border-indigo-50">
                                                <span className="text-xs font-black text-indigo-600 uppercase w-20 truncate">{service}</span>
                                                <select
                                                    className="flex-1 bg-gray-50 dark:bg-slate-800 p-2 rounded-lg text-xs font-bold outline-none border border-indigo-50"
                                                    defaultValue=""
                                                    onChange={async (e) => {
                                                        const selectedId = e.target.value;
                                                        if (!selectedId) return;

                                                        // Fetch current map from Supabase
                                                        let storedMapCurrent: Record<string, any> = {};
                                                        try {
                                                            const settings = await getHistorySettings();
                                                            if (settings['demo_credentials_map']) {
                                                                storedMapCurrent = JSON.parse(settings['demo_credentials_map']);
                                                            }
                                                        } catch (e) { }

                                                        if (selectedId === 'fictitious') {
                                                            // Generate unique fictitious for this service with current timestamp
                                                            const suffix = Date.now().toString(36).slice(-6).toUpperCase();
                                                            storedMapCurrent[service.toLowerCase()] = {
                                                                email: `demo.${service.toLowerCase().replace(/[^a-z]/g, '')}${suffix}@eudorama.com`,
                                                                password: `PASS-${suffix}-DEMO`,
                                                                publishedAt: new Date().toISOString()
                                                            };
                                                            await updateHistorySetting('demo_credentials_map', JSON.stringify(storedMapCurrent));
                                                            // TRIGGER REALTIME
                                                            await supabase.from('clients').update({ last_active: new Date().toISOString() }).eq('phone_number', '6789');
                                                            alert(`✅ ${service}: Nova credencial fictícia salva no banco!`);
                                                        } else {
                                                            const cred = credentials.find(c => c.id === selectedId);
                                                            if (cred) {
                                                                storedMapCurrent[service.toLowerCase()] = {
                                                                    email: cred.email,
                                                                    password: cred.password,
                                                                    publishedAt: new Date().toISOString()
                                                                };
                                                                await updateHistorySetting('demo_credentials_map', JSON.stringify(storedMapCurrent));
                                                                // TRIGGER REALTIME
                                                                await supabase.from('clients').update({ last_active: new Date().toISOString() }).eq('phone_number', '6789');
                                                                alert(`✅ ${service}: Credencial real salva - ${cred.email}`);
                                                            }
                                                        }
                                                    }}
                                                >
                                                    <option value="">-- Selecionar --</option>
                                                    <option value="fictitious">🎲 Gerar Novo Fictício</option>
                                                    {serviceCreds.map(c => (
                                                        <option key={c.id} value={c.id}>📧 {c.email}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="text-[10px] text-gray-400 font-bold">As credenciais são salvas no banco de dados e compartilhadas entre todos os navegadores.</p>
                            </div>

                            <button onClick={async () => { if (confirm("Deseja resetar todas as senhas de clientes?")) await resetAllClientPasswords(); loadData(); }} className="w-full bg-white dark:bg-slate-900 border-2 border-red-100 text-red-500 font-black py-5 rounded-2xl text-sm uppercase shadow-sm">Resetar Senhas Clientes</button>
                            <button onClick={async () => { if (prompt("DIGITE 1202 PARA LIMPAR") === "1202") await hardDeleteAllClients(); loadData(); }} className="w-full bg-red-600 text-white font-black py-5 rounded-2xl shadow-xl text-sm uppercase">Limpar Histórico e Contas</button>
                            <p className="text-[10px] font-bold text-gray-400 uppercase mt-4">Nota: Clientes nunca são excluídos permanentemente para preservar o histórico.</p>
                        </div>
                    </div>
                )}

                {activeTab === 'history' && (
                    <div className="space-y-6 animate-fade-in pb-32">
                        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-6">
                            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><History size={24} /></div>
                                    <div>
                                        <h2 className="text-2xl font-black text-gray-900 dark:text-white">Histórico de Atividades</h2>
                                        <p className="text-sm text-indigo-400 font-bold uppercase tracking-widest">Logs de alterações e auditoria</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2 bg-indigo-50 dark:bg-slate-800 p-2 rounded-xl">
                                        <span className="text-[10px] font-black uppercase text-indigo-400 pl-2">Retenção:</span>
                                        <select
                                            value={retentionDays}
                                            onChange={(e) => handleSaveRetention(e.target.value)}
                                            className="bg-white dark:bg-slate-900 text-indigo-600 font-bold text-xs p-2 rounded-lg outline-none border border-indigo-100"
                                        >
                                            <option value="3">3 Dias</option>
                                            <option value="7">7 Dias</option>
                                            <option value="15">15 Dias</option>
                                            <option value="30">30 Dias</option>
                                        </select>
                                    </div>
                                    <button onClick={handleClearHistory} className="bg-red-50 text-red-500 hover:bg-red-500 hover:text-white px-5 py-3 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all shadow-sm border border-red-100">
                                        <Trash2 size={16} /> Limpar Tudo
                                    </button>
                                </div>
                            </div>
                        </div>

                        {historyLoading ? (
                            <div className="text-center py-20"><Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto" /></div>
                        ) : historyLogs.length === 0 ? (
                            <div className="text-center py-20 bg-white/50 rounded-3xl border border-dashed border-indigo-200">
                                <History className="mx-auto w-16 h-16 text-indigo-200 mb-4" />
                                <p className="text-indigo-400 font-black uppercase tracking-tighter">Nenhum registro encontrado</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {historyLogs.map(log => (
                                    <div key={log.id} className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-gray-100 dark:border-slate-800 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-indigo-200 transition-colors">
                                        <div className="flex items-start gap-4">
                                            <div className="p-3 bg-indigo-50 dark:bg-slate-800 rounded-2xl text-indigo-600">
                                                {log.action.includes('Remov') || log.action.includes('Delet') ? <Trash2 size={20} /> :
                                                    log.action.includes('Novo') || log.action.includes('Adiciona') ? <Plus size={20} /> :
                                                        log.action.includes('Modific') || log.action.includes('Atualiza') ? <Edit2 size={20} /> : <History size={20} />}
                                            </div>
                                            <div>
                                                <h4 className="font-black text-gray-900 dark:text-white text-lg">{log.action}</h4>
                                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">{log.details.replace(/^"|"$/g, '')}</p>
                                            </div>
                                        </div>
                                        <div className="text-right min-w-fit">
                                            <span className="text-[10px] font-black uppercase text-indigo-300 bg-indigo-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                                                <Clock size={12} /> {new Date(log.created_at).toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* MODAL CLIENTE */}
            {clientModalOpen && (
                <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto border-4 border-indigo-50 dark:border-indigo-900/30">
                        <div className="flex justify-between items-center mb-8"><h3 className="font-black text-xl text-gray-900 dark:text-white leading-none">{clientForm.id ? 'Editar Perfil' : 'Novo Cliente'}</h3><button onClick={() => setClientModalOpen(false)} className="p-2.5 bg-indigo-50 dark:bg-slate-800 rounded-full text-indigo-400"><X size={24} /></button></div>
                        <div className="space-y-6">
                            <div className="space-y-2"><label className="text-xs font-black uppercase text-indigo-400 ml-1">WhatsApp (DDD + Número)</label><input className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border-2 border-transparent focus:border-indigo-300" value={clientForm.phone_number} onChange={e => setClientForm({ ...clientForm, phone_number: e.target.value })} placeholder="88999991234" /></div>
                            <div className="space-y-2"><label className="text-xs font-black uppercase text-indigo-400 ml-1">Nome Completo</label><input className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border-2 border-transparent focus:border-indigo-300" value={clientForm.client_name} onChange={e => setClientForm({ ...clientForm, client_name: e.target.value })} placeholder="Ex: Maria Silva" /></div>
                            <div className="space-y-2"><label className="text-xs font-black uppercase text-indigo-400 ml-1">Senha do Dashboard</label><div className="relative group"><input className="w-full bg-indigo-50 dark:bg-slate-800 p-4 pl-12 rounded-2xl font-bold text-lg outline-none border-2 border-transparent focus:border-indigo-300 transition-all" value={clientForm.client_password || ''} onChange={e => setClientForm({ ...clientForm, client_password: e.target.value })} placeholder="Definir senha do cliente" /><Lock className="absolute left-4 top-4 text-indigo-300 group-focus-within:text-indigo-600" size={20} /></div><p className="text-[10px] font-bold text-gray-400 ml-1">Esta é a senha que o cliente usa para entrar no app.</p></div>
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
                                        return (
                                            <div key={i} className="flex flex-col p-5 bg-gray-50 dark:bg-slate-800 rounded-3xl border border-indigo-50 dark:border-slate-700 gap-4 shadow-sm">
                                                <div className="flex justify-between items-center"><p className="font-black text-gray-800 dark:text-white uppercase">{serviceName}</p><div className="flex gap-2"><button onClick={() => { void sendWhatsAppMessage(clientForm.phone_number || '', clientForm.client_name || 'Dorameira', serviceName, expiryDate, clientForm); }} className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-xl" title="Mandar cobrança WhatsApp"><MessageCircle size={20} /></button><button onClick={() => { const n = [...((clientForm.subscriptions as string[] | undefined) || [])]; n.splice(i, 1); setClientForm({ ...clientForm, subscriptions: n }); }} className="p-2 text-red-400 hover:bg-red-50 rounded-xl" title="Remover Assinatura"><Trash2 size={20} /></button></div></div>
                                                <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><div className="space-y-1"><label className="text-[9px] font-black uppercase text-indigo-400 ml-1">Data de Início</label><input type="date" className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl text-xs font-bold outline-none border border-indigo-50" value={toDateInput(startDate)} onChange={(e) => { const n = [...((clientForm.subscriptions as string[] | undefined) || [])]; if (n[i]) { const p = n[i].split('|'); n[i] = `${p[0]}|${new Date(e.target.value).toISOString()}|${p[2]}|${p[3] || '1'}|${p[4] || ''}|${p[5] || p[1]}`; setClientForm({ ...clientForm, subscriptions: n }); } }} /></div><div className="space-y-1"><label className="text-[9px] font-black uppercase text-indigo-400 ml-1">Plano</label><div className="flex gap-1.5"><select className="flex-1 bg-white dark:bg-slate-900 p-2 rounded-xl text-xs font-black outline-none border border-indigo-50 h-[34px]" value={durationStr} onChange={(e) => { const n = [...((clientForm.subscriptions as string[] | undefined) || [])]; if (n[i]) { const p = n[i].split('|'); n[i] = `${p[0]}|${p[1]}|${p[2]}|${e.target.value}|${p[4] || ''}|${p[5] || p[1]}`; setClientForm({ ...clientForm, subscriptions: n }); } }}>{PLAN_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><button onClick={() => handleModalSmartRenew(i)} className="p-1.5 bg-indigo-600 text-white rounded-xl shadow-sm hover:bg-indigo-700 transition-all active:scale-90" title="Renovação Inteligente"><Zap size={16} /></button></div></div></div><div className="grid grid-cols-1 gap-2"><div className="bg-indigo-50/50 dark:bg-slate-900/50 p-2.5 rounded-xl border border-indigo-100/50 flex justify-between items-center"><span className="text-[9px] font-black text-indigo-400 uppercase">Fim</span><span className="text-xs font-black text-indigo-600">{expiryDate.toLocaleDateString()}</span></div></div><div className="flex gap-2 items-center mt-2"><input type="number" min="1" max="365" placeholder="Dias" className="w-20 bg-white dark:bg-slate-900 p-2 rounded-xl text-xs font-bold outline-none border border-emerald-200 focus:border-emerald-400 text-center" value={daysToAddInputs[i] || ''} onChange={(e) => setDaysToAddInputs({ ...daysToAddInputs, [i]: parseInt(e.target.value) || 0 })} /><button onClick={() => { handleModalAddDays(i, daysToAddInputs[i] || 0); setDaysToAddInputs({ ...daysToAddInputs, [i]: 0 }); }} className="flex-1 bg-emerald-500 text-white p-2 rounded-xl text-[10px] font-black uppercase hover:bg-emerald-600 transition-all flex items-center justify-center gap-1" title="Adicionar dias manualmente à assinatura"><Plus size={14} /> Adicionar Dias</button></div></div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="p-6 bg-indigo-50/50 dark:bg-slate-800 rounded-[2.5rem] border-2 border-dashed border-indigo-100 dark:border-slate-700 space-y-4"><p className="text-[10px] font-black uppercase text-indigo-400 text-center">Adicionar Novo Aplicativo</p><div className="grid grid-cols-2 gap-3"><select className="w-full bg-white dark:bg-slate-900 p-3 rounded-2xl font-bold text-xs outline-none border border-indigo-50" value={newSubService} onChange={e => setNewSubService(e.target.value)}>{SERVICES.map(s => <option key={s} value={s}>{s}</option>)}</select><select className="w-full bg-white dark:bg-slate-900 p-3 rounded-2xl font-bold text-xs outline-none border border-indigo-50" value={newSubPlan} onChange={e => setNewSubPlan(e.target.value)}>{PLAN_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div><button onClick={() => { const now = new Date().toISOString(); setClientForm({ ...clientForm, subscriptions: [...((clientForm.subscriptions as string[] | undefined) || []), `${newSubService}|${now}|0|${newSubPlan}||${now}`] }); }} className="w-full bg-indigo-600 text-white p-4 rounded-2xl flex items-center justify-center gap-2 font-black text-xs uppercase shadow-md"><Plus size={18} /> Incluir Plano</button></div>
                            </div>
                            <div className="pt-4 space-y-2">
                                <label className="text-xs font-black uppercase text-indigo-400 ml-1">Observações (Interno)</label>
                                <textarea
                                    className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-sm outline-none border-2 border-transparent focus:border-indigo-300 resize-none h-24"
                                    placeholder="Ex: Cliente prefere contato via WhatsApp..."
                                    value={clientForm.observation || ''}
                                    onChange={e => setClientForm({ ...clientForm, observation: e.target.value })}
                                />
                            </div>
                            <button onClick={handleSaveClient} disabled={savingClient} className="w-full bg-indigo-600 text-white font-black py-5 rounded-3xl shadow-xl mt-6 active:scale-95 transition-transform">{savingClient ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : 'Salvar Alterações'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL CONTA */}
            {credModalOpen && (
                <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative border border-indigo-100"><div className="flex justify-between items-center mb-8"><h3 className="font-black text-xl text-gray-900 dark:text-white leading-none">{credForm.id ? 'Editar Conta' : 'Nova Conta'}</h3><button onClick={() => setCredModalOpen(false)} className="p-2.5 bg-gray-100 dark:bg-slate-800 rounded-full text-gray-400"><X size={24} /></button></div><div className="space-y-5"><div className="space-y-2"><label className="text-xs font-black uppercase text-indigo-400 ml-1">Serviço</label><select className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border border-indigo-100" value={credForm.service} onChange={e => setCredForm({ ...credForm, service: e.target.value })}>{SERVICES.map(s => <option key={s} value={s}>{s}</option>)}</select></div><div className="space-y-2"><label className="text-xs font-black uppercase text-indigo-400 ml-1">E-mail / Login</label><input className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border border-indigo-100" value={credForm.email} onChange={e => setCredForm({ ...credForm, email: e.target.value })} placeholder="email@exemplo.com" /></div><div className="space-y-2"><label className="text-xs font-black uppercase text-indigo-400 ml-1">Senha</label><input className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border border-indigo-100" value={credForm.password} onChange={e => setCredForm({ ...credForm, password: e.target.value })} placeholder="******" /></div><div className="space-y-2"><label className="text-xs font-black uppercase text-indigo-400 ml-1">Data de Publicação</label><input type="datetime-local" className="w-full bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl font-bold text-lg outline-none border border-indigo-100" value={toLocalInput(credForm.publishedAt || new Date().toISOString())} onChange={e => setCredForm({ ...credForm, publishedAt: new Date(e.target.value).toISOString() })} /></div><button onClick={handleSaveCred} disabled={loading} className="w-full bg-indigo-600 text-white font-black py-5 rounded-3xl shadow-xl mt-6 active:scale-95 transition-transform">{loading ? <Loader2 className="animate-spin w-6 h-6 mx-auto" /> : 'Salvar Dados'}</button></div></div>
                </div>
            )}
        </div>
    );
};

