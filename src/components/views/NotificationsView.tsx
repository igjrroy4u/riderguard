import React, { useMemo, useState } from 'react';
import { Bell, MessageSquare, Phone, RefreshCw } from 'lucide-react';
import { buildSmsHref, buildTelHref, formatCoords, formatTimestamp } from '../../lib/geo';
import type {
  AccidentRecord,
  EmergencyNotification,
  LiveLocationSession,
  LiveTelemetryState,
} from '../../types';
import { StatusText } from '../StatusText';

interface NotificationsViewProps {
  notifications: EmergencyNotification[];
  activeAccident: AccidentRecord | null;
  activeSession: LiveLocationSession | null;
  telemetry: LiveTelemetryState;
  smsGatewayConfigured: boolean;
  onRetrySmsNotification: (notification: EmergencyNotification) => Promise<void>;
  onMarkDeviceSmsOpened: (notificationId: string) => Promise<void>;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  notifications,
  activeAccident,
  activeSession,
  telemetry,
  smsGatewayConfigured,
  onRetrySmsNotification,
  onMarkDeviceSmsOpened,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'SENT' | 'DELIVERED' | 'FAILED' | 'DEVICE_HANDOFF'>('ALL');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const sent = notifications.filter((n) => n.alertStatus === 'SENT' || n.alertStatus === 'DELIVERED').length;
    const smsDelivered = notifications.filter((n) => n.smsDeliveryStatus === 'DELIVERED').length;
    const smsDeviceHandoff = notifications.filter((n) => n.smsDeliveryStatus === 'DEVICE_HANDOFF').length;
    const failed = notifications.filter(
      (n) => n.alertStatus === 'FAILED' || n.smsDeliveryStatus === 'FAILED' || n.callStatus === 'FAILED'
    ).length;
    return { sent, smsDelivered, smsDeviceHandoff, failed };
  }, [notifications]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return notifications;
    if (filter === 'DEVICE_HANDOFF') {
      return notifications.filter((n) => n.smsDeliveryStatus === 'DEVICE_HANDOFF');
    }
    if (filter === 'FAILED') {
      return notifications.filter(
        (n) => n.alertStatus === 'FAILED' || n.smsDeliveryStatus === 'FAILED'
      );
    }
    if (filter === 'DELIVERED') {
      return notifications.filter(
        (n) => n.alertStatus === 'DELIVERED' || n.smsDeliveryStatus === 'DELIVERED'
      );
    }
    return notifications.filter((n) => n.alertStatus === 'SENT' || n.smsDeliveryStatus === 'SENT');
  }, [notifications, filter]);

  const handleRetry = async (n: EmergencyNotification) => {
    setRetryingId(n.id);
    try {
      await onRetrySmsNotification(n);
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Emergency Notification Dashboard
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Transparent audit of alert dispatch vs. carrier SMS delivery, call attempts, and live emergency session state.
        </p>
      </div>

      {/* Live Emergency Telemetry Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs text-slate-500">Emergency Alert & Session</div>
          <div>
            <StatusText status={activeAccident ? 'ACTIVE' : 'STANDBY'} />
          </div>
          <div className="text-xs text-slate-600">
            Live Sharing: {activeSession?.isActive ? 'Broadcasting' : 'Inactive'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs text-slate-500">Alert Dispatch vs. Carrier SMS</div>
          <div className="font-mono-tabular text-base font-bold text-slate-900">
            {stats.sent} Alerts · {stats.smsDelivered} SMS Delivered
          </div>
          <div className="text-xs text-slate-600">
            {stats.smsDeviceHandoff} Device Handoff · {stats.failed} Failed
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs text-slate-500">Current Location & Last GPS Update</div>
          <div className="font-mono-tabular text-xs font-semibold text-slate-900">
            {formatCoords(telemetry.latitude, telemetry.longitude)}
          </div>
          <div className="font-mono-tabular text-xs text-slate-500">
            {formatTimestamp(telemetry.lastGpsUpdateIso)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs text-slate-500">Accident Detection & SMS Carrier</div>
          <div>
            <StatusText status={telemetry.accidentDetectionActive ? 'ARMED' : 'STANDBY'} />
          </div>
          <div className="text-xs text-slate-600">
            Carrier Gateway: {smsGatewayConfigured ? 'Configured (Twilio)' : 'Device SMS Handoff Mode'}
          </div>
        </div>
      </div>

      {/* Honest Explanation Banner distinguishing Alert Sent vs SMS Delivered */}
      <div className="bg-slate-100 border border-slate-200 rounded-xl px-5 py-3.5 text-xs text-slate-700 leading-relaxed">
        <strong>Delivery Transparency:</strong> RiderGuard strictly separates{' '}
        <span className="font-semibold text-slate-900">Alert Sent</span> (persisted to cloud database and responder dashboard) from{' '}
        <span className="font-semibold text-slate-900">SMS Delivered</span> (confirmed by a mobile SMS carrier). When no server SMS carrier secret is configured, SMS rows accurately display{' '}
        <span className="font-semibold text-amber-800">Device SMS Handoff</span> with a one-tap button to transmit directly from your phone.
      </div>

      {/* Segmented Status Filter */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {(
          [
            ['ALL', `All (${notifications.length})`],
            ['SENT', 'Sent'],
            ['DELIVERED', 'Delivered'],
            ['DEVICE_HANDOFF', 'Device SMS Handoff'],
            ['FAILED', 'Failed'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              filter === key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Audit Log Table */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-2">
          <Bell className="w-9 h-9 text-slate-300 mx-auto" />
          <h3 className="font-display text-base font-semibold text-slate-900">
            No notification logs found
          </h3>
          <p className="text-xs text-slate-500">
            Triggering an SOS or accident alert creates individual delivery audit rows for every priority contact.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Channel</th>
                  <th className="py-3 px-4">Alert Status</th>
                  <th className="py-3 px-4">SMS Delivery Status</th>
                  <th className="py-3 px-4">Call Status</th>
                  <th className="py-3 px-4">Provider / Audit Note</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((n) => (
                  <tr key={n.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-mono-tabular text-slate-600 whitespace-nowrap">
                      {formatTimestamp(n.updatedAt || n.createdAt)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{n.contactName}</div>
                      <div className="font-mono-tabular text-slate-500">{n.contactPhone}</div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 font-medium">{n.channel}</td>
                    <td className="py-3.5 px-4">
                      <StatusText status={n.alertStatus} />
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={n.smsDeliveryStatus} />
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={n.callStatus} />
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 max-w-[240px]">
                      <div className="line-clamp-2" title={n.providerNote}>
                        {n.providerNote || '—'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {n.contactPhone && (
                          <>
                            <a
                              href={buildSmsHref(n.contactPhone, n.messagePreview)}
                              onClick={() => void onMarkDeviceSmsOpened(n.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                            >
                              <MessageSquare className="w-3 h-3" />
                              Device SMS
                            </a>
                            <a
                              href={buildTelHref(n.contactPhone)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md whitespace-nowrap"
                            >
                              <Phone className="w-3 h-3" />
                              Call
                            </a>
                          </>
                        )}
                        {(n.smsDeliveryStatus === 'FAILED' || n.smsDeliveryStatus === 'PENDING') && (
                          <button
                            type="button"
                            disabled={retryingId === n.id}
                            onClick={() => handleRetry(n)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            <RefreshCw
                              className={`w-3 h-3 ${retryingId === n.id ? 'animate-spin' : ''}`}
                            />
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
