import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'rider' | 'admin';

export type NavSection =
  | 'dashboard'
  | 'profile'
  | 'medical'
  | 'bikes'
  | 'contacts'
  | 'live-location'
  | 'sos'
  | 'accidents'
  | 'notifications'
  | 'device-status'
  | 'esp32'
  | 'settings'
  | 'admin';

export interface RiderProfile {
  uid: string;
  fullName: string;
  email: string;
  mobileNumber: string;
  dateOfBirth: string;
  age: number;
  profilePhotoUrl: string;
  role: UserRole;
  biometricEnabled: boolean;
  biometricCredentialId: string;
  accidentCountdownSec: number;
  impactThresholdG: number;
  autoSmsEnabled: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MedicalRecord {
  riderId: string;
  bloodGroup: string;
  medicalConditions: string;
  allergies: string;
  medicalHistory: string;
  emergencyInstructions: string;
  aadhaarMasked: string;
  aadhaarEncrypted: string;
  encryptionIv: string;
  encryptionSalt: string;
  updatedAt?: Timestamp;
}

export interface Bike {
  id: string;
  riderId: string;
  registrationNumber: string;
  brand: string;
  model: string;
  color: string;
  manufacturingYear: number;
  vehiclePhotoUrl: string;
  insuranceProvider: string;
  insurancePolicyNumber: string;
  insuranceExpiry: string;
  rcNumber: string;
  ownerName: string;
  isPrimary: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface EmergencyContact {
  id: string;
  riderId: string;
  name: string;
  relationship: string;
  mobileNumber: string;
  email: string;
  priority: number;
  notifySms: boolean;
  notifyCall: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type AccidentTriggerType = 'SOS_MANUAL' | 'ACCIDENT_AUTO' | 'TEST_DRILL';
export type AccidentStatus = 'ACTIVE' | 'RESPONDING' | 'RESOLVED' | 'CANCELLED_FALSE_ALARM';
export type EmergencyResponseStatus = 'PENDING' | 'DISPATCHED' | 'ACKNOWLEDGED' | 'HOSPITAL_EN_ROUTE' | 'CLOSED';
export type NotificationSummaryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'PARTIAL' | 'FAILED';
export type SmsSummaryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'DEVICE_HANDOFF' | 'FAILED';
export type CallSummaryStatus = 'NOT_INITIATED' | 'INITIATED' | 'CONNECTED' | 'FAILED';

export interface AccidentRecord {
  id: string;
  riderId: string;
  riderName: string;
  triggerType: AccidentTriggerType;
  status: AccidentStatus;
  responseStatus: EmergencyResponseStatus;
  latitude: number;
  longitude: number;
  locationAddress: string;
  bikeId: string;
  bikeSummary: string;
  impactGForce: number;
  nearestHospitalName: string;
  nearestHospitalAddress: string;
  nearestHospitalDistanceKm: number;
  nearestHospitalPhone: string;
  contactsNotifiedCount: number;
  notificationSummaryStatus: NotificationSummaryStatus;
  smsSummaryStatus: SmsSummaryStatus;
  callSummaryStatus: CallSummaryStatus;
  liveShareSessionId: string;
  medicalSnapshot: string;
  notes: string;
  resolvedAtIso: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface EmergencyNotification {
  id: string;
  riderId: string;
  accidentId: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  channel: 'APP_ALERT' | 'SMS' | 'CALL' | 'LIVE_LINK';
  alertStatus: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  smsDeliveryStatus:
    | 'NOT_APPLICABLE'
    | 'PENDING'
    | 'QUEUED'
    | 'SENT'
    | 'DELIVERED'
    | 'DEVICE_HANDOFF'
    | 'FAILED';
  callStatus: 'NOT_APPLICABLE' | 'INITIATED' | 'COMPLETED' | 'FAILED';
  messagePreview: string;
  providerNote: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface LiveLocationSession {
  id: string;
  riderId: string;
  accidentId: string;
  riderName: string;
  bikeSummary: string;
  bloodGroup: string;
  medicalAlertSummary: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  speedKmh: number;
  heading: number;
  locationLabel: string;
  nearestHospitalName: string;
  nearestHospitalDistanceKm: number;
  isActive: boolean;
  lastGpsUpdateIso: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DeviceStatusRecord {
  riderId: string;
  riderName: string;
  isConnected: boolean;
  gpsEnabled: boolean;
  locationPermission: 'granted' | 'denied' | 'prompt' | 'unsupported';
  internetOnline: boolean;
  accelerometerAvailable: boolean;
  gyroscopeAvailable: boolean;
  accidentDetectionActive: boolean;
  batteryLevel: number;
  batteryCharging: boolean;
  lastLatitude: number;
  lastLongitude: number;
  userAgentSummary: string;
  updatedAt?: Timestamp;
}

export interface HospitalItem {
  id: string;
  name: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  traumaLevel: string;
  emergency24x7: boolean;
  source: 'google_places' | 'verified';
  googleMapsUri?: string;
}

export interface LiveTelemetryState {
  internetOnline: boolean;
  firestoreConnected: boolean;
  locationPermission: 'granted' | 'denied' | 'prompt' | 'unsupported';
  locationSource: 'none' | 'gps' | 'manual';
  gpsEnabled: boolean;
  gpsError: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  speedKmh: number | null;
  heading: number | null;
  locationAddress: string;
  lastGpsUpdateIso: string | null;
  locationHistory: Array<[number, number]>;
  batteryLevel: number | null;
  batteryCharging: boolean;
  batterySupported: boolean;
  accelerometerAvailable: boolean;
  gyroscopeAvailable: boolean;
  motionPermissionState: 'granted' | 'prompt' | 'denied' | 'unsupported';
  currentGForce: number;
  peakGForce: number;
  tiltDegrees: number;
  accidentDetectionActive: boolean;
  lastDeviceSyncIso: string | null;
}

export type Esp32SyncMethod = 'NONE' | 'USB_SERIAL' | 'BLUETOOTH_BLE' | 'WIFI_CLOUD';

export interface Esp32Device {
  id: string;
  riderId: string;
  deviceName: string;
  hardwareModel: string;
  primaryNumber: string;
  secondaryNumber: string;
  tertiaryNumber: string;
  syncToken: string;
  configVersion: number;
  lastSyncMethod: Esp32SyncMethod;
  lastSyncedAtIso: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export const DEFAULT_AVATAR_URL = '/src/assets/images/rider_avatar_default_1795277638114.jpg';
export const DEFAULT_BIKE_URL = '/src/assets/images/bike_default_showcase_1795277638053.jpg';
export const AUTH_HERO_URL = '/src/assets/images/auth_hero_rider_1795277638651.jpg';
export const BOOTSTRAPPED_ADMIN_EMAIL = 'krishroy3211@gmail.com';
