import { useState, useEffect } from "react";
import { Outlet, Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, ShoppingCart, Package, Receipt,
  HandCoins, BarChart3, Settings as SettingsIcon,
  Lock, ShieldCheck, Wifi, WifiOff,
} from "lucide-react";
import { useSession } from "@/App";
import { useStore } from "@/lib/storage";
import { queueLength, flushQueue } from "@/lib/syncQueue";
import { TrialBanner } from "@/components/TrialBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const LOCKED_PAGES = ["/", "/inventory", "/expenses", "/utang", "/summary"] as const;

const allNav = [
  { to: "/",          label: "Home",    icon: LayoutDashboard },
  { to: "/pos",       label: "POS",     icon: ShoppingCart    },
  { to: "/inventory", label: "Stock",   icon: Package         },
  { to: "/expenses",  label: "Expense", icon: Receipt         },
  { to: "/utang",     label: "Utang",   icon: HandCoins       },
  { to: "/summary",   label: "Summary", icon: BarChart3       },
] as const;

const unlockedPages = new Set<string>();

/* ── Online/Offline indicator ── */
function OnlineIndicator() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(queueLength());

  useEffect(() => {
    const onOnline = async () => {
      setOnline(true);
      const count = await flushQueue();
      setPending(queueLength());
      if (count > 0) toast.success(`Synced ${count} offline changes ✓`);
    };
    const onOffline = () => { setOnline(false); setPending(queueLength()); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const interval = setInterval(() => setPending(queueLength()), 5000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(interval);
    };
  }, []);

  if (online && pending === 0) return null;

  return (
    <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium
      ${online ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
      {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {online ? `${pending} pending` : "Offline"}
    </div>
  );
}

/* ── PIN Pad ── */
function PinPad({ onPress, onBack, value }: { onPress: (d: string) => void; onBack: () => void; value: string }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-3.5 w-3.5 rounded-full border-2 transition-all ${
            value.length > i ? "bg-primary border-primary scale-110" : "border-muted-foreground/40"
          }`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <Button key={d} variant="outline" className="h-12 text-lg font-medium" onClick={() => onPress(d)}>{d}</Button>
        ))}
        <div />
        <Button variant="outline" className="h-12 text-lg font-medium" onClick={() => onPress("0")}>0</Button>
        <Button variant="ghost" className="h-12" onClick={onBack}>⌫</Button>
      </div>
    </div>
  );
}

/* ── Page PIN gate ── */
function PagePinGate({ path, label, onUnlocked }: { path: string; label: string; onUnlocked: () => void }) {
  const pins = useStore((s) => s.pins);
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  const press = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => {
        const pagePins: Record<string, string> = (pins as any).pages ?? {};
        const valid = pagePins[path] ?? pins.employee;
        if (next === valid) { unlockedPages.add(path); onUnlocked(); }
        else { setShake(true); setTimeout(() => setShake(false), 500); setPin(""); }
      }, 100);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <Card className="w-full max-w-xs">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/20 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <CardTitle className="text-base">{label}</CardTitle>
          <CardDescription className="text-xs">Enter PIN to access</CardDescription>
        </CardHeader>
        <CardContent className={shake ? "animate-[wiggle_0.4s_ease-in-out]" : ""}>
          <PinPad value={pin} onPress={press} onBack={() => setPin((p) => p.slice(0, -1))} />
        </CardContent>
      </Card>
      <style>{`@keyframes wiggle{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}`}</style>
    </div>
  );
}

function MaybeGated({ path, label }: { path: string; label: string }) {
  const role = useSession((s) => s.role);
  const [unlocked, setUnlocked] = useState(() => unlockedPages.has(path));
  if (role === "owner") return <Outlet />;
  if (LOCKED_PAGES.includes(path as any) && !unlocked)
    return <PagePinGate path={path} label={label} onUnlocked={() => setUnlocked(true)} />;
  return <Outlet />;
}

/* ── Cash drawer dialog ── */
function CashDrawerDialog({ open, title, description, onConfirm, onSkip }: {
  open: boolean; title: string; description: string;
  onConfirm: (amount: number) => void; onSkip: () => void;
}) {
  const { settings } = useStore();
  const [amount, setAmount] = useState("");
  return (
    <Dialog open={open}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-xs text-muted-foreground pt-1">{description}</p>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">Cash in Drawer ({settings.currency})</Label>
          <Input type="number" min={0} placeholder="0.00" value={amount}
            onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={() => { onConfirm(Number(amount) || 0); setAmount(""); }}>Confirm</Button>
          <Button variant="ghost" className="w-full text-xs" onClick={onSkip}>Skip</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Back to Owner ── */
function BackToOwnerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pins = useStore((s) => s.pins);
  const setRole = useSession((s) => s.setRole);
  const { settings } = useStore();
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const [stage, setStage] = useState<"pin" | "drawer">("pin");

  const press = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => {
        if (next === pins.owner) { setPin(""); setStage("drawer"); }
        else { setShake(true); setTimeout(() => setShake(false), 500); setPin(""); }
      }, 100);
    }
  };

  const done = (amount: number) => {
    unlockedPages.clear();
    setRole("owner");
    onClose();
    setStage("pin");
    toast.success(`Owner mode — Drawer: ${settings.currency}${amount.toFixed(2)}`);
  };

  if (stage === "drawer") {
    return <CashDrawerDialog open title="Cash in Drawer"
      description="How much cash is in the drawer?" onConfirm={done} onSkip={() => done(0)} />;
  }

  return (
    <Dialog open={open} onOpenChange={() => { setPin(""); setStage("pin"); onClose(); }}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />Switch to Owner
          </DialogTitle>
          <p className="text-xs text-muted-foreground pt-1">Enter owner PIN to continue.</p>
        </DialogHeader>
        <div className={shake ? "animate-[wiggle_0.4s_ease-in-out]" : ""}>
          <PinPad value={pin} onPress={press} onBack={() => setPin((p) => p.slice(0, -1))} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Switch to Employee ── */
function SwitchToEmployeeDialog({ open, onClose, onConfirm }: {
  open: boolean; onClose: () => void; onConfirm: (amount: number) => void;
}) {
  const { settings } = useStore();
  const [amount, setAmount] = useState("");
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Switch to Employee Mode</DialogTitle>
          <p className="text-xs text-muted-foreground pt-1">Record starting cash before handing over.</p>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">Starting Drawer Cash ({settings.currency})</Label>
          <Input type="number" min={0} placeholder="0.00" value={amount}
            onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={() => { onConfirm(Number(amount) || 0); setAmount(""); }}>
            Confirm & Switch
          </Button>
          <Button variant="ghost" className="w-full text-xs" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Layout ── */
export function Layout() {
  const role      = useSession((s) => s.role);
  const access    = useSession((s) => s.access);   // ← trial info
  const setRole   = useSession((s) => s.setRole);
  const settings  = useStore((s) => s.settings);
  const location  = useLocation();
  const [showOwnerDialog, setShowOwnerDialog]       = useState(false);
  const [showEmployeeDialog, setShowEmployeeDialog] = useState(false);

  const currentNav = allNav.find((n) => n.to === location.pathname);

  const handleSwitchToEmployee = (drawerAmount: number) => {
    setRole("employee");
    setShowEmployeeDialog(false);
    useStore.setState((s: any) => ({ ...s, drawerStart: drawerAmount }));
    toast.success(`Employee mode — Drawer: ${settings.currency}${drawerAmount.toFixed(2)}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* ── Trial Banner — sits above everything ── */}
      <TrialBanner access={access} />

      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/8 bg-card/60 px-3 py-2.5 backdrop-blur-xl sm:px-6 sm:py-3">
        <div className="flex items-center gap-2.5">
          {settings.logo ? (
            <img src={settings.logo} alt="logo" className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl object-cover ring-1 ring-white/10" />
          ) : (
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-primary/20 text-primary font-bold text-base ring-1 ring-primary/30">
              {settings.storeName.charAt(0)}
            </div>
          )}
          <div>
            <h1 className="text-xs sm:text-sm font-bold leading-tight">{settings.storeName}</h1>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground">{settings.tagline}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <OnlineIndicator />
          {role === "owner" ? (
            <>
              <Button variant="ghost" size="sm"
                className="text-xs text-muted-foreground border border-white/10 rounded-lg px-2 h-8 sm:px-3"
                onClick={() => setShowEmployeeDialog(true)}>
                <span className="hidden sm:inline">Employee Mode</span>
                <span className="sm:hidden text-[11px]">Employee</span>
              </Button>
              <Link to="/settings">
                <Button variant="ghost" size="icon" className="rounded-xl h-8 w-8">
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </Link>
            </>
          ) : (
            <Button variant="ghost" size="sm"
              className="flex items-center gap-1 text-xs text-muted-foreground border border-white/10 rounded-lg px-2 h-8"
              onClick={() => setShowOwnerDialog(true)}>
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Owner</span>
            </Button>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-x-hidden"
        style={{ paddingBottom: "calc(64px + env(safe-area-inset-bottom, 0px))" }}>
        <div className="mx-auto w-full max-w-2xl lg:max-w-4xl">
          <MaybeGated path={location.pathname} label={currentNav?.label ?? "This page"} />
        </div>
      </main>

      {/* Bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-card/90 backdrop-blur-xl"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${allNav.length}, minmax(0,1fr))`,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}>
        {allNav.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to;
          const isLocked = role === "employee" && LOCKED_PAGES.includes(to as any) && !unlockedPages.has(to);
          return (
            <Link key={to} to={to}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 sm:py-3
                text-[9px] sm:text-[11px] font-medium transition-colors min-h-[56px] sm:min-h-[64px]
                ${active ? "text-primary" : "text-muted-foreground"}`}>
              <div className="relative">
                <div className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg transition-all
                  ${active ? "bg-primary/20" : ""}`}>
                  <Icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
                </div>
                {isLocked && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-muted-foreground/30">
                    <Lock className="h-2 w-2" />
                  </span>
                )}
              </div>
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}
      </nav>

      <BackToOwnerDialog open={showOwnerDialog} onClose={() => setShowOwnerDialog(false)} />
      <SwitchToEmployeeDialog open={showEmployeeDialog}
        onClose={() => setShowEmployeeDialog(false)} onConfirm={handleSwitchToEmployee} />
    </div>
  );
}
