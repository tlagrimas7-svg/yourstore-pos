import { useState, useEffect } from "react";
import { useStore } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { bleScanner, blePrinter, isBTSupported, type BTStatus } from "@/lib/bluetooth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { OwnerPinPrompt } from "@/components/PinPrompt";
import { SystemGatewaySettings } from "@/components/SystemGatewaySettings";
import { toast } from "sonner";
import { Bluetooth, Printer, ScanLine, Bot, Eye, EyeOff, Crown, Receipt, RotateCcw } from "lucide-react";
import { useSession } from "@/App";

const PAGE_PIN_DEFS = [
  { path: "/",          label: "Home"    },
  { path: "/inventory", label: "Stock"   },
  { path: "/expenses",  label: "Expense" },
  { path: "/utang",     label: "Utang"   },
  { path: "/summary",   label: "Summary" },
];

const AI_PROVIDERS = [
  { id: "groq",    label: "Groq AI (Whisper + Llama)", description: "Forced Tagalog (tl) Whisper-large-v3 translation engine.", keyLabel: "Groq API Key" },
  { id: "none",    label: "Local only (Fuse.js)",      description: "No AI, fully offline. Free.",              keyLabel: null },
  { id: "claude",  label: "Claude (Anthropic)",        description: "Best Tagalog reasoning.",                 keyLabel: "Anthropic API Key" },
  { id: "gemini",  label: "Gemini (Google)",           description: "Free tier available, good Tagalog.",       keyLabel: "Gemini API Key" },
  { id: "mistral", label: "Mistral AI",                description: "Fast and cost-effective.",                 keyLabel: "Mistral API Key" },
  { id: "openai",  label: "OpenAI GPT",                description: "Very capable, wider coverage.",             keyLabel: "OpenAI API Key" },
];

const AI_STORAGE_KEY = "ysm_ai_provider";
const AI_KEY_PREFIX   = "ysm_ai_key_";

// ── Transaction number helpers (exported for use in POS.tsx) ──────────────────
export function getNextTransactionNumber(): string {
  const last = parseInt(localStorage.getItem("ysm_txn_counter") ?? "0", 10);
  const next = last + 1;
  localStorage.setItem("ysm_txn_counter", String(next));
  return String(next).padStart(6, "0");
}

export function getCurrentTransactionCount(): number {
  return parseInt(localStorage.getItem("ysm_txn_counter") ?? "0", 10);
}

export function resetTransactionCounter() {
  localStorage.setItem("ysm_txn_counter", "0");
}
// ─────────────────────────────────────────────────────────────────────────────

function statusBadge(status: BTStatus) {
  if (status === "connected")   return <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs px-2.5 py-1">Connected</Badge>;
  if (status === "connecting")  return <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs px-2.5 py-1">Connecting…</Badge>;
  if (status === "unsupported") return <Badge className="bg-slate-800 text-slate-400 border border-slate-700/60 text-xs px-2.5 py-1">Capacitor Mode</Badge>;
  return <Badge className="bg-slate-900 text-slate-500 border border-slate-800 text-xs px-2.5 py-1">Disconnected</Badge>;
}

function BTIcon({ status }: { status: BTStatus }) {
  if (status === "connected")   return <Bluetooth className="h-4 w-4 text-emerald-400" />;
  if (status === "unsupported") return <Bluetooth className="h-4 w-4 text-amber-400" />;
  return <Bluetooth className="h-4 w-4 text-blue-500" />;
}

