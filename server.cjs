var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_vite = require("vite");
var import_path = __toESM(require("path"), 1);
var import_axios = __toESM(require("axios"), 1);
var import_sync = require("csv-parse/sync");
var import_yahoo_finance2 = __toESM(require("yahoo-finance2"), 1);
var import_cors = __toESM(require("cors"), 1);
var yahooFinance = new import_yahoo_finance2.default();
if (typeof yahooFinance.setGlobalConfig === "function") {
  yahooFinance.setGlobalConfig({
    validation: {
      logErrors: false,
      throwErrors: false
    }
  });
}
function getRecordVal(r, keys) {
  if (!r) return void 0;
  for (const k of keys) {
    if (r[k] !== void 0 && r[k] !== null) return r[k];
    const upper = k.toUpperCase();
    if (r[upper] !== void 0 && r[upper] !== null) return r[upper];
    const lower = k.toLowerCase();
    if (r[lower] !== void 0 && r[lower] !== null) return r[lower];
  }
  return void 0;
}
function isETFPattern(symbol, name) {
  const cleanSymbol = (symbol || "").split(".")[0].toUpperCase();
  const nameUpper = (name || "").toUpperCase();
  const isExplicitETF = cleanSymbol.endsWith("BEES") || cleanSymbol.endsWith("ETF") || cleanSymbol.includes("ETF") || cleanSymbol.includes("BEES") || nameUpper.includes("EXCHANGE TRADED FUND") || nameUpper.includes("VALUE 20") || nameUpper.includes("VALUE 50") || [
    "AXISVALUE",
    "AXISVAL",
    "NV20",
    "NETFVAL20",
    "KOTAKNV20",
    "NETFLV30",
    "NETFALFA",
    "NETF50",
    "NETITF",
    "GOLDBEES",
    "NIFTYBEES",
    "BANKBEES",
    "JUNIORBEES",
    "CPSEETF",
    "MON100",
    "MAFANG",
    "ITBEES",
    "LIQUIDCASE"
  ].includes(cleanSymbol);
  const containsMutualFundKeywords = nameUpper.includes("FUND OF FUND") || nameUpper.includes("FOF") || nameUpper.includes("FD OF FD") || nameUpper.includes("F0F") || nameUpper.includes("MUTUAL FUND") || nameUpper.includes("DIRECT") || nameUpper.includes("GROWTH") || nameUpper.includes("REGULAR");
  if (isExplicitETF) {
    return true;
  }
  if (containsMutualFundKeywords) {
    return false;
  }
  return nameUpper.includes("ETF") || nameUpper.includes("BEES");
}
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use((0, import_cors.default)());
  app.use(import_express.default.json({ limit: "10mb" }));
  app.use(import_express.default.urlencoded({ extended: true, limit: "10mb" }));
  app.use((req, res, next) => {
    const start = Date.now();
    console.log(`${(/* @__PURE__ */ new Date()).toISOString()} - ${req.method} ${req.url} - START`);
    res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(`${(/* @__PURE__ */ new Date()).toISOString()} - ${req.method} ${req.url} - END (${res.statusCode}) - ${duration}ms`);
    });
    next();
  });
  app.set("trust proxy", true);
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  let cachedSymbols = null;
  let lastSymbolsFetch = 0;
  const SYMBOLS_CACHE_TTL = 24 * 60 * 60 * 1e3;
  app.get("/api/symbols", async (req, res) => {
    const now = Date.now();
    if (cachedSymbols && now - lastSymbolsFetch < SYMBOLS_CACHE_TTL) {
      console.log(`[/api/symbols] Serving ${cachedSymbols.length} symbols from cache`);
      return res.json(cachedSymbols);
    }
    console.log(`[/api/symbols] START: Fetching symbols from NSE`);
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.nseindia.com/"
      };
      const equityUrl = "https://archives.nseindia.com/content/equities/EQUITY_L.csv";
      const equityRes = await import_axios.default.get(equityUrl, { headers, timeout: 1e4 });
      console.log(`[/api/symbols] NSE Equity fetch success: ${equityRes.status}`);
      const equityRecords = (0, import_sync.parse)(equityRes.data, { columns: true, skip_empty_lines: true, trim: true });
      const etfUrl = "https://archives.nseindia.com/content/equities/etf.csv";
      const etfRes = await import_axios.default.get(etfUrl, { headers, timeout: 1e4 }).catch((err) => {
        if (err.response?.status === 404) {
          console.info(`[/api/symbols] NSE ETF CSV not found (404), proceeding with Equities only.`);
        } else {
          console.warn(`[/api/symbols] NSE ETF fetch failed:`, err.message);
        }
        return { data: "", status: "SKIPPED" };
      });
      console.log(`[/api/symbols] NSE ETF fetch status: ${etfRes.status || "200"}`);
      const etfRecords = etfRes.data ? (0, import_sync.parse)(etfRes.data, { columns: true, skip_empty_lines: true, trim: true }) : [];
      const symbols = [
        ...equityRecords.map((r) => {
          const sym = getRecordVal(r, ["SYMBOL"]);
          const name = getRecordVal(r, ["NAME OF COMPANY", "NAME_OF_COMPANY", "COMPANY NAME", "COMPANY_NAME", "SECURITY NAME", "SECURITY_NAME"]);
          const type = isETFPattern(sym, name) ? "ETF" : "Stock";
          return {
            symbol: sym,
            name: name || sym,
            type
          };
        }).filter((r) => r.symbol),
        ...etfRecords.map((r) => {
          const sym = getRecordVal(r, ["SYMBOL"]);
          const name = getRecordVal(r, ["NAME OF COMPANY", "NAME_OF_COMPANY", "COMPANY NAME", "COMPANY_NAME", "SECURITY NAME", "SECURITY_NAME", "UNDERLYING"]);
          return {
            symbol: sym,
            name: name || sym,
            type: "ETF"
          };
        }).filter((r) => r.symbol)
      ];
      console.log(`[/api/symbols] SUCCESS: Returning ${symbols.length} symbols`);
      cachedSymbols = symbols;
      lastSymbolsFetch = Date.now();
      res.json(symbols);
    } catch (error) {
      console.error("[/api/symbols] ERROR fetching symbols from NSE:", error.message);
      const fallbackSymbols = [
        { symbol: "RELIANCE", name: "Reliance Industries Limited", type: "Stock" },
        { symbol: "TCS", name: "Tata Consultancy Services Limited", type: "Stock" },
        { symbol: "HDFCBANK", name: "HDFC Bank Limited", type: "Stock" },
        { symbol: "ICICIBANK", name: "ICICI Bank Limited", type: "Stock" },
        { symbol: "INFY", name: "Infosys Limited", type: "Stock" },
        { symbol: "BHARTIARTL", name: "Bharti Airtel Limited", type: "Stock" },
        { symbol: "SBIN", name: "State Bank of India", type: "Stock" },
        { symbol: "LICI", name: "Life Insurance Corporation of India", type: "Stock" },
        { symbol: "ITC", name: "ITC Limited", type: "Stock" },
        { symbol: "HINDUNILVR", name: "Hindustan Unilever Limited", type: "Stock" },
        { symbol: "LT", name: "Larsen & Toubro Limited", type: "Stock" },
        { symbol: "BAJFINANCE", name: "Bajaj Finance Limited", type: "Stock" },
        { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank Limited", type: "Stock" },
        { symbol: "ADANIENT", name: "Adani Enterprises Limited", type: "Stock" },
        { symbol: "AXISBANK", name: "Axis Bank Limited", type: "Stock" },
        // Popular Indian ETFs (highly structured for easy search matching)
        { symbol: "AXISVALUE", name: "Axis Nifty 50 Value 20 ETF", type: "ETF" },
        { symbol: "NETFVAL20", name: "Kotak Nifty 50 Value 20 ETF", type: "ETF" },
        { symbol: "NV20", name: "Nippon India Nifty 50 Value 20 ETF", type: "ETF" },
        { symbol: "NIFTYBEES", name: "Nippon India Nifty 50 BeES ETF", type: "ETF" },
        { symbol: "GOLDBEES", name: "Nippon India Gold BeES ETF", type: "ETF" },
        { symbol: "JUNIORBEES", name: "Nippon India Junior BeES ETF", type: "ETF" },
        { symbol: "BANKBEES", name: "Nippon India Bank BeES ETF", type: "ETF" },
        { symbol: "LIQUIDBEES", name: "Nippon India Liquid BeES ETF", type: "ETF" },
        { symbol: "ITBEES", name: "Nippon India IT BeES ETF", type: "ETF" },
        { symbol: "AUTOBEES", name: "Nippon India Auto BeES ETF", type: "ETF" },
        { symbol: "PHARMABEES", name: "Nippon India Pharma BeES ETF", type: "ETF" },
        { symbol: "CONSUMBEES", name: "Nippon India Consumption BeES ETF", type: "ETF" },
        { symbol: "CPSEETF", name: "CPSE ETF", type: "ETF" },
        { symbol: "MON100", name: "Motilal Oswal Nasdaq 100 ETF", type: "ETF" },
        { symbol: "MAFANG", name: "Mirae Asset NYSE FANG+ ETF", type: "ETF" },
        { symbol: "MASPTOP50", name: "Mirae Asset S&P 500 Top 50 ETF", type: "ETF" },
        { symbol: "MID150BEES", name: "Nippon India Nifty Midcap 150 BeES ETF", type: "ETF" },
        { symbol: "SETFNIF50", name: "SBI Nifty 50 ETF", type: "ETF" },
        { symbol: "SETFNN50", name: "SBI Nifty Next 50 ETF", type: "ETF" },
        { symbol: "HDFCNIFETF", name: "HDFC Nifty 50 ETF", type: "ETF" },
        { symbol: "HDFCSENETF", name: "HDFC Sensex ETF", type: "ETF" },
        { symbol: "ICICINETF", name: "ICICI Prudential NIFTY 50 ETF", type: "ETF" },
        { symbol: "ICICILIQ", name: "ICICI Prudential Liquid ETF", type: "ETF" },
        { symbol: "LIQUIDCASE", name: "Zerodha Nifty 1D Rate Liquid ETF", type: "ETF" },
        { symbol: "SILVERBEES", name: "Nippon India Silver BeES ETF", type: "ETF" },
        { symbol: "HDFCSILVER", name: "HDFC Silver ETF", type: "ETF" }
      ];
      res.json(fallbackSymbols);
    }
  });
  app.get("/api/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);
      const query = q;
      console.log(`[/api/search] Searching for: ${query}`);
      const yahooPromise = Promise.race([
        yahooFinance.search(query, {}, { validateResult: false }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Yahoo Search Timeout")), 8e3))
      ]).catch((err) => {
        console.warn(`[/api/search] Yahoo Search failed/timeout for ${query}:`, err.message);
        return { quotes: [] };
      });
      const mfapiPromise = import_axios.default.get(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`, { timeout: 8e3 }).then((res2) => res2.data).catch((err) => {
        console.warn(`[/api/search] MFAPI Search failed/timeout for ${query}:`, err.message);
        return [];
      });
      const [yahooRawResults, mfapiResults] = await Promise.all([yahooPromise, mfapiPromise]);
      const yahooResults = yahooRawResults;
      const stocksAndEtfs = yahooResults.quotes.filter((q2) => {
        const qType = (q2.quoteType || "").toUpperCase();
        return (qType === "EQUITY" || qType === "ETF" || qType === "MUTUALFUND" || qType === "INDEX") && (q2.isYahooFinance || q2.symbol);
      }).map((q2) => {
        const symbol = q2.symbol || "";
        const name = q2.longname || q2.shortname || q2.symbol || "";
        const qType = (q2.quoteType || "").toUpperCase();
        let assetType = "Stock";
        if (qType === "ETF" || isETFPattern(symbol, name)) {
          assetType = "ETF";
        } else if (qType === "MUTUALFUND" || qType === "MUTUAL_FUND") {
          assetType = "Mutual Fund";
        }
        return {
          symbol: q2.symbol,
          name: q2.longname || q2.shortname || q2.symbol,
          type: assetType
        };
      });
      const mutualFunds = mfapiResults.map((m) => ({
        symbol: m.schemeCode.toString(),
        name: m.schemeName,
        type: "Mutual Fund"
      }));
      res.json([...stocksAndEtfs, ...mutualFunds].slice(0, 50));
    } catch (error) {
      console.error("Search failed:", error.message);
      res.status(500).json({ error: "Search failed" });
    }
  });
  app.post("/api/corporate-actions", async (req, res) => {
    const { trades } = req.body;
    if (!trades || !Array.isArray(trades)) return res.status(400).json({ error: "No trades provided" });
    const actions = [];
    const mergerMap = {
      "HDFC": { newSymbol: "HDFCBANK", ratio: 42 / 25, name: "HDFC Bank Limited" },
      "IDFC": { newSymbol: "IDFCFIRSTB", ratio: 155 / 100, name: "IDFC First Bank" },
      "LTI": { newSymbol: "LTIM", ratio: 1, name: "LTIMindtree" }
    };
    try {
      const allActions = await Promise.all(trades.map(async (trade) => {
        if (trade.type !== "Stock") return [];
        const localActions = [];
        const symbol = trade.stockSymbol.includes(".") ? trade.stockSymbol : `${trade.stockSymbol}.NS`;
        const startDate = new Date(trade.entryDate);
        const endDate = trade.exitDate ? new Date(trade.exitDate) : /* @__PURE__ */ new Date();
        if (mergerMap[trade.stockSymbol]) {
          const merger = mergerMap[trade.stockSymbol];
          localActions.push({
            tradeId: trade.id,
            stockSymbol: trade.stockSymbol,
            stockName: trade.stockName,
            type: "Merger",
            date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
            value: merger.ratio,
            description: `Detected merger: ${trade.stockSymbol} into ${merger.newSymbol}. Swap ratio: ${merger.ratio.toFixed(4)}`,
            newSymbol: merger.newSymbol,
            newName: merger.name,
            status: "Detected"
          });
        }
        try {
          const [divs, splits] = await Promise.all([
            yahooFinance.historical(symbol, {
              period1: trade.entryDate,
              events: "dividends"
            }, { validateResult: false }).catch(() => []),
            yahooFinance.historical(symbol, {
              period1: trade.entryDate,
              events: "split"
            }, { validateResult: false }).catch(() => [])
          ]);
          for (const div of divs) {
            const divDate = new Date(div.date);
            if (divDate > startDate && divDate <= endDate) {
              localActions.push({
                tradeId: trade.id,
                stockSymbol: trade.stockSymbol,
                stockName: trade.stockName,
                type: "Dividend",
                date: divDate.toISOString().split("T")[0],
                value: div.dividends,
                description: `Detected dividend of \u20B9${div.dividends} per share on ${divDate.toLocaleDateString()}`,
                status: "Detected"
              });
            }
          }
          for (const split of splits) {
            const splitDate = new Date(split.date);
            if (splitDate > startDate && splitDate <= endDate) {
              const [numerator, denominator] = split.stockSplits.split(":").map(Number);
              const ratio = numerator / denominator;
              localActions.push({
                tradeId: trade.id,
                stockSymbol: trade.stockSymbol,
                stockName: trade.stockName,
                type: ratio > 1 ? "Split" : "Bonus",
                date: splitDate.toISOString().split("T")[0],
                value: ratio,
                ratio: split.stockSplits,
                description: `Detected ${split.stockSplits} ${ratio > 1 ? "Split" : "Bonus"} on ${splitDate.toLocaleDateString()}`,
                status: "Detected"
              });
            }
          }
        } catch (err) {
          console.error(`Failed to fetch actions for ${symbol}:`, err.message || err);
        }
        return localActions;
      }));
      res.json(allActions.flat());
    } catch (error) {
      console.error("Corporate actions fetch failed:", error.message || error);
      res.status(500).json({ error: "Failed to fetch corporate actions" });
    }
  });
  app.get("/api/historical-range/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const { from, to } = req.query;
    try {
      if (/^\d+$/.test(symbol)) {
        try {
          const mfRes = await import_axios.default.get(`https://api.mfapi.in/mf/${symbol}`, { timeout: 15e3 });
          if (mfRes.data && mfRes.data.data) {
            const navData = mfRes.data.data;
            const fromTimestamp = from ? new Date(from).getTime() : 0;
            const toTimestamp = to ? new Date(to).getTime() : Date.now();
            const history2 = navData.map((item) => {
              const [d, m, y] = item.date.split("-");
              return {
                date: (/* @__PURE__ */ new Date(`${y}-${m}-${d}`)).toISOString(),
                price: parseFloat(item.nav),
                timestamp: (/* @__PURE__ */ new Date(`${y}-${m}-${d}`)).getTime()
              };
            }).filter((item) => item.timestamp >= fromTimestamp && item.timestamp <= toTimestamp).sort((a, b) => a.timestamp - b.timestamp);
            return res.json(history2.map((h) => ({ date: h.date, price: h.price })));
          }
        } catch (mfErr) {
          console.error(`MFAPI historical range failed for ${symbol}:`, mfErr.message);
        }
      }
      let yahooSymbol = symbol;
      if (!symbol.includes(".") && !symbol.includes("^")) {
        yahooSymbol = `${symbol}.NS`;
      }
      const history = await yahooFinance.historical(yahooSymbol, {
        period1: from,
        period2: to || (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
      });
      res.json(history.map((item) => ({
        date: item.date,
        price: item.close
      })));
    } catch (error) {
      console.error(`Historical range fetch failed for ${symbol}:`, error.message || error);
      res.status(500).json({ error: "Failed to fetch historical range" });
    }
  });
  app.get("/api/historical/:symbol/:date", async (req, res) => {
    const { symbol, date } = req.params;
    try {
      if (/^\d+$/.test(symbol)) {
        try {
          const mfRes = await import_axios.default.get(`https://api.mfapi.in/mf/${symbol}`);
          const navData = mfRes.data.data;
          const [y, m, d] = date.split("-");
          const targetDateStr = `${d}-${m}-${y}`;
          const targetTimestamp = new Date(date).getTime();
          const sortedNav = navData.map((item) => {
            const [day, month, year] = item.date.split("-");
            return { ...item, timestamp: (/* @__PURE__ */ new Date(`${year}-${month}-${day}`)).getTime() };
          }).sort((a, b) => a.timestamp - b.timestamp);
          const result = sortedNav.find((item) => item.timestamp >= targetTimestamp);
          if (result) {
            return res.json({ price: parseFloat(result.nav), date: new Date(result.timestamp).toISOString() });
          } else if (sortedNav.length > 0) {
            const latest = sortedNav[sortedNav.length - 1];
            return res.json({ price: parseFloat(latest.nav), date: new Date(latest.timestamp).toISOString(), isFallback: true });
          } else {
            return res.status(404).json({ error: "NAV values list is empty for this scheme" });
          }
        } catch (mfErr) {
          console.error(`MFAPI fetch failed for ${symbol}:`, mfErr.message);
        }
      }
      let yahooSymbol = symbol;
      if (!symbol.includes(".") && !symbol.includes("^")) {
        yahooSymbol = `${symbol}.NS`;
      }
      const startDate = new Date(date);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 10);
      const history = await yahooFinance.historical(yahooSymbol, {
        period1: startDate.toISOString().split("T")[0],
        period2: endDate.toISOString().split("T")[0]
      }, { validateResult: false }).catch(() => []);
      if (history && history.length > 0) {
        res.json({ price: history[0].close, date: history[0].date });
      } else {
        try {
          const quote = await yahooFinance.quote(yahooSymbol, {}, { validateResult: false });
          if (quote && (quote.regularMarketPrice || quote.regularMarketPreviousClose)) {
            return res.json({
              price: quote.regularMarketPrice || quote.regularMarketPreviousClose,
              date: (/* @__PURE__ */ new Date()).toISOString(),
              isFallback: true
            });
          }
        } catch (quoteErr) {
          console.error(`Final quote fallback failed for ${yahooSymbol}:`, quoteErr.message);
        }
        res.status(404).json({ error: "Historical price not found" });
      }
    } catch (error) {
      console.error(`Historical fetch failed for ${symbol}:`, error.message || error);
      res.status(500).json({ error: "Failed to fetch historical price" });
    }
  });
  app.post("/api/historical/batch", async (req, res) => {
    const { symbols, date } = req.body;
    if (!symbols || !Array.isArray(symbols) || !date) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const results = {};
    const CHUNK_SIZE = 5;
    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (symbol) => {
        try {
          let yahooSymbol = symbol;
          if (!symbol.includes(".") && !symbol.includes("^") && !/^\d{6}$/.test(symbol)) {
            yahooSymbol = `${symbol}.NS`;
          }
          if (/^\d+$/.test(symbol)) {
            const mfRes = await import_axios.default.get(`https://api.mfapi.in/mf/${symbol}`, { timeout: 15e3 }).catch(() => null);
            if (mfRes?.data?.data) {
              const targetTimestamp = new Date(date).getTime();
              const result = mfRes.data.data.map((item) => {
                const [day, month, year] = item.date.split("-");
                return { ...item, timestamp: (/* @__PURE__ */ new Date(`${year}-${month}-${day}`)).getTime() };
              }).find((item) => item.timestamp >= targetTimestamp);
              if (result) results[symbol] = parseFloat(result.nav);
              return;
            }
          }
          const startDate = new Date(date);
          const endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 7);
          const history = await yahooFinance.historical(yahooSymbol, {
            period1: startDate.toISOString().split("T")[0],
            period2: endDate.toISOString().split("T")[0]
          }).catch(() => []);
          if (history && history.length > 0) {
            results[symbol] = history[0].close;
          }
        } catch (err) {
          console.error(`Batch historical failed for ${symbol}:`, err.message);
        }
      }));
      if (i + CHUNK_SIZE < symbols.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    res.json(results);
  });
  const priceCache = /* @__PURE__ */ new Map();
  const CACHE_TTL = 5 * 60 * 1e3;
  app.post("/api/prices", async (req, res) => {
    const { symbols, types, names } = req.body;
    if (!symbols || !Array.isArray(symbols)) return res.status(400).json({ error: "No symbols provided" });
    const symbolList = symbols;
    const typeList = types || [];
    const namesList = names || [];
    const results = {};
    const now = Date.now();
    const symbolsToFetch = [];
    symbolList.forEach((symbol, idx) => {
      const cached = priceCache.get(symbol);
      if (cached && now - cached.timestamp < CACHE_TTL) {
        results[symbol] = { price: cached.price, marketCap: cached.marketCap };
      } else {
        symbolsToFetch.push({ symbol, type: typeList[idx] || "Stock", name: namesList[idx] || "", idx });
      }
    });
    if (symbolsToFetch.length === 0) {
      return res.json(results);
    }
    console.log(`[/api/prices] START: Fetching ${symbolsToFetch.length} symbols: ${symbolsToFetch.map((s) => s.symbol).join(", ")}`);
    try {
      const mfSymbols = symbolsToFetch.filter((s) => s.type === "Mutual Fund" && /^\d+$/.test(s.symbol));
      const yahooSymbols = symbolsToFetch.filter((s) => s.type !== "Mutual Fund" || !/^\d+$/.test(s.symbol));
      console.log(`[/api/prices] MF: ${mfSymbols.length}, Yahoo: ${yahooSymbols.length}`);
      const MF_CHUNK_SIZE = 3;
      for (let i = 0; i < mfSymbols.length; i += MF_CHUNK_SIZE) {
        const chunk = mfSymbols.slice(i, i + MF_CHUNK_SIZE);
        await Promise.all(chunk.map(async (item) => {
          try {
            let mfRes;
            try {
              mfRes = await import_axios.default.get(`https://api.mfapi.in/mf/${item.symbol}/latest`, { timeout: 15e3 });
            } catch (e1) {
              mfRes = await import_axios.default.get(`https://api.mfapi.in/mf/${item.symbol}`, { timeout: 15e3 });
            }
            if (mfRes.data) {
              let latestNav = null;
              if (mfRes.data.status === "SUCCESS" && mfRes.data.data && mfRes.data.data.length > 0) {
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
            console.warn(`[MFAPI] Fetch notice for ${item.symbol}: ${err.message}`);
          }
          const cached = priceCache.get(item.symbol);
          if (cached) {
            results[item.symbol] = { price: cached.price, marketCap: cached.marketCap };
          }
        }));
        if (i + MF_CHUNK_SIZE < mfSymbols.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (yahooSymbols.length > 0) {
        const yahooQueries = yahooSymbols.map((s) => {
          if ((s.type === "Stock" || s.type === "ETF") && !s.symbol.includes(".") && !s.symbol.includes(":")) {
            return `${s.symbol}.NS`;
          }
          return s.symbol;
        });
        const YAHOO_CHUNK_SIZE = 15;
        for (let i = 0; i < yahooQueries.length; i += YAHOO_CHUNK_SIZE) {
          const chunkQueries = yahooQueries.slice(i, i + YAHOO_CHUNK_SIZE);
          const originalSymbolsChunk = yahooSymbols.slice(i, i + YAHOO_CHUNK_SIZE);
          try {
            const quotes = await yahooFinance.quote(chunkQueries).catch(() => []);
            const quoteMap = /* @__PURE__ */ new Map();
            if (Array.isArray(quotes)) {
              quotes.forEach((q) => quoteMap.set(q.symbol, q));
            } else if (quotes && quotes.symbol) {
              quoteMap.set(quotes.symbol, quotes);
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
            console.error(`Yahoo batch quote failed for chunk:`, err.message);
          }
          if (i + YAHOO_CHUNK_SIZE < yahooQueries.length) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      }
      console.log(`[/api/prices] SUCCESS: Fetched ${Object.keys(results).length} results`);
      res.json(results);
    } catch (error) {
      console.error("Batch price fetch failed critically:", error.message);
      res.status(500).json({ error: "Batch fetch failed critically" });
    }
  });
  app.post("/api/scan", async (req, res) => {
    res.status(405).json({ error: "Use frontend scan implementation" });
  });
  app.get("/api/price/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const { type } = req.query;
    if (!symbol || symbol === "undefined" || symbol === "null") {
      return res.status(400).json({ error: "Invalid symbol" });
    }
    const now = Date.now();
    const cached = priceCache.get(symbol);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      console.log(`[Cache Hit] Serving ${symbol} from cache`);
      if (cached.price > 0) {
        return res.json({
          symbol,
          price: cached.price,
          marketCapValue: cached.marketCap,
          sector: "Cached",
          longName: symbol,
          fromCache: true
        });
      }
    }
    try {
      const isNumeric = /^\d+$/.test(symbol);
      if (type === "Mutual Fund" && isNumeric) {
        try {
          const mfRes = await import_axios.default.get(`https://api.mfapi.in/mf/${symbol}/latest`, { timeout: 15e3 });
          if (mfRes.data && mfRes.data.status === "SUCCESS" && mfRes.data.data && mfRes.data.data.length > 0) {
            const latest = mfRes.data.data[0];
            const meta = mfRes.data.meta;
            return res.json({
              symbol: meta.scheme_code.toString(),
              price: parseFloat(latest.nav),
              date: latest.date,
              sector: "Mutual Fund",
              marketCap: "N/A",
              longName: meta.scheme_name
            });
          }
        } catch (mfErr) {
          console.error(`MFAPI failed for ${symbol}, falling back to Yahoo...`, mfErr.message || mfErr);
        }
      }
      let yahooSymbol = symbol;
      if (type === "Stock" || type === "ETF") {
        if (!symbol.includes(".") && !symbol.includes(":")) {
          yahooSymbol = `${symbol}.NS`;
        }
      }
      let quote;
      try {
        quote = await yahooFinance.quote(yahooSymbol, {}, { validateResult: false });
      } catch (e) {
        if (yahooSymbol.endsWith(".NS")) {
          try {
            const bseSymbol = symbol + ".BO";
            console.log(`NSE quote failed, trying BSE: ${bseSymbol}`);
            quote = await yahooFinance.quote(bseSymbol, {}, { validateResult: false });
          } catch (bseErr) {
            console.log(`BSE quote also failed for ${symbol}`);
          }
        }
        if (!quote) {
          console.log(`Direct quotes failed for ${symbol}, trying search...`);
          const searchResults = await yahooFinance.search(symbol, {}, { validateResult: false });
          const validQuotes = searchResults.quotes.filter((q) => q.symbol);
          if (validQuotes.length > 0) {
            const bestMatch = validQuotes.find(
              (q) => q.symbol.endsWith(".NS") || q.symbol.endsWith(".BO")
            ) || validQuotes.find((q) => q.quoteType === "EQUITY") || validQuotes[0];
            yahooSymbol = bestMatch.symbol;
            console.log(`Found alternative symbol via search: ${yahooSymbol}`);
            quote = await yahooFinance.quote(yahooSymbol, {}, { validateResult: false }).catch(() => null);
          }
        }
      }
      if (!quote || quote.regularMarketPrice === void 0 && quote.nav === void 0 && quote.price === void 0) {
        return res.json({ error: "Price not found", price: null });
      }
      let marketCapCategory = "N/A";
      let sector = "Other";
      let summary = null;
      if (type === "Stock") {
        summary = await yahooFinance.quoteSummary(yahooSymbol, { modules: ["assetProfile", "summaryDetail", "price"] }, { validateResult: false }).catch(() => null);
        const marketCap = quote?.marketCap || summary?.summaryDetail?.marketCap || summary?.price?.marketCap || 0;
        if (marketCap > 6e11) {
          marketCapCategory = "Largecap";
        } else if (marketCap > 2e11) {
          marketCapCategory = "Midcap";
        } else if (marketCap > 0) {
          marketCapCategory = "Smallcap";
        }
        sector = summary?.assetProfile?.sector || "Other";
        if (sector === "Financial Services") {
          const name = (quote?.longName || quote?.shortName || summary?.price?.longName || "").toLowerCase();
          const sym = symbol.toLowerCase();
          if (name.includes("bank") || sym.includes("bank")) {
            sector = "Bank";
          }
        }
        if (quote && quote.regularMarketPrice === void 0 && summary?.price?.regularMarketPrice !== void 0) {
          quote.regularMarketPrice = summary.price.regularMarketPrice;
        }
      } else if (type === "ETF") {
        sector = "ETF";
      } else if (type === "Mutual Fund") {
        sector = "Mutual Fund";
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
        sector,
        marketCap: marketCapCategory,
        marketCapValue: rawMarketCap,
        longName: quote?.longName || quote?.shortName || symbol
      });
    } catch (error) {
      console.error(`Error fetching price for ${symbol}:`, error.message);
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  app.use((err, req, res, next) => {
    console.error("Unhandled express error:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
