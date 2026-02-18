import React from 'react';
import { X, TrendingUp, Calendar } from 'lucide-react';

interface PriceAdjustmentBannerProps {
    isOpen: boolean;
    onClose: () => void;
}

const PriceAdjustmentBanner: React.FC<PriceAdjustmentBannerProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-[2rem] p-6 max-w-sm w-full shadow-2xl space-y-5 animate-scale-up border-t-4 border-amber-500">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-amber-100 rounded-2xl">
                            <TrendingUp size={24} className="text-amber-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-gray-800 leading-tight">Aviso Importante</h3>
                            <p className="text-xs font-bold text-amber-600 uppercase tracking-wide flex items-center gap-1">
                                <Calendar size={12} /> A partir de 01/03/2026
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <X size={20} className="text-gray-400" />
                    </button>
                </div>

                {/* Mensagem */}
                <div className="space-y-3">
                    <p className="text-gray-700 text-sm font-medium leading-relaxed">
                        Para continuar oferecendo nossos serviços de qualidade, precisaremos fazer um <strong>pequeno reajuste nos valores mensais</strong> das assinaturas.
                    </p>

                    {/* Tabela de Preços */}
                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-2">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Novos Valores</p>

                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="font-bold text-gray-700">Viki Pass</span>
                            <span className="font-black text-amber-600">R$ 24,90</span>
                        </div>

                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="font-bold text-gray-700">IQIYI</span>
                            <span className="font-black text-amber-600">R$ 19,90</span>
                        </div>

                        <div className="flex justify-between items-center py-2">
                            <span className="font-bold text-gray-700">Kocowa+, DramaBox, Youku, WeTV</span>
                            <span className="font-black text-amber-600">R$ 16,90</span>
                        </div>
                    </div>

                    <p className="text-gray-500 text-xs font-medium text-center">
                        Agradecemos sua compreensão e apoio! 💖
                    </p>
                </div>

                {/* Botão */}
                <button
                    onClick={onClose}
                    className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-black text-sm uppercase tracking-wide shadow-lg shadow-amber-200 active:scale-95 transition-all"
                >
                    Entendido
                </button>
            </div>
        </div>
    );
};

export default PriceAdjustmentBanner;
