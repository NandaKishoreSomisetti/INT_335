/**
 * Campus Parking Discovery, Saved Vehicle Sessions & Staff Maintenance Service
 * (js/services/parkingService.js)
 *
 * Responsibilities:
 * 1. Fetches configured campus parking lots, vehicle sections, and freshness settings.
 * 2. Filters and recommends suitable parking sections based on vehicle compatibility,
 *    access restrictions, availability & freshness, and destination proximity.
 * 3. Offers legitimate alternatives when the closest section is Full or Closed.
 * 4. Manages the authenticated user's private saved parking session (lot -> section -> row -> bay,
 *    optional GPS pin, note, and private photo) without altering verified physical occupancy.
 * 5. Handles QR section code lookups with strict validation.
 * 6. Submits unverified user section reports and executes role-protected staff updates.
 */

import { PARKING_CONFIG } from '../config.js';
import { authService } from './authService.js';

function buildHeaders(extra = {}) {
  const headers = { Accept: 'application/json', ...extra };
  const token = authService.getAccessToken?.();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

const STATUS_PRIORITY = {
  Available: 1,
  Limited: 2,
  Unknown: 3,
  Full: 4,
  Closed: 5,
};

function getDefaultParkingCatalog() {
  const nowIso = new Date().toISOString();
  return {
    settings: { freshnessMinutes: 60, staleVehicleHours: 12 },
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
        lotName: 'North Academic Lot A',
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
        effectiveStatus: 'Available',
        isStale: false,
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        rows: ['Row A', 'Row B', 'Row C', 'Row D'],
        landmarkHint: 'Opposite Block A Main Stairwell & Security Kiosk',
      },
      {
        id: 'sec-a-car-2',
        lotId: 'lot-north-academic',
        lotName: 'North Academic Lot A',
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
        effectiveStatus: 'Limited',
        isStale: false,
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        rows: ['Row 1', 'Row 2', 'Row 3'],
        landmarkHint: 'Near North Gate Solar Canopy',
      },
      {
        id: 'sec-b-car-2',
        lotId: 'lot-east-innovation',
        lotName: 'East Innovation Lot B',
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
        effectiveStatus: 'Available',
        isStale: false,
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        rows: ['Row C1', 'Row C2', 'Row C3'],
        landmarkHint: 'Adjacent to Block B Amphitheater Walkway',
      },
      {
        id: 'sec-c-multi-1',
        lotId: 'lot-south-commons',
        lotName: 'South Commons Lot C',
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
        effectiveStatus: 'Available',
        isStale: false,
        updatedAt: nowIso,
        updatedBy: 'Campus Attendant Desk',
        rows: ['Row S1', 'Row S2', 'Row S3', 'Row S4', 'Row S5'],
        landmarkHint: 'Covered walkway linking South Commons to Engineering Wing',
      },
    ],
  };
}

/**
 * Pure recommendation & filtering helper for Find Parking (Requirement 7).
 *
 * @param {Array} sections
 * @param {Object} filters
 * @param {string} [filters.vehicleType=''] - 'bike' | 'car' | 'other' | ''
 * @param {string} [filters.destination=''] - Destination string or ''
 * @returns {{ primaryMatches: Array, alternatives: Array, allPrimaryFullOrClosed: boolean }}
 */
