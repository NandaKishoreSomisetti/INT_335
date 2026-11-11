/**
 * Support Modal Component (js/components/SupportModal.js)
 *
 * Uses native <dialog closedby="any"> opened via showModal() over a dimmed,
 * softly blurred backdrop. Renders the configured support email as a working
 * `mailto:` link and keeps calling disabled for the demo customer-care number.
 */

import { SUPPORT_EMAIL, SUPPORT_PHONE } from '../config.js?v=sb3';

function isValidEmail(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isDemoPhoneNumber(value) {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  if (lower.includes('demo') || /^0+$/.test(value.replace(/\D/g, ''))) {
    return true;
  }
  return false;
}

function isValidCallablePhone(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (isDemoPhoneNumber(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 6 && /^[+\d\s().-]+$/.test(trimmed);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class SupportModal {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.mountNode
   * @param {Function} [options.getReturnFocusElement]
   */
  constructor({ mountNode, getReturnFocusElement }) {
    this.mountNode = mountNode;
    this.getReturnFocusElement = getReturnFocusElement;
    this.dialog = null;
    this.triggerElement = null;
  }

  render() {
    if (!this.mountNode) return;

    const emailVal = (SUPPORT_EMAIL || '').trim();
    const phoneVal = (SUPPORT_PHONE || '').trim();
    const hasEmail = isValidEmail(emailVal);
    const hasCallablePhone = isValidCallablePhone(phoneVal);
    const hasDemoPhone = Boolean(phoneVal && isDemoPhoneNumber(phoneVal));

    const emailMarkup = hasEmail
      ? `<a href="mailto:${escapeHtml(emailVal)}" class="support-contact__link">${escapeHtml(emailVal)}</a>`
      : `<span class="support-contact__pending" aria-live="polite">Support email coming soon</span>`;

    const cleanTelHref = hasCallablePhone ? phoneVal.replace(/[^\d+]/g, '') : '';
    let phoneMarkup = '';
    if (hasCallablePhone) {
      phoneMarkup = `<a href="tel:${escapeHtml(cleanTelHref)}" class="support-contact__link">${escapeHtml(phoneVal)}</a>`;
    } else if (hasDemoPhone) {
      phoneMarkup = `<span class="support-contact__demo-number" aria-disabled="true">${escapeHtml(phoneVal)}</span>`;
    } else {
      phoneMarkup = `<span class="support-contact__pending" aria-live="polite">Customer-care number coming soon</span>`;
    }

    this.mountNode.innerHTML = `
      <dialog
        id="support-modal"
        class="glass-modal"
        closedby="any"
        aria-labelledby="support-modal-title"
        aria-describedby="support-modal-subtitle"
      >
        <div class="glass-modal__inner">
          <div class="glass-modal__header">
            <div>
              <p class="glass-modal__eyebrow">Campus Parking Assistance</p>
              <h2 id="support-modal-title" class="glass-modal__title">We’re here to help</h2>
            </div>
            <button
              type="button"
              class="glass-modal__icon-close"
              data-close-modal
              aria-label="Close support dialog"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <p id="support-modal-subtitle" class="glass-modal__subtitle">
            Find the right campus parking section for your bike, car, or other vehicle—and easily find your way back.
          </p>

          <div class="support-contact-list" role="list">
            <div class="support-contact-card" role="listitem">
              <div class="support-contact-card__icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="20" height="16" x="2" y="4" rx="2"></rect>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                </svg>
              </div>
              <div class="support-contact-card__body">
                <span class="support-contact__label">Support-team email</span>
                ${emailMarkup}
              </div>
            </div>

            <div class="support-contact-card" role="listitem">
              <div class="support-contact-card__icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </div>
              <div class="support-contact-card__body">
                <span class="support-contact__label">Customer-care phone number</span>
                ${phoneMarkup}
              </div>
            </div>
          </div>

          <div class="glass-modal__footer">
            <button type="button" id="support-modal-close-btn" class="btn-secondary" data-close-modal>
              Close
            </button>
          </div>
        </div>
      </dialog>
    `;

    this.dialog = this.mountNode.querySelector('#support-modal');
    this.bindEvents();
  }

  bindEvents() {
    if (!this.dialog) return;

    const closeButtons = this.dialog.querySelectorAll('[data-close-modal]');
    closeButtons.forEach((btn) => {
      btn.addEventListener('click', () => this.close());
    });

    if (typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)) {
      this.dialog.addEventListener('click', (event) => {
        if (event.target !== this.dialog) return;

        const rect = this.dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;

        if (isDialogContent) return;
        this.close();
      });
    }

    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = this.getFocusableElements();
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    this.dialog.addEventListener('close', () => {
      const returnTarget = this.triggerElement || this.getReturnFocusElement?.();
      if (returnTarget && typeof returnTarget.focus === 'function') {
        returnTarget.focus();
      }
    });
  }

  getFocusableElements() {
    if (!this.dialog) return [];
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(this.dialog.querySelectorAll(selector)).filter(
      (el) => !el.hasAttribute('hidden') && el.offsetParent !== null
    );
  }

  open(triggerElement = null) {
    if (!this.dialog) return;
    this.triggerElement = triggerElement || document.activeElement;

    if (typeof this.dialog.showModal === 'function') {
      if (!this.dialog.open) {
        this.dialog.showModal();
      }
    } else {
      this.dialog.setAttribute('open', '');
    }

    const closeBtn = this.dialog.querySelector('#support-modal-close-btn');
    closeBtn?.focus();
  }

  close() {
    if (!this.dialog) return;
    if (typeof this.dialog.close === 'function' && this.dialog.open) {
      this.dialog.close();
    } else {
      this.dialog.removeAttribute('open');
      const returnTarget = this.triggerElement || this.getReturnFocusElement?.();
      returnTarget?.focus?.();
    }
  }
}
