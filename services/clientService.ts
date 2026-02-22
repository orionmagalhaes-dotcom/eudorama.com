
import { createClient } from '@supabase/supabase-js';
import { User, ClientDBRow, Dorama, AdminUserDBRow, SubscriptionDetail, HistoryLog, HistorySettings } from '../types';

// --- CONFIGURAÇÃO DO SUPABASE ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const INFINITY_PAY_PAYMENT_CHECK_URL = 'https://api.infinitepay.io/invoices/public/checkout/payment_check';
const INFINITY_PAY_API_BASE_PATH = '/api/infinitypay';
const INFINITY_PAY_PAYMENT_CHECK_PATH = `${INFINITY_PAY_API_BASE_PATH}/payment-check`;
const INFINITY_PAY_ORDER_REGISTER_PATH = `${INFINITY_PAY_API_BASE_PATH}/order-register`;
const INFINITY_PAY_ORDER_LOOKUP_PATH = `${INFINITY_PAY_API_BASE_PATH}/order`;
const INFINITY_PAY_DEFAULT_WORKER_BASE = 'https://viki-worker.orionmagalhaes.workers.dev/api/infinitypay';
const INFINITY_PAY_PAYMENT_CHECK_WEBHOOK =
  ((import.meta as any).env?.VITE_INFINITY_PAY_PAYMENT_CHECK_WEBHOOK as string | undefined)?.trim() || '';
const INFINITY_PAY_PAYMENT_CHECK_TOKEN = (
  ((import.meta as any).env?.VITE_INFINITY_PAY_PAYMENT_CHECK_TOKEN as string | undefined)
  || ((import.meta as any).env?.VITE_VIKI_TV_AUTOMATION_TOKEN as string | undefined)
  || ''
).trim();

const getInfinityPayWebhookBase = (): string => {
  if (INFINITY_PAY_PAYMENT_CHECK_WEBHOOK) {
    const webhook = INFINITY_PAY_PAYMENT_CHECK_WEBHOOK.trim();
    if (/^https?:\/\//i.test(webhook)) {
      try {
        const parsed = new URL(webhook);
        const path = String(parsed.pathname || '/').trim();
        if (!path || path === '/') {
          parsed.pathname = INFINITY_PAY_API_BASE_PATH;
          return parsed.toString().replace(/\/$/, '');
        }

        const infinityPathIndex = path.indexOf(INFINITY_PAY_API_BASE_PATH);
        if (infinityPathIndex >= 0) {
          parsed.pathname = INFINITY_PAY_API_BASE_PATH;
          return parsed.toString().replace(/\/$/, '');
        }

        if (path.endsWith('/payment-check')) {
          parsed.pathname = path.slice(0, -'/payment-check'.length) || '/';
          return parsed.toString().replace(/\/$/, '');
        }

        return webhook.replace(/\/$/, '');
      } catch {
        return webhook.replace(/\/$/, '');
      }
    }

    if (webhook.startsWith('/')) {
      const normalizedRelative = webhook.replace(/\/+$/, '');
      if (normalizedRelative.endsWith('/payment-check')) {
        return normalizedRelative.slice(0, -'/payment-check'.length) || '/';
      }
      return normalizedRelative;
    }

    const normalizedRaw = webhook.replace(/\/+$/, '');
    if (normalizedRaw.endsWith('/payment-check')) {
      return normalizedRaw.slice(0, -'/payment-check'.length);
    }
    return normalizedRaw;
  }

  if ((import.meta as any).env?.DEV) return INFINITY_PAY_API_BASE_PATH;
  return INFINITY_PAY_DEFAULT_WORKER_BASE;
};

const buildInfinityPayEndpointFromBase = (base: string, path: string): string => {
  if (!base) return '';
  if (base.startsWith('/')) return path;
  const normalizedPath = path.startsWith(INFINITY_PAY_API_BASE_PATH)
    ? path.slice(INFINITY_PAY_API_BASE_PATH.length)
    : path;
  const pathWithSlash = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  return `${base.replace(/\/+$/, '')}${pathWithSlash}`;
};

const getInfinityPayPaymentCheckEndpoint = (): string => {
  const base = getInfinityPayWebhookBase();
  const endpoint = buildInfinityPayEndpointFromBase(base, INFINITY_PAY_PAYMENT_CHECK_PATH);
  return endpoint || INFINITY_PAY_PAYMENT_CHECK_URL;
};

const getInfinityPayOrderRegisterEndpoint = (): string => {
  const base = getInfinityPayWebhookBase();
  return buildInfinityPayEndpointFromBase(base, INFINITY_PAY_ORDER_REGISTER_PATH);
};

const getInfinityPayOrderLookupEndpoint = (): string => {
  const base = getInfinityPayWebhookBase();
  return buildInfinityPayEndpointFromBase(base, INFINITY_PAY_ORDER_LOOKUP_PATH);
};

const getInfinityPayBackendHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(INFINITY_PAY_PAYMENT_CHECK_TOKEN ? { Authorization: `Bearer ${INFINITY_PAY_PAYMENT_CHECK_TOKEN}` } : {})
});

// --- GERENCIAMENTO DE DADOS LOCAIS ---
const getLocalUserData = (phoneNumber: string) => {
  try {
    const data = localStorage.getItem(`dorama_user_${phoneNumber}`);
    return data ? JSON.parse(data) : { watching: [], favorites: [], completed: [] };
  } catch (e) {
    return { watching: [], favorites: [], completed: [] };
  }
};