function AIProviderSettings() {
  const access = useSession((s) => s.access);
  const isProPlan = access?.plan === "pro";

  const [selectedProvider, setSelectedProvider] = useState<string>(
    () => localStorage.getItem(AI_STORAGE_KEY) ?? "groq"
  );
  const [keys, setKeys] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      AI_PROVIDERS
        .filter((p) => p.keyLabel)
        .map((p) => {
          let savedKey = localStorage.getItem(AI_KEY_PREFIX + p.id) ?? "";
          if (p.id === "groq" && !savedKey) savedKey = localStorage.getItem("ysm_groq_key") ?? "";
          return [p.id, savedKey];
        })
    )
  );
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const saveProvider = (id: string) => {
    if (!isProPlan) { toast.error("Upgrade required: Voice Cashier settings are restricted to Pro accounts."); return; }
    setSelectedProvider(id);
    localStorage.setItem(AI_STORAGE_KEY, id);
    toast.success(`AI provider set to: ${AI_PROVIDERS.find((p) => p.id === id)?.label}`);
  };

  const saveKey = (providerId: string) => {
    if (!isProPlan) return;
    const val = keys[providerId]?.trim();
    if (!val) {
      localStorage.removeItem(AI_KEY_PREFIX + providerId);
      if (providerId === "groq") localStorage.removeItem("ysm_groq_key");
      toast("API key cleared.");
      return;
    }
    localStorage.setItem(AI_KEY_PREFIX + providerId, val);
    if (providerId === "groq") localStorage.setItem("ysm_groq_key", val);
    toast.success("API key saved.");
  };

  const toggleShowKey = (id: string) => setShowKey((prev) => ({ ...prev, [id]: !prev[id] }));
  const current = AI_PROVIDERS.find((p) => p.id === selectedProvider);

  return (
    <Card className="bg-[#121824] border-slate-800/80 shadow-md text-slate-100 relative overflow-hidden">
      <CardHeader className="border-b border-slate-800/60 pb-4">
        <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
          <Bot className="h-4 w-4 text-purple-400" />
          Voice Cashier AI Provider
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Fuse.js always runs first (offline, free). AI is only called when fuzzy matching is ambiguous.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-4 relative">
        {!isProPlan && (
          <div className="absolute inset-0 bg-[#121824]/80 backdrop-blur-[1.5px] z-10 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl mb-2.5 shadow-md">
              <Crown className="h-5 w-5 animate-pulse" />
            </div>
            <h4 className="text-sm font-bold text-white tracking-wide">Premium Module Required</h4>
            <p className="text-xs text-slate-400 max-w-xs mt-1 leading-relaxed">
              Your active plan tier (<span className="text-amber-400 font-bold uppercase">{access?.plan || "trial"}</span>) does not support automated voice translation processing.
            </p>
            <p className="text-[11px] text-slate-500 mt-2 italic">Contact management to activate your Pro license layout tier.</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2">
          {AI_PROVIDERS.map((p) => (
            <button key={p.id} type="button" disabled={!isProPlan} onClick={() => saveProvider(p.id)}
              className={`text-left rounded-xl border p-3 transition-all flex flex-col justify-between ${
                selectedProvider === p.id && isProPlan
                  ? "border-purple-500/60 bg-purple-500/5 text-white"
                  : "border-slate-800 bg-[#090d16]/40 text-slate-300 hover:border-slate-700"
              }`}>
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-bold tracking-wide">{p.label}</span>
                {selectedProvider === p.id && isProPlan && (
                  <span className="flex items-center gap-1 text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">Active</span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{p.description}</p>
            </button>
          ))}
        </div>
        {current?.keyLabel && isProPlan && (
          <div className="space-y-2 pt-3 border-t border-slate-800/60">
            <Label className="text-xs font-bold text-slate-400">{current.keyLabel}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey[selectedProvider] ? "text" : "password"}
                  placeholder="Paste your API key layout parameters…"
                  value={keys[selectedProvider] ?? ""}
                  onChange={(e) => setKeys((k) => ({ ...k, [selectedProvider]: e.target.value }))}
                  className="w-full bg-[#090d16] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none font-mono placeholder:text-slate-600"
                />
                <button type="button" onClick={() => toggleShowKey(selectedProvider)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  {showKey[selectedProvider] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button size="sm" onClick={() => saveKey(selectedProvider)} className="bg-purple-600 hover:bg-purple-700 font-bold text-xs px-4">Save</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Settings() {
  const { settings, setSettings, pins, setPins, clearAll } = useStore();
  const [s, setS] = useState(settings);
  const [newCat, setNewCat] = useState("");
  const [pinChange, setPinChange] = useState<null | "owner" | "employee">(null);
  const [newPin, setNewPin] = useState("");
  const [newPinReady, setNewPinReady] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmResetTxn, setConfirmResetTxn] = useState(false);
  const [txnCount, setTxnCount] = useState(getCurrentTransactionCount);

  const [scannerStatus, setScannerStatus] = useState<BTStatus>("disconnected");
  const [printerStatus, setPrinterStatus] = useState<BTStatus>("disconnected");

  useEffect(() => {
    bleScanner.onStatusChange = setScannerStatus;
    blePrinter.onStatusChange = setPrinterStatus;
    setScannerStatus(bleScanner.status);
    setPrinterStatus(blePrinter.status);
    return () => {
      bleScanner.onStatusChange = null;
      blePrinter.onStatusChange = null;
    };
  }, []);

  const pagePins: Record<string, string> = (pins as any).pages ?? {};
  const [pagePinDraft, setPagePinDraft] = useState<Record<string, string>>(
    Object.fromEntries(PAGE_PIN_DEFS.map(({ path }) => [path, pagePins[path] ?? ""]))
  );

  const saveSettings = () => { setSettings(s); toast.success("Saved"); };

  const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setS({ ...s, logo: r.result as string });
    r.readAsDataURL(f);
  };

  const savePagePin = (path: string, label: string) => {
    const val = pagePinDraft[path].replace(/\D/g, "").slice(0, 4);
    if (val && val.length !== 4) { toast.error(`${label} PIN must be 4 digits`); return; }
    const updated = { ...pagePins };
    if (val) updated[path] = val;
    else delete updated[path];
    setPins({ ...pins, pages: updated } as any);
    toast.success(val ? `${label} PIN saved` : `${label} PIN cleared`);
  };

  const connectScanner = async () => {
    if (scannerStatus === "connected") { bleScanner.disconnect(); toast("Scanner disconnected"); return; }
    toast("Initializing BLE scanner link...");
    const ok = await bleScanner.connect();
    if (ok) toast.success("Scanner connected successfully!");
    else toast.error("Connection trace dropped. Retrying via standard pairings.");
  };

  const connectPrinter = async () => {
    if (printerStatus === "connected") { blePrinter.disconnect(); toast("Printer disconnected"); return; }
    toast("Opening thermal print track connection stream...");
    const ok = await blePrinter.connect();
    if (ok) toast.success("Thermal Printer linked to checkout stream!");
    else toast.error("Could not bind hardware. Check power levels and range boundaries.");
  };

  return (
    <div className="space-y-4 p-4 text-slate-100 max-w-4xl mx-auto selection:bg-slate-800 pb-20">

      {/* ── Bluetooth Devices ── */}
      <Card className="bg-[#121824] border-slate-800/80 shadow-md">
        <CardHeader className="border-b border-slate-800/60 pb-4">
          <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
            <Bluetooth className="h-4 w-4 text-blue-400" />
            Bluetooth Devices
          </CardTitle>
          <p className="text-xs text-slate-400 mt-1">
            Connect your barcode scanner or thermal receipt printer. Standard HID hardware links run automatically without pairing.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-center justify-between gap-3 bg-[#090d16]/30 p-3 rounded-xl border border-slate-800/40">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-800/50 rounded-lg border border-slate-700/30">
                <ScanLine className="h-4 w-4 text-slate-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-white tracking-wide">BLE Scanner</p>
                <p className="text-[11px] text-slate-500 mt-0.5">SPP / BLE serial layout peripherals</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge(scannerStatus)}
              <Button size="sm" variant="outline" disabled={scannerStatus === "connecting"} onClick={connectScanner}
                className="bg-[#090d16] border-slate-800 hover:bg-slate-900 font-bold text-xs h-8">
                <BTIcon status={scannerStatus} />
                <span className="ml-1.5">{scannerStatus === "connected" ? "Disconnect" : "Connect"}</span>
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 bg-[#090d16]/30 p-3 rounded-xl border border-slate-800/40">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-800/50 rounded-lg border border-slate-700/30">
                <Printer className="h-4 w-4 text-slate-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-white tracking-wide">BT Printer</p>
                <p className="text-[11px] text-slate-500 mt-0.5">ESC/POS thermal print engines</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge(printerStatus)}
              <Button size="sm" variant="outline" disabled={printerStatus === "connecting"} onClick={connectPrinter}
                className="bg-[#090d16] border-slate-800 hover:bg-slate-900 font-bold text-xs h-8">
                <BTIcon status={printerStatus} />
                <span className="ml-1.5">{printerStatus === "connected" ? "Disconnect" : "Connect"}</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── AI Provider Configuration Panel ── */}
      <AIProviderSettings />

      {/* ── 🔒 Core Engine Configuration Panel ── */}
      <SystemGatewaySettings />

      {/* ── Branding ── */}
      <Card className="bg-[#121824] border-slate-800/80 shadow-md">
        <CardHeader className="border-b border-slate-800/60 pb-4">
          <CardTitle className="text-sm font-bold text-white">Branding & Store</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {([
            ["storeName",     "Store name"],
            ["tagline",       "Tagline"],
            ["address1",      "Address line 1"],
            ["address2",      "Address line 2"],
            ["contact",       "Contact number"],
            ["receiptFooter", "Receipt footer"],
            ["currency",      "Currency symbol"],
          ] as const).map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label className="text-xs font-bold text-slate-400">{label}</Label>
              <Input
                value={(s as any)[k]}
                onChange={(e) => setS({ ...s, [k]: e.target.value })}
                className="w-full bg-[#090d16] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs font-bold text-slate-400">Logo</Label>
            <Input type="file" accept="image/*" onChange={onLogo}
              className="w-full bg-[#090d16] border border-slate-800 rounded-lg text-xs file:bg-slate-800 file:border-none file:text-white file:px-2 file:py-1 file:rounded file:mr-2" />
            {s.logo && <img src={s.logo} alt="logo" className="mt-2 h-14 w-14 rounded-lg object-cover border border-slate-800" />}
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-bold text-slate-400">Low stock threshold</Label>
            <Input type="number" value={s.lowStockThreshold}
              onChange={(e) => setS({ ...s, lowStockThreshold: Number(e.target.value) })}
              className="w-full bg-[#090d16] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
          </div>
          <Button onClick={saveSettings} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold text-xs py-2.5 mt-2 shadow">
            Save Settings Baseline
          </Button>
        </CardContent>
      </Card>

      {/* ── Receipt & Cashier Settings ── */}
      <Card className="bg-[#121824] border-slate-800/80 shadow-md">
        <CardHeader className="border-b border-slate-800/60 pb-4">
          <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
            <Receipt className="h-4 w-4 text-teal-400" />
            Receipt & Cashier
          </CardTitle>
          <p className="text-xs text-slate-400 mt-1">
            Cashier name auto-switches to the employee name in Employee Mode.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">

          {/* Owner / Default Cashier Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-400">Owner / Default Cashier Name</Label>
            <Input
              value={(s as any).ownerName ?? ""}
              onChange={(e) => setS({ ...s, ownerName: e.target.value } as any)}
              placeholder="e.g. Juan Dela Cruz"
              className="w-full bg-[#090d16] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none placeholder:text-slate-600"
            />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Printed on receipts when in Owner mode. In Employee Mode the logged-in employee's name is used automatically.
            </p>
          </div>

          {/* Transaction Number Counter */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-400">Transaction Counter</Label>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-[#090d16]/60 border border-slate-800 rounded-lg px-4 py-2">
                <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">TXN #</span>
                <span className="text-base font-mono font-bold text-teal-400 tracking-widest">
                  {String(txnCount).padStart(6, "0")}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmResetTxn(true)}
                className="border-slate-700 bg-[#090d16]/30 hover:bg-rose-500/5 hover:border-rose-500/30 hover:text-rose-400 font-bold text-xs h-9 gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Auto-increments on every completed sale. Resets only when you confirm here.
            </p>
          </div>

          <Button onClick={saveSettings} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold text-xs py-2.5 mt-1 shadow">
            Save Receipt Settings
          </Button>
        </CardContent>
      </Card>

      {/* ── Expense categories ── */}
      <Card className="bg-[#121824] border-slate-800/80 shadow-md">
        <CardHeader className="border-b border-slate-800/60 pb-4">
          <CardTitle className="text-sm font-bold text-white">Expense Categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-4">
          {s.expenseCategories.map((c) => (
            <div key={c} className="flex justify-between items-center bg-[#090d16]/20 px-3 py-1.5 rounded-lg border border-slate-800/40 text-sm">
              <span className="text-xs font-semibold text-slate-300">{c}</span>
              <Button variant="ghost" size="sm"
                onClick={() => setS({ ...s, expenseCategories: s.expenseCategories.filter((x) => x !== c) })}
                className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/5 text-xs h-7">
                Remove
              </Button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Input placeholder="Add new category layout flag…" value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              className="flex-1 bg-[#090d16] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none placeholder:text-slate-600" />
            <Button onClick={() => {
              if (newCat && !s.expenseCategories.includes(newCat)) {
                setS({ ...s, expenseCategories: [...s.expenseCategories, newCat] });
                setNewCat("");
              }
            }} className="bg-slate-800 border border-slate-700 text-white font-bold text-xs px-4">Add</Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Security ── */}
      <Card className="bg-[#121824] border-slate-800/80 shadow-md">
        <CardHeader className="border-b border-slate-800/60 pb-4">
          <CardTitle className="text-sm font-bold text-white">Security</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-4">
          <Button variant="outline" onClick={() => { setNewPin(""); setPinChange("owner"); }}
            className="border-slate-800 bg-[#090d16]/30 font-bold text-xs text-slate-300 py-2.5">Change Owner PIN</Button>
          <Button variant="outline" onClick={() => { setNewPin(""); setPinChange("employee"); }}
            className="border-slate-800 bg-[#090d16]/30 font-bold text-xs text-slate-300 py-2.5">Change Employee PIN</Button>
        </CardContent>
      </Card>

      {/* ── Per-page PINs ── */}
      <Card className="bg-[#121824] border-slate-800/80 shadow-md">
        <CardHeader className="border-b border-slate-800/60 pb-4">
          <CardTitle className="text-sm font-bold text-white">Page PINs for Employees</CardTitle>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Set a custom 4-digit PIN per page, or leave blank to require the Employee PIN. POS is always open.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {PAGE_PIN_DEFS.map(({ path, label }) => (
            <div key={path} className="flex items-center gap-3 bg-[#090d16]/10 p-2 rounded-xl border border-slate-800/40">
              <span className="w-20 shrink-0 text-xs font-bold text-slate-400 tracking-wide">{label}</span>
              <Input
                type="password" inputMode="numeric" maxLength={4}
                placeholder={pagePins[path] ? "set ••••" : "Employee PIN"}
                className="flex-1 text-center bg-[#090d16] border border-slate-800 rounded-lg text-xs font-mono tracking-widest text-white focus:outline-none"
                value={pagePinDraft[path]}
                onChange={(e) => setPagePinDraft((d) => ({ ...d, [path]: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
              />
              <Button size="sm" variant="outline" onClick={() => savePagePin(path, label)}
                className="border-slate-800 font-bold text-xs h-8">Save</Button>
              {pagePins[path] && (
                <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300 h-8 px-2"
                  onClick={() => {
                    setPagePinDraft((d) => ({ ...d, [path]: "" }));
                    const updated = { ...pagePins };
                    delete updated[path];
                    setPins({ ...pins, pages: updated } as any);
                    toast.success(`${label} PIN cleared`);
                  }}>✕</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Danger zone ── */}
      <Card className="bg-[#121824] border-rose-500/20 shadow-md">
        <CardHeader className="border-b border-rose-500/10 pb-4">
          <CardTitle className="text-sm font-bold text-rose-400">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-4">
          <Button variant="destructive" className="bg-rose-600 hover:bg-rose-700 font-bold text-xs text-white py-2.5"
            onClick={() => supabase.auth.signOut()}>Logout Account</Button>
          <Button variant="outline" className="border-rose-500/30 text-rose-400 hover:bg-rose-500/5 font-bold text-xs py-2.5"
            onClick={() => setConfirmClear(true)}>Clear all data</Button>
        </CardContent>
      </Card>

      {/* Step 1: Enter New PIN Modal */}
      <Dialog open={!!pinChange && !newPinReady} onOpenChange={(o) => { if (!o) { setPinChange(null); setNewPin(""); } }}>
        <DialogContent className="max-w-xs bg-[#121824] border border-slate-800 text-slate-100 rounded-xl">
          <DialogHeader><DialogTitle className="text-sm font-bold text-white">Change {pinChange} PIN</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">New 4-digit PIN</Label>
              <Input type="password" inputMode="numeric" maxLength={4}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••" className="w-full bg-[#090d16] border border-slate-800 text-center tracking-widest text-lg font-mono focus:outline-none" autoFocus />
            </div>
            <p className="text-[10px] text-slate-500 italic">You will verify with your Owner master token in the next screen workflow stage.</p>
          </div>
          <DialogFooter className="flex gap-2 mt-2">
            <Button variant="outline" onClick={() => { setPinChange(null); setNewPin(""); }} className="flex-1 border-slate-800 font-bold text-xs">Cancel</Button>
            <button onClick={() => {
              if (!/^\d{4}$/.test(newPin)) { toast.error("PIN must be exactly 4 digits"); return; }
              setNewPinReady(true);
            }} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs">Next</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2: Confirm via Master Owner Prompt */}
      <OwnerPinPrompt
        open={newPinReady}
        onOpenChange={(o) => { if (!o) { setNewPinReady(false); setPinChange(null); setNewPin(""); } }}
        title={`Confirm — change ${pinChange} PIN`}
        onConfirm={() => {
          if (pinChange === "owner") setPins({ ...pins, owner: newPin });
          else if (pinChange === "employee") setPins({ ...pins, employee: newPin });
          toast.success(`${pinChange} PIN updated successfully`);
          setNewPin(""); setNewPinReady(false); setPinChange(null);
        }}
      />

      <OwnerPinPrompt
        open={confirmClear} onOpenChange={setConfirmClear}
        title="Clear all data pools" requireReason
        onConfirm={() => { clearAll(); toast.success("All cache data wiped clean"); }}
      />

      {/* Reset Transaction Counter Confirm */}
      <Dialog open={confirmResetTxn} onOpenChange={setConfirmResetTxn}>
        <DialogContent className="max-w-xs bg-[#121824] border border-slate-800 text-slate-100 rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-white">Reset Transaction Counter?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-400 pt-1 leading-relaxed">
            This will reset the transaction number back to <span className="font-bold text-white">000001</span> on the next sale.
            Existing transaction history is not affected.
          </p>
          <DialogFooter className="flex gap-2 mt-3">
            <Button variant="outline" onClick={() => setConfirmResetTxn(false)}
              className="flex-1 border-slate-800 font-bold text-xs">Cancel</Button>
            <Button
              onClick={() => {
                resetTransactionCounter();
                setTxnCount(0);
                setConfirmResetTxn(false);
                toast.success("Transaction counter reset to 000000");
              }}
              className="flex-1 bg-rose-600 hover:bg-rose-700 font-bold text-xs text-white"
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
