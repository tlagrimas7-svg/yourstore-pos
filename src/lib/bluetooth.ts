/**
 * bluetooth.ts
 * Universal Bluetooth manager for:
 *   - SPP/BLE barcode scanners (Web Bluetooth)
 *   - ESC/POS thermal printers (Web Bluetooth)
 *
 * HID scanners (most common) work automatically as keyboard input —
 * no Bluetooth API needed; they type into the focused input.
 *
 * Offline-safe: once paired, the browser remembers the device.
 * Web Bluetooth is supported on Chrome/Edge (Android, Windows, macOS).
 * NOT supported on iOS Safari (capacitor/cordova wrappers need a native BLE plugin).
 */

declare global {
  interface BluetoothRequestDeviceFilter { namePrefix?: string; name?: string; services?: string[]; }
  interface BluetoothLEScanFilter extends BluetoothRequestDeviceFilter {}
  interface BluetoothRequestDeviceOptions {
    filters?: BluetoothLEScanFilter[];
    acceptAllDevices?: boolean;
    optionalServices?: string[];
  }
  interface BluetoothRemoteGATTCharacteristic extends EventTarget {
    uuid: string;
    properties: { broadcast: boolean; read: boolean; writeWithoutResponse: boolean; write: boolean; notify: boolean; indicate: boolean; authenticatedSignedWrites: boolean; reliableWrite: boolean; writableAuxiliaries: boolean; };
    value?: DataView;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    readValue(): Promise<DataView>;
    writeValue(value: BufferSource): Promise<void>;
    writeValueWithoutResponse(value: BufferSource): Promise<void>;
    addEventListener(type: "characteristicvaluechanged", listener: (ev: Event) => void): void;
  }
  interface BluetoothRemoteGATTService {
    uuid: string;
    getCharacteristic(char: string): Promise<BluetoothRemoteGATTCharacteristic>;
    getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
  }
  interface BluetoothRemoteGATTServer {
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
  }
  interface BluetoothDevice extends EventTarget {
    id: string;
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
    addEventListener(type: "gattserverdisconnected", listener: (ev: Event) => void): void;
  }
  interface Bluetooth {
    requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
  }
  interface Navigator {
    readonly bluetooth?: Bluetooth;
  }
}

// ── Common BLE / SPP UUIDs ────────────────────────────────
const SPP_SERVICE     = "00001101-0000-1000-8000-00805f9b34fb";
const BLE_SERIAL_SVC  = "0000fff0-0000-1000-8000-00805f9b34fb";
const BLE_SERIAL_CHAR = "0000fff1-0000-1000-8000-00805f9b34fb";

// ESC/POS printers often use this Nordic UART service
const NORDIC_UART_SVC  = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NORDIC_UART_TX   = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // write here to print

// Generic printer service fallback
const PRINTER_SERVICES = [NORDIC_UART_SVC, "000018f0-0000-1000-8000-00805f9b34fb"];

export type BTStatus = "disconnected" | "connecting" | "connected" | "unsupported";

// ── Scanner ───────────────────────────────────────────────
class BLEScanner {
  private device: BluetoothDevice | null = null;
  private char: BluetoothRemoteGATTCharacteristic | null = null;
  private buffer = "";
  public status: BTStatus = "unsupported";
  public onScan: ((barcode: string) => void) | null = null;
  public onStatusChange: ((s: BTStatus) => void) | null = null;

  isSupported() {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  getDeviceName(): string | null {
    return this.device?.name ?? null;
  }

  async connect() {
    if (!this.isSupported()) {
      this.setStatus("unsupported");
      return false;
    }
    try {
      this.setStatus("connecting");
      this.device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SPP_SERVICE, BLE_SERIAL_SVC, NORDIC_UART_SVC],
      });
      this.device!.addEventListener("gattserverdisconnected", () => {
        this.setStatus("disconnected");
      });
      const server = await this.device!.gatt!.connect();

