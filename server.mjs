import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DB_FILE_PATH = process.env.PARKTRACE_DB_PATH
  ? path.resolve(process.env.PARKTRACE_DB_PATH)
  : path.join(DEFAULT_DATA_DIR, 'parktrace-db.json');
const PRIVATE_PHOTOS_DIR = path.join(path.dirname(DB_FILE_PATH), 'private-photos');
const PRIVATE_AVATARS_DIR = path.join(path.dirname(DB_FILE_PATH), 'private-avatars');
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB limit

const SESSION_COOKIE_NAME = 'parktrace_sid';
const PERSISTENT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SESSION_TTL_MS = PERSISTENT_MAX_AGE_SECONDS * 1000;

const STAFF_EMAILS = new Set(
  [
    'parktrace.1341@gmail.com',
    ...(process.env.PARKTRACE_STAFF_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ]
);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function createEmptyDb() {
  return {
    users: [],
    sessions: {},
    reviews: [],
    lots: [],
    sections: [],
    parkingSessions: [],
    reports: [],
    statusHistory: [],
    settings: {
      freshnessMinutes: 60,
      staleVehicleHours: 12,
      requireEmailVerification: process.env.PARKTRACE_REQUIRE_EMAIL_VERIFICATION === 'true',
    },
  };
}

function ensureStorageDirs() {
  const dbDir = path.dirname(DB_FILE_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  if (!fs.existsSync(PRIVATE_PHOTOS_DIR)) {
    fs.mkdirSync(PRIVATE_PHOTOS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PRIVATE_AVATARS_DIR)) {
    fs.mkdirSync(PRIVATE_AVATARS_DIR, { recursive: true });
  }
}

function loadDb() {
  ensureStorageDirs();
  if (!fs.existsSync(DB_FILE_PATH)) {
    const initial = createEmptyDb();
    saveDb(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const defaults = createEmptyDb();
    return {
      ...defaults,
      ...parsed,
      settings: {
        ...defaults.settings,
        ...(parsed.settings || {}),
      },
    };
  } catch {
    const fallback = createEmptyDb();
    saveDb(fallback);
    return fallback;
  }
}

function saveDb(db) {
  ensureStorageDirs();
  const tempPath = `${DB_FILE_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tempPath, DB_FILE_PATH);
}

// Rate limiter map: key -> { count, resetAt }
const rateLimitBuckets = new Map();

function checkRateLimit(key, maxRequests = 25, windowMs = 60_000) {
  const now = Date.now();
  const entry = rateLimitBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count += 1;
  return true;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const derived = crypto.scryptSync(String(password), salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) {
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function buildSessionCookie(token, persistence = 'session') {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (persistence === 'persistent') {
    parts.push(`Max-Age=${PERSISTENT_MAX_AGE_SECONDS}`);
  }
  return parts.join('; ');
}

function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function hasSavedAvatarFile(userId) {
  if (!userId) return false;
  try {
    return fs.existsSync(path.join(PRIVATE_AVATARS_DIR, `${userId}.json`));
  } catch {
    return false;
  }
}

function sanitizeUser(user, persistence = 'session') {
  if (!user) return null;
  // Authorization role is determined strictly by user.role / STAFF_EMAILS,
  // NEVER by user.campusAffiliation.
  const isStaff =
    user.role === 'staff' ||
    user.role === 'admin' ||
    STAFF_EMAILS.has(String(user.email || '').toLowerCase());
  const campusAffiliation =
    user.campusAffiliation === 'student' || user.campusAffiliation === 'staff'
      ? user.campusAffiliation
      : null;
  const hasProfilePhoto = Boolean(user.hasProfilePhoto && hasSavedAvatarFile(user.id));
  const versionParam = encodeURIComponent(user.profilePhotoUpdatedAt || '1');
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: isStaff ? 'staff' : 'member',
    campusAffiliation,
    hasProfilePhoto,
    profilePhotoUrl: hasProfilePhoto
      ? `/api/auth/profile/photo?u=${encodeURIComponent(user.id)}&v=${versionParam}`
      : null,
    emailVerified: user.emailVerified !== false,
    persistence,
    createdAt: user.createdAt,
  };
}

function getAuthenticatedSession(req, db) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token || !db.sessions[token]) return null;

  const sessionRecord = db.sessions[token];
  if (Date.now() - (sessionRecord.createdAtMs || 0) > SESSION_TTL_MS) {
    delete db.sessions[token];
    saveDb(db);
    return null;
  }

  const user = db.users.find((u) => u.id === sessionRecord.userId);
  if (!user) {
    delete db.sessions[token];
    saveDb(db);
    return null;
  }

  return {
    token,
    persistence: sessionRecord.persistence || 'session',
    user: sanitizeUser(user, sessionRecord.persistence || 'session'),
    rawUser: user,
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 65_536) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Request payload is too large.'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('Invalid JSON payload.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 180) return false;
  const parts = trimmed.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isValidDisplayName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) return false;
  return /\p{L}/u.test(trimmed);
}

function computeEffectiveSection(section, lots, freshnessMinutes = 60) {
  const lot = lots.find((l) => l.id === section.lotId) || null;
  const rawStatus = section.status || 'Unknown';
  const updatedMs = section.updatedAt ? Date.parse(section.updatedAt) : NaN;
  const ageMinutes = Number.isFinite(updatedMs)
    ? Math.max(0, (Date.now() - updatedMs) / 60_000)
    : Infinity;

  const isStale =
    rawStatus !== 'Closed' &&
    rawStatus !== 'Unknown' &&
    (!Number.isFinite(updatedMs) || ageMinutes > freshnessMinutes);

  const effectiveStatus = isStale ? 'Unknown' : rawStatus;

  return {
    id: section.id,
    lotId: section.lotId,
    lotName: lot ? lot.name : section.lotName || 'Campus Lot',
    lotCode: lot ? lot.code : section.lotCode || '',
    name: section.name,
    code: section.code,
    qrCode: section.qrCode || section.code,
    vehicleTypes: Array.isArray(section.vehicleTypes) ? section.vehicleTypes : ['bike', 'car', 'other'],
    destination: section.destination || (lot ? lot.destination : ''),
    entrance: section.entrance || '',
    capacity:
      typeof section.capacity === 'number' && Number.isFinite(section.capacity) && section.capacity > 0
        ? section.capacity
        : null,
    hasReliableCount: Boolean(section.hasReliableCount),
    availableSpaces:
      section.hasReliableCount &&
      !isStale &&
      effectiveStatus !== 'Closed' &&
      effectiveStatus !== 'Unknown' &&
      typeof section.availableSpaces === 'number' &&
      Number.isFinite(section.availableSpaces)
        ? Math.max(0, section.availableSpaces)
        : null,
    restrictions: section.restrictions || 'Standard campus permit',
    status: effectiveStatus,
    recordedStatus: rawStatus,
    isStale,
    closureReason: effectiveStatus === 'Closed' ? section.closureReason || '' : '',
    updatedAt: section.updatedAt || null,
    source: section.source || 'Staff Update',
    updatedBy: section.updatedBy || 'Parking Staff',
    latitude:
      typeof section.latitude === 'number' && Number.isFinite(section.latitude)
        ? section.latitude
        : null,
    longitude:
      typeof section.longitude === 'number' && Number.isFinite(section.longitude)
        ? section.longitude
        : null,
  };
}

function formatReviewForClient(review, currentUser) {
  const likedBy = Array.isArray(review.likedBy) ? review.likedBy : [];
  const currentUserId = currentUser ? String(currentUser.id) : null;
  return {
    id: String(review.id),
    authorId: String(review.authorId),
    authorName: String(review.authorName || 'Campus Member'),
    text: String(review.text || ''),
    createdAt: review.createdAt,
    updatedAt: review.updatedAt || null,
    likeCount: likedBy.length,
    likedByCurrentUser: Boolean(currentUserId && likedBy.includes(currentUserId)),
    isOwnReview: Boolean(currentUserId && String(review.authorId) === currentUserId),
  };
}

function sortReviewsList(reviews) {
  return [...reviews].sort((a, b) => {
    const likesA = Number(a.likeCount) || 0;
    const likesB = Number(b.likeCount) || 0;
    if (likesB !== likesA) return likesB - likesA;

    const timeA = Date.parse(a.createdAt) || 0;
    const timeB = Date.parse(b.createdAt) || 0;
    if (timeB !== timeA) return timeB - timeA;

    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

function formatParkingSessionForClient(session, db) {
  if (!session) return null;
  const lot = db.lots.find((l) => l.id === session.lotId) || null;
  const section = db.sections.find((s) => s.id === session.sectionId) || null;
  const staleHours = Number(db.settings?.staleVehicleHours) || 12;
  const parkedMs = Date.parse(session.parkedAt) || Date.now();
  const lastConfirmedMs = session.lastConfirmedAt ? Date.parse(session.lastConfirmedAt) : parkedMs;
  const hoursSinceCheck = (Date.now() - lastConfirmedMs) / 3_600_000;

  return {
    id: session.id,
    userId: session.userId,
    lotId: session.lotId || '',
    lotName: lot ? lot.name : session.lotName || '',
    sectionId: session.sectionId || '',
    sectionName: section ? section.name : session.sectionName || '',
    sectionCode: section ? section.code : session.sectionCode || '',
    entrance: section ? section.entrance : session.entrance || '',
    destination: section ? section.destination : session.destination || '',
    vehicleType: session.vehicleType || 'car',
    vehicleLabel: session.vehicleLabel || '',
    row: session.row || '',
    bay: session.bay || '',
    parkedAt: session.parkedAt,
    lastConfirmedAt: session.lastConfirmedAt || session.parkedAt,
    isLongRunning: hoursSinceCheck >= staleHours,
    note: session.note || '',
    latitude:
      typeof session.latitude === 'number' && Number.isFinite(session.latitude)
        ? session.latitude
        : section && typeof section.latitude === 'number'
        ? section.latitude
        : null,
    longitude:
      typeof session.longitude === 'number' && Number.isFinite(session.longitude)
        ? session.longitude
        : section && typeof section.longitude === 'number'
        ? section.longitude
        : null,
    hasUserPin:
      typeof session.latitude === 'number' &&
      Number.isFinite(session.latitude) &&
      typeof session.longitude === 'number' &&
      Number.isFinite(session.longitude),
    hasPhoto: Boolean(session.hasPhoto),
    photoUrl: session.hasPhoto ? `/api/sessions/${encodeURIComponent(session.id)}/photo` : null,
  };
}

function savePrivatePhoto(sessionId, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl.trim()
  );
  if (!match) {
    throw Object.assign(
      new Error('Photo must be a valid PNG, JPEG, or WebP image.'),
      { statusCode: 400 }
    );
  }
  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 2 * 1024 * 1024) {
    throw Object.assign(
      new Error('Photo size must be under 2 MB.'),
      { statusCode: 400 }
    );
  }
  ensureStorageDirs();
  const filePath = path.join(PRIVATE_PHOTOS_DIR, `${sessionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ mimeType, base64Data }), 'utf8');
  return true;
}

function deletePrivatePhoto(sessionId) {
  try {
    const filePath = path.join(PRIVATE_PHOTOS_DIR, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Verifies binary magic bytes for JPEG, PNG, or WebP and strips EXIF/location
 * metadata segments so saved profile avatars never retain GPS or camera EXIF data.
 */
function stripAvatarMetadataAndVerify(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw Object.assign(
      new Error('Profile photo file is empty or corrupted. Please choose a valid JPEG, PNG, or WebP image.'),
      { statusCode: 400 }
    );
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw Object.assign(
      new Error('Profile photo exceeds the 5 MB upload limit. Please choose a JPEG, PNG, or WebP image under 5 MB.'),
      { statusCode: 400 }
    );
  }

  if (mimeType === 'image/jpeg') {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw Object.assign(
        new Error('File content does not match a valid JPEG image. Accepted formats: JPEG, PNG, and WebP (max 5 MB).'),
        { statusCode: 400 }
      );
    }
    // Strip APP1 (EXIF/XMP: 0xFFE1), APP13 (IPTC: 0xFFED), and COM (0xFFFE) segments
    const outChunks = [buffer.subarray(0, 2)];
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) {
        outChunks.push(buffer.subarray(offset));
        break;
      }
      const marker = buffer[offset + 1];
      // SOS (0xDA) or EOI (0xD9) -> copy remaining compressed image data as-is
      if (marker === 0xda || marker === 0xd9) {
        outChunks.push(buffer.subarray(offset));
        break;
      }
      // Standalone markers without length
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        outChunks.push(buffer.subarray(offset, offset + 2));
        offset += 2;
        continue;
      }
      const segLen = buffer.readUInt16BE(offset + 2);
      if (segLen < 2 || offset + 2 + segLen > buffer.length) {
        outChunks.push(buffer.subarray(offset));
        break;
      }
      // Drop EXIF/XMP (0xE1), IPTC (0xED), and comment (0xFE) metadata segments
      if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) {
        outChunks.push(buffer.subarray(offset, offset + 2 + segLen));
      }
      offset += 2 + segLen;
    }
    return Buffer.concat(outChunks);
  }

  if (mimeType === 'image/png') {
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buffer.subarray(0, 8).equals(pngSig)) {
      throw Object.assign(
        new Error('File content does not match a valid PNG image. Accepted formats: JPEG, PNG, and WebP (max 5 MB).'),
        { statusCode: 400 }
      );
    }
    // Strip ancillary metadata chunks (eXIf, tEXt, zTXt, iTXt, tIME)
    const dropTypes = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
    const outChunks = [buffer.subarray(0, 8)];
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      const totalChunkLen = 12 + length;
      if (offset + totalChunkLen > buffer.length) {
        outChunks.push(buffer.subarray(offset));
        break;
      }
      if (!dropTypes.has(type)) {
        outChunks.push(buffer.subarray(offset, offset + totalChunkLen));
      }
      offset += totalChunkLen;
      if (type === 'IEND') break;
    }
    return Buffer.concat(outChunks);
  }

  if (mimeType === 'image/webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff !== 'RIFF' || webp !== 'WEBP') {
      throw Object.assign(
        new Error('File content does not match a valid WebP image. Accepted formats: JPEG, PNG, and WebP (max 5 MB).'),
        { statusCode: 400 }
      );
    }
    // Strip EXIF and XMP chunks if present in extended WebP
    const bodyChunks = [];
    let offset = 12;
    while (offset + 8 <= buffer.length) {
      const fourCC = buffer.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const paddedSize = chunkSize + (chunkSize % 2);
      if (offset + 8 + paddedSize > buffer.length) {
        bodyChunks.push(buffer.subarray(offset));
        break;
      }
      if (fourCC !== 'EXIF' && fourCC !== 'XMP ') {
        bodyChunks.push(buffer.subarray(offset, offset + 8 + paddedSize));
      }
      offset += 8 + paddedSize;
    }
    const payload = Buffer.concat(bodyChunks);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(4 + payload.length, 4);
    header.write('WEBP', 8, 'ascii');
    return Buffer.concat([header, payload]);
  }

  throw Object.assign(
    new Error('Unsupported image format. Please upload a JPEG, PNG, or WebP image (max 5 MB).'),
    { statusCode: 400 }
  );
}

function validateAndParseAvatarDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw Object.assign(
      new Error('Please provide a valid JPEG, PNG, or WebP image (up to 5 MB).'),
      { statusCode: 400 }
    );
  }
  const trimmed = dataUrl.trim();
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(trimmed);
  if (!match) {
    throw Object.assign(
      new Error('Unsupported image format. Please choose a JPEG, PNG, or WebP image (up to 5 MB).'),
      { statusCode: 400 }
    );
  }
  const rawMime = match[1].toLowerCase().trim();
  const normalizedMime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(normalizedMime)) {
    throw Object.assign(
      new Error('Unsupported file type. Only JPEG, PNG, and WebP images are accepted (max 5 MB).'),
      { statusCode: 400 }
    );
  }
  const cleanBase64 = match[2].replace(/[\r\n]/g, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  const strippedBuffer = stripAvatarMetadataAndVerify(buffer, normalizedMime);
  return {
    mimeType: normalizedMime,
    base64Data: strippedBuffer.toString('base64'),
  };
}

function saveAvatarAtomically(userId, parsedAvatar) {
  ensureStorageDirs();
  const finalPath = path.join(PRIVATE_AVATARS_DIR, `${userId}.json`);
  const tempPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(parsedAvatar), 'utf8');
  fs.renameSync(tempPath, finalPath);
}

