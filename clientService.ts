
import { createClient } from '@supabase/supabase-js';
import { User, ClientDBRow, Dorama, AdminUserDBRow, SubscriptionDetail } from './types';

// --- CONFIGURAÇÃO DO SUPABASE ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mhiormzpctfoyjbrmxfz.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaW9ybXpwY3Rmb3lqYnJteGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4NTkwNjUsImV4cCI6MjA4MTQzNTA2NX0.y5rfFm0XHsieEZ2fCDH6tq5sZI7mqo8V_tYbbkKWroQ';

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
  hasPassword: boolean; 
  phoneMatches: string[] 
}> => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('phone_number, client_password, deleted')
      .like('phone_number', `%${lastFourDigits}`);

    if (error || !data || data.length === 0) return { exists: false, hasPassword: false, phoneMatches: [] };

    const activeClients = (data as any[]).filter(c => !c.deleted);
    if (activeClients.length === 0) return { exists: false, hasPassword: false, phoneMatches: [] };

    const hasPass = activeClients.some(row => row.client_password && row.client_password.trim() !== '');
    const phones = Array.from(new Set(activeClients.map(d => d.phone_number as string)));
    return { exists: true, hasPassword: hasPass, phoneMatches: phones };
  } catch (e) { return { exists: false, hasPassword: false, phoneMatches: [] }; }
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
              
              allServices.add(cleanService);
              
              subscriptionMap[cleanService] = {
                  purchaseDate: specificDate || row.purchase_date,
                  durationMonths: individualDuration,
                  isDebtor: !individualPaid 
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
    const gameProgress = bestRow.game_progress || {};

    const appUser: User = {
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
      gameProgress: gameProgress,
      themeColor: bestRow.theme_color,
      backgroundImage: bestRow.background_image,
      profileImage: bestRow.profile_image
    };

    return { user: appUser, error: null };
};

export const verifyAdminLogin = async (login: string, pass: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase.from('admin_users').select('*').eq('username', login).limit(1);
    if (error || !data || data.length === 0) return false;
    return (data[0] as AdminUserDBRow).password === pass;
  } catch (e) { return false; }
};
