
/**
 * PARKTRACE Full-Stack HTTP Server & API (server.mjs)
 *
 * Refactored for Supabase Authentication & Profile Synchronization:
 * - Zero local file/folder data storage (all legacy `data/` JSON files, avatar directories,
 *   and `fs` database I/O helper functions have been completely removed).
 * - Uses `@supabase/supabase-js` configured via `NEXT_PUBLIC_SUPABASE_URL` and
 *   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (loaded from `.env` or environment variables).
 * - Synchronizes user profiles with `public.profiles` (with `auth.users` metadata fallback).
 * - Serves `/vendor/supabase.js` for browser ES module imports alongside static frontend assets.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// 1. Load `.env` Environment Variables (if present)
// ---------------------------------------------------------------------------
function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore .env read errors
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://usraecvkfulgmajqpvpo.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_SMKSc2nwXW7z73F6p6XDYw_NQjBVKEr';

if (
  typeof SUPABASE_URL !== 'string' ||
  SUPABASE_URL.trim().length === 0 ||
  typeof SUPABASE_ANON_KEY !== 'string' ||
  SUPABASE_ANON_KEY.trim().length === 0
) {
  console.warn('Supabase URL or Anon Key is missing from environment variables');
}

const STAFF_EMAILS = new Set(
  (process.env.STAFF_EMAILS || 'parktrace.1341@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

const SESSION_COOKIE_NAME = 'parktrace_sb_token';
const PERSISTENT_MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 days
const ALLOWED_PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// 2. Supabase Client Helpers
// ---------------------------------------------------------------------------
function createSupabaseServerClient(accessToken = null) {
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  if (accessToken) {
    options.global = {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
}

const supabaseAnon = createSupabaseServerClient();

// ---------------------------------------------------------------------------
// 3. In-Memory Operational State for Campus Lots, Sections, Sessions & Reviews
//    (No local file/folder disk I/O)
// ---------------------------------------------------------------------------
const nowIso = () => new Date().toISOString();

const runtimeState = {
  settings: {
    freshnessMinutes: 60,
    staleVehicleHours: 12,
  },
  destinations: [
    'Academic Block A',
    'Academic Block B',
    'Central Library & Research Hub',
    'Engineering & Innovation Wing',
    'Student Activity Center',
    'Administrative & Security Complex',
  ],
  lots: [
    {
      id: 'lot-north-academic',
      name: 'North Academic Lot A',
      nearestDestinations: ['Academic Block A', 'Central Library & Research Hub'],
      description: 'Covered and open bays directly adjacent to Academic Block A North Gate.',
      active: true,
    },
    {
      id: 'lot-east-innovation',
      name: 'East Innovation Lot B',
      nearestDestinations: ['Academic Block B', 'Engineering & Innovation Wing'],
      description: 'Multi-section transit bay serving Engineering labs and Block B lecture halls.',
      active: true,
    },
    {
      id: 'lot-south-commons',
      name: 'South Commons Lot C',
      nearestDestinations: ['Student Activity Center', 'Administrative & Security Complex'],
      description: 'High-capacity perimeter lot with shaded two-wheeler and four-wheeler bays.',
      active: true,
    },
  ],
  sections: [
    {
      id: 'sec-a-bike-1',
      lotId: 'lot-north-academic',
      code: 'PT-SEC-A1',
      name: 'Section A1 — Two-Wheeler Deck',
      vehicleTypes: ['bike'],
      destination: 'Academic Block A',
      walkingMinutes: 2,
      accessRule: 'general',
      accessLabel: 'Students & Staff',
      totalCapacity: 120,
      availableSpots: 34,
      status: 'Available',
      updatedAt: nowIso(),
      updatedBy: 'Campus Attendant Desk',
      rows: ['Row A', 'Row B', 'Row C', 'Row D'],
      landmarkHint: 'Opposite Block A Main Stairwell & Security Kiosk',
    },
    {
      id: 'sec-a-car-2',
      lotId: 'lot-north-academic',
      code: 'PT-SEC-A2',
      name: 'Section A2 — Four-Wheeler Court',
      vehicleTypes: ['car'],
      destination: 'Academic Block A',
      walkingMinutes: 3,
      accessRule: 'general',
      accessLabel: 'Students & Staff',
      totalCapacity: 45,
      availableSpots: 5,
      status: 'Limited',
      updatedAt: nowIso(),
      updatedBy: 'Campus Attendant Desk',
      rows: ['Row 1', 'Row 2', 'Row 3'],
      landmarkHint: 'Near North Gate Solar Canopy',
    },
    {
      id: 'sec-a-accessible-3',
      lotId: 'lot-north-academic',
      code: 'PT-SEC-A3',
      name: 'Section A3 — Accessible & EV Priority Bays',
      vehicleTypes: ['bike', 'car', 'other'],
      destination: 'Central Library & Research Hub',
      walkingMinutes: 1,
      accessRule: 'accessible',
      accessLabel: 'Accessible / EV Priority Permit Required',
      totalCapacity: 20,
      availableSpots: 9,
      status: 'Available',
      updatedAt: nowIso(),
      updatedBy: 'Campus Attendant Desk',
      rows: ['Priority Row P1', 'Priority Row P2'],
      landmarkHint: 'Step-free ramp entrance beside Central Library West Doors',
    },
    {
      id: 'sec-b-bike-1',
      lotId: 'lot-east-innovation',
      code: 'PT-SEC-B1',
      name: 'Section B1 — East Bike & Scooter Bay',
      vehicleTypes: ['bike'],
      destination: 'Engineering & Innovation Wing',
      walkingMinutes: 2,
      accessRule: 'general',
      accessLabel: 'Students & Staff',
      totalCapacity: 150,
      availableSpots: 0,
      status: 'Full',
      updatedAt: nowIso(),
      updatedBy: 'Campus Attendant Desk',
      rows: ['Row E1', 'Row E2', 'Row E3', 'Row E4'],
      landmarkHint: 'Beside Robotics Workshop Entrance',
    },
    {
      id: 'sec-b-car-2',
      lotId: 'lot-east-innovation',
      code: 'PT-SEC-B2',
      name: 'Section B2 — East Car & Utility Section',
      vehicleTypes: ['car', 'other'],
      destination: 'Academic Block B',
      walkingMinutes: 3,
      accessRule: 'general',
      accessLabel: 'Students & Staff',
      totalCapacity: 60,
      availableSpots: 22,
      status: 'Available',
      updatedAt: nowIso(),
      updatedBy: 'Campus Attendant Desk',
      rows: ['Row C1', 'Row C2', 'Row C3'],
      landmarkHint: 'Adjacent to Block B Amphitheater Walkway',
    },
    {
      id: 'sec-c-multi-1',
      lotId: 'lot-south-commons',
      code: 'PT-SEC-C1',
      name: 'Section C1 — South Overflow Two-Wheeler Zone',
      vehicleTypes: ['bike'],
      destination: 'Engineering & Innovation Wing',
      walkingMinutes: 5,
      accessRule: 'general',
      accessLabel: 'Students & Staff',
      totalCapacity: 180,
      availableSpots: 92,
      status: 'Available',
      updatedAt: nowIso(),
      updatedBy: 'Campus Attendant Desk',
      rows: ['Row S1', 'Row S2', 'Row S3', 'Row S4', 'Row S5'],
      landmarkHint: 'Covered walkway linking South Commons to Engineering Wing',
    },
    {
      id: 'sec-c-staff-2',
      lotId: 'lot-south-commons',
      code: 'PT-SEC-C2',
      name: 'Section C2 — Faculty & Staff Reserved Court',
      vehicleTypes: ['bike', 'car', 'other'],
      destination: 'Administrative & Security Complex',
      walkingMinutes: 2,
      accessRule: 'staff_only',
      accessLabel: 'Staff & Faculty Permit Only',
      totalCapacity: 40,
      availableSpots: 14,
      status: 'Available',
      updatedAt: nowIso(),
      updatedBy: 'Campus Attendant Desk',
      rows: ['Staff Row R1', 'Staff Row R2'],
      landmarkHint: 'Behind Administrative Block Security Barrier',
    },
  ],
  parkingSessions: [],
  sessionPhotos: new Map(), // sessionId -> { mimeType, buffer }
  profileCache: new Map(), // userId -> normalized user profile
  sectionReports: [],
  auditLogs: [],
  reviews: [],
};

// ---------------------------------------------------------------------------
// 4. HTTP, Cookie & Auth Verification Utilities
// ---------------------------------------------------------------------------
function parseCookies(cookieHeader = '') {
  const cookies = {};
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  return parts.join('; ');
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function extractAccessToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[SESSION_COOKIE_NAME] || null;
}

function deriveRole(email, profileRole) {
  if (profileRole === 'staff' || profileRole === 'admin') return 'staff';
  const cleanEmail = String(email || '').trim().toLowerCase();
  return STAFF_EMAILS.has(cleanEmail) ? 'staff' : 'member';
}

function normalizeUserRecord(supabaseUser, profileRow = null, persistence = 'persistent') {
  if (!supabaseUser || !supabaseUser.id) return null;
  const meta = supabaseUser.user_metadata || {};
  const email = String(profileRow?.email || supabaseUser.email || '').trim().toLowerCase();
  const fullName =
    String(
      profileRow?.full_name ||
        meta.full_name ||
        meta.fullName ||
        meta.name ||
        email.split('@')[0] ||
        'Campus Member'
    ).trim() || 'Campus Member';

  const role = deriveRole(email, profileRow?.role || meta.role);
  const rawAff =
    profileRow?.campus_affiliation ?? meta.campus_affiliation ?? meta.campusAffiliation ?? null;
  const campusAffiliation = rawAff === 'student' || rawAff === 'staff' ? rawAff : null;

  const avatarUrl =
    profileRow?.avatar_url !== undefined
      ? profileRow.avatar_url
      : meta.avatar_url !== undefined
      ? meta.avatar_url
      : null;

  const hasProfilePhoto = Boolean(avatarUrl && String(avatarUrl).trim().length > 0);

  return {
    id: String(supabaseUser.id),
    fullName,
    email,
    role,
    campusAffiliation,
    hasProfilePhoto,
    profilePhotoUrl: hasProfilePhoto ? String(avatarUrl) : null,
    emailVerified: Boolean(supabaseUser.email_confirmed_at || supabaseUser.confirmed_at || true),
    persistence,
  };
}

/**
 * Resolves the authenticated user via Supabase JWT verification + `public.profiles`.
 */
