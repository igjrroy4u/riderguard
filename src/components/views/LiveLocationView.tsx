import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Crosshair,
  ExternalLink,
  Hospital,
  MapPin,
  Navigation,
  Phone,
  Radio,
  RefreshCw,
  Search,
  Share2,
  Square,
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
  EmergencyContact,
  HospitalItem,
  LiveLocationSession,
  LiveTelemetryState,
} from '../../types';
import { LiveMap } from '../LiveMap';
import { StatusText } from '../StatusText';

interface LiveLocationViewProps {
  telemetry: LiveTelemetryState;
  hospitals: HospitalItem[];
  hospitalsLoading: boolean;
  hospitalsError: string | null;
  activeSession: LiveLocationSession | null;
  contacts: EmergencyContact[];
  riderName: string;
  onRequestGps: () => void;
  onStopGps: () => void;
  onSetManualLocation: (
    lat: number,
    lng: number,
    address?: string,
    makeLive?: boolean
  ) => Promise<void> | void;
  onRefreshHospitals: () => void;
  onStartLiveSharing: () => Promise<void>;
  onStopLiveSharing: () => Promise<void>;
}

interface SearchLocationResult {
  placeId: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
}

export const LiveLocationView: React.FC<LiveLocationViewProps> = ({
  telemetry,
  hospitals,
  hospitalsLoading,
  hospitalsError,
  activeSession,
  contacts,
  riderName,
  onRequestGps,
  onStopGps,
  onSetManualLocation,
  onRefreshHospitals,
  onStartLiveSharing,
  onStopLiveSharing,
}) => {
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);

  // Location correction / Google Maps link import state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchingLocation, setSearchingLocation] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchLocationResult[]>([]);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [pickLocationMode, setPickLocationMode] = useState(false);

  // If another signed-in device (e.g. your phone) is actively streaming live GPS, reflect it in real time
  const receivingCloudLiveStream =
    telemetry.locationSource === 'none' &&
    Boolean(activeSession?.isActive) &&
    ((activeSession?.latitude ?? 0) !== 0 || (activeSession?.longitude ?? 0) !== 0);

  const displayLat = receivingCloudLiveStream ? activeSession!.latitude : telemetry.latitude;
  const displayLng = receivingCloudLiveStream ? activeSession!.longitude : telemetry.longitude;
  const displayAccuracy = receivingCloudLiveStream
    ? activeSession!.accuracyMeters
    : telemetry.accuracyMeters;
  const displaySpeed = receivingCloudLiveStream ? activeSession!.speedKmh : telemetry.speedKmh;
  const displayAddress = receivingCloudLiveStream
    ? activeSession!.locationLabel || `${activeSession!.latitude.toFixed(5)}, ${activeSession!.longitude.toFixed(5)}`
    : telemetry.locationAddress;
  const displayLastSync = receivingCloudLiveStream
    ? activeSession!.lastGpsUpdateIso
    : telemetry.lastGpsUpdateIso;

  const liveUrl = activeSession?.isActive ? buildLiveShareUrl(activeSession.id) : '';
  const nearestHospital = hospitals[0] || null;
  const primaryContact = [...contacts].sort((a, b) => a.priority - b.priority)[0] || null;
  const isLowAccuracyGps =
    telemetry.locationSource === 'gps' &&
    telemetry.accuracyMeters !== null &&
    telemetry.accuracyMeters > 300;

  const handleSearchAddress = async (e: React.FormEvent, makeLive = true) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setSearchingLocation(true);
    setSearchMessage(null);
    setSearchResults([]);
    try {
      const resp = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}`);
      const data = (await resp.json().catch(() => ({}))) as {
        results?: SearchLocationResult[];
        error?: string;
        quotaExceeded?: boolean;
      };
      if (resp.status === 429 || data.quotaExceeded) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      if (!resp.ok) {
        setSearchMessage(data.error || 'Could not look up that Google Maps link or address.');
        return;
      }
      const list = Array.isArray(data.results) ? data.results : [];
      if (list.length === 0) {
        setSearchMessage(
          'No matching location found. Paste a Google Maps share link (maps.app.goo.gl/...), street address, PIN code, or click "Pin on Map".'
        );
      } else if (list.length === 1) {
        const match = list[0];
        await onSetManualLocation(match.latitude, match.longitude, match.formattedAddress, makeLive);
        setPickLocationMode(false);
        setSearchMessage(
          makeLive
            ? `Location updated to ${match.formattedAddress} and live broadcast is active.`
            : `Location updated to: ${match.formattedAddress}`
        );
      } else {
        setSearchResults(list);
      }
    } catch {
      setSearchMessage('Unable to reach Google Maps lookup service. You can still click "Pin on Map" directly.');
    } finally {
      setSearchingLocation(false);
    }
  };

  const handlePickOnMap = async (lat: number, lng: number) => {
    await onSetManualLocation(lat, lng, undefined, true);
    setPickLocationMode(false);
    setSearchResults([]);
    setSearchMessage(`Exact location pinned at ${lat.toFixed(5)}°, ${lng.toFixed(5)}° and synced live.`);
  };

  const handleToggleSharing = async () => {
    setSharingBusy(true);
    try {
      if (activeSession?.isActive) {
        await onStopLiveSharing();
      } else {
        await onStartLiveSharing();
      }
    } finally {
      setSharingBusy(false);
    }
  };

  const handleCopyLink = async () => {
    if (!liveUrl) return;
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked
    }
  };

  const handleNativeShare = async () => {
    if (!liveUrl || !navigator.share) return;
    try {
      await navigator.share({
        title: `RiderGuard Live Location — ${riderName}`,
        text: `Track ${riderName}'s live GPS location on RiderGuard:`,
        url: liveUrl,
      });
    } catch {
      // User cancelled share
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Live GPS Tracking & Nearest Hospital Finder
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Real-time coordinates, shareable emergency tracking link, and automatic nearby hospital discovery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {telemetry.gpsEnabled ? (
            <button
              type="button"
              onClick={onStopGps}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5" />
              Stop GPS Watch
            </button>
          ) : (
            <button
              type="button"
              onClick={onRequestGps}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <MapPin className="w-3.5 h-3.5" />
              Request GPS Permission & Start
            </button>
          )}

          <button
            type="button"
            disabled={sharingBusy}
            onClick={handleToggleSharing}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
              activeSession?.isActive
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            {activeSession?.isActive ? 'Stop Live Broadcast' : 'Go Live Now'}
          </button>
        </div>
      </div>

      {telemetry.gpsError && (
        <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
          <span>{telemetry.gpsError}</span>
        </div>
      )}

      {isLowAccuracyGps && (
        <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
            <span>
              Low browser GPS accuracy (<strong className="font-mono-tabular">±{telemetry.accuracyMeters}m</strong>) — laptops and Wi-Fi networks often report your ISP hub instead of your exact street. Search your address or click <strong>Pin on Map</strong> below to set your exact location.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPickLocationMode(true)}
            className="px-3 py-1.5 font-semibold bg-amber-900 text-white hover:bg-amber-800 rounded-md cursor-pointer whitespace-nowrap"
          >
            Pin Exact Location
          </button>
        </div>
      )}

      {/* Update with Google Maps Location & Make Live Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-900">
              Sync from Google Maps Link, Address, or Pin — and Broadcast Live
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Open Google Maps on your phone or browser → tap your blue dot → Share / Copy link → paste below to update your live location instantly.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            Source:{' '}
            <strong className="text-slate-900">
              {receivingCloudLiveStream
                ? 'Live Cloud Stream (Phone/Device)'
                : telemetry.locationSource === 'manual'
                  ? 'Google Maps Link / Exact Pin'
                  : telemetry.locationSource === 'gps'
                    ? 'Device Live GPS'
                    : 'Not set'}
            </strong>
          </div>
        </div>

        <form onSubmit={(e) => void handleSearchAddress(e, true)} className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Paste Google Maps link (maps.app.goo.gl/...), address, PIN code, or lat, lng..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={searchingLocation || searchQuery.trim().length < 2}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Radio className="w-3.5 h-3.5" />
            {searchingLocation ? 'Syncing...' : 'Update & Make Live'}
          </button>
          <button
            type="button"
            onClick={() => setPickLocationMode((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border cursor-pointer whitespace-nowrap transition-colors ${
              pickLocationMode
                ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            {pickLocationMode ? 'Cancel Pin Drop' : 'Pin on Map'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPickLocationMode(false);
              setSearchResults([]);
              setSearchMessage(null);
              onRequestGps();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {telemetry.locationSource === 'manual' ? 'Use Live GPS' : 'Refresh GPS'}
          </button>
        </form>

        {searchResults.length > 0 && (
          <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-slate-50">
            {searchResults.map((res) => (
              <li key={res.placeId}>
                <button
                  type="button"
                  onClick={() => {
                    void onSetManualLocation(res.latitude, res.longitude, res.formattedAddress, true);
                    setSearchResults([]);
                    setPickLocationMode(false);
                    setSearchMessage(`Location updated to ${res.formattedAddress} and live broadcast is active.`);
                  }}
                  className="w-full text-left px-3.5 py-2.5 text-xs hover:bg-white transition-colors flex items-center justify-between gap-3 cursor-pointer"
                >
                  <span className="font-medium text-slate-900">{res.formattedAddress}</span>
                  <span className="font-mono-tabular text-[11px] text-slate-500 whitespace-nowrap">
                    {res.latitude.toFixed(4)}, {res.longitude.toFixed(4)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {searchMessage && (
          <div className="text-xs text-emerald-800 font-medium">{searchMessage}</div>
        )}
      </div>

      {/* Active Live Sharing Bar */}
      {activeSession?.isActive && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
              <span>
                {receivingCloudLiveStream
                  ? 'Receiving Real-Time Live Stream from Your Signed-In Device'
                  : 'Real-Time Live Location Broadcast Active'}
              </span>
            </div>
            <div className="text-xs font-mono-tabular text-emerald-900 truncate max-w-xl">
              {liveUrl}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-950 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-md cursor-pointer whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Live Link'}
            </button>
            {displayLat !== null && displayLng !== null && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${displayLat},${displayLng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in Google Maps
              </a>
            )}
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button
                type="button"
                onClick={handleNativeShare}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md cursor-pointer whitespace-nowrap"
              >
                <Share2 className="w-3.5 h-3.5" />
                Share Link
              </button>
            )}
            {primaryContact && (
              <a
                href={buildSmsHref(
                  primaryContact.mobileNumber,
                  `RiderGuard Live Location from ${riderName}: ${liveUrl}`
                )}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
              >
                Text {primaryContact.name}
              </a>
            )}
          </div>
        </div>
      )}

      {/* GPS Telemetry Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Live Status</div>
          <div className="mt-1">
            <StatusText status={activeSession?.isActive ? 'ACTIVE' : telemetry.locationPermission} />
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Latitude</div>
          <div className="font-mono-tabular text-sm font-semibold text-slate-900 mt-1">
            {displayLat !== null ? `${displayLat.toFixed(6)}°` : '—'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Longitude</div>
          <div className="font-mono-tabular text-sm font-semibold text-slate-900 mt-1">
            {displayLng !== null ? `${displayLng.toFixed(6)}°` : '—'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Speed / Accuracy</div>
          <div className="font-mono-tabular text-sm font-semibold text-slate-900 mt-1">
            {displaySpeed !== null ? `${displaySpeed} km/h` : '—'} ·{' '}
            {displayAccuracy !== null ? `±${displayAccuracy}m` : '—'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 col-span-2 lg:col-span-1">
          <div className="text-xs text-slate-500">Last Live Sync</div>
          <div className="font-mono-tabular text-xs font-medium text-slate-900 mt-1">
            {formatTimestamp(displayLastSync)}
          </div>
        </div>
      </div>

      {/* Interactive Map + Nearby Hospitals Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-900">Interactive Rider & Hospital Map</span>
            <span className="text-slate-500 truncate max-w-md" title={displayAddress}>
              {displayAddress}
            </span>
          </div>

          <LiveMap
            latitude={displayLat}
            longitude={displayLng}
            accuracyMeters={displayAccuracy}
            trail={telemetry.locationHistory}
            hospitals={hospitals}
            selectedHospitalId={selectedHospitalId}
            onSelectHospital={(h) => setSelectedHospitalId(h.id)}
            riderLabel={riderName}
            isEmergency={Boolean(activeSession?.accidentId)}
            heightClass="h-[460px]"
            pickLocationMode={pickLocationMode}
            onPickLocation={(lat, lng) => void handlePickOnMap(lat, lng)}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-1">
            <span>
              Coordinates:{' '}
              <strong className="font-mono-tabular text-slate-900">
                {formatCoords(displayLat, displayLng)}
              </strong>
            </span>
            <span>Map &amp; nearby hospitals powered by Google Maps Platform</span>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Nearby Hospitals ({hospitals.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Sorted by real GPS distance · Nearest highlighted first
              </p>
            </div>
            <button
              type="button"
              disabled={hospitalsLoading || (!telemetry.gpsEnabled && !receivingCloudLiveStream)}
              onClick={onRefreshHospitals}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${hospitalsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {hospitalsError && (
            <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-900">
              {hospitalsError}
            </div>
          )}

          {!telemetry.gpsEnabled && !receivingCloudLiveStream ? (
            <div className="p-8 text-center space-y-3">
              <Hospital className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs text-slate-600">
                Enable GPS location permission to automatically discover nearby emergency hospitals and compute exact distances.
              </p>
              <button
                type="button"
                onClick={onRequestGps}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                Enable GPS Location
              </button>
            </div>
          ) : hospitalsLoading && hospitals.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Searching nearby hospitals around your GPS position...
            </div>
          ) : hospitals.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No hospitals returned within 10 km. Try refreshing or ask an administrator to add regional trauma centers.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[470px] overflow-y-auto">
              {hospitals.map((hospital, idx) => {
                const isNearest = idx === 0;
                const isSelected = hospital.id === selectedHospitalId;
                return (
                  <li
                    key={hospital.id}
                    className={`p-4 transition-colors ${
                      isSelected
                        ? 'bg-slate-100'
                        : isNearest
                          ? 'bg-emerald-50/60'
                          : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedHospitalId(hospital.id)}
                        className="text-left min-w-0 flex-1 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {hospital.name}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {isNearest ? 'Nearest Available Hospital · ' : ''}
                          {hospital.traumaLevel}
                          {hospital.source === 'verified' ? ' · Admin Verified' : ''}
                        </div>
                        <p className="text-xs text-slate-600 mt-1">{hospital.address}</p>
                        {hospital.phone && (
                          <p className="text-xs font-mono-tabular text-slate-700 mt-1">
                            Phone: {hospital.phone}
                          </p>
                        )}
                      </button>
                      <div className="font-mono-tabular text-xs font-bold text-emerald-700 whitespace-nowrap">
                        {hospital.distanceKm.toFixed(2)} km
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <a
                        href={buildHospitalNavigationUrl(
                          hospital.latitude,
                          hospital.longitude,
                          displayLat,
                          displayLng,
                          hospital.googleMapsUri
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md whitespace-nowrap"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        Navigate
                      </a>
                      {hospital.phone && (
                        <a
                          href={buildTelHref(hospital.phone)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          Call Hospital
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedHospitalId(hospital.id)}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        Show on Map
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {nearestHospital && (
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
              Closest trauma route: <strong className="text-slate-900">{nearestHospital.name}</strong> (
              <span className="font-mono-tabular">{nearestHospital.distanceKm.toFixed(2)} km</span>)
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
