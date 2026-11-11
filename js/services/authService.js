/**
 * Direct Supabase Authentication & Profile Service (js/services/authService.js)
 *
 * Designed for static hosting (GitHub Pages) and local browser environments:
 * - Zero `fetch('/api/auth/...')` calls (eliminates 405 Method Not Allowed on GitHub Pages).
 * - Communicates directly with Supabase using `supabase.auth.signInWithPassword`,
 *   `supabase.auth.signUp`, `supabase.auth.getSession`, `supabase.auth.signOut`,
 *   and `supabase.auth.onAuthStateChange`.
 * - Includes one-click `demoLogin()` ("⚡ Quick Demo Login") with resilient local fallback.
 */

import { SUPABASE_CONFIG, STORAGE_KEYS } from '../config.js?v=sb6';
import { supabase as initialSupabase, getSupabaseClient } from './supabaseClient.js?v=sb6';

export class AuthConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthConfigurationError';
    this.isConfigurationMissing = true;
  }
}

const ALLOWED_AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const STAFF_EMAIL_SET = new Set(['parktrace.1341@gmail.com']);
const FALLBACK_USER_STORAGE_KEY = 'parktrace.active_user_profile';
const LOCAL_PROFILE_EXTRAS_PREFIX = 'parktrace.profile_extras.';

class AuthService {
  constructor() {
    this.currentUser = null;
    this.accessToken = null;
    this.listeners = new Set();
    this.cacheClearCallbacks = new Set();
    this.intendedDestination = null;
    this.authSubscriptionInitialized = false;
    this.ignoreNextAuthEvent = false;
  }

  async resolveClient() {
    return initialSupabase || (await getSupabaseClient());
  }

  isConfigured() {
    const supabaseUrl = SUPABASE_CONFIG?.url;
    const supabaseAnonKey = SUPABASE_CONFIG?.anonKey;
    if (
      typeof supabaseUrl !== 'string' ||
      supabaseUrl.trim().length === 0 ||
      typeof supabaseAnonKey !== 'string' ||
      supabaseAnonKey.trim().length === 0
    ) {
      console.warn('Supabase URL or Anon Key is missing from environment variables');
      return false;
    }
    return true;
  }

  isAuthenticated() {
    return Boolean(this.currentUser && this.currentUser.id);
  }

  getAccessToken() {
    return this.accessToken || null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClearAccountCache(callback) {
    this.cacheClearCallbacks.add(callback);
    return () => this.cacheClearCallbacks.delete(callback);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.currentUser);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  setIntendedDestination(viewName) {
    this.intendedDestination = viewName || null;
  }

  consumeIntendedDestination() {
    const dest = this.intendedDestination;
    this.intendedDestination = null;
    return dest;
  }

  // ---------------------------------------------------------------------------
  // "Remember me" Device Email & Session Persistence Policy
  // ---------------------------------------------------------------------------
  getRememberedEmail() {
    if (typeof window === 'undefined') return '';
    try {
      const enabled = window.localStorage.getItem(STORAGE_KEYS.rememberMeEnabled);
      if (enabled === 'false') return '';
      return window.localStorage.getItem(STORAGE_KEYS.rememberedEmail) || '';
    } catch {
      return '';
    }
  }

  getRememberMePreference() {
    if (typeof window === 'undefined') return true;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEYS.rememberMeEnabled);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  }

  applyRememberMePolicy(email, rememberMe) {
    if (typeof window === 'undefined') return;
    try {
      const cleanEmail = (email || '').trim();
      window.localStorage.setItem(STORAGE_KEYS.rememberMeEnabled, String(Boolean(rememberMe)));
      if (rememberMe && cleanEmail) {
        window.localStorage.setItem(STORAGE_KEYS.rememberedEmail, cleanEmail);
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.rememberedEmail);
      }
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  }

  saveCachedUserProfile(user) {
    if (typeof window === 'undefined' || !user) return;
    try {
      const serialized = JSON.stringify(user);
      if (this.getRememberMePreference()) {
        window.localStorage?.setItem(FALLBACK_USER_STORAGE_KEY, serialized);
      } else {
        window.sessionStorage?.setItem(FALLBACK_USER_STORAGE_KEY, serialized);
      }
    } catch {
      // Ignore storage errors
    }
  }

