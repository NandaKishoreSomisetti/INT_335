/**
 * Authentication, Session & Profile Service Layer (js/services/authService.js)
 *
 * Powered by Supabase Auth (`@supabase/supabase-js`):
 * 1. Sign Up: Registers users exclusively via `supabase.auth.signUp({ email, password, options: { data } })`,
 *    logs `console.error('Supabase signup error:', error)` on failure, and surfaces `error.message` directly.
 * 2. Sign In: Authenticates via `supabase.auth.signInWithPassword({ email, password })`,
 *    immediately stores the user in client state upon `data.session`, and routes to the main dashboard.
 * 3. Sign Out & Reactive Session Management: `supabase.auth.signOut()` and `supabase.auth.onAuthStateChange()`.
 * 4. Profile Synchronization: Relies on the Supabase SQL trigger (`on_auth_user_created`) on signup
 *    and guards any `public.profiles` reads/updates behind an active authenticated session.
 */

import { AUTH_CONFIG, SUPABASE_CONFIG, STORAGE_KEYS } from '../config.js';
import { getSupabaseClient } from './supabaseClient.js';

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

class AuthService {
  constructor() {
    this.currentUser = null;
    this.accessToken = null;
    this.listeners = new Set();
    this.cacheClearCallbacks = new Set();
    this.intendedDestination = null;
    this.authSubscriptionInitialized = false;
    this.ignoreNextAuthEvent = false;
    this.avatarMemoryCache = new Map();
  }

  /**
   * Returns true when a valid Supabase configuration is present.
   */
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

  /**
   * Returns true if a user is currently authenticated.
   */
  isAuthenticated() {
    return Boolean(this.currentUser && this.currentUser.id);
  }

  /**
   * Returns the active Supabase JWT access token (if signed in).
   */
  getAccessToken() {
    return this.accessToken || null;
  }

  /**
   * Subscribe to session state changes (`currentUser`).
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Register a callback invoked during `logout()` to purge sensitive in-memory state.
   */
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

  // ---------------------------------------------------------------------------
  // User Normalization & Guarded Profile Hydration
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
    const email = String(
      overrides.email || profileRow?.email || supabaseUser.email || ''
    )
      .trim()
      .toLowerCase();

    const fullName =
      String(
        overrides.fullName ||
          profileRow?.full_name ||
          meta.full_name ||
          meta.fullName ||
          meta.name ||
          email.split('@')[0] ||
          'Campus Member'
      ).trim() || 'Campus Member';

    // Authorization role ('member' | 'staff') is strictly separate from campusAffiliation
    const role = this.deriveDefaultRole(email, profileRow?.role || meta.role);

    const rawAffiliation =
      overrides.campusAffiliation !== undefined
        ? overrides.campusAffiliation
        : profileRow?.campus_affiliation ?? meta.campus_affiliation ?? meta.campusAffiliation ?? null;
    const campusAffiliation =
      rawAffiliation === 'student' || rawAffiliation === 'staff' ? rawAffiliation : null;

    let avatarUrl =
      overrides.avatarUrl !== undefined
        ? overrides.avatarUrl
        : profileRow?.avatar_url !== undefined
        ? profileRow.avatar_url
        : this.avatarMemoryCache.has(userId)
        ? this.avatarMemoryCache.get(userId)
        : meta.avatar_url !== undefined
        ? meta.avatar_url
        : null;

