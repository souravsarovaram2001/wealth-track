import { Bond, BondPayout, PayoutFrequency } from '../types';

export function getPayoutIntervalMonths(frequency: PayoutFrequency): number {
  switch (frequency) {
    case 'Monthly': return 1;
    case 'Quarterly': return 3;
    case 'Semi-Annually': return 6;
    case 'Annually': return 12;
    default: return 12;
  }
}

export function generatePayoutSchedule(
  principal: number,
  interestRate: number,
  frequency: PayoutFrequency,
  purchaseDate: string,
  maturityDate?: string
): BondPayout[] {
  if (!maturityDate) return [];

  const schedule: BondPayout[] = [];
  const start = new Date(purchaseDate);
  const end = new Date(maturityDate);
  const interval = getPayoutIntervalMonths(frequency);
  const annualInterest = (principal * interestRate) / 100;
  const payoutAmount = (annualInterest * interval) / 12;

  let currentDate = new Date(start);
  
  // Advance to first payout date
  currentDate.setMonth(currentDate.getMonth() + interval);

  while (currentDate <= end) {
    schedule.push({
      id: Math.random().toString(36).substr(2, 9),
      date: currentDate.toISOString().split('T')[0],
      amount: Number(payoutAmount.toFixed(2)),
      status: 'Pending'
    });
    
    // Add next interval
    const nextDate = new Date(currentDate);
    nextDate.setMonth(nextDate.getMonth() + interval);
    currentDate = nextDate;
  }

  return schedule;
}

export function calculateAccruedInterest(bond: Bond): number {
  const now = (bond.status === 'Exited' && bond.exitDate) ? new Date(bond.exitDate) : new Date();
  
  // Find the most recent "Received" payout date or fall back to purchase date
  let lastPayoutDateStr = bond.purchaseDate;
  if (bond.lastPayoutDate) {
    lastPayoutDateStr = bond.lastPayoutDate;
  } else if (bond.payoutSchedule && bond.payoutSchedule.length > 0) {
    const receivedPayouts = bond.payoutSchedule
      .filter(p => p.status === 'Received')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    if (receivedPayouts.length > 0) {
      lastPayoutDateStr = receivedPayouts[0].date;
    }
  }

  const lastPayout = new Date(lastPayoutDateStr);
  
  // If exit date is set and we've reached it, or if interest was just received today
  if (now <= lastPayout) return 0;
  
  // Calculate days since last payout
  const diffTime = Math.abs(now.getTime() - lastPayout.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Use floor for full days elapsed
  
  const dailyInterest = (Number(bond.principal) * (Number(bond.interestRate) / 100)) / 365;
  return Number((dailyInterest * diffDays).toFixed(2));
}
