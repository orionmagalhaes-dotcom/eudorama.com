
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { User } from '../types';
import { getAssignedCredential } from '../services/credentialService';
import {
    updateClientName,
    updateClientPreferences,
    saveCredentialAcks,
    saveGameProgress,
    submitVikiTvAutomationRequest,
    getVikiTvAutomationStatus,
    type VikiTvAutomationStep,
    type VikiTvAutomationExecutionStatus
} from '../services/clientService';
import {
    Copy, Check, CreditCard, Star, Crown, Sparkles, Loader2,
    RotateCw, Key, Smartphone, Mail, Lock, AlertTriangle, PlusCircle, ArrowRight, Edit3, Fingerprint, ShieldAlert, Palette, Camera, X, CheckCircle2, Upload, Trash2, Clock, Zap, ShoppingBag, ArrowUpRight, RefreshCw, Bell, Calendar, Heart, MessageCircle
} from 'lucide-react';

interface DashboardProps {
    user: User;
    onOpenCheckout: (type: 'renewal' | 'gift' | 'new_sub' | 'early_renewal', targetService?: string) => void;
    showPalette: boolean;
    setShowPalette: (show: boolean) => void;
    onUpdateUser: (updatedUser: User) => void;
    syncTrigger?: number;
    onRefresh?: () => Promise<void>;
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

type VikiTvModel = 'samsung' | 'lg' | 'android';

const VIKI_TV_OPTIONS: { id: VikiTvModel; label: string; url: string }[] = [
    { id: 'samsung', label: 'Samsung TV', url: 'https://www.viki.com/samsungtv' },
    { id: 'lg', label: 'LG TV', url: 'https://www.viki.com/lgtv' },
    { id: 'android', label: 'Android TV', url: 'https://www.viki.com/androidtv' }
];

const normalizeVikiCodeInput = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
const isValidVikiTvCode = (value: string) => /^[a-z0-9]{6}$/.test(value);

type VikiTvUiExecutionStatus = 'idle' | VikiTvAutomationExecutionStatus;
const VIKI_TV_TERMINAL_STATUSES = new Set<VikiTvUiExecutionStatus>(['success', 'failed']);

const getVikiExecutionBadge = (status: VikiTvUiExecutionStatus) => {
    if (status === 'success') return { label: 'Concluida com sucesso', className: 'bg-emerald-100 text-emerald-700' };
    if (status === 'failed') return { label: 'Falha na execucao', className: 'bg-red-100 text-red-700' };
    if (status === 'running') return { label: 'Executando', className: 'bg-blue-100 text-blue-700' };
    if (status === 'queued') return { label: 'Na fila', className: 'bg-amber-100 text-amber-700' };
    return { label: 'Aguardando', className: 'bg-gray-100 text-gray-600' };
};

const getVikiStepBadge = (status: VikiTvAutomationStep['status']) => {
    if (status === 'success') return { label: 'Sucesso', className: 'text-emerald-700 bg-emerald-100' };
    if (status === 'failed') return { label: 'Falha', className: 'text-red-700 bg-red-100' };
    if (status === 'running') return { label: 'Executando', className: 'text-blue-700 bg-blue-100' };
    return { label: 'Pendente', className: 'text-gray-600 bg-gray-100' };
};

type VikiTvFinalFeedbackType = 'none' | 'invalid_code' | 'accepted_code' | 'generic_error';

const VIKI_TV_SUPPORT_WHATSAPP_URL = 'https://wa.me/558894875029?text=Ol%C3%A1!%20Preciso%20de%20assistencia%20na%20conexao%20da%20TV%20na%20Viki.';

const normalizeFeedbackText = (value: string | undefined | null) =>
    String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

const getVikiTvFinalFeedback = (
    executionStatus: VikiTvUiExecutionStatus,
    backendMessage: string | null,
    steps: VikiTvAutomationStep[]
): { type: VikiTvFinalFeedbackType; message: string } => {
    if (!VIKI_TV_TERMINAL_STATUSES.has(executionStatus)) {
        return { type: 'none', message: '' };
    }

    const codeStep = steps.find((step) => step.key === 'code');
    const joinedText = normalizeFeedbackText(
        [backendMessage, codeStep?.details, ...steps.map((step) => step.details || '')]
            .filter(Boolean)
            .join(' ')
    );

    const hasInvalidCodeSignal = /codigo invalido|code is not valid|valid samsung tv code|valid lg tv code|valid android tv code/.test(joinedText);
    if (hasInvalidCodeSignal) {
        return {
            type: 'invalid_code',
            message: 'O codigo que voce inseriu foi invalido. Confira o codigo na TV e tente novamente.'
        };
    }

    const hasAcceptedCodeSignal = /codigo aceito|codigo enviado para vinculacao|vinculacao/.test(joinedText);
    if (executionStatus === 'success' || hasAcceptedCodeSignal) {
        return {
            type: 'accepted_code',
            message: 'Conexao com a TV bem-sucedida.'
        };
    }

    return {
        type: 'generic_error',
        message: 'Nao foi possivel concluir a conexao automaticamente.'
    };
};

const Dashboard: React.FC<DashboardProps> = ({ user, onOpenCheckout, showPalette, setShowPalette, onUpdateUser, syncTrigger = 0, onRefresh }) => {
    const [mergedData, setMergedData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [isEditingName, setIsEditingName] = useState(false);
    const [tempName, setTempName] = useState(user.name);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [credentialUpdates, setCredentialUpdates] = useState<{ name: string, date: string }[]>([]);
    const [showVikiTvModal, setShowVikiTvModal] = useState(false);
    const [activeVikiService, setActiveVikiService] = useState<string>('Viki Pass');
    const [selectedVikiTvModel, setSelectedVikiTvModel] = useState<VikiTvModel | null>(null);
    const [vikiTvCode, setVikiTvCode] = useState('');
    const [vikiTvError, setVikiTvError] = useState<string | null>(null);
    const [vikiTvNotice, setVikiTvNotice] = useState<string | null>(null);
    const [vikiTvBackendMessage, setVikiTvBackendMessage] = useState<string | null>(null);
    const [isSubmittingVikiTv, setIsSubmittingVikiTv] = useState(false);
    const [vikiTvRequestId, setVikiTvRequestId] = useState<string | null>(null);
    const [vikiTvExecutionStatus, setVikiTvExecutionStatus] = useState<VikiTvUiExecutionStatus>('idle');
    const [vikiTvSteps, setVikiTvSteps] = useState<VikiTvAutomationStep[]>([]);
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

    const activeVikiCredential = useMemo(() => {
        const item = mergedData.find(data => data.name === activeVikiService);
        return item?.cred || null;
    }, [activeVikiService, mergedData]);

    const vikiTvFinalFeedback = useMemo(
        () => getVikiTvFinalFeedback(vikiTvExecutionStatus, vikiTvBackendMessage, vikiTvSteps),
        [vikiTvExecutionStatus, vikiTvBackendMessage, vikiTvSteps]
    );

    const vikiTvCurrentStep = useMemo(() => {
        if (vikiTvSteps.length === 0) return null;

        const runningStep = vikiTvSteps.find((step) => step.status === 'running');
        if (runningStep) return runningStep;

        const failedStep = [...vikiTvSteps].reverse().find((step) => step.status === 'failed');
        if (failedStep) return failedStep;

        const pendingStep = vikiTvSteps.find((step) => step.status === 'pending');
        if (pendingStep) return pendingStep;

        const lastSuccessStep = [...vikiTvSteps].reverse().find((step) => step.status === 'success');
        return lastSuccessStep || vikiTvSteps[0];
    }, [vikiTvSteps]);

    const getBgClass = () => {
        switch (user.themeColor) {
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

            const results = await Promise.all(validServices.map(async (raw) => {
                const name = raw.split('|')[0].trim();
                let details = user.subscriptionDetails ? user.subscriptionDetails[name] : null;

                let purchaseDate = details ? new Date(details.purchaseDate) : new Date(user.purchaseDate);
                let duration = details ? (details.durationMonths || 1) : (user.durationMonths || 1);

                const expiryDate = new Date(purchaseDate);
                expiryDate.setDate(purchaseDate.getDate() + (duration * 30));
                const toleranceUntil = details?.toleranceUntil ? new Date(details.toleranceUntil) : null;
                if (toleranceUntil) toleranceUntil.setHours(23, 59, 59, 999);

                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const target = new Date(expiryDate);
                target.setHours(0, 0, 0, 0);

                const diffTime = target.getTime() - now.getTime();
                const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                // Tolerance Logic
                let isInTolerance = false;
                let toleranceDaysLeft = 0;
                if (toleranceUntil && toleranceUntil.getTime() >= now.getTime()) {
                    isInTolerance = true;
                    const diffTol = toleranceUntil.getTime() - now.getTime();
                    toleranceDaysLeft = Math.ceil(diffTol / (1000 * 60 * 60 * 24));
                }

                const result = await getAssignedCredential(user, name);

                const itemIsDebtor = details ? details.isDebtor : false;

                // STRICT BLOCKING: Block if expired > 1 day AND not in tolerance AND not override
                // Tolerance always allows access, even for debtors
                // User can see credentials on expiry day and 1 day after (daysLeft 0, -1)
                const isBlocked = (daysLeft < -1 && !isInTolerance && !user.overrideExpiration);

                // Check for updates
                if (result.credential) {
                    const ackDate = user.gameProgress?._credential_acks?.[name] || '1970-01-01';
                    const pubDate = result.credential.publishedAt || '1970-01-01';
                    const ackTime = new Date(ackDate).getTime();
                    const pubTime = new Date(pubDate).getTime();

                    // CUTOFF: Updates before this date are ignored (to prevent spam for existing users)
                    // Set to roughly the time of deploying this feature: Jan 31, 2026
                    const CUTOFF_TIME = new Date('2026-01-31T03:00:00.000Z').getTime(); // 00:00 BRT

                    console.log(`[UPDATE CHECK] ${name}: pubDate=${pubDate}, ackDate=${ackDate}, isNewer=${pubTime > ackTime}, afterCutoff=${pubTime >= CUTOFF_TIME}`);

                    if (pubTime > ackTime && pubTime >= CUTOFF_TIME) {
                        (result as any).hasNewUpdate = true;
                    }
                }

                return {
                    name,
                    daysLeft,
                    isBlocked,
                    cred: result.credential,
                    alert: result.alert,
                    expiryDate,
                    itemIsDebtor,
                    hasNewUpdate: (result as any).hasNewUpdate,
                    isInTolerance,
                    toleranceDaysLeft
                };
            }));

            const updates = results.filter(r => r.hasNewUpdate && r.cred).map(r => ({ name: r.name, date: r.cred!.publishedAt }));
            if (updates.length > 0) {
                setCredentialUpdates(prev => {
                    const existingNames = new Set(prev.map(p => p.name));
                    // Only add if not already in the list AND not already acknowledged in user data (double check)
                    const newOnes = updates.filter(u => {
                        if (existingNames.has(u.name)) return false;
                        const ackDate = user.gameProgress?._credential_acks?.[u.name] || '1970-01-01';
                        return new Date(u.date).getTime() > new Date(ackDate).getTime();
                    });
                    if (newOnes.length === 0) return prev;
                    return [...prev, ...newOnes];
                });
            }

            setMergedData(results);
            setLoading(false);
            setTimeout(() => setIsSyncing(false), 800);
        };

        if (validServices.length > 0) loadUnifiedData();
        else setLoading(false);
    }, [validServices, user.phoneNumber, user.subscriptionDetails, user.isDebtor, user.name, user.purchaseDate, user.durationMonths, user.overrideExpiration, syncTrigger, user.gameProgress]);

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text.trim());
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const openVikiTvModal = (serviceName: string) => {
        setActiveVikiService(serviceName);
        setSelectedVikiTvModel(null);
        setVikiTvCode('');
        setVikiTvError(null);
        setVikiTvNotice(null);
        setVikiTvBackendMessage(null);
        setIsSubmittingVikiTv(false);
        setVikiTvRequestId(null);
        setVikiTvExecutionStatus('idle');
        setVikiTvSteps([]);
        setShowVikiTvModal(true);
    };

