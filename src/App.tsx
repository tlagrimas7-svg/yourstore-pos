import { useEffect, useState, Component, type ReactNode } from "react";
import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  RouterProvider,
  Navigate,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { supabase, checkAccess, type AccessInfo } from "@/lib/supabase";
import { useStore } from "@/lib/storage";
import { migrateIfNeeded } from "@/lib/migrate";
import { SyncIndicator } from "@/components/SyncIndicator";
import { Login } from "@/pages/Login";
import { PinLock } from "@/pages/PinLock";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { POS } from "@/pages/POS";
import { Scanner } from "@/pages/Scanner";
import { Inventory } from "@/pages/Inventory";
import { Expenses } from "@/pages/Expenses";
import { Utang } from "@/pages/Utang";
import { Summary } from "@/pages/Summary";
import { Settings as SettingsPage } from "@/pages/Settings";
import { AntiKupitLog } from "@/pages/AntiKupitLog";
import { DailyTransactions } from "@/pages/DailyTransactions";
import { ShiftLog } from "@/pages/ShiftLog";
import CashDrawerLog from "@/pages/CashDrawerLog";
import { toast } from "sonner";
import { create } from "zustand";
import { ShieldAlert, Delete } from "lucide-react";

type AuthStage = "loading" | "needs-login" | "needs-pin" | "ready";
type Role = "owner" | "employee" | null;

// ── Error Boundary ─────────────────────────────────────────────────────────────
interface EBState { hasError: boolean; }
class AppErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: unknown) { console.warn("[AppErrorBoundary caught]", err); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center bg-[#090d16] text-white">
          <p className="text-lg font-semibold">Something went wrong</p>
          <p className="text-sm text-muted-foreground">A page crashed. Your data is safe.</p>
          <button
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => { this.setState({ hasError: false }); window.history.back(); }}
          >Go back</button>
          <button
            className="text-xs text-muted-foreground underline"
            onClick={() => window.location.reload()}
          >Reload app</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Page Route Guard ───────────────────────────────────────────────────────────
function PageRouteGuard({ path, children }: { path: string; children: ReactNode }) {
  const role = useSession((s) => s.role);
  const unlockedPages = useSession((s) => s.unlockedPages);
  const unlockPage = useSession((s) => s.unlockPage);
  const { pins } = useStore();
  const [enteredPin, setEnteredPin] = useState<string>("");

  if (path === "/pos" || path === "/scanner" || role === "owner") {
    return <>{children}</>;
  }

  const pagePins = (pins as any)?.pages ?? {};
  const targetPagePin = pagePins[path] || (pins as any)?.employee;

  if (!targetPagePin || unlockedPages[path]) {
    return <>{children}</>;
  }

  const handleKeyPress = (num: string) => {
    if (enteredPin.length >= 4) return;
    const combined = enteredPin + num;
    setEnteredPin(combined);

    if (combined.length === 4) {
      if (combined === targetPagePin || combined === (pins as any)?.owner) {
        unlockPage(path);
        setEnteredPin("");
        toast.success("Access Authorized");
      } else {
        setEnteredPin("");
        toast.error("Invalid Security Code");
      }
    }
  };

  const handleBackspace = () => setEnteredPin((prev) => prev.slice(0, -1));

  return (
    <div className="flex flex-col items-center justify-center min-h-[75vh] bg-[#090d16] text-white p-6 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-xs text-center space-y-6">
        <div>
          <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3 shadow-md">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h2 className="text-base font-bold tracking-wide">Locked Layout Section</h2>
          <p className="text-xs text-slate-400 mt-1">Authorized access only. Enter 4-digit PIN code.</p>
        </div>

        <div className="flex justify-center gap-4 py-1">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={`h-3 w-3 rounded-full border transition-all duration-100 ${
                idx < enteredPin.length
                  ? "bg-amber-400 border-amber-400 scale-110 shadow-md shadow-amber-400/30"
                  : "border-slate-800 bg-slate-950"
              }`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2.5 pt-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleKeyPress(n)}
              className="h-14 rounded-xl bg-[#121824] border border-slate-800/60 hover:border-slate-700 text-lg font-bold text-slate-200 active:bg-slate-800/40 active:scale-95 transition-all flex items-center justify-center"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setEnteredPin("")}
            className="h-14 text-xs font-bold text-slate-500 hover:text-slate-400 active:scale-95 transition-all flex items-center justify-center"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => handleKeyPress("0")}
            className="h-14 rounded-xl bg-[#121824] border border-slate-800/60 hover:border-slate-700 text-lg font-bold text-slate-200 active:bg-slate-800/40 active:scale-95 transition-all flex items-center justify-center"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            className="h-14 text-slate-400 hover:text-slate-300 active:scale-95 transition-all flex items-center justify-center"
          >
            <Delete className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Routes ─────────────────────────────────────────────────────────────────────
const rootRoute   = createRootRoute({ component: () => <Outlet /> });
const layoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "layout", component: Layout });

