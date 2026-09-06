import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import YahooFinance from 'yahoo-finance2';
import cors from 'cors';

const yahooFinance = new YahooFinance();

// Configure yahoo-finance2
if (typeof (yahooFinance as any).setGlobalConfig === 'function') {
  (yahooFinance as any).setGlobalConfig({ 
    validation: { 
      logErrors: false,
      throwErrors: false
    } 
  });
}

function getRecordVal(r: any, keys: string[]): any {
  if (!r) return undefined;
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
    const upper = k.toUpperCase();
    if (r[upper] !== undefined && r[upper] !== null) return r[upper];
    const lower = k.toLowerCase();
    if (r[lower] !== undefined && r[lower] !== null) return r[lower];
  }
  return undefined;
}

function isETFPattern(symbol: string, name: string): boolean {
  const cleanSymbol = (symbol || '').split('.')[0].toUpperCase();
  const nameUpper = (name || '').toUpperCase();

  const isExplicitETF = 
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
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - START`);
    
    // Log response status when finished
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - END (${res.statusCode}) - ${duration}ms`);
    });
    
    next();
  });

  app.set('trust proxy', true);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  let cachedSymbols: any[] | null = null;
  let lastSymbolsFetch = 0;
  const SYMBOLS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // API: Fetch NSE Symbols (Stocks + ETFs)
  app.get('/api/symbols', async (req, res) => {
    const now = Date.now();
    if (cachedSymbols && (now - lastSymbolsFetch < SYMBOLS_CACHE_TTL)) {
      console.log(`[/api/symbols] Serving ${cachedSymbols.length} symbols from cache`);
      return res.json(cachedSymbols);
    }

    console.log(`[/api/symbols] START: Fetching symbols from NSE`);
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.nseindia.com/',
      };

      // Fetch Equity List with a reasonable timeout
      const equityUrl = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv';
      const equityRes = await axios.get(equityUrl, { headers, timeout: 10000 });
      console.log(`[/api/symbols] NSE Equity fetch success: ${equityRes.status}`);
      
      const equityRecords = parse(equityRes.data, { columns: true, skip_empty_lines: true, trim: true });

      // Fetch ETF List
      const etfUrl = 'https://archives.nseindia.com/content/equities/etf.csv';
      const etfRes: any = await axios.get(etfUrl, { headers, timeout: 10000 }).catch(err => {
        if (err.response?.status === 404) {
          console.info(`[/api/symbols] NSE ETF CSV not found (404), proceeding with Equities only.`);
        } else {
          console.warn(`[/api/symbols] NSE ETF fetch failed:`, err.message);
        }
        return { data: '', status: 'SKIPPED' };
      });
      console.log(`[/api/symbols] NSE ETF fetch status: ${etfRes.status || '200'}`);
      
      const etfRecords = etfRes.data ? parse(etfRes.data, { columns: true, skip_empty_lines: true, trim: true }) : [];

      const symbols = [
        ...equityRecords.map((r: any) => {
          const sym = getRecordVal(r, ['SYMBOL']);
          const name = getRecordVal(r, ['NAME OF COMPANY', 'NAME_OF_COMPANY', 'COMPANY NAME', 'COMPANY_NAME', 'SECURITY NAME', 'SECURITY_NAME']);
          const type = isETFPattern(sym, name) ? 'ETF' : 'Stock';
          return {
            symbol: sym,
            name: name || sym,
            type
          };
        }).filter((r: any) => r.symbol),
        ...etfRecords.map((r: any) => {
          const sym = getRecordVal(r, ['SYMBOL']);
          const name = getRecordVal(r, ['NAME OF COMPANY', 'NAME_OF_COMPANY', 'COMPANY NAME', 'COMPANY_NAME', 'SECURITY NAME', 'SECURITY_NAME', 'UNDERLYING']);
          return {
            symbol: sym,
            name: name || sym,
            type: 'ETF'
          };
        }).filter((r: any) => r.symbol)
      ];

      console.log(`[/api/symbols] SUCCESS: Returning ${symbols.length} symbols`);
      cachedSymbols = symbols;
      lastSymbolsFetch = Date.now();
      res.json(symbols);
    } catch (error) {
      console.error('[/api/symbols] ERROR fetching symbols from NSE:', (error as any).message);
      
      // Fallback to a small list of major NSE stocks if the external fetch fails
      const fallbackSymbols = [
        { symbol: 'RELIANCE', name: 'Reliance Industries Limited', type: 'Stock' },
        { symbol: 'TCS', name: 'Tata Consultancy Services Limited', type: 'Stock' },
        { symbol: 'HDFCBANK', name: 'HDFC Bank Limited', type: 'Stock' },
        { symbol: 'ICICIBANK', name: 'ICICI Bank Limited', type: 'Stock' },
        { symbol: 'INFY', name: 'Infosys Limited', type: 'Stock' },
        { symbol: 'BHARTIARTL', name: 'Bharti Airtel Limited', type: 'Stock' },
        { symbol: 'SBIN', name: 'State Bank of India', type: 'Stock' },
        { symbol: 'LICI', name: 'Life Insurance Corporation of India', type: 'Stock' },
        { symbol: 'ITC', name: 'ITC Limited', type: 'Stock' },
        { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Limited', type: 'Stock' },
        { symbol: 'LT', name: 'Larsen & Toubro Limited', type: 'Stock' },
        { symbol: 'BAJFINANCE', name: 'Bajaj Finance Limited', type: 'Stock' },
        { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Limited', type: 'Stock' },
        { symbol: 'ADANIENT', name: 'Adani Enterprises Limited', type: 'Stock' },
        { symbol: 'AXISBANK', name: 'Axis Bank Limited', type: 'Stock' },
        // Popular Indian ETFs (highly structured for easy search matching)
        { symbol: 'AXISVALUE', name: 'Axis Nifty 50 Value 20 ETF', type: 'ETF' },
        { symbol: 'NETFVAL20', name: 'Kotak Nifty 50 Value 20 ETF', type: 'ETF' },
        { symbol: 'NV20', name: 'Nippon India Nifty 50 Value 20 ETF', type: 'ETF' },
        { symbol: 'NIFTYBEES', name: 'Nippon India Nifty 50 BeES ETF', type: 'ETF' },
        { symbol: 'GOLDBEES', name: 'Nippon India Gold BeES ETF', type: 'ETF' },
        { symbol: 'JUNIORBEES', name: 'Nippon India Junior BeES ETF', type: 'ETF' },
        { symbol: 'BANKBEES', name: 'Nippon India Bank BeES ETF', type: 'ETF' },
        { symbol: 'LIQUIDBEES', name: 'Nippon India Liquid BeES ETF', type: 'ETF' },
        { symbol: 'ITBEES', name: 'Nippon India IT BeES ETF', type: 'ETF' },
        { symbol: 'AUTOBEES', name: 'Nippon India Auto BeES ETF', type: 'ETF' },
        { symbol: 'PHARMABEES', name: 'Nippon India Pharma BeES ETF', type: 'ETF' },
        { symbol: 'CONSUMBEES', name: 'Nippon India Consumption BeES ETF', type: 'ETF' },
        { symbol: 'CPSEETF', name: 'CPSE ETF', type: 'ETF' },
        { symbol: 'MON100', name: 'Motilal Oswal Nasdaq 100 ETF', type: 'ETF' },
        { symbol: 'MAFANG', name: 'Mirae Asset NYSE FANG+ ETF', type: 'ETF' },
        { symbol: 'MASPTOP50', name: 'Mirae Asset S&P 500 Top 50 ETF', type: 'ETF' },
        { symbol: 'MID150BEES', name: 'Nippon India Nifty Midcap 150 BeES ETF', type: 'ETF' },
        { symbol: 'SETFNIF50', name: 'SBI Nifty 50 ETF', type: 'ETF' },
        { symbol: 'SETFNN50', name: 'SBI Nifty Next 50 ETF', type: 'ETF' },
        { symbol: 'HDFCNIFETF', name: 'HDFC Nifty 50 ETF', type: 'ETF' },
        { symbol: 'HDFCSENETF', name: 'HDFC Sensex ETF', type: 'ETF' },
        { symbol: 'ICICINETF', name: 'ICICI Prudential NIFTY 50 ETF', type: 'ETF' },
        { symbol: 'ICICILIQ', name: 'ICICI Prudential Liquid ETF', type: 'ETF' },
        { symbol: 'LIQUIDCASE', name: 'Zerodha Nifty 1D Rate Liquid ETF', type: 'ETF' },
        { symbol: 'SILVERBEES', name: 'Nippon India Silver BeES ETF', type: 'ETF' },
        { symbol: 'HDFCSILVER', name: 'HDFC Silver ETF', type: 'ETF' }
      ];
      
      res.json(fallbackSymbols);
    }
  });

  // API: Search for any asset (Stock, ETF, Mutual Fund)
  app.get('/api/search', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);

      const query = q as string;
      console.log(`[/api/search] Searching for: ${query}`);

      // Search Yahoo Finance (for Stocks/ETFs) with a timeout
      const yahooPromise = Promise.race([
        yahooFinance.search(query, {}, { validateResult: false }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Yahoo Search Timeout')), 8000))
      ]).catch(err => {
        console.warn(`[/api/search] Yahoo Search failed/timeout for ${query}:`, err.message);
        return { quotes: [] };
      }) as Promise<any>;
      
      // Search MFAPI (for Mutual Funds) with a timeout
      const mfapiPromise = axios.get(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`, { timeout: 8000 })
        .then(res => res.data)
        .catch(err => {
          console.warn(`[/api/search] MFAPI Search failed/timeout for ${query}:`, err.message);
          return [];
        }) as Promise<any[]>;

      const [yahooRawResults, mfapiResults] = await Promise.all([yahooPromise, mfapiPromise]);
      const yahooResults = yahooRawResults as any;

      const stocksAndEtfs = (yahooResults.quotes as any[])
        .filter(q => {
          const qType = (q.quoteType || '').toUpperCase();
          return (qType === 'EQUITY' || qType === 'ETF' || qType === 'MUTUALFUND' || qType === 'INDEX') && (q.isYahooFinance || q.symbol);
        })
        .map(q => {
          const symbol = q.symbol || '';
          const name = q.longname || q.shortname || q.symbol || '';
          const qType = (q.quoteType || '').toUpperCase();
          
          let assetType = 'Stock';
          if (qType === 'ETF' || isETFPattern(symbol, name)) {
            assetType = 'ETF';
          } else if (qType === 'MUTUALFUND' || qType === 'MUTUAL_FUND') {
            assetType = 'Mutual Fund';
          }
          
          return {
            symbol: q.symbol,
            name: q.longname || q.shortname || q.symbol,
            type: assetType
          };
        });

      const mutualFunds = (mfapiResults as any[]).map(m => ({
        symbol: m.schemeCode.toString(),
        name: m.schemeName,
        type: 'Mutual Fund'
      }));

      // Combine results, prioritizing stocks/ETFs if they match exactly, then MFs
      res.json([...stocksAndEtfs, ...mutualFunds].slice(0, 50));
    } catch (error) {
      console.error('Search failed:', (error as any).message);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // API: Fetch Corporate Actions (Dividends, Splits)
  app.post('/api/corporate-actions', async (req, res) => {
    const { trades } = req.body;
    if (!trades || !Array.isArray(trades)) return res.status(400).json({ error: 'No trades provided' });

    const actions: any[] = [];
    const mergerMap: Record<string, { newSymbol: string; ratio: number; name: string }> = {
      'HDFC': { newSymbol: 'HDFCBANK', ratio: 42/25, name: 'HDFC Bank Limited' },
      'IDFC': { newSymbol: 'IDFCFIRSTB', ratio: 155/100, name: 'IDFC First Bank' },
      'LTI': { newSymbol: 'LTIM', ratio: 1, name: 'LTIMindtree' },
    };

    try {
      // Parallelize fetches for all symbols
      const allActions = await Promise.all(trades.map(async (trade) => {
        if (trade.type !== 'Stock') return [];
        
        const localActions = [];
        const symbol = trade.stockSymbol.includes('.') ? trade.stockSymbol : `${trade.stockSymbol}.NS`;
        const startDate = new Date(trade.entryDate);
        const endDate = trade.exitDate ? new Date(trade.exitDate) : new Date();

        // 1. Check for Mergers in our map
        if (mergerMap[trade.stockSymbol]) {
          const merger = mergerMap[trade.stockSymbol];
          localActions.push({
            tradeId: trade.id,
            stockSymbol: trade.stockSymbol,
            stockName: trade.stockName,
            type: 'Merger',
            date: new Date().toISOString().split('T')[0],
            value: merger.ratio,
            description: `Detected merger: ${trade.stockSymbol} into ${merger.newSymbol}. Swap ratio: ${merger.ratio.toFixed(4)}`,
            newSymbol: merger.newSymbol,
            newName: merger.name,
            status: 'Detected'
          });
        }

        try {
          // Fetch dividends and splits in parallel for this symbol
          const [divs, splits]: [any[], any[]] = await Promise.all([
            yahooFinance.historical(symbol, {
              period1: trade.entryDate,
              events: 'dividends',
            }, { validateResult: false }).catch(() => []),
            yahooFinance.historical(symbol, {
              period1: trade.entryDate,
              events: 'split',
            }, { validateResult: false }).catch(() => [])
          ]) as any;

          for (const div of divs) {
            const divDate = new Date(div.date);
            if (divDate > startDate && divDate <= endDate) {
              localActions.push({
                tradeId: trade.id,
                stockSymbol: trade.stockSymbol,
                stockName: trade.stockName,
                type: 'Dividend',
                date: divDate.toISOString().split('T')[0],
                value: div.dividends,
                description: `Detected dividend of ₹${div.dividends} per share on ${divDate.toLocaleDateString()}`,
                status: 'Detected'
              });
            }
          }

          for (const split of splits) {
            const splitDate = new Date(split.date);
            if (splitDate > startDate && splitDate <= endDate) {
              const [numerator, denominator] = split.stockSplits.split(':').map(Number);
              const ratio = numerator / denominator;
              localActions.push({
                tradeId: trade.id,
                stockSymbol: trade.stockSymbol,
                stockName: trade.stockName,
                type: ratio > 1 ? 'Split' : 'Bonus',
                date: splitDate.toISOString().split('T')[0],
                value: ratio,
                ratio: split.stockSplits,
                description: `Detected ${split.stockSplits} ${ratio > 1 ? 'Split' : 'Bonus'} on ${splitDate.toLocaleDateString()}`,
                status: 'Detected'
              });
            }
          }
        } catch (err) {
          console.error(`Failed to fetch actions for ${symbol}:`, (err as any).message || err);
        }
        return localActions;
      }));

      res.json(allActions.flat());
    } catch (error) {
      console.error('Corporate actions fetch failed:', (error as any).message || error);
      res.status(500).json({ error: 'Failed to fetch corporate actions' });
    }
  });

  // API: Fetch Historical Price Range
  app.get('/api/historical-range/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { from, to } = req.query;
    try {
      // Check if it's an Indian Mutual Fund (scheme code)
      if (/^\d+$/.test(symbol)) {
        try {
          const mfRes = await axios.get(`https://api.mfapi.in/mf/${symbol}`, { timeout: 15000 });
          if (mfRes.data && mfRes.data.data) {
            const navData = mfRes.data.data;
            const fromTimestamp = from ? new Date(from as string).getTime() : 0;
            const toTimestamp = to ? new Date(to as string).getTime() : Date.now();

            const history = navData
              .map((item: any) => {
                const [d, m, y] = item.date.split('-');
                return {
                  date: new Date(`${y}-${m}-${d}`).toISOString(),
                  price: parseFloat(item.nav),
                  timestamp: new Date(`${y}-${m}-${d}`).getTime()
                };
              })
              .filter((item: any) => item.timestamp >= fromTimestamp && item.timestamp <= toTimestamp)
              .sort((a: any, b: any) => a.timestamp - b.timestamp);

            return res.json(history.map(h => ({ date: h.date, price: h.price })));
          }
        } catch (mfErr) {
          console.error(`MFAPI historical range failed for ${symbol}:`, (mfErr as any).message);
          // Fall through to yahoo just in case
        }
      }

      let yahooSymbol = symbol;
      if (!symbol.includes('.') && !symbol.includes('^')) {
        yahooSymbol = `${symbol}.NS`;
      }
      
      const history = await (yahooFinance as any).historical(yahooSymbol, {
        period1: from as string,
        period2: (to as string) || new Date().toISOString().split('T')[0],
      }) as any[];

      res.json(history.map(item => ({
        date: item.date,
        price: item.close
      })));
    } catch (error) {
      console.error(`Historical range fetch failed for ${symbol}:`, (error as any).message || error);
      res.status(500).json({ error: 'Failed to fetch historical range' });
    }
  });

  // API: Fetch Historical Price for a specific date
  app.get('/api/historical/:symbol/:date', async (req, res) => {
    const { symbol, date } = req.params;
    try {
      // Check if it's an Indian Mutual Fund (scheme code)
      if (/^\d+$/.test(symbol)) {
        try {
          const mfRes = await axios.get(`https://api.mfapi.in/mf/${symbol}`);
          const navData = mfRes.data.data;
          // Format date from YYYY-MM-DD to DD-MM-YYYY as expected by mfapi
          const [y, m, d] = date.split('-');
          const targetDateStr = `${d}-${m}-${y}`;
          
          // Find the closest date (on or after)
          const targetTimestamp = new Date(date).getTime();
          const sortedNav = navData
            .map((item: any) => {
              const [day, month, year] = item.date.split('-');
              return { ...item, timestamp: new Date(`${year}-${month}-${day}`).getTime() };
            })
            .sort((a: any, b: any) => a.timestamp - b.timestamp);

          const result = sortedNav.find((item: any) => item.timestamp >= targetTimestamp);

          if (result) {
            return res.json({ price: parseFloat(result.nav), date: new Date(result.timestamp).toISOString() });
          } else if (sortedNav.length > 0) {
            // Fallback to latest available if requested date is too recent
            const latest = sortedNav[sortedNav.length - 1];
            return res.json({ price: parseFloat(latest.nav), date: new Date(latest.timestamp).toISOString(), isFallback: true });
          } else {
            return res.status(404).json({ error: 'NAV values list is empty for this scheme' });
          }
        } catch (mfErr) {
          console.error(`MFAPI fetch failed for ${symbol}:`, (mfErr as any).message);
          // Fall through to yahoo just in case
        }
      }

      let yahooSymbol = symbol;
      if (!symbol.includes('.') && !symbol.includes('^')) {
        yahooSymbol = `${symbol}.NS`;
      }
      
      const startDate = new Date(date);
      // Fetch data for a slightly larger window around the date since markets might have been closed
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 10); // increased window to 10 days for better coverage of holidays/weekends

      // Also try to fetch current quote as fallback if historical might fail for today/yesterday
      const history = await (yahooFinance as any).historical(yahooSymbol, {
        period1: startDate.toISOString().split('T')[0],
        period2: endDate.toISOString().split('T')[0],
      }, { validateResult: false }).catch(() => []) as any[];

      if (history && history.length > 0) {
        res.json({ price: history[0].close, date: history[0].date });
      } else {
        // Final fallback: Try regular quote if historical failed (likely because date is today/very recent)
        try {
          const quote = await yahooFinance.quote(yahooSymbol, {}, { validateResult: false }) as any;
          if (quote && (quote.regularMarketPrice || quote.regularMarketPreviousClose)) {
            return res.json({ 
              price: quote.regularMarketPrice || quote.regularMarketPreviousClose, 
              date: new Date().toISOString(),
              isFallback: true 
            });
          }
        } catch (quoteErr) {
          console.error(`Final quote fallback failed for ${yahooSymbol}:`, (quoteErr as any).message);
        }
        res.status(404).json({ error: 'Historical price not found' });
      }
    } catch (error) {
      console.error(`Historical fetch failed for ${symbol}:`, (error as any).message || error);
      res.status(500).json({ error: 'Failed to fetch historical price' });
    }
  });

  // API: Batch Historical Prices
  app.post('/api/historical/batch', async (req, res) => {
    const { symbols, date } = req.body;
    if (!symbols || !Array.isArray(symbols) || !date) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const results: Record<string, number> = {};
    
    // Process in smaller chunks to avoid hitting Yahoo rate limits too hard
    const CHUNK_SIZE = 5;
    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (symbol) => {
        try {
          let yahooSymbol = symbol;
          if (!symbol.includes('.') && !symbol.includes('^') && !/^\d{6}$/.test(symbol)) {
            yahooSymbol = `${symbol}.NS`;
          }

          // Special handling for MFs in batch
          if (/^\d+$/.test(symbol)) {
            const mfRes = await axios.get(`https://api.mfapi.in/mf/${symbol}`, { timeout: 15000 }).catch(() => null);
            if (mfRes?.data?.data) {
              const targetTimestamp = new Date(date).getTime();
              const result = mfRes.data.data
                .map((item: any) => {
                  const [day, month, year] = item.date.split('-');
                  return { ...item, timestamp: new Date(`${year}-${month}-${day}`).getTime() };
                })
                .find((item: any) => item.timestamp >= targetTimestamp);
              if (result) results[symbol] = parseFloat(result.nav);
              return;
            }
          }

          const startDate = new Date(date);
          const endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 7);

          const history = await (yahooFinance as any).historical(yahooSymbol, {
            period1: startDate.toISOString().split('T')[0],
            period2: endDate.toISOString().split('T')[0],
          }).catch(() => []) as any[];

          if (history && history.length > 0) {
            results[symbol] = history[0].close;
          }
        } catch (err) {
          console.error(`Batch historical failed for ${symbol}:`, err.message);
        }
      }));
      
      // Wait a bit between chunks if there are more
      if (i + CHUNK_SIZE < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    res.json(results);
  });

  const priceCache = new Map<string, { price: number; marketCap: number; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// API: Fetch Multiple Stock Prices
app.post('/api/prices', async (req, res) => {
  const { symbols, types, names } = req.body;
  if (!symbols || !Array.isArray(symbols)) return res.status(400).json({ error: 'No symbols provided' });

  const symbolList = symbols;
  const typeList = types || [];
  const namesList = names || [];
  const results: Record<string, any> = {};
  const now = Date.now();

  const symbolsToFetch: { symbol: string; type: string; name: string; idx: number }[] = [];

  // Check cache first
  symbolList.forEach((symbol, idx) => {
    const cached = priceCache.get(symbol);
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      results[symbol] = { price: cached.price, marketCap: cached.marketCap };
    } else {
      symbolsToFetch.push({ symbol, type: typeList[idx] || 'Stock', name: namesList[idx] || '', idx });
    }
  });

  if (symbolsToFetch.length === 0) {
    return res.json(results);
  }

  console.log(`[/api/prices] START: Fetching ${symbolsToFetch.length} symbols: ${symbolsToFetch.map(s => s.symbol).join(', ')}`);

  try {
    // Separate Mutual Funds (MFAPI) and Stocks/ETFs (Yahoo)
    const mfSymbols = symbolsToFetch.filter(s => s.type === 'Mutual Fund' && /^\d+$/.test(s.symbol));
    const yahooSymbols = symbolsToFetch.filter(s => s.type !== 'Mutual Fund' || !/^\d+$/.test(s.symbol));

    console.log(`[/api/prices] MF: ${mfSymbols.length}, Yahoo: ${yahooSymbols.length}`);

    // 1. Process Mutual Funds in small chunks to avoid MFAPI rate limits
    const MF_CHUNK_SIZE = 3;
    for (let i = 0; i < mfSymbols.length; i += MF_CHUNK_SIZE) {
      const chunk = mfSymbols.slice(i, i + MF_CHUNK_SIZE);
      await Promise.all(chunk.map(async (item) => {
        try {
          let mfRes;
          try {
            mfRes = await axios.get(`https://api.mfapi.in/mf/${item.symbol}/latest`, { timeout: 15000 });
          } catch (e1) {
            // Retry with full endpoint if latest timed out
            mfRes = await axios.get(`https://api.mfapi.in/mf/${item.symbol}`, { timeout: 15000 });
          }

          if (mfRes.data) {
            let latestNav: string | null = null;
            if (mfRes.data.status === 'SUCCESS' && mfRes.data.data && mfRes.data.data.length > 0) {
              latestNav = mfRes.data.data[0].nav;
            } else if (mfRes.data.data && mfRes.data.data.length > 0) {
              latestNav = mfRes.data.data[0].nav;
            }

            if (latestNav) {
              const price = parseFloat(latestNav);
              if (!isNaN(price) && price > 0) {
                results[item.symbol] = { price, marketCap: 0 };
                priceCache.set(item.symbol, { price, marketCap: 0, timestamp: now });
                return;
              }
            }
          }
        } catch (err) {
          console.warn(`[MFAPI] Fetch notice for ${item.symbol}: ${(err as any).message}`);
        }

        // Fallback to stale cached price if available
        const cached = priceCache.get(item.symbol);
        if (cached) {
          results[item.symbol] = { price: cached.price, marketCap: cached.marketCap };
        }
      }));
      if (i + MF_CHUNK_SIZE < mfSymbols.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 2. Process Stocks/ETFs with Yahoo Finance
    // Batch quotes is much more efficient than individual calls
    if (yahooSymbols.length > 0) {
      const yahooQueries = yahooSymbols.map(s => {
        if ((s.type === 'Stock' || s.type === 'ETF') && !s.symbol.includes('.') && !s.symbol.includes(':')) {
          return `${s.symbol}.NS`;
        }
        return s.symbol;
      });

      // Yahoo Finance allows batching in groups of up to ~20-50 usually
      const YAHOO_CHUNK_SIZE = 15;
      for (let i = 0; i < yahooQueries.length; i += YAHOO_CHUNK_SIZE) {
        const chunkQueries = yahooQueries.slice(i, i + YAHOO_CHUNK_SIZE);
        const originalSymbolsChunk = yahooSymbols.slice(i, i + YAHOO_CHUNK_SIZE);
        
        try {
          const quotes = await (yahooFinance as any).quote(chunkQueries).catch(() => []) as any[];
          const quoteMap = new Map();
          if (Array.isArray(quotes)) {
            quotes.forEach(q => quoteMap.set(q.symbol, q));
          } else if (quotes && (quotes as any).symbol) {
            quoteMap.set((quotes as any).symbol, quotes);
          }

          originalSymbolsChunk.forEach((item, idx) => {
            const querySymbol = chunkQueries[idx];
            const quote = quoteMap.get(querySymbol);
            
            if (quote) {
              const price = quote.regularMarketPrice || quote.regularMarketPreviousClose || quote.nav || 0;
              const marketCap = quote.marketCap || 0;
              if (price > 0) {
                results[item.symbol] = { price, marketCap };
                priceCache.set(item.symbol, { price, marketCap, timestamp: now });
              }
            }
          });
        } catch (err) {
          console.error(`Yahoo batch quote failed for chunk:`, (err as any).message);
          // Fallback to individual search if batch fails? (maybe too risky, let's just skip for now)
        }

        if (i + YAHOO_CHUNK_SIZE < yahooQueries.length) {
          await new Promise(resolve => setTimeout(resolve, 1500)); // Be gentle with Yahoo
        }
      }
    }

    console.log(`[/api/prices] SUCCESS: Fetched ${Object.keys(results).length} results`);
    res.json(results);
  } catch (error) {
    console.error('Batch price fetch failed critically:', (error as any).message);
    res.status(500).json({ error: 'Batch fetch failed critically' });
  }
});

  // API: AI Screenshot Scanning
  app.post('/api/scan', async (req, res) => {
    // This is handled in the frontend per system instructions
    res.status(405).json({ error: 'Use frontend scan implementation' });
  });

  // API: Fetch Stock Price
  app.get('/api/price/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { type } = req.query as { type?: string };

    if (!symbol || symbol === 'undefined' || symbol === 'null') {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    const now = Date.now();
    const cached = priceCache.get(symbol);
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      console.log(`[Cache Hit] Serving ${symbol} from cache`);
      // We can return the cached price and marketCap. 
      // The other metadata (sector, longName) might be missing but for single fetch, users usually care about price.
      // If we want to be safe, we only return if we have a full cache or we just proceed to fetch if it's a direct single request.
      // Given the 429 errors, it's better to return cached price if we have it.
      if (cached.price > 0) {
        return res.json({
          symbol,
          price: cached.price,
          marketCapValue: cached.marketCap,
          sector: 'Cached',
          longName: symbol,
          fromCache: true
        });
      }
    }

    try {
      const isNumeric = /^\d+$/.test(symbol);
      if (type === 'Mutual Fund' && isNumeric) {
        // Use MFAPI for Mutual Funds with numeric scheme codes
        try {
          const mfRes = await axios.get(`https://api.mfapi.in/mf/${symbol}/latest`, { timeout: 15000 });
          if (mfRes.data && mfRes.data.status === 'SUCCESS' && mfRes.data.data && mfRes.data.data.length > 0) {
            const latest = mfRes.data.data[0];
            const meta = mfRes.data.meta;
            return res.json({
              symbol: meta.scheme_code.toString(),
              price: parseFloat(latest.nav),
              date: latest.date,
              sector: 'Mutual Fund',
              marketCap: 'N/A',
              longName: meta.scheme_name,
            });
          }
        } catch (mfErr) {
          console.error(`MFAPI failed for ${symbol}, falling back to Yahoo...`, (mfErr as any).message || mfErr);
        }
      }

      // Use Yahoo Finance for Stocks, ETFs, and non-numeric Mutual Funds
      let yahooSymbol = symbol;
      if (type === 'Stock' || type === 'ETF') {
        if (!symbol.includes('.') && !symbol.includes(':')) {
          yahooSymbol = `${symbol}.NS`;
        }
      }

      let quote: any;
      try {
        quote = await yahooFinance.quote(yahooSymbol, {}, { validateResult: false });
      } catch (e) {
        // Fallback 1: Try .BO if .NS failed
        if (yahooSymbol.endsWith('.NS')) {
          try {
            const bseSymbol = symbol + '.BO';
            console.log(`NSE quote failed, trying BSE: ${bseSymbol}`);
            quote = await yahooFinance.quote(bseSymbol, {}, { validateResult: false });
          } catch (bseErr) {
            console.log(`BSE quote also failed for ${symbol}`);
          }
        }

        // Fallback 2: Try search if direct quotes failed
        if (!quote) {
          console.log(`Direct quotes failed for ${symbol}, trying search...`);
          const searchResults = await yahooFinance.search(symbol, {}, { validateResult: false }) as any;
          const validQuotes = (searchResults.quotes as any[]).filter(q => q.symbol);
          
          if (validQuotes.length > 0) {
            // Find the best match (prefer .NS or .BO for Indian assets)
            const bestMatch = validQuotes.find(q => 
              q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO')
            ) || validQuotes.find(q => q.quoteType === 'EQUITY') || validQuotes[0];
            
            yahooSymbol = bestMatch.symbol;
            console.log(`Found alternative symbol via search: ${yahooSymbol}`);
            quote = await yahooFinance.quote(yahooSymbol, {}, { validateResult: false }).catch(() => null);
          }
        }
      }

      if (!quote || (quote.regularMarketPrice === undefined && quote.nav === undefined && quote.price === undefined)) {
        return res.json({ error: 'Price not found', price: null });
      }

      // Determine Market Cap Category (only for stocks)
      let marketCapCategory = 'N/A';
      let sector = 'Other';
      let summary: any = null;

      if (type === 'Stock') {
        summary = await yahooFinance.quoteSummary(yahooSymbol, { modules: ["assetProfile", "summaryDetail", "price"] }, { validateResult: false }).catch(() => null);
        const marketCap = quote?.marketCap || summary?.summaryDetail?.marketCap || summary?.price?.marketCap || 0;
        
        if (marketCap > 600000000000) {
          marketCapCategory = 'Largecap';
        } else if (marketCap > 200000000000) {
          marketCapCategory = 'Midcap';
        } else if (marketCap > 0) {
          marketCapCategory = 'Smallcap';
        }

        sector = summary?.assetProfile?.sector || 'Other';
        if (sector === 'Financial Services') {
          const name = (quote?.longName || quote?.shortName || summary?.price?.longName || '').toLowerCase();
          const sym = symbol.toLowerCase();
          if (name.includes('bank') || sym.includes('bank')) {
            sector = 'Bank';
          }
        }

        // Fallback price from summary if quote was missing it
        if (quote && quote.regularMarketPrice === undefined && summary?.price?.regularMarketPrice !== undefined) {
          quote.regularMarketPrice = summary.price.regularMarketPrice;
        }
      } else if (type === 'ETF') {
        sector = 'ETF';
      } else if (type === 'Mutual Fund') {
        sector = 'Mutual Fund';
      }

      const finalPrice = quote?.regularMarketPrice || quote?.nav || quote?.price || 0;
      const rawMarketCap = quote?.marketCap || summary?.summaryDetail?.marketCap || summary?.price?.marketCap || 0;

      if (finalPrice > 0) {
        priceCache.set(symbol, { price: finalPrice, marketCap: rawMarketCap, timestamp: Date.now() });
      }

      res.json({
        symbol: quote?.symbol || yahooSymbol,
        price: finalPrice,
        currency: quote?.currency,
        change: quote?.regularMarketChange,
        changePercent: quote?.regularMarketChangePercent,
        sector: sector,
        marketCap: marketCapCategory,
        marketCapValue: rawMarketCap,
        longName: quote?.longName || quote?.shortName || symbol,
      });
    } catch (error) {
      console.error(`Error fetching price for ${symbol}:`, (error as any).message);
      res.status(500).json({ error: 'Failed to fetch price' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Global uncaught error handler for Express
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled express error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });
}

startServer();
