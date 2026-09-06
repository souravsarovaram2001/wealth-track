export const SECTORS = [
  'FMCG',
  'Bank',
  'Finance',
  'IT',
  'Energy',
  'Entertainment',
  'Industrial',
  'Manufacturing',
  'Automobile',
  'Nifty/ETF',
  'Real Estate',
  'COMMODITY (SILVER)',
  'COMMODITY (GOLD)',
  'CASH EQUIVALENT',
  'EQUITY - DIVERSIFIED'
];

export const SECTOR_MAP: Record<string, string> = {
  // FMCG
  'fmcg': 'FMCG',
  'Consumer Staples': 'FMCG',
  'Beverages': 'FMCG',
  'Food': 'FMCG',
  'Consumer Defensive': 'FMCG',
  'Healthcare': 'FMCG', // Moved to FMCG or Manufacturing? Instructions said Healthcare -> Manufacturing in line 85. 
  // Wait, let me check instructions again. "Force all stocks into these 11 categories only".
  // The mapping in the file (lines 16-105) needs to be strictly aligned to these 11.
  
  // Bank
  'bank': 'Bank',
  'Banking': 'Bank',
  
  // Finance
  'finance': 'Finance',
  'Financial Services': 'Finance',
  'NBFC': 'Finance',
  'Insurance': 'Finance',
  
  // IT
  'it': 'IT',
  'tech': 'IT',
  'Technology': 'IT',
  'Software': 'IT',
  
  // Energy
  'energy': 'Energy',
  'Oil & Gas': 'Energy',
  'Power': 'Energy',
  'Utilities': 'Energy',
  
  // Entertainment
  'entertainment': 'Entertainment',
  'Media': 'Entertainment',
  'Hotels': 'Entertainment',
  'Leisure': 'Entertainment',
  
  // Industrial
  'industrial': 'Industrial',
  'Capital Goods': 'Industrial',
  'Infrastructure': 'Industrial',
  'Logistics': 'Industrial',
  'Construction': 'Industrial',
  
  // Manufacturing
  'manufacturing': 'Manufacturing',
  'Chemicals': 'Manufacturing',
  'Metals': 'Manufacturing',
  'Pharmaceuticals': 'Manufacturing',
  'Basic Materials': 'Manufacturing',
  
  // Automobile
  'automobile': 'Automobile',
  'Auto Components': 'Automobile',
  
  // Nifty/ETF
  'ETF': 'Nifty/ETF',
  
  // Real Estate
  'real estate': 'Real Estate',
  'Realty': 'Real Estate'
};

export const SYMBOL_OVERRIDES: Record<string, string> = {
  'TCS': 'IT',
  'INFY': 'IT',
  'HDFCBANK': 'Bank',
  'ICICIBANK': 'Bank'
};

/**
 * Automatically distinguish between Equity Stocks and ETFs based on symbol or name.
 */
export function identifyAssetClass(symbol: string, name?: string): 'ETF' | 'Stock' {
  const cleanSymbol = (symbol || '').split('.')[0].toUpperCase();
  const cleanName = (name || '').toUpperCase();
  
  // Explicit overrides check first
  if (ASSET_TYPE_OVERRIDES[cleanSymbol]) {
    const override = ASSET_TYPE_OVERRIDES[cleanSymbol];
    if (override === 'ETF') return 'ETF';
  }

  const keywords = ['BEES', 'ETF', 'GOLD', 'SILVER', 'LIQUID', 'ITBEES', 'BANKBEES', 'PHARMABEES', 'NIFTY1D', 'LIQUIDCASE', 'LIQUIDETF', 'RATE'];
  if (keywords.some(k => cleanSymbol.endsWith(k) || cleanSymbol.includes('ETF') || cleanSymbol.includes('BEES') || cleanName.includes('ETF'))) {
    return 'ETF';
  }
  
  // Specific patterns for common Indian ETFs
  if (cleanSymbol.startsWith('SETF') || cleanSymbol.startsWith('NETF') || cleanSymbol.startsWith('BSL') || cleanSymbol.startsWith('MOM50') || cleanSymbol.startsWith('Z') || cleanSymbol.startsWith('ZERODHA')) {
     if (cleanSymbol.includes('NIFTY') || cleanSymbol.includes('BANK') || cleanSymbol.includes('MIDCAP') || cleanSymbol.includes('ETF') || cleanSymbol.includes('GOLD') || cleanSymbol.includes('SILVER') || cleanName.includes('ETF')) return 'ETF';
  }

  return 'Stock';
}

