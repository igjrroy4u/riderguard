import React from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Send,
  Smartphone,
  Activity,
} from 'lucide-react';

interface StatusTextProps {
  status: string;
}

export const StatusText: React.FC<StatusTextProps> = ({ status }) => {
  const normalized = status.toUpperCase();

  if (
    normalized === 'DELIVERED' ||
    normalized === 'RESOLVED' ||
    normalized === 'CLOSED' ||
    normalized === 'CONNECTED' ||
    normalized === 'COMPLETED' ||
    normalized === 'GRANTED' ||
    normalized === 'ONLINE' ||
    normalized === 'ARMED'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>{formatStatusLabel(normalized)}</span>
      </span>
    );
  }

  if (
    normalized === 'SENT' ||
    normalized === 'QUEUED' ||
    normalized === 'DISPATCHED' ||
    normalized === 'ACKNOWLEDGED' ||
    normalized === 'INITIATED' ||
    normalized === 'HOSPITAL_EN_ROUTE' ||
    normalized === 'RESPONDING'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 whitespace-nowrap">
        <Send className="w-3.5 h-3.5 shrink-0" />
        <span>{formatStatusLabel(normalized)}</span>
      </span>
    );
  }

  if (normalized === 'DEVICE_HANDOFF') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Smartphone className="w-3.5 h-3.5 shrink-0" />
        <span>Device SMS Handoff</span>
      </span>
    );
  }

  if (
    normalized === 'PENDING' ||
    normalized === 'PARTIAL' ||
    normalized === 'PROMPT' ||
    normalized === 'STANDBY' ||
    normalized === 'CANCELLED_FALSE_ALARM'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>{formatStatusLabel(normalized)}</span>
      </span>
    );
  }

  if (normalized === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap">
        <Activity className="w-3.5 h-3.5 shrink-0" />
        <span>Active Emergency</span>
      </span>
    );
  }

  if (
    normalized === 'FAILED' ||
    normalized === 'DENIED' ||
    normalized === 'OFFLINE' ||
    normalized === 'DISCONNECTED'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{formatStatusLabel(normalized)}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-slate-400" />
      <span>{formatStatusLabel(normalized)}</span>
    </span>
  );
};

function formatStatusLabel(code: string): string {
  const map: Record<string, string> = {
    CANCELLED_FALSE_ALARM: 'False Alarm Cancelled',
    HOSPITAL_EN_ROUTE: 'Hospital En Route',
    NOT_INITIATED: 'Not Initiated',
    NOT_APPLICABLE: 'Not Applicable',
    SOS_MANUAL: 'Manual SOS',
    ACCIDENT_AUTO: 'Auto Crash Sensor',
    TEST_DRILL: 'Safety Drill',
  };
  if (map[code]) return map[code];
  return code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
