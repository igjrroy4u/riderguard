import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, sendEmailVerification, signOut, type User } from 'firebase/auth';
import {
  collection,
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
  Activity,
  AlertTriangle,
  Bell,
  Bike as BikeIcon,
  Cpu,
  HeartPulse,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Radio,
  Settings,
  Shield,
  ShieldAlert,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from './lib/firebase';
import { buildLiveShareUrl, generateSecureId, haversineKm } from './lib/geo';
import { useDeviceTelemetry } from './hooks/useDeviceTelemetry';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  DEFAULT_AVATAR_URL,
  type AccidentRecord,
  type AccidentTriggerType,
  type Bike,
  type EmergencyContact,
  type EmergencyNotification,
  type Esp32Device,
  type HospitalItem,
  type LiveLocationSession,
  type MedicalRecord,
  type NavSection,
  type RiderProfile,
} from './types';
import { AuthScreen } from './components/AuthScreen';
import { EmergencyCountdownModal } from './components/EmergencyCountdownModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PublicLiveTracker } from './components/PublicLiveTracker';
import { PWAInstallButton } from './components/PWAInstallButton';
import { DashboardView } from './components/views/DashboardView';
import { ProfileView } from './components/views/ProfileView';
import { MedicalView } from './components/views/MedicalView';
import { BikesView } from './components/views/BikesView';
import { ContactsView } from './components/views/ContactsView';
import { LiveLocationView } from './components/views/LiveLocationView';
import { SosEmergencyView } from './components/views/SosEmergencyView';
import { AccidentHistoryView } from './components/views/AccidentHistoryView';
import { NotificationsView } from './components/views/NotificationsView';
import { DeviceStatusView } from './components/views/DeviceStatusView';
import { Esp32HardwareView } from './components/views/Esp32HardwareView';
import { SettingsView } from './components/views/SettingsView';
import { AdminDashboardView } from './components/views/AdminDashboardView';

