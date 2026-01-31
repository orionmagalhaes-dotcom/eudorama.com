
import { AppCredential, User, ClientDBRow } from '../types';
import { supabase } from './clientService';

// --- CACHE DE CREDENCIAIS (OTIMIZAÇÃO EGRESS) ---
let credentialsCache: { data: AppCredential[], timestamp: number } | null = null;
const CREDENTIALS_CACHE_TTL = 2 * 60 * 1000; // 2 minutos

// Limites atualizados conforme solicitado
const CREDENTIAL_LIMITS: Record<string, number> = {
    'viki': 6,
    'kocowa': 7,
    'iqiyi': 15,
    'wetv': 9999,
    'dramabox': 9999,
    'default': 10
};

export const fetchCredentials = async (retries = 3): Promise<AppCredential[]> => {
    // OTIMIZAÇÃO: Verificar cache primeiro
    if (credentialsCache && Date.now() - credentialsCache.timestamp < CREDENTIALS_CACHE_TTL) {
        return credentialsCache.data;
    }

    try {
        const { data, error } = await supabase
            .from('credentials')
            .select('id,service,email,password,published_at,is_visible');

        if (error) {
            console.error("Erro ao buscar credenciais do Supabase:", error.message || error);
            if (retries > 0) {
                console.log(`Tentando novamente em 1 segundo... (${retries} restantes)`);
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

        // Salvar no cache
        credentialsCache = { data: result, timestamp: Date.now() };
        return result;
    } catch (e: any) {
        console.error("Exceção ao buscar credenciais (TypeError provável):", e.message || e);
        if (retries > 0 && e.message?.includes('fetch')) {
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

        if (cred.id && cred.id.trim() !== '') {
            payload.id = cred.id;
        }

        const { data, error } = await supabase
            .from('credentials')
            .upsert(payload)
            .select()
            .single();

        if (error) {
            console.error("Erro ao salvar credencial:", error.message);
            return null;
        }
        return data.id;
    } catch (e: any) {
        console.error("Exceção ao salvar credencial:", e.message);
        return null;
    }
};

export const deleteCredential = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('credentials').delete().eq('id', id);
    return !error;
};

// --- ESTRATÉGIA DE DISTRIBUIÇÃO DINÂMICA (HASH-BASED - SEM FETCH DE TODOS CLIENTES) ---
export const getAssignedCredential = async (user: User, serviceName: string): Promise<{ credential: AppCredential | null, alert: string | null, daysActive: number }> => {

    const credentialsList = await fetchCredentials();
    const cleanServiceName = serviceName.split('|')[0].trim().toLowerCase();

    // OVERRIDE DEMO: Para Orion Magalhães (6789), sempre retorna uma conta fictícia ou a selecionada no Admin
    if (user.phoneNumber === '6789' || user.name === 'Demo') {
        // Check for per-service credential map
        const storedMap = JSON.parse(localStorage.getItem('demo_credentials_map') || '{}');
        const serviceKey = cleanServiceName.replace(/[^a-z]/g, '');

        let demoEmail: string;
        let demoPassword: string;
        let publishedAt: string;
        let isCustom = false;

        if (storedMap[cleanServiceName]) {
            demoEmail = storedMap[cleanServiceName].email;
            demoPassword = storedMap[cleanServiceName].password;
            publishedAt = storedMap[cleanServiceName].publishedAt || new Date().toISOString();
            isCustom = !demoEmail.includes('@eudorama.com') || !demoPassword.includes('DEMO');
        } else {
            // Generate unique fictitious credential based on service name and current timestamp
            const now = new Date();
            const dateSuffix = now.getTime().toString(36).slice(-4).toUpperCase();
            demoEmail = `demo.${serviceKey}${dateSuffix}@eudorama.com`;
            demoPassword = `PASS-${serviceKey.toUpperCase().slice(0, 4)}${dateSuffix}-DEMO`;
            // Use a stable "old" date so it doesn't trigger update for auto-generated ones
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
            alert: isCustom ? "🔧 Demo (Credencial Real)" : "✨ Demo (Fictício)",
            daysActive: 0
        };
    }

    const serviceCreds = credentialsList
        .filter(c => {
            if (!c.isVisible) return false;
            if (c.email.toLowerCase().includes('demo')) return false;
            const dbService = c.service.toLowerCase();
            return dbService.includes(cleanServiceName) || cleanServiceName.includes(dbService);
        })
        .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

    if (serviceCreds.length === 0) return { credential: null, alert: "Nenhuma conta disponível.", daysActive: 0 };

    // OTIMIZAÇÃO: Usar hash do telefone ao invés de buscar todos os clientes
    // Isso elimina a maior fonte de egress - getAllClients() não é mais chamado aqui
    const phoneHash = user.phoneNumber.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const credIndex = phoneHash % serviceCreds.length;
    const assignedCred = serviceCreds[credIndex];

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

    let alertMsg = null;
    const sName = serviceName.toLowerCase();

    if (sName.includes('viki')) {
        if (daysPassed >= 14) alertMsg = "⚠️ Conta Expirada (14 Dias).";
    }
    else if (sName.includes('kocowa')) {
        if (daysPassed >= 25) alertMsg = "⚠️ Próximo do vencimento.";
    }

    return { alert: alertMsg, daysActive: daysPassed };
};

export const getClientsUsingCredential = async (credential: AppCredential, clients: ClientDBRow[]): Promise<ClientDBRow[]> => {
    const credServiceLower = credential.service.toLowerCase().split('|')[0].trim();
    const allCreds = await fetchCredentials();
    const serviceCreds = allCreds
        .filter(c => c.isVisible && !c.email.includes('demo') && c.service.toLowerCase().includes(credServiceLower))
        .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

    const myIndex = serviceCreds.findIndex(c => c.id === credential.id);
    if (myIndex === -1) return [];

    const activeClientsWithService = clients
        .filter(c => !c.deleted && c.subscriptions.some(s => s.toLowerCase().includes(credServiceLower)))
        .sort((a, b) => a.phone_number.localeCompare(b.phone_number));

    return activeClientsWithService.filter((_, idx) => idx % serviceCreds.length === myIndex);
};
