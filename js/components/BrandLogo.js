/**
 * Shared Official PARKTRACE Logo Component (js/components/BrandLogo.js)
 *
 * Ensures consistent rendering of the official PARKTRACE logo (`./assets/parktrace-logo.png`)
 * across the public homepage subtitle lockup, authenticated glass navigation bar,
 * and shared brand headers.
 *
 * Rules enforced:
 * - Preserves proportions, colors, transparency, and visual quality (`object-fit: contain`).
 * - Explicit `width` and `height` attributes to prevent Cumulative Layout Shift (CLS).
 * - Uses `alt=""` when adjacent to visible "PARKTRACE" or descriptive brand text,
 *   and `alt="PARKTRACE"` when rendered as the sole brand label.
 */

import { ASSET_CONFIG } from '../config.js?v=sb8';

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders the official PARKTRACE logo `<img>` element.
 *
 * @param {Object} [options]
 * @param {'kicker' | 'navbar' | 'standalone'} [options.variant='navbar']
 * @param {boolean} [options.isSoleLabel=false] - Set true when no adjacent PARKTRACE text exists
 * @param {string} [options.className=''] - Optional extra CSS class
 * @returns {string} HTML string for the logo `<img>`
 */
export function renderBrandLogo({
  variant = 'navbar',
  isSoleLabel = false,
  className = '',
} = {}) {
  const src = ASSET_CONFIG.logoUrl || './assets/parktrace-logo.png';
  const size = variant === 'kicker' ? 34 : 32;
  const altText = isSoleLabel ? 'PARKTRACE' : '';
  const variantClass =
    variant === 'kicker'
      ? 'brand-kicker__logo'
      : 'parktrace-logo-img';
  const classes = [variantClass, className].filter(Boolean).join(' ');

  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(altText)}" width="${size}" height="${size}" class="${escapeAttr(classes)}" decoding="async" />`;
}

