import React, { useMemo, useState } from 'react';
import { X, Check, Receipt, Gift, Sparkles, CreditCard, Copy, MessageCircle } from 'lucide-react';
import { User } from '../types';
import { getServicePrice } from '../services/pricingConfig';
import { copyTextToClipboard } from '../services/clipboard';

interface CheckoutModalProps {
    onClose: () => void;
    user: User;
    type?: 'renewal' | 'gift' | 'new_sub' | 'early_renewal';
    targetService?: string;
}

const PIX_KEY = '00020126330014br.gov.bcb.pix0111024461983255204000053039865802BR5925Orion Saimon Magalhaes Co6009Sao Paulo62290525REC69361CCAD78A4566579523630467EB';
const INFINITY_PAY_CHECKOUT_FALLBACK_URL = 'https://checkout.infinitepay.io/orion_magalhaes/2RPzPmBfQ1';
const INFINITY_PAY_CHECKOUT_HANDLE_URL = 'https://checkout.infinitepay.io/orion_magalhaes';

const SERVICE_INFO: Record<string, string[]> = {
    'Viki Pass': ['Doramas exclusivos (Originais Viki)', '100% sem anuncios', 'Alta qualidade (Full HD)', 'Episodios antes de todo mundo'],
    'Kocowa+': ['Shows de K-Pop ao vivo', 'Reality shows coreanos', 'Legendas em tempo recorde', 'Entrevistas exclusivas'],
    'IQIYI': ['Melhores C-Dramas e animes', 'Qualidade 4K e som Dolby', 'Catalogo VIP Diamond', 'Sem interrupcoes'],
    'WeTV': ['Series Tencent alto orcamento', 'Mini doramas exclusivos', 'Opcoes de dublagem PT-BR', 'Conteudos extras'],
    'DramaBox': ['Micro-doramas (ep. 1 min)', 'Formato vertical mobile', 'Historias de vinganca e amor', 'Moedas ilimitadas'],
    'Youku': ['Sucessos da TV chinesa', 'Exclusivos Youku Premium', 'Legendas em portugues', 'Download offline'],
    'Contribuicao Voluntaria': ['Ajuda a manter nossos servidores', 'Mantem a plataforma funcionando', 'Seu carinho faz a diferenca', 'Acesso continuo aos doramas']
};

const buildInfinityPayCheckoutUrl = (services: string[], isVoluntaryOnly: boolean) => {
    if (isVoluntaryOnly) return INFINITY_PAY_CHECKOUT_FALLBACK_URL;

    const items = services
        .map((service) => {
            const price = getServicePrice(service, 1);
            if (!Number.isFinite(price) || price <= 0) return null;

            return {
                name: service,
                price: Math.round(price * 100),
                quantity: 1
            };
        })
        .filter((item): item is { name: string; price: number; quantity: number } => !!item);

    if (items.length === 0) return INFINITY_PAY_CHECKOUT_FALLBACK_URL;

    const params = new URLSearchParams();
    params.set('items', JSON.stringify(items));
    params.set('order_nsu', `eudorama-${Date.now()}`);
    params.set('redirect_url', window.location.href);

    return `${INFINITY_PAY_CHECKOUT_HANDLE_URL}?${params.toString()}`;
};

