/**
 * Campus Parking Discovery, Saved Vehicle Sessions & Staff Maintenance Service
 * (js/services/parkingService.js)
 *
 * GitHub Pages & Static-Host Compatible:
 * - Operates directly in the browser without calling relative `/api/parking` or
 *   `/api/sessions` routes (preventing 404 / 405 Method Not Allowed on GitHub Pages).
 */

import { authService } from './authService.js?v=sb8';

const STATUS_PRIORITY = {
  Available: 1,
  Limited: 2,
  Unknown: 3,
  Full: 4,
  Closed: 5,
};

const STORAGE_KEYS = {
  catalog: 'parktrace.parking_catalog.v2',
  sessions: 'parktrace.parking_sessions.v2',
  reports: 'parktrace.section_reports.v2',
  auditLogs: 'parktrace.staff_audit_logs.v2',
};

function createInitialCatalog() {
  const nowIso = new Date().toISOString();
  return {
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
        code: 'LOT-A',
        name: 'North Academic Lot A',
        destination: 'Academic Block A',
        nearestDestinations: ['Academic Block A', 'Central Library & Research Hub'],
        description: 'Covered and open bays directly adjacent to Academic Block A North Gate.',
        active: true,
      },
      {
        id: 'lot-east-innovation',
        code: 'LOT-B',
        name: 'East Innovation Lot B',
        destination: 'Academic Block B',
        nearestDestinations: ['Academic Block B', 'Engineering & Innovation Wing'],
        description: 'Multi-section transit bay serving Engineering labs and Block B lecture halls.',
        active: true,
      },
      {
        id: 'lot-south-commons',
        code: 'LOT-C',
        name: 'South Commons Lot C',
        destination: 'Student Activity Center',
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
        qrCode: 'PT-SEC-A1',
        name: 'Section A1 — Two-Wheeler Deck',
        vehicleTypes: ['bike'],
        destination: 'Academic Block A',
        walkingMinutes: 2,
        accessRule: 'general',
        accessLabel: 'Students & Staff Permit',
        restrictions: 'Students & Staff Permit',
        capacity: 120,
        totalCapacity: 120,
        availableSpaces: 34,
        availableSpots: 34,
        hasReliableCount: true,
        status: 'Available',
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        source: 'Campus Attendant Desk',
        rows: ['Row A', 'Row B', 'Row C', 'Row D'],
        entrance: 'Gate 1 — Opposite Block A Main Stairwell & Security Kiosk',
        landmarkHint: 'Gate 1 — Opposite Block A Main Stairwell & Security Kiosk',
        latitude: 31.2554,
        longitude: 75.7049,
      },
      {
        id: 'sec-a-car-2',
        lotId: 'lot-north-academic',
        code: 'PT-SEC-A2',
        qrCode: 'PT-SEC-A2',
        name: 'Section A2 — Four-Wheeler Court',
        vehicleTypes: ['car'],
        destination: 'Academic Block A',
        walkingMinutes: 3,
        accessRule: 'general',
        accessLabel: 'Students & Staff Permit',
        restrictions: 'Students & Staff Permit',
        capacity: 45,
        totalCapacity: 45,
        availableSpaces: 5,
        availableSpots: 5,
        hasReliableCount: true,
        status: 'Limited',
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        source: 'Campus Attendant Desk',
        rows: ['Row 1', 'Row 2', 'Row 3'],
        entrance: 'North Gate Solar Canopy Entrance',
        landmarkHint: 'North Gate Solar Canopy Entrance',
        latitude: 31.2558,
        longitude: 75.7053,
      },
      {
        id: 'sec-a-accessible-3',
        lotId: 'lot-north-academic',
        code: 'PT-SEC-A3',
        qrCode: 'PT-SEC-A3',
        name: 'Section A3 — Accessible & EV Priority Bays',
        vehicleTypes: ['bike', 'car', 'other'],
        destination: 'Central Library & Research Hub',
        walkingMinutes: 1,
        accessRule: 'accessible',
        accessLabel: 'Accessible / EV Priority Permit',
        restrictions: 'Accessible / EV Priority Permit',
        capacity: 20,
        totalCapacity: 20,
        availableSpaces: 9,
        availableSpots: 9,
        hasReliableCount: true,
        status: 'Available',
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        source: 'Campus Attendant Desk',
        rows: ['Priority Row P1', 'Priority Row P2'],
        entrance: 'Step-free ramp entrance beside Central Library West Doors',
        landmarkHint: 'Step-free ramp entrance beside Central Library West Doors',
        latitude: 31.2549,
        longitude: 75.7042,
      },
      {
        id: 'sec-b-bike-1',
        lotId: 'lot-east-innovation',
        code: 'PT-SEC-B1',
        qrCode: 'PT-SEC-B1',
        name: 'Section B1 — East Bike & Scooter Bay',
        vehicleTypes: ['bike'],
        destination: 'Engineering & Innovation Wing',
        walkingMinutes: 2,
        accessRule: 'general',
        accessLabel: 'Students & Staff Permit',
        restrictions: 'Students & Staff Permit',
        capacity: 150,
        totalCapacity: 150,
        availableSpaces: 0,
        availableSpots: 0,
        hasReliableCount: true,
        status: 'Full',
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        source: 'Campus Attendant Desk',
        rows: ['Row E1', 'Row E2', 'Row E3', 'Row E4'],
        entrance: 'East Gate — Beside Robotics Workshop Entrance',
        landmarkHint: 'East Gate — Beside Robotics Workshop Entrance',
        latitude: 31.2537,
        longitude: 75.7068,
      },
      {
        id: 'sec-b-car-2',
        lotId: 'lot-east-innovation',
        code: 'PT-SEC-B2',
        qrCode: 'PT-SEC-B2',
        name: 'Section B2 — East Car & Utility Section',
        vehicleTypes: ['car', 'other'],
        destination: 'Academic Block B',
        walkingMinutes: 3,
        accessRule: 'general',
        accessLabel: 'Students & Staff Permit',
        restrictions: 'Students & Staff Permit',
        capacity: 60,
        totalCapacity: 60,
        availableSpaces: 22,
        availableSpots: 22,
        hasReliableCount: true,
        status: 'Available',
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        source: 'Campus Attendant Desk',
        rows: ['Row C1', 'Row C2', 'Row C3'],
        entrance: 'Adjacent to Block B Amphitheater Walkway',
        landmarkHint: 'Adjacent to Block B Amphitheater Walkway',
        latitude: 31.2533,
        longitude: 75.7061,
      },
      {
        id: 'sec-c-multi-1',
        lotId: 'lot-south-commons',
        code: 'PT-SEC-C1',
        qrCode: 'PT-SEC-C1',
        name: 'Section C1 — South Overflow Two-Wheeler Zone',
        vehicleTypes: ['bike'],
        destination: 'Student Activity Center',
        walkingMinutes: 4,
        accessRule: 'general',
        accessLabel: 'Students & Staff Permit',
        restrictions: 'Students & Staff Permit',
        capacity: 180,
        totalCapacity: 180,
        availableSpaces: 92,
        availableSpots: 92,
        hasReliableCount: true,
        status: 'Available',
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        source: 'Campus Attendant Desk',
        rows: ['Row S1', 'Row S2', 'Row S3', 'Row S4', 'Row S5'],
        entrance: 'Covered walkway linking South Commons to Activity Center',
        landmarkHint: 'Covered walkway linking South Commons to Activity Center',
        latitude: 31.2521,
        longitude: 75.7039,
      },
      {
        id: 'sec-c-staff-2',
        lotId: 'lot-south-commons',
        code: 'PT-SEC-C2',
        qrCode: 'PT-SEC-C2',
        name: 'Section C2 — Faculty & Staff Reserved Court',
        vehicleTypes: ['bike', 'car', 'other'],
        destination: 'Administrative & Security Complex',
        walkingMinutes: 2,
        accessRule: 'staff_only',
        accessLabel: 'Staff & Faculty Permit Only',
        restrictions: 'Staff & Faculty Permit Only',
        capacity: 40,
        totalCapacity: 40,
        availableSpaces: 14,
        availableSpots: 14,
        hasReliableCount: true,
        status: 'Available',
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        source: 'Campus Attendant Desk',
        rows: ['Staff Row R1', 'Staff Row R2'],
        entrance: 'Behind Administrative Block Security Barrier',
        landmarkHint: 'Behind Administrative Block Security Barrier',
        latitude: 31.2518,
        longitude: 75.7032,
      },
    ],
  };
}

