import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SECTORS, MARKET_CAPS, BROKERS, ASSET_TYPES, formatSector, ASSET_TYPE_OVERRIDES } from '@/src/constants';
import { Search, Loader2, Landmark, Plus, Trash2, CheckCircle2, Circle, Calendar, ArrowRightLeft, RefreshCw, X } from 'lucide-react';
import { Trade, BondPayout, Bond, SIP, Broker, MarketCap, AssetType, PayoutFrequency } from '@/src/types';
import { generatePayoutSchedule as utilGenerateSchedule, calculateAccruedInterest as utilCalculateAccrued } from '@/src/lib/bondUtils';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { toast } from 'sonner';
import Fuse from 'fuse.js';
import { addMonths, format, parseISO, isAfter, isBefore, startOfDay } from 'date-fns';

interface TradeFormProps {
  onSubmit: (data: Omit<Trade, 'id'> | Omit<Bond, 'id'> | Partial<SIP>) => void;
  initialData?: Trade | Bond | SIP;
}

interface NSESymbol {
  symbol: string;
  name: string;
  type?: AssetType;
}

const isAssetETF = (symbol: string, name: string): boolean => {
  const cleanSymbol = (symbol || '').split('.')[0].toUpperCase();
  const nameUpper = (name || '').toUpperCase();

  const isExplicitETF = 
    ASSET_TYPE_OVERRIDES[cleanSymbol] === 'ETF' ||
    cleanSymbol.endsWith('BEES') ||
    cleanSymbol.endsWith('ETF') ||
    cleanSymbol.includes('ETF') ||
    cleanSymbol.includes('BEES') ||
    nameUpper.includes('EXCHANGE TRADED FUND') ||
    nameUpper.includes('VALUE 20') ||
    nameUpper.includes('VALUE 50') ||
    [
      'AXISVALUE', 'AXISVAL', 'NV20', 'NETFVAL20', 'KOTAKNV20', 
      'NETFLV30', 'NETFALFA', 'NETF50', 'NETITF', 'GOLDBEES', 
      'NIFTYBEES', 'BANKBEES', 'JUNIORBEES', 'CPSEETF', 'MON100', 
      'MAFANG', 'ITBEES', 'LIQUIDCASE'
    ].includes(cleanSymbol);

  const containsMutualFundKeywords = 
    nameUpper.includes('FUND OF FUND') || 
    nameUpper.includes('FOF') || 
    nameUpper.includes('FD OF FD') || 
    nameUpper.includes('F0F') ||
    nameUpper.includes('MUTUAL FUND') ||
    nameUpper.includes('DIRECT') ||
    nameUpper.includes('GROWTH') ||
    nameUpper.includes('REGULAR');

  if (isExplicitETF) {
    return true;
  }

  if (containsMutualFundKeywords) {
    return false;
  }

  return (
    nameUpper.includes('ETF') ||
    nameUpper.includes('BEES')
  );
};

