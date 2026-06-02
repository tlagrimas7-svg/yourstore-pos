import { useState } from "react";
import { useStore } from "@/lib/storage";
import { fmt, isSameDay } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, User, TrendingUp, Package, ChevronDown, ChevronUp } from "lucide-react";
import type { Shift } from "@/lib/types";

function duration(start: string, end?: string) {
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmt_time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmt_date(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function ShiftLog() {
  const shifts: Shift[] = useStore((s) => (s as any).shifts ?? []);
  const settings = useStore((s) => s.settings);
  const [selected, setSelected] = useState<Shift | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const completed = shifts.filter((s) => s.timeOut).sort(
    (a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime()
  );
  const active = shifts.filter((s) => !s.timeOut);

  const ShiftCard = ({ shift, highlight }: { shift: Shift; highlight?: boolean }) => {
    const isExpanded = expanded === shift.id;
    const itemSales = shift.itemSales ?? {};
    const itemEntries = Object.entries(itemSales);

    return (
      <Card
        className={`cursor-pointer transition-all ${highlight ? "border-primary" : ""}`}
        onClick={() => setSelected(shift)}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="h-4 w-4" />
              </div>
              <div>
                <p className="font-semibold text-sm">{shift.employeeName}</p>
                <p className="text-xs text-muted-foreground">{fmt_date(shift.timeIn)}</p>
              </div>
            </div>
            {!shift.timeOut ? (
              <Badge variant="default" className="text-xs">Active</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">{duration(shift.timeIn, shift.timeOut)}</Badge>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-muted/50 p-2">
              <p className="text-xs text-muted-foreground">Time In</p>
              <p className="text-sm font-medium">{fmt_time(shift.timeIn)}</p>
            </div>
            <div className="rounded-md bg-muted/50 p-2">
              <p className="text-xs text-muted-foreground">Time Out</p>
              <p className="text-sm font-medium">{shift.timeOut ? fmt_time(shift.timeOut) : "—"}</p>
            </div>
            <div className="rounded-md bg-primary/10 p-2">
              <p className="text-xs text-muted-foreground">Sales</p>
              <p className="text-sm font-bold text-primary">{fmt(shift.totalSales ?? 0, settings.currency)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {shift.transactionCount ?? 0} transactions
            </span>
            {itemEntries.length > 0 && (
              <button
                className="flex items-center gap-1 hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(isExpanded ? null : shift.id);
                }}
              >
                <Package className="h-3 w-3" />
                {itemEntries.length} items
                {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
          </div>

          {isExpanded && itemEntries.length > 0 && (
            <div
              className="border-t pt-2 space-y-1"
              onClick={(e) => e.stopPropagation()}
            >
              {itemEntries
                .sort((a, b) => b[1] - a[1])
                .map(([name, qty]) => (
                  <div key={name} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{name}</span>
                    <Badge variant="outline" className="text-xs h-5">{qty} sold</Badge>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Shift History</h2>
      </div>

      {active.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Active Shifts</p>
          {active.map((s) => <ShiftCard key={s.id} shift={s} highlight />)}
        </div>
      )}

      {completed.length === 0 && active.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No shifts recorded yet.</p>
            <p className="text-xs mt-1">Shifts appear when employees clock in.</p>
          </CardContent>
        </Card>
      )}

      {completed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Completed Shifts</p>
          {completed.map((s) => <ShiftCard key={s.id} shift={s} />)}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-4 w-4" />
              {selected?.employeeName} — Shift Detail
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Date</p>
                  <p className="text-sm font-medium">{fmt_date(selected.timeIn)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Duration</p>
                  <p className="text-sm font-medium">{duration(selected.timeIn, selected.timeOut)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Clock In</p>
                  <p className="text-sm font-medium">{fmt_time(selected.timeIn)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Clock Out</p>
                  <p className="text-sm font-medium">{selected.timeOut ? fmt_time(selected.timeOut) : "Still active"}</p>
                </div>
              </div>

              <div className="rounded-lg bg-primary/10 p-3 flex justify-between items-center">
                <div>
                  <p className="text-xs text-muted-foreground">Total Sales</p>
                  <p className="text-xl font-bold text-primary">{fmt(selected.totalSales ?? 0, settings.currency)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Transactions</p>
                  <p className="text-xl font-bold">{selected.transactionCount ?? 0}</p>
                </div>
              </div>

              {Object.keys(selected.itemSales ?? {}).length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Items Sold</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {Object.entries(selected.itemSales ?? {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, qty]) => (
                        <div key={name} className="flex justify-between items-center py-1 border-b last:border-0">
                          <span className="text-sm">{name}</span>
                          <Badge variant="secondary">{qty} sold</Badge>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ShiftLog;
