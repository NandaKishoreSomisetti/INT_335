/**
 * Campus Parking Discovery, Saved Vehicle Sessions & Staff Maintenance Service
 * (js/services/parkingService.js)
 *
 * GitHub Pages & Static-Host Compatible:
 * - Operates directly in the browser without calling relative `/api/parking` or
 *   `/api/sessions` routes (preventing 404 / 405 Method Not Allowed on GitHub Pages).
 */

import { authService } from './authService.js?v=sb6';

const STATUS_PRIORITY = {
  Available: 1,
  Limited: 2,
  Unknown: 3,
  Full: 4,
  Closed: 5,
};

const STORAGE_KEYS = {
  catalog: 'parktrace.parking_catalog.v1',
  sessions: 'parktrace.parking_sessions.v1',
  reports: 'parktrace.section_reports.v1',
  auditLogs: 'parktrace.staff_audit_logs.v1',
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
        updatedAt: nowIso,
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
        updatedAt: nowIso,
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
        updatedAt: nowIso,
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
        updatedAt: nowIso,
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
        updatedAt: nowIso,
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
        updatedAt: nowIso,
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
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        rows: ['Staff Row R1', 'Staff Row R2'],
        landmarkHint: 'Behind Administrative Block Security Barrier',
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
    this.lots = catalog.lots.filter((l) => l.active !== false);
    this.destinations = Array.isArray(catalog.destinations) ? catalog.destinations : [];
    this.sections = catalog.sections.map((sec) => {
      const lot = catalog.lots.find((l) => l.id === sec.lotId);
      return {
        ...computeFreshnessState(sec, this.settings),
        lotName: lot ? lot.name : 'Campus Parking Lot',
      };
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
        String(sec.id || '').toUpperCase() === code
    );
    if (!section) {
      throw new Error('No configured parking section matched that QR or section code.');
    }

    const lot = catalog.lots.find((l) => l.id === section.lotId);
    return {
      ...computeFreshnessState(section, catalog.settings),
      lotName: lot ? lot.name : 'Campus Parking Lot',
    };
  }

  async fetchActiveSession() {
    const user = authService.currentUser;
    if (!user?.id) {
      this.activeSession = null;
      this.notify();
      return null;
    }

    const catalog = this.loadCatalog();
    const allSessions = readJsonStorage(STORAGE_KEYS.sessions, []);
    const active = allSessions.find((s) => s.userId === user.id && s.status === 'active');
    this.activeSession = computeSessionState(active || null, catalog.settings);
    this.notify();
    return this.activeSession;
  }

  async saveParkingSession(sessionData) {
    const user = authService.currentUser;
    if (!user?.id) {
      throw new Error('Authentication required to save a parking location.');
    }

    const catalog = this.loadCatalog();
    const allSessions = readJsonStorage(STORAGE_KEYS.sessions, []);
    const existingActive = allSessions.find((s) => s.userId === user.id && s.status === 'active');

    if (existingActive && !sessionData.replaceExisting) {
      const err = new Error(
        'You already have an active parked vehicle saved. Replace your existing session or update it instead.'
      );
      err.code = 'ACTIVE_SESSION_EXISTS';
      throw err;
    }

    const sectionId = String(sessionData.sectionId || '').trim();
    const section = catalog.sections.find((s) => s.id === sectionId || s.code === sectionId);
    if (!section) {
      throw new Error('Please select a valid campus parking section.');
    }

    const vehicleType = String(sessionData.vehicleType || '')
      .trim()
      .toLowerCase();
    if (!['bike', 'car', 'other'].includes(vehicleType)) {
      throw new Error('Please select your vehicle type (Bike, Car, or Other).');
    }

    if (!section.vehicleTypes.includes(vehicleType)) {
      throw new Error(
        `Selected section (${section.name}) does not support ${vehicleType} parking.`
      );
    }

    if (section.accessRule === 'staff_only' && user.role !== 'staff') {
      throw new Error(
        'This section is reserved for authorized campus staff and faculty permits.'
      );
    }

    if (existingActive) {
      existingActive.status = 'completed';
      existingActive.endedAt = new Date().toISOString();
    }

    const lot = catalog.lots.find((l) => l.id === section.lotId);
    const nowIso = new Date().toISOString();
    const newSession = {
      id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: user.id,
      lotId: section.lotId,
      lotName: lot ? lot.name : 'Campus Parking Lot',
      sectionId: section.id,
      sectionCode: section.code,
      sectionName: section.name,
      vehicleType,
      rowIdentifier: String(sessionData.rowIdentifier || '')
        .trim()
        .slice(0, 60),
      bayIdentifier: String(sessionData.bayIdentifier || '')
        .trim()
        .slice(0, 60),
      landmarkNote: String(sessionData.landmarkNote || '')
        .trim()
        .slice(0, 280),
      gpsCoords: sessionData.gpsCoords || null,
      photoDataUrl: sessionData.photoDataUrl || null,
      status: 'active',
      parkedAt: nowIso,
      updatedAt: nowIso,
    };

    allSessions.push(newSession);
    writeJsonStorage(STORAGE_KEYS.sessions, allSessions);

    this.activeSession = computeSessionState(newSession, catalog.settings);
    this.notify();
    return this.activeSession;
  }

  async updateParkingSession(sessionId, updates) {
    const user = authService.currentUser;
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

    if (updates.sectionId && updates.sectionId !== session.sectionId) {
      const nextSec = catalog.sections.find((s) => s.id === updates.sectionId);
      if (!nextSec) {
        throw new Error('Selected parking section is invalid.');
      }
      const nextType = updates.vehicleType
        ? String(updates.vehicleType).toLowerCase()
        : session.vehicleType;
      if (!nextSec.vehicleTypes.includes(nextType)) {
        throw new Error(
          `Selected section (${nextSec.name}) does not support ${nextType} parking.`
        );
      }
      const lot = catalog.lots.find((l) => l.id === nextSec.lotId);
      session.lotId = nextSec.lotId;
      session.lotName = lot ? lot.name : 'Campus Parking Lot';
      session.sectionId = nextSec.id;
      session.sectionCode = nextSec.code;
      session.sectionName = nextSec.name;
    }

    if (
      updates.vehicleType &&
      ['bike', 'car', 'other'].includes(String(updates.vehicleType).toLowerCase())
    ) {
      session.vehicleType = String(updates.vehicleType).toLowerCase();
    }
    if (typeof updates.rowIdentifier === 'string') {
      session.rowIdentifier = updates.rowIdentifier.trim().slice(0, 60);
    }
    if (typeof updates.bayIdentifier === 'string') {
      session.bayIdentifier = updates.bayIdentifier.trim().slice(0, 60);
    }
    if (typeof updates.landmarkNote === 'string') {
      session.landmarkNote = updates.landmarkNote.trim().slice(0, 280);
    }
    if (updates.gpsCoords !== undefined) {
      session.gpsCoords = updates.gpsCoords;
    }
    if (updates.removePhoto) {
      session.photoDataUrl = null;
    } else if (updates.photoDataUrl) {
      session.photoDataUrl = updates.photoDataUrl;
    }

    session.updatedAt = new Date().toISOString();
    writeJsonStorage(STORAGE_KEYS.sessions, allSessions);

    this.activeSession = computeSessionState(session, catalog.settings);
    this.notify();
    return this.activeSession;
  }

  async endParkingSession(sessionId) {
    const user = authService.currentUser;
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
    const user = authService.currentUser;
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
        .slice(0, 300),
      reportedByUserId: user.id,
      reportedByName: user.fullName,
      status: 'pending_review',
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
    const reports = readJsonStorage(STORAGE_KEYS.reports, []);
    const auditLogs = readJsonStorage(STORAGE_KEYS.auditLogs, []);
    return {
      lots: catalog.lots,
      sections: catalog.sections.map((sec) => computeFreshnessState(sec, catalog.settings)),
      reports: reports.slice(0, 50),
      auditLogs: auditLogs.slice(0, 50),
      settings: catalog.settings,
    };
  }

  async createLot(lotData) {
    const user = authService.currentUser;
    const catalog = this.loadCatalog();
    const lot = {
      id: `lot_${Date.now().toString(36)}`,
      name: String(lotData.name || '').trim(),
      description: String(lotData.description || '').trim(),
      nearestDestinations: Array.isArray(lotData.nearestDestinations)
        ? lotData.nearestDestinations
        : ['Academic Block A'],
      active: true,
    };
    catalog.lots.push(lot);
    this.saveCatalog(catalog);

    const logs = readJsonStorage(STORAGE_KEYS.auditLogs, []);
    logs.unshift({
      id: `aud_${Date.now()}`,
      action: 'CREATE_LOT',
      targetName: lot.name,
      staffName: user?.fullName || 'Staff',
      staffEmail: user?.email || '',
      timestamp: new Date().toISOString(),
      details: `Created parking lot "${lot.name}"`,
    });
    writeJsonStorage(STORAGE_KEYS.auditLogs, logs);

    await this.fetchParkingData();
    return lot;
  }

  async updateLot(lotId, lotData) {
    const catalog = this.loadCatalog();
    const lot = catalog.lots.find((l) => l.id === lotId);
    if (!lot) throw new Error('Parking lot not found.');
    if (typeof lotData.name === 'string' && lotData.name.trim()) lot.name = lotData.name.trim();
    if (typeof lotData.description === 'string') lot.description = lotData.description.trim();
    if (typeof lotData.active === 'boolean') lot.active = lotData.active;
    this.saveCatalog(catalog);
    await this.fetchParkingData();
    return lot;
  }

  async createSection(sectionData) {
    const user = authService.currentUser;
    const catalog = this.loadCatalog();
    const lot = catalog.lots.find((l) => l.id === sectionData.lotId);
    if (!lot) throw new Error('Please select a valid parent parking lot.');

    const totalCapacity = Math.max(1, Number(sectionData.totalCapacity) || 50);
    const availableSpots = Math.min(
      totalCapacity,
      Math.max(0, Number(sectionData.availableSpots ?? totalCapacity))
    );
    const section = {
      id: `sec_${Date.now().toString(36)}`,
      lotId: lot.id,
      code: String(sectionData.code || '')
        .trim()
        .toUpperCase(),
      name: String(sectionData.name || '').trim(),
      vehicleTypes: Array.isArray(sectionData.vehicleTypes) ? sectionData.vehicleTypes : ['bike'],
      destination: sectionData.destination || lot.nearestDestinations[0] || 'Academic Block A',
      walkingMinutes: Math.max(1, Number(sectionData.walkingMinutes) || 3),
      accessRule: sectionData.accessRule || 'general',
      accessLabel: sectionData.accessLabel || 'Students & Staff',
      totalCapacity,
      availableSpots,
      status: sectionData.status || 'Available',
      updatedAt: new Date().toISOString(),
      updatedBy: user?.fullName || 'Staff',
      rows: Array.isArray(sectionData.rows) ? sectionData.rows : ['Row A', 'Row B', 'Row C'],
      landmarkHint: String(sectionData.landmarkHint || '').trim() || `Located inside ${lot.name}`,
    };

    catalog.sections.push(section);
    this.saveCatalog(catalog);
    await this.fetchParkingData();
    return section;
  }

  async updateSection(sectionId, sectionData) {
    const user = authService.currentUser;
    const catalog = this.loadCatalog();
    const section = catalog.sections.find((s) => s.id === sectionId);
    if (!section) throw new Error('Parking section not found.');

    if (typeof sectionData.name === 'string' && sectionData.name.trim()) {
      section.name = sectionData.name.trim();
    }
    if (typeof sectionData.code === 'string' && sectionData.code.trim()) {
      section.code = sectionData.code.trim().toUpperCase();
    }
    if (typeof sectionData.destination === 'string' && sectionData.destination.trim()) {
      section.destination = sectionData.destination.trim();
    }
    if (sectionData.totalCapacity !== undefined) {
      section.totalCapacity = Math.max(
        1,
        Number(sectionData.totalCapacity) || section.totalCapacity
      );
      section.availableSpots = Math.min(section.totalCapacity, section.availableSpots);
    }
    if (Array.isArray(sectionData.vehicleTypes) && sectionData.vehicleTypes.length > 0) {
      section.vehicleTypes = sectionData.vehicleTypes;
    }
    if (sectionData.accessRule) {
      section.accessRule = sectionData.accessRule;
    }
    if (typeof sectionData.landmarkHint === 'string') {
      section.landmarkHint = sectionData.landmarkHint.trim();
    }
    section.updatedAt = new Date().toISOString();
    section.updatedBy = user?.fullName || 'Staff';

    this.saveCatalog(catalog);
    await this.fetchParkingData();
    return computeFreshnessState(section, catalog.settings);
  }

  async updateSectionStatus(sectionId, statusData) {
    const user = authService.currentUser;
    const catalog = this.loadCatalog();
    const section = catalog.sections.find((s) => s.id === sectionId);
    if (!section) throw new Error('Parking section not found.');

    if (statusData.status) {
      section.status = statusData.status;
    }
    if (statusData.availableSpots !== undefined) {
      section.availableSpots = Math.max(
        0,
        Math.min(section.totalCapacity, Number(statusData.availableSpots) || 0)
      );
    } else if (section.status === 'Full' || section.status === 'Closed') {
      section.availableSpots = 0;
    }
    section.updatedAt = new Date().toISOString();
    section.updatedBy = user?.fullName || 'Staff';
    this.saveCatalog(catalog);

    const auditEntry = {
      id: `aud_${Date.now()}`,
      action: 'UPDATE_SECTION_STATUS',
      targetName: section.name,
      staffName: user?.fullName || 'Staff',
      staffEmail: user?.email || '',
      timestamp: section.updatedAt,
      details: `Set ${section.name} to ${section.status} (${section.availableSpots}/${section.totalCapacity} spots)`,
    };
    const logs = readJsonStorage(STORAGE_KEYS.auditLogs, []);
    logs.unshift(auditEntry);
    writeJsonStorage(STORAGE_KEYS.auditLogs, logs);

    await this.fetchParkingData();
    return {
      section: computeFreshnessState(section, catalog.settings),
      auditEntry,
    };
  }

  async reviewReport(reportId, reviewData) {
    const user = authService.currentUser;
    const reports = readJsonStorage(STORAGE_KEYS.reports, []);
    const report = reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Report not found.');

    report.status = reviewData.status === 'dismissed' ? 'dismissed' : 'verified';
    report.verified = report.status === 'verified';
    report.reviewedBy = user?.fullName || 'Staff';
    report.reviewedAt = new Date().toISOString();
    writeJsonStorage(STORAGE_KEYS.reports, reports);

    if (report.verified && reviewData.applySectionStatus && report.sectionId !== 'general') {
      await this.updateSectionStatus(report.sectionId, {
        status: reviewData.applySectionStatus,
      }).catch(() => {});
    }
    return report;
  }

  async updateStaffSettings(settingsData) {
    const catalog = this.loadCatalog();
    if (settingsData.freshnessMinutes !== undefined) {
      catalog.settings.freshnessMinutes = Math.max(
        5,
        Math.min(720, Number(settingsData.freshnessMinutes) || 60)
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

export const parkingService = new ParkingService();
