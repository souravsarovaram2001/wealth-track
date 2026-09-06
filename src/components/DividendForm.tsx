import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dividend } from '@/src/types';

interface DividendFormProps {
  onSubmit: (dividend: Omit<Dividend, 'id'>) => void;
}

export function DividendForm({ onSubmit }: DividendFormProps) {
  const [formData, setFormData] = useState({
    stockName: '',
    month: new Date().toISOString().slice(0, 7), // YYYY-MM
    amount: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(formData.amount);
    if (isNaN(amount)) return;

    onSubmit({
      stockName: formData.stockName,
      month: formData.month,
      amount,
    });

    setFormData({
      stockName: '',
      month: new Date().toISOString().slice(0, 7),
      amount: '',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-lg bg-card mt-6">
      <h3 className="font-semibold">Add Dividend</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Stock Name</Label>
          <Input
            value={formData.stockName}
            onChange={(e) => setFormData({ ...formData, stockName: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Month</Label>
          <Input
            type="month"
            value={formData.month}
            onChange={(e) => setFormData({ ...formData, month: e.target.value })}
            required
          />
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
      </div>
      <Button type="submit" variant="outline" className="w-full">Add Dividend</Button>
    </form>
  );
}
