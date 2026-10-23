/**
 * Configuração financeira centralizada para custos e divisão de receitas.
 */

// --- CUSTOS DAS CONTAS (por ciclo de cobrança, por conta) ---
// Únicos gastos com apps: IQIYI (R$ 10,00) e VIKI PASS (R$ 40,00)
export const ACCOUNT_COSTS: Record<string, number> = {
    'Viki Pass': 40.00,
    'IQIYI': 10.00,
    'WeTV': 0,
    'Kocowa+': 0,
    'DramaBox': 0,
    'Youku': 0,
};

export const DAYS_IN_MONTH = 30;

export const ACCOUNT_CYCLE_DAYS: Record<string, number> = {
    'Viki Pass': 35,
    'IQIYI': 30,
    'Kocowa+': 25,
    'WeTV': 30,
    'DramaBox': 30,
    'Youku': 30,
};

// --- DIVISÃO DE CUSTOS (quem paga o quê) ---
// O IQIYI custa 10 reais sendo todos pagos pelo Orion (100% Orion, 0% Iohanna)
// O VIKI PASS custa 40 reais sendo 70% desse valor pago pelo Orion (70% Orion, 30% Iohanna)
export const getCostSplit = (serviceName: string) => {
    const s = serviceName.toLowerCase();
    if (s.includes('iqiyi') || s.includes('iqyi')) {
        return { orion: 1.0, iohanna: 0.0 };
    }
    if (s.includes('viki')) {
        return { orion: 0.70, iohanna: 0.30 };
    }
    // Demais apps sem custos de assinatura de conta
    return { orion: 0.50, iohanna: 0.50 };
};

// --- DIVISÃO DE RECEITAS ---
// Orion recebe 70% de: Viki Pass, Kocowa, IQIYI, DramaBox (Iohanna 30%)
// Iohanna recebe 70% de: WeTV, Youku (Orion 30%)
const ORION_70_REVENUE_SERVICES = ['viki', 'kocowa', 'iqiyi', 'iqyi', 'dramabox'];
const IOHANNA_70_REVENUE_SERVICES = ['youku', 'wetv'];

export const getRevenueSplit = (serviceName: string) => {
    const s = serviceName.toLowerCase();

    if (ORION_70_REVENUE_SERVICES.some(svc => s.includes(svc))) {
        return { orion: 0.70, iohanna: 0.30 };
    }

    if (IOHANNA_70_REVENUE_SERVICES.some(svc => s.includes(svc))) {
        return { orion: 0.30, iohanna: 0.70 };
    }

    // Default 50/50 para serviços não listados
    return { orion: 0.50, iohanna: 0.50 };
};

// --- GASTOS COM ANÚNCIOS ---
export const DEFAULT_AD_SPEND_PER_DAY = 10.00;

// --- HELPERS ---
const findAccountKey = (serviceName: string): string | undefined => {
    return Object.keys(ACCOUNT_COSTS).find(k =>
        serviceName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(serviceName.toLowerCase())
    );
};

export const getAccountCost = (serviceName: string): number => {
    const key = findAccountKey(serviceName);
    return key ? ACCOUNT_COSTS[key] : 0;
};

export const getAccountCycleDays = (serviceName: string): number => {
    const key = Object.keys(ACCOUNT_CYCLE_DAYS).find(k =>
        serviceName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(serviceName.toLowerCase())
    );
    return key ? ACCOUNT_CYCLE_DAYS[key] : DAYS_IN_MONTH;
};

export const getAccountMonthlyCost = (serviceName: string): number => {
    const cycleCost = getAccountCost(serviceName);
    const cycleDays = getAccountCycleDays(serviceName);
    if (!cycleCost || !cycleDays) return 0;
    return cycleCost * (DAYS_IN_MONTH / cycleDays);
};

export const formatCurrency = (value: number): string => {
    return (Number(value) || 0).toFixed(2).replace('.', ',');
};

// --- CÁLCULO DE VENCIMENTO DE CONTAS DE APPS ---
export const getAccountExpiryDate = (publishedAt: string, serviceName: string): Date => {
    const pubDate = new Date(publishedAt);
    if (Number.isNaN(pubDate.getTime())) return new Date();
    const cycleDays = getAccountCycleDays(serviceName);
    const expiry = new Date(pubDate);
    expiry.setDate(expiry.getDate() + cycleDays);
    return expiry;
};

export const getAccountDaysRemaining = (publishedAt: string, serviceName: string): number => {
    const expiry = getAccountExpiryDate(publishedAt, serviceName);
    const now = new Date();
    expiry.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

export const getAccountStatus = (publishedAt: string, serviceName: string) => {
    const daysRemaining = getAccountDaysRemaining(publishedAt, serviceName);
    const expiryDate = getAccountExpiryDate(publishedAt, serviceName);
    
    if (daysRemaining < 0) {
        return {
            status: 'expired',
            label: 'Vencida',
            badgeClass: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
            daysRemaining,
            expiryDate,
            text: `Vencida há ${Math.abs(daysRemaining)} dias (${expiryDate.toLocaleDateString()})`
        };
    }
    if (daysRemaining <= 5) {
        return {
            status: 'expiring',
            label: daysRemaining === 0 ? 'Vence Hoje' : `Vence em ${daysRemaining}d`,
            badgeClass: 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
            daysRemaining,
            expiryDate,
            text: daysRemaining === 0 ? `Vence hoje (${expiryDate.toLocaleDateString()})` : `Vence em ${daysRemaining} dias (${expiryDate.toLocaleDateString()})`
        };
    }
    return {
        status: 'healthy',
        label: 'Em Dia',
        badgeClass: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
        daysRemaining,
        expiryDate,
        text: `Vence em ${daysRemaining} dias (${expiryDate.toLocaleDateString()})`
    };
};

// --- LIMITES DE CAPACIDADE POR CONTA ---
export const CAPACITY_LIMITS: Record<string, number> = {
    'viki': 8,
    'viki pass': 8,
    'kocowa': 7,
    'kocowa+': 7,
    'iqiyi': 15,
    'wetv': 9999,
    'dramabox': 9999,
    'youku': 9999,
};

export const getCapacityLimit = (serviceName: string): number => {
    const s = serviceName.toLowerCase();
    const key = Object.keys(CAPACITY_LIMITS).find(k => s.includes(k) || k.includes(s));
    return key ? CAPACITY_LIMITS[key] : 10; // Default 10
};