      // Try known scanner services in order
      let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
      for (const svcUuid of [BLE_SERIAL_SVC, NORDIC_UART_SVC, SPP_SERVICE]) {
        try {
          const svc = await server.getPrimaryService(svcUuid);
          const chars = await svc.getCharacteristics();
          // Find a notify/indicate characteristic
          characteristic = chars.find(
            (c) => c.properties.notify || c.properties.indicate
          ) ?? null;
          if (characteristic) break;
        } catch {}
      }

      if (!characteristic) throw new Error("No suitable characteristic found");

      this.char = characteristic;
      await characteristic.startNotifications();
      characteristic.addEventListener("characteristicvaluechanged", (e: any) => {
        const val = e.target.value as DataView;
        const text = new TextDecoder().decode(val);
        this.buffer += text;
        // Barcodes end with \n or \r
        const lines = this.buffer.split(/[\r\n]+/);
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
          const code = line.trim();
          if (code && this.onScan) this.onScan(code);
        }
      });

      this.setStatus("connected");
      return true;
    } catch (err: any) {
      if (err?.name !== "NotFoundError") console.error("[BLEScanner]", err);
      this.setStatus("disconnected");
      return false;
    }
  }

  disconnect() {
    this.device?.gatt?.disconnect();
    this.device = null;
    this.char = null;
    this.buffer = "";
    this.setStatus("disconnected");
  }

  private setStatus(s: BTStatus) {
    this.status = s;
    this.onStatusChange?.(s);
  }
}

// ── Printer ───────────────────────────────────────────────
class BLEPrinter {
  private device: BluetoothDevice | null = null;
  private char: BluetoothRemoteGATTCharacteristic | null = null;
  public status: BTStatus = "unsupported";
  public onStatusChange: ((s: BTStatus) => void) | null = null;

  isSupported() {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  getDeviceName(): string | null {
    return this.device?.name ?? null;
  }

  async connect() {
    if (!this.isSupported()) { this.setStatus("unsupported"); return false; }
    try {
      this.setStatus("connecting");
      this.device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [...PRINTER_SERVICES, "00001800-0000-1000-8000-00805f9b34fb"],
      });
      this.device!.addEventListener("gattserverdisconnected", () => {
        this.setStatus("disconnected");
      });
      const server = await this.device!.gatt!.connect();

      // Try printer services in order
      let writeChar: BluetoothRemoteGATTCharacteristic | null = null;
      for (const svcUuid of PRINTER_SERVICES) {
        try {
          const svc = await server.getPrimaryService(svcUuid);
          const chars = await svc.getCharacteristics();
          writeChar = chars.find(
            (c) => c.properties.write || c.properties.writeWithoutResponse
          ) ?? null;
          if (writeChar) break;
        } catch {}
      }

      if (!writeChar) throw new Error("No writable characteristic found");
      this.char = writeChar;
      this.setStatus("connected");
      return true;
    } catch (err: any) {
      if (err?.name !== "NotFoundError") console.error("[BLEPrinter]", err);
      this.setStatus("disconnected");
      return false;
    }
  }

  async print(data: Uint8Array): Promise<boolean> {
    if (!this.char) return false;
    try {
      // Send in 512-byte chunks (BLE MTU limit)
      const CHUNK = 512;
      for (let i = 0; i < data.length; i += CHUNK) {
        const chunk = data.slice(i, i + CHUNK);
        if (this.char.properties.writeWithoutResponse) {
          await this.char.writeValueWithoutResponse(chunk);
        } else {
          await this.char.writeValue(chunk);
        }
        // Small delay between chunks
        await new Promise((r) => setTimeout(r, 30));
      }
      return true;
    } catch (err) {
      console.error("[BLEPrinter print]", err);
      return false;
    }
  }

  disconnect() {
    this.device?.gatt?.disconnect();
    this.device = null;
    this.char = null;
    this.setStatus("disconnected");
  }

  private setStatus(s: BTStatus) {
    this.status = s;
    this.onStatusChange?.(s);
  }
}

// ── Singletons ────────────────────────────────────────────
export const bleScanner = new BLEScanner();
export const blePrinter = new BLEPrinter();
export const isBTSupported = () =>
  typeof navigator !== "undefined" && "bluetooth" in navigator;
