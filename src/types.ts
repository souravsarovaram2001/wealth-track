export type Broker = 'Zerodha' | 'Zerodha Coin' | 'Upstox' | 'Fyers' | 'Angel One' | 'Groww' | 'ICICI Direct' | 'HDFC Securities' | 'Kotak Securities';
export type TradeStatus = 'Active' | 'Sold' | 'Pending Link';
export type MarketCap = 'Smallcap' | 'Midcap' | 'Largecap' | 'N/A';
export type AssetType = 'Stock' | 'Mutual Fund' | 'ETF' | 'Bond';

export type PayoutFrequency = 'Monthly' | 'Quarterly' | 'Semi-Annually' | 'Annually';

export interface BondPayout {
  id: string;
  date: string;
  amount: number;
  status: 'Pending' | 'Received';
}

export interface Bond {
  id?: string;
  uid?: string;
  name: string;
  principal: number;
  interestRate: number; // Annual rate in percentage
  frequency: PayoutFrequency;
  purchaseDate: string;
  maturityDate?: string;
  payoutSchedule?: BondPayout[];
  accruedInterest?: number;
  lastPayoutDate?: string;
  status: 'Active' | 'Exited';
  exitDate?: string;
  redemptionAmount?: number;
  broker?: Broker;
}

export interface Trade {
  id?: string;
  stockName: string; // This will be the display name of the stock, MF, or ETF
  stockSymbol: string; // This will be the actual ticker/symbol for price fetching
  symbol?: string; // Compatibility field for external data mapping
  stock?: string;  // Compatibility field for external data mapping
  type: AssetType;
  entryDate: string;
  entryPrice: number;
  quantity: number;
  charges: number;
  interest: number;
  exitDate?: string;
  exitPrice?: number;
  status: TradeStatus;
  sector: string;
  marketCap: MarketCap;
  marketCapValue?: number;
  broker: Broker;
  targetPrice: number;
  lastKnownPrice?: number;
  lastPriceUpdate?: string;
  beta?: number;
  uid?: string;
  remarks?: string;
  sipId?: string;
}

export interface SIP {
  id?: string;
  uid?: string;
  stockName: string;
  stockSymbol: string;
  installmentAmount: number;
  startDate: string;
  dayOfMonth: number;
  frequency: 'Monthly';
  status: 'Active' | 'Paused' | 'Completed';
  lastProcessedDate?: string;
  type?: AssetType;
  initialInvestment?: number;
  stepUpType?: 'Percentage' | 'Fixed' | 'None';
  stepUpValue?: number;
}

export interface LedgerEntry {
  id?: string;
  date: string;
  broker: Broker;
  amount: number;
  type: 'Deposit' | 'Withdrawal';
}

export interface Dividend {
  id?: string;
  stockName: string;
  month: string; // YYYY-MM
  amount: number;
  date?: string; // Specific payment date
}

export interface CorporateAction {
  id?: string;
  uid?: string;
  tradeId: string;
  stockSymbol: string;
  stockName: string;
  type: 'Dividend' | 'Split' | 'Bonus' | 'Merger';
  date: string;
  value: number; // Dividend amount per share, or Split ratio
  ratio?: string; // e.g. "1:2"
  status: 'Detected' | 'Applied';
  description: string;
}

export interface PortfolioStats {
  totalInvested: number;
  totalRealizedProfit: number;
  stockRealizedProfit?: number;
  bondCapitalGain?: number;
  totalUnrealizedProfit: number;
  stockUnrealizedProfit: number;
  bondAccruedProfit: number;
  totalDividends: number;
  totalBondInterest?: number; 
  totalCharges: number;
  totalCurrentValue: number;
  // FY specific stats
  fyRealizedProfit?: number;
  fyDividends?: number;
  fyBondInterest?: number;
  fyBondAccrued?: number;
}

export interface ProcessedPortfolioEntry {
  id: string;
  symbol: string;
  name: string;
  type: AssetType;
  quantity: number;
  entryPrice: number;
  investment: number;
  currentPrice: number;
  currentValue: number;
  sector: string;
  marketCap: string;
  isSIP: boolean;
  pnl: number;
  pnlPercent: number;
  entryDate: string;
  beta?: number;
}

export interface HoldingStrategy {
  id?: string;
  uid?: string;
  name: string;
  description?: string;
  targetPercentage?: number;
  color?: string;
  stockSymbols: string[]; // List of stock symbols assigned to this strategy
  createdAt?: string;
}