export function TradeForm({ onSubmit, initialData }: TradeFormProps) {
  const [symbols, setSymbols] = useState<NSESymbol[]>([]);
  const [search, setSearch] = useState((initialData as Trade)?.stockName || (initialData as Bond)?.name || '');
  const [apiResults, setApiResults] = useState<NSESymbol[]>([]);
  const [loadingSymbols, setLoadingSymbols] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isValidSymbol, setIsValidSymbol] = useState(!!initialData);
  const [liveInfo, setLiveInfo] = useState<{ price?: number; sector?: string; marketCap?: string; marketCapValue?: number }>({});
  const [dynamicSectors, setDynamicSectors] = useState<string[]>(() => {
    const initialSector = (initialData as Trade)?.sector;
    if (initialSector && !SECTORS.includes(initialSector)) {
      return [...SECTORS, initialSector];
    }
    return [...SECTORS];
  });

  const [formData, setFormData] = useState({
    stockName: (initialData as Trade)?.stockName || (initialData as Bond)?.name || '',
    stockSymbol: (initialData as Trade)?.stockSymbol || '',
    type: (initialData as Trade)?.type || 'Stock',
    entryDate: (initialData as Trade)?.entryDate || (initialData as Bond)?.purchaseDate || new Date().toISOString().split('T')[0],
    entryPrice: (initialData as Trade)?.entryPrice !== undefined ? (initialData as Trade).entryPrice.toString() : '',
    quantity: (initialData as Trade)?.quantity !== undefined ? (initialData as Trade).quantity.toString() : '',
    totalInvestment: ((initialData as Trade)?.entryPrice !== undefined && (initialData as Trade)?.quantity !== undefined) 
      ? ((initialData as Trade).entryPrice * (initialData as Trade).quantity).toString() 
      : (initialData as Bond)?.principal?.toString() || '',
    nav: (initialData as Trade)?.entryPrice !== undefined ? (initialData as Trade).entryPrice.toString() : '',
    charges: (initialData as Trade)?.charges !== undefined ? (initialData as Trade).charges.toString() : '0',
    interest: (initialData as Trade)?.interest !== undefined ? (initialData as Trade).interest.toString() : '0',
    sector: (initialData as Trade)?.type === 'Mutual Fund' ? 'Mutual Fund' : (initialData as Trade)?.type === 'ETF' ? 'ETF' : (initialData as Trade)?.sector || SECTORS[0],
    marketCap: ((initialData as Trade)?.type === 'Mutual Fund' || (initialData as Trade)?.type === 'ETF') ? ('N/A' as MarketCap) : (((initialData as Trade)?.marketCap as MarketCap) || (MARKET_CAPS[0] as MarketCap)),
    broker: ((initialData as Trade)?.broker as Broker) || (BROKERS[0] as Broker),
    remarks: (initialData as Trade)?.remarks || '',
    // SIP specific fields
    isSIP: false,
    sipInstallment: '',
    sipStartDate: new Date().toISOString().split('T')[0],
    sipDayOfMonth: '8', // default to 8th
    sipFrequency: 'Monthly',
    sipInitialInvestment: '',
    sipStepUpType: (initialData as SIP)?.stepUpType || 'None',
    sipStepUpValue: (initialData as SIP)?.stepUpValue?.toString() || '',
    // Bond specific fields
    bondName: (initialData as Bond)?.name || '',
    couponRate: (initialData as Bond)?.interestRate?.toString() || '',
    frequency: (initialData as Bond)?.frequency || 'Annually',
    maturityDate: (initialData as Bond)?.maturityDate || '',
    bondStatus: (initialData as Bond)?.status || 'Active',
    exitDate: (initialData as Bond)?.exitDate || '',
    redemptionAmount: (initialData as Bond)?.redemptionAmount?.toString() || '',
    accruedInterest: (initialData as Bond)?.accruedInterest?.toString() || '0',
    lastPayoutDate: (initialData as Bond)?.lastPayoutDate || '',
  });

  const [payoutSchedule, setPayoutSchedule] = useState<BondPayout[]>((initialData as Bond)?.payoutSchedule || []);
  const [isScheduleManuallyEdited, setIsScheduleManuallyEdited] = useState(false);
  const [showExitFields, setShowExitFields] = useState(false);

  // Auto-generate schedule when threshold criteria are met
  useEffect(() => {
    if (formData.type === 'Bond' && 
        payoutSchedule.length === 0 && 
        !isScheduleManuallyEdited &&
        formData.totalInvestment && 
        formData.couponRate && 
        formData.maturityDate &&
        formData.entryDate
    ) {
      // Quiet auto-generation for new bonds
      const principal = parseFloat(formData.totalInvestment);
      const rate = parseFloat(formData.couponRate);
      const purchaseDate = parseISO(formData.entryDate);
      const maturityDate = parseISO(formData.maturityDate);
      
      if (!isNaN(principal) && !isNaN(rate) && isAfter(maturityDate, purchaseDate)) {
        const schedule: BondPayout[] = [];
        let currentDate = startOfDay(purchaseDate);
        const endLimit = startOfDay(maturityDate);
        const monthsToAdd = 
          formData.frequency === 'Monthly' ? 1 :
          formData.frequency === 'Quarterly' ? 3 :
          formData.frequency === 'Semi-Annually' ? 6 : 12;
        const interestPerPayout = (principal * (rate / 100)) / (12 / monthsToAdd);

        while (true) {
          currentDate = addMonths(currentDate, monthsToAdd);
          if (isAfter(currentDate, endLimit)) break;
          schedule.push({
            id: uuidv4(),
            date: format(currentDate, 'yyyy-MM-dd'),
            amount: parseFloat(interestPerPayout.toFixed(2)),
            status: 'Pending'
          });
          if (schedule.length > 240) break;
        }
        setPayoutSchedule(schedule);
      }
    }
  }, [formData.totalInvestment, formData.couponRate, formData.maturityDate, formData.entryDate, formData.type, formData.frequency, payoutSchedule.length, isScheduleManuallyEdited]);

  useEffect(() => {
    if (initialData) {
      const isBond = 'interestRate' in initialData || (initialData as any).type === 'Bond';
      const isSIPData = (initialData as any).installmentAmount !== undefined;
      
      setFormData({
        stockName: (initialData as Trade).stockName || (initialData as Bond).name || (initialData as SIP).stockName || '',
        stockSymbol: (initialData as Trade).stockSymbol || (initialData as SIP).stockSymbol || '',
        type: isBond ? 'Bond' : ((initialData as any).type || 'Stock'),
        entryDate: (initialData as Trade).entryDate || (initialData as Bond).purchaseDate || (initialData as SIP).startDate || new Date().toISOString().split('T')[0],
        entryPrice: (initialData as Trade).entryPrice !== undefined ? (initialData as Trade).entryPrice.toString() : '',
        quantity: (initialData as Trade).quantity !== undefined ? (initialData as Trade).quantity.toString() : '',
        totalInvestment: ((initialData as Trade).entryPrice !== undefined && (initialData as Trade).quantity !== undefined) 
          ? ((initialData as Trade).entryPrice * (initialData as Trade).quantity).toString() 
          : (initialData as Bond).principal?.toString() || '',
        nav: (initialData as Trade).entryPrice !== undefined ? (initialData as Trade).entryPrice.toString() : '',
        charges: (initialData as Trade).charges !== undefined ? (initialData as Trade).charges.toString() : '0',
        interest: (initialData as Trade).interest !== undefined ? (initialData as Trade).interest.toString() : '0',
        sector: (initialData as any).sector || SECTORS[0],
        marketCap: ((initialData as any).marketCap as MarketCap) || (MARKET_CAPS[0] as MarketCap),
        broker: ((initialData as any).broker as Broker) || (BROKERS[0] as Broker),
        remarks: (initialData as any).remarks || '',
        bondName: (initialData as Bond).name || '',
        couponRate: (initialData as Bond).interestRate?.toString() || '',
        frequency: (initialData as Bond).frequency || 'Annually',
        maturityDate: (initialData as Bond).maturityDate || '',
        bondStatus: (initialData as Bond).status || 'Active',
        exitDate: (initialData as Bond).exitDate || '',
        redemptionAmount: (initialData as Bond).redemptionAmount?.toString() || '',
        accruedInterest: (initialData as Bond).accruedInterest?.toString() || '0',
        lastPayoutDate: (initialData as Bond).lastPayoutDate || '',
        isSIP: isSIPData,
        sipInstallment: (initialData as any).installmentAmount?.toString() || '',
        sipInitialInvestment: (initialData as any).initialInvestment?.toString() || '',
        sipStartDate: (initialData as any).startDate || new Date().toISOString().split('T')[0],
        sipDayOfMonth: (initialData as any).dayOfMonth?.toString() || '8',
        sipFrequency: (initialData as any).frequency || 'Monthly',
        sipStepUpType: (initialData as any).stepUpType || 'None',
        sipStepUpValue: (initialData as any).stepUpValue?.toString() || '',
      });
      setPayoutSchedule((initialData as Bond).payoutSchedule || []);
      setSearch((initialData as Trade).stockName || (initialData as Bond).name || (initialData as SIP).stockName || '');
    }
  }, [initialData]);

  useEffect(() => {
    if (initialData && (initialData as Trade).stockSymbol) {
      const fetchLivePrice = async () => {
        try {
          const res = await axios.get(`/api/price/${(initialData as Trade).stockSymbol}?type=${(initialData as Trade).type}`, { timeout: 15000 });
          if (res.data.price) {
            const liveSector = (initialData as Trade).type === 'ETF' ? 'ETF' : res.data.sector;
            setLiveInfo({
              price: res.data.price,
              sector: liveSector,
              marketCap: res.data.marketCap,
              marketCapValue: res.data.marketCapValue
            });
            if (liveSector && !dynamicSectors.includes(liveSector)) {
              setDynamicSectors(prev => prev.includes(liveSector) ? prev : [...prev, liveSector]);
            }
            // Auto-fill price if it's empty (Add More scenario)
            setFormData(prev => {
              if (!prev.entryPrice || prev.entryPrice === '0') {
                return { ...prev, entryPrice: res.data.price.toString(), nav: res.data.price.toString() };
              }
              return prev;
            });
          }
        } catch (err: any) {
          console.error('Failed to fetch initial live price', err.message || err);
          if (err.message === 'Network Error') {
            toast.error("Network Error: Could not fetch initial price", {
              description: "Check your connection if prices don't load."
            });
          }
        }
      };
      fetchLivePrice();
    }
  }, [initialData]);

  useEffect(() => {
    const fetchSymbols = async () => {
      setLoadingSymbols(true);
      try {
        const res = await axios.get('/api/symbols', { timeout: 15000 });
        setSymbols(res.data);
      } catch (err: any) {
        console.error('Failed to fetch symbols', err.message || err);
      } finally {
        setLoadingSymbols(false);
      }
    };
    fetchSymbols();
  }, []);

  useEffect(() => {
    if (!search || search.length < 2) {
      setApiResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSymbols(true);
      try {
        const res = await axios.get(`/api/search?q=${search}`, { timeout: 15000 });
        setApiResults(res.data);
      } catch (err: any) {
        console.error('Search failed', err.message || err);
        if (err.message === 'Network Error') {
          toast.error("Search failed due to a network error.");
        }
      } finally {
        setLoadingSymbols(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [search]);

  // Programmatic Selection Event: Auto-link text input to master list
  useEffect(() => {
    if (!search || search.length < 3 || isValidSymbol || initialData) return;

    const timer = setTimeout(() => {
      const typeFilteredSymbols = symbols.filter(s => {
        if (s.type === 'Mutual Fund') return formData.type === 'Mutual Fund';
        if (s.type === 'Bond') return formData.type === 'Bond';
        if (formData.type === 'Stock') return s.type === 'Stock' || s.type === 'ETF' || isAssetETF(s.symbol, s.name);
        if (formData.type === 'ETF') return s.type === 'ETF' || isAssetETF(s.symbol, s.name);
        if (formData.type === 'Mutual Fund') return s.type === 'Mutual Fund';
        return true;
      });

      const fuse = new Fuse<NSESymbol>(typeFilteredSymbols, {
        keys: ['symbol', 'name'],
        threshold: 0.15, // High confidence threshold for auto-select
        ignoreLocation: true
      });

      const results = fuse.search(search);
      if (results.length > 0) {
        const bestMatch = results[0].item;
        // Only auto-select if it's a very clear match or exact match
        if (
          bestMatch.symbol.toLowerCase() === search.toLowerCase() || 
          bestMatch.name.toLowerCase() === search.toLowerCase() ||
          results[0].score! < 0.05
        ) {
          handleSelectSymbol(bestMatch);
          toast.info(`Auto-linked to ${bestMatch.name}`, { duration: 2000 });
        }
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [search, symbols, formData.type, isValidSymbol, initialData]);

  const combinedResults = useMemo(() => {
    // 1. Filter local symbols by type first
    const typeFilteredSymbols = symbols.filter(s => {
      if (s.type === 'Mutual Fund') return formData.type === 'Mutual Fund';
      if (s.type === 'Bond') return formData.type === 'Bond';
      if (formData.type === 'Stock') return s.type === 'Stock' || s.type === 'ETF' || isAssetETF(s.symbol, s.name);
      if (formData.type === 'ETF') return s.type === 'ETF' || isAssetETF(s.symbol, s.name);
      if (formData.type === 'Mutual Fund') return s.type === 'Mutual Fund';
      return true;
    });

    let local: NSESymbol[] = [];
    
    if (!search || search.trim().length === 0) {
      local = typeFilteredSymbols;
    } else {
      const fuse = new Fuse<NSESymbol>(typeFilteredSymbols, {
        keys: ['symbol', 'name'],
        threshold: 0.3,
        ignoreLocation: true
      });
      local = fuse.search(search).map(r => r.item);
    }
    
    // Merge with API results, avoiding duplicates by symbol
    const seen = new Set(local.map(s => s.symbol));
    const merged: NSESymbol[] = [...local];
    
    apiResults.forEach(s => {
      if (!seen.has(s.symbol)) {
        const isMatch = (() => {
          if (s.type === 'Mutual Fund') return formData.type === 'Mutual Fund';
          if (s.type === 'Bond') return formData.type === 'Bond';
          if (formData.type === 'Stock') return s.type === 'Stock' || s.type === 'ETF' || isAssetETF(s.symbol, s.name);
          if (formData.type === 'ETF') return s.type === 'ETF' || isAssetETF(s.symbol, s.name);
          if (formData.type === 'Mutual Fund') return s.type === 'Mutual Fund';
          return true;
        })();
        
        if (isMatch) {
          merged.push(s);
          seen.add(s.symbol);
        }
      }
    });

    // If we have a search term, we can also fuzzy-sort the merged results 
    // to ensure the most relevant items are at the top (especially from API)
    if (search && search.trim().length > 0) {
      const fuseMerged = new Fuse<NSESymbol>(merged, {
        keys: ['symbol', 'name'],
        threshold: 0.4
      });
      return fuseMerged.search(search).map(r => r.item).slice(0, 50);
    }
    
    return merged.slice(0, 50);
  }, [symbols, apiResults, search, formData.type]);

  const projectedWealth = useMemo(() => {
    if (!formData.isSIP || !formData.sipInstallment) return null;
    const monthlyAmount = parseFloat(formData.sipInstallment) || 0;
    const stepUpType = formData.sipStepUpType;
    const stepUpValue = parseFloat(formData.sipStepUpValue) || 0;
    const years = 5;
    const annualReturn = 0.12; // 12% expected return
    const monthlyReturn = annualReturn / 12;

    let totalWealthStepUp = 0;
    let totalInvestedStepUp = 0;
    let currentMonthly = monthlyAmount;

    for (let month = 1; month <= years * 12; month++) {
      if (month > 1 && (month - 1) % 12 === 0) {
        if (stepUpType === 'Percentage') {
          currentMonthly *= (1 + stepUpValue / 100);
        } else if (stepUpType === 'Fixed') {
          currentMonthly += stepUpValue;
        }
      }
      totalInvestedStepUp += currentMonthly;
      totalWealthStepUp = (totalWealthStepUp + currentMonthly) * (1 + monthlyReturn);
    }

    // Baseline (No Step-up)
    let totalWealthBase = 0;
    let totalInvestedBase = monthlyAmount * years * 12;
    for (let month = 1; month <= years * 12; month++) {
      totalWealthBase = (totalWealthBase + monthlyAmount) * (1 + monthlyReturn);
    }

    return {
      years,
      stepUp: { wealth: totalWealthStepUp, invested: totalInvestedStepUp },
      base: { wealth: totalWealthBase, invested: totalInvestedBase },
      diff: totalWealthStepUp - totalWealthBase
    };
  }, [formData.isSIP, formData.sipInstallment, formData.sipStepUpType, formData.sipStepUpValue]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => {
      const newData = { ...prev, [field]: value };
      if (field === 'type') {
        if (value === 'ETF') {
          newData.sector = 'ETF';
          newData.marketCap = 'N/A' as MarketCap;
        } else if (value === 'Mutual Fund') {
          newData.sector = 'Mutual Fund';
          newData.marketCap = 'N/A' as MarketCap;
        }
      }
      return newData;
    });
    if (field === 'type') {
      setSearch('');
      setIsValidSymbol(false);
      setApiResults([]);
      setLiveInfo({});
    }
  };

  const handleSelectSymbol = async (s: NSESymbol) => {
    let assetType = s.type || formData.type;
    
    // Apply asset type overrides
    const cleanSymbol = s.symbol.split('.')[0].toUpperCase();
    if (ASSET_TYPE_OVERRIDES[cleanSymbol]) {
      assetType = ASSET_TYPE_OVERRIDES[cleanSymbol] as any;
    }

    setFormData(prev => ({ ...prev, stockName: s.name, stockSymbol: s.symbol, type: assetType }));
    setSearch(s.name);
    setShowDropdown(false);
    setIsValidSymbol(true);
    
    // Fetch current price, sector, and market cap to help user
    try {
      const res = await axios.get(`/api/price/${s.symbol}?type=${assetType}`, { timeout: 15000 });
      if (res.data.price) {
        let liveSector = assetType === 'ETF' ? 'ETF' : (assetType === 'Mutual Fund' ? 'Mutual Fund' : res.data.sector);
        let liveMarketCap = (assetType === 'ETF' || assetType === 'Mutual Fund') ? 'N/A' : res.data.marketCap;
        
        // Apply Normalization and Overrides
        if (assetType === 'Stock') {
          liveSector = formatSector(s.symbol, liveSector);
        }

        setLiveInfo({
          price: res.data.price,
          sector: assetType === 'Stock' ? liveSector : undefined,
          marketCap: assetType === 'Stock' ? liveMarketCap : undefined,
          marketCapValue: assetType === 'Stock' ? res.data.marketCapValue : undefined
        });

        if (assetType === 'Stock' && liveSector && !dynamicSectors.includes(liveSector)) {
          setDynamicSectors(prev => [...prev, liveSector]);
        }

        setFormData(prev => ({ 
          ...prev, 
          stockName: res.data.longName || prev.stockName, // Use more proper name if available
          entryPrice: res.data.price.toString(),
          sector: (assetType === 'Mutual Fund' ? 'Mutual Fund' : (assetType === 'ETF' ? 'ETF' : (liveSector || prev.sector))),
          marketCap: (assetType === 'Mutual Fund' || assetType === 'ETF' ? ('N/A' as MarketCap) : ((liveMarketCap as MarketCap) || prev.marketCap))
        }));
        if (res.data.longName) {
          setSearch(res.data.longName);
        }
      }
    } catch (err) {
      console.error('Failed to fetch price, sector, and market cap', err);
    }
  };

  const generatePayoutSchedule = () => {
    const principal = parseFloat(formData.totalInvestment);
    const rate = parseFloat(formData.couponRate);
    const purchaseDate = formData.entryDate;
    const maturityDate = formData.maturityDate;
    
    if (isNaN(principal) || isNaN(rate) || !maturityDate) {
      toast.error("Please provide Investment Amount, Coupon Rate, and Maturity Date to auto-generate.");
      return;
    }

    // Auto-fill redemption amount if empty
    if (!formData.redemptionAmount) {
      handleChange('redemptionAmount', principal.toString());
    }

    const schedule = utilGenerateSchedule(
      principal,
      rate,
      formData.frequency as PayoutFrequency,
      purchaseDate,
      maturityDate
    );

    if (schedule.length === 0 && purchaseDate && maturityDate) {
      toast.error("Maturity date must be after purchase date.");
      return;
    }

    setPayoutSchedule(schedule);
    setIsScheduleManuallyEdited(false);
    toast.success(`Generated ${schedule.length} payout entries.`);
  };

  const addPayoutRow = () => {
    setPayoutSchedule([...payoutSchedule, {
      id: uuidv4(),
      date: new Date().toISOString().split('T')[0],
      amount: '' as any,
      status: 'Pending'
    }]);
    setIsScheduleManuallyEdited(true);
  };

  const calculateAccruedInterest = () => {
    const principal = parseFloat(formData.totalInvestment);
    const rate = parseFloat(formData.couponRate);

    if (isNaN(principal) || isNaN(rate)) {
      toast.error("Please provide Investment Amount and Coupon Rate.");
      return;
    }

    const bondForCalc: Bond = {
      principal,
      interestRate: rate,
      frequency: formData.frequency as PayoutFrequency,
      purchaseDate: formData.entryDate,
      lastPayoutDate: formData.lastPayoutDate || undefined,
      name: formData.bondName || formData.stockName,
      status: 'Active'
    };

    const accrued = utilCalculateAccrued(bondForCalc);
    handleChange('accruedInterest', accrued.toFixed(2));
    toast.success(`Accrued interest calculated: ₹${accrued.toFixed(2)}`);
  };

  useEffect(() => {
    if (formData.type === 'Bond' && formData.totalInvestment && formData.couponRate && formData.entryDate) {
      const principal = parseFloat(formData.totalInvestment);
      const rate = parseFloat(formData.couponRate);
      if (!isNaN(principal) && !isNaN(rate)) {
        const bondForCalc: Bond = {
          principal,
          interestRate: rate,
          frequency: formData.frequency as PayoutFrequency,
          purchaseDate: formData.entryDate,
          lastPayoutDate: formData.lastPayoutDate || undefined,
          name: formData.bondName || formData.stockName,
          status: 'Active'
        };
        const accrued = utilCalculateAccrued(bondForCalc);
        const accruedStr = accrued.toFixed(2);
        if (accruedStr !== formData.accruedInterest) {
          setFormData(prev => ({ ...prev, accruedInterest: accruedStr }));
        }
      }
    }
  }, [formData.totalInvestment, formData.couponRate, formData.entryDate, formData.lastPayoutDate, formData.type, formData.frequency]);

  const handlePayoutChange = (index: number, field: keyof BondPayout, value: any) => {
    const updated = [...payoutSchedule];
    updated[index] = { ...updated[index], [field]: value };
    setPayoutSchedule(updated);
    setIsScheduleManuallyEdited(true);
  };

  const removePayoutRow = (id: string) => {
    setPayoutSchedule(payoutSchedule.filter(p => p.id !== id));
    setIsScheduleManuallyEdited(true);
  };

  const clearSchedule = () => {
    if (confirm("Are you sure you want to clear the entire payout schedule?")) {
      setPayoutSchedule([]);
      setIsScheduleManuallyEdited(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.type !== 'Bond' && !isValidSymbol) {
      toast.error('Please select a valid stock/mutual fund from the search results.');
      return;
    }

      if (formData.type === 'Mutual Fund' && formData.isSIP) {
        const sipData: any = {
          stockName: formData.stockName,
          stockSymbol: formData.stockSymbol,
          installmentAmount: parseFloat(formData.sipInstallment),
          startDate: formData.sipStartDate,
          dayOfMonth: parseInt(formData.sipDayOfMonth),
          frequency: formData.sipFrequency,
          status: 'Active',
          type: 'Mutual Fund',
          broker: formData.broker as Broker,
          sector: formData.sector,
          marketCap: formData.marketCap,
          initialInvestment: parseFloat(formData.sipInitialInvestment) || 0,
          stepUpType: formData.sipStepUpType,
          stepUpValue: parseFloat(formData.sipStepUpValue) || 0,
        };
        onSubmit(sipData as any); // The parent should handle SIP detection
      } else if (formData.type === 'Bond') {
      const principal = parseFloat(formData.totalInvestment);
      const interestRate = parseFloat(formData.couponRate);
      if (isNaN(principal) || isNaN(interestRate)) return;

      // Ensure all payout amounts are numbers
      const sanitizedPayouts = payoutSchedule.map(p => ({
        ...p,
        amount: typeof p.amount === 'string' ? parseFloat(p.amount) || 0 : p.amount
      }));

      const bond: any = {
        name: formData.bondName || formData.stockName,
        principal,
        interestRate,
        frequency: formData.frequency as PayoutFrequency,
        purchaseDate: formData.entryDate,
        payoutSchedule: sanitizedPayouts,
        accruedInterest: parseFloat(formData.accruedInterest) || 0,
        lastPayoutDate: formData.lastPayoutDate,
        status: (formData.bondStatus as 'Active' | 'Exited') || 'Active',
      };
      
      if (formData.maturityDate) bond.maturityDate = formData.maturityDate;
      if (formData.exitDate) bond.exitDate = formData.exitDate;
      if (formData.redemptionAmount) {
        const parsedRedemption = parseFloat(formData.redemptionAmount);
        if (!isNaN(parsedRedemption)) bond.redemptionAmount = parsedRedemption;
      }
      
      onSubmit(bond);
    } else {
      let entryPrice: number;
      let quantity: number;

      if (formData.type === 'Mutual Fund') {
        const totalInv = parseFloat(formData.totalInvestment);
        const nav = parseFloat(formData.nav || formData.entryPrice);
        const qty = parseFloat(formData.quantity);

        if (!isNaN(totalInv) && totalInv > 0) {
          if (!isNaN(nav) && nav > 0) {
            entryPrice = nav;
            quantity = !isNaN(qty) && qty > 0 ? qty : totalInv / nav;
          } else if (!isNaN(qty) && qty > 0) {
            quantity = qty;
            entryPrice = totalInv / qty;
          } else {
            // Neither NAV nor quantity provided
            if (liveInfo.price && liveInfo.price > 0) {
              entryPrice = liveInfo.price;
              quantity = totalInv / liveInfo.price;
            } else {
              entryPrice = 1;
              quantity = totalInv;
            }
          }
        } else if (!isNaN(nav) && nav > 0 && !isNaN(qty) && qty > 0) {
          entryPrice = nav;
          quantity = qty;
        } else {
          toast.error('Please enter Total Investment or NAV & Quantity for the Mutual Fund.');
          return;
        }
      } else {
        entryPrice = parseFloat(formData.entryPrice);
        quantity = parseFloat(formData.quantity);
      }
      
      if (isNaN(entryPrice) || isNaN(quantity)) return;

      const trade: Omit<Trade, 'id'> = {
        stockName: formData.stockName,
        stockSymbol: formData.stockSymbol,
        type: formData.type as AssetType,
        entryDate: formData.entryDate,
        entryPrice,
        quantity,
        charges: parseFloat(formData.charges) || 0,
        interest: parseFloat(formData.interest) || 0,
        status: 'Active',
        sector: formData.type === 'Mutual Fund' ? 'Mutual Fund' : (formData.type === 'ETF' ? 'ETF' : formData.sector),
        marketCap: formData.type === 'Mutual Fund' ? 'N/A' : (formData.marketCap as MarketCap),
        ...(liveInfo.marketCapValue !== undefined && { marketCapValue: liveInfo.marketCapValue }),
        broker: formData.broker as Broker,
        targetPrice: entryPrice * 1.09, // 9% target
        remarks: formData.remarks,
      };

      onSubmit(trade);
    }

      setFormData({
        stockName: '',
        stockSymbol: '',
        type: 'Stock',
        entryDate: new Date().toISOString().split('T')[0],
        entryPrice: '',
        quantity: '',
        totalInvestment: '',
        nav: '',
        charges: '0',
        interest: '0',
        sector: SECTORS[0],
        marketCap: MARKET_CAPS[0] as MarketCap,
        broker: BROKERS[0] as Broker,
        remarks: '',
        bondName: '',
        couponRate: '',
        frequency: 'Annually',
        maturityDate: '',
        bondStatus: 'Active',
        exitDate: '',
        redemptionAmount: '',
        accruedInterest: '0',
        lastPayoutDate: '',
        isSIP: false,
        sipInstallment: '',
        sipInitialInvestment: '',
        sipStartDate: new Date().toISOString().split('T')[0],
        sipDayOfMonth: '8',
        sipFrequency: 'Monthly',
      });
      setPayoutSchedule([]);
      setShowExitFields(false);
    setSearch('');
    setLiveInfo({});
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-3 sm:p-4 border rounded-lg bg-card relative">
      <div className="flex flex-wrap gap-2 mb-4 bg-muted p-1 rounded-md">
        {['Stock', 'Mutual Fund', 'ETF', 'Bond'].map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handleChange('type', type)}
            className={`flex-1 py-1.5 px-3 text-xs sm:text-sm font-medium rounded-sm transition-all ${
              formData.type === type 
                ? 'bg-background text-foreground shadow-sm' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {formData.type === 'Bond' ? (
          <>
            <div className="space-y-2 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="bondName" className="text-xs sm:text-sm">Bond Name</Label>
              <Input
                id="bondName"
                placeholder="e.g. Govt Bond 2030"
                value={formData.bondName || ''}
                onChange={(e) => handleChange('bondName', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="principal" className="text-xs sm:text-sm">Investment Amount (₹)</Label>
              <Input
                id="principal"
                type="number"
                placeholder="e.g. 100000"
                value={formData.totalInvestment}
                onChange={(e) => handleChange('totalInvestment', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="couponRate" className="text-xs sm:text-sm">Coupon Rate (%)</Label>
              <Input
                id="couponRate"
                type="number"
                step="0.01"
                placeholder="e.g. 7.5"
                value={formData.couponRate}
                onChange={(e) => handleChange('couponRate', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs sm:text-sm">Payout Frequency</Label>
              <Select 
                value={formData.frequency} 
                onValueChange={(v: PayoutFrequency) => handleChange('frequency', v)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  {['Monthly', 'Quarterly', 'Semi-Annually', 'Annually'].map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="purchaseDate" className="text-xs sm:text-sm">Purchase Date</Label>
              <Input
                id="purchaseDate"
                type="date"
                value={formData.entryDate}
                onChange={(e) => handleChange('entryDate', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maturityDate" className="text-xs sm:text-sm">Maturity Date</Label>
              <Input
                id="maturityDate"
                type="date"
                value={formData.maturityDate}
                onChange={(e) => handleChange('maturityDate', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="redemptionAmount" className="text-xs sm:text-sm">Redemption Amount (₹)</Label>
              <Input
                id="redemptionAmount"
                type="number"
                placeholder="Expected at maturity"
                value={formData.redemptionAmount}
                onChange={(e) => handleChange('redemptionAmount', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastPayoutDate" className="text-xs sm:text-sm">Last Interest Payment Date</Label>
              <Input
                id="lastPayoutDate"
                type="date"
                value={formData.lastPayoutDate}
                onChange={(e) => handleChange('lastPayoutDate', e.target.value)}
                className="text-xs sm:text-sm"
              />
              <p className="text-[9px] text-muted-foreground italic">Optional: Manual override for calculation</p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="accruedInterest" className="text-xs sm:text-sm">Accrued Interest (₹)</Label>
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  onClick={calculateAccruedInterest}
                  className="h-5 text-[9px] px-1.5 bg-primary/5 hover:bg-primary/10 text-primary"
                >
                  Calculate
                </Button>
              </div>
              <Input
                id="accruedInterest"
                type="number"
                step="0.01"
                placeholder="Accrued so far"
                value={formData.accruedInterest}
                onChange={(e) => handleChange('accruedInterest', e.target.value)}
              />
            </div>

            {/* Payout Schedule Section */}
            <div className="sm:col-span-2 lg:col-span-3 space-y-4 mt-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold uppercase tracking-wider">Interest Payout Schedule</h3>
                </div>
                <div className="flex gap-2">
                  {payoutSchedule.length > 0 && (
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="sm" 
                      onClick={clearSchedule}
                      className="text-[10px] h-7 gap-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear
                    </Button>
                  )}
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={generatePayoutSchedule}
                    className="text-[10px] h-7 gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Auto-Generate Schedule
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={addPayoutRow}
                    className="text-[10px] h-7 gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Add Row
                  </Button>
                </div>
              </div>
              {payoutSchedule.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                  {payoutSchedule.map((payout, index) => (
                    <div key={payout.id} className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border border-muted group">
                      <button
                        type="button"
                        onClick={() => handlePayoutChange(index, 'status', payout.status === 'Received' ? 'Pending' : 'Received')}
                        className={`flex-shrink-0 transition-colors ${payout.status === 'Received' ? 'text-green-600' : 'text-muted-foreground'}`}
                      >
                        {payout.status === 'Received' ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                      </button>
                      <Input
                        type="date"
                        value={payout.date}
                        onChange={(e) => handlePayoutChange(index, 'date', e.target.value)}
                        className="h-8 text-[10px] sm:text-xs bg-background w-28 sm:w-32 flex-shrink-0"
                      />
                      <div className="relative flex-1 min-w-[60px]">
                        <span className="absolute left-2 top-2 text-[10px] text-muted-foreground pointer-events-none">₹</span>
                        <Input
                          type="text"
                          value={payout.amount ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                              handlePayoutChange(index, 'amount', val);
                            }
                          }}
                          className="h-8 text-xs pl-5 bg-background w-full"
                          placeholder="0.00"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePayoutRow(payout.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    onClick={addPayoutRow}
                    className="w-full text-[10px] h-8 gap-1 border border-dashed border-muted hover:bg-muted/50 mt-2"
                  >
                    <Plus className="w-3 h-3" />
                    Add Another Payout
                  </Button>
                </div>
              ) : (
                <div className="text-center py-6 border-2 border-dashed rounded-xl bg-muted/10">
                  <p className="text-xs text-muted-foreground">No payouts scheduled. Use Auto-Fill or Add Row.</p>
                </div>
              )}
            </div>

            {/* Exit Logic Section */}
            {initialData && (
              <div className="sm:col-span-2 lg:col-span-3 space-y-4 mt-4 border-t pt-4">
                {!showExitFields && formData.bondStatus === 'Active' ? (
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="w-full gap-2 border-orange-200 text-orange-600 hover:bg-orange-50"
                    onClick={() => {
                      setShowExitFields(true);
                      handleChange('bondStatus', 'Exited');
                    }}
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Exit Bond / Redemption
                  </Button>
                ) : (
                  <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-orange-700 uppercase tracking-wider">Bond Exit Details</h3>
                      {formData.bondStatus === 'Exited' && (
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs text-orange-600"
                          onClick={() => {
                            setShowExitFields(false);
                            handleChange('bondStatus', 'Active');
                          }}
                        >
                          Cancel Exit
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="exitDate" className="text-xs text-orange-700">Exit Date</Label>
                        <Input
                          id="exitDate"
                          type="date"
                          value={formData.exitDate}
                          onChange={(e) => handleChange('exitDate', e.target.value)}
                          className="bg-background border-orange-200"
                          required={formData.bondStatus === 'Exited'}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="redemptionAmount" className="text-xs text-orange-700">Redemption Amount (₹)</Label>
                        <Input
                          id="redemptionAmount"
                          type="number"
                          value={formData.redemptionAmount}
                          onChange={(e) => handleChange('redemptionAmount', e.target.value)}
                          className="bg-background border-orange-200"
                          placeholder="Principal + Final Interest"
                          required={formData.bondStatus === 'Exited'}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="space-y-2 relative sm:col-span-2 lg:col-span-1">
              <Label htmlFor="stockSearch" className="text-xs sm:text-sm">
                Search {formData.type}
              </Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="stockSearch"
                  placeholder={`Type symbol or name...`}
                  className="pl-8"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setFormData(prev => ({ ...prev, stockName: e.target.value, stockSymbol: e.target.value }));
                    setShowDropdown(true);
                    setIsValidSymbol(false);
                  }}
                  onFocus={() => {
                    setShowDropdown(true);
                  }}
                />
                {loadingSymbols && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              
              {showDropdown && search && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                  {combinedResults.length > 0 ? (
                    combinedResults.map(s => (
                      <div
                        key={s.symbol}
                        className="px-3 py-2 cursor-pointer hover:bg-accent text-sm flex justify-between items-center border-b last:border-0"
                        onClick={() => handleSelectSymbol(s)}
                      >
                        <div className="flex flex-col flex-1 min-w-0 mr-2">
                          <span className="font-bold whitespace-normal break-words leading-tight mb-1">{s.name}</span>
                          <span className="text-[10px] text-muted-foreground">Code: {s.symbol}</span>
                        </div>
                        {s.type && (
                          <span className={`text-[8px] font-bold uppercase px-1 rounded border ${
                            s.type === 'Stock' ? 'bg-blue-50 text-blue-600 border-blue-200' : 
                            s.type === 'ETF' ? 'bg-purple-50 text-purple-600 border-purple-200' : 
                            'bg-orange-50 text-orange-600 border-orange-200'
                          }`}>
                            {s.type}
                          </span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No results found</div>
                  )}
                </div>
              )}
              <input type="hidden" name="stockName" value={formData.stockName} required />
            </div>

            {formData.type === 'Mutual Fund' && (
              <div className="sm:col-span-2 lg:col-span-1 flex items-center gap-6 p-3 bg-muted/20 rounded-lg border border-dashed">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isSIP"
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                    checked={formData.isSIP}
                    onChange={(e) => handleChange('isSIP', e.target.checked as any)}
                  />
                  <Label htmlFor="isSIP" className="text-xs sm:text-sm font-bold cursor-pointer flex items-center gap-1 text-primary">
                    Enable SIP 
                    <Badge variant="outline" className="text-[9px] bg-primary/5 text-primary border-primary/20">Systematic</Badge>
                  </Label>
                </div>
              </div>
            )}

            {formData.isSIP && formData.type === 'Mutual Fund' ? (
              <>
                <div className="space-y-2">
                  <Label className="text-xs sm:text-sm font-bold text-primary">Initial Investment (Optional)</Label>
                  <Input
                    type="number"
                    placeholder="Lump sum at start e.g. 50000"
                    value={formData.sipInitialInvestment}
                    onChange={(e) => handleChange('sipInitialInvestment', e.target.value)}
                    className="border-primary/20 bg-primary/5"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs sm:text-sm">Monthly Installment Amount (₹)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 5000"
                    value={formData.sipInstallment}
                    onChange={(e) => handleChange('sipInstallment', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs sm:text-sm">SIP Start Date</Label>
                  <Input
                    type="date"
                    value={formData.sipStartDate}
                    onChange={(e) => handleChange('sipStartDate', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs sm:text-sm">SIP Day of Month</Label>
                  <Select 
                    value={formData.sipDayOfMonth} 
                    onValueChange={(v) => handleChange('sipDayOfMonth', v)}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="8th" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 28 }, (_, i) => (i + 1).toString()).map((day) => (
                        <SelectItem key={day} value={day}>{day}{day === '1' ? 'st' : day === '2' ? 'nd' : day === '3' ? 'rd' : 'th'}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-primary/5 p-4 rounded-2xl border border-primary/10">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                       <RefreshCw className="w-4 h-4 text-primary" />
                       <Label className="text-sm font-black uppercase tracking-tight text-primary">Annual Step-Up</Label>
                    </div>
                    <div className="flex gap-2">
                      <Select 
                        value={formData.sipStepUpType} 
                        onValueChange={(v) => handleChange('sipStepUpType', v)}
                      >
                        <SelectTrigger className="flex-1 text-xs">
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="None">None</SelectItem>
                          <SelectItem value="Percentage">Percentage (%)</SelectItem>
                          <SelectItem value="Fixed">Fixed Amount (₹)</SelectItem>
                        </SelectContent>
                      </Select>
                      {formData.sipStepUpType !== 'None' && (
                        <Input
                          type="number"
                          placeholder={formData.sipStepUpType === 'Percentage' ? "10" : "500"}
                          value={formData.sipStepUpValue}
                          onChange={(e) => handleChange('sipStepUpValue', e.target.value)}
                          className="w-24 text-xs h-9"
                        />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground italic">Increases your contribution every 12 months.</p>
                  </div>

                  {projectedWealth && (
                    <div className="bg-background/60 backdrop-blur-sm rounded-xl p-3 border border-primary/5">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-black uppercase text-muted-foreground">5-Year Wealth Path</span>
                        <div className="flex flex-col items-end">
                           <span className="text-xs font-black text-green-600">₹{Math.round(projectedWealth.stepUp.wealth).toLocaleString()}</span>
                           <span className="text-[9px] text-muted-foreground">Est. Value @ 12%</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden flex">
                          <div 
                            className="h-full bg-primary/20" 
                            style={{ width: `${(projectedWealth.base.wealth / projectedWealth.stepUp.wealth) * 100}%` }} 
                          />
                          <div 
                            className="h-full bg-primary" 
                            style={{ width: `${((projectedWealth.stepUp.wealth - projectedWealth.base.wealth) / projectedWealth.stepUp.wealth) * 100}%` }} 
                          />
                        </div>
                        <div className="flex justify-between text-[10px] font-medium">
                          <span className="text-muted-foreground">Normal SIP Advantage:</span>
                          <span className="text-primary font-black">+₹{Math.round(projectedWealth.diff).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="entryDate" className="text-xs sm:text-sm">Entry Date</Label>
                  <Input
                    id="entryDate"
                    type="date"
                    className="text-sm"
                    value={formData.entryDate}
                    onChange={(e) => handleChange('entryDate', e.target.value)}
                    required
                  />
                </div>

                {formData.type === 'Mutual Fund' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="totalInvestment" className="text-xs sm:text-sm">Total Investment (₹)</Label>
                  <Input
                    id="totalInvestment"
                    type="number"
                    step="0.01"
                    className="text-sm"
                    placeholder="e.g. 5000"
                    value={formData.totalInvestment}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormData(prev => ({ ...prev, totalInvestment: val }));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="nav" className="text-xs sm:text-sm">
                      NAV / Unit Price (₹) <span className="text-muted-foreground font-normal text-[10px]">(Optional)</span>
                    </Label>
                    {liveInfo.price && (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 rounded">
                        Live: ₹{liveInfo.price.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <Input
                    id="nav"
                    type="number"
                    step="0.0001"
                    className="text-sm"
                    placeholder="Optional (e.g. 25.4321)"
                    value={formData.nav}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormData(prev => ({ ...prev, nav: val, entryPrice: val }));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quantity" className="text-xs sm:text-sm">
                    Units / Quantity <span className="text-muted-foreground font-normal text-[10px]">(Optional)</span>
                  </Label>
                  <Input
                    id="quantity"
                    type="number"
                    step="0.0001"
                    className="text-sm"
                    placeholder="Optional (Units)"
                    value={formData.quantity}
                    onChange={(e) => handleChange('quantity', e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="entryPrice" className="text-xs sm:text-sm">Entry Price</Label>
                    {liveInfo.price && (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 rounded">
                        Live: ₹{liveInfo.price.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <Input
                    id="entryPrice"
                    type="number"
                    step="0.01"
                    className="text-sm"
                    value={formData.entryPrice}
                    onChange={(e) => handleChange('entryPrice', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quantity" className="text-xs sm:text-sm">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    className="text-sm"
                    value={formData.quantity}
                    onChange={(e) => handleChange('quantity', e.target.value)}
                    required
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="charges" className="text-xs sm:text-sm">Charges</Label>
              <Input
                id="charges"
                type="number"
                step="0.01"
                className="text-sm"
                value={formData.charges}
                onChange={(e) => handleChange('charges', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interest" className="text-xs sm:text-sm">Interest/MTF</Label>
              <Input
                id="interest"
                type="number"
                step="0.01"
                className="text-sm"
                value={formData.interest}
                onChange={(e) => handleChange('interest', e.target.value)}
              />
            </div>
            <div className={`space-y-2 ${(formData.type === 'ETF' || formData.type === 'Mutual Fund') ? 'hidden' : ''}`}>
              <div className="flex justify-between items-center">
                <Label className="text-xs sm:text-sm">Sector</Label>
                {liveInfo.sector && (
                  <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 rounded">
                    Live: {liveInfo.sector}
                  </span>
                )}
              </div>
              <Select value={formData.sector} onValueChange={(v) => handleChange('sector', v)}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dynamicSectors.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className={`space-y-2 ${(formData.type === 'ETF' || formData.type === 'Mutual Fund') ? 'hidden' : ''}`}>
              <div className="flex justify-between items-center">
                <Label className="text-xs sm:text-sm">Market Cap</Label>
                {liveInfo.marketCap && (
                  <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 rounded">
                    Live: {liveInfo.marketCap}
                  </span>
                )}
              </div>
              <Select value={formData.marketCap} onValueChange={(v) => handleChange('marketCap', v)}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKET_CAPS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs sm:text-sm">Broker</Label>
              <Select value={formData.broker} onValueChange={(v) => handleChange('broker', v)}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BROKERS.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="remarks" className="text-xs sm:text-sm">Remarks</Label>
              <Input
                id="remarks"
                placeholder="Strategy notes, reason for trade, etc."
                value={formData.remarks}
                onChange={(e) => handleChange('remarks', e.target.value)}
              />
            </div>
          </>
        )}
      </>
    )}
  </div>
      <Button type="submit" className="w-full">
        {initialData ? (formData.type === 'Bond' ? 'Update Bond' : 'Update Trade') : (formData.type === 'Bond' ? 'Add Bond' : 'Add Trade')}
      </Button>
    </form>
  );
}
