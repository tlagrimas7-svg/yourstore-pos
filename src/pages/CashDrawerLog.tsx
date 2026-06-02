import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  PlusCircle, MinusCircle, Wallet, ArrowDownRight, ArrowUpRight,
  History, Edit2, Check, X, Sliders, Calendar, CreditCard,
  CloudLightning, CloudOff, Smartphone,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/storage";

interface CashTransaction {
  id: string;
  type: "IN" | "OUT";
  amount: number;
  reason: string;
  logged_time: string;
  created_date: string;
  synced: boolean;
}

const GLOBAL_DEFAULT_BASE = 3000;

// Format peso — full number, no truncation, no ellipsis
function peso(n: number) {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CashDrawerLog() {
  const getTodayISO = () => new Date().toISOString().split("T")[0];

  const [selectedDate, setSelectedDate]   = useState<string>(getTodayISO());
  const [isEditingBase, setIsEditingBase] = useState<boolean>(false);
  const [tempBase, setTempBase]           = useState<string>(String(GLOBAL_DEFAULT_BASE));
  const baseInputRef                      = useRef<HTMLInputElement>(null);

  const [transactions, setTransactions]   = useState<CashTransaction[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [amount, setAmount]     = useState<string>("");
  const [reason, setReason]     = useState<string>("");
  const [txType, setTxType]     = useState<"IN" | "OUT">("IN");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isOnline, setIsOnline]   = useState<boolean>(navigator.onLine);

  const { transactions: storeTransactions } = useStore();

  // ── Network monitor ──────────────────────────────────────────────────────
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online",  on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ── Session + local cache ────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setCurrentUserId(data.user.id);
        const raw = localStorage.getItem(`ysm_cash_drawer_txs_${data.user.id}`);
        if (raw) {
          try { setTransactions(JSON.parse(raw)); } catch {}
        }
      }
    });
  }, []);

  // ── Fetch logs for selected date from Supabase ───────────────────────────
  useEffect(() => {
    const fetchLogs = async () => {
      if (!navigator.onLine || !currentUserId) return;
      try {
        const { data, error } = await supabase
          .from("cash_drawer_logs")
          .select("*")
          .eq("user_id", currentUserId)
          .eq("created_date", selectedDate)
          .order("logged_time", { ascending: false }); // newest first from DB

        if (!error && data) {
          const mapped: CashTransaction[] = data.map((item: any) => ({
            id:           item.id,
            type:         item.type,
            amount:       parseFloat(item.amount),
            reason:       item.reason,
            logged_time:  item.logged_time,
            created_date: item.created_date || selectedDate,
            synced:       true,
          }));

          setTransactions((prev) => {
            const cloudIds         = new Set(mapped.map((m) => m.id));
            const unsyncedToday    = prev.filter((t) => !t.synced && t.created_date === selectedDate && !cloudIds.has(t.id));
            const otherDays        = prev.filter((t) => t.created_date !== selectedDate);
            return [...unsyncedToday, ...mapped, ...otherDays];
          });
        }
      } catch (err) {
        console.error("Failed to fetch drawer logs:", err);
      }
    };
    fetchLogs();
  }, [selectedDate, currentUserId, isOnline]);

  // ── Persist to localStorage ──────────────────────────────────────────────
  useEffect(() => {
    if (currentUserId) {
      localStorage.setItem(`ysm_cash_drawer_txs_${currentUserId}`, JSON.stringify(transactions));
    }
  }, [transactions, currentUserId]);

  // ── Background sync of unsynced rows ────────────────────────────────────
  useEffect(() => {
    const sync = async () => {
      if (!isOnline || !currentUserId || isSyncing) return;
      const unsynced = transactions.filter((t) => !t.synced);
      if (!unsynced.length) return;
      setIsSyncing(true);
      try {
        const payloads = unsynced.map(({ id, type, amount, reason, logged_time, created_date }) => ({
          id, type, amount, reason, logged_time, created_date, user_id: currentUserId,
        }));
        const { error } = await supabase.from("cash_drawer_logs").insert(payloads);
        if (!error) {
          const ids = new Set(unsynced.map((u) => u.id));
          setTransactions((prev) => prev.map((t) => ids.has(t.id) ? { ...t, synced: true } : t));
        }
      } catch (err) {
        console.warn("Sync error, preserved locally:", err);
      } finally {
        setIsSyncing(false);
      }
    };
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, currentUserId]);

  // ── Transactions for selected date, newest first ─────────────────────────
  // Uses actual JS Date for reliable ordering (handles AM/PM vs 24h edge cases)
  const activeDayTransactions = useMemo(() => {
    return [...transactions]
      .filter((t) => t.created_date === selectedDate)
      .sort((a, b) => {
        // Parse logged_time strings into comparable values
        const parseTime = (t: string) => {
          const d = new Date(`1970-01-01 ${t}`);
          return isNaN(d.getTime()) ? 0 : d.getTime();
        };
        return parseTime(b.logged_time) - parseTime(a.logged_time);
      });
  }, [transactions, selectedDate]);

  // ── POS sales for selected date ──────────────────────────────────────────
  const selectedDayCashSales = useMemo(() => {
    return storeTransactions
      .filter((t) => {
        if (t.voided) return false;
        const d = new Date(t.date).toISOString().split("T")[0];
        if (d !== selectedDate) return false;
        const m = (t as any).paymentMethod?.toUpperCase() ?? "CASH";
        return m === "CASH";
      })
      .reduce((s, t) => s + t.total, 0);
  }, [storeTransactions, selectedDate]);

  const selectedDayEWalletSales = useMemo(() => {
    return storeTransactions
      .filter((t) => {
        if (t.voided) return false;
        const d = new Date(t.date).toISOString().split("T")[0];
        if (d !== selectedDate) return false;
        const m = (t as any).paymentMethod?.toUpperCase();
        return m && m !== "CASH";
      })
      .reduce((s, t) => s + t.total, 0);
  }, [storeTransactions, selectedDate]);

  // ── Drawer totals: base = most recent BASE_EDIT only ────────────────────
  const drawerTotals = useMemo(() => {
    // activeDayTransactions is newest-first; first BASE_EDIT found = most recent
    let computedBaseFloat = GLOBAL_DEFAULT_BASE;
    for (const tx of activeDayTransactions) {
      if (tx.reason.startsWith("[BASE_EDIT]")) {
        const m = tx.reason.match(/to ₱([\d,.]+)/);
        if (m?.[1]) {
          computedBaseFloat = parseFloat(m[1].replace(/,/g, ""));
          break;
        }
      }
    }

    // Only regular (non-base-edit) rows affect in/out totals
    const regularTxs = activeDayTransactions.filter(
      (t) => !t.reason.startsWith("[BASE_EDIT]")
    );
    const totalIn  = regularTxs.filter((t) => t.type === "IN") .reduce((s, t) => s + t.amount, 0);
    const totalOut = regularTxs.filter((t) => t.type === "OUT").reduce((s, t) => s + t.amount, 0);
    const expectedCurrent = computedBaseFloat + selectedDayCashSales + totalIn - totalOut;

    return { totalIn, totalOut, expectedCurrent, computedBaseFloat };
  }, [activeDayTransactions, selectedDayCashSales]);

  // Sync tempBase display when NOT editing
  useEffect(() => {
    if (!isEditingBase) {
      setTempBase(String(drawerTotals.computedBaseFloat));
    }
  }, [drawerTotals.computedBaseFloat, isEditingBase]);

  // Auto-focus base input
  useEffect(() => {
    if (isEditingBase) {
      setTimeout(() => {
        baseInputRef.current?.focus();
        baseInputRef.current?.select();
      }, 60);
    }
  }, [isEditingBase]);

  // ── Save base float ──────────────────────────────────────────────────────
  const saveBaseFloat = async () => {
    const parsed = parseFloat(tempBase);
    if (isNaN(parsed) || parsed < 0) {
      cancelBaseEdit();
      return;
    }

    const activeBase = drawerTotals.computedBaseFloat;

    if (parsed !== activeBase && currentUserId) {
      const now = new Date();
      const formattedTime = now.toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      });
      const dateLabel = new Date(selectedDate + "T12:00:00").toLocaleDateString([], {
        month: "short", day: "numeric",
      });

      const baseEditTx: CashTransaction = {
        id:           crypto.randomUUID(),
        type:         parsed > activeBase ? "IN" : "OUT",
        amount:       Math.abs(parsed - activeBase),
        reason:       `[BASE_EDIT] Base float configured from ₱${activeBase.toLocaleString()} to ₱${parsed.toLocaleString()} on ${dateLabel}`,
        logged_time:  formattedTime,
        created_date: selectedDate,
        synced:       false,
      };

      // Add optimistically — prepend so it's first (most recent)
      setTransactions((prev) => [baseEditTx, ...prev]);

      if (navigator.onLine) {
        try {
          const { error } = await supabase.from("cash_drawer_logs").insert([{
            id:           baseEditTx.id,
            type:         baseEditTx.type,
            amount:       baseEditTx.amount,
            reason:       baseEditTx.reason,
            logged_time:  baseEditTx.logged_time,
            created_date: baseEditTx.created_date,
            user_id:      currentUserId,
          }]);
          if (!error) {
            setTransactions((prev) =>
              prev.map((t) => t.id === baseEditTx.id ? { ...t, synced: true } : t)
            );
          }
        } catch (err) {
          console.error("Failed to sync base edit:", err);
        }
      }
    }

    setIsEditingBase(false);
  };

  const cancelBaseEdit = () => {
    setIsEditingBase(false);
    setTempBase(String(drawerTotals.computedBaseFloat));
  };

  // ── Log manual drawer event ──────────────────────────────────────────────
  const handleLogTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserId) return;
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0 || !reason.trim()) return;

    const formattedTime = new Date().toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });

    const newTx: CashTransaction = {
      id:           crypto.randomUUID(),
      type:         txType,
      amount:       parsedAmount,
      reason:       reason.trim(),
      logged_time:  formattedTime,
      created_date: selectedDate,
      synced:       false,
    };

    setTransactions((prev) => [newTx, ...prev]);
    setAmount("");
    setReason("");

    if (navigator.onLine) {
      try {
        const { error } = await supabase.from("cash_drawer_logs").insert([{
          id:           newTx.id,
          type:         newTx.type,
          amount:       newTx.amount,
          reason:       newTx.reason,
          logged_time:  newTx.logged_time,
          created_date: newTx.created_date,
          user_id:      currentUserId,
        }]);
        if (!error) {
          setTransactions((prev) =>
            prev.map((t) => t.id === newTx.id ? { ...t, synced: true } : t)
          );
        }
      } catch (err) {
        console.error("Transaction log error:", err);
      }
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-6 text-slate-100 min-h-screen pb-24">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/60 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight text-white">Cash Drawer Audit</h1>
            {isOnline ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                <CloudLightning className="h-2.5 w-2.5" /> Live Sync
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 font-medium">
                <CloudOff className="h-2.5 w-2.5" /> Offline Mode
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Real-time verification metrics and isolated transaction registers.</p>
        </div>
        <div className="flex items-center gap-3 bg-[#121824] border border-slate-800 rounded-xl px-3 py-1.5 shadow-inner">
          <Calendar className="h-4 w-4 text-amber-400 shrink-0" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent border-none text-xs font-bold text-white focus:outline-none cursor-pointer"
          />
        </div>
      </div>

      {/* ── Metric Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">

        {/* Expected Cash — NO truncate, responsive font size */}
        <div className="bg-[#121824] border border-slate-800/80 p-4 rounded-xl shadow-md col-span-2 md:col-span-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-[9px] text-amber-400 font-bold uppercase tracking-wider">Expected Cash</p>
              {/* KEY FIX: break-all so long numbers wrap instead of truncating */}
              <h2 className="text-lg font-black text-white mt-1 break-all leading-tight">
                {peso(drawerTotals.expectedCurrent)}
              </h2>

              {/* Base editor */}
              {isEditingBase ? (
                <div className="flex items-center gap-1 mt-2">
                  <input
                    ref={baseInputRef}
                    type="number"
                    inputMode="decimal"
                    value={tempBase}
                    onChange={(e) => setTempBase(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")  saveBaseFloat();
                      if (e.key === "Escape") cancelBaseEdit();
                    }}
                    className="w-24 bg-[#090d16] border border-amber-500/50 rounded px-1.5 py-0.5 text-[12px] font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                  <button type="button" onClick={saveBaseFloat}
                    className="p-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded hover:bg-emerald-500/20 transition-colors">
                    <Check className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={cancelBaseEdit}
                    className="p-1 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded hover:bg-rose-500/20 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setTempBase(String(drawerTotals.computedBaseFloat));
                    setIsEditingBase(true);
                  }}
                  className="mt-1.5 text-[9px] text-slate-500 hover:text-amber-400 flex items-center gap-0.5 transition-colors select-none"
                >
                  <span>Base: ₱{drawerTotals.computedBaseFloat.toLocaleString()}</span>
                  <Edit2 className="h-2 w-2 ml-0.5" />
                </button>
              )}
            </div>
            <div className="p-2 bg-slate-800/40 rounded-lg border border-slate-700/40 text-amber-400 shrink-0 mt-0.5">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Cash Sales */}
        <MetricCard
          label="Cash Sales"
          value={peso(selectedDayCashSales)}
          sub="Added to drawer"
          color="emerald"
          icon={<ArrowUpRight className="h-4 w-4" />}
        />

        {/* GCash / Maya */}
        <MetricCard
          label="GCash / Maya"
          value={peso(selectedDayEWalletSales)}
          sub="Bypasses drawer"
          color="purple"
          icon={<CreditCard className="h-4 w-4" />}
        />

        {/* Manual Cash In */}
        <MetricCard
          label="Manual Cash In"
          value={peso(drawerTotals.totalIn)}
          sub="Added manually"
          color="emerald"
          icon={<ArrowUpRight className="h-4 w-4" />}
        />

        {/* Manual Payouts */}
        <MetricCard
          label="Manual Payouts"
          value={peso(drawerTotals.totalOut)}
          sub="Pulled from cash"
          color="rose"
          icon={<ArrowDownRight className="h-4 w-4" />}
        />
      </div>

      {/* ── Operational Panel ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">

        {/* Log Form */}
        <form
          onSubmit={handleLogTransaction}
          className="bg-[#121824] border border-slate-800/80 p-5 rounded-xl shadow-md space-y-4 md:col-span-1"
        >
          <h3 className="text-sm font-bold text-white tracking-wide">Log Drawer Shift Event</h3>

          <div className="grid grid-cols-2 gap-1 bg-[#090d16] p-1 rounded-lg border border-slate-800/60">
            <button type="button" onClick={() => setTxType("IN")}
              className={`py-1.5 rounded-md font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                txType === "IN"
                  ? "bg-[#121824] border border-slate-700 text-emerald-400"
                  : "text-slate-400 hover:text-slate-200"
              }`}>
              <PlusCircle className="h-3.5 w-3.5" />Cash In
            </button>
            <button type="button" onClick={() => setTxType("OUT")}
              className={`py-1.5 rounded-md font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                txType === "OUT"
                  ? "bg-[#121824] border border-slate-700 text-rose-400"
                  : "text-slate-400 hover:text-slate-200"
              }`}>
              <MinusCircle className="h-3.5 w-3.5" />Cash Out
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">Amount (₱)</label>
            <input type="number" inputMode="decimal" step="any" required
              value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className="w-full bg-[#090d16] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-slate-600 placeholder:text-slate-600" />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">Reason / Description</label>
            <input type="text" required
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Change purchase, payout"
              className="w-full bg-[#090d16] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-slate-600 placeholder:text-slate-600" />
          </div>

          <button type="submit"
            className={`w-full py-2.5 rounded-lg font-bold text-white text-xs tracking-wide transition-all ${
              txType === "IN" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
            }`}>
            Record {txType === "IN" ? "Cash In" : "Cash Out"}
          </button>
        </form>

        {/* Timeline */}
        <div className="bg-[#121824] border border-slate-800/80 rounded-xl shadow-md md:col-span-2 overflow-hidden">
          <div className="p-4 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/20">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-bold tracking-wide text-white">Timeline Log Activity</h3>
            </div>
            <span className="text-[10px] bg-[#090d16] border border-slate-800 px-2.5 py-1 rounded-full text-slate-400 font-bold">
              {activeDayTransactions.length} items
            </span>
          </div>

          <div className="divide-y divide-slate-800/60 max-h-[380px] overflow-y-auto">
            {activeDayTransactions.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs tracking-wide">
                No shift modifications logged for this date.
              </div>
            ) : (
              activeDayTransactions.map((tx) => {
                const isBaseEdit = tx.reason.startsWith("[BASE_EDIT]");
                const isLoad     = tx.reason.startsWith("[DIGITAL_LOAD]");
                const isGcashIn  = tx.reason.startsWith("[DIGITAL_CASH_IN]");
                const isGcashOut = tx.reason.startsWith("[DIGITAL_CASH_OUT]");

                let displayReason = tx.reason
                  .replace(/\[BASE_EDIT\]\s*/,        "")
                  .replace(/\[DIGITAL_LOAD\]\s*/,     "")
                  .replace(/\[DIGITAL_CASH_IN\]\s*/,  "")
                  .replace(/\[DIGITAL_CASH_OUT\]\s*/, "");

                const iconColor = isBaseEdit
                  ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                  : isLoad
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                    : isGcashIn
                      ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                      : isGcashOut
                        ? "bg-pink-500/10 text-pink-400 border-pink-500/20"
                        : tx.type === "IN"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-400 border-rose-500/20";

                const amtColor = isBaseEdit ? "text-sky-400"
                  : isLoad ? "text-blue-400"
                  : isGcashIn ? "text-purple-400"
                  : isGcashOut ? "text-pink-400"
                  : tx.type === "IN" ? "text-emerald-400"
                  : "text-rose-400";

                return (
                  <div key={tx.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-900/20 transition-colors">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`p-1.5 rounded-lg mt-0.5 border shrink-0 ${iconColor}`}>
                        {isBaseEdit ? <Sliders className="h-3.5 w-3.5" />
                          : (isLoad || isGcashIn || isGcashOut) ? <Smartphone className="h-3.5 w-3.5" />
                          : tx.type === "IN" ? <ArrowUpRight className="h-3.5 w-3.5" />
                          : <ArrowDownRight className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="font-semibold text-sm text-slate-200 leading-tight">{displayReason}</p>
                          {isBaseEdit  && <TxBadge color="sky"    label="Base Adjustment" />}
                          {isLoad      && <TxBadge color="blue"   label="E-Load" />}
                          {isGcashIn   && <TxBadge color="purple" label="GCash Cash-In" />}
                          {isGcashOut  && <TxBadge color="pink"   label="GCash Cash-Out" />}
                          {!tx.synced  && <TxBadge color="amber"  label="Local Queue" />}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{tx.logged_time}</p>
                      </div>
                    </div>
                    <span className={`font-bold text-sm shrink-0 ${amtColor}`}>
                      {isBaseEdit ? "Mod" : tx.type === "IN" ? "+" : "−"} {peso(tx.amount)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Metric card helper ────────────────────────────────────────────────────────
function MetricCard({
  label, value, sub, color, icon,
}: {
  label: string; value: string; sub: string;
  color: "emerald" | "purple" | "rose";
  icon: React.ReactNode;
}) {
  const colorMap = {
    emerald: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    purple:  { text: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/20" },
    rose:    { text: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/20" },
  };
  const c = colorMap[color];
  return (
    <div className="bg-[#121824] border border-slate-800/80 p-4 rounded-xl flex items-center justify-between shadow-md">
      <div className="min-w-0">
        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{label}</p>
        <h3 className={`text-xl font-bold mt-1 break-all leading-tight ${c.text}`}>{value}</h3>
        <p className="text-[8px] text-slate-500 mt-1">{sub}</p>
      </div>
      <div className={`p-2 rounded-lg border shrink-0 ml-2 ${c.bg} ${c.border} ${c.text}`}>
        {icon}
      </div>
    </div>
  );
}

// ── Badge helper ──────────────────────────────────────────────────────────────
function TxBadge({ color, label }: { color: string; label: string }) {
  const map: Record<string, string> = {
    sky:    "bg-sky-500/20 text-sky-300 border-sky-500/30",
    blue:   "bg-blue-500/20 text-blue-300 border-blue-500/30",
    purple: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    pink:   "bg-pink-500/20 text-pink-300 border-pink-500/30",
    amber:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide border ${map[color] ?? ""}`}>
      {label}
    </span>
  );
}
