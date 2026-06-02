import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { Html5Qrcode } from "html5-qrcode";
import { useStore, uid, sbAddTransaction } from "@/lib/storage";
import { blePrinter, bleScanner } from "@/lib/bluetooth";
import { buildReceipt } from "@/lib/escpos";
import type { CartItem, Transaction } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Receipt, printReceipt } from "@/components/Receipt";
import { OwnerPinPrompt } from "@/components/PinPrompt";
import { VoiceCashier } from "@/components/VoiceCashier";
import { fmt } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, Plus, Minus, Printer, ListChecks, Bluetooth, Flashlight, FlashlightOff, Wallet, Smartphone, CreditCard, Zap, Search, Loader2, Package } from "lucide-react";
import { useSession } from "@/App";
import { getNextTransactionNumber } from "@/lib/transactionNumber";

const SCANNER_DIV_ID = "pos-qr-scanner";
const TXN_HISTORY_KEY = "ysm_txn_history";

let audioCtx: AudioContext | null = null;
function beep(found: boolean) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx;
    // iOS Safari starts contexts in 'suspended' state — resume on user gesture
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const play = (freq: number, startTime: number, duration: number, gain: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode); gainNode.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, startTime);
      gainNode.gain.setValueAtTime(gain, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.start(startTime); osc.stop(startTime + duration);
    };
    if (found) { play(1900, ctx.currentTime, 0.18, 1.0); }
    else { play(320, ctx.currentTime, 0.12, 0.8); play(280, ctx.currentTime + 0.15, 0.18, 0.8); }
    if (navigator.vibrate) { try { navigator.vibrate(found ? 40 : [40, 60, 80]); } catch {} }
  } catch {}
}

