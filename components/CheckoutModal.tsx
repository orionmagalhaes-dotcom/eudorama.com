
import React, { useState, useEffect } from 'react';
import { X, Check, Copy, Receipt, Gift, Rocket, Calendar, Sparkles, MessageCircle } from 'lucide-react';
import { User } from '../types';
import { getServicePrice } from '../services/pricingConfig';

interface CheckoutModalProps {
    onClose: () => void;
    user: User;
    type?: 'renewal' | 'gift' | 'new_sub' | 'early_renewal';
    targetService?: string;
}

const PIX_KEY = "00020126330014br.gov.bcb.pix0111024461983255204000053039865802BR5925Orion Saimon Magalhaes Co6009Sao Paulo62290525REC69361CCAD78A4566579523630467EB";

const SERVICE_INFO: Record<string, string[]> = {
    'Viki Pass': ['💎 Doramas Exclusivos (Originais Viki)', '🚫 100% Sem Anúncios', '🎬 Alta Qualidade (Full HD)', '⚡ Episódios Antes de Todo Mundo'],
    'Kocowa+': ['🇰🇷 Shows de K-Pop Ao Vivo', '🎭 Reality Shows Coreanos', '🏃 Legendas em Tempo Recorde', '🎧 Entrevistas Exclusivas'],
    'IQIYI': ['🐉 Melhores C-Dramas e Animes', '🌟 Qualidade 4K e Som Dolby', '📚 Catálogo VIP Diamond', '🚫 Sem Interrupções'],
    'WeTV': ['🏹 Séries Tencent Alto Orçamento', '🧸 Mini Doramas Exclusivos', '🇧🇷 Opções de Dublagem PT-BR', '🎁 Conteúdos Extras'],
    'DramaBox': ['🎬 Micro-Doramas (Ep. 1 min)', '📱 Formato Vertical Mobile', '🔥 Histórias de Vingança e Amor', '💰 Moedas Ilimitadas'],
    'Youku': ['🎋 Sucessos da TV Chinesa', '✨ Exclusivos Youku Premium', '💬 Legendas em Português', '📦 Download Offline'],
    'Contribuição Voluntária': ['💜 Ajuda a manter nossos servidores', '🚀 Mantém a plataforma funcionando', '🎁 Seu carinho faz a diferença', '✨ Acesso contínuo aos doramas']
};

