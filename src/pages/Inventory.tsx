import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useStore, uid, sbAddProduct, sbUpdateProduct, sbDeleteProduct, uploadProductImage } from "@/lib/storage";
import type { Product } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OwnerPinPrompt } from "@/components/PinPrompt";
import { fmt } from "@/lib/format";
import { toast } from "sonner";
import { Html5Qrcode } from "html5-qrcode";
import {
  Plus, Pencil, Trash2, ScanLine, Camera, X,
  Package, Search, AlertTriangle, Loader2, Zap, ClipboardList, Copy,
  FlashlightOff, Flashlight, RotateCcw,
} from "lucide-react";

const CATEGORIES = [
  "Beverages", "Snacks", "Dairy", "Meat & Seafood", "Bakery",
  "Canned Goods", "Condiments", "Frozen Foods", "Personal Care",
  "Household", "Tobacco", "Liquor", "Other",
];

const UNITS = ["pcs", "kg", "g", "pack", "bote", "litro", "sachet"];

const SCANNER_DIV_ID = "inv-barcode-scanner";
const CAMERA_DIV_ID  = "inv-photo-camera";

const blank = (): Product => ({
  id: "", name: "", barcode: "", category: "", stock: 0, cost: 0, price: 0, is_quick_grid: false, unit: "pcs"
} as any);

/* ─── tiny beep ─── */
let _audioCtx: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = _audioCtx;
    // iOS Safari starts contexts in 'suspended' state — resume on user gesture
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const play = (freq: number, t: number, dur: number) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "square"; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur);
    };
    if (ok) play(1900, ctx.currentTime, 0.14);
    else { play(320, ctx.currentTime, 0.10); play(260, ctx.currentTime + 0.13, 0.15); }
    if (navigator.vibrate) { try { navigator.vibrate(ok ? 35 : [35, 55, 70]); } catch {} }
  } catch {}
}

