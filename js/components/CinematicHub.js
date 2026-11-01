/**
 * Authenticated Cinematic Hub Interface (js/components/CinematicHub.js)
 *
 * Implements the protected post-login experience matching the approved PARKTRACE
 * visual identity:
 * - Floating horizontal Glass Navigation Bar (with accessible mobile glass menu)
 *   - Left: Official PARKTRACE logo + wordmark
 *   - Main navigation: Overview, Find Parking, My Vehicle, Reviews
 *   - Right secondary controls: [Staff Controls if authorized], Support, Profile, Log out (last)
 * - Overview Dashboard (adapts to active vs. empty parking session state)
 * - Find Parking (vehicle type + destination filtering, recommendations & alternatives,
 *   section cards, QR code lookup, list & verified map view)
 * - Save / Correct Parking Location Dialog (Lot -> Section -> Row -> Bay, QR assist,
 *   on-demand GPS pin, landmark note, and private surroundings photo)
 * - My Vehicle & Retrieval (saved location hierarchy, private photo, stale session check,
 *   verified entrance/directions handoff, Correct location, and I've left)
 * - Shared Persistent Reviews (connected to the same `/api/reviews` backend as the homepage)
 * - Profile Management (display name persistence)
 * - Protected Role-Based Staff Controls (lots, sections, QR codes, availability, closures,
 *   freshness policy, user reports review, and status-update audit history)
 */

