import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Load Firebase project metadata from firebase-applet-config.json
let firebaseApiKey = '';
let firebaseProjectId = '';
let firestoreDatabaseId = '(default)';
try {
  const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    if (typeof parsed.apiKey === 'string') firebaseApiKey = parsed.apiKey;
    if (typeof parsed.projectId === 'string') firebaseProjectId = parsed.projectId;
    if (typeof parsed.firestoreDatabaseId === 'string' && parsed.firestoreDatabaseId) {
      firestoreDatabaseId = parsed.firestoreDatabaseId;
    }
  }
} catch {
  firebaseApiKey = '';
}

function getGoogleMapsApiKey(): string {
  return (process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
}

function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

interface Esp32Heartbeat {
  lastSeenMs: number;
  lastSeenIso: string;
  pollCount: number;
  rssi: number | null;
  firmwareVersion: string;
}

const esp32HeartbeatMap = new Map<string, Esp32Heartbeat>();

function recordEsp32Heartbeat(token: string, rssiRaw?: string, fwRaw?: string): void {
  const prev = esp32HeartbeatMap.get(token);
  const now = Date.now();
  const parsedRssi = rssiRaw !== undefined && rssiRaw !== '' ? Number(rssiRaw) : NaN;
  const rssi = Number.isFinite(parsedRssi) && parsedRssi >= -120 && parsedRssi <= 0 ? parsedRssi : (prev?.rssi ?? null);
  const firmwareVersion = typeof fwRaw === 'string' && fwRaw.trim() ? fwRaw.trim().slice(0, 40) : (prev?.firmwareVersion || '');

  // Cap map size to avoid unbounded memory growth
  if (!prev && esp32HeartbeatMap.size > 1000) {
    const oldestKey = esp32HeartbeatMap.keys().next().value;
    if (oldestKey) esp32HeartbeatMap.delete(oldestKey);
  }

  esp32HeartbeatMap.set(token, {
    lastSeenMs: now,
    lastSeenIso: new Date(now).toISOString(),
    pollCount: (prev?.pollCount || 0) + 1,
    rssi,
    firmwareVersion,
  });
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email?: string } | null> {
  if (!firebaseApiKey || !idToken || idToken.length > 4096) {
    return null;
  }
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return { uid: user.localId, email: user.email };
  } catch {
    return null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // 1. Health, SMS Gateway & Google Maps Configuration Status
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      smsGatewayConfigured: isTwilioConfigured(),
      googleMapsConfigured: Boolean(getGoogleMapsApiKey()),
      serverTimeIso: new Date().toISOString(),
    });
  });

  // 1b. Runtime Google Maps JavaScript SDK Bootstrap Key (read from environment secrets)
  app.get('/api/maps/config', (_req: Request, res: Response) => {
    const apiKey = getGoogleMapsApiKey();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      configured: Boolean(apiKey),
      apiKey,
    });
  });

  // 2. Nearby Hospitals via Google Maps Platform Places API (New) — places:searchNearby
  // Reference: https://developers.google.com/maps/documentation/places/web-service/nearby-search?utm_campaign=gmp_mcp_codeassist_v1_aistudio
  app.get('/api/hospitals/nearby', async (req: Request, res: Response) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusRaw = Number(req.query.radius || 10000);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      res.status(400).json({ error: 'Valid numeric lat and lng query parameters are required.' });
      return;
    }

    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      res.status(503).json({
        hospitals: [],
        error: 'Google Maps API key is not configured yet. Restart or check API key configuration.',
      });
      return;
    }

    const radius = Math.min(Math.max(Number.isFinite(radiusRaw) ? radiusRaw : 10000, 1000), 50000);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 11000);
      const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.internationalPhoneNumber,places.primaryType,places.types,places.googleMapsUri',
          'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        },
        body: JSON.stringify({
          includedTypes: ['hospital'],
          maxResultCount: 15,
          rankPreference: 'DISTANCE',
          languageCode: 'en',
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius,
            },
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await response.json()) as {
        places?: Array<{
          id?: string;
          displayName?: { text?: string };
          formattedAddress?: string;
          location?: { latitude?: number; longitude?: number };
          nationalPhoneNumber?: string;
          internationalPhoneNumber?: string;
          primaryType?: string;
          types?: string[];
          googleMapsUri?: string;
        }>;
        error?: { code?: number; status?: string; message?: string };
      };

      if (response.status === 429 || data.error?.status === 'RESOURCE_EXHAUSTED') {
        res.status(429).json({
          hospitals: [],
          quotaExceeded: true,
          error: 'Google Maps Platform quota reached for nearby hospital search.',
        });
        return;
      }

      if (!response.ok) {
        res.status(502).json({
          hospitals: [],
          error: data.error?.message || `Unable to search nearby hospitals (HTTP ${response.status}).`,
        });
        return;
      }

      const hospitals = (data.places || [])
        .map((place) => {
          const hLat = place.location?.latitude;
          const hLng = place.location?.longitude;
          const name = place.displayName?.text || '';
          if (!place.id || !name || typeof hLat !== 'number' || typeof hLng !== 'number') {
            return null;
          }
          const types = place.types || [];
          const isEmergency =
            types.includes('emergency_room') ||
            name.toLowerCase().includes('emergency') ||
            name.toLowerCase().includes('trauma');

          return {
            id: `gmp_${place.id}`,
            name,
            address: place.formattedAddress || `${hLat.toFixed(4)}, ${hLng.toFixed(4)}`,
            phone: place.internationalPhoneNumber || place.nationalPhoneNumber || '',
            latitude: hLat,
            longitude: hLng,
            distanceKm: haversineKm(lat, lng, hLat, hLng),
            emergency24x7: isEmergency,
            traumaLevel: isEmergency ? 'Emergency & Trauma Care' : 'Hospital',
            source: 'google_places' as const,
            googleMapsUri: place.googleMapsUri || '',
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 15);

      res.json({ hospitals, source: 'google_places' });
    } catch {
      res.status(503).json({
        hospitals: [],
        error: 'Unable to reach Google Places nearby hospital service. Check network connectivity.',
      });
    }
  });

  // 3. Reverse Geocoding via Google Maps Platform Geocoding REST API (server-side proxy avoids CORS & legacy JS Geocoder)
  // Reference: https://developers.google.com/maps/documentation/geocoding/requests-reverse-geocoding?utm_campaign=gmp_mcp_codeassist_v1_aistudio
  app.get('/api/geocode/reverse', async (req: Request, res: Response) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      res.status(400).json({ error: 'Valid numeric lat and lng are required.' });
      return;
    }

    const fallbackAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      res.json({ address: fallbackAddress });
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(
        `${lat},${lng}`
      )}&language=en&key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await resp.json()) as {
        status?: string;
        results?: Array<{ formatted_address?: string }>;
      };

      if (resp.status === 429 || data.status === 'OVER_QUERY_LIMIT') {
        res.status(429).json({
          address: fallbackAddress,
          quotaExceeded: true,
        });
        return;
      }

      const formatted = data.results?.[0]?.formatted_address;
      res.json({ address: formatted || fallbackAddress });
    } catch {
      res.json({ address: fallbackAddress });
    }
  });

  // Helper: Strictly allowlisted Google Maps hostname validation (prevents SSRF)
  function isAllowedGoogleMapsHost(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return (
      h === 'maps.app.goo.gl' ||
      h === 'goo.gl' ||
      h === 'maps.google.com' ||
      h === 'www.google.com' ||
      h === 'google.com' ||
      /^maps\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h) ||
      /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h)
    );
  }

  function extractCoordsFromGoogleMapsUrl(urlStr: string): { lat: number; lng: number } | null {
    // 1. Exact pin coordinates (!3d<lat>!4d<lng>) — most accurate for place/pin share links
    const pinMatches = [...urlStr.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
    if (pinMatches.length > 0) {
      const last = pinMatches[pinMatches.length - 1];
      const lat = Number(last[1]);
      const lng = Number(last[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    // 2. Query parameters (?q=lat,lng or &query=lat,lng or &ll=lat,lng or &center=lat,lng)
    try {
      const parsed = new URL(urlStr);
      for (const param of ['q', 'query', 'll', 'center', 'destination']) {
        const val = parsed.searchParams.get(param);
        if (val) {
          const m = val.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
          if (m) {
            const lat = Number(m[1]);
            const lng = Number(m[2]);
            if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
              return { lat, lng };
            }
          }
        }
      }
    } catch {
      // Fall through to regex parsing
    }

    // 3. /@lat,lng or /search/lat,lng path coordinates
    const pathMatch = urlStr.match(/(?:@|\/search\/)(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (pathMatch) {
      const lat = Number(pathMatch[1]);
      const lng = Number(pathMatch[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    return null;
  }

  async function resolveGoogleMapsShareUrl(rawInput: string): Promise<{
    result?: { placeId: string; formattedAddress: string; latitude: number; longitude: number };
    fallbackQuery?: string;
    error?: string;
    quotaExceeded?: boolean;
    statusCode?: number;
  }> {
    let currentUrl: URL;
    try {
      currentUrl = new URL(rawInput.trim());
    } catch {
      return { error: 'Invalid Google Maps link format.', statusCode: 400 };
    }

    if (currentUrl.protocol !== 'https:' && currentUrl.protocol !== 'http:') {
      return { error: 'Only HTTP/HTTPS Google Maps links are supported.', statusCode: 400 };
    }
    if (!isAllowedGoogleMapsHost(currentUrl.hostname)) {
      return {
        error: 'Please paste an official Google Maps link (maps.app.goo.gl or google.com/maps).',
        statusCode: 400,
      };
    }

    let finalUrl = currentUrl.toString();
    // Safely follow up to 5 redirects strictly within allowlisted Google Maps hosts
    for (let hop = 0; hop < 5; hop++) {
      const immediateCoords = extractCoordsFromGoogleMapsUrl(finalUrl);
      if (immediateCoords) break;

      const host = new URL(finalUrl).hostname.toLowerCase();
      if (host !== 'maps.app.goo.gl' && host !== 'goo.gl' && hop > 0) {
        break;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        const resp = await fetch(finalUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RiderGuard/1.0)' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const locationHeader = resp.headers.get('location');
        if (resp.status >= 300 && resp.status < 400 && locationHeader) {
          const nextUrl = new URL(locationHeader, finalUrl);
          if (!isAllowedGoogleMapsHost(nextUrl.hostname)) {
            break;
          }
          finalUrl = nextUrl.toString();
          continue;
        }
        break;
      } catch {
        break;
      }
    }

    const coords = extractCoordsFromGoogleMapsUrl(finalUrl);
    const apiKey = getGoogleMapsApiKey();

    if (coords) {
      let formattedAddress = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
      if (apiKey) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 7000);
          const geoResp = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(
              `${coords.lat},${coords.lng}`
            )}&language=en&key=${encodeURIComponent(apiKey)}`,
            { headers: { Accept: 'application/json' }, signal: controller.signal }
          );
          clearTimeout(timeout);
          const geoData = (await geoResp.json()) as {
            status?: string;
            results?: Array<{ formatted_address?: string; place_id?: string }>;
          };
          if (geoResp.status === 429 || geoData.status === 'OVER_QUERY_LIMIT') {
            return {
              result: {
                placeId: `glink_${coords.lat.toFixed(5)}_${coords.lng.toFixed(5)}`,
                formattedAddress,
                latitude: coords.lat,
                longitude: coords.lng,
              },
              quotaExceeded: true,
            };
          }
          if (geoData.results?.[0]?.formatted_address) {
            formattedAddress = geoData.results[0].formatted_address;
          }
        } catch {
          // Keep coordinate label if reverse geocode fails
        }
      }
      return {
        result: {
          placeId: `glink_${coords.lat.toFixed(5)}_${coords.lng.toFixed(5)}`,
          formattedAddress,
          latitude: coords.lat,
          longitude: coords.lng,
        },
      };
    }

    // Fallback: extract place name from /maps/place/<PlaceName> or ?q=<text>
    try {
      const parsed = new URL(finalUrl);
      const qParam = parsed.searchParams.get('q') || parsed.searchParams.get('query');
      if (qParam && qParam.trim().length >= 2) {
        return { fallbackQuery: qParam.trim() };
      }
      const placeMatch = parsed.pathname.match(/\/maps\/place\/([^/]+)/);
      if (placeMatch?.[1]) {
        return { fallbackQuery: decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')) };
      }
    } catch {
      // ignore
    }

    return {
      error:
        'Could not extract coordinates from that Google Maps link. Copy a shared pin link (maps.app.goo.gl/...) or paste coordinates like 22.5726, 88.3639.',
      statusCode: 422,
    };
  }

  // 3b. Forward Geocoding / Address & Google Maps Link Search via Google Maps Platform Geocoding REST API
  // Reference: https://developers.google.com/maps/documentation/geocoding/requests-geocoding?utm_campaign=gmp_mcp_codeassist_v1_aistudio
  app.get('/api/geocode/search', async (req: Request, res: Response) => {
    let q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 500) : '';
    if (!q || q.length < 2) {
      res.status(400).json({ error: 'Enter a Google Maps link, address, landmark, PIN code, or coordinates.' });
      return;
    }

    // Support pasting full Google Maps share links directly (e.g. https://maps.app.goo.gl/... or https://www.google.com/maps/...)
    const urlInTextMatch = q.match(/https?:\/\/[^\s]+/i);
    if (urlInTextMatch) {
      const resolved = await resolveGoogleMapsShareUrl(urlInTextMatch[0]);
      if (resolved.result) {
        res.json({
          results: [resolved.result],
          source: 'google_maps_link',
          quotaExceeded: Boolean(resolved.quotaExceeded),
        });
        return;
      }
      if (resolved.fallbackQuery) {
        q = resolved.fallbackQuery;
      } else {
        res.status(resolved.statusCode || 400).json({
          results: [],
          error: resolved.error || 'Could not resolve Google Maps link.',
        });
        return;
      }
    }

    // Direct coordinate entry support (e.g. "22.5726, 88.3639")
    const coordMatch = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordMatch) {
      const lat = Number(coordMatch[1]);
      const lng = Number(coordMatch[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        res.json({
          results: [
            {
              placeId: `coord_${lat.toFixed(5)}_${lng.toFixed(5)}`,
              formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              latitude: lat,
              longitude: lng,
            },
          ],
        });
        return;
      }
    }

    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      res.status(503).json({
        results: [],
        error: 'Google Maps API key is not configured for address search.',
      });
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        q
      )}&language=en&key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await resp.json()) as {
        status?: string;
        error_message?: string;
        results?: Array<{
          place_id?: string;
          formatted_address?: string;
          geometry?: { location?: { lat?: number; lng?: number } };
        }>;
      };

      if (resp.status === 429 || data.status === 'OVER_QUERY_LIMIT') {
        res.status(429).json({
          results: [],
          quotaExceeded: true,
          error: 'Google Maps Geocoding quota reached.',
        });
        return;
      }

      if (data.status === 'ZERO_RESULTS') {
        res.json({ results: [] });
        return;
      }

      if (!resp.ok || (data.status && data.status !== 'OK')) {
        res.status(502).json({
          results: [],
          error: data.error_message || `Location lookup failed (${data.status || resp.status}).`,
        });
        return;
      }

      const results = (data.results || [])
        .slice(0, 5)
        .map((item, idx) => {
          const lat = item.geometry?.location?.lat;
          const lng = item.geometry?.location?.lng;
          if (typeof lat !== 'number' || typeof lng !== 'number') return null;
          return {
            placeId: item.place_id || `geo_${idx}`,
            formattedAddress: item.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            latitude: lat,
            longitude: lng,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      res.json({ results });
    } catch {
      res.status(503).json({
        results: [],
        error: 'Unable to reach Google Maps Geocoding service right now.',
      });
    }
  });

  // 4. Authenticated Emergency SMS Dispatch (Real Twilio when configured; honest Device Handoff otherwise)
  app.post('/api/emergency/dispatch-sms', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const verifiedUser = await verifyFirebaseIdToken(token);
    if (!verifiedUser) {
      res.status(401).json({ error: 'Authentication required to dispatch emergency SMS.' });
      return;
    }

    const body = req.body as {
      contacts?: Array<{ id?: string; name?: string; mobileNumber?: string }>;
      message?: string;
    };

    if (!Array.isArray(body.contacts) || body.contacts.length === 0 || body.contacts.length > 15) {
      res.status(400).json({ error: 'Provide between 1 and 15 emergency contacts.' });
      return;
    }

    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 600) : '';
    if (!message) {
      res.status(400).json({ error: 'Emergency message body is required.' });
      return;
    }

    const sanitizedContacts = body.contacts
      .filter((c) => c && typeof c.mobileNumber === 'string' && c.mobileNumber.trim().length >= 5)
      .map((c) => ({
        id: String(c.id || '').slice(0, 128),
        name: String(c.name || 'Emergency Contact').slice(0, 120),
        mobileNumber: String(c.mobileNumber || '').replace(/[^\d+\-\s()]/g, '').slice(0, 24),
      }));

    if (!isTwilioConfigured()) {
      res.json({
        gatewayConfigured: false,
        results: sanitizedContacts.map((c) => ({
          contactId: c.id,
          contactName: c.name,
          contactPhone: c.mobileNumber,
          alertStatus: 'SENT',
          smsDeliveryStatus: 'DEVICE_HANDOFF',
          providerNote:
            'Alert recorded in cloud system. Carrier SMS gateway is not configured on this server; tap Send SMS on device to transmit via mobile network.',
        })),
      });
      return;
    }

    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;
    const fromNumber = process.env.TWILIO_FROM_NUMBER!;
    const basicAuth = Buffer.from(`${sid}:${authToken}`).toString('base64');

    const results = await Promise.all(
      sanitizedContacts.map(async (c) => {
        try {
          const params = new URLSearchParams({
            To: c.mobileNumber,
            From: fromNumber,
            Body: message,
          });
          const resp = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
            {
              method: 'POST',
              headers: {
                Authorization: `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params.toString(),
            }
          );
          const payload = (await resp.json()) as { sid?: string; status?: string; message?: string };
          if (resp.ok && payload.sid) {
            const carrierStatus =
              payload.status === 'delivered'
                ? 'DELIVERED'
                : payload.status === 'sent'
                  ? 'SENT'
                  : 'QUEUED';
            return {
              contactId: c.id,
              contactName: c.name,
              contactPhone: c.mobileNumber,
              alertStatus: 'SENT',
              smsDeliveryStatus: carrierStatus,
              providerNote: `Carrier accepted (SID: ${payload.sid}, status: ${payload.status || 'queued'}).`,
            };
          }
          return {
            contactId: c.id,
            contactName: c.name,
            contactPhone: c.mobileNumber,
            alertStatus: 'SENT',
            smsDeliveryStatus: 'FAILED',
            providerNote: `Carrier rejected SMS: ${payload.message || resp.statusText}`,
          };
        } catch (err) {
          return {
            contactId: c.id,
            contactName: c.name,
            contactPhone: c.mobileNumber,
            alertStatus: 'SENT',
            smsDeliveryStatus: 'FAILED',
            providerNote: `Carrier request failed: ${err instanceof Error ? err.message : 'Network error'}`,
          };
        }
      })
    );

    res.json({ gatewayConfigured: true, results });
  });

  // 5. ESP32 Wi-Fi HTTPS Number Polling Endpoint (Authenticated by 28+ char Device Sync Token)
  app.get('/api/esp32/numbers', async (req: Request, res: Response) => {
    const headerToken = typeof req.headers['x-device-token'] === 'string' ? req.headers['x-device-token'] : '';
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const token = (headerToken || queryToken).trim();

    if (!/^[a-zA-Z0-9_\-]{28,128}$/.test(token)) {
      res.status(401).json({
        error: 'Valid ESP32 device sync token is required via X-Device-Token header or token query parameter.',
      });
      return;
    }

    if (!firebaseProjectId) {
      res.status(503).json({ error: 'Firebase project configuration is not available.' });
      return;
    }

    try {
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        firebaseProjectId
      )}/databases/${encodeURIComponent(
        firestoreDatabaseId
      )}/documents/esp32SyncConfigs/${encodeURIComponent(token)}`;

      const resp = await fetch(firestoreUrl, {
        headers: { Accept: 'application/json' },
      });

      if (resp.status === 404 || resp.status === 403) {
        res.status(404).json({
          error: 'Device token not found or revoked. Copy the latest token from RiderGuard ESP32 Manager.',
        });
        return;
      }

      if (!resp.ok) {
        res.status(502).json({ error: `Failed to read ESP32 config (HTTP ${resp.status}).` });
        return;
      }

      const docJson = (await resp.json()) as {
        fields?: Record<
          string,
          { stringValue?: string; integerValue?: string; doubleValue?: number; timestampValue?: string }
        >;
      };

      const fields = docJson.fields || {};
      const str = (k: string) => fields[k]?.stringValue || '';
      const num = (k: string) =>
        Number(fields[k]?.integerValue ?? fields[k]?.doubleValue ?? 1);

      const isBrowserTest = String(req.query.test || '') === '1';
      if (!isBrowserTest) {
        recordEsp32Heartbeat(
          token,
          typeof req.query.rssi === 'string' ? req.query.rssi : undefined,
          typeof req.query.fw === 'string' ? req.query.fw : undefined
        );
      }

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        deviceName: str('deviceName'),
        primaryNumber: str('primaryNumber'),
        secondaryNumber: str('secondaryNumber'),
        tertiaryNumber: str('tertiaryNumber'),
        configVersion: num('configVersion'),
        updatedAt: fields.updatedAt?.timestampValue || new Date().toISOString(),
      });
    } catch {
      res.status(502).json({ error: 'Unable to reach cloud config store.' });
    }
  });

  // 5b. ESP32 Wi-Fi Live Heartbeat Endpoint
  app.post('/api/esp32/heartbeat', (req: Request, res: Response) => {
    const headerToken = typeof req.headers['x-device-token'] === 'string' ? req.headers['x-device-token'] : '';
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const body = (req.body || {}) as { token?: string; rssi?: number | string; fw?: string };
    const token = (headerToken || queryToken || (typeof body.token === 'string' ? body.token : '')).trim();

    if (!/^[a-zA-Z0-9_\-]{28,128}$/.test(token)) {
      res.status(401).json({ error: 'Valid ESP32 device sync token required.' });
      return;
    }

    recordEsp32Heartbeat(
      token,
      body.rssi !== undefined ? String(body.rssi) : undefined,
      typeof body.fw === 'string' ? body.fw : undefined
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, serverTimeIso: new Date().toISOString() });
  });

  // 5c. Authenticated ESP32 Live Wi-Fi Status Lookup for Website UI
  app.get('/api/esp32/status', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const verifiedUser = await verifyFirebaseIdToken(idToken);
    if (!verifiedUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!/^[a-zA-Z0-9_\-]{28,128}$/.test(token)) {
      res.status(400).json({ error: 'Invalid device sync token.' });
      return;
    }

    const hb = esp32HeartbeatMap.get(token);
    if (!hb) {
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        online: false,
        lastSeenIso: null,
        secondsAgo: null,
        pollCount: 0,
        rssi: null,
        firmwareVersion: '',
      });
      return;
    }

    const secondsAgo = Math.max(0, Math.floor((Date.now() - hb.lastSeenMs) / 1000));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      online: secondsAgo <= 150,
      lastSeenIso: hb.lastSeenIso,
      secondsAgo,
      pollCount: hb.pollCount,
      rssi: hb.rssi,
      firmwareVersion: hb.firmwareVersion,
    });
  });

  const httpServer = http.createServer(app);

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`RiderGuard server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
