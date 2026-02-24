import { AppCredential, User, ClientDBRow } from '../types';
import { supabase } from './clientService';

// Credential cache
let credentialsCache: { data: AppCredential[]; timestamp: number } | null = null;
const CREDENTIALS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// Distribution clients cache (minimal columns only)
type DistributionClientRow = Pick<ClientDBRow, 'id' | 'phone_number' | 'subscriptions' | 'duration_months' | 'deleted'>;
let distributionClientsCache: { data: DistributionClientRow[]; timestamp: number } | null = null;
const DISTRIBUTION_CLIENTS_CACHE_TTL = 60 * 1000; // 1 minute

const normalizeSubscriptions = (subs: any, defaultDuration: number = 1): string[] => {
    let list: any[] = [];

    if (Array.isArray(subs)) {
        list = subs;
    } else if (typeof subs === 'string') {
        const cleaned = String(subs).replace(/^\{|\}$/g, '');
        if (!cleaned) list = [];
        else if (cleaned.includes(';')) list = cleaned.split(';');
        else if (cleaned.includes(',')) list = cleaned.split(',');
        else if (cleaned.includes('+')) list = cleaned.split('+');
        else list = [cleaned];
    }

    const result = (list || []).map((s: any) => {
        const str = String(s || '').trim().replace(/^"|"$/g, '');
        if (!str) return '';
        const parts = str.split('|');
        const name = parts[0] || 'Desconhecido';
        const date = parts[1] || '1970-01-01T00:00:00.000Z';
        const status = parts[2] || '0';
        const duration = (parts[3] && parts[3].trim() !== '') ? parts[3] : String(defaultDuration || 1);
        const tolerance = parts[4] || '';
        const originalPaymentDate = parts[5] || date;
        return `${name}|${date}|${status}|${duration}|${tolerance}|${originalPaymentDate}`;
    });

    return result.filter((s: string) => s.length > 0 && s.toLowerCase() !== 'null' && s !== '""' && !s.startsWith('|'));
};

const matchesServiceName = (credentialService: string, serviceLower: string) => {
    const dbService = String(credentialService || '').toLowerCase().trim();
    const subService = String(serviceLower || '').toLowerCase().trim();
    if (!dbService || !subService) return false;
    return dbService.includes(subService) || subService.includes(dbService);
};

const normalizePhoneKey = (value: string | undefined | null) => {
    const raw = String(value || '').trim();
    const digits = raw.replace(/\D/g, '');
    return digits || raw;
};

const getServiceCredentials = (credentialsList: AppCredential[], serviceLower: string) => {
    return credentialsList
        .filter(c => {
            if (!c.isVisible) return false;
            if ((c.email || '').toLowerCase().includes('demo')) return false;
            return matchesServiceName(c.service, serviceLower);
        })
        .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
};

const getActiveClientsForService = (clients: DistributionClientRow[], serviceLower: string) => {
    return clients
        .filter(c => {
            if (c.deleted) return false;
            const subs = normalizeSubscriptions(c.subscriptions || [], c.duration_months || 1);
            return subs.some(sub => {
                const subService = (sub.split('|')[0] || '').trim().toLowerCase();
                return subService && (subService.includes(serviceLower) || serviceLower.includes(subService));
            });
        })
        .sort((a, b) => normalizePhoneKey(a.phone_number).localeCompare(normalizePhoneKey(b.phone_number)) || String(a.id || '').localeCompare(String(b.id || '')));
};

const fetchDistributionClients = async (retries = 2): Promise<DistributionClientRow[]> => {
    if (distributionClientsCache && Date.now() - distributionClientsCache.timestamp < DISTRIBUTION_CLIENTS_CACHE_TTL) {
        return distributionClientsCache.data;
    }

    try {
        const { data, error } = await supabase
            .from('clients')
            .select('id,phone_number,subscriptions,duration_months,deleted');

        if (error) {
            if (retries > 0) {
                await new Promise(r => setTimeout(r, 800));
                return fetchDistributionClients(retries - 1);
            }
            return [];
        }

        const result = (data || []) as DistributionClientRow[];
        distributionClientsCache = { data: result, timestamp: Date.now() };
        return result;
    } catch (e: any) {
        if (retries > 0 && String(e?.message || '').includes('fetch')) {
            await new Promise(r => setTimeout(r, 800));
            return fetchDistributionClients(retries - 1);
        }
        return [];
    }
};

export const fetchCredentials = async (retries = 3): Promise<AppCredential[]> => {
    if (credentialsCache && Date.now() - credentialsCache.timestamp < CREDENTIALS_CACHE_TTL) {
        return credentialsCache.data;
    }

    try {
        const { data, error } = await supabase
            .from('credentials')
            .select('id,service,email,password,published_at,is_visible');

        if (error) {
            console.error('Erro ao buscar credenciais do Supabase:', error.message || error);
            if (retries > 0) {
                await new Promise(r => setTimeout(r, 1000));
                return fetchCredentials(retries - 1);
            }
            return [];
        }
        if (!data) return [];

        const result = data.map((row: any) => ({
            id: row.id,
            service: row.service,
            email: row.email,
            password: row.password,
            publishedAt: row.published_at,
            isVisible: row.is_visible
        }));

        credentialsCache = { data: result, timestamp: Date.now() };
        return result;
    } catch (e: any) {
        console.error('Excecao ao buscar credenciais:', e.message || e);
        if (retries > 0 && String(e?.message || '').includes('fetch')) {
            await new Promise(r => setTimeout(r, 1000));
            return fetchCredentials(retries - 1);
        }
        return [];
    }
};

