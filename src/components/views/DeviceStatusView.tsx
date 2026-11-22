import React from 'react';
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Clock,
  Cpu,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { formatCoords, formatTimestamp } from '../../lib/geo';
import type { LiveTelemetryState } from '../../types';
import { StatusText } from '../StatusText';

interface DeviceStatusViewProps {
  telemetry: LiveTelemetryState;
  onRequestGps: () => void;
  onEnableSensors: () => void;
  onSyncDeviceNow: () => Promise<void>;
  syncing: boolean;
}

export const DeviceStatusView: React.FC<DeviceStatusViewProps> = ({
  telemetry,
  onRequestGps,
  onEnableSensors,
  onSyncDeviceNow,
  syncing,
}) => {
  const warnings: Array<{ title: string; detail: string; actionLabel?: string; onAction?: () => void }> = [];

  if (!telemetry.internetOnline) {
    warnings.push({
      title: 'Internet Connection Offline',
      detail: 'Cloud alerts, Firestore sync, and hospital search require an active internet connection.',
    });
  }
  if (telemetry.locationPermission === 'denied') {
    warnings.push({
      title: 'Location Permission Blocked',
      detail: 'Allow GPS location access in your browser site settings so live coordinates can be shared during SOS.',
    });
  } else if (!telemetry.gpsEnabled) {
    warnings.push({
      title: 'GPS Tracking Not Active',
      detail: 'Grant GPS permission and start tracking to continuously update your rider coordinates.',
      actionLabel: 'Enable GPS Now',
      onAction: onRequestGps,
    });
  }
  if (!telemetry.accidentDetectionActive) {
    warnings.push({
      title: 'Accident Detection on Standby',
      detail: 'Arm accelerometer and gyroscope sensors before riding to enable automatic crash detection.',
      actionLabel: 'Arm Crash Sensors',
      onAction: onEnableSensors,
    });
  }
  if (telemetry.batterySupported && telemetry.batteryLevel !== null && telemetry.batteryLevel <= 20 && !telemetry.batteryCharging) {
    warnings.push({
      title: `Low Battery Warning (${telemetry.batteryLevel}%)`,
      detail: 'Connect your device to a bike USB charger to ensure uninterrupted GPS tracking.',
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Device Connection Status</h1>
          <p className="text-sm text-slate-600 mt-1">
            Live hardware telemetry read directly from your browser and device sensors—zero simulated statuses.
          </p>
        </div>
        <button
          type="button"
          disabled={syncing}
          onClick={() => void onSyncDeviceNow()}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing Telemetry...' : 'Sync Device to Cloud'}
        </button>
      </div>

      {/* Actionable Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-2.5">
          {warnings.map((w) => (
            <div
              key={w.title}
              className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 text-xs text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">{w.title}</div>
                  <div className="text-amber-800 mt-0.5">{w.detail}</div>
                </div>
              </div>
              {w.actionLabel && w.onAction && (
                <button
                  type="button"
                  onClick={w.onAction}
                  className="px-3.5 py-1.5 text-xs font-semibold text-amber-950 bg-white border border-amber-300 hover:bg-amber-100 rounded-md cursor-pointer whitespace-nowrap"
                >
                  {w.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 8-Card Hardware & Connectivity Diagnostics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Device Cloud Connection</span>
            <Cpu className="w-4 h-4 text-slate-400" />
          </div>
          <StatusText
            status={telemetry.internetOnline && telemetry.firestoreConnected ? 'CONNECTED' : 'DISCONNECTED'}
          />
          <p className="text-xs text-slate-500">
            Firestore real-time channel {telemetry.firestoreConnected ? 'reachable' : 'offline'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Internet Connection</span>
            {telemetry.internetOnline ? (
              <Wifi className="w-4 h-4 text-emerald-600" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-600" />
            )}
          </div>
          <StatusText status={telemetry.internetOnline ? 'ONLINE' : 'OFFLINE'} />
          <p className="text-xs text-slate-500">Reported by navigator.onLine</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>GPS Receiver</span>
            <MapPin className="w-4 h-4 text-slate-400" />
          </div>
          <StatusText status={telemetry.gpsEnabled ? 'CONNECTED' : 'DISCONNECTED'} />
          <p className="text-xs font-mono-tabular text-slate-600">
            {formatCoords(telemetry.latitude, telemetry.longitude)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Location Permission</span>
            <ShieldCheck className="w-4 h-4 text-slate-400" />
          </div>
          <StatusText status={telemetry.locationPermission} />
          <p className="text-xs text-slate-500">Browser Geolocation Permissions API</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Motion Sensors</span>
            <Activity className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-xs font-medium text-slate-900 space-y-0.5">
            <div>Accelerometer: {telemetry.accelerometerAvailable ? 'Available' : 'Unavailable'}</div>
            <div>Gyroscope: {telemetry.gyroscopeAvailable ? 'Available' : 'Unavailable'}</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Accident Detection Service</span>
            <ShieldCheck className="w-4 h-4 text-slate-400" />
          </div>
          <StatusText status={telemetry.accidentDetectionActive ? 'ARMED' : 'STANDBY'} />
          <p className="text-xs font-mono-tabular text-slate-600">
            Live {telemetry.currentGForce.toFixed(2)}G · Tilt {telemetry.tiltDegrees}°
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Battery Level</span>
            <BatteryCharging className="w-4 h-4 text-slate-400" />
          </div>
          {telemetry.batterySupported && telemetry.batteryLevel !== null ? (
            <>
              <div className="font-mono-tabular text-lg font-bold text-slate-900">
                {telemetry.batteryLevel}%
              </div>
              <p className="text-xs text-slate-500">
                {telemetry.batteryCharging ? 'Charging connected' : 'Running on battery'}
              </p>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-slate-700">Not Exposed</div>
              <p className="text-xs text-slate-500">
                Battery Status API is restricted on this browser (e.g. Safari/Firefox)
              </p>
            </>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Last Device Sync Time</span>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>
          <div className="font-mono-tabular text-xs font-semibold text-slate-900">
            {formatTimestamp(telemetry.lastDeviceSyncIso)}
          </div>
          <p className="text-xs text-slate-500">
            Last GPS fix: {formatTimestamp(telemetry.lastGpsUpdateIso)}
          </p>
        </div>
      </div>
    </div>
  );
};