async function getAuthenticatedUser(req) {
  const token = extractAccessToken(req);
  if (!token) return null;

  try {
    const supabaseClient = createSupabaseServerClient(token);
    const { data, error } = await supabaseClient.auth.getUser(token);
    if (error || !data?.user) {
      return null;
    }

    const sbUser = data.user;
    let profileRow = null;

    try {
      const { data: row, error: rowErr } = await supabaseClient
        .from('profiles')
        .select('id, email, full_name, role, campus_affiliation, avatar_url, updated_at')
        .eq('id', sbUser.id)
        .maybeSingle();

      if (!rowErr && row) {
        profileRow = row;
      } else if (!rowErr && !row) {
        const meta = sbUser.user_metadata || {};
        const email = String(sbUser.email || '').trim().toLowerCase();
        const insertPayload = {
          id: sbUser.id,
          email,
          full_name:
            meta.full_name || meta.fullName || email.split('@')[0] || 'Campus Member',
          role: deriveRole(email, meta.role),
          campus_affiliation: meta.campus_affiliation ?? null,
          avatar_url: meta.avatar_url ?? null,
          updated_at: nowIso(),
        };
        const { data: createdRow } = await supabaseClient
          .from('profiles')
          .upsert(insertPayload, { onConflict: 'id' })
          .select('id, email, full_name, role, campus_affiliation, avatar_url, updated_at')
          .maybeSingle();
        if (createdRow) {
          profileRow = createdRow;
        }
      }
    } catch {
      // Fallback to cached or user_metadata profile if table is not yet migrated
    }

    const cached = runtimeState.profileCache.get(sbUser.id);
    const normalized = normalizeUserRecord(sbUser, profileRow || cached);
    if (normalized) {
      runtimeState.profileCache.set(sbUser.id, {
        email: normalized.email,
        full_name: normalized.fullName,
        role: normalized.role,
        campus_affiliation: normalized.campusAffiliation,
        avatar_url: normalized.profilePhotoUrl,
      });
    }
    return normalized;
  } catch {
    return null;
  }
}

function computeFreshnessState(section, settings) {
  const thresholdMs = (Number(settings?.freshnessMinutes) || 60) * 60 * 1000;
  const updatedMs = section.updatedAt ? Date.parse(section.updatedAt) : 0;
  const ageMs = updatedMs ? Math.max(0, Date.now() - updatedMs) : Infinity;
  const isStale = !updatedMs || ageMs > thresholdMs;

  return {
    ...section,
    isStale,
    ageMinutes: Number.isFinite(ageMs) ? Math.floor(ageMs / 60000) : null,
    effectiveStatus: isStale && section.status !== 'Closed' ? 'Unknown' : section.status,
  };
}

function computeSessionState(session, settings) {
  if (!session) return null;
  const staleHours = Number(settings?.staleVehicleHours) || 12;
  const parkedMs = session.parkedAt ? Date.parse(session.parkedAt) : Date.now();
  const elapsedMs = Math.max(0, Date.now() - parkedMs);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const isLongRunning = elapsedMs > staleHours * 3600 * 1000;

  return {
    id: session.id,
    userId: session.userId,
    lotId: session.lotId,
    lotName: session.lotName,
    sectionId: session.sectionId,
    sectionCode: session.sectionCode,
    sectionName: session.sectionName,
    vehicleType: session.vehicleType,
    rowIdentifier: session.rowIdentifier || '',
    bayIdentifier: session.bayIdentifier || '',
    landmarkNote: session.landmarkNote || '',
    gpsCoords: session.gpsCoords || null,
    hasPhoto: Boolean(runtimeState.sessionPhotos.has(session.id)),
    photoUrl: runtimeState.sessionPhotos.has(session.id)
      ? `/api/sessions/${encodeURIComponent(session.id)}/photo`
      : null,
    parkedAt: session.parkedAt,
    updatedAt: session.updatedAt,
    elapsedMinutes,
    isLongRunning,
    staleThresholdHours: staleHours,
  };
}

