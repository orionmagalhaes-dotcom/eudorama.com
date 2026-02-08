/**
 * Configuração centralizada de preços das assinaturas.
 * 
 * Reajuste de preços a partir de 01/03/2026:
 * - Viki Pass: R$ 19,90 → R$ 24,90
 * - IQIYI: R$ 14,90 → R$ 19,90
 * - Kocowa+, DramaBox, Youku, WeTV: R$ 14,90 → R$ 16,90
 */

// Data de início dos novos preços: 01 de Março de 2026
export const PRICE_ADJUSTMENT_DATE = new Date('2026-03-01T00:00:00-03:00');

// Preços ANTES de 01/03/2026
const PRICES_BEFORE = {
  viki: 19.90,
  iqiyi: 14.90,
  others: 14.90
};

// Preços A PARTIR de 01/03/2026
const PRICES_AFTER = {
  viki: 24.90,
  iqiyi: 19.90,
  others: 16.90
};

/**
 * Retorna o preço mensal de um serviço baseado na data atual.
 * @param serviceName Nome do serviço (ex: 'Viki Pass', 'IQIYI')
 * @param duration Duração em meses (se > 1, retorna 0 - planos longos não são cobrados mensalmente)
 * @returns Preço mensal em reais
 */
export const getServicePrice = (serviceName: string, duration: number): number => {
  // Planos com duração > 1 mês são pré-pagos, não cobram mensalmente
  if (duration > 1) return 0.00;

  const now = new Date();
  const isAfterAdjustment = now >= PRICE_ADJUSTMENT_DATE;
  const prices = isAfterAdjustment ? PRICES_AFTER : PRICES_BEFORE;

  const s = serviceName.toLowerCase();
  
  if (s.includes('viki')) {
    return prices.viki;
  }
  
  if (s.includes('iqiyi') || s.includes('iqyi')) {
    return prices.iqiyi;
  }
  
  // Kocowa+, DramaBox, Youku, WeTV e outros
  return prices.others;
};

/**
 * Retorna todos os preços atuais para exibição.
 */
export const getCurrentPrices = () => {
  const now = new Date();
  const isAfterAdjustment = now >= PRICE_ADJUSTMENT_DATE;
  return isAfterAdjustment ? PRICES_AFTER : PRICES_BEFORE;
};

/**
 * Verifica se o reajuste já está em vigor.
 */
export const isPriceAdjustmentActive = () => {
  return new Date() >= PRICE_ADJUSTMENT_DATE;
};
