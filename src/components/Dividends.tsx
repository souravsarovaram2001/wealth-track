import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dividend } from '@/src/types';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DividendsProps {
  dividends: Dividend[];
  onDelete: (dividend: Dividend) => void;
}

export function Dividends({ dividends, onDelete }: DividendsProps) {
  return (
    <div className="border rounded-xl bg-card shadow-sm overflow-x-auto custom-scrollbar">
      <div className="min-w-[400px] sm:min-w-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="text-[10px] sm:text-xs">Asset Name</TableHead>
              <TableHead className="text-[10px] sm:text-xs">Month / Period</TableHead>
              <TableHead className="text-right text-[10px] sm:text-xs">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!dividends || dividends.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground text-sm">
                  No dividend records found
                </TableCell>
              </TableRow>
            ) : (
              [...dividends]
                .sort((a, b) => {
                  const dateA = a.date || `${a.month}-01`;
                  const dateB = b.date || `${b.month}-01`;
                  return new Date(dateB).getTime() - new Date(dateA).getTime();
                })
                .map((div) => {
                  const displayMonth = (() => {
                    try {
                      // Try parsing YYYY-MM
                      const [year, month] = div.month.split('-');
                      return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
                    } catch (e) {
                      return div.month;
                    }
                  })();

                  return (
                    <TableRow key={div.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-medium py-3">
                        <div className="flex flex-col">
                          <span className="text-xs sm:text-sm font-bold">{div.stockName}</span>
                          {div.date && <span className="text-[10px] text-muted-foreground">Received on {new Date(div.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm font-medium opacity-70 italic">{displayMonth}</TableCell>
                      <TableCell className="text-right font-mono text-xs sm:text-sm font-black text-green-600">
                        <div className="flex items-center justify-end gap-2">
                          <span>₹{div.amount.toLocaleString()}</span>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => div.id && onDelete(div)}
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
