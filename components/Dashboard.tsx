
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { User, AppCredential } from '../types';
import { getAssignedCredential } from '../services/credentialService';
import { getAllClients, updateClientName, updateClientPreferences } from '../services/clientService';
import { 
  Copy, Check, CreditCard, Star, Crown, Sparkles, Loader2, 
  RotateCw, Key, Smartphone, Mail, Lock, AlertTriangle, PlusCircle, ArrowRight, Edit3, Fingerprint, ShieldAlert, Palette, Camera, X, CheckCircle2, Upload, Trash2, Clock, Zap, ShoppingBag, ArrowUpRight, Wifi
} from 'lucide-react';

interface DashboardProps {
  user: User;
  onOpenSupport: () => void;
  onOpenCheckout: (type: 'renewal' | 'gift' | 'new_sub' | 'early_renewal', targetService?: string) => void;
  showPalette: boolean; 
  setShowPalette: (show: boolean) => void;
  onUpdateUser: (updatedUser: User) => void;
  syncTrigger?: number; 
}

const THEME_OPTIONS = [
    { name: 'Rosa Dorama', color: 'bg-pink-50', value: 'pink' },
    { name: 'Lavanda', color: 'bg-purple-50', value: 'purple' },
    { name: 'Céu Azul', color: 'bg-blue-50', value: 'blue' },
    { name: 'Menta', color: 'bg-emerald-50', value: 'emerald' },
    { name: 'Âmbar', color: 'bg-amber-50', value: 'amber' },
    { name: 'Noite', color: 'bg-slate-900', value: 'dark' },
];

const ALL_AVAILABLE_SERVICES = [
    { name: 'Viki Pass', desc: 'O maior catálogo de doramas coreanos do mundo.', color: 'from-blue-500 to-indigo-600' },
    { name: 'Kocowa+', desc: 'Programas de variedades e K-Pop em tempo real.', color: 'from-indigo-500 to-purple-600' },
    { name: 'IQIYI', desc: 'Os melhores C-Dramas e produções em 4K.', color: 'from-emerald-500 to-teal-600' },
    { name: 'WeTV', desc: 'Séries exclusivas da Tencent com dublagem.', color: 'from-orange-500 to-red-600' },
    { name: 'DramaBox', desc: 'Doramas verticais viciantes para maratonar.', color: 'from-rose-500 to-pink-600' },
    { name: 'Youku', desc: 'Clássicos chineses e novas tendências.', color: 'from-cyan-500 to-blue-600' }
];