// ---------------------------------------------------------------------------
// 5. API Route Handlers
// ---------------------------------------------------------------------------
async function handleApiRequest(req, res, url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  // =========================================================================
  // AUTHENTICATION & SUPABASE SESSION BRIDGE (`/api/auth/*`)
  // =========================================================================
  if (pathname === '/api/auth/session' && method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 200, { user: null });
    }
    return sendJson(res, 200, { user });
  }

  if (pathname === '/api/auth/session' && method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const token = String(body.accessToken || extractAccessToken(req) || '').trim();
    const rememberMe = body.rememberMe !== false;

    if (!token) {
      return sendJson(res, 400, { message: 'Missing Supabase access token.' });
    }

    if (body.profile && body.profile.id) {
      runtimeState.profileCache.set(String(body.profile.id), {
        email: body.profile.email,
        full_name: body.profile.fullName,
        role: body.profile.role,
        campus_affiliation: body.profile.campusAffiliation,
        avatar_url: body.profile.profilePhotoUrl,
      });
    }

    const cookieHeader = serializeCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: rememberMe ? PERSISTENT_MAX_AGE_SEC : undefined,
    });

    const user =
      body.profile && body.profile.id
        ? body.profile
        : await getAuthenticatedUser({
            headers: { authorization: `Bearer ${token}`, cookie: '' },
          });

    return sendJson(
      res,
      200,
      { user },
      {
        'Set-Cookie': cookieHeader,
      }
    );
  }

  if (pathname === '/api/auth/signup' && method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { message: 'Invalid request payload.' });
    }

    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (fullName.length < 2) {
      return sendJson(res, 400, { message: 'Please enter your full name (at least 2 characters).' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { message: 'Please enter a valid email address.' });
    }
    if (password.length < 8) {
      return sendJson(res, 400, { message: 'Password must be at least 8 characters long.' });
    }

    const { data, error } = await supabaseAnon.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          fullName,
          campus_affiliation: null,
        },
      },
    });

    if (error) {
      console.error('Auth error details:', error);
      const status = error.status && error.status >= 400 ? error.status : 400;
      return sendJson(res, status, { message: error.message });
    }

    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return sendJson(res, 409, {
        message: 'An account with this email address already exists. Please log in instead.',
      });
    }

    if (data?.session && data?.user) {
      const sbClient = createSupabaseServerClient(data.session.access_token);
      let profileRow = null;
      try {
        const { data: upserted } = await sbClient
          .from('profiles')
          .upsert(
            {
              id: data.user.id,
              email,
              full_name: fullName,
              role: deriveRole(email),
              campus_affiliation: null,
              avatar_url: null,
              updated_at: nowIso(),
            },
            { onConflict: 'id' }
          )
          .select('id, email, full_name, role, campus_affiliation, avatar_url, updated_at')
          .maybeSingle();
        profileRow = upserted || null;
      } catch {
        // Ignore if table not yet migrated
      }

      const user = normalizeUserRecord(data.user, profileRow, 'persistent');
      const cookieHeader = serializeCookie(SESSION_COOKIE_NAME, data.session.access_token, {
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: PERSISTENT_MAX_AGE_SEC,
      });

      return sendJson(
        res,
        201,
        { user, session: { access_token: data.session.access_token } },
        { 'Set-Cookie': cookieHeader }
      );
    }

    return sendJson(res, 200, {
      requiresVerification: true,
      email,
      message:
        'Your account has been created. Please check your email inbox to confirm your address before logging in.',
    });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { message: 'Invalid request payload.' });
    }

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const rememberMe = Boolean(body.rememberMe);

    if (!email || !password) {
      return sendJson(res, 400, { message: 'Please enter both your email address and password.' });
    }

    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data?.session || !data?.user) {
      console.error('Auth error details:', error);
      const status = error?.status && error.status >= 400 ? error.status : 401;
      return sendJson(res, status, {
        message: error?.message || 'Authentication failed: no active session returned.',
      });
    }

    const user = await getAuthenticatedUser({
      headers: { authorization: `Bearer ${data.session.access_token}`, cookie: '' },
    });

    const cookieHeader = serializeCookie(SESSION_COOKIE_NAME, data.session.access_token, {
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: rememberMe ? PERSISTENT_MAX_AGE_SEC : undefined,
    });

    return sendJson(
      res,
      200,
      {
        user,
        session: { access_token: data.session.access_token },
      },
      { 'Set-Cookie': cookieHeader }
    );
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const clearCookie = serializeCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 0,
    });

    return sendJson(
      res,
      200,
      { ok: true },
      {
        'Set-Cookie': clearCookie,
      }
    );
  }

  if (pathname === '/api/auth/profile' && method === 'PUT') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err?.message === 'Payload too large') {
        return sendJson(res, 413, {
          message: 'Profile photo exceeds the 5 MB size limit. Please choose a smaller image.',
        });
      }
      return sendJson(res, 400, { message: 'Invalid request payload.' });
    }

    const fullName = String(body.fullName || '').trim();
    if (fullName.length < 2 || fullName.length > 80) {
      return sendJson(res, 400, {
        message: 'Display name must be between 2 and 80 characters.',
      });
    }

    let nextAffiliation = user.campusAffiliation ?? null;
    if (body.campusAffiliation !== undefined) {
      const rawAffiliation = String(body.campusAffiliation ?? '').trim().toLowerCase();
      if (rawAffiliation === '') {
        nextAffiliation = null;
      } else if (rawAffiliation === 'student' || rawAffiliation === 'staff') {
        nextAffiliation = rawAffiliation;
      } else {
        return sendJson(res, 400, {
          message: 'Invalid campus affiliation. Please select Student or Staff.',
        });
      }
    }

    let nextAvatarUrl = user.profilePhotoUrl ?? null;
    if (Boolean(body.removeAvatar)) {
      nextAvatarUrl = null;
    } else if (body.avatarDataUrl !== undefined && body.avatarDataUrl !== null && body.avatarDataUrl !== '') {
      const match = String(body.avatarDataUrl).match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/
      );
      if (!match) {
        return sendJson(res, 400, {
          message: 'Invalid image format. Please upload a valid JPEG, PNG, or WebP photo.',
        });
      }
      const mimeType = match[1].toLowerCase();
      if (!ALLOWED_PHOTO_MIMES.has(mimeType)) {
        return sendJson(res, 400, {
          message: 'Unsupported image format. Only JPEG, PNG, and WebP photos are allowed.',
        });
      }
      const buf = Buffer.from(match[2], 'base64');
      if (buf.length > MAX_PHOTO_BYTES) {
        return sendJson(res, 413, {
          message: 'Profile photo exceeds the 5 MB size limit.',
        });
      }
      nextAvatarUrl = String(body.avatarDataUrl);
    }

    const token = extractAccessToken(req);
    const sbClient = createSupabaseServerClient(token);
    let updatedRow = null;

    try {
      const { data: row } = await sbClient
        .from('profiles')
        .upsert(
          {
            id: user.id,
            email: user.email,
            full_name: fullName,
            role: user.role || 'member',
            campus_affiliation: nextAffiliation,
            avatar_url: nextAvatarUrl,
            updated_at: nowIso(),
          },
          { onConflict: 'id' }
        )
        .select('id, email, full_name, role, campus_affiliation, avatar_url, updated_at')
        .maybeSingle();
      updatedRow = row || null;
    } catch {
      // Fallback to in-memory cache + auth metadata
    }

    runtimeState.profileCache.set(user.id, {
      email: user.email,
      full_name: fullName,
      role: user.role,
      campus_affiliation: nextAffiliation,
      avatar_url: nextAvatarUrl,
    });

    const updatedUser = {
      ...user,
      fullName: updatedRow?.full_name || fullName,
      campusAffiliation:
        updatedRow?.campus_affiliation !== undefined
          ? updatedRow.campus_affiliation
          : nextAffiliation,
      hasProfilePhoto: Boolean(nextAvatarUrl),
      profilePhotoUrl: nextAvatarUrl,
    };

    return sendJson(res, 200, { user: updatedUser });
  }

  // =========================================================================
  // AUTHENTICATED AVATAR STREAMING (`/api/profile/avatar`)
  // =========================================================================
  if (pathname === '/api/profile/avatar' && method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Authentication required to view profile photo.' });
    }

    if (!user.profilePhotoUrl) {
      return sendJson(res, 404, { message: 'No profile photo found for this account.' });
    }

    const match = String(user.profilePhotoUrl).match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/
    );
    if (match) {
      const mimeType = match[1].toLowerCase();
      const buffer = Buffer.from(match[2], 'base64');
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': buffer.length,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(buffer);
      return;
    }

    res.writeHead(302, { Location: user.profilePhotoUrl });
    res.end();
    return;
  }

  // =========================================================================
  // CAMPUS PARKING LOTS, SECTIONS & QR LOOKUP (`/api/parking/*`)
  // =========================================================================
  if (pathname === '/api/parking' && method === 'GET') {
    const activeLots = runtimeState.lots.filter((l) => l.active !== false);
    const enrichedSections = runtimeState.sections.map((sec) => {
      const lot = runtimeState.lots.find((l) => l.id === sec.lotId);
      return {
        ...computeFreshnessState(sec, runtimeState.settings),
        lotName: lot ? lot.name : 'Campus Parking Lot',
      };
    });

    return sendJson(res, 200, {
      lots: activeLots,
      sections: enrichedSections,
      destinations: runtimeState.destinations,
      settings: runtimeState.settings,
    });
  }

  const qrMatch = pathname.match(/^\/api\/parking\/qr\/([^/]+)$/);
  if (qrMatch && method === 'GET') {
    const rawCode = decodeURIComponent(qrMatch[1] || '').trim().toUpperCase();
    if (!rawCode || !/^[A-Z0-9_-]+$/.test(rawCode)) {
      return sendJson(res, 400, {
        message: 'Invalid QR or section code format. Only valid campus section codes are accepted.',
      });
    }

    const section = runtimeState.sections.find(
      (sec) =>
        String(sec.code || '').toUpperCase() === rawCode ||
        String(sec.id || '').toUpperCase() === rawCode
    );
    if (!section) {
      return sendJson(res, 404, {
        message: `No configured campus parking section found for code "${rawCode}".`,
      });
    }

    const lot = runtimeState.lots.find((l) => l.id === section.lotId);
    return sendJson(res, 200, {
      section: {
        ...computeFreshnessState(section, runtimeState.settings),
        lotName: lot ? lot.name : 'Campus Parking Lot',
      },
    });
  }

  // =========================================================================
  // SAVED VEHICLE PARKING SESSIONS (`/api/sessions/*`)
  // =========================================================================
  if (pathname === '/api/sessions/active' && method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }

    const active = runtimeState.parkingSessions.find(
      (s) => s.userId === user.id && s.status === 'active'
    );
    return sendJson(res, 200, {
      session: computeSessionState(active, runtimeState.settings),
    });
  }

  if (pathname === '/api/sessions' && method === 'POST') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Authentication required to save a parking location.' });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { message: 'Invalid request payload.' });
    }

    const existingActive = runtimeState.parkingSessions.find(
      (s) => s.userId === user.id && s.status === 'active'
    );
    if (existingActive && !body.replaceExisting) {
      return sendJson(res, 409, {
        code: 'ACTIVE_SESSION_EXISTS',
        message:
          'You already have an active parked vehicle saved. Replace your existing session or update it instead.',
        session: computeSessionState(existingActive, runtimeState.settings),
      });
    }

    const sectionId = String(body.sectionId || '').trim();
    const section = runtimeState.sections.find(
      (s) => s.id === sectionId || s.code === sectionId
    );
    if (!section) {
      return sendJson(res, 400, { message: 'Please select a valid campus parking section.' });
    }

    const vehicleType = String(body.vehicleType || '').trim().toLowerCase();
    if (!['bike', 'car', 'other'].includes(vehicleType)) {
      return sendJson(res, 400, {
        message: 'Please select your vehicle type (Bike, Car, or Other).',
      });
    }

    if (!section.vehicleTypes.includes(vehicleType)) {
      return sendJson(res, 400, {
        message: `Selected section (${section.name}) does not support ${vehicleType} parking.`,
      });
    }

    if (section.accessRule === 'staff_only' && user.role !== 'staff') {
      return sendJson(res, 403, {
        message: 'This section is reserved for authorized campus staff and faculty permits.',
      });
    }

    const rowIdentifier = String(body.rowIdentifier || '').trim().slice(0, 60);
    const bayIdentifier = String(body.bayIdentifier || '').trim().slice(0, 60);
    const landmarkNote = String(body.landmarkNote || '').trim().slice(0, 280);

    let gpsCoords = null;
    if (body.gpsCoords && typeof body.gpsCoords === 'object') {
      const lat = Number(body.gpsCoords.lat);
      const lng = Number(body.gpsCoords.lng);
      const accuracy = Number(body.gpsCoords.accuracy) || null;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        gpsCoords = { lat, lng, accuracy };
      }
    }

    const sessionId = `ps_${crypto.randomUUID()}`;
    let parsedPhoto = null;
    if (body.photoDataUrl) {
      const match = String(body.photoDataUrl).match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/
      );
      if (!match) {
        return sendJson(res, 400, {
          message: 'Invalid photo format. Please upload a JPEG, PNG, or WebP image.',
        });
      }
      const mimeType = match[1].toLowerCase();
      if (!ALLOWED_PHOTO_MIMES.has(mimeType)) {
        return sendJson(res, 400, {
          message: 'Unsupported photo format. Only JPEG, PNG, and WebP are allowed.',
        });
      }
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > MAX_PHOTO_BYTES) {
        return sendJson(res, 400, {
          message: 'Photo exceeds the 5 MB maximum size limit.',
        });
      }
      parsedPhoto = { mimeType, buffer };
    }

    if (existingActive) {
      existingActive.status = 'completed';
      existingActive.endedAt = nowIso();
      runtimeState.sessionPhotos.delete(existingActive.id);
    }

    if (parsedPhoto) {
      runtimeState.sessionPhotos.set(sessionId, parsedPhoto);
    }

    const lot = runtimeState.lots.find((l) => l.id === section.lotId);
    const newSession = {
      id: sessionId,
      userId: user.id,
      lotId: section.lotId,
      lotName: lot ? lot.name : 'Campus Parking Lot',
      sectionId: section.id,
      sectionCode: section.code,
      sectionName: section.name,
      vehicleType,
      rowIdentifier,
      bayIdentifier,
      landmarkNote,
      gpsCoords,
      status: 'active',
      parkedAt: nowIso(),
      updatedAt: nowIso(),
    };

    runtimeState.parkingSessions.push(newSession);

    return sendJson(res, 201, {
      session: computeSessionState(newSession, runtimeState.settings),
    });
  }

  const sessionPhotoMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/photo$/);
  if (sessionPhotoMatch && method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }

    const sessionId = decodeURIComponent(sessionPhotoMatch[1]);
    const session = runtimeState.parkingSessions.find((s) => s.id === sessionId);
    if (!session || session.userId !== user.id) {
      return sendJson(res, 403, {
        message: 'Access denied. Parking photos are private to their owner.',
      });
    }

    const photoEntry = runtimeState.sessionPhotos.get(sessionId);
    if (!photoEntry) {
      return sendJson(res, 404, { message: 'No photo found for this parking session.' });
    }

    res.writeHead(200, {
      'Content-Type': photoEntry.mimeType,
      'Cache-Control': 'private, no-store',
    });
    res.end(photoEntry.buffer);
    return;
  }

  const sessionItemMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionItemMatch && method === 'PUT') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }

    const sessionId = decodeURIComponent(sessionItemMatch[1]);
    const session = runtimeState.parkingSessions.find(
      (s) => s.id === sessionId && s.status === 'active'
    );
    if (!session) {
      return sendJson(res, 404, { message: 'Active parking session not found.' });
    }
    if (session.userId !== user.id) {
      return sendJson(res, 403, {
        message: 'You can only update your own saved parking session.',
      });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { message: 'Invalid request payload.' });
    }

    if (body.sectionId && body.sectionId !== session.sectionId) {
      const nextSec = runtimeState.sections.find((s) => s.id === body.sectionId);
      if (!nextSec) {
        return sendJson(res, 400, { message: 'Selected parking section is invalid.' });
      }
      const nextType = body.vehicleType
        ? String(body.vehicleType).toLowerCase()
        : session.vehicleType;
      if (!nextSec.vehicleTypes.includes(nextType)) {
        return sendJson(res, 400, {
          message: `Selected section (${nextSec.name}) does not support ${nextType} parking.`,
        });
      }
      const lot = runtimeState.lots.find((l) => l.id === nextSec.lotId);
      session.lotId = nextSec.lotId;
      session.lotName = lot ? lot.name : 'Campus Parking Lot';
      session.sectionId = nextSec.id;
      session.sectionCode = nextSec.code;
      session.sectionName = nextSec.name;
    }

    if (
      body.vehicleType &&
      ['bike', 'car', 'other'].includes(String(body.vehicleType).toLowerCase())
    ) {
      session.vehicleType = String(body.vehicleType).toLowerCase();
    }
    if (typeof body.rowIdentifier === 'string') {
      session.rowIdentifier = body.rowIdentifier.trim().slice(0, 60);
    }
    if (typeof body.bayIdentifier === 'string') {
      session.bayIdentifier = body.bayIdentifier.trim().slice(0, 60);
    }
    if (typeof body.landmarkNote === 'string') {
      session.landmarkNote = body.landmarkNote.trim().slice(0, 280);
    }
    if (body.gpsCoords !== undefined) {
      if (body.gpsCoords === null) {
        session.gpsCoords = null;
      } else if (typeof body.gpsCoords === 'object') {
        const lat = Number(body.gpsCoords.lat);
        const lng = Number(body.gpsCoords.lng);
        const accuracy = Number(body.gpsCoords.accuracy) || null;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          session.gpsCoords = { lat, lng, accuracy };
        }
      }
    }

    if (body.removePhoto) {
      runtimeState.sessionPhotos.delete(session.id);
    } else if (body.photoDataUrl) {
      const match = String(body.photoDataUrl).match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/
      );
      if (!match) {
        return sendJson(res, 400, {
          message: 'Invalid photo format. Please upload a JPEG, PNG, or WebP image.',
        });
      }
      const mimeType = match[1].toLowerCase();
      if (!ALLOWED_PHOTO_MIMES.has(mimeType)) {
        return sendJson(res, 400, {
          message: 'Unsupported photo format. Only JPEG, PNG, and WebP are allowed.',
        });
      }
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > MAX_PHOTO_BYTES) {
        return sendJson(res, 400, {
          message: 'Photo exceeds the 5 MB maximum size limit.',
        });
      }
      runtimeState.sessionPhotos.set(session.id, { mimeType, buffer });
    }

    session.updatedAt = nowIso();
    return sendJson(res, 200, {
      session: computeSessionState(session, runtimeState.settings),
    });
  }

  if (sessionItemMatch && method === 'DELETE') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }

    const sessionId = decodeURIComponent(sessionItemMatch[1]);
    const session = runtimeState.parkingSessions.find(
      (s) => s.id === sessionId && s.status === 'active'
    );
    if (!session) {
      return sendJson(res, 404, { message: 'Active parking session not found.' });
    }
    if (session.userId !== user.id) {
      return sendJson(res, 403, {
        message: 'You can only end your own saved parking session.',
      });
    }

    session.status = 'completed';
    session.endedAt = nowIso();
    runtimeState.sessionPhotos.delete(session.id);

    return sendJson(res, 200, { ok: true, id: sessionId });
  }

  // =========================================================================
  // USER SECTION ISSUE REPORTS (`/api/reports`)
  // =========================================================================
  if (pathname === '/api/reports' && method === 'POST') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Please log in to submit a section report.' });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { message: 'Invalid request payload.' });
    }

    const sectionId = String(body.sectionId || '').trim();
    const issueType = String(body.issueType || '').trim();
    const description = String(body.description || '').trim().slice(0, 300);

    const section = runtimeState.sections.find((s) => s.id === sectionId);
    if (!section && sectionId !== 'general') {
      return sendJson(res, 400, { message: 'Please select a valid campus parking section.' });
    }
    if (!issueType) {
      return sendJson(res, 400, { message: 'Please select the issue type you observed.' });
    }

    const report = {
      id: `rep_${crypto.randomUUID()}`,
      sectionId: section ? section.id : 'general',
      sectionName: section ? section.name : String(body.sectionName || 'General Campus Lot'),
      issueType,
      description,
      reportedByUserId: user.id,
      reportedByName: user.fullName,
      status: 'pending_review',
      verified: false,
      createdAt: nowIso(),
    };

    runtimeState.sectionReports.unshift(report);
    return sendJson(res, 201, { report });
  }

  // =========================================================================
  // STAFF MAINTENANCE & RBAC CONTROLS (`/api/staff/*`)
  // =========================================================================
  if (pathname.startsWith('/api/staff')) {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }
    if (user.role !== 'staff') {
      return sendJson(res, 403, {
        message: 'Staff authorization required to access parking maintenance controls.',
      });
    }

    if (pathname === '/api/staff/overview' && method === 'GET') {
      return sendJson(res, 200, {
        lots: runtimeState.lots,
        sections: runtimeState.sections.map((sec) =>
          computeFreshnessState(sec, runtimeState.settings)
        ),
        reports: runtimeState.sectionReports.slice(0, 50),
        auditLogs: runtimeState.auditLogs.slice(0, 50),
        settings: runtimeState.settings,
      });
    }

    if (pathname === '/api/staff/lots' && method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const name = String(body.name || '').trim();
      const description = String(body.description || '').trim();
      const nearestDestinations = Array.isArray(body.nearestDestinations)
        ? body.nearestDestinations.map((d) => String(d).trim()).filter(Boolean)
        : [];

      if (!name) {
        return sendJson(res, 400, { message: 'Lot name is required.' });
      }

      const lot = {
        id: `lot_${crypto.randomUUID().slice(0, 8)}`,
        name,
        description,
        nearestDestinations: nearestDestinations.length
          ? nearestDestinations
          : ['Academic Block A'],
        active: true,
      };
      runtimeState.lots.push(lot);
      for (const dest of lot.nearestDestinations) {
        if (!runtimeState.destinations.includes(dest)) {
          runtimeState.destinations.push(dest);
        }
      }

      runtimeState.auditLogs.unshift({
        id: `aud_${crypto.randomUUID()}`,
        action: 'CREATE_LOT',
        targetName: lot.name,
        staffName: user.fullName,
        staffEmail: user.email,
        timestamp: nowIso(),
        details: `Created parking lot "${lot.name}"`,
      });

      return sendJson(res, 201, { lot });
    }

    const staffLotMatch = pathname.match(/^\/api\/staff\/lots\/([^/]+)$/);
    if (staffLotMatch && method === 'PUT') {
      const lotId = decodeURIComponent(staffLotMatch[1]);
      const lot = runtimeState.lots.find((l) => l.id === lotId);
      if (!lot) {
        return sendJson(res, 404, { message: 'Parking lot not found.' });
      }

      const body = await readJsonBody(req).catch(() => ({}));
      if (typeof body.name === 'string' && body.name.trim()) {
        lot.name = body.name.trim();
      }
      if (typeof body.description === 'string') {
        lot.description = body.description.trim();
      }
      if (typeof body.active === 'boolean') {
        lot.active = body.active;
      }

      runtimeState.auditLogs.unshift({
        id: `aud_${crypto.randomUUID()}`,
        action: 'UPDATE_LOT',
        targetName: lot.name,
        staffName: user.fullName,
        staffEmail: user.email,
        timestamp: nowIso(),
        details: `Updated lot "${lot.name}" (active: ${lot.active})`,
      });

      return sendJson(res, 200, { lot });
    }

    if (pathname === '/api/staff/sections' && method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const lotId = String(body.lotId || '').trim();
      const name = String(body.name || '').trim();
      const code = String(body.code || '')
        .trim()
        .toUpperCase();
      const destination = String(body.destination || '').trim();
      const totalCapacity = Math.max(1, Number(body.totalCapacity) || 50);
      const availableSpots = Math.min(
        totalCapacity,
        Math.max(0, Number(body.availableSpots ?? totalCapacity))
      );
      const status = ['Available', 'Limited', 'Full', 'Closed', 'Unknown'].includes(body.status)
        ? body.status
        : 'Available';
      const accessRule = ['general', 'staff_only', 'accessible'].includes(body.accessRule)
        ? body.accessRule
        : 'general';
      const vehicleTypes = Array.isArray(body.vehicleTypes)
        ? body.vehicleTypes.filter((t) => ['bike', 'car', 'other'].includes(t))
        : ['bike'];

      const lot = runtimeState.lots.find((l) => l.id === lotId);
      if (!lot) {
        return sendJson(res, 400, { message: 'Please select a valid parent parking lot.' });
      }
      if (!name || !code) {
        return sendJson(res, 400, { message: 'Section name and QR code are required.' });
      }
      if (vehicleTypes.length === 0) {
        return sendJson(res, 400, { message: 'Select at least one supported vehicle type.' });
      }

      const accessLabels = {
        general: 'Students & Staff',
        staff_only: 'Staff & Faculty Permit Only',
        accessible: 'Accessible / Priority Permit Required',
      };

      const section = {
        id: `sec_${crypto.randomUUID().slice(0, 8)}`,
        lotId,
        code,
        name,
        vehicleTypes,
        destination: destination || lot.nearestDestinations[0] || 'Academic Block A',
        walkingMinutes: Math.max(1, Number(body.walkingMinutes) || 3),
        accessRule,
        accessLabel: body.accessLabel || accessLabels[accessRule],
        totalCapacity,
        availableSpots,
        status,
        updatedAt: nowIso(),
        updatedBy: user.fullName,
        rows:
          Array.isArray(body.rows) && body.rows.length
            ? body.rows
            : ['Row A', 'Row B', 'Row C'],
        landmarkHint: String(body.landmarkHint || '').trim() || `Located inside ${lot.name}`,
      };

      runtimeState.sections.push(section);
      if (section.destination && !runtimeState.destinations.includes(section.destination)) {
        runtimeState.destinations.push(section.destination);
      }

      runtimeState.auditLogs.unshift({
        id: `aud_${crypto.randomUUID()}`,
        action: 'CREATE_SECTION',
        targetName: section.name,
        staffName: user.fullName,
        staffEmail: user.email,
        timestamp: nowIso(),
        details: `Created section "${section.name}" (${section.code}) in ${lot.name}`,
      });

      return sendJson(res, 201, { section });
    }

    const staffSecStatusMatch = pathname.match(/^\/api\/staff\/sections\/([^/]+)\/status$/);
    if (staffSecStatusMatch && method === 'POST') {
      const sectionId = decodeURIComponent(staffSecStatusMatch[1]);
      const section = runtimeState.sections.find((s) => s.id === sectionId);
      if (!section) {
        return sendJson(res, 404, { message: 'Parking section not found.' });
      }

      const body = await readJsonBody(req).catch(() => ({}));
      const validStatuses = ['Available', 'Limited', 'Full', 'Closed', 'Unknown'];
      if (body.status && validStatuses.includes(body.status)) {
        section.status = body.status;
      }

      if (body.availableSpots !== undefined) {
        const nextSpots = Math.max(
          0,
          Math.min(section.totalCapacity, Number(body.availableSpots) || 0)
        );
        section.availableSpots = nextSpots;
        if (!body.status) {
          if (nextSpots === 0) section.status = 'Full';
          else if (nextSpots <= Math.ceil(section.totalCapacity * 0.15))
            section.status = 'Limited';
          else section.status = 'Available';
        }
      } else if (body.status === 'Full' || body.status === 'Closed') {
        section.availableSpots = 0;
      }

      section.updatedAt = nowIso();
      section.updatedBy = user.fullName;

      const auditEntry = {
        id: `aud_${crypto.randomUUID()}`,
        action: 'UPDATE_SECTION_STATUS',
        targetName: section.name,
        staffName: user.fullName,
        staffEmail: user.email,
        timestamp: section.updatedAt,
        details: `Set ${section.name} to ${section.status} (${section.availableSpots}/${section.totalCapacity} spots)`,
      };
      runtimeState.auditLogs.unshift(auditEntry);

      return sendJson(res, 200, {
        section: computeFreshnessState(section, runtimeState.settings),
        auditEntry,
      });
    }

    const staffSecEditMatch = pathname.match(/^\/api\/staff\/sections\/([^/]+)$/);
    if (staffSecEditMatch && method === 'PUT') {
      const sectionId = decodeURIComponent(staffSecEditMatch[1]);
      const section = runtimeState.sections.find((s) => s.id === sectionId);
      if (!section) {
        return sendJson(res, 404, { message: 'Parking section not found.' });
      }

      const body = await readJsonBody(req).catch(() => ({}));
      if (typeof body.name === 'string' && body.name.trim()) {
        section.name = body.name.trim();
      }
      if (typeof body.code === 'string' && body.code.trim()) {
        section.code = body.code.trim().toUpperCase();
      }
      if (typeof body.destination === 'string' && body.destination.trim()) {
        section.destination = body.destination.trim();
        if (!runtimeState.destinations.includes(section.destination)) {
          runtimeState.destinations.push(section.destination);
        }
      }
      if (body.totalCapacity !== undefined) {
        section.totalCapacity = Math.max(1, Number(body.totalCapacity) || section.totalCapacity);
        section.availableSpots = Math.min(section.totalCapacity, section.availableSpots);
      }
      if (
        Array.isArray(body.vehicleTypes) &&
        body.vehicleTypes.length > 0
      ) {
        section.vehicleTypes = body.vehicleTypes.filter((t) =>
          ['bike', 'car', 'other'].includes(t)
        );
      }
      if (
        body.accessRule &&
        ['general', 'staff_only', 'accessible'].includes(body.accessRule)
      ) {
        section.accessRule = body.accessRule;
        const accessLabels = {
          general: 'Students & Staff',
          staff_only: 'Staff & Faculty Permit Only',
          accessible: 'Accessible / Priority Permit Required',
        };
        section.accessLabel = body.accessLabel || accessLabels[body.accessRule];
      }
      if (typeof body.landmarkHint === 'string') {
        section.landmarkHint = body.landmarkHint.trim();
      }

      section.updatedAt = nowIso();
      section.updatedBy = user.fullName;

      runtimeState.auditLogs.unshift({
        id: `aud_${crypto.randomUUID()}`,
        action: 'EDIT_SECTION',
        targetName: section.name,
        staffName: user.fullName,
        staffEmail: user.email,
        timestamp: section.updatedAt,
        details: `Updated configuration for ${section.name}`,
      });

      return sendJson(res, 200, {
        section: computeFreshnessState(section, runtimeState.settings),
      });
    }

    const staffReportMatch = pathname.match(/^\/api\/staff\/reports\/([^/]+)$/);
    if (staffReportMatch && method === 'PUT') {
      const reportId = decodeURIComponent(staffReportMatch[1]);
      const report = runtimeState.sectionReports.find((r) => r.id === reportId);
      if (!report) {
        return sendJson(res, 404, { message: 'Report not found.' });
      }

      const body = await readJsonBody(req).catch(() => ({}));
      report.status = body.status === 'dismissed' ? 'dismissed' : 'verified';
      report.verified = report.status === 'verified';
      report.reviewedBy = user.fullName;
      report.reviewedAt = nowIso();

      if (report.verified && body.applySectionStatus && report.sectionId !== 'general') {
        const sec = runtimeState.sections.find((s) => s.id === report.sectionId);
        if (
          sec &&
          ['Available', 'Limited', 'Full', 'Closed', 'Unknown'].includes(body.applySectionStatus)
        ) {
          sec.status = body.applySectionStatus;
          if (sec.status === 'Full' || sec.status === 'Closed') {
            sec.availableSpots = 0;
          }
          sec.updatedAt = nowIso();
          sec.updatedBy = `${user.fullName} (Verified Report)`;
        }
      }

      runtimeState.auditLogs.unshift({
        id: `aud_${crypto.randomUUID()}`,
        action: 'REVIEW_REPORT',
        targetName: report.sectionName,
        staffName: user.fullName,
        staffEmail: user.email,
        timestamp: nowIso(),
        details: `Marked user report on ${report.sectionName} as ${report.status}`,
      });

      return sendJson(res, 200, { report });
    }

    if (pathname === '/api/staff/settings' && method === 'PUT') {
      const body = await readJsonBody(req).catch(() => ({}));
      if (body.freshnessMinutes !== undefined) {
        runtimeState.settings.freshnessMinutes = Math.max(
          5,
          Math.min(720, Number(body.freshnessMinutes) || 60)
        );
      }
      if (body.staleVehicleHours !== undefined) {
        runtimeState.settings.staleVehicleHours = Math.max(
          1,
          Math.min(168, Number(body.staleVehicleHours) || 12)
        );
      }

      runtimeState.auditLogs.unshift({
        id: `aud_${crypto.randomUUID()}`,
        action: 'UPDATE_SETTINGS',
        targetName: 'Freshness & Thresholds',
        staffName: user.fullName,
        staffEmail: user.email,
        timestamp: nowIso(),
        details: `Updated freshness threshold to ${runtimeState.settings.freshnessMinutes}m, vehicle alert to ${runtimeState.settings.staleVehicleHours}h`,
      });

      return sendJson(res, 200, { settings: runtimeState.settings });
    }
  }

  // =========================================================================
  // SHARED PERSISTENT REVIEWS & LIKES (`/api/reviews/*`)
  // =========================================================================
  if (pathname === '/api/reviews' && method === 'GET') {
    const user = await getAuthenticatedUser(req);
    const reviewsPayload = runtimeState.reviews.map((r) => {
      const likedBy = Array.isArray(r.likedByUserIds) ? r.likedByUserIds : [];
      return {
        id: r.id,
        authorId: r.authorId,
        authorName: r.authorName,
        text: r.text,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt || null,
        likeCount: likedBy.length,
        likedByCurrentUser: user ? likedBy.includes(user.id) : false,
        isOwnReview: user ? r.authorId === user.id : false,
      };
    });

    return sendJson(res, 200, { reviews: reviewsPayload });
  }

  if (pathname === '/api/reviews' && method === 'POST') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Please log in to submit a review.' });
    }

    const existing = runtimeState.reviews.find((r) => r.authorId === user.id);
    if (existing) {
      return sendJson(res, 409, {
        message:
          'You have already submitted a review. You can edit or delete your existing review.',
      });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { message: 'Invalid request payload.' });
    }

    const text = String(body.text || '').trim();
    if (!text) {
      return sendJson(res, 400, { message: 'Please write your review before submitting.' });
    }
    if (text.length > 400) {
      return sendJson(res, 400, { message: 'Review text must be 400 characters or fewer.' });
    }

    const review = {
      id: `rev_${crypto.randomUUID()}`,
      authorId: user.id,
      authorName: user.fullName,
      text,
      createdAt: nowIso(),
      updatedAt: null,
      likedByUserIds: [],
    };

    runtimeState.reviews.unshift(review);

    return sendJson(res, 201, {
      review: {
        id: review.id,
        authorId: review.authorId,
        authorName: review.authorName,
        text: review.text,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        likeCount: 0,
        likedByCurrentUser: false,
        isOwnReview: true,
      },
    });
  }

  const reviewLikeMatch = pathname.match(/^\/api\/reviews\/([^/]+)\/likes$/);
  if (reviewLikeMatch && (method === 'POST' || method === 'DELETE')) {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Please log in to like reviews.' });
    }

    const reviewId = decodeURIComponent(reviewLikeMatch[1]);
    const review = runtimeState.reviews.find((r) => String(r.id) === String(reviewId));
    if (!review) {
      return sendJson(res, 404, { message: 'Review not found.' });
    }

    if (!Array.isArray(review.likedByUserIds)) {
      review.likedByUserIds = [];
    }

    const hasLiked = review.likedByUserIds.includes(user.id);
    if (method === 'POST' && !hasLiked) {
      review.likedByUserIds.push(user.id);
    } else if (method === 'DELETE' && hasLiked) {
      review.likedByUserIds = review.likedByUserIds.filter((id) => id !== user.id);
    }

    return sendJson(res, 200, {
      id: review.id,
      likeCount: review.likedByUserIds.length,
      likedByCurrentUser: review.likedByUserIds.includes(user.id),
    });
  }

  const reviewItemMatch = pathname.match(/^\/api\/reviews\/([^/]+)$/);
  if (reviewItemMatch && (method === 'PUT' || method === 'DELETE')) {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }

    const reviewId = decodeURIComponent(reviewItemMatch[1]);
    const idx = runtimeState.reviews.findIndex((r) => String(r.id) === String(reviewId));
    if (idx === -1) {
      return sendJson(res, 404, { message: 'Review not found.' });
    }

    const review = runtimeState.reviews[idx];
    if (review.authorId !== user.id) {
      return sendJson(res, 403, {
        message: 'You can only edit or delete your own review.',
      });
    }

    if (method === 'DELETE') {
      runtimeState.reviews.splice(idx, 1);
      return sendJson(res, 200, { ok: true, id: reviewId });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { message: 'Invalid request payload.' });
    }

    const text = String(body.text || '').trim();
    if (!text) {
      return sendJson(res, 400, { message: 'Review text cannot be empty.' });
    }
    if (text.length > 400) {
      return sendJson(res, 400, { message: 'Review text must be 400 characters or fewer.' });
    }

    review.text = text;
    review.authorName = user.fullName;
    review.updatedAt = nowIso();

    const likedBy = Array.isArray(review.likedByUserIds) ? review.likedByUserIds : [];
    return sendJson(res, 200, {
      review: {
        id: review.id,
        authorId: review.authorId,
        authorName: review.authorName,
        text: review.text,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        likeCount: likedBy.length,
        likedByCurrentUser: likedBy.includes(user.id),
        isOwnReview: true,
      },
    });
  }

  return sendJson(res, 404, { message: 'API endpoint not found.' });
}

