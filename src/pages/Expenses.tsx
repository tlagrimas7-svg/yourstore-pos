import { useState } from "react";
import { useStore, uid } from "@/lib/storage";
import type { Expense } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmt, isSameMonth } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export function Expenses() {
  const { expenses, setExpenses, settings } = useStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Expense>({ id: "", date: new Date().toISOString().slice(0, 10), category: settings.expenseCategories[0] ?? "Other", amount: 0, notes: "" });

  const now = new Date();
  const monthTotal = expenses
    .filter((e) => isSameMonth(e.date, now.getFullYear(), now.getMonth()))
    .reduce((s, e) => s + e.amount, 0);

  const save = () => {
    if (!draft.amount) return toast.error("Amount required");
    setExpenses([{ ...draft, id: uid(), date: new Date(draft.date).toISOString() }, ...expenses]);
    toast.success("Expense added");
    setOpen(false);
    setDraft({ id: "", date: new Date().toISOString().slice(0, 10), category: settings.expenseCategories[0] ?? "Other", amount: 0, notes: "" });
  };

  return (
    <div className="space-y-3 p-4">
      <Card>
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground">This Month</div>
          <div className="text-2xl font-bold">{fmt(monthTotal, settings.currency)}</div>
        </CardContent>
      </Card>
      <Button onClick={() => setOpen(true)} className="w-full"><Plus className="mr-1 h-4 w-4" />Add Expense</Button>
      {expenses.map((e) => (
        <Card key={e.id}>
          <CardContent className="flex items-center gap-2 p-3">
            <div className="flex-1">
              <div className="text-sm font-medium">{e.category} · {fmt(e.amount, settings.currency)}</div>
              <div className="text-xs text-muted-foreground">{new Date(e.date).toLocaleDateString()} {e.notes ? `· ${e.notes}` : ""}</div>
            </div>
            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setExpenses(expenses.filter((x) => x.id !== e.id))}><Trash2 className="h-4 w-4" /></Button>
          </CardContent>
        </Card>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={draft.date.slice(0, 10)} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{settings.expenseCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Amount</Label><Input type="number" value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label>Notes</Label><Textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}