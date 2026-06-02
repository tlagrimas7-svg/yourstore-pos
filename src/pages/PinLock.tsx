import { useState } from "react";
import { useStore } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { toast } from "sonner";

export function PinLock({ onUnlocked }: { onUnlocked: (role: "owner" | "employee") => void }) {
  const settings = useStore((s) => s.settings);
  const pins = useStore((s) => s.pins);
  const [pin, setPin] = useState("");

  const press = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => {
        if (next === pins.owner) onUnlocked("owner");
        else if (next === pins.employee) onUnlocked("employee");
        else {
          toast.error("Incorrect PIN");
          setPin("");
        }
      }, 100);
    }
  };

  const back = () => setPin((p) => p.slice(0, -1));

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Lock className="h-6 w-6" />
          </div>
          <CardTitle>{settings.storeName}</CardTitle>
          <CardDescription>{settings.tagline}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-4 w-4 rounded-full border-2 ${pin.length > i ? "bg-primary border-primary" : "border-muted-foreground/40"}`}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Button key={d} variant="outline" className="h-14 text-xl" onClick={() => press(d)}>{d}</Button>
            ))}
            <div />
            <Button variant="outline" className="h-14 text-xl" onClick={() => press("0")}>0</Button>
            <Button variant="ghost" className="h-14" onClick={back}>⌫</Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">Enter Owner or Employee PIN</p>
        </CardContent>
      </Card>
    </div>
  );
}