export const addLocalDorama = (phoneNumber: string, type: 'watching' | 'favorites' | 'completed', dorama: Dorama) => {
  const currentData = getLocalUserData(phoneNumber);
  if (!currentData[type]) currentData[type] = [];
  currentData[type].push(dorama);
  localStorage.setItem(`dorama_user_${phoneNumber}`, JSON.stringify(currentData));
  return currentData;
};

// --- FUNÇÕES DE CLIENTE ---

export const getAllClients = async (retries = 2): Promise<ClientDBRow[]> => {
  try {
    // OTIMIZAÇÃO EGRESS: Included game_progress to fetch internal observation
    const { data, error } = await supabase.from('clients')
      .select('id,phone_number,client_name,client_password,subscriptions,duration_months,purchase_date,is_debtor,override_expiration,deleted,created_at,theme_color,last_active_at,game_progress');
    if (error) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return getAllClients(retries - 1);
      }
      return [];
    }
    // Map game_progress._observation to root observation
    return (data || []).map((c: any) => ({
      ...c,
      observation: c.game_progress?._observation || ''
    })) as unknown as ClientDBRow[];
  } catch (e: any) {
    if (retries > 0 && e.message?.includes('fetch')) {
      await new Promise(r => setTimeout(r, 1000));
      return getAllClients(retries - 1);
    }
    return [];
  }
};

export const checkUserStatus = async (lastFourDigits: string): Promise<{
  exists: boolean;
  matches: { phoneNumber: string; hasPassword: boolean; name?: string; photo?: string }[]
}> => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('phone_number, client_password, client_name, profile_image, deleted')
      .like('phone_number', `%${lastFourDigits}`);

    if (error || !data || data.length === 0) return { exists: false, matches: [] };
    const activeClients = (data as any[]).filter(c => !c.deleted);
    if (activeClients.length === 0) return { exists: false, matches: [] };

    const matchesMap = new Map<string, { phoneNumber: string; hasPassword: boolean; name?: string; photo?: string }>();
    activeClients.forEach(client => {
      if (!matchesMap.has(client.phone_number)) {
        matchesMap.set(client.phone_number, {
          phoneNumber: client.phone_number,
          hasPassword: !!(client.client_password && client.client_password.trim() !== ''),
          name: client.client_name,
          photo: client.profile_image
        });
      }
    });
    return { exists: true, matches: Array.from(matchesMap.values()) };
  } catch (e) { return { exists: false, matches: [] }; }
};

export const loginWithPassword = async (phoneNumber: string, password: string): Promise<{ user: User | null, error: string | null }> => {
  try {
    const { data, error } = await supabase.from('clients').select('*').eq('phone_number', phoneNumber);
    if (error || !data || data.length === 0) return { user: null, error: 'Usuário não encontrado.' };
    const clientData = data[0] as unknown as ClientDBRow;
    if (clientData.deleted) return { user: null, error: 'Acesso revogado.' };
    if (String(clientData.client_password).trim() !== String(password).trim()) return { user: null, error: 'Senha incorreta.' };
    return processUserLogin(data as unknown as ClientDBRow[]);
  } catch (e) { return { user: null, error: 'Erro de conexão.' }; }
};

export const processUserLogin = (userRows: ClientDBRow[]): { user: User | null, error: string | null } => {
  if (userRows.length === 0) return { user: null, error: 'Dados vazios.' };
  const primaryPhone = userRows[0].phone_number;
  const allServices = new Set<string>();
  const subscriptionMap: Record<string, SubscriptionDetail> = {};
  let bestRow = userRows[0];
  let maxExpiryTime = 0;
  let isDebtorAny = false;
  let overrideAny = false;

  userRows.forEach(row => {
    if (row.deleted) return;
    let subs: string[] = [];
    if (Array.isArray(row.subscriptions)) subs = row.subscriptions;
    else if (typeof row.subscriptions === 'string') {
      const s = (row.subscriptions as string).replace(/^\{|\}$/g, '');
      if (s.includes(';')) subs = s.split(';').map(i => i.trim().replace(/^"|"$/g, ''));
      else if (s.includes('+')) subs = s.split('+').map(i => i.trim().replace(/^"|"$/g, ''));
      else subs = [s.replace(/^"|"$/g, '')];
    }

    subs.forEach(s => {
      if (s) {
        const parts = s.split('|');
        const cleanService = parts[0].trim();
        if (!cleanService) return;

        const specificDate = parts[1] ? parts[1].trim() : null;
        const individualPaid = (parts[2] || '0') === '1';
        const durationStr = parts[3] ? parts[3].trim() : '';
        const individualDuration = durationStr !== '' ? parseInt(durationStr) : (row.duration_months || 1);
        const toleranceDate = parts[4] ? parts[4].trim() : undefined;

        allServices.add(cleanService);
        subscriptionMap[cleanService] = {
          purchaseDate: specificDate || row.purchase_date,
          durationMonths: individualDuration,
          isDebtor: !individualPaid,
          toleranceUntil: toleranceDate || undefined
        };
        if (!individualPaid) isDebtorAny = true;
      }
    });
    if (row.is_debtor) isDebtorAny = true;
    if (row.override_expiration) overrideAny = true;

    const purchase = new Date(row.purchase_date);
    const expiry = new Date(purchase);
    expiry.setDate(purchase.getDate() + ((row.duration_months || 1) * 30));
    if (expiry.getTime() > maxExpiryTime) {
      maxExpiryTime = expiry.getTime();
      bestRow = row;
    }
  });

  const combinedServices = Array.from(allServices);
  const localData = getLocalUserData(primaryPhone);
  return {
    user: {
      id: bestRow.id,
      name: bestRow.client_name || "Dorameira",
      phoneNumber: bestRow.phone_number,
      purchaseDate: bestRow.purchase_date,
      durationMonths: bestRow.duration_months,
      subscriptionDetails: subscriptionMap,
      services: combinedServices,
      isDebtor: isDebtorAny,
      overrideExpiration: overrideAny,
      watching: localData.watching || [],
      favorites: localData.favorites || [],
      completed: localData.completed || [],
      gameProgress: bestRow.game_progress || {},
      themeColor: bestRow.theme_color,
      backgroundImage: bestRow.background_image,
      profileImage: bestRow.profile_image
    },
    error: null
  };
};