export const saveCredential = async (cred: AppCredential): Promise<string | null> => {
    try {
        const payload: any = {
            service: cred.service,
            email: cred.email,
            password: cred.password,
            published_at: cred.publishedAt,
            is_visible: cred.isVisible
        };

        if (cred.id && cred.id.trim() !== '') payload.id = cred.id;

        const { data, error } = await supabase
            .from('credentials')
            .upsert(payload)
            .select()
            .single();

        if (error) {
            console.error('Erro ao salvar credencial:', error.message);
            return null;
        }

        credentialsCache = null;
        return data.id;
    } catch (e: any) {
        console.error('Excecao ao salvar credencial:', e.message);
        return null;
    }
};

export const deleteCredential = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('credentials').delete().eq('id', id);
    if (!error) credentialsCache = null;
    return !error;
};

export const getAssignedCredential = async (user: User, serviceName: string): Promise<{ credential: AppCredential | null; alert: string | null; daysActive: number }> => {
    const credentialsList = await fetchCredentials();
    const cleanServiceName = serviceName.split('|')[0].trim().toLowerCase();

    // Demo override
    if (user.phoneNumber === '6789' || user.name === 'Demo') {
        let storedMap: Record<string, { email: string; password: string; publishedAt?: string }> = {};
        try {
            const { data } = await supabase.from('history_settings').select('value').eq('key', 'demo_credentials_map').single();
            if (data?.value) storedMap = JSON.parse(data.value);
        } catch {
            // keep empty map
        }

        const serviceKey = cleanServiceName.replace(/[^a-z]/g, '');
        const credentialData = storedMap[cleanServiceName] || storedMap[serviceKey];

        let demoEmail: string;
        let demoPassword: string;
        let publishedAt: string;
        let isCustom = false;

        if (credentialData) {
            demoEmail = credentialData.email;
            demoPassword = credentialData.password;
            publishedAt = credentialData.publishedAt || new Date().toISOString();
            isCustom = !demoEmail.includes('@eudorama.com') || !demoPassword.includes('DEMO');
        } else {
            const dateSuffix = Date.now().toString(36).slice(-4).toUpperCase();
            demoEmail = `demo.${serviceKey}${dateSuffix}@eudorama.com`;
            demoPassword = `PASS-${serviceKey.toUpperCase().slice(0, 4)}${dateSuffix}-DEMO`;
            publishedAt = '2020-01-01T00:00:00.000Z';
        }

        return {
            credential: {
                id: 'demo-id',
                service: serviceName,
                email: demoEmail,
                password: demoPassword,
                publishedAt,
                isVisible: true
            },
            alert: isCustom ? 'Demo (Credencial Real)' : 'Demo (Ficticio)',
            daysActive: 0
        };
    }

    const serviceCreds = getServiceCredentials(credentialsList, cleanServiceName);
    if (serviceCreds.length === 0) return { credential: null, alert: 'Nenhuma conta disponivel.', daysActive: 0 };

    let assignedCred: AppCredential | null = null;

    // Balanced distribution: rank active clients with this service and assign round-robin
    const distributionClients = await fetchDistributionClients();
    if (distributionClients.length > 0) {
        const activeClientsForService = getActiveClientsForService(distributionClients, cleanServiceName);
        const userPhoneKey = normalizePhoneKey(user.phoneNumber);
        const rank = activeClientsForService.findIndex(c => normalizePhoneKey(c.phone_number) === userPhoneKey);
        if (rank !== -1) assignedCred = serviceCreds[rank % serviceCreds.length];
    }

    // Fallback for first access / missing rank
    if (!assignedCred) {
        const phoneHash = String(user.phoneNumber || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        assignedCred = serviceCreds[phoneHash % serviceCreds.length];
    }

    const health = calculateHealth(assignedCred, serviceName);
    return {
        credential: assignedCred,
        alert: health.alert,
        daysActive: health.daysActive
    };
};

const calculateHealth = (cred: AppCredential, serviceName: string) => {
    const dateCreated = new Date(cred.publishedAt);
    const today = new Date();
    dateCreated.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - dateCreated.getTime();
    const daysPassed = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let alertMsg: string | null = null;
    const sName = serviceName.toLowerCase();

    if (sName.includes('viki')) {
        if (daysPassed >= 30) alertMsg = 'Conta expirada (30 dias).';
    } else if (sName.includes('kocowa')) {
        if (daysPassed >= 25) alertMsg = 'Proximo do vencimento.';
    }

    return { alert: alertMsg, daysActive: daysPassed };
};

export const getClientsUsingCredential = async (credential: AppCredential, clients: ClientDBRow[]): Promise<ClientDBRow[]> => {
    const credServiceLower = credential.service.toLowerCase().split('|')[0].trim();
    const allCreds = await fetchCredentials();
    const serviceCreds = getServiceCredentials(allCreds, credServiceLower);

    const myIndex = serviceCreds.findIndex(c => c.id === credential.id);
    if (myIndex === -1) return [];

    const activeClientsWithService = clients
        .filter(c => {
            if (c.deleted) return false;
            const subscriptions = normalizeSubscriptions(c.subscriptions || [], c.duration_months || 1);
            return subscriptions.some(sub => {
                const subService = (sub.split('|')[0] || '').trim().toLowerCase();
                return subService && (subService.includes(credServiceLower) || credServiceLower.includes(subService));
            });
        })
        .sort((a, b) => normalizePhoneKey(a.phone_number).localeCompare(normalizePhoneKey(b.phone_number)) || String(a.id || '').localeCompare(String(b.id || '')));

    return activeClientsWithService.filter((_, idx) => idx % serviceCreds.length === myIndex);
};
