// src/lib/useSyncStatus.ts
// Reactive hook that exposes sync state to any component.

import { useState, useEffect, useCallback } from "react";
import { flushQueue, queueLength, startOnlineWatcher } from "./syncQueue";

export type SyncStatus =
  | "online"      // connected, nothing pending
  | "syncing"     // actively flushing the queue
  | "pending"     // offline or flush not done yet, items waiting
  | "offline";    // no connection

export interface SyncState {
  status: SyncStatus;
  pending: number;       // number of ops waiting to sync
  isOnline: boolean;
  lastSynced: Date | null;
  forceSync: () => Promise<void>;
}

export function useSyncStatus(): SyncState {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(queueLength());
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const refreshPending = useCallback(() => {
    setPending(queueLength());
  }, []);

  const forceSync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      await flushQueue();
      setLastSynced(new Date());
    } finally {
      setSyncing(false);
      refreshPending();
    }
  }, [refreshPending]);

  useEffect(() => {
    // Online/offline listeners
    const handleOnline = () => {
      setIsOnline(true);
      forceSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshPending();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Start the background watcher — idempotent, safe to call multiple times
    startOnlineWatcher((count) => {
      if (count > 0) setLastSynced(new Date());
      refreshPending();
    });

    // Poll pending count every 3s (catches new enqueued ops)
    const interval = setInterval(refreshPending, 3000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [forceSync, refreshPending]);

  const status: SyncStatus = !isOnline
    ? "offline"
    : syncing
    ? "syncing"
    : pending > 0
    ? "pending"
    : "online";

  return { status, pending, isOnline, lastSynced, forceSync };
}