export const saveClientToDB = async (client: Partial<ClientDBRow>): Promise<{ success: boolean; msg: string }> => {
  try {
    const payload = { ...client };

    // FETCH OLD DATA IF UPDATING
    let oldData: ClientDBRow | null = null;
    if (payload.id) {
      const { data } = await supabase.from('clients').select('*').eq('id', payload.id).single();
      if (data) oldData = data as ClientDBRow;
    } else if (payload.phone_number) {
      const { data } = await supabase.from('clients').select('*').eq('phone_number', payload.phone_number).single();
      if (data) oldData = data as ClientDBRow;
    }

    // Handle Observation -> game_progress mapping
    // We check if 'observation' key exists in payload (it might be empty string)
    if (payload.observation !== undefined) {
      const currentProgress = payload.game_progress || oldData?.game_progress || (oldData as any)?.gameProgress || {};
      // Store observation in _observation key to avoid clutter
      const newProgress = { ...currentProgress, _observation: payload.observation };
      payload.game_progress = newProgress;
      // IMPORTANT: Delete the root 'observation' key because it doesn't exist in DB schema
      delete payload.observation;
    }

    if (!payload.id || payload.id === '') delete payload.id;
    if (!Array.isArray(payload.subscriptions)) payload.subscriptions = [];
    const { error } = await supabase.from('clients').upsert(payload);

    if (error) throw error;

    // --- LOGGING LOGIC ---
    const clientName = payload.client_name || oldData?.client_name || payload.phone_number || "Cliente";

    if (!oldData) {
      // NEW CLIENT
      await logHistory('Novo Cliente', `Cliente ${clientName} (${payload.phone_number}) foi adicionado.`);
    } else {
      // UPDATE OR DELETE
      if (payload.deleted && !oldData.deleted) {
        await logHistory('Cliente Removido', `Cliente ${clientName} enviado para lixeira.`);
      } else if (payload.deleted === false && oldData.deleted) {
        // CLIENT RESTORED - Log individual subscriptions as "Restored" for financial tracking
        const subs = (oldData.subscriptions || []) as string[];

        // Helper to parse subscription string: Service|Date|Paid|Duration
        const parseSub = (s: string) => {
          if (!s) return null;
          const parts = s.split('|');
          return {
            service: parts[0].trim(),
            date: parts[1]?.trim(),
            paid: (parts[2] || '0') === '1',
            duration: parts[3] ? parseInt(parts[3].trim()) : 1
          };
        };

        let restoredCount = 0;
        subs.forEach(s => {
          const p = parseSub(s);
          if (p) {
            // Log specially so it counts as "Revenue" or "New Subscription" in reports if needed
            logHistory('Assinatura Restaurada', `Cliente ${clientName} restaurado: ${p.service} (${p.duration * 30} dias) reativado.`).catch(console.error);
            restoredCount++;
          }
        });

        if (restoredCount === 0) {
          await logHistory('Cliente Restaurado', `Cliente ${clientName} restaurado da lixeira (sem assinaturas ativas).`);
        }
      } else {
        const oldSubs = (oldData.subscriptions || []) as string[];
        const newSubs = (payload.subscriptions || []) as string[];

        // Helper to parse subscription string: Service|Date|Paid|Duration
        const parseSub = (s: string) => {
          if (!s) return null;
          const parts = s.split('|');
          return {
            service: parts[0].trim(),
            date: parts[1]?.trim(),
            paid: (parts[2] || '0') === '1',
            duration: parts[3] ? parseInt(parts[3].trim()) || 1 : 1
          };
        };

        const oldMap = new Map<string, ReturnType<typeof parseSub>>();
        oldSubs.forEach(s => { const p = parseSub(s); if (p) oldMap.set(p.service, p); });

        const newMap = new Map<string, ReturnType<typeof parseSub>>();
        newSubs.forEach(s => { const p = parseSub(s); if (p) newMap.set(p.service, p); });

        let changesLogged = false;

        // Check for Additions and Updates
        for (const [service, newDetails] of newMap.entries()) {
          if (!newDetails) continue;
          const oldDetails = oldMap.get(service);

          if (!oldDetails) {
            // Added
            await logHistory('Assinatura Adicionada', `Cliente ${clientName} adquiriu ${service} (${newDetails.duration * 30} dias).`);
            changesLogged = true;
          } else {
            // Existing - Check for changes
            if (newDetails.duration !== oldDetails.duration || newDetails.date !== oldDetails.date) {
              // Renewal / Change Duration
              await logHistory('Assinatura Renovada', `Cliente ${clientName} renovou ${service} por ${newDetails.duration * 30} dias.`);
              changesLogged = true;
            } else if (newDetails.paid !== oldDetails.paid) {
              // Payment Status Change
              const status = newDetails.paid ? 'PAGO' : 'PENDENTE';
              await logHistory('Pagamento Atualizado', `Status de pagamento de ${service} para ${clientName} alterado para ${status}.`);
              changesLogged = true;
            }
          }
        }

        // Check for Removals
        for (const [service, oldDetails] of oldMap.entries()) {
          if (!newMap.has(service)) {
            const durationDays = (oldDetails?.duration || 1) * 30;
            await logHistory('Assinatura Removida', `Cliente ${clientName} cancelou/removeu a assinatura de ${service} (${durationDays} dias).`);
            changesLogged = true;
          }
        }

        // Fallback for other changes (Name, Phone, etc)
        if (!changesLogged) {
          const ignoreKeys = ['subscriptions', 'id', 'created_at', 'updated_at', 'last_active_at'];
          const hasOtherChanges = Object.keys(payload).some(k => {
            if (ignoreKeys.includes(k)) return false;
            // simple inequality check, strict for primities
            return (payload as any)[k] != (oldData as any)[k];
          });

          if (hasOtherChanges) {
            await logHistory('Dados Atualizados', `Dados cadastrais de ${clientName} foram modificados.`);
          }
        }
      }
    }

    return { success: true, msg: "Salvo com sucesso!" };
  } catch (e: any) { return { success: false, msg: `Erro: ${e.message}` }; }
};

