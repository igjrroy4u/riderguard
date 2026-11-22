import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveTelemetryState } from '../types';

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

interface DeviceMotionConstructorWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

interface UseDeviceTelemetryOptions {
  impactThresholdG: number;
  onImpactDetected: (gForce: number, tiltDeg: number) => void;
}

export function useDeviceTelemetry({
  impactThresholdG,
  onImpactDetected,
}: UseDeviceTelemetryOptions) {
  const [state, setState] = useState<LiveTelemetryState>(() => ({
    internetOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    firestoreConnected: true,
    locationPermission:
      typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'prompt' : 'unsupported',
    locationSource: 'none',
    gpsEnabled: false,
    gpsError: null,
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    speedKmh: null,
    heading: null,
    locationAddress: 'Location permission not yet granted',
    lastGpsUpdateIso: null,
    locationHistory: [],
    batteryLevel: null,
    batteryCharging: false,
    batterySupported: false,
    accelerometerAvailable: typeof window !== 'undefined' && 'DeviceMotionEvent' in window,
    gyroscopeAvailable: typeof window !== 'undefined' && 'DeviceOrientationEvent' in window,
    motionPermissionState:
      typeof window !== 'undefined' && 'DeviceMotionEvent' in window ? 'prompt' : 'unsupported',
    currentGForce: 1.0,
    peakGForce: 1.0,
    tiltDegrees: 0,
    accidentDetectionActive: false,
    lastDeviceSyncIso: null,
  }));

  const watchIdRef = useRef<number | null>(null);
  const bestAccuracyRef = useRef<number | null>(null);
  const lastGeocodeRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastImpactTriggerRef = useRef<number>(0);
  const onImpactRef = useRef(onImpactDetected);
  const thresholdRef = useRef(impactThresholdG);

  useEffect(() => {
    onImpactRef.current = onImpactDetected;
  }, [onImpactDetected]);

  useEffect(() => {
    thresholdRef.current = impactThresholdG;
  }, [impactThresholdG]);

  // 1. Internet connectivity listener
  useEffect(() => {
    const handleOnline = () => setState((prev) => ({ ...prev, internetOnline: true }));
    const handleOffline = () => setState((prev) => ({ ...prev, internetOnline: false }));
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 2. Real Battery Status API (where supported by browser)
  useEffect(() => {
    const nav = navigator as NavigatorWithBattery;
    if (!nav.getBattery) return;

    let batteryObj: BatteryManagerLike | null = null;
    const syncBattery = () => {
      if (!batteryObj) return;
      setState((prev) => ({
        ...prev,
        batterySupported: true,
        batteryLevel: Math.round(batteryObj!.level * 100),
        batteryCharging: batteryObj!.charging,
      }));
    };

    nav
      .getBattery()
      .then((bat) => {
        batteryObj = bat;
        syncBattery();
        bat.addEventListener('levelchange', syncBattery);
        bat.addEventListener('chargingchange', syncBattery);
      })
      .catch(() => {
        // Battery API unavailable
      });

    return () => {
      if (batteryObj) {
        batteryObj.removeEventListener('levelchange', syncBattery);
        batteryObj.removeEventListener('chargingchange', syncBattery);
      }
    };
  }, []);

  // 3. Query Geolocation Permission state passively without prompting user
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState((prev) => ({ ...prev, locationPermission: 'unsupported' }));
      return;
    }
    if (!navigator.permissions?.query) return;
    let permStatus: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        permStatus = status;
        setState((prev) => ({
          ...prev,
          locationPermission: status.state as 'granted' | 'denied' | 'prompt',
        }));
        status.onchange = () => {
          setState((prev) => ({
            ...prev,
            locationPermission: status.state as 'granted' | 'denied' | 'prompt',
            gpsEnabled: status.state === 'denied' ? false : prev.gpsEnabled,
          }));
        };
      })
      .catch(() => {
        // Permissions API not supported for geolocation
      });
    return () => {
      if (permStatus) permStatus.onchange = null;
    };
  }, []);

  const reverseGeocode = useCallback(async (lat: number, lng: number, force = false) => {
    const prev = lastGeocodeRef.current;
    const now = Date.now();
    if (
      !force &&
      prev &&
      now - prev.at < 30000 &&
      Math.abs(prev.lat - lat) < 0.0008 &&
      Math.abs(prev.lng - lng) < 0.0008
    ) {
      return;
    }
    lastGeocodeRef.current = { lat, lng, at: now };
    try {
      const resp = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
      const data = (await resp.json().catch(() => ({}))) as {
        address?: string;
        quotaExceeded?: boolean;
      };
      if (resp.status === 429 || data.quotaExceeded) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        return;
      }
      if (!resp.ok) return;
      if (data.address) {
        setState((s) => ({ ...s, locationAddress: data.address! }));
      }
    } catch {
      // Keep coordinate label when offline
    }
  }, []);

  // 4. Explicit User-Requested GPS Permission & Live Tracking
  const startGpsTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState((prev) => ({
        ...prev,
        locationPermission: 'unsupported',
        gpsEnabled: false,
        gpsError: 'Geolocation is not supported by this browser or device.',
      }));
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    bestAccuracyRef.current = null;

    setState((prev) => ({ ...prev, gpsError: null, locationSource: 'gps' }));

    const handlePosition = (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy, speed, heading } = pos.coords;
      const roundedAcc = accuracy ? Math.round(accuracy) : 0;

      // Prevent jumping back to coarse IP/cell-tower drift after a high-accuracy lock
      if (
        bestAccuracyRef.current !== null &&
        bestAccuracyRef.current <= 150 &&
        roundedAcc > 1000
      ) {
        return;
      }
      if (roundedAcc > 0 && (bestAccuracyRef.current === null || roundedAcc < bestAccuracyRef.current)) {
        bestAccuracyRef.current = roundedAcc;
      }

      const iso = new Date(pos.timestamp || Date.now()).toISOString();
      const speedKmh = speed !== null && speed >= 0 ? Number((speed * 3.6).toFixed(1)) : 0;

      setState((prev) => {
        const lastPoint = prev.locationHistory[prev.locationHistory.length - 1];
        const movedEnough =
          !lastPoint ||
          Math.abs(lastPoint[0] - latitude) > 0.00008 ||
          Math.abs(lastPoint[1] - longitude) > 0.00008;
        const nextHistory = movedEnough
          ? [...prev.locationHistory.slice(-120), [latitude, longitude] as [number, number]]
          : prev.locationHistory;

        return {
          ...prev,
          locationPermission: 'granted',
          locationSource: 'gps',
          gpsEnabled: true,
          gpsError: null,
          latitude,
          longitude,
          accuracyMeters: roundedAcc,
          speedKmh,
          heading: heading !== null && Number.isFinite(heading) ? Math.round(heading) : 0,
          lastGpsUpdateIso: iso,
          locationHistory: nextHistory,
          locationAddress:
            prev.locationAddress === 'Location permission not yet granted'
              ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
              : prev.locationAddress,
        };
      });

      void reverseGeocode(latitude, longitude);
    };

    const handleError = (err: GeolocationPositionError) => {
      const denied = err.code === err.PERMISSION_DENIED;
      setState((prev) => ({
        ...prev,
        locationPermission: denied ? 'denied' : prev.locationPermission,
        gpsEnabled: false,
        gpsError: denied
          ? 'Location permission was denied. Enable GPS access in browser site settings, or search/pin your exact location below.'
          : err.code === err.POSITION_UNAVAILABLE
            ? 'GPS position unavailable. Ensure device location services are turned on, or pin your exact location on the map.'
            : 'GPS request timed out. Retrying when signal is available, or pin your location manually below.',
      }));
    };

    // Request an immediate fresh high-accuracy fix (maximumAge: 0 avoids stale coarse cache)
    navigator.geolocation.getCurrentPosition(handlePosition, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12000,
    });

    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });
  }, [reverseGeocode]);

  // Manual Exact Pin / Address Override (stops inaccurate desktop/IP watch from overwriting)
  const setManualLocation = useCallback(
    (latitude: number, longitude: number, addressLabel?: string) => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      bestAccuracyRef.current = null;

      const iso = new Date().toISOString();
      const cleanLabel = addressLabel?.trim() || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

      setState((prev) => ({
        ...prev,
        locationSource: 'manual',
        gpsEnabled: true,
        gpsError: null,
        latitude,
        longitude,
        accuracyMeters: 10,
        speedKmh: 0,
        heading: 0,
        lastGpsUpdateIso: iso,
        locationAddress: cleanLabel,
        locationHistory: [[latitude, longitude]],
      }));

      if (!addressLabel?.trim()) {
        void reverseGeocode(latitude, longitude, true);
      }
    },
    [reverseGeocode]
  );

  const stopGpsTracking = useCallback(() => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    bestAccuracyRef.current = null;
    setState((prev) => ({ ...prev, gpsEnabled: false, locationSource: 'none' }));
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // 5. Real Accelerometer & Gyroscope Accident Detection (asks iOS permission explicitly)
  const enableAccidentDetection = useCallback(async (): Promise<{
    ok: boolean;
    message: string;
  }> => {
    if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
      setState((prev) => ({
        ...prev,
        accelerometerAvailable: false,
        motionPermissionState: 'unsupported',
        accidentDetectionActive: false,
      }));
      return {
        ok: false,
        message: 'Motion sensors are not available on this device/browser.',
      };
    }

    try {
      const DME = DeviceMotionEvent as unknown as DeviceMotionConstructorWithPermission;
      if (typeof DME.requestPermission === 'function') {
        const res = await DME.requestPermission();
        if (res !== 'granted') {
          setState((prev) => ({
            ...prev,
            motionPermissionState: 'denied',
            accidentDetectionActive: false,
          }));
          return {
            ok: false,
            message: 'Motion sensor permission was denied by the user.',
          };
        }
      }
      const DOE = DeviceOrientationEvent as unknown as DeviceMotionConstructorWithPermission;
      if (typeof DOE?.requestPermission === 'function') {
        await DOE.requestPermission().catch(() => 'denied');
      }

      setState((prev) => ({
        ...prev,
        motionPermissionState: 'granted',
        accidentDetectionActive: true,
        peakGForce: 1.0,
      }));
      return {
        ok: true,
        message: 'Accident detection sensors armed. Monitoring accelerometer and gyroscope impact.',
      };
    } catch {
      return {
        ok: false,
        message: 'Failed to request motion sensor permissions.',
      };
    }
  }, []);

  const disableAccidentDetection = useCallback(() => {
    setState((prev) => ({ ...prev, accidentDetectionActive: false }));
  }, []);

  useEffect(() => {
    if (!state.accidentDetectionActive) return;

    let latestTilt = 0;

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity || event.acceleration;
      if (!acc) return;
      const ax = acc.x ?? 0;
      const ay = acc.y ?? 0;
      const az = acc.z ?? 0;
      const mag = Math.sqrt(ax * ax + ay * ay + az * az);
      if (!Number.isFinite(mag) || mag === 0) return;

      const gForce = Number((mag / 9.80665).toFixed(2));
      setState((prev) => ({
        ...prev,
        accelerometerAvailable: true,
        currentGForce: gForce,
        peakGForce: Math.max(prev.peakGForce, gForce),
      }));

      const now = Date.now();
      if (gForce >= thresholdRef.current && now - lastImpactTriggerRef.current > 20000) {
        lastImpactTriggerRef.current = now;
        onImpactRef.current(gForce, latestTilt);
      }
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const beta = Math.abs(event.beta ?? 0);
      const gamma = Math.abs(event.gamma ?? 0);
      const tilt = Math.round(Math.max(beta, gamma));
      latestTilt = tilt;
      setState((prev) => ({
        ...prev,
        gyroscopeAvailable: true,
        tiltDegrees: tilt,
      }));
    };

    window.addEventListener('devicemotion', handleMotion);
    window.addEventListener('deviceorientation', handleOrientation);
    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, [state.accidentDetectionActive]);

  const setFirestoreConnected = useCallback((connected: boolean) => {
    setState((prev) => ({
      ...prev,
      firestoreConnected: connected,
      lastDeviceSyncIso: connected ? new Date().toISOString() : prev.lastDeviceSyncIso,
    }));
  }, []);

  const resetPeakGForce = useCallback(() => {
    setState((prev) => ({ ...prev, peakGForce: prev.currentGForce }));
  }, []);

  return {
    telemetry: state,
    startGpsTracking,
    stopGpsTracking,
    setManualLocation,
    enableAccidentDetection,
    disableAccidentDetection,
    setFirestoreConnected,
    resetPeakGForce,
  };
}
