/**
 * Car Page Transition (js/utils/pageTransition.js)
 *
 * Plays a short "drive-by" animation: a veil fades in, a car drives across the screen,
 * the page content is swapped while the car covers the middle, then the veil fades out.
 * Respects prefers-reduced-motion (swaps instantly, no animation).
 */

const TOTAL_MS = 900;
const SWAP_AT_MS = 380;

let overlayEl = null;
let swapTimer = null;
let endTimer = null;
let pendingSwap = null;

const CAR_SVG = `
  <svg class="page-car__svg" viewBox="0 0 160 64" width="160" height="64" aria-hidden="true" focusable="false">
    <path class="page-car__body" d="M8 44c0-6 4-10 10-11l18-3 18-14c4-3 9-5 14-5h28c6 0 11 2 15 6l14 13 18 3c6 1 9 5 9 10v5c0 3-2 5-5 5H13c-3 0-5-2-5-5z"/>
    <path class="page-car__glass" d="M60 18c3-2 6-3 9-3h12v15H44zM87 15h9c4 0 8 2 11 4l11 11H87z"/>
    <rect class="page-car__light" x="146" y="37" width="8" height="5" rx="2"/>
    <rect class="page-car__tail" x="7" y="38" width="6" height="5" rx="2"/>
    <g transform="translate(42 52)">
      <g class="page-car__wheel">
        <circle class="page-car__tyre" r="11"/><circle class="page-car__hub" r="4"/><path class="page-car__spoke" d="M0-9V9M-9 0H9"/>
      </g>
    </g>
    <g transform="translate(122 52)">
      <g class="page-car__wheel">
        <circle class="page-car__tyre" r="11"/><circle class="page-car__hub" r="4"/><path class="page-car__spoke" d="M0-9V9M-9 0H9"/>
      </g>
    </g>
  </svg>
`;

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function ensureOverlay() {
  if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'page-transition';
  overlayEl.setAttribute('aria-hidden', 'true');
  overlayEl.innerHTML = `
    <div class="page-transition__veil"></div>
    <div class="page-transition__road"></div>
    <div class="page-car">
      <span class="page-car__trail"></span>
      ${CAR_SVG}
    </div>
  `;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function flushPendingSwap() {
  const fn = pendingSwap;
  pendingSwap = null;
  clearTimeout(swapTimer);
  fn?.();
}

/**
 * @param {Function} [onSwap] - Called while the car covers the screen (or immediately with reduced motion).
 */
export function playCarTransition(onSwap) {
  if (prefersReducedMotion()) {
    onSwap?.();
    return;
  }

  // If a transition is already running, finish its swap first, then restart.
  flushPendingSwap();
  clearTimeout(endTimer);

  const overlay = ensureOverlay();
  overlay.classList.remove('is-playing');
  void overlay.offsetWidth; // restart CSS animations
  overlay.classList.add('is-playing');

  pendingSwap = onSwap || null;
  swapTimer = setTimeout(flushPendingSwap, SWAP_AT_MS);
  endTimer = setTimeout(() => overlay.classList.remove('is-playing'), TOTAL_MS);
}
