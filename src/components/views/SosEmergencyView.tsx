import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  HeartPulse,
  Hospital,
  MessageSquare,
  Navigation,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import {
  buildHospitalNavigationUrl,
  buildLiveShareUrl,
  buildSmsHref,
  buildTelHref,
  formatCoords,
  formatTimestamp,
} from '../../lib/geo';
import type {
  AccidentRecord,
  EmergencyContact,
  EmergencyNotification,
  HospitalItem,
  LiveLocationSession,
  LiveTelemetryState,
  MedicalRecord,
  RiderProfile,
} from '../../types';
import { StatusText } from '../StatusText';

interface SosEmergencyViewProps {
  profile: RiderProfile | null;
  medical: MedicalRecord | null;
  contacts: EmergencyContact[];
  activeAccident: AccidentRecord | null;
  activeSession: LiveLocationSession | null;
  notifications: EmergencyNotification[];
  telemetry: LiveTelemetryState;
  nearestHospital: HospitalItem | null;
  smsGatewayConfigured: boolean;
  sosBusy: boolean;
  onTriggerSos: () => Promise<void>;
  onResolveEmergency: () => Promise<void>;
  onToggleAccidentDetection: () => Promise<void>;
  onRunImpactDrill: () => void;
  onLogCallAttempt: (contact: EmergencyContact) => Promise<void>;
  onLogDeviceSmsHandoff: (notificationId: string) => Promise<void>;
  onResetPeakG: () => void;
}