export const updateDoramaInDB = async (dorama: Dorama): Promise<boolean> => {
  try {
    const { error } = await supabase.from('doramas').update({
      episodes_watched: dorama.episodesWatched,
      total_episodes: dorama.totalEpisodes,
      season: dorama.season,
      rating: dorama.rating,
      status: dorama.status
    }).eq('id', dorama.id);
    return !error;
  } catch (e) { return false; }
};

export const resetAllClientPasswords = async (): Promise<{ success: boolean, msg: string }> => {
  const { error } = await supabase.from('clients').update({ client_password: '' }).neq('id', '00000000-0000-0000-0000-000000000000');
  return error ? { success: false, msg: error.message } : { success: true, msg: "Senhas resetadas." };
};

export const hardDeleteAllClients = async (): Promise<{ success: boolean, msg: string }> => {
  try {
    await supabase.from('doramas').delete().neq('id', '0');
    await supabase.from('credentials').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    // Note: Clients delete commented out or specific logic? The existing code had delete clients logic.
    // The previous view showed: const { error } = await supabase.from('clients').delete().neq('id', ...);
    // Be careful not to remove functionality. I will preserve the original logic and ADD logging.

    // Original Logic preserved:
    const { error } = await supabase.from('clients').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) return { success: false, msg: `Erro: ${error.message}` };

    await logHistory('Limpeza Geral', 'Todas as credenciais, doramas e CLIENTES foram apagados (Hard Reset).');
    return { success: true, msg: "Banco limpo." };
  } catch (e: any) { return { success: false, msg: `Exceção: ${e.message}` }; }
};

export const refreshUserProfile = async (phoneNumber: string): Promise<{ user: User | null; error: string | null }> => {
  try {
    const { data, error } = await supabase.from('clients').select('*').eq('phone_number', phoneNumber);
    if (error || !data || data.length === 0) return { user: null, error: 'Usuário não encontrado.' };
    return processUserLogin(data as unknown as ClientDBRow[]);
  } catch (e) { return { user: null, error: 'Erro de conexão.' }; }
};

const normalizeClientSubscriptionsForUpdate = (rawSubscriptions: any, defaultDuration: number): string[] => {
  let list: string[] = [];

  if (Array.isArray(rawSubscriptions)) {
    list = rawSubscriptions.map((item: any) => String(item));
  } else if (typeof rawSubscriptions === 'string') {
    const cleaned = rawSubscriptions.replace(/^\{|\}$/g, '').trim();
    if (!cleaned) return [];
    if (cleaned.includes(';')) list = cleaned.split(';');
    else if (cleaned.includes(',')) list = cleaned.split(',');
    else if (cleaned.includes('+')) list = cleaned.split('+');
    else list = [cleaned];
  }

  return list
    .map((value) => {
      const str = String(value).trim().replace(/^"|"$/g, '');
      if (!str) return '';
      const parts = str.split('|');
      const serviceName = (parts[0] || '').trim();
      if (!serviceName) return '';

      const startDateRaw = parts[1] || new Date().toISOString();
      const startDate = Number.isNaN(new Date(startDateRaw).getTime()) ? new Date().toISOString() : startDateRaw;
      const paidFlag = (parts[2] || '0') === '1' ? '1' : '0';
      const durationMonths = Math.max(1, parseInt(parts[3] || String(defaultDuration || 1), 10) || 1);
      const toleranceDate = parts[4] || '';
      const originalPaymentDate = parts[5] || startDate;

      return `${serviceName}|${startDate}|${paidFlag}|${durationMonths}|${toleranceDate}|${originalPaymentDate}`;
    })
    .filter(Boolean);
};

const calculateNextSubscriptionStart = (dateStr: string, months: number): Date => {
  const base = new Date(dateStr);
  const next = Number.isNaN(base.getTime()) ? new Date() : new Date(base);
  next.setDate(next.getDate() + Math.max(1, months) * 30);
  return next;
};

