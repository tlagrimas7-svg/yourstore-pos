import { useStore } from "@/lib/storage";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function AntiKupitLog() {
  const events = useStore((s) => s.antiKupit);
  return (
    <div className="space-y-2 p-4">
      <h2 className="text-lg font-semibold">Anti-Kupit Log</h2>
      {events.length === 0 && <p className="text-sm text-muted-foreground">No suspicious events.</p>}
      {events.map((e) => (
        <Card key={e.id}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <Badge variant="destructive" className="capitalize">{e.type.replace("_", " ")}</Badge>
              <span className="text-xs text-muted-foreground">{new Date(e.date).toLocaleString()}</span>
            </div>
            <div className="mt-1 text-sm font-medium">{e.item}</div>
            <div className="text-xs text-muted-foreground">{e.reason}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}