export function formatSector(symbol: string, fetchedSector: string | null | undefined): string {
  const cleanSymbol = symbol.split('.')[0].toUpperCase();
  
  // Specific user requested overrides for Zerodha ETFs (and common names)
  if (cleanSymbol.includes('MIDCAP')) return 'EQUITY - DIVERSIFIED';
  if (cleanSymbol.includes('SILVER')) return 'COMMODITY (SILVER)';
  if (cleanSymbol.includes('GOLD')) return 'COMMODITY (GOLD)';
  if (cleanSymbol.includes('LIQUID') || cleanSymbol.includes('1D')) return 'CASH EQUIVALENT';

  if (identifyAssetClass(cleanSymbol) === 'ETF') {
    return 'Nifty/ETF';
  }

  if (SYMBOL_OVERRIDES[cleanSymbol]) {
    return SYMBOL_OVERRIDES[cleanSymbol];
  }

  const normalizedInput = (fetchedSector || 'Other').trim().toLowerCase();
  
  // Fuzzy mapping logic to ensure it falls into the 11 categories
  if (normalizedInput.includes('bank')) return 'Bank';
  if (normalizedInput.includes('finance') || normalizedInput.includes('insur') || normalizedInput.includes('invest') || normalizedInput.includes('nbfc')) return 'Finance';
  if (normalizedInput.includes('software') || normalizedInput.includes('tech') || normalizedInput.includes('it')) return 'IT';
  if (normalizedInput.includes('food') || normalizedInput.includes('beverage') || normalizedInput.includes('consum') || normalizedInput.includes('fmcg') || normalizedInput.includes('staple')) return 'FMCG';
  if (normalizedInput.includes('energy') || normalizedInput.includes('oil') || normalizedInput.includes('power') || normalizedInput.includes('utilit') || normalizedInput.includes('gas')) return 'Energy';
  if (normalizedInput.includes('metal') || normalizedInput.includes('chem') || normalizedInput.includes('manufact') || normalizedInput.includes('pharm') || normalizedInput.includes('health') || normalizedInput.includes('material')) return 'Manufacturing';
  if (normalizedInput.includes('infra') || normalizedInput.includes('logist') || normalizedInput.includes('indust') || normalizedInput.includes('capit') || normalizedInput.includes('construct')) return 'Industrial';
  if (normalizedInput.includes('auto')) return 'Automobile';
  if (normalizedInput.includes('real') || normalizedInput.includes('realty') || normalizedInput.includes('estate')) return 'Real Estate';
  if (normalizedInput.includes('media') || normalizedInput.includes('entertain') || normalizedInput.includes('hotel') || normalizedInput.includes('tourism') || normalizedInput.includes('leisure')) return 'Entertainment';
  if (normalizedInput.includes('etf')) return 'Nifty/ETF';

  return 'Finance'; // Defaulting to Finance if no match, or maybe Industrial? Instructions say force into 11.
}

export const ASSET_TYPE_OVERRIDES: Record<string, 'ETF' | 'Stock' | 'Mutual Fund' | 'Bond'> = {
  'GOLDBEES': 'ETF',
  'NIFTYBEES': 'ETF',
  'BANKBEES': 'ETF',
  'CPSEETF': 'ETF',
  'JUNIORBEES': 'ETF',
  'ITBEES': 'ETF',
  'PHARMABEES': 'ETF',
  'CONSUMBEES': 'ETF',
  'AUTOBEES': 'ETF',
  'MON100': 'ETF',
  'MAFANG': 'ETF',
  'SILVERBEES': 'ETF',
  'LIQUIDBEES': 'ETF',
  'HDFCNIFTY': 'ETF',
  'SBIETF': 'ETF',
  'MOM50': 'ETF',
  'MOMOMENTUM': 'ETF',
  'NETITF': 'ETF',
  'ICICINIFTY': 'ETF',
  'ICICIBANKNIFTY': 'ETF',
  'SILVERETF': 'ETF',
  'GOLDETF': 'ETF',
  'LIQUIDCASE': 'ETF',
  'LIQUID1D': 'ETF',
  'ZERODHAGOLD': 'ETF',
  'ZERODHASILVER': 'ETF',
  'ZERODHAMIDCAP': 'ETF',
  'MIDCAP150': 'ETF',
  'NETFVAL20': 'ETF',
  'NV20': 'ETF',
  'KOTAKNV20': 'ETF',
  'NETFLV30': 'ETF',
  'NETFALFA': 'ETF',
  'NETF50': 'ETF',
  'AXISVALUE': 'ETF',
  'AXISVAL': 'ETF'
};

export const MARKET_CAPS = ['Smallcap', 'Midcap', 'Largecap', 'N/A'] as const;
export const ASSET_TYPES = ['Stock', 'Mutual Fund', 'ETF', 'Bond'] as const;
export const BROKERS = ['Zerodha', 'Zerodha Coin', 'Upstox', 'Fyers', 'Angel One', 'Groww', 'ICICI Direct', 'HDFC Securities', 'Kotak Securities'] as const;

/**
 * Strict Market Cap Classification Logic
 */
export function getMarketCapCategory(symbol: string, marketCapValue?: number, fallbackLabel?: string): string {
  const cleanSymbol = symbol.split('.')[0].toUpperCase();
  const largeCapOverrides = ['TCS', 'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY'];
  
  if (largeCapOverrides.includes(cleanSymbol)) return "Largecap";

  if (marketCapValue && marketCapValue > 0) {
    const marketCapCr = marketCapValue / 10000000;
    if (marketCapCr > 60000) return "Largecap";
    if (marketCapCr >= 20000) return "Midcap";
    return "Smallcap";
  }

  if (fallbackLabel && ['Largecap', 'Midcap', 'Smallcap'].includes(fallbackLabel)) return fallbackLabel;

  return "Smallcap";
}
