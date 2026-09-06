import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PortfolioStats, Trade, Dividend, LedgerEntry, Bond, ProcessedPortfolioEntry } from '@/src/types';
import { formatSector, getMarketCapCategory, identifyAssetClass } from '@/src/constants';
import { addMonths, isAfter, isBefore } from 'date-fns';
import axios from 'axios';
import { RefreshCw, Landmark, PlusCircle, TrendingUp, ChevronRight, Clock, ArrowUpRight, PieChart as PieIcon, BarChart3, Target } from 'lucide-react';
import { calculateXIRR } from '@/src/lib/xirr';
import { calculateAccruedInterest } from '@/src/lib/bondUtils';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Sector, SectorProps } from 'recharts';
import { motion, AnimatePresence } from 'motion/react';

interface DashboardProps {
  stats: PortfolioStats;
  trades: Trade[];
  dividends: Dividend[];
  ledger: LedgerEntry[];
  bonds: Bond[];
  processedPortfolio: ProcessedPortfolioEntry[];
  onLoadSampleData?: () => void;
  onAddMore?: (symbol: string, name: string, type: string) => void;
  lastUpdated?: Date | null;
  overallXIRR: number | null;
  activeXIRR: number | null;
  realizedXIRR: number | null;
  currentPrices: Record<string, number>;
}

const COLORS = [
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#6366f1', // Indigo
  '#84cc16', // Lime
  '#475569', // Slate
];

const CHART_GRADIENTS = [
  ['#3b82f6', '#2563eb'],
  ['#10b981', '#059669'],
  ['#f59e0b', '#d97706'],
  ['#ef4444', '#dc2626'],
  ['#8b5cf6', '#7c3aed'],
  ['#06b6d4', '#0891b2'],
];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const value = payload[0].value;
    const name = payload[0].name;
    const fill = payload[0].fill;

    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 5 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-white/20 dark:border-zinc-800/50 p-3 sm:p-4 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.2)] ring-1 ring-black/5 min-w-[160px] sm:min-w-[180px]"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.1)]" style={{ backgroundColor: fill }} />
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">{name}</p>
          </div>
          <Badge variant="outline" className="text-[9px] font-black px-1.5 h-4 bg-primary/5 text-primary border-primary/20">
            {data.percent}%
          </Badge>
        </div>
        <div className="space-y-0.5">
          <p className="text-xl font-black text-foreground">₹{value.toLocaleString()}</p>
          <p className="text-[9px] font-bold text-muted-foreground/60 italic tracking-tight">Contributing {data.percent}% to total sector value</p>
        </div>
        {data.assets && data.assets.length > 0 && (
          <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/50">
            <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Top Assets</p>
            <div className="flex flex-wrap gap-1">
              {data.assets.slice(0, 3).map((asset: string, i: number) => (
                <span key={i} className="text-[8px] font-bold px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-md text-zinc-600 dark:text-zinc-400">
                  {asset}
                </span>
              ))}
              {data.assets.length > 3 && (
                <span className="text-[8px] font-bold text-zinc-400">+{data.assets.length - 3} more</span>
              )}
            </div>
          </div>
        )}
      </motion.div>
    );
  }
  return null;
};

const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius - 2}
        outerRadius={innerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    </g>
  );
};