function readJsonStorage(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

function normalizeSectionRecord(section, settings, lotName = 'Campus Parking Lot') {
  const thresholdMs = (Number(settings?.freshnessMinutes) || 60) * 60 * 1000;
  const updatedMs = section.updatedAt ? Date.parse(section.updatedAt) : 0;
  const ageMs = updatedMs ? Math.max(0, Date.now() - updatedMs) : Infinity;
  const isStale = !updatedMs || ageMs > thresholdMs;

  const capacity = Number(section.capacity ?? section.totalCapacity ?? 0) || null;
  const availableSpaces =
    section.availableSpaces !== undefined && section.availableSpaces !== null
      ? Number(section.availableSpaces)
      : section.availableSpots !== undefined && section.availableSpots !== null
      ? Number(section.availableSpots)
      : null;

  return {
    ...section,
    lotName: section.lotName || lotName,
    capacity,
    totalCapacity: capacity || 50,
    availableSpaces,
    availableSpots: availableSpaces ?? 0,
    hasReliableCount: Boolean(
      section.hasReliableCount ?? (availableSpaces !== null && !Number.isNaN(availableSpaces))
    ),
    entrance: section.entrance || section.landmarkHint || 'Main lot entrance',
    landmarkHint: section.landmarkHint || section.entrance || 'Main lot entrance',
    restrictions: section.restrictions || section.accessLabel || 'Standard campus permit',
    accessLabel: section.accessLabel || section.restrictions || 'Standard campus permit',
    source: section.source || section.updatedBy || 'Staff',
    updatedBy: section.updatedBy || section.source || 'Staff',
    recordedStatus: section.status || 'Available',
    isStale,
    ageMinutes: Number.isFinite(ageMs) ? Math.floor(ageMs / 60000) : null,
    effectiveStatus: isStale && section.status !== 'Closed' ? 'Unknown' : section.status,
  };
}

function computeSessionState(session, settings, catalog = null) {
  if (!session) return null;
  const staleHours = Number(settings?.staleVehicleHours) || 12;
  const parkedMs = session.parkedAt ? Date.parse(session.parkedAt) : Date.now();
  const elapsedMs = Math.max(0, Date.now() - parkedMs);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const isLongRunning = elapsedMs > staleHours * 3600 * 1000;

  const matchedSec = catalog?.sections?.find((s) => s.id === session.sectionId);
  const rowVal = String(session.row ?? session.rowIdentifier ?? '').trim();
  const bayVal = String(session.bay ?? session.bayIdentifier ?? '').trim();
  const noteVal = String(session.note ?? session.landmarkNote ?? '').trim();

  const lat =
    typeof session.latitude === 'number'
      ? session.latitude
      : typeof session.gpsCoords?.latitude === 'number'
      ? session.gpsCoords.latitude
      : typeof matchedSec?.latitude === 'number'
      ? matchedSec.latitude
      : null;

  const lng =
    typeof session.longitude === 'number'
      ? session.longitude
      : typeof session.gpsCoords?.longitude === 'number'
      ? session.gpsCoords.longitude
      : typeof matchedSec?.longitude === 'number'
      ? matchedSec.longitude
      : null;

  return {
    id: session.id,
    userId: session.userId,
    lotId: session.lotId,
    lotName: session.lotName || 'Campus Parking Lot',
    sectionId: session.sectionId,
    sectionCode: session.sectionCode || matchedSec?.code || '',
    sectionName: session.sectionName || matchedSec?.name || 'Campus Section',
    vehicleType: session.vehicleType || 'bike',
    row: rowVal,
    rowIdentifier: rowVal,
    bay: bayVal,
    bayIdentifier: bayVal,
    note: noteVal,
    landmarkNote: noteVal,
    entrance:
      session.entrance ||
      matchedSec?.entrance ||
      matchedSec?.landmarkHint ||
      'Follow main lot entrance signage',
    destination: session.destination || matchedSec?.destination || '',
    latitude: lat,
    longitude: lng,
    gpsCoords: lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null,
    hasPhoto: Boolean(session.photoDataUrl),
    photoUrl: session.photoDataUrl || null,
    parkedAt: session.parkedAt,
    updatedAt: session.updatedAt,
    elapsedMinutes,
    isLongRunning,
    staleThresholdHours: staleHours,
  };
}

export function recommendParkingSections(
  sections = [],
  { vehicleType = '', destination = '' } = {}
) {
  const cleanVehicle = (vehicleType || '').trim().toLowerCase();
  const cleanDest = (destination || '').trim().toLowerCase();

  const compatible = sections.filter((sec) => {
    if (!cleanVehicle) return true;
    const types = Array.isArray(sec.vehicleTypes) ? sec.vehicleTypes : [];
    return types.map((t) => String(t).toLowerCase()).includes(cleanVehicle);
  });

  const rankComparator = (a, b) => {
    const pA = STATUS_PRIORITY[a.status] ?? 99;
    const pB = STATUS_PRIORITY[b.status] ?? 99;
    if (pA !== pB) return pA - pB;

    const timeA = a.updatedAt ? Date.parse(a.updatedAt) || 0 : 0;
    const timeB = b.updatedAt ? Date.parse(b.updatedAt) || 0 : 0;
    if (timeB !== timeA) return timeB - timeA;

    return String(a.name || '').localeCompare(String(b.name || ''));
  };

  if (!cleanDest) {
    return {
      primaryMatches: [...compatible].sort(rankComparator),
      alternatives: [],
      allPrimaryFullOrClosed: false,
    };
  }

  const primaryMatches = compatible
    .filter((sec) => String(sec.destination || '').trim().toLowerCase() === cleanDest)
    .sort(rankComparator);

  const hasOpenPrimary = primaryMatches.some(
    (sec) => sec.status === 'Available' || sec.status === 'Limited'
  );
  const allPrimaryFullOrClosed = primaryMatches.length > 0 && !hasOpenPrimary;

  let alternatives = [];
  if (primaryMatches.length === 0 || allPrimaryFullOrClosed) {
    alternatives = compatible
      .filter(
        (sec) =>
          String(sec.destination || '').trim().toLowerCase() !== cleanDest &&
          (sec.status === 'Available' || sec.status === 'Limited')
      )
      .sort(rankComparator);
  }

  return {
    primaryMatches,
    alternatives,
    allPrimaryFullOrClosed,
  };
}

class ParkingService {
  constructor() {
    this.lots = [];
    this.sections = [];
    this.destinations = [];
    this.settings = {
      freshnessMinutes: 60,
      staleVehicleHours: 12,
    };
    this.activeSession = null;
    this.listeners = new Set();

    authService.onClearAccountCache(() => {
      this.clearClientCaches();
    });
  }

  loadCatalog() {
    const stored = readJsonStorage(STORAGE_KEYS.catalog, null);
    if (stored && Array.isArray(stored.sections) && Array.isArray(stored.lots)) {
      return stored;
    }
    const initial = createInitialCatalog();
    writeJsonStorage(STORAGE_KEYS.catalog, initial);
    return initial;
  }

  saveCatalog(catalog) {
    writeJsonStorage(STORAGE_KEYS.catalog, catalog);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener({
          lots: this.lots,
          sections: this.sections,
          destinations: this.destinations,
          activeSession: this.activeSession,
          settings: this.settings,
        });
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  clearClientCaches() {
    this.lots = [];
    this.sections = [];
    this.destinations = [];
    this.activeSession = null;
    this.notify();
  }

  async fetchParkingData() {
    const catalog = this.loadCatalog();
    this.settings = { ...this.settings, ...(catalog.settings || {}) };
    this.lots = catalog.lots
      .filter((l) => l.active !== false)
      .map((l) => ({
        ...l,
        code: l.code || l.id.toUpperCase(),
      }));
    this.destinations = Array.isArray(catalog.destinations) ? catalog.destinations : [];
    this.sections = catalog.sections.map((sec) => {
      const lot = catalog.lots.find((l) => l.id === sec.lotId);
      return normalizeSectionRecord(
        sec,
        this.settings,
        lot ? lot.name : 'Campus Parking Lot'
      );
    });
    this.notify();
    return {
      lots: this.lots,
      sections: this.sections,
      destinations: this.destinations,
      settings: this.settings,
    };
  }

  async lookupSectionByQr(rawCode) {
    const code = String(rawCode || '')
      .trim()
      .toUpperCase();
    if (!code || !/^[A-Z0-9_-]+$/.test(code)) {
      throw new Error(
        'Invalid section or QR code format. Only valid campus section codes are accepted.'
      );
    }

    const catalog = this.loadCatalog();
    const section = catalog.sections.find(
      (sec) =>
        String(sec.code || '').toUpperCase() === code ||
        String(sec.qrCode || '').toUpperCase() === code ||
        String(sec.id || '').toUpperCase() === code
    );
    if (!section) {
      throw new Error('No configured parking section matched that QR or section code.');
    }

    const lot = catalog.lots.find((l) => l.id === section.lotId);
    return normalizeSectionRecord(
      section,
      catalog.settings,
      lot ? lot.name : 'Campus Parking Lot'
    );
  }

  async fetchActiveSession() {
    const user = authService.currentUser || authService.loadCachedUserProfile();
    if (!user?.id) {
      this.activeSession = null;
      this.notify();
      return null;
    }

    const catalog = this.loadCatalog();
    const allSessions = readJsonStorage(STORAGE_KEYS.sessions, []);
    const active = allSessions.find((s) => s.userId === user.id && s.status === 'active');
    this.activeSession = computeSessionState(active || null, catalog.settings, catalog);
    this.notify();
    return this.activeSession;
  }

  async saveParkingSession(sessionData = {}) {
    const user = authService.currentUser || authService.loadCachedUserProfile();
    if (!user?.id) {
      throw new Error('Authentication required to save a parking location.');
    }

    const catalog = this.loadCatalog();
    const allSessions = readJsonStorage(STORAGE_KEYS.sessions, []);
    const existingActive = allSessions.find((s) => s.userId === user.id && s.status === 'active');

    const shouldReplace = Boolean(
      sessionData.replaceActive ?? sessionData.replaceExisting ?? true
    );
    if (existingActive && !shouldReplace) {
      const err = new Error(
        'You already have an active parked vehicle saved. Replace your existing session or update it instead.'
      );
      err.code = 'ACTIVE_SESSION_EXISTS';
      throw err;
    }

    const sectionId = String(sessionData.sectionId || '').trim();
    const section = catalog.sections.find(
      (s) => s.id === sectionId || s.code === sectionId
    );
    const lot =
      catalog.lots.find((l) => l.id === (section?.lotId || sessionData.lotId)) ||
      catalog.lots[0];

    const vehicleType = String(sessionData.vehicleType || 'bike')
      .trim()
      .toLowerCase();
    if (!['bike', 'car', 'other'].includes(vehicleType)) {
      throw new Error('Please select your vehicle type (Bike, Car, or Other).');
    }

    if (existingActive) {
      existingActive.status = 'completed';
      existingActive.endedAt = new Date().toISOString();
    }

    const nowIso = new Date().toISOString();
    const rowVal = String(sessionData.row ?? sessionData.rowIdentifier ?? '')
      .trim()
      .slice(0, 60);
    const bayVal = String(sessionData.bay ?? sessionData.bayIdentifier ?? '')
      .trim()
      .slice(0, 60);
    const noteVal = String(sessionData.note ?? sessionData.landmarkNote ?? '')
      .trim()
      .slice(0, 300);

    const lat =
      typeof sessionData.latitude === 'number'
        ? sessionData.latitude
        : typeof sessionData.gpsCoords?.latitude === 'number'
        ? sessionData.gpsCoords.latitude
        : typeof section?.latitude === 'number'
        ? section.latitude
        : null;
    const lng =
      typeof sessionData.longitude === 'number'
        ? sessionData.longitude
        : typeof sessionData.gpsCoords?.longitude === 'number'
        ? sessionData.gpsCoords.longitude
        : typeof section?.longitude === 'number'
        ? section.longitude
        : null;

    const newSession = {
      id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: user.id,
      lotId: section?.lotId || lot?.id || 'lot-manual',
      lotName: lot?.name || sessionData.lotName || 'Campus Parking Lot',
      sectionId: section?.id || 'sec-manual',
      sectionCode: section?.code || '',
      sectionName: section?.name || sessionData.sectionName || 'Campus Section',
      entrance: section?.entrance || section?.landmarkHint || 'Main lot entrance',
      destination: section?.destination || lot?.destination || '',
      vehicleType,
      row: rowVal,
      rowIdentifier: rowVal,
      bay: bayVal,
      bayIdentifier: bayVal,
      note: noteVal,
      landmarkNote: noteVal,
      latitude: lat,
      longitude: lng,
      gpsCoords: lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null,
      photoDataUrl: sessionData.photoDataUrl || null,
      status: 'active',
      parkedAt: sessionData.parkedAt || nowIso,
      updatedAt: nowIso,
    };

    allSessions.push(newSession);
    writeJsonStorage(STORAGE_KEYS.sessions, allSessions);

    this.activeSession = computeSessionState(newSession, catalog.settings, catalog);
    this.notify();
    return this.activeSession;
  }

  async updateParkingSession(sessionId, updates = {}) {
    const user = authService.currentUser || authService.loadCachedUserProfile();
    if (!user?.id) {
      throw new Error('Authentication required.');
    }

    const catalog = this.loadCatalog();
    const allSessions = readJsonStorage(STORAGE_KEYS.sessions, []);
    const session = allSessions.find(
      (s) => s.id === sessionId && s.userId === user.id && s.status === 'active'
    );
    if (!session) {
      throw new Error('Active parking session not found.');
    }

    if (updates.confirmStillParked) {
      session.parkedAt = new Date().toISOString();
      session.updatedAt = session.parkedAt;
      writeJsonStorage(STORAGE_KEYS.sessions, allSessions);
      this.activeSession = computeSessionState(session, catalog.settings, catalog);
      this.notify();
      return this.activeSession;
    }

    if (updates.sectionId && updates.sectionId !== session.sectionId) {
      const nextSec = catalog.sections.find((s) => s.id === updates.sectionId);
      if (nextSec) {
        const lot = catalog.lots.find((l) => l.id === nextSec.lotId);
        session.lotId = nextSec.lotId;
        session.lotName = lot ? lot.name : 'Campus Parking Lot';
        session.sectionId = nextSec.id;
        session.sectionCode = nextSec.code;
        session.sectionName = nextSec.name;
        session.entrance = nextSec.entrance || nextSec.landmarkHint || 'Main lot entrance';
        session.destination = nextSec.destination || '';
      }
    }

    if (
      updates.vehicleType &&
      ['bike', 'car', 'other'].includes(String(updates.vehicleType).toLowerCase())
    ) {
      session.vehicleType = String(updates.vehicleType).toLowerCase();
    }

    const nextRow = updates.row ?? updates.rowIdentifier;
    if (typeof nextRow === 'string') {
      session.row = nextRow.trim().slice(0, 60);
      session.rowIdentifier = session.row;
    }

    const nextBay = updates.bay ?? updates.bayIdentifier;
    if (typeof nextBay === 'string') {
      session.bay = nextBay.trim().slice(0, 60);
      session.bayIdentifier = session.bay;
    }

    const nextNote = updates.note ?? updates.landmarkNote;
    if (typeof nextNote === 'string') {
      session.note = nextNote.trim().slice(0, 300);
      session.landmarkNote = session.note;
    }

    if (typeof updates.latitude === 'number' && typeof updates.longitude === 'number') {
      session.latitude = updates.latitude;
      session.longitude = updates.longitude;
      session.gpsCoords = { latitude: updates.latitude, longitude: updates.longitude };
    } else if (updates.gpsCoords !== undefined) {
      session.gpsCoords = updates.gpsCoords;
      session.latitude = updates.gpsCoords?.latitude ?? null;
      session.longitude = updates.gpsCoords?.longitude ?? null;
    }

    if (updates.parkedAt) {
      session.parkedAt = updates.parkedAt;
    }

    if (updates.removePhoto) {
      session.photoDataUrl = null;
    } else if (updates.photoDataUrl) {
      session.photoDataUrl = updates.photoDataUrl;
    }

    session.updatedAt = new Date().toISOString();
    writeJsonStorage(STORAGE_KEYS.sessions, allSessions);

    this.activeSession = computeSessionState(session, catalog.settings, catalog);
    this.notify();
    return this.activeSession;
  }

  async endParkingSession(sessionId) {
    const user = authService.currentUser || authService.loadCachedUserProfile();
    if (!user?.id) {
      throw new Error('Authentication required.');
    }

    const allSessions = readJsonStorage(STORAGE_KEYS.sessions, []);
    const session = allSessions.find(
      (s) => s.id === sessionId && s.userId === user.id && s.status === 'active'
    );
    if (session) {
      session.status = 'completed';
      session.endedAt = new Date().toISOString();
      writeJsonStorage(STORAGE_KEYS.sessions, allSessions);
    }

    this.activeSession = null;
    this.notify();
    return true;
  }

  async submitSectionReport({ sectionId, sectionName, issueType, description }) {
    const user = authService.currentUser || authService.loadCachedUserProfile();
    if (!user?.id) {
      throw new Error('Please log in to submit a section report.');
    }

    const catalog = this.loadCatalog();
    const section = catalog.sections.find((s) => s.id === sectionId);
    const reports = readJsonStorage(STORAGE_KEYS.reports, []);
    const report = {
      id: `rep_${Date.now()}`,
      sectionId: section ? section.id : 'general',
      sectionName: section ? section.name : String(sectionName || 'General Campus Lot'),
      issueType: String(issueType || '').trim(),
      description: String(description || '')
        .trim()
        .slice(0, 400),
      reportedByUserId: user.id,
      reportedByName: user.fullName || 'Campus Member',
      reporterName: user.fullName || 'Campus Member',
      status: 'pending',
      verified: false,
      createdAt: new Date().toISOString(),
    };

    reports.unshift(report);
    writeJsonStorage(STORAGE_KEYS.reports, reports);
    return report;
  }

  // ---------------------------------------------------------------------------
  // Staff Maintenance Operations
  // ---------------------------------------------------------------------------
  async fetchStaffOverview() {
    const catalog = this.loadCatalog();
    const reports = readJsonStorage(STORAGE_KEYS.reports, []).map((r) => ({
      ...r,
      reporterName: r.reporterName || r.reportedByName || 'Campus Member',
      status: r.status === 'pending_review' ? 'pending' : r.status || 'pending',
    }));
    const auditLogs = readJsonStorage(STORAGE_KEYS.auditLogs, []);
    return {
      lots: catalog.lots.map((l) => ({ ...l, code: l.code || l.id.toUpperCase() })),
      sections: catalog.sections.map((sec) => {
        const lot = catalog.lots.find((l) => l.id === sec.lotId);
        return normalizeSectionRecord(
          sec,
          catalog.settings,
          lot ? lot.name : 'Campus Parking Lot'
        );
      }),
      reports: reports.slice(0, 50),
      statusHistory: auditLogs.slice(0, 50),
      auditLogs: auditLogs.slice(0, 50),
      settings: catalog.settings,
    };
  }

  async createLot(lotData) {
    const user = authService.currentUser || authService.loadCachedUserProfile();
    const catalog = this.loadCatalog();
    const dest = String(lotData.destination || '').trim() || 'Academic Block A';
    if (!catalog.destinations.includes(dest)) {
      catalog.destinations.push(dest);
    }
    const lot = {
      id: `lot_${Date.now().toString(36)}`,
      code: String(lotData.code || `LOT-${catalog.lots.length + 1}`)
        .trim()
        .toUpperCase(),
      name: String(lotData.name || '').trim(),
      destination: dest,
      description: String(lotData.description || '').trim(),
      nearestDestinations: Array.isArray(lotData.nearestDestinations)
        ? lotData.nearestDestinations
        : [dest],
      active: true,
    };
    catalog.lots.push(lot);
    this.saveCatalog(catalog);

    await this.fetchParkingData();
    return lot;
  }

  async createSection(sectionData) {
    const user = authService.currentUser || authService.loadCachedUserProfile();
    const catalog = this.loadCatalog();
    const lot = catalog.lots.find((l) => l.id === sectionData.lotId);
    if (!lot) throw new Error('Please select a valid parent parking lot.');

    const capacityVal = Number(sectionData.capacity ?? sectionData.totalCapacity) || 50;
    const codeVal = String(sectionData.code || '')
      .trim()
      .toUpperCase();
    const entranceVal =
      String(sectionData.entrance || sectionData.landmarkHint || '').trim() ||
      `Located inside ${lot.name}`;
    const destVal =
      String(sectionData.destination || '').trim() ||
      lot.destination ||
      lot.nearestDestinations?.[0] ||
      'Academic Block A';

    if (destVal && !catalog.destinations.includes(destVal)) {
      catalog.destinations.push(destVal);
    }

    const section = {
      id: `sec_${Date.now().toString(36)}`,
      lotId: lot.id,
      code: codeVal,
      qrCode: String(sectionData.qrCode || codeVal)
        .trim()
        .toUpperCase(),
      name: String(sectionData.name || '').trim(),
      vehicleTypes:
        Array.isArray(sectionData.vehicleTypes) && sectionData.vehicleTypes.length > 0
          ? sectionData.vehicleTypes
          : ['bike'],
      destination: destVal,
      walkingMinutes: Math.max(1, Number(sectionData.walkingMinutes) || 3),
      accessRule: sectionData.accessRule || 'general',
      accessLabel: sectionData.restrictions || sectionData.accessLabel || 'Students & Staff Permit',
      restrictions:
        sectionData.restrictions || sectionData.accessLabel || 'Students & Staff Permit',
      capacity: capacityVal,
      totalCapacity: capacityVal,
      availableSpaces: capacityVal,
      availableSpots: capacityVal,
      hasReliableCount: true,
      status: sectionData.status || 'Available',
      updatedAt: new Date().toISOString(),
      updatedBy: user?.fullName || 'Staff',
      source: 'Staff Configuration',
      rows: Array.isArray(sectionData.rows) ? sectionData.rows : ['Row A', 'Row B', 'Row C'],
      entrance: entranceVal,
      landmarkHint: entranceVal,
    };

    catalog.sections.push(section);
    this.saveCatalog(catalog);
    await this.fetchParkingData();
    return section;
  }

  async updateSectionStatus(sectionId, statusData) {
    const user = authService.currentUser || authService.loadCachedUserProfile();
    const catalog = this.loadCatalog();
    const section = catalog.sections.find((s) => s.id === sectionId);
    if (!section) throw new Error('Parking section not found.');

    const previousStatus = section.status || 'Available';
    if (statusData.status) {
      section.status = statusData.status;
    }

    const rawSpaces = statusData.availableSpaces ?? statusData.availableSpots;
    if (rawSpaces !== undefined && rawSpaces !== '') {
      const cap = Number(section.capacity || section.totalCapacity || 100);
      const count = Math.max(0, Math.min(cap, Number(rawSpaces) || 0));
      section.availableSpaces = count;
      section.availableSpots = count;
    } else if (section.status === 'Full' || section.status === 'Closed') {
      section.availableSpaces = 0;
      section.availableSpots = 0;
    }

    if (statusData.hasReliableCount !== undefined) {
      section.hasReliableCount = Boolean(statusData.hasReliableCount);
    }
    if (statusData.closureReason !== undefined) {
      section.closureReason = String(statusData.closureReason || '').trim();
    }
    if (statusData.source) {
      section.source = String(statusData.source).trim();
    }

    section.updatedAt = new Date().toISOString();
    section.updatedBy = user?.fullName || 'Staff';
    this.saveCatalog(catalog);

    const auditEntry = {
      id: `aud_${Date.now()}`,
      action: 'UPDATE_SECTION_STATUS',
      sectionId: section.id,
      sectionName: section.name,
      sectionCode: section.code,
      previousStatus,
      newStatus: section.status,
      note:
        statusData.note ||
        statusData.closureReason ||
        `Updated availability to ${section.status}`,
      source: section.source || 'Staff Update',
      updatedBy: user?.fullName || 'Staff',
      timestamp: section.updatedAt,
    };
    const logs = readJsonStorage(STORAGE_KEYS.auditLogs, []);
    logs.unshift(auditEntry);
    writeJsonStorage(STORAGE_KEYS.auditLogs, logs);

    await this.fetchParkingData();
    return {
      section: normalizeSectionRecord(section, catalog.settings),
      auditEntry,
    };
  }

  async reviewReport(reportId, reviewData) {
    const user = authService.currentUser || authService.loadCachedUserProfile();
    const reports = readJsonStorage(STORAGE_KEYS.reports, []);
    const report = reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Report not found.');

    report.status = reviewData.status === 'dismissed' ? 'dismissed' : 'reviewed';
    report.verified = report.status === 'reviewed';
    report.reviewedBy = user?.fullName || 'Staff';
    report.reviewedAt = new Date().toISOString();
    writeJsonStorage(STORAGE_KEYS.reports, reports);

    return report;
  }

  async updateStaffSettings(settingsData) {
    const catalog = this.loadCatalog();
    if (settingsData.freshnessMinutes !== undefined) {
      catalog.settings.freshnessMinutes = Math.max(
        1,
        Math.min(10080, Number(settingsData.freshnessMinutes) || 60)
      );
    }
    if (settingsData.staleVehicleHours !== undefined) {
      catalog.settings.staleVehicleHours = Math.max(
        1,
        Math.min(168, Number(settingsData.staleVehicleHours) || 12)
      );
    }
    this.saveCatalog(catalog);
    await this.fetchParkingData();
    return catalog.settings;
  }
}

const sharedParkingService =
  typeof window !== 'undefined' && window.__PARKTRACE_PARKING_SERVICE__
    ? window.__PARKTRACE_PARKING_SERVICE__
    : new ParkingService();

if (typeof window !== 'undefined') {
  window.__PARKTRACE_PARKING_SERVICE__ = sharedParkingService;
}

export const parkingService = sharedParkingService;
