
/**
 * Calculates the Net Present Value for a given rate and set of cash flows.
 * @param rate Annualized interest rate.
 * @param flows Array of cash flows with amounts and dates (in milliseconds).
 */
function npv(rate: number, flows: { amount: number; date: number }[]): number {
  const d1 = flows[0].date;
  return flows.reduce((acc, flow) => {
    return acc + flow.amount / Math.pow(1 + rate, (flow.date - d1) / (365 * 24 * 60 * 60 * 1000));
  }, 0);
}

/**
 * Calculates the derivative of Net Present Value for a given rate and set of cash flows.
 * @param rate Annualized interest rate.
 * @param flows Array of cash flows with amounts and dates (in milliseconds).
 */
function npvDeriv(rate: number, flows: { amount: number; date: number }[]): number {
  const d1 = flows[0].date;
  return flows.reduce((acc, flow) => {
    const fraction = (flow.date - d1) / (365 * 24 * 60 * 60 * 1000);
    if (fraction === 0) return acc;
    return acc - fraction * flow.amount * Math.pow(1 + rate, -fraction - 1);
  }, 0);
}

/**
 * Extended Internal Rate of Return (XIRR).
 * Uses Newton-Raphson method with a fallback to Bisection if it fails to converge.
 * @param flows Array of cash flows with amounts and dates (ISO string).
 * @param guess Initial guess for the rate (default 0.1).
 */
export function calculateXIRR(flows: { amount: number; date: string }[], guess: number = 0.1): number | null {
  if (flows.length < 2) return null;

  // Aggregate flows by date string (YYYY-MM-DD) to improve stability and handle same-day transactions
  const aggregated = new Map<string, number>();
  flows.forEach(f => {
    // Treat all times as the same day part to avoid time-of-day artifacts
    const dStr = new Date(f.date).toISOString().split('T')[0];
    aggregated.set(dStr, (aggregated.get(dStr) || 0) + f.amount);
  });

  const processedFlows = Array.from(aggregated.entries())
    .map(([dStr, amount]) => ({ amount, date: new Date(dStr).getTime() }))
    .sort((a, b) => a.date - b.date);

  if (processedFlows.length < 2) return null;

  // Check if we have at least one positive and one negative cash flow
  const hasPositive = processedFlows.some(f => f.amount > 0);
  const hasNegative = processedFlows.some(f => f.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const maxIterations = 200;
  const precision = 1e-7;

  const guesses = [guess, -0.1, 0.5, -0.5, 0.01, 2.0];
  let bestRate = null;

  for (const g of guesses) {
    let currentRate = g;
    let converged = false;

    // Newton-Raphson
    for (let i = 0; i < maxIterations; i++) {
      const v = npv(currentRate, processedFlows);
      const d = npvDeriv(currentRate, processedFlows);
      
      if (Math.abs(d) < 1e-15) break; 
      
      const nextRate = currentRate - v / d;
      if (Math.abs(nextRate - currentRate) < precision) {
        if (nextRate > -0.999) {
          bestRate = nextRate;
          converged = true;
        }
        break; 
      }
      currentRate = nextRate;
      
      if (currentRate > 1e15 || currentRate < -0.9999) break;
    }

    if (converged) return bestRate;
  }

  // Robust Bisection as fallback
  let low = -0.999;
  let high = 1e6; // Start with 1,000,000%
  
  // Find valid high bound
  let vLow = npv(low, processedFlows);
  let vHigh = npv(high, processedFlows);

  // If vLow and vHigh have same sign, expand high aggressively
  if (Math.sign(vLow) === Math.sign(vHigh)) {
    for (let i = 0; i < 30; i++) {
      high *= 10;
      vHigh = npv(high, processedFlows);
      if (Math.sign(vLow) !== Math.sign(vHigh)) break;
      if (high > 1e18) break; // Absolute cap to avoid overflow
    }
  }

  if (Math.sign(vLow) !== Math.sign(vHigh)) {
    for (let i = 0; i < maxIterations; i++) {
      const mid = (low + high) / 2;
      const vMid = npv(mid, processedFlows);
      
      if (Math.abs(vMid) < precision) return mid;
      
      if (Math.sign(vLow) === Math.sign(vMid)) {
        low = mid;
        vLow = vMid;
      } else {
        high = mid;
        vHigh = vMid;
      }
      
      if (Math.abs(high - low) < (low === 0 ? precision : Math.abs(low) * precision)) return mid;
    }
  }

  return null;
}
