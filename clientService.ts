
import { createClient } from '@supabase/supabase-js';
import { User, ClientDBRow, Dorama, AdminUserDBRow, SubscriptionDetail, HistoryLog, HistorySettings } from './types';

// --- CONFIGURAÇÃO DO SUPABASE ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

export const getAllClients = async (): Promise<ClientDBRow[]> => {
  try {
    const { data, error } = await supabase.from('clients').select('*');
    if (error) return [];
    return data as unknown as ClientDBRow[];
  } catch (e) { return []; }
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
    if (Array.isArray(row.subscriptions)) {
      subs = row.subscriptions;
    } else if (typeof row.subscriptions === 'string') {
      const s = (row.subscriptions as string).replace(/^\{|\}$/g, '');
      if (s.includes(';')) subs = s.split(';').map(i => i.trim().replace(/^"|"$/g, ''));
      else if (s.includes('+')) subs = s.split('+').map(i => i.trim().replace(/^"|"$/g, ''));
      else subs = [s.replace(/^"|"$/g, '')];
    }

    subs.forEach(s => {
      if (s) {
        const parts = s.split('|');
        const cleanService = parts[0].trim();
        const specificDate = parts[1] ? parts[1].trim() : null;
        const individualPaid = parts[2] !== '0';
        const individualDuration = (parts[3] && parts[3].trim() !== '') ? parseInt(parts[3]) : (row.duration_months || 1);
        const toleranceDate = parts[4] ? parts[4].trim() : undefined;

        allServices.add(cleanService);
        subscriptionMap[cleanService] = {
          purchaseDate: specificDate || row.purchase_date,
          durationMonths: individualDuration,
          isDebtor: !individualPaid,
          toleranceUntil: toleranceDate
        };
        if (!individualPaid) isDebtorAny = true;
      }
    });

    if (row.is_debtor) isDebtorAny = true;
    if (row.override_expiration) overrideAny = true;

    const purchase = new Date(row.purchase_date);
    const expiry = new Date(purchase);
    expiry.setMonth(purchase.getMonth() + (row.duration_months || 1));

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

    if (!payload.id || payload.id === '') delete payload.id;
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
        await logHistory('Cliente Restaurado', `Cliente ${clientName} restaurado da lixeira.`);
      } else {
        // CHECK SUBSCRIPTION CHANGES
        const oldSubs = (oldData.subscriptions || []) as string[];
        const newSubs = (payload.subscriptions || []) as string[];

        if (JSON.stringify(oldSubs) !== JSON.stringify(newSubs)) {
          // Simple diff
          if (newSubs.length > oldSubs.length) {
            await logHistory('Assinatura Adicionada', `Nova assinatura adicionada para ${clientName}.`);
          } else if (newSubs.length < oldSubs.length) {
            await logHistory('Assinatura Removida', `Assinatura removida de ${clientName}.`);
          } else {
            // Same count, content changed (renewals, etc)
            await logHistory('Assinatura Modificada', `Assinaturas de ${clientName} atualizadas (Renovação/Edição).`);
          }
        } else {
          // GENERIC DATA UPDATE
          await logHistory('Dados Atualizados', `Dados de ${clientName} foram modificados.`);
        }
      }
    }

    return { success: true, msg: "Salvo com sucesso!" };
  } catch (e: any) { return { success: false, msg: e.message }; }
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

export const registerClientPassword = async (phoneNumber: string, password: string): Promise<boolean> => {
  try {
    const { error } = await supabase.from('clients').update({ client_password: password }).eq('phone_number', phoneNumber);
    return !error;
  } catch (e) { return false; }
};

export const resetAllClientPasswords = async (): Promise<{ success: boolean, msg: string }> => {
  const { error } = await supabase.from('clients').update({ client_password: '' }).neq('id', '00000000-0000-0000-0000-000000000000');
  return error ? { success: false, msg: error.message } : { success: true, msg: "Senhas resetadas." };
};

export const hardDeleteAllClients = async (): Promise<{ success: boolean, msg: string }> => {
  try {
    // Limpa dados auxiliares mas MANTÉM a tabela de clientes intacta para evitar perdas
    await supabase.from('doramas').delete().neq('id', '0');
    await supabase.from('credentials').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await logHistory('Limpeza Geral', 'Todas as credenciais e doramas foram apagados (Hard Reset).');
    return { success: true, msg: "Dados auxiliares limpos. Clientes preservados." };
  } catch (e: any) { return { success: false, msg: e.message }; }
};

export const refreshUserProfile = async (phoneNumber: string): Promise<{ user: User | null; error: string | null }> => {
  try {
    const { data, error } = await supabase.from('clients').select('*').eq('phone_number', phoneNumber);
    if (error || !data || data.length === 0) return { user: null, error: 'Usuário não encontrado.' };
    return processUserLogin(data as unknown as ClientDBRow[]);
  } catch (e) { return { user: null, error: 'Erro de conexão.' }; }
};

export const updateClientName = async (phoneNumber: string, newName: string): Promise<boolean> => {
  const { error } = await supabase.from('clients').update({ client_name: newName }).eq('phone_number', phoneNumber);
  return !error;
};

export const updateClientPreferences = async (phoneNumber: string, preferences: any): Promise<boolean> => {
  const { error } = await supabase.from('clients').update(preferences).eq('phone_number', phoneNumber);
  return !error;
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
    const { data, error } = await supabase.from('admin_users').select('*').eq('username', login).limit(1);
    if (error || !data || data.length === 0) return false;
    return (data[0] as AdminUserDBRow).password === pass;
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
