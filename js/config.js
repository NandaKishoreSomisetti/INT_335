/**
 * PARKTRACE Configuration Layer (js/config.js)
 *
 * Centralizes environment variables, Supabase credentials, API endpoints,
 * support channels, and asset paths.
 */

const globalConfig =
  typeof window !== 'undefined' && window.PARKTRACE_CONFIG ? window.PARKTRACE_CONFIG : {};

const nodeEnv =
  typeof process !== 'undefined' && process && process.env ? process.env : {};

export const SUPABASE_CONFIG = {
  /**
   * Public Supabase project URL (`NEXT_PUBLIC_SUPABASE_URL`).
   */
  url:
    globalConfig.NEXT_PUBLIC_SUPABASE_URL ??
    nodeEnv.NEXT_PUBLIC_SUPABASE_URL ??
    'https://usraecvkfulgmajqpvpo.supabase.co',

  /**
   * Public Supabase publishable / anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`).
   */
  anonKey:
    globalConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    nodeEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    'sb_publishable_SMKSc2nwXW7z73F6p6XDYw_NQjBVKEr',
};

export const AUTH_CONFIG = {
  /**
   * Base URL for the server-side authentication & profile synchronization API.
   */
  baseUrl: globalConfig.AUTH_API_BASE_URL ?? '/api/auth',

  endpoints: {
    login: '/login',
    signup: '/signup',
    logout: '/logout',
    session: '/session',
    profile: '/profile',
  },
};

export const REVIEWS_CONFIG = {
  /**
   * Base URL for the shared persistent Reviews & Likes REST API.
   */
  baseUrl: globalConfig.REVIEWS_API_BASE_URL ?? '/api/reviews',
};

export const PARKING_CONFIG = {
  /**
   * Base URL for campus parking lots, sections, QR lookup, sessions, and staff updates.
   */
  baseUrl: globalConfig.PARKING_API_BASE_URL ?? '/api/parking',
  sessionsUrl: globalConfig.SESSIONS_API_BASE_URL ?? '/api/sessions',
  reportsUrl: globalConfig.REPORTS_API_BASE_URL ?? '/api/reports',
  staffUrl: globalConfig.STAFF_API_BASE_URL ?? '/api/staff',
};

export const SUPPORT_CONFIG = {
  /**
   * Support email address and phone number displayed in the Support modal.
   */
  supportEmail: globalConfig.SUPPORT_EMAIL ?? 'parktrace.1341@gmail.com',
  supportPhoneDisplay: globalConfig.SUPPORT_PHONE_DISPLAY ?? '+91 75692 05626',
  supportPhoneHref: globalConfig.SUPPORT_PHONE_HREF ?? 'tel:+917569205626',
  hoursLabel: globalConfig.SUPPORT_HOURS ?? 'Mon – Sat, 7:30 AM – 8:30 PM Campus Time',
  officeLocation: globalConfig.SUPPORT_OFFICE ?? 'Campus Mobility & Security Desk, Block A Ground Floor',
};

export const ASSET_CONFIG = {
  /**
   * Clean photographic background asset path.
   */
  heroImageUrl: globalConfig.HERO_IMAGE_URL ?? './assets/hero-car-clean.jpg',
  heroImageAlt: '',
};

export const STORAGE_KEYS = {
  rememberedEmail: 'parktrace.remembered_email',
  rememberMeEnabled: 'parktrace.remember_me_enabled',
  supabaseAuthToken: 'parktrace.supabase.auth.token',
};