function deleteAvatarFile(userId) {
  try {
    const filePath = path.join(PRIVATE_AVATARS_DIR, `${userId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

async function handleApiRequest(req, res, pathname) {
  const db = loadDb();
  const clientIp = req.socket?.remoteAddress || 'local';
  const auth = getAuthenticatedSession(req, db);
  const currentUser = auth ? auth.user : null;

  // ---------------------------------------------------------------------------
  // 1. AUTHENTICATION & PROFILE (/api/auth/*)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/auth/session' && req.method === 'GET') {
    if (!currentUser) {
      return sendJson(res, 200, { user: null });
    }
    return sendJson(res, 200, { user: currentUser });
  }

  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    if (!checkRateLimit(`signup:${clientIp}`, 15, 60_000)) {
      return sendJson(res, 429, { message: 'Too many sign-up attempts. Please wait a moment and try again.' });
    }

    const body = await readJsonBody(req);
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!isValidDisplayName(fullName)) {
      return sendJson(res, 400, { message: 'Please enter your full name (including at least one letter).' });
    }
    if (!isValidEmail(email)) {
      return sendJson(res, 400, { message: 'Please enter a valid email address (e.g., name@campus.edu).' });
    }
    if (password.length < 8 || password.length > 128) {
      return sendJson(res, 400, { message: 'Password must be at least 8 characters long.' });
    }

    const existing = db.users.find((u) => u.email.toLowerCase() === email);
    if (existing) {
      return sendJson(res, 409, { message: 'An account with this email address already exists. Please log in instead.' });
    }

    const requireVerification = Boolean(db.settings?.requireEmailVerification);
    const isStaff = STAFF_EMAILS.has(email);
    const newUser = {
      id: `usr_${crypto.randomBytes(8).toString('hex')}`,
      fullName,
      email,
      passwordHash: hashPassword(password),
      role: isStaff ? 'staff' : 'member',
      emailVerified: !requireVerification,
      verificationToken: requireVerification ? crypto.randomBytes(16).toString('hex') : null,
      createdAt: new Date().toISOString(),
    };

    db.users.push(newUser);

    if (requireVerification) {
      saveDb(db);
      return sendJson(res, 201, {
        requiresVerification: true,
        email: newUser.email,
        message: 'Account created. Please verify your email address before accessing protected campus parking features.',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[token] = {
      userId: newUser.id,
      persistence: 'session',
      createdAtMs: Date.now(),
    };
    saveDb(db);

    return sendJson(
      res,
      201,
      { user: sanitizeUser(newUser, 'session') },
      { 'Set-Cookie': buildSessionCookie(token, 'session') }
    );
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (!checkRateLimit(`login:${clientIp}`, 20, 60_000)) {
      return sendJson(res, 429, { message: 'Too many login attempts. Please wait a moment and try again.' });
    }

    const body = await readJsonBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const persistence = body.persistence === 'persistent' ? 'persistent' : 'session';

    if (!isValidEmail(email) || !password) {
      return sendJson(res, 400, { message: 'Please enter a valid email address and password.' });
    }

    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendJson(res, 401, { message: 'Invalid email address or password.' });
    }

    if (user.emailVerified === false) {
      return sendJson(res, 403, {
        requiresVerification: true,
        email: user.email,
        message: 'Please verify your email address before signing in.',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[token] = {
      userId: user.id,
      persistence,
      createdAtMs: Date.now(),
    };
    saveDb(db);

    return sendJson(
      res,
      200,
      { user: sanitizeUser(user, persistence) },
      { 'Set-Cookie': buildSessionCookie(token, persistence) }
    );
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    if (auth && auth.token) {
      delete db.sessions[auth.token];
      saveDb(db);
    }
    return sendJson(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': buildClearSessionCookie() }
    );
  }

  if (pathname === '/api/auth/profile/photo' && req.method === 'GET') {
    if (!auth || !currentUser) {
      return sendJson(res, 401, { message: 'Authentication required to view profile photo.' });
    }
    const reqUrl = new URL(req.url || pathname, 'http://localhost');
    const requestedUserId = reqUrl.searchParams.get('u') || reqUrl.searchParams.get('userId');
    if (requestedUserId && String(requestedUserId) !== String(currentUser.id)) {
      return sendJson(res, 403, {
        message: 'Access denied. You can only access your own profile photo.',
      });
    }

    const avatarPath = path.join(PRIVATE_AVATARS_DIR, `${currentUser.id}.json`);
    if (!fs.existsSync(avatarPath)) {
      return sendJson(res, 404, { message: 'No profile photo saved for this account.' });
    }

    try {
      const { mimeType, base64Data } = JSON.parse(fs.readFileSync(avatarPath, 'utf8'));
      const imgBuffer = Buffer.from(base64Data, 'base64');
      res.writeHead(200, {
        'Content-Type': mimeType || 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(imgBuffer);
      return;
    } catch {
      return sendJson(res, 500, { message: 'Unable to load saved profile photo.' });
    }
  }

  if (pathname === '/api/auth/profile' && (req.method === 'PUT' || req.method === 'PATCH')) {
    if (!auth || !currentUser) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }

    let body;
    try {
      // Allow up to 8 MB JSON payload so a 5 MB image in base64 can be parsed and validated
      body = await readJsonBody(req, 8 * 1024 * 1024);
    } catch (err) {
      if (err && err.statusCode === 413) {
        return sendJson(res, 400, {
          message:
            'Profile photo exceeds the 5 MB upload limit. Please choose a JPEG, PNG, or WebP image under 5 MB.',
        });
      }
      throw err;
    }

    // Ensure users can modify ONLY their own profile and photo
    if (
      (body.userId !== undefined && String(body.userId) !== String(currentUser.id)) ||
      (body.id !== undefined && String(body.id) !== String(currentUser.id))
    ) {
      return sendJson(res, 403, {
        message: 'Forbidden. You can only modify your own profile and photo.',
      });
    }

    const fullName =
      body.fullName !== undefined ? String(body.fullName || '').trim() : auth.rawUser.fullName;

    if (!isValidDisplayName(fullName)) {
      return sendJson(res, 400, {
        message: 'Please enter a valid display name (1–100 characters, including at least one letter).',
      });
    }

    let nextAffiliation =
      auth.rawUser.campusAffiliation === 'student' || auth.rawUser.campusAffiliation === 'staff'
        ? auth.rawUser.campusAffiliation
        : null;

    if (body.campusAffiliation !== undefined) {
      const rawAff =
        body.campusAffiliation === null ? '' : String(body.campusAffiliation).trim().toLowerCase();
      if (rawAff === '') {
        nextAffiliation = null;
      } else if (rawAff === 'student' || rawAff === 'staff') {
        nextAffiliation = rawAff;
      } else {
        return sendJson(res, 400, {
          message: 'Please select a valid campus affiliation (Student or Staff).',
        });
      }
    }

    // Validate new avatar BEFORE mutating any user fields or replacing the existing avatar file
    let parsedAvatar = null;
    const shouldRemoveAvatar = Boolean(body.removeAvatar);
    if (!shouldRemoveAvatar && body.avatarDataUrl !== undefined && body.avatarDataUrl !== null) {
      parsedAvatar = validateAndParseAvatarDataUrl(body.avatarDataUrl);
    }

    // Apply validated updates atomically (keeping previous picture if anything above threw)
    if (shouldRemoveAvatar) {
      deleteAvatarFile(currentUser.id);
      auth.rawUser.hasProfilePhoto = false;
      auth.rawUser.profilePhotoUpdatedAt = null;
    } else if (parsedAvatar) {
      saveAvatarAtomically(currentUser.id, parsedAvatar);
      auth.rawUser.hasProfilePhoto = true;
      auth.rawUser.profilePhotoUpdatedAt = new Date().toISOString();
    }

    auth.rawUser.fullName = fullName;
    auth.rawUser.campusAffiliation = nextAffiliation;

    // Keep author display name synchronized on the user's published review
    // (never adding profile photos or affiliation to public reviews)
    for (const review of db.reviews) {
      if (String(review.authorId) === String(currentUser.id)) {
        review.authorName = fullName;
      }
    }
    saveDb(db);

    return sendJson(res, 200, {
      user: sanitizeUser(auth.rawUser, auth.persistence),
    });
  }

  // ---------------------------------------------------------------------------
  // 2. SHARED PERSISTENT REVIEWS & LIKES (/api/reviews/*)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/reviews' && req.method === 'GET') {
    const formatted = sortReviewsList(
      db.reviews.map((r) => formatReviewForClient(r, currentUser))
    );
    return sendJson(res, 200, { reviews: formatted });
  }

  if (pathname === '/api/reviews' && req.method === 'POST') {
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Please log in to share a campus parking review.' });
    }

    if (!checkRateLimit(`review-post:${currentUser.id}`, 10, 60_000)) {
      return sendJson(res, 429, { message: 'Too many review submissions. Please wait a moment before trying again.' });
    }

    const existingReview = db.reviews.find(
      (r) => String(r.authorId) === String(currentUser.id)
    );
    if (existingReview) {
      return sendJson(res, 409, {
        message: 'You have already published a review. You can edit or delete your existing review.',
      });
    }

    const body = await readJsonBody(req);
    const text = String(body.text || body.comment || '').trim();
    if (!text) {
      return sendJson(res, 400, { message: 'Please write your review before submitting.' });
    }
    if (text.length > 400) {
      return sendJson(res, 400, { message: 'Review text must be 400 characters or fewer.' });
    }

    const newReview = {
      id: `rev_${crypto.randomBytes(8).toString('hex')}`,
      authorId: currentUser.id,
      authorName: currentUser.fullName,
      text,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      likedBy: [],
    };

    db.reviews.push(newReview);
    saveDb(db);

    return sendJson(res, 201, {
      review: formatReviewForClient(newReview, currentUser),
    });
  }

  const reviewItemMatch = /^\/api\/reviews\/([^/]+)$/.exec(pathname);
  if (reviewItemMatch) {
    const reviewId = decodeURIComponent(reviewItemMatch[1]);
    const reviewIndex = db.reviews.findIndex((r) => String(r.id) === String(reviewId));

    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (!currentUser) {
        return sendJson(res, 401, { message: 'Please log in to edit your review.' });
      }
      if (reviewIndex === -1) {
        return sendJson(res, 404, { message: 'Review not found.' });
      }
      const target = db.reviews[reviewIndex];
      if (String(target.authorId) !== String(currentUser.id)) {
        return sendJson(res, 403, { message: 'You can only edit your own review.' });
      }
      if (!checkRateLimit(`review-edit:${currentUser.id}`, 15, 60_000)) {
        return sendJson(res, 429, { message: 'Too many edits. Please wait a moment and try again.' });
      }

      const body = await readJsonBody(req);
      const text = String(body.text || body.comment || '').trim();
      if (!text) {
        return sendJson(res, 400, { message: 'Review text cannot be empty.' });
      }
      if (text.length > 400) {
        return sendJson(res, 400, { message: 'Review text must be 400 characters or fewer.' });
      }

      target.text = text;
      target.authorName = currentUser.fullName;
      target.updatedAt = new Date().toISOString();
      saveDb(db);

      return sendJson(res, 200, {
        review: formatReviewForClient(target, currentUser),
      });
    }

    if (req.method === 'DELETE') {
      if (!currentUser) {
        return sendJson(res, 401, { message: 'Please log in to delete your review.' });
      }
      if (reviewIndex === -1) {
        return sendJson(res, 404, { message: 'Review not found.' });
      }
      const target = db.reviews[reviewIndex];
      if (String(target.authorId) !== String(currentUser.id)) {
        return sendJson(res, 403, { message: 'You can only delete your own review.' });
      }

      db.reviews.splice(reviewIndex, 1);
      saveDb(db);

      return sendJson(res, 200, { ok: true, id: reviewId });
    }
  }

  const reviewLikesMatch = /^\/api\/reviews\/([^/]+)\/likes$/.exec(pathname);
  if (reviewLikesMatch) {
    const reviewId = decodeURIComponent(reviewLikesMatch[1]);
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Please log in to like reviews.' });
    }
    const target = db.reviews.find((r) => String(r.id) === String(reviewId));
    if (!target) {
      return sendJson(res, 404, { message: 'Review not found.' });
    }
    if (!Array.isArray(target.likedBy)) {
      target.likedBy = [];
    }

    const userIdStr = String(currentUser.id);
    if (req.method === 'POST') {
      if (!target.likedBy.includes(userIdStr)) {
        target.likedBy.push(userIdStr);
        saveDb(db);
      }
      return sendJson(res, 200, {
        id: target.id,
        likeCount: target.likedBy.length,
        likedByCurrentUser: true,
      });
    }

    if (req.method === 'DELETE') {
      target.likedBy = target.likedBy.filter((uid) => String(uid) !== userIdStr);
      saveDb(db);
      return sendJson(res, 200, {
        id: target.id,
        likeCount: target.likedBy.length,
        likedByCurrentUser: false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. PARKING DISCOVERY & QR LOOKUP (/api/parking/*)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/parking' && req.method === 'GET') {
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Authentication required to view campus parking data.' });
    }

    const freshnessMinutes = Number(db.settings?.freshnessMinutes) || 60;
    const sections = db.sections.map((sec) =>
      computeEffectiveSection(sec, db.lots, freshnessMinutes)
    );

    const destinationsSet = new Set();
    for (const lot of db.lots) {
      if (lot.destination) destinationsSet.add(lot.destination);
    }
    for (const sec of db.sections) {
      if (sec.destination) destinationsSet.add(sec.destination);
    }

    return sendJson(res, 200, {
      lots: db.lots,
      sections,
      destinations: Array.from(destinationsSet),
      settings: {
        freshnessMinutes,
        staleVehicleHours: Number(db.settings?.staleVehicleHours) || 12,
      },
    });
  }

  const qrLookupMatch = /^\/api\/parking\/qr\/([^/]+)$/.exec(pathname);
  if (qrLookupMatch && req.method === 'GET') {
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }
    const rawCode = decodeURIComponent(qrLookupMatch[1]).trim();
    // Strict validation: never follow URLs or execute instructions
    if (!rawCode || rawCode.length > 64 || !/^[A-Za-z0-9_-]+$/.test(rawCode)) {
      return sendJson(res, 400, {
        message: 'Invalid QR section code format. Enter a valid alphanumeric section code.',
      });
    }

    const upperCode = rawCode.toUpperCase();
    const matchedSection = db.sections.find(
      (s) =>
        String(s.qrCode || '').toUpperCase() === upperCode ||
        String(s.code || '').toUpperCase() === upperCode ||
        String(s.id || '').toUpperCase() === upperCode
    );

    if (!matchedSection) {
      return sendJson(res, 404, {
        message: 'No configured campus parking section matches that QR or section code.',
      });
    }

    const freshnessMinutes = Number(db.settings?.freshnessMinutes) || 60;
    return sendJson(res, 200, {
      section: computeEffectiveSection(matchedSection, db.lots, freshnessMinutes),
    });
  }

  // ---------------------------------------------------------------------------
  // 4. SAVED VEHICLE PARKING SESSIONS (/api/sessions/*)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/sessions/active' && req.method === 'GET') {
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }
    const active = db.parkingSessions.find(
      (s) => String(s.userId) === String(currentUser.id) && s.active !== false
    );
    return sendJson(res, 200, {
      session: formatParkingSessionForClient(active || null, db),
    });
  }

  if (pathname === '/api/sessions' && req.method === 'POST') {
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Authentication required to save a parking location.' });
    }

    // Allow up to 3MB body for optional private surroundings photo
    const body = await readJsonBody(req, 3 * 1024 * 1024);

    const vehicleType = String(body.vehicleType || 'car').toLowerCase();
    if (!['bike', 'car', 'other'].includes(vehicleType)) {
      return sendJson(res, 400, { message: 'Please select a valid vehicle type (bike, car, or other).' });
    }

    const sectionId = String(body.sectionId || '').trim();
    const lotId = String(body.lotId || '').trim();
    const matchedSection = sectionId ? db.sections.find((s) => s.id === sectionId) : null;
    const matchedLot = matchedSection
      ? db.lots.find((l) => l.id === matchedSection.lotId)
      : lotId
      ? db.lots.find((l) => l.id === lotId)
      : null;

    const customLotName = String(body.lotName || '').trim();
    const customSectionName = String(body.sectionName || '').trim();

    if (!matchedSection && (!customLotName || !customSectionName)) {
      return sendJson(res, 400, {
        message: 'Please select a parking lot and vehicle section (or enter the lot and section names).',
      });
    }

    if (matchedSection && Array.isArray(matchedSection.vehicleTypes)) {
      if (!matchedSection.vehicleTypes.includes(vehicleType)) {
        return sendJson(res, 400, {
          message: `Selected section (${matchedSection.name}) does not accept ${vehicleType} vehicles.`,
        });
      }
    }

    // Prevent accidental duplicate active sessions for the same user
    const existingActiveIndex = db.parkingSessions.findIndex(
      (s) => String(s.userId) === String(currentUser.id) && s.active !== false
    );
    if (existingActiveIndex !== -1 && !body.replaceActive) {
      return sendJson(res, 409, {
        code: 'ACTIVE_SESSION_EXISTS',
        message:
          'You already have an active parked vehicle saved. Use "Correct location" to update it, or confirm replacing your active session.',
      });
    }

    let sessionId = `ps_${crypto.randomBytes(8).toString('hex')}`;
    if (existingActiveIndex !== -1) {
      sessionId = db.parkingSessions[existingActiveIndex].id;
    }

    let hasPhoto = existingActiveIndex !== -1 ? Boolean(db.parkingSessions[existingActiveIndex].hasPhoto) : false;
    if (body.removePhoto) {
      deletePrivatePhoto(sessionId);
      hasPhoto = false;
    } else if (body.photoDataUrl) {
      savePrivatePhoto(sessionId, body.photoDataUrl);
      hasPhoto = true;
    }

    const nowIso = new Date().toISOString();
    const parkedAtIso =
      body.parkedAt && !Number.isNaN(Date.parse(body.parkedAt))
        ? new Date(body.parkedAt).toISOString()
        : existingActiveIndex !== -1 && body.preserveParkedTime
        ? db.parkingSessions[existingActiveIndex].parkedAt
        : nowIso;

    const lat =
      typeof body.latitude === 'number' && Number.isFinite(body.latitude) ? body.latitude : null;
    const lng =
      typeof body.longitude === 'number' && Number.isFinite(body.longitude) ? body.longitude : null;

    const record = {
      id: sessionId,
      userId: currentUser.id,
      active: true,
      lotId: matchedLot ? matchedLot.id : lotId,
      lotName: matchedLot ? matchedLot.name : customLotName,
      sectionId: matchedSection ? matchedSection.id : sectionId,
      sectionName: matchedSection ? matchedSection.name : customSectionName,
      sectionCode: matchedSection ? matchedSection.code : String(body.sectionCode || '').trim(),
      entrance: matchedSection ? matchedSection.entrance : String(body.entrance || '').trim(),
      destination: matchedSection ? matchedSection.destination : String(body.destination || '').trim(),
      vehicleType,
      vehicleLabel: String(body.vehicleLabel || '').trim().slice(0, 80),
      row: String(body.row || '').trim().slice(0, 40),
      bay: String(body.bay || '').trim().slice(0, 40),
      parkedAt: parkedAtIso,
      lastConfirmedAt: nowIso,
      note: String(body.note || '').trim().slice(0, 300),
      latitude: lat,
      longitude: lng,
      hasPhoto,
      updatedAt: nowIso,
    };

    if (existingActiveIndex !== -1) {
      db.parkingSessions[existingActiveIndex] = record;
    } else {
      db.parkingSessions.push(record);
    }

    // IMPORTANT: Saving a user parking session is a private memory aid and MUST NOT
    // automatically alter verified physical occupancy on `db.sections`.
    saveDb(db);

    return sendJson(res, existingActiveIndex !== -1 ? 200 : 201, {
      session: formatParkingSessionForClient(record, db),
    });
  }

  const sessionPhotoMatch = /^\/api\/sessions\/([^/]+)\/photo$/.exec(pathname);
  if (sessionPhotoMatch && req.method === 'GET') {
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }
    const sessionId = decodeURIComponent(sessionPhotoMatch[1]);
    const session = db.parkingSessions.find((s) => String(s.id) === String(sessionId));
    if (!session) {
      return sendJson(res, 404, { message: 'Parking session not found.' });
    }
    if (String(session.userId) !== String(currentUser.id)) {
      return sendJson(res, 403, { message: 'Access denied. Saved vehicle photos are private to their owner.' });
    }

    const photoPath = path.join(PRIVATE_PHOTOS_DIR, `${session.id}.json`);
    if (!fs.existsSync(photoPath)) {
      return sendJson(res, 404, { message: 'No private photo saved for this session.' });
    }

    try {
      const { mimeType, base64Data } = JSON.parse(fs.readFileSync(photoPath, 'utf8'));
      const imgBuffer = Buffer.from(base64Data, 'base64');
      res.writeHead(200, {
        'Content-Type': mimeType || 'image/jpeg',
        'Cache-Control': 'private, no-store',
      });
      res.end(imgBuffer);
      return;
    } catch {
      return sendJson(res, 500, { message: 'Unable to load saved photo.' });
    }
  }

  const sessionItemMatch = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
  if (sessionItemMatch) {
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }
    const sessionId = decodeURIComponent(sessionItemMatch[1]);
    const idx = db.parkingSessions.findIndex((s) => String(s.id) === String(sessionId));
    if (idx === -1) {
      return sendJson(res, 404, { message: 'Parking session not found.' });
    }
    const target = db.parkingSessions[idx];
    if (String(target.userId) !== String(currentUser.id)) {
      return sendJson(res, 403, {
        message: 'Access denied. Saved vehicle locations are private to their owner.',
      });
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = await readJsonBody(req, 3 * 1024 * 1024);

      if (body.confirmStillParked) {
        target.lastConfirmedAt = new Date().toISOString();
        saveDb(db);
        return sendJson(res, 200, {
          session: formatParkingSessionForClient(target, db),
        });
      }

      if (body.vehicleType) {
        const vt = String(body.vehicleType).toLowerCase();
        if (!['bike', 'car', 'other'].includes(vt)) {
          return sendJson(res, 400, { message: 'Invalid vehicle type.' });
        }
        target.vehicleType = vt;
      }

      if (body.sectionId !== undefined || body.lotId !== undefined) {
        const secId = String(body.sectionId ?? target.sectionId).trim();
        const lId = String(body.lotId ?? target.lotId).trim();
        const matchedSec = secId ? db.sections.find((s) => s.id === secId) : null;
        const matchedLot = matchedSec
          ? db.lots.find((l) => l.id === matchedSec.lotId)
          : lId
          ? db.lots.find((l) => l.id === lId)
          : null;

        if (matchedSec) {
          if (
            Array.isArray(matchedSec.vehicleTypes) &&
            !matchedSec.vehicleTypes.includes(target.vehicleType)
          ) {
            return sendJson(res, 400, {
              message: `Selected section (${matchedSec.name}) does not accept ${target.vehicleType} vehicles.`,
            });
          }
          target.sectionId = matchedSec.id;
          target.sectionName = matchedSec.name;
          target.sectionCode = matchedSec.code;
          target.entrance = matchedSec.entrance || '';
          target.destination = matchedSec.destination || '';
          target.lotId = matchedLot ? matchedLot.id : matchedSec.lotId;
          target.lotName = matchedLot ? matchedLot.name : target.lotName;
        } else if (body.lotName || body.sectionName) {
          target.lotName = String(body.lotName || target.lotName).trim();
          target.sectionName = String(body.sectionName || target.sectionName).trim();
        }
      }

      if (body.vehicleLabel !== undefined) {
        target.vehicleLabel = String(body.vehicleLabel || '').trim().slice(0, 80);
      }
      if (body.row !== undefined) {
        target.row = String(body.row || '').trim().slice(0, 40);
      }
      if (body.bay !== undefined) {
        target.bay = String(body.bay || '').trim().slice(0, 40);
      }
      if (body.note !== undefined) {
        target.note = String(body.note || '').trim().slice(0, 300);
      }
      if (body.latitude !== undefined) {
        target.latitude =
          typeof body.latitude === 'number' && Number.isFinite(body.latitude) ? body.latitude : null;
      }
      if (body.longitude !== undefined) {
        target.longitude =
          typeof body.longitude === 'number' && Number.isFinite(body.longitude)
            ? body.longitude
            : null;
      }
      if (body.removePhoto) {
        deletePrivatePhoto(target.id);
        target.hasPhoto = false;
      } else if (body.photoDataUrl) {
        savePrivatePhoto(target.id, body.photoDataUrl);
        target.hasPhoto = true;
      }

      target.updatedAt = new Date().toISOString();
      target.lastConfirmedAt = target.updatedAt;
      saveDb(db);

      return sendJson(res, 200, {
        session: formatParkingSessionForClient(target, db),
      });
    }

    if (req.method === 'DELETE') {
      deletePrivatePhoto(target.id);
      db.parkingSessions.splice(idx, 1);
      saveDb(db);
      return sendJson(res, 200, { ok: true, id: sessionId });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. USER SECTION ISSUE REPORTS (/api/reports)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/reports' && req.method === 'POST') {
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Authentication required to submit a section report.' });
    }
    if (!checkRateLimit(`report:${currentUser.id}`, 10, 60_000)) {
      return sendJson(res, 429, { message: 'Too many reports submitted recently. Please try again later.' });
    }

    const body = await readJsonBody(req);
    const sectionId = String(body.sectionId || '').trim();
    const issueType = String(body.issueType || 'incorrect_status').trim().slice(0, 60);
    const description = String(body.description || '').trim().slice(0, 400);

    if (!sectionId || !description) {
      return sendJson(res, 400, { message: 'Please select a section and describe the issue.' });
    }

    const section = db.sections.find((s) => s.id === sectionId);
    const report = {
      id: `rep_${crypto.randomBytes(8).toString('hex')}`,
      sectionId,
      sectionName: section ? section.name : String(body.sectionName || 'Campus Section'),
      issueType,
      description,
      reporterId: currentUser.id,
      reporterName: currentUser.fullName,
      status: 'pending',
      staffNote: '',
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
    };

    // Unverified user reports NEVER automatically mutate trusted section occupancy
    db.reports.unshift(report);
    saveDb(db);

    return sendJson(res, 201, { report });
  }

  // ---------------------------------------------------------------------------
  // 6. PROTECTED ROLE-BASED STAFF CONTROLS (/api/staff/*)
  // ---------------------------------------------------------------------------
  if (pathname.startsWith('/api/staff')) {
    if (!currentUser) {
      return sendJson(res, 401, { message: 'Authentication required.' });
    }
    if (currentUser.role !== 'staff' && currentUser.role !== 'admin') {
      return sendJson(res, 403, {
        message: 'Forbidden. Authorized campus parking staff permissions are required.',
      });
    }

    if (pathname === '/api/staff/overview' && req.method === 'GET') {
      const freshnessMinutes = Number(db.settings?.freshnessMinutes) || 60;
      return sendJson(res, 200, {
        lots: db.lots,
        sections: db.sections.map((s) => computeEffectiveSection(s, db.lots, freshnessMinutes)),
        reports: db.reports,
        statusHistory: db.statusHistory.slice(0, 100),
        settings: db.settings,
      });
    }

    if (pathname === '/api/staff/lots' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      const code = String(body.code || '').trim().toUpperCase();
      const destination = String(body.destination || '').trim();
      const description = String(body.description || '').trim();

      if (!name || !code || !destination) {
        return sendJson(res, 400, {
          message: 'Lot name, short identifier code, and nearby academic destination are required.',
        });
      }

      const lot = {
        id: `lot_${crypto.randomBytes(6).toString('hex')}`,
        name,
        code,
        destination,
        description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.lots.push(lot);
      saveDb(db);
      return sendJson(res, 201, { lot });
    }

    const staffLotMatch = /^\/api\/staff\/lots\/([^/]+)$/.exec(pathname);
    if (staffLotMatch && req.method === 'PUT') {
      const lotId = decodeURIComponent(staffLotMatch[1]);
      const lot = db.lots.find((l) => l.id === lotId);
      if (!lot) {
        return sendJson(res, 404, { message: 'Parking lot not found.' });
      }
      const body = await readJsonBody(req);
      if (body.name) lot.name = String(body.name).trim();
      if (body.code) lot.code = String(body.code).trim().toUpperCase();
      if (body.destination) lot.destination = String(body.destination).trim();
      if (body.description !== undefined) lot.description = String(body.description).trim();
      lot.updatedAt = new Date().toISOString();
      saveDb(db);
      return sendJson(res, 200, { lot });
    }

    if (pathname === '/api/staff/sections' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const lotId = String(body.lotId || '').trim();
      const lot = db.lots.find((l) => l.id === lotId);
      if (!lot) {
        return sendJson(res, 400, { message: 'Please select a valid parent parking lot.' });
      }

      const name = String(body.name || '').trim();
      const code = String(body.code || '').trim().toUpperCase();
      const qrCode = String(body.qrCode || code).trim().toUpperCase();
      const entrance = String(body.entrance || '').trim();
      const destination = String(body.destination || lot.destination || '').trim();

      if (!name || !code || !entrance) {
        return sendJson(res, 400, {
          message: 'Section name, short code, and entrance location are required.',
        });
      }

      const rawVehicleTypes = Array.isArray(body.vehicleTypes) ? body.vehicleTypes : [];
      const vehicleTypes = rawVehicleTypes
        .map((v) => String(v).toLowerCase())
        .filter((v) => ['bike', 'car', 'other'].includes(v));

      if (vehicleTypes.length === 0) {
        return sendJson(res, 400, {
          message: 'Select at least one accepted vehicle type (bike, car, or other).',
        });
      }

      const validStatuses = ['Available', 'Limited', 'Full', 'Closed', 'Unknown'];
      const status = validStatuses.includes(body.status) ? body.status : 'Available';
      const capacity =
        body.capacity !== undefined && body.capacity !== '' && Number(body.capacity) > 0
          ? Math.round(Number(body.capacity))
          : null;
      const hasReliableCount = Boolean(body.hasReliableCount);
      const availableSpaces =
        hasReliableCount &&
        body.availableSpaces !== undefined &&
        body.availableSpaces !== '' &&
        Number.isFinite(Number(body.availableSpaces))
          ? Math.max(0, Math.round(Number(body.availableSpaces)))
          : null;

      const nowIso = new Date().toISOString();
      const section = {
        id: `sec_${crypto.randomBytes(6).toString('hex')}`,
        lotId: lot.id,
        name,
        code,
        qrCode,
        vehicleTypes,
        destination,
        entrance,
        capacity,
        hasReliableCount,
        availableSpaces,
        restrictions: String(body.restrictions || 'Students & Staff').trim(),
        status,
        closureReason: status === 'Closed' ? String(body.closureReason || '').trim() : '',
        source: String(body.source || 'Staff Configuration').trim(),
        updatedBy: currentUser.fullName,
        updatedAt: nowIso,
        latitude:
          body.latitude !== undefined && body.latitude !== '' && Number.isFinite(Number(body.latitude))
            ? Number(body.latitude)
            : null,
        longitude:
          body.longitude !== undefined && body.longitude !== '' && Number.isFinite(Number(body.longitude))
            ? Number(body.longitude)
            : null,
      };

      db.sections.push(section);
      db.statusHistory.unshift({
        id: `hist_${crypto.randomBytes(6).toString('hex')}`,
        sectionId: section.id,
        sectionName: section.name,
        sectionCode: section.code,
        previousStatus: 'None',
        newStatus: section.status,
        availableSpaces: section.availableSpaces,
        source: section.source,
        updatedBy: currentUser.fullName,
        note: section.closureReason || 'Initial section creation',
        timestamp: nowIso,
      });

      saveDb(db);
      const freshnessMinutes = Number(db.settings?.freshnessMinutes) || 60;
      return sendJson(res, 201, {
        section: computeEffectiveSection(section, db.lots, freshnessMinutes),
      });
    }

    const staffSectionStatusMatch = /^\/api\/staff\/sections\/([^/]+)\/status$/.exec(pathname);
    if (
      staffSectionStatusMatch &&
      (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')
    ) {
      const sectionId = decodeURIComponent(staffSectionStatusMatch[1]);
      const section = db.sections.find((s) => s.id === sectionId);
      if (!section) {
        return sendJson(res, 404, { message: 'Parking section not found.' });
      }

      const body = await readJsonBody(req);
      const validStatuses = ['Available', 'Limited', 'Full', 'Closed', 'Unknown'];
      if (!validStatuses.includes(body.status)) {
        return sendJson(res, 400, { message: 'Please select a valid availability status.' });
      }

      const prevStatus = section.status || 'Unknown';
      section.status = body.status;
      section.closureReason =
        body.status === 'Closed' ? String(body.closureReason || 'Closed for maintenance/event').trim() : '';

      if (body.hasReliableCount !== undefined) {
        section.hasReliableCount = Boolean(body.hasReliableCount);
      }
      if (
        section.hasReliableCount &&
        body.availableSpaces !== undefined &&
        body.availableSpaces !== '' &&
        Number.isFinite(Number(body.availableSpaces))
      ) {
        section.availableSpaces = Math.max(0, Math.round(Number(body.availableSpaces)));
      } else if (!section.hasReliableCount) {
        section.availableSpaces = null;
      }

      const nowIso = new Date().toISOString();
      section.source = String(body.source || 'Staff Patrol Update').trim();
      section.updatedBy = currentUser.fullName;
      section.updatedAt = nowIso;

      const historyEntry = {
        id: `hist_${crypto.randomBytes(6).toString('hex')}`,
        sectionId: section.id,
        sectionName: section.name,
        sectionCode: section.code,
        previousStatus: prevStatus,
        newStatus: section.status,
        availableSpaces: section.availableSpaces,
        source: section.source,
        updatedBy: currentUser.fullName,
        note: String(body.note || section.closureReason || '').trim(),
        timestamp: nowIso,
      };
      db.statusHistory.unshift(historyEntry);
      saveDb(db);

      const freshnessMinutes = Number(db.settings?.freshnessMinutes) || 60;
      return sendJson(res, 200, {
        section: computeEffectiveSection(section, db.lots, freshnessMinutes),
        historyEntry,
      });
    }

    const staffSectionEditMatch = /^\/api\/staff\/sections\/([^/]+)$/.exec(pathname);
    if (staffSectionEditMatch && req.method === 'PUT') {
      const sectionId = decodeURIComponent(staffSectionEditMatch[1]);
      const section = db.sections.find((s) => s.id === sectionId);
      if (!section) {
        return sendJson(res, 404, { message: 'Parking section not found.' });
      }

      const body = await readJsonBody(req);
      if (body.lotId && db.lots.some((l) => l.id === body.lotId)) {
        section.lotId = body.lotId;
      }
      if (body.name) section.name = String(body.name).trim();
      if (body.code) section.code = String(body.code).trim().toUpperCase();
      if (body.qrCode) section.qrCode = String(body.qrCode).trim().toUpperCase();
      if (body.destination !== undefined) section.destination = String(body.destination).trim();
      if (body.entrance !== undefined) section.entrance = String(body.entrance).trim();
      if (body.restrictions !== undefined) section.restrictions = String(body.restrictions).trim();
      if (Array.isArray(body.vehicleTypes)) {
        const vt = body.vehicleTypes
          .map((v) => String(v).toLowerCase())
          .filter((v) => ['bike', 'car', 'other'].includes(v));
        if (vt.length > 0) section.vehicleTypes = vt;
      }
      if (body.capacity !== undefined) {
        section.capacity =
          body.capacity !== '' && Number(body.capacity) > 0
            ? Math.round(Number(body.capacity))
            : null;
      }
      if (body.hasReliableCount !== undefined) {
        section.hasReliableCount = Boolean(body.hasReliableCount);
      }
      if (body.availableSpaces !== undefined) {
        section.availableSpaces =
          section.hasReliableCount &&
          body.availableSpaces !== '' &&
          Number.isFinite(Number(body.availableSpaces))
            ? Math.max(0, Math.round(Number(body.availableSpaces)))
            : null;
      }
      if (body.latitude !== undefined) {
        section.latitude =
          body.latitude !== '' && Number.isFinite(Number(body.latitude))
            ? Number(body.latitude)
            : null;
      }
      if (body.longitude !== undefined) {
        section.longitude =
          body.longitude !== '' && Number.isFinite(Number(body.longitude))
            ? Number(body.longitude)
            : null;
      }

      section.updatedAt = new Date().toISOString();
      section.updatedBy = currentUser.fullName;
      saveDb(db);

      const freshnessMinutes = Number(db.settings?.freshnessMinutes) || 60;
      return sendJson(res, 200, {
        section: computeEffectiveSection(section, db.lots, freshnessMinutes),
      });
    }

    const staffReportMatch = /^\/api\/staff\/reports\/([^/]+)$/.exec(pathname);
    if (staffReportMatch && (req.method === 'PUT' || req.method === 'PATCH')) {
      const reportId = decodeURIComponent(staffReportMatch[1]);
      const report = db.reports.find((r) => r.id === reportId);
      if (!report) {
        return sendJson(res, 404, { message: 'Report not found.' });
      }
      const body = await readJsonBody(req);
      if (['pending', 'reviewed', 'dismissed'].includes(body.status)) {
        report.status = body.status;
      }
      if (body.staffNote !== undefined) {
        report.staffNote = String(body.staffNote).trim().slice(0, 300);
      }
      report.reviewedAt = new Date().toISOString();
      report.reviewedBy = currentUser.fullName;
      saveDb(db);
      return sendJson(res, 200, { report });
    }

    if (pathname === '/api/staff/settings' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (body.freshnessMinutes !== undefined) {
        const fm = Number(body.freshnessMinutes);
        if (!Number.isFinite(fm) || fm < 1 || fm > 10_080) {
          return sendJson(res, 400, {
            message: 'Freshness policy must be between 1 and 10,080 minutes.',
          });
        }
        db.settings.freshnessMinutes = Math.round(fm);
      }
      if (body.staleVehicleHours !== undefined) {
        const sh = Number(body.staleVehicleHours);
        if (Number.isFinite(sh) && sh >= 1 && sh <= 720) {
          db.settings.staleVehicleHours = Math.round(sh);
        }
      }
      saveDb(db);
      return sendJson(res, 200, { settings: db.settings });
    }
  }

  return sendJson(res, 404, { message: 'API endpoint not found.' });
}

function getNetworkUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return urls;
}

export function createParktraceServer() {
  return http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
      let pathname = decodeURIComponent(reqUrl.pathname);

      // Handle API routes
      if (pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, pathname);
        return;
      }

      if (pathname === '/') pathname = '/index.html';

      // Block direct static access to private server storage (/data/*) and hidden files
      const normalizedRel = path.posix.normalize(pathname.replace(/\\/g, '/'));
      if (
        normalizedRel.startsWith('/data/') ||
        normalizedRel === '/data' ||
        normalizedRel.startsWith('/.')
      ) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      const safePath = path.normalize(path.join(__dirname, pathname));
      if (!safePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      fs.readFile(safePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }

        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    } catch (err) {
      const status = err?.statusCode || 500;
      sendJson(res, status, {
        message: err?.message || 'An unexpected server error occurred.',
      });
    }
  });
}

if (path.resolve(process.argv[1] || '') === __filename) {
  const server = createParktraceServer();
  server.listen(PORT, HOST, () => {
    console.log(`PARKTRACE local server running at http://localhost:${PORT}`);
    const netUrls = getNetworkUrls(PORT);
    for (const url of netUrls) {
      console.log(`PARKTRACE network URL: ${url}`);
    }
  });
}
