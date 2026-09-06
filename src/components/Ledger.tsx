import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LedgerEntry } from '@/src/types';
import { format, isValid } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const safeFormat = (date: any, formatStr: string) => {
  if (!date) return '--';
  const d = new Date(date);
  if (!isValid(d)) return '--';
  return format(d, formatStr);
};

interface LedgerProps {
  entries: LedgerEntry[];
  onDelete: (entry: LedgerEntry) => void;
}

export function Ledger({ entries, onDelete }: LedgerProps) {
  return (
    <div className="border rounded-xl bg-card shadow-sm overflow-x-auto custom-scrollbar">
      <div className="min-w-[400px] sm:min-w-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="text-[10px] sm:text-xs">Date</TableHead>
              <TableHead className="text-[10px] sm:text-xs">Broker</TableHead>
              <TableHead className="text-[10px] sm:text-xs">Type</TableHead>
              <TableHead className="text-right text-[10px] sm:text-xs">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!entries || entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                  No ledger entries found
                </TableCell>
              </TableRow>
            ) : (
              [...entries]
                .sort((a, b) => {
                  const timeA = new Date(a.date).getTime();
                  const timeB = new Date(b.date).getTime();
                  return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
                })
                .map((entry) => (
                  <TableRow key={entry.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-xs sm:text-sm font-medium">
                      {safeFormat(entry.date, 'dd MMM yy')}
                    </TableCell>
                    <TableCell className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-tight">
                      {entry.broker}
                    </TableCell>
                    <TableCell>
                      <span className={`text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${entry.type === 'Deposit' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
                        {entry.type}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs sm:text-sm font-black">
                      <div className="flex items-center justify-end gap-2">
                        <span>₹{entry.amount.toLocaleString()}</span>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => entry.id && onDelete(entry)}
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