    const closeVikiTvModal = () => {
        setShowVikiTvModal(false);
        setVikiTvError(null);
        setVikiTvNotice(null);
        setVikiTvBackendMessage(null);
        setIsSubmittingVikiTv(false);
        setVikiTvRequestId(null);
        setVikiTvExecutionStatus('idle');
        setVikiTvSteps([]);
    };

    const handleVikiTvCodeChange = (value: string) => {
        setVikiTvCode(normalizeVikiCodeInput(value));
        if (vikiTvError) setVikiTvError(null);
    };

    const handleStartVikiTvFlow = async () => {
        if (isSubmittingVikiTv) return;

        if (!selectedVikiTvModel) {
            setVikiTvError('Selecione o modelo da TV para continuar.');
            return;
        }

        if (!isValidVikiTvCode(vikiTvCode)) {
            setVikiTvError('Informe um codigo valido com 6 caracteres (a-z e 0-9).');
            return;
        }

        const tvOption = VIKI_TV_OPTIONS.find(option => option.id === selectedVikiTvModel);
        if (!tvOption) {
            setVikiTvError('Modelo de TV invalido.');
            return;
        }

        if (!activeVikiCredential?.email || !activeVikiCredential?.password) {
            setVikiTvError('Credencial Viki indisponivel no momento. Tente atualizar a conta.');
            return;
        }

        const submittedAt = new Date().toISOString();
        const initialSteps: VikiTvAutomationStep[] = [
            { key: 'validation', label: 'Validacao dos dados', status: 'success', updatedAt: submittedAt },
            { key: 'request', label: 'Envio da solicitacao de automacao', status: 'running', updatedAt: submittedAt },
            { key: 'login', label: 'Login automatico na Viki', status: 'pending' },
            { key: 'code', label: 'Insercao do codigo informado', status: 'pending' },
            { key: 'logout', label: 'Logout e finalizacao', status: 'pending' }
        ];

        try {
            setIsSubmittingVikiTv(true);
            setVikiTvError(null);
            setVikiTvNotice(null);
            setVikiTvBackendMessage(null);
            setVikiTvExecutionStatus('running');
            setVikiTvSteps(initialSteps);
            setVikiTvRequestId(null);

            const response = await submitVikiTvAutomationRequest({
                phoneNumber: user.phoneNumber,
                clientName: user.name,
                serviceName: activeVikiService,
                tvModel: selectedVikiTvModel,
                tvUrl: tvOption.url,
                tvCode: vikiTvCode,
                credentialEmail: activeVikiCredential.email,
                credentialPassword: activeVikiCredential.password
            });

            setVikiTvRequestId(response.requestId);
            setVikiTvExecutionStatus(response.executionStatus);
            setVikiTvSteps(response.steps && response.steps.length > 0 ? response.steps : initialSteps);
            setVikiTvBackendMessage(response.message);

            const gameProgressUpdate = {
                requestId: response.requestId,
                provider: response.provider,
                submittedAt,
                serviceName: activeVikiService,
                tvModel: selectedVikiTvModel,
                tvUrl: tvOption.url,
                tvCodeMasked: `${vikiTvCode.slice(0, 2)}****`,
                status: response.executionStatus
            };

            await saveGameProgress(user.phoneNumber, '_viki_tv_last_request', gameProgressUpdate);
            const updatedUser = {
                ...user,
                gameProgress: {
                    ...user.gameProgress,
                    _viki_tv_last_request: gameProgressUpdate
                }
            };
            onUpdateUser(updatedUser);

            setVikiTvNotice(`${response.message} ID: ${response.requestId}`);
            setVikiTvError(null);
            setVikiTvCode('');
        } catch (e) {
            console.error('Erro ao iniciar automacao Viki TV:', e);
            setVikiTvError(null);
            setVikiTvBackendMessage('Falha ao iniciar automacao em background.');
            setVikiTvExecutionStatus('failed');
            setVikiTvSteps(prev => prev.length > 0 ? prev.map(step => {
                if (step.key === 'request') {
                    return { ...step, status: 'failed', details: 'Erro no envio da solicitacao', updatedAt: new Date().toISOString() };
                }
                return step;
            }) : [{ key: 'request', label: 'Envio da solicitacao de automacao', status: 'failed', details: 'Erro no envio da solicitacao', updatedAt: new Date().toISOString() }]);
        } finally {
            setIsSubmittingVikiTv(false);
        }
    };