export interface InfinityPayOrderContext {
  orderNsu: string;
  phoneNumber: string;
  services: string[];
  status?: string;
  paid?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface InfinityPayOrderContextRegisterPayload {
  orderNsu: string;
  phoneNumber: string;
  services: string[];
  handle?: string;
}

export interface InfinityPayOrderContextResult {
  success: boolean;
  message?: string;
  order?: InfinityPayOrderContext;
  raw?: any;
}

const normalizeInfinityServices = (services: unknown): string[] => {
  if (!Array.isArray(services)) return [];
  return services
    .map((service) => String(service || '').trim())
    .filter(Boolean);
};

export const registerInfinityPayOrderContext = async (
  payload: InfinityPayOrderContextRegisterPayload
): Promise<InfinityPayOrderContextResult> => {
  const endpoint = getInfinityPayOrderRegisterEndpoint();
  if (!endpoint) {
    return {
      success: false,
      message: 'Endpoint de backend para registro de pedido InfinityPay nao configurado.'
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: getInfinityPayBackendHeaders(),
      body: JSON.stringify({
        order_nsu: payload.orderNsu,
        phone_number: payload.phoneNumber,
        services: normalizeInfinityServices(payload.services),
        handle: payload.handle
      })
    });

    const rawText = await response.text().catch(() => '');
    let body: any = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = rawText ? { message: rawText.slice(0, 220) } : null;
    }

    if (!response.ok || body?.success === false) {
      const message = String(body?.message || body?.error || '').trim();
      return {
        success: false,
        message: message || `Falha ao registrar pedido InfinityPay (HTTP ${response.status}).`,
        raw: body
      };
    }

    return {
      success: true,
      message: String(body?.message || '').trim() || 'Pedido InfinityPay registrado no backend.',
      raw: body
    };
  } catch (e: any) {
    return {
      success: false,
      message: String(e?.message || 'Erro ao registrar pedido InfinityPay no backend.')
    };
  }
};

export const getInfinityPayOrderContext = async (orderNsu: string): Promise<InfinityPayOrderContextResult> => {
  const endpoint = getInfinityPayOrderLookupEndpoint();
  if (!endpoint) {
    return {
      success: false,
      message: 'Endpoint de backend para consulta de pedido InfinityPay nao configurado.'
    };
  }

  try {
    const separator = endpoint.includes('?') ? '&' : '?';
    const response = await fetch(`${endpoint}${separator}order_nsu=${encodeURIComponent(orderNsu)}`, {
      method: 'GET',
      headers: getInfinityPayBackendHeaders()
    });

    const rawText = await response.text().catch(() => '');
    let body: any = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = rawText ? { message: rawText.slice(0, 220) } : null;
    }

    if (!response.ok || body?.success === false) {
      const message = String(body?.message || body?.error || '').trim();
      return {
        success: false,
        message: message || `Falha ao consultar pedido InfinityPay (HTTP ${response.status}).`,
        raw: body
      };
    }

    const orderSource = (body?.order || body) as any;
    const parsedOrder: InfinityPayOrderContext = {
      orderNsu: String(orderSource?.order_nsu || orderSource?.orderNsu || orderNsu || '').trim(),
      phoneNumber: String(orderSource?.phone_number || orderSource?.phoneNumber || '').trim(),
      services: normalizeInfinityServices(orderSource?.services),
      status: typeof orderSource?.status === 'string' ? orderSource.status : undefined,
      paid: typeof orderSource?.paid === 'boolean'
        ? orderSource.paid
        : (typeof orderSource?.paid === 'number' ? orderSource.paid === 1 : undefined),
      createdAt: typeof orderSource?.created_at === 'string' ? orderSource.created_at : orderSource?.createdAt,
      updatedAt: typeof orderSource?.updated_at === 'string' ? orderSource.updated_at : orderSource?.updatedAt
    };

    if (!parsedOrder.orderNsu) parsedOrder.orderNsu = String(orderNsu || '').trim();

    return {
      success: true,
      order: parsedOrder,
      raw: body
    };
  } catch (e: any) {
    return {
      success: false,
      message: String(e?.message || 'Erro ao consultar pedido InfinityPay no backend.')
    };
  }
};

export interface InfinityPayPaymentCheckRequest {
  handle: string;
  orderNsu: string;
  transactionNsu: string;
  slug: string;
}

export interface InfinityPayPaymentCheckResult {
  success: boolean;
  paid: boolean;
  status?: string;
  message?: string;
  raw?: any;
}

export const checkInfinityPayPaymentStatus = async (
  payload: InfinityPayPaymentCheckRequest
): Promise<InfinityPayPaymentCheckResult> => {
  try {
    const response = await fetch(getInfinityPayPaymentCheckEndpoint(), {
      method: 'POST',
      headers: getInfinityPayBackendHeaders(),
      body: JSON.stringify({
        handle: payload.handle,
        order_nsu: payload.orderNsu,
        transaction_nsu: payload.transactionNsu,
        slug: payload.slug
      })
    });

    const rawText = await response.text().catch(() => '');
    let body: any = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = rawText ? { message: rawText.slice(0, 220) } : null;
    }

    if (!response.ok) {
      const apiMessage = String(body?.error || body?.message || '').trim();
      return {
        success: false,
        paid: false,
        status: String(body?.status || ''),
        message: apiMessage || `Falha ao validar pagamento (HTTP ${response.status}).`,
        raw: body
      };
    }

    const status = String(body?.status || '').toUpperCase();
    const apiSuccess = typeof body?.success === 'boolean' ? body.success : true;
    const paidFromFlag = typeof body?.paid === 'boolean' ? body.paid : null;
    const paidFromStatus = ['PAID', 'APPROVED', 'CONFIRMED', 'CAPTURED'].includes(status);
    const paid = paidFromFlag ?? paidFromStatus;

    if (!apiSuccess) {
      const apiMessage = String(body?.error || body?.message || '').trim();
      return {
        success: false,
        paid: false,
        status,
        message: apiMessage || 'Falha ao validar pagamento no InfinityPay.',
        raw: body
      };
    }

    return {
      success: true,
      paid,
      status,
      raw: body
    };
  } catch (e: any) {
    const rawMessage = String(e?.message || '').trim();
    const isNetworkFailure = /failed to fetch|networkerror|load failed|fetch failed/i.test(rawMessage);
    return {
      success: false,
      paid: false,
      message: isNetworkFailure
        ? 'Falha de rede ao validar pagamento no InfinityPay.'
        : (rawMessage || 'Erro ao validar pagamento no InfinityPay.')
    };
  }
};

