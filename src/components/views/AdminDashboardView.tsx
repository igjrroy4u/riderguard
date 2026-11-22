import React, { useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Bike as BikeIcon,
  CheckCircle2,
  Hospital,
  Plus,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { formatCoords, formatTimestamp, generateSecureId } from '../../lib/geo';
import type {
  AccidentRecord,
  Bike,
  DeviceStatusRecord,
  EmergencyContact,
  EmergencyNotification,
  EmergencyResponseStatus,
  HospitalItem,
  MedicalRecord,
  RiderProfile,
} from '../../types';
import { StatusText } from '../StatusText';

type AdminTab =
  | 'alerts'
  | 'riders'
  | 'bikes'
  | 'contacts'
  | 'notifications'
  | 'devices'
  | 'hospitals';

export const AdminDashboardView: React.FC = () => {
  const [tab, setTab] = useState<AdminTab>('alerts');
  const [riders, setRiders] = useState<RiderProfile[]>([]);
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [accidents, setAccidents] = useState<AccidentRecord[]>([]);
  const [notifications, setNotifications] = useState<EmergencyNotification[]>([]);
  const [devices, setDevices] = useState<DeviceStatusRecord[]>([]);
  const [hospitals, setHospitals] = useState<HospitalItem[]>([]);

  const [selectedRiderMedical, setSelectedRiderMedical] = useState<{
    rider: RiderProfile;
    medical: MedicalRecord | null;
  } | null>(null);

  const [showHospitalForm, setShowHospitalForm] = useState(false);
  const [hospitalForm, setHospitalForm] = useState({
    name: '',
    address: '',
    phone: '',
    latitude: '',
    longitude: '',
    traumaLevel: 'Level 1 Trauma Center',
    emergency24x7: true,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        collection(db, 'riders'),
        (snap) => {
          setRiders(snap.docs.map((d) => d.data() as RiderProfile));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'riders')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'bikes'),
        (snap) => {
          setBikes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Bike, 'id'>) })));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'bikes')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'emergencyContacts'),
        (snap) => {
          setContacts(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EmergencyContact, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'emergencyContacts')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'accidents'),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<AccidentRecord, 'id'>) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
          setAccidents(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'accidents')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'notifications'),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<EmergencyNotification, 'id'>) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
          setNotifications(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'deviceStatuses'),
        (snap) => {
          setDevices(snap.docs.map((d) => d.data() as DeviceStatusRecord));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'deviceStatuses')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'hospitals'), where('emergency24x7', 'in', [true, false])),
        (snap) => {
          setHospitals(
            snap.docs.map((d) => {
              const data = d.data() as {
                name: string;
                address: string;
                phone: string;
                latitude: number;
                longitude: number;
                traumaLevel: string;
                emergency24x7: boolean;
              };
              return {
                id: d.id,
                ...data,
                distanceKm: 0,
                source: 'verified' as const,
              };
            })
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'hospitals')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, []);

  const activeAlertsCount = accidents.filter(
    (a) => a.status === 'ACTIVE' || a.status === 'RESPONDING'
  ).length;

  const handleUpdateResponseStatus = async (
    accident: AccidentRecord,
    nextResponse: EmergencyResponseStatus
  ) => {
    setBusy(true);
    const path = `accidents/${accident.id}`;
    try {
      const nextStatus =
        nextResponse === 'CLOSED'
          ? 'RESOLVED'
          : nextResponse === 'DISPATCHED' ||
              nextResponse === 'ACKNOWLEDGED' ||
              nextResponse === 'HOSPITAL_EN_ROUTE'
            ? 'RESPONDING'
            : accident.status;

      await updateDoc(doc(db, 'accidents', accident.id), {
        responseStatus: nextResponse,
        status: nextStatus,
        resolvedAtIso: nextStatus === 'RESOLVED' ? new Date().toISOString() : accident.resolvedAtIso,
        updatedAt: serverTimestamp(),
      });

      if (nextStatus === 'RESOLVED' && accident.liveShareSessionId) {
        await updateDoc(doc(db, 'liveSessions', accident.liveShareSessionId), {
          isActive: false,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
      }

      setNotice(`Incident ${accident.id.slice(0, 10)} updated to ${nextResponse}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    } finally {
      setBusy(false);
    }
  };

  const handleInspectRiderMedical = async (rider: RiderProfile) => {
    const path = `riders/${rider.uid}/medical/record`;
    try {
      const snap = await getDoc(doc(db, 'riders', rider.uid, 'medical', 'record'));
      setSelectedRiderMedical({
        rider,
        medical: snap.exists() ? (snap.data() as MedicalRecord) : null,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  };

  const handleCreateHospital = async (e: React.FormEvent) => {
    e.preventDefault();
    const lat = Number(hospitalForm.latitude);
    const lng = Number(hospitalForm.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setNotice('Please provide valid numeric latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }

    setBusy(true);
    const hospitalId = generateSecureId('hosp', 20);
    const path = `hospitals/${hospitalId}`;
    try {
      await setDoc(doc(db, 'hospitals', hospitalId), {
        name: hospitalForm.name.trim().slice(0, 160),
        address: hospitalForm.address.trim().slice(0, 300),
        phone: hospitalForm.phone.trim().slice(0, 40),
        latitude: lat,
        longitude: lng,
        traumaLevel: hospitalForm.traumaLevel.trim().slice(0, 40),
        emergency24x7: Boolean(hospitalForm.emergency24x7),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setHospitalForm({
        name: '',
        address: '',
        phone: '',
        latitude: '',
        longitude: '',
        traumaLevel: 'Level 1 Trauma Center',
        emergency24x7: true,
      });
      setShowHospitalForm(false);
      setNotice('Verified emergency hospital added to directory.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteHospital = async (id: string) => {
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'hospitals', id));
      setNotice('Hospital removed from verified directory.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hospitals/${id}`);
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: AdminTab; label: string; count: number }> = [
    { id: 'alerts', label: 'Alerts & Accidents', count: accidents.length },
    { id: 'riders', label: 'Registered Riders', count: riders.length },
    { id: 'bikes', label: 'Bikes', count: bikes.length },
    { id: 'contacts', label: 'Emergency Contacts', count: contacts.length },
    { id: 'notifications', label: 'Notifications', count: notifications.length },
    { id: 'devices', label: 'Device Status', count: devices.length },
    { id: 'hospitals', label: 'Hospitals', count: hospitals.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 mb-1">
            <Shield className="w-4 h-4 text-slate-900" />
            <span>Administrator Dispatch & Governance Console</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Admin Dashboard</h1>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-2">
            <span className="text-slate-500">Active Alerts: </span>
            <strong className={`font-mono-tabular ${activeAlertsCount > 0 ? 'text-red-700' : 'text-slate-900'}`}>
              {activeAlertsCount}
            </strong>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-2">
            <span className="text-slate-500">Riders: </span>
            <strong className="font-mono-tabular text-slate-900">{riders.length}</strong>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-2">
            <span className="text-slate-500">Verified Hospitals: </span>
            <strong className="font-mono-tabular text-slate-900">{hospitals.length}</strong>
          </div>
        </div>
      </div>

      {notice && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Segmented Admin Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label} <span className="font-mono-tabular text-slate-400">({t.count})</span>
          </button>
        ))}
      </div>

      {/* TAB 1: Active Alerts & Accident Records */}
      {tab === 'alerts' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {accidents.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No accident or emergency alerts recorded across riders yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                    <th className="py-3 px-4">Incident / Time</th>
                    <th className="py-3 px-4">Rider & Bike</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">Nearest Hospital</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Dispatch Response Control</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accidents.map((acc) => (
                    <tr
                      key={acc.id}
                      className={acc.status === 'ACTIVE' ? 'bg-red-50/40' : 'hover:bg-slate-50'}
                    >
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-mono-tabular font-semibold text-slate-900">
                          {acc.id.slice(0, 12)}
                        </div>
                        <div className="font-mono-tabular text-slate-500">
                          {formatTimestamp(acc.createdAt)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{acc.riderName}</div>
                        <div className="text-slate-600">{acc.bikeSummary || 'No bike listed'}</div>
                      </td>
                      <td className="py-3.5 px-4 max-w-[200px]">
                        <div className="truncate text-slate-800">{acc.locationAddress || '—'}</div>
                        <div className="font-mono-tabular text-slate-500">
                          {formatCoords(acc.latitude, acc.longitude)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 max-w-[180px]">
                        <div className="truncate text-slate-800">
                          {acc.nearestHospitalName || 'Not located'}
                        </div>
                        {acc.nearestHospitalDistanceKm > 0 && (
                          <div className="font-mono-tabular text-slate-500">
                            {acc.nearestHospitalDistanceKm.toFixed(2)} km
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 space-y-1">
                        <div>
                          <StatusText status={acc.status} />
                        </div>
                        <div>
                          <StatusText status={acc.responseStatus} />
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <select
                          aria-label={`Update response status for ${acc.id}`}
                          disabled={busy}
                          value={acc.responseStatus}
                          onChange={(e) =>
                            void handleUpdateResponseStatus(
                              acc,
                              e.target.value as EmergencyResponseStatus
                            )
                          }
                          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                        >
                          <option value="PENDING">Pending</option>
                          <option value="DISPATCHED">Dispatched</option>
                          <option value="ACKNOWLEDGED">Acknowledged</option>
                          <option value="HOSPITAL_EN_ROUTE">Hospital En Route</option>
                          <option value="CLOSED">Closed / Resolved</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Registered Riders */}
      {tab === 'riders' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-3 px-4">Rider</th>
                  <th className="py-3 px-4">Email & Mobile</th>
                  <th className="py-3 px-4">Age / DOB</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Biometric</th>
                  <th className="py-3 px-4 text-right">Authorized Medical View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {riders.map((r) => (
                  <tr key={r.uid} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{r.fullName}</div>
                      <div className="font-mono-tabular text-slate-500">{r.uid.slice(0, 12)}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-slate-900">{r.email}</div>
                      <div className="font-mono-tabular text-slate-500">{r.mobileNumber || '—'}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-slate-700">
                      {r.age || '—'} · {r.dateOfBirth || '—'}
                    </td>
                    <td className="py-3.5 px-4 capitalize font-medium text-slate-800">{r.role}</td>
                    <td className="py-3.5 px-4 text-slate-600">
                      {r.biometricEnabled ? 'Enrolled' : 'Not set'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => void handleInspectRiderMedical(r)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                      >
                        View Medical Info
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Registered Bikes */}
      {tab === 'bikes' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {bikes.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              <BikeIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              No motorcycles registered yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                    <th className="py-3 px-4">Registration</th>
                    <th className="py-3 px-4">Brand & Model</th>
                    <th className="py-3 px-4">Year / Colour</th>
                    <th className="py-3 px-4">Owner</th>
                    <th className="py-3 px-4">RC Number</th>
                    <th className="py-3 px-4">Insurance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bikes.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 font-mono-tabular font-semibold text-slate-900">
                        {b.registrationNumber}
                      </td>
                      <td className="py-3.5 px-4 text-slate-900">
                        {b.brand} {b.model}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {b.manufacturingYear} · {b.color || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-800">{b.ownerName || '—'}</td>
                      <td className="py-3.5 px-4 font-mono-tabular text-slate-700">
                        {b.rcNumber || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {b.insuranceProvider || '—'}
                        {b.insuranceExpiry ? ` (Exp ${b.insuranceExpiry})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Emergency Contacts */}
      {tab === 'contacts' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {contacts.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              No emergency contacts registered yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4">Contact Name</th>
                    <th className="py-3 px-4">Relationship</th>
                    <th className="py-3 px-4">Mobile Number</th>
                    <th className="py-3 px-4">Rider UID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contacts.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 font-mono-tabular font-bold text-slate-900">
                        P{c.priority}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-900">{c.name}</td>
                      <td className="py-3.5 px-4 text-slate-700">{c.relationship}</td>
                      <td className="py-3.5 px-4 font-mono-tabular text-slate-900">
                        {c.mobileNumber}
                      </td>
                      <td className="py-3.5 px-4 font-mono-tabular text-slate-500">
                        {c.riderId.slice(0, 12)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: Notification History */}
      {tab === 'notifications' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Alert</th>
                  <th className="py-3 px-4">SMS Status</th>
                  <th className="py-3 px-4">Call Status</th>
                  <th className="py-3 px-4">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notifications.map((n) => (
                  <tr key={n.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-mono-tabular text-slate-600 whitespace-nowrap">
                      {formatTimestamp(n.createdAt)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{n.contactName}</div>
                      <div className="font-mono-tabular text-slate-500">{n.contactPhone}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={n.alertStatus} />
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={n.smsDeliveryStatus} />
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={n.callStatus} />
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 max-w-[260px] truncate">
                      {n.providerNote}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 6: Device Connection Status */}
      {tab === 'devices' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-3 px-4">Rider</th>
                  <th className="py-3 px-4">Connection</th>
                  <th className="py-3 px-4">GPS / Permission</th>
                  <th className="py-3 px-4">Crash Detection</th>
                  <th className="py-3 px-4">Battery</th>
                  <th className="py-3 px-4">Last Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devices.map((d) => (
                  <tr key={d.riderId} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      {d.riderName || d.riderId.slice(0, 12)}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={d.internetOnline && d.isConnected ? 'ONLINE' : 'OFFLINE'} />
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={d.locationPermission} />
                      <div className="font-mono-tabular text-slate-500 mt-0.5">
                        {d.gpsEnabled ? formatCoords(d.lastLatitude, d.lastLongitude) : 'GPS Off'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={d.accidentDetectionActive ? 'ARMED' : 'STANDBY'} />
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-slate-700">
                      {d.batteryLevel >= 0 ? `${d.batteryLevel}%` : 'Unavailable'}
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-slate-600 whitespace-nowrap">
                      {formatTimestamp(d.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: Hospital Directory Management */}
      {tab === 'hospitals' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-600">
              Admin-verified hospitals are merged into every rider's Nearest Hospital Finder alongside live Google Maps Places hospital lookups.
            </p>
            <button
              type="button"
              onClick={() => setShowHospitalForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Verified Hospital
            </button>
          </div>

          {showHospitalForm && (
            <form
              onSubmit={handleCreateHospital}
              className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Hospital Name *</label>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={hospitalForm.name}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Emergency Phone</label>
                <input
                  type="tel"
                  maxLength={40}
                  value={hospitalForm.phone}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, phone: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Trauma Level</label>
                <input
                  type="text"
                  maxLength={40}
                  value={hospitalForm.traumaLevel}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, traumaLevel: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Address *</label>
                <input
                  type="text"
                  required
                  maxLength={300}
                  value={hospitalForm.address}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, address: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Latitude *</label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="e.g. 12.9716"
                  value={hospitalForm.latitude}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, latitude: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Longitude *</label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="e.g. 77.5946"
                  value={hospitalForm.longitude}
                  onChange={(e) => setHospitalForm({ ...hospitalForm, longitude: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono-tabular"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Save Hospital
                </button>
                <button
                  type="button"
                  onClick={() => setShowHospitalForm(false)}
                  className="px-3 py-2 text-xs text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {hospitals.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                <Hospital className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                No custom verified hospitals added yet. Live Google Maps Places hospital lookup remains active automatically.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                      <th className="py-3 px-4">Hospital Name</th>
                      <th className="py-3 px-4">Address</th>
                      <th className="py-3 px-4">Phone</th>
                      <th className="py-3 px-4">Coordinates</th>
                      <th className="py-3 px-4 text-right">Remove</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {hospitals.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-50">
                        <td className="py-3.5 px-4 font-semibold text-slate-900">
                          {h.name}
                          <div className="font-normal text-slate-500">{h.traumaLevel}</div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-700">{h.address}</td>
                        <td className="py-3.5 px-4 font-mono-tabular text-slate-700">
                          {h.phone || '—'}
                        </td>
                        <td className="py-3.5 px-4 font-mono-tabular text-slate-600">
                          {formatCoords(h.latitude, h.longitude)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDeleteHospital(h.id)}
                            className="p-1.5 text-slate-500 hover:text-red-700 cursor-pointer"
                            aria-label={`Delete ${h.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Authorized Rider Medical Info Inspector Modal */}
      {selectedRiderMedical && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  {selectedRiderMedical.rider.fullName} — Medical Record
                </h3>
                <p className="text-xs text-slate-500">{selectedRiderMedical.rider.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRiderMedical(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close medical view"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedRiderMedical.medical ? (
              <dl className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-slate-500">Blood Group</dt>
                    <dd className="font-mono-tabular text-base font-bold text-red-700">
                      {selectedRiderMedical.medical.bloodGroup || 'Not set'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Aadhaar (Masked & Encrypted)</dt>
                    <dd className="font-mono-tabular font-semibold text-slate-900">
                      {selectedRiderMedical.medical.aadhaarMasked || 'Not stored'}
                    </dd>
                  </div>
                </div>
                <div>
                  <dt className="text-slate-500">Allergies</dt>
                  <dd className="text-slate-900 mt-0.5">
                    {selectedRiderMedical.medical.allergies || 'None listed'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Medical Conditions</dt>
                  <dd className="text-slate-900 mt-0.5">
                    {selectedRiderMedical.medical.medicalConditions || 'None listed'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Medical History</dt>
                  <dd className="text-slate-900 mt-0.5 whitespace-pre-line">
                    {selectedRiderMedical.medical.medicalHistory || 'None listed'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Emergency Responder Instructions</dt>
                  <dd className="text-slate-900 mt-0.5 whitespace-pre-line">
                    {selectedRiderMedical.medical.emergencyInstructions || 'None listed'}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="p-4 rounded-lg bg-slate-50 text-xs text-slate-600 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                This rider has not completed their medical profile yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