export default function App() {
  // Check for public live location tracking query param (?track=<sessionId>)
  const [trackSessionId, setTrackSessionId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('track');
    return t && t.length >= 24 ? t : null;
  });

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Firestore-synced domain state
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [medical, setMedical] = useState<MedicalRecord | null>(null);
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [accidents, setAccidents] = useState<AccidentRecord[]>([]);
  const [notifications, setNotifications] = useState<EmergencyNotification[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveLocationSession[]>([]);
  const [esp32Devices, setEsp32Devices] = useState<Esp32Device[]>([]);
  const [verifiedHospitals, setVerifiedHospitals] = useState<HospitalItem[]>([]);
  const [nearbyHospitals, setNearbyHospitals] = useState<HospitalItem[]>([]);
  const [hospitalsLoading, setHospitalsLoading] = useState(false);
  const [hospitalsError, setHospitalsError] = useState<string | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  const [smsGatewayConfigured, setSmsGatewayConfigured] = useState(false);
  const [sosBusy, setSosBusy] = useState(false);
  const [syncingDevice, setSyncingDevice] = useState(false);
  const [globalNotice, setGlobalNotice] = useState<string | null>(null);

  // Accident Detection Countdown Modal state
  const [crashModal, setCrashModal] = useState<{
    open: boolean;
    gForce: number;
    tilt: number;
    isDrill: boolean;
  }>({ open: false, gForce: 0, tilt: 0, isDrill: false });

  const lastHospitalLookupRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  const handleImpactDetected = useCallback((gForce: number, tilt: number) => {
    setCrashModal((prev) =>
      prev.open ? prev : { open: true, gForce, tilt, isDrill: false }
    );
  }, []);

  const {
    telemetry,
    startGpsTracking,
    stopGpsTracking,
    setManualLocation,
    enableAccidentDetection,
    disableAccidentDetection,
    setFirestoreConnected,
    resetPeakGForce,
  } = useDeviceTelemetry({
    impactThresholdG: profile?.impactThresholdG ?? 3.2,
    onImpactDetected: handleImpactDetected,
  });

  // Check backend health & SMS gateway status
  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { smsGatewayConfigured?: boolean } | null) => {
        if (data && typeof data.smsGatewayConfigured === 'boolean') {
          setSmsGatewayConfigured(data.smsGatewayConfigured);
        }
      })
      .catch(() => undefined);

    void testFirestoreConnection().then((ok) => setFirestoreConnected(ok));
  }, [setFirestoreConnected]);

  // Listen for Google Maps Platform quota exhaustion events from Tier-1 & Tier-2 handlers
  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const isAdmin = Boolean(
    authUser &&
      authUser.emailVerified &&
      (authUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL || profile?.role === 'admin')
  );

  // Bootstrap & subscribe to Rider Profile + all rider collections
  useEffect(() => {
    if (!authUser) {
      setProfile(null);
      setMedical(null);
      setBikes([]);
      setContacts([]);
      setAccidents([]);
      setNotifications([]);
      setLiveSessions([]);
      setEsp32Devices([]);
      return;
    }

    let cancelled = false;
    const uid = authUser.uid;
    const riderRef = doc(db, 'riders', uid);

    const ensureProfile = async () => {
      if (!authUser.emailVerified) return;
      try {
        const snap = await getDoc(riderRef);
        if (!snap.exists() && !cancelled) {
          const isBootAdmin = authUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
          await setDoc(riderRef, {
            uid,
            fullName: (authUser.displayName || authUser.email?.split('@')[0] || 'Rider').slice(0, 120),
            email: (authUser.email || '').slice(0, 160),
            mobileNumber: '',
            dateOfBirth: '',
            age: 0,
            profilePhotoUrl: (authUser.photoURL || DEFAULT_AVATAR_URL).slice(0, 65000),
            role: isBootAdmin ? 'admin' : 'rider',
            biometricEnabled: false,
            biometricCredentialId: '',
            accidentCountdownSec: 15,
            impactThresholdG: 3.2,
            autoSmsEnabled: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `riders/${uid}`);
      }
    };

    void ensureProfile();

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        riderRef,
        (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as RiderProfile);
          }
          setFirestoreConnected(true);
        },
        (err) => handleFirestoreError(err, OperationType.GET, `riders/${uid}`)
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'riders', uid, 'medical', 'record'),
        (snap) => {
          setMedical(snap.exists() ? (snap.data() as MedicalRecord) : null);
        },
        (err) => handleFirestoreError(err, OperationType.GET, `riders/${uid}/medical/record`)
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'bikes'), where('riderId', '==', uid)),
        (snap) => {
          setBikes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Bike, 'id'>) })));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'bikes')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'emergencyContacts'), where('riderId', '==', uid)),
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
        query(collection(db, 'accidents'), where('riderId', '==', uid)),
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
        query(collection(db, 'notifications'), where('riderId', '==', uid)),
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
        query(collection(db, 'liveSessions'), where('riderId', '==', uid)),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<LiveLocationSession, 'id'>) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
          setLiveSessions(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'liveSessions')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'esp32Devices'), where('riderId', '==', uid)),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Esp32Device, 'id'>) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
          setEsp32Devices(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'esp32Devices')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'hospitals'), where('emergency24x7', 'in', [true, false])),
        (snap) => {
          setVerifiedHospitals(
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

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [authUser, setFirestoreConnected]);

  const activeAccident =
    accidents.find((a) => a.status === 'ACTIVE' || a.status === 'RESPONDING') || null;
  const activeSession = liveSessions.find((s) => s.isActive) || null;
  const effectiveLatitude =
    telemetry.latitude ??
    (activeSession?.isActive && (activeSession.latitude !== 0 || activeSession.longitude !== 0)
      ? activeSession.latitude
      : null);
  const effectiveLongitude =
    telemetry.longitude ??
    (activeSession?.isActive && (activeSession.latitude !== 0 || activeSession.longitude !== 0)
      ? activeSession.longitude
      : null);

  // Merge Google Places nearby hospitals + Admin-verified hospitals sorted by Haversine distance
  const combinedHospitals = useMemo<HospitalItem[]>(() => {
    const lat = effectiveLatitude;
    const lng = effectiveLongitude;
    const withDistVerified = verifiedHospitals.map((h) => ({
      ...h,
      distanceKm:
        lat !== null && lng !== null ? haversineKm(lat, lng, h.latitude, h.longitude) : 0,
    }));
    const merged = [...withDistVerified, ...nearbyHospitals];
    if (lat !== null && lng !== null) {
      merged.sort((a, b) => a.distanceKm - b.distanceKm);
    }
    return merged;
  }, [verifiedHospitals, nearbyHospitals, effectiveLatitude, effectiveLongitude]);

  const nearestHospital = combinedHospitals[0] || null;

  // Fetch nearby hospitals via Google Maps Platform Places API (New) proxy (/api/hospitals/nearby)
  const fetchNearbyHospitals = useCallback(
    async (force = false) => {
      if (effectiveLatitude === null || effectiveLongitude === null) return;
      const prev = lastHospitalLookupRef.current;
      const now = Date.now();
      if (
        !force &&
        prev &&
        now - prev.at < 60000 &&
        Math.abs(prev.lat - effectiveLatitude) < 0.004 &&
        Math.abs(prev.lng - effectiveLongitude) < 0.004
      ) {
        return;
      }

      lastHospitalLookupRef.current = {
        lat: effectiveLatitude,
        lng: effectiveLongitude,
        at: now,
      };
      setHospitalsLoading(true);
      setHospitalsError(null);

      try {
        const resp = await fetch(
          `/api/hospitals/nearby?lat=${effectiveLatitude}&lng=${effectiveLongitude}&radius=10000`
        );
        const data = (await resp.json().catch(() => ({}))) as {
          hospitals?: HospitalItem[];
          error?: string;
          quotaExceeded?: boolean;
        };
        if (resp.status === 429 || data.quotaExceeded) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        if (Array.isArray(data.hospitals)) {
          setNearbyHospitals(data.hospitals);
        }
        if (data.error) {
          setHospitalsError(data.error);
        }
      } catch {
        setHospitalsError('Unable to reach nearby hospital lookup service while offline.');
      } finally {
        setHospitalsLoading(false);
      }
    },
    [effectiveLatitude, effectiveLongitude]
  );

  useEffect(() => {
    if (effectiveLatitude !== null && effectiveLongitude !== null) {
      void fetchNearbyHospitals(false);
    }
  }, [effectiveLatitude, effectiveLongitude, fetchNearbyHospitals]);

  // Sync device telemetry to Firestore (/deviceStatuses/{uid})
  const syncDeviceStatusToCloud = useCallback(async () => {
    if (!authUser || !authUser.emailVerified) return;
    setSyncingDevice(true);
    const path = `deviceStatuses/${authUser.uid}`;
    try {
      await setDoc(doc(db, 'deviceStatuses', authUser.uid), {
        riderId: authUser.uid,
        riderName: (profile?.fullName || authUser.displayName || 'Rider').slice(0, 120),
        isConnected: telemetry.internetOnline && telemetry.firestoreConnected,
        gpsEnabled: telemetry.gpsEnabled,
        locationPermission: telemetry.locationPermission,
        internetOnline: telemetry.internetOnline,
        accelerometerAvailable: telemetry.accelerometerAvailable,
        gyroscopeAvailable: telemetry.gyroscopeAvailable,
        accidentDetectionActive: telemetry.accidentDetectionActive,
        batteryLevel: telemetry.batteryLevel ?? -1,
        batteryCharging: telemetry.batteryCharging,
        lastLatitude: telemetry.latitude ?? 0,
        lastLongitude: telemetry.longitude ?? 0,
        userAgentSummary: (navigator.userAgent || 'Browser').slice(0, 160),
        updatedAt: serverTimestamp(),
      });
      setFirestoreConnected(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setSyncingDevice(false);
    }
  }, [authUser, profile?.fullName, telemetry, setFirestoreConnected]);

  // Periodic/reactive device telemetry cloud sync
  useEffect(() => {
    if (!authUser || !authUser.emailVerified || !profile) return;
    const timer = window.setTimeout(() => {
      void syncDeviceStatusToCloud();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [
    authUser,
    profile,
    telemetry.gpsEnabled,
    telemetry.locationPermission,
    telemetry.internetOnline,
    telemetry.accidentDetectionActive,
    telemetry.batteryLevel,
  ]);

  // Push real-time GPS updates into active LiveLocationSession automatically
  useEffect(() => {
    if (
      !activeSession?.isActive ||
      !authUser?.emailVerified ||
      telemetry.latitude === null ||
      telemetry.longitude === null
    ) {
      return;
    }

    const sessionRef = doc(db, 'liveSessions', activeSession.id);
    const timer = window.setTimeout(() => {
      void updateDoc(sessionRef, {
        latitude: telemetry.latitude!,
        longitude: telemetry.longitude!,
        accuracyMeters: telemetry.accuracyMeters ?? 0,
        speedKmh: telemetry.speedKmh ?? 0,
        heading: telemetry.heading ?? 0,
        locationLabel: telemetry.locationAddress.slice(0, 250),
        nearestHospitalName: (nearestHospital?.name || '').slice(0, 160),
        nearestHospitalDistanceKm: nearestHospital?.distanceKm ?? 0,
        lastGpsUpdateIso: telemetry.lastGpsUpdateIso || new Date().toISOString(),
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [
    activeSession?.id,
    activeSession?.isActive,
    authUser?.emailVerified,
    telemetry.latitude,
    telemetry.longitude,
    telemetry.accuracyMeters,
    telemetry.speedKmh,
    telemetry.heading,
    telemetry.locationAddress,
    telemetry.lastGpsUpdateIso,
    nearestHospital?.name,
    nearestHospital?.distanceKm,
  ]);

  const buildMedicalSnapshot = useCallback(() => {
    const parts = [
      `Blood Group: ${medical?.bloodGroup || 'Not specified'}`,
      `Allergies: ${medical?.allergies || 'None reported'}`,
      `Conditions: ${medical?.medicalConditions || 'None reported'}`,
      `Instructions: ${medical?.emergencyInstructions || 'Follow standard trauma protocol'}`,
    ];
    return parts.join('\n').slice(0, 800);
  }, [medical]);

  const primaryBikeSummary = useMemo(() => {
    const primary = bikes.find((b) => b.isPrimary) || bikes[0];
    if (!primary) return '';
    return `${primary.brand} ${primary.model} (${primary.registrationNumber})`.slice(0, 160);
  }, [bikes]);

  // Start or Immediately Update Live Location Sharing Session in Firestore
  const handleStartLiveSharing = useCallback(
    async (
      accidentId = '',
      override?: { latitude: number; longitude: number; addressLabel?: string }
    ): Promise<string> => {
      if (!authUser || !authUser.emailVerified) {
        setGlobalNotice('Sign in with Google or verify your email to broadcast your live location.');
        return '';
      }

      const lat = override?.latitude ?? telemetry.latitude ?? 0;
      const lng = override?.longitude ?? telemetry.longitude ?? 0;
      const label = (
        override?.addressLabel ||
        telemetry.locationAddress ||
        (lat !== 0 || lng !== 0 ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Acquiring live GPS...')
      ).slice(0, 250);

      if (activeSession?.isActive) {
        if (override || (telemetry.latitude !== null && telemetry.longitude !== null)) {
          try {
            await updateDoc(doc(db, 'liveSessions', activeSession.id), {
              latitude: lat,
              longitude: lng,
              accuracyMeters: override ? 10 : (telemetry.accuracyMeters ?? 0),
              speedKmh: override ? 0 : (telemetry.speedKmh ?? 0),
              heading: override ? 0 : (telemetry.heading ?? 0),
              locationLabel: label,
              nearestHospitalName: (nearestHospital?.name || '').slice(0, 160),
              nearestHospitalDistanceKm: nearestHospital?.distanceKm ?? 0,
              lastGpsUpdateIso: new Date().toISOString(),
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `liveSessions/${activeSession.id}`);
          }
        }
        return activeSession.id;
      }

      const sessionId = generateSecureId('live', 28);
      const path = `liveSessions/${sessionId}`;
      try {
        await setDoc(doc(db, 'liveSessions', sessionId), {
          riderId: authUser.uid,
          accidentId: accidentId.slice(0, 128),
          riderName: (profile?.fullName || authUser.displayName || 'Rider').slice(0, 120),
          bikeSummary: primaryBikeSummary,
          bloodGroup: (medical?.bloodGroup || '').slice(0, 10),
          medicalAlertSummary: buildMedicalSnapshot().slice(0, 600),
          latitude: lat,
          longitude: lng,
          accuracyMeters: override ? 10 : (telemetry.accuracyMeters ?? 0),
          speedKmh: override ? 0 : (telemetry.speedKmh ?? 0),
          heading: override ? 0 : (telemetry.heading ?? 0),
          locationLabel: label,
          nearestHospitalName: (nearestHospital?.name || '').slice(0, 160),
          nearestHospitalDistanceKm: nearestHospital?.distanceKm ?? 0,
          isActive: true,
          lastGpsUpdateIso: new Date().toISOString(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setGlobalNotice('Live location broadcast is now active and streaming in real time.');
        return sessionId;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [
      authUser,
      activeSession,
      profile?.fullName,
      primaryBikeSummary,
      medical?.bloodGroup,
      buildMedicalSnapshot,
      telemetry,
      nearestHospital,
    ]
  );

  const handleStopLiveSharing = useCallback(async () => {
    if (!activeSession) return;
    const path = `liveSessions/${activeSession.id}`;
    try {
      await updateDoc(doc(db, 'liveSessions', activeSession.id), {
        isActive: false,
        updatedAt: serverTimestamp(),
      });
      setGlobalNotice('Live location sharing stopped. Public link access has been revoked.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }, [activeSession]);

  // Complete End-to-End Emergency Dispatch Workflow (Manual SOS or Auto Crash Detection)
  const triggerEmergencyWorkflow = useCallback(
    async (triggerType: AccidentTriggerType, impactGForce = 0) => {
      if (!authUser || !authUser.emailVerified) {
        setGlobalNotice('Verify your email or sign in with Google before triggering cloud SOS alerts.');
        return;
      }

      setSosBusy(true);
      setGlobalNotice(null);

      try {
        if (!telemetry.gpsEnabled) {
          startGpsTracking();
        }

        const accidentId = generateSecureId('acc', 20);
        const liveSessionId = await handleStartLiveSharing(accidentId);
        const liveUrl = liveSessionId ? buildLiveShareUrl(liveSessionId) : '';

        const primaryBike = bikes.find((b) => b.isPrimary) || bikes[0] || null;
        const lat = telemetry.latitude ?? 0;
        const lng = telemetry.longitude ?? 0;
        const medicalSnap = buildMedicalSnapshot();
        const sortedContacts = [...contacts].sort((a, b) => a.priority - b.priority);

        const emergencyMessage = [
          `EMERGENCY SOS (${triggerType === 'ACCIDENT_AUTO' ? 'Accident Detected' : 'Manual SOS'}): ${
            profile?.fullName || 'Rider'
          } needs urgent help.`,
          `GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)} (${telemetry.locationAddress.slice(0, 100)}).`,
          medical?.bloodGroup ? `Blood: ${medical.bloodGroup}.` : '',
          nearestHospital
            ? `Nearest hospital: ${nearestHospital.name} (${nearestHospital.distanceKm.toFixed(1)} km).`
            : '',
          liveUrl ? `Live tracker: ${liveUrl}` : '',
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, 600);

        // 1. Create AccidentRecord in Firestore
        const accidentPath = `accidents/${accidentId}`;
        try {
          await setDoc(doc(db, 'accidents', accidentId), {
            riderId: authUser.uid,
            riderName: (profile?.fullName || authUser.displayName || 'Rider').slice(0, 120),
            triggerType,
            status: 'ACTIVE',
            responseStatus: 'DISPATCHED',
            latitude: lat,
            longitude: lng,
            locationAddress: telemetry.locationAddress.slice(0, 300),
            bikeId: primaryBike?.id || '',
            bikeSummary: primaryBikeSummary,
            impactGForce: Number(impactGForce.toFixed(2)),
            nearestHospitalName: (nearestHospital?.name || '').slice(0, 160),
            nearestHospitalAddress: (nearestHospital?.address || '').slice(0, 300),
            nearestHospitalDistanceKm: nearestHospital?.distanceKm ?? 0,
            nearestHospitalPhone: (nearestHospital?.phone || '').slice(0, 40),
            contactsNotifiedCount: sortedContacts.length,
            notificationSummaryStatus: sortedContacts.length > 0 ? 'PENDING' : 'SENT',
            smsSummaryStatus: sortedContacts.length > 0 ? 'PENDING' : 'DEVICE_HANDOFF',
            callSummaryStatus: 'NOT_INITIATED',
            liveShareSessionId: liveSessionId,
            medicalSnapshot: medicalSnap,
            notes: '',
            resolvedAtIso: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, accidentPath);
        }

        // 2. Dispatch SMS via authenticated backend route (Twilio if configured, honest DEVICE_HANDOFF otherwise)
        let smsResults: Array<{
          contactId: string;
          contactName: string;
          contactPhone: string;
          alertStatus: 'SENT' | 'DELIVERED' | 'FAILED';
          smsDeliveryStatus: 'QUEUED' | 'SENT' | 'DELIVERED' | 'DEVICE_HANDOFF' | 'FAILED';
          providerNote: string;
        }> = [];

        if (sortedContacts.length > 0) {
          try {
            const idToken = await authUser.getIdToken();
            const resp = await fetch('/api/emergency/dispatch-sms', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({
                contacts: sortedContacts.map((c) => ({
                  id: c.id,
                  name: c.name,
                  mobileNumber: c.mobileNumber,
                })),
                message: emergencyMessage,
              }),
            });

            if (resp.ok) {
              const payload = (await resp.json()) as {
                results?: typeof smsResults;
              };
              smsResults = payload.results || [];
            } else {
              smsResults = sortedContacts.map((c) => ({
                contactId: c.id,
                contactName: c.name,
                contactPhone: c.mobileNumber,
                alertStatus: 'SENT',
                smsDeliveryStatus: 'FAILED',
                providerNote: `Server SMS dispatch returned HTTP ${resp.status}. Use Device SMS button.`,
              }));
            }
          } catch {
            smsResults = sortedContacts.map((c) => ({
              contactId: c.id,
              contactName: c.name,
              contactPhone: c.mobileNumber,
              alertStatus: 'SENT',
              smsDeliveryStatus: 'DEVICE_HANDOFF',
              providerNote: 'Network unavailable for carrier SMS. Use direct Device SMS handoff.',
            }));
          }

          // 3. Persist per-contact notification audit rows in Firestore
          await Promise.all(
            smsResults.map(async (resItem) => {
              const notifId = generateSecureId('ntf', 20);
              const notifPath = `notifications/${notifId}`;
              try {
                await setDoc(doc(db, 'notifications', notifId), {
                  riderId: authUser.uid,
                  accidentId,
                  contactId: resItem.contactId.slice(0, 128),
                  contactName: resItem.contactName.slice(0, 120),
                  contactPhone: resItem.contactPhone.slice(0, 24),
                  channel: 'SMS',
                  alertStatus: resItem.alertStatus,
                  smsDeliveryStatus: resItem.smsDeliveryStatus,
                  callStatus: 'NOT_APPLICABLE',
                  messagePreview: emergencyMessage,
                  providerNote: resItem.providerNote.slice(0, 300),
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              } catch (err) {
                handleFirestoreError(err, OperationType.CREATE, notifPath);
              }
            })
          );

          // 4. Update accident summary statuses based on honest carrier response
          const anyDelivered = smsResults.some((r) => r.smsDeliveryStatus === 'DELIVERED');
          const anySentOrQueued = smsResults.some(
            (r) => r.smsDeliveryStatus === 'SENT' || r.smsDeliveryStatus === 'QUEUED'
          );
          const anyHandoff = smsResults.some((r) => r.smsDeliveryStatus === 'DEVICE_HANDOFF');
          const allFailed = smsResults.every((r) => r.smsDeliveryStatus === 'FAILED');

          const smsSummaryStatus = anyDelivered
            ? 'DELIVERED'
            : anySentOrQueued
              ? 'SENT'
              : anyHandoff
                ? 'DEVICE_HANDOFF'
                : allFailed
                  ? 'FAILED'
                  : 'PENDING';

          await updateDoc(doc(db, 'accidents', accidentId), {
            notificationSummaryStatus: 'SENT',
            smsSummaryStatus,
            updatedAt: serverTimestamp(),
          });
        }

        setActiveNav('sos');
        setGlobalNotice(
          'Emergency alert activated. Live GPS sharing is running and emergency contact actions are ready.'
        );
      } finally {
        setSosBusy(false);
      }
    },
    [
      authUser,
      telemetry,
      startGpsTracking,
      handleStartLiveSharing,
      bikes,
      buildMedicalSnapshot,
      contacts,
      profile?.fullName,
      medical?.bloodGroup,
      nearestHospital,
      primaryBikeSummary,
    ]
  );

  // Cancel false accident alarm (optionally record cancelled drill/alarm in history)
  const handleCancelFalseAlarm = useCallback(async () => {
    const { gForce, isDrill } = crashModal;
    setCrashModal({ open: false, gForce: 0, tilt: 0, isDrill: false });

    if (authUser && authUser.emailVerified) {
      const accidentId = generateSecureId('acc', 20);
      try {
        await setDoc(doc(db, 'accidents', accidentId), {
          riderId: authUser.uid,
          riderName: (profile?.fullName || authUser.displayName || 'Rider').slice(0, 120),
          triggerType: isDrill ? 'TEST_DRILL' : 'ACCIDENT_AUTO',
          status: 'CANCELLED_FALSE_ALARM',
          responseStatus: 'CLOSED',
          latitude: telemetry.latitude ?? 0,
          longitude: telemetry.longitude ?? 0,
          locationAddress: telemetry.locationAddress.slice(0, 300),
          bikeId: bikes.find((b) => b.isPrimary)?.id || '',
          bikeSummary: primaryBikeSummary,
          impactGForce: Number(gForce.toFixed(2)),
          nearestHospitalName: (nearestHospital?.name || '').slice(0, 160),
          nearestHospitalAddress: (nearestHospital?.address || '').slice(0, 300),
          nearestHospitalDistanceKm: nearestHospital?.distanceKm ?? 0,
          nearestHospitalPhone: (nearestHospital?.phone || '').slice(0, 40),
          contactsNotifiedCount: 0,
          notificationSummaryStatus: 'PENDING',
          smsSummaryStatus: 'DEVICE_HANDOFF',
          callSummaryStatus: 'NOT_INITIATED',
          liveShareSessionId: '',
          medicalSnapshot: 'False alarm cancelled before dispatch.',
          notes: 'Rider confirmed safe during countdown window.',
          resolvedAtIso: new Date().toISOString(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking audit log
      }
    }

    setGlobalNotice('False alarm cancelled. No emergency alert was sent.');
  }, [
    crashModal,
    authUser,
    profile?.fullName,
    telemetry,
    bikes,
    primaryBikeSummary,
    nearestHospital,
  ]);

  const handleConfirmCountdownEmergency = useCallback(() => {
    const { gForce, isDrill } = crashModal;
    setCrashModal({ open: false, gForce: 0, tilt: 0, isDrill: false });
    void triggerEmergencyWorkflow(isDrill ? 'TEST_DRILL' : 'ACCIDENT_AUTO', gForce);
  }, [crashModal, triggerEmergencyWorkflow]);

  const handleResolveActiveEmergency = useCallback(async () => {
    if (!activeAccident) return;
    setSosBusy(true);
    try {
      await updateDoc(doc(db, 'accidents', activeAccident.id), {
        status: 'RESOLVED',
        responseStatus: 'CLOSED',
        resolvedAtIso: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
      if (activeSession?.isActive) {
        await updateDoc(doc(db, 'liveSessions', activeSession.id), {
          isActive: false,
          updatedAt: serverTimestamp(),
        });
      }
      setGlobalNotice(
        'Emergency marked resolved and live location sharing automatically stopped.'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `accidents/${activeAccident.id}`);
    } finally {
      setSosBusy(false);
    }
  }, [activeAccident, activeSession]);

  const handleLogCallAttempt = useCallback(
    async (contact: EmergencyContact) => {
      if (!activeAccident || !authUser?.emailVerified) return;
      const existingLog = notifications.find(
        (n) => n.accidentId === activeAccident.id && n.contactId === contact.id
      );
      try {
        if (existingLog) {
          await updateDoc(doc(db, 'notifications', existingLog.id), {
            callStatus: 'INITIATED',
            providerNote: `${existingLog.providerNote} · Direct call initiated by rider.`.slice(0, 300),
            updatedAt: serverTimestamp(),
          });
        }
        await updateDoc(doc(db, 'accidents', activeAccident.id), {
          callSummaryStatus: 'INITIATED',
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking dialer log
      }
    },
    [activeAccident, authUser?.emailVerified, notifications]
  );

  const handleMarkDeviceSmsOpened = useCallback(async (notificationId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), {
        smsDeliveryStatus: 'DEVICE_HANDOFF',
        providerNote: 'Device native SMS composer opened by rider for mobile network delivery.',
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-blocking status update
    }
  }, []);

  const handleRetrySmsNotification = useCallback(
    async (n: EmergencyNotification) => {
      if (!authUser) return;
      try {
        const idToken = await authUser.getIdToken();
        const resp = await fetch('/api/emergency/dispatch-sms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            contacts: [
              { id: n.contactId, name: n.contactName, mobileNumber: n.contactPhone },
            ],
            message: n.messagePreview,
          }),
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as {
          results?: Array<{
            alertStatus: 'SENT' | 'DELIVERED' | 'FAILED';
            smsDeliveryStatus: 'QUEUED' | 'SENT' | 'DELIVERED' | 'DEVICE_HANDOFF' | 'FAILED';
            providerNote: string;
          }>;
        };
        const first = data.results?.[0];
        if (!first) return;
        await updateDoc(doc(db, 'notifications', n.id), {
          alertStatus: first.alertStatus,
          smsDeliveryStatus: first.smsDeliveryStatus,
          providerNote: first.providerNote.slice(0, 300),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `notifications/${n.id}`);
      }
    },
    [authUser]
  );

  const handleToggleAccidentDetection = useCallback(async () => {
    if (telemetry.accidentDetectionActive) {
      disableAccidentDetection();
      setGlobalNotice('Accident detection sensors paused.');
    } else {
      const res = await enableAccidentDetection();
      setGlobalNotice(res.message);
    }
  }, [telemetry.accidentDetectionActive, disableAccidentDetection, enableAccidentDetection]);

  const handleLogout = async () => {
    stopGpsTracking();
    disableAccidentDetection();
    await signOut(auth);
    setActiveNav('dashboard');
  };

  const quotaBanner = mapsQuotaExceeded ? (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
      <span>
        Google Maps Platform quota reached. If you are the app owner, visit{' '}
        <a
          href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold text-amber-950 hover:text-amber-800"
        >
          maps developer site
        </a>{' '}
        for instructions to update your account.
      </span>
    </div>
  ) : null;

  // Public Live Tracker Mode (when opening ?track=<sessionId>)
  if (trackSessionId) {
    return (
      <>
        {quotaBanner}
        <PublicLiveTracker
          sessionId={trackSessionId}
          onExitTracker={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('track');
            window.history.replaceState({}, '', url.toString());
            setTrackSessionId(null);
          }}
        />
      </>
    );
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Initializing RiderGuard safety services...</div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <>
        <div className="fixed top-4 right-4 z-40">
          <PWAInstallButton variant="header" />
        </div>
        <AuthScreen />
        <OfflineIndicator />
      </>
    );
  }

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    highlight?: boolean;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'profile', label: 'My Profile', icon: UserIcon },
    { id: 'medical', label: 'Medical Information', icon: HeartPulse },
    { id: 'bikes', label: 'My Bike', icon: BikeIcon },
    { id: 'contacts', label: 'Emergency Contacts', icon: Users },
    { id: 'live-location', label: 'Live Location', icon: MapPin },
    { id: 'sos', label: 'SOS Emergency', icon: ShieldAlert, highlight: true },
    { id: 'accidents', label: 'Accident History', icon: History },
    { id: 'notifications', label: 'Notification History', icon: Bell },
    { id: 'device-status', label: 'Device Status', icon: Cpu },
    { id: 'esp32', label: 'ESP32 Device', icon: Radio },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  if (isAdmin) {
    navItems.push({ id: 'admin', label: 'Admin Dashboard', icon: Shield });
  }

  const currentNavLabel =
    navItems.find((i) => i.id === activeNav)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar (260px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
          <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            RiderGuard
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Primary Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? item.highlight
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-900 text-white'
                    : item.highlight
                      ? 'text-red-700 hover:bg-red-50'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 space-y-2">
          <div className="px-3 py-2 flex items-center gap-2.5">
            <img
              src={profile?.profilePhotoUrl || DEFAULT_AVATAR_URL}
              alt={profile?.fullName || 'Rider'}
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {profile?.fullName || authUser.displayName || 'Rider'}
              </div>
              <div className="text-[11px] text-slate-500 capitalize">
                {isAdmin ? 'Administrator' : 'Rider Account'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col shadow-xl z-10">
            <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-600" />
                <span className="font-display text-base font-bold text-slate-900">RiderGuard</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-900 cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg cursor-pointer ${
                      active
                        ? item.highlight
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-900 text-white'
                        : item.highlight
                          ? 'text-red-700 hover:bg-red-50'
                          : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {quotaBanner}
        {/* Clean Contextual Top Bar (<= 56px height) */}
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
              <span className="hidden sm:inline">RiderGuard</span>
              <span className="hidden sm:inline" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 truncate">{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton variant="header" />
            {activeAccident ? (
              <button
                type="button"
                onClick={() => setActiveNav('sos')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Activity className="w-3.5 h-3.5" />
                Active SOS
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveNav('sos')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                SOS Alert
              </button>
            )}
          </div>
        </header>

        {/* Email Verification Guard Banner for unverified Email/Password signups */}
        {!authUser.emailVerified && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Please verify your email address ({authUser.email}) to unlock cloud database saves and SOS dispatch.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await sendEmailVerification(authUser);
                    setGlobalNotice(`Verification email resent to ${authUser.email}. Check your inbox and spam folder.`);
                  } catch {
                    setGlobalNotice('Please wait a moment before requesting another verification email.');
                  }
                }}
                className="px-3 py-1 font-semibold bg-white border border-amber-300 rounded-md hover:bg-amber-100 cursor-pointer whitespace-nowrap"
              >
                Resend Verification
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await authUser.reload();
                    await authUser.getIdToken(true);
                    if (auth.currentUser?.emailVerified) {
                      window.location.reload();
                    } else {
                      setGlobalNotice(
                        `Email verification not detected yet for ${authUser.email}. Click the verification link in your inbox first, then tap "I Verified My Email".`
                      );
                    }
                  } catch {
                    setGlobalNotice('Unable to refresh verification status right now. Try again in a moment.');
                  }
                }}
                className="px-3 py-1 font-semibold bg-amber-900 text-white rounded-md hover:bg-amber-800 cursor-pointer whitespace-nowrap"
              >
                I Verified My Email
              </button>
            </div>
          </div>
        )}

        {/* Transient Notification Toast Bar */}
        {globalNotice && (
          <div className="bg-slate-900 text-white px-4 lg:px-8 py-2.5 text-xs flex items-center justify-between gap-4">
            <span>{globalNotice}</span>
            <button
              type="button"
              onClick={() => setGlobalNotice(null)}
              className="text-slate-300 hover:text-white cursor-pointer"
              aria-label="Dismiss message"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Active View Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1360px] w-full mx-auto">
          {activeNav === 'dashboard' && (
            <DashboardView
              profile={profile}
              medical={medical}
              bikes={bikes}
              contacts={contacts}
              accidents={accidents}
              notifications={notifications}
              activeAccident={activeAccident}
              activeSession={activeSession}
              telemetry={telemetry}
              nearestHospital={nearestHospital}
              onNavigate={setActiveNav}
              onTriggerSos={() => void triggerEmergencyWorkflow('SOS_MANUAL', 0)}
              onRequestGps={startGpsTracking}
              onToggleAccidentDetection={() => void handleToggleAccidentDetection()}
              onResolveActiveEmergency={() => void handleResolveActiveEmergency()}
            />
          )}

          {activeNav === 'profile' && <ProfileView profile={profile} />}

          {activeNav === 'medical' && <MedicalView profile={profile} medical={medical} />}

          {activeNav === 'bikes' && <BikesView profile={profile} bikes={bikes} />}

          {activeNav === 'contacts' && <ContactsView profile={profile} contacts={contacts} />}

          {activeNav === 'live-location' && (
            <LiveLocationView
              telemetry={telemetry}
              hospitals={combinedHospitals}
              hospitalsLoading={hospitalsLoading}
              hospitalsError={hospitalsError}
              activeSession={activeSession}
              contacts={contacts}
              riderName={profile?.fullName || authUser.displayName || 'Rider'}
              onRequestGps={startGpsTracking}
              onStopGps={stopGpsTracking}
              onSetManualLocation={async (lat, lng, address, makeLive = false) => {
                lastHospitalLookupRef.current = null;
                setManualLocation(lat, lng, address);
                if (makeLive || activeSession?.isActive) {
                  await handleStartLiveSharing(activeAccident?.id || '', {
                    latitude: lat,
                    longitude: lng,
                    addressLabel: address,
                  });
                }
              }}
              onRefreshHospitals={() => void fetchNearbyHospitals(true)}
              onStartLiveSharing={async () => {
                if (!telemetry.gpsEnabled && telemetry.latitude === null) {
                  startGpsTracking();
                }
                await handleStartLiveSharing(activeAccident?.id || '');
              }}
              onStopLiveSharing={handleStopLiveSharing}
            />
          )}

          {activeNav === 'sos' && (
            <SosEmergencyView
              profile={profile}
              medical={medical}
              contacts={contacts}
              activeAccident={activeAccident}
              activeSession={activeSession}
              notifications={notifications}
              telemetry={telemetry}
              nearestHospital={nearestHospital}
              smsGatewayConfigured={smsGatewayConfigured}
              sosBusy={sosBusy}
              onTriggerSos={() => triggerEmergencyWorkflow('SOS_MANUAL', 0)}
              onResolveEmergency={handleResolveActiveEmergency}
              onToggleAccidentDetection={handleToggleAccidentDetection}
              onRunImpactDrill={() =>
                setCrashModal({
                  open: true,
                  gForce: Number(((profile?.impactThresholdG ?? 3.2) + 0.85).toFixed(2)),
                  tilt: 74,
                  isDrill: true,
                })
              }
              onLogCallAttempt={handleLogCallAttempt}
              onLogDeviceSmsHandoff={handleMarkDeviceSmsOpened}
              onResetPeakG={resetPeakGForce}
            />
          )}

          {activeNav === 'accidents' && <AccidentHistoryView accidents={accidents} />}

          {activeNav === 'notifications' && (
            <NotificationsView
              notifications={notifications}
              activeAccident={activeAccident}
              activeSession={activeSession}
              telemetry={telemetry}
              smsGatewayConfigured={smsGatewayConfigured}
              onRetrySmsNotification={handleRetrySmsNotification}
              onMarkDeviceSmsOpened={handleMarkDeviceSmsOpened}
            />
          )}

          {activeNav === 'device-status' && (
            <DeviceStatusView
              telemetry={telemetry}
              onRequestGps={startGpsTracking}
              onEnableSensors={() => void handleToggleAccidentDetection()}
              onSyncDeviceNow={syncDeviceStatusToCloud}
              syncing={syncingDevice}
            />
          )}

          {activeNav === 'esp32' && (
            <Esp32HardwareView
              profile={profile}
              contacts={contacts}
              devices={esp32Devices}
            />
          )}

          {activeNav === 'settings' && (
            <SettingsView
              profile={profile}
              smsGatewayConfigured={smsGatewayConfigured}
              onNavigate={setActiveNav}
            />
          )}

          {activeNav === 'admin' && isAdmin && <AdminDashboardView />}
        </main>
      </div>

      {/* Accident Detection Confirmation & False-Alarm Cancellation Modal */}
      <EmergencyCountdownModal
        open={crashModal.open}
        countdownSeconds={profile?.accidentCountdownSec ?? 15}
        detectedGForce={crashModal.gForce}
        detectedTilt={crashModal.tilt}
        isDrill={crashModal.isDrill}
        onCancelFalseAlarm={() => void handleCancelFalseAlarm()}
        onConfirmEmergency={handleConfirmCountdownEmergency}
      />

      <OfflineIndicator />
    </div>
  );
}
