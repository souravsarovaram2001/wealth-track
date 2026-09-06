import { useState, useMemo, useEffect, useCallback } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trade, Bond } from '@/src/types';
import { SECTORS, MARKET_CAPS, ASSET_TYPES, BROKERS, getMarketCapCategory, formatSector } from '@/src/constants';
import { format, differenceInDays, startOfDay, parseISO, isValid } from 'date-fns';
import { Edit2, Trash2, LogOut, ArrowUpDown, ArrowUp, ArrowDown, Search as SearchIcon, Filter, X, PlusCircle, Loader2, Download, RefreshCw } from 'lucide-react';

const safeFormat = (date: any, formatStr: string) => {
  if (!date) return '--';
  const d = new Date(date);
  if (!isValid(d)) return '--';
  return format(d, formatStr);
};
import Fuse from 'fuse.js';

interface TradeLogProps {
  trades: Trade[];
  bonds: Bond[];
  currentPrices: Record<string, number>;
  fetchingSymbols: Set<string>;
  onRefreshPrices?: () => void;
  onExitTrade: (trade: Trade) => void;
  onEditTrade: (trade: Trade | Bond) => void;
  onDeleteTrade: (trade: any, index: number) => void;
  onAddMore: (trade: Trade) => void;
  onExitBond?: (bond: Bond) => void;
}

type SortItem = {
  key: keyof Trade | 'profit' | 'days' | 'currentPrice';
  direction: 'asc' | 'desc';
};

