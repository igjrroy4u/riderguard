import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Circle,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  Polyline,
  useAdvancedMarkerRef,
  useMap,
} from '@vis.gl/react-google-maps';
import { buildHospitalNavigationUrl } from '../lib/geo';
import type { HospitalItem } from '../types';

interface LiveMapProps {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters?: number | null;
  trail?: Array<[number, number]>;
  hospitals?: HospitalItem[];
  selectedHospitalId?: string | null;
  onSelectHospital?: (hospital: HospitalItem) => void;
  riderLabel?: string;
  isEmergency?: boolean;
  heightClass?: string;
  pickLocationMode?: boolean;
  onPickLocation?: (lat: number, lng: number) => void;
}

type LatLngLiteral = { lat: number; lng: number };

const DEFAULT_CENTER: LatLngLiteral = { lat: 20.5937, lng: 78.9629 };

// Cache runtime API key bootstrap fetch so multiple maps share one request
let cachedMapsKeyPromise: Promise<string> | null = null;

function resolveGoogleMapsApiKey(): Promise<string> {
  const buildTimeKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  if (buildTimeKey) {
    return Promise.resolve(buildTimeKey);
  }
  if (!cachedMapsKeyPromise) {
    cachedMapsKeyPromise = fetch('/api/maps/config')
      .then((res) => (res.ok ? res.json() : { apiKey: '' }))
      .then((data: { apiKey?: string }) => (typeof data.apiKey === 'string' ? data.apiKey.trim() : ''))
      .catch(() => '');
  }
  return cachedMapsKeyPromise;
}

interface RiderMarkerProps {
  position: LatLngLiteral;
  label: string;
  isEmergency: boolean;
  draggable?: boolean;
  onDragEnd?: (lat: number, lng: number) => void;
}