    useEffect(() => {
        if (!showVikiTvModal || !vikiTvRequestId) return;
        if (VIKI_TV_TERMINAL_STATUSES.has(vikiTvExecutionStatus) || vikiTvExecutionStatus === 'idle') return;

        let isActive = true;
        let inFlight = false;
        let timerId: number | undefined;

        const pollStatus = async () => {
            if (!isActive || inFlight) return;
            inFlight = true;

            try {
                const status = await getVikiTvAutomationStatus(vikiTvRequestId);
                if (!isActive) return;
                if (!status) return;

                setVikiTvExecutionStatus(status.executionStatus);
                if (status.steps?.length > 0) setVikiTvSteps(status.steps);
                setVikiTvBackendMessage(status.message);
                setVikiTvNotice(`${status.message} ID: ${status.requestId}`);

                if (status.executionStatus === 'success' || status.executionStatus === 'failed') {
                    setVikiTvError(null);
                }
                if (VIKI_TV_TERMINAL_STATUSES.has(status.executionStatus) && timerId) {
                    isActive = false;
                    window.clearInterval(timerId);
                }
            } finally {
                inFlight = false;
            }
        };

        void pollStatus();
        timerId = window.setInterval(() => {
            void pollStatus();
        }, 5000);

        return () => {
            isActive = false;
            if (timerId) window.clearInterval(timerId);
        };
    }, [showVikiTvModal, vikiTvRequestId, vikiTvExecutionStatus]);

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