const dashboardRoute = createRoute({ getParentRoute: () => layoutRoute, path: "/",           component: () => <PageRouteGuard path="/"><Dashboard /></PageRouteGuard> });
const posRoute       = createRoute({ getParentRoute: () => layoutRoute, path: "/pos",         component: () => <PageRouteGuard path="/pos"><POS /></PageRouteGuard> });
const scannerRoute   = createRoute({ getParentRoute: () => layoutRoute, path: "/scanner",     component: () => <PageRouteGuard path="/scanner"><Scanner /></PageRouteGuard> });
const inventoryRoute = createRoute({ getParentRoute: () => layoutRoute, path: "/inventory",   component: () => <PageRouteGuard path="/inventory"><Inventory /></PageRouteGuard> });
const expensesRoute  = createRoute({ getParentRoute: () => layoutRoute, path: "/expenses",    component: () => <PageRouteGuard path="/expenses"><Expenses /></PageRouteGuard> });
const utangRoute     = createRoute({ getParentRoute: () => layoutRoute, path: "/utang",       component: () => <PageRouteGuard path="/utang"><Utang /></PageRouteGuard> });
const summaryRoute   = createRoute({ getParentRoute: () => layoutRoute, path: "/summary",     component: () => <PageRouteGuard path="/summary"><Summary /></PageRouteGuard> });
const settingsRoute  = createRoute({ getParentRoute: () => layoutRoute, path: "/settings",    component: () => <PageRouteGuard path="/settings"><SettingsPage /></PageRouteGuard> });
const antiKupitRoute = createRoute({ getParentRoute: () => layoutRoute, path: "/anti-kupit",  component: () => <PageRouteGuard path="/anti-kupit"><AntiKupitLog /></PageRouteGuard> });
const dailyRoute     = createRoute({ getParentRoute: () => layoutRoute, path: "/daily",       component: () => <PageRouteGuard path="/daily"><DailyTransactions /></PageRouteGuard> });
const shiftsRoute    = createRoute({ getParentRoute: () => layoutRoute, path: "/shifts",      component: () => <PageRouteGuard path="/shifts"><ShiftLog /></PageRouteGuard> });
const drawerRoute    = createRoute({ getParentRoute: () => layoutRoute, path: "/drawer",      component: () => <PageRouteGuard path="/drawer"><CashDrawerLog /></PageRouteGuard> });

const notFoundRoute = createRoute({ getParentRoute: () => rootRoute, path: "$", component: () => <Navigate to="/" /> });

const routeTree = rootRoute.addChildren([
  layoutRoute.addChildren([
    dashboardRoute, posRoute, scannerRoute, inventoryRoute,
    expensesRoute, utangRoute, summaryRoute, settingsRoute,
    antiKupitRoute, dailyRoute, shiftsRoute, drawerRoute,
  ]),
  notFoundRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router; }
}

// ── Session store ──────────────────────────────────────────────────────────────
interface SessionState {
  role: Role;
  access: AccessInfo | null;
  unlockedPages: Record<string, boolean>;
  setRole: (r: Role) => void;
  setAccess: (a: AccessInfo | null) => void;
  unlockPage: (path: string) => void;
  lock: () => void;
}
export const useSession = create<SessionState>((set) => ({
  role: null,
  access: null,
  unlockedPages: {},
  setRole: (role) => set({ role }),
  setAccess: (access) => set({ access }),
  unlockPage: (path) => set((state) => ({ unlockedPages: { ...state.unlockedPages, [path]: true } })),
  lock: () => set({ role: null, unlockedPages: {} }),
}));

// ── App ────────────────────────────────────────────────────────────────────────
export function App() {
  const [stage, setStage]   = useState<AuthStage>("loading");
  const [email, setEmail]   = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const hydrate   = useStore((s) => s.hydrate);
  const role      = useSession((s) => s.role);
  const lock      = useSession((s) => s.lock);
  const setAccess = useSession((s) => s.setAccess);

  const bootSession = async (uid: string, userEmail: string, access?: AccessInfo) => {
    setUserId(uid);
    setEmail(userEmail);
    if (access) setAccess(access);

    try {
      const migrated = await migrateIfNeeded(uid, userEmail);
      if (migrated) toast.success("Your data has been backed up to the cloud ✓");
    } catch (err) {
      console.warn("[migrate] failed silently:", err);
    }

    await hydrate(uid, userEmail);
    setStage("needs-pin");
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const session = data.session;
      if (!session) { setStage("needs-login"); return; }

      const userEmail = session.user.email ?? "";
      const result    = await checkAccess(userEmail);

      if (!result.ok) {
        await supabase.auth.signOut();
        toast.error("Access denied. Contact your administrator.");
        setStage("needs-login");
        return;
      }

      await bootSession(session.user.id, userEmail, result.access);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) {
        setEmail(""); setUserId(""); lock(); setAccess(null); setStage("needs-login");
      }
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  // Auto-lock after 5 min inactivity
  useEffect(() => {
    if (stage !== "ready") return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        lock();
        setStage("needs-pin");
        toast("Auto-locked due to inactivity");
      }, 5 * 60 * 1000);
    };
    const events = ["mousemove", "keydown", "touchstart", "click"];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [stage, lock]);

  const handleLoggedIn = async (e: string, uid: string) => {
    const result = await checkAccess(e);
    await bootSession(uid, e, result.ok ? result.access : undefined);
  };

  const handleUnlocked = (r: Role) => {
    useSession.getState().setRole(r);
    setStage("ready");
  };

  return (
    <>
      <Toaster richColors position="top-center" />

      {stage === "loading" && (
        <div className="flex min-h-screen items-center justify-center bg-[#090d16] text-muted-foreground">
          Loading system context…
        </div>
      )}

      {stage === "needs-login" && <Login onLoggedIn={handleLoggedIn} />}
      {stage === "needs-pin"   && email && <PinLock onUnlocked={handleUnlocked} />}

      {stage === "ready" && role && (
        <AppErrorBoundary>
          {/* Sync indicator floats above everything */}
          <SyncIndicator />
          <RouterProvider router={router} />
        </AppErrorBoundary>
      )}
    </>
  );
}

export default App;
