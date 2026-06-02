import { useMemo, useState } from "react";
import { useStore } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fmt, isSameMonth } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, Legend } from "recharts";
import { Printer } from "lucide-react";

const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

export function Summary() {
  const { transactions, expenses, utang, products, settings } = useStore();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [year, m] = month.split("-").map(Number);
  const monthIndex = m - 1;

  const data = useMemo(() => {
    const tx = transactions.filter((t) => !t.voided && isSameMonth(t.date, year, monthIndex));
    const exp = expenses.filter((e) => isSameMonth(e.date, year, monthIndex));
    const totalSales = tx.reduce((s, t) => s + t.total, 0);
    const totalCOGS = tx.reduce((s, t) => s + t.items.reduce((a, i) => a + i.cost * i.qty, 0), 0);
    const totalExp = exp.reduce((s, e) => s + e.amount, 0);
    const net = totalSales - totalCOGS - totalExp;

    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const daily = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, sales: 0 }));
    tx.forEach((t) => {
      const d = new Date(t.date).getDate();
      daily[d - 1].sales += t.total;
    });

    const catMap = new Map<string, number>();
    tx.forEach((t) => t.items.forEach((i) => {
      const cat = products.find((p) => p.id === i.productId)?.category || "Uncategorized";
      catMap.set(cat, (catMap.get(cat) ?? 0) + i.qty * i.price);
    }));
    const byCategory = [...catMap.entries()].map(([name, value]) => ({ name, value }));

    const expMap = new Map<string, number>();
    exp.forEach((e) => expMap.set(e.category, (expMap.get(e.category) ?? 0) + e.amount));
    const expByCategory = [...expMap.entries()].map(([name, value]) => ({ name, value }));

    const utangCollected = utang
      .flatMap((u) => u.payments)
      .filter((p) => isSameMonth(p.date, year, monthIndex))
      .reduce((s, p) => s + p.amount, 0);

    return { totalSales, totalCOGS, totalExp, net, daily, byCategory, expByCategory, utangCollected };
  }, [transactions, expenses, utang, products, year, monthIndex]);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <Button variant="outline" size="icon" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Sales</CardTitle></CardHeader><CardContent className="text-xl font-bold">{fmt(data.totalSales, settings.currency)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Expenses</CardTitle></CardHeader><CardContent className="text-xl font-bold">{fmt(data.totalExp, settings.currency)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">COGS</CardTitle></CardHeader><CardContent className="text-xl font-bold">{fmt(data.totalCOGS, settings.currency)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Net Profit</CardTitle></CardHeader><CardContent className={`text-xl font-bold ${data.net >= 0 ? "" : "text-destructive"}`}>{fmt(data.net, settings.currency)}</CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Daily Sales</CardTitle></CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily}>
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="sales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Sales by Category</CardTitle></CardHeader>
        <CardContent className="h-56">
          {data.byCategory.length === 0 ? <p className="text-sm text-muted-foreground">No sales.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.byCategory} dataKey="value" nameKey="name" outerRadius={70} label>
                  {data.byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Expenses by Category</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {data.expByCategory.length === 0 && <p className="text-sm text-muted-foreground">No expenses.</p>}
          {data.expByCategory.map((c) => (
            <div key={c.name} className="flex justify-between text-sm"><span>{c.name}</span><span>{fmt(c.value, settings.currency)}</span></div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Utang Collected</CardTitle></CardHeader>
        <CardContent className="text-xl font-bold">{fmt(data.utangCollected, settings.currency)}</CardContent>
      </Card>
    </div>
  );
}