export const renewClientSubscriptionsAfterInfinityPayment = async (
  phoneNumber: string,
  targetServices: string[]
): Promise<{ success: boolean; msg: string; renewedServices: string[] }> => {
  try {
    const normalizedTargets = Array.from(
      new Set(
        (targetServices || [])
          .map((service) => String(service || '').trim())
          .filter(Boolean)
      )
    );

    if (normalizedTargets.length === 0) {
      return { success: false, msg: 'Nenhuma assinatura informada para renovacao.', renewedServices: [] };
    }

    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('phone_number', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return { success: false, msg: 'Cliente nao encontrado para renovacao automatica.', renewedServices: [] };
    }

    const client = data[0] as ClientDBRow;
    if (client.deleted) {
      return { success: false, msg: 'Cliente removido e sem permissao para renovacao.', renewedServices: [] };
    }

    const normalizedSubs = normalizeClientSubscriptionsForUpdate(client.subscriptions, client.duration_months || 1);
    const updatedSubs = [...normalizedSubs];
    const renewedServices: string[] = [];

    normalizedTargets.forEach((targetService) => {
      const subIndex = updatedSubs.findIndex((sub) => {
        const serviceName = sub.split('|')[0]?.trim()?.toLowerCase();
        return serviceName === targetService.toLowerCase();
      });

      if (subIndex >= 0) {
        const parts = updatedSubs[subIndex].split('|');
        const months = Math.max(1, parseInt(parts[3] || String(client.duration_months || 1), 10) || 1);
        const nextStartIso = calculateNextSubscriptionStart(parts[1], months).toISOString();
        updatedSubs[subIndex] = `${parts[0]}|${nextStartIso}|1|${months}||${nextStartIso}`;
        renewedServices.push(parts[0]);
        return;
      }

      const fallbackMonths = Math.max(1, client.duration_months || 1);
      const nowIso = new Date().toISOString();
      updatedSubs.push(`${targetService}|${nowIso}|1|${fallbackMonths}||${nowIso}`);
      renewedServices.push(targetService);
    });

    const hasDebtorServices = updatedSubs.some((sub) => (sub.split('|')[2] || '0') !== '1');
    const saveResult = await saveClientToDB({
      ...client,
      subscriptions: updatedSubs,
      is_debtor: hasDebtorServices
    });

    if (!saveResult.success) {
      return { success: false, msg: saveResult.msg || 'Falha ao salvar renovacao automatica.', renewedServices: [] };
    }

    return {
      success: true,
      msg: 'Renovacao automatica aplicada com sucesso.',
      renewedServices
    };
  } catch (e: any) {
    return {
      success: false,
      msg: e?.message || 'Erro ao aplicar renovacao automatica.',
      renewedServices: []
    };
  }
};
export const updateClientName = async (phoneNumber: string, newName: string): Promise<boolean> => {
  const { error } = await supabase.from('clients').update({ client_name: newName }).eq('phone_number', phoneNumber);
  return !error;
};

export const updateClientPreferences = async (phoneNumber: string, preferences: any): Promise<boolean> => {
  const { error } = await supabase.from('clients').update(preferences).eq('phone_number', phoneNumber);
  return !error;
};

export const registerClientPassword = async (phoneNumber: string, password: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase.from('clients').update({ client_password: password }).eq('phone_number', phoneNumber).select();
    return !!data && data.length > 0;
  } catch (e) { return false; }
};

export const saveGameProgress = async (phoneNumber: string, gameId: string, progressData: any) => {
  const { data } = await supabase.from('clients').select('game_progress').eq('phone_number', phoneNumber).single();
  const current = data?.game_progress || {};
  const updated = { ...current, [gameId]: progressData };
  await supabase.from('clients').update({ game_progress: updated }).eq('phone_number', phoneNumber);
};

export const updateLastActive = async (phoneNumber: string): Promise<void> => {
  await supabase.from('clients').update({ last_active_at: new Date().toISOString() }).eq('phone_number', phoneNumber);
};

export const saveCredentialAck = async (phoneNumber: string, serviceName: string, publishedAt: string) => {
  const { data } = await supabase.from('clients').select('game_progress').eq('phone_number', phoneNumber).single();
  const current = data?.game_progress || {};
  const acks = current._credential_acks || {};

  // Update ack for this service
  acks[serviceName] = publishedAt;

  const updated = { ...current, _credential_acks: acks };
  await supabase.from('clients').update({ game_progress: updated }).eq('phone_number', phoneNumber);
};

export const saveCredentialAcks = async (phoneNumber: string, newAcks: Record<string, string>) => {
  const { data } = await supabase.from('clients').select('game_progress').eq('phone_number', phoneNumber).single();
  const current = data?.game_progress || {};
  const acks = current._credential_acks || {};

  // Merge new acks
  Object.assign(acks, newAcks);

  const updated = { ...current, _credential_acks: acks };
  await supabase.from('clients').update({ game_progress: updated }).eq('phone_number', phoneNumber);
};

export interface VikiTvAutomationRequest {
  phoneNumber: string;
  clientName: string;
  serviceName: string;
  tvModel: 'samsung' | 'lg' | 'android';
  tvUrl: string;
  tvCode: string;
  credentialEmail: string;
  credentialPassword: string;
}

