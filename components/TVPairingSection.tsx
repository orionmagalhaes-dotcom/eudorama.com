import React, { useMemo, useState } from 'react';
import { Wifi, X, CheckCircle2 } from 'lucide-react';

interface TVPairingSectionProps {
  vikiEmail: string;
  vikiPassword: string;
  onClose?: () => void;
}

const TVPairingSection: React.FC<TVPairingSectionProps> = ({ vikiEmail, vikiPassword, onClose }) => {
  const [brand, setBrand] = useState<'samsung' | 'lg'>('samsung');
  const [tvCode, setTvCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const baseUrl = import.meta.env.VITE_VIKI_SERVER_URL || `http://${window.location.hostname}:4010`;

  const canSubmit = useMemo(() => {
    return Boolean(vikiEmail && vikiPassword && tvCode.length === 6 && !loading);
  }, [vikiEmail, vikiPassword, tvCode, loading]);

  const handleCodeChange = (value: string) => {
    const normalized = value.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6);
    setTvCode(normalized);
  };

  const handlePair = async () => {
    if (!canSubmit) return;

    setLoading(true);
    setDone(false);
    setError(null);

    try {
      const response = await fetch(`${baseUrl}/api/viki/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viki_email: vikiEmail,
          viki_password: vikiPassword,
          tv_brand: brand,
          tv_code: tvCode
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const stage = data?.stage ? ` [${data.stage}]` : '';
        const detail = data?.detail ? ` (${data.detail})` : '';
        setError(`${data?.error || 'Nao foi possivel vincular a TV agora.'}${stage}${detail}`);
        return;
      }

      setDone(true);
      setTvCode('');
    } catch {
      setError('Servidor de vinculacao offline. Execute: npm run viki-server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white w-full max-w-md rounded-[2.5rem] p-6 relative">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-10 h-10 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center active:scale-95 transition-transform"
          aria-label="Fechar"
        >
          <X size={16} />
        </button>
      )}

      <div className="space-y-5">
        <div>
          <h3 className="text-xl font-black text-gray-900">Vincular Rakuten Viki na {brand === 'lg' ? 'LG TV' : 'Samsung TV'}</h3>
          <p className="text-sm text-gray-500 font-medium mt-1">Digite o codigo de 6 caracteres (letras minusculas e numeros) exibido na TV e clique em Vincular TV.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setBrand('samsung')}
            disabled={loading}
            className={`py-3 rounded-2xl font-black text-xs uppercase tracking-widest border ${
              brand === 'samsung' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200'
            } disabled:opacity-60`}
          >
            Samsung
          </button>
          <button
            onClick={() => setBrand('lg')}
            disabled={loading}
            className={`py-3 rounded-2xl font-black text-xs uppercase tracking-widest border ${
              brand === 'lg' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200'
            } disabled:opacity-60`}
          >
            LG
          </button>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            value={tvCode}
            onChange={(e) => handleCodeChange(e.target.value)}
            placeholder="Codigo da TV (6 caracteres)"
            maxLength={6}
            className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>

        <button
          onClick={handlePair}
          disabled={!canSubmit}
          className="w-full bg-indigo-600 text-white py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-md active:scale-95 transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
        >
          <Wifi size={14} />
          {loading ? 'Vinculando...' : 'Vincular TV'}
        </button>

        {done && (
          <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold">
            <CheckCircle2 size={16} /> TV vinculada com sucesso.
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-700 text-xs font-bold rounded-2xl px-4 py-3">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default TVPairingSection;
