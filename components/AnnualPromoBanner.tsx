import React from 'react';
import { X, CalendarDays, MessageCircle, CreditCard, Flame, ShieldCheck, Sparkles } from 'lucide-react';

interface AnnualPromoBannerProps {
  isOpen: boolean;
  onClose: () => void;
}

const SUPPORT_WHATSAPP_NUMBER = '558894875029';
const PROMO_WHATSAPP_MESSAGE = encodeURIComponent(
  'Ola! Tenho interesse no combo anual com os 3 apps juntos (Viki Pass + Kocowa+ + Dramabox) por R$ 199 no PIX ou R$ 249 em ate 12x no cartao. Ja tenho plano ativo e quero confirmar a soma dos dias para nao perder nenhum dia pago.'
);
const PROMO_APPS = [
  {
    name: 'Viki Pass',
    detail: 'Doramas asiaticos premium sem anuncios.',
    color: 'text-rose-700 border-rose-200 bg-rose-50'
  },
  {
    name: 'Kocowa+',
    detail: 'Variedades e conteudo coreano oficial.',
    color: 'text-sky-700 border-sky-200 bg-sky-50'
  },
  {
    name: 'Dramabox',
    detail: 'Series curtas e dramas para maratonar.',
    color: 'text-violet-700 border-violet-200 bg-violet-50'
  }
] as const;

const AnnualPromoBanner: React.FC<AnnualPromoBannerProps> = ({ isOpen, onClose }) => {
  const handleOpenWhatsApp = () => {
    window.open(
      `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${PROMO_WHATSAPP_MESSAGE}`,
      '_blank',
      'noopener,noreferrer'
    );
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="relative w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-scale-up">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-rose-500 to-fuchsia-600" />
        <div className="absolute -top-10 -right-10 w-36 h-36 bg-yellow-300/30 blur-2xl rounded-full" />
        <div className="absolute -bottom-10 -left-8 w-32 h-32 bg-white/20 blur-2xl rounded-full" />

        <div className="relative p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/20 text-white text-[10px] font-black uppercase tracking-wider border border-white/30">
                <Flame size={12} /> Promocao relampago
              </span>
              <h3 className="text-2xl font-black text-white leading-tight">Combo Anual com 3 Apps Juntos</h3>
              <p className="text-[11px] font-black text-yellow-100 uppercase tracking-wide flex items-center gap-1.5">
                <CalendarDays size={13} /> Valida ate 10/03/2026
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 bg-white/20 hover:bg-white/30 rounded-full transition-colors">
              <X size={20} className="text-white" />
            </button>
          </div>

          <div className="rounded-2xl border border-white/30 bg-white/10 p-3">
            <p className="text-white text-[11px] font-black uppercase tracking-wider text-center">
              Voce leva no combo anual
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {PROMO_APPS.map((app) => (
                <div
                  key={app.name}
                  className={`rounded-xl border p-2.5 ${app.color}`}
                >
                  <p className="text-xs font-black uppercase">{app.name}</p>
                  <p className="text-[10px] font-bold mt-0.5 leading-snug">{app.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-lg space-y-3 border border-white/80">
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-1">
              <Sparkles size={12} className="text-orange-500" /> Oferta do Combo Anual
            </p>

            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase">Pagamento no PIX</p>
                <p className="text-4xl leading-none font-black text-emerald-600 mt-1">R$ 199</p>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-red-50 border border-red-100 text-red-600 text-[10px] font-black uppercase tracking-wide">
                Apenas 3 vagas disponiveis
              </span>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <span className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
                <CreditCard size={14} /> Cartao (ate 12x)
              </span>
              <span className="text-2xl font-black text-indigo-600">R$ 249</span>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/95 px-4 py-3">
            <p className="text-[11px] font-bold text-emerald-900 leading-tight flex items-start gap-1.5">
              <ShieldCheck size={15} className="mt-0.5 shrink-0" />
              Se voce ja tiver plano ativo, os dias serao adicionados para voce nao perder nenhum dia ja pago.
            </p>
          </div>

          <button
            onClick={handleOpenWhatsApp}
            className="w-full bg-green-500 hover:bg-green-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 shadow-xl shadow-green-300/50 active:scale-95 transition-all"
          >
            <MessageCircle size={18} />
            Garantir Promocao no WhatsApp
          </button>

          <div className="text-center">
            <button
              onClick={onClose}
              className="text-[11px] text-white/80 font-bold uppercase hover:text-white transition-colors"
            >
              Agora nao
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnnualPromoBanner;