export function Dashboard({ 
  stats, 
  trades, 
  dividends, 
  ledger, 
  bonds, 
  processedPortfolio, 
  onLoadSampleData, 
  onAddMore, 
  lastUpdated, 
  overallXIRR, 
  activeXIRR, 
  realizedXIRR, 
  currentPrices
}: DashboardProps) {
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [selectedDrillDown, setSelectedDrillDown] = useState<{ title: string, category: string, stocks: any[] } | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [mcActiveIndex, setMcActiveIndex] = useState<number | null>(null);
  const [sectorActiveIndex, setSectorActiveIndex] = useState<number | null>(null);

  const combinedHoldings = useMemo(() => {
    const holdings = [...processedPortfolio];
    
    // Add active bonds to dashboard combined view
    bonds.filter(b => b.status === 'Active' || !b.status).forEach(b => {
      const accrued = calculateAccruedInterest(b);
      const investment = Number(b.principal);
      const currentValue = investment + accrued;
      
      holdings.push({
        id: b.id!,
        symbol: b.name,
        name: b.name,
        type: 'Bond',
        quantity: 1,
        entryPrice: investment,
        investment: investment,
        currentPrice: currentValue,
        currentValue: currentValue,
        sector: 'Fixed Income',
        marketCap: 'Fixed Income',
        isSIP: false,
        pnl: accrued,
        pnlPercent: investment > 0 ? (accrued / investment) * 100 : 0,
        entryDate: b.purchaseDate
      });
    });
    
    return holdings;
  }, [processedPortfolio, bonds]);

  const unrealizedProfit = combinedHoldings.reduce((acc, t) => acc + (t.currentValue - t.investment), 0);

  // Sector distribution
  const sectorData = useMemo(() => {
    const rawData = combinedHoldings.reduce((acc: any[], entry) => {
      // Show sector distribution for STOCKS ONLY
      if (entry.sector === 'CASH EQUIVALENT' || entry.type !== 'Stock') return acc;

      const masterSector = entry.sector;
      const existing = acc.find(i => i.name === masterSector);
      
      if (existing) {
        existing.value += entry.currentValue;
        if (!existing.assets.includes(entry.name)) {
          existing.assets.push(entry.name);
        }
      } else {
        acc.push({ 
          name: masterSector, 
          value: entry.currentValue, 
          assets: [entry.name],
          subSectors: []
        });
      }
      return acc;
    }, []);

    const sortedData = rawData.sort((a, b) => b.value - a.value);
    
    if (sortedData.length > 15) {
      const top14 = sortedData.slice(0, 14);
      const others = sortedData.slice(14);
      const othersValue = others.reduce((acc, curr) => acc + curr.value, 0);
      const othersAssets = others.reduce((acc, curr) => [...acc, ...curr.assets], []);
      
      return [...top14, { name: 'Other', value: othersValue, assets: othersAssets, subSectors: [] }];
    }

    return sortedData;
  }, [combinedHoldings]);

  // Market Cap distribution
  const marketCapData = useMemo(() => {
    const data = combinedHoldings.reduce((acc: any[], entry) => {
      // Show distribution of STOCKS ONLY (Exclude MF, ETF, Bonds, Cash)
      if (entry.sector === 'CASH EQUIVALENT' || entry.type !== 'Stock') return acc;
      
      let name = entry.marketCap;
      
      const existing = acc.find(i => i.name === name);
      if (existing) {
        existing.value += entry.currentValue;
        if (!existing.assets.includes(entry.name)) {
          existing.assets.push(entry.name);
        }
      } else {
        acc.push({ name: name, value: entry.currentValue, assets: [entry.name] });
      }
      return acc;
    }, []);

    return data.sort((a, b) => b.value - a.value);
  }, [combinedHoldings]);

  // Asset Type distribution
  const assetTypeData = useMemo(() => {
    const data = combinedHoldings.reduce((acc: any[], entry) => {
      let type: string = entry.type;
      if (type === 'Mutual Fund') type = 'MF';
      
      const existing = acc.find(i => i.name === type);
      if (existing) {
        existing.value += entry.currentValue;
        if (!existing.assets.includes(entry.name)) {
          existing.assets.push(entry.name);
        }
      } else {
        acc.push({ name: type, value: entry.currentValue, assets: [entry.name] });
      }
      return acc;
    }, []);

    return data.sort((a, b) => b.value - a.value);
  }, [combinedHoldings]);

  const brokerBalances = ledger.reduce((acc: Record<string, number>, entry) => {
    const amount = entry.type === 'Deposit' ? entry.amount : -entry.amount;
    acc[entry.broker] = (acc[entry.broker] || 0) + amount;
    return acc;
  }, {});

  const sectorTotal = useMemo(() => sectorData.reduce((acc, curr) => acc + curr.value, 0), [sectorData]);
  const marketCapTotal = useMemo(() => marketCapData.reduce((acc, curr) => acc + curr.value, 0), [marketCapData]);
  const assetTypeTotal = useMemo(() => assetTypeData.reduce((acc, curr) => acc + curr.value, 0), [assetTypeData]);

  // Total Overall Profit/Loss for current Financial Year
  // includes Total Unrealized Profit (Stocks + Bond Accrued) + Realized metrics from this FY
  const overallPnL = stats.totalUnrealizedProfit + (stats.fyRealizedProfit || 0);

  // Bond Interest Calculation for Dashboard
  const bondInterestDisplay = useMemo(() => {
    return {
      paid: stats.totalBondInterest,
      accrued: stats.bondAccruedProfit,
      fyPaid: stats.fyBondInterest || 0,
      fyAccrued: stats.fyBondAccrued || 0 
    };
  }, [stats]);

  const currentFY = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    return month >= 4 ? `FY ${year}-${(year + 1).toString().slice(-2)}` : `FY ${year - 1}-${year.toString().slice(-2)}`;
  }, []);

  const getFY = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return month >= 4 ? `FY ${year}-${(year + 1).toString().slice(-2)}` : `FY ${year - 1}-${year.toString().slice(-2)}`;
  };

  const fyStats = useMemo(() => {
    // Trades realized in current FY
    const fyRealizedTrades = trades.filter(t => t.status === 'Sold' && getFY(t.exitDate!) === currentFY);
    const tradeRealized = fyRealizedTrades.reduce((acc, t) => acc + (t.exitPrice! - t.entryPrice) * t.quantity - (t.charges || 0) - (t.interest || 0), 0);
    
    // Dividends in current FY
    const fyDividends = dividends.filter(d => getFY(d.month) === currentFY).reduce((acc, d) => acc + d.amount, 0);

    // Bond interest in current FY is already in bondInterestDisplay.fyPaid
    // Bond capital gains in current FY
    const fyExitedBonds = bonds.filter(b => b.status === 'Exited' && getFY(b.exitDate!) === currentFY);
    const bondGains = fyExitedBonds.reduce((acc, b) => acc + ((b.redemptionAmount || b.principal) - b.principal), 0);

    const realized = tradeRealized + bondInterestDisplay.fyPaid + bondGains;

    return {
      realized,
      dividends: fyDividends,
      pnl: stats.totalUnrealizedProfit + realized + fyDividends
    };
  }, [trades, dividends, bonds, bondInterestDisplay, stats.totalUnrealizedProfit, currentFY]);


  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold">WealthTrack Portfolio Overview</h2>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {lastUpdated && (
            <div className="text-[10px] text-muted-foreground mr-2 hidden sm:block">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          )}
          {onLoadSampleData && trades.length === 0 && (
            <Button onClick={onLoadSampleData} variant="outline" size="sm" className="flex-1 sm:flex-none">
              Load Sample Data
            </Button>
          )}
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"
      >
        <Card className="bg-primary/5 border-primary/20 col-span-2 sm:col-span-1">
          <CardHeader className="pb-1 sm:pb-2">
            <CardTitle className="text-[9px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Invested (Active)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-base sm:text-2xl font-bold">₹{stats.totalInvested.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardHeader className="pb-1 sm:pb-2">
            <CardTitle className="text-[9px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground flex justify-between items-center">
              <span className="flex items-center gap-1">
                Portfolio Performance <Badge variant="secondary" className="px-1 py-0 h-4 text-[8px] bg-muted/50">{currentFY}</Badge>
              </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {overallXIRR !== null && !isNaN(overallXIRR) && (
                  <Badge variant="outline" className="text-[9px] font-black border-blue-200 bg-blue-50 text-blue-700 flex items-center gap-0.5" title="Total Portfolio XIRR (All-time Portfolio performance)">
                    <TrendingUp className="w-2 h-2" />
                    Overall: {overallXIRR * 100 > 0 ? '+' : ''}{(overallXIRR * 100).toFixed(2)}% XIRR
                  </Badge>
                )}
                {activeXIRR !== null && !isNaN(activeXIRR) && (
                  <Badge variant="outline" className="text-[9px] font-black border-indigo-200 bg-indigo-50 text-indigo-700 flex items-center gap-0.5" title="Active Portfolio XIRR (Current Holdings only)">
                    <Clock className="w-2 h-2" />
                    Active: {activeXIRR * 100 > 0 ? '+' : ''}{(activeXIRR * 100).toFixed(2)}% XIRR
                  </Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-base sm:text-2xl font-bold ${overallPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {overallPnL >= 0 ? '+' : ''}₹{overallPnL.toLocaleString()}
              <span className="text-[10px] sm:text-xs font-normal text-muted-foreground ml-2">({currentFY} Balance)</span>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1 sm:mt-2">
              <span className="text-[8px] sm:text-[10px] font-bold text-foreground" title="Current Unrealized Profit from Stocks/ETFs/MFs + Accrued Bond Interest">
                Net Unrealized: <span className={stats.totalUnrealizedProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                  ₹{stats.totalUnrealizedProfit.toLocaleString()}
                </span>
              </span>
              <span className="text-[8px] sm:text-[10px] text-muted-foreground" title={`Total Realized Profit in ${currentFY} (Sales + Dividends + Interest)`}>
                FY Realized: <span className={(stats.fyRealizedProfit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}>
                  ₹{(stats.fyRealizedProfit || 0).toLocaleString()}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50/50 border-amber-100 col-span-2 sm:col-span-1">
          <CardHeader className="pb-1 sm:pb-2">
            <CardTitle className="text-[9px] sm:text-xs font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1">
              <Landmark className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
              Bond Interest Summary <Badge variant="outline" className="ml-1 px-1 py-0 h-4 text-[8px] bg-amber-100/50 text-amber-700 border-amber-200">{currentFY}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-base sm:text-2xl font-bold text-amber-700">₹{(bondInterestDisplay.fyPaid + bondInterestDisplay.fyAccrued).toLocaleString()}</div>
            <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1 sm:mt-2">
              <span className="text-[8px] sm:text-[10px] text-muted-foreground" title={`Interest Received in ${currentFY}`}>
                FY Paid: <span className="text-amber-600">₹{bondInterestDisplay.fyPaid.toLocaleString()}</span>
              </span>
              <span className="text-[8px] sm:text-[10px] text-muted-foreground" title={`Scheduled Interest Payouts remaining in ${currentFY}`}>
                FY Pending: <span className="text-amber-600">₹{bondInterestDisplay.fyAccrued.toLocaleString()}</span>
              </span>
              <span className="text-[8px] sm:text-[10px] text-muted-foreground ml-auto border-l pl-2 border-amber-200" title={`Current daily accrued interest (earned since last payout but not yet due)`}>
                Daily Accrued: <span className="text-amber-600">₹{bondInterestDisplay.accrued.toLocaleString()}</span>
              </span>
            </div>
          </CardContent>
        </Card>
      </motion.div>
      
      
      {/* BenchmarkChart removed per user request */}

      {/* Removed PortfolioHealth Audit section per user request */}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <Card className="overflow-hidden border-none shadow-2xl bg-gradient-to-br from-card to-muted/20">
            <CardHeader className="pb-2 border-b border-border/50 bg-muted/30">
              <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <div className="w-1 h-3 bg-primary rounded-full" />
                Asset Allocation
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
        <div className="flex flex-col lg:flex-row items-center gap-6">
          <div className="w-full lg:w-1/2 h-[220px] sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  activeIndex={activeIndex === null ? undefined : activeIndex}
                        activeShape={renderActiveShape}
                        data={assetTypeData.map(d => ({ ...d, percent: ((d.value / assetTypeTotal) * 100).toFixed(1) }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        dataKey="value"
                        onMouseEnter={(_, index) => setActiveIndex(index)}
                        onMouseLeave={() => setActiveIndex(null)}
                        animationDuration={1000}
                        animationEasing="cubic-bezier(0.4, 0, 0.2, 1)"
                        paddingAngle={2}
                        onClick={(data) => {
                        const category = data.name;
                        const filteredStocks = trades.filter(t => t.status === 'Active' && (t.type || 'Stock') === category);
                        const filteredBonds = bonds.filter(b => (b.status === 'Active' || !b.status) && category === 'Bond');
                        setSelectedDrillDown({ 
                          title: 'Asset Class', 
                          category, 
                          stocks: [...filteredStocks, ...filteredBonds.map(b => ({ ...b, stockName: b.name, stockSymbol: 'BOND', quantity: 1, entryPrice: b.principal }))] 
                        });
                      }}
                    >
                      {assetTypeData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[(index + 4) % COLORS.length]} className="outline-none" />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full lg:w-1/2 space-y-2">
                {assetTypeData.map((item, idx) => (
                  <div key={idx} 
                    className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer ${activeIndex === idx ? 'bg-primary/5 border-primary/30 scale-102 shadow-sm' : 'bg-background hover:border-primary/20'}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseLeave={() => setActiveIndex(null)}
                    onClick={() => {
                      const category = item.name;
                      const filteredStocks = trades.filter(t => t.status === 'Active' && (t.type || 'Stock') === category);
                      const filteredBonds = bonds.filter(b => (b.status === 'Active' || !b.status) && category === 'Bond');
                      setSelectedDrillDown({ 
                        title: 'Asset Class', 
                        category, 
                        stocks: [...filteredStocks, ...filteredBonds.map(b => ({ ...b, stockName: b.name, stockSymbol: 'BOND', quantity: 1, entryPrice: b.principal }))] 
                      });
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[(idx + 4) % COLORS.length] }} />
                      <span className="text-[10px] font-black uppercase tracking-widest">{item.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold">₹{item.value.toLocaleString()}</span>
                      <span className="text-[8px] text-muted-foreground ml-2">{((item.value / assetTypeTotal) * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
        >
          <Card className="overflow-hidden border-none shadow-2xl bg-gradient-to-br from-card to-muted/20">
            <CardHeader className="pb-2 border-b border-border/50 bg-muted/30">
              <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <div className="w-1 h-3 bg-emerald-500 rounded-full" />
                Market Cap Distribution
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
        <div className="flex flex-col lg:flex-row items-center gap-6">
          <div className="w-full lg:w-1/2 h-[220px] sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  activeIndex={mcActiveIndex === null ? undefined : mcActiveIndex}
                        activeShape={renderActiveShape}
                        data={marketCapData.map(d => ({ ...d, percent: ((d.value / marketCapTotal) * 100).toFixed(1) }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        dataKey="value"
                        onMouseEnter={(_, index) => setMcActiveIndex(index)}
                        onMouseLeave={() => setMcActiveIndex(null)}
                        animationDuration={1000}
                        animationEasing="cubic-bezier(0.4, 0, 0.2, 1)"
                        paddingAngle={2}
                        onClick={(data) => {
                          const category = data.name;
                          const filteredStocks = trades.filter(t => t.status === 'Active' && (t.type === 'ETF' || t.type === 'Mutual Fund' ? t.type : getMarketCapCategory(t.stockSymbol, t.marketCapValue, t.marketCap)) === category);
                          const filteredBonds = bonds.filter(b => (b.status === 'Active' || !b.status) && category === 'Fixed Income');
                          setSelectedDrillDown({ 
                            title: 'Market Cap', 
                            category, 
                            stocks: [...filteredStocks, ...filteredBonds.map(b => ({ ...b, stockName: b.name, stockSymbol: 'BOND', quantity: 1, entryPrice: b.principal }))] 
                          });
                        }}
                      >
                        {marketCapData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} className="outline-none" />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full lg:w-1/2 space-y-2">
                  {marketCapData.map((item, idx) => (
                    <div key={idx} 
                      className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer ${mcActiveIndex === idx ? 'bg-emerald-50 border-emerald-500/30 scale-102 shadow-sm' : 'bg-background hover:border-emerald-500/20'}`}
                      onMouseEnter={() => setMcActiveIndex(idx)}
                      onMouseLeave={() => setMcActiveIndex(null)}
                      onClick={() => {
                        const category = item.name;
                        const filteredStocks = trades.filter(t => t.status === 'Active' && (t.type === 'ETF' || t.type === 'Mutual Fund' ? t.type : getMarketCapCategory(t.stockSymbol, t.marketCapValue, t.marketCap)) === category);
                        const filteredBonds = bonds.filter(b => (b.status === 'Active' || !b.status) && category === 'Fixed Income');
                        setSelectedDrillDown({ 
                          title: 'Market Cap', 
                          category, 
                          stocks: [...filteredStocks, ...filteredBonds.map(b => ({ ...b, stockName: b.name, stockSymbol: 'BOND', quantity: 1, entryPrice: b.principal }))] 
                        });
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        <span className="text-[10px] font-black uppercase tracking-widest">{item.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold">₹{item.value.toLocaleString()}</span>
                        <span className="text-[8px] text-muted-foreground ml-2">{((item.value / marketCapTotal) * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {selectedDrillDown && (
        <Card className="w-full border-primary/20 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm sm:text-base font-bold">
              {selectedDrillDown.title}: <span className="text-primary">{selectedDrillDown.category}</span>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setSelectedDrillDown(null)} className="h-8 text-xs">Close</Button>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar scroll-smooth" style={{ WebkitOverflowScrolling: 'touch' }}>
              <table className="w-full text-[10px] sm:text-xs text-left border-collapse">
                <thead className="sticky top-0 bg-muted z-20 shadow-sm">
                  <tr>
                    <th className="p-2 sm:p-3 font-bold border-b">Stock</th>
                    <th className="p-2 sm:p-3 font-bold text-right border-b">Qty</th>
                    <th className="p-2 sm:p-3 font-bold text-right border-b">Invested</th>
                    <th className="p-2 sm:p-3 font-bold text-right border-b">P&L</th>
                    <th className="p-2 sm:p-3 font-bold text-right border-b"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedDrillDown.stocks.map((s, idx) => {
                    const currentPrice = currentPrices[s.stockSymbol] || s.lastKnownPrice || 0;
                    const pnl = s.stockSymbol === 'BOND' ? 0 : (currentPrice - s.entryPrice) * s.quantity;
                    const invested = s.stockSymbol === 'BOND' ? s.principal : s.entryPrice * s.quantity;
                    return (
                      <tr key={idx} className="hover:bg-muted/30 transition-colors">
                        <td className="p-2 sm:p-3">
                          <div className="font-bold truncate max-w-[120px] sm:max-w-none">{s.stockName}</div>
                          <div className="text-[8px] sm:text-[10px] text-muted-foreground">{s.stockSymbol}</div>
                        </td>
                        <td className="p-2 sm:p-3 text-right font-mono">{s.quantity}</td>
                        <td className="p-2 sm:p-3 text-right font-mono">₹{invested.toLocaleString()}</td>
                        <td className={`p-2 sm:p-3 text-right font-bold font-mono ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {s.stockSymbol === 'BOND' ? '-' : `${pnl >= 0 ? '+' : ''}₹${(pnl || 0).toLocaleString()}`}
                        </td>
                        <td className="p-2 sm:p-3 text-right">
                          {onAddMore && s.stockSymbol !== 'BOND' && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => onAddMore(s.stockSymbol, s.stockName, s.type || 'Stock')}
                              className="h-6 w-6 p-0 text-blue-600"
                              title="Add More"
                            >
                              <PlusCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}




      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <Card className="w-full overflow-hidden border-none shadow-2xl bg-white dark:bg-zinc-950">
          <CardHeader className="pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.5)]" />
              Sector Diversification
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-8 px-6 pb-8">
            <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8 lg:gap-12">
              {/* Chart Column - Left */}
              <div className="w-full lg:w-[45%] h-[300px] sm:h-[360px] relative flex flex-col justify-center shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      activeIndex={sectorActiveIndex === null ? undefined : sectorActiveIndex}
                      activeShape={renderActiveShape}
                      data={sectorData.map(d => ({ ...d, percent: ((d.value / sectorTotal) * 100).toFixed(1) }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={75}
                      outerRadius={105}
                      dataKey="value"
                      onMouseEnter={(_, index) => setSectorActiveIndex(index)}
                      onMouseLeave={() => setSectorActiveIndex(null)}
                      animationDuration={1000}
                      animationEasing="cubic-bezier(0.4, 0, 0.2, 1)"
                      paddingAngle={2}
                      onClick={(data) => {
                        const category = data.name;
                        const filteredStocks = trades.filter(t => t.status === 'Active' && formatSector(t.stockSymbol, t.sector) === category);
                        setSelectedDrillDown({ 
                          title: 'Sector', 
                          category, 
                          stocks: filteredStocks
                        });
                      }}
                    >
                      {sectorData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} className="outline-none" />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Central stat display */}
                <div className="absolute top-[50%] left-[50%] -translate-x-[50%] -translate-y-[50%] text-center pointer-events-none">
                  <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Total Sector</div>
                  <div className="text-xl font-black text-foreground">₹{Math.round(sectorTotal).toLocaleString()}</div>
                </div>
              </div>

              {/* List Column - Right */}
              <div className="w-full flex-1 flex flex-col gap-3 min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Diversification Score</h3>
                  <Badge variant="outline" className="text-[8px] font-black bg-emerald-50 text-emerald-600 border-emerald-100">
                    {sectorData.length > 8 ? 'High' : sectorData.length > 4 ? 'Optimal' : 'Low'}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
                  {sectorData.map((item, idx) => (
                    <div key={idx} 
                      className={`group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${sectorActiveIndex === idx ? 'bg-violet-50 dark:bg-violet-950/20 border-violet-500/30 scale-[1.01] shadow-sm' : 'bg-zinc-50/50 dark:bg-zinc-900/30 border-transparent hover:border-zinc-200 dark:hover:border-zinc-800'}`}
                      onMouseEnter={() => setSectorActiveIndex(idx)}
                      onMouseLeave={() => setSectorActiveIndex(null)}
                      onClick={() => {
                        const category = item.name;
                        const filteredStocks = trades.filter(t => t.status === 'Active' && formatSector(t.stockSymbol, t.sector) === category);
                        setSelectedDrillDown({ 
                          title: 'Sector', 
                          category, 
                          stocks: filteredStocks
                        });
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        <div className="flex flex-col min-w-0">
                          <span className="text-[10px] font-black uppercase tracking-tight text-zinc-700 dark:text-zinc-300 truncate">{item.name}</span>
                          <span className="text-[9px] font-bold text-violet-500/80">{((item.value / sectorTotal) * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div className="text-[11px] font-black text-foreground">₹{item.value.toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