export function TradeLog({ 
  trades, 
  bonds, 
  currentPrices, 
  fetchingSymbols, 
  onRefreshPrices, 
  onExitTrade, 
  onEditTrade, 
  onDeleteTrade, 
  onAddMore,
  onExitBond
}: TradeLogProps) {
  const [filter, setFilter] = useState<'All' | 'Active' | 'Sold' | 'Exited'>('All');
  const [, setForceUpdate] = useState(0);

  // Trigger re-render when currentPrices changes
  useEffect(() => {
    setForceUpdate(p => p + 1);
  }, [currentPrices]);

  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [capFilter, setCapFilter] = useState<string>('All');
  const [termFilter, setTermFilter] = useState<'All' | 'Short' | 'Long'>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [brokerFilter, setBrokerFilter] = useState<string>('All');
  const [profitFilter, setProfitFilter] = useState<'All' | 'Profitable' | 'Loss'>('All');
  const [lotStatusFilter, setLotStatusFilter] = useState<'All' | 'Open' | 'Closed'>('All');
  const [daysRangeFilter, setDaysRangeFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Multi-column sort state
  const [sortConfig, setSortConfig] = useState<SortItem[]>(() => {
    const saved = localStorage.getItem('trade_log_sort');
    return saved ? JSON.parse(saved) : [{ key: 'entryDate', direction: 'desc' }];
  });

  // Persist sort config
  useEffect(() => {
    localStorage.setItem('trade_log_sort', JSON.stringify(sortConfig));
  }, [sortConfig]);

  const calculateProfit = useCallback((item: Trade | Bond) => {
    if ('type' in item && item.type === 'Bond') {
      const bond = item as any; // It's a normalized bond in unifiedList or a Bond object
      const interestReceived = bond.payoutSchedule?.filter((p: any) => p.status === 'Received').reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0) || 0;
      if (bond.status === 'Exited' || bond.status === 'Sold') {
        const redemption = bond.redemptionAmount || 0;
        const principal = bond.principal || bond.entryPrice || 0;
        return redemption + interestReceived - principal;
      }
      // For active bonds, profit is interest received so far + accrued interest
      return interestReceived + (bond.accruedInterest || 0);
    }

    if ('stockSymbol' in item) {
      const trade = item as Trade;
      if (trade.status === 'Active' || trade.status === 'Pending Link') {
        const live = currentPrices[trade.stockSymbol];
        const currentPrice = (live && live > 0) ? live : (trade.lastKnownPrice && trade.lastKnownPrice > 0 ? trade.lastKnownPrice : 0);
        
        // If price is still 0, we don't have real data yet. Return null to signal "waiting"
        if (currentPrice === 0) return null;
        
        return (currentPrice - trade.entryPrice) * trade.quantity - (trade.charges || 0) - (trade.interest || 0);
      }
      const exitPrice = trade.exitPrice || 0;
      return (exitPrice - trade.entryPrice) * trade.quantity - (trade.charges || 0) - (trade.interest || 0);
    }
    return 0;
  }, [currentPrices]);

  const calculateHoldingPeriod = useCallback((item: Trade | Bond) => {
    const entryDateStr = 'entryDate' in item ? item.entryDate : item.purchaseDate;
    const exitDateStr = 'exitDate' in item ? item.exitDate : undefined;
    
    if (!entryDateStr) return 0;
    
    const start = startOfDay(new Date(entryDateStr));
    const end = exitDateStr ? startOfDay(new Date(exitDateStr)) : startOfDay(new Date());
    
    return Math.max(0, differenceInDays(end, start));
  }, []);

  const unifiedList = useMemo(() => {
    const normalizedTrades = trades.map(t => ({ 
      ...t, 
      collection: 'trades' as const,
      original: t,
      type: t.type || 'Stock',
      sector: formatSector(t.stockSymbol, t.sector),
      broker: t.broker || 'N/A'
    }));
    const normalizedBonds = bonds.filter(b => b.status === 'Exited').map(b => ({
      ...b,
      collection: 'bonds' as const,
      original: b,
      stockName: b.name,
      stockSymbol: 'BOND',
      type: 'Bond' as const,
      entryDate: b.purchaseDate,
      entryPrice: b.principal,
      quantity: 1,
      sector: 'Fixed Income',
      marketCap: 'N/A' as const,
      broker: b.broker || 'N/A',
      status: b.status === 'Exited' ? 'Sold' : 'Active'
    }));
    return [...normalizedTrades, ...normalizedBonds];
  }, [trades, bonds]);

  const filteredTrades = useMemo(() => {
    // Stage 1: Preliminary Filtering (everything except search)
    const baseFiltered = (unifiedList as any[]).filter((t) => {
      const isLotClosed = t.status === 'Sold' || t.status === 'Exited';
      const matchesLotStatus = lotStatusFilter === 'All' || 
                              (lotStatusFilter === 'Open' ? !isLotClosed : isLotClosed);
      
      const matchesStatus = filter === 'All' || t.status === filter || (filter === 'Sold' && t.status === 'Exited') || (filter === 'Active' && t.status === 'Pending Link');
      const matchesSector = sectorFilter === 'All' || t.sector === sectorFilter;
      const dynamicMarketCap = (t.type === 'ETF' || t.type === 'Mutual Fund') ? 'N/A' : getMarketCapCategory(t.stockSymbol, t.marketCapValue, t.marketCap);
      const matchesCap = capFilter === 'All' || dynamicMarketCap === capFilter;
      const matchesType = typeFilter === 'All' || t.type === typeFilter;
      
      const days = calculateHoldingPeriod(t);
      const matchesTerm = termFilter === 'All' || 
                         (termFilter === 'Long' ? days > 365 : days <= 365);
      
      const matchesDaysRange = daysRangeFilter === 'All' || (() => {
        if (daysRangeFilter === '0-30') return days <= 30;
        if (daysRangeFilter === '31-90') return days > 30 && days <= 90;
        if (daysRangeFilter === '91-180') return days > 90 && days <= 180;
        if (daysRangeFilter === '181-365') return days > 180 && days <= 365;
        if (daysRangeFilter === '365+') return days > 365;
        return true;
      })();
      
      const matchesBroker = brokerFilter === 'All' || t.broker === brokerFilter;
      
      const profit = calculateProfit(t);
      const matchesProfit = profitFilter === 'All' || 
                           (profitFilter === 'Profitable' ? profit > 0 : profit < 0);
      
      return matchesStatus && matchesSector && matchesCap && matchesType && matchesTerm && matchesBroker && matchesProfit && matchesLotStatus && matchesDaysRange;
    });

    // Stage 2: Fuzzy Search
    if (!searchQuery || searchQuery.trim().length === 0) {
      return baseFiltered;
    }

    const fuse = new Fuse<any>(baseFiltered, {
      keys: [
        { name: 'stockName', weight: 0.5 },
        { name: 'stockSymbol', weight: 0.4 },
        { name: 'sector', weight: 0.1 }
      ],
      threshold: 0.3, // Lower is stricter, higher is fuzzier
      ignoreLocation: true,
      useExtendedSearch: true
    });

    return fuse.search(searchQuery).map(result => result.item);
  }, [trades, filter, sectorFilter, capFilter, typeFilter, brokerFilter, profitFilter, lotStatusFilter, daysRangeFilter, searchQuery, termFilter, calculateHoldingPeriod, calculateProfit, unifiedList]);

  const sortedTrades = useMemo(() => {
    // Pre-calculate computed fields to avoid redundant calculations during sort
    const tradesWithComputed = filteredTrades.map(trade => {
      const live = currentPrices[trade.stockSymbol];
      // Consistent fallback logic (wait for real data)
      const currentPrice = (live && live > 0) ? live : (trade.lastKnownPrice && trade.lastKnownPrice > 0 ? trade.lastKnownPrice : 0);
      return {
        trade,
        profit: calculateProfit(trade),
        days: calculateHoldingPeriod(trade),
        currentPrice
      };
    });

    if (sortConfig.length === 0) return tradesWithComputed.map(t => t.trade);

    const sorted = [...tradesWithComputed].sort((a, b) => {
      for (const sort of sortConfig) {
        let aValue: any;
        let bValue: any;

        if (sort.key === 'profit') {
          aValue = a.profit;
          bValue = b.profit;
        } else if (sort.key === 'days') {
          aValue = a.days;
          bValue = b.days;
        } else if (sort.key === 'currentPrice') {
          aValue = a.currentPrice;
          bValue = b.currentPrice;
        } else if (sort.key === 'sector') {
          aValue = (a.trade.type === 'ETF' ? 'ETF' : a.trade.type === 'Mutual Fund' ? 'Mutual Fund' : a.trade.sector) || '';
          bValue = (b.trade.type === 'ETF' ? 'ETF' : b.trade.type === 'Mutual Fund' ? 'Mutual Fund' : b.trade.sector) || '';
        } else {
          aValue = a.trade[sort.key as keyof Trade] || '';
          bValue = b.trade[sort.key as keyof Trade] || '';
        }

        if (aValue < bValue) return sort.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sort.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return sorted.map(s => s.trade);
  }, [filteredTrades, sortConfig, currentPrices]);

  const requestSort = (key: SortItem['key'], multi: boolean = false) => {
    setSortConfig(prev => {
      const existingIndex = prev.findIndex(s => s.key === key);
      
      if (multi) {
        // Multi-column sorting: holding Shift
        const newSort = [...prev];
        if (existingIndex > -1) {
          // Toggle direction: asc -> desc -> remove
          if (newSort[existingIndex].direction === 'asc') {
            newSort[existingIndex] = { ...newSort[existingIndex], direction: 'desc' };
            return newSort;
          } else {
            // Remove if already desc
            return newSort.filter((_, i) => i !== existingIndex);
          }
        } else {
          // Add as a secondary sort
          return [...prev, { key, direction: 'asc' }];
        }
      } else {
        // Single column sort: click without Shift
        // If it's already the primary/only sort column, toggle direction
        if (prev.length === 1 && prev[0].key === key) {
          return [{ key, direction: prev[0].direction === 'asc' ? 'desc' : 'asc' }];
        }
        // Otherwise, replace all existing sorts with this column
        return [{ key, direction: 'asc' }];
      }
    });
  };

  const getSortIcon = (key: string) => {
    const sort = sortConfig.find(s => s.key === key);
    const index = sortConfig.findIndex(s => s.key === key);
    
    if (!sort) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-30" />;
    
    return (
      <div className="flex items-center">
        {sort.direction === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />}
        {sortConfig.length > 1 && (
          <span className="ml-0.5 text-[8px] bg-primary text-primary-foreground rounded-full w-3 h-3 flex items-center justify-center">
            {index + 1}
          </span>
        )}
      </div>
    );
  };

  const getRowHighlight = (trade: Trade) => {
    if (trade.status !== 'Active') return '';
    const days = calculateHoldingPeriod(trade);
    const profit = calculateProfit(trade);
    
    // Red if held > 365 days but underperforming (negative profit)
    if (days > 365 && profit < 0) return 'bg-red-500/10 border-l-4 border-l-red-500';
    // Green if profitable
    if (profit > 0) return 'bg-green-500/10 border-l-4 border-l-green-500';
    return '';
  };

  const getAgeColor = (days: number) => {
    if (days < 30) return 'bg-green-500/10 text-green-600 border-green-200';
    if (days <= 365) return 'bg-yellow-500/10 text-yellow-600 border-yellow-200';
    return 'bg-red-500/10 text-red-600 border-red-200';
  };

  const clearAllFilters = () => {
    setFilter('All');
    setSectorFilter('All');
    setCapFilter('All');
    setTermFilter('All');
    setLotStatusFilter('All');
    setDaysRangeFilter('All');
    setTypeFilter('All');
    setBrokerFilter('All');
    setProfitFilter('All');
    setSearchQuery('');
    setSortConfig([{ key: 'days', direction: 'desc' }]);
  };

  const isFilterActive = filter !== 'All' || sectorFilter !== 'All' || capFilter !== 'All' || termFilter !== 'All' || typeFilter !== 'All' || brokerFilter !== 'All' || profitFilter !== 'All' || lotStatusFilter !== 'All' || daysRangeFilter !== 'All' || searchQuery !== '' || (sortConfig.length > 1 || (sortConfig.length === 1 && (sortConfig[0].key !== 'days' || sortConfig[0].direction !== 'desc')));

  const totalPnL = useMemo(() => {
    return sortedTrades.reduce((acc, trade) => acc + calculateProfit(trade), 0);
  }, [sortedTrades, calculateProfit]);

  const assetCounts = useMemo(() => {
    const counts = { Stock: 0, Bond: 0, 'Mutual Fund': 0, ETF: 0 };
    sortedTrades.forEach(t => {
      const type = (t.type || 'Stock') as keyof typeof counts;
      if (counts.hasOwnProperty(type)) {
        counts[type]++;
      }
    });
    return counts;
  }, [sortedTrades]);

  const exportToCSV = () => {
    const headers = ['Asset', 'Symbol', 'Type', 'Sector', 'Broker', 'Entry Date', 'Exit Date', 'Buy Price', 'Current/Exit Price', 'Quantity', 'Days Held', 'P&L'];
    const rows = sortedTrades.map(trade => {
      const profit = calculateProfit(trade);
      const days = calculateHoldingPeriod(trade);
      const currentOrExitPrice = trade.status === 'Active' 
        ? (currentPrices[trade.stockSymbol] || trade.lastKnownPrice || trade.entryPrice)
        : (trade.type === 'Bond' ? (trade as any).redemptionAmount : trade.exitPrice);
      
      return [
        trade.stockName,
        trade.stockSymbol,
        trade.type,
        trade.type === 'ETF' ? 'ETF' : trade.sector,
        trade.broker,
        safeFormat(trade.entryDate, 'yyyy-MM-dd'),
        trade.exitDate ? safeFormat(trade.exitDate, 'yyyy-MM-dd') : 'Open',
        trade.entryPrice,
        currentOrExitPrice,
        trade.quantity,
        days,
        profit.toFixed(2)
      ];
    });

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${val}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `trade_log_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xl font-semibold">NSE Portfolio Aging Tracker</h2>
              <p className="text-sm text-muted-foreground">Monitoring holding periods and live performance</p>
            </div>
            {onRefreshPrices && (
              <Button 
                variant="outline" 
                size="icon" 
                onClick={onRefreshPrices}
                className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary transition-all active:rotate-180 duration-500"
                title="Refresh Prices"
              >
                <RefreshCw className={`w-4 h-4 ${fetchingSymbols.size > 0 ? 'animate-spin' : ''}`} />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowFilters(!showFilters)}
              className="sm:hidden h-10 gap-2"
            >
              <Filter className="w-4 h-4" />
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </Button>
            <div className={`px-3 py-1.5 rounded-lg border flex flex-col items-end ${totalPnL >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <span className="text-[9px] font-bold uppercase text-muted-foreground">Filtered P&L</span>
              <span className={`text-sm font-bold ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totalPnL >= 0 ? '+' : ''}₹{totalPnL.toLocaleString()}
              </span>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={exportToCSV}
              disabled={sortedTrades.length === 0}
              className="h-10 text-xs gap-2 border-primary/20 hover:bg-primary/5 hover:text-primary transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </Button>
            {isFilterActive && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={clearAllFilters}
                className="h-10 text-xs gap-2 border-destructive/20 hover:bg-destructive/5 hover:text-destructive transition-colors hidden sm:flex"
              >
                <X className="w-3.5 h-3.5" />
                Clear All
              </Button>
            )}
          </div>
        </div>

          <div className={`${showFilters ? 'grid' : 'hidden'} sm:grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-9 gap-2 sm:gap-4 bg-muted/20 p-2 sm:p-4 rounded-xl border shadow-sm`}>
            <div className="space-y-1 sm:space-y-2 col-span-2">
            <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Search Portfolio</Label>
            <div className="relative group">
              <SearchIcon className="absolute left-3 top-2.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input 
                placeholder="Stock symbol or sector..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 sm:pl-9 h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all"
              />
            </div>
          </div>

          <div className="space-y-1 sm:space-y-2">
            <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Asset Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Assets</SelectItem>
                {ASSET_TYPES.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 sm:space-y-2">
            <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Aging Group</Label>
            <Select value={daysRangeFilter} onValueChange={setDaysRangeFilter}>
              <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Ages</SelectItem>
                <SelectItem value="0-30">0-30 Days</SelectItem>
                <SelectItem value="31-90">31-90 Days</SelectItem>
                <SelectItem value="91-180">91-180 Days</SelectItem>
                <SelectItem value="181-365">181-365 Days</SelectItem>
                <SelectItem value="365+">365+ Days (LT)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 sm:space-y-2">
            <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Trade Status</Label>
            <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
              <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Statuses</SelectItem>
                <SelectItem value="Active">Active Positions</SelectItem>
                <SelectItem value="Sold">Sold / Closed</SelectItem>
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
            <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Market Cap</Label>
            <Select value={capFilter} onValueChange={setCapFilter}>
              <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Market Caps</SelectItem>
                {MARKET_CAPS.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 sm:space-y-2">
            <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Holding Term</Label>
            <Select value={termFilter} onValueChange={(v: any) => setTermFilter(v)}>
              <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Terms</SelectItem>
                <SelectItem value="Short">Short-term (≤1yr)</SelectItem>
                <SelectItem value="Long">Long-term (&gt;1yr)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 sm:space-y-2">
            <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Broker</Label>
            <Select value={brokerFilter} onValueChange={setBrokerFilter}>
              <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Brokers</SelectItem>
                {BROKERS.map(b => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
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

          <div className="space-y-1 sm:space-y-2">
            <Label className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-primary/70 ml-1">Lot Status</Label>
            <Select value={lotStatusFilter} onValueChange={(v: any) => setLotStatusFilter(v)}>
              <SelectTrigger className="h-9 sm:h-10 text-xs sm:text-sm bg-background border-muted-foreground/20 focus:border-primary/50 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Lots</SelectItem>
                <SelectItem value="Open">Open Lots</SelectItem>
                <SelectItem value="Closed">Closed Lots</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {sortConfig.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Active Sort:</span>
            {sortConfig.map((sort, idx) => (
              <Badge key={sort.key} variant="secondary" className="text-[10px] py-0 h-5 flex items-center gap-1">
                {sort.key === 'stockName' ? 'Stock' : 
                 sort.key === 'entryPrice' ? 'Buy Price' : 
                 sort.key === 'days' ? 'Days Held' : 
                 sort.key === 'currentPrice' ? 'Live Price' :
                 sort.key === 'profit' ? 'P&L' : sort.key}
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
            {sortConfig.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
                onClick={() => setSortConfig([])}
              >
                Clear All
              </Button>
            )}
            <span className="text-[9px] text-muted-foreground ml-auto italic hidden sm:inline">
              Tip: Hold Shift + Click to sort by multiple columns
            </span>
          </div>
        )}
      </div>

      <div className="border rounded-xl bg-card shadow-sm overflow-x-auto custom-scrollbar">
        <div className="min-w-[800px] sm:min-w-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead 
                    className="w-[140px] sm:w-[180px] min-w-[140px] cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => requestSort('stockName', e.shiftKey)}
                  >
                    <div className="flex items-center text-[10px] sm:text-xs">Asset {getSortIcon('stockName')}</div>
                  </TableHead>
                  <TableHead 
                    className="min-w-[100px] cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => requestSort('entryDate', e.shiftKey)}
                  >
                    <div className="flex items-center text-[10px] sm:text-xs">Date {getSortIcon('entryDate')}</div>
                  </TableHead>
                  <TableHead 
                    className="hidden sm:table-cell min-w-[100px] cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => requestSort('entryPrice', e.shiftKey)}
                  >
                    <div className="flex items-center text-[10px] sm:text-xs">Buy Price {getSortIcon('entryPrice')}</div>
                  </TableHead>
                  <TableHead 
                    className="hidden sm:table-cell min-w-[80px] cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => requestSort('quantity', e.shiftKey)}
                  >
                    <div className="flex items-center text-[10px] sm:text-xs">Qty {getSortIcon('quantity')}</div>
                  </TableHead>
                  <TableHead 
                    className="text-[10px] sm:text-xs min-w-[100px] cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => requestSort('currentPrice', e.shiftKey)}
                  >
                    <div className="flex items-center">Price {getSortIcon('currentPrice')}</div>
                  </TableHead>
                  <TableHead 
                    className="hidden lg:table-cell min-w-[120px] cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => requestSort('sector', e.shiftKey)}
                  >
                    <div className="flex items-center text-[10px] sm:text-xs">Sector {getSortIcon('sector')}</div>
                  </TableHead>
                  <TableHead 
                    className="hidden lg:table-cell min-w-[120px] cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => requestSort('broker', e.shiftKey)}
                  >
                    <div className="flex items-center text-[10px] sm:text-xs">Broker {getSortIcon('broker')}</div>
                  </TableHead>
                  <TableHead 
                    className="hidden md:table-cell min-w-[100px] cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => requestSort('days', e.shiftKey)}
                  >
                    <div className="flex items-center text-[10px] sm:text-xs">Days {getSortIcon('days')}</div>
                  </TableHead>
                  <TableHead 
                    className="text-right min-w-[120px] cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => requestSort('profit', e.shiftKey)}
                  >
                    <div className="flex items-center justify-end text-[10px] sm:text-xs">P&L {getSortIcon('profit')}</div>
                  </TableHead>
                </TableRow>
              </TableHeader>
                  <TableBody>
                    {sortedTrades.map((trade, index) => {
                      const profit = calculateProfit(trade);
                      const days = calculateHoldingPeriod(trade);
                      const live = currentPrices[trade.stockSymbol];
                      // User requested: Do not set Current Price = Buy Price if live price is missing.
                      const currentPrice = trade.type === 'Bond' ? undefined : ((live && live > 0) ? live : (trade.lastKnownPrice && trade.lastKnownPrice > 0 ? trade.lastKnownPrice : 0));
                      
                      return (
                        <TableRow key={trade.id} className={`hover:bg-muted/30 transition-colors ${getRowHighlight(trade)}`}>
                          <TableCell className="font-medium py-3 min-w-[140px]">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs sm:text-base font-bold leading-tight">
                                  {trade.stockName || trade.symbol || trade.stockSymbol || "Unlinked"}
                                </span>
                                <span className={`text-[7px] sm:text-[8px] font-bold uppercase px-1 rounded border ${trade.type === 'Stock' ? 'bg-blue-50 text-blue-600 border-blue-200' : trade.type === 'ETF' ? 'bg-purple-50 text-purple-600 border-purple-200' : trade.type === 'Bond' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-orange-50 text-orange-600 border-orange-200'}`}>
                                  {trade.type}
                                </span>
                              </div>
                              <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground font-bold mt-0.5">
                                {trade.type === 'ETF' ? 'Nifty/ETF' : (trade.type === 'Mutual Fund' ? 'Mutual Fund' : (trade.type === 'Bond' ? 'Fixed Income' : (trade.sector || 'Pending...')))}
                              </span>
                              {trade.remarks && (
                                <span className="text-[9px] text-blue-600 font-medium italic mt-1 line-clamp-1" title={trade.remarks}>
                                  "{trade.remarks}"
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[100px]">
                            <div className="flex flex-col">
                              <Badge variant={trade.exitDate ? "secondary" : "outline"} className={`text-[9px] uppercase w-fit mb-1 ${!trade.exitDate ? 'bg-green-50 text-green-700 border-green-200' : ''}`}>
                                {trade.exitDate ? 'Closed' : 'Open'}
                              </Badge>
                              <span className="text-xs font-bold">{safeFormat(trade.entryDate, 'dd MMM yy')}</span>
                              {trade.status === 'Sold' && trade.exitDate && (
                                <span className="text-[9px] text-muted-foreground">Exited: {safeFormat(trade.exitDate, 'dd MMM yy')}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm hidden sm:table-cell min-w-[100px]">
                            ₹{(trade.entryPrice || 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-sm hidden sm:table-cell min-w-[80px]">
                            {(trade.quantity || 0)}
                          </TableCell>
                          <TableCell className="text-sm font-mono min-w-[100px]">
                            <div className="flex flex-col">
                              {trade.status === 'Active' ? (
                                trade.type === 'Bond' ? (
                                  <span className="text-xs text-muted-foreground italic">Fixed Income</span>
                                ) : (
                                  fetchingSymbols.has(trade.stockSymbol) ? (
                                    <div className="flex items-center gap-1.5 text-muted-foreground animate-pulse">
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      <span className="text-[10px]">Fetching...</span>
                                    </div>
                                  ) : (
                                    (currentPrice !== undefined && currentPrice !== null && currentPrice > 0) 
                                      ? `₹${currentPrice.toLocaleString()}` 
                                      : (trade.lastKnownPrice ? (
                                          <div className="flex flex-col items-end">
                                            <span className="text-muted-foreground line-through decoration-transparent">₹{trade.lastKnownPrice.toLocaleString()}</span>
                                            <span className="text-[8px] text-muted-foreground uppercase">Last Price</span>
                                          </div>
                                        ) : 'Fetching...')
                                  )
                                )
                              ) : (
                                trade.type === 'Bond' ? (
                                  `₹${trade.redemptionAmount?.toLocaleString()}`
                                ) : (
                                  `₹${trade.exitPrice?.toLocaleString()}`
                                )
                              )}
                              <span className="md:hidden text-[10px] text-muted-foreground mt-0.5">{(isNaN(days) ? '--' : days)}d</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm hidden lg:table-cell min-w-[120px]">
                            {trade.type === 'ETF' ? 'Nifty/ETF' : (trade.type === 'Mutual Fund' ? '-' : (trade.type === 'Bond' ? 'Fixed Income' : (trade.sector || 'Pending...')))}
                          </TableCell>
                          <TableCell className="text-sm hidden lg:table-cell min-w-[120px]">
                            {trade.broker || 'Pending...'}
                          </TableCell>
                          <TableCell className="hidden md:table-cell min-w-[100px]">
                            <div className="flex flex-col gap-1">
                              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold ${getAgeColor(days)}`}>
                                {isNaN(days) ? '--' : days} Days
                              </div>
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border w-fit ${days > 365 ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                {days > 365 ? 'Long-term' : 'Short-term'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right py-3 min-w-[120px]">
                            <div className="flex flex-col items-end gap-1">
                              {profit === null ? (
                                <span className="text-[10px] text-muted-foreground animate-pulse font-medium italic">Waiting for Price...</span>
                              ) : (
                                <>
                                  <span className={`font-bold text-xs sm:text-sm ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {profit >= 0 ? '+' : ''}₹{(Math.abs(profit) || 0).toLocaleString()}
                                  </span>
                                  {trade.type === 'Bond' && trade.status === 'Active' && (Number((trade as any).accruedInterest) || 0) > 0 && (
                                    <span className="text-[9px] text-blue-600 font-medium">Incl. ₹{(Number((trade as any).accruedInterest) || 0).toLocaleString()} accrued</span>
                                  )}
                                </>
                              )}
                              <div className="flex items-center gap-0.5 sm:gap-1">
                                {(days !== undefined && days !== null) && (
                                  <div className={`sm:hidden inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-bold ${getAgeColor(Number(days) || 0)}`}>
                                    {Number(days) || 0} Days
                                  </div>
                                )}
                                {trade.status === 'Active' && (
                                  <>
                                    {trade.type !== 'Bond' && (
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => onAddMore(trade)} 
                                        className="h-7 w-7 sm:h-8 sm:w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 border sm:border-0"
                                        title="Add More"
                                      >
                                        <PlusCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                      </Button>
                                    )}
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      onClick={() => {
                                        if (trade.type === 'Bond' && onExitBond) {
                                          onExitBond(trade.original as any);
                                        } else if (trade.id) {
                                          onExitTrade(trade.original as any);
                                        }
                                      }} 
                                      className="h-7 sm:h-8 px-1.5 sm:px-2 text-[9px] sm:text-[10px] hover:bg-primary/10 border sm:border-0"
                                    >
                                      Exit
                                    </Button>
                                  </>
                                )}
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => onEditTrade(trade.original as any)} 
                                  className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground hover:text-primary border sm:border-0"
                                >
                                  <Edit2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    console.log("TRADELOG: Deleting row at index", index, "ID:", trade.id);
                                    onDeleteTrade(trade, index);
                                  }} 
                                  className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground hover:text-destructive border sm:border-0"
                                >
                                  <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                </Button>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
            <tfoot className="bg-muted/50 font-bold">
              <TableRow>
                <TableCell colSpan={5} className="py-3 px-4">
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground uppercase tracking-wider">
                    <span>Showing:</span>
                    {assetCounts.Stock > 0 && <Badge variant="outline" className="bg-blue-50 text-[9px]">{assetCounts.Stock} Stocks</Badge>}
                    {assetCounts.Bond > 0 && <Badge variant="outline" className="bg-orange-50 text-[9px]">{assetCounts.Bond} Bonds</Badge>}
                    {assetCounts['Mutual Fund'] > 0 && <Badge variant="outline" className="bg-yellow-50 text-[9px]">{assetCounts['Mutual Fund']} MFs</Badge>}
                    {assetCounts.ETF > 0 && <Badge variant="outline" className="bg-purple-50 text-[9px]">{assetCounts.ETF} ETFs</Badge>}
                  </div>
                </TableCell>
                <TableCell colSpan={2} className="text-right py-3">Total Filtered P&L:</TableCell>
                <TableCell className="text-right py-3" colSpan={2}>
                  <span className={`${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {totalPnL >= 0 ? '+' : ''}₹{totalPnL.toLocaleString()}
                  </span>
                </TableCell>
              </TableRow>
            </tfoot>
          </Table>
        </div>
      </div>
    </div>
  );
}