export function POS() {
  const {
    products, transactions, settings, userId,
    setProducts, setTransactions, addAntiKupit,
    posCart, setPosCart, addTransactionToShift,
  } = useStore();

  const access = useSession((s) => s.access);
  const plan = (access as any)?.plan ?? "free";

  const activeShift = useStore((s) => s.activeShift);
  const isEmployeeMode = !!activeShift;

  const [search, setSearch]       = useState("");
  const [discount, setDiscount]   = useState({ type: "amount" as "amount" | "percent", value: 0 });
  const [paid, setPaid]           = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "GCASH" | "MAYA" | "CARD">("CASH");
  const [activeTab, setActiveTab] = useState<"scan" | "quick">("scan");

  const [digitalOpen, setDigitalOpen] = useState(false);
  const [digType, setDigType] = useState<"ELOAD" | "CASH_IN" | "CASH_OUT">("ELOAD");
  const [digAmount, setDigAmount] = useState("");
  const [digPatong, setDigPatong] = useState("3");
  const [digRef, setDigRef] = useState("");
  const [digSubmitting, setDigSubmitting] = useState(false);

  const [showReceipt, setShowReceipt]   = useState<Transaction | null>(null);
  const [voidPin, setVoidPin]           = useState<{ open: boolean; idx: number }>({ open: false, idx: -1 });
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [manualOpen, setManualOpen]     = useState(false);
  const [manual, setManual]             = useState({ name: "Manual sale", amount: 0, notes: "" });
  const [scannerReady, setScannerReady] = useState(false);
  const [voiceMicOpen, setVoiceMicOpen] = useState(false);
  const [lastScanned, setLastScanned]   = useState<{ name: string; price: number; qty: number } | null>(null);
  const [btPrinterConnected, setBtPrinterConnected] = useState(blePrinter.status === "connected");
  const [torchOn, setTorchOn]     = useState(false);
  const [torchAvail, setTorchAvail] = useState(false);

  const scannerRef      = useRef<Html5Qrcode | null>(null);
  const productsRef     = useRef(products);
  const scanCooldownRef = useRef(false);
  const startingRef     = useRef(false);
  const streamRef       = useRef<MediaStream | null>(null);

  useEffect(() => { productsRef.current = products; }, [products]);

  useEffect(() => {
    blePrinter.onStatusChange = (s) => setBtPrinterConnected(s === "connected");
    setBtPrinterConnected(blePrinter.status === "connected");
    return () => { blePrinter.onStatusChange = null; };
  }, []);

  useEffect(() => {
    bleScanner.onScan = handleBarcode;
    return () => { bleScanner.onScan = null; };
  }, []);

  const handleBarcode = (decoded: string) => {
    if (scanCooldownRef.current) return;
    scanCooldownRef.current = true;
    setTimeout(() => { scanCooldownRef.current = false; }, 300);
    const p = productsRef.current.find((x) => x.barcode === decoded || x.id === decoded);
    if (!p) { beep(false); toast.error(`Not found: ${decoded}`); return; }
    beep(true);
    const state = useStore.getState();
    const existing = state.posCart.find((i) => i.productId === p.id);
    const newQty = existing ? existing.qty + 1 : 1;
    if (existing) {
      state.setPosCart(state.posCart.map((i) => i.productId === p.id ? { ...i, qty: i.qty + 1 } : i));
    } else {
      state.setPosCart([...state.posCart, { productId: p.id, name: p.name, qty: 1, price: p.price, cost: p.cost }]);
    }
    setLastScanned({ name: p.name, price: p.price, qty: newQty });
    toast.success(`✓ ${p.name}`, { duration: 1000 });
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const newState = !torchOn;
      await (track as any).applyConstraints({ advanced: [{ torch: newState }] });
      setTorchOn(newState);
    } catch { toast.error("Flashlight not supported on this device"); }
  };

  const killAllVideoTracks = () => {
    try {
      const videos = document.querySelectorAll("video");
      videos.forEach((v) => {
        const src = v.srcObject as MediaStream | null;
        if (src) src.getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      });
    } catch {}
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const stopScanner = useCallback(() => {
    const s = scannerRef.current;
    scannerRef.current = null;
    startingRef.current = false;
    setScannerReady(false);
    setLastScanned(null);
    setTorchOn(false);
    if (s) {
      try {
        s.stop().catch(() => {}).finally(() => {
          try { s.clear(); } catch {}
          killAllVideoTracks();
        });
      } catch { killAllVideoTracks(); }
    } else {
      killAllVideoTracks();
    }
  }, []);

  const startScanner = useCallback(async () => {
    if (scannerRef.current || startingRef.current) return;
    let attempts = 0;
    while (attempts < 30) {
      const el = document.getElementById(SCANNER_DIV_ID);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) break;
      await new Promise((r) => setTimeout(r, 100));
      attempts++;
    }
    const el = document.getElementById(SCANNER_DIV_ID);
    if (!el || el.offsetWidth === 0) { toast.error("Camera container not ready"); return; }
    startingRef.current = true;
    const scanner = new Html5Qrcode(SCANNER_DIV_ID);
    scannerRef.current = scanner;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const caps = (track as any).getCapabilities?.() ?? {};
      setTorchAvail(!!caps.torch);
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 30,
          qrbox: { width: Math.min(260, el.offsetWidth - 40), height: 110 },
          aspectRatio: el.offsetWidth / el.offsetHeight,
          ...({ experimentalFeatures: { useBarCodeDetectorIfSupported: true } } as any),
        },
        handleBarcode,
        () => {}
      );
      setTimeout(() => {
        const video = el.querySelector("video");
        if (video && video.srcObject instanceof MediaStream) {
          streamRef.current = video.srcObject;
          const t = video.srcObject.getVideoTracks()[0];
          const c = (t as any).getCapabilities?.() ?? {};
          setTorchAvail(!!c.torch);
        }
      }, 800);
      setScannerReady(true);
    } catch {
      scannerRef.current = null;
      startingRef.current = false;
      toast.error("Camera not available — check permissions");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => startScanner(), 300);
    return () => { clearTimeout(t); stopScanner(); };
  }, []);

  const handleCameraToggle = useCallback((active: boolean) => {
    setVoiceMicOpen(!active);
    if (!active) {
      const s = scannerRef.current;
      if (s) {
        try {
          s.stop().catch(() => {}).finally(() => {
            try { s.clear(); } catch {}
            killAllVideoTracks();
          });
        } catch { killAllVideoTracks(); }
        scannerRef.current = null;
        startingRef.current = false;
        setScannerReady(false);
        setLastScanned(null);
        setTorchOn(false);
      } else {
        killAllVideoTracks();
      }
    } else {
      setTimeout(() => startScanner(), 400);
    }
  }, [startScanner]);

  const cart    = posCart;
  const setCart = (updater: CartItem[] | ((c: CartItem[]) => CartItem[])) =>
    setPosCart(typeof updater === "function" ? updater(posCart) : updater);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q)).slice(0, 8);
  }, [search, products]);

  const quickGridProducts = useMemo(() => {
    return products.filter((p) => (p as any).is_quick_grid === true);
  }, [products]);

  const addToCart = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const existing = cart.find((i) => i.productId === productId);
    if (existing) {
      setCart(cart.map((i) => i.productId === productId ? { ...i, qty: i.qty + 1 } : i));
      beep(true);
      toast.success(`✓ Plus One: ${p.name}`, { duration: 800 });
    } else {
      setCart([...cart, { productId: p.id, name: p.name, qty: 1, price: p.price, cost: p.cost }]);
      beep(true);
      toast.success(`✓ Added: ${p.name}`, { duration: 800 });
    }
    setSearch("");
  };

  const addVoiceToCart = useCallback((items: any[]) => {
    const state = useStore.getState();
    const updated = [...state.posCart];
    for (const item of items) {
      const incomingId = item.productId || item.id;
      const rawQty = item.qty ?? item.quantity ?? 1;
      const cleanIncomingQty = Math.max(1, parseInt(String(rawQty), 10) || 1);
      const existingIndex = updated.findIndex((i) => i.productId === incomingId);
      if (existingIndex > -1) {
        const currentQty = Math.max(1, parseInt(String(updated[existingIndex].qty), 10) || 1);
        updated[existingIndex] = { ...updated[existingIndex], qty: currentQty + cleanIncomingQty };
      } else {
        const targetProduct = productsRef.current.find((p) => p.id === incomingId);
        updated.push({
          productId: incomingId,
          name: item.name || targetProduct?.name || "Unknown Item",
          qty: cleanIncomingQty,
          price: item.price ?? targetProduct?.price ?? 0,
          cost: item.cost ?? targetProduct?.cost ?? 0,
        });
      }
    }
    state.setPosCart(updated);
  }, []);

  const updateQty = (productId: string, delta: number) =>
    setCart(cart.map((i) => i.productId === productId ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter((i) => i.qty > 0));

  const removeFromCart = (idx: number) => setVoidPin({ open: true, idx });

  const subtotal   = cart.reduce((s, i) => s + i.qty * i.price, 0);
  const discAmount = discount.type === "amount"
    ? Math.min(subtotal, discount.value)
    : (subtotal * Math.min(100, discount.value)) / 100;
  const total  = Math.max(0, subtotal - discAmount);
  const change = Math.max(0, paid - total);

  useEffect(() => {
    if (paymentMethod !== "CASH") setPaid(total);
  }, [total, paymentMethod]);

  const handlePaymentMethodChange = (method: "CASH" | "GCASH" | "MAYA" | "CARD") => {
    setPaymentMethod(method);
    if (method !== "CASH") setPaid(total);
    else setPaid(0);
  };

  const handleLogDigitalTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    const principal = parseFloat(digAmount);
    const patong = parseFloat(digPatong) || 0;
    if (isNaN(principal) || principal <= 0) return toast.error("Pakilagay ang tamang halaga");
    setDigSubmitting(true);
    const businessDate = new Date().toISOString().split("T")[0];
    const formattedTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    let drawerActionType: "IN" | "OUT" = "IN";
    let absoluteDrawerCashDelta = 0;
    let computedReasonString = "";
    if (digType === "ELOAD") {
      drawerActionType = "IN"; absoluteDrawerCashDelta = patong;
      computedReasonString = `[DIGITAL_LOAD] E-Load to ${digRef || "No Number"} (Load: ₱${principal}, Patong: ₱${patong})`;
    } else if (digType === "CASH_IN") {
      drawerActionType = "IN"; absoluteDrawerCashDelta = patong;
      computedReasonString = `[DIGITAL_CASH_IN] GCash Cash-In to ${digRef || "No Number"} (Principal: ₱${principal}, Patong: ₱${patong})`;
    } else if (digType === "CASH_OUT") {
      drawerActionType = "OUT"; absoluteDrawerCashDelta = principal - patong;
      computedReasonString = `[DIGITAL_CASH_OUT] GCash Cash-Out from ${digRef || "No Number"} (Principal: ₱${principal}, Patong Deducted: ₱${patong})`;
    }
    const newDrawerTx = {
      id: crypto.randomUUID(), type: drawerActionType, amount: absoluteDrawerCashDelta,
      reason: computedReasonString, logged_time: formattedTime,
      created_date: businessDate, synced: false,
    };
    if (navigator.onLine) {
      try {
        const { supabase } = await import("@/lib/supabase");
        const { error } = await supabase.from("cash_drawer_logs").insert([{
          id: newDrawerTx.id, type: newDrawerTx.type, amount: newDrawerTx.amount,
          reason: newDrawerTx.reason, logged_time: newDrawerTx.logged_time,
          created_date: newDrawerTx.created_date, user_id: userId,
        }]);
        if (!error) newDrawerTx.synced = true;
      } catch (err) { console.warn("Cloud write paused:", err); }
    }
    const cachedRawLog = localStorage.getItem(`ysm_cash_drawer_txs_${userId}`);
    const existingQueueRecords = cachedRawLog ? JSON.parse(cachedRawLog) : [];
    localStorage.setItem(`ysm_cash_drawer_txs_${userId}`, JSON.stringify([newDrawerTx, ...existingQueueRecords]));
    beep(true);
    toast.success(newDrawerTx.synced ? "Digital record synced live!" : "Saved locally to offline queue! 📦");
    setDigAmount(""); setDigRef(""); setDigPatong("3"); setDigitalOpen(false); setDigSubmitting(false);
  };

  const checkout = async () => {
    if (cart.length === 0) return toast.error("Cart is empty");
    if (paid < total)      return toast.error("Insufficient payment");
    for (const item of cart) {
      const p = products.find((x) => x.id === item.productId);
      if (!p || p.stock < item.qty) return toast.error(`Insufficient stock for ${item.name}`);
    }

    const cashierName: string = isEmployeeMode && activeShift?.employeeName
      ? activeShift.employeeName
      : ((settings as any).ownerName?.trim() || settings.storeName || "Owner");

    const transactionNo = getNextTransactionNumber();

    const { activeShift: currentShift } = useStore.getState();
    const tx: Transaction = {
      id: uid(),
      date: new Date().toISOString(),
      items: cart,
      subtotal, discount: discAmount, total, paid, change,
      shiftId: currentShift?.id,
      employeeName: currentShift?.employeeName,
      paymentMethod,
      transactionNo,
      cashierName,
    } as any;

    setTransactions([tx, ...transactions]);
    setProducts(products.map((p) => {
      const ci = cart.find((c) => c.productId === p.id);
      return ci ? { ...p, stock: p.stock - ci.qty } : p;
    }));

    try {
      await sbAddTransaction(userId, tx);
      const { supabase } = await import("@/lib/supabase");
      for (const item of cart) {
        const p = products.find((x) => x.id === item.productId);
        if (p) await supabase.from("products").update({ stock: p.stock - item.qty }).eq("id", p.id).eq("user_id", userId);
      }
    } catch {}

    if (currentShift) await addTransactionToShift(tx);

    const historyEntry = {
      transactionNo,
      cashierName,
      date: new Date().toLocaleString("en-PH"),
      total, subtotal, discount: discAmount, paid, change,
      paymentMethod,
      itemCount: cart.length,
      items: cart.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
      txId: tx.id,
    };
    const existingHistory: any[] = JSON.parse(localStorage.getItem(TXN_HISTORY_KEY) ?? "[]");
    existingHistory.unshift(historyEntry);
    if (existingHistory.length > 1000) existingHistory.length = 1000;
    localStorage.setItem(TXN_HISTORY_KEY, JSON.stringify(existingHistory));

    setCart([]);
    setDiscount({ type: "amount", value: 0 });
    setPaid(0);
    setPaymentMethod("CASH");
    setShowReceipt(tx);
    toast.success(`Sale #${transactionNo} completed!`);
  };

  const handlePrint = async (tx: Transaction) => {
    if (btPrinterConnected) {
      const bytes = buildReceipt(tx, settings);
      const ok = await blePrinter.print(bytes);
      if (ok) { toast.success("Printed via Bluetooth ✓"); return; }
      toast.error("BT print failed — falling back to browser print");
    }
    printReceipt();
  };

  const addManualTransaction = async () => {
    if (!manual.amount || manual.amount <= 0) return toast.error("Enter an amount");
    const tx: Transaction = {
      id: uid(), date: new Date().toISOString(),
      items: [{ productId: "manual", name: manual.name || "Manual sale", qty: 1, price: manual.amount, cost: 0 }],
      subtotal: manual.amount, discount: 0, total: manual.amount,
      paid: manual.amount, change: 0, voidReason: manual.notes || undefined,
      paymentMethod: "CASH",
    } as any;
    setTransactions([tx, ...transactions]);
    try { await sbAddTransaction(userId, tx); } catch {}
    setManual({ name: "Manual sale", amount: 0, notes: "" });
    setManualOpen(false);
    toast.success("Manual transaction added");
  };

  return (
    <div className="space-y-3 p-4 pb-24 max-w-4xl mx-auto">

      <style>{`
        #${SCANNER_DIV_ID} { width:100%; height:100%; position:relative; background:#000; }
        #${SCANNER_DIV_ID} video {
          width:100% !important; height:100% !important;
          object-fit:cover !important; position:absolute !important;
          top:0 !important; left:0 !important; display:block !important;
          /* iOS Safari + Android Chrome WebView need these to inline-play the camera */
          playsinline:true !important; -webkit-playsinline:true !important;
          autoplay:true !important; -webkit-autoplay:true !important;
          muted:true !important; -webkit-muted:true !important;
        }
        #${SCANNER_DIV_ID} img[alt="Info icon"] { display:none !important; }
        #${SCANNER_DIV_ID}__scan_region > div { display:none !important; }
        #${SCANNER_DIV_ID}__dashboard      { display:none !important; }
        #${SCANNER_DIV_ID}__header_message { display:none !important; }
        #${SCANNER_DIV_ID}__filescan_input { display:none !important; }
        @keyframes sweep {
          0%,100% { top: 18%; }
          50%      { top: 72%; }
        }
      `}</style>

      {/* ── Camera block ── */}
      <div className="rounded-2xl overflow-hidden bg-black border border-slate-800/40 shadow-lg">
        <div className="relative w-full overflow-hidden rounded-t-2xl" style={{ height: 240 }}>
          <div
            id={SCANNER_DIV_ID}
            style={{
              position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
              visibility: voiceMicOpen ? "hidden" : "visible",
            }}
          />

          {voiceMicOpen && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950">
              <div className="h-14 w-14 rounded-full bg-red-500/20 flex items-center justify-center">
                <div className="h-10 w-10 rounded-full bg-red-500/30 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-red-400 fill-current">
                    <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm6.364 9a6.5 6.5 0 0 1-12.728 0H4a8 8 0 0 0 7 7.938V20H9v2h6v-2h-2v-2.062A8 8 0 0 0 20 10h-1.636z"/>
                  </svg>
                </div>
              </div>
              <p className="text-xs text-white/50">Camera paused — mic active</p>
            </div>
          )}

          {scannerReady && !voiceMicOpen && (
            <div className="pointer-events-none absolute inset-0 z-10">
              <div className="absolute inset-0" style={{
                background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)"
              }} />
              <div className="absolute" style={{
                left:"10%", right:"10%", top:"18%", bottom:"22%",
                border:"1.5px solid rgba(52,211,153,0.4)", borderRadius:6,
              }} />
              {[
                "left-[10%] top-[18%] rounded-tl-md border-l-[3px] border-t-[3px]",
                "right-[10%] top-[18%] rounded-tr-md border-r-[3px] border-t-[3px]",
                "left-[10%] bottom-[22%] rounded-bl-md border-b-[3px] border-l-[3px]",
                "right-[10%] bottom-[22%] rounded-br-br rounded-br-md border-b-[3px] border-r-[3px]",
              ].map((cls, i) => (
                <span key={i} className={`absolute h-7 w-7 border-emerald-400 ${cls}`}
                  style={{ filter:"drop-shadow(0 0 6px rgba(52,211,153,0.9))" }} />
              ))}
              <div className="absolute" style={{
                left:"10%", right:"10%", height:2,
                background:"linear-gradient(90deg, transparent, rgba(52,211,153,0.9), transparent)",
                animation:"sweep 1.8s ease-in-out infinite",
                boxShadow:"0 0 10px 3px rgba(52,211,153,0.5)",
              }} />
              {torchAvail && (
                <div className="pointer-events-auto absolute top-3 right-3 z-20">
                  <button onClick={toggleTorch}
                    className={`flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md transition-all
                      ${torchOn ? "bg-yellow-400/90 text-black" : "bg-black/50 text-white/70 border border-white/20"}`}>
                    {torchOn ? <Flashlight className="h-4 w-4" /> : <FlashlightOff className="h-4 w-4" />}
                  </button>
                </div>
              )}
            </div>
          )}

          {!scannerReady && !voiceMicOpen && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
              <p className="text-xs text-white/30">Starting camera…</p>
            </div>
          )}

          <div className="absolute bottom-3 left-0 right-0 z-20 flex justify-center">
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 backdrop-blur-md text-xs font-medium
              ${voiceMicOpen
                ? "bg-red-900/50 text-red-300/80"
                : scannerReady
                  ? "bg-black/50 text-white/80"
                  : "bg-black/40 text-white/30"}`}>
              <div className={`h-1.5 w-1.5 rounded-full ${
                voiceMicOpen ? "bg-red-400 animate-pulse" : scannerReady ? "bg-emerald-400 animate-pulse" : "bg-white/20"
              }`} />
              {voiceMicOpen ? "Mic mode" : scannerReady ? "Point at barcode" : "Initializing…"}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 gap-3 bg-zinc-900 rounded-b-2xl">
          {lastScanned ? (
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-white/30 uppercase tracking-wider leading-none mb-0.5">Last scanned</p>
              <p className="text-sm font-semibold text-white truncate">{lastScanned.name}</p>
            </div>
          ) : (
            <p className="text-xs text-white/25 flex-1">
              {voiceMicOpen ? "Say product names to add to cart" : "Scan a barcode to add to cart"}
            </p>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 rounded-full bg-slate-800/60 px-2 py-0.5 border border-slate-700/40">
              <div className={`h-1.5 w-1.5 rounded-full ${isEmployeeMode ? "bg-amber-400" : "bg-teal-400"}`} />
              <span className="text-[10px] font-bold text-slate-300 max-w-[80px] truncate">
                {isEmployeeMode && activeShift?.employeeName
                  ? activeShift.employeeName
                  : ((settings as any).ownerName?.trim() || "Owner")}
              </span>
            </div>
            {btPrinterConnected && (
              <div className="flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5">
                <Bluetooth className="h-3 w-3 text-blue-400" />
                <span className="text-[10px] text-blue-300">BT</span>
              </div>
            )}
            {lastScanned && (
              <span className="text-base font-bold text-emerald-400">
                {fmt(lastScanned.price * lastScanned.qty, settings.currency)}
              </span>
            )}
            {cart.length > 0 && (
              <span className="text-xs font-semibold text-white/40">
                {cart.length} item{cart.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab Router ── */}
      <div className="grid grid-cols-2 gap-1.5 bg-[#121824] p-1 rounded-xl border border-slate-800/60 shadow-inner">
        <button type="button" onClick={() => setActiveTab("scan")}
          className={`py-2 rounded-lg font-bold text-xs tracking-wide transition-all flex items-center justify-center gap-2 ${
            activeTab === "scan"
              ? "bg-[#090d16] border border-slate-800 text-emerald-400 shadow-md"
              : "text-slate-400 hover:text-slate-200"
          }`}>
          <Search className="h-3.5 w-3.5" />
          Scan & Search Item
        </button>
        <button type="button" onClick={() => setActiveTab("quick")}
          className={`py-2 rounded-lg font-bold text-xs tracking-wide transition-all flex items-center justify-center gap-2 ${
            activeTab === "quick"
              ? "bg-[#090d16] border border-slate-800 text-amber-400 shadow-md"
              : "text-slate-400 hover:text-slate-200"
          }`}>
          <Zap className="h-3.5 w-3.5" />
          Mabilisang Pindot (Quick Grid)
        </button>
      </div>

      {/* ── Search / Quick Grid ── */}
      {activeTab === "scan" ? (
        <div className="space-y-3">
          <Input placeholder="Search product or barcode…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-[#121824] border-slate-800 text-sm focus:outline-none" />
          {matches.length > 0 && (
            <Card className="bg-[#121824] border-slate-800/80 shadow-md">
              <CardContent className="p-2 divide-y divide-slate-800/40">
                {matches.map((p) => (
                  <button key={p.id} onClick={() => addToCart(p.id)}
                    className="flex w-full items-center justify-between rounded-xl p-2.5 text-left hover:bg-slate-900/40 transition-colors">
                    <div>
                      <div className="text-sm font-bold text-slate-200">{p.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Stock balance: {p.stock}</div>
                    </div>
                    <Badge className="bg-slate-800 text-slate-300 border-slate-700">{fmt(p.price, settings.currency)}</Badge>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <Card className="bg-[#121824] border-slate-800/80 shadow-md">
          <CardContent className="p-3.5">
            {quickGridProducts.length === 0 ? (
              <div className="text-center p-6 bg-[#090d16]/30 border border-dashed border-slate-800 rounded-xl text-xs text-slate-400 tracking-wide">
                ✨ <span className="font-bold text-slate-200">Walang laman ang iyong Quick Grid.</span>
                <p className="text-slate-500 text-[11px] mt-1">
                  Pumunta sa <span className="text-amber-400 font-bold">Stock page</span> at i-on ang "Quick Grid" toggle sa mga produktong walang barcode (gaya ng itlog, yelo, o pandesal)! ⚡
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {quickGridProducts.map((p) => (
                  <button key={p.id} type="button" onClick={() => addToCart(p.id)}
                    className="flex items-center gap-2.5 p-2 h-24 bg-gradient-to-b from-[#1c2333]/70 to-[#090d16]/90 border border-slate-800/80 rounded-xl hover:border-amber-500/40 active:scale-[0.97] transition-all text-left shadow-inner group w-full">
                    <div className="h-16 w-16 shrink-0 rounded-lg overflow-hidden bg-zinc-950 flex items-center justify-center border border-slate-800/50">
                      {p.image_url
                        ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                        : <Package className="h-5 w-5 text-slate-600/50" />}
                    </div>
                    <div className="flex flex-col justify-between h-full flex-1 min-w-0 py-0.5">
                      <span className="text-xs font-bold text-slate-200 line-clamp-2 leading-tight tracking-wide group-hover:text-white">{p.name}</span>
                      <span className="text-xs font-black text-amber-400 font-mono">{fmt(p.price, settings.currency)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Cart ── */}
      <Card className="bg-[#121824] border-slate-800/80 shadow-md text-slate-100">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2 mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Cart Queue ({cart.length})</h3>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setDigitalOpen(true)} className="text-xs text-blue-400 hover:text-blue-300 hover:bg-slate-900/40 h-7 px-2 font-bold">
                <Smartphone className="mr-1 h-3.5 w-3.5 text-blue-400" />E-Load / GCash
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)} className="text-xs text-slate-400 hover:text-white hover:bg-slate-900/40 h-7 px-2">
                <ListChecks className="mr-1 h-3.5 w-3.5 text-amber-400" />History Log
              </Button>
            </div>
          </div>
          {cart.length === 0 && <p className="text-xs text-slate-500 py-4 text-center tracking-wide">Scan items or type search descriptors to pack checkout container.</p>}
          {cart.map((it, idx) => (
            <div key={it.productId} className="flex items-center gap-2 rounded-xl border border-slate-800/60 bg-[#090d16]/20 p-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-200 truncate">{it.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                  {fmt(it.price, settings.currency)} × {it.qty} = <span className="text-emerald-400 font-bold">{fmt(it.price * it.qty, settings.currency)}</span>
                </div>
              </div>
              <Button size="icon" variant="outline" className="h-7 w-7 border-slate-800 bg-[#090d16]" onClick={() => updateQty(it.productId, -1)}><Minus className="h-3 w-3" /></Button>
              <span className="w-6 text-center text-xs font-bold font-mono">{it.qty}</span>
              <Button size="icon" variant="outline" className="h-7 w-7 border-slate-800 bg-[#090d16]" onClick={() => updateQty(it.productId, +1)}><Plus className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-400 hover:text-rose-300 hover:bg-rose-500/5" onClick={() => removeFromCart(idx)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Checkout Panel ── */}
      <Card className="bg-[#121824] border-slate-800/80 shadow-md text-slate-100">
        <CardContent className="space-y-3.5 p-4">
          <div className="flex items-center gap-3 bg-[#090d16]/40 p-2 rounded-xl border border-slate-800/60">
            <Label className="w-16 text-xs font-bold text-slate-400">Discount</Label>
            <Select value={discount.type} onValueChange={(v) => setDiscount({ ...discount, type: v as "amount" | "percent" })}>
              <SelectTrigger className="w-24 bg-[#090d16] border-slate-800 text-xs h-8"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#121824] border-slate-800 text-white">
                <SelectItem value="amount">Peso (₱)</SelectItem>
                <SelectItem value="percent">Percent (%)</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" min={0} value={discount.value || ""}
              onChange={(e) => setDiscount({ ...discount, value: Number(e.target.value) })}
              className="flex-1 bg-[#090d16] border-slate-800 text-xs h-8 focus:outline-none" placeholder="0" />
          </div>

          <div className="space-y-1.5 border-b border-slate-800/60 pb-3 text-xs">
            <div className="flex justify-between text-slate-400"><span>Subtotal</span><span>{fmt(subtotal, settings.currency)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Discount reductions</span><span>-{fmt(discAmount, settings.currency)}</span></div>
            <div className="flex justify-between text-sm font-black text-white pt-1"><span>Grand Total</span><span className="text-amber-400 text-base font-black">₱{total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
          </div>

          <div className="space-y-2 text-left bg-[#090d16]/20 p-3 rounded-xl border border-slate-800/40">
            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Route Payment Pipeline</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
              {(["CASH", "GCASH", "MAYA", "CARD"] as const).map((method) => {
                const colors: Record<string, string> = { CASH: "emerald", GCASH: "blue", MAYA: "green", CARD: "purple" };
                const icons = { CASH: <Wallet className="h-3.5 w-3.5" />, GCASH: <Smartphone className="h-3.5 w-3.5" />, MAYA: <Smartphone className="h-3.5 w-3.5" />, CARD: <CreditCard className="h-3.5 w-3.5" /> };
                const c = colors[method];
                const active = paymentMethod === method;
                return (
                  <button key={method} type="button" onClick={() => handlePaymentMethodChange(method)}
                    className={`py-2 px-2.5 rounded-lg border transition-all flex items-center justify-center gap-1.5 ${
                      active
                        ? `border-${c}-500/50 bg-${c}-500/10 text-${c}-400 font-bold shadow-md shadow-${c}-950/20`
                        : "border-slate-800/80 bg-[#090d16]/50 text-slate-400 hover:border-slate-700"
                    }`}>
                    {icons[method]}
                    <span className="text-[11px] tracking-wide">{method === "CARD" ? "Card" : method.charAt(0) + method.slice(1).toLowerCase()}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Amount Paid</Label>
              <Input type="number" inputMode="decimal" min={0}
                disabled={paymentMethod !== "CASH"} value={paid || ""}
                onChange={(e) => setPaid(Number(e.target.value))}
                className="bg-[#090d16] border-slate-800 h-10 font-mono text-sm focus:outline-none" placeholder="0.00" />
            </div>
            <div className="w-28 text-right pr-1">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Change Due</p>
              <p className="text-base font-mono font-bold mt-1 text-emerald-400">
                ₱{change.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm h-11 rounded-xl shadow-lg shadow-emerald-950/20 mt-2"
            size="lg" onClick={checkout}>
            Finalize {paymentMethod === "CASH" ? "Cash Checkout" : `${paymentMethod} Settlement`}
          </Button>
        </CardContent>
      </Card>

      <VoiceCashier onAddToCart={addVoiceToCart} plan={plan} onCameraToggle={handleCameraToggle} />

      {/* ── E-Load / GCash Dialog ── */}
      <Dialog open={digitalOpen} onOpenChange={(o) => !o && setDigitalOpen(false)}>
        <DialogContent className="bg-[#121824] border border-slate-800 text-slate-100 max-w-xs rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-white font-bold flex items-center gap-2 text-sm tracking-wide">
              <Smartphone className="h-4 w-4 text-blue-400" /> E-Load / GCash Tracker
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLogDigitalTransaction} className="space-y-3.5 text-left pt-2">
            <div className="grid grid-cols-3 gap-1 bg-[#090d16] p-1 rounded-lg border border-slate-800/60">
              {(["ELOAD", "CASH_IN", "CASH_OUT"] as const).map((t) => (
                <button key={t} type="button"
                  onClick={() => { setDigType(t); setDigPatong(t === "ELOAD" ? "3" : "10"); }}
                  className={`py-1.5 rounded-md font-bold text-[10px] transition-all uppercase tracking-wide ${
                    digType === t
                      ? `bg-[#121824] border border-slate-800 ${t === "ELOAD" ? "text-blue-400" : t === "CASH_IN" ? "text-emerald-400" : "text-rose-400"}`
                      : "text-slate-400"
                  }`}>
                  {t === "ELOAD" ? "E-Load" : t === "CASH_IN" ? "Cash In" : "Cash Out"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Halaga (₱)</Label>
                <Input type="number" inputMode="decimal" required value={digAmount}
                  onChange={(e) => setDigAmount(e.target.value)}
                  className="bg-[#090d16] border-slate-800 text-xs h-9 focus:outline-none font-mono" placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Patong / Fee (₱)</Label>
                <Input type="number" inputMode="decimal" required value={digPatong}
                  onChange={(e) => setDigPatong(e.target.value)}
                  className="bg-[#090d16] border-slate-800 text-xs h-9 focus:outline-none font-mono text-amber-400" placeholder="0" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Phone / Reference Number</Label>
              <Input type="text" inputMode="tel" value={digRef} onChange={(e) => setDigRef(e.target.value)}
                className="bg-[#090d16] border-slate-800 text-xs h-9 focus:outline-none font-mono" placeholder="e.g., 0917xxxxxxx" />
            </div>
            <DialogFooter className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setDigitalOpen(false)} className="flex-1 border-slate-800 font-bold text-xs h-9">Cancel</Button>
              <Button type="submit" disabled={digSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-700 font-bold text-xs h-9">
                {digSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "I-save sa Drawer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <OwnerPinPrompt
        open={voidPin.open} onOpenChange={(o) => setVoidPin((v) => ({ ...v, open: o }))}
        requireReason title="Void / Remove item"
        onConfirm={(reason) => {
          const removed = cart[voidPin.idx];
          if (removed) {
            addAntiKupit({ id: uid(), date: new Date().toISOString(), type: "void", item: removed.name, reason });
            setCart((c) => c.filter((_, i) => i !== voidPin.idx));
            toast("Item removed (logged)");
          }
        }}
      />

      {/* ── Receipt Dialog ── */}
      <Dialog open={!!showReceipt} onOpenChange={(o) => !o && setShowReceipt(null)}>
        <DialogContent className="bg-[#121824] border border-slate-800 text-slate-100 max-w-sm rounded-xl">
          <DialogHeader><DialogTitle className="text-white font-bold">Transaction Receipt</DialogTitle></DialogHeader>
          <div className="print-area max-h-[55vh] overflow-y-auto pr-1">{showReceipt && <Receipt tx={showReceipt} />}</div>
          <DialogFooter className="gap-2 sm:gap-0 flex-row mt-2">
            <Button onClick={() => showReceipt && handlePrint(showReceipt)} className="flex-1 bg-blue-600 hover:bg-blue-700 font-bold text-xs">
              {btPrinterConnected ? <><Bluetooth className="mr-1.5 h-4 w-4" />BT Print</> : <><Printer className="mr-1.5 h-4 w-4" />System Print</>}
            </Button>
            <Button variant="outline" onClick={() => setShowReceipt(null)} className="flex-1 border-slate-800 font-bold text-xs">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── History Dialog ── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto bg-[#121824] border border-slate-800 text-slate-100 rounded-xl max-w-md">
          <DialogHeader><DialogTitle className="text-white font-bold">Today's Completed Registers</DialogTitle></DialogHeader>
          <div className="text-xs text-amber-400 mb-1">
            <Link to="/daily" className="underline font-semibold hover:text-amber-300">Open complete operational breakdown report →</Link>
          </div>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {transactions
              .filter((t) => new Date(t.date).toDateString() === new Date().toDateString())
              .map((t) => {
                const methodLabel = (t as any).paymentMethod || "CASH";
                return (
                  <div key={t.id} className="rounded-xl border border-slate-800/80 bg-[#090d16]/30 p-3 text-xs space-y-1.5">
                    {/* Header: TXN# and time */}
                    <div className="flex justify-between text-slate-400 font-mono">
                      <span>
                        {(t as any).transactionNo
                          ? <span className="text-teal-400 font-bold">#{(t as any).transactionNo}</span>
                          : `ID: #${t.id.slice(0, 6)}`}
                      </span>
                      <span>{new Date(t.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    {/* Cashier */}
                    {(t as any).cashierName && (
                      <div className="text-[10px] text-slate-500">
                        Cashier: <span className="text-slate-300 font-bold">{(t as any).cashierName}</span>
                      </div>
                    )}
                    {/* Items list */}
                    <div className="space-y-0.5 border-t border-slate-800/40 pt-1.5">
                      {t.items.map((it, i) => (
                        <div key={i} className="flex justify-between text-[10px] text-slate-400">
                          <span className="truncate max-w-[60%]">{it.qty}× {it.name}</span>
                          <span className="text-slate-300 font-mono">{fmt(it.qty * it.price, settings.currency)}</span>
                        </div>
                      ))}
                    </div>
                    {/* Total row */}
                    <div className="flex justify-between font-bold text-slate-200 border-t border-slate-800/40 pt-1">
                      <span>{t.items.length} item{t.items.length !== 1 ? "s" : ""}</span>
                      <span className="text-sm text-white">{fmt(t.total, settings.currency)}</span>
                    </div>
                    {/* Payment badge + view invoice */}
                    <div className="flex items-center justify-between pt-0.5">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${
                        methodLabel === "CASH"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : methodLabel === "CARD"
                            ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                            : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                      }`}>{methodLabel}</span>
                      <Button variant="link" size="sm" className="h-5 p-0 text-amber-400 hover:text-amber-300 underline font-medium" onClick={() => setShowReceipt(t)}>View Full Invoice</Button>
                    </div>
                  </div>
                );
              })}
            {transactions.filter((t) => new Date(t.date).toDateString() === new Date().toDateString()).length === 0 && (
              <p className="text-xs text-slate-500 py-4 text-center tracking-wide">No transactions completed yet today.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Manual Transaction Dialog ── */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="bg-[#121824] border border-slate-800 text-slate-100 rounded-xl max-w-xs">
          <DialogHeader><DialogTitle className="text-white font-bold">Add Manual Transaction</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2 text-left">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Description</Label>
              <Input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} className="bg-[#090d16] border-slate-800 text-xs focus:outline-none" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Amount (₱)</Label>
              <Input type="number" min={0} value={manual.amount || ""}
                onChange={(e) => setManual({ ...manual, amount: Number(e.target.value) })} className="bg-[#090d16] border-slate-800 text-xs focus:outline-none" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Notes (optional)</Label>
              <Textarea rows={2} value={manual.notes} onChange={(e) => setManual({ ...manual, notes: e.target.value })}
                className="bg-[#090d16] border-slate-800 text-xs focus:outline-none placeholder:text-slate-700" placeholder="Enter log comments here..." />
            </div>
          </div>
          <DialogFooter className="flex gap-2 mt-2">
            <Button variant="outline" onClick={() => setManualOpen(false)} className="flex-1 border-slate-800 font-bold text-xs">Cancel</Button>
            <Button onClick={addManualTransaction} className="flex-1 bg-emerald-600 hover:bg-emerald-700 font-bold text-xs">Add Sale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
