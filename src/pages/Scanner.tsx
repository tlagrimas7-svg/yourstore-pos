import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useNavigate } from "@tanstack/react-router";
import { useStore, uid } from "@/lib/storage";
import type { Product, Transaction } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Receipt, printReceipt } from "@/components/Receipt";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Printer, X, Plus, Minus } from "lucide-react";
import { fmt } from "@/lib/format";
import { toast } from "sonner";

export function Scanner() {
  const navigate = useNavigate();
  const {
    products,
    transactions,
    setProducts,
    setTransactions,
    settings,
    addToPosCart,
  } = useStore();

  const [matched, setMatched] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [receipt, setReceipt] = useState<Transaction | null>(null);
  const [scannerReady, setScannerReady] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const productsRef = useRef(products);
  const lastScannedRef = useRef<string | null>(null);
  const scanCooldownRef = useRef(false);
  const matchedRef = useRef<Product | null>(null);
  const qtyRef = useRef(1);
  const addToPosCartRef = useRef(addToPosCart);

  useEffect(() => { productsRef.current = products; }, [products]);
  useEffect(() => { matchedRef.current = matched; }, [matched]);
  useEffect(() => { qtyRef.current = qty; }, [qty]);
  useEffect(() => { addToPosCartRef.current = addToPosCart; }, [addToPosCart]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.id = "qr-reader";
    const scanner = new Html5Qrcode("qr-reader");

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 30,
          qrbox: { width: 200, height: 200 },
          ...({ experimentalFeatures: { useBarCodeDetectorIfSupported: true } } as any),
        },
        (decoded) => {
          if (scanCooldownRef.current) return;
          scanCooldownRef.current = true;
          setTimeout(() => { scanCooldownRef.current = false; }, 300);

          const p = productsRef.current.find(
            (x) => x.barcode === decoded || x.id === decoded
          );
          if (!p) { toast.error(`No product: ${decoded}`); return; }

          if (lastScannedRef.current === decoded && matchedRef.current) {
            setQty((q) => q + 1);
            toast.success(`+1 ${p.name}`);
            return;
          }

          if (matchedRef.current) {
            addToPosCartRef.current({
              productId: matchedRef.current.id,
              name: matchedRef.current.name,
              qty: qtyRef.current,
              price: matchedRef.current.price,
              cost: matchedRef.current.cost,
            });
            toast.success(`✓ ${matchedRef.current.name} added to cart`);
          }

          lastScannedRef.current = decoded;
          setMatched(p);
          setQty(1);
        },
        () => {}
      )
      .then(() => setScannerReady(true))
      .catch(() => toast.error("Cannot access camera"));

    return () => { scanner.stop().catch(() => {}); scanner.clear().catch(() => {}); };
  }, []);

  const total = matched ? matched.price * qty : 0;

  const addToCart = useCallback(() => {
    if (!matched) return;
    addToPosCart({ productId: matched.id, name: matched.name, qty, price: matched.price, cost: matched.cost });
    toast.success(`Added ${qty} × ${matched.name} to cart`);
    setMatched(null);
    lastScannedRef.current = null;
    navigate({ to: "/pos" });
  }, [matched, qty, addToPosCart, navigate]);

  const quickSell = useCallback(() => {
    if (!matched) return;
    if (matched.stock < qty) return toast.error("Insufficient stock");
    const tx: Transaction = {
      id: uid(),
      date: new Date().toISOString(),
      items: [{ productId: matched.id, name: matched.name, qty, price: matched.price, cost: matched.cost }],
      subtotal: total, discount: 0, total, paid: total, change: 0,
    };
    setTransactions([tx, ...transactions]);
    setProducts(products.map((p) => p.id === matched.id ? { ...p, stock: p.stock - qty } : p));
    setReceipt(tx);
    setMatched(null);
    lastScannedRef.current = null;
  }, [matched, qty, total, transactions, products, setTransactions, setProducts]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <h2 className="font-semibold">Scanner</h2>
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/pos" })}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Camera box — compact, centered */}
      <div className="shrink-0 flex items-center justify-center bg-black" style={{ height: 260 }}>
        <div
          ref={containerRef}
          style={{ width: 260, height: 260, overflow: "hidden", borderRadius: 12, border: "2px solid rgba(255,255,255,0.15)" }}
        />
      </div>

      {!scannerReady && (
        <p className="text-center text-xs text-white/40 py-1 shrink-0">Starting camera…</p>
      )}

      <div className="shrink-0 border-t border-white/10 mx-4 my-2" />

      {/* Product card */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {matched ? (
          <Card className="bg-zinc-900 border-zinc-700 text-white">
            <CardContent className="p-4 space-y-3">
              <div>
                <div className="text-xl font-bold">{matched.name}</div>
                <div className="text-sm text-zinc-400 mt-0.5">
                  {fmt(matched.price, settings.currency)} each · {matched.stock} in stock
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" className="border-zinc-600 shrink-0"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}>
                  <Minus className="h-4 w-4" />
                </Button>
                <Input type="number" className="w-16 text-center bg-zinc-800 border-zinc-600"
                  value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} />
                <Button size="icon" variant="outline" className="border-zinc-600 shrink-0"
                  onClick={() => setQty((q) => q + 1)}>
                  <Plus className="h-4 w-4" />
                </Button>
                <div className="ml-auto text-xl font-bold text-green-400">
                  {fmt(total, settings.currency)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" className="bg-zinc-700 hover:bg-zinc-600" onClick={addToCart}>
                  Add to Cart
                </Button>
                <Button className="bg-green-600 hover:bg-green-500" onClick={quickSell}>
                  Quick Sell
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm text-center gap-2">
            <div className="text-5xl">📦</div>
            <p>Point camera at a barcode or QR code</p>
            <p className="text-xs">Items auto-add to cart on scan</p>
          </div>
        )}
      </div>

      {/* Receipt Dialog */}
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
