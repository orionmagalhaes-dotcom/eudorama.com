import React from 'react';
import { X, Tv, Smartphone, Monitor } from 'lucide-react';

interface NewAppBannerProps {
    isOpen: boolean;
    onClose: () => void;
}

const NewAppBanner: React.FC<NewAppBannerProps> = ({ isOpen, onClose }) => {
    const handleWhatsApp = () => {
        window.open(
            'https://wa.me/5588994827119?text=Ol%C3%A1!%20Tenho%20interesse%20no%20novo%20aplicativo%20de%20TVs%2C%20filmes%20e%20s%C3%A9ries%20por%20R%2419%2C90.',
            '_blank'
        );
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors z-10"
                >
                    <X className="w-5 h-5 text-white" />
                </button>

                <div className="absolute top-4 left-4">
                    <div className="bg-yellow-400 text-yellow-900 px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest animate-pulse">
                        Novidade
                    </div>
                </div>

                <div className="pt-16 pb-8 px-6 text-white text-center space-y-5">
                    <div className="flex justify-center gap-3 text-4xl">
                        <span>TV</span>
                        <span>Filmes</span>
                        <span>Series</span>
                    </div>

                    <div>
                        <h2 className="text-2xl font-black leading-tight">
                            Novo Aplicativo Disponivel
                        </h2>
                        <p className="text-white/80 text-sm font-medium mt-2">
                            Tenha acesso a canais de TV, filmes e series em todos os seus dispositivos.
                        </p>
                    </div>

                    <div className="flex flex-wrap justify-center gap-2">
                        <span className="bg-red-600 px-3 py-1 rounded-lg text-[10px] font-black">Netflix</span>
                        <span className="bg-purple-800 px-3 py-1 rounded-lg text-[10px] font-black">HBO Max</span>
                        <span className="bg-blue-600 px-3 py-1 rounded-lg text-[10px] font-black">Prime Video</span>
                        <span className="bg-blue-700 px-3 py-1 rounded-lg text-[10px] font-black">Disney+</span>
                        <span className="bg-gray-700 px-3 py-1 rounded-lg text-[10px] font-black">+ Muito Mais</span>
                    </div>

                    <div className="bg-white/10 rounded-2xl p-4 space-y-3">
                        <p className="text-[10px] font-black uppercase text-white/60">Funciona em todos os dispositivos</p>
                        <div className="flex justify-center gap-6">
                            <div className="flex flex-col items-center gap-1">
                                <Smartphone className="w-6 h-6 text-white/80" />
                                <span className="text-[9px] font-bold text-white/60">Celular</span>
                            </div>
                            <div className="flex flex-col items-center gap-1">
                                <Monitor className="w-6 h-6 text-white/80" />
                                <span className="text-[9px] font-bold text-white/60">Computador</span>
                            </div>
                            <div className="flex flex-col items-center gap-1">
                                <Tv className="w-6 h-6 text-white/80" />
                                <span className="text-[9px] font-bold text-white/60">TV</span>
                            </div>
                        </div>
                    </div>

                    <div className="py-2">
                        <div className="flex items-baseline justify-center gap-2">
                            <span className="text-sm font-bold text-white/50 line-through">R$ 39,90</span>
                            <span className="text-4xl font-black text-yellow-300">R$ 19,90</span>
                            <span className="text-sm font-bold text-white/80">/mes</span>
                        </div>
                    </div>

                    <button
                        onClick={handleWhatsApp}
                        className="w-full bg-green-500 hover:bg-green-600 text-white py-4 rounded-2xl font-black text-sm uppercase flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
                    >
                        Quero Saber Mais
                    </button>

                    <button
                        onClick={onClose}
                        className="text-white/50 text-xs font-bold uppercase hover:text-white/80 transition-colors"
                    >
                        Agora nao
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NewAppBanner;
