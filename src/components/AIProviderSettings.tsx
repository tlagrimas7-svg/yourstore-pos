// Drop this inside your Settings.tsx page — it adds the AI Provider section
// Import it and place it wherever you want in the settings layout

import { useState } from "react";
import { useStore } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Bot, Eye, EyeOff } from "lucide-react";

type Provider = "local" | "claude" | "gemini" | "mistral";

interface AIProviderConfig {
  provider: Provider;
  apiKey: string;
}

export function AIProviderSettings() {
  const { settings, setSettings } = useStore();
  const saved = (settings as any).aiProvider as AIProviderConfig | undefined;

  const [provider, setProvider] = useState<Provider>(saved?.provider ?? "local");
  const [apiKey, setApiKey]     = useState(saved?.apiKey ?? "");
  const [showKey, setShowKey]   = useState(false);

  const save = () => {
    setSettings({ ...settings, aiProvider: { provider, apiKey } } as any);
    toast.success("AI provider saved ✓");
  };

  const providerInfo: Record<Provider, { label: string; placeholder: string; url: string; cost: string }> = {
    local:   { label: "Local only (Fuse.js — free, offline)", placeholder: "No API key needed", url: "", cost: "Free · fully offline" },
    claude:  { label: "Claude (Anthropic)",  placeholder: "sk-ant-api03-...", url: "https://console.anthropic.com", cost: "~₱0.001 per scan" },
    gemini:  { label: "Gemini (Google)",     placeholder: "AIzaSy...",        url: "https://ai.google.dev",         cost: "Free tier available" },
    mistral: { label: "Mistral AI",          placeholder: "...",              url: "https://console.mistral.ai",    cost: "Free tier available" },
  };

  const info = providerInfo[provider];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-5 w-5 text-primary" />
          Voice Cashier — AI Provider
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Fuse.js handles most matches offline for free. AI is only called when no local match is found.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">AI Provider</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local only (Fuse.js — free, offline)</SelectItem>
              <SelectItem value="claude">Claude (Anthropic)</SelectItem>
              <SelectItem value="gemini">Gemini (Google)</SelectItem>
              <SelectItem value="mistral">Mistral AI</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{info.cost}</p>
        </div>

        {provider !== "local" && (
          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                placeholder={info.placeholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-10 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {info.url && (
              <p className="text-[11px] text-muted-foreground">
                Get your key at{" "}
                <a href={info.url} target="_blank" rel="noopener noreferrer" className="underline text-primary">
                  {info.url.replace("https://", "")}
                </a>
              </p>
            )}
          </div>
        )}

        {/* How it works */}
        <div className="rounded-lg bg-muted p-3 space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">How it works</p>
          <div className="space-y-1">
            {[
              { step: "1", text: "Cashier taps 🎤 and speaks", active: true },
              { step: "2", text: "Fuse.js matches products instantly (offline)", active: true },
              { step: "3", text: provider === "local" ? "Result shown for confirmation" : `${providerInfo[provider].label.split(" ")[0]} AI called only if no match`, active: true },
              { step: "4", text: "Cashier confirms before adding to cart", active: true },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="shrink-0 h-4 w-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center font-medium">{step}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <Button className="w-full" onClick={save}>Save AI Settings</Button>
      </CardContent>
    </Card>
  );
}