const CheckoutModal: React.FC<CheckoutModalProps> = ({ onClose, user, type = 'renewal', targetService }) => {
    const [copied, setCopied] = useState(false);

    const renewalList = useMemo(() => {
        if (!(type === 'new_sub' || type === 'renewal' || type === 'early_renewal' || type === 'gift')) return [];

        if (targetService) {
            return targetService
                .split(',')
                .map((service) => service.trim())
                .filter((service) => service.length > 0);
        }

        if (type === 'gift') {
            return ['Contribuicao Voluntaria (Apoio)'];
        }

        return user.services || [];
    }, [targetService, type, user.services]);

    const total = useMemo(() => {
        return renewalList.reduce((acc, service) => {
            if (service.includes('Contribuicao Voluntaria')) return acc;
            return acc + getServicePrice(service, 1);
        }, 0);
    }, [renewalList]);

    const formattedPrice = useMemo(() => total.toFixed(2).replace('.', ','), [total]);
    const isVoluntaryOnly = renewalList.length === 1 && renewalList[0].includes('Contribuicao Voluntaria');

    const checkoutUrl = useMemo(
        () => buildInfinityPayCheckoutUrl(renewalList, isVoluntaryOnly),
        [renewalList, isVoluntaryOnly]
    );

    const benefits = useMemo(() => {
        const serviceName = renewalList[0] || '';
        const key = Object.keys(SERVICE_INFO).find((serviceKey) => serviceName.includes(serviceKey));
        return key ? SERVICE_INFO[key] : [];
    }, [renewalList]);

    const handleInfinityPayCheckout = () => {
        window.location.assign(checkoutUrl);
    };

    const handleCopyPix = async () => {
        const copiedValue = await copyTextToClipboard(PIX_KEY);
        if (!copiedValue) {
            alert('Nao foi possivel copiar a chave Pix agora. Tente novamente.');
            return;
        }

        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSendProof = () => {
        const priceText = isVoluntaryOnly ? 'valor voluntario' : `R$ ${formattedPrice}`;
        const message = `Ola! Fiz o Pix de ${priceText} referente a **${renewalList.join(', ')}**. Segue comprovante:`;
        window.open(`https://wa.me/558894875029?text=${encodeURIComponent(message)}`, '_blank');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-2xl bg-white shadow-md">
                            {type === 'gift' ? <Gift className="text-red-600" /> : <Receipt className="text-green-700" />}
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-gray-800">{type === 'new_sub' ? 'Assinar novo' : 'Finalizar pagamento'}</h2>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">InfinityPay e Pix</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2.5 bg-white shadow-sm hover:bg-gray-200 rounded-full">
                        <X className="w-6 h-6 text-gray-500" />
                    </button>
                </div>

                <div className="overflow-y-auto p-6 space-y-6">
                    <div className="bg-gray-900 p-6 rounded-[2rem] text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <span className="text-[10px] font-black uppercase text-gray-400 block mb-1">Total a pagar</span>
                            <p className="font-black text-2xl sm:text-3xl break-words">
                                {isVoluntaryOnly ? 'Voluntario' : `R$ ${formattedPrice}`}
                            </p>
                        </div>
                        <div className="text-left sm:text-right w-full sm:w-auto">
                            <span className="text-[10px] font-black uppercase text-pink-400 block mb-1">Assinaturas</span>
                            <p className="font-bold text-sm text-gray-200 leading-snug">
                                {renewalList.length > 1 ? `${renewalList.length} Apps` : (renewalList[0] || 'Plano')}
                            </p>
                        </div>
                    </div>

                    {benefits.length > 0 && (
                        <div className="bg-blue-50 p-5 rounded-[2rem] border border-blue-100">
                            <p className="text-[10px] font-black text-blue-800 uppercase mb-4 flex items-center gap-2">
                                <Sparkles className="w-3 h-3" /> Beneficios VIP
                            </p>
                            <ul className="space-y-3">
                                {benefits.map((benefit, idx) => (
                                    <li key={idx} className="flex items-center text-sm font-bold text-blue-900">
                                        <Check className="w-4 h-4 text-blue-600 mr-2" /> {benefit}
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
                                    <span key={idx} className="bg-white px-3 py-1 rounded-full text-[10px] font-bold border border-gray-200 text-gray-600">
                                        {item}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-4">
                        <button
                            onClick={handleInfinityPayCheckout}
                            className="w-full py-5 rounded-[1.5rem] font-black uppercase flex justify-center items-center transition-all shadow-lg active:scale-95 bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                            <CreditCard className="w-5 h-5 mr-2" /> Pagar com InfinityPay
                        </button>

                        <button
                            onClick={handleCopyPix}
                            className={`w-full py-5 rounded-[1.5rem] font-black uppercase flex justify-center items-center transition-all shadow-lg active:scale-95 ${copied ? 'bg-green-500 text-white' : 'bg-gray-900 text-white hover:bg-black'}`}
                        >
                            <Copy className="w-5 h-5 mr-2" /> {copied ? 'Codigo copiado com sucesso!' : 'Copiar chave Pix'}
                        </button>

                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 text-center space-y-1">
                            <p className="text-[10px] font-black text-gray-400 uppercase">Ou pague com a chave CPF:</p>
                            <p className="font-black text-gray-800 text-lg tracking-wide">02446198325</p>
                            <p className="text-xs font-bold text-gray-500">Orion Saimon Magalhaes - PicPay</p>
                        </div>

                        <button
                            onClick={handleSendProof}
                            className="w-full bg-green-600 hover:bg-green-700 text-white font-black py-5 rounded-[1.5rem] flex justify-center items-center uppercase transition-all shadow-md active:scale-95"
                        >
                            <MessageCircle className="w-5 h-5 mr-2" /> Ja paguei! Enviar comprovante
                        </button>
                    </div>

                    <p className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                        O acesso e liberado manualmente apos o envio do comprovante.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default CheckoutModal;