export function recommendParkingSections(
  sections = [],
  { vehicleType = '', destination = '' } = {}
) {
  const cleanVehicle = (vehicleType || '').trim().toLowerCase();
  const cleanDest = (destination || '').trim().toLowerCase();

  // 1. Filter by vehicle compatibility
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

    // Register cache wipe on logout
    authService.onClearAccountCache(() => {
      this.clearClientCaches();
    });
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
    try {
      const response = await fetch(PARKING_CONFIG.baseUrl.replace(/\/$/, ''), {
        method: 'GET',
        credentials: 'include',
        headers: buildHeaders(),
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(payload.sections)) {
        this.lots = Array.isArray(payload.lots) ? payload.lots : [];
        this.sections = Array.isArray(payload.sections) ? payload.sections : [];
        this.destinations = Array.isArray(payload.destinations) ? payload.destinations : [];
        if (payload.settings) {
          this.settings = { ...this.settings, ...payload.settings };
        }
        this.notify();
        return {
          lots: this.lots,
          sections: this.sections,
          destinations: this.destinations,
          settings: this.settings,
        };
      }
    } catch {
      // Fall back to default catalog when running without local API server
    }

    const fallback = getDefaultParkingCatalog();
    this.lots = fallback.lots;
    this.sections = fallback.sections;
    this.destinations = fallback.destinations;
    this.settings = { ...this.settings, ...fallback.settings };
    this.notify();
    return {
      lots: this.lots,
      sections: this.sections,
      destinations: this.destinations,
      settings: this.settings,
    };
  }

  async lookupSectionByQr(rawCode) {
    const code = String(rawCode || '').trim();
    if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) {
      throw new Error(
        'Invalid section or QR code format. Only valid campus section codes are accepted.'
      );
    }

    try {
      const endpoint = `${PARKING_CONFIG.baseUrl.replace(/\/$/, '')}/qr/${encodeURIComponent(code)}`;
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        headers: buildHeaders(),
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.section) {
        return payload.section;
      }
    } catch {
      // Check in-memory sections as fallback
    }

    const upper = code.toUpperCase();
    const localMatch = (this.sections.length ? this.sections : getDefaultParkingCatalog().sections).find(
      (sec) =>
        String(sec.code || '').toUpperCase() === upper ||
        String(sec.id || '').toUpperCase() === upper
    );
    if (localMatch) {
      return localMatch;
    }

    throw new Error('No configured parking section matched that QR or section code.');
  }

  async fetchActiveSession() {
    try {
      const endpoint = `${PARKING_CONFIG.sessionsUrl.replace(/\/$/, '')}/active`;
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        headers: buildHeaders(),
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        this.activeSession = payload.session || null;
        this.notify();
        return this.activeSession;
      }
    } catch {
      // Ignore network error when running in static mode
    }

    this.notify();
    return this.activeSession;
  }

  async saveParkingSession(sessionData) {
    const endpoint = PARKING_CONFIG.sessionsUrl.replace(/\/$/, '');
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(sessionData),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(
        payload.message || 'Could not save your parking location. Please try again.'
      );
      err.code = payload.code || null;
      throw err;
    }

    this.activeSession = payload.session || null;
    this.notify();
    return this.activeSession;
  }

  async updateParkingSession(sessionId, updates) {
    const endpoint = `${PARKING_CONFIG.sessionsUrl.replace(/\/$/, '')}/${encodeURIComponent(sessionId)}`;
    const response = await fetch(endpoint, {
      method: 'PUT',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updates),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload.message || 'Could not update your saved parking location. Please try again.'
      );
    }

    this.activeSession = payload.session || null;
    this.notify();
    return this.activeSession;
  }

  async endParkingSession(sessionId) {
    const endpoint = `${PARKING_CONFIG.sessionsUrl.replace(/\/$/, '')}/${encodeURIComponent(sessionId)}`;
    const response = await fetch(endpoint, {
      method: 'DELETE',
      credentials: 'include',
      headers: buildHeaders(),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Could not clear your saved parking session.');
    }

    this.activeSession = null;
    this.notify();
    return true;
  }

  async submitSectionReport({ sectionId, sectionName, issueType, description }) {
    const endpoint = PARKING_CONFIG.reportsUrl.replace(/\/$/, '');
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sectionId, sectionName, issueType, description }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to submit report right now.');
    }

    return payload.report;
  }

  // ---------------------------------------------------------------------------
  // Staff Maintenance Operations (Protected by Server RBAC)
  // ---------------------------------------------------------------------------
  async fetchStaffOverview() {
    const endpoint = `${PARKING_CONFIG.staffUrl.replace(/\/$/, '')}/overview`;
    const response = await fetch(endpoint, {
      method: 'GET',
      credentials: 'include',
      headers: buildHeaders(),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to load staff maintenance controls.');
    }
    return payload;
  }

  async createLot(lotData) {
    const endpoint = `${PARKING_CONFIG.staffUrl.replace(/\/$/, '')}/lots`;
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(lotData),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to create parking lot.');
    }
    await this.fetchParkingData();
    return payload.lot;
  }

  async updateLot(lotId, lotData) {
    const endpoint = `${PARKING_CONFIG.staffUrl.replace(/\/$/, '')}/lots/${encodeURIComponent(lotId)}`;
    const response = await fetch(endpoint, {
      method: 'PUT',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(lotData),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to update parking lot.');
    }
    await this.fetchParkingData();
    return payload.lot;
  }

  async createSection(sectionData) {
    const endpoint = `${PARKING_CONFIG.staffUrl.replace(/\/$/, '')}/sections`;
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(sectionData),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to create parking section.');
    }
    await this.fetchParkingData();
    return payload.section;
  }

  async updateSection(sectionId, sectionData) {
    const endpoint = `${PARKING_CONFIG.staffUrl.replace(/\/$/, '')}/sections/${encodeURIComponent(sectionId)}`;
    const response = await fetch(endpoint, {
      method: 'PUT',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(sectionData),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to update parking section.');
    }
    await this.fetchParkingData();
    return payload.section;
  }

  async updateSectionStatus(sectionId, statusData) {
    const endpoint = `${PARKING_CONFIG.staffUrl.replace(/\/$/, '')}/sections/${encodeURIComponent(sectionId)}/status`;
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(statusData),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to update section status.');
    }
    await this.fetchParkingData();
    return payload;
  }

  async reviewReport(reportId, reviewData) {
    const endpoint = `${PARKING_CONFIG.staffUrl.replace(/\/$/, '')}/reports/${encodeURIComponent(reportId)}`;
    const response = await fetch(endpoint, {
      method: 'PUT',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(reviewData),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to update report status.');
    }
    return payload.report;
  }

  async updateStaffSettings(settingsData) {
    const endpoint = `${PARKING_CONFIG.staffUrl.replace(/\/$/, '')}/settings`;
    const response = await fetch(endpoint, {
      method: 'PUT',
      credentials: 'include',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(settingsData),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to update freshness settings.');
    }
    await this.fetchParkingData();
    return payload.settings;
  }
}

export const parkingService = new ParkingService();