import { authService } from '../services/authService.js';
import {
  parkingService,
  recommendParkingSections,
} from '../services/parkingService.js';
import { renderBrandLogo } from './BrandLogo.js';
import { ReviewSection } from './ReviewSection.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(isoString) {
  if (!isoString) return 'Not recorded';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return String(isoString);
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'No timestamp';
  const ms = Date.parse(isoString);
  if (Number.isNaN(ms)) return String(isoString);
  const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (diffMin < 1) return 'Just now';
  if (diffMin === 1) return '1 min ago';
  if (diffMin < 60) return `${diffMin} mins ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr === 1) return '1 hr ago';
  if (diffHr < 24) return `${diffHr} hrs ago`;
  return formatDateTime(isoString);
}

function formatVehicleTypeLabel(type) {
  switch (String(type || '').toLowerCase()) {
    case 'bike':
      return 'Bike / Two-Wheeler';
    case 'car':
      return 'Car';
    case 'other':
      return 'Other Campus Vehicle';
    default:
      return 'Campus Vehicle';
  }
}

function toLocalDateTimeInputValue(isoString) {
  const d = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function computeInitials(name) {
  const parts = String(name || 'User')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

export class CinematicHub {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.mountNode
   * @param {Function} options.onOpenSupport
   */
  constructor({ mountNode, onOpenSupport }) {
    this.mountNode = mountNode;
    this.onOpenSupport = onOpenSupport;

    this.activeView = 'overview'; // 'overview' | 'find-parking' | 'my-vehicle' | 'reviews' | 'profile' | 'staff'
    this.mobileMenuOpen = false;
    this.isLoadingData = false;
    this.globalBanner = null; // { type: 'error' | 'info' | 'config', message: string }

    // Find Parking filter state
    this.selectedVehicleType = 'bike';
    this.selectedDestination = '';
    this.findViewMode = 'list'; // 'list' | 'map'
    this.qrLookupMessage = null;

    // Save / Correct Parking Modal state
    this.saveModalMode = 'create'; // 'create' | 'edit'
    this.saveModalPreselect = null; // { lotId, sectionId, vehicleType }
    this.capturedCoordinates = null; // { latitude, longitude }
    this.gpsStatusMessage = '';
    this.cameraStream = null;
    this.cameraStatusMessage = '';
    this.selectedPhotoDataUrl = null;
    this.removeExistingPhoto = false;
    this.isSavingSession = false;
    this.saveModalError = '';

    // Report Modal state
    this.reportTargetSection = null;
    this.isSubmittingReport = false;
    this.reportModalError = '';

    // Profile state
    this.isSavingProfile = false;
    this.profileBanner = null;
    this.profileDraftUserId = null;
    this.profileDraftName = '';
    this.profileDraftAffiliation = '';
    this.profileStagedAvatarDataUrl = null;
    this.profileStagedRemoveAvatar = false;
    this.profilePhotoNotice = null;
    this.profileCameraStream = null;
    this.profileCameraCapturedDataUrl = null;

    // Staff state
    this.staffData = null;
    this.isLoadingStaff = false;
    this.staffBanner = null;

    // Reviews sub-component inside hub
    this.hubReviewsComponent = null;
  }

  init() {
    parkingService.subscribe(() => {
      if (!authService.currentUser || this.mountNode?.hidden) return;
      this.renderActiveViewContent();
    });

    const stopAllCameras = () => {
      this.stopCameraStream();
      this.stopProfileCameraStream();
    };
    window.addEventListener('pagehide', stopAllCameras);
    window.addEventListener('beforeunload', stopAllCameras);
  }

  async activate(initialView = 'overview') {
    if (!this.mountNode) return;
    const user = authService.currentUser;
    if (!user) return;

    const allowedViews = ['overview', 'find-parking', 'my-vehicle', 'reviews', 'profile'];
    if (user.role === 'staff' || user.role === 'admin') {
      allowedViews.push('staff');
    }
    this.activeView = allowedViews.includes(initialView) ? initialView : 'overview';
    this.mobileMenuOpen = false;
    this.globalBanner = null;

    this.mountNode.hidden = false;
    this.renderShell();

    this.isLoadingData = true;
    this.renderActiveViewContent();

    try {
      await Promise.all([
        parkingService.fetchParkingData(),
        parkingService.fetchActiveSession(),
      ]);
    } catch (err) {
      this.globalBanner = {
        type: 'error',
        message: err?.message || 'Unable to synchronize campus parking data. Please retry.',
      };
    } finally {
      this.isLoadingData = false;
      this.renderActiveViewContent();
    }
  }

  deactivate() {
    this.stopCameraStream();
    this.stopProfileCameraStream();
    this.profileDraftUserId = null;
    this.profileStagedAvatarDataUrl = null;
    this.profileStagedRemoveAvatar = false;
    this.profilePhotoNotice = null;
    this.mobileMenuOpen = false;
    this.globalBanner = null;
    if (this.mountNode) {
      this.mountNode.hidden = true;
      this.mountNode.innerHTML = '';
    }
  }

  navigateTo(viewName, options = {}) {
    const user = authService.currentUser;
    if (!user) return;

    if (this.activeView === 'profile' && viewName !== 'profile') {
      this.stopProfileCameraStream();
    }

    const isStaff = user.role === 'staff' || user.role === 'admin';
    if (viewName === 'staff' && !isStaff) {
      this.globalBanner = {
        type: 'error',
        message: 'Staff permissions are required to access parking data maintenance controls.',
      };
      this.renderActiveViewContent();
      return;
    }

    if (options.vehicleType) {
      this.selectedVehicleType = options.vehicleType;
    }
    if (options.destination !== undefined) {
      this.selectedDestination = options.destination;
    }

    this.activeView = viewName;
    this.mobileMenuOpen = false;
    this.globalBanner = null;

    this.updateNavbarState();
    this.renderActiveViewContent();

    if (viewName === 'staff') {
      this.loadStaffOverview();
    }

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  renderShell() {
    if (!this.mountNode) return;
    const user = authService.currentUser;
    const isStaff = user && (user.role === 'staff' || user.role === 'admin');

    this.mountNode.innerHTML = `
      <div class="hub-stage">
        <!-- Restrained Cinematic Backdrop -->
        <div class="hub-backdrop" aria-hidden="true">
          <img
            src="./assets/hero-car-clean.jpg"
            alt=""
            width="1920"
            height="1080"
            class="hub-backdrop__img"
            decoding="async"
          />
          <div class="hub-backdrop__overlay"></div>
        </div>

        <!-- Floating Glass Navigation Bar (Requirement 5) -->
        <header class="hub-header">
          <nav class="hub-navbar" aria-label="Authenticated navigation">
            <div class="hub-navbar__left">
              <button
                type="button"
                class="hub-brand"
                data-nav-view="overview"
                aria-label="PARKTRACE Overview"
              >
                ${renderBrandLogo({ variant: 'navbar', isSoleLabel: false, className: 'hub-brand__logo' })}
                <span class="hub-brand__wordmark">PARKTRACE</span>
              </button>
            </div>

            <!-- Main Navigation Links (Desktop) -->
            <div class="hub-navbar__primary" role="list">
              <button
                type="button"
                class="hub-nav-link"
                data-nav-view="overview"
                role="listitem"
              >
                Overview
              </button>
              <button
                type="button"
                class="hub-nav-link"
                data-nav-view="find-parking"
                role="listitem"
              >
                Find Parking
              </button>
              <button
                type="button"
                class="hub-nav-link"
                data-nav-view="my-vehicle"
                role="listitem"
              >
                My Vehicle
              </button>
              <button
                type="button"
                class="hub-nav-link"
                data-nav-view="reviews"
                role="listitem"
              >
                Reviews
              </button>
            </div>

            <!-- Secondary Controls on the Right (Desktop) -->
            <div class="hub-navbar__secondary">
              ${
                isStaff
                  ? `
                    <button
                      type="button"
                      class="hub-nav-link hub-nav-link--staff"
                      data-nav-view="staff"
                    >
                      Staff Controls
                    </button>
                  `
                  : ''
              }
              <button
                type="button"
                id="hub-support-btn"
                class="hub-nav-link"
                aria-haspopup="dialog"
                aria-controls="support-modal"
              >
                Support
              </button>
              <button
                type="button"
                class="hub-nav-link"
                data-nav-view="profile"
              >
                Profile
              </button>
              <span class="hub-navbar__divider" aria-hidden="true"></span>
              <button
                type="button"
                id="hub-logout-btn"
                class="hub-nav-link hub-nav-link--logout"
              >
                Log out
              </button>
            </div>

            <!-- Mobile Menu Toggle Button -->
            <button
              type="button"
              id="hub-mobile-menu-btn"
              class="hub-mobile-toggle"
              aria-expanded="false"
              aria-controls="hub-mobile-menu"
              aria-label="Toggle navigation menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
              <span class="hub-mobile-toggle__label">Menu</span>
            </button>
          </nav>

          <!-- Collapsible Accessible Mobile Glass Menu -->
          <div id="hub-mobile-menu" class="hub-mobile-menu glass-panel" hidden>
            <div class="hub-mobile-menu__group" role="list" aria-label="Main navigation">
              <button type="button" class="hub-mobile-link" data-nav-view="overview" role="listitem">
                Overview
              </button>
              <button type="button" class="hub-mobile-link" data-nav-view="find-parking" role="listitem">
                Find Parking
              </button>
              <button type="button" class="hub-mobile-link" data-nav-view="my-vehicle" role="listitem">
                My Vehicle
              </button>
              <button type="button" class="hub-mobile-link" data-nav-view="reviews" role="listitem">
                Reviews
              </button>
            </div>
            <div class="hub-mobile-menu__divider" aria-hidden="true"></div>
            <div class="hub-mobile-menu__group" role="list" aria-label="Account and support actions">
              ${
                isStaff
                  ? `
                    <button type="button" class="hub-mobile-link hub-mobile-link--staff" data-nav-view="staff" role="listitem">
                      Staff Controls
                    </button>
                  `
                  : ''
              }
              <button
                type="button"
                id="hub-mobile-support-btn"
                class="hub-mobile-link"
                aria-haspopup="dialog"
                aria-controls="support-modal"
                role="listitem"
              >
                Support
              </button>
              <button type="button" class="hub-mobile-link" data-nav-view="profile" role="listitem">
                Profile
              </button>
              <div class="hub-mobile-menu__divider" aria-hidden="true"></div>
              <button
                type="button"
                id="hub-mobile-logout-btn"
                class="hub-mobile-link hub-mobile-link--logout"
                role="listitem"
              >
                Log out
              </button>
            </div>
          </div>
        </header>

        <!-- Main Authenticated Content Area -->
        <main id="hub-main-content" class="hub-main" tabindex="-1">
          <div id="hub-global-banner-slot" aria-live="polite"></div>
          <div id="hub-view-container" class="hub-view-container"></div>
        </main>

        <!-- Save / Correct Parking Location Modal -->
        <div id="save-parking-modal-mount">
          ${this.renderSaveParkingModalMarkup()}
        </div>

        <!-- Report Section Issue Modal -->
        <div id="report-section-modal-mount">
          ${this.renderReportSectionModalMarkup()}
        </div>
      </div>
    `;

    this.bindShellEvents();
    this.updateNavbarState();
  }

  updateNavbarState() {
    if (!this.mountNode) return;
    const allNavButtons = this.mountNode.querySelectorAll('[data-nav-view]');
    allNavButtons.forEach((btn) => {
      if (btn.classList.contains('hub-brand')) return;
      const view = btn.getAttribute('data-nav-view');
      const isCurrent = view === this.activeView;
      btn.classList.toggle('is-active', isCurrent);
      if (isCurrent) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    });

    const mobileMenu = this.mountNode.querySelector('#hub-mobile-menu');
    const mobileBtn = this.mountNode.querySelector('#hub-mobile-menu-btn');
    if (mobileMenu && mobileBtn) {
      mobileMenu.hidden = !this.mobileMenuOpen;
      mobileBtn.setAttribute('aria-expanded', this.mobileMenuOpen ? 'true' : 'false');
    }
  }

  bindShellEvents() {
    if (!this.mountNode) return;

    // Navigation buttons
    this.mountNode.querySelectorAll('[data-nav-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetView = btn.getAttribute('data-nav-view');
        if (targetView) {
          this.navigateTo(targetView);
        }
      });
    });

    // Support buttons
    const supportBtn = this.mountNode.querySelector('#hub-support-btn');
    const mobileSupportBtn = this.mountNode.querySelector('#hub-mobile-support-btn');
    supportBtn?.addEventListener('click', () => this.onOpenSupport?.(supportBtn));
    mobileSupportBtn?.addEventListener('click', () => {
      this.mobileMenuOpen = false;
      this.updateNavbarState();
      this.onOpenSupport?.(mobileSupportBtn);
    });

    // Log out buttons (last item in navbar and mobile menu)
    const handleLogout = async () => {
      try {
        await authService.logout();
      } catch (err) {
        this.globalBanner = {
          type: 'error',
          message: err?.message || 'Sign-out failed. Please try again.',
        };
        this.renderGlobalBanner();
      }
    };
    this.mountNode.querySelector('#hub-logout-btn')?.addEventListener('click', handleLogout);
    this.mountNode.querySelector('#hub-mobile-logout-btn')?.addEventListener('click', handleLogout);

    // Mobile menu toggle
    const mobileBtn = this.mountNode.querySelector('#hub-mobile-menu-btn');
    mobileBtn?.addEventListener('click', () => {
      this.mobileMenuOpen = !this.mobileMenuOpen;
      this.updateNavbarState();
    });

    // Close mobile menu on Escape
    this.mountNode.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.mobileMenuOpen) {
        this.mobileMenuOpen = false;
        this.updateNavbarState();
        mobileBtn?.focus();
      }
    });

    this.bindSaveParkingModalEvents();
    this.bindReportModalEvents();
  }

  renderGlobalBanner() {
    const slot = this.mountNode?.querySelector('#hub-global-banner-slot');
    if (!slot) return;
    if (!this.globalBanner) {
      slot.innerHTML = '';
      return;
    }
    slot.innerHTML = `
      <div class="status-banner status-banner--${escapeHtml(this.globalBanner.type)} hub-global-banner" role="alert">
        <div class="status-banner__content">
          <p class="status-banner__message">${escapeHtml(this.globalBanner.message)}</p>
        </div>
      </div>
    `;
  }

  renderActiveViewContent() {
    if (!this.mountNode) return;
    this.renderGlobalBanner();
    const container = this.mountNode.querySelector('#hub-view-container');
    if (!container) return;

    switch (this.activeView) {
      case 'overview':
        container.innerHTML = this.renderOverviewMarkup();
        this.bindOverviewEvents(container);
        break;
      case 'find-parking':
        container.innerHTML = this.renderFindParkingMarkup();
        this.bindFindParkingEvents(container);
        break;
      case 'my-vehicle':
        container.innerHTML = this.renderMyVehicleMarkup();
        this.bindMyVehicleEvents(container);
        break;
      case 'reviews':
        container.innerHTML = `<section id="hub-reviews-section" class="hub-reviews-view" aria-labelledby="hub-reviews-title"></section>`;
        this.mountHubReviews(container.querySelector('#hub-reviews-section'));
        break;
      case 'profile':
        container.innerHTML = this.renderProfileMarkup();
        this.bindProfileEvents(container);
        break;
      case 'staff':
        container.innerHTML = this.renderStaffMarkup();
        this.bindStaffEvents(container);
        break;
      default:
        container.innerHTML = this.renderOverviewMarkup();
        this.bindOverviewEvents(container);
    }
  }

  // ===========================================================================
  // VIEW 1: OVERVIEW DASHBOARD (Requirement 6)
  // ===========================================================================
  renderOverviewMarkup() {
    const user = authService.currentUser;
    const activeSession = parkingService.activeSession;
    const destinations = parkingService.destinations || [];
    const staleHours = parkingService.settings?.staleVehicleHours || 12;

    const destinationOptions = [
      `<option value="">All configured campus destinations</option>`,
      ...destinations.map(
        (dest) =>
          `<option value="${escapeHtml(dest)}" ${
            this.selectedDestination === dest ? 'selected' : ''
          }>${escapeHtml(dest)}</option>`
      ),
    ].join('');

    if (activeSession) {
      // Active parking session state: saved vehicle card is prominent & Find my vehicle is primary
      const locationSummary = [
        activeSession.lotName || 'Campus Lot',
        activeSession.sectionName
          ? `${activeSession.sectionName}${
              activeSession.sectionCode ? ` (${activeSession.sectionCode})` : ''
            }`
          : '',
      ]
        .filter(Boolean)
        .join(' · ');

      const rowBaySummary =
        activeSession.row || activeSession.bay
          ? `${activeSession.row ? `Row ${escapeHtml(activeSession.row)}` : ''}${
              activeSession.row && activeSession.bay ? ' · ' : ''
            }${activeSession.bay ? `Bay ${escapeHtml(activeSession.bay)}` : ''}`
          : 'Row / bay not specified';

      return `
        <div class="hub-page-header">
          <div>
            <p class="hub-eyebrow">CAMPUS VEHICLE PARKING &amp; RETRIEVAL</p>
            <h1 class="hub-title">Welcome, ${escapeHtml(user?.fullName || 'Rider')}</h1>
            <p class="hub-subtitle">Your active campus parking session is saved below for effortless retrieval.</p>
          </div>
          <div class="hub-header-actions">
            <button type="button" class="btn-secondary btn-compact" data-go-find-parking>
              Find parking
            </button>
          </div>
        </div>

        ${
          activeSession.isLongRunning
            ? `
              <div class="glass-panel stale-session-banner" role="region" aria-label="Confirm active parking session">
                <div class="stale-session-banner__body">
                  <strong class="stale-session-banner__title">Is your vehicle still parked here?</strong>
                  <p class="stale-session-banner__text">
                    This parking record was saved over ${escapeHtml(staleHours)} hours ago (${escapeHtml(
                formatDateTime(activeSession.parkedAt)
              )}). Confirm whether your vehicle is still parked or mark that you have left.
                  </p>
                </div>
                <div class="stale-session-banner__actions">
                  <button type="button" class="btn-secondary btn-compact" data-confirm-still-parked="${escapeHtml(
                    activeSession.id
                  )}">
                    Yes, still parked
                  </button>
                  <button type="button" class="btn-primary btn-compact" data-end-session="${escapeHtml(
                    activeSession.id
                  )}">
                    I’ve left
                  </button>
                </div>
              </div>
            `
            : ''
        }

        <div class="hub-overview-grid">
          <!-- Prominent Active Parked Vehicle Card -->
          <section class="glass-panel hub-card hub-card--featured" aria-labelledby="overview-active-vehicle-heading">
            <div class="hub-card__badge-row">
              <span class="status-pill status-pill--available">Active Parking Session</span>
              <span class="hub-card__meta-tag">${escapeHtml(
                formatVehicleTypeLabel(activeSession.vehicleType)
              )}${activeSession.vehicleLabel ? ` · ${escapeHtml(activeSession.vehicleLabel)}` : ''}</span>
            </div>

            <h2 id="overview-active-vehicle-heading" class="hub-card__title">
              ${escapeHtml(locationSummary)}
            </h2>

            <dl class="vehicle-detail-grid">
              <div class="vehicle-detail-item">
                <dt>Row &amp; Bay</dt>
                <dd>${rowBaySummary}</dd>
              </div>
              <div class="vehicle-detail-item">
                <dt>Parked at</dt>
                <dd>${escapeHtml(formatDateTime(activeSession.parkedAt))}</dd>
              </div>
              <div class="vehicle-detail-item">
                <dt>Entrance / Landmark</dt>
                <dd>${escapeHtml(
                  activeSession.entrance || activeSession.destination || 'See section details'
                )}</dd>
              </div>
              ${
                activeSession.note
                  ? `
                    <div class="vehicle-detail-item vehicle-detail-item--wide">
                      <dt>Saved note</dt>
                      <dd>${escapeHtml(activeSession.note)}</dd>
                    </div>
                  `
                  : ''
              }
            </dl>

            <div class="hub-card__actions">
              <button type="button" id="overview-find-my-vehicle-btn" class="btn-primary btn-compact">
                Find my vehicle
              </button>
              <button type="button" class="btn-secondary btn-compact" data-correct-location>
                Correct location
              </button>
              <button type="button" class="btn-ghost-pill btn-ghost-pill--danger" data-end-session="${escapeHtml(
                activeSession.id
              )}">
                I’ve left
              </button>
            </div>
          </section>

          <!-- Secondary Quick Discovery Card -->
          <section class="glass-panel hub-card" aria-labelledby="overview-discover-heading">
            <p class="hub-eyebrow">Campus Sections</p>
            <h2 id="overview-discover-heading" class="hub-card__title">Check Parking Availability</h2>
            <p class="hub-card__desc">
              Need to check another academic block or switch sections? Browse compatible bike, car, and campus vehicle sections.
            </p>
            <form id="overview-quick-search-form" class="hub-quick-form">
              <div class="form-field">
                <label for="overview-vehicle-select" class="form-label">Vehicle type</label>
                <select id="overview-vehicle-select" name="vehicleType" class="form-input">
                  <option value="bike" ${this.selectedVehicleType === 'bike' ? 'selected' : ''}>Bike / Two-Wheeler</option>
                  <option value="car" ${this.selectedVehicleType === 'car' ? 'selected' : ''}>Car</option>
                  <option value="other" ${this.selectedVehicleType === 'other' ? 'selected' : ''}>Other Campus Vehicle</option>
                </select>
              </div>
              <div class="form-field">
                <label for="overview-destination-select" class="form-label">Destination / Academic block</label>
                <select id="overview-destination-select" name="destination" class="form-input">
                  ${destinationOptions}
                </select>
              </div>
              <button type="submit" class="btn-secondary">
                Browse parking sections
              </button>
            </form>
          </section>
        </div>
      `;
    }

    // Without an active parking session: Find parking is primary, empty My parked vehicle card shown
    return `
      <div class="hub-page-header">
        <div>
          <p class="hub-eyebrow">CAMPUS VEHICLE PARKING &amp; RETRIEVAL</p>
          <h1 class="hub-title">Welcome, ${escapeHtml(user?.fullName || 'Rider')}</h1>
          <p class="hub-subtitle">
            Find the right campus parking section for your bike, car, or other vehicle—and easily find your way back.
          </p>
        </div>
      </div>

      <div class="hub-overview-grid">
        <!-- Primary Action Card: Find Parking -->
        <section class="glass-panel hub-card hub-card--featured" aria-labelledby="overview-find-heading">
          <p class="hub-eyebrow">Step 1 · Arrival</p>
          <h2 id="overview-find-heading" class="hub-card__title">Find Suitable Campus Parking</h2>
          <p class="hub-card__desc">
            Select your vehicle type and destination block to view compatible parking sections, entrances, and availability.
          </p>

          <form id="overview-quick-search-form" class="hub-quick-form">
            <div class="form-grid-2col">
              <div class="form-field">
                <label for="overview-vehicle-select" class="form-label">Vehicle type</label>
                <select id="overview-vehicle-select" name="vehicleType" class="form-input">
                  <option value="bike" ${this.selectedVehicleType === 'bike' ? 'selected' : ''}>Bike / Two-Wheeler</option>
                  <option value="car" ${this.selectedVehicleType === 'car' ? 'selected' : ''}>Car</option>
                  <option value="other" ${this.selectedVehicleType === 'other' ? 'selected' : ''}>Other Campus Vehicle</option>
                </select>
              </div>

              <div class="form-field">
                <label for="overview-destination-select" class="form-label">Destination / Academic block</label>
                <select id="overview-destination-select" name="destination" class="form-input">
                  ${destinationOptions}
                </select>
              </div>
            </div>

            <div class="hub-card__actions">
              <button type="submit" id="overview-find-parking-btn" class="btn-primary btn-compact">
                Find parking
              </button>
              <button type="button" id="overview-ive-parked-btn" class="btn-secondary btn-compact" data-open-save-modal>
                I’ve parked — Save location
              </button>
            </div>
          </form>
        </section>

        <!-- Helpful Empty "My Parked Vehicle" Card -->
        <section class="glass-panel hub-card" aria-labelledby="overview-empty-vehicle-heading">
          <p class="hub-eyebrow">Step 2 · Retrieval Memory Aid</p>
          <h2 id="overview-empty-vehicle-heading" class="hub-card__title">My Parked Vehicle</h2>
          <p class="hub-card__desc">
            No active parking location is saved right now. Once you park your bike, car, or campus vehicle, record your lot, section, row/bay, or scan the section QR code so you can locate it effortlessly after class.
          </p>

          <div class="hub-empty-callout">
            <p class="hub-empty-callout__title">Nothing parked yet</p>
            <p class="hub-empty-callout__sub">Saved locations, notes, and surroundings photos remain strictly private to your account.</p>
          </div>

          <div class="hub-card__actions">
            <button type="button" class="btn-secondary btn-compact" data-open-save-modal>
              Save parking location
            </button>
          </div>
        </section>
      </div>
    `;
  }

  bindOverviewEvents(container) {
    container.querySelector('#overview-quick-search-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const vt = form.querySelector('#overview-vehicle-select')?.value || 'bike';
      const dest = form.querySelector('#overview-destination-select')?.value || '';
      this.navigateTo('find-parking', { vehicleType: vt, destination: dest });
    });

    container.querySelector('[data-go-find-parking]')?.addEventListener('click', () => {
      this.navigateTo('find-parking');
    });

    container.querySelector('#overview-find-my-vehicle-btn')?.addEventListener('click', () => {
      this.navigateTo('my-vehicle');
    });

    container.querySelectorAll('[data-open-save-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openSaveParkingModal({
          mode: 'create',
          preselect: { vehicleType: this.selectedVehicleType },
        });
      });
    });

    container.querySelector('[data-correct-location]')?.addEventListener('click', () => {
      this.openSaveParkingModal({ mode: 'edit' });
    });

    container.querySelectorAll('[data-end-session]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sessionId = btn.getAttribute('data-end-session');
        if (!sessionId) return;
        await this.handleEndParkingSession(sessionId);
      });
    });

    container.querySelectorAll('[data-confirm-still-parked]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sessionId = btn.getAttribute('data-confirm-still-parked');
        if (!sessionId) return;
        try {
          await parkingService.updateParkingSession(sessionId, { confirmStillParked: true });
          this.globalBanner = {
            type: 'info',
            message: 'Confirmed—your vehicle parking session remains active.',
          };
          this.renderActiveViewContent();
        } catch (err) {
          this.globalBanner = {
            type: 'error',
            message: err?.message || 'Unable to confirm session status.',
          };
          this.renderGlobalBanner();
        }
      });
    });
  }

  // ===========================================================================
  // VIEW 2: FIND PARKING (Requirement 7)
  // ===========================================================================
  renderFindParkingMarkup() {
    const user = authService.currentUser;
    const isStaff = user && (user.role === 'staff' || user.role === 'admin');
    const sections = parkingService.sections || [];
    const destinations = parkingService.destinations || [];
    const freshnessMinutes = parkingService.settings?.freshnessMinutes || 60;

    const { primaryMatches, alternatives, allPrimaryFullOrClosed } = recommendParkingSections(
      sections,
      {
        vehicleType: this.selectedVehicleType,
        destination: this.selectedDestination,
      }
    );

    const destinationOptions = [
      `<option value="" ${this.selectedDestination === '' ? 'selected' : ''}>All configured destinations</option>`,
      ...destinations.map(
        (dest) =>
          `<option value="${escapeHtml(dest)}" ${
            this.selectedDestination === dest ? 'selected' : ''
          }>${escapeHtml(dest)}</option>`
      ),
    ].join('');

    const mappedSections = primaryMatches.filter(
      (s) => typeof s.latitude === 'number' && typeof s.longitude === 'number'
    );

    let resultsMarkup = '';
    if (this.isLoadingData) {
      resultsMarkup = `
        <div class="glass-panel hub-empty-state" role="status" aria-live="polite">
          <progress aria-label="Loading parking sections" class="loading-spinner"></progress>
          <p>Loading campus parking sections…</p>
        </div>
      `;
    } else if (sections.length === 0) {
      resultsMarkup = `
        <div class="glass-panel hub-empty-state" role="status">
          <h2 class="hub-card__title">No campus parking sections published yet</h2>
          <p class="hub-card__desc">
            Campus parking lots and vehicle sections have not been configured in the system yet. We never display fabricated campus locations or fake occupancy numbers.
          </p>
          <div class="hub-card__actions">
            <button type="button" class="btn-secondary btn-compact" data-open-save-modal>
              I’ve parked — Save manual location
            </button>
            ${
              isStaff
                ? `
                  <button type="button" class="btn-primary btn-compact" data-go-staff>
                    Configure lots &amp; sections in Staff Controls
                  </button>
                `
                : ''
            }
          </div>
        </div>
      `;
    } else if (this.findViewMode === 'map') {
      if (mappedSections.length === 0) {
        resultsMarkup = `
          <div class="glass-panel hub-empty-state" role="status">
            <h2 class="hub-card__title">Verified map coordinates not available</h2>
            <p class="hub-card__desc">
              Accurate geographic coordinates have not been attached to the matching sections yet. Use the list view to inspect verified section entrances and availability.
            </p>
            <button type="button" class="btn-secondary btn-compact" data-switch-find-view="list">
              Return to List view
            </button>
          </div>
        `;
      } else {
        resultsMarkup = `
          <div class="glass-panel hub-map-panel" role="region" aria-label="Verified section coordinates">
            <h2 class="hub-card__title">Verified Section Coordinates</h2>
            <p class="hub-card__desc">
              Select a section below to open verified coordinates in your maps application or record your parking location.
            </p>
            <div class="hub-sections-grid">
              ${mappedSections.map((sec) => this.renderSectionCardMarkup(sec)).join('')}
            </div>
          </div>
        `;
      }
    } else {
      if (primaryMatches.length === 0 && alternatives.length === 0) {
        resultsMarkup = `
          <div class="glass-panel hub-empty-state" role="status">
            <h2 class="hub-card__title">No matching sections available</h2>
            <p class="hub-card__desc">
              No configured parking section currently matches <strong>${escapeHtml(
                formatVehicleTypeLabel(this.selectedVehicleType)
              )}</strong>${
          this.selectedDestination ? ` near <strong>${escapeHtml(this.selectedDestination)}</strong>` : ''
        }. Try clearing the destination filter or selecting another vehicle type.
            </p>
            <button type="button" id="reset-parking-filters-btn" class="btn-secondary btn-compact">
              Show all sections for ${escapeHtml(formatVehicleTypeLabel(this.selectedVehicleType))}
            </button>
          </div>
        `;
      } else {
        const primaryNotice =
          allPrimaryFullOrClosed && this.selectedDestination
            ? `
              <div class="status-banner status-banner--config" role="status">
                <strong class="status-banner__title">Closest sections for ${escapeHtml(
                  this.selectedDestination
                )} are currently Full or Closed</strong>
                <p class="status-banner__message">
                  See recommended alternative sections with open capacity below.
                </p>
              </div>
            `
            : '';

        const primaryCards =
          primaryMatches.length > 0
            ? `
              <div class="hub-sections-block">
                <h2 class="hub-section-heading">
                  ${
                    this.selectedDestination
                      ? `Sections for ${escapeHtml(this.selectedDestination)}`
                      : `Compatible Parking Sections (${primaryMatches.length})`
                  }
                </h2>
                <div class="hub-sections-grid">
                  ${primaryMatches.map((sec) => this.renderSectionCardMarkup(sec)).join('')}
                </div>
              </div>
            `
            : '';

        const alternativeCards =
          alternatives.length > 0
            ? `
              <div class="hub-sections-block">
                <h2 class="hub-section-heading">Recommended Alternative Sections</h2>
                <div class="hub-sections-grid">
                  ${alternatives.map((sec) => this.renderSectionCardMarkup(sec, true)).join('')}
                </div>
              </div>
            `
            : '';

        resultsMarkup = `
          ${primaryNotice}
          ${primaryCards}
          ${alternativeCards}
        `;
      }
    }

    return `
      <div class="hub-page-header">
        <div>
          <p class="hub-eyebrow">Campus Parking Discovery</p>
          <h1 class="hub-title">Find Parking</h1>
          <p class="hub-subtitle">
            Filter sections by vehicle type and destination block. Availability is staff/source-verified (freshness window: ${escapeHtml(
              freshnessMinutes
            )} mins) and does not reserve or guarantee a space.
          </p>
        </div>
        <div class="hub-header-actions">
          <button type="button" class="btn-primary btn-compact" data-open-save-modal>
            I’ve parked — Save location
          </button>
        </div>
      </div>

      <!-- Filters & QR Section Lookup Bar -->
      <section class="glass-panel hub-filter-bar" aria-label="Filter parking sections">
        <div class="hub-filter-bar__controls">
          <div class="form-field">
            <label for="find-vehicle-filter" class="form-label">Vehicle type</label>
            <select id="find-vehicle-filter" class="form-input">
              <option value="bike" ${this.selectedVehicleType === 'bike' ? 'selected' : ''}>Bike / Two-Wheeler</option>
              <option value="car" ${this.selectedVehicleType === 'car' ? 'selected' : ''}>Car</option>
              <option value="other" ${this.selectedVehicleType === 'other' ? 'selected' : ''}>Other Campus Vehicle</option>
              <option value="" ${this.selectedVehicleType === '' ? 'selected' : ''}>All vehicle types</option>
            </select>
          </div>

          <div class="form-field">
            <label for="find-destination-filter" class="form-label">Destination / Academic block</label>
            <select id="find-destination-filter" class="form-input">
              ${destinationOptions}
            </select>
          </div>

          <form id="find-qr-lookup-form" class="form-field hub-qr-inline-form">
            <label for="find-qr-input" class="form-label">Section or QR code</label>
            <div class="hub-qr-inline-row">
              <input
                type="text"
                id="find-qr-input"
                class="form-input"
                placeholder="e.g. SEC-BIKE-A1"
                maxlength="64"
              />
              <button type="submit" class="btn-secondary btn-compact">
                Use code
              </button>
            </div>
          </form>

          <div class="form-field">
            <span class="form-label">Display mode</span>
            <div class="hub-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                class="hub-view-toggle__btn ${this.findViewMode === 'list' ? 'is-active' : ''}"
                data-switch-find-view="list"
                aria-pressed="${this.findViewMode === 'list' ? 'true' : 'false'}"
              >
                List view
              </button>
              <button
                type="button"
                class="hub-view-toggle__btn ${this.findViewMode === 'map' ? 'is-active' : ''}"
                data-switch-find-view="map"
                aria-pressed="${this.findViewMode === 'map' ? 'true' : 'false'}"
              >
                Map view
              </button>
            </div>
          </div>
        </div>
        ${
          this.qrLookupMessage
            ? `<p class="hub-qr-feedback" role="status">${escapeHtml(this.qrLookupMessage)}</p>`
            : ''
        }
      </section>

      ${resultsMarkup}
    `;
  }

  renderSectionCardMarkup(sec, isAlternative = false) {
    const statusLower = String(sec.status || 'Unknown').toLowerCase();
    const vehicleBadges = (sec.vehicleTypes || [])
      .map((vt) => `<span class="vehicle-type-chip">${escapeHtml(formatVehicleTypeLabel(vt))}</span>`)
      .join('');

    const capacityText =
      sec.hasReliableCount && sec.availableSpaces !== null
        ? `${sec.availableSpaces} spaces available${
            sec.capacity ? ` of ${sec.capacity}` : ''
          } (verified count)`
        : sec.capacity
        ? `Capacity: ${sec.capacity} spaces (section-level status)`
        : 'Capacity not specified (section-level status)';

    const updateText = sec.updatedAt
      ? `Updated ${formatRelativeTime(sec.updatedAt)} · Source: ${sec.source || 'Staff'}${
          sec.isStale ? ' (Outdated — marked Unknown)' : ''
        }`
      : `No recent status update · Marked Unknown`;

    const hasCoords = typeof sec.latitude === 'number' && typeof sec.longitude === 'number';
    const mapsUrl = hasCoords
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${sec.latitude},${sec.longitude}`
        )}`
      : null;

    return `
      <article class="glass-panel section-card ${isAlternative ? 'section-card--alternative' : ''}" data-section-card="${escapeHtml(
      sec.id
    )}">
        <header class="section-card__header">
          <div>
            <p class="section-card__lot">${escapeHtml(sec.lotName)} · <code class="section-card__code">${escapeHtml(
      sec.code
    )}</code></p>
            <h3 class="section-card__title">${escapeHtml(sec.name)}</h3>
          </div>
          <span class="status-pill status-pill--${escapeHtml(statusLower)}">
            ${escapeHtml(sec.status)}
          </span>
        </header>

        <div class="section-card__chips" aria-label="Accepted vehicle types">
          ${vehicleBadges}
        </div>

        <dl class="section-card__details">
          <div>
            <dt>Nearby destination</dt>
            <dd>${escapeHtml(sec.destination || 'General campus access')}</dd>
          </div>
          <div>
            <dt>Entrance location</dt>
            <dd>${escapeHtml(sec.entrance || 'Main lot entrance')}</dd>
          </div>
          <div>
            <dt>Capacity &amp; spaces</dt>
            <dd>${escapeHtml(capacityText)}</dd>
          </div>
          <div>
            <dt>Restrictions</dt>
            <dd>${escapeHtml(sec.restrictions || 'Standard campus permit')}</dd>
          </div>
          ${
            sec.closureReason
              ? `
                <div class="section-card__closure">
                  <dt>Closure notice</dt>
                  <dd>${escapeHtml(sec.closureReason)}</dd>
                </div>
              `
              : ''
          }
        </dl>

        <p class="section-card__freshness">${escapeHtml(updateText)}</p>

        <footer class="section-card__actions">
          <button
            type="button"
            class="btn-primary btn-compact"
            data-park-here="${escapeHtml(sec.id)}"
            ${sec.status === 'Closed' ? 'disabled' : ''}
          >
            ${sec.status === 'Closed' ? 'Section Closed' : 'I’ve parked here'}
          </button>
          ${
            mapsUrl
              ? `
                <a
                  href="${escapeHtml(mapsUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn-secondary btn-compact"
                >
                  Directions
                </a>
              `
              : ''
          }
          <button
            type="button"
            class="btn-ghost-pill btn-ghost-pill--sm"
            data-report-section="${escapeHtml(sec.id)}"
          >
            Report issue
          </button>
        </footer>
      </article>
    `;
  }

  bindFindParkingEvents(container) {
    container.querySelector('#find-vehicle-filter')?.addEventListener('change', (e) => {
      this.selectedVehicleType = e.target.value;
      this.qrLookupMessage = null;
      this.renderActiveViewContent();
    });

    container.querySelector('#find-destination-filter')?.addEventListener('change', (e) => {
      this.selectedDestination = e.target.value;
      this.qrLookupMessage = null;
      this.renderActiveViewContent();
    });

    container.querySelector('#reset-parking-filters-btn')?.addEventListener('click', () => {
      this.selectedDestination = '';
      this.renderActiveViewContent();
    });

    container.querySelectorAll('[data-switch-find-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-switch-find-view');
        if (mode === 'list' || mode === 'map') {
          this.findViewMode = mode;
          this.renderActiveViewContent();
        }
      });
    });

    container.querySelector('[data-go-staff]')?.addEventListener('click', () => {
      this.navigateTo('staff');
    });

    container.querySelectorAll('[data-open-save-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openSaveParkingModal({
          mode: parkingService.activeSession ? 'edit' : 'create',
          preselect: { vehicleType: this.selectedVehicleType || 'bike' },
        });
      });
    });

    // QR / Section Code lookup
    container.querySelector('#find-qr-lookup-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = container.querySelector('#find-qr-input');
      const code = input?.value?.trim() || '';
      if (!code) return;

      try {
        const matched = await parkingService.lookupSectionByQr(code);
        this.qrLookupMessage = `Matched section ${matched.name} (${matched.code}). Pre-selected for saving your location.`;
        this.openSaveParkingModal({
          mode: parkingService.activeSession ? 'edit' : 'create',
          preselect: {
            lotId: matched.lotId,
            sectionId: matched.id,
            vehicleType: matched.vehicleTypes?.[0] || this.selectedVehicleType || 'bike',
          },
        });
      } catch (err) {
        this.qrLookupMessage = err?.message || 'No matching section found for that code.';
        this.renderActiveViewContent();
      }
    });

    // "I've parked here" on a specific section card
    container.querySelectorAll('[data-park-here]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sectionId = btn.getAttribute('data-park-here');
        const sec = (parkingService.sections || []).find((s) => s.id === sectionId);
        if (!sec) return;
        const chosenVehicle =
          this.selectedVehicleType && sec.vehicleTypes?.includes(this.selectedVehicleType)
            ? this.selectedVehicleType
            : sec.vehicleTypes?.[0] || 'bike';

        this.openSaveParkingModal({
          mode: parkingService.activeSession ? 'edit' : 'create',
          preselect: {
            lotId: sec.lotId,
            sectionId: sec.id,
            vehicleType: chosenVehicle,
          },
        });
      });
    });

    // "Report issue" on a section card
    container.querySelectorAll('[data-report-section]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sectionId = btn.getAttribute('data-report-section');
        const sec = (parkingService.sections || []).find((s) => s.id === sectionId);
        if (sec) {
          this.openReportModal(sec, btn);
        }
      });
    });
  }

  // ===========================================================================
  // VIEW 3: MY VEHICLE & RETRIEVAL (Requirement 9)
  // ===========================================================================
  renderMyVehicleMarkup() {
    const activeSession = parkingService.activeSession;
    const staleHours = parkingService.settings?.staleVehicleHours || 12;

    if (!activeSession) {
      return `
        <div class="hub-page-header">
          <div>
            <p class="hub-eyebrow">Vehicle Retrieval Memory Aid</p>
            <h1 class="hub-title">My Vehicle</h1>
            <p class="hub-subtitle">
              Locate your parked bike, car, or campus vehicle with saved lot, section, bay, and landmark details.
            </p>
          </div>
        </div>

        <section class="glass-panel hub-empty-state" aria-labelledby="no-saved-vehicle-heading">
          <h2 id="no-saved-vehicle-heading" class="hub-card__title">No parked vehicle location saved</h2>
          <p class="hub-card__desc">
            You do not have an active parked vehicle recorded right now. After parking on campus, save your lot, section, row/bay, or scan the section QR code so you can easily find your way back.
          </p>
          <div class="hub-card__actions">
            <button type="button" class="btn-primary btn-compact" data-open-save-modal>
              Save parking location
            </button>
            <button type="button" class="btn-secondary btn-compact" data-go-find-parking>
              Find parking
            </button>
          </div>
        </section>
      `;
    }

    const hasCoords =
      typeof activeSession.latitude === 'number' && typeof activeSession.longitude === 'number';
    const walkingMapsUrl = hasCoords
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
          `${activeSession.latitude},${activeSession.longitude}`
        )}&travelmode=walking`
      : null;

    return `
      <div class="hub-page-header">
        <div>
          <p class="hub-eyebrow">Vehicle Retrieval &amp; Wayfinding</p>
          <h1 class="hub-title">My Vehicle</h1>
          <p class="hub-subtitle">
            Private parking record for your ${escapeHtml(
              formatVehicleTypeLabel(activeSession.vehicleType)
            )}.
          </p>
        </div>
        <div class="hub-header-actions">
          <button type="button" class="btn-secondary btn-compact" data-correct-location>
            Correct location
          </button>
          <button type="button" class="btn-primary btn-compact" data-end-session="${escapeHtml(
            activeSession.id
          )}">
            I’ve left
          </button>
        </div>
      </div>

      ${
        activeSession.isLongRunning
          ? `
            <div class="glass-panel stale-session-banner" role="region" aria-label="Stale parking session check">
              <div class="stale-session-banner__body">
                <strong class="stale-session-banner__title">Still parked in ${escapeHtml(
                  activeSession.sectionName || activeSession.lotName
                )}?</strong>
                <p class="stale-session-banner__text">
                  This location was saved over ${escapeHtml(staleHours)} hours ago. We never clear your saved location automatically—please confirm if your vehicle is still parked or mark that you have left.
                </p>
              </div>
              <div class="stale-session-banner__actions">
                <button type="button" class="btn-secondary btn-compact" data-confirm-still-parked="${escapeHtml(
                  activeSession.id
                )}">
                  Yes, still parked
                </button>
                <button type="button" class="btn-primary btn-compact" data-end-session="${escapeHtml(
                  activeSession.id
                )}">
                  I’ve left
                </button>
              </div>
            </div>
          `
          : ''
      }

      <div class="hub-overview-grid">
        <!-- Saved Hierarchy & Details Card -->
        <section class="glass-panel hub-card hub-card--featured" aria-labelledby="retrieval-location-heading">
          <div class="hub-card__badge-row">
            <span class="status-pill status-pill--available">Saved Location</span>
            <span class="hub-card__meta-tag">${escapeHtml(
              formatVehicleTypeLabel(activeSession.vehicleType)
            )}${activeSession.vehicleLabel ? ` · ${escapeHtml(activeSession.vehicleLabel)}` : ''}</span>
          </div>

          <h2 id="retrieval-location-heading" class="hub-card__title">
            ${escapeHtml(activeSession.lotName || 'Campus Lot')} → ${escapeHtml(
      activeSession.sectionName || 'Section'
    )}${activeSession.sectionCode ? ` (${escapeHtml(activeSession.sectionCode)})` : ''}
          </h2>

          <dl class="vehicle-detail-grid">
            <div class="vehicle-detail-item">
              <dt>Parking Lot</dt>
              <dd>${escapeHtml(activeSession.lotName || 'Not specified')}</dd>
            </div>
            <div class="vehicle-detail-item">
              <dt>Vehicle Section</dt>
              <dd>${escapeHtml(activeSession.sectionName || 'Not specified')}${
      activeSession.sectionCode ? ` · ${escapeHtml(activeSession.sectionCode)}` : ''
    }</dd>
            </div>
            <div class="vehicle-detail-item">
              <dt>Row</dt>
              <dd>${escapeHtml(activeSession.row || 'Not marked')}</dd>
            </div>
            <div class="vehicle-detail-item">
              <dt>Bay</dt>
              <dd>${escapeHtml(activeSession.bay || 'Not marked')}</dd>
            </div>
            <div class="vehicle-detail-item">
              <dt>Parking Time</dt>
              <dd>${escapeHtml(formatDateTime(activeSession.parkedAt))}</dd>
            </div>
            <div class="vehicle-detail-item">
              <dt>Saved GPS Pin</dt>
              <dd>${
                hasCoords
                  ? `${activeSession.latitude.toFixed(5)}, ${activeSession.longitude.toFixed(5)}`
                  : 'No GPS pin attached'
              }</dd>
            </div>
            ${
              activeSession.note
                ? `
                  <div class="vehicle-detail-item vehicle-detail-item--wide">
                    <dt>Landmark / Retrieval Note</dt>
                    <dd>${escapeHtml(activeSession.note)}</dd>
                  </div>
                `
                : ''
            }
          </dl>

          ${
            activeSession.hasPhoto && activeSession.photoUrl
              ? `
                <div class="vehicle-photo-block">
                  <p class="form-label">Private Surroundings Photo (Visible only to you)</p>
                  <img
                    src="${escapeHtml(activeSession.photoUrl)}?t=${Date.now()}"
                    alt="Saved surroundings photo for your parked vehicle"
                    class="vehicle-photo-preview"
                    loading="lazy"
                  />
                </div>
              `
              : ''
          }

          <div class="hub-card__actions">
            <button type="button" id="focus-retrieval-guide-btn" class="btn-primary btn-compact">
              Find my vehicle
            </button>
            <button type="button" class="btn-secondary btn-compact" data-correct-location>
              Correct location
            </button>
            <button type="button" class="btn-ghost-pill btn-ghost-pill--danger" data-end-session="${escapeHtml(
              activeSession.id
            )}">
              I’ve left (Delete saved record)
            </button>
          </div>
        </section>

        <!-- Retrieval & Wayfinding Card -->
        <section id="retrieval-guidance-card" class="glass-panel hub-card" tabindex="-1" aria-labelledby="retrieval-wayfinding-heading">
          <p class="hub-eyebrow">Return Guidance</p>
          <h2 id="retrieval-wayfinding-heading" class="hub-card__title">How to Return to Your Vehicle</h2>

          <div class="retrieval-steps">
            <div class="retrieval-step">
              <span class="retrieval-step__num">1</span>
              <div>
                <strong>Head toward the verified destination landmark</strong>
                <p>${escapeHtml(
                  activeSession.destination ||
                    activeSession.lotName ||
                    'Return to your saved campus parking lot.'
                )}</p>
              </div>
            </div>
            <div class="retrieval-step">
              <span class="retrieval-step__num">2</span>
              <div>
                <strong>Use the designated section entrance</strong>
                <p>${escapeHtml(
                  activeSession.entrance ||
                    `Enter ${activeSession.sectionName || 'your saved vehicle section'}.`
                )}</p>
              </div>
            </div>
            <div class="retrieval-step">
              <span class="retrieval-step__num">3</span>
              <div>
                <strong>Check your saved row, bay, and note</strong>
                <p>
                  ${
                    activeSession.row || activeSession.bay
                      ? `Row: ${escapeHtml(activeSession.row || '—')} · Bay: ${escapeHtml(
                          activeSession.bay || '—'
                        )}`
                      : 'No specific row/bay number recorded.'
                  }
                  ${activeSession.note ? ` — "${escapeHtml(activeSession.note)}"` : ''}
                </p>
              </div>
            </div>
          </div>

          ${
            walkingMapsUrl
              ? `
                <div class="hub-card__actions">
                  <a
                    href="${escapeHtml(walkingMapsUrl)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn-primary btn-compact"
                  >
                    Open walking directions in Maps
                  </a>
                </div>
              `
              : `
                <p class="field-hint">
                  Verified map coordinates are not attached to this record. Follow the campus block and section entrance details above, or tap "Correct location" to attach a GPS pin.
                </p>
              `
          }
        </section>
      </div>
    `;
  }

  bindMyVehicleEvents(container) {
    container.querySelectorAll('[data-open-save-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openSaveParkingModal({ mode: 'create' });
      });
    });

    container.querySelector('[data-go-find-parking]')?.addEventListener('click', () => {
      this.navigateTo('find-parking');
    });

    container.querySelectorAll('[data-correct-location]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openSaveParkingModal({ mode: 'edit' });
      });
    });

    container.querySelector('#focus-retrieval-guide-btn')?.addEventListener('click', () => {
      const guide = container.querySelector('#retrieval-guidance-card');
      guide?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      guide?.focus();
    });

    container.querySelectorAll('[data-end-session]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sessionId = btn.getAttribute('data-end-session');
        if (sessionId) {
          await this.handleEndParkingSession(sessionId);
        }
      });
    });

    container.querySelectorAll('[data-confirm-still-parked]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sessionId = btn.getAttribute('data-confirm-still-parked');
        if (!sessionId) return;
        try {
          await parkingService.updateParkingSession(sessionId, { confirmStillParked: true });
          this.globalBanner = {
            type: 'info',
            message: 'Confirmed—your vehicle parking session remains active.',
          };
          this.renderActiveViewContent();
        } catch (err) {
          this.globalBanner = {
            type: 'error',
            message: err?.message || 'Unable to confirm session status.',
          };
          this.renderGlobalBanner();
        }
      });
    });
  }

  async handleEndParkingSession(sessionId) {
    try {
      await parkingService.endParkingSession(sessionId);
      this.globalBanner = {
        type: 'info',
        message: 'Parking session ended and private location record cleared.',
      };
      this.renderActiveViewContent();
    } catch (err) {
      this.globalBanner = {
        type: 'error',
        message: err?.message || 'Could not clear your saved parking session.',
      };
      this.renderGlobalBanner();
    }
  }

  // ===========================================================================
  // VIEW 4: SHARED REVIEWS IN HUB (Requirement 11)
  // ===========================================================================
  mountHubReviews(mountEl) {
    if (!mountEl) return;
    this.hubReviewsComponent = new ReviewSection({
      mountNode: mountEl,
      mode: 'hub',
      idPrefix: 'hub',
    });
    this.hubReviewsComponent.init();
    this.hubReviewsComponent.open();
  }

  // ===========================================================================
  // VIEW 5: PROFILE (Requirement 13 + Campus Affiliation & Profile Picture)
  // ===========================================================================
  ensureProfileDraft(user) {
    if (!user) return;
    if (this.profileDraftUserId !== user.id) {
      this.profileDraftUserId = user.id;
      this.profileDraftName = user.fullName || '';
      this.profileDraftAffiliation =
        user.campusAffiliation === 'student' || user.campusAffiliation === 'staff'
          ? user.campusAffiliation
          : '';
      this.profileStagedAvatarDataUrl = null;
      this.profileStagedRemoveAvatar = false;
      this.profilePhotoNotice = null;
    }
  }

  syncProfileDraftFromDom(container) {
    if (!container) return;
    const nameInput = container.querySelector('#profile-fullname-input');
    const affSelect = container.querySelector('#profile-affiliation-select');
    if (nameInput) {
      this.profileDraftName = nameInput.value;
    }
    if (affSelect) {
      this.profileDraftAffiliation = affSelect.value;
    }
  }

  stopProfileCameraStream() {
    if (this.profileCameraStream) {
      try {
        this.profileCameraStream.getTracks().forEach((track) => track.stop());
      } catch {
        // Ignore stream cleanup errors
      }
      this.profileCameraStream = null;
    }
    const videoEl = this.mountNode?.querySelector('#profile-camera-video');
    if (videoEl && videoEl.srcObject) {
      videoEl.srcObject = null;
    }
  }

  async processAndOptimizeAvatarFile(file) {
    const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB limit
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    if (!file) {
      throw new Error('No image file selected.');
    }

    const normalizedType =
      file.type === 'image/jpg' ? 'image/jpeg' : String(file.type || '').toLowerCase();
    if (!ALLOWED_TYPES.includes(normalizedType)) {
      throw new Error(
        'Unsupported file format. Please select a JPEG, PNG, or WebP image (maximum 5 MB).'
      );
    }

    if (file.size <= 0) {
      throw new Error('Selected image file is empty. Please choose a valid JPEG, PNG, or WebP image.');
    }

    if (file.size > MAX_FILE_BYTES) {
      throw new Error(
        'Selected image exceeds the 5 MB upload limit. Please choose a JPEG, PNG, or WebP image under 5 MB.'
      );
    }

    // Verify magic bytes before decoding
    const headerBuf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isJpeg = headerBuf[0] === 0xff && headerBuf[1] === 0xd8 && headerBuf[2] === 0xff;
    const isPng =
      headerBuf[0] === 0x89 &&
      headerBuf[1] === 0x50 &&
      headerBuf[2] === 0x4e &&
      headerBuf[3] === 0x47;
    const isWebp =
      headerBuf[0] === 0x52 &&
      headerBuf[1] === 0x49 &&
      headerBuf[2] === 0x46 &&
      headerBuf[3] === 0x46 &&
      headerBuf[8] === 0x57 &&
      headerBuf[9] === 0x45 &&
      headerBuf[10] === 0x42 &&
      headerBuf[11] === 0x50;

    if (!isJpeg && !isPng && !isWebp) {
      throw new Error(
        'File content does not match a valid JPEG, PNG, or WebP image (maximum 5 MB).'
      );
    }

    // Load image, center-crop square to preserve proportions without stretching,
    // resize to max 512x512 for avatar use, and re-encode via <canvas> to strip EXIF/GPS metadata.
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () =>
          reject(new Error('Could not decode image. Please select a valid JPEG, PNG, or WebP file.'));
        image.src = objectUrl;
      });

      const srcW = img.naturalWidth || img.width || 1;
      const srcH = img.naturalHeight || img.height || 1;
      const minSide = Math.min(srcW, srcH);
      const sx = Math.max(0, Math.floor((srcW - minSide) / 2));
      const sy = Math.max(0, Math.floor((srcH - minSide) / 2));
      const targetSize = Math.min(512, minSide);

      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Unable to prepare image preview.');
      }
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);

      const outputMime =
        normalizedType === 'image/png'
          ? 'image/png'
          : normalizedType === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg';
      return canvas.toDataURL(outputMime, 0.9);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  renderProfileMarkup() {
    const user = authService.currentUser;
    if (!user) return '';

    this.ensureProfileDraft(user);

    const roleLabel =
      user.role === 'staff' || user.role === 'admin'
        ? 'Authorized Parking Staff'
        : 'Campus Member (Student / Staff Rider)';

    const hasSavedPhoto = Boolean(user.hasProfilePhoto && user.profilePhotoUrl);
    const effectivePhotoSrc = this.profileStagedAvatarDataUrl
      ? this.profileStagedAvatarDataUrl
      : !this.profileStagedRemoveAvatar && hasSavedPhoto
      ? user.profilePhotoUrl
      : null;
    const canRemovePhoto = Boolean(effectivePhotoSrc);
    const initials = computeInitials(this.profileDraftName || user.fullName || user.email);

    return `
      <div class="hub-page-header">
        <div>
          <p class="hub-eyebrow">Account Settings</p>
          <h1 class="hub-title">Profile</h1>
          <p class="hub-subtitle">Manage your display name and inspect your campus account details.</p>
        </div>
      </div>

      <div class="hub-profile-wrapper">
        <section class="glass-panel hub-card" aria-labelledby="profile-card-heading">
          <h2 id="profile-card-heading" class="hub-card__title">Account Information</h2>

          ${
            this.profileBanner
              ? `
                <div class="status-banner status-banner--${escapeHtml(
                  this.profileBanner.type
                )}" role="alert">
                  <p class="status-banner__message">${escapeHtml(this.profileBanner.message)}</p>
                </div>
              `
              : ''
          }

          <form id="hub-profile-form" class="auth-form" novalidate>
            <!-- Compact Profile Picture Area (Above Display Name) -->
            <div class="profile-avatar-block">
              <div class="profile-avatar-row">
                <div class="profile-avatar" id="profile-avatar-preview">
                  ${
                    effectivePhotoSrc
                      ? `<img
                          src="${escapeHtml(effectivePhotoSrc)}"
                          alt="Profile picture preview for ${escapeHtml(
                            this.profileDraftName || user.fullName || 'your account'
                          )}"
                          class="profile-avatar__img"
                          width="72"
                          height="72"
                        />`
                      : `<span
                          class="profile-avatar__initials"
                          role="img"
                          aria-label="Profile avatar placeholder with initials ${escapeHtml(initials)}"
                        >${escapeHtml(initials)}</span>`
                  }
                </div>

                <div class="profile-avatar-controls">
                  <span class="form-label">Profile picture</span>
                  <div class="profile-avatar-actions">
                    <input
                      type="file"
                      id="profile-photo-file-input"
                      accept="image/jpeg,image/png,image/webp"
                      class="visually-hidden"
                      tabindex="-1"
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      id="profile-upload-photo-btn"
                      class="btn-secondary btn-compact profile-photo-btn"
                      aria-describedby="profile-photo-hint"
                    >
                      Upload photo
                    </button>
                    <button
                      type="button"
                      id="profile-take-photo-btn"
                      class="btn-secondary btn-compact profile-photo-btn"
                      aria-haspopup="dialog"
                      aria-controls="profile-camera-modal"
                    >
                      Take photo
                    </button>
                    ${
                      canRemovePhoto
                        ? `<button
                            type="button"
                            id="profile-remove-photo-btn"
                            class="btn-ghost-pill btn-ghost-pill--sm btn-ghost-pill--danger"
                          >
                            Remove photo
                          </button>`
                        : ''
                    }
                  </div>
                  <span id="profile-photo-hint" class="field-hint">
                    Accepted formats: JPEG, PNG, or WebP (max 5 MB). Private to your account and never shown on public reviews.
                  </span>
                  ${
                    this.profileStagedAvatarDataUrl
                      ? `<span class="profile-photo-staged-note" role="status">Preview ready — click “Save profile changes” below to save.</span>`
                      : this.profileStagedRemoveAvatar && hasSavedPhoto
                      ? `<span class="profile-photo-staged-note profile-photo-staged-note--remove" role="status">Photo marked for removal — click “Save profile changes” below to confirm.</span>`
                      : ''
                  }
                </div>
              </div>

              ${
                this.profilePhotoNotice
                  ? `<div class="status-banner status-banner--${escapeHtml(
                      this.profilePhotoNotice.type
                    )}" role="status" aria-live="polite">
                      <p class="status-banner__message">${escapeHtml(
                        this.profilePhotoNotice.message
                      )}</p>
                    </div>`
                  : ''
              }
            </div>

            <div class="form-field">
              <label for="profile-fullname-input" class="form-label">Display name (Full name)</label>
              <input
                type="text"
                id="profile-fullname-input"
                name="fullName"
                class="form-input"
                autocomplete="name"
                required
                maxlength="100"
                value="${escapeHtml(this.profileDraftName)}"
              />
              <span class="field-hint">Shown publicly when you post a campus parking review.</span>
            </div>

            <div class="form-field">
              <label for="profile-affiliation-select" class="form-label">Campus affiliation</label>
              <select
                id="profile-affiliation-select"
                name="campusAffiliation"
                class="form-input"
                aria-describedby="profile-affiliation-hint"
              >
                <option value="" ${!this.profileDraftAffiliation ? 'selected' : ''}>Select your affiliation</option>
                <option value="student" ${
                  this.profileDraftAffiliation === 'student' ? 'selected' : ''
                }>Student</option>
                <option value="staff" ${
                  this.profileDraftAffiliation === 'staff' ? 'selected' : ''
                }>Staff</option>
              </select>
              <span id="profile-affiliation-hint" class="field-hint">
                Stored in your member profile. Selecting Staff does not change your account role or administrative permissions.
              </span>
            </div>

            <div class="form-field">
              <label for="profile-email-readonly" class="form-label">Email address</label>
              <input
                type="email"
                id="profile-email-readonly"
                class="form-input"
                value="${escapeHtml(user.email || '')}"
                readonly
                aria-readonly="true"
              />
              <span class="field-hint">Your email address is kept private and never shown on public reviews.</span>
            </div>

            <dl class="vehicle-detail-grid">
              <div class="vehicle-detail-item">
                <dt>Account Role</dt>
                <dd>${escapeHtml(roleLabel)}</dd>
              </div>
              <div class="vehicle-detail-item">
                <dt>Session Mode</dt>
                <dd>${
                  user.persistence === 'persistent'
                    ? 'Remembered device session'
                    : 'Standard browser session'
                }</dd>
              </div>
            </dl>

            <div class="hub-card__actions">
              <button
                type="submit"
                id="profile-save-btn"
                class="btn-primary btn-compact"
                ${this.isSavingProfile ? 'disabled' : ''}
              >
                ${
                  this.isSavingProfile
                    ? `<progress aria-label="Saving profile" class="loading-spinner"></progress><span>Saving…</span>`
                    : `<span>Save profile changes</span>`
                }
              </button>
            </div>
          </form>
        </section>
      </div>

      <!-- Camera Capture Dialog for Profile Picture -->
      <dialog
        id="profile-camera-modal"
        class="glass-modal"
        closedby="any"
        aria-labelledby="profile-camera-modal-title"
      >
        <div class="glass-modal__inner">
          <div class="glass-modal__header">
            <div>
              <p class="glass-modal__eyebrow">Profile Picture</p>
              <h2 id="profile-camera-modal-title" class="glass-modal__title">Take Profile Photo</h2>
            </div>
            <button
              type="button"
              id="profile-camera-close-btn"
              class="glass-modal__icon-close"
              aria-label="Cancel camera capture"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <p class="glass-modal__subtitle">
            Position yourself in the circular frame. The camera stream stops as soon as you capture or cancel.
          </p>

          <div class="profile-camera-viewport">
            <video
              id="profile-camera-video"
              class="profile-camera-viewport__media"
              width="320"
              height="320"
              autoplay
              playsinline
              muted
            ></video>
            <img
              id="profile-camera-captured-img"
              class="profile-camera-viewport__media"
              width="320"
              height="320"
              alt="Captured profile picture preview"
              hidden
            />
          </div>

          <p id="profile-camera-status" class="field-hint" aria-live="polite"></p>

          <div class="glass-modal__footer profile-camera-footer">
            <button
              type="button"
              id="profile-camera-capture-btn"
              class="btn-primary btn-compact"
            >
              Capture
            </button>
            <button
              type="button"
              id="profile-camera-retake-btn"
              class="btn-secondary btn-compact"
              hidden
            >
              Retake
            </button>
            <button
              type="button"
              id="profile-camera-use-btn"
              class="btn-primary btn-compact"
              hidden
            >
              Use photo
            </button>
            <button
              type="button"
              id="profile-camera-cancel-btn"
              class="btn-ghost-pill btn-ghost-pill--sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </dialog>
    `;
  }

  async startProfileCameraLiveStream(container) {
    const videoEl = container.querySelector('#profile-camera-video');
    const capturedImg = container.querySelector('#profile-camera-captured-img');
    const captureBtn = container.querySelector('#profile-camera-capture-btn');
    const retakeBtn = container.querySelector('#profile-camera-retake-btn');
    const useBtn = container.querySelector('#profile-camera-use-btn');
    const statusEl = container.querySelector('#profile-camera-status');

    this.stopProfileCameraStream();
    this.profileCameraCapturedDataUrl = null;

    if (capturedImg) {
      capturedImg.hidden = true;
      capturedImg.removeAttribute('src');
    }
    if (videoEl) {
      videoEl.hidden = false;
    }
    if (captureBtn) {
      captureBtn.hidden = false;
      captureBtn.disabled = true;
    }
    if (retakeBtn) retakeBtn.hidden = true;
    if (useBtn) useBtn.hidden = true;
    if (statusEl) statusEl.textContent = 'Requesting camera permission…';

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error(
        'Camera capture is unavailable in this browser. Please use "Upload photo" to choose a JPEG, PNG, or WebP image (up to 5 MB).'
      );
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 640 },
      },
      audio: false,
    });

    this.profileCameraStream = stream;
    if (videoEl) {
      videoEl.srcObject = stream;
      await videoEl.play().catch(() => {});
    }
    if (captureBtn) {
      captureBtn.disabled = false;
    }
    if (statusEl) {
      statusEl.textContent = 'Camera ready. Click "Capture" to take your photo.';
    }
  }

  bindProfileEvents(container) {
    const form = container.querySelector('#hub-profile-form');
    const nameInput = container.querySelector('#profile-fullname-input');
    const affSelect = container.querySelector('#profile-affiliation-select');
    const fileInput = container.querySelector('#profile-photo-file-input');
    const uploadBtn = container.querySelector('#profile-upload-photo-btn');
    const takePhotoBtn = container.querySelector('#profile-take-photo-btn');
    const removePhotoBtn = container.querySelector('#profile-remove-photo-btn');

    const cameraModal = container.querySelector('#profile-camera-modal');
    const cameraVideo = container.querySelector('#profile-camera-video');
    const cameraCapturedImg = container.querySelector('#profile-camera-captured-img');
    const cameraStatus = container.querySelector('#profile-camera-status');
    const captureBtn = container.querySelector('#profile-camera-capture-btn');
    const retakeBtn = container.querySelector('#profile-camera-retake-btn');
    const usePhotoBtn = container.querySelector('#profile-camera-use-btn');
    const cancelCameraBtn = container.querySelector('#profile-camera-cancel-btn');
    const closeCameraBtn = container.querySelector('#profile-camera-close-btn');

    // Keep draft state synced as the user edits name or affiliation
    nameInput?.addEventListener('input', () => {
      this.profileDraftName = nameInput.value;
    });
    affSelect?.addEventListener('change', () => {
      this.profileDraftAffiliation = affSelect.value;
    });

    // 1. "Upload photo" button -> opens file picker
    uploadBtn?.addEventListener('click', () => {
      this.syncProfileDraftFromDom(container);
      fileInput?.click();
    });

    fileInput?.addEventListener('change', async () => {
      this.syncProfileDraftFromDom(container);
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await this.processAndOptimizeAvatarFile(file);
        this.profileStagedAvatarDataUrl = dataUrl;
        this.profileStagedRemoveAvatar = false;
        this.profilePhotoNotice = null;
        this.renderActiveViewContent();
      } catch (err) {
        // Keep previous saved/staged photo intact on validation error
        this.profilePhotoNotice = {
          type: 'error',
          message:
            err?.message ||
            'Could not use the selected file. Please choose a valid JPEG, PNG, or WebP image under 5 MB.',
        };
        this.renderActiveViewContent();
      } finally {
        fileInput.value = '';
      }
    });

    // 2. "Remove photo" button -> stages removal (or clears staged preview)
    removePhotoBtn?.addEventListener('click', () => {
      this.syncProfileDraftFromDom(container);
      const user = authService.currentUser;
      this.profileStagedAvatarDataUrl = null;
      this.profileStagedRemoveAvatar = Boolean(user?.hasProfilePhoto);
      this.profilePhotoNotice = null;
      this.renderActiveViewContent();
    });

    // 3. "Take photo" button -> requests camera permission ONLY on click
    const closeAndReleaseCameraModal = () => {
      this.stopProfileCameraStream();
      this.profileCameraCapturedDataUrl = null;
      if (cameraModal?.open) {
        cameraModal.close();
      } else if (cameraModal) {
        cameraModal.removeAttribute('open');
      }
      takePhotoBtn?.focus();
    };

    cameraModal?.addEventListener('close', () => {
      this.stopProfileCameraStream();
      this.profileCameraCapturedDataUrl = null;
    });

    takePhotoBtn?.addEventListener('click', async () => {
      this.syncProfileDraftFromDom(container);
      this.profilePhotoNotice = null;

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        this.profilePhotoNotice = {
          type: 'error',
          message:
            'Camera capture is not supported in this browser or context. You can still use "Upload photo" to select a JPEG, PNG, or WebP image (up to 5 MB).',
        };
        this.renderActiveViewContent();
        return;
      }

      if (cameraModal) {
        if (typeof cameraModal.showModal === 'function') {
          cameraModal.showModal();
        } else {
          cameraModal.setAttribute('open', '');
        }
      }

      try {
        await this.startProfileCameraLiveStream(container);
      } catch {
        closeAndReleaseCameraModal();
        this.profilePhotoNotice = {
          type: 'error',
          message:
            'Camera access was denied or no camera was found. You can still use "Upload photo" to select a JPEG, PNG, or WebP image (up to 5 MB).',
        };
        this.renderActiveViewContent();
      }
    });

    // Camera "Capture" -> captures square frame, stops live camera stream immediately, shows Retake & Use photo
    captureBtn?.addEventListener('click', () => {
      if (!cameraVideo) return;
      const vw = cameraVideo.videoWidth || 320;
      const vh = cameraVideo.videoHeight || 320;
      const minSide = Math.max(1, Math.min(vw, vh));
      const sx = Math.max(0, Math.floor((vw - minSide) / 2));
      const sy = Math.max(0, Math.floor((vh - minSide) / 2));
      const targetSize = Math.min(512, minSide);

      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(cameraVideo, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);
      this.profileCameraCapturedDataUrl = canvas.toDataURL('image/jpeg', 0.9);

      // Stop camera stream as soon as capture finishes
      this.stopProfileCameraStream();

      cameraVideo.hidden = true;
      if (cameraCapturedImg) {
        cameraCapturedImg.src = this.profileCameraCapturedDataUrl;
        cameraCapturedImg.hidden = false;
      }
      captureBtn.hidden = true;
      if (retakeBtn) retakeBtn.hidden = false;
      if (usePhotoBtn) {
        usePhotoBtn.hidden = false;
        usePhotoBtn.focus();
      }
      if (cameraStatus) {
        cameraStatus.textContent =
          'Photo captured and camera released. Choose "Use photo" to preview it on your profile, or "Retake".';
      }
    });

    // Camera "Retake" -> restarts stream for another capture
    retakeBtn?.addEventListener('click', async () => {
      try {
        await this.startProfileCameraLiveStream(container);
      } catch {
        closeAndReleaseCameraModal();
        this.profilePhotoNotice = {
          type: 'error',
          message:
            'Unable to restart the camera. You can still use "Upload photo" to select an image.',
        };
        this.renderActiveViewContent();
      }
    });

    // Camera "Use photo" -> stages captured photo in Profile preview
    usePhotoBtn?.addEventListener('click', () => {
      if (!this.profileCameraCapturedDataUrl) return;
      this.profileStagedAvatarDataUrl = this.profileCameraCapturedDataUrl;
      this.profileStagedRemoveAvatar = false;
      this.profilePhotoNotice = null;
      closeAndReleaseCameraModal();
      this.renderActiveViewContent();
    });

    // Camera "Cancel" / close button -> stops stream and discards capture
    cancelCameraBtn?.addEventListener('click', closeAndReleaseCameraModal);
    closeCameraBtn?.addEventListener('click', closeAndReleaseCameraModal);

    // 4. "Save profile changes" form submission
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (this.isSavingProfile) return;

      this.syncProfileDraftFromDom(container);
      const fullName = (this.profileDraftName || '').trim();
      const campusAffiliation = this.profileDraftAffiliation || '';

      if (!fullName || !/\p{L}/u.test(fullName)) {
        this.profileBanner = {
          type: 'error',
          message: 'Please enter a valid display name containing at least one letter.',
        };
        this.renderActiveViewContent();
        return;
      }

      if (campusAffiliation !== '' && campusAffiliation !== 'student' && campusAffiliation !== 'staff') {
        this.profileBanner = {
          type: 'error',
          message: 'Please select a valid campus affiliation (Student or Staff).',
        };
        this.renderActiveViewContent();
        return;
      }

      this.isSavingProfile = true;
      this.profileBanner = null;
      this.renderActiveViewContent();

      try {
        const updatedUser = await authService.updateProfile({
          fullName,
          campusAffiliation: campusAffiliation || null,
          avatarDataUrl: this.profileStagedAvatarDataUrl || undefined,
          removeAvatar: this.profileStagedRemoveAvatar || undefined,
        });

        this.isSavingProfile = false;
        this.profileDraftName = updatedUser?.fullName || fullName;
        this.profileDraftAffiliation = updatedUser?.campusAffiliation || '';
        this.profileStagedAvatarDataUrl = null;
        this.profileStagedRemoveAvatar = false;
        this.profilePhotoNotice = null;
        this.profileBanner = {
          type: 'info',
          message: 'Your profile changes have been saved.',
        };
        this.renderActiveViewContent();
      } catch (err) {
        // Preserve the user's unsaved edits and staged photo preview on error
        this.isSavingProfile = false;
        this.profileBanner = {
          type: 'error',
          message: err?.message || 'Unable to update your profile right now.',
        };
        this.renderActiveViewContent();
      }
    });
  }

  // ===========================================================================
  // VIEW 6: PROTECTED STAFF CONTROLS (Requirement 10)
  // ===========================================================================
  async loadStaffOverview() {
    this.isLoadingStaff = true;
    this.renderActiveViewContent();
    try {
      this.staffData = await parkingService.fetchStaffOverview();
    } catch (err) {
      this.staffBanner = {
        type: 'error',
        message: err?.message || 'Unable to load staff maintenance data.',
      };
    } finally {
      this.isLoadingStaff = false;
      this.renderActiveViewContent();
    }
  }

  renderStaffMarkup() {
    const user = authService.currentUser;
    if (!user || (user.role !== 'staff' && user.role !== 'admin')) {
      return `
        <div class="glass-panel hub-empty-state" role="alert">
          <h2 class="hub-card__title">Authorized Staff Access Required</h2>
          <p class="hub-card__desc">This section is restricted to authorized campus parking staff.</p>
        </div>
      `;
    }

    const lots = this.staffData?.lots || parkingService.lots || [];
    const sections = this.staffData?.sections || parkingService.sections || [];
    const reports = this.staffData?.reports || [];
    const history = this.staffData?.statusHistory || [];
    const settings = this.staffData?.settings || parkingService.settings || { freshnessMinutes: 60 };

    const lotOptions = lots
      .map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)} (${escapeHtml(l.code)})</option>`)
      .join('');

    const sectionOptions = sections
      .map(
        (s) =>
          `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(
            s.code
          )}) — Currently: ${escapeHtml(s.recordedStatus || s.status)}</option>`
      )
      .join('');

    return `
      <div class="hub-page-header">
        <div>
          <p class="hub-eyebrow">Protected Role-Based Administration</p>
          <h1 class="hub-title">Staff Controls &amp; Data Maintenance</h1>
          <p class="hub-subtitle">
            Maintain campus parking lots, vehicle sections, QR codes, availability statuses, closures, and user reports.
          </p>
        </div>
      </div>

      ${
        this.staffBanner
          ? `
            <div class="status-banner status-banner--${escapeHtml(this.staffBanner.type)}" role="alert">
              <p class="status-banner__message">${escapeHtml(this.staffBanner.message)}</p>
            </div>
          `
          : ''
      }

      <div class="hub-overview-grid">
        <!-- 1. Update Section Availability / Mark Closure -->
        <section class="glass-panel hub-card" aria-labelledby="staff-status-heading">
          <p class="hub-eyebrow">Live Operations</p>
          <h2 id="staff-status-heading" class="hub-card__title">Update Section Availability or Closure</h2>
          ${
            sections.length === 0
              ? `<p class="hub-card__desc">Create a parking lot and section first to update availability.</p>`
              : `
                <form id="staff-status-form" class="auth-form">
                  <div class="form-field">
                    <label for="staff-status-section" class="form-label">Target section</label>
                    <select id="staff-status-section" name="sectionId" class="form-input" required>
                      ${sectionOptions}
                    </select>
                  </div>
                  <div class="form-grid-2col">
                    <div class="form-field">
                      <label for="staff-status-value" class="form-label">Availability status</label>
                      <select id="staff-status-value" name="status" class="form-input" required>
                        <option value="Available">Available</option>
                        <option value="Limited">Limited</option>
                        <option value="Full">Full</option>
                        <option value="Closed">Closed (Maintenance / Event)</option>
                        <option value="Unknown">Unknown</option>
                      </select>
                    </div>
                    <div class="form-field">
                      <label for="staff-status-source" class="form-label">Information source</label>
                      <input
                        type="text"
                        id="staff-status-source"
                        name="source"
                        class="form-input"
                        value="Staff Patrol Inspection"
                        required
                      />
                    </div>
                  </div>
                  <div class="form-grid-2col">
                    <div class="form-field">
                      <label for="staff-status-spaces" class="form-label">Verified available spaces (optional)</label>
                      <input
                        type="number"
                        id="staff-status-spaces"
                        name="availableSpaces"
                        class="form-input"
                        min="0"
                        placeholder="Only if counted"
                      />
                    </div>
                    <div class="form-field">
                      <label for="staff-status-reason" class="form-label">Closure reason / update note</label>
                      <input
                        type="text"
                        id="staff-status-reason"
                        name="closureReason"
                        class="form-input"
                        placeholder="e.g. Convocation event closure"
                      />
                    </div>
                  </div>
                  <label class="checkbox-control">
                    <input type="checkbox" id="staff-status-reliable" name="hasReliableCount" />
                    <span class="checkbox-control__text">Publish numeric space count as verified</span>
                  </label>
                  <button type="submit" class="btn-primary btn-compact">
                    Publish status update
                  </button>
                </form>
              `
          }
        </section>

        <!-- 2. Create Parking Lot & Freshness Policy -->
        <section class="glass-panel hub-card" aria-labelledby="staff-lot-heading">
          <p class="hub-eyebrow">Campus Infrastructure</p>
          <h2 id="staff-lot-heading" class="hub-card__title">Create Parking Lot</h2>
          <form id="staff-create-lot-form" class="auth-form">
            <div class="form-grid-2col">
              <div class="form-field">
                <label for="staff-lot-name" class="form-label">Lot name</label>
                <input type="text" id="staff-lot-name" name="name" class="form-input" required placeholder="e.g. North Academic Lot" />
              </div>
              <div class="form-field">
                <label for="staff-lot-code" class="form-label">Short code</label>
                <input type="text" id="staff-lot-code" name="code" class="form-input" required placeholder="e.g. LOT-N1" />
              </div>
            </div>
            <div class="form-field">
              <label for="staff-lot-dest" class="form-label">Nearby academic block / destination</label>
              <input type="text" id="staff-lot-dest" name="destination" class="form-input" required placeholder="e.g. Academic Block 32 &amp; Library" />
            </div>
            <button type="submit" class="btn-secondary btn-compact">
              Add parking lot
            </button>
          </form>

          <hr class="hub-divider" />

          <h3 class="hub-card__subtitle">Availability Freshness Policy</h3>
          <form id="staff-freshness-form" class="hub-qr-inline-row">
            <div class="form-field" style="flex:1">
              <label for="staff-freshness-mins" class="form-label">Mark status as Unknown after (minutes)</label>
              <input
                type="number"
                id="staff-freshness-mins"
                name="freshnessMinutes"
                class="form-input"
                min="1"
                max="10080"
                value="${escapeHtml(settings.freshnessMinutes || 60)}"
                required
              />
            </div>
            <button type="submit" class="btn-secondary btn-compact">
              Save policy
            </button>
          </form>
        </section>
      </div>

      <!-- 3. Create / Configure Vehicle Section -->
      <section class="glass-panel hub-card" aria-labelledby="staff-create-section-heading">
        <p class="hub-eyebrow">Section Configuration &amp; QR Mapping</p>
        <h2 id="staff-create-section-heading" class="hub-card__title">Add Vehicle Parking Section</h2>
        ${
          lots.length === 0
            ? `<p class="hub-card__desc">Add a campus parking lot above first, then create vehicle sections inside it.</p>`
            : `
              <form id="staff-create-section-form" class="auth-form">
                <div class="form-grid-2col">
                  <div class="form-field">
                    <label for="staff-sec-lot" class="form-label">Parent parking lot</label>
                    <select id="staff-sec-lot" name="lotId" class="form-input" required>
                      ${lotOptions}
                    </select>
                  </div>
                  <div class="form-field">
                    <label for="staff-sec-name" class="form-label">Section name</label>
                    <input type="text" id="staff-sec-name" name="name" class="form-input" required placeholder="e.g. Two-Wheeler Bay Zone A" />
                  </div>
                </div>

                <div class="form-grid-2col">
                  <div class="form-field">
                    <label for="staff-sec-code" class="form-label">Short identifier code</label>
                    <input type="text" id="staff-sec-code" name="code" class="form-input" required placeholder="e.g. SEC-TW-A1" />
                  </div>
                  <div class="form-field">
                    <label for="staff-sec-qr" class="form-label">QR code identifier</label>
                    <input type="text" id="staff-sec-qr" name="qrCode" class="form-input" placeholder="e.g. QR-SEC-TW-A1 (defaults to code)" />
                  </div>
                </div>

                <div class="form-grid-2col">
                  <div class="form-field">
                    <label for="staff-sec-entrance" class="form-label">Designated entrance location</label>
                    <input type="text" id="staff-sec-entrance" name="entrance" class="form-input" required placeholder="e.g. Gate 2 — North Academic Spine" />
                  </div>
                  <div class="form-field">
                    <label for="staff-sec-dest" class="form-label">Nearby destination / block</label>
                    <input type="text" id="staff-sec-dest" name="destination" class="form-input" placeholder="Defaults to parent lot destination" />
                  </div>
                </div>

                <div class="form-grid-2col">
                  <div class="form-field">
                    <label for="staff-sec-capacity" class="form-label">Total capacity (optional)</label>
                    <input type="number" id="staff-sec-capacity" name="capacity" class="form-input" min="1" placeholder="e.g. 120" />
                  </div>
                  <div class="form-field">
                    <label for="staff-sec-restrictions" class="form-label">Access restrictions</label>
                    <input type="text" id="staff-sec-restrictions" name="restrictions" class="form-input" value="Students &amp; Staff Permit" />
                  </div>
                </div>

                <fieldset class="staff-checkbox-fieldset">
                  <legend class="form-label">Accepted vehicle types</legend>
                  <div class="staff-checkbox-row">
                    <label class="checkbox-control">
                      <input type="checkbox" name="vehicleTypes" value="bike" checked />
                      <span class="checkbox-control__text">Bike / Two-Wheeler</span>
                    </label>
                    <label class="checkbox-control">
                      <input type="checkbox" name="vehicleTypes" value="car" />
                      <span class="checkbox-control__text">Car</span>
                    </label>
                    <label class="checkbox-control">
                      <input type="checkbox" name="vehicleTypes" value="other" />
                      <span class="checkbox-control__text">Other Campus Vehicle</span>
                    </label>
                  </div>
                </fieldset>

                <button type="submit" class="btn-primary btn-compact">
                  Create parking section
                </button>
              </form>
            `
        }
      </section>

      <!-- 4. User Reports Queue & Status History -->
      <div class="hub-overview-grid">
        <section class="glass-panel hub-card" aria-labelledby="staff-reports-heading">
          <p class="hub-eyebrow">Verification Queue</p>
          <h2 id="staff-reports-heading" class="hub-card__title">User Section Reports (${reports.length})</h2>
          <p class="hub-card__desc">
            User reports never alter occupancy automatically. Review and verify reports below.
          </p>
          ${
            reports.length === 0
              ? `<p class="field-hint">No user reports submitted yet.</p>`
              : `
                <div class="staff-list">
                  ${reports
                    .map(
                      (rep) => `
                        <div class="staff-list-item">
                          <div>
                            <strong>${escapeHtml(rep.sectionName)} · ${escapeHtml(rep.issueType)}</strong>
                            <p>${escapeHtml(rep.description)}</p>
                            <span class="field-hint">Reported by ${escapeHtml(
                              rep.reporterName
                            )} · ${escapeHtml(formatDateTime(rep.createdAt))} · Status: <strong>${escapeHtml(
                        rep.status
                      )}</strong></span>
                          </div>
                          ${
                            rep.status === 'pending'
                              ? `
                                <div class="staff-list-item__actions">
                                  <button type="button" class="btn-secondary btn-compact" data-review-report="${escapeHtml(
                                    rep.id
                                  )}" data-report-status="reviewed">
                                    Mark reviewed
                                  </button>
                                  <button type="button" class="btn-ghost-pill btn-ghost-pill--sm" data-review-report="${escapeHtml(
                                    rep.id
                                  )}" data-report-status="dismissed">
                                    Dismiss
                                  </button>
                                </div>
                              `
                              : ''
                          }
                        </div>
                      `
                    )
                    .join('')}
                </div>
              `
          }
        </section>

        <section class="glass-panel hub-card" aria-labelledby="staff-history-heading">
          <p class="hub-eyebrow">Audit Log</p>
          <h2 id="staff-history-heading" class="hub-card__title">Status-Update History (${history.length})</h2>
          ${
            history.length === 0
              ? `<p class="field-hint">No status updates recorded yet.</p>`
              : `
                <div class="staff-list">
                  ${history
                    .slice(0, 15)
                    .map(
                      (h) => `
                        <div class="staff-list-item">
                          <div>
                            <strong>${escapeHtml(h.sectionName)} (<code>${escapeHtml(
                        h.sectionCode
                      )}</code>): ${escapeHtml(h.previousStatus)} → ${escapeHtml(h.newStatus)}</strong>
                            <p>${escapeHtml(h.note || 'Status updated')}</p>
                            <span class="field-hint">${escapeHtml(
                              formatDateTime(h.timestamp)
                            )} · Source: ${escapeHtml(h.source)} · By ${escapeHtml(h.updatedBy)}</span>
                          </div>
                        </div>
                      `
                    )
                    .join('')}
                </div>
              `
          }
        </section>
      </div>
    `;
  }

  bindStaffEvents(container) {
    // Create lot
    container.querySelector('#staff-create-lot-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const name = form.querySelector('#staff-lot-name')?.value?.trim() || '';
      const code = form.querySelector('#staff-lot-code')?.value?.trim() || '';
      const destination = form.querySelector('#staff-lot-dest')?.value?.trim() || '';

      try {
        await parkingService.createLot({ name, code, destination });
        this.staffBanner = { type: 'info', message: `Created parking lot "${name}".` };
        await this.loadStaffOverview();
      } catch (err) {
        this.staffBanner = { type: 'error', message: err?.message || 'Could not create lot.' };
        this.renderActiveViewContent();
      }
    });

    // Update freshness policy
    container.querySelector('#staff-freshness-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const freshnessMinutes = Number(form.querySelector('#staff-freshness-mins')?.value || 60);
      try {
        await parkingService.updateStaffSettings({ freshnessMinutes });
        this.staffBanner = {
          type: 'info',
          message: `Freshness policy updated to ${freshnessMinutes} minutes.`,
        };
        await this.loadStaffOverview();
      } catch (err) {
        this.staffBanner = { type: 'error', message: err?.message || 'Could not update policy.' };
        this.renderActiveViewContent();
      }
    });

    // Create section
    container.querySelector('#staff-create-section-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const lotId = form.querySelector('#staff-sec-lot')?.value || '';
      const name = form.querySelector('#staff-sec-name')?.value?.trim() || '';
      const code = form.querySelector('#staff-sec-code')?.value?.trim() || '';
      const qrCode = form.querySelector('#staff-sec-qr')?.value?.trim() || code;
      const entrance = form.querySelector('#staff-sec-entrance')?.value?.trim() || '';
      const destination = form.querySelector('#staff-sec-dest')?.value?.trim() || '';
      const capacity = form.querySelector('#staff-sec-capacity')?.value || '';
      const restrictions = form.querySelector('#staff-sec-restrictions')?.value?.trim() || '';
      const vehicleTypes = Array.from(
        form.querySelectorAll('input[name="vehicleTypes"]:checked')
      ).map((cb) => cb.value);

      try {
        await parkingService.createSection({
          lotId,
          name,
          code,
          qrCode,
          entrance,
          destination,
          capacity,
          restrictions,
          vehicleTypes,
          status: 'Available',
        });
        this.staffBanner = { type: 'info', message: `Created parking section "${name}" (${code}).` };
        await this.loadStaffOverview();
      } catch (err) {
        this.staffBanner = { type: 'error', message: err?.message || 'Could not create section.' };
        this.renderActiveViewContent();
      }
    });

    // Update section status / closure
    container.querySelector('#staff-status-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const sectionId = form.querySelector('#staff-status-section')?.value || '';
      const status = form.querySelector('#staff-status-value')?.value || 'Available';
      const source = form.querySelector('#staff-status-source')?.value?.trim() || 'Staff Update';
      const availableSpaces = form.querySelector('#staff-status-spaces')?.value ?? '';
      const closureReason = form.querySelector('#staff-status-reason')?.value?.trim() || '';
      const hasReliableCount = Boolean(form.querySelector('#staff-status-reliable')?.checked);

      try {
        await parkingService.updateSectionStatus(sectionId, {
          status,
          source,
          availableSpaces,
          closureReason,
          note: closureReason,
          hasReliableCount,
        });
        this.staffBanner = { type: 'info', message: 'Section status updated and logged.' };
        await this.loadStaffOverview();
      } catch (err) {
        this.staffBanner = { type: 'error', message: err?.message || 'Could not update status.' };
        this.renderActiveViewContent();
      }
    });

    // Review user report
    container.querySelectorAll('[data-review-report]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reportId = btn.getAttribute('data-review-report');
        const nextStatus = btn.getAttribute('data-report-status') || 'reviewed';
        if (!reportId) return;
        try {
          await parkingService.reviewReport(reportId, { status: nextStatus });
          this.staffBanner = { type: 'info', message: `Report marked as ${nextStatus}.` };
          await this.loadStaffOverview();
        } catch (err) {
          this.staffBanner = { type: 'error', message: err?.message || 'Could not update report.' };
          this.renderActiveViewContent();
        }
      });
    });
  }

  // ===========================================================================
  // MODAL 1: SAVE / CORRECT PARKING LOCATION (Requirement 8)
  // ===========================================================================
  renderSaveParkingModalMarkup() {
    const lots = parkingService.lots || [];
    const sections = parkingService.sections || [];
    const active = parkingService.activeSession;
    const isEdit = this.saveModalMode === 'edit' && active;

    const preLotId =
      this.saveModalPreselect?.lotId ?? (isEdit ? active.lotId : lots[0]?.id || '');
    const filteredSections = preLotId
      ? sections.filter((s) => s.lotId === preLotId)
      : sections;
    const preSectionId =
      this.saveModalPreselect?.sectionId ??
      (isEdit ? active.sectionId : filteredSections[0]?.id || '');
    const preVehicleType =
      this.saveModalPreselect?.vehicleType ??
      (isEdit ? active.vehicleType : this.selectedVehicleType || 'bike');

    const lotOptions =
      lots.length > 0
        ? lots
            .map(
              (l) =>
                `<option value="${escapeHtml(l.id)}" ${
                  l.id === preLotId ? 'selected' : ''
                }>${escapeHtml(l.name)} (${escapeHtml(l.code)})</option>`
            )
            .join('')
        : `<option value="">Manual lot entry below</option>`;

    const sectionOptions =
      filteredSections.length > 0
        ? filteredSections
            .map(
              (s) =>
                `<option value="${escapeHtml(s.id)}" ${
                  s.id === preSectionId ? 'selected' : ''
                }>${escapeHtml(s.name)} (${escapeHtml(s.code)})</option>`
            )
            .join('')
        : `<option value="">Manual section entry below</option>`;

    return `
      <dialog
        id="save-parking-modal"
        class="glass-modal glass-modal--wide"
        closedby="any"
        aria-labelledby="save-parking-modal-title"
      >
        <div class="glass-modal__inner">
          <div class="glass-modal__header">
            <div>
              <p class="glass-modal__eyebrow">Parking Location Memory Aid</p>
              <h2 id="save-parking-modal-title" class="glass-modal__title">
                ${isEdit ? 'Correct Saved Parking Location' : 'I’ve Parked — Save Location'}
              </h2>
            </div>
            <button
              type="button"
              class="glass-modal__icon-close"
              data-close-save-modal
              aria-label="Close save parking dialog"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <!-- QR-Assisted Section Preselection -->
          <div class="save-modal-qr-box">
            <div class="save-modal-qr-box__row">
              <label for="save-modal-qr-input" class="form-label">Have a section QR code?</label>
              <div class="hub-qr-inline-row">
                <input
                  type="text"
                  id="save-modal-qr-input"
                  class="form-input"
                  placeholder="Enter QR or section code (e.g. SEC-TW-A1)"
                  maxlength="64"
                />
                <button type="button" id="save-modal-apply-qr-btn" class="btn-secondary btn-compact">
                  Apply code
                </button>
                <button type="button" id="save-modal-scan-camera-btn" class="btn-ghost-pill btn-ghost-pill--sm">
                  Scan QR
                </button>
              </div>
            </div>
            <video id="save-modal-camera-preview" class="qr-camera-preview" hidden playsinline muted></video>
            <p id="save-modal-qr-status" class="field-hint" aria-live="polite">${escapeHtml(
              this.cameraStatusMessage
            )}</p>
          </div>

          <div id="save-modal-error-slot" aria-live="polite">
            ${
              this.saveModalError
                ? `
                  <div class="status-banner status-banner--error" role="alert">
                    <p class="status-banner__message">${escapeHtml(this.saveModalError)}</p>
                  </div>
                `
                : ''
            }
          </div>

          <form id="save-parking-form" class="auth-form" novalidate>
            <!-- Hierarchy: Parking Lot -> Vehicle Section -> Row -> Bay -->
            <div class="form-grid-2col">
              <div class="form-field">
                <label for="save-lot-select" class="form-label">1. Parking lot</label>
                ${
                  lots.length > 0
                    ? `<select id="save-lot-select" name="lotId" class="form-input">${lotOptions}</select>`
                    : `<input type="text" id="save-lot-name-input" name="lotName" class="form-input" required placeholder="e.g. North Academic Lot" value="${escapeHtml(
                        isEdit ? active.lotName : ''
                      )}" />`
                }
              </div>

              <div class="form-field">
                <label for="save-section-select" class="form-label">2. Vehicle section</label>
                ${
                  sections.length > 0
                    ? `<select id="save-section-select" name="sectionId" class="form-input">${sectionOptions}</select>`
                    : `<input type="text" id="save-section-name-input" name="sectionName" class="form-input" required placeholder="e.g. Two-Wheeler Section A" value="${escapeHtml(
                        isEdit ? active.sectionName : ''
                      )}" />`
                }
              </div>
            </div>

            <div class="form-grid-2col">
              <div class="form-field">
                <label for="save-row-input" class="form-label">3. Row (where marked)</label>
                <input
                  type="text"
                  id="save-row-input"
                  name="row"
                  class="form-input"
                  maxlength="40"
                  placeholder="e.g. Row B"
                  value="${escapeHtml(isEdit ? active.row : '')}"
                />
              </div>

              <div class="form-field">
                <label for="save-bay-input" class="form-label">4. Bay / Spot (where marked)</label>
                <input
                  type="text"
                  id="save-bay-input"
                  name="bay"
                  class="form-input"
                  maxlength="40"
                  placeholder="e.g. Bay 14"
                  value="${escapeHtml(isEdit ? active.bay : '')}"
                />
              </div>
            </div>

            <div class="form-grid-2col">
              <div class="form-field">
                <label for="save-vehicle-type" class="form-label">Vehicle type</label>
                <select id="save-vehicle-type" name="vehicleType" class="form-input" required>
                  <option value="bike" ${preVehicleType === 'bike' ? 'selected' : ''}>Bike / Two-Wheeler</option>
                  <option value="car" ${preVehicleType === 'car' ? 'selected' : ''}>Car</option>
                  <option value="other" ${preVehicleType === 'other' ? 'selected' : ''}>Other Campus Vehicle</option>
                </select>
              </div>

              <div class="form-field">
                <label for="save-parked-time" class="form-label">Parking time</label>
                <input
                  type="datetime-local"
                  id="save-parked-time"
                  name="parkedAt"
                  class="form-input"
                  value="${escapeHtml(
                    toLocalDateTimeInputValue(isEdit ? active.parkedAt : null)
                  )}"
                />
              </div>
            </div>

            <div class="form-field">
              <label for="save-note-input" class="form-label">Landmark or retrieval note (optional)</label>
              <input
                type="text"
                id="save-note-input"
                name="note"
                class="form-input"
                maxlength="300"
                placeholder="e.g. Near red pillar B4, opposite staircase"
                value="${escapeHtml(isEdit ? active.note : '')}"
              />
            </div>

            <!-- Optional Location Pin & Private Surroundings Photo -->
            <div class="form-grid-2col">
              <div class="form-field">
                <span class="form-label">Location pin (optional)</span>
                <button type="button" id="save-capture-gps-btn" class="btn-secondary btn-compact">
                  Capture current GPS pin
                </button>
                <span id="save-gps-status" class="field-hint" aria-live="polite">${escapeHtml(
                  this.gpsStatusMessage
                )}</span>
              </div>

              <div class="form-field">
                <label for="save-photo-input" class="form-label">Private photo of surroundings (optional)</label>
                <input
                  type="file"
                  id="save-photo-input"
                  accept="image/png,image/jpeg,image/webp"
                  class="form-input form-input--file"
                />
                <span class="field-hint">Stored privately; visible only to your account.</span>
              </div>
            </div>

            <div class="glass-modal__footer">
              <button type="button" class="btn-secondary btn-compact" data-close-save-modal>
                Cancel
              </button>
              <button
                type="submit"
                id="save-parking-submit-btn"
                class="btn-primary btn-compact"
                ${this.isSavingSession ? 'disabled' : ''}
              >
                ${
                  this.isSavingSession
                    ? `<progress aria-label="Saving location" class="loading-spinner"></progress><span>Saving…</span>`
                    : `<span>${isEdit ? 'Save corrected location' : 'Confirm & save location'}</span>`
                }
              </button>
            </div>
          </form>
        </div>
      </dialog>
    `;
  }

  openSaveParkingModal({ mode = 'create', preselect = null } = {}) {
    this.saveModalMode = mode;
    this.saveModalPreselect = preselect;
    this.saveModalError = '';
    this.gpsStatusMessage = '';
    this.cameraStatusMessage = '';
    this.selectedPhotoDataUrl = null;
    this.removeExistingPhoto = false;
    this.capturedCoordinates = null;

    const mount = this.mountNode?.querySelector('#save-parking-modal-mount');
    if (!mount) return;
    mount.innerHTML = this.renderSaveParkingModalMarkup();
    this.bindSaveParkingModalEvents();

    const dialog = mount.querySelector('#save-parking-modal');
    if (dialog) {
      if (typeof dialog.showModal === 'function' && !dialog.open) {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }
  }

  closeSaveParkingModal() {
    this.stopCameraStream();
    const dialog = this.mountNode?.querySelector('#save-parking-modal');
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  stopCameraStream() {
    if (this.cameraStream) {
      try {
        this.cameraStream.getTracks().forEach((t) => t.stop());
      } catch {
        // Ignore stream stop errors
      }
      this.cameraStream = null;
    }
  }

  bindSaveParkingModalEvents() {
    const dialog = this.mountNode?.querySelector('#save-parking-modal');
    if (!dialog) return;

    dialog.querySelectorAll('[data-close-save-modal]').forEach((btn) => {
      btn.addEventListener('click', () => this.closeSaveParkingModal());
    });

    dialog.addEventListener('close', () => {
      this.stopCameraStream();
    });

    // Dynamic Lot -> Section filtering
    const lotSelect = dialog.querySelector('#save-lot-select');
    const secSelect = dialog.querySelector('#save-section-select');
    lotSelect?.addEventListener('change', () => {
      const selectedLotId = lotSelect.value;
      const sections = (parkingService.sections || []).filter(
        (s) => !selectedLotId || s.lotId === selectedLotId
      );
      if (secSelect) {
        secSelect.innerHTML = sections
          .map(
            (s) =>
              `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(
                s.code
              )})</option>`
          )
          .join('');
      }
    });

    // Apply QR code manually inside modal
    const applyQrBtn = dialog.querySelector('#save-modal-apply-qr-btn');
    const qrInput = dialog.querySelector('#save-modal-qr-input');
    const qrStatus = dialog.querySelector('#save-modal-qr-status');

    const applyQrCodeValue = async (rawCode) => {
      try {
        const matched = await parkingService.lookupSectionByQr(rawCode);
        if (lotSelect) lotSelect.value = matched.lotId;
        if (lotSelect) lotSelect.dispatchEvent(new Event('change'));
        if (secSelect) secSelect.value = matched.id;
        const vtSelect = dialog.querySelector('#save-vehicle-type');
        if (vtSelect && matched.vehicleTypes?.[0]) {
          vtSelect.value = matched.vehicleTypes[0];
        }
        if (qrStatus) {
          qrStatus.textContent = `Pre-selected ${matched.name} (${matched.code}). Confirm your row/bay and save.`;
        }
      } catch (err) {
        if (qrStatus) {
          qrStatus.textContent =
            err?.message || 'Could not match that QR code. Please select your section manually.';
        }
      }
    };

    applyQrBtn?.addEventListener('click', () => {
      const code = qrInput?.value?.trim() || '';
      if (!code) {
        if (qrStatus) qrStatus.textContent = 'Enter a section or QR code first.';
        return;
      }
      applyQrCodeValue(code);
    });

    // Camera QR Scan (permission requested ONLY when user clicks "Scan QR")
    const scanBtn = dialog.querySelector('#save-modal-scan-camera-btn');
    const videoEl = dialog.querySelector('#save-modal-camera-preview');
    scanBtn?.addEventListener('click', async () => {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        if (qrStatus) {
          qrStatus.textContent =
            'Camera access is unavailable in this browser. Enter the section code above or select your section manually.';
        }
        qrInput?.focus();
        return;
      }

      try {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoEl) {
          videoEl.hidden = false;
          videoEl.srcObject = this.cameraStream;
          await videoEl.play().catch(() => {});
        }
        if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
          if (qrStatus) {
            qrStatus.textContent = 'Point your camera at the section QR sign…';
          }
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const scanInterval = setInterval(async () => {
            if (!this.cameraStream || !videoEl || videoEl.hidden) {
              clearInterval(scanInterval);
              return;
            }
            try {
              const barcodes = await detector.detect(videoEl);
              if (barcodes.length > 0 && barcodes[0].rawValue) {
                clearInterval(scanInterval);
                const code = String(barcodes[0].rawValue).trim();
                this.stopCameraStream();
                videoEl.hidden = true;
                if (qrInput) qrInput.value = code;
                await applyQrCodeValue(code);
              }
            } catch {
              clearInterval(scanInterval);
            }
          }, 450);
        } else {
          this.stopCameraStream();
          if (videoEl) videoEl.hidden = true;
          if (qrStatus) {
            qrStatus.textContent =
              'QR detection is not built into this browser. Please type the code printed on the QR sign or choose your section below.';
          }
          qrInput?.focus();
        }
      } catch {
        this.stopCameraStream();
        if (videoEl) videoEl.hidden = true;
        if (qrStatus) {
          qrStatus.textContent =
            'Camera permission was denied or unavailable. Please enter the section code manually or select from the list below.';
        }
        qrInput?.focus();
      }
    });

    // GPS Location Pin (permission requested ONLY when user clicks "Capture current GPS pin")
    const gpsBtn = dialog.querySelector('#save-capture-gps-btn');
    const gpsStatus = dialog.querySelector('#save-gps-status');
    gpsBtn?.addEventListener('click', () => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        this.gpsStatusMessage =
          'Location services are unavailable on this device. Your manual lot and section selection will be saved.';
        if (gpsStatus) gpsStatus.textContent = this.gpsStatusMessage;
        return;
      }

      if (gpsStatus) gpsStatus.textContent = 'Requesting current GPS coordinates…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.capturedCoordinates = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          };
          this.gpsStatusMessage = `GPS pin captured (${pos.coords.latitude.toFixed(
            5
          )}, ${pos.coords.longitude.toFixed(5)}).`;
          if (gpsStatus) gpsStatus.textContent = this.gpsStatusMessage;
        },
        () => {
          this.capturedCoordinates = null;
          this.gpsStatusMessage =
            'Location access was denied. You can still save your parking lot, section, and row/bay manually.';
          if (gpsStatus) gpsStatus.textContent = this.gpsStatusMessage;
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

    // Private surroundings photo file input
    const photoInput = dialog.querySelector('#save-photo-input');
    photoInput?.addEventListener('change', () => {
      const file = photoInput.files?.[0];
      if (!file) {
        this.selectedPhotoDataUrl = null;
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.saveModalError = 'Please choose an image smaller than 2 MB.';
        const errSlot = dialog.querySelector('#save-modal-error-slot');
        if (errSlot) {
          errSlot.innerHTML = `<div class="status-banner status-banner--error" role="alert"><p class="status-banner__message">${escapeHtml(
            this.saveModalError
          )}</p></div>`;
        }
        photoInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          this.selectedPhotoDataUrl = reader.result;
        }
      };
      reader.readAsDataURL(file);
    });

    // Submit Save / Correct Parking Location form
    const form = dialog.querySelector('#save-parking-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (this.isSavingSession) return;

      const lotId = dialog.querySelector('#save-lot-select')?.value || '';
      const sectionId = dialog.querySelector('#save-section-select')?.value || '';
      const lotName = dialog.querySelector('#save-lot-name-input')?.value?.trim() || '';
      const sectionName = dialog.querySelector('#save-section-name-input')?.value?.trim() || '';
      const row = dialog.querySelector('#save-row-input')?.value?.trim() || '';
      const bay = dialog.querySelector('#save-bay-input')?.value?.trim() || '';
      const vehicleType = dialog.querySelector('#save-vehicle-type')?.value || 'bike';
      const parkedAtRaw = dialog.querySelector('#save-parked-time')?.value || '';
      const note = dialog.querySelector('#save-note-input')?.value?.trim() || '';

      const payload = {
        lotId,
        sectionId,
        lotName,
        sectionName,
        row,
        bay,
        vehicleType,
        parkedAt: parkedAtRaw ? new Date(parkedAtRaw).toISOString() : new Date().toISOString(),
        note,
        replaceActive: true,
      };

      if (this.capturedCoordinates) {
        payload.latitude = this.capturedCoordinates.latitude;
        payload.longitude = this.capturedCoordinates.longitude;
      }
      if (this.selectedPhotoDataUrl) {
        payload.photoDataUrl = this.selectedPhotoDataUrl;
      }

      this.isSavingSession = true;
      const submitBtn = dialog.querySelector('#save-parking-submit-btn');
      if (submitBtn) submitBtn.disabled = true;

      try {
        if (this.saveModalMode === 'edit' && parkingService.activeSession?.id) {
          await parkingService.updateParkingSession(parkingService.activeSession.id, payload);
        } else {
          await parkingService.saveParkingSession(payload);
        }
        this.isSavingSession = false;
        this.closeSaveParkingModal();
        this.globalBanner = {
          type: 'info',
          message:
            this.saveModalMode === 'edit'
              ? 'Your saved parking location has been updated.'
              : 'Parking location saved! You can retrieve your vehicle details anytime in My Vehicle.',
        };
        this.renderActiveViewContent();
      } catch (err) {
        this.isSavingSession = false;
        if (submitBtn) submitBtn.disabled = false;
        this.saveModalError =
          err?.message || 'Unable to save your parking location. Please verify your selection.';
        const errSlot = dialog.querySelector('#save-modal-error-slot');
        if (errSlot) {
          errSlot.innerHTML = `<div class="status-banner status-banner--error" role="alert"><p class="status-banner__message">${escapeHtml(
            this.saveModalError
          )}</p></div>`;
        }
      }
    });
  }

  // ===========================================================================
  // MODAL 2: REPORT INCORRECT SECTION INFORMATION (Requirement 10)
  // ===========================================================================
  renderReportSectionModalMarkup() {
    const sec = this.reportTargetSection;
    return `
      <dialog
        id="report-section-modal"
        class="glass-modal"
        closedby="any"
        aria-labelledby="report-section-modal-title"
      >
        <div class="glass-modal__inner">
          <div class="glass-modal__header">
            <div>
              <p class="glass-modal__eyebrow">Section Feedback for Staff Review</p>
              <h2 id="report-section-modal-title" class="glass-modal__title">
                Report Section Information
              </h2>
            </div>
            <button
              type="button"
              class="glass-modal__icon-close"
              data-close-report-modal
              aria-label="Close report dialog"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <p class="glass-modal__subtitle">
            Reporting <strong>${escapeHtml(sec?.name || 'Campus Section')}</strong>. Reports are sent to campus parking staff for verification and do not automatically alter live occupancy.
          </p>

          <div id="report-modal-error-slot" aria-live="polite"></div>

          <form id="report-section-form" class="auth-form" novalidate>
            <div class="form-field">
              <label for="report-issue-type" class="form-label">Issue type</label>
              <select id="report-issue-type" name="issueType" class="form-input" required>
                <option value="Full section">Section appears full</option>
                <option value="Unexpected closure">Gate or section is closed</option>
                <option value="Signage / QR issue">Signage or QR code issue</option>
                <option value="Incorrect details">Entrance or vehicle restriction mismatch</option>
              </select>
            </div>

            <div class="form-field">
              <label for="report-description" class="form-label">Details</label>
              <textarea
                id="report-description"
                name="description"
                class="form-input form-textarea"
                rows="3"
                maxlength="400"
                required
                placeholder="Briefly describe what you observed so staff can verify…"
              ></textarea>
            </div>

            <div class="glass-modal__footer">
              <button type="button" class="btn-secondary btn-compact" data-close-report-modal>
                Cancel
              </button>
              <button type="submit" id="report-submit-btn" class="btn-primary btn-compact">
                Submit report for review
              </button>
            </div>
          </form>
        </div>
      </dialog>
    `;
  }

  openReportModal(section, triggerEl = null) {
    this.reportTargetSection = section;
    this.reportTriggerEl = triggerEl;
    const mount = this.mountNode?.querySelector('#report-section-modal-mount');
    if (!mount) return;
    mount.innerHTML = this.renderReportSectionModalMarkup();
    this.bindReportModalEvents();

    const dialog = mount.querySelector('#report-section-modal');
    if (dialog) {
      if (typeof dialog.showModal === 'function' && !dialog.open) {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }
  }

  closeReportModal() {
    const dialog = this.mountNode?.querySelector('#report-section-modal');
    if (dialog) {
      if (typeof dialog.close === 'function' && dialog.open) {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
    this.reportTriggerEl?.focus?.();
  }

  bindReportModalEvents() {
    const dialog = this.mountNode?.querySelector('#report-section-modal');
    if (!dialog) return;

    dialog.querySelectorAll('[data-close-report-modal]').forEach((btn) => {
      btn.addEventListener('click', () => this.closeReportModal());
    });

    const form = dialog.querySelector('#report-section-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!this.reportTargetSection || this.isSubmittingReport) return;

      const issueType = dialog.querySelector('#report-issue-type')?.value || 'Incorrect details';
      const description = dialog.querySelector('#report-description')?.value?.trim() || '';
      const errSlot = dialog.querySelector('#report-modal-error-slot');

      if (!description) {
        if (errSlot) {
          errSlot.innerHTML = `<div class="status-banner status-banner--error" role="alert"><p class="status-banner__message">Please describe the issue before submitting.</p></div>`;
        }
        return;
      }

      this.isSubmittingReport = true;
      try {
        await parkingService.submitSectionReport({
          sectionId: this.reportTargetSection.id,
          sectionName: this.reportTargetSection.name,
          issueType,
          description,
        });
        this.isSubmittingReport = false;
        this.closeReportModal();
        this.globalBanner = {
          type: 'info',
          message: 'Thank you—your report has been queued for campus parking staff verification.',
        };
        this.renderGlobalBanner();
      } catch (err) {
        this.isSubmittingReport = false;
        if (errSlot) {
          errSlot.innerHTML = `<div class="status-banner status-banner--error" role="alert"><p class="status-banner__message">${escapeHtml(
            err?.message || 'Unable to submit report right now.'
          )}</p></div>`;
        }
      }
    });
  }
}

