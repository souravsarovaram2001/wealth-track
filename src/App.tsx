/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Tabs as ShadcnTabs, TabsContent as ShadcnTabsContent, TabsList as ShadcnTabsList, TabsTrigger as ShadcnTabsTrigger } from '@/components/ui/tabs';
import { Dashboard } from './components/Dashboard';
import { TradeLog } from './components/TradeLog';
import { PortfolioSummary } from './components/PortfolioSummary';
import { Bonds } from './components/Bonds';
import { TradeForm } from './components/TradeForm';
import { Ledger } from './components/Ledger';
import { LedgerForm } from './components/LedgerForm';
import { Dividends } from './components/Dividends';
import { DividendForm } from './components/DividendForm';
import { HoldingStrategies } from './components/HoldingStrategies';
import { Trade, LedgerEntry, Dividend, Bond, PortfolioStats, CorporateAction, SIP, ProcessedPortfolioEntry, AssetType, TradeStatus, HoldingStrategy } from './types';
import { LayoutDashboard, List, PlusCircle, Wallet, Gift, LogIn, LogOut, PieChart, Landmark, Bell, Activity, Repeat, Search, Briefcase } from 'lucide-react';
import { calculateXIRR } from './lib/xirr';
import { calculateAccruedInterest } from './lib/bondUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { auth, db, signIn, logOut, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc, deleteDoc, writeBatch } from 'firebase/firestore';
import axios from 'axios';
import Papa from 'papaparse';
import Fuse from 'fuse.js';
import { GoogleGenAI, Type } from "@google/genai";
import { Camera, Loader2, Check, X, AlertCircle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

import { Toaster, toast } from 'sonner';
import { formatSector, ASSET_TYPE_OVERRIDES, identifyAssetClass, getMarketCapCategory, BROKERS } from './constants';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [strategies, setStrategies] = useState<HoldingStrategy[]>([]);
  const [exitTradeData, setExitTradeData] = useState<{ 
    trade: Trade; 
    price: string; 
    date: string; 
    quantity: string; 
    remarks: string;
    method: 'FIFO' | 'Manual';
    manualLots: Record<string, number>;
  } | null>(null);
  const [editTradeData, setEditTradeData] = useState<Trade | Bond | SIP | null>(null);
  const [addMoreTradeData, setAddMoreTradeData] = useState<Partial<Trade> | null>(null);
  const [exitBondData, setExitBondData] = useState<{ 
    bond: Bond; 
    exitDate: string; 
    redemptionAmount: string;
    remarks: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ item: any, index: number } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedTrades, setScannedTrades] = useState<Omit<Trade, 'id'>[]>([]);
  const [pendingScans, setPendingScans] = useState<any[]>([]);
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [stockMasterList, setStockMasterList] = useState<{symbol: string, name: string, type: string}[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fetchingSymbols, setFetchingSymbols] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("portfolio");
  const [corporateActions, setCorporateActions] = useState<CorporateAction[]>([]);
  const [showActionsDialog, setShowActionsDialog] = useState(false);
  const [isCheckingActions, setIsCheckingActions] = useState(false);
  const [pendingAction, setPendingAction] = useState<CorporateAction | null>(null);
  const [sips, setSips] = useState<SIP[]>([]);
  const [isProcessingSIPs, setIsProcessingSIPs] = useState(false);
  const isOnline = useOnlineStatus();

  // Helper to remove undefined values before Firestore writes
  const sanitizePayload = (payload: any) => {
    return Object.fromEntries(
      Object.entries(payload).filter(([_, v]) => v !== undefined)
    );
  };

  useEffect(() => {
    if (!user) {
      setPendingScans([]);
      return;
    }

    const q = query(collection(db, 'pendingScans'), where('uid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const scans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPendingScans(scans);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'pendingScans');
    });

    return () => unsubscribe();
  }, [user]);

  const tradesRef = React.useRef<Trade[]>([]);
  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  const lastFetchRef = React.useRef<number>(0);
  const isFetchingRef = React.useRef<boolean>(false);
  const FETCH_COOLDOWN = 120000; // 2 minutes minimum between fetches

  const fetchAllPrices = React.useCallback(async (specificTrades?: Trade[]) => {
    if (isFetchingRef.current) return;
    
    const now = Date.now();
    // Don't fetch too frequently unless it's a specific set of trades (e.g. on add)
    // For specific trades, still allow a shorter cooldown (e.g. 5 seconds) to avoid slamming on bulk edits
    const bypassCooldown = specificTrades && (now - lastFetchRef.current > 5000);
    
    if (!specificTrades && (now - lastFetchRef.current < FETCH_COOLDOWN)) {
      console.log('Skipping batch price fetch due to cooldown');
      return;
    }
    
    if (specificTrades && !bypassCooldown) {
      console.log('Skipping specific price fetch due to aggressive specific-cooldown');
      return;
    }
    
    lastFetchRef.current = now;
    isFetchingRef.current = true;
    const tradesToFetch = specificTrades || tradesRef.current.filter(t => t.status === 'Active' || t.status === 'Pending Link');
    
    // Group by unique symbol and type to avoid redundant calls
    const uniqueAssets = Array.from(new Set(tradesToFetch.map(t => `${t.stockSymbol}|${t.type || 'Stock'}|${t.stockName}`)))
      .map(item => {
        const [symbol, type, name] = (item as string).split('|');
        return { symbol, type, name };
      });

    // Add Nifty 50 for benchmark tracking
    uniqueAssets.push({ symbol: '^NSEI', type: 'ETF', name: 'Nifty 50 Benchmark' });

    const symbolsToMark = uniqueAssets.map(a => a.symbol);
    setFetchingSymbols(prev => {
      const next = new Set(prev);
      symbolsToMark.forEach(s => next.add(s));
      return next;
    });

    try {
      const symbols = uniqueAssets.map(a => a.symbol);
      const types = uniqueAssets.map(a => a.type);
      const names = uniqueAssets.map(a => a.name);
      
      // Ensure we don't send empty requests
      if (symbols.length === 0) {
        setFetchingSymbols(new Set());
        isFetchingRef.current = false;
        return;
      }

      console.log(`[/api/prices] Requesting ${symbols.length} symbols...`);
      const res = await axios.post('/api/prices', { symbols, types, names }, { 
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' }
      });
      const batchPrices = res.data;
      
      setCurrentPrices(prev => {
        const next = { ...prev };
        Object.keys(batchPrices).forEach(symbol => {
          if (batchPrices[symbol].price !== undefined && batchPrices[symbol].price !== null) {
            next[symbol] = batchPrices[symbol].price;
          }
        });
        return next;
      });

      setLastUpdated(new Date());

      // Update local state for immediate feedback and detect category changes
      setTrades(prev => prev.map(t => {
        if (t.status === 'Active' && t.type === 'Stock' && batchPrices[t.stockSymbol]) {
          const newMarketCap = batchPrices[t.stockSymbol].marketCap;
          if (newMarketCap && newMarketCap > 0 && t.marketCapValue !== newMarketCap) {
            const oldCategory = getMarketCapCategory(t.stockSymbol, t.marketCapValue, t.marketCap);
            const newCategory = getMarketCapCategory(t.stockSymbol, newMarketCap, t.marketCap);
            
            if (oldCategory !== newCategory && oldCategory !== 'N/A' && newCategory !== 'N/A') {
              toast.info(`${t.stockName} moved from ${oldCategory} to ${newCategory}!`, {
                description: `Market Cap: ₹${(newMarketCap / 10000000).toLocaleString(undefined, { maximumFractionDigits: 0 })} Cr`,
                duration: 5000
              });
            }
            
            return { ...t, marketCapValue: newMarketCap };
          }
        }
        return t;
      }));

      // Update lastKnownPrice and marketCapValue in Firestore if it's missing or changed
      if (user) {
        for (const trade of tradesRef.current) {
          if (trade.status === 'Active' && batchPrices[trade.stockSymbol]) {
            const newPrice = batchPrices[trade.stockSymbol].price;
            const newMarketCap = batchPrices[trade.stockSymbol].marketCap;
            
            const updates: any = {};
            const lastUpdate = trade.lastPriceUpdate ? new Date(trade.lastPriceUpdate) : new Date(0);
            const now = new Date();
            const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);

            if (newPrice && newPrice > 0 && (trade.lastKnownPrice !== newPrice)) {
              if (!trade.lastKnownPrice || hoursSinceUpdate > 1) {
                updates.lastKnownPrice = newPrice;
                updates.lastPriceUpdate = now.toISOString();
              }
            }

            if (trade.type === 'Stock' && newMarketCap && newMarketCap > 0 && trade.marketCapValue !== newMarketCap) {
              updates.marketCapValue = newMarketCap;
            }

            if (Object.keys(updates).length > 0) {
              const tradeRef = doc(db, 'trades', trade.id!);
              updateDoc(tradeRef, sanitizePayload(updates)).catch(err => {
                handleFirestoreError(err, OperationType.UPDATE, `trades/${trade.id}`);
              });
            }
          }
        }
      }
    } catch (e: any) {
      if (e.response?.status === 429) {
        console.warn('Batch price fetch rate limited (429). Will retry later.');
      } else if (e.message === 'Network Error') {
        console.error('Network Error in App batch price fetch. Server might be unreachable or request blocked.');
        // Don't show toast for every periodic network error to avoid spamming the user
      } else {
        console.error('Error in App batch price fetch:', e.message || e);
        if (e.response?.data) {
          console.error('Server error details:', e.response.data);
        }
      }
    } finally {
      isFetchingRef.current = false;
      setFetchingSymbols(prev => {
        const next = new Set(prev);
        symbolsToMark.forEach(s => next.delete(s));
        return next;
      });
    }
  }, [user]); // Only depend on user

  // Fetch master list on mount with retry
  useEffect(() => {
    let retries = 0;
    const maxRetries = 3;
    
    const fetchSymbols = () => {
      axios.get('/api/symbols', { timeout: 20000 })
        .then(res => setStockMasterList(res.data))
        .catch(e => {
          console.error("Master list fetch failed", e.message || e);
          if (retries < maxRetries) {
            retries++;
            console.log(`Retrying symbol fetch (${retries}/${maxRetries})...`);
            setTimeout(fetchSymbols, 2000 * retries);
          } else {
            toast.error("Failed to load stock list", {
              description: e.message === 'Network Error' 
                ? "Connection lost. Please refresh the page if problem persists."
                : "Symbols could not be loaded. Searching may be limited."
            });
          }
        });
    };

    fetchSymbols();
  }, []);

  // Self-healing useEffect for missing stock names
  useEffect(() => {
    if (!user || trades.length === 0 || stockMasterList.length === 0) return;

    const orphans = trades.filter(t => 
      (t.status === 'Active' || t.status === 'Pending Link') && (
        !t.sector || 
        t.sector === 'Pending...' || 
        t.stockName === 'Unknown' || 
        !t.stockName || 
        t.stockName === t.stockSymbol ||
        (identifyAssetClass(t.stockSymbol, t.stockName) === 'ETF' && t.type !== 'ETF') ||
        (t.type === 'Mutual Fund' && (t.marketCap !== 'N/A' || t.sector !== 'Mutual Fund'))
      )
    );

    if (orphans.length > 0) {
      const heal = async () => {
        const batch = writeBatch(db);
        let needsCommit = false;
        
        const fuse = new Fuse<{symbol: string, name: string, type: string}>(stockMasterList, {
          keys: ['symbol', 'name'],
          threshold: 0.3,
          useExtendedSearch: true
        });

        orphans.forEach(trade => {
          const updates: any = {};
          
          if (trade.type === 'Mutual Fund') {
            if (trade.marketCap !== 'N/A') updates.marketCap = 'N/A';
            if (trade.sector !== 'Mutual Fund') updates.sector = 'Mutual Fund';
          }

          // 1. Check if it should be an ETF or has mis-categorized sector
          const detectedClass = identifyAssetClass(trade.stockSymbol, trade.stockName);
          if (detectedClass === 'ETF' && trade.type !== 'ETF') {
            updates.type = 'ETF';
            updates.sector = formatSector(trade.stockSymbol, trade.sector);
            updates.marketCap = 'N/A';
          } else if (detectedClass === 'ETF' && (trade.sector === 'Finance' || trade.sector === 'Financial Services') && (trade.stockName?.includes('Midcap') || trade.stockSymbol?.includes('MIDCAP'))) {
            // Specifically fix Midcap ETF sectors even if type is already ETF
            updates.sector = 'EQUITY - DIVERSIFIED';
          }

          // 2. Attempt fuzzy match for linking/metadata
          const searchKey = trade.stockSymbol || trade.stockName;
          const results = fuse.search(searchKey);
          
          if (results.length > 0) {
            const match = results[0].item;
            
            if (match.name && match.name !== trade.stockName && (!trade.stockName || trade.stockName === trade.stockSymbol)) {
              updates.stockName = match.name;
            }
            
            // Try to resolve sector if missing or pending
            if (!updates.sector && (!trade.sector || trade.sector === 'Pending...')) {
              const resolvedSector = formatSector(match.symbol, undefined);
              if (resolvedSector) {
                updates.sector = resolvedSector;
              }
            }
          }

          if (Object.keys(updates).length > 0) {
            batch.update(doc(db, 'trades', trade.id!), sanitizePayload(updates));
            needsCommit = true;
          }
        });
        
        if (needsCommit) {
          try {
            await batch.commit();
            console.log(`Auto-linked ${orphans.length} trades using fuzzy matching.`);
          } catch (e) {
            handleFirestoreError(e, OperationType.WRITE, 'trades/batch-heal');
            toast.error("Failed to save automatic profile updates");
          }
        }
      };
      
      const timer = setTimeout(heal, 2000);
      return () => clearTimeout(timer);
    }
  }, [trades, stockMasterList, user]);

  const activeSymbols = useMemo(() => 
    trades.filter(t => t.status === 'Active' || t.status === 'Pending Link').map(t => t.stockSymbol).sort().join(','),
    [trades]
  );

  useEffect(() => {
    if (activeSymbols && user) {
      fetchAllPrices();
    }
  }, [activeSymbols, fetchAllPrices, user]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (user) fetchAllPrices();
    }, 900000); // 15 minutes
    return () => clearInterval(interval);
  }, [fetchAllPrices, user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setTrades([]);
      setLedger([]);
      setDividends([]);
      setBonds([]);
      setStrategies([]);
      setCorporateActions([]);
      return;
    }

    const tradesQuery = query(collection(db, 'trades'), where('uid', '==', user.uid));
    const unsubscribeTrades = onSnapshot(tradesQuery, (snapshot) => {
      setTrades(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Trade)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'trades'));

    const ledgerQuery = query(collection(db, 'ledger'), where('uid', '==', user.uid));
    const unsubscribeLedger = onSnapshot(ledgerQuery, (snapshot) => {
      setLedger(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'ledger'));

    const dividendsQuery = query(collection(db, 'dividends'), where('uid', '==', user.uid));
    const unsubscribeDividends = onSnapshot(dividendsQuery, (snapshot) => {
      setDividends(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Dividend)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'dividends'));

    const bondsQuery = query(collection(db, 'bonds'), where('uid', '==', user.uid));
    const unsubscribeBonds = onSnapshot(bondsQuery, (snapshot) => {
      setBonds(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Bond)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'bonds'));

    const strategiesQuery = query(collection(db, 'strategies'), where('uid', '==', user.uid));
    const unsubscribeStrategies = onSnapshot(strategiesQuery, (snapshot) => {
      setStrategies(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as HoldingStrategy)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'strategies'));

    const actionsQuery = query(collection(db, 'corporateActions'), where('uid', '==', user.uid));
    const unsubscribeActions = onSnapshot(actionsQuery, (snapshot) => {
      setCorporateActions(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CorporateAction)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'corporateActions'));

    const sipsQuery = query(collection(db, 'sips'), where('uid', '==', user.uid));
    const unsubscribeSips = onSnapshot(sipsQuery, (snapshot) => {
      setSips(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SIP)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'sips'));

    return () => {
      unsubscribeTrades();
      unsubscribeLedger();
      unsubscribeDividends();
      unsubscribeBonds();
      unsubscribeStrategies();
      unsubscribeActions();
      unsubscribeSips();
    };
  }, [user]);

  // Auto-check for corporate actions once per session/day
  useEffect(() => {
    if (user && trades.length > 0) {
      const lastCheckKey = `last_corp_check_${user.uid}`;
      const lastCheck = localStorage.getItem(lastCheckKey);
      const now = new Date().getTime();
      const ONE_DAY = 24 * 60 * 60 * 1000;

      if (!lastCheck || (now - parseInt(lastCheck)) > ONE_DAY) {
        // Delay slightly to wait for initial data load to be solid
        const timer = setTimeout(() => {
          checkCorporateActions();
          localStorage.setItem(lastCheckKey, now.toString());
        }, 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [user, trades.length > 0]);

  // Automated SIP Engine: Background processing of installments
  useEffect(() => {
    if (user && sips.length > 0 && !isProcessingSIPs) {
      const processSIPs = async () => {
        setIsProcessingSIPs(true);
        let totalAdded = 0;
        
        try {
          for (const sip of sips.filter(s => s.status === 'Active')) {
            const installments = await generateSipInstallments(sip, sip.lastProcessedDate);
            if (installments.length > 0) {
              const batch = writeBatch(db);
              installments.forEach(inst => {
                const tradeRef = doc(collection(db, 'trades'));
                batch.set(tradeRef, sanitizePayload(inst));
              });
              
              const lastDate = installments[installments.length - 1].entryDate;
              // batch.update requires a DocumentReference
              const sipRef = doc(db, 'sips', sip.id!);
              batch.update(sipRef, sanitizePayload({ lastProcessedDate: lastDate }));
              
              await batch.commit();
              totalAdded += installments.length;
            }
          }
          
          if (totalAdded > 0) {
            toast.success(`SIP Engine: Generated ${totalAdded} new trade entries for your active SIPs.`);
          }
        } catch (err) {
          console.error("Automated SIP processing failed:", err);
          toast.error("SIP Engine encountered an error", {
            description: "Some installments might not have been generated. Please refresh."
          });
        } finally {
          setIsProcessingSIPs(false);
        }
      };

      // Debounce the processing slightly after initial load
      const timer = setTimeout(processSIPs, 5000);
      return () => clearTimeout(timer);
    }
  }, [user, sips]);

  const processedPortfolio = useMemo(() => {
    const activeTrades = trades.filter(t => t.status === 'Active' || t.status === 'Pending Link');
    
    const holdings: ProcessedPortfolioEntry[] = [];
    
    activeTrades.forEach(t => {
      const live = currentPrices[t.stockSymbol];
      // User requested: Do not set Current Price = Buy Price if live price is missing.
      // Keep it as null or 0 until API returns a value.
      const currentPrice = (live && live > 0) ? live : (t.lastKnownPrice && t.lastKnownPrice > 0 ? t.lastKnownPrice : 0);
      
      const investment = (Number(t.entryPrice) * Number(t.quantity)) + (Number(t.charges) || 0) + (Number(t.interest) || 0);
      const currentValue = Number(currentPrice) * Number(t.quantity);
      const isSIP = !!t.sipId || sips.some(s => s.stockSymbol === t.stockSymbol);
      
      const pnl = currentValue - investment;
      holdings.push({
        id: t.id!,
        symbol: t.stockSymbol,
        name: t.stockName,
        type: t.type || 'Stock',
        quantity: Number(t.quantity) || 0,
        entryPrice: Number(t.entryPrice) || 0,
        investment: isNaN(investment) ? 0 : investment,
        currentPrice: isNaN(currentPrice) ? 0 : currentPrice,
        currentValue: isNaN(currentValue) ? 0 : currentValue,
        sector: t.type === 'Mutual Fund' ? 'Mutual Fund' : (t.type === 'ETF' ? 'ETF' : formatSector(t.stockSymbol, t.sector)),
        marketCap: t.type === 'Mutual Fund' || t.type === 'ETF' ? 'N/A' : getMarketCapCategory(t.stockSymbol, t.marketCapValue, t.marketCap),
        isSIP,
        pnl: isNaN(pnl) ? 0 : pnl,
        pnlPercent: investment > 0 ? (pnl / investment) * 100 : 0,
        entryDate: t.entryDate
      });
    });
    
    return holdings;
  }, [trades, currentPrices, sips]);

  const stats = useMemo<PortfolioStats>(() => {
    // Current FY Calculation
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed
    const fyStart = currentMonth >= 3 
      ? new Date(currentYear, 3, 1) 
      : new Date(currentYear - 1, 3, 1);
    const fyEnd = new Date(fyStart.getFullYear() + 1, 2, 31, 23, 59, 59);
    
    const isDateInFY = (dateStr?: string) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= fyStart && d <= fyEnd;
    };

    // 1. Calculate Active Investment Stats from Processed Portfolio (Stocks/ETFs)
    const stockInvested = processedPortfolio.reduce((acc, curr) => acc + (Number(curr.investment) || 0), 0);
    const stockCurrentAssetValue = processedPortfolio.reduce((acc, curr) => acc + (Number(curr.currentValue) || 0), 0);
    const stockUnrealizedProfit = processedPortfolio.reduce((acc, curr) => acc + (Number(curr.pnl) || 0), 0);

    // Active Bonds Stats (Includes bonds with NO status as they default to active)
    const activeBonds = bonds.filter(b => b.status !== 'Exited');
    const bondInvested = activeBonds.reduce((acc, b) => acc + (Number(b.principal) || 0), 0);
    const bondAccruedProfit = activeBonds.reduce((acc, b) => {
      const accrued = calculateAccruedInterest(b);
      return acc + (isNaN(accrued) ? 0 : accrued);
    }, 0);
    const bondCurrentValue = bondInvested + bondAccruedProfit;

    // Projected FY Bond Accrued (Pending payouts remaining in this FY)
    const fyBondAccrued = activeBonds.reduce((acc, b) => {
      const interest = b.payoutSchedule?.filter(p => p.status === 'Pending' && isDateInFY(p.date)).reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;
      return acc + interest;
    }, 0);

    const totalInvested = stockInvested + bondInvested;
    const totalCurrentAssetValue = stockCurrentAssetValue + bondCurrentValue;
    const totalUnrealizedProfit = stockUnrealizedProfit + bondAccruedProfit;

    // 2. Realized Profits (Trades + Bonds + Dividends)
    const stockRealizedProfit = trades.filter(t => t.status === 'Sold').reduce((acc, t) => {
      const buyValue = (Number(t.entryPrice) * Number(t.quantity)) + (Number(t.charges) || 0) + (Number(t.interest) || 0);
      const sellValue = (Number(t.exitPrice || 0) * Number(t.quantity));
      const profit = sellValue - buyValue;
      return acc + (isNaN(profit) ? 0 : profit);
    }, 0);

    const fyStockRealizedProfit = trades.filter(t => t.status === 'Sold' && isDateInFY(t.exitDate)).reduce((acc, t) => {
      const buyValue = (Number(t.entryPrice) * Number(t.quantity)) + (Number(t.charges) || 0) + (Number(t.interest) || 0);
      const sellValue = (Number(t.exitPrice || 0) * Number(t.quantity));
      return acc + (sellValue - buyValue);
    }, 0);

    const bondCapitalGain = bonds.filter(b => b.status === 'Exited').reduce((acc, b) => {
      const gain = (Number(b.redemptionAmount || b.principal) || 0) - (Number(b.principal) || 0);
      return acc + (isNaN(gain) ? 0 : gain);
    }, 0);

    const fyBondCapitalGain = bonds.filter(b => b.status === 'Exited' && isDateInFY(b.exitDate)).reduce((acc, b) => {
      return acc + ((Number(b.redemptionAmount || b.principal) || 0) - (Number(b.principal) || 0));
    }, 0);

    const totalBondInterest = bonds.reduce((acc, b) => {
      const interest = b.payoutSchedule?.filter(p => p.status === 'Received').reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;
      return acc + interest;
    }, 0);

    const fyBondInterest = bonds.reduce((acc, b) => {
      const interest = b.payoutSchedule?.filter(p => p.status === 'Received' && isDateInFY(p.date)).reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;
      return acc + interest;
    }, 0);

    const totalDividends = dividends.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    const fyDividends = dividends.filter(d => isDateInFY(d.date)).reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    
    // Comprehensive Realized Profit: Sales (Stocks + Bonds) + Dividends + Bond Interest
    const totalRealizedProfit = stockRealizedProfit + bondCapitalGain + totalDividends + totalBondInterest;
    const fyRealizedProfit = fyStockRealizedProfit + fyBondCapitalGain + fyDividends + fyBondInterest;

    const totalCharges = trades.reduce((acc, t) => acc + (Number(t.charges) || 0) + (Number(t.interest) || 0), 0);

    // 3. Cash Balance (Inflows - Outflows + Realized Proceeds)
    const cashFromLedger = ledger.reduce((acc, l) => acc + (l.type === 'Deposit' ? Number(l.amount) : -Number(l.amount)), 0);
    const cashFromTrades = trades.reduce((acc, t) => {
      const buyCost = Number(t.entryPrice) * Number(t.quantity) + (Number(t.charges) || 0) + (Number(t.interest) || 0);
      const sellProceeds = t.status === 'Sold' ? (Number(t.exitPrice || 0) * Number(t.quantity) - (Number(t.charges) || 0)) : 0;
      return acc - buyCost + sellProceeds;
    }, 0);
    const cashFromBonds = bonds.reduce((acc, b) => {
      const purchaseCost = Number(b.principal);
      const exitProceeds = b.status === 'Exited' ? (Number(b.redemptionAmount || b.principal) || 0) : 0;
      const interest = b.payoutSchedule?.filter(p => p.status === 'Received').reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;
      return acc - purchaseCost + exitProceeds + interest;
    }, 0);
    const cashFromDividends = dividends.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    
    const cashBalance = cashFromLedger + cashFromTrades + cashFromBonds + cashFromDividends;
    const finalTotalValue = totalCurrentAssetValue + cashBalance;

    return {
      totalInvested: isNaN(totalInvested) ? 0 : totalInvested,
      totalRealizedProfit: isNaN(totalRealizedProfit) ? 0 : totalRealizedProfit,
      stockRealizedProfit: isNaN(stockRealizedProfit) ? 0 : stockRealizedProfit,
      bondCapitalGain: isNaN(bondCapitalGain) ? 0 : bondCapitalGain,
      totalUnrealizedProfit: isNaN(totalUnrealizedProfit) ? 0 : totalUnrealizedProfit,
      stockUnrealizedProfit: isNaN(stockUnrealizedProfit) ? 0 : stockUnrealizedProfit,
      bondAccruedProfit: isNaN(bondAccruedProfit) ? 0 : bondAccruedProfit,
      totalDividends: isNaN(totalDividends) ? 0 : totalDividends,
      totalBondInterest: isNaN(totalBondInterest) ? 0 : totalBondInterest,
      totalCharges: isNaN(totalCharges) ? 0 : totalCharges,
      totalCurrentValue: isNaN(finalTotalValue) ? 0 : finalTotalValue,
      fyRealizedProfit: isNaN(fyRealizedProfit) ? 0 : fyRealizedProfit,
      fyDividends: isNaN(fyDividends) ? 0 : fyDividends,
      fyBondInterest: isNaN(fyBondInterest) ? 0 : fyBondInterest,
      fyBondAccrued: isNaN(fyBondAccrued) ? 0 : fyBondAccrued
    };
  }, [processedPortfolio, trades, bonds, dividends, ledger]);

  const checkCorporateActions = async () => {
    if (!user || trades.length === 0) return;
    setIsCheckingActions(true);
    try {
      const res = await axios.post('/api/corporate-actions', { trades });
      const detectedActions: CorporateAction[] = res.data;

      for (const action of detectedActions) {
        // Check if this action already exists in our records
        const exists = corporateActions.find(a => 
          a.tradeId === action.tradeId && 
          a.type === action.type && 
          a.date === action.date &&
          a.value === action.value
        );

        if (!exists) {
          const isDividend = action.type === 'Dividend';
          await addDoc(collection(db, 'corporateActions'), sanitizePayload({
            ...action,
            uid: user.uid,
            status: isDividend ? 'Applied' : 'Detected'
          }));

          if (isDividend) {
            // Automatically record the dividend
            const trade = trades.find(t => t.id === action.tradeId);
            if (trade) {
              const totalDividend = Number(trade.quantity * action.value);
              if (!isNaN(totalDividend) && totalDividend > 0) {
                await addDoc(collection(db, 'dividends'), sanitizePayload({
                  stockName: trade.stockName,
                  month: action.date.substring(0, 7), // YYYY-MM
                  amount: totalDividend,
                  uid: user.uid,
                  autoTracked: true,
                  date: action.date
                }));
                
                toast.info(`Dividend of ₹${totalDividend.toLocaleString()} from ${trade.stockName} recorded automatically.`);
              }
              
              // Also record as a detected action but mark it as 'Applied' immediately
              await addDoc(collection(db, 'corporateActions'), sanitizePayload({
                ...action,
                uid: user.uid,
                status: 'Applied'
              }));
              continue; // Move to next action
            }
          }
        }
      }
      
      if (detectedActions.length > 0) {
        toast.success(`Detected ${detectedActions.length} new corporate actions!`);
        setShowActionsDialog(true);
      } else {
        toast.info("No new corporate actions detected.");
      }
    } catch (err) {
      console.error("Failed to check corporate actions:", err);
      toast.error("Failed to check corporate actions", {
        description: "There was a problem communicating with the external data provider."
      });
    } finally {
      setIsCheckingActions(false);
    }
  };

  const applyCorporateAction = async (action: CorporateAction) => {
    if (!user || !action.id) return;
    
    // Confirmation step for non-dividend actions
    if (action.type !== 'Dividend' && !pendingAction) {
      setPendingAction(action);
      return;
    }

    try {
      if (action.type === 'Dividend') {
        const trade = trades.find(t => t.id === action.tradeId);
        if (trade) {
          const totalDividend = trade.quantity * action.value;
          
          // Check for existing dividend entry for this stock and date
          const existingDiv = dividends.find(d => 
            d.stockName === trade.stockName && 
            d.date === action.date
          );

          if (existingDiv && existingDiv.id) {
            await updateDoc(doc(db, 'dividends', existingDiv.id), sanitizePayload({
              amount: totalDividend
            }));
            toast.success(`Updated existing dividend for ${trade.stockName}`);
          } else {
            await addDoc(collection(db, 'dividends'), sanitizePayload({
              stockName: trade.stockName,
              month: action.date.substring(0, 7), // YYYY-MM
              amount: totalDividend,
              date: action.date,
              uid: user.uid
            }));
          }
        }
      } else if (action.type === 'Split' || action.type === 'Bonus') {
        const trade = trades.find(t => t.id === action.tradeId);
        if (trade && trade.id) {
          const newQty = trade.quantity * action.value;
          const newPrice = trade.entryPrice / action.value;
          await updateDoc(doc(db, 'trades', trade.id), sanitizePayload({
            quantity: newQty,
            entryPrice: newPrice
          }));
        }
      } else if (action.type === 'Merger') {
        const trade = trades.find(t => t.id === action.tradeId);
        const mergerData = action as any;
        if (trade && trade.id && mergerData.newSymbol) {
          const newQty = trade.quantity * action.value;
          await updateDoc(doc(db, 'trades', trade.id), sanitizePayload({
            stockSymbol: mergerData.newSymbol,
            stockName: mergerData.newName,
            quantity: newQty
          }));
        }
      }

      // Mark action as applied
      await updateDoc(doc(db, 'corporateActions', action.id), sanitizePayload({
        status: 'Applied'
      }));
      
      toast.success(`${action.type} applied successfully!`);
      setPendingAction(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `corporateActions/${action.id}`);
      toast.error("Failed to apply corporate action", {
        description: "A database error occurred. Please try again later."
      });
    }
  };

  const generateSipInstallments = async (sip: SIP, fromDateStr?: string) => {
    if (!user) return [];
    const installments: Omit<Trade, 'id'>[] = [];
    const baseDate = fromDateStr || sip.startDate;
    const startRangeDate = new Date(baseDate);
    
    // Safety check for invalid date
    if (isNaN(startRangeDate.getTime())) {
      console.error(`Invalid SIP start date: ${baseDate} for ${sip.stockName}`);
      return [];
    }

    try {
      // Fetch the entire history in one go
      const res = await axios.get(`/api/historical-range/${sip.stockSymbol}?from=${baseDate}`);
      const historyItems: { date: string, price: number }[] = res.data;
      
      const now = new Date();
      let current = new Date(startRangeDate);
      current.setDate(sip.dayOfMonth);

      if (current < startRangeDate) {
        current.setMonth(current.getMonth() + 1);
        current.setDate(sip.dayOfMonth);
      }

      while (current <= now) {
        const dateStr = current.toISOString().split('T')[0];
        
        if (fromDateStr && dateStr <= fromDateStr) {
          current.setMonth(current.getMonth() + 1);
          current.setDate(sip.dayOfMonth);
          continue;
        }

        // Calculate current installment with Step-Up
        let installmentAmount = sip.installmentAmount;
        if (sip.stepUpType && sip.stepUpType !== 'None' && sip.stepUpValue) {
          const startDate = new Date(sip.startDate);
          const diffYears = Math.floor((current.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
          
          if (diffYears > 0) {
            for (let y = 0; y < diffYears; y++) {
              if (sip.stepUpType === 'Percentage') {
                installmentAmount *= (1 + sip.stepUpValue / 100);
              } else if (sip.stepUpType === 'Fixed') {
                installmentAmount += sip.stepUpValue;
              }
            }
          }
        }

        // Find the closest price in history
        const targetTime = current.getTime();
        let bestMatch: any = null;
        let minDiff = Infinity;

        for (const item of historyItems) {
          const itemTime = new Date(item.date).getTime();
          const diff = Math.abs(itemTime - targetTime);
          if (diff < minDiff && diff < 7 * 24 * 60 * 60 * 1000) {
            minDiff = diff;
            bestMatch = item;
          }
        }

        if (bestMatch) {
          installments.push({
            stockName: sip.stockName,
            stockSymbol: sip.stockSymbol,
            type: sip.type || 'Mutual Fund',
            entryDate: bestMatch.date.split('T')[0],
            entryPrice: bestMatch.price,
            quantity: installmentAmount / bestMatch.price,
            charges: 0,
            interest: 0,
            status: 'Active',
            sector: sip.type === 'ETF' ? 'ETF' : 'Mutual Fund',
            marketCap: 'N/A',
            broker: 'Groww',
            targetPrice: bestMatch.price * 1.1,
            sipId: sip.id,
            uid: user.uid
          });
        }

        current.setMonth(current.getMonth() + 1);
        current.setDate(sip.dayOfMonth);
      }
    } catch (err) {
      console.error(`Failed to generate SIP installments for ${sip.stockName}`, err);
      toast.error(`Error generating SIP history for ${sip.stockName}`, {
        description: "Historical price data could not be fetched."
      });
    }
    
    return installments;
  };

  const handleAddTrade = async (data: any) => {
    if (!user) return;
    
    // Check if it's a SIP
    if ('installmentAmount' in data) {
      try {
        const sipData = { ...data, uid: user.uid, lastProcessedDate: data.startDate };
        const sipRef = await addDoc(collection(db, 'sips'), sanitizePayload(sipData));
        toast.success("SIP created successfully!");
        
        // Handle initial investment if provided
        if (data.initialInvestment > 0) {
          try {
            const res = await axios.get(`/api/historical/${data.stockSymbol}/${data.startDate}`);
            if (res.data.price) {
               const initialTrade = {
                 stockName: data.stockName,
                 stockSymbol: data.stockSymbol,
                 type: data.type || 'Mutual Fund',
                 entryDate: data.startDate,
                 entryPrice: res.data.price,
                 quantity: data.initialInvestment / res.data.price,
                 charges: 0,
                 interest: 0,
                 status: 'Active',
                 sector: data.type === 'ETF' ? 'ETF' : 'Mutual Fund',
                 marketCap: 'N/A',
                 broker: data.broker || 'Groww',
                 targetPrice: res.data.price * 1.1,
                 sipId: sipRef.id,
                 uid: user.uid
               };
               await addDoc(collection(db, 'trades'), sanitizePayload(initialTrade));
               toast.success("Initial lump-sum investment added!");
            }
          } catch (e: any) {
            console.error("Failed to add initial investment", e);
            const is404 = e.response?.status === 404;
            toast.error("SIP: Failed to add initial investment", {
              description: is404 
                ? "Historical price for the start date was not found. Please add the initial lump-sum manually." 
                : "The SIP was created, but the initial lump-sum entry failed."
            });
          }
        }

        const installments = await generateSipInstallments({ id: sipRef.id, ...sipData } as SIP);
        if (installments.length > 0) {
          const batch = writeBatch(db);
          installments.forEach(inst => {
            const tradeRef = doc(collection(db, 'trades'));
            batch.set(tradeRef, sanitizePayload(inst));
          });
          
          // Update last processed date to the last installment date
          const lastDate = installments[installments.length - 1].entryDate;
          batch.update(sipRef, sanitizePayload({ lastProcessedDate: lastDate }));
          
          await batch.commit();
          toast.success(`Backfilled ${installments.length} SIP installments.`);
        }
      } catch (err) {
        console.error("SIP creation failed", err);
        toast.error("Failed to create SIP");
      }
      return;
    }

    const trade = data as Omit<Trade, 'id'>;
    try {
      // Fetch initial price to save as lastKnownPrice and determine market cap
      let initialPrice = 0;
      let fetchedMarketCap = 0;
      try {
        const res = await axios.post('/api/prices', { 
          symbols: [trade.stockSymbol], 
          types: [trade.type], 
          names: [trade.stockName] 
        });
        if (res.data[trade.stockSymbol]) {
          initialPrice = res.data[trade.stockSymbol].price;
          fetchedMarketCap = res.data[trade.stockSymbol].marketCap || 0;
        }
      } catch (e) {
        console.error('Failed to fetch initial price for new trade', e);
      }

      const tradePayload: any = { 
        ...trade, 
        uid: user.uid
      };

      // Apply dynamic market cap classification
      if (tradePayload.type === 'Stock') {
        tradePayload.marketCap = getMarketCapCategory(trade.stockSymbol, fetchedMarketCap);
      } else {
        tradePayload.marketCap = 'N/A';
      }

      // Apply asset type overrides
      const cleanSymbol = trade.stockSymbol.split('.')[0].toUpperCase();
      if (ASSET_TYPE_OVERRIDES[cleanSymbol]) {
        tradePayload.type = ASSET_TYPE_OVERRIDES[cleanSymbol];
      }

      // Apply normalization to sector
      if (tradePayload.type === 'Stock') {
        tradePayload.sector = formatSector(trade.stockSymbol, trade.sector);
      } else if (tradePayload.type === 'ETF') {
        tradePayload.sector = 'ETF';
        tradePayload.marketCap = 'N/A';
      } else if (tradePayload.type === 'Mutual Fund') {
        tradePayload.sector = 'Mutual Fund';
        tradePayload.marketCap = 'N/A';
      }

      if (initialPrice > 0) {
        tradePayload.lastKnownPrice = initialPrice;
        tradePayload.lastPriceUpdate = new Date().toISOString();
      }

      if (fetchedMarketCap > 0) {
        tradePayload.marketCapValue = fetchedMarketCap;
      }

      await addDoc(collection(db, 'trades'), sanitizePayload(tradePayload));
      toast.success(`${trade.stockName} trade added successfully!`);
      if (initialPrice > 0) {
        setCurrentPrices(prev => ({ ...prev, [trade.stockSymbol]: initialPrice }));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'trades');
      toast.error(`Failed to add trade: ${trade.stockName}`);
    }
  };

  // Auto-process pending SIP dates
  useEffect(() => {
    if (user && sips.length > 0 && trades.length > 0 && !isProcessingSIPs) {
      const processPendingSIPs = async () => {
        setIsProcessingSIPs(true);
        try {
          for (const sip of sips.filter(s => s.status === 'Active')) {
            const baseDate = sip.lastProcessedDate || sip.startDate;
            const lastProcessed = new Date(baseDate);
            
            if (isNaN(lastProcessed.getTime())) {
              console.error(`Invalid SIP date for processing: ${baseDate} in ${sip.stockName}`);
              continue;
            }

            const now = new Date();
            let nextDate = new Date(lastProcessed);
            nextDate.setMonth(nextDate.getMonth() + 1);
            nextDate.setDate(sip.dayOfMonth);

            if (isNaN(nextDate.getTime())) continue;

            const newInstallments: Omit<Trade, 'id'>[] = [];
            let latestProcessed = lastProcessed;

            while (nextDate <= now) {
              // Ensure nextDate is valid before toISOString
              if (isNaN(nextDate.getTime())) break;
              const dateStr = nextDate.toISOString().split('T')[0];
              try {
                const res = await axios.get(`/api/historical/${sip.stockSymbol}/${dateStr}`);
                if (res.data.price) {
                  newInstallments.push({
                    stockName: sip.stockName,
                    stockSymbol: sip.stockSymbol,
                    type: 'Mutual Fund',
                    entryDate: res.data.date.split('T')[0],
                    entryPrice: res.data.price,
                    quantity: sip.installmentAmount / res.data.price,
                    charges: 0,
                    interest: 0,
                    status: 'Active',
                    sector: 'Mutual Fund',
                    marketCap: 'N/A',
                    broker: 'Groww',
                    targetPrice: res.data.price * 1.1,
                    sipId: sip.id,
                    uid: user.uid
                  });
                  latestProcessed = new Date(nextDate);
                } else {
                  // If we can't findNAV for a past date, break to avoid infinite loop or wrong updates
                  break;
                }
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `sips/${sip.id}`);
                console.error(`SIP processing failed for ${sip.stockName} on ${dateStr}`, err);
                toast.error(`Auto-SIP failed for ${sip.stockName}`, {
                  description: `Problem processing installment for ${dateStr}.`
                });
                break; 
              }
              nextDate.setMonth(nextDate.getMonth() + 1);
              nextDate.setDate(sip.dayOfMonth);
            }

            if (newInstallments.length > 0) {
              const batch = writeBatch(db);
              newInstallments.forEach(inst => {
                const tradeRef = doc(collection(db, 'trades'));
                batch.set(tradeRef, sanitizePayload(inst));
              });
              const sipRef = doc(db, 'sips', sip.id!);
              batch.update(sipRef, sanitizePayload({ lastProcessedDate: latestProcessed.toISOString().split('T')[0] }));
              await batch.commit();
              toast.success(`Processed ${newInstallments.length} new installments for ${sip.stockName}`);
            }
          }
        } catch (err) {
          console.error("SIP auto-processing failed", err);
          toast.error("SIP Engine background error", {
            description: "Some SIP updates might have been skipped."
          });
        } finally {
          setIsProcessingSIPs(false);
        }
      };
      
      const timer = setTimeout(processPendingSIPs, 5000); // Wait for initial loads
      return () => clearTimeout(timer);
    }
  }, [user, sips.length > 0, trades.length > 0]);

  const handleAddLedger = async (entry: Omit<LedgerEntry, 'id'>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'ledger'), sanitizePayload({ ...entry, uid: user.uid }));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'ledger');
    }
  };

  const handleAddDividend = async (dividend: Omit<Dividend, 'id'>) => {
    if (!user) return;
    try {
      const amount = Number(dividend.amount);
      if (isNaN(amount)) throw new Error("Invalid dividend amount");
      
      await addDoc(collection(db, 'dividends'), sanitizePayload({ 
        ...dividend, 
        amount,
        uid: user.uid 
      }));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'dividends');
    }
  };

  const handleDeleteLedger = (entry: LedgerEntry) => {
    setDeleteConfirm({ 
      item: { ...entry, collection: 'ledger', displayName: `${entry.type} of ₹${entry.amount.toLocaleString()} (${entry.broker})` }, 
      index: -1 
    });
  };

  const handleDeleteDividend = (div: Dividend) => {
    setDeleteConfirm({ 
      item: { ...div, collection: 'dividends', displayName: `Dividend from ${div.stockName} (₹${div.amount.toLocaleString()})` }, 
      index: -1 
    });
  };

  const handleAddBond = async (bond: Omit<Bond, 'id'>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'bonds'), sanitizePayload({ ...bond, uid: user.uid }));
      toast.success("Bond added successfully!");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'bonds');
      toast.error("Failed to add bond");
    }
  };

  const handleAddStrategy = async (strategy: Omit<HoldingStrategy, 'id' | 'uid'>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'strategies'), sanitizePayload({ ...strategy, uid: user.uid }));
      toast.success("Strategy created successfully!");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'strategies');
      toast.error("Failed to create strategy");
    }
  };

  const handleUpdateStrategy = async (id: string, updated: Partial<HoldingStrategy>) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'strategies', id), sanitizePayload({ ...updated, uid: user.uid }));
      toast.success("Strategy updated!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `strategies/${id}`);
      toast.error("Failed to update strategy");
    }
  };

  const handleDeleteStrategy = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'strategies', id));
      toast.success("Strategy deleted!");
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `strategies/${id}`);
      toast.error("Failed to delete strategy");
    }
  };

  const handleDeleteRow = (trade: any, indexInView: number) => {
    setDeleteConfirm({ item: trade, index: indexInView });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm || !user) return;
    const { item: trade, index: indexInView } = deleteConfirm;
    const id = trade.id;
    
    if (!id) {
      toast.error("Cannot delete item: Missing Unique ID");
      setDeleteConfirm(null);
      return;
    }

    setIsDeleting(true);
    console.log("APP: Confirmed deletion of ID:", id);

    if (trade.collection === 'bonds') {
      const originalBonds = [...bonds];
      setBonds(prev => prev.filter(b => b && b.id !== id).filter(Boolean));
      
      try {
        await deleteDoc(doc(db, 'bonds', id));
        localStorage.removeItem(`bond_payout_schedule_${id}`);
        localStorage.removeItem(`bond_notes_${id}`);
        setTimeout(() => fetchAllPrices(), 100);
        toast.success("Bond removed successfully.");
      } catch (err) {
        setBonds(originalBonds);
        handleFirestoreError(err, OperationType.DELETE, `bonds/${id}`);
        toast.error("Failed to delete bond", {
          description: "Database error occurred, data reverted."
        });
      }
    } else if (trade.collection === 'sips') {
      const originalSips = [...sips];
      setSips(prev => prev.filter(s => s.id !== id));
      try {
        await deleteDoc(doc(db, 'sips', id));
        toast.success("SIP removed successfully.");
      } catch (err) {
        setSips(originalSips);
        handleFirestoreError(err, OperationType.DELETE, `sips/${id}`);
        toast.error("Failed to delete SIP", {
          description: "Database error occurred, data reverted."
        });
      }
    } else if (trade.collection === 'ledger') {
      try {
        await deleteDoc(doc(db, 'ledger', id));
        toast.success("Ledger entry removed.");
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `ledger/${id}`);
        toast.error("Failed to delete ledger entry.");
      }
    } else if (trade.collection === 'dividends') {
      try {
        await deleteDoc(doc(db, 'dividends', id));
        toast.success("Dividend entry removed.");
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `dividends/${id}`);
        toast.error("Failed to delete dividend.");
      }
    } else {
      const originalTrades = [...trades];
      setTrades(prev => prev.filter(t => t && t.id !== id).filter(Boolean));
      
      try {
        await deleteDoc(doc(db, 'trades', id));
        localStorage.removeItem(`trade_alerts_${trade.stockSymbol}`);
        localStorage.removeItem(`trade_notes_${id}`);
        setTimeout(() => fetchAllPrices(), 100);
        toast.success("Trade removed successfully.");
      } catch (err) {
        setTrades(originalTrades);
        console.error("Delete trade failed:", err);
        toast.error("Deletion failed. Data reverted.");
      }
    }
    
    setIsDeleting(false);
    setDeleteConfirm(null);
  };

  const onExitBond = (bond: Bond) => {
    setExitBondData({
      bond,
      exitDate: new Date().toISOString().split('T')[0],
      redemptionAmount: bond.principal.toString(),
      remarks: ''
    });
  };

  const handleExitBond = async () => {
    if (!exitBondData || !user || !exitBondData.bond.id) return;
    try {
      const { bond, exitDate, redemptionAmount, remarks } = exitBondData;
      await updateDoc(doc(db, 'bonds', bond.id), sanitizePayload({
        status: 'Exited',
        exitDate,
        redemptionAmount: parseFloat(redemptionAmount),
        remarks: remarks || (bond as any).remarks || ""
      }));
      setExitBondData(null);
      toast.success("Bond exited successfully!");
    } catch (err) {
      console.error("Bond exit failed:", err);
      handleFirestoreError(err, OperationType.UPDATE, 'bonds');
    }
  };

  const getFIFOPlan = (trades: Trade[], stockSymbol: string, exitQuantity: number) => {
    const activeTrades = trades
      .filter(t => t.stockSymbol === stockSymbol && t.status === 'Active')
      .sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());

    let remainingToExit = exitQuantity;
    const plan = [];
    let totalAvailable = 0;

    for (const trade of activeTrades) {
      totalAvailable += trade.quantity;
      if (remainingToExit <= 0) continue;

      const take = Math.min(trade.quantity, remainingToExit);
      plan.push({
        trade,
        take,
        isFull: Math.abs(take - trade.quantity) < 0.000001
      });
      remainingToExit -= take;
    }

    return { plan, remainingToExit, totalAvailable };
  };

  const handleExitTrade = async () => {
    if (!exitTradeData || !user) return;
    const { method, manualLots, trade, price, date, quantity, remarks } = exitTradeData;
    
    if (!trade.id) {
      toast.error("Invalid trade ID");
      return;
    }

    const parsedPrice = parseFloat(price);
    const parsedQuantity = parseFloat(quantity);

    if (isNaN(parsedPrice)) {
      toast.error("Please enter a valid exit price");
      return;
    }
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      toast.error("Please enter a valid quantity");
      return;
    }
    if (!date) {
      toast.error("Please enter a valid exit date");
      return;
    }

    let itemsToProcess: { trade: Trade; take: number; isFull: boolean }[] = [];

    if (method === 'FIFO') {
      const { plan, remainingToExit } = getFIFOPlan(trades, trade.stockSymbol, parsedQuantity);
      if (remainingToExit > 0.000001) {
        toast.error(`Not enough quantity to exit. You only have ${parsedQuantity - remainingToExit} shares.`);
        return;
      }
      itemsToProcess = plan;
    } else {
      // Manual selection
      const totalManualQty = (Object.values(manualLots) as number[]).reduce((acc: number, q: number) => acc + q, 0);
      if (Math.abs(totalManualQty - parsedQuantity) > 0.000001) {
        toast.error(`Manual lot quantities (${totalManualQty}) do not match total exit quantity (${parsedQuantity})`);
        return;
      }

      for (const [lotId, lotQty] of Object.entries(manualLots) as [string, number][]) {
        if (lotQty <= 0) continue;
        const lotTrade = trades.find(t => t.id === lotId);
        if (!lotTrade) continue;
        
        itemsToProcess.push({
          trade: lotTrade,
          take: lotQty,
          isFull: Math.abs(lotQty - lotTrade.quantity) < 0.000001
        });
      }
    }

    try {
      const batch = writeBatch(db);
      
      for (const item of itemsToProcess) {
        const tradeRef = doc(db, 'trades', item.trade.id!);
        if (item.isFull) {
          // Full Exit
          batch.update(tradeRef, sanitizePayload({
            status: 'Sold',
            exitPrice: parsedPrice,
            exitDate: date,
            remarks: remarks || ""
          }));
        } else {
          // Partial Split
          // 1. Update existing record to remaining balance
          const remainingQty = item.trade.quantity - item.take;
          const share = item.take / item.trade.quantity;
          const takeCharges = (item.trade.charges || 0) * share;
          const takeInterest = (item.trade.interest || 0) * share;

          batch.update(tradeRef, sanitizePayload({ 
            quantity: remainingQty,
            charges: (item.trade.charges || 0) - takeCharges,
            interest: (item.trade.interest || 0) - takeInterest
          }));

          // 2. Create new record for the sold portion
          const newTradeRef = doc(collection(db, 'trades'));
          const { id: tradeId, ...tradeData } = item.trade;
          const soldRecord = {
            ...tradeData,
            quantity: item.take,
            charges: takeCharges,
            interest: takeInterest,
            status: 'Sold',
            exitPrice: parsedPrice,
            exitDate: date,
            uid: user.uid,
            remarks: remarks || ""
          };
          batch.set(newTradeRef, sanitizePayload(soldRecord));
        }
      }

      await batch.commit();
      setExitTradeData(null);
      toast.success(`Successfully exited ${parsedQuantity} shares of ${trade.stockName}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trades/${trade.id}`);
      toast.error("Failed to exit trade");
    }
  };

  const handleUnifiedAdd = async (data: Omit<Trade, 'id'> | Omit<Bond, 'id'>) => {
    if ('stockSymbol' in data) {
      await handleAddTrade(data as Omit<Trade, 'id'>);
      setActiveTab('activity');
    } else {
      await handleAddBond(data as Omit<Bond, 'id'>);
      setActiveTab('portfolio');
    }
  };

  const handleUnifiedUpdate = async (data: any) => {
    if (!user || !editTradeData) return;
    try {
      const id = editTradeData.id!;
      
      // Determine collection by checking local state
      const isActuallyABond = bonds.some(b => b.id === id);
      const isActuallyATrade = trades.some(t => t.id === id);
      const isActuallyASIP = sips.some(s => s.id === id);

      if (isActuallyASIP) {
        const sipData = data as Partial<SIP>;
        await updateDoc(doc(db, 'sips', id), sanitizePayload({ ...sipData, uid: user.uid }));
        setSips(prev => prev.map(s => s.id === id ? { ...s, ...sipData } : s));
        toast.success("SIP updated successfully!");
      } else if (isActuallyATrade) {
        // Check if we are upgrading to a SIP
        if (data.isSIP) {
           const sipData = {
              uid: user.uid,
              stockName: data.stockName,
              stockSymbol: data.stockSymbol || (editTradeData as Trade).stockSymbol,
              installmentAmount: parseFloat(data.sipInstallment),
              startDate: data.sipStartDate,
              dayOfMonth: parseInt(data.sipDayOfMonth),
              frequency: 'Monthly',
              status: 'Active',
              type: data.type || 'Mutual Fund',
              stepUpType: data.sipStepUpType,
              stepUpValue: parseFloat(data.sipStepUpValue) || 0,
              lastProcessedDate: new Date().toISOString().split('T')[0] // Don't backfill for existing
           };
           const sipRef = await addDoc(collection(db, 'sips'), sanitizePayload(sipData));
           
           // Link the current trade to this new SIP
           await updateDoc(doc(db, 'trades', id), { sipId: sipRef.id });
           toast.success("SIP enabled for this holding!");
        }

        const tradeData = data as Omit<Trade, 'id'>;
        // Preserve lastKnownPrice and lastPriceUpdate
        const existingTrade = trades.find(t => t.id === id);
        const updatePayload: any = {
          ...tradeData,
          uid: user.uid
        };
        
        // Ensure we don't lose stockSymbol if the form omitted it (e.g. if type changed to Bond)
        if (!updatePayload.stockSymbol && existingTrade?.stockSymbol) {
          updatePayload.stockSymbol = existingTrade.stockSymbol;
        }

        // Ensure price re-fetch
        updatePayload.lastKnownPrice = existingTrade?.lastKnownPrice || tradeData.entryPrice;
        updatePayload.lastPriceUpdate = new Date().toISOString();
        
        await updateDoc(doc(db, 'trades', id), sanitizePayload(updatePayload));
        setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updatePayload } : t));
        
        // Re-fetch immediate for UI sync
        fetchAllPrices([{ ...updatePayload, id } as Trade]);
      } else if (isActuallyABond) {
        const bondData = data as Omit<Bond, 'id'>;
        const updatePayload = {
          ...bondData,
          uid: user.uid
        };
        await updateDoc(doc(db, 'bonds', id), sanitizePayload(updatePayload));
        setBonds(prev => prev.map(b => b.id === id ? { ...b, ...updatePayload } : b));
        
        // Instant Refresh: Trigger stats recalibration
        setTimeout(() => fetchAllPrices(), 100);
      } else {
        // Fallback for safety if somehow missing from local state (e.g. race condition)
        const collectionName = ('stockSymbol' in data || 'symbol' in data) ? 'trades' : 'bonds';
        await updateDoc(doc(db, collectionName, id), sanitizePayload({ ...data, uid: user.uid }));
      }
      setEditTradeData(null);
      toast.success("Updated successfully!");
    } catch (err) {
      console.error("Update failed:", err);
      toast.error("Failed to update");
    }
  };

  const handleUpdateTrade = async (trade: Trade) => {
    if (!user || !trade.id) return;
    
    // Read-Before-Write: Log new values
    console.log("Updating trade with ID:", trade.id);
    console.log("New values:", trade);

    try {
      const { id, ...data } = trade;
      await updateDoc(doc(db, 'trades', id), sanitizePayload(data));
      
      // State Sync: Explicitly update local state for immediate feedback
      setTrades(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
      
      setEditTradeData(null);
      toast.success("Trade updated successfully!");
      
      // Re-fetch on Update: Trigger a fresh fetch for this stock
      fetchAllPrices([trade]);
    } catch (err) {
      console.error("Update failed:", err);
      handleFirestoreError(err, OperationType.UPDATE, `trades/${trade.id}`);
      toast.error("Failed to update trade");
    }
  };

  const handleLoadSampleData = async () => {
    if (!user) return;
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 35);
    const oneYearAgo = new Date(today);
    oneYearAgo.setDate(today.getDate() - 400);

    const sampleTrades = [
      { 
        stockName: 'HDFC Bank', 
        stockSymbol: 'HDFCBANK.NS',
        type: 'Stock',
        entryDate: oneYearAgo.toISOString().split('T')[0], 
        entryPrice: 1450, 
        quantity: 50, 
        charges: 100, 
        interest: 0, 
        status: 'Active', 
        sector: 'Bank', 
        marketCap: 'Largecap', 
        broker: 'Zerodha', 
        targetPrice: 1580 
      },
      { 
        stockName: 'TCS', 
        stockSymbol: 'TCS.NS',
        type: 'Stock',
        entryDate: thirtyDaysAgo.toISOString().split('T')[0], 
        entryPrice: 3800, 
        quantity: 10, 
        charges: 50, 
        interest: 0, 
        status: 'Active', 
        sector: 'IT', 
        marketCap: 'Largecap', 
        broker: 'Upstox', 
        targetPrice: 4142 
      },
      { 
        stockName: 'Zomato', 
        stockSymbol: 'ZOMATO.NS',
        type: 'Stock',
        entryDate: today.toISOString().split('T')[0], 
        entryPrice: 180, 
        quantity: 500, 
        charges: 200, 
        interest: 0, 
        status: 'Active', 
        sector: 'Tech', 
        marketCap: 'Midcap', 
        broker: 'Fyers', 
        targetPrice: 196 
      },
      { 
        stockName: 'NIFTY BEES', 
        stockSymbol: 'NIFTYBEES.NS',
        type: 'ETF',
        entryDate: thirtyDaysAgo.toISOString().split('T')[0], 
        entryPrice: 245, 
        quantity: 100, 
        charges: 20, 
        interest: 0, 
        status: 'Active', 
        sector: 'ETF', 
        marketCap: 'Largecap', 
        broker: 'Zerodha', 
        targetPrice: 270 
      },
      { 
        stockName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth', 
        stockSymbol: '122639',
        type: 'Mutual Fund',
        entryDate: thirtyDaysAgo.toISOString().split('T')[0], 
        entryPrice: 65.5, 
        quantity: 1000, 
        charges: 0, 
        interest: 0, 
        status: 'Active', 
        sector: 'Mutual Fund', 
        marketCap: 'N/A', 
        broker: 'Zerodha Coin', 
        targetPrice: 75 
      },
      { 
        stockName: 'Reliance Industries', 
        stockSymbol: 'RELIANCE.NS',
        type: 'Stock',
        entryDate: '2025-02-15', 
        entryPrice: 2500, 
        quantity: 10, 
        charges: 100, 
        interest: 0, 
        status: 'Sold', 
        exitDate: '2025-03-20', 
        exitPrice: 2800, 
        sector: 'Energy', 
        marketCap: 'Largecap', 
        broker: 'Upstox', 
        targetPrice: 2725 
      },
    ];
    const sampleLedger = [
      { date: '2025-01-01', broker: 'Zerodha', amount: 100000, type: 'Deposit' },
      { date: '2025-02-01', broker: 'Upstox', amount: 50000, type: 'Deposit' },
      { date: '2025-03-01', broker: 'Fyers', amount: 100000, type: 'Deposit' },
    ];
    const sampleDividends = [
      { stockName: 'HDFC Bank', month: '2025-03', amount: 500 },
    ];
    const sampleBonds = [
      { name: 'Govt of India 7.15% GS 2028', principal: 100000, interestRate: 7.15, frequency: 'Semi-Annually', purchaseDate: '2024-01-15' },
      { name: 'NHAI Tax Free Bond', principal: 50000, interestRate: 8.2, frequency: 'Annually', purchaseDate: '2023-11-10' },
      { name: 'Corporate Bond - Monthly', principal: 25000, interestRate: 9.5, frequency: 'Monthly', purchaseDate: '2025-01-01' },
    ];

    for (const t of sampleTrades) await handleAddTrade(t as any);
    for (const l of sampleLedger) await handleAddLedger(l as any);
    for (const d of sampleDividends) await handleAddDividend(d as any);
    for (const b of sampleBonds) await handleAddBond(b as any);
  };

  const downloadSampleCSV = () => {
    const headers = "Stock Name,Asset,Quantity,Price,Date,Sector,Broker,Type\n";
    const sampleRows = [
      "RELIANCE,Stock,10,2500.50,2024-01-15,Energy,Zerodha,Buy",
      "HDFCBANK,Stock,20,1650.00,2024-01-20,Bank,Upstox,Buy",
      "NIFTYBEES,ETF,50,250.00,2024-03-01,ETF,Zerodha,Buy"
    ].join("\n");
    const csvContent = headers + sampleRows;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "portfolio_sample_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.info("Sample template downloaded.");
  };

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    toast.loading("Processing CSV...", { id: 'csv-import' });

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      // transformHeader cleans the BOM character and normalizes case/spaces as per user request
      transformHeader: (header) => header.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]/g, ""),
      complete: async (results) => {
        const rows = results.data as any[];
        
        // Tracking which headers were mapped for a visual confirmation toast
        const mappedFields = new Set<string>();

        if (results.errors.length > 0 && rows.length === 0) {
          console.error("PapaParse Errors:", results.errors);
          toast.error(`File parsing error: ${results.errors[0].message}`, { id: 'csv-import' });
          return;
        }

        if (rows.length < 1) {
          toast.error("CSV file is empty or headers not matched.", { id: 'csv-import' });
          return;
        }

        // Helper to find normalized value and clean numeric strings
        const getCleanValue = (row: any, searchKeys: string[], fieldLabel?: string) => {
          for (const key of searchKeys) {
            const cleanKey = key.toLowerCase().replace(/[\s_-]/g, "");
            if (row[cleanKey] !== undefined && row[cleanKey] !== null && String(row[cleanKey]).trim() !== "") {
              if (fieldLabel) mappedFields.add(fieldLabel);
              return String(row[cleanKey]).trim();
            }
          }
          return undefined;
        };

        const parseNumeric = (val: string | undefined): number => {
          if (!val) return 0;
          // Strip currency symbols (like ₹, $), commas, and whitespace - user requirement
          const clean = val.replace(/[^\d.-]/g, '');
          const parsed = parseFloat(clean);
          return isNaN(parsed) ? 0 : parsed;
        };

        const normalizeDate = (dateStr: string | undefined): string => {
          if (!dateStr) return new Date().toISOString().split('T')[0];
          const cleanDate = dateStr.trim();
          
          // Handle common DD-MM-YYYY or DD/MM/YYYY
          if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(cleanDate)) {
            const separator = cleanDate.includes('-') ? '-' : '/';
            const [d, m, y] = cleanDate.split(separator);
            const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            if (!isNaN(new Date(iso).getTime())) return iso;
          }
          
          const d = new Date(cleanDate);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
          return new Date().toISOString().split('T')[0];
        };

        const tradesToCreate: Omit<Trade, 'id'>[] = [];
        let errorCount = 0;
        
        // Helper for aggressive fuzzy normalization
        const normalize = (val: string) => val.toLowerCase().replace(/[\s.]/g, '').trim();

        const fuse = new Fuse<{symbol: string, name: string, type: string}>(stockMasterList, {
          keys: [
            { name: 'symbol', weight: 0.7 },
            { name: 'name', weight: 0.3 }
          ],
          threshold: 0.2, // Tighter threshold for accuracy
          ignoreLocation: true
        });

        for (const row of rows) {
          try {
            // "Format-Agnostic" Fuzzy Header Mapping Rules:
            
            // 1. Identify Stock Name: Look for Stock, Symbol, Ticker, Stockname
            const rawSymbol = getCleanValue(row, ['symbol', 'stock', 'ticker', 'stockname', 'asset', 'stockcode', 'tradingsymbol', 'scrip', 'company_code'], 'Stock');
            const rawName = getCleanValue(row, ['stockname', 'name', 'company', 'instrument', 'security', 'description'], 'Stock Name') || rawSymbol || 'Unknown';
            
            // 2. Identify Price: Look for Buy Price, Entry Price, Purchase Price, Rate, Cost
            const price = parseNumeric(getCleanValue(row, ['buyprice', 'price', 'entryprice', 'purchaseprice', 'avgprice', 'nav', 'rate', 'cost', 'avg_cost'], 'Buy Price'));
            
            // 3. Identify Date: Look for Entry Date, Buy Date, or Purchase Date
            const date = normalizeDate(getCleanValue(row, ['entrydate', 'date', 'buydate', 'purchasedate', 'tradedate', 'dateofpurchase', 'transaction_date', 'purchase_date'], 'Date'));
            
            // 4. Identify Type/Action: Look for Type or Action
            const rawTypeOrAction = getCleanValue(row, ['type', 'action', 'status', 'trantype', 'transaction_type', 'side']);
            
            // Handle Quantity
            const qty = parseNumeric(getCleanValue(row, ['quantity', 'qty', 'units', 'volume', 'qty_available', 'balance_qty', 'holding_qty'], 'Quantity'));

            // Validation Rule: Need at least 'Symbol' or 'Name' and a 'Price'
            if ((!rawSymbol && !rawName) || price <= 0) {
              console.warn("Skipping row: missing Symbol/Name or Price mapping", row);
              errorCount++;
              continue;
            }

            // PROGRAMMATIC LINKING: Aggressive fuzzy matching
            let finalName = rawName;
            let finalSymbol = rawSymbol || '';
            let finalSector = getCleanValue(row, ['sector', 'industry', 'group']) || '';
            let status: TradeStatus = 'Active';
            let resolvedType: AssetType = 'Stock'; // Rule: Default 'Asset' to 'Stock' if not provided

            const normalizedInput = normalize(rawSymbol || rawName);
            const matchResults = fuse.search(normalizedInput);
            
            if (matchResults.length > 0) {
              const match = matchResults[0].item;
              // User requirement: assign matched properties
              finalName = match.name;
              finalSymbol = match.symbol;
              finalSector = formatSector(match.symbol, finalSector || (match as any).sector);
            } else {
              // User requirement: If no match, mark as 'Pending Link'
              status = 'Pending Link';
            }

            // Status logic override: check if it's already a sold trade in CSV
            if (rawTypeOrAction) {
              const lowerVal = rawTypeOrAction.toLowerCase();
              if (lowerVal.includes('sell') || lowerVal === 's') status = 'Sold';
            }

            // Check for explicit asset type mappings
            const separateAsset = getCleanValue(row, ['asset', 'assetclass', 'category', 'instrumenttype']);
            if (separateAsset) {
              const s = separateAsset.toLowerCase();
              if (s.includes('mut') || s.includes('mf') || s.includes('fund')) resolvedType = 'Mutual Fund';
              else if (s.includes('etf')) resolvedType = 'ETF';
              else if (s.includes('bond')) resolvedType = 'Bond';
              else if (s.includes('stock') || s.includes('equity')) resolvedType = 'Stock';
            }

            tradesToCreate.push({
              stockName: finalName,
              stockSymbol: finalSymbol,
              symbol: finalSymbol, // Extra field for UI binding compatibility
              stock: finalSymbol,  // Extra field for UI binding compatibility
              type: resolvedType,
              quantity: qty || 1, // Graceful default
              entryPrice: price,
              entryDate: date,
              status: status,
              sector: finalSector,
              marketCap: 'N/A',
              broker: (getCleanValue(row, ['broker', 'platform', 'source']) as any) || '', // Default to empty for 'Pending...' UI fallback
              targetPrice: price * 1.09,
              charges: 0,
              interest: 0,
              uid: user.uid
            });
          } catch (e) {
            errorCount++;
          }
        }

        if (tradesToCreate.length === 0) {
          toast.dismiss('csv-import');
          toast.error("Format mismatch: Could not map Symbol/Stock and Price columns.", { duration: 5000 });
          return;
        }

        // 2. Batch Processing (prices and Firestore)
        toast.loading(`Enriching ${tradesToCreate.length} trades with live data...`, { id: 'csv-import' });
        const uniqueSymbols = Array.from(new Set(tradesToCreate.map(t => t.stockSymbol)));
        const symbolTypes = uniqueSymbols.map(s => tradesToCreate.find(t => t.stockSymbol === s)?.type || 'Stock');
        const symbolNames = uniqueSymbols.map(s => tradesToCreate.find(t => t.stockSymbol === s)?.stockName || '');

        let liveData: Record<string, any> = {};
        try {
          const res = await axios.post('/api/prices', { symbols: uniqueSymbols, types: symbolTypes, names: symbolNames });
          liveData = res.data;
        } catch (e) {
          console.error("Batch price fetch failed", e);
          toast.warning("Limited live data", {
            description: "Some prices could not be fetched during import. Last known prices will be used.",
            id: 'csv-import'
          });
        }

        toast.loading(`Saving ${tradesToCreate.length} trades...`, { id: 'csv-import' });
        const CHUNK_SIZE = 450;
        let successCount = 0;

        for (let i = 0; i < tradesToCreate.length; i += CHUNK_SIZE) {
          const chunk = tradesToCreate.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);

          chunk.forEach(trade => {
            const docRef = doc(collection(db, 'trades'));
            const liveInfo = liveData[trade.stockSymbol] || {};
            const payload = { ...trade };
            
            if (payload.type === 'Stock') {
              payload.marketCap = getMarketCapCategory(payload.stockSymbol, liveInfo.marketCap) as any;
              payload.sector = formatSector(payload.stockSymbol, payload.sector);
            } else if (payload.type === 'ETF' || payload.type === 'Mutual Fund') {
              payload.sector = payload.type;
              payload.marketCap = 'N/A';
            }

            if (liveInfo.price) {
              payload.lastKnownPrice = liveInfo.price;
              payload.lastPriceUpdate = new Date().toISOString();
            }

            batch.set(docRef, sanitizePayload(payload));
          });

          try {
            await batch.commit();
            successCount += chunk.length;
          } catch (e) {
            handleFirestoreError(e, OperationType.WRITE, 'trades/batch-import');
            console.error("Batch write failed", e);
            errorCount += chunk.length;
          }
        }

        toast.dismiss('csv-import');
        if (successCount > 0) {
          toast.success(`Import complete! Successfully added ${successCount} trades.`);
          
          // Visual Confirmation of mapping - user requested
          if (mappedFields.has('Stock') && mappedFields.has('Buy Price')) {
            toast.info("Data Mapped Successfully", {
              description: "Mapped 'Stock' to 'Stock Name' and 'Buy Price' to 'Price'.",
              duration: 5000
            });
          }

          // Trigger immediate price refresh for imported active trades - user requested
          const newActiveTrades = tradesToCreate.filter(t => t.status === 'Active' || t.status === 'Pending Link');
          if (newActiveTrades.length > 0) {
            // Trigger API call for LTP immediately using newly assigned symbols
            fetchAllPrices(newActiveTrades as Trade[]);
          }
        }
        if (errorCount > 0) {
          toast.error(`${errorCount} rows skipped due to errors.`);
        }
        event.target.value = '';
      },
      error: (error) => {
        toast.dismiss('csv-import');
        toast.error(`CSV Parsing Error: ${error.message}`);
      }
    });
  };

  const overallXIRR = useMemo(() => {
    const flows: { amount: number; date: string }[] = [];

    // 1. Trades (Buy, Sell)
    trades.forEach(t => {
      // Buy (Outflow)
      const investment = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
      flows.push({ amount: -investment, date: t.entryDate });
      
      // Sell (Inflow)
      if (t.status === 'Sold' && t.exitPrice && t.exitDate) {
        const realization = t.exitPrice * t.quantity;
        flows.push({ amount: realization, date: t.exitDate });
      }
    });

    // 2. Dividends (Inflow)
    dividends.forEach(d => {
      flows.push({ amount: d.amount, date: d.date || `${d.month}-01` });
    });

    // 3. Bonds (Invest, Redeem, Payouts)
    bonds.forEach(b => {
      // Purchase (Outflow)
      flows.push({ amount: b.principal ? -b.principal : 0, date: b.purchaseDate });
      
      // Redemption (Inflow)
      if (b.status === 'Exited' && b.exitDate) {
        flows.push({ amount: b.redemptionAmount || b.principal, date: b.exitDate });
      }
      
      // Payouts (Inflow)
      b.payoutSchedule?.forEach(p => {
        if (p.status === 'Received') {
          flows.push({ amount: p.amount, date: p.date });
        }
      });
    });

    // 4. Terminal Value (Active portfolio value today)
    const activeStats = trades.filter(t => t.status === 'Active');
    const activeBonds = bonds.filter(b => b.status === 'Active');
    
    const tradeValue = activeStats.reduce((acc, t) => {
      const live = currentPrices[t.stockSymbol];
      const price = (live && live > 0) ? live : (t.lastKnownPrice && t.lastKnownPrice > 0 ? t.lastKnownPrice : 0);
      return acc + (price * Number(t.quantity));
    }, 0);
    
    const bondValue = activeBonds.reduce((acc, b) => acc + b.principal + calculateAccruedInterest(b), 0);
    
    const currentPortfolioValue = tradeValue + bondValue;
    
    if (currentPortfolioValue > 0) {
      flows.push({ amount: currentPortfolioValue, date: new Date().toISOString().split('T')[0] });
    }

    if (flows.length < 2) return null;
    return calculateXIRR(flows);
  }, [trades, dividends, bonds, currentPrices]);

  const realizedXIRR = useMemo(() => {
    const flows: { amount: number; date: string }[] = [];
    
    // Set of symbols that have some form of realization
    const realizedSymbols = new Set<string>();
    trades.filter(t => t.status === 'Sold').forEach(t => realizedSymbols.add(t.stockSymbol));
    dividends.forEach(d => {
      const t = trades.find(tr => tr.stockName.toLowerCase() === d.stockName.toLowerCase());
      if (t) realizedSymbols.add(t.stockSymbol);
    });
    bonds.forEach(b => {
      if (b.status === 'Exited' || b.payoutSchedule?.some(p => p.status === 'Received')) {
        realizedSymbols.add(b.name);
      }
    });

    // 1. Trades for realized symbols
    realizedSymbols.forEach(symbol => {
      const symbolTrades = trades.filter(t => t.stockSymbol === symbol);
      if (symbolTrades.length === 0) return;

      symbolTrades.forEach(t => {
        // Buy
        const investment = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
        flows.push({ amount: -investment, date: t.entryDate });
        // Sell
        if (t.status === 'Sold' && t.exitPrice && t.exitDate) {
          flows.push({ amount: t.exitPrice * t.quantity, date: t.exitDate });
        }
      });

      // Current Value of remaining active portion
      const activeQty = symbolTrades.filter(t => t.status === 'Active').reduce((sum, t) => sum + t.quantity, 0);
      if (activeQty > 0) {
        const currentPrice = currentPrices[symbol] || symbolTrades.find(t => t.status === 'Active')?.entryPrice || 0;
        flows.push({ amount: currentPrice * activeQty, date: new Date().toISOString().split('T')[0] });
      }

      // Dividends for this symbol
      const name = symbolTrades[0].stockName;
      dividends.filter(d => d.stockName.toLowerCase() === name.toLowerCase()).forEach(d => {
        flows.push({ amount: d.amount, date: d.date || `${d.month}-01` });
      });
    });

    // 2. Bonds for realized symbols (already handled in step 1 if we treat them similar, but let's do separately for clarity)
    bonds.filter(b => realizedSymbols.has(b.name)).forEach(b => {
      // Outflow
      flows.push({ amount: -Number(b.principal), date: b.purchaseDate });
      
      // Interest
      b.payoutSchedule?.forEach(p => {
        if (p.status === 'Received') {
          flows.push({ amount: p.amount, date: p.date });
        }
      });

      // Redemption or Current Value
      if (b.status === 'Exited' && b.exitDate) {
        flows.push({ amount: b.redemptionAmount || b.principal, date: b.exitDate });
      } else {
        const accrued = calculateAccruedInterest(b);
        flows.push({ amount: Number(b.principal) + accrued, date: new Date().toISOString().split('T')[0] });
      }
    });

    if (flows.length < 2) return null;
    return calculateXIRR(flows);
  }, [trades, dividends, bonds, currentPrices]);

  const activeXIRR = useMemo(() => {
    const flows: { amount: number; date: string }[] = [];
    
    // Only current active holdings
    const activeStats = trades.filter(t => t.status === 'Active' || t.status === 'Pending Link');
    const activeBondsList = bonds.filter(b => b.status === 'Active' || !b.status);
    
    activeStats.forEach(t => {
      const investment = (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0);
      flows.push({ amount: -investment, date: t.entryDate });
    });
    
    activeBondsList.forEach(b => {
      flows.push({ amount: -Number(b.principal), date: b.purchaseDate });
    });

    // Dividends related to active holdings (this is debatable, but let's include all dividends to be consistent with overall)
    // Actually, for "Invested (Active)", maybe we should only include dividends from current holdings.
    const activeNames = new Set(activeStats.map(t => t.stockName).concat(activeBondsList.map(b => b.name)));
    dividends.filter(d => activeNames.has(d.stockName.toUpperCase()) || activeNames.has(d.stockName.toLowerCase())).forEach(d => {
      flows.push({ amount: d.amount, date: d.date || `${d.month}-01` });
    });

    // Terminal Value
    const tradeValue = activeStats.reduce((acc, t) => {
      const live = currentPrices[t.stockSymbol];
      const price = (live && live > 0) ? live : (t.lastKnownPrice && t.lastKnownPrice > 0 ? t.lastKnownPrice : 0);
      return acc + (price * Number(t.quantity));
    }, 0);
    const bondValue = activeBondsList.reduce((acc, b) => acc + Number(b.principal) + calculateAccruedInterest(b), 0);
    
    const currentPortfolioValue = tradeValue + bondValue;
    if (currentPortfolioValue > 0) {
      flows.push({ amount: currentPortfolioValue, date: new Date().toISOString().split('T')[0] });
    }

    if (flows.length < 2) return null;
    return calculateXIRR(flows);
  }, [trades, dividends, bonds, currentPrices]);

  const handleScanScreenshot = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    setIsScanning(true);
    setShowScanDialog(true);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const resultData = e.target?.result as string;
      const base64Data = resultData.split(',')[1];
      const detectedMimeType = resultData.split(';')[0].split(':')[1] || file.type || 'image/png';
      
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: detectedMimeType,
                    data: base64Data,
                  },
                },
                {
                  text: "Extract trade data from this portfolio screenshot. Return a JSON array of objects representing each trade or holding. IMPORTANT: Correctly identify the 'type' for each entry. Use 'ETF' for Index funds, Exchange Traded Funds (e.g., NIFTYBEES, GOLDBEES, JuniorBeES, LIQUIDCASE, or any name containing 'ETF', 'BEES', 'Liquid', '1D Rate'). Use 'Stock' for individual company shares (e.g., RELIANCE, TCS). Use 'Mutual Fund' for mutual fund schemes. For ETFs, use specific sectors if applicable: 'COMMODITY (SILVER)', 'COMMODITY (GOLD)', 'CASH EQUIVALENT' (for Liquid ETFs), 'EQUITY (MIDCAP)' (for Midcap ETFs), or 'Nifty/ETF' for others. Extract: stockName, stockSymbol, type, quantity, entryPrice, entryDate, sector, marketCap, broker.",
                },
              ],
            }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  stockName: { type: Type.STRING },
                  stockSymbol: { type: Type.STRING },
                  type: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  entryPrice: { type: Type.NUMBER },
                  entryDate: { type: Type.STRING },
                  sector: { type: Type.STRING },
                  marketCap: { type: Type.STRING },
                  broker: { type: Type.STRING },
                },
                required: ['stockName', 'stockSymbol', 'type', 'quantity', 'entryPrice', 'entryDate'],
              },
            },
          },
        });

        const text = response.text;
        if (!text) throw new Error('No content returned from AI analysis.');

        const result = JSON.parse(text);
        const processedTrades = Array.isArray(result) ? result.map((t: any) => {
          let type = t.type || 'Stock';
          let sector = t.sector || 'Other';
          
          // Heuristic normalization for ETFs often misidentified as Finance stocks
          const lowerName = (t.stockName || '').toLowerCase();
          const lowerSymbol = (t.stockSymbol || '').toLowerCase();
          
          const isETF = 
            lowerName.includes('etf') || 
            lowerSymbol.includes('etf') || 
            lowerName.includes('bees') || 
            lowerSymbol.includes('bees') || 
            lowerName.includes('index') || 
            lowerName.includes('liquid') ||
            lowerName.includes('bond') ||
            lowerSymbol.includes('midcap');

          if (isETF) {
            type = 'ETF';
          }

          // Specific user requested sectors for Zerodha/Common ETFs
          if (lowerName.includes('silver') || lowerSymbol.includes('silver')) sector = 'COMMODITY (SILVER)';
          else if (lowerName.includes('gold') || lowerSymbol.includes('gold')) sector = 'COMMODITY (GOLD)';
          else if (lowerName.includes('liquid') || lowerName.includes('1d rate') || lowerSymbol.includes('liquid')) sector = 'CASH EQUIVALENT';
          else if (lowerName.includes('midcap 150') || lowerName.includes('midcap150') || lowerSymbol.includes('midcap')) sector = 'EQUITY (MIDCAP)';
          else if (isETF && (!t.sector || t.sector === 'Finance' || t.sector === 'Other' || t.sector === 'Financial Services')) {
            sector = 'Nifty/ETF';
          }

          return {
            ...t,
            type,
            sector: type === 'Mutual Fund' ? 'Mutual Fund' : sector,
            status: 'Active',
            charges: 0,
            interest: 0,
            targetPrice: (Number(t.entryPrice) || 0) * 1.09,
            marketCap: (type === 'Mutual Fund' || type === 'ETF') ? 'N/A' : (t.marketCap || 'Midcap'),
            broker: t.broker || 'Zerodha',
          };
        }) : [];
        
        setScannedTrades(processedTrades);

        // Save to Firestore for cross-device sync
        if (user && processedTrades.length > 0) {
          try {
            await addDoc(collection(db, 'pendingScans'), sanitizePayload({
              extractedData: processedTrades,
              timestamp: new Date().toISOString(),
              uid: user.uid,
              deviceName: /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile Device' : 'Desktop'
            }));
            toast.success("Scan results synced to your account.");
          } catch (syncErr) {
            handleFirestoreError(syncErr, OperationType.CREATE, 'pendingScans');
            console.error("Failed to sync scan result:", syncErr);
          }
        }
      } catch (err: any) {
        console.error("Scanning failed:", err.message || err);
        
        let errorMsg = err.message || 'Gemini AI was unable to parse the image.';
        if (err.errors || err.subErrors) {
          const apiErrors = err.errors || err.subErrors;
          const detail = Array.isArray(apiErrors) ? apiErrors.map((e: any) => e.message || e.reason || (typeof e === 'object' ? JSON.stringify(e) : e)).join(', ') : '';
          if (detail) errorMsg = `AI Error: ${detail}`;
        }

        toast.error(errorMsg, {
            description: "Please try a clearer screenshot or check your API quota."
        });
        setShowScanDialog(false);
      } finally {
        setIsScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleImportScannedTrades = async () => {
    for (const trade of scannedTrades) {
      await handleAddTrade(trade);
    }
    
    // If it was a pending scan, clear it
    if (user && pendingScans.length > 0) {
      const match = pendingScans.find(s => JSON.stringify(s.extractedData) === JSON.stringify(scannedTrades));
      if (match) {
        await deleteDoc(doc(db, 'pendingScans', match.id));
      }
    }

    setScannedTrades([]);
    setShowScanDialog(false);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 text-center">
        <div className="max-w-md space-y-6">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">WealthTrack</h1>
            <p className="text-muted-foreground text-lg">Your professional portfolio management companion.</p>
          </div>
          <Button onClick={signIn} size="lg" className="w-full gap-2">
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </Button>
          <p className="text-xs text-muted-foreground">Secure authentication powered by Firebase</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-2 sm:p-4 md:p-8 max-w-7xl mx-auto pb-32 sm:pb-8">
      <Toaster position="top-right" richColors />
      <header className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 relative bg-background/80 backdrop-blur-sm sm:bg-transparent z-40 py-2 sm:py-0">
        <div className="flex items-center justify-between w-full sm:w-auto">
          <div>
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight">WealthTrack</h1>
            <p className="text-[10px] sm:text-sm text-muted-foreground uppercase font-bold tracking-widest">Portfolio Analytics</p>
          </div>
          <div className="flex items-center gap-1 sm:hidden">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowActionsDialog(true)} 
              className="rounded-full relative h-9 w-9"
            >
              <Bell className="w-5 h-5" />
              {corporateActions.filter(a => a.status === 'Detected').length > 0 && (
                <span className="absolute top-1 right-1 bg-red-600 text-white text-[8px] font-bold px-1 rounded-full animate-pulse">
                  {corporateActions.filter(a => a.status === 'Detected').length}
                </span>
              )}
            </Button>
            <Label htmlFor="screenshot-scan-mobile" className="cursor-pointer">
              <div className="flex items-center justify-center w-9 h-9 bg-blue-600/10 text-blue-600 rounded-full hover:bg-blue-600/20 transition-colors">
                <Camera className="w-5 h-5" />
              </div>
              <input 
                id="screenshot-scan-mobile" 
                type="file" 
                accept="image/*" 
                className="hidden" 
                onChange={handleScanScreenshot} 
              />
            </Label>
            <Button variant="ghost" size="icon" onClick={logOut} className="rounded-full h-9 w-9">
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
        <div className="hidden sm:flex items-center justify-end gap-3 sm:gap-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={checkCorporateActions} 
            disabled={isCheckingActions}
            className="text-xs gap-2 relative"
          >
            {isCheckingActions ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
            <span>Check Actions</span>
            {corporateActions.filter(a => a.status === 'Detected').length > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                {corporateActions.filter(a => a.status === 'Detected').length}
              </span>
            )}
          </Button>
          <div className="flex items-center gap-2">
            <Label htmlFor="screenshot-scan" className="cursor-pointer">
              <div className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-md text-xs font-medium hover:bg-blue-700 transition-all shadow-sm">
                <Camera className="w-3.5 h-3.5" />
                <span>Scan Screenshot</span>
              </div>
              <input 
                id="screenshot-scan" 
                type="file" 
                accept="image/*" 
                className="hidden" 
                onChange={handleScanScreenshot} 
              />
            </Label>
            <div className="flex flex-col gap-2">
              <Label htmlFor="csv-import" className="cursor-pointer">
                <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-md text-xs font-medium hover:bg-muted/80 transition-all border border-muted-foreground/20">
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Import CSV</span>
                </div>
                <input 
                  id="csv-import" 
                  type="file" 
                  accept=".csv" 
                  className="hidden" 
                  onChange={handleImportCSV} 
                />
              </Label>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={downloadSampleCSV}
                className="h-6 text-[9px] uppercase tracking-tighter font-black text-muted-foreground hover:text-primary"
              >
                Download Sample CSV
              </Button>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-medium">{user.displayName}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={logOut} className="rounded-full">
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {user && pendingScans.length > 0 && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-blue-900">Sync complete: New scans from your devices</p>
              <p className="text-xs text-blue-700">Confirm {pendingScans.length} scan(s) to add them to your portfolio.</p>
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto justify-end">
            <Button 
              variant="outline" 
              size="sm" 
              className="text-xs bg-white h-9 px-4 font-bold border-blue-200 text-blue-700 hover:bg-blue-100"
              onClick={() => {
                setScannedTrades(pendingScans[0].extractedData);
                setShowScanDialog(true);
              }}
            >
              Review Latest
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-xs h-9 px-4 font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-100"
              onClick={async () => {
                const batchPromises = pendingScans.map(scan => deleteDoc(doc(db, 'pendingScans', scan.id)));
                await Promise.all(batchPromises);
                toast.success("Pending scans cleared");
              }}
            >
              Clear All
            </Button>
          </div>
        </div>
      )}

      <ShadcnTabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
        <ShadcnTabsList className="fixed bottom-0 left-0 right-0 z-50 flex w-full h-16 p-1 bg-background/80 backdrop-blur-md border-t sm:relative sm:h-auto sm:bg-muted/50 sm:border-0 sm:rounded-xl sm:justify-center grid grid-cols-5 max-w-2xl mx-auto">
          <ShadcnTabsTrigger value="portfolio" className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-1 sm:py-2 px-1 sm:px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <LayoutDashboard className="w-5 h-5 sm:w-4 sm:h-4 text-primary" />
            <div className="flex flex-col items-center sm:items-start">
              <span className="text-[10px] sm:text-sm font-bold">Dashboard</span>
              <span className="hidden sm:block text-[8px] text-muted-foreground uppercase tracking-tight">Overview</span>
            </div>
          </ShadcnTabsTrigger>
          <ShadcnTabsTrigger value="holdings" className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-1 sm:py-2 px-1 sm:px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <PieChart className="w-5 h-5 sm:w-4 sm:h-4 text-primary" />
            <div className="flex flex-col items-center sm:items-start">
              <span className="text-[10px] sm:text-sm font-bold">Holdings</span>
              <span className="hidden sm:block text-[8px] text-muted-foreground uppercase tracking-tight">Summary</span>
            </div>
          </ShadcnTabsTrigger>
          <ShadcnTabsTrigger value="strategies" className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-1 sm:py-2 px-1 sm:px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Briefcase className="w-5 h-5 sm:w-4 sm:h-4 text-primary" />
            <div className="flex flex-col items-center sm:items-start">
              <span className="text-[10px] sm:text-sm font-bold">Strategies</span>
              <span className="hidden sm:block text-[8px] text-muted-foreground uppercase tracking-tight">Buckets</span>
            </div>
          </ShadcnTabsTrigger>
          <ShadcnTabsTrigger value="activity" className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-1 sm:py-2 px-1 sm:px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm relative">
            <List className="w-5 h-5 sm:w-4 sm:h-4 text-primary" />
            <div className="flex flex-col items-center sm:items-start">
              <span className="text-[10px] sm:text-sm font-bold">Activity</span>
              <span className="hidden sm:block text-[8px] text-muted-foreground uppercase tracking-tight">Records</span>
            </div>
            {corporateActions.filter(a => a.status === 'Detected').length > 0 && (
              <span className="absolute top-2 right-4 bg-primary text-primary-foreground text-[8px] font-bold h-4 w-4 flex items-center justify-center rounded-full ring-2 ring-background">
                {corporateActions.filter(a => a.status === 'Detected').length}
              </span>
            )}
          </ShadcnTabsTrigger>

          <ShadcnTabsTrigger value="bonds" className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-1 sm:py-2 px-1 sm:px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Landmark className="w-5 h-5 sm:w-4 sm:h-4 text-primary" />
            <div className="flex flex-col items-center sm:items-start">
              <span className="text-[10px] sm:text-sm font-bold">Bonds</span>
              <span className="hidden sm:block text-[8px] text-muted-foreground uppercase tracking-tight">Debt</span>
            </div>
          </ShadcnTabsTrigger>
        </ShadcnTabsList>

        <ShadcnTabsContent value="portfolio" className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <Dashboard 
            stats={stats} 
            trades={trades} 
            dividends={dividends} 
            ledger={ledger} 
            bonds={bonds}
            processedPortfolio={processedPortfolio}
            onLoadSampleData={handleLoadSampleData}
            onAddMore={(symbol, name, type) => setAddMoreTradeData({ stockSymbol: symbol, stockName: name, type: type as any })}
            lastUpdated={lastUpdated}
            overallXIRR={overallXIRR}
            realizedXIRR={realizedXIRR}
            activeXIRR={activeXIRR}
            currentPrices={currentPrices}
          />
          
          {corporateActions.length > 0 && (
            <div className="border-t pt-12 mt-12">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Bell className="w-5 h-5 text-primary" />
                    Corporate Actions
                  </h2>
                  <p className="text-sm text-muted-foreground">Dividends, splits, and bonuses detected for your portfolio</p>
                </div>
                <Button 
                  onClick={checkCorporateActions} 
                  disabled={isCheckingActions}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  {isCheckingActions ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Check for New Actions
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {corporateActions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 3).map((action) => (
                  <div key={action.id} className={`p-4 rounded-xl border transition-all ${action.status === 'Applied' ? 'bg-muted/30 border-muted opacity-60' : 'bg-card shadow-sm border-primary/20 hover:border-primary/40'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          action.type === 'Dividend' ? 'bg-green-100 text-green-700' : 
                          action.type === 'Split' ? 'bg-blue-100 text-blue-700' : 
                          'bg-purple-100 text-purple-700'
                        }`}>
                          {action.type}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{action.date}</span>
                      </div>
                      {action.status === 'Detected' && (
                        <Button size="sm" variant="ghost" onClick={() => applyCorporateAction(action)} className="h-6 w-6 p-0 text-primary">
                          <Check className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    <h4 className="font-bold text-sm tracking-tight">{action.stockName}</h4>
                    <p className="text-[10px] text-muted-foreground line-clamp-2 mt-1">{action.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-12 border-t mt-12 space-y-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Landmark className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold">Broker & Entity Overview</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(
                ledger.reduce((acc: Record<string, number>, entry) => {
                  const amount = entry.type === 'Deposit' ? entry.amount : -entry.amount;
                  acc[entry.broker] = (acc[entry.broker] || 0) + amount;
                  return acc;
                }, {})
              ).map(([broker, balance]) => (
                <div key={broker} className="bg-card border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all border-l-4 border-l-primary/30">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{broker}</span>
                    <span className={`text-xl font-black ${(balance as number) >= 0 ? 'text-foreground' : 'text-red-600'}`}>
                      ₹{(balance as number).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ShadcnTabsContent>

        <ShadcnTabsContent value="holdings" className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <PortfolioSummary 
            trades={trades} 
            dividends={dividends}
            bonds={bonds}
            sips={sips}
            processedPortfolio={processedPortfolio}
            currentPrices={currentPrices}
            realizedXIRR={realizedXIRR}
            overallXIRR={overallXIRR}
            activeXIRR={activeXIRR}
            onAddMore={(symbol, name, type) => setAddMoreTradeData({ stockSymbol: symbol, stockName: name, type: type as any })}
            onExit={(symbol) => {
              const trade = trades.find(t => t.stockSymbol === symbol && t.status === 'Active');
              if (trade) {
                const totalQty = trades
                  .filter(t => t.stockSymbol === symbol && t.status === 'Active')
                  .reduce((acc, curr) => acc + curr.quantity, 0);

                setExitTradeData({ 
                  trade, 
                  price: (currentPrices[trade.stockSymbol] || trade.lastKnownPrice || trade.entryPrice).toString(), 
                  date: new Date().toISOString().split('T')[0],
                  quantity: totalQty.toString(),
                  remarks: "",
                  method: 'FIFO',
                  manualLots: {}
                });
              }
            }}
            onEditBond={(bond) => setEditTradeData(bond)}
            onDeleteBond={(id) => {
              const bond = bonds.find(b => b.id === id);
              if (bond) handleDeleteRow({ ...bond, collection: 'bonds' }, -1);
            }}
            onExitBond={onExitBond}
            onEditSIP={(sip) => setEditTradeData(sip)}
            onDeleteSIP={(id) => {
              const sip = sips.find(s => s.id === id);
              if (sip) handleDeleteRow({ ...sip, collection: 'sips' }, -1);
            }}
          />
        </ShadcnTabsContent>

        <ShadcnTabsContent value="strategies" className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <HoldingStrategies
            strategies={strategies}
            portfolioEntries={processedPortfolio}
            trades={trades}
            dividends={dividends}
            onAddStrategy={handleAddStrategy}
            onUpdateStrategy={handleUpdateStrategy}
            onDeleteStrategy={handleDeleteStrategy}
          />
        </ShadcnTabsContent>

        <ShadcnTabsContent value="bonds" className="animate-in fade-in slide-in-from-bottom-2 duration-500">
          <Bonds 
            bonds={bonds}
            onEdit={(bond) => setEditTradeData(bond)}
            onDelete={(id) => {
              const bond = bonds.find(b => b.id === id);
              if (bond) handleDeleteRow({ ...bond, collection: 'bonds' }, -1);
            }}
            onExit={onExitBond}
          />
        </ShadcnTabsContent>

        <ShadcnTabsContent value="activity" className="space-y-12 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-12 sm:pb-0">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-1 space-y-6">
              <div className="bg-card border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <PlusCircle className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-bold">Quick Entry</h2>
                </div>
                
                <ShadcnTabs defaultValue="trade" className="w-full">
                  <ShadcnTabsList className="grid grid-cols-3 mb-6">
                    <ShadcnTabsTrigger value="trade" className="text-xs">Trade</ShadcnTabsTrigger>
                    <ShadcnTabsTrigger value="ledger" className="text-xs">Ledger</ShadcnTabsTrigger>
                    <ShadcnTabsTrigger value="dividend" className="text-xs">Div.</ShadcnTabsTrigger>
                  </ShadcnTabsList>
                  
                  <ShadcnTabsContent value="trade">
                    <TradeForm onSubmit={handleUnifiedAdd} />
                  </ShadcnTabsContent>
                  
                  <ShadcnTabsContent value="ledger">
                    <LedgerForm onSubmit={handleAddLedger} />
                  </ShadcnTabsContent>
                  
                  <ShadcnTabsContent value="dividend">
                    <DividendForm onSubmit={handleAddDividend} />
                  </ShadcnTabsContent>
                </ShadcnTabs>
              </div>
            </div>

            <div className="xl:col-span-2 space-y-6">
              <ShadcnTabs defaultValue="trades" className="w-full space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card border p-4 rounded-2xl shadow-sm">
                  <div>
                    <h3 className="text-lg font-bold">Activity & Records</h3>
                    <p className="text-xs text-muted-foreground">Switch between your historical trade logs, dividends, and cash ledger</p>
                  </div>
                  <ShadcnTabsList className="grid grid-cols-3 w-full sm:w-[360px] h-10">
                    <ShadcnTabsTrigger value="trades" className="text-xs font-bold">Trade Log</ShadcnTabsTrigger>
                    <ShadcnTabsTrigger value="dividends" className="text-xs font-bold">Dividends</ShadcnTabsTrigger>
                    <ShadcnTabsTrigger value="ledger" className="text-xs font-bold">Broker Ledger</ShadcnTabsTrigger>
                  </ShadcnTabsList>
                </div>

                <ShadcnTabsContent value="trades" className="m-0 animate-in fade-in-50 duration-300">
                  <TradeLog 
                    trades={trades} 
                    bonds={bonds}
                    currentPrices={currentPrices}
                    fetchingSymbols={fetchingSymbols}
                    onRefreshPrices={() => fetchAllPrices()}
                    onExitTrade={(trade) => setExitTradeData({ 
                      trade, 
                      price: (currentPrices[trade.stockSymbol] || trade.lastKnownPrice || trade.entryPrice).toString(), 
                      date: new Date().toISOString().split('T')[0],
                      quantity: trade.quantity.toString(),
                      remarks: trade.remarks || "",
                      method: 'FIFO',
                      manualLots: { [trade.id!]: trade.quantity }
                    })} 
                    onEditTrade={(trade) => setEditTradeData(trade)}
                    onDeleteTrade={handleDeleteRow}
                    onExitBond={onExitBond}
                    onAddMore={(trade) => setAddMoreTradeData({ 
                      stockSymbol: trade.stockSymbol, 
                      stockName: trade.stockName, 
                      type: trade.type,
                      sector: trade.sector,
                      marketCap: trade.marketCap,
                      broker: trade.broker
                    })}
                  />
                </ShadcnTabsContent>

                <ShadcnTabsContent value="dividends" className="m-0 animate-in fade-in-50 duration-300">
                  <div className="space-y-6">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600">
                        <Gift className="w-5 h-5" />
                      </div>
                      <h2 className="text-xl font-bold font-heading">Dividend History</h2>
                    </div>
                    <Dividends dividends={dividends} onDelete={handleDeleteDividend} />
                  </div>
                </ShadcnTabsContent>

                <ShadcnTabsContent value="ledger" className="m-0 animate-in fade-in-50 duration-300">
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 mb-6">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <Landmark className="w-5 h-5" />
                      </div>
                      <h2 className="text-xl font-bold">Broker Overview & Ledger</h2>
                    </div>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      <div className="lg:col-span-1">
                        <div className="bg-card border rounded-2xl p-6 shadow-sm h-full">
                          <h3 className="text-sm font-bold uppercase tracking-wider mb-4 opacity-70">Summary by Broker</h3>
                          <div className="space-y-4">
                            {BROKERS.map(broker => {
                              const brokerLedger = ledger.filter(e => e.broker === broker);
                              const deposits = brokerLedger.filter(e => e.type === 'Deposit').reduce((sum, e) => sum + e.amount, 0);
                              const withdrawals = brokerLedger.filter(e => e.type === 'Withdrawal').reduce((sum, e) => sum + e.amount, 0);
                              const activeInvested = trades
                                .filter(t => t.broker === broker && t.status === 'Active')
                                .reduce((sum, t) => sum + (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0), 0);
                              
                              const availableBalance = deposits - withdrawals - activeInvested;
                              
                              if (deposits === 0 && withdrawals === 0 && activeInvested === 0) return null;

                              return (
                                <div key={broker} className="p-4 rounded-xl bg-muted/30 border border-transparent hover:border-sidebar-border transition-all space-y-3">
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs font-black uppercase tracking-widest text-primary">{broker}</span>
                                    <Badge variant={availableBalance >= 0 ? "outline" : "destructive"} className="text-[10px] font-bold py-0 h-5">
                                      {availableBalance >= 0 ? 'Liquid' : 'Overdrawn'}
                                    </Badge>
                                  </div>
                                  <div className="grid grid-cols-2 gap-y-3 gap-x-2">
                                    <div className="flex flex-col">
                                      <span className="text-[9px] text-muted-foreground uppercase font-bold">Deposited</span>
                                      <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">₹{deposits.toLocaleString()}</span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                      <span className="text-[9px] text-muted-foreground uppercase font-bold">Withdrawn</span>
                                      <span className="text-xs font-mono font-bold text-muted-foreground">₹{withdrawals.toLocaleString()}</span>
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-[9px] text-muted-foreground uppercase font-bold">Invested</span>
                                      <span className="text-xs font-mono font-bold">₹{activeInvested.toLocaleString()}</span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                      <span className="text-[9px] text-muted-foreground uppercase font-bold">Available</span>
                                      <span className={`text-xs font-mono font-bold ${availableBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        ₹{availableBalance.toLocaleString()}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            <div className="pt-4 mt-2 border-t space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold uppercase text-muted-foreground">Total Deposits</span>
                                <span className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400">
                                  ₹{ledger.filter(e => e.type === 'Deposit').reduce((sum, e) => sum + e.amount, 0).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold uppercase text-muted-foreground">Total Invested</span>
                                <span className="text-sm font-mono font-bold">
                                  ₹{trades.filter(t => t.status === 'Active').reduce((acc, t) => acc + (t.entryPrice * t.quantity) + (t.charges || 0) + (t.interest || 0), 0).toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="lg:col-span-2">
                        <div className="bg-card border rounded-2xl p-6 shadow-sm h-full">
                          <h3 className="text-sm font-bold uppercase tracking-wider mb-4 opacity-70">Transaction Ledger</h3>
                          <div className="pr-1">
                            <Ledger entries={ledger} onDelete={handleDeleteLedger} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </ShadcnTabsContent>
              </ShadcnTabs>
            </div>
          </div>
        </ShadcnTabsContent>
      </ShadcnTabs>

      {exitTradeData && (
        <Dialog open={!!exitTradeData} onOpenChange={() => setExitTradeData(null)}>
          <DialogContent className="max-w-md md:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Exit Trade: {exitTradeData.trade.stockName}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Exit Price</Label>
                  <Input 
                    type="number" 
                    step="0.01"
                    value={exitTradeData.price || ''} 
                    onChange={(e) => setExitTradeData({ ...exitTradeData, price: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Total Quantity to Exit</Label>
                  <Input 
                    type="number" 
                    step="any"
                    value={exitTradeData.quantity || ''} 
                    onChange={(e) => {
                      const newQty = e.target.value;
                      setExitTradeData({ ...exitTradeData, quantity: newQty });
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Max available: {trades.filter(t => t.stockSymbol === exitTradeData.trade.stockSymbol && t.status === 'Active').reduce((acc, curr) => acc + curr.quantity, 0).toFixed(6)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Exit Date</Label>
                  <Input 
                    type="date" 
                    value={exitTradeData.date || ''} 
                    onChange={(e) => setExitTradeData({ ...exitTradeData, date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Remarks (Optional)</Label>
                  <Input 
                    placeholder="Reason for exit..."
                    value={exitTradeData.remarks || ''} 
                    onChange={(e) => setExitTradeData({ ...exitTradeData, remarks: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-3 p-4 bg-muted/50 rounded-xl border border-muted">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-bold uppercase tracking-wider">Lot Selection Method</Label>
                  <div className="flex bg-background rounded-lg p-0.5 border shadow-sm">
                    <button 
                      onClick={() => setExitTradeData({ ...exitTradeData, method: 'FIFO' })}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${exitTradeData.method === 'FIFO' ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted'}`}
                    >
                      FIFO
                    </button>
                    <button 
                      onClick={() => {
                        // Pre-populate manual lots with FIFO logic as a starting point if no manual lots are set
                        const { plan } = getFIFOPlan(trades, exitTradeData.trade.stockSymbol, parseFloat(exitTradeData.quantity) || 0);
                        const initialLots: Record<string, number> = {};
                        plan.forEach(p => initialLots[p.trade.id!] = p.take);
                        
                        setExitTradeData({ ...exitTradeData, method: 'Manual', manualLots: initialLots });
                      }}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${exitTradeData.method === 'Manual' ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted'}`}
                    >
                      MANUAL
                    </button>
                  </div>
                </div>

                {exitTradeData.method === 'FIFO' ? (
                  <div className="text-[11px] space-y-1.5 font-mono">
                    {(() => {
                      const { plan, remainingToExit, totalAvailable } = getFIFOPlan(trades, exitTradeData.trade.stockSymbol, parseFloat(exitTradeData.quantity) || 0);
                      if (plan.length === 0) return <p className="text-red-500">No active entries found.</p>;
                      
                      return (
                        <>
                          {plan.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center opacity-80">
                              <span>• {new Date(item.trade.entryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} Lot:</span>
                              <span className="font-bold">{item.take.toFixed(2)} / {item.trade.quantity.toFixed(2)}</span>
                            </div>
                          ))}
                          {remainingToExit > 0.000001 ? (
                            <div className="mt-3 p-2 bg-red-500/10 text-red-600 rounded border border-red-500/20 font-bold text-center">
                              Insufficient quantity! Missing {remainingToExit.toFixed(2)} shares.
                            </div>
                          ) : (
                            <div className="mt-3 p-2 bg-green-500/10 text-green-600 rounded border border-green-500/20 font-bold text-center">
                              {totalAvailable - (parseFloat(exitTradeData.quantity) || 0) > 0.000001 
                                ? `${(totalAvailable - (parseFloat(exitTradeData.quantity) || 0)).toFixed(2)} shares will remain Active.`
                                : "All shares will be exited."}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {trades
                      .filter(t => t.stockSymbol === exitTradeData.trade.stockSymbol && t.status === 'Active')
                      .sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime())
                      .map((lot) => (
                        <div key={lot.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-2 bg-background rounded-lg border border-muted text-[11px] gap-2">
                          <div className="flex flex-col">
                            <span className="font-bold">{new Date(lot.entryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                            <span className="text-muted-foreground">Price: ₹{lot.entryPrice.toLocaleString()} | Avail: {lot.quantity.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input 
                              type="number"
                              step="any"
                              className="h-7 w-24 text-[11px] font-bold"
                              value={exitTradeData.manualLots[lot.id!] || ''}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const cappedVal = Math.min(val, lot.quantity);
                                const newLots = { ...exitTradeData.manualLots, [lot.id!]: cappedVal };
                                
                                // Also update total quantity if needed?
                                // Actually better to let user set total and then distribute, or vice versa.
                                // Let's keep total sync'd if user modifies lots.
                                const newTotal = Object.values(newLots).reduce((acc: number, q: number) => acc + q, 0);
                                setExitTradeData({ ...exitTradeData, manualLots: newLots, quantity: newTotal.toString() });
                              }}
                            />
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-7 px-2 text-[10px]"
                              onClick={() => {
                                const newLots = { ...exitTradeData.manualLots, [lot.id!]: lot.quantity };
                                const newTotal = Object.values(newLots).reduce((acc: number, q: number) => acc + q, 0);
                                setExitTradeData({ ...exitTradeData, manualLots: newLots, quantity: newTotal.toString() });
                              }}
                            >
                              MAX
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="pt-2">
                <Button 
                  onClick={handleExitTrade} 
                  className="w-full font-bold shadow-lg shadow-primary/20"
                  disabled={(() => {
                    const q = parseFloat(exitTradeData.quantity);
                    if (isNaN(q) || q <= 0) return true;
                    if (exitTradeData.method === 'FIFO') {
                      const { remainingToExit } = getFIFOPlan(trades, exitTradeData.trade.stockSymbol, q);
                      return remainingToExit > 0.000001;
                    } else {
                        const totalSelected = (Object.values(exitTradeData.manualLots) as number[]).reduce((acc: number, val: number) => acc + val, 0);
                      return Math.abs(totalSelected - q) > 0.000001 || totalSelected <= 0;
                    }
                  })()}
                >
                  <LogIn className="w-4 h-4 mr-2 rotate-180" />
                  Confirm Trade Exit
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {exitBondData && (
        <Dialog open={!!exitBondData} onOpenChange={() => setExitBondData(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Exit Bond: {exitBondData?.bond.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Exit Date</Label>
                <Input 
                  type="date" 
                  value={exitBondData?.exitDate || ''} 
                  onChange={(e) => setExitBondData(prev => prev ? { ...prev, exitDate: e.target.value } : null)}
                />
              </div>
              <div className="space-y-2">
                <Label>Redemption Amount (Principal + any final gain)</Label>
                <Input 
                  type="number" 
                  value={exitBondData?.redemptionAmount || ''} 
                  onChange={(e) => setExitBondData(prev => prev ? { ...prev, redemptionAmount: e.target.value } : null)}
                />
              </div>
              <div className="space-y-2">
                <Label>Remarks</Label>
                <Input 
                  placeholder="Reason for exit..." 
                  value={exitBondData?.remarks || ''} 
                  onChange={(e) => setExitBondData(prev => prev ? { ...prev, remarks: e.target.value } : null)}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setExitBondData(null)}>Cancel</Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={handleExitBond}>Confirm Exit</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {editTradeData && (
        <Dialog open={!!editTradeData} onOpenChange={() => setEditTradeData(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit {('stockName' in editTradeData) ? 'Trade' : 'Bond'}: {('stockName' in editTradeData) ? editTradeData.stockName : editTradeData.name}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <TradeForm 
                initialData={editTradeData} 
                onSubmit={handleUnifiedUpdate} 
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {addMoreTradeData && (
        <Dialog open={!!addMoreTradeData} onOpenChange={() => setAddMoreTradeData(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add More: {addMoreTradeData.stockName}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <TradeForm 
                initialData={addMoreTradeData as Trade} 
                onSubmit={(newTrade) => {
                  if ('stockSymbol' in newTrade) {
                    handleAddTrade(newTrade as Omit<Trade, 'id'>);
                  }
                  setAddMoreTradeData(null);
                }} 
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {pendingAction && (
        <Dialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertCircle className="w-5 h-5" />
                Confirm Corporate Action
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="p-4 bg-muted/50 rounded-lg border space-y-2">
                <div className="flex justify-between text-xs uppercase font-bold tracking-wider text-muted-foreground">
                  <span>Type</span>
                  <span>Asset</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span className="text-primary">{pendingAction.type}</span>
                  <span>{pendingAction.stockName}</span>
                </div>
                <div className="pt-2 border-t mt-2 text-[11px] text-muted-foreground leading-relaxed">
                  {pendingAction.description}
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Applying this action will automatically adjust your trade quantity and entry price. This action is permanent and should be verified against your broker statement.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setPendingAction(null)}>Cancel</Button>
              <Button className="flex-1" onClick={() => applyCorporateAction(pendingAction)}>Apply Action</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}


      {showScanDialog && (
        <Dialog open={showScanDialog} onOpenChange={() => setShowScanDialog(false)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Scan Trade Screenshot
              </DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-6">
              {isScanning ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
                  <div className="text-center">
                    <p className="font-medium">Analyzing your screenshot...</p>
                    <p className="text-sm text-muted-foreground">Gemini is extracting trade details for you.</p>
                  </div>
                </div>
              ) : scannedTrades.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Detected Trades ({scannedTrades.length})</h3>
                    <p className="text-xs text-muted-foreground italic">Please review before importing</p>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Asset</th>
                          <th className="px-3 py-2 text-left font-medium">Type</th>
                          <th className="px-3 py-2 text-right font-medium">Qty</th>
                          <th className="px-3 py-2 text-right font-medium">Price</th>
                          <th className="px-3 py-2 text-center font-medium">Date</th>
                          <th className="px-3 py-2 text-center font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {scannedTrades.map((t, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium">{t.stockName}</td>
                            <td className="px-3 py-2 text-xs">{t.type}</td>
                            <td className="px-3 py-2 text-right">{t.quantity}</td>
                            <td className="px-3 py-2 text-right">₹{t.entryPrice.toLocaleString()}</td>
                            <td className="px-3 py-2 text-center text-xs">{t.entryDate}</td>
                            <td className="px-3 py-2 text-center">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-destructive"
                                onClick={() => setScannedTrades(prev => prev.filter((_, i) => i !== idx))}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <Button variant="outline" className="flex-1" onClick={() => setShowScanDialog(false)}>Cancel</Button>
                    <Button className="flex-1 gap-2" onClick={handleImportScannedTrades}>
                      <Check className="w-4 h-4" />
                      Import All Trades
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
                  <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center">
                    <AlertCircle className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="font-medium">No trades detected</p>
                    <p className="text-sm text-muted-foreground max-w-xs">
                      We couldn't find any trade data in that image. Please try another screenshot or import via CSV.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => setShowScanDialog(false)}>Close</Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {deleteConfirm && (
        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-5 h-5" />
                Confirm Deletion
              </DialogTitle>
            </DialogHeader>
            <div className="py-6 space-y-4 text-center sm:text-left">
              <p className="text-sm text-foreground">
                Are you sure you want to delete <span className="font-bold">{deleteConfirm.item.displayName || deleteConfirm.item.stockName || deleteConfirm.item.name || 'this entry'}</span>?
              </p>
              <p className="text-xs text-muted-foreground">
                This will permanently remove the record from your portfolio.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={isDeleting}>
                  Cancel
                </Button>
                <Button 
                  variant="destructive" 
                  className="flex-1 font-bold shadow-lg shadow-destructive/20" 
                  onClick={confirmDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Yes, Delete Item
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Corporate Actions Dialog */}
      <Dialog open={showActionsDialog} onOpenChange={setShowActionsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Corporate Actions Log
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {corporateActions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="w-12 h-12 mx-auto mb-2 opacity-20" />
                <p>No corporate actions detected yet.</p>
                <Button variant="outline" size="sm" onClick={checkCorporateActions} className="mt-4">
                  Check for Actions Now
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {corporateActions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((action) => (
                  <div key={action.id} className={`p-4 rounded-xl border flex items-start justify-between gap-4 ${action.status === 'Applied' ? 'bg-muted/30 opacity-70' : 'bg-card shadow-sm border-primary/20'}`}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          action.type === 'Dividend' ? 'bg-green-100 text-green-700' : 
                          action.type === 'Split' ? 'bg-blue-100 text-blue-700' : 
                          action.type === 'Bonus' ? 'bg-purple-100 text-purple-700' : 
                          'bg-orange-100 text-orange-700'
                        }`}>
                          {action.type}
                        </span>
                        <span className="text-xs text-muted-foreground font-medium">{action.date}</span>
                      </div>
                      <h4 className="font-bold text-sm">{action.stockName} ({action.stockSymbol})</h4>
                      <p className="text-xs text-muted-foreground">{action.description}</p>
                    </div>
                    {action.status === 'Detected' ? (
                      <Button size="sm" onClick={() => applyCorporateAction(action)} className="h-8 text-[10px] font-bold uppercase">
                        Apply Action
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1 text-green-600 text-[10px] font-bold uppercase">
                        <Check className="w-3 h-3" />
                        Applied
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function useOnlineStatus() {
  const [isOnline, setIsOnline] = React.useState(navigator.onLine);
  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  return isOnline;
}



