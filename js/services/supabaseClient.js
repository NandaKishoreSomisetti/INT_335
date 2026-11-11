/**
 * Supabase Client Initialization Module (js/services/supabaseClient.js)
 *
 * Initializes and exports `supabase` directly for GitHub Pages and browser ES modules
 * using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 */

import { SUPABASE_CONFIG, STORAGE_KEYS } from '../config.js?v=sb8';

const supabaseUrl = SUPABASE_CONFIG?.url;
const supabaseAnonKey = SUPABASE_CONFIG?.anonKey;

if (
  typeof supabaseUrl !== 'string' ||
  supabaseUrl.trim().length === 0 ||
  typeof supabaseAnonKey !== 'string' ||
  supabaseAnonKey.trim().length === 0
) {
  console.warn('Supabase URL or Anon Key is missing from environment variables');
}

/**
 * Adaptive storage adapter for Supabase Auth in the browser.
 * Routes session tokens to `localStorage` when "Remember me" is enabled (default)
 * or `sessionStorage` when "Remember me" is unchecked.
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

function initSyncSupabaseClient() {
  if (typeof window !== 'undefined' && window.__PARKTRACE_SUPABASE_CLIENT__) {
    return window.__PARKTRACE_SUPABASE_CLIENT__;
  }
  if (typeof window !== 'undefined' && window.supabase?.createClient) {
    const client = window.supabase.createClient(supabaseUrl.trim(), supabaseAnonKey.trim(), {
      auth: {
        storageKey: STORAGE_KEYS.supabaseAuthToken,
        storage: adaptiveBrowserStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    window.__PARKTRACE_SUPABASE_CLIENT__ = client;
    return client;
  }
  return null;
}

export let supabase = initSyncSupabaseClient();

/**
 * Returns the initialized Supabase client instance (resolving via ESM CDN if needed).
 */
export async function getSupabaseClient() {
  if (supabase) {
    return supabase;
  }
  if (typeof window !== 'undefined' && window.__PARKTRACE_SUPABASE_CLIENT__) {
    supabase = window.__PARKTRACE_SUPABASE_CLIENT__;
    return supabase;
  }

  if (
    typeof supabaseUrl !== 'string' ||
    supabaseUrl.trim().length === 0 ||
    typeof supabaseAnonKey !== 'string' ||
    supabaseAnonKey.trim().length === 0
  ) {
    console.warn('Supabase URL or Anon Key is missing from environment variables');
    throw new Error('Supabase URL or Anon Key is missing from environment variables');
  }

  let createClient =
    typeof window !== 'undefined' && window.supabase?.createClient
      ? window.supabase.createClient
      : null;

  if (!createClient && typeof window !== 'undefined') {
    const cdnMod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    createClient = cdnMod.createClient;
  }

  if (!createClient) {
    const pkgName = '@supabase/supabase-js';
    const nodeMod = await import(pkgName);
    createClient = nodeMod.createClient;
  }

  const isBrowser = typeof window !== 'undefined';
  supabase = createClient(supabaseUrl.trim(), supabaseAnonKey.trim(), {
    auth: {
      storageKey: STORAGE_KEYS.supabaseAuthToken,
      storage: isBrowser ? adaptiveBrowserStorage : undefined,
      persistSession: isBrowser,
      autoRefreshToken: isBrowser,
      detectSessionInUrl: isBrowser,
    },
  });

  if (isBrowser) {
    window.__PARKTRACE_SUPABASE_CLIENT__ = supabase;
  }

  return supabase;
}

export { SUPABASE_CONFIG };
