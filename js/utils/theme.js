/**
 * Theme Preference Utility (js/utils/theme.js)
 *
 * Persists the viewer's Light / Dark appearance choice and applies it to <html data-theme>.
 * The same storage key is read by the inline bootstrap script in index.html / 404.html
 * so the saved theme is applied before first paint.
 */

export const THEME_STORAGE_KEY = 'parktrace-theme';
const VALID_THEMES = ['dark', 'light'];

export function getTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  if (VALID_THEMES.includes(current)) return current;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (VALID_THEMES.includes(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return 'dark';
}

export function applyTheme(theme) {
  const next = VALID_THEMES.includes(theme) ? theme : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', next === 'light' ? '#f3f6f4' : '#050a08');
  return next;
}

export function setTheme(theme) {
  const next = applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
  return next;
}
