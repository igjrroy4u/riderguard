import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  AlertTriangle,
  Bike,
  HeartPulse,
  Hospital,
  MapPin,
  Navigation,
  ShieldAlert,
  Clock,
  Lock,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { buildHospitalNavigationUrl, formatCoords, formatTimestamp } from '../lib/geo';
import type { LiveLocationSession } from '../types';
import { LiveMap } from './LiveMap';

interface PublicLiveTrackerProps {
  sessionId: string;
  onExitTracker: () => void;
}

export const PublicLiveTracker: React.FC<PublicLiveTrackerProps> = ({
  sessionId,
  onExitTracker,
}) => {
  const [session, setSession] = useState<LiveLocationSession | null>(null);
  const [trail, setTrail] = useState<Array<[number, number]>>([]);
  const [loading, setLoading] = useState(true);
  const [closedOrDenied, setClosedOrDenied] = useState(false);

  useEffect(() => {
    const ref = doc(db, 'liveSessions', sessionId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setClosedOrDenied(true);
          setSession(null);
          return;
        }
        const data = { id: snap.id, ...(snap.data() as Omit<LiveLocationSession, 'id'>) };
        if (!data.isActive) {
          setClosedOrDenied(true);
          setSession(null);
          return;
        }
        setClosedOrDenied(false);
        setSession(data);
        setTrail((prev) => {
          const last = prev[prev.length - 1];
          if (
            !last ||
            Math.abs(last[0] - data.latitude) > 0.00005 ||
            Math.abs(last[1] - data.longitude) > 0.00005
          ) {
            return [...prev.slice(-100), [data.latitude, data.longitude]];
          }
          return prev;
        });
      },
      () => {
        setLoading(false);
        setClosedOrDenied(true);
        setSession(null);
      }
    );

    return () => unsub();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Connecting to live emergency location stream...</div>
      </div>
    );
  }

  if (closedOrDenied || !session) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Lock className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
            Live Location Sharing Ended
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            This emergency tracking session has been closed by the rider or the link has expired.
            Access to live GPS coordinates is automatically revoked when an emergency is resolved.
          </p>
          <button
            type="button"
            onClick={onExitTracker}
            className="px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Open RiderGuard App
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-red-600 text-white px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 shrink-0" />
          <div>
            <h1 className="font-display text-lg font-bold leading-tight">
              RiderGuard Live Emergency Tracker
            </h1>
            <p className="text-xs text-red-100">
              Authorized live stream for {session.riderName}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExitTracker}
          className="px-3.5 py-2 text-xs font-semibold bg-white/15 hover:bg-white/25 text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          Open RiderGuard Portal
        </button>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <div className="flex items-center gap-2 font-medium text-red-700">
                <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                <span>Live GPS Stream Active</span>
              </div>
              <div className="flex items-center gap-3 font-mono-tabular">
                <span>{formatCoords(session.latitude, session.longitude)}</span>
                <span>·</span>
                <span>{session.speedKmh.toFixed(1)} km/h</span>
                <span>·</span>
                <span>±{Math.round(session.accuracyMeters)}m</span>
              </div>
            </div>

            <LiveMap
              latitude={session.latitude}
              longitude={session.longitude}
              accuracyMeters={session.accuracyMeters}
              trail={trail}
              riderLabel={`${session.riderName} (Emergency)`}
              isEmergency
              heightClass="h-[440px]"
            />

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                <span>{session.locationLabel || 'Acquiring street address...'}</span>
              </div>
              <a
                href={buildHospitalNavigationUrl(session.latitude, session.longitude)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
              >
                <Navigation className="w-3.5 h-3.5" />
                Navigate to Rider
              </a>
            </div>
          </div>

          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                <HeartPulse className="w-4 h-4" />
                <span>Emergency Medical Summary</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm border-y border-slate-100 py-3">
                <div>
                  <div className="text-xs text-slate-500">Rider Name</div>
                  <div className="font-semibold text-slate-900">{session.riderName}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Blood Group</div>
                  <div className="font-mono-tabular font-bold text-red-700 text-base">
                    {session.bloodGroup || 'Not listed'}
                  </div>
                </div>
              </div>
              <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                {session.medicalAlertSummary || 'No additional medical conditions listed.'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-sm">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Bike className="w-4 h-4 text-slate-500" />
                <span>Registered Vehicle</span>
              </div>
              <p className="text-xs text-slate-700">{session.bikeSummary || 'Not specified'}</p>

              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center gap-2 font-semibold text-slate-900 mb-1">
                  <Hospital className="w-4 h-4 text-emerald-600" />
                  <span>Nearest Hospital</span>
                </div>
                <p className="text-xs text-slate-700">
                  {session.nearestHospitalName || 'Locating nearby hospital'}
                  {session.nearestHospitalDistanceKm > 0 && (
                    <span className="font-mono-tabular text-slate-500">
                      {' '}
                      · {session.nearestHospitalDistanceKm.toFixed(2)} km away
                    </span>
                  )}
                </p>
              </div>

              <div className="border-t border-slate-100 pt-3 flex items-center gap-2 text-xs text-slate-500">
                <Clock className="w-3.5 h-3.5" />
                <span>Last GPS sync: {formatTimestamp(session.lastGpsUpdateIso)}</span>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <span>
                Only critical emergency medical info is shared here. Identity documents (Aadhaar) remain encrypted and restricted.
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
