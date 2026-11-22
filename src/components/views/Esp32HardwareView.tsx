import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertCircle,
  AlertTriangle,
  Bluetooth,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  HelpCircle,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Terminal,
  Trash2,
  Usb,
  Users,
  Wifi,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  connectEsp32Ble,
  connectEsp32Serial,
  describeSerialPort,
  disconnectEsp32Ble,
  disconnectEsp32Serial,
  formatPhoneForEsp32,
  generateEsp32ArduinoSketch,
  getAuthorizedSerialPorts,
  isRunningInIframe,
  isWebBluetoothSupported,
  isWebSerialSupported,
  openSerialPort,
  sanitizePhoneNumber,
  sendBleLine,
  sendSerialLine,
  type BleConnection,
  type SerialConnection,
  type SerialPortLike,
} from '../../lib/esp32';
import { formatTimestamp, generateSecureId } from '../../lib/geo';
import type { EmergencyContact, Esp32Device, RiderProfile } from '../../types';
import { StatusText } from '../StatusText';

interface Esp32HardwareViewProps {
  profile: RiderProfile | null;
  contacts: EmergencyContact[];
  devices: Esp32Device[];
}

interface WifiLiveStatus {
  online: boolean;
  lastSeenIso: string | null;
  secondsAgo: number | null;
  pollCount: number;
  rssi: number | null;
  firmwareVersion: string;
}

