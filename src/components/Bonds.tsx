import React, { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bond, PayoutFrequency, BondPayout } from '@/src/types';
import { format, differenceInMonths, addMonths, isAfter, isBefore, startOfMonth, endOfMonth, startOfYear, addYears, subYears, parseISO, isValid } from 'date-fns';
import { Trash2, TrendingUp, Calendar, DollarSign, ChevronDown, ChevronRight, Clock, CheckCircle2, History, LogOut } from 'lucide-react';
import { calculateAccruedInterest } from '@/src/lib/bondUtils';

interface BondsProps {
  bonds: Bond[];
  onDelete: (id: string) => void;
  onEdit?: (bond: Bond) => void;
  onExit?: (bond: Bond) => void;
}

export function Bonds({ bonds, onDelete, onEdit, onExit }: BondsProps) {
  const [expandedBond, setExpandedBond] = useState<string | null>(null);
  const today = new Date();
  
  // Financial Year Logic (April - March)
  const currentFYStart = today.getMonth() >= 3 
    ? new Date(today.getFullYear(), 3, 1) 
    : new Date(today.getFullYear() - 1, 3, 1);
  const currentFYEnd = new Date(currentFYStart.getFullYear() + 1, 2, 31);

  const bondCalculations = useMemo(() => {
    return bonds.map(bond => {
      const principal = Number(bond.principal) || 0;
      const interestRate = Number(bond.interestRate) || 0;
      
      // 1. Accrued Interest (since last payout or purchase)
      const accrued = calculateAccruedInterest(bond);

      // 2. Earnings from Schedule
      let totalEarned = 0;
      let fyPaid = 0;
      let fyAccrued = 0;
      const monthlyIncome: Record<string, number> = {};

      // Initialize monthly income for current FY
      for (let i = 0; i < 12; i++) {
        const d = addMonths(currentFYStart, i);
        monthlyIncome[format(d, 'MMM')] = 0;
      }

      if (bond.payoutSchedule && bond.payoutSchedule.length > 0) {
        bond.payoutSchedule.forEach(p => {
          const pDate = new Date(p.date);
          const amount = Number(p.amount) || 0;

          if (p.status === 'Received') {
            totalEarned += amount;
            if (!isBefore(pDate, currentFYStart) && !isAfter(pDate, currentFYEnd)) {
              fyPaid += amount;
              const monthKey = format(pDate, 'MMM');
              monthlyIncome[monthKey] = (monthlyIncome[monthKey] || 0) + amount;
            }
          } else {
            // Projected in current FY
            if (!isBefore(pDate, currentFYStart) && !isAfter(pDate, currentFYEnd)) {
              fyAccrued += amount;
              const monthKey = format(pDate, 'MMM');
              monthlyIncome[monthKey] = (monthlyIncome[monthKey] || 0) + amount;
            }
          }
        });
      } else {
        // Fallback to legacy calculation if no schedule exists
        // (Similar to previous implementation but we prefer schedule)
      }

      return {
        ...bond,
        accrued,
        totalEarned,
        fyPaid,
        fyAccrued,
        fyTotal: fyPaid + fyAccrued,
        monthlyIncome
      };
    });
  }, [bonds, currentFYStart, currentFYEnd, today]);

  const totalFYSummary = useMemo(() => {
    return bondCalculations.reduce((acc, b) => ({
      paid: acc.paid + b.fyPaid,
      accrued: acc.accrued + b.fyAccrued,
      total: acc.total + b.fyTotal
    }), { paid: 0, accrued: 0, total: 0 });
  }, [bondCalculations]);

  const chartData = useMemo(() => {
    const data: any[] = [];
    for (let i = 0; i < 12; i++) {
      const d = addMonths(currentFYStart, i);
      const monthLabel = format(d, 'MMM');
      const amount = bondCalculations.reduce((acc, b) => acc + (b.monthlyIncome[monthLabel] || 0), 0);
      data.push({ name: monthLabel, amount });
    }
    return data;
  }, [bondCalculations, currentFYStart]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-blue-50/50 border-blue-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              FY Paid Interest
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalFYSummary.paid.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Interest received to date in FY</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-50/50 border-purple-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-purple-600 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              FY Accrued Interest
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalFYSummary.accrued.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Projected for remainder of FY</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50/50 border-green-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Total FY Interest
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalFYSummary.total.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Paid + Accrued for current FY</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Monthly Interest Income (FY {currentFYStart.getFullYear()}-{currentFYEnd.getFullYear().toString().slice(-2)})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {chartData.map((entry, index) => (
              <div key={index} className="p-3 rounded-xl border bg-background hover:border-blue-300 transition-all text-center">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">{entry.name}</div>
                <div className="text-sm font-black text-foreground">₹{entry.amount.toLocaleString()}</div>
                <div className="w-full h-1 bg-muted rounded-full overflow-hidden mt-2">
                  <div 
                    className="h-full bg-blue-500 rounded-full" 
                    style={{ width: `${chartData.some(d => d.amount > 0) ? (entry.amount / Math.max(...chartData.map(d => d.amount))) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[30px]"></TableHead>
              <TableHead>Bond Name</TableHead>
              <TableHead>Principal</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>FY Total</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bondCalculations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No bonds added yet. Use the Trade Form to add bonds with payout schedules.
                </TableCell>
              </TableRow>
            ) : (
              bondCalculations.map((bond) => (
                <React.Fragment key={bond.id}>
                  <TableRow 
                    className={`cursor-pointer hover:bg-muted/30 ${expandedBond === bond.id ? 'bg-muted/20' : ''}`}
                    onClick={() => setExpandedBond(expandedBond === bond.id ? null : bond.id!)}
                  >
                    <TableCell>
                      {expandedBond === bond.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold text-sm sm:text-base">{bond.name}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px] font-bold uppercase py-0 h-4">
                            {bond.frequency}
                          </Badge>
                          {bond.status === 'Exited' && (
                            <Badge variant="destructive" className="text-[10px] font-bold uppercase py-0 h-4">
                              Exited
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>₹{(Number(bond.principal) || 0).toLocaleString()}</TableCell>
                    <TableCell>{(Number(bond.interestRate) || 0)}%</TableCell>
                    <TableCell className="text-green-600 font-bold">₹{(Number(bond.totalEarned) || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-blue-600 font-bold">₹{(Number(bond.fyTotal) || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {onExit && bond.status !== 'Exited' && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => onExit(bond)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 gap-1 border border-red-100"
                          >
                            <LogOut className="w-4 h-4" />
                            <span className="text-[10px] font-bold uppercase hidden sm:inline">Exit</span>
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => onDelete(bond.id!)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedBond === bond.id && (
                    <TableRow className="bg-muted/5 group hover:bg-muted/10">
                      <TableCell colSpan={8} className="p-0 border-t">
                        <div className="p-4 sm:p-6 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                          <div className="flex items-center justify-between border-b pb-2 mb-4">
                            <h4 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                              <Calendar className="w-4 h-4" />
                              Interest Payout Schedule
                            </h4>
                            <div className="flex gap-4">
                                <div className="text-right">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Maturity Date</p>
                                    <p className="text-sm font-bold">{bond.maturityDate ? format(new Date(bond.maturityDate), 'dd MMM yyyy') : '--'}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Purchase Date</p>
                                    <p className="text-sm font-bold">{format(new Date(bond.purchaseDate), 'dd MMM yyyy')}</p>
                                </div>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 max-h-[300px] overflow-y-auto no-scrollbar pr-2">
                            {bond.payoutSchedule && bond.payoutSchedule.length > 0 ? (
                                bond.payoutSchedule.map((p, idx) => (
                                    <div 
                                        key={p.id} 
                                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                            p.status === 'Received' 
                                            ? 'bg-green-50/30 border-green-100 shadow-sm' 
                                            : isBefore(new Date(p.date), today) 
                                                ? 'bg-orange-50/30 border-orange-100' 
                                                : 'bg-background border-muted'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-full ${p.status === 'Received' ? 'bg-green-100 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                                                {p.status === 'Received' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold">{format(new Date(p.date), 'dd MMM yyyy')}</span>
                                                <span className="text-[10px] text-muted-foreground uppercase font-medium">{p.status}</span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-black">₹{Number(p.amount).toLocaleString()}</p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="col-span-full py-8 text-center text-muted-foreground italic">
                                    No payout schedule defined for this bond.
                                </div>
                            )}
                          </div>

                          {bond.remarks && (
                            <div className="bg-muted/10 p-3 rounded-lg border border-dashed text-xs text-muted-foreground italic">
                              <strong>Remarks:</strong> {bond.remarks}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