// ---------------------------------------------------------------------------
// 6. Static Asset Server + `/vendor/supabase.js` Browser ESM Bridge
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let cachedSupabaseVendorBundle = null;

function serveSupabaseVendorBundle(res) {
  if (!cachedSupabaseVendorBundle) {
    const umdPath = path.join(
      __dirname,
      'node_modules',
      '@supabase',
      'supabase-js',
      'dist',
      'umd',
      'supabase.js'
    );
    const umdSource = fs.readFileSync(umdPath, 'utf8');
    cachedSupabaseVendorBundle = `${umdSource}\nexport const createClient = (typeof globalThis !== 'undefined' && globalThis.supabase && globalThis.supabase.createClient) ? globalThis.supabase.createClient : undefined;\n`;
  }

  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(cachedSupabaseVendorBundle);
}

function handleStaticRequest(req, res, url) {
  let reqPath = decodeURIComponent(url.pathname);

  if (reqPath === '/vendor/supabase.js') {
    try {
      serveSupabaseVendorBundle(res);
      return;
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Unable to load Supabase vendor bundle');
      return;
    }
  }

  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  // Prevent access to sensitive dotfiles or backend files
  const normalized = path.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const safeRelative = normalized.replace(/^[/\\]+/, '');
  if (
    safeRelative.startsWith('.env') ||
    safeRelative.startsWith('.git') ||
    safeRelative.startsWith('supabase') ||
    safeRelative === 'server.mjs' ||
    safeRelative === 'package.json' ||
    safeRelative === 'package-lock.json'
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const absolutePath = path.join(__dirname, safeRelative);
  if (!absolutePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(absolutePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const isCodeOrMarkup =
      ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.css';
    const responseHeaders = {
      'Content-Type': contentType,
      'Cache-Control': isCodeOrMarkup
        ? 'no-store, no-cache, must-revalidate'
        : 'public, max-age=3600',
    };
    if (ext === '.html') {
      responseHeaders['Clear-Site-Data'] = '"cache"';
    }
    res.writeHead(200, responseHeaders);

    const stream = fs.createReadStream(absolutePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    });
    stream.pipe(res);
  });
}

export function createParktraceServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, url);
        return;
      }
      handleStaticRequest(req, res, url);
    } catch {
      if (!res.headersSent) {
        sendJson(res, 500, { message: 'An unexpected server error occurred.' });
      } else {
        res.end();
      }
    }
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = createParktraceServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PARKTRACE server running at http://localhost:${PORT}`);
  });
}