const Dashboard: React.FC<DashboardProps> = ({ user, onOpenCheckout, showPalette, setShowPalette, onUpdateUser, syncTrigger = 0 }) => {
  const [mergedData, setMergedData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(user.name);
  const [isSyncing, setIsSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validServices = useMemo(() => (user.services || []).filter(s => s && s.trim().length > 0), [user.services]);

  const missingServices = useMemo(() => {
      return ALL_AVAILABLE_SERVICES.filter(s => 
          !validServices.some(vs => vs.toLowerCase().includes(s.name.toLowerCase()))
      );
  }, [validServices]);

  const expiringServices = useMemo(() => {
    return mergedData.filter(item => item.daysLeft <= 5);
  }, [mergedData]);

  const getBgClass = () => {
      switch(user.themeColor) {
          case 'purple': return 'bg-purple-50';
          case 'blue': return 'bg-blue-50';
          case 'emerald': return 'bg-emerald-50';
          case 'amber': return 'bg-amber-50';
          case 'dark': return 'bg-slate-950';
          default: return 'bg-pink-50';
      }
  };

  const getTextColorClass = () => user.themeColor === 'dark' ? 'text-white' : 'text-gray-900';

  useEffect(() => {
      const loadUnifiedData = async () => {
          setIsSyncing(true);
          if (mergedData.length === 0) setLoading(true);
          
          const allClients = await getAllClients();
          const results = await Promise.all(validServices.map(async (raw) => {
              const name = raw.split('|')[0].trim();
              let details = user.subscriptionDetails ? user.subscriptionDetails[name] : null;
              
              let purchaseDate = details ? new Date(details.purchaseDate) : new Date(user.purchaseDate);
              let duration = details ? (details.durationMonths || 1) : (user.durationMonths || 1);
              
              const expiryDate = new Date(purchaseDate);
              expiryDate.setMonth(purchaseDate.getMonth() + duration);
              
              const now = new Date();
              now.setHours(0,0,0,0);
              const target = new Date(expiryDate);
              target.setHours(0,0,0,0);
              
              const diffTime = target.getTime() - now.getTime();
              const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              
              const result = await getAssignedCredential(user, name, allClients);
              
              const itemIsDebtor = details ? details.isDebtor : false;
              const isBlocked = ((daysLeft < -3) || (itemIsDebtor && daysLeft < 0)) && !user.overrideExpiration;

              return { 
                  name, 
                  daysLeft, 
                  isBlocked,
                  cred: result.credential, 
                  alert: result.alert,
                  expiryDate,
                  itemIsDebtor
              };
          }));
          setMergedData(results);
          setLoading(false);
          setTimeout(() => setIsSyncing(false), 800);
      };

      if (validServices.length > 0) loadUnifiedData();
      else setLoading(false);
  }, [validServices, user.phoneNumber, user.subscriptionDetails, user.isDebtor, user.name, user.purchaseDate, user.durationMonths, user.overrideExpiration, syncTrigger]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text.trim());
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleEditName = async () => {
      if (isEditingName && tempName !== user.name && tempName.trim()) {
          await updateClientName(user.phoneNumber, tempName.trim());
          onUpdateUser({ ...user, name: tempName.trim() });
      }
      setIsEditingName(!isEditingName);
  };

  const handleUpdateTheme = async (colorValue: string) => {
      const success = await updateClientPreferences(user.phoneNumber, { theme_color: colorValue });
      if (success) {
          onUpdateUser({ ...user, themeColor: colorValue });
      }
  };

  const handleProfileImageClick = () => {
      fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
          alert("Imagem muito grande! Escolha uma de até 2MB.");
          return;
      }

      setUploading(true);
      const reader = new FileReader();
      reader.onloadend = async () => {
          const base64String = reader.result as string;
          const success = await updateClientPreferences(user.phoneNumber, { profile_image: base64String });
          if (success) {
              onUpdateUser({ ...user, profileImage: base64String });
          }
          setUploading(false);
      };
      reader.readAsDataURL(file);
  };

  const handleSmartRenewal = () => {
    if (expiringServices.length === 0) return;
    const targets = expiringServices.map(s => s.name).join(',');
    const hasExpired = expiringServices.some(s => s.daysLeft < 0);
    onOpenCheckout(hasExpired ? 'renewal' : 'early_renewal', targets);
  };

  return (
    <div className={`${getBgClass()} min-h-screen pb-32 transition-all duration-500`}>
      <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*" 
          onChange={handleFileChange} 
      />

      {showPalette && (
          <div className="px-5 pt-4 animate-slide-down sticky top-20 z-40">
              <div className="bg-white/95 backdrop-blur-md rounded-[2.5rem] p-6 shadow-2xl border border-white space-y-6">
                  <div className="flex justify-between items-center">
                      <h3 className="text-sm font-black uppercase text-gray-800 flex items-center gap-2">
                          <Palette size={18} className="text-pink-500" /> Personalizar Estilo
                      </h3>
                      <button onClick={() => setShowPalette(false)} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
                          <X size={20} className="text-gray-400" />
                      </button>
                  </div>
                  <div className="grid grid-cols-6 gap-3">
                      {THEME_OPTIONS.map((opt) => (
                          <button 
                            key={opt.value}
                            onClick={() => handleUpdateTheme(opt.value)}
                            className={`aspect-square rounded-2xl border-4 transition-all transform active:scale-90 ${opt.color} ${user.themeColor === opt.value ? 'border-pink-500 scale-110 shadow-lg' : 'border-gray-50 hover:border-pink-200'}`}
                          />
                      ))}
                  </div>
              </div>
          </div>
      )}

      <div className="flex justify-between items-center px-6 pt-8 pb-4">
          <div className="flex items-center gap-5">
              <div className="relative group cursor-pointer" onClick={handleProfileImageClick}>
                  <div className={`w-24 h-24 rounded-full overflow-hidden border-4 border-white shadow-xl ring-4 ring-pink-200 shrink-0 bg-white flex items-center justify-center ${uploading ? 'opacity-50' : ''}`}>
                      {uploading ? (
                          <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                      ) : (
                          <img src={user.profileImage || `https://ui-avatars.com/api/?name=${user.name}&background=random`} alt="Profile" className="w-full h-full object-cover" />
                      )}
                  </div>
                  <div className="absolute bottom-0 right-0 bg-pink-600 text-white p-2 rounded-full shadow-lg border-2 border-white">
                      <Camera size={14} />
                  </div>
              </div>
              <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {isEditingName ? (
                        <input autoFocus className="bg-white border border-pink-300 rounded-lg px-2 py-1 text-sm font-bold outline-none w-32 text-gray-900" value={tempName} onChange={(e) => setTempName(e.target.value)} onBlur={handleEditName} onKeyDown={(e) => e.key === 'Enter' && handleEditName()}/>
                    ) : (
                        <h2 className={`text-2xl font-black tracking-tight leading-none truncate ${getTextColorClass()}`}>{user.name}</h2>
                    )}
                    <button onClick={handleEditName} className="p-1 text-gray-400 hover:text-pink-600 transition-colors"><Edit3 size={16} /></button>
                  </div>
                  <div className="flex items-center gap-2 mt-2.5">
                    <div className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-full border border-pink-100 shadow-sm w-fit">
                        <Crown size={14} className="text-yellow-500 fill-current" />
                        <span className="text-[11px] font-black text-pink-600 uppercase tracking-[0.15em]">Membro VIP</span>
                    </div>
                    {/* INDICADOR REALTIME */}
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-white shadow-sm transition-all duration-500 ${isSyncing ? 'border-blue-200 text-blue-500' : 'border-emerald-100 text-emerald-500'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-blue-500 animate-spin' : 'bg-emerald-500 animate-pulse'}`}></div>
                        <span className="text-[9px] font-black uppercase tracking-widest">{isSyncing ? 'Sincronizando' : 'Ao Vivo'}</span>
                    </div>
                  </div>
              </div>
          </div>
      </div>

      <div className="px-5 pt-4 space-y-6">
          {!loading && expiringServices.length > 0 && (
              <div className="animate-fade-in-up">
                  <button 
                      onClick={handleSmartRenewal}
                      className="w-full bg-gradient-to-r from-orange-500 to-red-600 p-6 rounded-[2.5rem] text-white shadow-xl shadow-orange-200 flex items-center justify-between group overflow-hidden relative active:scale-[0.98] transition-all"
                  >
                      <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-125 transition-transform">
                          <RotateCw size={80} />
                      </div>
                      <div className="flex items-center gap-4 relative z-10 text-left">
                          <div className="bg-white/20 p-4 rounded-2xl backdrop-blur-md">
                              <AlertTriangle className="text-white animate-pulse" size={28} />
                          </div>
                          <div>
                              <p className="text-xs font-black uppercase tracking-widest text-white/80">Atenção {user.name.split(' ')[0]}!</p>
                              <h3 className="text-xl font-black">
                                  {expiringServices.length === 1 
                                    ? `1 assinatura ${expiringServices[0].daysLeft < 0 ? 'vencida' : 'pendente'}`
                                    : `${expiringServices.length} assinaturas pendentes`
                                  }
                              </h3>
                          </div>
                      </div>
                      <div className="bg-white text-orange-600 p-3 rounded-2xl shadow-lg relative z-10 group-hover:translate-x-1 transition-transform">
                          <ArrowRight size={24} />
                      </div>
                  </button>
              </div>
          )}

          {loading && mergedData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-pink-500" />
                  <p className="font-bold text-sm uppercase tracking-widest">Iniciando Conexão...</p>
              </div>
          ) : (
              <div className="grid grid-cols-1 gap-5">
                  {mergedData.map((item, i) => (
                    <div key={i} className={`bg-white rounded-[2.5rem] p-6 shadow-xl border relative overflow-hidden transition-all ${item.daysLeft < 0 ? 'border-red-100' : 'border-gray-100'}`}>
                        {item.daysLeft <= 5 && item.daysLeft >= 0 && (
                            <div className="absolute top-0 right-0 left-0 bg-yellow-400 py-1 text-center">
                                <span className="text-[9px] font-black text-yellow-950 uppercase flex items-center justify-center gap-1"><Clock size={10}/> Vencimento Próximo!</span>
                            </div>
                        )}
                        {item.daysLeft < 0 && item.daysLeft >= -3 && (
                            <div className="absolute top-0 right-0 left-0 bg-orange-500 py-1 text-center">
                                <span className="text-[9px] font-black text-white uppercase flex items-center justify-center gap-1"><AlertTriangle size={10}/> ASSINATURA VENCIDA (EM TOLERÂNCIA)</span>
                            </div>
                        )}
                        {item.isBlocked && (
                            <div className="absolute top-0 right-0 left-0 bg-red-600 py-1 text-center">
                                <span className="text-[9px] font-black text-white uppercase flex items-center justify-center gap-1"><ShieldAlert size={10}/> ACESSO SUSPENSO</span>
                            </div>
                        )}

                        <div className={`flex justify-between items-start mb-6 ${(item.daysLeft <= 5 || item.isBlocked || (item.daysLeft < 0 && item.daysLeft >= -3)) ? 'mt-4' : ''}`}>
                            <div className="flex items-center gap-4">
                                <div className={`w-14 h-14 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-lg ring-4 ring-pink-50`}>{item.name[0]}</div>
                                <div>
                                    <h3 className="font-black text-gray-800 text-lg leading-none">{item.name}</h3>
                                    <span className={`inline-block px-2 py-0.5 mt-2 rounded-lg text-[10px] font-black uppercase ${item.daysLeft < 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                                        {item.daysLeft < 0 ? `Vencido há ${Math.abs(item.daysLeft)} ${Math.abs(item.daysLeft) === 1 ? 'dia' : 'dias'}` : `${item.daysLeft} dias restantes`}
                                    </span>
                                </div>
                            </div>
                            {item.daysLeft <= 5 && (
                                <button onClick={() => onOpenCheckout(item.daysLeft < 0 ? 'renewal' : 'early_renewal', item.name)} className={`px-4 py-2 rounded-2xl font-black text-[10px] uppercase shadow-md transition-transform active:scale-95 flex items-center gap-1.5 ${item.daysLeft < 0 ? 'bg-red-600 text-white' : 'bg-yellow-400 text-yellow-950'}`}>
                                    <RotateCw size={14} /> Renovar
                                </button>
                            )}
                        </div>
                        
                        <div className="space-y-3">
                            <div className="bg-gray-50 p-4 rounded-[1.5rem] border border-gray-100 flex justify-between items-center group">
                                <div className="flex flex-col min-w-0 flex-1 text-gray-800">
                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Login</span>
                                    <span className={`font-mono font-bold text-sm break-all transition-all duration-500 ${item.isBlocked ? 'text-red-300 blur-[8px] select-none' : 'text-gray-700'}`}>
                                        {item.isBlocked ? 'BLOQUEADO' : (item.cred?.email || 'Buscando...')}
                                    </span>
                                </div>
                                {!item.isBlocked && <button onClick={() => item.cred && copyToClipboard(item.cred.email, `e-${i}`)} className="p-3 text-indigo-600 bg-white border border-gray-100 rounded-xl shadow-sm active:scale-90 flex items-center gap-1"><Copy size={14}/><span className="text-[10px] font-black uppercase">Copiar</span></button>}
                            </div>
                            <div className="bg-gray-50 p-4 rounded-[1.5rem] border border-gray-100 flex justify-between items-center group">
                                <div className="flex flex-col min-w-0 flex-1 text-gray-800">
                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Senha</span>
                                    <span className={`font-mono font-bold tracking-widest transition-all duration-500 ${item.isBlocked ? 'text-red-300 blur-[8px] select-none' : 'text-gray-700'}`}>
                                        {item.isBlocked ? '••••••••' : (item.cred?.password || '••••••')}
                                    </span>
                                </div>
                                {!item.isBlocked && <button onClick={() => item.cred && copyToClipboard(item.cred.password, `p-${i}`)} className="p-3 text-indigo-600 bg-white border border-gray-100 rounded-xl shadow-sm active:scale-90 flex items-center gap-1"><Copy size={14}/><span className="text-[10px] font-black uppercase">Copiar</span></button>}
                            </div>
                        </div>

                        {item.daysLeft < 0 && item.daysLeft >= -3 && !item.isBlocked && (
                            <div className="mt-4 bg-orange-50 p-3 rounded-2xl border border-orange-100 flex items-center gap-3">
                                <AlertTriangle className="text-orange-500 shrink-0" size={16} />
                                <p className="text-[9px] font-bold text-orange-800 uppercase leading-tight">Sua assinatura venceu. Renove em até {4 + item.daysLeft} dias para não perder o acesso visual às credenciais.</p>
                            </div>
                        )}
                        
                        {item.isBlocked && (
                            <div className="mt-4 bg-red-50 p-4 rounded-2xl border border-red-100 flex items-center gap-3 animate-pulse">
                                <Lock className="text-red-500 shrink-0" size={18} />
                                <p className="text-[10px] font-bold text-red-700 uppercase leading-tight">Acesso Suspenso. Regularize seu pagamento para liberar as credenciais.</p>
                            </div>
                        )}
                    </div>
                  ))}

                  {missingServices.length > 0 && (
                      <div className="pt-10 pb-4 space-y-6">
                          <div className="flex items-center gap-3 px-1">
                              <div className="p-2 bg-pink-100 rounded-xl text-pink-600"><ShoppingBag size={20} /></div>
                              <div>
                                  <h4 className="text-lg font-black text-gray-800 leading-none">Explore Novos Horizontes</h4>
                                  <p className="text-xs text-gray-400 font-bold uppercase mt-1">Experiências que você ainda não tem</p>
                              </div>
                          </div>

                          <div className="grid grid-cols-1 gap-4">
                              {missingServices.map((svc, idx) => (
                                  <div key={idx} className={`relative overflow-hidden bg-gradient-to-br ${svc.color} p-6 rounded-[2.5rem] text-white shadow-xl group transition-all hover:-translate-y-1`}>
                                      <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                                          <Sparkles size={120} />
                                      </div>
                                      <div className="relative z-10 space-y-4">
                                          <div className="flex justify-between items-start">
                                              <div className="bg-white/20 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                                                  VIP Access
                                              </div>
                                              <Zap size={24} className="text-yellow-300 fill-yellow-300 animate-pulse" />
                                          </div>
                                          <div>
                                              <h5 className="text-2xl font-black">{svc.name}</h5>
                                              <p className="text-sm font-medium text-white/80 mt-1 max-w-[220px]">{svc.desc}</p>
                                          </div>
                                          <button 
                                              onClick={() => onOpenCheckout('new_sub', svc.name)}
                                              className="bg-white text-gray-900 px-6 py-3 rounded-2xl font-black text-xs uppercase flex items-center gap-2 shadow-lg active:scale-95 transition-all w-fit"
                                          >
                                              Assinar Agora <ArrowRight size={14} />
                                          </button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}
              </div>
          )}
      </div>
    </div>
  );
};

export default Dashboard;
