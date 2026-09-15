import { AppCredential, User, ClientDBRow } from '../types';
import { supabase } from './clientService';
import { getAccountCycleDays } from './financeConfig';

// Credential cache
let credentialsCache: { data: AppCredential[]; timestamp: number } | null = null;
const CREDENTIALS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// Distribution clients cache (minimal columns only)
type DistributionClientRow = Pick<ClientDBRow, 'id' | 'phone_number' | 'subscriptions' | 'duration_months' | 'deleted' | 'manual_credentials'>;
let distributionClientsCache: { data: DistributionClientRow[]; timestamp: number } | null = null;
const DISTRIBUTION_CLIENTS_CACHE_TTL = 30 * 1000; // 30 seconds

export const normalizeSubscriptions = (subs: any, defaultDuration: number = 1): string[] => {
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

export const getCanonicalServiceKey = (service: string): string => {
    const clean = String(service || '').split('|')[0].trim().toLowerCase();
    if (clean.includes('viki')) return 'viki';
    if (clean.includes('kocowa')) return 'kocowa';
    if (clean.includes('iqiyi')) return 'iqiyi';
    if (clean.includes('wetv')) return 'wetv';
    if (clean.includes('dramabox')) return 'dramabox';
    if (clean.includes('youku')) return 'youku';
    return clean;
};

export const matchesServiceName = (credentialService: string, serviceLower: string) => {
    const dbService = String(credentialService || '').toLowerCase().trim();
    const subService = String(serviceLower || '').toLowerCase().trim();
    if (!dbService || !subService) return false;
    return dbService.includes(subService) || subService.includes(dbService) || getCanonicalServiceKey(dbService) === getCanonicalServiceKey(subService);
};

export const getAssignedCredentialId = (manualCreds?: Record<string, string> | null, serviceName?: string): string | null => {
    if (!manualCreds || typeof manualCreds !== 'object' || !serviceName) return null;
    const clean = serviceName.split('|')[0].trim();
    const canonical = getCanonicalServiceKey(clean);

    if (manualCreds[clean]) return manualCreds[clean];
    if (manualCreds[canonical]) return manualCreds[canonical];

    for (const [key, credId] of Object.entries(manualCreds)) {
        if (!credId) continue;
        if (key.toLowerCase() === clean.toLowerCase() || getCanonicalServiceKey(key) === canonical) {
            return credId;
        }
    }
    return null;
};

export const normalizePhoneKey = (value: string | undefined | null) => {
    const raw = String(value || '').trim();
    const digits = raw.replace(/\D/g, '');
    return digits || raw;
};

export const getToleranceEndDate = (raw?: string | null) => {
    if (!raw) return null;
    const toleranceDate = new Date(raw);
    if (Number.isNaN(toleranceDate.getTime())) return null;
    toleranceDate.setHours(23, 59, 59, 999);
    return toleranceDate;
};

export const isToleranceActive = (raw?: string | null, nowRef?: Date) => {
    const toleranceDate = getToleranceEndDate(raw);
    if (!toleranceDate) return false;
    const now = nowRef ? new Date(nowRef) : new Date();
    return toleranceDate.getTime() >= now.getTime();
};

export const calculateExpiry = (dateStr: string, months: number) => {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return new Date();
    date.setDate(date.getDate() + ((months || 1) * 30));
    return date;
};

export const getDaysRemaining = (expiryDate: Date) => {
    const now = new Date();
    const expiry = new Date(expiryDate);
    expiry.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

export const isSubscriptionActiveNow = (startDate: string, duration: number, toleranceRaw?: string | null, nowRef?: Date) => {
    const expiryDate = calculateExpiry(startDate, duration);
    const daysLeft = getDaysRemaining(expiryDate);
    if (daysLeft >= 0) return true;
    return isToleranceActive(toleranceRaw, nowRef);
};

export const getServiceCredentials = (credentialsList: AppCredential[], serviceLower: string) => {
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
                const parts = sub.split('|');
                const subService = (parts[0] || '').trim().toLowerCase();
                if (!subService || !matchesServiceName(subService, serviceLower)) return false;
                const startDate = parts[1] || '1970-01-01T00:00:00.000Z';
                const duration = parseInt(parts[3] || String(c.duration_months || 1));
                const toleranceUntil = parts[4] || '';
                return isSubscriptionActiveNow(startDate, duration, toleranceUntil);
            });
        })
        .sort((a, b) => normalizePhoneKey(a.phone_number).localeCompare(normalizePhoneKey(b.phone_number)) || String(a.id || '').localeCompare(String(b.id || '')));
};