    if (meta.has_avatar === false && overrides.avatarUrl === undefined) {
      avatarUrl = profileRow?.avatar_url ?? null;
    }

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
      updatedAt: profileRow?.updated_at || supabaseUser.updated_at || new Date().toISOString(),
    };
  }

  /**
   * Strictly guarded profile fetch: ONLY queries `public.profiles` when an active
   * authenticated `session.access_token` is present, and never throws or blocks auth.
   */
  async fetchProfileWhenAuthenticated(supabase, session, overrides = {}) {
    if (!supabase || !session?.access_token || !session?.user?.id) {
      return this.normalizeUser(session?.user, null, overrides);
    }

    let profileRow = null;
    try {
      const { data: existingProfile, error: selectError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, campus_affiliation, avatar_url, updated_at')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!selectError && existingProfile) {
        profileRow = existingProfile;
        if (existingProfile.avatar_url) {
          this.avatarMemoryCache.set(String(session.user.id), existingProfile.avatar_url);
        }
      }
    } catch {
      // Never fail login/signup if public.profiles is not yet migrated
    }

    return this.normalizeUser(session.user, profileRow, overrides);
  }

  /**
   * Optional non-blocking bridge to the local Node server (`/api/auth/session`).
   */
  async syncServerSessionBridge(session, userProfile = null) {
    if (typeof fetch === 'undefined' || !session?.access_token) return null;
    try {
      const endpoint = `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${AUTH_CONFIG.endpoints.session}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          accessToken: session.access_token,
          rememberMe: this.getRememberMePreference(),
          profile: userProfile,
        }),
      });
      if (res.ok) {
        const payload = await res.json().catch(() => ({}));
        return payload?.user || null;
      }
    } catch {
      // Non-fatal on static hosts (e.g., GitHub Pages)
    }
    return null;
  }

  /**
   * Initializes the reactive `supabase.auth.onAuthStateChange` listener once.
   */
  async ensureAuthStateListener() {
    if (this.authSubscriptionInitialized) return;
    this.authSubscriptionInitialized = true;

    try {
      const supabase = await getSupabaseClient();
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (this.ignoreNextAuthEvent) return;

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
          const immediateUser = this.normalizeUser(session.user);
          if (!this.currentUser) {
            this.currentUser = immediateUser;
            this.saveCachedUserProfile(immediateUser);
            this.notify();
          }

          const hydratedUser = await this.fetchProfileWhenAuthenticated(supabase, session);
          if (hydratedUser) {
            const prevJson = JSON.stringify(this.currentUser);
            const nextJson = JSON.stringify(hydratedUser);
            this.currentUser = hydratedUser;
            this.saveCachedUserProfile(hydratedUser);
            this.syncServerSessionBridge(session, hydratedUser).catch(() => {});
            if (prevJson !== nextJson) {
              this.notify();
            }
          }
        }
      });
    } catch {
      this.authSubscriptionInitialized = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Session Restoration (`restoreSession`)
  // ---------------------------------------------------------------------------
  async restoreSession() {
    if (!this.isConfigured()) {
      return null;
    }

    await this.ensureAuthStateListener();

    try {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase.auth.getSession();

      if (!error && data?.session?.user) {
        this.accessToken = data.session.access_token || null;
        const immediateUser = this.normalizeUser(data.session.user);
        this.currentUser = immediateUser;
        this.saveCachedUserProfile(immediateUser);
        this.notify();

        // Hydrate any additional profile fields without blocking UI routing
        this.fetchProfileWhenAuthenticated(supabase, data.session)
          .then((hydrated) => {
            if (hydrated && this.currentUser?.id === hydrated.id) {
              this.currentUser = hydrated;
              this.saveCachedUserProfile(hydrated);
              this.syncServerSessionBridge(data.session, hydrated).catch(() => {});
              this.notify();
            }
          })
          .catch(() => {});

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
      this.notify();
      return null;
    } catch {
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
  // Sign In (`supabase.auth.signInWithPassword`)
  // ---------------------------------------------------------------------------
  async login({ email, password, rememberMe }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    this.applyRememberMePolicy(cleanEmail, rememberMe);

    if (!this.isConfigured()) {
      throw new AuthConfigurationError(
        'Supabase URL or Anon Key is missing from environment variables'
      );
    }

    await this.ensureAuthStateListener();
    const supabase = await getSupabaseClient();

    this.ignoreNextAuthEvent = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        console.error('Supabase login error:', error);
        const authErr = new Error(error.message || 'Authentication failed.');
        authErr.code = error.code;
        authErr.status = error.status;
        throw authErr;
      }

      if (data?.session && data?.session?.user) {
        this.accessToken = data.session.access_token || null;
        // Immediately store user in client state and route to main dashboard
        const immediateUser = this.normalizeUser(data.session.user);
        this.currentUser = immediateUser;
        this.saveCachedUserProfile(immediateUser);
        this.notify();

        // Non-blocking profile hydration & server session sync
        this.fetchProfileWhenAuthenticated(supabase, data.session)
          .then((hydratedUser) => {
            if (hydratedUser && this.currentUser?.id === hydratedUser.id) {
              this.currentUser = hydratedUser;
              this.saveCachedUserProfile(hydratedUser);
              this.syncServerSessionBridge(data.session, hydratedUser).catch(() => {});
              this.notify();
            }
          })
          .catch(() => {});

        return this.currentUser;
      }

      if (data?.user) {
        const fallbackUser = this.normalizeUser(data.user);
        this.currentUser = fallbackUser;
        this.saveCachedUserProfile(fallbackUser);
        this.notify();
        return this.currentUser;
      }

      throw new Error('No active session returned from Supabase.');
    } finally {
      this.ignoreNextAuthEvent = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Sign Up (`supabase.auth.signUp`)
  // ---------------------------------------------------------------------------
  async signUp({ fullName, email, password }) {
    const cleanName = (fullName || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanName || cleanName.length < 2) {
      throw new Error('Please enter your full name (at least 2 characters).');
    }

    if (!this.isConfigured()) {
      throw new AuthConfigurationError(
        'Supabase URL or Anon Key is missing from environment variables'
      );
    }

    await this.ensureAuthStateListener();
    const supabase = await getSupabaseClient();

    this.ignoreNextAuthEvent = true;
    try {
      // Register user exclusively through supabase.auth.signUp (never insert raw passwords into tables)
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: cleanName,
            fullName: cleanName,
            campus_affiliation: null,
          },
        },
      });

      if (error) {
        console.error('Supabase signup error:', error);
        const signUpErr = new Error(error.message || 'Sign up failed.');
        signUpErr.code = error.code;
        signUpErr.status = error.status;
        throw signUpErr;
      }

      // Detect duplicate user when Supabase obfuscates existing email addresses
      if (
        data?.user &&
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0
      ) {
        const dupError = new Error('User already registered with this email address.');
        console.error('Supabase signup error:', dupError);
        throw dupError;
      }

      // Case 1: Active session returned immediately by Supabase
      if (data?.session && data?.user) {
        this.accessToken = data.session.access_token || null;
        const immediateUser = this.normalizeUser(data.user, null, { fullName: cleanName });
        this.currentUser = immediateUser;
        this.saveCachedUserProfile(immediateUser);
        this.notify();

        this.syncServerSessionBridge(data.session, immediateUser).catch(() => {});
        return this.currentUser;
      }

      // Case 2: User created in auth.users (session is null if email confirmation is enabled)
      if (data?.user) {
        const createdUser = this.normalizeUser(data.user, null, { fullName: cleanName });
        this.currentUser = createdUser;
        this.saveCachedUserProfile(createdUser);
        this.notify();
        return this.currentUser;
      }

      const unknownErr = new Error('Supabase signUp completed without returning a user record.');
      console.error('Supabase signup error:', unknownErr);
      throw unknownErr;
    } finally {
      this.ignoreNextAuthEvent = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Profile Update (`public.profiles` + `supabase.auth.updateUser`)
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
      this.avatarMemoryCache.delete(this.currentUser.id);
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
      this.avatarMemoryCache.set(this.currentUser.id, nextAvatarUrl);
    }

    const supabase = await getSupabaseClient();
    const nowIso = new Date().toISOString();
    const { data: sessionData } = await supabase.auth.getSession();
    const activeSession = sessionData?.session || null;

    // 1. Guarded upsert into `public.profiles` ONLY when an active authenticated session exists
    let updatedProfileRow = null;
    if (activeSession?.access_token && activeSession?.user?.id) {
      try {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .upsert(
            {
              id: activeSession.user.id,
              email: this.currentUser.email,
              full_name: cleanName,
              role: this.currentUser.role || 'member',
              campus_affiliation: normalizedAffiliation,
              avatar_url: nextAvatarUrl,
              updated_at: nowIso,
            },
            { onConflict: 'id' }
          )
          .select('id, email, full_name, role, campus_affiliation, avatar_url, updated_at')
          .maybeSingle();

        if (!profileError && profileData) {
          updatedProfileRow = profileData;
        }
      } catch {
        // Ignore if public.profiles table has not been migrated yet
      }
    }

    // 2. Keep `auth.users` metadata synchronized when an active session is present
    this.ignoreNextAuthEvent = true;
    try {
      const metadataPayload = {
        full_name: cleanName,
        fullName: cleanName,
        campus_affiliation: normalizedAffiliation,
        has_avatar: Boolean(nextAvatarUrl),
      };

      if (activeSession?.access_token) {
        await supabase.auth.updateUser({ data: metadataPayload }).catch(() => {});
      }

      // 3. Synchronize with server-side `/api/auth/profile` if available
      if (typeof fetch !== 'undefined' && AUTH_CONFIG.baseUrl && this.accessToken) {
        const profileEndpoint = `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${AUTH_CONFIG.endpoints.profile}`;
        await fetch(profileEndpoint, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify({
            fullName: cleanName,
            campusAffiliation: normalizedAffiliation,
            avatarDataUrl: Boolean(removeAvatar) ? undefined : avatarDataUrl,
            removeAvatar: Boolean(removeAvatar),
          }),
        }).catch(() => {});
      }

      const effectiveRow = updatedProfileRow || {
        id: this.currentUser.id,
        email: this.currentUser.email,
        full_name: cleanName,
        role: this.currentUser.role || 'member',
        campus_affiliation: normalizedAffiliation,
        avatar_url: nextAvatarUrl,
        updated_at: nowIso,
      };

      this.currentUser = this.normalizeUser(
        { id: this.currentUser.id, email: this.currentUser.email, user_metadata: metadataPayload },
        effectiveRow
      );
      this.saveCachedUserProfile(this.currentUser);
      this.notify();
      return this.currentUser;
    } finally {
      this.ignoreNextAuthEvent = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Sign Out (`supabase.auth.signOut`)
  // ---------------------------------------------------------------------------
  async logout() {
    this.ignoreNextAuthEvent = true;
    try {
      if (this.isConfigured()) {
        const supabase = await getSupabaseClient();
        await supabase.auth.signOut();
      }
    } catch {
      // Always clear local & server state even if network signOut fails
    } finally {
      this.ignoreNextAuthEvent = false;
    }

    if (typeof fetch !== 'undefined' && AUTH_CONFIG.baseUrl) {
      const endpoint = `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${AUTH_CONFIG.endpoints.logout}`;
      try {
        await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        // Ignore network errors during logout bridge cleanup
      }
    }

    for (const cb of this.cacheClearCallbacks) {
      try {
        cb();
      } catch {
        // Ignore callback errors
      }
    }

    this.avatarMemoryCache.clear();
    this.clearCachedUserProfile();
    this.accessToken = null;
    this.currentUser = null;
    this.intendedDestination = null;
    this.notify();
  }
}

export const authService = new AuthService();
