import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BROKERS } from '@/src/constants';
import { LedgerEntry, Broker } from '@/src/types';

interface LedgerFormProps {
  onSubmit: (entry: Omit<LedgerEntry, 'id'>) => void;
}

export function LedgerForm({ onSubmit }: LedgerFormProps) {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    broker: BROKERS[0] as Broker,
    amount: '',
    type: 'Deposit' as 'Deposit' | 'Withdrawal',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(formData.amount);
    if (isNaN(amount)) return;

    onSubmit({
      date: formData.date,
      broker: formData.broker,
      amount,
      type: formData.type,
    });

    setFormData({
      date: new Date().toISOString().split('T')[0],
      broker: BROKERS[0] as Broker,
      amount: '',
      type: 'Deposit',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-lg bg-card mt-6">
      <h3 className="font-semibold">Add Cash Flow</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Date</Label>
          <Input
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Broker</Label>
          <Select value={formData.broker} onValueChange={(v: any) => setFormData({ ...formData, broker: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BROKERS.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Amount</Label>
          <Input
            type="number"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={formData.type} onValueChange={(v: any) => setFormData({ ...formData, type: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Deposit">Deposit</SelectItem>
              <SelectItem value="Withdrawal">Withdrawal</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" variant="outline" className="w-full">Add Ledger Entry</Button>
    </form>
  );
}
