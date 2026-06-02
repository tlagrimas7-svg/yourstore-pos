import { useStore } from "@/lib/storage";
import { fmt } from "@/lib/format";
import type { Transaction } from "@/lib/types";

export function Receipt({ tx }: { tx: Transaction }) {
  const settings = useStore((s) => s.settings);
  const transactionNo = (tx as any).transactionNo;
  const cashierName   = (tx as any).cashierName;
  const paymentMethod = (tx as any).paymentMethod ?? "CASH";

  return (
    <div className="receipt mx-auto max-w-xs bg-white p-3 font-mono text-xs text-black">
      <div className="text-center">
        {settings.logo && <img src={settings.logo} alt="" className="mx-auto mb-1 h-12 w-12 object-contain" />}
        <div className="text-sm font-bold">{settings.storeName}</div>
        <div>{settings.tagline}</div>
        {settings.address1 && <div>{settings.address1}</div>}
        {settings.address2 && <div>{settings.address2}</div>}
        {settings.contact  && <div>{settings.contact}</div>}
      </div>

      <div className="my-1 border-t border-dashed border-black" />

      <div>{new Date(tx.date).toLocaleString()}</div>
      {transactionNo
        ? <div className="font-bold">TXN #{transactionNo}</div>
        : <div>#{tx.id.slice(0, 8)}</div>}
      {cashierName && <div>Cashier: {cashierName}</div>}
      {paymentMethod && <div>Payment: {paymentMethod}</div>}

      <div className="my-1 border-t border-dashed border-black" />

      {tx.items.map((it, i) => (
        <div key={i} className="mb-0.5">
          <div>{it.name}</div>
          <div className="flex justify-between">
            <span>{it.qty} × {fmt(it.price, settings.currency)}</span>
            <span>{fmt(it.qty * it.price, settings.currency)}</span>
          </div>
        </div>
      ))}

      <div className="my-1 border-t border-dashed border-black" />
      <div className="flex justify-between"><span>Subtotal</span><span>{fmt(tx.subtotal, settings.currency)}</span></div>
      {tx.discount > 0 && (
        <div className="flex justify-between"><span>Discount</span><span>-{fmt(tx.discount, settings.currency)}</span></div>
      )}
      <div className="flex justify-between font-bold"><span>TOTAL</span><span>{fmt(tx.total, settings.currency)}</span></div>
      <div className="flex justify-between"><span>Paid</span><span>{fmt(tx.paid, settings.currency)}</span></div>
      <div className="flex justify-between"><span>Change</span><span>{fmt(tx.change, settings.currency)}</span></div>

      <div className="my-1 border-t border-dashed border-black" />
      <div className="text-center">{settings.receiptFooter}</div>
    </div>
  );
}

export function printReceipt() {
  window.print();
}
