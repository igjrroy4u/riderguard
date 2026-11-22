import React from 'react';
import {
  AlertTriangle,
  Bike as BikeIcon,
  ChevronRight,
  HeartPulse,
  Hospital,
  MapPin,
  Navigation,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Users,
} from 'lucide-react';
import {
  DEFAULT_AVATAR_URL,
  DEFAULT_BIKE_URL,
  type AccidentRecord,
  type Bike,
  type EmergencyContact,
  type EmergencyNotification,
  type HospitalItem,
  type LiveLocationSession,
  type LiveTelemetryState,
  type MedicalRecord,
  type NavSection,
  type RiderProfile,
} from '../../types';
import {
  buildHospitalNavigationUrl,
  buildTelHref,
  formatCoords,
  formatTimestamp,
} from '../../lib/geo';
import { StatusText } from '../StatusText';

interface DashboardViewProps {
  profile: RiderProfile | null;
  medical: MedicalRecord | null;
  bikes: Bike[];
  contacts: EmergencyContact[];
  accidents: AccidentRecord[];
  notifications: EmergencyNotification[];
  activeAccident: AccidentRecord | null;
  activeSession: LiveLocationSession | null;
  telemetry: LiveTelemetryState;
  nearestHospital: HospitalItem | null;
  onNavigate: (section: NavSection) => void;
  onTriggerSos: () => void;
  onRequestGps: () => void;
  onToggleAccidentDetection: () => void;
  onResolveActiveEmergency: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  profile,
  medical,
  bikes,
  contacts,
  accidents,
  notifications,
  activeAccident,
  activeSession,
  telemetry,
  nearestHospital,
  onNavigate,
  onTriggerSos,
  onRequestGps,
  onToggleAccidentDetection,
  onResolveActiveEmergency,
}) => {
  const primaryBike = bikes.find((b) => b.isPrimary) || bikes[0] || null;
  const sortedContacts = [...contacts].sort((a, b) => a.priority - b.priority);
  const recentAccidents = accidents.slice(0, 4);
  const sentCount = notifications.filter(
    (n) => n.alertStatus === 'SENT' || n.alertStatus === 'DELIVERED'
  ).length;
  const failedCount = notifications.filter(
    (n) => n.alertStatus === 'FAILED' || n.smsDeliveryStatus === 'FAILED'
  ).length;

  return (
    <div className="space-y-6">
      {/* Focal Anchor: High-Visibility SOS Emergency Command Bar */}
      <section
        className={`rounded-xl border p-6 lg:p-8 ${
          activeAccident
            ? 'bg-red-50 border-red-300'
            : 'bg-white border-slate-200'
        }`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-8 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <StatusText status={activeAccident ? 'ACTIVE' : telemetry.accidentDetectionActive ? 'ARMED' : 'STANDBY'} />
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">
                {telemetry.gpsEnabled
                  ? formatCoords(telemetry.latitude, telemetry.longitude)
                  : 'GPS not active'}
              </span>
              {activeSession?.isActive && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-red-700 font-medium">Live location link active</span>
                </>
              )}
            </div>

            <h1 className="font-display text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
              {activeAccident
                ? 'Active Emergency Alert in Progress'
                : `Welcome back, ${profile?.fullName || 'Rider'}`}
            </h1>

            <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
              {activeAccident
                ? `Incident ${activeAccident.id.slice(0, 10)} is active. Live GPS location, your medical summary, and nearest hospital details are synchronized with emergency notifications.`
                : 'Trigger an immediate SOS alert in any crash or roadside emergency to notify your priority contacts, broadcast your live GPS position, and display critical medical instructions.'}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {!telemetry.gpsEnabled && (
                <button
                  type="button"
                  onClick={onRequestGps}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Enable Live GPS
                </button>
              )}
              <button
                type="button"
                onClick={onToggleAccidentDetection}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {telemetry.accidentDetectionActive
                  ? 'Pause Crash Detection'
                  : 'Arm Crash Detection'}
              </button>
              {activeAccident && (
                <button
                  type="button"
                  onClick={onResolveActiveEmergency}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  Mark Safe & Close Emergency
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col items-stretch sm:items-end justify-center">
            {activeAccident ? (
              <button
                type="button"
                onClick={() => onNavigate('sos')}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-7 py-5 text-base font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-colors cursor-pointer whitespace-nowrap"
              >
                <ShieldAlert className="w-6 h-6 shrink-0" />
                Open Emergency Console
              </button>
            ) : (
              <button
                type="button"
                onClick={onTriggerSos}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-5 text-base font-bold text-white bg-red-600 hover:bg-red-700 active:scale-[0.99] rounded-xl shadow-sm transition-all cursor-pointer whitespace-nowrap"
              >
                <ShieldAlert className="w-6 h-6 shrink-0" />
                Trigger SOS Emergency
              </button>
            )}
            <span className="text-xs text-slate-500 mt-2 sm:text-right">
              Notifies {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'} · Shares GPS & Medical ID
            </span>
          </div>
        </div>
      </section>

      {/* 4-Column Operational Status Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>GPS Location Status</span>
            <MapPin className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <StatusText status={telemetry.gpsEnabled ? 'GRANTED' : telemetry.locationPermission} />
            <p className="text-xs text-slate-600 mt-1.5 truncate" title={telemetry.locationAddress}>
              {telemetry.gpsEnabled
                ? telemetry.locationAddress
                : 'Click Enable Live GPS to lock coordinates'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('live-location')}
            className="text-xs font-medium text-slate-900 hover:underline inline-flex items-center gap-1 self-start cursor-pointer"
          >
            Open Live Map <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Device Connection</span>
            <Smartphone className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <StatusText
              status={telemetry.internetOnline && telemetry.firestoreConnected ? 'ONLINE' : 'OFFLINE'}
            />
            <p className="text-xs text-slate-600 mt-1.5 font-mono-tabular">
              {telemetry.batterySupported && telemetry.batteryLevel !== null
                ? `Battery ${telemetry.batteryLevel}%${telemetry.batteryCharging ? ' (Charging)' : ''}`
                : 'Battery API unavailable on browser'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('device-status')}
            className="text-xs font-medium text-slate-900 hover:underline inline-flex items-center gap-1 self-start cursor-pointer"
          >
            Device Diagnostics <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Accident Detection</span>
            <AlertTriangle className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <StatusText status={telemetry.accidentDetectionActive ? 'ARMED' : 'STANDBY'} />
            <p className="text-xs text-slate-600 mt-1.5 font-mono-tabular">
              Live {telemetry.currentGForce.toFixed(2)}G · Threshold {(profile?.impactThresholdG ?? 3.2).toFixed(1)}G
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('sos')}
            className="text-xs font-medium text-slate-900 hover:underline inline-flex items-center gap-1 self-start cursor-pointer"
          >
            Sensor Console <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Emergency Notifications</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <div className="font-mono-tabular text-lg font-bold text-slate-900">
              {sentCount} Sent · {failedCount} Failed
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {notifications.length === 0
                ? 'No emergency notifications logged yet'
                : `Last update ${formatTimestamp(notifications[0]?.updatedAt)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            className="text-xs font-medium text-slate-900 hover:underline inline-flex items-center gap-1 self-start cursor-pointer"
          >
            Notification Monitor <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* Main Content Grid: Rider Profile + Primary Bike + Nearest Hospital */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Rider Profile & Medical Summary */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Rider Profile & Medical ID
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Edit
              </button>
            </div>

            <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
              <img
                src={profile?.profilePhotoUrl || DEFAULT_AVATAR_URL}
                alt={profile?.fullName || 'Rider profile photo'}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full object-cover border border-slate-200 bg-slate-100 shrink-0"
              />
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 truncate">
                  {profile?.fullName || 'Unnamed Rider'}
                </div>
                <div className="text-xs text-slate-500 truncate">{profile?.email}</div>
                <div className="text-xs text-slate-600 font-mono-tabular mt-0.5">
                  {profile?.mobileNumber || 'Add mobile number'}
                  {profile?.age ? ` · Age ${profile.age}` : ''}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 text-xs">
              <div>
                <div className="text-slate-500">Blood Group</div>
                <div className="font-mono-tabular text-base font-bold text-red-700 mt-0.5">
                  {medical?.bloodGroup || 'Not set'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Aadhaar Vault</div>
                <div className="font-mono-tabular text-sm font-medium text-slate-900 mt-0.5">
                  {medical?.aadhaarMasked || 'Not stored'}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-slate-500">Allergies</div>
                <div className="text-slate-800 mt-0.5">
                  {medical?.allergies || 'No allergies recorded'}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-slate-500">Emergency Medical Instructions</div>
                <div className="text-slate-800 mt-0.5 line-clamp-2">
                  {medical?.emergencyInstructions || 'Add responder medical instructions'}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('medical')}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <HeartPulse className="w-4 h-4 text-red-600" />
            Manage Medical Record
          </button>
        </div>

        {/* Registered Bike Summary */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Primary Bike ({bikes.length} registered)
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('bikes')}
                className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Manage
              </button>
            </div>

            {primaryBike ? (
              <div className="space-y-4">
                <div className="aspect-[4/3] w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                  <img
                    src={primaryBike.vehiclePhotoUrl || DEFAULT_BIKE_URL}
                    alt={`${primaryBike.brand} ${primaryBike.model}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <div className="font-semibold text-slate-900">
                    {primaryBike.brand} {primaryBike.model}
                  </div>
                  <div className="text-xs text-slate-600 font-mono-tabular mt-0.5">
                    {primaryBike.registrationNumber} · {primaryBike.color || 'Color N/A'} ·{' '}
                    {primaryBike.manufacturingYear}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    Insurance: {primaryBike.insuranceProvider || 'Not added'}
                    {primaryBike.insuranceExpiry ? ` (Exp ${primaryBike.insuranceExpiry})` : ''}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-10 text-center space-y-3">
                <BikeIcon className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs text-slate-500">
                  No motorcycle registered yet. Add your registration number, RC, and insurance details.
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigate('bikes')}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <BikeIcon className="w-4 h-4" />
            {primaryBike ? 'View All Bikes' : 'Register Your First Bike'}
          </button>
        </div>

        {/* Nearest Hospital & Priority Emergency Contacts */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-5">
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Nearest Hospital
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('live-location')}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Finder
                </button>
              </div>

              {nearestHospital ? (
                <div className="space-y-2.5 pb-4 border-b border-slate-100">
                  <div className="flex items-start gap-2.5">
                    <Hospital className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {nearestHospital.name}
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                        {nearestHospital.address}
                      </div>
                      <div className="text-xs font-mono-tabular text-emerald-700 font-medium mt-1">
                        {nearestHospital.distanceKm.toFixed(2)} km away · {nearestHospital.traumaLevel}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={buildHospitalNavigationUrl(
                        nearestHospital.latitude,
                        nearestHospital.longitude,
                        telemetry.latitude,
                        telemetry.longitude
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      Navigate
                    </a>
                    {nearestHospital.phone && (
                      <a
                        href={buildTelHref(nearestHospital.phone)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        Call
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pb-4 border-b border-slate-100 text-xs text-slate-500">
                  Enable GPS to automatically locate and calculate distance to nearby emergency hospitals.
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Priority Emergency Contacts ({contacts.length})
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('contacts')}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Manage
                </button>
              </div>

              {sortedContacts.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {sortedContacts.slice(0, 3).map((contact) => (
                    <li
                      key={contact.id}
                      className="py-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          P{contact.priority} · {contact.name}
                        </div>
                        <div className="text-xs text-slate-500 font-mono-tabular truncate">
                          {contact.relationship} · {contact.mobileNumber}
                        </div>
                      </div>
                      <a
                        href={buildTelHref(contact.mobileNumber)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md shrink-0 whitespace-nowrap"
                      >
                        <Phone className="w-3 h-3" />
                        Call
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  Add at least one emergency contact so SOS alerts can reach family or responders.
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('contacts')}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <Users className="w-4 h-4" />
            Manage Emergency Contacts
          </button>
        </div>
      </section>

      {/* Recent Accident & Emergency History */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Recent Accident & SOS History
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('accidents')}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            View Full History <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentAccidents.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No accident or SOS events recorded. Every triggered alert or safety drill is archived here with full GPS, SMS, and hospital details.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-3 px-4">Incident ID</th>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Trigger</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Nearest Hospital</th>
                  <th className="py-3 px-4">SMS Status</th>
                  <th className="py-3 px-4">Resolution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentAccidents.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono-tabular font-medium text-slate-900">
                      {acc.id.slice(0, 12)}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-slate-600 whitespace-nowrap">
                      {formatTimestamp(acc.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={acc.triggerType} />
                    </td>
                    <td className="py-3 px-4 text-slate-700 max-w-[200px] truncate">
                      {acc.locationAddress || formatCoords(acc.latitude, acc.longitude)}
                    </td>
                    <td className="py-3 px-4 text-slate-700 max-w-[180px] truncate">
                      {acc.nearestHospitalName || 'Not located'}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={acc.smsSummaryStatus} />
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={acc.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
