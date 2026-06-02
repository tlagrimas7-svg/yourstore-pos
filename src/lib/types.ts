export interface Product {
  id: string;
  name: string;
  barcode?: string;
  category?: string;
  stock: number;
  cost: number;
  price: number;
  image_url?: string;
  is_quick_grid?: boolean;
}
export interface CartItem {
  productId: string;
  name: string;
  qty: number;
  price: number;
  cost: number;
  discount?: { type: "amount" | "percent"; value: number };
}
export interface Transaction {
  id: string;
  date: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  change: number;
  voided?: boolean;
  voidReason?: string;
  shiftId?: string;
  employeeName?: string;
  paymentMethod?: string;
  transactionNo?: string;   // ← NEW: zero-padded e.g. "000042"
  cashierName?: string;     // ← NEW: resolved cashier at time of sale
}
export interface Expense {
  id: string;
  date: string;
  category: string;
  amount: number;
  notes?: string;
}
export interface UtangPayment {
  id: string;
  date: string;
  amount: number;
}
export interface UtangRecord {
  id: string;
  customer: string;
  date: string;
  items: string;
  amount: number;
  payments: UtangPayment[];
  promiseDate?: string;
  contact?: string;
  email?: string;
  notes?: string;
}
export interface AntiKupitEvent {
  id: string;
  date: string;
  type: "void" | "stock_adjust" | "delete";
  item: string;
  reason: string;
}
export interface StockLog {
  id: string;
  date: string;
  productId: string;
  delta: number;
  reason: string;
}
export interface Settings {
  storeName: string;
  tagline: string;
  address1: string;
  address2: string;
  contact: string;
  logo: string;
  receiptFooter: string;
  currency: string;
  lowStockThreshold: number;
  expenseCategories: string[];
  ownerName: string;          // ← NEW: default cashier name shown on receipts
}
export interface Pins {
  owner: string;
  employee: string;
  pages?: Record<string, string>;
}
export interface ShiftSaleItem {
  productId: string;
  name: string;
  qty: number;
  total: number;
}
export interface Shift {
  id: string;
  employeeName: string;
  timeIn: string;
  timeOut?: string;
  totalSales: number;
  txCount: number;
  items: ShiftSaleItem[];
  drawerStart?: number;
}
export const DEFAULT_SETTINGS: Settings = {
  storeName: "YourStore",
  tagline: "Your Store Manager",
  address1: "",
  address2: "",
  contact: "",
  logo: "",
  receiptFooter: "Thank you for shopping with us!",
  currency: "₱",
  lowStockThreshold: 5,
  expenseCategories: ["Rent", "Utilities", "Supplies", "Wages", "Other"],
  ownerName: "",              // ← NEW
};
export const DEFAULT_PINS: Pins = { owner: "1234", employee: "0000" };
