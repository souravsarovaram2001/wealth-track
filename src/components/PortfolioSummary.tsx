import { useState, useMemo, useCallback, Fragment } from 'react';
import { Tabs as ShadcnTabs, TabsContent as ShadcnTabsContent, TabsList as ShadcnTabsList, TabsTrigger as ShadcnTabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, Trash2, Landmark, Search as SearchIcon, ArrowUpDown, ArrowUp, ArrowDown, X, LogOut, Pencil, Filter, ChevronDown, ChevronRight, Clock, Edit2, Repeat } from 'lucide-react';
import Fuse from 'fuse.js';
import { Trade, Dividend, Bond, SIP, ProcessedPortfolioEntry } from '@/src/types';
import { SECTORS, ASSET_TYPES, identifyAssetClass, formatSector } from '@/src/constants';
import { differenceInDays, format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isValid } from 'date-fns';
import { calculateXIRR } from '@/src/lib/xirr';
import { calculateAccruedInterest } from '@/src/lib/bondUtils';

const safeFormat = (date: any, formatStr: string) => {
  if (!date) return '--';
  const d = new Date(date);
  if (!isValid(d)) return '--';
  return format(d, formatStr);
};

const formatXIRR = (val: number | null | undefined) => {
  if (val === null || val === undefined || isNaN(val)) return '--';
  return `${(val * 100).toFixed(2)}%`;
};

interface PortfolioSummaryProps {
  trades: Trade[];
  dividends: Dividend[];
  bonds: Bond[];
  sips: SIP[];
  processedPortfolio: ProcessedPortfolioEntry[];
  currentPrices: Record<string, number>;
  realizedXIRR?: number | null;
  overallXIRR?: number | null;
  activeXIRR?: number | null;
  onAddMore: (symbol: string, name: string, type: string) => void;
  onExit: (symbol: string) => void;
  onEditBond?: (bond: Bond) => void;
  onDeleteBond?: (id: string) => void;
  onExitBond?: (bond: Bond) => void;
  onEditSIP?: (sip: SIP) => void;
  onDeleteSIP?: (id: string) => void;
}

interface StockSummary {
  symbol: string;
  name: string;
  type: string;
  totalQuantity: number;
  totalInvestment: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  unrealizedPnL: number;
  totalDividends: number;
  totalPnL: number;
  pnlPercentage: number;
  sector: string;
  oldestDate: string;
  accruedInterest?: number;
  xirr?: number | null;
  isSIP?: boolean;
}

const getCurrentFY = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed
  if (month >= 4) {
    return `FY ${year}-${(year + 1).toString().slice(-2)}`;
  } else {
    return `FY ${year - 1}-${year.toString().slice(-2)}`;
  }
};

