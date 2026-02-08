import React, { useState, useEffect } from 'react';
import { X, Tv, Smartphone, Monitor, CheckCircle2 } from 'lucide-react';

const STORAGE_KEY = 'tv_streaming_promo_seen';

const TVStreamingBanner: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const hasSeenPromo = localStorage.getItem(STORAGE_KEY);
        if (!hasSeenPromo) {
            // Show after a short delay for better UX
            const timer = setTimeout(() => setIsVisible(true), 1500);
            return () => clearTimeout(timer);
        }
    }, []);

    const handleClose = () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        setIsVisible(false);
    };

    const handleWhatsApp = () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        window.open(
            'https://wa.me/5588994827119?text=Olá! Tenho interesse no acesso a TVs, filmes e séries por R$19,90. Pode me dar mais informações?',
            '_blank'
        );
        setIsVisible(false);
    };

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden relative">
                {/* Close button */}
                <button
                    onClick={handleClose}
                    className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors z-10"
                >
                    <X className="w-5 h-5 text-white" />
                </button>

                {/* Badge */}
                <div className="absolute top-4 left-4">
                    <div className="bg-yellow-400 text-yellow-900 px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest animate-pulse">
                        🔥 Novidade!
                    </div>
                </div>

                {/* Content */}
                <div className="pt-16 pb-8 px-6 text-white text-center space-y-5">
                    {/* Icons */}
                    <div className="flex justify-center gap-3">
                        <span className="text-4xl">📺</span>
                        <span className="text-4xl">🎬</span>
                        <span className="text-4xl">🍿</span>
                    </div>

                    {/* Title */}
                    <div>
                        <h2 className="text-2xl font-black leading-tight">
                            TVs, Filmes e Séries
                        </h2>
                        <p className="text-white/80 text-sm font-medium mt-2">
                            Tenha acesso a <strong className="text-yellow-300">TODOS</strong> os canais de TV, filmes e séries do mundo!
                        </p>
                    </div>

                    {/* Platforms */}
                    <div className="flex flex-wrap justify-center gap-2">
                        <span className="bg-red-600 px-3 py-1 rounded-lg text-[10px] font-black">Netflix</span>
                        <span className="bg-purple-800 px-3 py-1 rounded-lg text-[10px] font-black">HBO Max</span>
                        <span className="bg-blue-600 px-3 py-1 rounded-lg text-[10px] font-black">Prime Video</span>
                        <span className="bg-blue-700 px-3 py-1 rounded-lg text-[10px] font-black">Disney+</span>
                        <span className="bg-gray-700 px-3 py-1 rounded-lg text-[10px] font-black">+ Muito Mais</span>
                    </div>

                    {/* Device compatibility */}
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
                                <span className="text-[9px] font-bold text-white/60">Todas as TVs</span>
                            </div>
                        </div>
                    </div>

                    {/* Price */}
                    <div className="py-2">
                        <div className="flex items-baseline justify-center gap-2">
                            <span className="text-sm font-bold text-white/50 line-through">R$ 39,90</span>
                            <span className="text-4xl font-black text-yellow-300">R$ 19,90</span>
                            <span className="text-sm font-bold text-white/80">/mês</span>
                        </div>
                    </div>

                    {/* CTA Button */}
                    <button
                        onClick={handleWhatsApp}
                        className="w-full bg-green-500 hover:bg-green-600 text-white py-4 rounded-2xl font-black text-sm uppercase flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
                    >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                        Quero Saber Mais
                    </button>

                    {/* Skip */}
                    <button
                        onClick={handleClose}
                        className="text-white/50 text-xs font-bold uppercase hover:text-white/80 transition-colors"
                    >
                        Agora não, obrigado
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TVStreamingBanner;
