// Real Web Serial API (USB) & Web Bluetooth API (BLE UART) helpers + Arduino ESP32 firmware generator

export const BLE_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_UART_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write to ESP32
export const BLE_UART_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify from ESP32

export interface SerialPortInfoLike {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo?: () => SerialPortInfoLike;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

export interface SerialConnection {
  port: SerialPortLike;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  stopReading: () => void;
  portLabel: string;
}

export interface BleDeviceLike {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<BleGattServerLike>;
    disconnect(): void;
  };
  addEventListener?: (type: string, listener: EventListener) => void;
}

interface BleGattServerLike {
  getPrimaryService(uuid: string): Promise<{
    getCharacteristic(uuid: string): Promise<BleCharacteristicLike>;
  }>;
}

interface BleCharacteristicLike extends EventTarget {
  value?: DataView;
  writeValue(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BleCharacteristicLike>;
}

export interface BleConnection {
  device: BleDeviceLike;
  rxChar: BleCharacteristicLike;
  txChar: BleCharacteristicLike | null;
  deviceName: string;
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function sanitizePhoneNumber(input: string): string {
  return input.replace(/[^\d+\-\s()]/g, '').trim().slice(0, 24);
}

export function formatPhoneForEsp32(input: string): string {
  // Strip spaces/hyphens/parentheses so SIM800L/SIM7600 AT+CMGS receives clean +919876543210
  return input.replace(/[^\d+]/g, '').slice(0, 20);
}

const KNOWN_USB_CHIPS: Record<number, string> = {
  0x10c4: 'Silicon Labs CP210x (ESP32)',
  0x1a86: 'WCH CH340 / CH9102 (ESP32)',
  0x0403: 'FTDI USB-UART (ESP32)',
  0x303a: 'Espressif Native USB (ESP32-S2/S3/C3)',
};

export function describeSerialPort(port: SerialPortLike): string {
  const info = port.getInfo?.();
  if (!info?.usbVendorId) return 'USB Serial Device';
  const known = KNOWN_USB_CHIPS[info.usbVendorId];
  const vid = info.usbVendorId.toString(16).padStart(4, '0').toUpperCase();
  const pid = (info.usbProductId || 0).toString(16).padStart(4, '0').toUpperCase();
  return known ? `${known} [${vid}:${pid}]` : `USB Serial [${vid}:${pid}]`;
}

export async function getAuthorizedSerialPorts(): Promise<SerialPortLike[]> {
  if (!isWebSerialSupported()) return [];
  try {
    const serialNav = navigator as unknown as {
      serial: { getPorts: () => Promise<SerialPortLike[]> };
    };
    return await serialNav.serial.getPorts();
  } catch {
    return [];
  }
}

export async function openSerialPort(
  port: SerialPortLike,
  onLine: (line: string) => void,
  baudRate = 115200,
  onDisconnect?: () => void
): Promise<SerialConnection> {
  try {
    await port.open({ baudRate });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('already open')) {
      throw new Error('This USB port is already open in another tab or window.');
    }
    if (msg.toLowerCase().includes('failed to open') || msg.toLowerCase().includes('busy')) {
      throw new Error(
        'Cannot open ESP32 USB port because another program is using it. Close Arduino IDE Serial Monitor or PlatformIO monitor, then retry.'
      );
    }
    throw new Error(`Unable to open ESP32 USB port: ${msg}`);
  }

  if (!port.writable) {
    await port.close().catch(() => undefined);
    throw new Error('Serial port opened without a writable stream.');
  }

  const writer = port.writable.getWriter();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let active = true;

  if (port.readable) {
    reader = port.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    void (async () => {
      try {
        while (active && reader) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const l of lines) {
              if (l.trim()) onLine(l.trim());
            }
          }
        }
      } catch {
        if (active && onDisconnect) {
          onDisconnect();
        }
      }
    })();
  }

  return {
    port,
    writer,
    reader,
    stopReading: () => {
      active = false;
    },
    portLabel: describeSerialPort(port),
  };
}