export function PortfolioSummary({ 
  trades, 
  dividends, 
  bonds, 
  sips, 
  processedPortfolio, 
  currentPrices, 
  realizedXIRR, 
  overallXIRR,
  activeXIRR,
  onAddMore, 
  onExit, 
  onEditBond, 
  onDeleteBond, 
  onExitBond,
  onEditSIP,
  onDeleteSIP
}: PortfolioSummaryProps) {
  const [activeSubTab, setActiveSubTab] = useState('active');
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [profitFilter, setProfitFilter] = useState<'All' | 'Profitable' | 'Loss'>('All');
  const [fyFilter, setFyFilter] = useState<string>(getCurrentFY());
  const [termFilter, setTermFilter] = useState<string>('All');
  const [sortConfig, setSortConfig] = useState<{ key: keyof StockSummary; direction: 'asc' | 'desc' }[]>([
    { key: 'totalInvestment', direction: 'desc' }
  ]);
  const [showFilters, setShowFilters] = useState(false);

  const getFY = (dateStr: string) => {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-indexed
    if (month >= 4) {
      return `FY ${year}-${(year + 1).toString().slice(-2)}`;
    } else {
      return `FY ${year - 1}-${year.toString().slice(-2)}`;
    }
  };

  const calculateDays = (dateStr: string) => {
    const start = new Date(dateStr);
    const end = new Date();
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const exitedTradesSummary = useMemo(() => {
    const soldTrades = trades.filter(t => t.status === 'Sold');
    const exitedBonds = bonds.filter(b => b.status === 'Exited' || (b.exitDate && b.exitDate <= new Date().toISOString().split('T')[0]));
    
    const calculateDaysBetween = (entry: string, exit: string) => {
      const start = new Date(entry);
      const end = new Date(exit);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    const groups = new Map<string, {
      symbol: string;
      name: string;
      id?: string;
      term: 'ST' | 'LT';
      quantity: number;
      totalBuyValue: number;
      totalSellValue: number;
      realizedProfit: number;
      fy: string;
      type: string;
    }>();

    // 1. Process Sold Trades (Stocks/ETFs)
    soldTrades.forEach(t => {
      const fy = getFY(t.exitDate!);
      const days = calculateDaysBetween(t.entryDate, t.exitDate!);
      const term = days >= 365 ? 'LT' : 'ST';
      const key = `${t.stockSymbol}-${fy}-${term}`;

      const existing = groups.get(key) || {
        symbol: t.stockSymbol,
        name: t.stockName,
        term,
        quantity: 0,
        totalBuyValue: 0,
        totalSellValue: 0,
        realizedProfit: 0,
        fy,
        type: t.type
      };

      const buyValue = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
      const sellValue = (t.exitPrice! * t.quantity);
      const profit = sellValue - buyValue;

      groups.set(key, {
        ...existing,
        quantity: existing.quantity + t.quantity,
        totalBuyValue: existing.totalBuyValue + buyValue,
        totalSellValue: existing.totalSellValue + sellValue,
        realizedProfit: existing.realizedProfit + profit
      });
    });

    // 2. Process Exited Bonds (Capital Gain/Loss on Redemption)
    exitedBonds.forEach(b => {
      if (!b.exitDate) return;
      const fy = getFY(b.exitDate);
      const days = calculateDaysBetween(b.purchaseDate, b.exitDate);
      const term = days >= 365 ? 'LT' : 'ST';
      const key = `BOND-CAP-${b.id}-${fy}-${term}`;

      // Calculate only capital gain/loss on redemption, exclude interest payouts (they are handled in part 3)
      const profit = (b.redemptionAmount || b.principal) - b.principal;

      groups.set(key, {
        symbol: b.name,
        name: b.name,
        id: b.id,
        term,
        quantity: 1,
        totalBuyValue: b.principal,
        totalSellValue: (b.redemptionAmount || b.principal),
        realizedProfit: profit,
        fy,
        type: 'Bond'
      });
    });

    // 3. Process Interest from ALL Bonds (Realized Income)
    bonds.forEach(b => {
      b.payoutSchedule?.filter(p => p.status === 'Received').forEach(p => {
        const fy = getFY(p.date);
        const key = `BOND-INT-${b.id}-${fy}`;
        
        const existing = groups.get(key) || {
          symbol: b.name,
          name: `${b.name} (Interest)`,
          id: b.id,
          term: 'ST',
          quantity: 1,
          totalBuyValue: b.principal, // Use principal as base for yield % calculation
          totalSellValue: b.principal, // Will add interest to this
          realizedProfit: 0,
          fy,
          type: 'Bond'
        };

        groups.set(key, {
          ...existing,
          totalSellValue: existing.totalSellValue + (Number(p.amount) || 0),
          realizedProfit: existing.realizedProfit + (Number(p.amount) || 0)
        });
      });
    });

    let result = Array.from(groups.values()).map(r => {
      const flows: { amount: number; date: string }[] = [];
      
      if (r.type === 'Bond') {
        const bondId = r.id; 
        const bond = bonds.find(b => b.id === bondId || b.name === r.symbol);
        if (bond) {
          // Flow: Outflow of principal at purchase
          flows.push({ amount: -Number(bond.principal), date: bond.purchaseDate });
          
          // Flow: All received interests
          bond.payoutSchedule?.forEach(p => {
            if (p.status === 'Received') {
              flows.push({ amount: Number(p.amount), date: p.date });
            }
          });
          
          if (bond.status === 'Exited' && bond.exitDate) {
            // Flow: Redemption inflow at exit
            flows.push({ amount: Number(bond.redemptionAmount || bond.principal), date: bond.exitDate });
          } else if (bond.status === 'Active' || !bond.status) {
            // Flow: Current value inflow at today (hypothetical exit for XIRR calculation)
            const accrued = calculateAccruedInterest(bond);
            flows.push({ amount: Number(bond.principal) + accrued, date: new Date().toISOString().split('T')[0] });
          }
        }
      } else {
        const relevantTrades = trades.filter(t => t.stockSymbol === r.symbol && (t.status === 'Sold' || t.status === 'Active')); // Include active lots for overall asset performance
        relevantTrades.forEach(t => {
          const investAmount = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
          flows.push({ amount: -investAmount, date: t.entryDate });
          if (t.status === 'Sold' && t.exitPrice && t.exitDate) {
            flows.push({ amount: t.exitPrice * t.quantity, date: t.exitDate });
          }
        });

        // Add dividends for this asset
        dividends.filter(d => d.stockName === r.name).forEach(d => {
          flows.push({ amount: d.amount, date: d.date || `${d.month}-01` });
        });

        // If it's the realized tab, we only care about performance of EXITED portion?
        // Actually, the user usually wants to see the XIRR of the "Closed" trade.
        // But if we have partial exits, XIRR is harder to define without considering the remaining value.
        // For 'Exited' tab specifically, if we are grouping by FY/Term, we should probably only include the relevant trades.
        
        // Let's refine: if it's the grouping for the summary table, we use only the 'Sold' trades of that group.
      }

      let individualXIRR = null;
      if (flows.length >= 2) {
        try {
          individualXIRR = calculateXIRR(flows);
        } catch (e) {
          console.error(`Error calculating XIRR for ${r.symbol}:`, e);
        }
      }

      return {
        ...r,
        pnlPercentage: r.totalBuyValue > 0 ? (r.realizedProfit / r.totalBuyValue) * 100 : 0,
        xirr: individualXIRR
      };
    });
    
    // Apply Filters
    if (fyFilter !== 'All') {
      result = result.filter(r => r.fy === fyFilter);
    }

    if (termFilter !== 'All') {
      result = result.filter(r => r.term === termFilter);
    }

    if (typeFilter !== 'All') {
      result = result.filter(r => r.type === typeFilter);
    }

    if (searchQuery && searchQuery.trim().length > 0) {
      const query = searchQuery.toLowerCase();
      result = result.filter(r => 
        r.symbol.toLowerCase().includes(query) || 
        r.name.toLowerCase().includes(query)
      );
    }

    return result;
  }, [trades, bonds, fyFilter, typeFilter, termFilter, searchQuery]);

  const filteredRealizedXIRR = useMemo(() => {
    const flows: { amount: number; date: string }[] = [];
    const realizedSymbols = new Set<string>();
    
    // 1. Filtered Sold Trades
    trades.filter(t => {
      if (t.status !== 'Sold' || !t.exitDate) return false;
      const matchesFY = fyFilter === 'All' || getFY(t.exitDate) === fyFilter;
      const matchesType = typeFilter === 'All' || t.type === typeFilter;
      const days = differenceInDays(new Date(t.exitDate), new Date(t.entryDate));
      const term = days >= 365 ? 'LT' : 'ST';
      const matchesTerm = termFilter === 'All' || term === termFilter;
      return matchesFY && matchesType && matchesTerm;
    }).forEach(t => realizedSymbols.add(t.stockSymbol));

    // 2. Filtered Bonds
    bonds.filter(b => {
      if (b.status === 'Exited' && b.exitDate) {
        const matchesFY = fyFilter === 'All' || getFY(b.exitDate) === fyFilter;
        const matchesType = (typeFilter === 'All' || typeFilter === 'Bond');
        const days = differenceInDays(new Date(b.exitDate), new Date(b.purchaseDate));
        const term = days >= 365 ? 'LT' : 'ST';
        const matchesTerm = termFilter === 'All' || term === termFilter;
        if (matchesFY && matchesType && matchesTerm) return true;
      }
      const hasReceivedInterestInFY = b.payoutSchedule?.some(p => {
        if (p.status !== 'Received') return false;
        return fyFilter === 'All' || getFY(p.date) === fyFilter;
      });
      // For interest, it's usually ST, but let's just check if we want to show it when filtered by Term?
      // Interest is usually taxed as ST (slab rates), so if termFilter is LT, we might want to hide bond interest.
      if (termFilter === 'LT' && hasReceivedInterestInFY) return false;

      return hasReceivedInterestInFY && (typeFilter === 'All' || typeFilter === 'Bond');
    }).forEach(b => realizedSymbols.add(b.name));

    // 3. Filtered Dividends
    dividends.filter(d => {
      if (typeFilter !== 'All' && typeFilter !== 'Stock' && typeFilter !== 'ETF') return false;
      if (fyFilter !== 'All') {
        const divDate = d.date || `${d.month}-01`;
        return getFY(divDate) === fyFilter;
      }
      return true;
    }).forEach(d => {
      const t = trades.find(tr => tr.stockName === d.stockName);
      if (t) realizedSymbols.add(t.stockSymbol);
    });

    realizedSymbols.forEach(symbol => {
      const symbolTrades = trades.filter(t => t.stockSymbol === symbol);
      if (symbolTrades.length > 0) {
        symbolTrades.forEach(t => {
          const inv = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
          flows.push({ amount: -inv, date: t.entryDate });
          if (t.status === 'Sold' && t.exitPrice && t.exitDate) {
            flows.push({ amount: t.exitPrice * t.quantity, date: t.exitDate });
          }
        });
        const activeQty = symbolTrades.filter(t => t.status === 'Active').reduce((sum, t) => sum + t.quantity, 0);
        if (activeQty > 0) {
          const currentPrice = currentPrices[symbol] || symbolTrades.find(t => t.status === 'Active')?.entryPrice || 0;
          flows.push({ amount: currentPrice * activeQty, date: new Date().toISOString().split('T')[0] });
        }
        dividends.filter(d => d.stockName === symbolTrades[0].stockName).forEach(d => {
          flows.push({ amount: d.amount, date: d.date || `${d.month}-01` });
        });
      }

      const bond = bonds.find(b => b.name === symbol);
      if (bond) {
        flows.push({ amount: -Number(bond.principal), date: bond.purchaseDate });
        bond.payoutSchedule?.forEach(p => {
          if (p.status === 'Received') flows.push({ amount: Number(p.amount), date: p.date });
        });
        if (bond.status === 'Exited' && bond.exitDate) {
          flows.push({ amount: Number(bond.redemptionAmount || bond.principal), date: bond.exitDate });
        } else {
          const accrued = calculateAccruedInterest(bond);
          flows.push({ amount: Number(bond.principal) + accrued, date: new Date().toISOString().split('T')[0] });
        }
      }
    });

    try {
      if (flows.length < 2) return null;
      return calculateXIRR(flows);
    } catch (e) {
      console.error("Overall realized XIRR calculation failed", e);
      return null;
    }
  }, [trades, bonds, dividends, currentPrices, fyFilter, typeFilter, termFilter]);

  const availableFYs = useMemo(() => {
    const soldTrades = trades.filter(t => t.status === 'Sold');
    const exitedBonds = bonds.filter(b => b.status === 'Exited' || (b.exitDate && b.exitDate <= new Date().toISOString().split('T')[0]));
    const fys = new Set<string>();
    soldTrades.forEach(t => fys.add(getFY(t.exitDate!)));
    exitedBonds.forEach(b => {
      if (b.exitDate) fys.add(getFY(b.exitDate));
    });
    
    // Also include FYs from bond interest payouts
    bonds.forEach(b => {
      b.payoutSchedule?.forEach(p => {
        if (p.status === 'Received') {
          fys.add(getFY(p.date));
        }
      });
    });

    return Array.from(fys).sort().reverse();
  }, [trades, bonds]);

  const stockSummaries = useMemo(() => {
    const summaryMap = new Map<string, { 
      qty: number; 
      investment: number; 
      currentValue: number;
      sector: string; 
      oldestDate: string; 
      type: string; 
      name: string;
      isSIP: boolean;
    }>();

    processedPortfolio.forEach(t => {
      const existing = summaryMap.get(t.symbol) || { 
        qty: 0, 
        investment: 0, 
        currentValue: 0,
        sector: t.sector, 
        oldestDate: t.entryDate, 
        type: t.type, 
        name: t.name,
        isSIP: t.isSIP
      };

      summaryMap.set(t.symbol, {
        qty: existing.qty + t.quantity,
        investment: existing.investment + t.investment,
        currentValue: existing.currentValue + t.currentValue,
        sector: t.sector,
        oldestDate: t.entryDate < existing.oldestDate ? t.entryDate : existing.oldestDate,
        type: t.type,
        name: t.name,
        isSIP: existing.isSIP || t.isSIP
      });
    });

    let summaries: StockSummary[] = [];
    summaryMap.forEach((data, symbol) => {
      const stockDividends = dividends
        .filter(d => d.stockName.toLowerCase() === data.name.toLowerCase() || d.stockName.toLowerCase() === symbol.toLowerCase())
        .reduce((sum, d) => sum + d.amount, 0);
        
      const unrealizedPnL = data.currentValue - data.investment;
      const totalPnL = unrealizedPnL + stockDividends;
      const pnlPercentage = data.investment > 0 ? (totalPnL / data.investment) * 100 : 0;
      
      const currentPriceRaw = currentPrices[symbol];
      const symbolTrade = trades.find(t => t.stockSymbol === symbol && t.status === 'Active');
      const currentPrice = (currentPriceRaw !== undefined && currentPriceRaw > 0) 
        ? currentPriceRaw 
        : (symbolTrade?.lastKnownPrice || 0);

      // Calculate XIRR for this specific asset
      const stockFlows: { amount: number; date: string }[] = [];
      
      const allTradesForSymbol = trades.filter(t => t.stockSymbol === symbol);
      
      allTradesForSymbol.forEach(t => {
          const investment = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
          stockFlows.push({ amount: -investment, date: t.entryDate });
          
          if (t.status === 'Sold' && t.exitPrice && t.exitDate) {
            const realization = t.exitPrice * t.quantity;
            stockFlows.push({ amount: realization, date: t.exitDate });
          }
        });

        dividends.filter(d => d.stockName.toLowerCase() === data.name.toLowerCase() || d.stockName.toLowerCase() === symbol.toLowerCase()).forEach(d => {
          const divDate = d.date || `${d.month}-01`;
          stockFlows.push({ amount: d.amount, date: divDate });
        });

        if (data.qty > 0) {
          stockFlows.push({ 
            amount: data.currentValue, 
            date: new Date().toISOString().split('T')[0] 
          });
        }
      
      let xirr = null;
      try {
        if (stockFlows.length >= 2) {
          xirr = calculateXIRR(stockFlows);
        }
      } catch (e) {
        // Silently fail XIRR
      }

      summaries.push({
        symbol,
        name: data.name,
        type: data.type,
        totalQuantity: data.qty,
        totalInvestment: data.investment,
        avgPrice: data.qty > 0 ? data.investment / data.qty : 0,
        currentPrice,
        currentValue: data.currentValue,
        unrealizedPnL,
        totalDividends: stockDividends,
        totalPnL,
        pnlPercentage,
        sector: data.sector,
        oldestDate: data.oldestDate,
        xirr,
        isSIP: data.isSIP
      });
    });

    // Apply Filters (Stage 1: Non-search filters)
    summaries = summaries.filter(s => {
      const matchesType = typeFilter === 'All' || s.type === typeFilter;
      const matchesSector = sectorFilter === 'All' || s.sector === sectorFilter;
      const matchesProfit = profitFilter === 'All' || 
                           (profitFilter === 'Profitable' ? s.unrealizedPnL > 0 : s.unrealizedPnL < 0);
      
      const holdingDays = calculateDays(s.oldestDate);
      const isLongTerm = holdingDays > 365;
      const matchesTerm = termFilter === 'All' || 
                         (termFilter === 'LT' ? isLongTerm : !isLongTerm);
      
      return matchesType && matchesSector && matchesProfit && matchesTerm;
    });

    // Stage 2: Fuzzy Search
    if (searchQuery && searchQuery.trim().length > 0) {
      const fuse = new Fuse<any>(summaries, {
        keys: [
          { name: 'name', weight: 0.6 },
          { name: 'symbol', weight: 0.4 }
        ],
        threshold: 0.3,
        ignoreLocation: true
      });
      summaries = fuse.search(searchQuery).map(r => r.item);
    }

    // Apply Sorting
    if (sortConfig.length > 0) {
      summaries.sort((a, b) => {
        for (const sort of sortConfig) {
          const aValue = a[sort.key];
          const bValue = b[sort.key];
          if (aValue < bValue) return sort.direction === 'asc' ? -1 : 1;
          if (aValue > bValue) return sort.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    return summaries;
  }, [processedPortfolio, dividends, trades, currentPrices, searchQuery, typeFilter, sectorFilter, profitFilter, termFilter, sortConfig]);

  const requestSort = (key: keyof StockSummary, multi: boolean = false) => {
    setSortConfig(prev => {
      const existingIndex = prev.findIndex(s => s.key === key);
      if (multi) {
        if (existingIndex > -1) {
          const newSort = [...prev];
          newSort[existingIndex] = { ...newSort[existingIndex], direction: newSort[existingIndex].direction === 'asc' ? 'desc' : 'asc' };
          return newSort;
        }
        return [...prev, { key, direction: 'asc' }];
      } else {
        if (existingIndex === 0 && prev.length === 1) {
          return [{ key, direction: prev[0].direction === 'asc' ? 'desc' : 'asc' }];
        }
        return [{ key, direction: 'asc' }];
      }
    });
  };

  const getSortIcon = (key: keyof StockSummary) => {
    const sort = sortConfig.find(s => s.key === key);
    if (!sort) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-30" />;
    return sort.direction === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const totals = useMemo(() => {
    // 1. GLOBAL TOTALS (No filters)
    const activeBonds = bonds.filter(b => b.status === 'Active' || !b.status);
    const bondAccruedProfit = activeBonds.reduce((acc, b) => acc + calculateAccruedInterest(b), 0);
    const bondInvested = activeBonds.reduce((acc, b) => acc + (Number(b.principal) || 0), 0);

    const globalHoldings = processedPortfolio;
    const globalInvestment = globalHoldings.reduce((acc, curr) => acc + (Number(curr.investment) || 0), 0);
    const globalValue = globalHoldings.reduce((acc, curr) => acc + (Number(curr.currentValue) || 0), 0);
    const globalUnrealizedPnL = globalValue - globalInvestment;
    
    const globalDividends = dividends.reduce((acc, d) => acc + d.amount, 0);
    
    // Global Tax Breakdown (Stocks only for LTCG/STCG usually)
    let globalLtcg = 0;
    let globalStcg = 0;
    globalHoldings.forEach(item => {
      const days = differenceInDays(new Date(), new Date(item.entryDate));
      if (days >= 365) globalLtcg += (Number(item.pnl) || 0);
      else globalStcg += (Number(item.pnl) || 0);
    });

    const globalRealizedPnL = trades.filter(t => t.status === 'Sold').reduce((acc, t) => {
      const buyValue = (Number(t.entryPrice) * Number(t.quantity)) + (Number(t.charges) || 0) + (Number(t.interest) || 0);
      const sellValue = (Number(t.exitPrice || 0) * Number(t.quantity));
      return acc + (sellValue - buyValue);
    }, 0) + bonds.reduce((acc, b) => {
      const interest = b.payoutSchedule?.filter(p => p.status === 'Received').reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;
      const capitalGain = (b.status === 'Exited') ? (Number(b.redemptionAmount || b.principal) - Number(b.principal)) : 0;
      return acc + interest + capitalGain;
    }, 0);

    // 2. FILTERED TOTALS
    const filteredPortfolio = stockSummaries;
    let filteredInvestment = filteredPortfolio.reduce((acc, curr) => acc + curr.totalInvestment, 0);
    let filteredValue = filteredPortfolio.reduce((acc, curr) => acc + curr.currentValue, 0);
    
    // If type filter is Bond, include active bonds in filtered totals
    if (typeFilter === 'Bond') {
      const filteredBonds = activeBonds.filter(b => {
        if (searchQuery && !b.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
      });
      const bondInv = filteredBonds.reduce((acc, b) => acc + (Number(b.principal) || 0), 0);
      const bondAcc = filteredBonds.reduce((acc, b) => acc + calculateAccruedInterest(b), 0);
      
      filteredInvestment += bondInv;
      filteredValue += (bondInv + bondAcc);
    }

    const filteredUnrealizedPnL = filteredValue - filteredInvestment;
    
    const filteredRealizedPnL = exitedTradesSummary.reduce((acc, r) => acc + r.realizedProfit, 0);
    const filteredDividends = dividends.filter(d => {
      if (fyFilter !== 'All' && getFY(d.month) !== fyFilter) return false;
      
      const query = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || d.stockName.toLowerCase().includes(query);
      
      // Asset type filter for dividends
      if (typeFilter !== 'All') {
        const asset = trades.find(t => t.stockName === d.stockName);
        if (asset && asset.type !== typeFilter) return false;
        if (!asset && typeFilter === 'Bond') return false; // Dividends aren't for bonds usually
      }
      
      return matchesSearch;
    }).reduce((acc, d) => acc + d.amount, 0);

    // Filtered Tax Breakdown
    const activeNonBondSymbols = new Set(filteredPortfolio.map(s => s.symbol));
    let filteredLtcg = 0;
    let filteredStcg = 0;
    processedPortfolio.forEach(item => {
      if (activeNonBondSymbols.has(item.symbol)) {
        const days = differenceInDays(new Date(), new Date(item.entryDate));
        if (days >= 365) filteredLtcg += (Number(item.pnl) || 0);
        else filteredStcg += (Number(item.pnl) || 0);
      }
    });

    const isFiltered = !!(searchQuery || typeFilter !== 'All' || sectorFilter !== 'All' || profitFilter !== 'All' || fyFilter !== 'All' || termFilter !== 'All');

    const hasActiveFilters = !!(searchQuery || typeFilter !== 'All' || sectorFilter !== 'All' || profitFilter !== 'All' || termFilter !== 'All');

    return {
      investment: hasActiveFilters ? filteredInvestment : globalInvestment,
      value: hasActiveFilters ? filteredValue : globalValue,
      unrealizedPnL: hasActiveFilters ? filteredUnrealizedPnL : globalUnrealizedPnL,
      realizedPnL: (searchQuery || typeFilter !== 'All' || fyFilter !== 'All' || termFilter !== 'All') ? filteredRealizedPnL : globalRealizedPnL,
      totalDividends: (searchQuery || typeFilter !== 'All' || fyFilter !== 'All' || termFilter !== 'All') ? filteredDividends : globalDividends,
      stcg: hasActiveFilters ? filteredStcg : globalStcg,
      ltcg: hasActiveFilters ? filteredLtcg : globalLtcg,
      totalPnL: (hasActiveFilters ? filteredUnrealizedPnL : globalUnrealizedPnL) + 
                ((searchQuery || typeFilter !== 'All' || fyFilter !== 'All' || termFilter !== 'All') ? filteredRealizedPnL : globalRealizedPnL) + 
                ((searchQuery || typeFilter !== 'All' || fyFilter !== 'All' || termFilter !== 'All') ? filteredDividends : globalDividends),
      isFiltered
    };
  }, [stockSummaries, exitedTradesSummary, processedPortfolio, trades, bonds, dividends, fyFilter, typeFilter, sectorFilter, profitFilter, termFilter, searchQuery]);

  const activeSubTabXIRR = useMemo(() => {
    if (!totals.isFiltered || activeSubTab !== 'active') return null;
    const flows = stockSummaries.flatMap(s => {
      const flows: {amount: number, date: string}[] = [];
      const symTrades = trades.filter(t => t.stockSymbol === s.symbol && (t.status === 'Active' || t.status === 'Pending Link'));
      symTrades.forEach(t => {
        const inv = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
        flows.push({ amount: -inv, date: t.entryDate });
      });
      dividends.filter(d => d.stockName.toLowerCase() === s.name.toLowerCase() || d.stockName.toLowerCase() === s.symbol.toLowerCase()).forEach(d => {
        flows.push({ amount: d.amount, date: d.date || `${d.month}-01` });
      });
      if (s.totalQuantity > 0) {
        flows.push({ amount: s.currentValue, date: new Date().toISOString().split('T')[0] });
      }
      return flows;
    });
    return calculateXIRR(flows);
  }, [stockSummaries, trades, dividends, totals.isFiltered, activeSubTab]);

  if (stockSummaries.length === 0 && trades.length === 0) {
    return (
      <div className="bg-card border rounded-2xl p-8 text-center mt-6">
        <Landmark className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
        <h3 className="text-lg font-bold">No holdings found</h3>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto mt-2">
          Your portfolio is currently empty. Start adding some trades to see your holdings here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Portfolio Holdings Summary</h2>
          <p className="text-sm text-muted-foreground">Aggregated view of your active investments and overall performance</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowFilters(!showFilters)}
            className="sm:hidden h-10 gap-2"
          >
            <Filter className="w-4 h-4" />
            {showFilters ? 'Hide Filters' : 'Show Filters'}
          </Button>
          <ShadcnTabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-fit">
            <ShadcnTabsList className="grid w-[240px] sm:w-[320px] grid-cols-2 h-10">
              <ShadcnTabsTrigger value="active" className="text-xs sm:text-sm">Active Holdings</ShadcnTabsTrigger>
              <ShadcnTabsTrigger value="exited" className="text-xs sm:text-sm">Exited / Realized</ShadcnTabsTrigger>
            </ShadcnTabsList>
          </ShadcnTabs>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 sm:gap-3 mb-2">
        <div className="bg-card border rounded-xl p-3 sm:p-4 shadow-sm relative overflow-hidden">
          {totals.isFiltered && <div className="absolute top-0 right-0 p-1"><Badge variant="outline" className="text-[7px] scale-75 origin-top-right">Filtered</Badge></div>}
          <p className="text-[9px] sm:text-[10px] font-bold uppercase text-muted-foreground mb-1">Invested (Active)</p>
          <p className="text-base sm:text-lg font-bold">₹{totals.investment.toLocaleString()}</p>
          {activeSubTab === 'active' && activeXIRR !== null && activeXIRR !== undefined && !totals.isFiltered && (
             <div className="mt-1">
               <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-1 rounded">XIRR: {formatXIRR(activeXIRR)}</span>
             </div>
          )}
          {totals.isFiltered && activeSubTab === 'active' && activeSubTabXIRR !== null && (
            <div className="mt-1">
              <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-1 rounded">XIRR: {formatXIRR(activeSubTabXIRR)}</span>
            </div>
          )}
        </div>
        <div className="bg-card border rounded-xl p-3 sm:p-4 shadow-sm relative overflow-hidden">
          <p className="text-[9px] sm:text-[10px] font-bold uppercase text-muted-foreground mb-1">Unrealized P&L</p>
          <div className="flex flex-col">
            <p className={`text-base sm:text-lg font-bold ${totals.unrealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {totals.unrealizedPnL >= 0 ? '+' : ''}₹{totals.unrealizedPnL.toLocaleString()}
            </p>
            <p className={`text-[10px] font-bold ${totals.unrealizedPnL >= 0 ? 'text-green-600/80' : 'text-red-600/80'}`}>
              ({totals.investment > 0 ? ((totals.unrealizedPnL / totals.investment) * 100).toFixed(2) : '0.00'}%)
            </p>
          </div>
          {overallXIRR !== null && overallXIRR !== undefined && !totals.isFiltered && activeSubTab === 'active' && (
            <div className="absolute bottom-2 right-3">
              <Badge variant="outline" className="text-[8px] font-black text-blue-600 border-blue-200 bg-blue-50">
                Overall XIRR: {formatXIRR(overallXIRR)}
              </Badge>
            </div>
          )}
        </div>
        <div className="bg-card border rounded-xl p-3 sm:p-4 shadow-sm relative overflow-hidden">
          <p className="text-[9px] sm:text-[10px] font-bold uppercase text-muted-foreground mb-1">
            Realized P&L {totals.isFiltered && fyFilter !== 'All' ? `(${fyFilter})` : ''}
          </p>
          <p className={`text-base sm:text-lg font-bold ${totals.realizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {totals.realizedPnL >= 0 ? '+' : ''}₹{totals.realizedPnL.toLocaleString()}
          </p>
          {filteredRealizedXIRR !== null && !isNaN(filteredRealizedXIRR) && activeSubTab === 'exited' && (
            <div className="mt-1">
              <Badge variant="outline" className="text-[9px] font-black text-blue-600 border-blue-200 bg-blue-50">
                XIRR: {formatXIRR(filteredRealizedXIRR)}
              </Badge>
            </div>
          )}
        </div>
        <div className="bg-card border rounded-xl p-3 sm:p-4 shadow-sm text-blue-600">
          <p className="text-[9px] sm:text-[10px] font-bold uppercase text-muted-foreground mb-1">Dividends</p>
          <p className="text-base sm:text-lg font-bold">₹{totals.totalDividends.toLocaleString()}</p>
        </div>
        <div className="bg-card border rounded-xl p-3 sm:p-4 shadow-sm ring-2 ring-primary/10 col-span-2 sm:col-span-1">
          <p className="text-[9px] sm:text-[10px] font-bold uppercase text-primary mb-1">Overall Net P&L</p>
          <p className={`text-base sm:text-lg font-bold ${totals.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {totals.totalPnL >= 0 ? '+' : ''}₹{totals.totalPnL.toLocaleString()}
          </p>
        </div>
      </div>

      <ShadcnTabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
        <ShadcnTabsContent value="active" className="space-y-4 mt-0">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <Badge 
              variant="outline" 
              onClick={() => setTermFilter(prev => prev === 'ST' ? 'All' : 'ST')}
              className={`text-[10px] font-bold uppercase shrink-0 py-1 cursor-pointer transition-colors border-muted-foreground/20 hover:bg-muted/50 ${termFilter === 'ST' ? 'bg-primary/10 border-primary text-primary font-black shadow-xs' : ''}`}
              title="Click to filter by Short-term (≤1y) holdings"
            >
              Est. STCG: <span className={`ml-1 ${totals.stcg >= 0 ? 'text-green-600' : 'text-red-600'}`}>₹{totals.stcg.toLocaleString()}</span>
            </Badge>
            <Badge 
              variant="outline" 
              onClick={() => setTermFilter(prev => prev === 'LT' ? 'All' : 'LT')}
              className={`text-[10px] font-bold uppercase shrink-0 py-1 cursor-pointer transition-colors border-muted-foreground/20 hover:bg-muted/50 ${termFilter === 'LT' ? 'bg-primary/10 border-primary text-primary font-black shadow-xs' : ''}`}
              title="Click to filter by Long-term (>1y) holdings"
            >
              Est. LTCG: <span className={`ml-1 ${totals.ltcg >= 0 ? 'text-green-600' : 'text-red-600'}`}>₹{totals.ltcg.toLocaleString()}</span>
            </Badge>
            {termFilter !== 'All' && (
              <Badge 
                variant="secondary" 
                onClick={() => setTermFilter('All')} 
                className="text-[9px] font-bold cursor-pointer hover:bg-destructive/10 hover:text-destructive flex items-center gap-1 shrink-0"
              >
                <span>Term: {termFilter === 'LT' ? 'Long-term (>1y)' : 'Short-term (≤1y)'}</span>
                <X className="w-2.5 h-2.5" />
              </Badge>
            )}
          </div>
          <div className={`${showFilters ? 'grid' : 'hidden'} sm:grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 bg-muted/20 p-2 sm:p-4 rounded-xl border shadow-sm`}>
              <div className="space-y-1 sm:space-y-2 col-span-2 sm:col-span-2 md:col-span-3 lg:col-span-2">
                <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Search Holdings</Label>
                <div className="relative group">
                  <SearchIcon className="absolute left-3 top-2.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input 
                    placeholder="Search by name or symbol..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 sm:pl-9 h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1 sm:space-y-2">
                <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Asset Class</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Assets</SelectItem>
                    {ASSET_TYPES.filter(t => t !== 'Bond').map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 sm:space-y-2">
                <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Industry Sector</Label>
                <Select value={sectorFilter} onValueChange={setSectorFilter}>
                  <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Sectors</SelectItem>
                    {SECTORS.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 sm:space-y-2">
                <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Holding Term</Label>
                <Select value={termFilter} onValueChange={setTermFilter}>
                  <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                    <SelectValue placeholder="All Terms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Terms</SelectItem>
                    <SelectItem value="LT">Long-term (&gt;1y)</SelectItem>
                    <SelectItem value="ST">Short-term (≤1y)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 sm:space-y-2">
                <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">P&L Status</Label>
                <Select value={profitFilter} onValueChange={(v: any) => setProfitFilter(v)}>
                  <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Results</SelectItem>
                    <SelectItem value="Profitable">Profitable</SelectItem>
                    <SelectItem value="Loss">Loss-making</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end col-span-2 sm:col-span-1 md:col-span-1 lg:col-span-1">
                {(searchQuery || typeFilter !== 'All' || sectorFilter !== 'All' || profitFilter !== 'All' || termFilter !== 'All') && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setSearchQuery('');
                      setTypeFilter('All');
                      setSectorFilter('All');
                      setProfitFilter('All');
                      setTermFilter('All');
                    }}
                    className="h-9 sm:h-10 text-xs gap-2 border-destructive/20 hover:bg-destructive/5 hover:text-destructive transition-colors w-full"
                  >
                    <X className="w-3.5 h-3.5" />
                    Clear Filters
                  </Button>
                )}
              </div>
            </div>

            {sortConfig.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-1">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Active Sort:</span>
                {sortConfig.map((sort, idx) => (
                  <Badge key={sort.key} variant="secondary" className="text-[10px] py-0 h-5 flex items-center gap-1">
                    {sort.key === 'name' ? 'Asset' : 
                    sort.key === 'totalInvestment' ? 'Invested' : 
                    sort.key === 'currentValue' ? 'Value' : 
                    sort.key === 'unrealizedPnL' ? 'P&L' : 
                    sort.key === 'pnlPercentage' ? 'P&L %' : sort.key}
                    {sort.direction === 'asc' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSortConfig(prev => prev.filter(s => s.key !== sort.key));
                      }}
                      className="hover:text-destructive transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Badge>
                ))}
                <span className="text-[9px] text-muted-foreground ml-auto italic hidden sm:inline">
                  Tip: Hold Shift + Click to sort by multiple columns
                </span>
              </div>
            )}

            {totals.isFiltered && activeSubTab === 'active' && (
              <div className="bg-primary/5 border border-primary/20 p-2.5 px-4 rounded-xl flex items-center justify-between text-xs font-bold mb-2 animate-in fade-in slide-in-from-top-1 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 text-primary" />
                    <span className="text-primary uppercase tracking-tighter text-[10px]">Filtered Results Summary</span>
                  </div>
                  <span className="text-muted-foreground hidden sm:inline">Active Assets: {stockSummaries.length}</span>
                </div>
                <div className="flex items-center gap-4 sm:gap-8">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 text-right">
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground font-medium uppercase">Filtered Invested</span>
                    <span className="text-xs sm:text-sm">₹{stockSummaries.reduce((acc, s) => acc + s.totalInvestment, 0).toLocaleString()}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 text-right">
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground font-medium uppercase">Filtered P&L</span>
                    <span className={`text-xs sm:text-sm ${stockSummaries.reduce((acc, s) => acc + s.unrealizedPnL, 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {stockSummaries.reduce((acc, s) => acc + s.unrealizedPnL, 0) >= 0 ? '+' : ''}₹{stockSummaries.reduce((acc, s) => acc + s.unrealizedPnL, 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
              <div className="overflow-x-auto no-scrollbar">
                <div className="min-w-[750px] sm:min-w-0">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead 
                          className="w-[140px] sm:w-[180px] cursor-pointer hover:text-primary transition-colors"
                          onClick={(e) => requestSort('name', e.shiftKey)}
                        >
                          <div className="flex items-center text-[10px] sm:text-xs">Asset {getSortIcon('name')}</div>
                        </TableHead>
                        <TableHead 
                          className="text-right text-[10px] sm:text-xs hidden sm:table-cell cursor-pointer hover:text-primary transition-colors"
                          onClick={(e) => requestSort('totalQuantity', e.shiftKey)}
                        >
                          <div className="flex items-center justify-end">Qty {getSortIcon('totalQuantity')}</div>
                        </TableHead>
                        <TableHead 
                          className="text-right text-[10px] sm:text-xs hidden md:table-cell cursor-pointer hover:text-primary transition-colors"
                          onClick={(e) => requestSort('avgPrice', e.shiftKey)}
                        >
                          <div className="flex items-center justify-end">Avg. Price {getSortIcon('avgPrice')}</div>
                        </TableHead>
                        <TableHead 
                          className="text-right text-[10px] sm:text-xs cursor-pointer hover:text-primary transition-colors"
                          onClick={(e) => requestSort('totalInvestment', e.shiftKey)}
                        >
                          <div className="flex items-center justify-end">Invested {getSortIcon('totalInvestment')}</div>
                        </TableHead>
                        <TableHead 
                          className="text-right text-[10px] sm:text-xs hidden sm:table-cell cursor-pointer hover:text-primary transition-colors"
                          onClick={(e) => requestSort('currentValue', e.shiftKey)}
                        >
                          <div className="flex items-center justify-end">Current {getSortIcon('currentValue')}</div>
                        </TableHead>
                        <TableHead 
                          className="text-right text-[10px] sm:text-xs cursor-pointer hover:text-primary transition-colors"
                          onClick={(e) => requestSort('unrealizedPnL', e.shiftKey)}
                        >
                          <div className="flex items-center justify-end">P&L {getSortIcon('unrealizedPnL')}</div>
                        </TableHead>
                        <TableHead 
                          className="text-right text-[10px] sm:text-xs cursor-pointer hover:text-primary transition-colors"
                          onClick={(e) => requestSort('pnlPercentage', e.shiftKey)}
                        >
                          <div className="flex items-center justify-end">P&L (%) {getSortIcon('pnlPercentage')}</div>
                        </TableHead>
                        <TableHead 
                          className="text-right text-[10px] sm:text-xs cursor-pointer hover:text-primary transition-colors"
                          onClick={(e) => requestSort('xirr', e.shiftKey)}
                        >
                          <div className="flex items-center justify-end">XIRR {getSortIcon('xirr')}</div>
                        </TableHead>
                        <TableHead className="text-right text-[10px] sm:text-xs">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockSummaries.map((s) => (
                        <Fragment key={s.symbol}>
                          <TableRow 
                            className={`group transition-colors cursor-pointer ${expandedSymbol === s.symbol ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/30'}`}
                            onClick={() => setExpandedSymbol(expandedSymbol === s.symbol ? null : s.symbol)}
                          >
                            <TableCell className="font-medium py-3">
                              <div className="flex items-start gap-2">
                                <div className="mt-1 transition-transform duration-200">
                                  {expandedSymbol === s.symbol ? <ChevronDown className="w-4 h-4 text-primary" /> : <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />}
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs sm:text-base font-bold leading-tight">{s.name}</span>
                                    <span className={`text-[7px] sm:text-[8px] font-bold uppercase px-1 rounded border ${s.type === 'Stock' ? 'bg-blue-50 text-blue-600 border-blue-200' : s.type === 'ETF' ? 'bg-purple-50 text-purple-600 border-purple-200' : 'bg-orange-50 text-orange-600 border-orange-200'}`}>
                                      {s.type}
                                    </span>
                                    {s.isSIP && (
                                      <Badge variant="outline" className="text-[7px] sm:text-[8px] font-bold uppercase bg-yellow-50 text-yellow-700 border-yellow-200 h-4">
                                        SIP
                                      </Badge>
                                    )}
                                    {identifyAssetClass(s.symbol, s.name) === 'ETF' && s.type !== 'ETF' && (
                                      <span className="text-[7px] sm:text-[8px] font-bold uppercase px-1 rounded border bg-indigo-50 text-indigo-600 border-indigo-200">
                                        Index
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {s.type !== 'Mutual Fund' && (
                                      <span className="text-[9px] sm:text-[10px] text-muted-foreground uppercase font-bold">{s.sector}</span>
                                    )}
                                    <span className={`text-[7px] sm:text-[8px] font-bold uppercase px-1 rounded border ${calculateDays(s.oldestDate) > 365 ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                      {calculateDays(s.oldestDate) > 365 ? 'LT' : 'ST'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right hidden sm:table-cell font-bold">{s.totalQuantity}</TableCell>
                            <TableCell className="text-right font-mono text-sm hidden md:table-cell">₹{s.avgPrice.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              <div className="flex flex-col items-end font-bold">
                                <span>₹{s.totalInvestment.toLocaleString()}</span>
                                <span className="sm:hidden text-[10px] font-normal text-muted-foreground">Val: ₹{s.currentValue.toLocaleString()}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm hidden sm:table-cell">
                              <div className="flex flex-col items-end">
                                <span className="font-bold">₹{s.currentValue.toLocaleString()}</span>
                                <span className="text-[10px] text-muted-foreground">@ ₹{s.currentPrice.toLocaleString()}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className={`flex flex-col items-end ${s.unrealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                <span className="font-bold text-xs sm:text-sm">
                                  {s.unrealizedPnL >= 0 ? '+' : ''}₹{s.unrealizedPnL.toLocaleString()}
                                </span>
                                {s.totalDividends > 0 && (
                                  <span className="text-[8px] text-blue-600 font-bold">
                                    +₹{s.totalDividends.toLocaleString()} Div.
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className={`flex flex-col items-end ${s.pnlPercentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                <span className="font-bold text-xs sm:text-sm">
                                  {s.pnlPercentage >= 0 ? '+' : ''}{s.pnlPercentage.toFixed(2)}%
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {s.xirr !== null && s.xirr !== undefined && !isNaN(s.xirr) ? (
                                <div className="flex flex-col items-end">
                                  <span className={`font-bold text-xs sm:text-sm ${s.xirr >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                                    {formatXIRR(s.xirr)}
                                  </span>
                                  <span className="text-[8px] font-bold text-muted-foreground uppercase">XIRR</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">--</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-7 sm:h-8 px-1.5 sm:px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1 border sm:border-0"
                                  onClick={() => onAddMore(s.symbol, s.name, s.type)}
                                >
                                  <PlusCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                  <span className="text-[9px] sm:text-[10px] font-bold uppercase">Add</span>
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-7 sm:h-8 px-1.5 sm:px-2 text-red-600 hover:text-red-700 hover:bg-red-50 gap-1 border sm:border-0"
                                  onClick={() => onExit(s.symbol)}
                                >
                                  <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                  <span className="text-[9px] sm:text-[10px] font-bold uppercase">Exit</span>
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          
                          {expandedSymbol === s.symbol && (
                            <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-muted">
                              <TableCell colSpan={9} className="p-0 border-t">
                                <div className="p-4 sm:p-6 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                  <div className="flex items-center gap-2 mb-4">
                                    <div className="w-1 h-6 bg-primary rounded-full" />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                      Asset Performance & Health
                                    </h4>
                                  </div>

                                  {sips.find(sip => sip.stockSymbol === s.symbol && sip.status === 'Active') && (
                                    <div className="mb-4 bg-primary/10 border border-primary/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                                      <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                                          <Repeat className="w-6 h-6" />
                                        </div>
                                        <div className="flex flex-col">
                                          <span className="text-[10px] font-black uppercase tracking-tighter text-primary/70">SIP Schedule Active</span>
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm font-black">₹{sips.find(sip => sip.stockSymbol === s.symbol)?.installmentAmount.toLocaleString()}/mo</span>
                                            <Badge variant="outline" className="text-[9px] bg-background">Day {sips.find(sip => sip.stockSymbol === s.symbol)?.dayOfMonth}</Badge>
                                          </div>
                                        </div>
                                      </div>
                                      
                                      <div className="flex items-center gap-6">
                                        {sips.find(sip => sip.stockSymbol === s.symbol)?.stepUpType !== 'None' && (
                                          <div className="flex flex-col items-center">
                                            <span className="text-[9px] font-black uppercase text-muted-foreground">Annual Step-Up</span>
                                            <span className="text-xs font-black text-primary">
                                              {sips.find(sip => sip.stockSymbol === s.symbol)?.stepUpType === 'Percentage' 
                                                ? `${sips.find(sip => sip.stockSymbol === s.symbol)?.stepUpValue}%` 
                                                : `₹${sips.find(sip => sip.stockSymbol === s.symbol)?.stepUpValue?.toLocaleString()}`}
                                            </span>
                                          </div>
                                        )}
                                        <Button 
                                          variant="outline" 
                                          size="sm" 
                                          className="h-8 text-[10px] font-bold gap-1.5 border-primary/20 hover:bg-primary/5 rounded-lg"
                                          onClick={() => onEditSIP && onEditSIP(sips.find(sip => sip.stockSymbol === s.symbol)!)}
                                        >
                                          <Edit2 className="w-3 h-3" />
                                          Update SIP
                                        </Button>
                                      </div>
                                    </div>
                                  )}

                                  <div className="flex items-center gap-2 mb-2">
                                    <div className="w-1 h-6 bg-primary rounded-full" />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                      Tax Lots & Cost Basis Breakdown
                                    </h4>
                                  </div>
                                  <div className="border rounded-xl overflow-hidden bg-background shadow-inner">
                                    <Table>
                                      <TableHeader className="bg-muted/30">
                                        <TableRow className="hover:bg-transparent border-b-0">
                                          <TableHead className="h-8 text-[9px] uppercase font-black px-4">Date</TableHead>
                                          <TableHead className="h-8 text-[9px] uppercase font-black text-right">Qty</TableHead>
                                          <TableHead className="h-8 text-[9px] uppercase font-black text-right">Basis</TableHead>
                                          <TableHead className="h-8 text-[9px] uppercase font-black text-right">PnL</TableHead>
                                          <TableHead className="h-8 text-[9px] uppercase font-black text-right px-4">Tax Status</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {trades
                                          .filter(t => t.stockSymbol === s.symbol && t.status === 'Active')
                                          .sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime())
                                          .map(lot => {
                                            const days = differenceInDays(new Date(), new Date(lot.entryDate));
                                            const lotBasis = (lot.entryPrice * lot.quantity) + (lot.charges || 0) + (lot.interest || 0);
                                            const lotPnL = ((currentPrices[s.symbol] || s.currentPrice) * lot.quantity) - lotBasis;
                                            return (
                                              <TableRow key={lot.id} className="hover:bg-primary/[0.02] border-none group/lot">
                                                <TableCell className="py-2 px-4">
                                                  <div className="flex flex-col">
                                                    <span className="text-[11px] font-bold">{safeFormat(lot.entryDate, 'dd MMM yyyy')}</span>
                                                    <span className="text-[9px] text-muted-foreground opacity-70 flex items-center gap-1">
                                                      <Clock className="w-2.5 h-2.5" /> {(isNaN(days) ? '--' : days)}d holding
                                                    </span>
                                                  </div>
                                                </TableCell>
                                                <TableCell className="py-2 text-right font-mono text-[11px] font-bold text-muted-foreground group-hover/lot:text-foreground">
                                                  {lot.quantity.toLocaleString()}
                                                </TableCell>
                                                <TableCell className="py-2 text-right">
                                                  <div className="flex flex-col items-end">
                                                    <span className="text-[11px] font-bold">₹{lotBasis.toLocaleString()}</span>
                                                    <span className="text-[9px] text-muted-foreground opacity-70">@ ₹{lot.entryPrice.toLocaleString()}</span>
                                                  </div>
                                                </TableCell>
                                                <TableCell className={`py-2 text-right font-mono text-[11px] font-bold ${lotPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                  {lotPnL >= 0 ? '+' : ''}{lotPnL.toLocaleString()}
                                                </TableCell>
                                                <TableCell className="py-2 text-right px-4">
                                                  <Badge variant={days >= 365 ? "default" : "secondary"} className={`text-[8px] font-black h-4 px-1 ${days >= 365 ? 'bg-blue-600' : 'opacity-60'}`}>
                                                    {days >= 365 ? 'LTCG' : 'STCG'}
                                                  </Badge>
                                                </TableCell>
                                              </TableRow>
                                            )
                                          })}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                      
                      {totals.isFiltered && stockSummaries.length > 0 && (
                        <TableRow className="bg-muted/40 font-bold border-t-2 border-primary/20">
                          <TableCell className="py-4 font-black uppercase text-[10px] tracking-wider text-primary">Filtered Total ({stockSummaries.length} items)</TableCell>
                          <TableCell className="text-right hidden sm:table-cell font-mono">
                            {stockSummaries.reduce((acc, s) => acc + s.totalQuantity, 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right hidden md:table-cell">--</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            ₹{stockSummaries.reduce((acc, s) => acc + s.totalInvestment, 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm hidden sm:table-cell">
                            ₹{stockSummaries.reduce((acc, s) => acc + s.currentValue, 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className={`flex flex-col items-end ${stockSummaries.reduce((acc, s) => acc + s.unrealizedPnL, 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              <span className="font-bold text-xs sm:text-sm">
                                {stockSummaries.reduce((acc, s) => acc + s.unrealizedPnL, 0) >= 0 ? '+' : ''}₹{stockSummaries.reduce((acc, s) => acc + s.unrealizedPnL, 0).toLocaleString()}
                              </span>
                              {stockSummaries.reduce((acc, s) => acc + s.totalDividends, 0) > 0 && (
                                <span className="text-[8px] text-blue-600 font-bold">
                                  +₹{stockSummaries.reduce((acc, s) => acc + s.totalDividends, 0).toLocaleString()} Div.
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className={`flex flex-col items-end ${stockSummaries.reduce((acc, s) => acc + s.unrealizedPnL, 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              <span className="font-bold text-xs sm:text-sm">
                                {stockSummaries.reduce((acc, s) => acc + s.totalInvestment, 0) > 0 
                                  ? ((stockSummaries.reduce((acc, s) => acc + s.unrealizedPnL, 0) / stockSummaries.reduce((acc, s) => acc + s.totalInvestment, 0)) * 100).toFixed(2) 
                                  : '0.00'}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell colSpan={2}></TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                </Table>
              </div>
            </div>
          </div>

          {(typeFilter === 'All' || typeFilter === 'Bond') && bonds.filter(b => b.status === 'Active' || !b.status).length > 0 && (
            <div className="mt-8 space-y-4">
              <div className="flex items-center gap-2">
                <Landmark className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-semibold">Bond Holdings</h2>
              </div>
              <div className="border rounded-xl overflow-hidden bg-card shadow-sm overflow-x-auto">
                <div className="min-w-[600px] sm:min-w-0">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="text-[10px] sm:text-xs">Bond Name</TableHead>
                        <TableHead className="text-right text-[10px] sm:text-xs">Principal</TableHead>
                        <TableHead className="text-right text-[10px] sm:text-xs">Interest Received</TableHead>
                        <TableHead className="text-right text-[10px] sm:text-xs">XIRR</TableHead>
                        <TableHead className="text-right text-[10px] sm:text-xs">Frequency</TableHead>
                        <TableHead className="text-right text-[10px] sm:text-xs">Purchase Date</TableHead>
                        <TableHead className="text-right text-[10px] sm:text-xs">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bonds.filter(b => b.status === 'Active' || !b.status).map((bond) => (
                        <TableRow key={bond.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="font-medium py-3">
                            <div className="flex flex-col">
                              <span className="text-sm sm:text-base">{bond.name}</span>
                              <span className="text-[10px] text-muted-foreground uppercase font-bold">Fixed Income</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">₹{bond.principal.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end">
                              <span className="font-mono text-sm text-green-600 font-bold">₹{(bond.payoutSchedule?.filter(p => p.status === 'Received').reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0).toLocaleString()}</span>
                              {bond.lastPayoutDate && <span className="text-[9px] text-muted-foreground italic">Last: {new Date(bond.lastPayoutDate).toLocaleDateString()}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              const bondFlows: { amount: number; date: string }[] = [];
                              bondFlows.push({ amount: -bond.principal, date: bond.purchaseDate });
                              bond.payoutSchedule?.forEach(p => {
                                if (p.status === 'Received') {
                                  bondFlows.push({ amount: Number(p.amount), date: p.date });
                                }
                              });
                              // Terminal value
                              const accrued = calculateAccruedInterest(bond);
                              bondFlows.push({ amount: bond.principal + accrued, date: new Date().toISOString().split('T')[0] });
                              
                              try {
                                if (bondFlows.length >= 2) {
                                  const rate = calculateXIRR(bondFlows);
                                  return (
                                    <span className="font-mono text-sm font-bold text-blue-600">
                                      {formatXIRR(rate)}
                                    </span>
                                  );
                                }
                              } catch (e) {
                                return <span className="text-[10px] text-muted-foreground">--</span>;
                              }
                              return <span className="text-[10px] text-muted-foreground">--</span>;
                            })()}
                          </TableCell>
                          <TableCell className="text-right text-xs">{bond.frequency}</TableCell>
                          <TableCell className="text-right text-xs">{new Date(bond.purchaseDate).toLocaleDateString()}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {onEditBond && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => onEditBond(bond)}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {onDeleteBond && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => bond.id && onDeleteBond(bond.id)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {onExitBond && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 gap-1 border border-red-100"
                                  onClick={() => onExitBond(bond)}
                                >
                                  <LogOut className="w-3.5 h-3.5" />
                                  <span className="text-[10px] font-bold uppercase hidden sm:inline">Exit</span>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </ShadcnTabsContent>

        <ShadcnTabsContent value="exited" className="space-y-4 mt-0">
          <div className={`${showFilters ? 'flex' : 'hidden'} sm:flex bg-muted/20 p-4 rounded-xl border shadow-sm flex-col sm:flex-row sm:items-center justify-between gap-4`}>
            <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-xl">
              <div className="space-y-1 sm:space-y-2 flex-1">
                <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Financial Year</Label>
                <Select value={fyFilter} onValueChange={setFyFilter}>
                  <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                    <SelectValue placeholder="Select FY" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Years</SelectItem>
                    {availableFYs.map(fy => (
                      <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 sm:space-y-2 flex-1">
                <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Asset Class</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                    <SelectValue placeholder="All Classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Classes</SelectItem>
                    <SelectItem value="Stock">Stocks</SelectItem>
                    <SelectItem value="ETF">ETFs</SelectItem>
                    <SelectItem value="Mutual Fund">Mutual Funds</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 sm:space-y-2 flex-1">
                <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Holding Term</Label>
                <Select value={termFilter} onValueChange={setTermFilter}>
                  <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                    <SelectValue placeholder="All Terms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Terms</SelectItem>
                    <SelectItem value="LT">Long-term (1y+)</SelectItem>
                    <SelectItem value="ST">Short-term (&lt;1y)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold uppercase text-muted-foreground underline decoration-dotted decoration-muted-foreground/30 underline-offset-4">Performance Metrics</span>
              <div className="flex items-baseline gap-3">
                <div className="flex flex-col items-end">
                  <span className="text-[9px] font-bold uppercase text-muted-foreground/70">Realized Gain</span>
                  <span className={`text-xl font-bold ${totals.realizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {totals.realizedPnL >= 0 ? '+' : ''}₹{totals.realizedPnL.toLocaleString()}
                  </span>
                </div>
                {filteredRealizedXIRR !== null && !isNaN(filteredRealizedXIRR) && (
                  <div className="flex flex-col items-end border-l pl-3">
                    <span className="text-[9px] font-bold uppercase text-muted-foreground/70">Realized XIRR</span>
                    <span className="text-xl font-bold text-blue-600">
                      {formatXIRR(filteredRealizedXIRR)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
            <div className="overflow-x-auto no-scrollbar">
              <div className="min-w-[800px] sm:min-w-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="text-[10px] sm:text-xs">Stock Name</TableHead>
                      <TableHead className="text-[10px] sm:text-xs">Term</TableHead>
                      <TableHead className="text-right text-[10px] sm:text-xs hidden sm:table-cell">Quantity</TableHead>
                      <TableHead className="text-right text-[10px] sm:text-xs hidden md:table-cell">Avg Buy Price</TableHead>
                      <TableHead className="text-right text-[10px] sm:text-xs hidden md:table-cell">Avg Sell Price</TableHead>
                      <TableHead className="text-right text-[10px] sm:text-xs">Realized P&L</TableHead>
                      <TableHead className="text-right text-[10px] sm:text-xs">P&L (%) / XIRR</TableHead>
                      <TableHead className="text-right text-[10px] sm:text-xs">Exit FY</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exitedTradesSummary.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                          No exited trades found for the selected criteria.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {exitedTradesSummary.map((r, idx) => (
                          <TableRow key={`${r.symbol}-${r.fy}-${r.term}-${idx}`} className="hover:bg-muted/30 transition-colors">
                            <TableCell className="font-medium py-3">
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm sm:text-base font-bold">{r.name}</span>
                                  <span className={`text-[7px] sm:text-[8px] font-bold uppercase px-1 rounded border ${r.type === 'Stock' ? 'bg-blue-50 text-blue-600 border-blue-200' : r.type === 'ETF' ? 'bg-purple-50 text-purple-600 border-purple-200' : r.type === 'Bond' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-orange-50 text-orange-600 border-orange-200'}`}>
                                    {r.type}
                                  </span>
                                </div>
                                <span className="text-[10px] text-muted-foreground uppercase font-bold">{r.symbol}</span>
                                <div className="sm:hidden text-[9px] text-muted-foreground mt-1 bg-muted/50 px-1 rounded w-fit">
                                  {isNaN(r.quantity) ? '0' : r.quantity} Qty • Buy: ₹{(isNaN(r.totalBuyValue / r.quantity) ? 0 : (r.totalBuyValue / r.quantity)).toFixed(2)}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={r.term === 'LT' ? 'default' : 'secondary'} className="text-[10px] font-bold">
                                {r.term === 'LT' ? 'LONG-TERM' : 'SHORT-TERM'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm hidden sm:table-cell">{isNaN(r.quantity) ? '0' : r.quantity}</TableCell>
                            <TableCell className="text-right font-mono text-sm hidden md:table-cell">₹{(isNaN(r.totalBuyValue / r.quantity) ? 0 : (r.totalBuyValue / r.quantity)).toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm hidden md:table-cell">₹{(isNaN(r.totalSellValue / r.quantity) ? 0 : (r.totalSellValue / r.quantity)).toFixed(2)}</TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${r.realizedProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              <div className="flex flex-col items-end">
                                <span>{r.realizedProfit >= 0 ? '+' : ''}₹{(isNaN(r.realizedProfit) ? 0 : r.realizedProfit).toLocaleString()}</span>
                                <span className="sm:hidden text-[10px] text-muted-foreground">Sell: ₹{(isNaN(r.totalSellValue / r.quantity) ? 0 : (r.totalSellValue / r.quantity)).toFixed(2)}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end">
                                <span className={`font-mono text-sm font-bold ${r.pnlPercentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {r.pnlPercentage >= 0 ? '+' : ''}{r.pnlPercentage.toFixed(2)}%
                                </span>
                                {r.xirr !== null && !isNaN(r.xirr) && (
                                  <span className="text-[10px] font-bold text-blue-600">
                                    {formatXIRR(r.xirr)} XIRR
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-xs font-medium text-muted-foreground">{r.fy}</TableCell>
                          </TableRow>
                        ))}
                        
                        {(searchQuery || typeFilter !== 'All' || fyFilter !== 'All') && exitedTradesSummary.length > 0 && (
                          <TableRow className="bg-muted/40 font-bold border-t-2 border-primary/20">
                            <TableCell colSpan={2} className="py-4 font-black uppercase text-[10px] tracking-wider text-primary">Filtered Total ({exitedTradesSummary.length} items)</TableCell>
                            <TableCell className="text-right hidden sm:table-cell font-mono">
                              {exitedTradesSummary.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right hidden md:table-cell">--</TableCell>
                            <TableCell className="text-right hidden md:table-cell">--</TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${exitedTradesSummary.reduce((acc, r) => acc + r.realizedProfit, 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {exitedTradesSummary.reduce((acc, r) => acc + r.realizedProfit, 0) >= 0 ? '+' : ''}₹{exitedTradesSummary.reduce((acc, r) => acc + r.realizedProfit, 0).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={`font-mono text-sm font-bold ${exitedTradesSummary.reduce((acc, r) => acc + r.realizedProfit, 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {exitedTradesSummary.reduce((acc, r) => acc + r.totalBuyValue, 0) > 0 
                                  ? ((exitedTradesSummary.reduce((acc, r) => acc + r.realizedProfit, 0) / exitedTradesSummary.reduce((acc, r) => acc + r.totalBuyValue, 0)) * 100).toFixed(2)
                                  : '0.00'}%
                              </span>
                            </TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        )}
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </ShadcnTabsContent>
      </ShadcnTabs>

      {sips.length > 0 && (
        <div className="pt-12 border-t mt-12 space-y-8 pb-12">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-inner">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-black tracking-tight text-foreground uppercase">Managed SIPs</h2>
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">Automatic Investment Schedules</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-muted/30 p-1.5 rounded-lg border border-muted/50 self-start">
               <div className="px-3 py-1 bg-background rounded-md shadow-sm border border-muted-foreground/10">
                 <span className="text-[10px] font-black uppercase text-muted-foreground mr-2">Monthly Committed:</span>
                 <span className="text-sm font-black text-primary">₹{sips.filter(s => s.status === 'Active').reduce((acc, curr) => acc + curr.installmentAmount, 0).toLocaleString()}</span>
               </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sips.map((s) => (
              <div key={s.id} className="relative group overflow-hidden bg-card border rounded-3xl p-5 shadow-sm hover:shadow-xl transition-all duration-300 border-muted-foreground/10 hover:border-primary/20">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 transition-all group-hover:bg-primary/10" />
                
                <div className="relative flex justify-between items-start mb-4">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-1.5 mb-1">
                      <h3 className="text-base font-black truncate">{s.stockName}</h3>
                      <Badge variant={s.status === 'Active' ? 'default' : 'secondary'} className="text-[8px] h-4 font-black uppercase tracking-widest px-1">
                        {s.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                       <span className="text-[10px] font-bold text-muted-foreground uppercase">{s.stockSymbol}</span>
                       <span className="text-[10px] font-bold text-primary/70">Day {s.dayOfMonth}</span>
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end gap-1">
                     <span className="text-lg font-black text-primary leading-tight">₹{s.installmentAmount.toLocaleString()}</span>
                     <span className="text-[9px] font-black text-muted-foreground uppercase tracking-wider">Per Month</span>
                  </div>
                </div>

                <div className="relative flex items-center justify-between mt-6 pt-4 border-t border-dashed">
                  <div className="flex flex-col">
                    <span className="text-[8px] font-bold text-muted-foreground uppercase">Started On</span>
                    <span className="text-[11px] font-bold">{new Date(s.startDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {onDeleteSIP && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-9 w-9 rounded-xl text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => s.id && onDeleteSIP(s.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                    {onEditSIP && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-9 w-9 rounded-xl bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
                        onClick={() => onEditSIP(s)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 text-primary pt-8 border-t border-muted-foreground/10">
            <Clock className="w-5 h-5" />
            <h2 className="text-xl font-bold">Upcoming Installments</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {(() => {
              const upcoming = [];
              const now = new Date();
              for (let i = 0; i < 3; i++) {
                const monthDate = addMonths(now, i);
                const isValidDate = monthDate instanceof Date && !isNaN(monthDate.getTime());
                const monthName = isValidDate ? format(monthDate, 'MMMM yyyy') : 'Unknown Date';
                
                const monthSips = sips.filter(s => s.status === 'Active').map(s => {
                  const sipDate = new Date(monthDate);
                  sipDate.setDate(Number(s.dayOfMonth || 1));
                  return { ...s, scheduledDate: sipDate };
                }).filter(s => s.scheduledDate >= now)
                  .sort((a,b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());

                if (monthSips.length > 0) {
                  upcoming.push(
                    <div key={monthName} className="space-y-4">
                      <h3 className="text-sm font-black text-muted-foreground uppercase tracking-widest border-b pb-2">{monthName}</h3>
                      <div className="space-y-3">
                        {monthSips.map((s, idx) => (
                           <div key={`${s.id}-${idx}`} className="bg-card border rounded-2xl p-4 flex justify-between items-center shadow-sm hover:shadow-md transition-shadow">
                             <div className="flex flex-col">
                               <span className="text-sm font-bold leading-tight">{s.stockName}</span>
                               <span className="text-xs text-muted-foreground">{s.scheduledDate instanceof Date && !isNaN(s.scheduledDate.getTime()) ? format(s.scheduledDate, 'do MMMM (EEEE)') : '--'}</span>
                             </div>
                             <div className="text-right">
                               <span className="text-sm font-black text-primary">₹{s.installmentAmount.toLocaleString()}</span>
                               <div className="flex items-center justify-end gap-1 mt-1">
                                 <Badge variant="outline" className="text-[8px] font-bold bg-primary/5 text-primary border-primary/10 h-4">MF SIP</Badge>
                               </div>
                             </div>
                           </div>
                        ))}
                      </div>
                    </div>
                  );
                }
              }
              return upcoming;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
