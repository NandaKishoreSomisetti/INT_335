/**
 * Supabase Client Initialization Module (js/services/supabaseClient.js)
 *
 * Initializes and exports the `@supabase/supabase-js` client using:
 * - `NEXT_PUBLIC_SUPABASE_URL`
 * - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 *
 * Supports both browser execution (via `/vendor/supabase.js` UMD/ESM bridge or
 * `window.supabase`) and Node.js execution (`@supabase/supabase-js`), with an
 * adaptive storage adapter that honors the user's "Remember me" session preference.
 */

import { SUPABASE_CONFIG, STORAGE_KEYS } from '../config.js';

let supabaseInstance = null;
let createClientFn = null;

/**
 * Adaptive storage adapter for Supabase Auth in the browser.
 * Routes session tokens to `localStorage` when "Remember me" is enabled (default)
 * or `sessionStorage` when "Remember me" is unchecked, while never storing raw passwords.
 */
const adaptiveBrowserStorage = {
  getItem(key) {
    if (typeof window === 'undefined') return null;
    try {
      const fromSession = window.sessionStorage?.getItem(key);
      if (fromSession !== null && fromSession !== undefined) {
        return fromSession;
      }
      return window.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },

  setItem(key, value) {
    if (typeof window === 'undefined') return;
    try {
      const rememberPref = window.localStorage?.getItem(STORAGE_KEYS.rememberMeEnabled);
      const usePersistent = rememberPref !== 'false';
      if (usePersistent) {
        window.localStorage?.setItem(key, value);
        window.sessionStorage?.removeItem(key);
      } else {
        window.sessionStorage?.setItem(key, value);
        window.localStorage?.removeItem(key);
      }
    } catch {
      // Ignore storage quota errors
    }
  },

  removeItem(key) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage?.removeItem(key);
      window.sessionStorage?.removeItem(key);
    } catch {
      // Ignore storage errors
    }
  },
};

/**
 * Resolves `createClient` from `@supabase/supabase-js` across Browser and Node environments.
 */
async function resolveCreateClient() {
  if (createClientFn) return createClientFn;

  if (typeof window !== 'undefined' && window.supabase?.createClient) {
    createClientFn = window.supabase.createClient;
    return createClientFn;
  }

  if (typeof window !== 'undefined') {
    try {
      const mod = await import('/vendor/supabase.js');
      createClientFn = mod.createClient || window.supabase?.createClient;
      if (createClientFn) return createClientFn;
    } catch {
      try {
        const cdnMod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        createClientFn = cdnMod.createClient;
        if (createClientFn) return createClientFn;
      } catch {
        // Fallback to bare specifier
      }
    }
  }

  const pkgName = '@supabase/supabase-js';
  const nodeMod = await import(pkgName);
  createClientFn = nodeMod.createClient;
  return createClientFn;
}

/**
 * Returns the configured singleton Supabase client instance.
 */
export async function getSupabaseClient() {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = (SUPABASE_CONFIG.url || '').trim();
  const supabaseAnonKey = (SUPABASE_CONFIG.anonKey || '').trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const createClient = await resolveCreateClient();
  const isBrowser = typeof window !== 'undefined';

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: STORAGE_KEYS.supabaseAuthToken,
      storage: isBrowser ? adaptiveBrowserStorage : undefined,
      persistSession: isBrowser,
      autoRefreshToken: isBrowser,
      detectSessionInUrl: isBrowser,
    },
  });

  return supabaseInstance;
}

export { SUPABASE_CONFIG };