export async function connectEsp32Serial(
  onLine: (line: string) => void,
  baudRate = 115200,
  onDisconnect?: () => void
): Promise<SerialConnection> {
  if (!isWebSerialSupported()) {
    throw new Error(
      'USB Web Serial is only available in Chrome or Edge on a computer (Android & iPhone mobile browsers do not support USB Serial — use Bluetooth BLE or Wi-Fi Sync instead).'
    );
  }

  const serialNav = navigator as unknown as {
    serial: { requestPort: () => Promise<SerialPortLike> };
  };

  let port: SerialPortLike;
  try {
    port = await serialNav.serial.requestPort();
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : String(err);
    if (name === 'SecurityError' || msg.toLowerCase().includes('permissions policy')) {
      throw new Error(
        'Browser blocked USB access inside an embedded preview. Open RiderGuard directly in a full Chrome/Edge tab to connect your ESP32.'
      );
    }
    if (name === 'NotFoundError') {
      throw new Error(
        'No ESP32 USB port was selected. If the browser port list was empty: (1) use a DATA USB cable (not charge-only), (2) install the CP210x or CH340 USB driver on your PC, and (3) reconnect the ESP32.'
      );
    }
    throw new Error(msg || 'Unable to select USB serial port.');
  }

  return openSerialPort(port, onLine, baudRate, onDisconnect);
}

export async function sendSerialLine(conn: SerialConnection, command: string): Promise<void> {
  const bytes = new TextEncoder().encode(`${command.trim()}\n`);
  await conn.writer.write(bytes);
}

export async function disconnectEsp32Serial(conn: SerialConnection): Promise<void> {
  conn.stopReading();
  try {
    await conn.reader?.cancel();
  } catch {
    // Ignore reader cancel error
  }
  try {
    conn.reader?.releaseLock();
  } catch {
    // Ignore
  }
  try {
    conn.writer.releaseLock();
  } catch {
    // Ignore
  }
  try {
    await conn.port.close();
  } catch {
    // Ignore
  }
}

export async function connectEsp32Ble(
  onLine: (line: string) => void,
  options?: { acceptAllDevices?: boolean; onDisconnect?: () => void }
): Promise<BleConnection> {
  if (!isWebBluetoothSupported()) {
    throw new Error(
      'Web Bluetooth requires Chrome on Android or Desktop over HTTPS (iPhone Safari does not support Web Bluetooth — use Wi-Fi Cloud Sync instead).'
    );
  }

  const btNav = navigator as unknown as {
    bluetooth: {
      requestDevice: (opts: {
        acceptAllDevices?: boolean;
        filters?: Array<{ services?: string[]; namePrefix?: string }>;
        optionalServices?: string[];
      }) => Promise<BleDeviceLike>;
    };
  };

  let device: BleDeviceLike;
  try {
    device = options?.acceptAllDevices
      ? await btNav.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [BLE_UART_SERVICE_UUID],
        })
      : await btNav.bluetooth.requestDevice({
          filters: [
            { services: [BLE_UART_SERVICE_UUID] },
            { namePrefix: 'RiderGuard' },
            { namePrefix: 'ESP32' },
          ],
          optionalServices: [BLE_UART_SERVICE_UUID],
        });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : String(err);
    if (name === 'SecurityError' || msg.toLowerCase().includes('permissions policy')) {
      throw new Error(
        'Browser blocked Bluetooth inside an embedded preview. Open RiderGuard directly in a full Chrome tab to pair your ESP32.'
      );
    }
    if (name === 'NotFoundError') {
      throw new Error(
        'No Bluetooth device selected. If your ESP32 did not appear: (1) flash the RiderGuard Firmware (.ino) so it advertises BLE UART, (2) turn ON Bluetooth & Location on Android, or try "Scan All Bluetooth Devices".'
      );
    }
    throw new Error(msg || 'Unable to scan Bluetooth devices.');
  }

  if (!device.gatt) {
    throw new Error('Selected Bluetooth device does not support BLE GATT.');
  }

  if (options?.onDisconnect && device.addEventListener) {
    device.addEventListener('gattserverdisconnected', () => options.onDisconnect?.());
  }

  const server = await device.gatt.connect();
  let service: { getCharacteristic(uuid: string): Promise<BleCharacteristicLike> };
  try {
    service = await server.getPrimaryService(BLE_UART_SERVICE_UUID);
  } catch {
    device.gatt.disconnect();
    throw new Error(
      `Connected to "${device.name || 'Bluetooth Device'}", but RiderGuard BLE UART service was not found on it. Flash the RiderGuard Firmware (.ino) from the Firmware tab onto your ESP32 first (note: Classic BluetoothSerial is not supported by browsers; BLE is required).`
    );
  }

  const rxChar = await service.getCharacteristic(BLE_UART_RX_CHAR_UUID);

  let txChar: BleCharacteristicLike | null = null;
  try {
    txChar = await service.getCharacteristic(BLE_UART_TX_CHAR_UUID);
    await txChar.startNotifications();
    const decoder = new TextDecoder();
    txChar.addEventListener('characteristicvaluechanged', (ev: Event) => {
      const target = ev.target as BleCharacteristicLike;
      if (!target.value) return;
      const text = decoder.decode(target.value.buffer).trim();
      if (text) onLine(text);
    });
  } catch {
    txChar = null;
  }

  return {
    device,
    rxChar,
    txChar,
    deviceName: device.name || 'ESP32 BLE Unit',
  };
}