    const handleDismissAllUpdates = () => {
        if (credentialUpdates.length === 0) return;

        // 1. Prepare batch update map
        const newAcks: Record<string, string> = {};
        credentialUpdates.forEach(u => {
            newAcks[u.name] = u.date;
        });

        // 2. Clear local state IMMEDIATELY to close modal
        setCredentialUpdates([]);

        // 3. Update User Context (Optimistic)
        const updatedUser = { ...user };
        updatedUser.gameProgress = { ...user.gameProgress };
        if (!updatedUser.gameProgress._credential_acks) updatedUser.gameProgress._credential_acks = {};
        updatedUser.gameProgress._credential_acks = { ...updatedUser.gameProgress._credential_acks, ...newAcks };

        onUpdateUser(updatedUser);

        // 4. Persist to DB
        saveCredentialAcks(user.phoneNumber, newAcks).catch(e => console.error("Failed to save acks:", e));
    };

    return (
        <div className={`${getBgClass()} min-h-screen pb-40 transition-all duration-500`}>
            {/* CREDENTIAL UPDATE MODAL */}
            {credentialUpdates.length > 0 && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-[2rem] p-6 max-w-sm w-full shadow-2xl space-y-4 animate-scale-up">
                        <div className="flex items-center gap-3 text-amber-500">
                            <div className="p-3 bg-amber-100 rounded-full">
                                <Key size={24} className="animate-pulse" />
                            </div>
                            <h3 className="text-lg font-black text-gray-800 leading-none">Emails e Senhas Atualizados!</h3>
                        </div>
                        <div className="text-gray-600 text-sm font-medium space-y-3">
                            <p>As senhas de <strong>{credentialUpdates.map(u => u.name).join(', ')}</strong> foram alteradas recentemente.</p>
                            <p className="bg-amber-50 text-amber-800 p-3 rounded-xl border border-amber-100 font-bold text-xs">
                                ⚠️ Importante: Atualize também o login/senha nos aplicativos (TV, Celular) para continuar assistindo seus doramas desbloqueados e sem anúncios.
                            </p>
                        </div>
                        <button
                            onClick={handleDismissAllUpdates}
                            className="w-full py-3 rounded-xl bg-amber-500 text-white font-black text-sm uppercase tracking-wide shadow-lg shadow-amber-200 active:scale-95 transition-all"
                        >
                            Entendido
                        </button>
                    </div>
                </div>
            )}