export const SosEmergencyView: React.FC<SosEmergencyViewProps> = ({
  profile,
  medical,
  contacts,
  activeAccident,
  activeSession,
  notifications,
  telemetry,
  nearestHospital,
  smsGatewayConfigured,
  sosBusy,
  onTriggerSos,
  onResolveEmergency,
  onToggleAccidentDetection,
  onRunImpactDrill,
  onLogCallAttempt,
  onLogDeviceSmsHandoff,
  onResetPeakG,
}) => {
  const [confirmArmSos, setConfirmArmSos] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const sortedContacts = [...contacts].sort((a, b) => a.priority - b.priority);
  const activeNotifications = activeAccident
    ? notifications.filter((n) => n.accidentId === activeAccident.id)
    : [];
  const liveUrl = activeSession?.isActive ? buildLiveShareUrl(activeSession.id) : '';

  const buildEmergencyText = () => {
    const coords =
      telemetry.latitude !== null && telemetry.longitude !== null
        ? `${telemetry.latitude.toFixed(5)}, ${telemetry.longitude.toFixed(5)}`
        : 'GPS unavailable';
    const hospitalPart = nearestHospital
      ? ` Nearest hospital: ${nearestHospital.name} (${nearestHospital.distanceKm.toFixed(1)} km).`
      : '';
    const linkPart = liveUrl ? ` Live location: ${liveUrl}` : '';
    const bloodPart = medical?.bloodGroup ? ` Blood: ${medical.bloodGroup}.` : '';
    return `EMERGENCY SOS from ${profile?.fullName || 'Rider'}! Location: ${coords} (${telemetry.locationAddress}).${bloodPart}${hospitalPart}${linkPart}`;
  };

  const handleCopyLiveUrl = async () => {
    if (!liveUrl) return;
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          SOS Emergency & Accident Detection
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Manual SOS dispatch, real-time accelerometer & gyroscope crash monitoring, and responder medical summary.
        </p>
      </div>

      {/* Active Emergency Command Panel OR SOS Trigger */}
      {activeAccident ? (
        <section className="bg-red-50 border border-red-300 rounded-xl p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-red-200 pb-5">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-red-700">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                <span>ACTIVE EMERGENCY SESSION · ID {activeAccident.id.slice(0, 12)}</span>
              </div>
              <h2 className="font-display text-2xl font-bold text-slate-900">
                Emergency Alert Dispatched
              </h2>
              <p className="text-xs text-slate-700">
                Triggered {formatTimestamp(activeAccident.createdAt)} ·{' '}
                <StatusText status={activeAccident.triggerType} /> · Response:{' '}
                <StatusText status={activeAccident.responseStatus} />
              </p>
            </div>

            <button
              type="button"
              disabled={sosBusy}
              onClick={onResolveEmergency}
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl cursor-pointer whitespace-nowrap"
            >
              <CheckCircle2 className="w-4 h-4" />
              Mark Rider Safe & Close Emergency
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Contacts Dispatch & Direct SMS / Calling */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Emergency Contact Notifications & Direct Calling
                </h3>
                <span className="text-xs text-slate-500">
                  {smsGatewayConfigured
                    ? 'Server SMS Carrier Active'
                    : 'Carrier SMS not configured — use Device SMS buttons below'}
                </span>
              </div>

              {sortedContacts.length === 0 ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  No emergency contacts registered. Call local emergency services directly (112 / 911 / 108).
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {sortedContacts.map((contact) => {
                    const log = activeNotifications.find((n) => n.contactId === contact.id);
                    const smsBody = buildEmergencyText();
                    return (
                      <li key={contact.id} className="py-3.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              P{contact.priority} · {contact.name}{' '}
                              <span className="text-xs font-normal text-slate-500">
                                ({contact.relationship})
                              </span>
                            </div>
                            <div className="text-xs font-mono-tabular text-slate-600">
                              {contact.mobileNumber}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={buildTelHref(contact.mobileNumber)}
                              onClick={() => void onLogCallAttempt(contact)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md whitespace-nowrap"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              Emergency Call
                            </a>
                            <a
                              href={buildSmsHref(contact.mobileNumber, smsBody)}
                              onClick={() => {
                                if (log) void onLogDeviceSmsHandoff(log.id);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              Send Device SMS
                            </a>
                          </div>
                        </div>

                        {log && (
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                            <span>
                              Alert: <StatusText status={log.alertStatus} />
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              SMS: <StatusText status={log.smsDeliveryStatus} />
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              Call: <StatusText status={log.callStatus} />
                            </span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Live Tracking URL */}
              {liveUrl && (
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs min-w-0">
                    <div className="text-slate-500">Live Tracking Link (Auto-expires when closed)</div>
                    <div className="font-mono-tabular text-slate-900 truncate max-w-md">{liveUrl}</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyLiveUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedLink ? 'Copied' : 'Copy Live Link'}
                  </button>
                </div>
              )}

              {/* Universal Emergency Numbers */}
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium">Direct Emergency Helplines:</span>
                <a
                  href="tel:112"
                  className="inline-flex items-center gap-1 px-2.5 py-1 font-mono-tabular font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md"
                >
                  <Phone className="w-3 h-3" /> 112 (Emergency)
                </a>
                <a
                  href="tel:108"
                  className="inline-flex items-center gap-1 px-2.5 py-1 font-mono-tabular font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md"
                >
                  <Phone className="w-3 h-3" /> 108 (Ambulance)
                </a>
                <a
                  href="tel:911"
                  className="inline-flex items-center gap-1 px-2.5 py-1 font-mono-tabular font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md"
                >
                  <Phone className="w-3 h-3" /> 911
                </a>
              </div>
            </div>

            {/* Right: Responder Medical Info & Nearest Hospital */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-display text-sm font-semibold text-red-700">
                    <HeartPulse className="w-4 h-4" />
                    <span>Rider Medical Information</span>
                  </div>
                  <span className="font-mono-tabular text-base font-bold text-red-700">
                    {medical?.bloodGroup || 'Unknown'}
                  </span>
                </div>
                <div className="text-slate-700 whitespace-pre-line leading-relaxed border-t border-slate-100 pt-2.5">
                  {activeAccident.medicalSnapshot || 'No medical history recorded.'}
                </div>
                <div className="text-slate-500 pt-1">
                  Vehicle: <strong className="text-slate-900">{activeAccident.bikeSummary || 'Not specified'}</strong>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900">
                  <Hospital className="w-4 h-4 text-emerald-600" />
                  <span>Nearest Hospital Details</span>
                </div>
                {nearestHospital || activeAccident.nearestHospitalName ? (
                  <>
                    <div className="font-semibold text-slate-900 text-sm">
                      {nearestHospital?.name || activeAccident.nearestHospitalName}
                    </div>
                    <p className="text-slate-600">
                      {nearestHospital?.address || activeAccident.nearestHospitalAddress}
                    </p>
                    <div className="font-mono-tabular text-emerald-700 font-semibold">
                      {(nearestHospital?.distanceKm ?? activeAccident.nearestHospitalDistanceKm).toFixed(2)} km away
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {nearestHospital && (
                        <a
                          href={buildHospitalNavigationUrl(
                            nearestHospital.latitude,
                            nearestHospital.longitude,
                            telemetry.latitude,
                            telemetry.longitude
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          Navigate to Hospital
                        </a>
                      )}
                      {(nearestHospital?.phone || activeAccident.nearestHospitalPhone) && (
                        <a
                          href={buildTelHref(
                            nearestHospital?.phone || activeAccident.nearestHospitalPhone
                          )}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          Call Hospital
                        </a>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-slate-500">
                    GPS fix required to calculate nearest hospital route.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-3">
              <h2 className="font-display text-xl font-bold text-slate-900">
                Manual SOS Emergency Dispatch
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Pressing SOS immediately creates a cloud emergency record, starts a live GPS tracking session,
                notifies all {contacts.length} registered emergency contacts, prepares your medical card,
                and surfaces one-tap emergency calling and nearest hospital navigation.
              </p>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1">
                <span>
                  GPS: <strong className="font-mono-tabular text-slate-900">{formatCoords(telemetry.latitude, telemetry.longitude)}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  SMS Gateway:{' '}
                  <strong className="text-slate-900">
                    {smsGatewayConfigured ? 'Carrier API Active' : 'Cloud Alert + Device SMS Handoff'}
                  </strong>
                </span>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col items-stretch sm:items-end gap-3">
              {!confirmArmSos ? (
                <button
                  type="button"
                  onClick={() => setConfirmArmSos(true)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-5 text-base font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-colors cursor-pointer"
                >
                  <ShieldAlert className="w-6 h-6" />
                  Activate SOS Emergency
                </button>
              ) : (
                <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <div className="text-xs font-semibold text-red-900">
                    Confirm Emergency SOS Dispatch?
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={sosBusy}
                      onClick={async () => {
                        await onTriggerSos();
                        setConfirmArmSos(false);
                      }}
                      className="flex-1 px-4 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      {sosBusy ? 'Dispatching SOS...' : 'Confirm & Dispatch SOS'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmArmSos(false)}
                      className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Real-Time Sensor-Based Accident Detection Engine */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2.5">
              <Activity className="w-5 h-5 text-slate-900" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                Accelerometer & Gyroscope Accident Detection
              </h2>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Monitors device motion sensors for high-G impact spikes. When triggered, a{' '}
              <span className="font-mono-tabular font-semibold">{profile?.accidentCountdownSec ?? 15}s</span>{' '}
              countdown opens with a false-alarm cancellation button before automatically firing SOS.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleAccidentDetection}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${
                telemetry.accidentDetectionActive
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              {telemetry.accidentDetectionActive
                ? 'Crash Detection Armed (Click to Pause)'
                : 'Request Sensor Permission & Arm'}
            </button>

            <button
              type="button"
              onClick={onRunImpactDrill}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-300 hover:bg-amber-100 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Zap className="w-3.5 h-3.5" />
              Test Impact Countdown Drill
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-500">Service State</div>
            <div className="mt-1">
              <StatusText status={telemetry.accidentDetectionActive ? 'ARMED' : 'STANDBY'} />
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-500">Live Acceleration</div>
            <div className="font-mono-tabular text-xl font-bold text-slate-900 mt-1">
              {telemetry.currentGForce.toFixed(2)} G
            </div>
            <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
              Trigger ≥ {(profile?.impactThresholdG ?? 3.2).toFixed(1)} G
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Peak Measured</span>
              <button
                type="button"
                onClick={onResetPeakG}
                className="text-[11px] text-slate-500 hover:text-slate-900 underline cursor-pointer"
              >
                Reset
              </button>
            </div>
            <div className="font-mono-tabular text-xl font-bold text-slate-900 mt-1">
              {telemetry.peakGForce.toFixed(2)} G
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-500">Gyroscope Tilt</div>
            <div className="font-mono-tabular text-xl font-bold text-slate-900 mt-1">
              {telemetry.tiltDegrees}°
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {telemetry.accelerometerAvailable ? 'Motion API Present' : 'Desktop / No Motion Sensor'}
            </div>
          </div>
        </div>

        {!telemetry.accelerometerAvailable && (
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              This browser or desktop computer does not expose physical accelerometer hardware events. Use a smartphone browser over HTTPS for live motion-sensor impact detection, or use the "Test Impact Countdown Drill" button above to verify the full countdown, false-alarm cancellation, and auto-SOS workflow.
            </span>
          </div>
        )}
      </section>
    </div>
  );
};
