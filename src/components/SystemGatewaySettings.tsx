import React from "react";

export function SystemGatewaySettings() {
  return (
    <div className="rounded-xl border border-slate-800/60 bg-[#121824] p-6 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-200 tracking-wide">System Environment</h3>
        <p className="text-xs text-slate-400 mt-1">
          Connected directly to the core standalone production database.
        </p>
      </div>
      
      <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 w-fit font-medium">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Production Mode Active (Direct Link)
      </div>
    </div>
  );
}

export default SystemGatewaySettings;