            {showVikiTvModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-[2rem] p-6 max-w-md w-full shadow-2xl space-y-4 animate-scale-up">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-black text-gray-800 leading-none">Conexao TV Viki</h3>
                                <p className="text-xs text-gray-500 font-bold uppercase mt-1">{activeVikiService}</p>
                            </div>
                            <button onClick={closeVikiTvModal} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
                                <X size={18} className="text-gray-400" />
                            </button>
                        </div>

                        <div className="space-y-2">
                            <p className="text-[11px] font-black uppercase text-gray-500">1. Escolha o modelo da TV</p>
                            <div className="grid grid-cols-1 gap-2">
                                {VIKI_TV_OPTIONS.map(option => (
                                    <button
                                        key={option.id}
                                        onClick={() => {
                                            setSelectedVikiTvModel(option.id);
                                            setVikiTvError(null);
                                        }}
                                        className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-bold transition-all ${selectedVikiTvModel === option.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <p className="text-[11px] font-black uppercase text-gray-500">2. Informe o codigo da TV</p>
                            <input
                                value={vikiTvCode}
                                onChange={(e) => handleVikiTvCodeChange(e.target.value)}
                                placeholder="ex: aaa000"
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono tracking-wider lowercase text-gray-900 outline-none focus:border-blue-500"
                            />
                            <p className="text-[10px] text-gray-500 font-bold uppercase">Use 6 caracteres: letras minusculas e numeros.</p>
                        </div>

                        <div className="bg-blue-50 rounded-xl p-3 border border-blue-100 space-y-1">
                            <p className="text-[10px] font-black uppercase text-blue-700">Processo 100% automatizado</p>
                            <p className="text-[11px] font-bold text-blue-700">Depois de confirmar, nosso sistema executa login, preenchimento do codigo e logout em background.</p>
                        </div>

                        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] font-black uppercase text-gray-600">Status da automacao</p>
                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${getVikiExecutionBadge(vikiTvExecutionStatus).className}`}>
                                    {getVikiExecutionBadge(vikiTvExecutionStatus).label}
                                </span>
                            </div>
                            {vikiTvRequestId && (
                                <p className="text-[10px] font-mono text-gray-500 break-all">ID: {vikiTvRequestId}</p>
                            )}
                            {vikiTvCurrentStep && (
                                <div className="bg-white border border-gray-100 rounded-lg px-3 py-2 space-y-1">
                                    <p className="text-[10px] font-black uppercase text-gray-500">Etapa atual</p>
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-[11px] font-bold text-gray-700">{vikiTvCurrentStep.label}</p>
                                        <span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase ${getVikiStepBadge(vikiTvCurrentStep.status).className}`}>
                                            {getVikiStepBadge(vikiTvCurrentStep.status).label}
                                        </span>
                                    </div>
                                    {vikiTvCurrentStep.details && (
                                        <p className="text-[10px] text-gray-500 font-semibold">{vikiTvCurrentStep.details}</p>
                                    )}
                                </div>
                            )}
                        </div>

                        {vikiTvError && (
                            <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{vikiTvError}</p>
                        )}
                        {vikiTvFinalFeedback.type === 'none' && vikiTvNotice && (
                            <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3">{vikiTvNotice}</p>
                        )}
                        {vikiTvFinalFeedback.type === 'invalid_code' && (
                            <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">{vikiTvFinalFeedback.message}</p>
                        )}
                        {vikiTvFinalFeedback.type === 'accepted_code' && (
                            <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3">{vikiTvFinalFeedback.message}</p>
                        )}
                        {vikiTvFinalFeedback.type === 'generic_error' && (
                            <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-3">
                                <p className="text-xs font-bold text-red-700">{vikiTvFinalFeedback.message}</p>
                                <a
                                    href={VIKI_TV_SUPPORT_WHATSAPP_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wide transition-colors"
                                >
                                    <MessageCircle size={14} />
                                    Falar com assistencia no WhatsApp
                                </a>
                            </div>
                        )}

                        <button
                            onClick={handleStartVikiTvFlow}
                            disabled={isSubmittingVikiTv}
                            className={`w-full py-3 rounded-xl text-white font-black text-sm uppercase tracking-wide shadow-lg active:scale-95 transition-all ${isSubmittingVikiTv ? 'bg-blue-300 shadow-blue-100' : 'bg-blue-600 shadow-blue-200'}`}
                        >
                            {isSubmittingVikiTv ? 'Iniciando automacao...' : 'Iniciar conexao automatica'}
                        </button>
                    </div>
                </div>
            )}

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
                            ) : user.profileImage ? (
                                <img src={user.profileImage} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-2xl font-black text-pink-500">
                                    {(user.name || 'D').trim().charAt(0).toUpperCase()}
                                </span>
                            )}
                        </div>
                        <div className="absolute bottom-0 right-0 bg-pink-600 text-white p-2 rounded-full shadow-lg border-2 border-white">
                            <Camera size={14} />
                        </div>
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            {isEditingName ? (
                                <input autoFocus className="bg-white border border-pink-300 rounded-lg px-2 py-1 text-sm font-bold outline-none w-32 text-gray-900" value={tempName} onChange={(e) => setTempName(e.target.value)} onBlur={handleEditName} onKeyDown={(e) => e.key === 'Enter' && handleEditName()} />
                            ) : (
                                <h2 className={`text-2xl font-black tracking-tight leading-none truncate ${getTextColorClass()}`}>
                                    {user.name}
                                </h2>
                            )}
                            <button onClick={handleEditName} className="p-1 text-gray-400 hover:text-pink-600 transition-colors"><Edit3 size={16} /></button>
                        </div>
                        <div className="flex items-center gap-2 mt-2.5 flex-wrap">

                            {/* BOTÃO ATUALIZAR */}
                            <button
                                onClick={async () => {
                                    if (onRefresh && !isRefreshing) {
                                        setIsRefreshing(true);
                                        await onRefresh();
                                        setIsRefreshing(false);
                                    }
                                }}
                                disabled={isRefreshing}
                                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border bg-white shadow-sm transition-all active:scale-95 ${isRefreshing ? 'border-pink-200 text-pink-400' : 'border-pink-100 text-pink-600 hover:bg-pink-50 hover:border-pink-300'}`}
                            >
                                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                                <span className="text-[11px] font-black uppercase tracking-wide">{isRefreshing ? 'Atualizando...' : 'Atualizar informações da conta'}</span>
                            </button>
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
                                    <p className="text-xs font-black uppercase tracking-widest text-white/80">
                                        Atenção {user.name.split(' ')[0]}!
                                    </p>
                                    <h3 className="text-xl font-black">
                                        {expiringServices.length === 1
                                            ? `1 assinatura ${expiringServices[0].daysLeft < 0 ? 'vencida' : 'próxima do vencimento'}`
                                            : `${expiringServices.length} ${expiringServices.some(s => s.daysLeft < 0) ? 'assinaturas pendentes' : 'renovações próximas'}`
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
                                        <span className="text-[9px] font-black text-yellow-950 uppercase flex items-center justify-center gap-1"><Clock size={10} /> Vencimento Próximo!</span>
                                    </div>
                                )}
                                {item.daysLeft < 0 && !item.isInTolerance && (
                                    <div className="absolute top-0 right-0 left-0 bg-red-600 py-1 text-center">
                                        <span className="text-[9px] font-black text-white uppercase flex items-center justify-center gap-1"><AlertTriangle size={10} /> ASSINATURA VENCIDA</span>
                                    </div>
                                )}
                                {item.isInTolerance && (
                                    <div className="absolute top-0 right-0 left-0 bg-indigo-500 py-1 text-center animate-pulse">
                                        <span className="text-[9px] font-black text-white uppercase flex items-center justify-center gap-1"><ShieldAlert size={10} /> EM TOLERÂNCIA (+{item.toleranceDaysLeft}d)</span>
                                    </div>
                                )}
                                {item.isBlocked && (
                                    <div className="absolute top-0 right-0 left-0 bg-red-600 py-1 text-center">
                                        <span className="text-[9px] font-black text-white uppercase flex items-center justify-center gap-1"><ShieldAlert size={10} /> ACESSO SUSPENSO</span>
                                    </div>
                                )}

                                <div className={`flex justify-between items-start mb-6 ${(item.daysLeft <= 5 || item.isBlocked || (item.daysLeft < 0 && item.daysLeft >= -3)) ? 'mt-4' : ''}`}>
                                    <div className="flex items-center gap-4">
                                        <div className={`w-14 h-14 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-lg ring-4 ring-pink-50`}>{item.name[0]}</div>
                                        <div>
                                            <h3 className="font-black text-gray-800 text-lg leading-none">{item.name}</h3>
                                            <div className="flex flex-col gap-1 mt-1.5">
                                                <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-black uppercase w-fit ${item.isInTolerance ? 'bg-indigo-100 text-indigo-700' : (item.daysLeft < 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700')}`}>
                                                    {item.isInTolerance ? `Em Tolerância (${item.toleranceDaysLeft}d)` : (item.daysLeft < 0 ? `Vencido há ${Math.abs(item.daysLeft)} ${Math.abs(item.daysLeft) === 1 ? 'dia' : 'dias'}` : `${item.daysLeft} dias restantes`)}
                                                </span>
                                                {item.cred?.publishedAt && (
                                                    <span className="flex items-center gap-1 text-[9px] font-bold text-gray-400 uppercase">
                                                        <Calendar size={10} />
                                                        Atualizado em {new Date(item.cred.publishedAt).toLocaleDateString()}
                                                    </span>
                                                )}
                                            </div>
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
                                        {!item.isBlocked && <button onClick={() => item.cred && copyToClipboard(item.cred.email, `e-${i}`)} className="p-3 text-indigo-600 bg-white border border-gray-100 rounded-xl shadow-sm active:scale-90 flex items-center gap-1"><Copy size={14} /><span className="text-[10px] font-black uppercase">Copiar</span></button>}
                                    </div>
                                    <div className="bg-gray-50 p-4 rounded-[1.5rem] border border-gray-100 flex justify-between items-center group">
                                        <div className="flex flex-col min-w-0 flex-1 text-gray-800">
                                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Senha</span>
                                            <span className={`font-mono font-bold tracking-widest transition-all duration-500 ${item.isBlocked ? 'text-red-300 blur-[8px] select-none' : 'text-gray-700'}`}>
                                                {item.isBlocked ? '••••••••' : (item.cred?.password || '••••••')}
                                            </span>
                                        </div>
                                        {!item.isBlocked && <button onClick={() => item.cred && copyToClipboard(item.cred.password, `p-${i}`)} className="p-3 text-indigo-600 bg-white border border-gray-100 rounded-xl shadow-sm active:scale-90 flex items-center gap-1"><Copy size={14} /><span className="text-[10px] font-black uppercase">Copiar</span></button>}
                                    </div>
                                </div>

                                {item.name.toLowerCase().includes('viki') && !item.isBlocked && (
                                    <div className="mt-4 bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-[10px] font-black uppercase text-blue-700">Conexao de TV Viki</p>
                                            <p className="text-[10px] font-bold text-blue-600 mt-1">Informe modelo e codigo da TV. O restante roda automatico em background.</p>
                                        </div>
                                        <button
                                            onClick={() => openVikiTvModal(item.name)}
                                            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase whitespace-nowrap shadow-md active:scale-95"
                                        >
                                            Conectar TV
                                        </button>
                                    </div>
                                )}

                                {item.daysLeft < 0 && !item.isInTolerance && !item.isBlocked && (
                                    <div className="mt-4 bg-orange-50 p-3 rounded-2xl border border-orange-100 flex items-center gap-3">
                                        <AlertTriangle className="text-orange-500 shrink-0" size={16} />
                                        <p className="text-[9px] font-bold text-orange-800 uppercase leading-tight">Sua assinatura venceu. Renove agora para recuperar o acesso.</p>
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

                        <div className="pt-10 pb-4 space-y-6">
                            <div className="flex items-center gap-3 px-1">
                                <div className="p-2 bg-pink-100 rounded-xl text-pink-600"><Heart size={20} /></div>
                                <div>
                                    <h4 className="text-lg font-black text-gray-800 leading-none">Nos Ajude</h4>
                                    <p className="text-xs text-gray-400 font-bold uppercase mt-1">Otimização Contínua</p>
                                </div>
                            </div>

                            <div className="relative overflow-hidden bg-gradient-to-br from-rose-500 to-pink-600 p-6 rounded-[2.5rem] text-white shadow-xl group transition-all hover:-translate-y-1">
                                <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                                    <Heart size={120} />
                                </div>
                                <div className="relative z-10 space-y-4">
                                    <div className="flex justify-between items-start">
                                        <div className="bg-white/20 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                                            Contribuição
                                        </div>
                                        <Sparkles size={24} className="text-yellow-300 fill-yellow-300 animate-pulse" />
                                    </div>
                                    <div>
                                        <h5 className="text-2xl font-black">Apoie o Projeto</h5>
                                        <p className="text-sm font-medium text-white/80 mt-1">
                                            Sua ajuda financeira de qualquer valor é essencial para mantermos o sistema online e com melhorias constantes.
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => onOpenCheckout('gift', 'Donation')}
                                        className="bg-white text-gray-900 px-6 py-3 rounded-2xl font-black text-xs uppercase flex items-center gap-2 shadow-lg active:scale-95 transition-all w-fit"
                                    >
                                        Contribuir <ArrowRight size={14} />
                                    </button>
                                </div>
                            </div>

                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
