import { useState } from "react";
import { useStore } from "@/lib/storage";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function OwnerPinPrompt({
  open,
  onOpenChange,
  onConfirm,
  requireReason = false,
  title = "Owner PIN required",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (reason: string) => void;
  requireReason?: boolean;
  title?: string;
}) {
  const ownerPin = useStore((s) => s.pins.owner);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");

  const submit = () => {
    if (pin !== ownerPin) {
      toast.error("Incorrect Owner PIN");
      return;
    }
    if (requireReason && !reason.trim()) {
      toast.error("Reason is required");
      return;
    }
    onConfirm(reason);
    setPin("");
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>This action is restricted.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Owner PIN</Label>
            <Input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
          </div>
          {requireReason && (
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <Button onClick={submit} className="w-full">Confirm</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}