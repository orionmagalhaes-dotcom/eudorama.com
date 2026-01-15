import React, { useState, useEffect } from 'react';
import { Smartphone, Download, X, Share, PlusSquare, ArrowBigDownDash, Settings } from 'lucide-react';

const PWAInstallOverlay: React.FC = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isIOS, setIsIOS] = useState(false);

    useEffect(() => {
        console.log('PWA: Overlay inicializado. Verificando ambiente...');
        // Detect iOS
        const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
        setIsIOS(isIOSDevice);
        console.log('PWA: Dispositivo iOS:', isIOSDevice);

        const handleBeforeInstallPrompt = (e: any) => {
            console.log('PWA: Evento beforeinstallprompt capturado!');
            e.preventDefault();
            setDeferredPrompt(e);
            setIsVisible(true);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // If iOS and not standalone, show help after 3 seconds
        if (isIOSDevice && !window.matchMedia('(display-mode: standalone)').matches) {
            console.log('PWA: Exibindo guia de instalação para iOS.');
            const timer = setTimeout(() => setIsVisible(true), 3000);
            return () => clearTimeout(timer);
        }

        // Just for debugging: if URL has ?debug_pwa=true
        if (window.location.search.includes('debug_pwa=true')) {
            console.log('PWA: Modo debug ativado, forçando visibilidade.');
            setIsVisible(true);
        }

        return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }, []);

    const handleInstallClick = async () => {
        if (!deferredPrompt) {
            alert('Aguarde um momento... O navegador ainda está validando o aplicativo para instalação. Certifique-se de que está usando Chrome ou Edge em modo seguro.');
            console.warn('PWA: Clique no botão mas deferredPrompt ainda é null.');
            return;
        }
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`PWA: Escolha do usuário: ${outcome}`);
        if (outcome === 'accepted') {
            setIsVisible(false);
        }
        setDeferredPrompt(null);
    };

    if (!isVisible) return null;

    return (
        <div className="fixed inset-x-0 bottom-24 z-[70] px-4 animate-bounce-in">
            <div className="bg-white rounded-[2rem] p-5 shadow-2xl border-2 border-pink-100 relative overflow-hidden ring-1 ring-pink-50">
                <button
                    onClick={() => setIsVisible(false)}
                    className="absolute top-4 right-4 p-1.5 bg-gray-50 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={18} />
                </button>

                <div className="flex gap-4 items-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0 scale-105">
                        <Smartphone size={32} />
                    </div>
                    <div className="flex-1 min-w-0 pr-6">
                        <h4 className="text-lg font-black text-gray-900 leading-tight">Instalar EuDorama</h4>
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-wide mt-0.5">App Oficial para Smartphones</p>
                    </div>
                </div>

                <div className="mt-5">
                    {isIOS ? (
                        <div className="bg-pink-50 rounded-2xl p-4 space-y-3 border border-pink-100">
                            <p className="text-xs font-bold text-pink-700 leading-relaxed uppercase tracking-tight">
                                No seu iPhone, clique em <span className="inline-flex items-center align-middle bg-white px-1.5 py-0.5 rounded border border-pink-200"><Share size={12} className="text-blue-500" /> Compartilhar</span> e depois em <span className="inline-flex items-center align-middle bg-white px-1.5 py-0.5 rounded border border-pink-200"><PlusSquare size={12} className="text-gray-700" /> Adicionar à Tela de Início</span>.
                            </p>
                        </div>
                    ) : (
                        <button
                            onClick={handleInstallClick}
                            className="w-full bg-pink-600 hover:bg-pink-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-pink-200 transition-all active:scale-95 flex items-center justify-center gap-3"
                        >
                            <Download size={20} />
                            INSTALAR AGORA
                        </button>
                    )}
                </div>

                {/* Decorator */}
                <div className="absolute -bottom-2 -right-2 opacity-5 pointer-events-none transform rotate-12">
                    <Smartphone size={100} />
                </div>
            </div>
        </div>
    );
};

export default PWAInstallOverlay;
