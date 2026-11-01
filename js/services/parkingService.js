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

const STATUS_PRIORITY = {
  Available: 1,
  Limited: 2,
  Unknown: 3,
  Full: 4,
  Closed: 5,
};

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
    const response = await fetch(PARKING_CONFIG.baseUrl.replace(/\/$/, ''), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to load campus parking sections right now.');
    }

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

  async lookupSectionByQr(rawCode) {
    const code = String(rawCode || '').trim();
    if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) {
      throw new Error(
        'Invalid section or QR code format. Only valid campus section codes are accepted.'
      );
    }

    const endpoint = `${PARKING_CONFIG.baseUrl.replace(/\/$/, '')}/qr/${encodeURIComponent(code)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload.message || 'No configured parking section matched that QR or section code.'
      );
    }

    return payload.section;
  }

  async fetchActiveSession() {
    const endpoint = `${PARKING_CONFIG.sessionsUrl.replace(/\/$/, '')}/active`;
    const response = await fetch(endpoint, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to retrieve your saved vehicle location.');
    }

    this.activeSession = payload.session || null;
    this.notify();
    return this.activeSession;
  }

  async saveParkingSession(sessionData) {
    const endpoint = PARKING_CONFIG.sessionsUrl.replace(/\/$/, '');
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: { Accept: 'application/json' },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: { Accept: 'application/json' },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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