export type VikiTvAutomationExecutionStatus = 'queued' | 'running' | 'success' | 'failed' | 'unknown';
export type VikiTvAutomationStepStatus = 'pending' | 'running' | 'success' | 'failed';

export interface VikiTvAutomationStep {
  key: string;
  label: string;
  status: VikiTvAutomationStepStatus;
  details?: string;
  updatedAt?: string;
}

export interface VikiTvAutomationResponse {
  success: boolean;
  requestId: string;
  provider: 'webhook' | 'history_fallback';
  message: string;
  executionStatus: VikiTvAutomationExecutionStatus;
  steps: VikiTvAutomationStep[];
}

const buildVikiRequestId = () => `viki-tv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeStepStatus = (value: any): VikiTvAutomationStepStatus => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'success' || raw === 'ok' || raw === 'completed' || raw === 'done') return 'success';
  if (raw === 'failed' || raw === 'error') return 'failed';
  if (raw === 'running' || raw === 'in_progress' || raw === 'processing') return 'running';
  return 'pending';
};

const normalizeExecutionStatus = (value: any): VikiTvAutomationExecutionStatus => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'success' || raw === 'completed' || raw === 'done') return 'success';
  if (raw === 'failed' || raw === 'error') return 'failed';
  if (raw === 'running' || raw === 'in_progress' || raw === 'processing') return 'running';
  if (raw === 'queued' || raw === 'pending') return 'queued';
  return 'unknown';
};

const buildDefaultQueuedSteps = (submittedAt: string): VikiTvAutomationStep[] => ([
  { key: 'request', label: 'Solicitacao recebida', status: 'success', updatedAt: submittedAt },
  { key: 'dispatch', label: 'Automacao em background iniciada', status: 'running', updatedAt: submittedAt },
  { key: 'login', label: 'Login na Viki', status: 'pending' },
  { key: 'code', label: 'Insercao do codigo da TV', status: 'pending' },
  { key: 'logout', label: 'Logout e finalizacao', status: 'pending' }
]);

const parseWebhookResponseBody = (body: any, fallbackRequestId: string): {
  requestId: string;
  message: string;
  executionStatus: VikiTvAutomationExecutionStatus;
  steps: VikiTvAutomationStep[];
} => {
  const requestId = typeof body?.requestId === 'string' && body.requestId.trim() ? body.requestId : fallbackRequestId;
  const executionStatus = normalizeExecutionStatus(body?.status || body?.executionStatus);
  const message = typeof body?.message === 'string' && body.message.trim()
    ? body.message
    : 'Solicitacao enviada. A automacao esta em andamento.';

  const stepsRaw = Array.isArray(body?.steps) ? body.steps : [];
  const steps: VikiTvAutomationStep[] = stepsRaw
    .filter((step: any) => step)
    .map((step: any, index: number) => ({
      key: typeof step.key === 'string' && step.key.trim() ? step.key : `step_${index + 1}`,
      label: typeof step.label === 'string' && step.label.trim() ? step.label : `Etapa ${index + 1}`,
      status: normalizeStepStatus(step.status),
      details: typeof step.details === 'string' ? step.details : undefined,
      updatedAt: typeof step.updatedAt === 'string' ? step.updatedAt : undefined
    }));

  return {
    requestId,
    message,
    executionStatus,
    steps: steps.length > 0 ? steps : buildDefaultQueuedSteps(new Date().toISOString())
  };
};

export const submitVikiTvAutomationRequest = async (payload: VikiTvAutomationRequest): Promise<VikiTvAutomationResponse> => {
  const requestId = buildVikiRequestId();
  const submittedAt = new Date().toISOString();

  const webhookUrl = ((import.meta as any).env?.VITE_VIKI_TV_AUTOMATION_WEBHOOK as string | undefined)
    || ((import.meta as any).env?.DEV ? '/api/viki-tv-automation' : undefined);
  const webhookToken = (import.meta as any).env?.VITE_VIKI_TV_AUTOMATION_TOKEN as string | undefined;

  if (webhookUrl && webhookUrl.trim()) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {})
        },
        body: JSON.stringify({
          requestId,
          submittedAt,
          source: 'eudorama-client-dashboard',
          payload
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Webhook ${response.status}: ${errorBody.slice(0, 200)}`);
      }

      let parsedBody: any = null;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }

      const parsed = parseWebhookResponseBody(parsedBody, requestId);
      const success = parsed.executionStatus !== 'failed';

      return {
        success,
        requestId: parsed.requestId,
        provider: 'webhook',
        message: parsed.message,
        executionStatus: parsed.executionStatus === 'unknown' ? 'queued' : parsed.executionStatus,
        steps: parsed.steps
      };
    } catch (e: any) {
      console.error('Falha ao enviar webhook de automacao Viki TV:', e?.message || e);
    }
  }

  // Fallback: registra a solicitacao para processamento manual/externo sem quebrar o fluxo do cliente
  await supabase.from('history_logs').insert({
    action: 'Solicitacao Conexao TV Viki',
    details: JSON.stringify({
      requestId,
      submittedAt,
      mode: 'history_fallback',
      payload: {
        ...payload,
        credentialPassword: '***'
      }
    })
  });

  return {
    success: false,
    requestId,
    provider: 'history_fallback',
    message: 'Automacao nao configurada. A solicitacao foi registrada, mas nao foi executada automaticamente.',
    executionStatus: 'failed',
    steps: [
      { key: 'request', label: 'Solicitacao recebida', status: 'success', updatedAt: submittedAt },
      { key: 'dispatch', label: 'Tentativa de iniciar automacao', status: 'failed', updatedAt: submittedAt, details: 'Webhook de automacao nao configurado' }
    ]
  };
};

