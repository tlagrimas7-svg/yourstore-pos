import { useState } from "react";
import { useStore, uid } from "@/lib/storage";
import type { UtangRecord } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { fmt } from "@/lib/format";
import { toast } from "sonner";
import {
  Plus, Phone, Mail, Calendar, Clock,
  ChevronDown, ChevronUp, CheckCircle2, AlertCircle,
} from "lucide-react";

const blank = (): Omit<UtangRecord, "id"> => ({
  customer: "",
  date: new Date().toISOString(),
  items: "",
  amount: 0,
  payments: [],
  promiseDate: "",
  contact: "",
  email: "",
  notes: "",
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isOverdue(promiseDate?: string) {
  if (!promiseDate) return false;
  return new Date(promiseDate) < new Date();
}

function daysUntil(promiseDate: string) {
  const diff = new Date(promiseDate).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d left`;
}

export function Utang() {
  const { utang, setUtang, settings } = useStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(blank());
  const [editId, setEditId] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<UtangRecord | null>(null);
  const [payAmt, setPayAmt] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "outstanding" | "paid">("outstanding");

  const total = utang.reduce((s, u) => {
    const paid = u.payments.reduce((a, p) => a + p.amount, 0);
    return s + Math.max(0, u.amount - paid);
  }, 0);

  const overdue = utang.filter((u) => {
    const balance = u.amount - u.payments.reduce((a, p) => a + p.amount, 0);
    return balance > 0 && isOverdue(u.promiseDate);
  }).length;

  const filtered = utang.filter((u) => {
    const balance = u.amount - u.payments.reduce((a, p) => a + p.amount, 0);
    if (filter === "outstanding") return balance > 0;
    if (filter === "paid") return balance <= 0;
    return true;
  });

  const openNew = () => {
    setDraft(blank());
    setEditId(null);
    setOpen(true);
  };

  const openEdit = (u: UtangRecord) => {
    setDraft({
      customer: u.customer, date: u.date, items: u.items,
      amount: u.amount, payments: u.payments,
      promiseDate: u.promiseDate ?? "",
      contact: u.contact ?? "",
      email: u.email ?? "",
      notes: u.notes ?? "",
    });
    setEditId(u.id);
    setOpen(true);
  };

  const save = () => {
    if (!draft.customer.trim()) return toast.error("Customer name required");
    if (!draft.amount) return toast.error("Amount required");

    if (editId) {
      setUtang(utang.map((u) => u.id === editId ? { ...u, ...draft } : u));
      toast.success("Updated");
    } else {
      const record: UtangRecord = {
        ...draft,
        id: uid(),
        date: new Date().toISOString(),
      };
      setUtang([record, ...utang]);
      toast.success("Utang added");
    }
    setOpen(false);
  };

  const pay = () => {
    if (!payFor || !payAmt) return;
    setUtang(utang.map((u) =>
      u.id === payFor.id
        ? { ...u, payments: [...u.payments, { id: uid(), date: new Date().toISOString(), amount: payAmt }] }
        : u
    ));
    setPayFor(null);
    setPayAmt(0);
    toast.success("Payment recorded");
  };

  return (
    <div className="space-y-3 p-4">

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Outstanding</div>
            <div className="text-2xl font-bold text-destructive">{fmt(total, settings.currency)}</div>
          </CardContent>
        </Card>
        <Card className={overdue > 0 ? "border-orange-500/50" : ""}>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Overdue</div>
            <div className={`text-2xl font-bold ${overdue > 0 ? "text-orange-500" : ""}`}>{overdue}</div>
          </CardContent>
        </Card>
      </div>

      {/* ── Actions ── */}
      <Button onClick={openNew} className="w-full">
        <Plus className="mr-1 h-4 w-4" />New Utang
      </Button>

      {/* ── Filter tabs ── */}
      <div className="flex rounded-lg border p-0.5 gap-0.5">
        {(["outstanding", "paid", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium capitalize transition-colors
              ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {f}
          </button>
        ))}
      </div>

      {/* ── Utang list ── */}
      {filtered.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">No records found.</p>
      )}

      {filtered.map((u) => {
        const paid = u.payments.reduce((a, p) => a + p.amount, 0);
        const balance = u.amount - paid;
        const overduePast = balance > 0 && isOverdue(u.promiseDate);
        const isExpanded = expanded === u.id;

        return (
          <Card key={u.id} className={overduePast ? "border-orange-500/40" : ""}>
            <CardContent className="p-3 space-y-2">
              {/* ── Top row ── */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{u.customer}</span>
                    {balance <= 0
                      ? <Badge variant="secondary" className="text-[10px] text-green-500 border-green-500/30">Paid</Badge>
                      : overduePast
                        ? <Badge variant="outline" className="text-[10px] text-orange-500 border-orange-500/30">Overdue</Badge>
                        : null}
                  </div>
                  {/* Timestamp */}
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                    <Clock className="h-3 w-3" />
                    <span>{formatDate(u.date)} {formatTime(u.date)}</span>
                  </div>
                </div>
                <Badge variant={balance > 0 ? "destructive" : "secondary"} className="shrink-0">
                  {fmt(balance, settings.currency)}
                </Badge>
              </div>

              {/* ── Items ── */}
              {u.items && (
                <p className="text-xs text-muted-foreground">{u.items}</p>
              )}

              {/* ── Info pills ── */}
              <div className="flex flex-wrap gap-2">
                {u.promiseDate && (
                  <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium
                    ${overduePast
                      ? "bg-orange-500/15 text-orange-400"
                      : "bg-muted text-muted-foreground"}`}>
                    <Calendar className="h-3 w-3" />
                    <span>{formatDate(u.promiseDate)} · {daysUntil(u.promiseDate)}</span>
                  </div>
                )}
                {u.contact && (
                  <a href={`tel:${u.contact}`}
                    className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                    <Phone className="h-3 w-3" />
                    {u.contact}
                  </a>
                )}
                {u.email && (
                  <a href={`mailto:${u.email}`}
                    className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                    <Mail className="h-3 w-3" />
                    {u.email}
                  </a>
                )}
              </div>

              {/* ── Amount summary ── */}
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>Total: {fmt(u.amount, settings.currency)}</span>
                <span>Paid: {fmt(paid, settings.currency)}</span>
              </div>

              {/* ── Expand: payment history ── */}
              {u.payments.length > 0 && (
                <button
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded(isExpanded ? null : u.id)}>
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {u.payments.length} payment{u.payments.length !== 1 ? "s" : ""}
                </button>
              )}

              {isExpanded && (
                <div className="border-t pt-2 space-y-1">
                  {u.payments.map((p) => (
                    <div key={p.id} className="flex justify-between text-xs">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        <span>{formatDate(p.date)} {formatTime(p.date)}</span>
                      </div>
                      <span className="font-medium text-green-500">+{fmt(p.amount, settings.currency)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Actions ── */}
              <div className="flex gap-2 pt-1">
                {balance > 0 && (
                  <Button size="sm" variant="outline" className="flex-1"
                    onClick={() => { setPayFor(u); setPayAmt(balance); }}>
                    Record Payment
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="flex-1"
                  onClick={() => openEdit(u)}>
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* ── Add / Edit dialog ── */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Utang" : "New Utang"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Customer Name *</Label>
              <Input placeholder="e.g. Juan dela Cruz"
                value={draft.customer} onChange={(e) => setDraft({ ...draft, customer: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>Items / Description</Label>
              <Textarea placeholder="What did they take?"
                value={draft.items} onChange={(e) => setDraft({ ...draft, items: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>Amount *</Label>
              <Input type="number" min={0} placeholder="0.00"
                value={draft.amount || ""}
                onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} />
            </div>

            <div className="space-y-1">
              <Label className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />Promise Date
              </Label>
              <Input type="date"
                value={draft.promiseDate ? draft.promiseDate.slice(0, 10) : ""}
                onChange={(e) => setDraft({ ...draft, promiseDate: e.target.value ? new Date(e.target.value).toISOString() : "" })} />
            </div>

            <div className="space-y-1">
              <Label className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />Contact Number
              </Label>
              <Input type="tel" placeholder="09XXXXXXXXX"
                value={draft.contact ?? ""}
                onChange={(e) => setDraft({ ...draft, contact: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label className="flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />Email
              </Label>
              <Input type="email" placeholder="juan@email.com"
                value={draft.email ?? ""}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea placeholder="Any additional notes…"
                value={draft.notes ?? ""}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Payment dialog ── */}
      <Dialog open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          {payFor && (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-semibold">{payFor.customer}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Balance: {fmt(payFor.amount - payFor.payments.reduce((a, p) => a + p.amount, 0), settings.currency)}
                </p>
              </div>
              <div className="space-y-1">
                <Label>Payment Amount</Label>
                <Input type="number" min={0} value={payAmt || ""}
                  onChange={(e) => setPayAmt(Number(e.target.value))} autoFocus />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
            <Button onClick={pay}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
