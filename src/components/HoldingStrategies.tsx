import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs as ShadcnTabs, TabsContent as ShadcnTabsContent, TabsList as ShadcnTabsList, TabsTrigger as ShadcnTabsTrigger } from '@/components/ui/tabs';
import { HoldingStrategy, ProcessedPortfolioEntry, Trade, Dividend } from '@/src/types';
import { calculateXIRR } from '@/src/lib/xirr';
import { 
  Plus, Trash2, Edit3, Target, TrendingUp, TrendingDown, PieChart, 
  Layers, Check, X, Briefcase, Tag, AlertCircle, ArrowRight, ChevronDown, ChevronUp, ShieldCheck, ArrowLeft 
} from 'lucide-react';

const formatXIRR = (val: number | null | undefined) => {
  if (val === null || val === undefined || isNaN(val)) return '--';
  return `${val >= 0 ? '+' : ''}${(val * 100).toFixed(2)}%`;
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

interface HoldingStrategiesProps {
  strategies: HoldingStrategy[];
  portfolioEntries: ProcessedPortfolioEntry[];
  trades?: Trade[];
  dividends?: Dividend[];
  onAddStrategy: (strategy: Omit<HoldingStrategy, 'id' | 'uid'>) => Promise<void>;
  onUpdateStrategy: (id: string, updated: Partial<HoldingStrategy>) => Promise<void>;
  onDeleteStrategy: (id: string) => Promise<void>;
}

const STRATEGY_COLORS = [
  { name: 'Blue', value: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400', hex: '#3b82f6' },
  { name: 'Emerald', value: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400', hex: '#10b981' },
  { name: 'Purple', value: 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400', hex: '#8b5cf6' },
  { name: 'Amber', value: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400', hex: '#f59e0b' },
  { name: 'Rose', value: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400', hex: '#f43f5e' },
  { name: 'Indigo', value: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20 dark:text-indigo-400', hex: '#6366f1' },
  { name: 'Cyan', value: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20 dark:text-cyan-400', hex: '#06b6d4' },
  { name: 'Slate', value: 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400', hex: '#64748b' },
];

export function HoldingStrategies({
  strategies,
  portfolioEntries,
  trades = [],
  dividends = [],
  onAddStrategy,
  onUpdateStrategy,
  onDeleteStrategy
}: HoldingStrategiesProps) {
  // Subtab navigation state
  const [activeSubTab, setActiveSubTab] = useState<string>('dashboard');

  // Modal / Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetPercentage, setTargetPercentage] = useState('');
  const [color, setColor] = useState(STRATEGY_COLORS[0].value);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);

  // Add Stock Dialog state per strategy
  const [addingToStrategyId, setAddingToStrategyId] = useState<string | null>(null);
  const [selectedSymbolToAdd, setSelectedSymbolToAdd] = useState<string>('');

  // Assign Unassigned Stock state
  const [assigningSymbol, setAssigningSymbol] = useState<string | null>(null);
  const [targetStrategyId, setTargetStrategyId] = useState<string>('');
  const [mappingTab, setMappingTab] = useState<'all' | 'unassigned'>('all');

  // Expanded strategy view
  const [expandedStrategyId, setExpandedStrategyId] = useState<string | null>(null);

  // Consolidate duplicate stock trades into a single entry per stock symbol
  const consolidatedPortfolio = useMemo(() => {
    const map = new Map<string, ProcessedPortfolioEntry>();

    portfolioEntries.forEach(entry => {
      const existing = map.get(entry.symbol);
      if (!existing) {
        map.set(entry.symbol, { ...entry });
      } else {
        const totalQty = existing.quantity + entry.quantity;
        const totalInv = existing.investment + entry.investment;
        const totalVal = existing.currentValue + entry.currentValue;
        const totalPnl = totalVal - totalInv;
        
        let latestDate = existing.entryDate;
        if (entry.entryDate) {
          if (!latestDate || new Date(entry.entryDate).getTime() > new Date(latestDate).getTime()) {
            latestDate = entry.entryDate;
          }
        }

        map.set(entry.symbol, {
          ...existing,
          quantity: totalQty,
          investment: totalInv,
          currentValue: totalVal,
          entryPrice: totalQty > 0 ? totalInv / totalQty : existing.entryPrice,
          currentPrice: totalQty > 0 ? totalVal / totalQty : existing.currentPrice,
          pnl: totalPnl,
          pnlPercent: totalInv > 0 ? (totalPnl / totalInv) * 100 : 0,
          isSIP: existing.isSIP || entry.isSIP,
          entryDate: latestDate
        });
      }
    });

    const list = Array.from(map.values());
    list.forEach(item => {
      const activeTrades = (trades || []).filter(
        t => t.stockSymbol === item.symbol && (t.status === 'Active' || t.status === 'Pending Link') && t.entryDate
      );
      if (activeTrades.length > 0) {
        activeTrades.sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime());
        item.entryDate = activeTrades[0].entryDate;
      }
    });

    return list;
  }, [portfolioEntries, trades]);

  // Total Portfolio Invested
  const totalPortfolioInvested = useMemo(() => {
    return consolidatedPortfolio.reduce((acc, entry) => acc + entry.investment, 0);
  }, [consolidatedPortfolio]);

  // Calculate strategy analytics (Unrealized + Realized + XIRR)
  const strategyStats = useMemo(() => {
    return strategies.map(strategy => {
      const symbolsSet = new Set(strategy.stockSymbols || []);
      const matchedEntries = consolidatedPortfolio.filter(e => symbolsSet.has(e.symbol));
      
      const invested = matchedEntries.reduce((acc, e) => acc + e.investment, 0);
      const currentValue = matchedEntries.reduce((acc, e) => acc + e.currentValue, 0);
      const unrealizedPnl = currentValue - invested;
      const unrealizedPnlPercent = invested > 0 ? (unrealizedPnl / invested) * 100 : 0;
      const actualAllocation = totalPortfolioInvested > 0 ? (invested / totalPortfolioInvested) * 100 : 0;

      // Closed/Sold trades for symbols assigned to this strategy
      const matchedSoldTrades = (trades || []).filter(
        t => t.status === 'Sold' && symbolsSet.has(t.stockSymbol)
      );

      const realizedPnl = matchedSoldTrades.reduce((acc, t) => {
        const exit = t.exitPrice || 0;
        const buy = t.entryPrice || 0;
        const qty = t.quantity || 0;
        const chg = t.charges || 0;
        const int = t.interest || 0;
        return acc + ((exit - buy) * qty - chg - int);
      }, 0);

      const soldCostBasis = matchedSoldTrades.reduce((acc, t) => {
        return acc + (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
      }, 0);

      const realizedPnlPercent = soldCostBasis > 0 ? (realizedPnl / soldCostBasis) * 100 : 0;
      const totalPnl = unrealizedPnl + realizedPnl;
      const totalCostBasis = invested + soldCostBasis;
      const totalPnlPercent = totalCostBasis > 0 ? (totalPnl / totalCostBasis) * 100 : (invested > 0 ? (totalPnl / invested) * 100 : 0);

      // Cash flows for Strategy XIRR
      const flows: { amount: number; date: string }[] = [];
      const matchingTrades = (trades || []).filter(t => symbolsSet.has(t.stockSymbol));

      matchingTrades.forEach(t => {
        const cost = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
        if (cost > 0 && t.entryDate) {
          flows.push({ amount: -cost, date: t.entryDate });
        }

        if (t.status === 'Sold' && t.exitPrice && t.exitDate) {
          const proceeds = (t.exitPrice * t.quantity) - (t.charges || 0) - (t.interest || 0);
          flows.push({ amount: proceeds, date: t.exitDate });
        }
      });

      (dividends || []).forEach(d => {
        const stockNameLower = d.stockName?.toLowerCase() || '';
        const isMatch = Array.from<string>(symbolsSet).some((sym: string) => 
          sym.toLowerCase() === stockNameLower || stockNameLower.includes(sym.toLowerCase())
        );
        if (isMatch) {
          flows.push({
            amount: d.amount,
            date: d.date || `${d.month}-01`
          });
        }
      });

      if (currentValue > 0) {
        flows.push({
          amount: currentValue,
          date: new Date().toISOString().split('T')[0]
        });
      }

      let xirr: number | null = null;
      if (flows.length >= 2) {
        try {
          xirr = calculateXIRR(flows);
        } catch (e) {
          // Ignore convergence errors
        }
      }

      return {
        ...strategy,
        matchedEntries,
        matchedSoldTrades,
        invested,
        currentValue,
        unrealizedPnl,
        unrealizedPnlPercent,
        realizedPnl,
        realizedPnlPercent,
        pnl: totalPnl,
        pnlPercent: totalPnlPercent,
        xirr,
        actualAllocation,
        count: matchedEntries.length
      };
    });
  }, [strategies, consolidatedPortfolio, totalPortfolioInvested, trades, dividends]);

  // Unique assigned stocks set
  const assignedSymbolsSet = useMemo(() => {
    const assignedSymbols = new Set<string>();
    strategies.forEach(s => {
      (s.stockSymbols || []).forEach(sym => assignedSymbols.add(sym));
    });
    return assignedSymbols;
  }, [strategies]);

  // Unassigned stocks
  const unassignedEntries = useMemo(() => {
    return consolidatedPortfolio.filter(e => !assignedSymbolsSet.has(e.symbol));
  }, [consolidatedPortfolio, assignedSymbolsSet]);

  // Unique assigned entries for portfolio summary calculations (prevents double counting when in multiple strategies)
  const uniqueAssignedEntries = useMemo(() => {
    return consolidatedPortfolio.filter(e => assignedSymbolsSet.has(e.symbol));
  }, [consolidatedPortfolio, assignedSymbolsSet]);

  const totalAssignedInvested = useMemo(() => {
    return uniqueAssignedEntries.reduce((acc, e) => acc + e.investment, 0);
  }, [uniqueAssignedEntries]);

  const totalAssignedUnrealizedPnl = useMemo(() => {
    return uniqueAssignedEntries.reduce((acc, e) => acc + e.pnl, 0);
  }, [uniqueAssignedEntries]);

  const totalAssignedRealizedPnl = useMemo(() => {
    const assignedSoldTrades = (trades || []).filter(
      t => t.status === 'Sold' && assignedSymbolsSet.has(t.stockSymbol)
    );
    return assignedSoldTrades.reduce((acc, t) => {
      const exit = t.exitPrice || 0;
      const buy = t.entryPrice || 0;
      const qty = t.quantity || 0;
      const chg = t.charges || 0;
      const int = t.interest || 0;
      return acc + ((exit - buy) * qty - chg - int);
    }, 0);
  }, [trades, assignedSymbolsSet]);

  const totalAssignedNetPnl = totalAssignedUnrealizedPnl + totalAssignedRealizedPnl;

  const totalAssignedXIRR = useMemo(() => {
    if (assignedSymbolsSet.size === 0) return null;

    const flows: { amount: number; date: string }[] = [];
    const assignedTrades = (trades || []).filter(t => assignedSymbolsSet.has(t.stockSymbol));

    assignedTrades.forEach(t => {
      const cost = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
      if (cost > 0 && t.entryDate) {
        flows.push({ amount: -cost, date: t.entryDate });
      }

      if (t.status === 'Sold' && t.exitPrice && t.exitDate) {
        const proceeds = (t.exitPrice * t.quantity) - (t.charges || 0) - (t.interest || 0);
        flows.push({ amount: proceeds, date: t.exitDate });
      }
    });

    (dividends || []).forEach(d => {
      const stockNameLower = d.stockName?.toLowerCase() || '';
      const isMatch = Array.from<string>(assignedSymbolsSet).some((sym: string) =>
        sym.toLowerCase() === stockNameLower || stockNameLower.includes(sym.toLowerCase())
      );
      if (isMatch) {
        flows.push({
          amount: d.amount,
          date: d.date || `${d.month}-01`
        });
      }
    });

    const totalAssignedCurrentValue = uniqueAssignedEntries.reduce((acc, e) => acc + e.currentValue, 0);
    if (totalAssignedCurrentValue > 0) {
      flows.push({
        amount: totalAssignedCurrentValue,
        date: new Date().toISOString().split('T')[0]
      });
    }

    if (flows.length < 2) return null;
    try {
      return calculateXIRR(flows);
    } catch (e) {
      return null;
    }
  }, [assignedSymbolsSet, trades, dividends, uniqueAssignedEntries]);

  const totalAssignedAllocation = totalPortfolioInvested > 0 
    ? (totalAssignedInvested / totalPortfolioInvested) * 100 
    : 0;

  // Open create form
  const handleOpenCreate = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setTargetPercentage('');
    setColor(STRATEGY_COLORS[0].value);
    setSelectedSymbols([]);
    setIsFormOpen(true);
  };

  // Open edit form
  const handleOpenEdit = (strategy: HoldingStrategy) => {
    setEditingId(strategy.id || null);
    setName(strategy.name);
    setDescription(strategy.description || '');
    setTargetPercentage(strategy.targetPercentage !== undefined ? String(strategy.targetPercentage) : '');
    setColor(strategy.color || STRATEGY_COLORS[0].value);
    setSelectedSymbols(strategy.stockSymbols || []);
    setIsFormOpen(true);
  };

  // Toggle symbol selection in form
  const toggleSymbolSelection = (symbol: string) => {
    if (selectedSymbols.includes(symbol)) {
      setSelectedSymbols(selectedSymbols.filter(s => s !== symbol));
    } else {
      setSelectedSymbols([...selectedSymbols, symbol]);
    }
  };

  // Submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const payload = {
      name: name.trim(),
      description: description.trim(),
      targetPercentage: targetPercentage ? parseFloat(targetPercentage) : undefined,
      color,
      stockSymbols: selectedSymbols,
      createdAt: new Date().toISOString(),
    };

    if (editingId) {
      await onUpdateStrategy(editingId, payload);
    } else {
      await onAddStrategy(payload);
    }

    setIsFormOpen(false);
  };

  // Add single bought stock to strategy
  const handleAddStockToStrategy = async (strategyId: string, symbolToAdd: string) => {
    if (!symbolToAdd) return;
    const strategy = strategies.find(s => s.id === strategyId);
    if (!strategy) return;

    const updatedSymbols = Array.from(new Set([...(strategy.stockSymbols || []), symbolToAdd]));
    await onUpdateStrategy(strategyId, { stockSymbols: updatedSymbols });
    setAddingToStrategyId(null);
    setSelectedSymbolToAdd('');
  };

  // Remove stock from strategy
  const handleRemoveStockFromStrategy = async (strategyId: string, symbolToRemove: string) => {
    const strategy = strategies.find(s => s.id === strategyId);
    if (!strategy) return;

    const updatedSymbols = (strategy.stockSymbols || []).filter(s => s !== symbolToRemove);
    await onUpdateStrategy(strategyId, { stockSymbols: updatedSymbols });
  };

  // Assign unassigned stock to target strategy
  const handleAssignUnassigned = async () => {
    if (!assigningSymbol || !targetStrategyId) return;
    await handleAddStockToStrategy(targetStrategyId, assigningSymbol);
    setAssigningSymbol(null);
    setTargetStrategyId('');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Create / Edit Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card border rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                {editingId ? 'Edit Holding Strategy' : 'Create Holding Strategy'}
              </h3>
              <button onClick={() => setIsFormOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="strat-name">Strategy Name *</Label>
                <Input
                  id="strat-name"
                  placeholder="e.g., Core Long-Term, Dividend Yield, High Momentum"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="strat-target">Target Portfolio % (Optional)</Label>
                  <Input
                    id="strat-target"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    placeholder="e.g., 40"
                    value={targetPercentage}
                    onChange={(e) => setTargetPercentage(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Badge Color Theme</Label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {STRATEGY_COLORS.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => setColor(c.value)}
                        className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c.value ? 'scale-125 ring-2 ring-primary ring-offset-2' : 'opacity-70 hover:opacity-100'}`}
                        style={{ backgroundColor: c.hex }}
                        title={c.name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="strat-desc">Description / Investment Thesis (Optional)</Label>
                <Input
                  id="strat-desc"
                  placeholder="e.g., Bluechips held for 5+ years with consistent dividend growth"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {/* Bought Stocks Multi-Selector */}
              <div className="space-y-2 pt-2">
                <Label className="flex items-center justify-between">
                  <span>Assign Your Bought Stocks / ETFs</span>
                  <span className="text-xs text-muted-foreground">{selectedSymbols.length} selected</span>
                </Label>
                <div className="border rounded-xl p-3 max-h-48 overflow-y-auto space-y-2 bg-muted/20 custom-scrollbar">
                  {consolidatedPortfolio.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No bought holdings found in your portfolio yet.</p>
                  ) : (
                    consolidatedPortfolio.map((entry) => {
                      const isSelected = selectedSymbols.includes(entry.symbol);
                      return (
                        <div
                          key={entry.symbol}
                          onClick={() => toggleSymbolSelection(entry.symbol)}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                            isSelected ? 'bg-primary/10 border border-primary/30 font-medium' : 'hover:bg-muted border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <div className={`w-4 h-4 rounded flex items-center justify-center border ${isSelected ? 'bg-primary text-primary-foreground border-primary' : 'border-muted-foreground/40'}`}>
                              {isSelected && <Check className="w-3 h-3" />}
                            </div>
                            <span className="font-bold">{entry.symbol}</span>
                            <span className="text-muted-foreground truncate">{entry.name}</span>
                          </div>
                          <span className="font-mono opacity-80 shrink-0">₹{entry.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingId ? 'Save Changes' : 'Create Strategy'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Stock Dialog */}
      {addingToStrategyId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-md font-bold">Add Bought Stock to Strategy</h3>
              <button onClick={() => setAddingToStrategyId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <Label>Select from your portfolio holdings:</Label>
              <select
                className="w-full bg-background border rounded-lg p-2.5 text-sm"
                value={selectedSymbolToAdd}
                onChange={(e) => setSelectedSymbolToAdd(e.target.value)}
              >
                <option value="">-- Choose a stock / ETF --</option>
                {consolidatedPortfolio
                  .filter(entry => {
                    const strat = strategies.find(s => s.id === addingToStrategyId);
                    return !strat?.stockSymbols?.includes(entry.symbol);
                  })
                  .map(entry => (
                    <option key={entry.symbol} value={entry.symbol}>
                      {entry.symbol} - {entry.name} (₹{entry.currentValue.toLocaleString()})
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setAddingToStrategyId(null)}>Cancel</Button>
              <Button 
                size="sm" 
                disabled={!selectedSymbolToAdd}
                onClick={() => handleAddStockToStrategy(addingToStrategyId, selectedSymbolToAdd)}
              >
                Add to Strategy
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Unassigned Stock Dialog */}
      {assigningSymbol && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-md font-bold flex items-center gap-2">
                <Tag className="w-4 h-4 text-primary" />
                Assign {assigningSymbol} to Strategy
              </h3>
              <button onClick={() => { setAssigningSymbol(null); setTargetStrategyId(''); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {(() => {
              const stock = consolidatedPortfolio.find(e => e.symbol === assigningSymbol);
              return stock ? (
                <div className="p-3 rounded-xl bg-muted/30 border text-xs space-y-1">
                  <div className="flex justify-between font-bold text-sm">
                    <span>{stock.symbol}</span>
                    <span className="font-mono text-primary">₹{stock.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{stock.name}</span>
                    <span>{stock.quantity} Qty</span>
                  </div>
                </div>
              ) : null;
            })()}

            <div className="space-y-3">
              <Label>Select Target Strategy Bucket:</Label>
              <select
                className="w-full bg-background border rounded-lg p-2.5 text-sm font-medium"
                value={targetStrategyId}
                onChange={(e) => setTargetStrategyId(e.target.value)}
              >
                <option value="">-- Choose a Strategy --</option>
                {strategies.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs text-primary px-0"
                onClick={() => {
                  setAssigningSymbol(null);
                  handleOpenCreate();
                }}
              >
                + Create New Strategy
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { setAssigningSymbol(null); setTargetStrategyId(''); }}>Cancel</Button>
                <Button 
                  size="sm" 
                  disabled={!targetStrategyId}
                  onClick={handleAssignUnassigned}
                >
                  Confirm Assignment
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subtab Navigation Bar */}
      <ShadcnTabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-muted/40 p-2 rounded-2xl border shadow-xs">
          <ShadcnTabsList className="flex flex-wrap h-auto gap-1.5 bg-transparent p-0">
            <ShadcnTabsTrigger value="dashboard" className="text-xs sm:text-sm font-bold flex items-center gap-1.5 px-3.5 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-xl transition-all">
              <PieChart className="w-4 h-4 text-primary" />
              Strategies Dashboard
            </ShadcnTabsTrigger>
            <ShadcnTabsTrigger value="unassigned" className="text-xs sm:text-sm font-bold flex items-center gap-1.5 px-3.5 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-xl transition-all">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              Unassigned Stocks ({unassignedEntries.length})
            </ShadcnTabsTrigger>
            {strategyStats.map((strat) => (
              <ShadcnTabsTrigger key={strat.id} value={strat.id || 'strat'} className="text-xs sm:text-sm font-bold flex items-center gap-1.5 px-3.5 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-xl transition-all">
                <span className={`w-2.5 h-2.5 rounded-full ${strat.color?.split(' ')[0] || 'bg-primary'}`} />
                {strat.name}
              </ShadcnTabsTrigger>
            ))}
          </ShadcnTabsList>

          <Button onClick={handleOpenCreate} size="sm" className="shrink-0 text-xs font-bold shadow-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> New Strategy
          </Button>
        </div>

        {/* 1. DASHBOARD SUBTAB CONTENT */}
        <ShadcnTabsContent value="dashboard" className="space-y-8 animate-in fade-in-50 duration-300 m-0">
          {/* Strategies Grid */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold tracking-tight">Your Investment Strategies ({strategies.length})</h3>
            </div>

            {strategyStats.length === 0 ? (
              <Card className="border border-dashed bg-muted/10 p-12 text-center rounded-2xl">
                <div className="max-w-md mx-auto space-y-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                    <Briefcase className="w-6 h-6" />
                  </div>
                  <h4 className="text-base font-bold">No Strategies Created Yet</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Create your first holding strategy to categorize your portfolio into disciplined buckets and monitor their independent returns.
                  </p>
                  <Button onClick={handleOpenCreate} size="sm">
                    <Plus className="w-4 h-4 mr-1.5" /> Create First Strategy
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {strategyStats.map((strategy) => {
                  const isPositive = strategy.pnl >= 0;

                  return (
                    <Card key={strategy.id} className="border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
                      <div>
                        {/* Strategy Header */}
                        <div className="p-5 border-b bg-muted/30 flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-base sm:text-lg font-black tracking-tight">{strategy.name}</h4>
                              <Badge variant="outline" className={`text-[10px] font-bold ${strategy.color || STRATEGY_COLORS[0].value}`}>
                                {strategy.count} {strategy.count === 1 ? 'Holding' : 'Holdings'}
                              </Badge>
                              <Badge variant="outline" className={`text-[10px] font-mono font-bold ${strategy.xirr !== null && strategy.xirr >= 0 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : (strategy.xirr !== null ? 'bg-rose-500/10 text-rose-600 border-rose-500/20' : 'bg-muted text-muted-foreground')}`}>
                                XIRR: {formatXIRR(strategy.xirr)}
                              </Badge>
                              {strategy.targetPercentage !== undefined && (
                                <Badge variant="secondary" className="text-[10px] font-mono">
                                  Target: {strategy.targetPercentage}% | Actual: {strategy.actualAllocation.toFixed(1)}%
                                </Badge>
                              )}
                            </div>
                            {strategy.description && (
                              <p className="text-xs text-muted-foreground line-clamp-2">{strategy.description}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => handleOpenEdit(strategy)}
                              title="Edit Strategy"
                            >
                              <Edit3 className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => strategy.id && onDeleteStrategy(strategy.id)}
                              title="Delete Strategy"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Financial Metrics */}
                        <div className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-2 bg-card border-b">
                          <div className="p-2 rounded-lg bg-muted/20">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground truncate">Active Invested</p>
                            <p className="text-xs sm:text-sm font-black font-mono mt-0.5">
                              ₹{strategy.invested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </p>
                          </div>
                          <div className="p-2 rounded-lg bg-muted/20">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground truncate">Current Value</p>
                            <p className="text-xs sm:text-sm font-black font-mono mt-0.5">
                              ₹{strategy.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </p>
                          </div>
                          <div className="p-2 rounded-lg bg-muted/20">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground truncate">Unrealized P&amp;L</p>
                            <p className={`text-xs sm:text-sm font-black font-mono mt-0.5 flex items-center gap-0.5 ${strategy.unrealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {strategy.unrealizedPnl >= 0 ? '+' : ''}₹{strategy.unrealizedPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              <span className="text-[9px] font-bold opacity-80">({strategy.unrealizedPnl >= 0 ? '+' : ''}{strategy.unrealizedPnlPercent.toFixed(1)}%)</span>
                            </p>
                          </div>
                          <div className="p-2 rounded-lg bg-muted/20">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground truncate">Realized P&amp;L</p>
                            <p className={`text-xs sm:text-sm font-black font-mono mt-0.5 flex items-center gap-0.5 ${strategy.realizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {strategy.realizedPnl >= 0 ? '+' : ''}₹{strategy.realizedPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              <span className="text-[9px] font-bold opacity-75">({strategy.matchedSoldTrades.length} sold)</span>
                            </p>
                          </div>
                          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 col-span-2 sm:col-span-1">
                            <p className="text-[10px] uppercase font-semibold text-blue-600 truncate">Strategy XIRR</p>
                            <p className={`text-xs sm:text-sm font-black font-mono mt-0.5 ${strategy.xirr !== null && strategy.xirr >= 0 ? 'text-emerald-600' : (strategy.xirr !== null ? 'text-rose-600' : '')}`}>
                              {formatXIRR(strategy.xirr)}
                            </p>
                          </div>
                        </div>
                        <div className="px-5 py-2.5 bg-muted/30 border-b flex flex-wrap items-center justify-between text-xs font-bold gap-2">
                          <span className="text-muted-foreground uppercase text-[10px] tracking-wider">Total Strategy Net P&amp;L:</span>
                          <div className="flex items-center gap-2.5">
                            <span className={`font-mono text-xs sm:text-sm font-black ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {isPositive ? '+' : ''}₹{strategy.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({isPositive ? '+' : ''}{strategy.pnlPercent.toFixed(1)}%)
                            </span>
                            <span className="text-muted-foreground font-normal">|</span>
                            <span className={`font-mono text-xs sm:text-sm font-black ${strategy.xirr !== null && strategy.xirr >= 0 ? 'text-emerald-600' : (strategy.xirr !== null ? 'text-rose-600' : 'text-muted-foreground')}`}>
                              XIRR: {formatXIRR(strategy.xirr)}
                            </span>
                          </div>
                        </div>

                        {/* Target Allocation Progress Bar */}
                        {strategy.targetPercentage !== undefined && strategy.targetPercentage > 0 && (
                          <div className="px-5 pt-3 pb-1">
                            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                              <span>Portfolio Allocation</span>
                              <span className="font-mono">{strategy.actualAllocation.toFixed(1)}% / {strategy.targetPercentage}% Target</span>
                            </div>
                            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                              <div 
                                className={`h-full transition-all duration-500 rounded-full ${strategy.actualAllocation > strategy.targetPercentage ? 'bg-amber-500' : 'bg-primary'}`} 
                                style={{ width: `${Math.min(100, (strategy.actualAllocation / strategy.targetPercentage) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Top Holdings Preview */}
                        <div className="p-5 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Included Holdings Preview</span>
                            <span className="text-xs font-mono font-bold text-muted-foreground">{strategy.matchedEntries.length} items</span>
                          </div>

                          {strategy.matchedEntries.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic py-3 text-center border rounded-xl bg-muted/10">
                              No stocks assigned yet. Click button below to open strategy subtab and add stocks.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {strategy.matchedEntries.slice(0, 3).map((entry) => {
                                const entryPos = entry.pnl >= 0;
                                return (
                                  <div key={entry.symbol} className="flex items-center justify-between p-2.5 rounded-xl border bg-muted/20 hover:bg-muted/40 transition-colors text-xs">
                                    <div className="flex flex-col truncate pr-2">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-bold">{entry.symbol}</span>
                                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-normal">
                                          {entry.type}
                                        </Badge>
                                      </div>
                                      <span className="text-[10px] text-muted-foreground truncate">{entry.name} ({entry.quantity} qty)</span>
                                    </div>
                                    <div className="text-right font-mono shrink-0">
                                      <p className="font-bold">₹{entry.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                                      <p className={`text-[10px] font-bold ${entryPos ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {entryPos ? '+' : ''}{entry.pnlPercent.toFixed(1)}%
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                              {strategy.matchedEntries.length > 3 && (
                                <p className="text-[11px] text-center text-muted-foreground pt-1 font-medium">
                                  + {strategy.matchedEntries.length - 3} more holdings in subtab view
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-4 bg-muted/20 border-t flex items-center justify-between">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => strategy.id && setAddingToStrategyId(strategy.id)}
                        >
                          <Plus className="w-3 h-3 mr-1" /> Quick Add Stock
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          className="text-xs font-bold shadow-xs group-hover:bg-primary/90"
                          onClick={() => strategy.id && setActiveSubTab(strategy.id)}
                        >
                          Open Strategy Subtab <ArrowRight className="w-3.5 h-3.5 ml-1" />
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* All Portfolio Holdings Overview */}
          {consolidatedPortfolio.length > 0 && (
            <Card className="border rounded-2xl p-6 bg-muted/10 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                    <Tag className="w-5 h-5 text-primary" />
                    Portfolio Mapping Overview ({consolidatedPortfolio.length} Stocks/ETFs)
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Assign any holding to one or multiple strategy buckets simultaneously.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex bg-muted p-1 rounded-xl text-xs font-medium">
                    <button
                      onClick={() => setMappingTab('all')}
                      className={`px-3 py-1 rounded-lg transition-colors ${mappingTab === 'all' ? 'bg-background shadow-xs text-foreground font-bold' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      All Holdings ({consolidatedPortfolio.length})
                    </button>
                    <button
                      onClick={() => { setMappingTab('unassigned'); setActiveSubTab('unassigned'); }}
                      className={`px-3 py-1 rounded-lg transition-colors ${mappingTab === 'unassigned' ? 'bg-background shadow-xs text-foreground font-bold' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Unassigned ({unassignedEntries.length})
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {consolidatedPortfolio.map((entry) => {
                  const memberStrategies = strategies.filter(s => s.stockSymbols?.includes(entry.symbol));
                  const availableStrategies = strategies.filter(s => !s.stockSymbols?.includes(entry.symbol));

                  return (
                    <div key={entry.symbol} className="flex flex-col justify-between p-3.5 rounded-xl border bg-card text-xs shadow-xs gap-3">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 truncate">
                            <p className="font-bold text-sm">{entry.symbol}</p>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                              {entry.type}
                            </Badge>
                          </div>
                          <span className="font-mono text-xs font-bold text-primary">
                            ₹{entry.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{entry.name} ({entry.quantity} Qty)</p>

                        <div className="flex flex-wrap gap-1 mt-2.5 pt-2 border-t border-dashed">
                          {memberStrategies.length > 0 ? (
                            memberStrategies.map(strat => (
                              <Badge key={strat.id} variant="outline" className={`text-[10px] px-2 py-0.5 flex items-center gap-1 font-medium ${strat.color}`}>
                                {strat.name}
                                <button
                                  onClick={() => strat.id && handleRemoveStockFromStrategy(strat.id, entry.symbol)}
                                  className="hover:opacity-70 ml-0.5 p-0.5"
                                  title={`Remove from ${strat.name}`}
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-2 py-0.5 text-amber-600 bg-amber-500/10 border-amber-500/20">
                              Unassigned
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        {strategies.length > 0 ? (
                          availableStrategies.length > 0 ? (
                            <div className="flex items-center gap-1.5 w-full">
                              <select
                                className="bg-background border rounded-lg px-2 py-1.5 text-xs font-medium cursor-pointer hover:border-primary/50 transition-colors w-full"
                                defaultValue=""
                                onChange={(e) => {
                                  const stratId = e.target.value;
                                  if (stratId) {
                                    handleAddStockToStrategy(stratId, entry.symbol);
                                    e.target.value = "";
                                  }
                                }}
                              >
                                <option value="">+ Add to Strategy ({availableStrategies.length})</option>
                                {availableStrategies.map(s => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic py-1 text-right w-full">In all strategies</span>
                          )
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-primary border-primary/30 w-full"
                            onClick={handleOpenCreate}
                          >
                            + Create Strategy
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </ShadcnTabsContent>

        {/* 2. UNASSIGNED STOCKS SUBTAB CONTENT */}
        <ShadcnTabsContent value="unassigned" className="space-y-6 animate-in fade-in-50 duration-300 m-0">
          <Card className="border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6 pb-4 border-b">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  Unassigned Holdings ({unassignedEntries.length})
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  These stocks and ETFs have not been assigned to any strategy bucket yet. Assign them below to organize 100% of your portfolio.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setActiveSubTab('dashboard')}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Dashboard
              </Button>
            </div>

            {unassignedEntries.length === 0 ? (
              <div className="text-center py-12 bg-muted/10 rounded-2xl border border-dashed">
                <Check className="w-12 h-12 text-emerald-500 mx-auto mb-3 opacity-80" />
                <h4 className="text-base font-bold">100% Portfolio Assigned!</h4>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  Every stock and ETF in your portfolio belongs to at least one strategy bucket. Great job maintaining disciplined portfolio structure.
                </p>
                <Button onClick={() => setActiveSubTab('dashboard')} className="mt-4" size="sm">
                  Return to Dashboard
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {unassignedEntries.map((entry) => (
                  <div key={entry.symbol} className="p-4 rounded-xl border bg-card shadow-sm flex flex-col justify-between gap-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-base font-black">{entry.symbol}</span>
                        <Badge variant="secondary" className="text-xs font-mono font-bold text-primary">
                          ₹{entry.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-1">{entry.name}</p>
                      <div className="flex items-center justify-between text-xs font-mono mt-3 pt-3 border-t text-muted-foreground">
                        <span>Qty: {entry.quantity}</span>
                        <span>Invested: ₹{entry.investment.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t">
                      <Label className="text-[11px] font-bold uppercase text-muted-foreground">Assign to Strategy:</Label>
                      {strategies.length === 0 ? (
                        <Button size="sm" variant="outline" className="w-full text-xs" onClick={handleOpenCreate}>
                          + Create Your First Strategy
                        </Button>
                      ) : (
                        <div className="flex gap-2">
                          <select
                            className="bg-background border rounded-lg px-2.5 py-1.5 text-xs font-medium w-full"
                            defaultValue=""
                            onChange={(e) => {
                              const stratId = e.target.value;
                              if (stratId) {
                                handleAddStockToStrategy(stratId, entry.symbol);
                                e.target.value = "";
                              }
                            }}
                          >
                            <option value="">-- Select Strategy --</option>
                            {strategies.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </ShadcnTabsContent>

        {/* 3. INDIVIDUAL STRATEGY SUBTABS */}
        {strategyStats.map((strat) => {
          const isPos = strat.pnl >= 0;
          return (
            <ShadcnTabsContent key={strat.id} value={strat.id || 'strat'} className="space-y-6 animate-in fade-in-50 duration-300 m-0">
              {/* Strategy Banner */}
              <div className="bg-card border rounded-2xl p-6 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button variant="outline" size="sm" onClick={() => setActiveSubTab('dashboard')} className="h-8 px-2.5 text-xs">
                        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Dashboard
                      </Button>
                      <h3 className="text-xl sm:text-2xl font-black tracking-tight">{strat.name}</h3>
                      <Badge variant="outline" className={`text-xs font-bold px-2.5 py-0.5 ${strat.color || STRATEGY_COLORS[0].value}`}>
                        {strat.count} {strat.count === 1 ? 'Holding' : 'Holdings'}
                      </Badge>
                      {strat.targetPercentage !== undefined && (
                        <Badge variant="secondary" className="text-xs font-mono">
                          Target: {strat.targetPercentage}% | Actual: {strat.actualAllocation.toFixed(1)}%
                        </Badge>
                      )}
                    </div>
                    {strat.description && (
                      <p className="text-sm text-muted-foreground max-w-3xl">{strat.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenEdit(strat)}
                      className="flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> Edit Strategy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (strat.id) {
                          onDeleteStrategy(strat.id);
                          setActiveSubTab('dashboard');
                        }
                      }}
                      className="text-destructive hover:bg-destructive/10 border-destructive/30 flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </Button>
                  </div>
                </div>

                {/* Strategy Financial Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="p-3.5 rounded-xl bg-muted/20 border">
                    <p className="text-[10px] sm:text-xs font-bold uppercase text-muted-foreground">Active Invested</p>
                    <p className="text-base sm:text-xl font-black font-mono mt-1">
                      ₹{strat.invested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-muted/20 border">
                    <p className="text-[10px] sm:text-xs font-bold uppercase text-muted-foreground">Current Value</p>
                    <p className="text-base sm:text-xl font-black font-mono mt-1">
                      ₹{strat.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-muted/20 border">
                    <p className="text-[10px] sm:text-xs font-bold uppercase text-muted-foreground">Unrealized P&amp;L</p>
                    <p className={`text-base sm:text-xl font-black font-mono mt-1 flex items-center gap-1 ${strat.unrealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {strat.unrealizedPnl >= 0 ? '+' : ''}₹{strat.unrealizedPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      <span className="text-[10px] font-bold opacity-80">({strat.unrealizedPnl >= 0 ? '+' : ''}{strat.unrealizedPnlPercent.toFixed(1)}%)</span>
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-muted/20 border">
                    <p className="text-[10px] sm:text-xs font-bold uppercase text-muted-foreground">Realized P&amp;L</p>
                    <p className={`text-base sm:text-xl font-black font-mono mt-1 flex items-center gap-1 ${strat.realizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {strat.realizedPnl >= 0 ? '+' : ''}₹{strat.realizedPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      <span className="text-[10px] font-bold opacity-75">({strat.matchedSoldTrades.length} sold)</span>
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-primary/10 border border-primary/20">
                    <p className="text-[10px] sm:text-xs font-bold uppercase text-primary">Total Net P&amp;L</p>
                    <p className={`text-base sm:text-xl font-black font-mono mt-1 flex items-center gap-1 ${isPos ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {isPos ? '+' : ''}₹{strat.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      <span className="text-[10px] font-bold opacity-80">({isPos ? '+' : ''}{strat.pnlPercent.toFixed(1)}%)</span>
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 col-span-2 sm:col-span-1">
                    <p className="text-[10px] sm:text-xs font-bold uppercase text-blue-600">Strategy XIRR</p>
                    <p className={`text-base sm:text-xl font-black font-mono mt-1 ${strat.xirr !== null && strat.xirr >= 0 ? 'text-emerald-600' : (strat.xirr !== null ? 'text-rose-600' : '')}`}>
                      {formatXIRR(strat.xirr)}
                    </p>
                  </div>
                </div>

                {/* Target Allocation Bar */}
                {strat.targetPercentage !== undefined && strat.targetPercentage > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <div className="flex justify-between text-xs font-bold text-muted-foreground">
                      <span>Portfolio Allocation Progress</span>
                      <span className="font-mono">{strat.actualAllocation.toFixed(1)}% of Portfolio / {strat.targetPercentage}% Target</span>
                    </div>
                    <div className="w-full bg-muted h-2.5 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 rounded-full ${strat.actualAllocation > strat.targetPercentage ? 'bg-amber-500' : 'bg-primary'}`} 
                        style={{ width: `${Math.min(100, (strat.actualAllocation / strat.targetPercentage) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Strategy Holdings Table */}
              <Card className="border rounded-2xl overflow-hidden shadow-sm">
                <div className="p-6 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-muted/10">
                  <div>
                    <h4 className="text-lg font-bold">Assigned Stocks &amp; ETFs ({strat.matchedEntries.length})</h4>
                    <p className="text-xs text-muted-foreground">All positions currently grouped into {strat.name}</p>
                  </div>
                  <Button 
                    onClick={() => strat.id && setAddingToStrategyId(strat.id)}
                    className="flex items-center gap-1.5 shadow-xs"
                    size="sm"
                  >
                    <Plus className="w-4 h-4" /> Add Stock to {strat.name}
                  </Button>
                </div>

                {strat.matchedEntries.length === 0 ? (
                  <div className="text-center py-16 px-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
                      <Briefcase className="w-6 h-6" />
                    </div>
                    <h5 className="text-base font-bold">No Holdings in this Strategy</h5>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                      Click the "Add Stock to {strat.name}" button above to include stocks from your portfolio into this strategic bucket.
                    </p>
                    <Button onClick={() => strat.id && setAddingToStrategyId(strat.id)} size="sm" className="mt-4">
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Holdings Now
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead>Symbol &amp; Name</TableHead>
                          <TableHead>Asset Type</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Last Invested Date</TableHead>
                          <TableHead className="text-right">Total Invested</TableHead>
                          <TableHead className="text-right">Current Value</TableHead>
                          <TableHead className="text-right">Net P&amp;L</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {strat.matchedEntries.map((entry) => {
                          const entryPos = entry.pnl >= 0;
                          return (
                            <TableRow key={entry.symbol} className="hover:bg-muted/20">
                              <TableCell className="font-bold">
                                <div className="flex flex-col">
                                  <span className="text-sm">{entry.symbol}</span>
                                  <span className="text-xs text-muted-foreground font-normal truncate max-w-[180px]">{entry.name}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px] font-normal px-2">
                                  {entry.type}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold">{entry.quantity}</TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold text-muted-foreground">
                                {formatDate(entry.entryDate)}
                              </TableCell>
                              <TableCell className="text-right font-mono">₹{entry.investment.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</TableCell>
                              <TableCell className="text-right font-mono font-bold">₹{entry.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</TableCell>
                              <TableCell className="text-right font-mono">
                                <div className={`flex flex-col items-end font-bold ${entryPos ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  <span>{entryPos ? '+' : ''}₹{entry.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                  <span className="text-[10px] font-normal opacity-80">({entryPos ? '+' : ''}{entry.pnlPercent.toFixed(1)}%)</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => strat.id && handleRemoveStockFromStrategy(strat.id, entry.symbol)}
                                  className="text-muted-foreground hover:text-destructive h-8 px-2"
                                  title="Remove holding from this strategy"
                                >
                                  <X className="w-4 h-4 mr-1" />
                                  <span className="text-xs font-bold">Remove</span>
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>

              {/* Realized / Closed Trades Table */}
              {strat.matchedSoldTrades.length > 0 && (
                <Card className="border rounded-2xl overflow-hidden shadow-sm mt-6">
                  <div className="p-6 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-muted/10">
                    <div>
                      <h4 className="text-lg font-bold flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-emerald-600" />
                        Realized / Sold Positions ({strat.matchedSoldTrades.length})
                      </h4>
                      <p className="text-xs text-muted-foreground">Historical realized profit &amp; loss from exited trades assigned to {strat.name}</p>
                    </div>
                    <Badge variant="outline" className={`font-mono font-bold text-xs px-3 py-1 ${strat.realizedPnl >= 0 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 border-rose-500/20'}`}>
                      Realized Strategy P&amp;L: {strat.realizedPnl >= 0 ? '+' : ''}₹{strat.realizedPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead>Symbol &amp; Name</TableHead>
                          <TableHead>Asset Type</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Entry Price</TableHead>
                          <TableHead className="text-right">Exit Price</TableHead>
                          <TableHead className="text-right">Exit Date</TableHead>
                          <TableHead className="text-right">Realized P&amp;L</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {strat.matchedSoldTrades.map((trade, idx) => {
                          const exit = trade.exitPrice || 0;
                          const buy = trade.entryPrice || 0;
                          const qty = trade.quantity || 0;
                          const chg = trade.charges || 0;
                          const int = trade.interest || 0;
                          const tradePnl = (exit - buy) * qty - chg - int;
                          const isTradePos = tradePnl >= 0;
                          const tradePnlPct = (buy * qty) > 0 ? (tradePnl / (buy * qty)) * 100 : 0;

                          return (
                            <TableRow key={trade.id || idx} className="hover:bg-muted/20">
                              <TableCell className="font-bold">
                                <div className="flex flex-col">
                                  <span className="text-sm">{trade.stockSymbol}</span>
                                  <span className="text-xs text-muted-foreground font-normal truncate max-w-[180px]">{trade.stockName}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px] font-normal px-2">
                                  {trade.type}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold">{trade.quantity}</TableCell>
                              <TableCell className="text-right font-mono">₹{trade.entryPrice.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono font-bold text-emerald-600">₹{(trade.exitPrice || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono text-xs text-muted-foreground">{trade.exitDate || 'N/A'}</TableCell>
                              <TableCell className="text-right font-mono">
                                <div className={`flex flex-col items-end font-bold ${isTradePos ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  <span>{isTradePos ? '+' : ''}₹{tradePnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                  <span className="text-[10px] font-normal opacity-80">({isTradePos ? '+' : ''}{tradePnlPct.toFixed(1)}%)</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              )}
            </ShadcnTabsContent>
          );
        })}
      </ShadcnTabs>

      {/* Overall Strategy Summary Banner & Analytics Cards (Rendered at bottom of strategy tab and included across strategy holdings subtabs) */}
      <div className="space-y-6 pt-6 border-t mt-8">
        {/* Top Banner & Actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card border rounded-2xl p-6 shadow-sm">
          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
              <Briefcase className="w-6 h-6 text-primary" />
              Holding Strategies &amp; Buckets
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-2xl">
              Organize your purchased stocks and ETFs into strategic investment buckets (e.g., Long Term Core, Momentum, Dividend Growth). Monitor targeted allocation percentages and evaluate independent strategy P&amp;L (Realized &amp; Unrealized).
            </p>
          </div>
          <Button onClick={handleOpenCreate} className="w-full sm:w-auto flex items-center gap-2 shadow-md">
            <Plus className="w-4 h-4" /> Create Strategy
          </Button>
        </div>

        {/* Overview Analytics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <Card className="border shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] sm:text-xs font-semibold uppercase text-muted-foreground tracking-wider">Total Strategies</p>
                <h3 className="text-xl sm:text-2xl font-black mt-1">{strategies.length}</h3>
              </div>
              <div className="p-3 rounded-xl bg-primary/10 text-primary">
                <Layers className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] sm:text-xs font-semibold uppercase text-muted-foreground tracking-wider">Assigned Invested</p>
                <h3 className="text-xl sm:text-2xl font-black mt-1">₹{totalAssignedInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">of ₹{totalPortfolioInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })} total</p>
              </div>
              <div className="p-3 rounded-xl bg-blue-500/10 text-blue-600">
                <PieChart className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] sm:text-xs font-semibold uppercase text-muted-foreground tracking-wider">Unrealized Strategy P&amp;L</p>
                <h3 className={`text-xl sm:text-2xl font-black mt-1 ${totalAssignedUnrealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {totalAssignedUnrealizedPnl >= 0 ? '+' : ''}
                  ₹{totalAssignedUnrealizedPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Active holdings</p>
              </div>
              <div className={`p-3 rounded-xl ${totalAssignedUnrealizedPnl >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                {totalAssignedUnrealizedPnl >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] sm:text-xs font-semibold uppercase text-muted-foreground tracking-wider">Realized Strategy P&amp;L</p>
                <h3 className={`text-xl sm:text-2xl font-black mt-1 ${totalAssignedRealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {totalAssignedRealizedPnl >= 0 ? '+' : ''}
                  ₹{totalAssignedRealizedPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Closed positions</p>
              </div>
              <div className={`p-3 rounded-xl ${totalAssignedRealizedPnl >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                <Target className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] sm:text-xs font-semibold uppercase text-muted-foreground tracking-wider">Total Strategy Net P&amp;L</p>
                <h3 className={`text-xl sm:text-2xl font-black mt-1 ${totalAssignedNetPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {totalAssignedNetPnl >= 0 ? '+' : ''}
                  ₹{totalAssignedNetPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Realized + Unrealized</p>
              </div>
              <div className={`p-3 rounded-xl ${totalAssignedNetPnl >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                {totalAssignedNetPnl >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] sm:text-xs font-semibold uppercase text-muted-foreground tracking-wider">Overall Strategy XIRR</p>
                <h3 className={`text-xl sm:text-2xl font-black mt-1 ${totalAssignedXIRR !== null && totalAssignedXIRR >= 0 ? 'text-emerald-600' : (totalAssignedXIRR !== null ? 'text-rose-600' : '')}`}>
                  {formatXIRR(totalAssignedXIRR)}
                </h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Annualized Return</p>
              </div>
              <div className={`p-3 rounded-xl ${totalAssignedXIRR !== null && totalAssignedXIRR >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-blue-500/10 text-blue-600'}`}>
                <TrendingUp className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