const RiderAdvancedMarker: React.FC<RiderMarkerProps> = ({
  position,
  label,
  isEmergency,
  draggable = false,
  onDragEnd,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        title={draggable ? `${label} (Drag to adjust exact position)` : label}
        zIndex={1000}
        draggable={draggable}
        onClick={() => setOpen((prev) => !prev)}
        onDragEnd={(e) => {
          const lat = e.latLng?.lat();
          const lng = e.latLng?.lng();
          if (typeof lat === 'number' && typeof lng === 'number') {
            onDragEnd?.(lat, lng);
          }
        }}
      >
        <div
          className={`w-5 h-5 rounded-full border-[3px] border-white shadow-md ${
            draggable ? 'cursor-grab active:cursor-grabbing' : ''
          } ${isEmergency ? 'bg-red-600' : 'bg-slate-900'}`}
        />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} maxWidth={230} onCloseClick={() => setOpen(false)}>
          <div className="text-xs leading-relaxed text-slate-800 pr-1">
            <div className="font-semibold text-slate-900">{label}</div>
            <div className="font-mono-tabular text-slate-600 mt-0.5">
              {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            </div>
            {draggable && (
              <div className="text-[11px] text-slate-500 mt-1">
                Tip: Drag this marker to fine-tune your exact spot.
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface HospitalMarkerProps {
  hospital: HospitalItem;
  isNearest: boolean;
  isSelected: boolean;
  originLat: number | null;
  originLng: number | null;
  onSelect?: (hospital: HospitalItem) => void;
  onClearSelection?: () => void;
}

const HospitalAdvancedMarker: React.FC<HospitalMarkerProps> = ({
  hospital,
  isNearest,
  isSelected,
  originLat,
  originLng,
  onSelect,
  onClearSelection,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [localOpen, setLocalOpen] = useState(false);
  const showInfo = isSelected || localOpen;

  const background = isSelected ? '#dc2626' : isNearest ? '#16a34a' : '#2563eb';
  const borderColor = isSelected ? '#991b1b' : isNearest ? '#166534' : '#1d4ed8';

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: hospital.latitude, lng: hospital.longitude }}
        title={hospital.name}
        zIndex={isSelected ? 900 : isNearest ? 800 : 500}
        onClick={() => {
          setLocalOpen(true);
          onSelect?.(hospital);
        }}
      >
        <Pin
          background={background}
          borderColor={borderColor}
          glyphColor="#ffffff"
          glyphText="H"
          scale={isSelected || isNearest ? 1.1 : 0.95}
        />
      </AdvancedMarker>

      {showInfo && marker && (
        <InfoWindow
          anchor={marker}
          maxWidth={250}
          onCloseClick={() => {
            setLocalOpen(false);
            if (isSelected) {
              onClearSelection?.();
            }
          }}
        >
          <div className="text-xs leading-relaxed text-slate-700 space-y-1 pr-1">
            <div className="font-semibold text-slate-900">
              {hospital.name}
              {isNearest ? ' (Nearest)' : ''}
            </div>
            <div className="text-slate-600">{hospital.address}</div>
            <div className="font-mono-tabular font-semibold text-emerald-700">
              {hospital.distanceKm.toFixed(2)} km away
            </div>
            {hospital.phone && (
              <div className="font-mono-tabular text-slate-700">Tel: {hospital.phone}</div>
            )}
            <div className="pt-1">
              <a
                href={buildHospitalNavigationUrl(
                  hospital.latitude,
                  hospital.longitude,
                  originLat,
                  originLng,
                  hospital.googleMapsUri
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block font-semibold text-blue-700 hover:underline"
              >
                Open Directions in Google Maps
              </a>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface MapCameraControllerProps {
  latitude: number | null;
  longitude: number | null;
  selectedHospital: HospitalItem | null;
  recenterSignal: number;
}

const MapCameraController: React.FC<MapCameraControllerProps> = ({
  latitude,
  longitude,
  selectedHospital,
  recenterSignal,
}) => {
  const map = useMap();
  const lastCenteredPosRef = useRef<LatLngLiteral | null>(null);

  // Auto-center on first GPS fix AND whenever position refines/moves significantly (> ~220m)
  useEffect(() => {
    if (!map || latitude === null || longitude === null) return;
    const prev = lastCenteredPosRef.current;
    const movedSignificantly =
      !prev ||
      Math.abs(prev.lat - latitude) > 0.002 ||
      Math.abs(prev.lng - longitude) > 0.002;
    if (movedSignificantly) {
      map.panTo({ lat: latitude, lng: longitude });
      const currentZoom = map.getZoom() ?? 4;
      if (currentZoom < 14) {
        map.setZoom(15);
      }
      lastCenteredPosRef.current = { lat: latitude, lng: longitude };
    }
  }, [map, latitude, longitude]);

  // Pan smoothly to a selected hospital
  useEffect(() => {
    if (!map || !selectedHospital) return;
    map.panTo({ lat: selectedHospital.latitude, lng: selectedHospital.longitude });
    const currentZoom = map.getZoom() ?? 14;
    if (currentZoom < 14) {
      map.setZoom(14);
    }
  }, [map, selectedHospital]);

  // Explicit Recenter on Rider button click
  useEffect(() => {
    if (!map || recenterSignal === 0 || latitude === null || longitude === null) return;
    map.panTo({ lat: latitude, lng: longitude });
    map.setZoom(15);
    lastCenteredPosRef.current = { lat: latitude, lng: longitude };
  }, [map, recenterSignal, latitude, longitude]);

  return null;
};

export const LiveMap: React.FC<LiveMapProps> = ({
  latitude,
  longitude,
  accuracyMeters = null,
  trail = [],
  hospitals = [],
  selectedHospitalId = null,
  onSelectHospital,
  riderLabel = 'Rider Location',
  isEmergency = false,
  heightClass = 'h-[420px]',
  pickLocationMode = false,
  onPickLocation,
}) => {
  const [apiKey, setApiKey] = useState<string>(() =>
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  );
  const [keyResolved, setKeyResolved] = useState<boolean>(() =>
    Boolean((import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim())
  );
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [dismissedSelectionId, setDismissedSelectionId] = useState<string | null>(null);

  useEffect(() => {
    if (apiKey) return;
    let mounted = true;
    void resolveGoogleMapsApiKey().then((k) => {
      if (!mounted) return;
      setApiKey(k);
      setKeyResolved(true);
    });
    return () => {
      mounted = false;
    };
  }, [apiKey]);

  // Reset dismissal when parent chooses a different hospital
  useEffect(() => {
    setDismissedSelectionId(null);
  }, [selectedHospitalId]);

  const riderPosition = useMemo<LatLngLiteral | null>(() => {
    if (latitude === null || longitude === null) return null;
    return { lat: latitude, lng: longitude };
  }, [latitude, longitude]);

  const trailPath = useMemo<LatLngLiteral[]>(
    () => trail.map(([lat, lng]) => ({ lat, lng })),
    [trail]
  );

  const selectedHospital = useMemo(
    () => hospitals.find((h) => h.id === selectedHospitalId) || null,
    [hospitals, selectedHospitalId]
  );

  const initialCenter = riderPosition || DEFAULT_CENTER;
  const initialZoom = riderPosition ? 14 : 4;

  return (
    <div
      className={`relative w-full ${heightClass} rounded-lg overflow-hidden border border-slate-200 bg-slate-100`}
    >
      {!keyResolved ? (
        <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
          Loading Google Maps Platform...
        </div>
      ) : !apiKey ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-2">
          <div className="text-sm font-semibold text-slate-900">
            Google Maps API Key Not Available
          </div>
          <p className="text-xs text-slate-600 max-w-md">
            Ensure Google Maps Platform is enabled in your environment configuration and reload the page to display the interactive map.
          </p>
        </div>
      ) : (
        <APIProvider apiKey={apiKey} libraries={['marker']} language="en">
          <GoogleMap
            style={{ width: '100%', height: '100%' }}
            defaultCenter={initialCenter}
            defaultZoom={initialZoom}
            mapId="DEMO_MAP_ID"
            gestureHandling="greedy"
            streetViewControl={false}
            mapTypeControl={true}
            fullscreenControl={true}
            clickableIcons={!pickLocationMode}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            onClick={(e) => {
              if (!pickLocationMode || !onPickLocation) return;
              const latLng = e.detail?.latLng;
              if (latLng && typeof latLng.lat === 'number' && typeof latLng.lng === 'number') {
                onPickLocation(latLng.lat, latLng.lng);
              }
            }}
          >
            <MapCameraController
              latitude={latitude}
              longitude={longitude}
              selectedHospital={selectedHospital}
              recenterSignal={recenterSignal}
            />

            {riderPosition && accuracyMeters && accuracyMeters > 0 && (
              <Circle
                center={riderPosition}
                radius={Math.min(accuracyMeters, 500)}
                strokeColor={isEmergency ? '#dc2626' : '#0284c7'}
                strokeOpacity={0.7}
                strokeWeight={1}
                fillColor={isEmergency ? '#ef4444' : '#38bdf8'}
                fillOpacity={0.14}
              />
            )}

            {trailPath.length >= 2 && (
              <Polyline
                path={trailPath}
                strokeColor={isEmergency ? '#dc2626' : '#0f172a'}
                strokeOpacity={0.8}
                strokeWeight={3}
              />
            )}

            {riderPosition && (
              <RiderAdvancedMarker
                position={riderPosition}
                label={riderLabel}
                isEmergency={isEmergency}
                draggable={Boolean(onPickLocation)}
                onDragEnd={onPickLocation}
              />
            )}

            {hospitals.map((hospital, index) => (
              <HospitalAdvancedMarker
                key={hospital.id}
                hospital={hospital}
                isNearest={index === 0}
                isSelected={
                  hospital.id === selectedHospitalId && hospital.id !== dismissedSelectionId
                }
                originLat={latitude}
                originLng={longitude}
                onSelect={onSelectHospital}
                onClearSelection={() => setDismissedSelectionId(hospital.id)}
              />
            ))}
          </GoogleMap>
        </APIProvider>
      )}

      {pickLocationMode && apiKey && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-md shadow-md whitespace-nowrap pointer-events-none">
          Click anywhere on the map to set your exact location
        </div>
      )}

      {riderPosition && apiKey && (
        <button
          type="button"
          onClick={() => setRecenterSignal((s) => s + 1)}
          className="absolute bottom-3 left-3 z-20 px-3 py-1.5 text-xs font-medium bg-white text-slate-900 border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
        >
          Recenter on Rider
        </button>
      )}
    </div>
  );
};
