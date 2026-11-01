/**
 * Authentication Integration Layer (js/services/authService.js)
 *
 * Responsibilities:
 * 1. Device-level "Remember me" email persistence (never stores raw passwords in
 *    localStorage, sessionStorage, cookies, or client storage).
 * 2. Real HTTP authentication integration against `AUTH_CONFIG.baseUrl`.
 * 3. Preserves intended post-login destination (e.g. 'reviews' when login began there).
 * 4. Supports profile updates (`PUT /api/auth/profile`) and email-verification states.
 * 5. Real sign-out (`POST /api/auth/logout`) that clears account-specific client caches
 *    and prevents browser Back from restoring protected content.
 */

import { AUTH_CONFIG } from '../config.js';

export class AuthConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthConfigurationError';
    this.isConfigurationMissing = true;
  }
}

class AuthService {
  constructor() {
    this.currentUser = null;
    this.intendedDestination = null; // e.g. 'reviews' | 'overview'
    this.pendingVerificationEmail = null;
    this.listeners = new Set();
    this.cacheClearCallbacks = new Set();
  }

  /**
   * Checks whether a real authentication backend URL has been configured.
   */
  isConfigured() {
    return Boolean(AUTH_CONFIG.baseUrl && AUTH_CONFIG.baseUrl.trim().length > 0);
  }

  /**
   * Register a callback to wipe account-specific client caches on logout.
   */
  onClearAccountCache(callback) {
    this.cacheClearCallbacks.add(callback);
    return () => this.cacheClearCallbacks.delete(callback);
  }

  clearAccountCaches() {
    for (const cb of this.cacheClearCallbacks) {
      try {
        cb();
      } catch {
        // Ignore cache cleanup errors
      }
    }
  }

  /**
   * Sets or consumes the intended destination after login.
   */
  setIntendedDestination(viewName) {
    this.intendedDestination = viewName || null;
  }

  consumeIntendedDestination() {
    const dest = this.intendedDestination;
    this.intendedDestination = null;
    return dest || 'overview';
  }

  /**
   * Subscribe to authentication state transitions.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.currentUser);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }

  /**
   * Retrieves the remembered email address if the user previously opted into "Remember me".
   */
  getRememberedEmail() {
    try {
      const rememberPref = localStorage.getItem(AUTH_CONFIG.storageKeys.rememberPreference);
      if (rememberPref === 'true') {
        return localStorage.getItem(AUTH_CONFIG.storageKeys.rememberedEmail) || '';
      }
    } catch {
      // Storage access restricted in private browsing
    }
    return '';
  }