export async function sendBleLine(conn: BleConnection, command: string): Promise<void> {
  const bytes = new TextEncoder().encode(`${command.trim()}\n`);
  await conn.rxChar.writeValue(bytes);
}

export function disconnectEsp32Ble(conn: BleConnection): void {
  try {
    if (conn.device.gatt?.connected) {
      conn.device.gatt.disconnect();
    }
  } catch {
    // Ignore disconnect errors
  }
}

export function generateEsp32ArduinoSketch(params: {
  apiEndpoint: string;
  syncToken: string;
  deviceName: string;
  primaryNumber: string;
  secondaryNumber: string;
  tertiaryNumber: string;
}): string {
  const safeName = (params.deviceName || 'RiderGuard-ESP32').replace(/"/g, "'").slice(0, 28);
  return `/*
 * RiderGuard ESP32 Emergency Number Sync Firmware (v2)
 * Supports:
 *   1) USB Serial editing (115200 baud) from RiderGuard website (Web Serial)
 *   2) Bluetooth BLE UART editing from RiderGuard website (Web Bluetooth)
 *      - Advertises Nordic UART Service UUID + auto-restarts advertising on disconnect
 *   3) Wi-Fi HTTPS Cloud Polling + Live Online Heartbeat on RiderGuard website
 * Stores numbers permanently in ESP32 NVS Flash (Preferences.h) — survives power loss.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// --- Wi-Fi & RiderGuard Cloud Config ---
const char* WIFI_SSID          = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD      = "YOUR_WIFI_PASSWORD";
const char* RIDERGUARD_API_URL = "${params.apiEndpoint}";
const char* DEVICE_SYNC_TOKEN  = "${params.syncToken}";

// Nordic UART Service UUIDs (matching RiderGuard Web Bluetooth)
#define SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHAR_RX_UUID "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define CHAR_TX_UUID "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

Preferences prefs;
BLECharacteristic* pTxChar = nullptr;
bool bleClientConnected = false;

String primaryNumber   = "${formatPhoneForEsp32(params.primaryNumber)}";
String secondaryNumber = "${formatPhoneForEsp32(params.secondaryNumber)}";
String tertiaryNumber  = "${formatPhoneForEsp32(params.tertiaryNumber)}";
int configVersion      = 1;

unsigned long lastCloudPollMs = 0;
bool initialPollDone = false;
const unsigned long CLOUD_POLL_INTERVAL_MS = 30000; // Poll & send heartbeat every 30 seconds

void replyAll(const String& msg) {
  Serial.println(msg);
  if (pTxChar != nullptr && bleClientConnected) {
    pTxChar->setValue(msg.c_str());
    pTxChar->notify();
  }
}

void saveNumbersToFlash() {
  prefs.begin("riderguard", false);
  prefs.putString("num1", primaryNumber);
  prefs.putString("num2", secondaryNumber);
  prefs.putString("num3", tertiaryNumber);
  prefs.putInt("ver", configVersion);
  prefs.end();
  replyAll("OK:SAVED|" + primaryNumber + "|" + secondaryNumber + "|" + tertiaryNumber);
}

void loadNumbersFromFlash() {
  prefs.begin("riderguard", true);
  primaryNumber   = prefs.getString("num1", primaryNumber);
  secondaryNumber = prefs.getString("num2", secondaryNumber);
  tertiaryNumber  = prefs.getString("num3", tertiaryNumber);
  configVersion   = prefs.getInt("ver", 1);
  prefs.end();
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  if (cmd.startsWith("SET_PRIMARY:")) {
    primaryNumber = cmd.substring(12);
    primaryNumber.trim();
    replyAll("OK:PRIMARY=" + primaryNumber);
  } else if (cmd.startsWith("SET_SECONDARY:")) {
    secondaryNumber = cmd.substring(14);
    secondaryNumber.trim();
    replyAll("OK:SECONDARY=" + secondaryNumber);
  } else if (cmd.startsWith("SET_TERTIARY:")) {
    tertiaryNumber = cmd.substring(13);
    tertiaryNumber.trim();
    replyAll("OK:TERTIARY=" + tertiaryNumber);
  } else if (cmd == "SAVE_NUMBERS") {
    saveNumbersToFlash();
  } else if (cmd == "GET_CONFIG") {
    replyAll("CONFIG:" + primaryNumber + "|" + secondaryNumber + "|" + tertiaryNumber + "|v" + String(configVersion));
  } else if (cmd == "PING") {
    replyAll("PONG:RiderGuard-ESP32|v" + String(configVersion));
  } else {
    replyAll("ERR:UNKNOWN_CMD");
  }
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    bleClientConnected = true;
    Serial.println("BLE:Client connected");
  }
  void onDisconnect(BLEServer* pServer) override {
    bleClientConnected = false;
    Serial.println("BLE:Client disconnected — restarting advertising");
    delay(200);
    BLEDevice::startAdvertising();
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) override {
    String val = String(pChar->getValue().c_str());
    int start = 0;
    while (start < val.length()) {
      int nl = val.indexOf('\\n', start);
      if (nl == -1) nl = val.length();
      handleCommand(val.substring(start, nl));
      start = nl + 1;
    }
  }
};

void pollRiderGuardCloud() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(RIDERGUARD_API_URL) + "?rssi=" + String(WiFi.RSSI()) + "&fw=2.0";
  http.begin(url);
  http.addHeader("X-Device-Token", DEVICE_SYNC_TOKEN);

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, payload) == DeserializationError::Ok) {
      int remoteVer = doc["configVersion"] | configVersion;
      if (remoteVer > configVersion) {
        primaryNumber   = String((const char*)(doc["primaryNumber"]   | ""));
        secondaryNumber = String((const char*)(doc["secondaryNumber"] | ""));
        tertiaryNumber  = String((const char*)(doc["tertiaryNumber"]  | ""));
        configVersion   = remoteVer;
        saveNumbersToFlash();
        Serial.println("CLOUD_SYNC: Updated to v" + String(configVersion));
      } else {
        Serial.println("CLOUD_HEARTBEAT: Online (v" + String(configVersion) + ")");
      }
    }
  } else {
    Serial.println("CLOUD_SYNC_ERR: HTTP " + String(code));
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  loadNumbersFromFlash();

  // Initialize BLE UART for wireless editing from RiderGuard (Android Chrome / Desktop Chrome)
  BLEDevice::init("${safeName}");
  BLEServer* pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  BLEService* pService = pServer->createService(SERVICE_UUID);
  pTxChar = pService->createCharacteristic(CHAR_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  pTxChar->addDescriptor(new BLE2902());
  BLECharacteristic* pRxChar = pService->createCharacteristic(
    CHAR_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pRxChar->setCallbacks(new RxCallbacks());
  pService->start();

  // CRITICAL: Explicitly advertise the Nordic UART Service UUID so browsers always discover this ESP32
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  // Connect Wi-Fi for remote cloud sync & live online indicator
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("READY:RiderGuard ESP32 (BLE + USB + Wi-Fi)");
  handleCommand("GET_CONFIG");
}

void loop() {
  // 1) Process USB Serial commands from RiderGuard Website
  if (Serial.available()) {
    String line = Serial.readStringUntil('\\n');
    handleCommand(line);
  }

  // 2) Poll RiderGuard Cloud API immediately once Wi-Fi connects, then every 30 seconds
  if (WiFi.status() == WL_CONNECTED) {
    if (!initialPollDone || (millis() - lastCloudPollMs >= CLOUD_POLL_INTERVAL_MS)) {
      initialPollDone = true;
      lastCloudPollMs = millis();
      pollRiderGuardCloud();
    }
  }

  // Tip: Use primaryNumber, secondaryNumber, tertiaryNumber in your SIM800L / SIM7600
  // GSM AT+CMGS SMS or ATD emergency call routine when your MPU6050 detects a crash!
}
`;
}
