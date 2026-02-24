/**
 * Configuração financeira centralizada para custos e divisão de receitas.
 */

// --- CUSTOS DAS CONTAS (por mês, por conta) ---
export const ACCOUNT_COSTS: Record<string, number> = {
    'Viki Pass': 37.90,
    'IQIYI': 9.90,
    'WeTV': 13.90,
    // Outros serviços sem custo de conta própria
    'Kocowa+': 0,
    'DramaBox': 0,
    'Youku': 0,
};

// --- DIVISÃO DE CUSTOS (quem paga o quê) ---
// Serviços onde Orion paga 70% e Iohanna 30%
const ORION_70_COST_SERVICES = ['viki', 'iqiyi', 'wetv'];

export const getCostSplit = (serviceName: string) => {
    const s = serviceName.toLowerCase();
    const isOrion70 = ORION_70_COST_SERVICES.some(svc => s.includes(svc));
    return isOrion70
        ? { orion: 0.70, iohanna: 0.30 }
        : { orion: 0.50, iohanna: 0.50 }; // Default 50/50 se não especificado
};

// --- DIVISÃO DE RECEITAS ---
// Orion recebe 70% de: Viki Pass, Kocowa, IQIYI, DramaBox
// Iohanna recebe 70% de: Youku, WeTV
const ORION_70_REVENUE_SERVICES = ['viki', 'kocowa', 'iqiyi', 'dramabox'];
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
export const DAYS_IN_MONTH = 30;

// --- HELPERS ---
export const getAccountCost = (serviceName: string): number => {
    const key = Object.keys(ACCOUNT_COSTS).find(k =>
        serviceName.toLowerCase().includes(k.toLowerCase())
    );
    return key ? ACCOUNT_COSTS[key] : 0;
};

export const formatCurrency = (value: number): string => {
    return value.toFixed(2).replace('.', ',');
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
