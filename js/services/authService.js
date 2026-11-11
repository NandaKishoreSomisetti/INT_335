/**
 * Authentication, Session & Profile Service Layer (js/services/authService.js)
 *
 * Powered by Supabase Auth (`@supabase/supabase-js`) and `public.profiles`:
 * 1. Sign Up: `supabase.auth.signUp()` with `email`, `password`, and `options.data` metadata,
 *    plus automatic synchronization into `public.profiles`.
 * 2. Sign In: `supabase.auth.signInWithPassword()` with clear, user-friendly error mapping.
 * 3. Sign Out & Reactive Session Management: `supabase.auth.signOut()` and
 *    `supabase.auth.onAuthStateChange()` without page stutter or reload loops.
 * 4. Profile Synchronization: Reads and updates `public.profiles` (with `user_metadata`
 *    and server bridge fallback resilience) for `full_name`, `campus_affiliation`
 *    ('student' | 'staff' | null), and `avatar_url`, keeping `campus_affiliation`
 *    strictly separate from authorization `role`.
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

/**
 * Translates raw Supabase Auth error messages into clear, user-friendly feedback.
 */
function formatSupabaseAuthError(error, context = 'login') {
  const rawMessage = String(error?.message || error?.error_description || '').trim();
  const lower = rawMessage.toLowerCase();

  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return {
      message: 'Invalid email or password. Please check your credentials and try again.',
      requiresVerification: false,
    };
  }

  if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed')) {
    return {
      message:
        'Please verify your email address before signing in. Check your inbox for the confirmation link.',
      requiresVerification: true,
    };
  }

  if (
    lower.includes('user already registered') ||
    lower.includes('already been registered') ||
    lower.includes('already exists')
  ) {
    return {
      message: 'An account with this email address already exists. Please log in instead.',
      requiresVerification: false,
    };
  }

  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    error?.status === 429
  ) {
    return {
      message: 'Too many authentication attempts. Please wait a moment before trying again.',
      requiresVerification: false,
    };
  }

  if (lower.includes('password should be at least')) {
    return {
      message: 'Password must be at least 8 characters long.',
      requiresVerification: false,
    };
  }

  if (lower.includes('unable to validate email') || lower.includes('invalid format')) {
    return {
      message: 'Please enter a valid email address.',
      requiresVerification: false,
    };
  }

  if (rawMessage) {
    return {
      message: rawMessage,
      requiresVerification: false,
    };
  }

  return {
    message:
      context === 'signup'
        ? 'Unable to create your account right now. Please try again.'
        : 'Unable to verify credentials right now. Please try again.',
    requiresVerification: false,
  };
}

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
    return Boolean(
      SUPABASE_CONFIG.url &&
        SUPABASE_CONFIG.url.trim().length > 0 &&
        SUPABASE_CONFIG.anonKey &&
        SUPABASE_CONFIG.anonKey.trim().length > 0
    );
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

  // ---------------------------------------------------------------------------
  // Supabase `public.profiles` Synchronization & User Normalization
  // ---------------------------------------------------------------------------
  deriveDefaultRole(email, existingRole) {
    if (existingRole === 'staff' || existingRole === 'admin') {
      return 'staff';
    }
    const cleanEmail = String(email || '').trim().toLowerCase();
    return STAFF_EMAIL_SET.has(cleanEmail) ? 'staff' : 'member';
  }

  normalizeUser(supabaseUser, profileRow = null) {
    if (!supabaseUser || !supabaseUser.id) return null;

    const userId = String(supabaseUser.id);
    const meta = supabaseUser.user_metadata || {};
    const email = String(profileRow?.email || supabaseUser.email || '').trim().toLowerCase();

    const fullName =
      String(
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
      profileRow?.campus_affiliation ?? meta.campus_affiliation ?? meta.campusAffiliation ?? null;
    const campusAffiliation =
      rawAffiliation === 'student' || rawAffiliation === 'staff' ? rawAffiliation : null;

    let avatarUrl =
      profileRow?.avatar_url !== undefined
        ? profileRow.avatar_url
        : this.avatarMemoryCache.has(userId)
        ? this.avatarMemoryCache.get(userId)
        : meta.avatar_url !== undefined
        ? meta.avatar_url
        : null;

    if (meta.has_avatar === false) {
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
   * Synchronizes the authenticated `auth.users` record with `public.profiles`.
   * Automatically mirrors missing users into `public.profiles` and falls back cleanly
   * to `user_metadata` if the database migration has not yet been applied.
   */
  async syncProfileFromDatabase(supabase, supabaseUser, overrides = {}) {
    if (!supabase || !supabaseUser?.id) {
      return this.normalizeUser(supabaseUser);
    }

    const meta = supabaseUser.user_metadata || {};
    const email = String(supabaseUser.email || '').trim().toLowerCase();
    let profileRow = null;

    try {
      const { data: existingProfile, error: selectError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, campus_affiliation, avatar_url, updated_at')
        .eq('id', supabaseUser.id)
        .maybeSingle();

      if (!selectError && existingProfile) {
        profileRow = existingProfile;
        if (existingProfile.avatar_url) {
          this.avatarMemoryCache.set(String(supabaseUser.id), existingProfile.avatar_url);
        }
      } else if (!selectError && !existingProfile) {
        // Mirror new user into `public.profiles`
        const initialPayload = {
          id: supabaseUser.id,
          email,
          full_name:
            overrides.fullName ||
            meta.full_name ||
            meta.fullName ||
            email.split('@')[0] ||
            'Campus Member',
          role: this.deriveDefaultRole(email, meta.role),
          campus_affiliation:
            overrides.campusAffiliation !== undefined
              ? overrides.campusAffiliation
              : meta.campus_affiliation ?? null,
          avatar_url:
            overrides.avatarUrl !== undefined ? overrides.avatarUrl : meta.avatar_url ?? null,
          updated_at: new Date().toISOString(),
        };

        const { data: insertedProfile, error: upsertError } = await supabase
          .from('profiles')
          .upsert(initialPayload, { onConflict: 'id' })
          .select('id, email, full_name, role, campus_affiliation, avatar_url, updated_at')
          .maybeSingle();

        if (!upsertError && insertedProfile) {
          profileRow = insertedProfile;
        }
      }
    } catch {
      // Gracefully fall back to user_metadata if public.profiles table is not yet migrated
    }

    return this.normalizeUser(supabaseUser, profileRow);
  }

  /**
   * Bridges the active Supabase session token to the local Node server (`/api/auth/session`)
   * so API calls with `credentials: 'include'` or `Authorization: Bearer` stay synchronized.
   */
  async syncServerSessionBridge(session, userProfile = null) {
    if (typeof fetch === 'undefined') return null;
    try {
      const endpoint = `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${AUTH_CONFIG.endpoints.session}`;
      if (session?.access_token) {
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
          if (payload?.user?.profilePhotoUrl && userProfile && !userProfile.profilePhotoUrl) {
            userProfile.hasProfilePhoto = true;
            userProfile.profilePhotoUrl = payload.user.profilePhotoUrl;
            this.avatarMemoryCache.set(userProfile.id, payload.user.profilePhotoUrl);
          }
          return payload?.user || null;
        }
      }
    } catch {
      // Non-fatal if running in serverless/static preview
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

        if (event === 'SIGNED_OUT' || !session?.user) {
          this.accessToken = null;
          if (this.currentUser !== null) {
            this.currentUser = null;
            this.notify();
          }
          return;
        }

        if (
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED' ||
          event === 'INITIAL_SESSION'
        ) {
          this.accessToken = session.access_token || null;
          const syncedUser = await this.syncProfileFromDatabase(supabase, session.user);
          await this.syncServerSessionBridge(session, syncedUser);
          const prevJson = JSON.stringify(this.currentUser);
          const nextJson = JSON.stringify(syncedUser);
          this.currentUser = syncedUser;
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

      if (error || !data?.session?.user) {
        this.accessToken = null;
        this.currentUser = null;
        this.notify();
        return null;
      }

      this.accessToken = data.session.access_token || null;
      const syncedUser = await this.syncProfileFromDatabase(supabase, data.session.user);
      await this.syncServerSessionBridge(data.session, syncedUser);
      this.currentUser = syncedUser;
      this.notify();
      return this.currentUser;
    } catch {
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
      throw new AuthConfigurationError('Sign-in is temporarily unavailable. Please try again later.');
    }

    await this.ensureAuthStateListener();

    let supabase;
    try {
      supabase = await getSupabaseClient();
    } catch {
      throw new AuthConfigurationError('Sign-in service could not be initialized.');
    }

    this.ignoreNextAuthEvent = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        const formatted = formatSupabaseAuthError(error, 'login');
        const authErr = new Error(formatted.message);
        authErr.requiresVerification = formatted.requiresVerification;
        throw authErr;
      }

      if (!data?.session || !data?.user) {
        const verifyErr = new Error(
          'Please verify your email address before signing in. Check your inbox for the confirmation link.'
        );
        verifyErr.requiresVerification = true;
        throw verifyErr;
      }

      this.accessToken = data.session.access_token || null;
      const syncedUser = await this.syncProfileFromDatabase(supabase, data.user);
      await this.syncServerSessionBridge(data.session, syncedUser);
      this.currentUser = syncedUser;
      this.notify();
      return this.currentUser;
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
        'Registration is temporarily unavailable. Please try again later.'
      );
    }

    await this.ensureAuthStateListener();

    let supabase;
    try {
      supabase = await getSupabaseClient();
    } catch {
      throw new AuthConfigurationError('Registration service could not be initialized.');
    }

    this.ignoreNextAuthEvent = true;
    try {
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
        const formatted = formatSupabaseAuthError(error, 'signup');
        const signUpErr = new Error(formatted.message);
        signUpErr.requiresVerification = formatted.requiresVerification;
        throw signUpErr;
      }

      // Detect obfuscated duplicate user response when email confirmations are enabled
      if (
        data?.user &&
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0
      ) {
        throw new Error(
          'An account with this email address already exists. Please log in instead.'
        );
      }

      // Case 1: Active session returned immediately (Auto-confirm enabled in Supabase)
      if (data?.session && data?.user) {
        this.accessToken = data.session.access_token || null;
        const syncedUser = await this.syncProfileFromDatabase(supabase, data.user, {
          fullName: cleanName,
        });
        await this.syncServerSessionBridge(data.session, syncedUser);
        this.currentUser = syncedUser;
        this.notify();
        return this.currentUser;
      }

      // Case 2: Email confirmation required by Supabase project settings
      if (data?.user && !data?.session) {
        return {
          requiresVerification: true,
          email: cleanEmail,
          message:
            'Your account has been created. Please check your email inbox to confirm your address before logging in.',
        };
      }

      throw new Error('Unable to complete registration. Please try again.');
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

    // 1. Upsert into `public.profiles` (with RLS `auth.uid() = id`)
    let updatedProfileRow = null;
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .upsert(
          {
            id: this.currentUser.id,
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
      // Fall through to auth.updateUser + server profile endpoint if table is not yet migrated
    }

    // 2. Keep `auth.users` metadata synchronized (keeping JWT compact without large base64 strings)
    this.ignoreNextAuthEvent = true;
    try {
      const metadataPayload = {
        full_name: cleanName,
        fullName: cleanName,
        campus_affiliation: normalizedAffiliation,
        has_avatar: Boolean(nextAvatarUrl),
      };

      const { data: userUpdateData, error: userUpdateError } = await supabase.auth.updateUser({
        data: metadataPayload,
      });

      if (userUpdateError && !updatedProfileRow) {
        throw new Error(userUpdateError.message || 'Could not update profile.');
      }

      // 3. Synchronize with server-side `/api/auth/profile` endpoint
      if (typeof fetch !== 'undefined' && AUTH_CONFIG.baseUrl) {
        const profileEndpoint = `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${AUTH_CONFIG.endpoints.profile}`;
        const headers = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };
        if (this.accessToken) {
          headers.Authorization = `Bearer ${this.accessToken}`;
        }
        await fetch(profileEndpoint, {
          method: 'PUT',
          credentials: 'include',
          headers,
          body: JSON.stringify({
            fullName: cleanName,
            campusAffiliation: normalizedAffiliation,
            avatarDataUrl: Boolean(removeAvatar) ? undefined : avatarDataUrl,
            removeAvatar: Boolean(removeAvatar),
          }),
        }).catch(() => {});
      }

      const baseUser = userUpdateData?.user || {
        id: this.currentUser.id,
        email: this.currentUser.email,
        user_metadata: metadataPayload,
      };

      const effectiveRow = updatedProfileRow || {
        id: this.currentUser.id,
        email: this.currentUser.email,
        full_name: cleanName,
        role: this.currentUser.role || 'member',
        campus_affiliation: normalizedAffiliation,
        avatar_url: nextAvatarUrl,
        updated_at: nowIso,
      };

      this.currentUser = this.normalizeUser(baseUser, effectiveRow);
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

    // Clear all sensitive account caches registered by services
    for (const cb of this.cacheClearCallbacks) {
      try {
        cb();
      } catch {
        // Ignore callback errors
      }
    }

    this.avatarMemoryCache.clear();
    this.accessToken = null;
    this.currentUser = null;
    this.intendedDestination = null;
    this.notify();
  }
}

export const authService = new AuthService();