  loadCachedUserProfile() {
    if (typeof window === 'undefined') return null;
    try {
      const raw =
        window.sessionStorage?.getItem(FALLBACK_USER_STORAGE_KEY) ||
        window.localStorage?.getItem(FALLBACK_USER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  clearCachedUserProfile() {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage?.removeItem(FALLBACK_USER_STORAGE_KEY);
      window.localStorage?.removeItem(FALLBACK_USER_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  saveLocalProfileExtras(userId, extras) {
    if (typeof window === 'undefined' || !userId) return;
    try {
      window.localStorage?.setItem(
        `${LOCAL_PROFILE_EXTRAS_PREFIX}${userId}`,
        JSON.stringify(extras)
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  loadLocalProfileExtras(userId) {
    if (typeof window === 'undefined' || !userId) return null;
    try {
      const raw = window.localStorage?.getItem(`${LOCAL_PROFILE_EXTRAS_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // User Normalization
  // ---------------------------------------------------------------------------
  deriveDefaultRole(email, existingRole) {
    if (existingRole === 'staff' || existingRole === 'admin') {
      return 'staff';
    }
    const cleanEmail = String(email || '').trim().toLowerCase();
    return STAFF_EMAIL_SET.has(cleanEmail) ? 'staff' : 'member';
  }

  normalizeUser(supabaseUser, profileRow = null, overrides = {}) {
    if (!supabaseUser || !supabaseUser.id) return null;

    const userId = String(supabaseUser.id);
    const meta = supabaseUser.user_metadata || {};
    const localExtras = this.loadLocalProfileExtras(userId) || {};

    const email = String(
      overrides.email || profileRow?.email || supabaseUser.email || localExtras.email || ''
    )
      .trim()
      .toLowerCase();

    const fullName =
      String(
        overrides.fullName ||
          profileRow?.full_name ||
          localExtras.fullName ||
          meta.full_name ||
          meta.fullName ||
          meta.name ||
          email.split('@')[0] ||
          'Campus Member'
      ).trim() || 'Campus Member';

    const role = this.deriveDefaultRole(email, profileRow?.role || meta.role);

    const rawAffiliation =
      overrides.campusAffiliation !== undefined
        ? overrides.campusAffiliation
        : profileRow?.campus_affiliation ??
          localExtras.campusAffiliation ??
          meta.campus_affiliation ??
          meta.campusAffiliation ??
          null;
    const campusAffiliation =
      rawAffiliation === 'student' || rawAffiliation === 'staff' ? rawAffiliation : null;

    let avatarUrl =
      overrides.avatarUrl !== undefined
        ? overrides.avatarUrl
        : profileRow?.avatar_url !== undefined
        ? profileRow.avatar_url
        : localExtras.avatarUrl !== undefined
        ? localExtras.avatarUrl
        : meta.avatar_url !== undefined
        ? meta.avatar_url
        : null;

    const hasProfilePhoto = Boolean(avatarUrl && String(avatarUrl).trim().length > 0);
    const rememberPref = this.getRememberMePreference();

    return {
      id: userId,
      fullName,
      email,
      role,
      campusAffiliation,
      hasProfilePhoto,
      profilePhotoUrl: hasProfilePhoto ? String(avatarUrl) : null,
      emailVerified: Boolean(supabaseUser.email_confirmed_at || supabaseUser.confirmed_at || true),
      persistence: rememberPref ? 'persistent' : 'session',
      isDemo: Boolean(overrides.isDemo || supabaseUser.isDemo || userId === 'demo-user-12345'),
      updatedAt: profileRow?.updated_at || supabaseUser.updated_at || new Date().toISOString(),
    };
  }

  async ensureAuthStateListener() {
    if (this.authSubscriptionInitialized) return;
    this.authSubscriptionInitialized = true;

    try {
      const supabase = await this.resolveClient();
      supabase.auth.onAuthStateChange((event, session) => {
        if (this.ignoreNextAuthEvent) return;

        // Keep active demo user session intact unless explicitly logged out
        if (this.currentUser?.isDemo || this.currentUser?.id === 'demo-user-12345') {
          return;
        }

        if (event === 'SIGNED_OUT') {
          this.accessToken = null;
          this.clearCachedUserProfile();
          if (this.currentUser !== null) {
            this.currentUser = null;
            this.notify();
          }
          return;
        }

        if (
          session?.user &&
          (event === 'SIGNED_IN' ||
            event === 'TOKEN_REFRESHED' ||
            event === 'USER_UPDATED' ||
            event === 'INITIAL_SESSION')
        ) {
          this.accessToken = session.access_token || null;
          const normalized = this.normalizeUser(session.user);
          const prevJson = JSON.stringify(this.currentUser);
          const nextJson = JSON.stringify(normalized);
          this.currentUser = normalized;
          this.saveCachedUserProfile(normalized);
          if (prevJson !== nextJson) {
            this.notify();
          }
        }
      });
    } catch {
      this.authSubscriptionInitialized = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Direct Supabase Session Check (`getSession` / `getCurrentUser` / `restoreSession`)
  // ---------------------------------------------------------------------------
  async getSession() {
    const supabase = await this.resolveClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user || null;
  }

  async getCurrentUser() {
    return this.getSession();
  }

  async restoreSession() {
    if (!this.isConfigured()) {
      return null;
    }

    await this.ensureAuthStateListener();

    try {
      const supabase = await this.resolveClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      // Never overwrite an active in-memory user (such as an instant Quick Demo Login)
      if (this.currentUser && this.currentUser.id) {
        return this.currentUser;
      }

      if (session?.user) {
        this.accessToken = session.access_token || null;
        const user = this.normalizeUser(session.user);
        this.currentUser = user;
        this.saveCachedUserProfile(user);
        this.notify();
        return this.currentUser;
      }

      const cached = this.loadCachedUserProfile();
      if (cached && cached.id) {
        this.currentUser = cached;
        this.notify();
        return this.currentUser;
      }

      this.accessToken = null;
      this.currentUser = null;
      return null;
    } catch {
      if (this.currentUser && this.currentUser.id) {
        return this.currentUser;
      }
      const cached = this.loadCachedUserProfile();
      if (cached && cached.id) {
        this.currentUser = cached;
        this.notify();
        return this.currentUser;
      }
      this.accessToken = null;
      this.currentUser = null;
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Direct Supabase Sign In (`login`)
  // Supports both `login({ email, password, rememberMe })` and `login(email, password)`
  // ---------------------------------------------------------------------------
  async login(emailOrOptions, maybePassword) {
    const isObjectArg = typeof emailOrOptions === 'object' && emailOrOptions !== null;
    const rawEmail = isObjectArg ? emailOrOptions.email : emailOrOptions;
    const password = isObjectArg ? emailOrOptions.password : maybePassword;
    const rememberMe = isObjectArg ? Boolean(emailOrOptions.rememberMe ?? true) : true;

    const email = String(rawEmail || '').trim().toLowerCase();
    this.applyRememberMePolicy(email, rememberMe);

    const supabase = await this.resolveClient();
    await this.ensureAuthStateListener();

    this.ignoreNextAuthEvent = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.error('Auth error details:', error);
        throw error;
      }

      this.accessToken = data?.session?.access_token || null;
      const normalized = this.normalizeUser(data.user || data?.session?.user);
      this.currentUser = normalized;
      this.saveCachedUserProfile(normalized);
      this.notify();
      return data.user;
    } catch (error) {
      console.error('Auth error details:', error);
      throw error;
    } finally {
      this.ignoreNextAuthEvent = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Direct Supabase Sign Up (`signup` / `signUp`)
  // Supports both `signUp({ fullName, email, password })` and `signup(email, password, metadata)`
  // ---------------------------------------------------------------------------
  async signup(email, password, metadata = {}) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(metadata?.full_name || metadata?.fullName || '').trim();

    const supabase = await this.resolveClient();
    await this.ensureAuthStateListener();

    this.ignoreNextAuthEvent = true;
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: metadata },
      });
      if (error) {
        console.error('Auth error details:', error);
        throw error;
      }

      if (
        data?.user &&
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0
      ) {
        const dupError = new Error('User already registered');
        console.error('Auth error details:', dupError);
        throw dupError;
      }

      if (data?.session) {
        this.accessToken = data.session.access_token || null;
      }

      if (data?.user) {
        this.saveLocalProfileExtras(data.user.id, {
          email: cleanEmail,
          fullName: cleanName || cleanEmail.split('@')[0],
          campusAffiliation: null,
        });
        const normalized = this.normalizeUser(data.user, null, {
          fullName: cleanName || cleanEmail.split('@')[0],
        });
        this.currentUser = normalized;
        this.saveCachedUserProfile(normalized);
        this.notify();
      }

      return data.user;
    } catch (error) {
      console.error('Auth error details:', error);
      throw error;
    } finally {
      this.ignoreNextAuthEvent = false;
    }
  }

  async signUp(optionsOrEmail, maybePassword, maybeMetadata) {
    if (typeof optionsOrEmail === 'object' && optionsOrEmail !== null) {
      const cleanName = String(optionsOrEmail.fullName || '').trim();
      if (!cleanName || cleanName.length < 2) {
        throw new Error('Please enter your full name (at least 2 characters).');
      }
      return this.signup(optionsOrEmail.email, optionsOrEmail.password, {
        full_name: cleanName,
        fullName: cleanName,
        campus_affiliation: null,
      });
    }
    return this.signup(optionsOrEmail, maybePassword, maybeMetadata);
  }

  // ---------------------------------------------------------------------------
  // Quick Demo Login (`demoLogin`)
  // Authenticates immediately and routes straight to the main dashboard
  // ---------------------------------------------------------------------------
  async demoLogin() {
    this.ignoreNextAuthEvent = true;
    try {
      const demoUser = {
        id: 'demo-user-12345',
        email: 'demo@example.com',
        user_metadata: { full_name: 'Demo User' },
        role: 'authenticated',
      };

      const normalizedDemo = this.normalizeUser(demoUser, null, {
        fullName: 'Demo User',
        email: 'demo@example.com',
        isDemo: true,
      });

      this.accessToken = 'demo-session-token-12345';
      this.currentUser = normalizedDemo;
      this.saveCachedUserProfile(normalizedDemo);
      this.notify();
      return this.currentUser;
    } finally {
      this.ignoreNextAuthEvent = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Direct Profile Update (`updateProfile` — zero `/api` calls)
  // ---------------------------------------------------------------------------
  async updateProfile({ fullName, campusAffiliation, avatarDataUrl, removeAvatar }) {
    if (!this.currentUser) {
      throw new Error('Please log in to update your profile.');
    }

    const cleanName = (fullName || '').trim();
    if (!cleanName || cleanName.length < 2) {
      throw new Error('Display name must be at least 2 characters.');
    }
    if (cleanName.length > 80) {
      throw new Error('Display name must be 80 characters or fewer.');
    }

    let normalizedAffiliation = this.currentUser.campusAffiliation ?? null;
    if (campusAffiliation !== undefined) {
      const cleanAff = String(campusAffiliation || '').trim().toLowerCase();
      if (cleanAff === '') {
        normalizedAffiliation = null;
      } else if (cleanAff === 'student' || cleanAff === 'staff') {
        normalizedAffiliation = cleanAff;
      } else {
        throw new Error('Please select a valid campus affiliation (Student or Staff).');
      }
    }

    let nextAvatarUrl = this.currentUser.profilePhotoUrl ?? null;
    if (Boolean(removeAvatar)) {
      nextAvatarUrl = null;
    } else if (avatarDataUrl !== undefined && avatarDataUrl !== null && avatarDataUrl !== '') {
      const match = String(avatarDataUrl).match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/
      );
      if (!match) {
        throw new Error('Invalid image format. Please choose a valid JPEG, PNG, or WebP image.');
      }
      const mimeType = match[1].toLowerCase();
      if (!ALLOWED_AVATAR_MIMES.includes(mimeType)) {
        throw new Error('Unsupported image format. Please use a JPEG, PNG, or WebP photo.');
      }
      const approxBytes = Math.floor((match[2].length * 3) / 4);
      if (approxBytes > MAX_AVATAR_BYTES) {
        throw new Error('Profile photo exceeds the 5 MB size limit. Please choose a smaller image.');
      }
      nextAvatarUrl = String(avatarDataUrl);
    }

    const nowIso = new Date().toISOString();
    this.saveLocalProfileExtras(this.currentUser.id, {
      email: this.currentUser.email,
      fullName: cleanName,
      campusAffiliation: normalizedAffiliation,
      avatarUrl: nextAvatarUrl,
      updatedAt: nowIso,
    });

    if (!this.currentUser.isDemo && this.isConfigured()) {
      try {
        const supabase = await this.resolveClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user?.id) {
          await supabase
            .from('profiles')
            .upsert(
              {
                id: session.user.id,
                email: this.currentUser.email,
                full_name: cleanName,
                role: this.currentUser.role || 'member',
                campus_affiliation: normalizedAffiliation,
                avatar_url: nextAvatarUrl,
                updated_at: nowIso,
              },
              { onConflict: 'id' }
            )
            .catch(() => {});

          this.ignoreNextAuthEvent = true;
          await supabase.auth
            .updateUser({
              data: {
                full_name: cleanName,
                fullName: cleanName,
                campus_affiliation: normalizedAffiliation,
              },
            })
            .catch(() => {});
          this.ignoreNextAuthEvent = false;
        }
      } catch {
        this.ignoreNextAuthEvent = false;
      }
    }

    this.currentUser = {
      ...this.currentUser,
      fullName: cleanName,
      campusAffiliation: normalizedAffiliation,
      hasProfilePhoto: Boolean(nextAvatarUrl),
      profilePhotoUrl: nextAvatarUrl,
      updatedAt: nowIso,
    };

    this.saveCachedUserProfile(this.currentUser);
    this.notify();
    return this.currentUser;
  }

  // ---------------------------------------------------------------------------
  // Direct Supabase Sign Out (`logout` — zero `/api` calls)
  // ---------------------------------------------------------------------------
  async logout() {
    this.ignoreNextAuthEvent = true;
    try {
      if (this.isConfigured()) {
        const supabase = await this.resolveClient();
        await supabase.auth.signOut();
      }
    } catch {
      // Always clear local state even if network signOut fails
    } finally {
      this.ignoreNextAuthEvent = false;
    }

    for (const cb of this.cacheClearCallbacks) {
      try {
        cb();
      } catch {
        // Ignore callback errors
      }
    }

    this.clearCachedUserProfile();
    this.accessToken = null;
    this.currentUser = null;
    this.intendedDestination = null;
    this.notify();
  }
}

export const authService = new AuthService();
