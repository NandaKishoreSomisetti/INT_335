/**
 * PARKTRACE Application Configuration (js/config.js)
 *
 * Central configuration for contact details, brand & background assets,
 * authentication endpoints, shared reviews backend, and campus parking services.
 */

const runtimeOverrides =
  typeof window !== 'undefined' && window.PARKTRACE_CONFIG
    ? window.PARKTRACE_CONFIG
    : {};

/**
 * Support team email address (Requirement 3).
 * Rendered as a working mailto: link in the Support modal.
 */
export const SUPPORT_EMAIL =
  runtimeOverrides.SUPPORT_EMAIL ?? 'parktrace.1341@gmail.com';

/**
 * Temporary customer-care number (Requirement 3).
 * Calling is disabled for this demo number.
 */
export const SUPPORT_PHONE =
  runtimeOverrides.SUPPORT_PHONE ?? '00000 00000 — Demo number';

/**
 * Hero background & official brand logo asset configuration.
 */
export const ASSET_CONFIG = {
  heroImageUrl: runtimeOverrides.HERO_IMAGE_URL ?? './assets/hero-car-clean.jpg',
  heroImageAlt: runtimeOverrides.HERO_IMAGE_ALT ?? '',
  logoUrl: runtimeOverrides.LOGO_URL ?? './assets/parktrace-logo.png',
};

/**
 * Authentication integration configuration.
 */
export const AUTH_CONFIG = {
  baseUrl: runtimeOverrides.AUTH_API_BASE_URL ?? '/api/auth',
  endpoints: {
    login: '/login',
    signUp: '/signup',
    logout: '/logout',
    session: '/session',
    profile: '/profile',
  },
  storageKeys: {
    rememberedEmail: 'parktrace_remembered_email',
    rememberPreference: 'parktrace_remember_me',
  },
};

/**
 * Shared persistent Reviews & Likes backend configuration.
 * Used by both the public homepage and the authenticated Reviews page.
 */
export const REVIEWS_CONFIG = {
  baseUrl: runtimeOverrides.REVIEWS_API_BASE_URL ?? '/api/reviews',
  pageSize: 6,
};

/**
 * Campus Parking Discovery, Saved Vehicle Sessions, Reports & Staff Controls configuration.
 */
export const PARKING_CONFIG = {
  baseUrl: runtimeOverrides.PARKING_API_BASE_URL ?? '/api/parking',
  sessionsUrl: runtimeOverrides.SESSIONS_API_BASE_URL ?? '/api/sessions',
  reportsUrl: runtimeOverrides.REPORTS_API_BASE_URL ?? '/api/reports',
  staffUrl: runtimeOverrides.STAFF_API_BASE_URL ?? '/api/staff',
};