  /**
   * Checks whether "Remember me" was previously selected on this device.
   */
  getRememberMePreference() {
    try {
      return localStorage.getItem(AUTH_CONFIG.storageKeys.rememberPreference) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Persists or clears the user's email address based on the "Remember me" checkbox.
   * NEVER stores passwords in any browser storage.
   */
  applyRememberMePolicy(email, rememberMe) {
    try {
      if (rememberMe && email) {
        localStorage.setItem(AUTH_CONFIG.storageKeys.rememberPreference, 'true');
        localStorage.setItem(AUTH_CONFIG.storageKeys.rememberedEmail, email.trim());
      } else {
        localStorage.removeItem(AUTH_CONFIG.storageKeys.rememberPreference);
        localStorage.removeItem(AUTH_CONFIG.storageKeys.rememberedEmail);
      }
    } catch {
      // Ignore storage quota / privacy mode exceptions
    }
  }

  normalizeUser(rawUser, fallbackEmail = '', persistence = 'session') {
    if (!rawUser) return null;
    const rawAff =
      rawUser.campusAffiliation === 'student' || rawUser.campusAffiliation === 'staff'
        ? rawUser.campusAffiliation
        : null;
    return {
      id: rawUser.id,
      fullName: rawUser.fullName || rawUser.name || fallbackEmail,
      email: rawUser.email || fallbackEmail,
      role: rawUser.role || 'member',
      campusAffiliation: rawAff,
      hasProfilePhoto: Boolean(rawUser.hasProfilePhoto),
      profilePhotoUrl: rawUser.profilePhotoUrl || null,
      emailVerified: rawUser.emailVerified !== false,
      persistence: rawUser.persistence || persistence,
    };
  }

  /**
   * Restores an active authenticated session from the configured backend if available.
   */
  async restoreSession() {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const response = await fetch(
        `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${AUTH_CONFIG.endpoints.session}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }
      );

      if (!response.ok) {
        this.currentUser = null;
        this.notify();
        return null;
      }

      const data = await response.json();
      if (data && data.user) {
        this.currentUser = this.normalizeUser(data.user, data.user.email, data.user.persistence);
        this.notify();
        return this.currentUser;
      }
    } catch {
      // Session restoration failed or backend unreachable
    }
    return null;
  }

  /**
   * Authenticates a returning user with email and password.
   */
  async login({ email, password, rememberMe }) {
    const cleanEmail = (email || '').trim();
    this.applyRememberMePolicy(cleanEmail, Boolean(rememberMe));

    if (!this.isConfigured()) {
      throw new AuthConfigurationError(
        'Sign-in is temporarily unavailable. Please try again later.'
      );
    }

    const response = await fetch(
      `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${AUTH_CONFIG.endpoints.login}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email: cleanEmail,
          password,
          persistence: rememberMe ? 'persistent' : 'session',
        }),
      }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.requiresVerification) {
        this.pendingVerificationEmail = payload.email || cleanEmail;
      }
      const err = new Error(payload.message || 'Unable to log in with those credentials.');
      err.requiresVerification = Boolean(payload.requiresVerification);
      throw err;
    }

    if (!payload.user) {
      throw new Error('Authentication server returned an incomplete session response.');
    }

    this.pendingVerificationEmail = null;
    this.currentUser = this.normalizeUser(
      payload.user,
      cleanEmail,
      rememberMe ? 'persistent' : 'session'
    );
    this.notify();
    return this.currentUser;
  }

  /**
   * Registers a new campus parking account.
   * Handles both immediate authenticated sessions and email-verification-required states.
   */
  async signUp({ fullName, email, password }) {
    const cleanEmail = (email || '').trim();
    const cleanName = (fullName || '').trim();

    if (!this.isConfigured()) {
      throw new AuthConfigurationError(
        'Account registration is temporarily unavailable. Please try again later.'
      );
    }

    const response = await fetch(
      `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${AUTH_CONFIG.endpoints.signUp}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          fullName: cleanName,
          email: cleanEmail,
          password,
        }),
      }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to create your account at this time.');
    }

    if (payload.requiresVerification) {
      this.pendingVerificationEmail = payload.email || cleanEmail;
      return {
        requiresVerification: true,
        email: payload.email || cleanEmail,
        message:
          payload.message ||
          'Please verify your email address before accessing protected campus parking features.',
      };
    }

    if (!payload.user) {
      throw new Error('Account registration succeeded, but no user session was returned.');
    }

    this.pendingVerificationEmail = null;
    this.currentUser = this.normalizeUser(payload.user, cleanEmail, 'session');
    this.notify();
    return {
      requiresVerification: false,
      user: this.currentUser,
    };
  }

  /**
   * Updates the authenticated user's profile details (display name, campus affiliation, and profile picture).
   */
  async updateProfile({ fullName, campusAffiliation, avatarDataUrl, removeAvatar }) {
    if (!this.currentUser) {
      throw new Error('Please log in to update your profile.');
    }

    const cleanName = (fullName || '').trim();
    if (!cleanName) {
      throw new Error('Display name cannot be empty.');
    }

    const requestBody = { fullName: cleanName };
    if (campusAffiliation !== undefined) {
      requestBody.campusAffiliation = campusAffiliation;
    }
    if (removeAvatar) {
      requestBody.removeAvatar = true;
    } else if (avatarDataUrl) {
      requestBody.avatarDataUrl = avatarDataUrl;
    }

    const profileEndpoint = AUTH_CONFIG.endpoints.profile || '/profile';
    const response = await fetch(
      `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${profileEndpoint}`,
      {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to update your profile right now.');
    }

    if (payload.user) {
      this.currentUser = this.normalizeUser(
        payload.user,
        this.currentUser.email,
        this.currentUser.persistence
      );
      this.notify();
    }
    return this.currentUser;
  }

  /**
   * Signs out the current user via the backend provider, clears account-specific client caches,
   * and returns to the public homepage. Throws if the sign-out request fails so the caller
   * can surface an honest error.
   */
  async logout() {
    if (this.isConfigured()) {
      const response = await fetch(
        `${AUTH_CONFIG.baseUrl.replace(/\/$/, '')}${AUTH_CONFIG.endpoints.logout}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Sign-out failed. Please check your connection and try again.');
      }
    }

    this.currentUser = null;
    this.intendedDestination = null;
    this.clearAccountCaches();
    this.notify();
  }
}

export const authService = new AuthService();
