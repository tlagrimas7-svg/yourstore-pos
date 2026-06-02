import { useState, useEffect, useCallback } from "react";
import { bleScanner, blePrinter, type BTStatus } from "@/lib/bluetooth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bluetooth, BluetoothOff, Printer, ScanLine } from "lucide-react";
import { toast } from "sonner";

function statusColor(s: BTStatus) {
  if (s === "connected")   return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
  if (s === "connecting")  return "text-yellow-400 border-yellow-500/40 bg-yellow-500/10";
  if (s === "unsupported") return "text-amber-400 border-amber-500/40 bg-amber-500/10";
  return "text-muted-foreground border-white/10 bg-white/5";
}

function statusLabel(s: BTStatus) {
  if (s === "connected")   return "Connected";
  if (s === "connecting")  return "Connecting…";
  if (s === "unsupported") return "Unsupported";
  return "Disconnected";
}

export function BluetoothPanel() {
  const [scannerStatus, setScannerStatus] = useState<BTStatus>(bleScanner.status);
  const [printerStatus, setPrinterStatus] = useState<BTStatus>(blePrinter.status);
  const [scannerName, setScannerName]     = useState<string | null>(bleScanner.getDeviceName());
  const [printerName, setPrinterName]     = useState<string | null>(blePrinter.getDeviceName());
  const [lastBarcode, setLastBarcode]     = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      setScannerStatus(bleScanner.status);
      setPrinterStatus(blePrinter.status);
      setScannerName(bleScanner.getDeviceName());
      setPrinterName(blePrinter.getDeviceName());
    };
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, []);

  const handleScan = useCallback((barcode: string) => {
    setLastBarcode(barcode);
    toast.success(`Scanner: ${barcode}`, { duration: 1500 });
  }, []);

  useEffect(() => {
    bleScanner.onScan = handleScan;
    return () => { bleScanner.onScan = null; };
  }, [handleScan]);

  const connectScanner = async () => {
    if (!bleScanner.isSupported()) {
      toast.error("Bluetooth not supported. Use Chrome/Edge on Android or desktop.");
      return;
    }
    setScannerStatus("connecting");
    const ok = await bleScanner.connect();
    setScannerStatus(bleScanner.status);
    setScannerName(bleScanner.getDeviceName());
    if (ok) toast.success(`Scanner connected: ${bleScanner.getDeviceName() ?? "device"}`);
    else    toast.error("Scanner connection failed");
  };

  const disconnectScanner = () => {
    bleScanner.disconnect();
    setScannerStatus(bleScanner.status);
    setScannerName(null);
    toast("Scanner disconnected");
  };

  const connectPrinter = async () => {
    if (!blePrinter.isSupported()) {
      toast.error("Bluetooth not supported. Use Chrome/Edge on Android or desktop.");
      return;
    }
    setPrinterStatus("connecting");
    const ok = await blePrinter.connect();
    setPrinterStatus(blePrinter.status);
    setPrinterName(blePrinter.getDeviceName());
    if (ok) toast.success(`Printer connected: ${blePrinter.getDeviceName() ?? "device"}`);
    else    toast.error("Printer connection failed. Try a different printer profile.");
  };

  const disconnectPrinter = () => {
    blePrinter.disconnect();
    setPrinterStatus(blePrinter.status);
    setPrinterName(null);
    toast("Printer disconnected");
  };

  const testPrint = async () => {
    const ESC = 0x1b; const GS = 0x1d;
    const bytes = new Uint8Array([
      ESC, 0x40,
      ESC, 0x61, 0x01,
      ESC, 0x21, 0x10,
      ...new TextEncoder().encode("YourStore\n"),
      ESC, 0x21, 0x00,
      ...new TextEncoder().encode("Test print OK\n\n\n"),
      GS, 0x56, 0x41, 0x10,
    ]);
    const ok = await blePrinter.print(bytes);
    if (ok) toast.success("Test print sent!");
    else    toast.error("Print failed — check connection");
  };

  const btSupported = bleScanner.isSupported();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Bluetooth className="h-4 w-4" />
          Bluetooth Devices
        </CardTitle>
        {!btSupported && (
          <p className="text-xs text-amber-400 mt-1">
            ⚠ Web Bluetooth requires Chrome or Edge on Android/desktop. Not available on iOS Safari.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">

        {/* ── Barcode Scanner ── */}
        <div className="rounded-xl border border-white/8 p-3 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 shrink-0">
              <ScanLine className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Barcode Scanner</p>
              <p className="text-xs text-muted-foreground truncate">
                {scannerName ?? "HID scanners work without pairing"}
              </p>
            </div>
            <Badge variant="outline" className={`text-xs shrink-0 ${statusColor(scannerStatus)}`}>
              {statusLabel(scannerStatus)}
            </Badge>
          </div>

          {lastBarcode && (
            <div className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-muted-foreground break-all">
              Last scan: <span className="text-foreground font-mono">{lastBarcode}</span>
            </div>
          )}

          <div className="flex gap-2">
            {scannerStatus !== "connected" ? (
              <Button
                size="sm" className="flex-1"
                disabled={!btSupported || scannerStatus === "connecting"}
                onClick={connectScanner}
              >
                <Bluetooth className="mr-1.5 h-3.5 w-3.5" />
                {scannerStatus === "connecting" ? "Connecting…" : "Connect"}
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="flex-1" onClick={disconnectScanner}>
                <BluetoothOff className="mr-1.5 h-3.5 w-3.5" />
                Disconnect
              </Button>
            )}
          </div>

          {scannerStatus === "connected" && (
            <p className="text-[11px] text-blue-400/80">
              📷 Phone camera is OFF — using physical scanner
            </p>
          )}
        </div>

        {/* ── Receipt Printer ── */}
        <div className="rounded-xl border border-white/8 p-3 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 shrink-0">
              <Printer className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Receipt Printer</p>
              <p className="text-xs text-muted-foreground truncate">
                {printerName ?? "ESC/POS thermal printer"}
              </p>
            </div>
            <Badge variant="outline" className={`text-xs shrink-0 ${statusColor(printerStatus)}`}>
              {statusLabel(printerStatus)}
            </Badge>
          </div>

          <div className="flex gap-2">
            {printerStatus !== "connected" ? (
              <Button
                size="sm" className="flex-1"
                disabled={!btSupported || printerStatus === "connecting"}
                onClick={connectPrinter}
              >
                <Bluetooth className="mr-1.5 h-3.5 w-3.5" />
                {printerStatus === "connecting" ? "Connecting…" : "Connect"}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" className="flex-1" onClick={disconnectPrinter}>
                  <BluetoothOff className="mr-1.5 h-3.5 w-3.5" />
                  Disconnect
                </Button>
                <Button size="sm" variant="secondary" onClick={testPrint}>
                  Test Print
                </Button>
              </>
            )}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Bluetooth connections restore automatically when you return to POS. Use Chrome or Edge for best compatibility.
        </p>
      </CardContent>
    </Card>
  );
}