export const Esp32HardwareView: React.FC<Esp32HardwareViewProps> = ({
  profile,
  contacts,
  devices,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  // Editable form state
  const [deviceName, setDeviceName] = useState('RiderGuard Helmet ESP32');
  const [hardwareModel, setHardwareModel] = useState('ESP32-WROOM + SIM800L + MPU6050');
  const [primaryNumber, setPrimaryNumber] = useState('');
  const [secondaryNumber, setSecondaryNumber] = useState('');
  const [tertiaryNumber, setTertiaryNumber] = useState('');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // USB Web Serial real connection state
  const serialConnRef = useRef<SerialConnection | null>(null);
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialPortLabel, setSerialPortLabel] = useState<string>('');
  const [serialBusy, setSerialBusy] = useState(false);
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [pairedPorts, setPairedPorts] = useState<SerialPortLike[]>([]);

  // Bluetooth Web BLE real connection state
  const bleConnRef = useRef<BleConnection | null>(null);
  const [bleConnectedName, setBleConnectedName] = useState<string | null>(null);
  const [bleBusy, setBleBusy] = useState(false);

  // Wi-Fi live heartbeat state from /api/esp32/status
  const [wifiStatus, setWifiStatus] = useState<WifiLiveStatus | null>(null);

  // Live hardware terminal log + manual command sender
  const [consoleLines, setConsoleLines] = useState<
    Array<{ ts: string; dir: 'TX' | 'RX' | 'SYS'; text: string }>
  >([]);
  const [manualCmd, setManualCmd] = useState('');

  // Cloud API tester, troubleshooter & firmware preview
  const [activeTab, setActiveTab] = useState<'sync' | 'firmware'>('sync');
  const [showTroubleshooter, setShowTroubleshooter] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<string | null>(null);
  const [testingApi, setTestingApi] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  const inIframe = useMemo(() => isRunningInIframe(), []);
  const standaloneUrl = typeof window !== 'undefined' ? window.location.href : '';

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedId) || devices[0] || null,
    [devices, selectedId]
  );

  const appendLog = useCallback((dir: 'TX' | 'RX' | 'SYS', text: string) => {
    const ts = new Date().toLocaleTimeString();
    setConsoleLines((prev) => [...prev.slice(-90), { ts, dir, text }]);
  }, []);

  // Parse CONFIG:num1|num2|num3|vN replies from ESP32 into helpful status message
  const handleHardwareRxLine = useCallback(
    (source: 'USB' | 'BLE', line: string) => {
      appendLog('RX', source === 'BLE' ? `[BLE] ${line}` : line);
      if (line.startsWith('CONFIG:')) {
        const parts = line.slice(7).split('|');
        const [p1 = '', p2 = '', p3 = '', ver = ''] = parts;
        setFeedback({
          type: 'ok',
          text: `ESP32 responded (${source}): Primary=${p1 || 'empty'}, Secondary=${p2 || 'empty'}, Tertiary=${p3 || 'empty'} ${ver ? `(${ver})` : ''}.`,
        });
      } else if (line.startsWith('OK:SAVED|')) {
        setFeedback({
          type: 'ok',
          text: `ESP32 confirmed emergency numbers saved permanently to flash memory (${source}).`,
        });
      }
    },
    [appendLog]
  );

  // Sync form inputs when selected device changes
  useEffect(() => {
    if (creatingNew) return;
    if (selectedDevice) {
      setSelectedId(selectedDevice.id);
      setDeviceName(selectedDevice.deviceName);
      setHardwareModel(selectedDevice.hardwareModel);
      setPrimaryNumber(selectedDevice.primaryNumber);
      setSecondaryNumber(selectedDevice.secondaryNumber);
      setTertiaryNumber(selectedDevice.tertiaryNumber);
    } else if (devices.length === 0) {
      const sorted = [...contacts].sort((a, b) => a.priority - b.priority);
      setPrimaryNumber((prev) => prev || sorted[0]?.mobileNumber || '');
      setSecondaryNumber((prev) => prev || sorted[1]?.mobileNumber || '');
      setTertiaryNumber((prev) => prev || sorted[2]?.mobileNumber || '');
    }
  }, [selectedDevice?.id, creatingNew, devices.length]);

  // Detect previously authorized USB Serial ports + live USB plug/unplug events
  useEffect(() => {
    if (!isWebSerialSupported() || inIframe) return;
    let cancelled = false;

    const refreshPorts = async () => {
      const ports = await getAuthorizedSerialPorts();
      if (!cancelled) setPairedPorts(ports);
    };

    void refreshPorts();

    const serialObj = (navigator as unknown as { serial?: EventTarget }).serial;
    const onConnect = () => {
      appendLog('SYS', 'USB serial device plugged in — ready to connect.');
      void refreshPorts();
    };
    const onDisconnect = () => {
      appendLog('SYS', 'USB serial device unplugged.');
      void refreshPorts();
    };

    serialObj?.addEventListener?.('connect', onConnect);
    serialObj?.addEventListener?.('disconnect', onDisconnect);

    return () => {
      cancelled = true;
      serialObj?.removeEventListener?.('connect', onConnect);
      serialObj?.removeEventListener?.('disconnect', onDisconnect);
    };
  }, [inIframe, appendLog]);

  // Poll live Wi-Fi heartbeat status for selected ESP32 every 5 seconds
  const fetchWifiHeartbeat = useCallback(async () => {
    if (!selectedDevice?.syncToken || creatingNew) {
      setWifiStatus(null);
      return;
    }
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;
      const resp = await fetch(
        `/api/esp32/status?token=${encodeURIComponent(selectedDevice.syncToken)}`,
        {
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );
      if (!resp.ok) return;
      const data = (await resp.json()) as WifiLiveStatus;
      setWifiStatus(data);
    } catch {
      // Ignore transient poll errors
    }
  }, [selectedDevice?.syncToken, creatingNew]);

  useEffect(() => {
    void fetchWifiHeartbeat();
    if (!selectedDevice?.syncToken || creatingNew) return;
    const id = window.setInterval(() => {
      void fetchWifiHeartbeat();
    }, 5000);
    return () => window.clearInterval(id);
  }, [fetchWifiHeartbeat, selectedDevice?.syncToken, creatingNew]);

  // Cleanup hardware connections on unmount
  useEffect(() => {
    return () => {
      if (serialConnRef.current) {
        void disconnectEsp32Serial(serialConnRef.current);
      }
      if (bleConnRef.current) {
        disconnectEsp32Ble(bleConnRef.current);
      }
    };
  }, []);

  const apiEndpoint =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/esp32/numbers`
      : 'https://your-riderguard-app.run.app/api/esp32/numbers';

  const handleImportFromContacts = () => {
    const sorted = [...contacts].sort((a, b) => a.priority - b.priority);
    if (sorted.length === 0) {
      setFeedback({
        type: 'err',
        text: 'No emergency contacts found yet. Add contacts in Emergency Contacts first or type numbers manually.',
      });
      return;
    }
    setPrimaryNumber(sorted[0]?.mobileNumber || '');
    setSecondaryNumber(sorted[1]?.mobileNumber || '');
    setTertiaryNumber(sorted[2]?.mobileNumber || '');
    setFeedback({
      type: 'ok',
      text: `Imported top ${Math.min(3, sorted.length)} priority emergency contact number(s). Click Save to Cloud or Push to ESP32 to apply.`,
    });
  };

  const persistDeviceNumbers = async (
    syncMethod: 'WIFI_CLOUD' | 'USB_SERIAL' | 'BLUETOOTH_BLE' = 'WIFI_CLOUD'
  ): Promise<Esp32Device | null> => {
    if (!profile) return null;
    const cleanPrimary = sanitizePhoneNumber(primaryNumber);
    const cleanSecondary = sanitizePhoneNumber(secondaryNumber);
    const cleanTertiary = sanitizePhoneNumber(tertiaryNumber);

    if (!deviceName.trim()) {
      setFeedback({ type: 'err', text: 'Please enter a name for your ESP32 module.' });
      return null;
    }
    if (!cleanPrimary) {
      setFeedback({
        type: 'err',
        text: 'Enter at least a Primary Emergency Phone Number (e.g. +919876543210).',
      });
      return null;
    }

    setSaving(true);
    setFeedback(null);

    const isUpdate = Boolean(selectedDevice && !creatingNew);
    const deviceId = isUpdate ? selectedDevice!.id : generateSecureId('esp', 20);
    const syncToken = isUpdate ? selectedDevice!.syncToken : generateSecureId('esptok', 28);
    const nextVersion = isUpdate ? (selectedDevice!.configVersion || 1) + 1 : 1;
    const nowIso = new Date().toISOString();

    const devicePath = `esp32Devices/${deviceId}`;
    const configPath = `esp32SyncConfigs/${syncToken}`;

    try {
      if (isUpdate) {
        await updateDoc(doc(db, 'esp32Devices', deviceId), {
          deviceName: deviceName.trim().slice(0, 80),
          hardwareModel: hardwareModel.trim().slice(0, 80),
          primaryNumber: cleanPrimary,
          secondaryNumber: cleanSecondary,
          tertiaryNumber: cleanTertiary,
          configVersion: nextVersion,
          lastSyncMethod: syncMethod,
          lastSyncedAtIso: nowIso,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'esp32Devices', deviceId), {
          riderId: profile.uid,
          deviceName: deviceName.trim().slice(0, 80),
          hardwareModel: hardwareModel.trim().slice(0, 80),
          primaryNumber: cleanPrimary,
          secondaryNumber: cleanSecondary,
          tertiaryNumber: cleanTertiary,
          syncToken,
          configVersion: nextVersion,
          lastSyncMethod: syncMethod,
          lastSyncedAtIso: nowIso,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      // Write matching token-scoped config for ESP32 HTTPS Wi-Fi polling
      await setDoc(doc(db, 'esp32SyncConfigs', syncToken), {
        riderId: profile.uid,
        deviceId,
        deviceName: deviceName.trim().slice(0, 80),
        primaryNumber: formatPhoneForEsp32(cleanPrimary),
        secondaryNumber: formatPhoneForEsp32(cleanSecondary),
        tertiaryNumber: formatPhoneForEsp32(cleanTertiary),
        configVersion: nextVersion,
        updatedAt: serverTimestamp(),
      });

      setCreatingNew(false);
      setSelectedId(deviceId);
      setFeedback({
        type: 'ok',
        text: `Saved emergency numbers (config v${nextVersion}) to cloud. Your ESP32 can pull them over Wi-Fi or receive them immediately via USB/Bluetooth below.`,
      });

      return {
        id: deviceId,
        riderId: profile.uid,
        deviceName: deviceName.trim().slice(0, 80),
        hardwareModel: hardwareModel.trim().slice(0, 80),
        primaryNumber: cleanPrimary,
        secondaryNumber: cleanSecondary,
        tertiaryNumber: cleanTertiary,
        syncToken,
        configVersion: nextVersion,
        lastSyncMethod: syncMethod,
        lastSyncedAtIso: nowIso,
      };
    } catch (err) {
      handleFirestoreError(
        err,
        isUpdate ? OperationType.UPDATE : OperationType.CREATE,
        `${devicePath} / ${configPath}`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRotateToken = async () => {
    if (!profile || !selectedDevice) return;
    setSaving(true);
    setFeedback(null);
    const oldToken = selectedDevice.syncToken;
    const newToken = generateSecureId('esptok', 28);
    const nextVersion = (selectedDevice.configVersion || 1) + 1;

    try {
      await setDoc(doc(db, 'esp32SyncConfigs', newToken), {
        riderId: profile.uid,
        deviceId: selectedDevice.id,
        deviceName: selectedDevice.deviceName,
        primaryNumber: formatPhoneForEsp32(selectedDevice.primaryNumber),
        secondaryNumber: formatPhoneForEsp32(selectedDevice.secondaryNumber),
        tertiaryNumber: formatPhoneForEsp32(selectedDevice.tertiaryNumber),
        configVersion: nextVersion,
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'esp32Devices', selectedDevice.id), {
        syncToken: newToken,
        configVersion: nextVersion,
        updatedAt: serverTimestamp(),
      });

      await deleteDoc(doc(db, 'esp32SyncConfigs', oldToken)).catch(() => undefined);

      setFeedback({
        type: 'ok',
        text: 'Device sync token rotated. Old token is revoked; update DEVICE_SYNC_TOKEN in your ESP32 sketch.',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `esp32Devices/${selectedDevice.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDevice = async (device: Esp32Device) => {
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'esp32Devices', device.id));
      await deleteDoc(doc(db, 'esp32SyncConfigs', device.syncToken)).catch(() => undefined);
      setSelectedId(null);
      setFeedback({
        type: 'ok',
        text: `Deleted ESP32 unit "${device.deviceName}" and revoked its sync token.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `esp32Devices/${device.id}`);
    } finally {
      setSaving(false);
    }
  };

  // --- USB Web Serial Handlers ---
  const attachSerialConnection = async (conn: SerialConnection) => {
    serialConnRef.current = conn;
    setSerialConnected(true);
    setSerialPortLabel(conn.portLabel);
    appendLog('SYS', `USB Serial connected (${conn.portLabel}) at ${baudRate} baud.`);
    await sendSerialLine(conn, 'GET_CONFIG');
    appendLog('TX', 'GET_CONFIG');
    const ports = await getAuthorizedSerialPorts();
    setPairedPorts(ports);
  };

  const handleConnectUsb = async (existingPort?: SerialPortLike) => {
    setSerialBusy(true);
    setFeedback(null);
    try {
      const onUnexpectedDisconnect = () => {
        serialConnRef.current = null;
        setSerialConnected(false);
        setSerialPortLabel('');
        appendLog('SYS', 'ESP32 USB connection lost.');
      };
      const conn = existingPort
        ? await openSerialPort(
            existingPort,
            (line) => handleHardwareRxLine('USB', line),
            baudRate,
            onUnexpectedDisconnect
          )
        : await connectEsp32Serial(
            (line) => handleHardwareRxLine('USB', line),
            baudRate,
            onUnexpectedDisconnect
          );
      await attachSerialConnection(conn);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to connect to ESP32 over USB Serial.',
      });
    } finally {
      setSerialBusy(false);
    }
  };

  const handleDisconnectUsb = async () => {
    if (!serialConnRef.current) return;
    await disconnectEsp32Serial(serialConnRef.current);
    serialConnRef.current = null;
    setSerialConnected(false);
    setSerialPortLabel('');
    appendLog('SYS', 'USB Serial disconnected.');
  };

  const handlePushViaUsb = async () => {
    if (!serialConnRef.current) return;
    const p1 = formatPhoneForEsp32(primaryNumber);
    const p2 = formatPhoneForEsp32(secondaryNumber);
    const p3 = formatPhoneForEsp32(tertiaryNumber);
    if (!p1) {
      setFeedback({ type: 'err', text: 'Enter a Primary Emergency Number before pushing to ESP32.' });
      return;
    }

    setSerialBusy(true);
    setFeedback(null);
    try {
      const cmds = [
        `SET_PRIMARY:${p1}`,
        `SET_SECONDARY:${p2}`,
        `SET_TERTIARY:${p3}`,
        'SAVE_NUMBERS',
      ];
      for (const cmd of cmds) {
        await sendSerialLine(serialConnRef.current, cmd);
        appendLog('TX', cmd);
        await new Promise((r) => setTimeout(r, 120));
      }
      await persistDeviceNumbers('USB_SERIAL');
      setFeedback({
        type: 'ok',
        text: 'Emergency numbers pushed to ESP32 over USB Serial and saved to cloud.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed writing commands to USB Serial.',
      });
    } finally {
      setSerialBusy(false);
    }
  };

  const handleReadFromUsb = async () => {
    if (!serialConnRef.current) return;
    try {
      await sendSerialLine(serialConnRef.current, 'GET_CONFIG');
      appendLog('TX', 'GET_CONFIG');
    } catch (err) {
      appendLog('SYS', `Read failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // --- Bluetooth Web BLE Handlers ---
  const handleConnectBle = async (acceptAllDevices = false) => {
    setBleBusy(true);
    setFeedback(null);
    try {
      const conn = await connectEsp32Ble((line) => handleHardwareRxLine('BLE', line), {
        acceptAllDevices,
        onDisconnect: () => {
          bleConnRef.current = null;
          setBleConnectedName(null);
          appendLog('SYS', 'Bluetooth BLE device disconnected.');
        },
      });
      bleConnRef.current = conn;
      setBleConnectedName(conn.deviceName);
      appendLog('SYS', `Connected via Bluetooth BLE to ${conn.deviceName}.`);
      await sendBleLine(conn, 'GET_CONFIG');
      appendLog('TX', '[BLE] GET_CONFIG');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to connect to ESP32 via Bluetooth BLE.',
      });
    } finally {
      setBleBusy(false);
    }
  };

  const handleDisconnectBle = () => {
    if (!bleConnRef.current) return;
    disconnectEsp32Ble(bleConnRef.current);
    bleConnRef.current = null;
    setBleConnectedName(null);
    appendLog('SYS', 'Bluetooth BLE disconnected.');
  };

  const handlePushViaBle = async () => {
    if (!bleConnRef.current) return;
    const p1 = formatPhoneForEsp32(primaryNumber);
    const p2 = formatPhoneForEsp32(secondaryNumber);
    const p3 = formatPhoneForEsp32(tertiaryNumber);
    if (!p1) {
      setFeedback({
        type: 'err',
        text: 'Enter a Primary Emergency Number before pushing via Bluetooth.',
      });
      return;
    }

    setBleBusy(true);
    setFeedback(null);
    try {
      const cmds = [
        `SET_PRIMARY:${p1}`,
        `SET_SECONDARY:${p2}`,
        `SET_TERTIARY:${p3}`,
        'SAVE_NUMBERS',
      ];
      for (const cmd of cmds) {
        await sendBleLine(bleConnRef.current, cmd);
        appendLog('TX', `[BLE] ${cmd}`);
        await new Promise((r) => setTimeout(r, 150));
      }
      await persistDeviceNumbers('BLUETOOTH_BLE');
      setFeedback({
        type: 'ok',
        text: 'Emergency numbers pushed wirelessly to ESP32 over Bluetooth BLE and saved to cloud.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Bluetooth BLE write failed.',
      });
    } finally {
      setBleBusy(false);
    }
  };

  const handleSendManualCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = manualCmd.trim();
    if (!cmd) return;
    if (serialConnRef.current) {
      try {
        await sendSerialLine(serialConnRef.current, cmd);
        appendLog('TX', cmd);
        setManualCmd('');
      } catch (err) {
        appendLog('SYS', `USB send failed: ${err instanceof Error ? err.message : 'Error'}`);
      }
    } else if (bleConnRef.current) {
      try {
        await sendBleLine(bleConnRef.current, cmd);
        appendLog('TX', `[BLE] ${cmd}`);
        setManualCmd('');
      } catch (err) {
        appendLog('SYS', `BLE send failed: ${err instanceof Error ? err.message : 'Error'}`);
      }
    }
  };

  // --- Live Cloud Endpoint Test ---
  const handleTestCloudApi = async () => {
    if (!selectedDevice?.syncToken) return;
    setTestingApi(true);
    setApiTestResult(null);
    try {
      const resp = await fetch('/api/esp32/numbers?test=1', {
        headers: { 'X-Device-Token': selectedDevice.syncToken },
      });
      const data = await resp.json();
      setApiTestResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setApiTestResult(`Request failed: ${err instanceof Error ? err.message : 'Network error'}`);
    } finally {
      setTestingApi(false);
    }
  };

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const firmwareCode = useMemo(
    () =>
      generateEsp32ArduinoSketch({
        apiEndpoint,
        syncToken: selectedDevice?.syncToken || 'SAVE_DEVICE_FIRST_TO_GENERATE_TOKEN',
        deviceName,
        primaryNumber,
        secondaryNumber,
        tertiaryNumber,
      }),
    [apiEndpoint, selectedDevice?.syncToken, deviceName, primaryNumber, secondaryNumber, tertiaryNumber]
  );

  const handleDownloadSketch = () => {
    const blob = new Blob([firmwareCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'RiderGuard_ESP32_NumberSync.ino';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const anyHardwareConnected = serialConnected || Boolean(bleConnectedName) || Boolean(wifiStatus?.online);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            ESP32 Emergency Number Manager
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Connect your ESP32 via USB Cable, Bluetooth BLE, or Wi-Fi Cloud Sync to monitor live status and update emergency phone numbers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('sync')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'sync' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Number Editor &amp; Sync
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('firmware')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'firmware' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ESP32 Firmware (.ino)
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setCreatingNew(true);
              setDeviceName(`RiderGuard ESP32 #${devices.length + 1}`);
              setHardwareModel('ESP32-WROOM + SIM800L + MPU6050');
              setPrimaryNumber('');
              setSecondaryNumber('');
              setTertiaryNumber('');
              setActiveTab('sync');
              setFeedback(null);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add ESP32 Unit
          </button>
        </div>
      </div>

      {/* Iframe Hardware Permission Warning (Critical when previewing inside embedded frame) */}
      {inIframe && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 max-w-2xl">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold">
                ESP32 USB &amp; Bluetooth connections require opening RiderGuard in a full browser tab
              </div>
              <p className="text-amber-900 leading-relaxed">
                You are currently viewing RiderGuard inside an embedded preview frame, where browsers block direct USB Serial and Bluetooth access for security. Open the direct app tab below (or use Wi-Fi Cloud Sync) to connect your ESP32.
              </p>
            </div>
          </div>
          {standaloneUrl && (
            <a
              href={standaloneUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-amber-900 hover:bg-amber-950 rounded-lg whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Full Browser Tab
            </a>
          )}
        </div>
      )}

      {/* Live 3-Channel ESP32 Connection Status Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Usb className="w-3.5 h-3.5" />
              USB Cable (Web Serial)
            </div>
            <div className="text-xs font-medium text-slate-800 truncate mt-1">
              {serialConnected
                ? serialPortLabel
                : pairedPorts.length > 0
                  ? `${pairedPorts.length} paired port ready`
                  : isWebSerialSupported()
                    ? 'Click Connect below'
                    : 'Desktop Chrome/Edge only'}
            </div>
          </div>
          <StatusText status={serialConnected ? 'CONNECTED' : 'DISCONNECTED'} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Bluetooth className="w-3.5 h-3.5" />
              Bluetooth (Web BLE)
            </div>
            <div className="text-xs font-medium text-slate-800 truncate mt-1">
              {bleConnectedName
                ? bleConnectedName
                : isWebBluetoothSupported()
                  ? 'Click Pair below'
                  : 'Chrome Android/Desktop only'}
            </div>
          </div>
          <StatusText status={bleConnectedName ? 'CONNECTED' : 'DISCONNECTED'} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5" />
              Wi-Fi Cloud Heartbeat
            </div>
            <div className="text-xs font-medium text-slate-800 truncate mt-1">
              {wifiStatus?.online
                ? `Online · ${wifiStatus.secondsAgo ?? 0}s ago${wifiStatus.rssi !== null ? ` (${wifiStatus.rssi} dBm)` : ''}`
                : wifiStatus?.lastSeenIso
                  ? `Last seen ${formatTimestamp(wifiStatus.lastSeenIso)}`
                  : selectedDevice
                    ? 'Waiting for ESP32 Wi-Fi poll'
                    : 'Save device first'}
            </div>
          </div>
          <StatusText status={wifiStatus?.online ? 'ONLINE' : 'OFFLINE'} />
        </div>
      </div>

      {/* Built-in Troubleshooter for "ESP32 is ON but not showing in website" */}
      {!anyHardwareConnected && (
        <div className="bg-slate-900 text-slate-100 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>ESP32 is powered ON, but not showing up on the website?</span>
            </div>
            <button
              type="button"
              onClick={() => setShowTroubleshooter((v) => !v)}
              className="px-3 py-1 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-md cursor-pointer"
            >
              {showTroubleshooter ? 'Hide Checklist' : 'Fix Connection (5 Checks)'}
            </button>
          </div>

          {showTroubleshooter && (
            <ol className="mt-3 pt-3 border-t border-slate-800 space-y-2 text-xs text-slate-300 list-decimal pl-5 leading-relaxed">
              <li>
                <strong className="text-white">Websites cannot auto-connect to plugged-in hardware:</strong>{' '}
                For browser security, plugging in an ESP32 never makes it appear automatically. You must click{' '}
                <strong className="text-white">Connect ESP32 via USB</strong> (on PC Chrome/Edge) or{' '}
                <strong className="text-white">Pair ESP32 via Bluetooth</strong> (on Android/PC Chrome) and pick it in the browser popup.
              </li>
              <li>
                <strong className="text-white">Using a phone with USB OTG?</strong>{' '}
                Android Chrome &amp; iPhone Safari do <em>not</em> support USB Web Serial. Instead, use{' '}
                <strong className="text-white">Bluetooth BLE</strong> (Android Chrome) or{' '}
                <strong className="text-white">Wi-Fi Cloud Sync</strong> (works on every phone &amp; computer).
              </li>
              <li>
                <strong className="text-white">ESP32 LED is ON, but no USB port appears on PC:</strong>{' '}
                Many USB cables are <em>charge-only</em> (power turns the LED on, but there are no data wires). Try a data USB cable, install the{' '}
                <strong className="text-white">CP210x</strong> or <strong className="text-white">CH340</strong> USB driver, and close Arduino IDE Serial Monitor.
              </li>
              <li>
                <strong className="text-white">Not appearing in Bluetooth scan:</strong>{' '}
                Browsers only scan <strong>Bluetooth Low Energy (BLE)</strong> — not Classic Bluetooth (<code className="text-amber-300">BluetoothSerial</code>). Flash the{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('firmware')}
                  className="underline text-amber-300 font-semibold cursor-pointer"
                >
                  ESP32 Firmware (.ino)
                </button>{' '}
                first, turn on Location on Android, or click <strong className="text-white">Scan All Bluetooth Devices</strong> below.
              </li>
              <li>
                <strong className="text-white">Using Wi-Fi Cloud Sync:</strong>{' '}
                After flashing the RiderGuard <code className="text-amber-300">.ino</code> sketch with your Wi-Fi SSID/password and Sync Token, the ESP32 pings RiderGuard automatically every 30 seconds and the <strong className="text-emerald-400">Wi-Fi Cloud Heartbeat</strong> card above turns <strong className="text-emerald-400">ONLINE</strong>.
              </li>
            </ol>
          )}
        </div>
      )}

      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-start gap-2.5 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Registered ESP32 Selector Strip */}
      {devices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {devices.map((d) => {
            const active = !creatingNew && selectedDevice?.id === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setCreatingNew(false);
                  setSelectedId(d.id);
                  setApiTestResult(null);
                }}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>{d.deviceName}</span>
                <span className={`font-mono-tabular ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                  v{d.configVersion}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {activeTab === 'sync' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Phone Number Editor Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void persistDeviceNumbers('WIFI_CLOUD');
            }}
            className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  {creatingNew || !selectedDevice
                    ? 'Register & Configure ESP32 Numbers'
                    : `Edit Numbers — ${selectedDevice.deviceName}`}
                </h2>
                {selectedDevice && !creatingNew && (
                  <p className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                    Config v{selectedDevice.configVersion} · Last sync {formatTimestamp(selectedDevice.lastSyncedAtIso)} ({selectedDevice.lastSyncMethod})
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={handleImportFromContacts}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap"
              >
                <Users className="w-3.5 h-3.5" />
                Fill from Emergency Contacts
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="esp-name">
                  Device Name *
                </label>
                <input
                  id="esp-name"
                  type="text"
                  required
                  maxLength={80}
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g. Smart Helmet ESP32"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="esp-model">
                  Hardware Board / GSM Module
                </label>
                <input
                  id="esp-model"
                  type="text"
                  maxLength={80}
                  value={hardwareModel}
                  onChange={(e) => setHardwareModel(e.target.value)}
                  placeholder="ESP32 + SIM800L + MPU6050"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <div className="space-y-4 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="esp-num-1">
                  Primary Emergency Number (Slot 1 — Dialed &amp; SMS First) *
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="esp-num-1"
                    type="tel"
                    required
                    maxLength={24}
                    value={primaryNumber}
                    onChange={(e) => setPrimaryNumber(e.target.value)}
                    placeholder="+919876543210"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Include country code (e.g. +91 for India, +1 for US) so SIM800L / SIM7600 AT commands work reliably.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="esp-num-2">
                  Secondary Emergency Number (Slot 2 — Optional)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="esp-num-2"
                    type="tel"
                    maxLength={24}
                    value={secondaryNumber}
                    onChange={(e) => setSecondaryNumber(e.target.value)}
                    placeholder="+919876543211"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="esp-num-3">
                  Tertiary Emergency Number (Slot 3 — Optional)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="esp-num-3"
                    type="tel"
                    maxLength={24}
                    value={tertiaryNumber}
                    onChange={(e) => setTertiaryNumber(e.target.value)}
                    placeholder="+91108"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Numbers to Cloud'}
              </button>

              {selectedDevice && !creatingNew && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDeleteDevice(selectedDevice)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Unit
                </button>
              )}
            </div>
          </form>

          {/* Right Column: 3 Real Hardware Sync Channels (USB Serial, Bluetooth BLE, Wi-Fi Cloud) */}
          <div className="lg:col-span-6 space-y-4">
            {/* Channel 1: Direct USB Serial */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Usb className="w-4 h-4 text-slate-900" />
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    1. Push via USB Cable (Web Serial)
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {!serialConnected && isWebSerialSupported() && (
                    <select
                      aria-label="USB Serial Baud Rate"
                      value={baudRate}
                      onChange={(e) => setBaudRate(Number(e.target.value))}
                      className="text-[11px] font-mono-tabular border border-slate-300 rounded-md px-2 py-1 bg-white text-slate-700"
                    >
                      <option value={115200}>115200 baud</option>
                      <option value={9600}>9600 baud</option>
                      <option value={57600}>57600 baud</option>
                    </select>
                  )}
                  <StatusText status={serialConnected ? 'CONNECTED' : 'DISCONNECTED'} />
                </div>
              </div>

              {!isWebSerialSupported() ? (
                <p className="text-xs text-slate-600 leading-relaxed">
                  USB Web Serial is only supported in <strong>Chrome or Edge on a PC/Mac</strong> (mobile phone browsers cannot read USB OTG serial ports). Use <strong>Bluetooth BLE</strong> or <strong>Wi-Fi Cloud Sync</strong> below from your phone.
                </p>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {!serialConnected ? (
                      <>
                        <button
                          type="button"
                          disabled={serialBusy}
                          onClick={() => void handleConnectUsb()}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          <Usb className="w-3.5 h-3.5" />
                          {serialBusy ? 'Opening Port...' : 'Connect ESP32 via USB'}
                        </button>
                        {pairedPorts.map((port, idx) => (
                          <button
                            key={idx}
                            type="button"
                            disabled={serialBusy}
                            onClick={() => void handleConnectUsb(port)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg cursor-pointer whitespace-nowrap"
                          >
                            Reconnect {describeSerialPort(port)}
                          </button>
                        ))}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={serialBusy}
                          onClick={() => void handlePushViaUsb()}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Push Numbers to ESP32
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReadFromUsb()}
                          className="px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Read Stored Numbers
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDisconnectUsb()}
                          className="px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Disconnect
                        </button>
                      </>
                    )}
                  </div>
                  {!serialConnected && (
                    <p className="text-[11px] text-slate-500">
                      Plug ESP32 with a data USB cable, close Arduino Serial Monitor, and select CP210x / CH340 / ESP32 in the browser popup.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Channel 2: Wireless Bluetooth BLE */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bluetooth className="w-4 h-4 text-sky-700" />
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    2. Push Wirelessly via Bluetooth (Web BLE UART)
                  </h3>
                </div>
                <StatusText status={bleConnectedName ? 'CONNECTED' : 'DISCONNECTED'} />
              </div>

              {!isWebBluetoothSupported() ? (
                <p className="text-xs text-slate-600 leading-relaxed">
                  Web Bluetooth requires <strong>Chrome on Android or Desktop</strong> over HTTPS. On iPhone/Safari, use <strong>Wi-Fi Cloud Sync</strong> below.
                </p>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {!bleConnectedName ? (
                      <>
                        <button
                          type="button"
                          disabled={bleBusy}
                          onClick={() => void handleConnectBle(false)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          <Bluetooth className="w-3.5 h-3.5" />
                          {bleBusy ? 'Scanning...' : 'Pair RiderGuard ESP32'}
                        </button>
                        <button
                          type="button"
                          disabled={bleBusy}
                          onClick={() => void handleConnectBle(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Scan All Bluetooth Devices
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={bleBusy}
                          onClick={() => void handlePushViaBle()}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Push Numbers to {bleConnectedName}
                        </button>
                        <button
                          type="button"
                          onClick={handleDisconnectBle}
                          className="px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Disconnect BLE
                        </button>
                      </>
                    )}
                  </div>
                  {!bleConnectedName && (
                    <p className="text-[11px] text-slate-500">
                      Requires BLE firmware from the <strong>ESP32 Firmware (.ino)</strong> tab. If your ESP32 has a custom Bluetooth name, use <strong>Scan All Bluetooth Devices</strong>.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Channel 3: Wi-Fi HTTPS Cloud Polling */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-emerald-700" />
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    3. Remote Wi-Fi Cloud Polling API
                  </h3>
                </div>
                <span className="font-mono-tabular text-xs text-slate-500">
                  {selectedDevice ? `v${selectedDevice.configVersion}` : 'Unsaved'}
                </span>
              </div>

              {selectedDevice && !creatingNew ? (
                <div className="space-y-3 text-xs">
                  <div>
                    <div className="text-slate-500 mb-1">HTTPS GET Endpoint</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-mono-tabular text-[11px] text-slate-800 truncate">
                        {apiEndpoint}
                      </code>
                      <button
                        type="button"
                        onClick={() => void handleCopy('url', apiEndpoint)}
                        className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 rounded-md cursor-pointer"
                        aria-label="Copy endpoint URL"
                      >
                        {copiedKey === 'url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-slate-500 mb-1">
                      <span>Header: X-Device-Token</span>
                      <button
                        type="button"
                        onClick={() => setShowToken((v) => !v)}
                        className="text-slate-700 underline cursor-pointer"
                      >
                        {showToken ? 'Hide' : 'Reveal'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-mono-tabular text-[11px] text-slate-800 truncate">
                        {showToken
                          ? selectedDevice.syncToken
                          : `${selectedDevice.syncToken.slice(0, 10)}••••••••••••••••••••`}
                      </code>
                      <button
                        type="button"
                        onClick={() => void handleCopy('token', selectedDevice.syncToken)}
                        className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 rounded-md cursor-pointer"
                        aria-label="Copy device sync token"
                      >
                        {copiedKey === 'token' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={testingApi}
                      onClick={() => void handleTestCloudApi()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingApi ? 'animate-spin' : ''}`} />
                      Test Live ESP32 API Response
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleRotateToken()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Rotate Token
                    </button>
                  </div>

                  {apiTestResult && (
                    <pre className="p-3 bg-slate-900 text-emerald-300 rounded-lg font-mono-tabular text-[11px] overflow-x-auto">
                      {apiTestResult}
                    </pre>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Save your numbers to cloud first to generate a private ESP32 sync token and live HTTPS endpoint.
                </p>
              )}
            </div>

            {/* Live Hardware Console Output + Manual Command Box */}
            <div className="bg-slate-950 text-slate-200 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2 font-mono-tabular text-slate-300">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>ESP32 Live Serial / BLE Console</span>
                </div>
                {consoleLines.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConsoleLines([])}
                    className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="h-36 overflow-y-auto font-mono-tabular text-[11px] space-y-1">
                {consoleLines.length === 0 ? (
                  <div className="text-slate-500">
                    Connect an ESP32 over USB Serial or Bluetooth BLE to view live hardware responses here.
                  </div>
                ) : (
                  consoleLines.map((line, i) => (
                    <div key={`${line.ts}-${i}`} className="flex gap-2">
                      <span className="text-slate-500 shrink-0">{line.ts}</span>
                      <span
                        className={
                          line.dir === 'TX'
                            ? 'text-sky-400'
                            : line.dir === 'RX'
                              ? 'text-emerald-400'
                              : 'text-amber-300'
                        }
                      >
                        [{line.dir}]
                      </span>
                      <span className="break-all">{line.text}</span>
                    </div>
                  ))
                )}
              </div>

              {(serialConnected || bleConnectedName) && (
                <form onSubmit={(e) => void handleSendManualCommand(e)} className="flex gap-2 pt-1 border-t border-slate-800">
                  <input
                    type="text"
                    value={manualCmd}
                    onChange={(e) => setManualCmd(e.target.value)}
                    placeholder="Send command (e.g. PING, GET_CONFIG, SET_PRIMARY:+91...)"
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono-tabular bg-slate-900 border border-slate-700 rounded-md text-white placeholder:text-slate-500 focus:outline-none focus:border-slate-500"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-md cursor-pointer"
                  >
                    <Send className="w-3 h-3" />
                    Send
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Firmware Tab: Ready-to-flash Arduino C++ Sketch pre-filled with endpoint & token */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Code2 className="w-5 h-5 text-slate-900" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Ready-to-Flash ESP32 Arduino Firmware (.ino)
                </h2>
                <p className="text-xs text-slate-500">
                  Advertises BLE UART Service UUID (with auto-reconnect), USB Serial (115200 baud), and Wi-Fi Cloud Heartbeat every 30s. Requires ArduinoJson library.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopy('sketch', firmwareCode)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
              >
                {copiedKey === 'sketch' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'sketch' ? 'Copied Sketch' : 'Copy Code'}
              </button>
              <button
                type="button"
                onClick={handleDownloadSketch}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Download .ino
              </button>
            </div>
          </div>
          <pre className="p-5 bg-slate-950 text-slate-100 font-mono-tabular text-xs overflow-x-auto max-h-[560px] leading-relaxed">
            {firmwareCode}
          </pre>
        </div>
      )}
    </div>
  );
};