export const getVikiTvAutomationStatus = async (requestId: string): Promise<VikiTvAutomationResponse | null> => {
  const statusWebhook = ((import.meta as any).env?.VITE_VIKI_TV_AUTOMATION_STATUS_WEBHOOK as string | undefined)
    || ((import.meta as any).env?.DEV ? '/api/viki-tv-automation/status' : undefined);
  const webhookToken = (import.meta as any).env?.VITE_VIKI_TV_AUTOMATION_TOKEN as string | undefined;
  if (!statusWebhook || !statusWebhook.trim()) return null;

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL(statusWebhook, baseOrigin);
    url.searchParams.set('requestId', requestId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {})
      }
    });

    if (!response.ok) return null;

    let body: any = null;
    try {
      body = await response.json();
    } catch {
      return null;
    }

    const parsed = parseWebhookResponseBody(body, requestId);
    return {
      success: parsed.executionStatus === 'success',
      requestId: parsed.requestId,
      provider: 'webhook',
      message: parsed.message,
      executionStatus: parsed.executionStatus,
      steps: parsed.steps
    };
  } catch (e) {
    console.error('Falha ao consultar status da automacao Viki TV:', e);
    return null;
  }
};

export const addDoramaToDB = async (phoneNumber: string, listType: 'watching' | 'favorites' | 'completed', dorama: Dorama): Promise<Dorama | null> => {
  try {
    let status = 'Watching';
    if (listType === 'favorites') status = 'Plan to Watch';
    if (listType === 'completed') status = 'Completed';
    const payload = {
      phone_number: phoneNumber,
      title: dorama.title,
      genre: dorama.genre || 'Drama',
      thumbnail: dorama.thumbnail || '',
      status: status,
      episodes_watched: dorama.episodesWatched || (status === 'Completed' ? dorama.totalEpisodes : 1),
      total_episodes: dorama.totalEpisodes || 16,
      season: dorama.season || 1,
      rating: dorama.rating || 0
    };
    const { data, error } = await supabase.from('doramas').insert(payload).select().single();
    if (error) return null;
    return { ...dorama, id: data.id };
  } catch (e) { return null; }
};

export const removeDoramaFromDB = async (doramaId: string): Promise<boolean> => {
  const { error } = await supabase.from('doramas').delete().eq('id', doramaId);
  return !error;
};

export const getUserDoramasFromDB = async (phoneNumber: string): Promise<{ watching: Dorama[], favorites: Dorama[], completed: Dorama[] }> => {
  try {
    const { data, error } = await supabase.from('doramas').select('*').eq('phone_number', phoneNumber);
    if (error || !data) return { watching: [], favorites: [], completed: [] };
    const map = (d: any): Dorama => ({
      id: d.id,
      title: d.title,
      genre: d.genre || 'Drama',
      thumbnail: d.thumbnail || '',
      status: d.status,
      episodesWatched: d.episodes_watched || 0,
      totalEpisodes: d.total_episodes || 16,
      season: d.season || 1,
      rating: d.rating || 0
    });
    return {
      watching: data.filter((d: any) => d.status === 'Watching').map(map),
      favorites: data.filter((d: any) => d.status === 'Plan to Watch').map(map),
      completed: data.filter((d: any) => d.status === 'Completed').map(map)
    };
  } catch (e) { return { watching: [], favorites: [], completed: [] }; }
};

export const verifyAdminLogin = async (login: string, pass: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase.from('admin_users').select('*').eq('username', login.trim()).limit(1);
    if (data && data.length > 0) return (data[0] as AdminUserDBRow).password === pass.trim();
    return false;
  } catch (e) { return false; }
};

export const updateAdminPassword = async (newPassword: string) => {
  const { error } = await supabase.from('admin_users').upsert({ username: 'admin', password: newPassword }, { onConflict: 'username' });
  return !error;
};

// --- HISTORY & LOGGING SERVICE ---

export const logHistory = async (action: string, details: any) => {
  try {
    const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
    await supabase.from('history_logs').insert({ action, details: detailsStr });
  } catch (e) { console.error("Falha ao registrar log:", e); }
};

export const getHistoryLogs = async (): Promise<HistoryLog[]> => {
  try {
    const { data, error } = await supabase.from('history_logs').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return data as unknown as HistoryLog[];
  } catch (e) { return []; }
};

export const clearHistoryLogs = async (): Promise<boolean> => {
  try {
    const { error } = await supabase.from('history_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    return !error;
  } catch (e) { return false; }
};

export const getHistorySettings = async (): Promise<Record<string, string>> => {
  try {
    const { data } = await supabase.from('history_settings').select('*');
    if (!data) return {};
    const settings: Record<string, string> = {};
    data.forEach((row: any) => settings[row.key] = row.value);
    return settings;
  } catch (e) { return {}; }
};

export const updateHistorySetting = async (key: string, value: string): Promise<boolean> => {
  try {
    const { error } = await supabase.from('history_settings').upsert({ key, value });
    return !error;
  } catch (e) { return false; }
};

export const enforceHistoryRetention = async (): Promise<void> => {
  try {
    const settings = await getHistorySettings();
    const daysStr = settings['retention_days'] || '7';
    const days = parseInt(daysStr) || 7;

    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - days);

    await supabase.from('history_logs').delete().lt('created_at', limitDate.toISOString());
  } catch (e) { console.error("Erro ao limpar histórico antigo:", e); }
};

