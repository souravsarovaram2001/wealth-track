import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedData<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_EXPIRY_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCachedData(key: string, data: any) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) {
    console.warn("Failed to set cache (likely storage full):", e);
  }
}

export async function fetchStockBetas(symbols: string[]): Promise<Record<string, number>> {
  if (!symbols.length || !process.env.GEMINI_API_KEY) return {};

  const cacheKey = `betas_${symbols.sort().join(",")}`;
  const cached = getCachedData<Record<string, number>>(cacheKey);
  if (cached) return cached;

  try {
    const prompt = `
      Provide the current 1-year Beta (relative to NIFTY 50) for the following Indian stock/Mutual Fund symbols. 
      Return the data strictly as a JSON object where keys are symbols and values are numeric betas. 
      If a beta is unknown, provide a conservative estimate (1.0 for large cap, 1.2 for mid cap, 0.8 for defensive/FMCG).
      
      Symbols: ${symbols.join(", ")}
      
      IMPORTANT: Return ONLY the JSON object. Do not include any introductory or explanatory text.
      Example Response: {"RELIANCE": 1.1, "TCS": 0.75}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    const text = response.text || "";
    // Robust JSON extraction: look for strictly the outer-most { }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("No JSON object found in Gemini response");
    }
    
    const result = JSON.parse(match[0]);
    setCachedData(cacheKey, result);
    return result;
  } catch (error: any) {
    console.error("Error fetching betas from Gemini:", error.message || error);
    return {};
  }
}

export async function fetchHistoricalPrices(symbols: string[], days: number): Promise<Record<string, { date: string, close: number }[]>> {
  if (!symbols.length || !process.env.GEMINI_API_KEY) return {};

  const cacheKey = `hist_${days}_${symbols.sort().join(",")}`;
  const cached = getCachedData<Record<string, { date: string, close: number }[]>>(cacheKey);
  if (cached) return cached;

  try {
    const prompt = `
      Provide historical daily closing prices for the following financial symbols for the last ${days} days (including the current date ${new Date().toISOString().split('T')[0]}).
      Include the indices/stocks: ${symbols.join(", ")}.
      Return the data strictly as a JSON object where each key is a symbol (e.g. "NIFTY50", "RELIANCE.NS"), and its value is an array of objects with "date" (YYYY-MM-DD) and "close" (number).
      Ensure you include data points for April 2026 specifically.
      
      IMPORTANT: Return ONLY the JSON object. Do not include any introductory or explanatory text.
      Example Response: {"NIFTY50": [{"date": "2026-04-01", "close": 22679}, ...]}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    const text = response.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("No JSON object found in Gemini response");
    }
    
    const result = JSON.parse(match[0]);
    setCachedData(cacheKey, result);
    return result;
  } catch (error: any) {
    console.error("Error fetching historical prices from Gemini:", error.message || error);
    return {};
  }
}
