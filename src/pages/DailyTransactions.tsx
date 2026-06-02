import { useMemo, useState } from "react";
import { useStore } from "@/lib/storage";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Receipt, printReceipt } from "@/components/Receipt";
import { fmt, todayKey } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { Printer } from "lucide-react";

export function DailyTransactions() {
  const { transactions, settings } = useStore();
  const [date, setDate] = useState(todayKey());
  const [receipt, setReceipt] = useState<Transaction | null>(null);

  const list = useMemo(
    () => transactions.filter((t) => t.date.slice(0, 10) === date),
    [transactions, date],
  );
  const total = list.reduce((s, t) => s + (t.voided ? 0 : t.total), 0);
  const count = list.filter((t) => !t.voided).length;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Daily Transactions</h2>
          <p className="text-xs text-muted-foreground">{count} sales · {fmt(total, settings.currency)}</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        />
      </div>

      {list.length === 0 && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No transactions for this day.</CardContent></Card>
      )}

      {list.map((t) => (
        <Card key={t.id}>
          <CardContent className="space-y-1 p-3 text-sm">
            <div className="flex justify-between">
              <span className="font-mono text-xs">#{t.id}</span>
              <span className="text-xs text-muted-foreground">{new Date(t.date).toLocaleTimeString()}</span>
            </div>
            <div className="text-xs text-muted-foreground">{t.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}</div>
            <div className="flex items-center justify-between">
              <span className={t.voided ? "text-destructive line-through" : "font-semibold"}>
                {fmt(t.total, settings.currency)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setReceipt(t)}>
                <Printer className="mr-1 h-3 w-3" />Receipt
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Receipt</DialogTitle></DialogHeader>
          <div className="print-area">{receipt && <Receipt tx={receipt} />}</div>
          <DialogFooter>
            <Button onClick={printReceipt}><Printer className="mr-1 h-4 w-4" />Print</Button>
            <Button variant="outline" onClick={() => setReceipt(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
