/**
 * escpos.ts
 * Generates raw ESC/POS bytes for thermal receipt printers.
 * Works offline — pure byte manipulation, no network needed.
 */

import type { Transaction } from "@/lib/types";
import type { Settings } from "@/lib/types";

// ── ESC/POS command constants ─────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

const CMD = {
  INIT:          [ESC, 0x40],               // Initialize printer
  ALIGN_LEFT:    [ESC, 0x61, 0x00],
  ALIGN_CENTER:  [ESC, 0x61, 0x01],
  ALIGN_RIGHT:   [ESC, 0x61, 0x02],
  BOLD_ON:       [ESC, 0x45, 0x01],
  BOLD_OFF:      [ESC, 0x45, 0x00],
  DOUBLE_HEIGHT: [ESC, 0x21, 0x10],
  NORMAL_SIZE:   [ESC, 0x21, 0x00],
  CUT:           [GS,  0x56, 0x42, 0x00],  // Partial cut
  FEED_3:        [ESC, 0x64, 0x03],         // Feed 3 lines
};

// ── Builder ───────────────────────────────────────────────
class EscPosBuilder {
  private bytes: number[] = [];

  add(cmd: number[]) { this.bytes.push(...cmd); return this; }

  text(str: string) {
    // Encode as Latin-1 (most thermal printers default)
    for (let i = 0; i < str.length; i++) {
      this.bytes.push(str.charCodeAt(i) & 0xff);
    }
    return this;
  }

  line(str = "") { return this.text(str).add([LF]); }

  centerLine(str: string) {
    return this.add(CMD.ALIGN_CENTER).line(str);
  }

  boldLine(str: string) {
    return this.add(CMD.BOLD_ON).add(CMD.ALIGN_CENTER).line(str).add(CMD.BOLD_OFF);
  }

  dashes(n = 32) { return this.line("-".repeat(n)); }

  // Two-column row: left text + right text, total width chars
  twoCol(left: string, right: string, width = 32) {
    const space = Math.max(1, width - left.length - right.length);
    return this.add(CMD.ALIGN_LEFT).line(left + " ".repeat(space) + right);
  }

  build(): Uint8Array { return new Uint8Array(this.bytes); }
}

// ── Format currency ───────────────────────────────────────
function money(amount: number, currency: string): string {
  return `${currency}${amount.toFixed(2)}`;
}

// ── Main receipt builder ──────────────────────────────────
export function buildReceipt(tx: Transaction, settings: Settings): Uint8Array {
  const b = new EscPosBuilder();
  const W = 32; // chars per line for 58mm paper (48 for 80mm)

  b.add(CMD.INIT);

  // ── Header ──
  b.add(CMD.DOUBLE_HEIGHT)
   .boldLine(settings.storeName)
   .add(CMD.NORMAL_SIZE);

  if (settings.tagline)    b.centerLine(settings.tagline);
  if (settings.address1)   b.centerLine(settings.address1);
  if (settings.address2)   b.centerLine(settings.address2);
  if (settings.contact)    b.centerLine(settings.contact);

  b.dashes(W);

  // ── Transaction info ──
  const date = new Date(tx.date);
  b.add(CMD.ALIGN_LEFT)
   .line(date.toLocaleDateString())
   .line(date.toLocaleTimeString())
   .line(`#${tx.id.slice(0, 8).toUpperCase()}`);

  if (tx.employeeName) b.line(`Cashier: ${tx.employeeName}`);

  b.dashes(W);

  // ── Items ──
  b.add(CMD.ALIGN_LEFT);
  for (const item of tx.items) {
    // Item name (truncate if too long)
    const name = item.name.length > W ? item.name.slice(0, W - 1) : item.name;
    b.line(name);
    const qtyPrice = `  ${item.qty} x ${money(item.price, settings.currency)}`;
    const lineTotal = money(item.qty * item.price, settings.currency);
    b.twoCol(qtyPrice, lineTotal, W);
  }

  b.dashes(W);

  // ── Totals ──
  b.twoCol("Subtotal", money(tx.subtotal, settings.currency), W);
  if (tx.discount > 0) {
    b.twoCol("Discount", `-${money(tx.discount, settings.currency)}`, W);
  }

  b.add(CMD.BOLD_ON);
  b.twoCol("TOTAL", money(tx.total, settings.currency), W);
  b.add(CMD.BOLD_OFF);

  b.twoCol("Cash", money(tx.paid, settings.currency), W);
  b.twoCol("Change", money(tx.change, settings.currency), W);

  b.dashes(W);

  // ── Footer ──
  if (settings.receiptFooter) {
    b.add(CMD.ALIGN_CENTER).line(settings.receiptFooter);
  }
  b.centerLine("Thank you!");

  // ── Cut ──
  b.add(CMD.FEED_3).add(CMD.CUT);

  return b.build();
}