const CheckoutModal: React.FC<CheckoutModalProps> = ({ onClose, user, type = 'renewal', targetService }) => {
    const [copied, setCopied] = useState(false);
    const [formattedPrice, setFormattedPrice] = useState('0,00');
    const [renewalList, setRenewalList] = useState<string[]>([]);

    useEffect(() => {
        if (type === 'new_sub' || type === 'renewal' || type === 'early_renewal' || type === 'gift') {
            let servicesToCalculate: string[] = [];

            if (targetService) {
                // Suporta múltiplos serviços separados por vírgula (fluxo "Renovar Todos")
                servicesToCalculate = targetService.split(',').map(s => s.trim()).filter(s => s !== '');
            } else if (type === 'gift') {
                servicesToCalculate = ['Contribuição Voluntária (Apoio)'];
            } else {
                // Se não especificado e não for presente, assume renovação de tudo que o usuário tem
                servicesToCalculate = user.services;
            }

            let total = 0;
            servicesToCalculate.forEach(svc => {
                if (svc.includes('Contribuição Voluntária')) {
                    total += 0; // Valor aberto (voluntário)
                } else {
                    // Usa preço dinâmico baseado na data (pricingConfig)
                    total += getServicePrice(svc, 1);
                }
            });

            setFormattedPrice(total.toFixed(2).replace('.', ','));
            setRenewalList(servicesToCalculate);
        }
    }, [user, type, targetService]);

    const isVoluntaryOnly = renewalList.length === 1 && renewalList[0].includes('Contribuição Voluntária');
    const displayPrice = isVoluntaryOnly ? 'Voluntário' : formattedPrice;

    const handleCopyPix = () => {
        navigator.clipboard.writeText(PIX_KEY);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSendProof = () => {
        const priceText = isVoluntaryOnly ? "valor voluntário" : `R$ ${formattedPrice}`;
        let message = `Olá! Fiz o Pix de ${priceText} referente a **${renewalList.join(', ')}**. Segue comprovante:`;
        window.open(`https://wa.me/558894875029?text=${encodeURIComponent(message)}`, '_blank');
        onClose();
    };

    let benefits: string[] = [];
    // Mostra benefícios do primeiro serviço se for uma lista, ou do único se for um
    const svcName = renewalList[0] || '';
    const key = Object.keys(SERVICE_INFO).find(k => svcName.includes(k));
    if (key) benefits = SERVICE_INFO[key];

    return (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-2xl bg-white shadow-md">
                            {type === 'gift' ? <Gift className="text-red-600" /> : <Receipt className="text-green-700" />}
                        </div>
                        <div><h2 className="text-xl font-black text-gray-800">{type === 'new_sub' ? 'Assinar Novo' : 'Finalizar Pagamento'}</h2><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Pix Copia e Cola</p></div>
                    </div>
                    <button onClick={onClose} className="p-2.5 bg-white shadow-sm hover:bg-gray-200 rounded-full"><X className="w-6 h-6 text-gray-500" /></button>
                </div>
                <div className="overflow-y-auto p-6 space-y-6">
                    <div className="bg-gray-900 p-6 rounded-[2rem] text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <span className="text-[10px] font-black uppercase text-gray-400 block mb-1">Total a Pagar</span>
                            <p className="font-black text-2xl sm:text-3xl break-words">{isVoluntaryOnly ? 'Voluntário' : `R$ ${formattedPrice}`}</p>
                        </div>
                        <div className="text-left sm:text-right w-full sm:w-auto">
                            <span className="text-[10px] font-black uppercase text-pink-400 block mb-1">Assinaturas</span>
                            <p className="font-bold text-sm text-gray-200 leading-snug">{renewalList.length > 1 ? `${renewalList.length} Apps` : (renewalList[0] || 'Plano')}</p>
                        </div>
                    </div>

                    {benefits.length > 0 && (
                        <div className="bg-blue-50 p-5 rounded-[2rem] border border-blue-100">
                            <p className="text-[10px] font-black text-blue-800 uppercase mb-4 flex items-center gap-2"><Sparkles className="w-3 h-3" /> Benefícios VIP</p>
                            <ul className="space-y-3">
                                {benefits.map((b, i) => (
                                    <li key={i} className="flex items-center text-sm font-bold text-blue-900">
                                        <Check className="w-4 h-4 text-blue-600 mr-2" /> {b}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {renewalList.length > 1 && (
                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                            <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Itens no carrinho:</p>
                            <div className="flex flex-wrap gap-2">
                                {renewalList.map((item, idx) => (
                                    <span key={idx} className="bg-white px-3 py-1 rounded-full text-[10px] font-bold border border-gray-200 text-gray-600">{item}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-4">
                        <button onClick={handleCopyPix} className={`w-full py-5 rounded-[1.5rem] font-black uppercase flex justify-center items-center transition-all shadow-lg active:scale-95 ${copied ? 'bg-green-500 text-white' : 'bg-gray-900 text-white hover:bg-black'}`}>
                            {copied ? 'Código Copiado com Sucesso!' : 'Copiar Chave Pix'}
                        </button>

                        {/* PIX Key Info */}
                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 text-center space-y-1">
                            <p className="text-[10px] font-black text-gray-400 uppercase">Ou pague com a chave CPF:</p>
                            <p className="font-black text-gray-800 text-lg tracking-wide">02446198325</p>
                            <p className="text-xs font-bold text-gray-500">Orion Saimon Magalhães • PicPay</p>
                        </div>

                        <button onClick={handleSendProof} className="w-full bg-green-600 hover:bg-green-700 text-white font-black py-5 rounded-[1.5rem] flex justify-center items-center uppercase transition-all shadow-md active:scale-95">
                            <MessageCircle className="w-5 h-5 mr-2" /> Já paguei! Enviar comprovante
                        </button>
                    </div>

                    <p className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                        O acesso é liberado manualmente após o envio do comprovante.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default CheckoutModal;