export const fetchDistributionClients = async (retries = 2): Promise<DistributionClientRow[]> => {
    if (distributionClientsCache && Date.now() - distributionClientsCache.timestamp < DISTRIBUTION_CLIENTS_CACHE_TTL) {
        return distributionClientsCache.data;
    }

    try {
        const { data, error } = await supabase
            .from('clients')
            .select('id,phone_number,subscriptions,duration_months,deleted,manual_credentials');

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

    // 1. Check if user already has an assigned credential in memory
    const existingCredId = getAssignedCredentialId(user.manualCredentials, serviceName);
    if (existingCredId) {
        const found = serviceCreds.find(c => c.id === existingCredId);
        if (found) {
            const health = calculateHealth(found, serviceName);
            return { credential: found, alert: health.alert, daysActive: health.daysActive };
        }
    }

    // 2. Check DB records (in case memory does not have manualCredentials yet)
    const distributionClients = await fetchDistributionClients();
    const userPhoneKey = normalizePhoneKey(user.phoneNumber);
    const dbClient = distributionClients.find(c => normalizePhoneKey(c.phone_number) === userPhoneKey || (user.id && c.id === user.id));
    if (dbClient?.manual_credentials) {
        const dbCredId = getAssignedCredentialId(dbClient.manual_credentials, serviceName);
        if (dbCredId) {
            const found = serviceCreds.find(c => c.id === dbCredId);
            if (found) {
                if (user.manualCredentials) {
                    user.manualCredentials[getCanonicalServiceKey(serviceName)] = found.id;
                    user.manualCredentials[serviceName] = found.id;
                }
                const health = calculateHealth(found, serviceName);
                return { credential: found, alert: health.alert, daysActive: health.daysActive };
            }
        }
    }

    // 3. Not assigned yet! Distribute equally across available credentials:
    // Count active assignments for each credential of this service
    const activeClientsForService = getActiveClientsForService(distributionClients, cleanServiceName);
    const countsMap = new Map<string, number>();
    serviceCreds.forEach(c => countsMap.set(c.id, 0));

    activeClientsForService.forEach(client => {
        const credId = getAssignedCredentialId(client.manual_credentials, cleanServiceName);
        if (credId && countsMap.has(credId)) {
            countsMap.set(credId, (countsMap.get(credId) || 0) + 1);
        }
    });

    // Find the minimum count among available credentials
    let minCount = Infinity;
    serviceCreds.forEach(c => {
        const count = countsMap.get(c.id) || 0;
        if (count < minCount) minCount = count;
    });

    // Pick randomly among the candidates with the minimum count (Rule 1)
    const candidates = serviceCreds.filter(c => (countsMap.get(c.id) || 0) === minCount);
    const chosenCred = candidates[Math.floor(Math.random() * candidates.length)];

    // Persist assignment to DB and user object immediately!
    const targetClientId = user.id || dbClient?.id;
    const targetPhone = user.phoneNumber || dbClient?.phone_number;
    const canonicalKey = getCanonicalServiceKey(cleanServiceName);

    if (targetClientId || targetPhone) {
        const currentManual = dbClient?.manual_credentials || user.manualCredentials || {};
        const nextManual = {
            ...currentManual,
            [canonicalKey]: chosenCred.id,
            [serviceName]: chosenCred.id
        };
        void (async () => {
            try {
                if (targetClientId) {
                    await supabase.from('clients').update({ manual_credentials: nextManual }).eq('id', targetClientId);
                } else if (targetPhone) {
                    await supabase.from('clients').update({ manual_credentials: nextManual }).eq('phone_number', targetPhone);
                }
                distributionClientsCache = null;
            } catch (err) {
                console.error('Erro ao persistir vínculo de credencial:', err);
            }
        })();
    }

    if (user.manualCredentials) {
        user.manualCredentials[canonicalKey] = chosenCred.id;
        user.manualCredentials[serviceName] = chosenCred.id;
    }

    const health = calculateHealth(chosenCred, serviceName);
    return {
        credential: chosenCred,
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
        const cycleDays = getAccountCycleDays(serviceName);
        if (daysPassed >= cycleDays) alertMsg = `Conta expirada (${cycleDays} dias).`;
    } else if (sName.includes('kocowa')) {
        if (daysPassed >= 25) alertMsg = 'Proximo do vencimento.';
    }

    return { alert: alertMsg, daysActive: daysPassed };
};

export const getClientsUsingCredential = async (credential: AppCredential, clients: ClientDBRow[]): Promise<ClientDBRow[]> => {
    const credServiceLower = credential.service.toLowerCase().split('|')[0].trim();
    return clients.filter(c => {
        if (c.deleted) return false;
        const linkedCredId = getAssignedCredentialId(c.manual_credentials, credServiceLower);
        return linkedCredId === credential.id;
    });
};

/**
 * Distribute unassigned clients equally across credentials for a given service.
 * Rule 1: Equal distribution with random remainder.
 * Rule 2: Already assigned clients remain untouched unless forceRebalance is true.
 */
export const distributeUnassignedClients = async (
    serviceName: string,
    clientsList?: ClientDBRow[],
    forceRebalance = false
): Promise<{ assignedCount: number; errors: number }> => {
    const cleanServiceName = serviceName.split('|')[0].trim().toLowerCase();
    const canonicalKey = getCanonicalServiceKey(cleanServiceName);
    const allCreds = await fetchCredentials();
    const serviceCreds = getServiceCredentials(allCreds, cleanServiceName);
    if (serviceCreds.length === 0) return { assignedCount: 0, errors: 0 };

    let clients = clientsList;
    if (!clients) {
        const { data } = await supabase.from('clients').select('id,phone_number,subscriptions,duration_months,deleted,manual_credentials');
        clients = (data || []) as ClientDBRow[];
    }

    const eligibleClients = clients.filter(c => {
        if (c.deleted) return false;
        const subs = normalizeSubscriptions(c.subscriptions || [], c.duration_months || 1);
        return subs.some(sub => {
            const parts = sub.split('|');
            const subService = (parts[0] || '').trim().toLowerCase();
            return subService && matchesServiceName(subService, cleanServiceName);
        });
    });

    const countsMap = new Map<string, number>();
    serviceCreds.forEach(c => countsMap.set(c.id, 0));

    const unassigned: ClientDBRow[] = [];

    eligibleClients.forEach(c => {
        const existingCredId = getAssignedCredentialId(c.manual_credentials, cleanServiceName);
        const validCred = existingCredId ? serviceCreds.find(cred => cred.id === existingCredId) : null;
        if (validCred && !forceRebalance) {
            countsMap.set(validCred.id, (countsMap.get(validCred.id) || 0) + 1);
        } else {
            unassigned.push(c);
        }
    });

    if (unassigned.length === 0) return { assignedCount: 0, errors: 0 };

    // Shuffle unassigned clients so order is impartial
    const shuffled = [...unassigned].sort(() => Math.random() - 0.5);

    let assignedCount = 0;
    let errors = 0;

    for (const client of shuffled) {
        // Find credentials with minimum count
        let minCount = Infinity;
        serviceCreds.forEach(c => {
            const count = countsMap.get(c.id) || 0;
            if (count < minCount) minCount = count;
        });

        const candidates = serviceCreds.filter(c => (countsMap.get(c.id) || 0) === minCount);
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];

        countsMap.set(chosen.id, (countsMap.get(chosen.id) || 0) + 1);

        const currentManual = client.manual_credentials || {};
        const nextManual = {
            ...currentManual,
            [canonicalKey]: chosen.id,
            [cleanServiceName]: chosen.id
        };
        client.manual_credentials = nextManual;

        try {
            const { error } = await supabase.from('clients').update({ manual_credentials: nextManual }).eq('id', client.id);
            if (error) errors++;
            else assignedCount++;
        } catch {
            errors++;
        }
    }

    distributionClientsCache = null;
    return { assignedCount, errors };
};
