import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Store } from "lucide-react";

export function Login({ onLoggedIn }: { onLoggedIn: (email: string, uid: string) => void }) {
  const settings = useStore((s) => s.settings);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dynamicStoreName, setDynamicStoreName] = useState("");
  const [loading, setLoading] = useState(false);

  // Dynamic Lookup Logic for Store Branding
  useEffect(() => {
    if (!email.includes("@") || !email.includes(".")) {
      setDynamicStoreName("");
      return;
    }

    const fetchStoreName = async () => {
      try {
        const { data, error } = await supabase
          .from("allowed_users")
          .select("store_name")
          .eq("email", email.trim().toLowerCase())
          .maybeSingle();

        if (!error && data?.store_name) {
          setDynamicStoreName(data.store_name);
        } else {
          setDynamicStoreName(""); 
        }
      } catch (err) {
        console.error("Error fetching dynamic store branding:", err);
      }
    };

    const delayDebounce = setTimeout(() => {
      fetchStoreName();
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // 1. Authenticate against Supabase Auth
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });

      if (error) {
        toast.error(error.message || "Invalid email or password.");
        return;
      }

      if (data?.user) {
        // 2. Look up by EMAIL instead of ID to force-find the row
        const { data: profile, error: profileError } = await supabase
          .from("allowed_users")
          .select("id, is_active, store_name, plan, trial_ends_at, expires_at")
          .eq("email", data.user.email?.trim().toLowerCase())
          .maybeSingle();

        if (profileError) {
          await supabase.auth.signOut();
          toast.error(`Database Error: ${profileError.message}`);
          return;
        }

        if (!profile) {
          await supabase.auth.signOut();
          toast.error("Access Denied: Email not registered in allowed_users table.");
          return;
        }

        // 3. EXPLICIT ID COMPARISON DEBUNKER
        // If the row is found but IDs don't match, show exactly what's wrong on screen
        if (profile.id !== data.user.id) {
          await supabase.auth.signOut();
          toast.error(`ID MISMATCH! Table has: ${profile.id.substring(0, 8)}... but Auth expects: ${data.user.id.substring(0, 8)}...`, {
            duration: 10000 // Keep it visible longer to read
          });
          console.log("ID inside Table Editor:", profile.id);
          console.log("True ID inside Auth Panel:", data.user.id);
          return;
        }

        // 4. Smart Expiration Checking Logic
        const now = new Date();
        const isDeactivated = !profile.is_active;
        const isTrialExpired = 
          profile.plan === "trial" && 
          profile.trial_ends_at && 
          new Date(profile.trial_ends_at) < now;
        const isPlanExpired = 
          profile.expires_at && 
          new Date(profile.expires_at) < now;

        if (isDeactivated || isTrialExpired || isPlanExpired) {
          await supabase.auth.signOut();
          if (isDeactivated) toast.error("Access Denied: This account has been deactivated.");
          else if (isTrialExpired) toast.error("Access Denied: Your trial period has expired.");
          else if (isPlanExpired) toast.error("Access Denied: Your subscription plan has expired.");
          return;
        }

        const finalStoreName = profile.store_name || dynamicStoreName || settings.storeName || "YourStore";
        toast.success(`Welcome back to ${finalStoreName}!`);
        
        onLoggedIn(data.user.email || "", data.user.id);
      }
    } catch (err) {
      console.error("Authentication runtime error:", err);
      toast.error("Database connection timeout. Please check your network link.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Store className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl transition-all duration-300">
            {dynamicStoreName || settings.storeName || "YourStore"}
          </CardTitle>
          <CardDescription>{settings.tagline || "Your Store Manager"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input 
                id="email" 
                type="email" 
                autoComplete="email" 
                required
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                placeholder="name@store.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password" 
                type="password" 
                autoComplete="current-password" 
                required
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Signing in…" : "Login"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default Login;