export function Inventory() {
  const { products, setProducts, settings, addAntiKupit, addStockLog, userId } = useStore();
  const [search, setSearch]       = useState("");
  const [editing, setEditing]     = useState<Product | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [stockEdit, setStockEdit] = useState<{ product: Product; newStock: number } | null>(null);
  const [stockPin, setStockPin]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [filterCat, setFilterCat] = useState("all");

  const [pamalengkeOpen, setPamalengkeOpen] = useState(false);
  const [wasteProduct, setWasteProduct]     = useState<Product | null>(null);
  const [wasteQty, setWasteQty]             = useState("1");
  const [wasteReason, setWasteReason]       = useState("Sira / Basag");
  const [wasteSubmitting, setWasteSubmitting] = useState(false);

  /* ── scanner state ── */
  const [scannerOpen, setScannerOpen]     = useState(false);
  const [scannerReady, setScannerReady]   = useState(false);
  const [torchOn, setTorchOn]             = useState(false);
  const [torchAvail, setTorchAvail]       = useState(false);
  const scannerRef    = useRef<Html5Qrcode | null>(null);
  const startingRef   = useRef(false);
  const streamRef     = useRef<MediaStream | null>(null);
  const cooldownRef   = useRef(false);

  /* ── camera (photo) state ── */
  const [cameraOpen, setCameraOpen]     = useState(false);
  const [camReady, setCamReady]         = useState(false);
  const [camFacing, setCamFacing]       = useState<"environment" | "user">("environment");
  const camScannerRef = useRef<Html5Qrcode | null>(null);
  const camStartingRef = useRef(false);
  const camStreamRef  = useRef<MediaStream | null>(null);

  const [dupConfirm, setDupConfirm] = useState<{ existing: Product; scannedBarcode: string } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const list = products.filter((p) => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode ?? "").toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "all" || p.category === filterCat;
    return matchSearch && matchCat;
  });

  const lowStockItems = useMemo(() =>
    products.filter((p) => p.stock <= settings.lowStockThreshold),
    [products, settings.lowStockThreshold]
  );

  const copyPamalengkeList = async () => {
    if (lowStockItems.length === 0) return;
    const dateString = new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    const text = `📋 *PAMALENGKE LIST - ${dateString}*\n` +
      `---------------------------------\n` +
      lowStockItems.map((p) => `❌ ${p.name} (Stock: ${p.stock} ${(p as any).unit || "pcs"})`).join("\n") +
      `\n---------------------------------\nGenerated via POS Restock System`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.success("Kopyado na sa clipboard!");
      } else {
        // Fallback for WebViews that block the Clipboard API
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); toast.success("Kopyado na sa clipboard!"); }
        catch { toast.error("Hindi makopya ang listahan."); }
        finally { document.body.removeChild(ta); }
      }
    } catch { toast.error("Hindi makopya ang listahan."); }
  };

  /* ════════════════════════════════════════
     BARCODE SCANNER — POS-quality
  ════════════════════════════════════════ */
  const killScannerTracks = () => {
    try {
      document.querySelectorAll(`#${SCANNER_DIV_ID} video`).forEach((v: any) => {
        (v.srcObject as MediaStream)?.getTracks().forEach((t: any) => t.stop());
        v.srcObject = null;
      });
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stopScanner = useCallback(() => {
    const s = scannerRef.current;
    scannerRef.current = null;
    startingRef.current = false;
    setScannerReady(false);
    setTorchOn(false);
    if (s) {
      try { s.stop().catch(() => {}).finally(() => { try { s.clear(); } catch {} killScannerTracks(); }); }
      catch { killScannerTracks(); }
    } else { killScannerTracks(); }
  }, []);

  const handleBarcodeScanned = useCallback((barcode: string) => {
    if (cooldownRef.current) return;
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, 300);

    beep(true);
    const existing = products.find((p) => p.barcode === barcode && p.id !== editing?.id);
    if (existing) {
      setScannerOpen(false);
      setDupConfirm({ existing, scannedBarcode: barcode });
      return;
    }
    setEditing((prev) => prev ? { ...prev, barcode } : prev);
    setScannerOpen(false);
    toast.success(`Barcode: ${barcode}`);
  }, [products, editing?.id]);

  const startScanner = useCallback(async () => {
    if (scannerRef.current || startingRef.current) return;
    startingRef.current = true;
    /* wait for DOM */
    let attempts = 0;
    while (attempts++ < 30) {
      const el = document.getElementById(SCANNER_DIV_ID);
      if (el && el.offsetWidth > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const el = document.getElementById(SCANNER_DIV_ID);
    if (!el || el.offsetWidth === 0) { startingRef.current = false; toast.error("Scanner container not ready"); return; }

    const scanner = new Html5Qrcode(SCANNER_DIV_ID);
    scannerRef.current = scanner;
    try {
      /* probe torch capability */
      const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const caps = (probe.getVideoTracks()[0] as any).getCapabilities?.() ?? {};
      setTorchAvail(!!caps.torch);
      probe.getTracks().forEach((t) => t.stop());

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 30,
          qrbox: { width: Math.min(260, el.offsetWidth - 40), height: 100 },
          aspectRatio: el.offsetWidth / (el.offsetHeight || 220),
          ...({ experimentalFeatures: { useBarCodeDetectorIfSupported: true } } as any),
        },
        handleBarcodeScanned,
        () => {},
      );
      /* grab live stream for torch control */
      setTimeout(() => {
        const vid = el.querySelector("video");
        if (vid?.srcObject instanceof MediaStream) {
          streamRef.current = vid.srcObject;
        }
      }, 800);
      setScannerReady(true);
    } catch {
      scannerRef.current = null;
      startingRef.current = false;
      toast.error("Camera not available — check permissions");
    }
  }, [handleBarcodeScanned]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await (track as any).applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch { toast.error("Flashlight not supported"); }
  };

  useEffect(() => {
    if (scannerOpen) { setTimeout(() => startScanner(), 300); }
    else { stopScanner(); }
  }, [scannerOpen]);

  /* ════════════════════════════════════════
     PHOTO CAMERA — Html5Qrcode video mode
     (no decode callback — purely for capture)
  ════════════════════════════════════════ */
  const killCamTracks = () => {
    try {
      document.querySelectorAll(`#${CAMERA_DIV_ID} video`).forEach((v: any) => {
        (v.srcObject as MediaStream)?.getTracks().forEach((t: any) => t.stop());
        v.srcObject = null;
      });
    } catch {}
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
  };

  const stopCamera = useCallback(() => {
    const s = camScannerRef.current;
    camScannerRef.current = null;
    camStartingRef.current = false;
    setCamReady(false);
    if (s) {
      try { s.stop().catch(() => {}).finally(() => { try { s.clear(); } catch {} killCamTracks(); }); }
      catch { killCamTracks(); }
    } else { killCamTracks(); }
  }, []);

  const startCamera = useCallback(async (facing: "environment" | "user" = "environment") => {
    if (camScannerRef.current || camStartingRef.current) return;
    camStartingRef.current = true;
    let attempts = 0;
    while (attempts++ < 30) {
      const el = document.getElementById(CAMERA_DIV_ID);
      if (el && el.offsetWidth > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const el = document.getElementById(CAMERA_DIV_ID);
    if (!el || el.offsetWidth === 0) { camStartingRef.current = false; toast.error("Camera container not ready"); return; }

    const scanner = new Html5Qrcode(CAMERA_DIV_ID);
    camScannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: facing },
        {
          fps: 30,
          /* no qrbox so we fill the viewport — we never use the scan result */
          qrbox: { width: 1, height: 1 },
          aspectRatio: el.offsetWidth / (el.offsetHeight || 300),
          ...({ experimentalFeatures: { useBarCodeDetectorIfSupported: true } } as any),
        },
        () => {}, /* ignore any accidental barcode decode in photo mode */
        () => {},
      );
      setTimeout(() => {
        const vid = el.querySelector("video");
        if (vid?.srcObject instanceof MediaStream) camStreamRef.current = vid.srcObject;
      }, 600);
      setCamReady(true);
    } catch {
      camScannerRef.current = null;
      camStartingRef.current = false;
      toast.error("Camera not available");
    }
  }, []);

  const openCamera = (facing: "environment" | "user" = "environment") => {
    setCamFacing(facing);
    setCameraOpen(true);
  };

  useEffect(() => {
    if (cameraOpen) { setTimeout(() => startCamera(camFacing), 300); }
    else { stopCamera(); }
  }, [cameraOpen, camFacing]);

  const flipCamera = () => {
    stopCamera();
    const next = camFacing === "environment" ? "user" : "environment";
    setCamFacing(next);
    setTimeout(() => startCamera(next), 400);
  };

  const capturePhoto = () => {
    const el = document.getElementById(CAMERA_DIV_ID);
    const vid = el?.querySelector("video") as HTMLVideoElement | null;
    if (!vid) { toast.error("Camera not ready"); return; }
    const canvas = document.createElement("canvas");
    canvas.width = vid.videoWidth || 640;
    canvas.height = vid.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(vid, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    setPendingImage(dataUrl);
    stopCamera();
    setCameraOpen(false);
    toast.success("Photo captured!");
  };

  /* cleanup on unmount */
  useEffect(() => () => { stopScanner(); stopCamera(); }, []);

  /* ════════════════════════════════════════
     CRUD helpers (unchanged)
  ════════════════════════════════════════ */
  const toggleQuickGridRow = async (p: Product) => {
    const nextState = !(p as any).is_quick_grid;
    const finalProduct: Product = { ...p, is_quick_grid: nextState } as any;
    setProducts(products.map((x) => x.id === p.id ? finalProduct : x));
    try {
      await sbUpdateProduct(userId, finalProduct);
      if (nextState) toast.success(`⚡ Added ${p.name} to Quick Grid!`);
      else toast.info(`Removed ${p.name} from Quick Grid.`);
    } catch { toast.error("Failed to sync grid state"); }
  };

  const handleLogWaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wasteProduct || !userId) return;
    const qty = parseFloat(wasteQty);
    if (isNaN(qty) || qty <= 0 || qty > wasteProduct.stock) return toast.error("Pakilagay ang tamang dami");
    setWasteSubmitting(true);
    const newStock = wasteProduct.stock - qty;
    const totalLoss = wasteProduct.cost * qty;
    const businessDate = new Date().toISOString().split("T")[0];
    const formattedTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    try {
      const final = { ...wasteProduct, stock: newStock };
      setProducts(products.map((p) => p.id === wasteProduct.id ? final : p));
      await sbUpdateProduct(userId, final);
      addStockLog({ id: uid(), date: new Date().toISOString(), productId: wasteProduct.id, delta: -qty, reason: `[TAPON_${wasteReason.toUpperCase()}]` });
      addAntiKupit({ id: uid(), date: new Date().toISOString(), type: "stock_waste", item: wasteProduct.name, reason: `Bawas -${qty} ${((wasteProduct as any).unit || "pcs")} (${wasteReason}). Lugi: ₱${totalLoss}` });
      const { supabase } = await import("@/lib/supabase");
      await supabase.from("inventory_waste_logs").insert([{
        id: crypto.randomUUID(), product_id: wasteProduct.id, product_name: wasteProduct.name,
        qty, cost_price: wasteProduct.cost, total_loss: totalLoss, reason: wasteReason,
        logged_time: formattedTime, created_date: businessDate, user_id: userId,
      }]);
      toast.success("Na-log ang sira/expired!");
      setWasteProduct(null); setWasteQty("1");
    } catch { toast.error("Error saving waste log"); }
    finally { setWasteSubmitting(false); }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name) return toast.error("Name required");
    setSaving(true);
    try {
      let image_url = editing.image_url;
      if (pendingImage) {
        const productId = editing.id || uid();
        const url = await uploadProductImage(userId, productId, pendingImage);
        if (url) image_url = url;
      }
      const finalProduct: Product = { ...editing, image_url, id: editing.id || uid() };
      if (editing.id) {
        setProducts(products.map((p) => p.id === editing.id ? finalProduct : p));
        await sbUpdateProduct(userId, finalProduct);
        toast.success("Updated");
      } else {
        setProducts([finalProduct, ...products]);
        await sbAddProduct(userId, finalProduct);
        toast.success("Added");
      }
      setPendingImage(null); setEditing(null);
    } catch { toast.error("Save failed"); }
    finally { setSaving(false); }
  };

  const mergeWithExisting = () => {
    if (!dupConfirm) return;
    setEditing({ ...dupConfirm.existing });
    setPendingImage(null); setDupConfirm(null);
  };
  const keepSeparate = () => {
    if (!dupConfirm || !editing) return;
    setEditing((prev) => prev ? { ...prev, barcode: dupConfirm.scannedBarcode } : prev);
    setDupConfirm(null);
  };

  const editingDisplayImage = pendingImage ?? editing?.image_url;

  /* ════════════════════════════════════════
     SCANNER OVERLAY (shared styles)
  ════════════════════════════════════════ */
  const ScannerOverlay = ({ containerId, ready, showCorners = true }: { containerId: string; ready: boolean; showCorners?: boolean }) => (
    <>
      <style>{`
        #${containerId} { width:100%; height:100%; position:relative; background:#000; }
        #${containerId} video {
          width:100% !important; height:100% !important;
          object-fit:cover !important; position:absolute !important;
          top:0 !important; left:0 !important; display:block !important;
          /* iOS Safari + Android Chrome WebView inline-play */
          playsinline:true !important; -webkit-playsinline:true !important;
          autoplay:true !important; -webkit-autoplay:true !important;
          muted:true !important; -webkit-muted:true !important;
        }
        #${containerId} img[alt="Info icon"] { display:none !important; }
        #${containerId}__scan_region > div { display:none !important; }
        #${containerId}__dashboard      { display:none !important; }
        #${containerId}__header_message { display:none !important; }
        #${containerId}__filescan_input { display:none !important; }
        @keyframes inv-sweep {
          0%,100% { top: 20%; }
          50%      { top: 68%; }
        }
      `}</style>
      {ready && showCorners && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute inset-0" style={{
            background: "radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,0.72) 100%)"
          }} />
          {/* scan zone border */}
          <div className="absolute" style={{
            left: "10%", right: "10%", top: "20%", bottom: "24%",
            border: "1.5px solid rgba(251,191,36,0.35)", borderRadius: 6,
          }} />
          {/* corner brackets */}
          {[
            "left-[10%] top-[20%] rounded-tl border-l-[3px] border-t-[3px]",
            "right-[10%] top-[20%] rounded-tr border-r-[3px] border-t-[3px]",
            "left-[10%] bottom-[24%] rounded-bl border-b-[3px] border-l-[3px]",
            "right-[10%] bottom-[24%] rounded-br border-b-[3px] border-r-[3px]",
          ].map((cls, i) => (
            <span key={i} className={`absolute h-6 w-6 border-amber-400 ${cls}`}
              style={{ filter: "drop-shadow(0 0 6px rgba(251,191,36,0.85))" }} />
          ))}
          {/* sweep line */}
          <div className="absolute" style={{
            left: "10%", right: "10%", height: 2,
            background: "linear-gradient(90deg, transparent, rgba(251,191,36,0.9), transparent)",
            animation: "inv-sweep 1.8s ease-in-out infinite",
            boxShadow: "0 0 10px 3px rgba(251,191,36,0.45)",
          }} />
        </div>
      )}
      {!ready && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          <p className="text-[11px] text-white/30">Starting camera…</p>
        </div>
      )}
    </>
  );

  /* ════════════════════════════════════════
     RENDER
  ════════════════════════════════════════ */
  return (
    <div className="space-y-3 p-4">
      {/* search + filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name or barcode…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 flex items-center gap-1 shrink-0" onClick={() => setPamalengkeOpen(true)}>
          <ClipboardList className="h-4 w-4" /><span className="hidden sm:inline">Listahan</span>
        </Button>
        <Button onClick={() => { setEditing(blank()); setPendingImage(null); }} className="shrink-0">
          <Plus className="mr-1 h-4 w-4" />New
        </Button>
      </div>

      {/* product list */}
      {list.map((p) => {
        const low = p.stock <= settings.lowStockThreshold;
        const img = p.image_url;
        const isQuickGridActive = (p as any).is_quick_grid === true;
        const productUnit = (p as any).unit || "pcs";
        return (
          <Card key={p.id} className="overflow-hidden">
            <CardContent className="flex items-center gap-3 p-3">
              <div className="h-14 w-14 shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center cursor-pointer" onClick={() => img && setPreviewImage(img)}>
                {img ? <img src={img} alt={p.name} className="h-full w-full object-cover hover:opacity-80 transition-opacity" /> : <Package className="h-6 w-6 text-muted-foreground/40" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold truncate">{p.name}</span>
                  {low && <Badge variant="destructive" className="text-[10px] shrink-0">LOW</Badge>}
                  {isQuickGridActive && <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] font-bold shrink-0">⚡ QUICK GRID</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">{p.category || "Uncategorized"} · {p.barcode || "no barcode"}</div>
                <div className="text-xs mt-0.5 flex gap-3">
                  <span>Stock: <button className="underline font-bold text-slate-200" onClick={() => setStockEdit({ product: p, newStock: p.stock })}>{p.stock} <span className="text-muted-foreground font-normal">{productUnit}</span></button></span>
                  <span>Cost {fmt(p.cost, settings.currency)}</span>
                  <span>Sell {fmt(p.price, settings.currency)}</span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0 items-center">
                <Button size="icon" variant="ghost" onClick={() => toggleQuickGridRow(p)} className={`h-9 w-9 ${isQuickGridActive ? "text-amber-400" : "text-muted-foreground"}`}>
                  <Zap className="h-4 w-4" fill={isQuickGridActive ? "currentColor" : "none"} />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setWasteProduct(p)} className="text-orange-400 h-9 w-9"><AlertTriangle className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setPendingImage(null); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(p)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* ══════════════════════════════════
          BARCODE SCANNER DIALOG — POS-quality
      ══════════════════════════════════ */}
      <Dialog open={scannerOpen} onOpenChange={(o) => { if (!o) { setScannerOpen(false); } }}>
        <DialogContent className="max-w-sm p-0 overflow-hidden rounded-2xl bg-zinc-950 border border-slate-800">
          <div className="relative w-full overflow-hidden" style={{ height: 260 }}>
            <div id={SCANNER_DIV_ID} style={{ position: "absolute", inset: 0 }} />
            <ScannerOverlay containerId={SCANNER_DIV_ID} ready={scannerReady} />

            {/* status pill */}
            <div className="absolute bottom-3 left-0 right-0 z-20 flex justify-center">
              <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 backdrop-blur-md text-xs font-medium
                ${scannerReady ? "bg-black/50 text-white/80" : "bg-black/40 text-white/30"}`}>
                <div className={`h-1.5 w-1.5 rounded-full ${scannerReady ? "bg-amber-400 animate-pulse" : "bg-white/20"}`} />
                {scannerReady ? "Point at barcode" : "Initializing…"}
              </div>
            </div>

            {/* torch button */}
            {torchAvail && scannerReady && (
              <div className="absolute top-3 right-3 z-20">
                <button onClick={toggleTorch}
                  className={`flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md transition-all
                    ${torchOn ? "bg-yellow-400/90 text-black" : "bg-black/50 text-white/70 border border-white/20"}`}>
                  {torchOn ? <Flashlight className="h-4 w-4" /> : <FlashlightOff className="h-4 w-4" />}
                </button>
              </div>
            )}

            {/* close button */}
            <button onClick={() => setScannerOpen(false)}
              className="absolute top-3 left-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/70 backdrop-blur-md border border-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-xs text-slate-400">Scan the product barcode to auto-fill</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════
          PHOTO CAMERA DIALOG — high-fps video
      ══════════════════════════════════ */}
      <Dialog open={cameraOpen} onOpenChange={(o) => { if (!o) { stopCamera(); setCameraOpen(false); } }}>
        <DialogContent className="max-w-sm p-0 overflow-hidden rounded-2xl bg-zinc-950 border border-slate-800">
          <div className="relative w-full overflow-hidden" style={{ height: 320 }}>
            <div id={CAMERA_DIV_ID} style={{ position: "absolute", inset: 0 }} />

            {/* camera styles — no scan overlay, just clean video */}
            <style>{`
              #${CAMERA_DIV_ID} { width:100%; height:100%; position:relative; background:#000; }
              #${CAMERA_DIV_ID} video {
                width:100% !important; height:100% !important;
                object-fit:cover !important; position:absolute !important;
                top:0 !important; left:0 !important; display:block !important;
                /* iOS Safari + Android Chrome WebView inline-play */
                playsinline:true !important; -webkit-playsinline:true !important;
                autoplay:true !important; -webkit-autoplay:true !important;
                muted:true !important; -webkit-muted:true !important;
              }
              #${CAMERA_DIV_ID} img[alt="Info icon"] { display:none !important; }
              #${CAMERA_DIV_ID}__scan_region > div { display:none !important; }
              #${CAMERA_DIV_ID}__dashboard { display:none !important; }
              #${CAMERA_DIV_ID}__header_message { display:none !important; }
              #${CAMERA_DIV_ID}__filescan_input { display:none !important; }
            `}</style>

            {!camReady && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                <p className="text-[11px] text-white/30">Starting camera…</p>
              </div>
            )}

            {/* viewfinder guide */}
            {camReady && (
              <div className="pointer-events-none absolute inset-0 z-10">
                <div className="absolute inset-0" style={{
                  background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)"
                }} />
                {/* round guide circle */}
                <div className="absolute" style={{
                  left: "25%", right: "25%", top: "15%", bottom: "15%",
                  border: "2px solid rgba(59,130,246,0.5)", borderRadius: "50%",
                  boxShadow: "0 0 0 2000px rgba(0,0,0,0.18)",
                }} />
              </div>
            )}

            {/* controls row */}
            <div className="absolute bottom-4 left-0 right-0 z-20 flex items-center justify-center gap-6">
              {/* flip camera */}
              <button onClick={flipCamera}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white/70 backdrop-blur-md border border-white/10">
                <RotateCcw className="h-4 w-4" />
              </button>
              {/* shutter */}
              <button onClick={capturePhoto} disabled={!camReady}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-lg border-4 border-white/30 active:scale-95 transition-transform disabled:opacity-40">
                <Camera className="h-6 w-6 text-zinc-900" />
              </button>
              {/* close */}
              <button onClick={() => { stopCamera(); setCameraOpen(false); }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white/70 backdrop-blur-md border border-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-xs text-slate-400">Center the product, then tap the shutter button</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════
          ADD / EDIT PRODUCT DIALOG
      ══════════════════════════════════ */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { stopScanner(); setScannerOpen(false); stopCamera(); setCameraOpen(false); setEditing(null); setPendingImage(null); } }}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Product" : "Add Product"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              {/* photo block */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative h-28 w-28 rounded-xl overflow-hidden bg-muted flex items-center justify-center border cursor-pointer"
                  onClick={() => editingDisplayImage && setPreviewImage(editingDisplayImage)}>
                  {editingDisplayImage
                    ? <>
                        <img src={editingDisplayImage} alt="Product" className="h-full w-full object-cover" />
                        <button onClick={(e) => { e.stopPropagation(); setPendingImage(null); setEditing({ ...editing, image_url: undefined }); }}
                          className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5">
                          <X className="h-3 w-3 text-white" />
                        </button>
                      </>
                    : <Package className="h-10 w-10 text-muted-foreground/30" />}
                </div>
                <Button size="sm" variant="outline" onClick={() => openCamera("environment")}>
                  <Camera className="h-4 w-4 mr-1" />
                  {editingDisplayImage ? "Retake Photo" : "Take Photo"}
                </Button>
              </div>

              {/* barcode row */}
              <div className="space-y-1">
                <Label>Barcode</Label>
                <div className="flex gap-2">
                  <Input value={editing.barcode ?? ""} placeholder="Scan or type barcode"
                    onChange={(e) => setEditing({ ...editing, barcode: e.target.value })} />
                  <Button size="icon" variant="outline" onClick={() => setScannerOpen(true)}>
                    <ScanLine className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Name *</Label>
                <Input value={editing.name} placeholder="Product name"
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>

              <div className="space-y-1">
                <Label>Category</Label>
                <Select value={editing.category || ""} onValueChange={(v) => setEditing({ ...editing, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between bg-zinc-900/30 p-2.5 rounded-xl border border-slate-800/60">
                <Label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" /> Quick Grid Visibility
                </Label>
                <Button type="button" size="sm" variant={(editing as any).is_quick_grid ? "default" : "outline"}
                  className={(editing as any).is_quick_grid ? "bg-amber-500 text-black font-bold h-8 text-[11px]" : "border-slate-800 h-8 text-[11px]"}
                  onClick={() => setEditing({ ...editing, is_quick_grid: !(editing as any).is_quick_grid } as any)}>
                  {(editing as any).is_quick_grid ? "Naka-On ⚡" : "Naka-Off"}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Stock Volume</Label>
                  <Input type="number" step="any" value={editing.stock}
                    onChange={(e) => setEditing({ ...editing, stock: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label>Unit Size</Label>
                  <Select value={(editing as any).unit || "pcs"} onValueChange={(v) => setEditing({ ...editing, unit: v } as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>Cost Price</Label><Input type="number" step="any" value={editing.cost} onChange={(e) => setEditing({ ...editing, cost: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label>Selling Price</Label><Input type="number" step="any" value={editing.price} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { stopScanner(); setScannerOpen(false); stopCamera(); setCameraOpen(false); setEditing(null); setPendingImage(null); }}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving…</> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waste Log Dialog */}
      <Dialog open={!!wasteProduct} onOpenChange={(o) => !o && setWasteProduct(null)}>
        <DialogContent className="max-w-xs bg-[#121824] border border-slate-800 text-slate-100 rounded-xl">
          <DialogHeader><DialogTitle className="text-white font-bold flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-orange-400" /> I-log ang Sira / Expired</DialogTitle></DialogHeader>
          {wasteProduct && (
            <form onSubmit={handleLogWaste} className="space-y-3.5 text-left pt-1">
              <div className="bg-[#090d16]/40 p-2.5 rounded-lg border border-slate-800/60 text-xs">
                <p className="text-slate-400">Item: <span className="text-white font-bold">{wasteProduct.name}</span></p>
                <p className="text-slate-400 mt-1">Kasalukuyang Stock: <span className="text-amber-400 font-mono font-bold">{wasteProduct.stock} {(wasteProduct as any).unit || "pcs"}</span></p>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ilan ang itatapon?</Label>
                <Input type="number" step="any" inputMode="decimal" required min={0.001} max={wasteProduct.stock} value={wasteQty} onChange={(e) => setWasteQty(e.target.value)} className="bg-[#090d16] border-slate-800 text-xs h-9 font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Dahilan</Label>
                <Select value={wasteReason} onValueChange={setWasteReason}>
                  <SelectTrigger className="bg-[#090d16] border-slate-800 text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#121824] border-slate-800 text-white">
                    <SelectItem value="Sira / Nabasag">Sira / Nabasag</SelectItem>
                    <SelectItem value="Expired">Expired</SelectItem>
                    <SelectItem value="Correction">Maling Bilang (Correction)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setWasteProduct(null)} className="flex-1 border-slate-800 text-xs h-9">Cancel</Button>
                <Button type="submit" disabled={wasteSubmitting} className="flex-1 bg-orange-600 text-white font-bold text-xs h-9">
                  {wasteSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "I-record ang Lugi"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Stock Adjust Dialog */}
      <Dialog open={!!stockEdit} onOpenChange={(o) => !o && setStockEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adjust stock — {stockEdit?.product.name}</DialogTitle></DialogHeader>
          {stockEdit && (
            <div className="space-y-2">
              <Label>New stock count (Supports decimals for kilos)</Label>
              <Input type="number" step="any" value={stockEdit.newStock} onChange={(e) => setStockEdit({ ...stockEdit, newStock: Number(e.target.value) })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockEdit(null)}>Cancel</Button>
            <Button onClick={() => setStockPin(true)}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OwnerPinPrompt
        open={stockPin} onOpenChange={setStockPin} requireReason title="Confirm stock adjustment"
        onConfirm={async (reason) => {
          if (!stockEdit) return;
          const { product: p, newStock } = stockEdit;
          const delta = newStock - p.stock;
          setProducts(products.map((x) => x.id === p.id ? { ...x, stock: newStock } : x));
          await sbUpdateProduct(userId, { ...p, stock: newStock });
          addStockLog({ id: uid(), date: new Date().toISOString(), productId: p.id, delta, reason });
          addAntiKupit({ id: uid(), date: new Date().toISOString(), type: "stock_adjust", item: p.name, reason: `${delta > 0 ? "+" : ""}${delta}: ${reason}` });
          setStockEdit(null);
          toast.success("Stock adjusted");
        }}
      />

      {/* Duplicate barcode confirm */}
      <Dialog open={!!dupConfirm} onOpenChange={(o) => !o && setDupConfirm(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Duplicate Barcode</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This barcode already belongs to <span className="font-bold text-slate-200">{dupConfirm?.existing.name}</span>. What do you want to do?
          </p>
          <DialogFooter className="flex gap-2 flex-col sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={keepSeparate}>Use Anyway</Button>
            <Button className="flex-1" onClick={mergeWithExisting}>Edit That Product</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image preview */}
      <Dialog open={!!previewImage} onOpenChange={(o) => !o && setPreviewImage(null)}>
        <DialogContent className="max-w-sm p-2 bg-zinc-950 border-slate-800">
          {previewImage && <img src={previewImage} alt="Preview" className="w-full rounded-xl object-contain max-h-[70vh]" />}
        </DialogContent>
      </Dialog>

      {/* Pamalengke List Dialog */}
      <Dialog open={pamalengkeOpen} onOpenChange={setPamalengkeOpen}>
        <DialogContent className="max-w-sm max-h-[80vh] overflow-y-auto bg-[#121824] text-slate-100 rounded-xl">
          <DialogHeader><DialogTitle className="text-white font-bold flex items-center gap-2 text-sm"><ClipboardList className="h-4 w-4 text-amber-400" /> Listahan ng Pamalengke</DialogTitle></DialogHeader>
          <div className="space-y-2.5 my-2 max-h-[50vh] overflow-y-auto pr-1">
            {lowStockItems.length === 0
              ? <div className="text-center py-8 text-xs text-slate-500">Kumpleto pa ang iyong stocks! 🎉</div>
              : lowStockItems.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-2.5 border border-slate-800 bg-[#090d16]/30 text-xs rounded-xl">
                    <div className="min-w-0 flex-1"><p className="font-semibold text-slate-200 truncate">{p.name}</p></div>
                    <Badge variant="destructive" className="font-mono text-[11px]">Stock: {p.stock} {(p as any).unit || "pcs"}</Badge>
                  </div>
                ))
            }
          </div>
          <DialogFooter className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setPamalengkeOpen(false)} className="flex-1 border-slate-800 text-xs h-9">Isara</Button>
            <Button type="button" onClick={copyPamalengkeList} disabled={lowStockItems.length === 0} className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs h-9 flex items-center gap-1.5">
              <Copy className="h-3.5 w-3.5" /> Kopyahin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
