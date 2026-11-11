/**
 * Glass Authentication Panel Component (js/components/AuthPanel.js)
 *
 * Implements the translucent dark-glass authentication card with:
 * - Two accessible tabs: "Log in" and "Sign up"
 * - Semantic autofill attributes (`autocomplete="username"`, `id="current-password"`,
 *   `id="new-password"`, `autocomplete="new-password"`)
 * - Show/hide password toggles without blocking paste or password managers
 * - Device-level "Remember me" email persistence (never storing raw passwords)
 * - Post-interaction validation, email verification state handling, and user-friendly status feedback
 */

import { authService } from '../services/authService.js?v=sb3';
import { validateFormOnSubmit, validateControlConstraints } from '../utils/validation.js?v=sb3';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class AuthPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.mountNode
   * @param {Function} [options.onOpenReviews]
   */
  constructor({ mountNode, onOpenReviews }) {
    this.mountNode = mountNode;
    this.onOpenReviews = onOpenReviews;
    this.activeTab = 'login'; // 'login' | 'signup'
    this.isSubmitting = false;
    this.statusBanner = null; // { type: 'error' | 'config' | 'info', title: string, message: string }
    this.verificationPending = null; // { email: string, message: string }
    this.unsubscribeAuth = null;
  }

  init() {
    this.render();
    this.unsubscribeAuth = authService.subscribe(() => {
      this.render();
    });
  }

  render() {
    if (!this.mountNode) return;

    if (this.verificationPending) {
      this.renderVerificationState(this.verificationPending);
      return;
    }

    const rememberedEmail = authService.getRememberedEmail();
    const rememberChecked = authService.getRememberMePreference();

    this.mountNode.innerHTML = `
      <div class="glass-panel auth-card" role="region" aria-label="Account authentication">
        <div class="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            id="tab-login"
            class="auth-tab ${this.activeTab === 'login' ? 'is-active' : ''}"
            aria-selected="${this.activeTab === 'login' ? 'true' : 'false'}"
            aria-controls="panel-login"
            tabindex="${this.activeTab === 'login' ? '0' : '-1'}"
            data-tab="login"
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            id="tab-signup"
            class="auth-tab ${this.activeTab === 'signup' ? 'is-active' : ''}"
            aria-selected="${this.activeTab === 'signup' ? 'true' : 'false'}"
            aria-controls="panel-signup"
            tabindex="${this.activeTab === 'signup' ? '0' : '-1'}"
            data-tab="signup"
          >
            Sign up
          </button>
        </div>

        <div id="auth-status-slot" aria-live="polite">
          ${this.renderStatusBanner()}
        </div>

        <!-- LOG IN PANEL -->
        <div
          id="panel-login"
          class="auth-tabpanel"
          role="tabpanel"
          aria-labelledby="tab-login"
          ${this.activeTab === 'login' ? '' : 'hidden'}
        >
          <form id="login-form" class="auth-form" method="post" action="#login" novalidate>
            <div class="form-field">
              <label for="login-email" class="form-label">Email address</label>
              <input
                type="email"
                id="login-email"
                name="email"
                class="form-input"
                autocomplete="username"
                inputmode="email"
                enterkeyhint="next"
                required
                value="${escapeHtml(rememberedEmail)}"
                placeholder="you@gmail.com"
                aria-errormessage="login-email-error"
              />
              <div id="login-email-error" class="field-error" role="alert">
                <span aria-hidden="true" class="field-error__icon">!</span>
                <span class="error-text">Please enter a valid email address.</span>
              </div>
            </div>

            <div class="form-field">
              <div class="form-label-row">
                <label for="current-password" class="form-label">Password</label>
              </div>
              <div class="password-input-wrapper">
                <input
                  type="password"
                  id="current-password"
                  name="password"
                  class="form-input form-input--password"
                  autocomplete="current-password"
                  enterkeyhint="done"
                  required
                  placeholder="Enter your password"
                  aria-errormessage="login-password-error"
                />
                <button
                  type="button"
                  class="password-toggle"
                  data-toggle-password="current-password"
                  aria-label="Show password"
                  aria-pressed="false"
                >
                  <span class="password-toggle__text">Show</span>
                </button>
              </div>
              <div id="login-password-error" class="field-error" role="alert">
                <span aria-hidden="true" class="field-error__icon">!</span>
                <span class="error-text">Please enter your password.</span>
              </div>
            </div>

            <div class="form-row-options">
              <label for="remember-me" class="checkbox-control">
                <input
                  type="checkbox"
                  id="remember-me"
                  name="rememberMe"
                  class="visually-hidden"
                  ${rememberChecked ? 'checked' : ''}
                />
                <span class="checkbox-control__text">Remember me</span>
              </label>
            </div>

            <button
              type="submit"
              id="login-submit-btn"
              class="btn-primary auth-submit-btn"
              ${this.isSubmitting ? 'disabled' : ''}
            >
              ${
                this.isSubmitting && this.activeTab === 'login'
                  ? `<progress aria-label="Logging in" class="loading-spinner"></progress><span>Verifying…</span>`
                  : `<span>Log in</span>`
              }
            </button>
          </form>
        </div>

        <!-- SIGN UP PANEL -->
        <div
          id="panel-signup"
          class="auth-tabpanel"
          role="tabpanel"
          aria-labelledby="tab-signup"
          ${this.activeTab === 'signup' ? '' : 'hidden'}
        >
          <form id="signup-form" class="auth-form" method="post" action="#signup" novalidate>
            <div class="form-field">
              <label for="signup-name" class="form-label">Full name</label>
              <input
                type="text"
                id="signup-name"
                name="fullName"
                class="form-input"
                autocomplete="name"
                enterkeyhint="next"
                required
                placeholder="Your full name"
                aria-errormessage="signup-name-error"
              />
              <div id="signup-name-error" class="field-error" role="alert">
                <span aria-hidden="true" class="field-error__icon">!</span>
                <span class="error-text">Please enter your full name.</span>
              </div>
            </div>

            <div class="form-field">
              <label for="signup-email" class="form-label">Email address</label>
              <input
                type="email"
                id="signup-email"
                name="email"
                class="form-input"
                autocomplete="email"
                inputmode="email"
                enterkeyhint="next"
                required
                placeholder="you@gmail.com"
                aria-errormessage="signup-email-error"
              />
              <div id="signup-email-error" class="field-error" role="alert">
                <span aria-hidden="true" class="field-error__icon">!</span>
                <span class="error-text">Please enter a valid email address.</span>
              </div>
            </div>

            <div class="form-grid-2col">
              <div class="form-field">
                <div class="form-label-row">
                  <label for="new-password" class="form-label">Password</label>
                  <span id="new-password-hint" class="field-hint">8+ chars</span>
                </div>
                <div class="password-input-wrapper">
                  <input
                    type="password"
                    id="new-password"
                    name="password"
                    class="form-input form-input--password"
                    autocomplete="new-password"
                    minlength="8"
                    enterkeyhint="next"
                    required
                    placeholder="8+ characters"
                    aria-describedby="new-password-hint"
                    aria-errormessage="signup-password-error"
                  />
                  <button
                    type="button"
                    class="password-toggle"
                    data-toggle-password="new-password"
                    aria-label="Show password"
                    aria-pressed="false"
                  >
                    <span class="password-toggle__text">Show</span>
                  </button>
                </div>
                <div id="signup-password-error" class="field-error" role="alert">
                  <span aria-hidden="true" class="field-error__icon">!</span>
                  <span class="error-text">Password must be at least 8 characters.</span>
                </div>
              </div>

              <div class="form-field">
                <div class="form-label-row">
                  <label for="confirm-password" class="form-label">Confirm password</label>
                </div>
                <div class="password-input-wrapper">
                  <input
                    type="password"
                    id="confirm-password"
                    name="confirmPassword"
                    class="form-input form-input--password"
                    autocomplete="new-password"
                    minlength="8"
                    enterkeyhint="done"
                    required
                    placeholder="Repeat password"
                    aria-errormessage="signup-confirm-error"
                  />
                  <button
                    type="button"
                    class="password-toggle"
                    data-toggle-password="confirm-password"
                    aria-label="Show confirm password"
                    aria-pressed="false"
                  >
                    <span class="password-toggle__text">Show</span>
                  </button>
                </div>
                <div id="signup-confirm-error" class="field-error" role="alert">
                  <span aria-hidden="true" class="field-error__icon">!</span>
                  <span class="error-text">Passwords must match.</span>
                </div>
              </div>
            </div>

            <button
              type="submit"
              id="signup-submit-btn"
              class="btn-primary auth-submit-btn"
              ${this.isSubmitting ? 'disabled' : ''}
            >
              ${
                this.isSubmitting && this.activeTab === 'signup'
                  ? `<progress aria-label="Creating account" class="loading-spinner"></progress><span>Creating account…</span>`
                  : `<span>Create account</span>`
              }
            </button>
          </form>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderVerificationState({ email, message }) {
    if (!this.mountNode) return;

    this.mountNode.innerHTML = `
      <div class="glass-panel auth-card auth-card--authenticated" role="region" aria-label="Email verification required">
        <div class="auth-success-badge">
          <span class="auth-success-badge__dot" aria-hidden="true"></span>
          <span>Verification required</span>
        </div>

        <h2 class="auth-success__title">Verify your email address</h2>
        <p class="auth-success__email">${escapeHtml(email)}</p>
        <p class="auth-success__meta">${escapeHtml(message)}</p>

        <div class="auth-success__actions">
          <button type="button" id="auth-back-to-login-btn" class="btn-primary">
            Return to Log in
          </button>
        </div>
      </div>
    `;

    this.mountNode.querySelector('#auth-back-to-login-btn')?.addEventListener('click', () => {
      this.verificationPending = null;
      this.activeTab = 'login';
      this.render();
    });
  }

  renderStatusBanner() {
    if (!this.statusBanner) return '';

    const { type, title, message } = this.statusBanner;
    return `
      <div class="status-banner status-banner--${escapeHtml(type)}" role="alert">
        <div class="status-banner__content">
          <strong class="status-banner__title">${escapeHtml(title)}</strong>
          <p class="status-banner__message">${escapeHtml(message)}</p>
        </div>
      </div>
    `;
  }

  updateStatusSlot() {
    const slot = this.mountNode?.querySelector('#auth-status-slot');
    if (slot) {
      slot.innerHTML = this.renderStatusBanner();
    }
  }

  bindEvents() {
    if (!this.mountNode) return;

    const tabs = Array.from(this.mountNode.querySelectorAll('[role="tab"]'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        if (targetTab && targetTab !== this.activeTab) {
          this.switchTab(targetTab);
        }
      });

      tab.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const nextTab = this.activeTab === 'login' ? 'signup' : 'login';
          this.switchTab(nextTab, true);
        }
      });
    });

    const toggleButtons = this.mountNode.querySelectorAll('[data-toggle-password]');
    toggleButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const inputId = btn.getAttribute('data-toggle-password');
        const input = this.mountNode.querySelector(`#${inputId}`);
        if (!input) return;

        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        btn.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
        btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
        const textNode = btn.querySelector('.password-toggle__text');
        if (textNode) {
          textNode.textContent = isHidden ? 'Hide' : 'Show';
        }
      });
    });

    const rememberCheckbox = this.mountNode.querySelector('#remember-me');
    const loginEmailInput = this.mountNode.querySelector('#login-email');
    rememberCheckbox?.addEventListener('change', () => {
      if (!rememberCheckbox.checked) {
        authService.applyRememberMePolicy('', false);
      } else if (loginEmailInput?.value.trim()) {
        authService.applyRememberMePolicy(loginEmailInput.value.trim(), true);
      }
    });

    // Log in submission
    const loginForm = this.mountNode.querySelector('#login-form');
    loginForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (this.isSubmitting) return;

      this.statusBanner = null;
      this.updateStatusSlot();

      if (!validateFormOnSubmit(loginForm)) {
        return;
      }

      const email = loginForm.querySelector('#login-email')?.value || '';
      const password = loginForm.querySelector('#current-password')?.value || '';
      const rememberMe = Boolean(loginForm.querySelector('#remember-me')?.checked);

      this.setSubmittingState(true, 'login');

      try {
        await authService.login({ email, password, rememberMe });
      } catch (error) {
        console.error('Auth error details:', error);
        this.statusBanner = {
          type: error?.isConfigurationMissing ? 'config' : 'error',
          title: 'Log in failed',
          message: error?.message || String(error),
        };
        this.updateStatusSlot();
      } finally {
        this.setSubmittingState(false, 'login');
      }
    });

    // Sign up submission
    const signupForm = this.mountNode.querySelector('#signup-form');
    signupForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (this.isSubmitting) return;

      this.statusBanner = null;
      this.updateStatusSlot();

      const confirmInput = signupForm.querySelector('#confirm-password');
      if (confirmInput) {
        validateControlConstraints(confirmInput);
      }

      if (!validateFormOnSubmit(signupForm)) {
        return;
      }

      const fullName = signupForm.querySelector('#signup-name')?.value || '';
      const email = signupForm.querySelector('#signup-email')?.value || '';
      const password = signupForm.querySelector('#new-password')?.value || '';

      this.setSubmittingState(true, 'signup');

      try {
        await authService.signUp({ fullName, email, password });
      } catch (error) {
        console.error('Auth error details:', error);
        this.statusBanner = {
          type: error?.isConfigurationMissing ? 'config' : 'error',
          title: 'Sign up failed',
          message: error?.message || String(error),
        };
        this.updateStatusSlot();
      } finally {
        this.setSubmittingState(false, 'signup');
      }
    });
  }

  setSubmittingState(isSubmitting, mode) {
    this.isSubmitting = isSubmitting;
    const btnId = mode === 'login' ? '#login-submit-btn' : '#signup-submit-btn';
    const btn = this.mountNode?.querySelector(btnId);
    if (!btn) return;

    btn.disabled = isSubmitting;
    if (isSubmitting) {
      btn.innerHTML =
        mode === 'login'
          ? `<progress aria-label="Logging in" class="loading-spinner"></progress><span>Verifying…</span>`
          : `<progress aria-label="Creating account" class="loading-spinner"></progress><span>Creating account…</span>`;
    } else {
      btn.innerHTML = mode === 'login' ? `<span>Log in</span>` : `<span>Create account</span>`;
    }
  }

  switchTab(tabName, focusTabButton = false) {
    if (tabName !== 'login' && tabName !== 'signup') return;
    this.activeTab = tabName;
    this.statusBanner = null;
    this.updateStatusSlot();

    const loginTab = this.mountNode?.querySelector('#tab-login');
    const signupTab = this.mountNode?.querySelector('#tab-signup');
    const loginPanel = this.mountNode?.querySelector('#panel-login');
    const signupPanel = this.mountNode?.querySelector('#panel-signup');

    const isLogin = tabName === 'login';

    loginTab?.classList.toggle('is-active', isLogin);
    loginTab?.setAttribute('aria-selected', isLogin ? 'true' : 'false');
    loginTab?.setAttribute('tabindex', isLogin ? '0' : '-1');

    signupTab?.classList.toggle('is-active', !isLogin);
    signupTab?.setAttribute('aria-selected', !isLogin ? 'true' : 'false');
    signupTab?.setAttribute('tabindex', !isLogin ? '0' : '-1');

    if (loginPanel) loginPanel.hidden = !isLogin;
    if (signupPanel) signupPanel.hidden = isLogin;

    if (focusTabButton) {
      (isLogin ? loginTab : signupTab)?.focus();
    }
  }

  /**
   * Focuses the Log in email or password field (called when clicking "Log in to write a review").
   */
  focusLoginPanel(promptMessage = '') {
    if (authService.currentUser) return;
    this.switchTab('login');
    if (promptMessage) {
      this.statusBanner = {
        type: 'info',
        title: 'Sign in to continue',
        message: promptMessage,
      };
      this.updateStatusSlot();
    }
    const emailInput = this.mountNode?.querySelector('#login-email');
    const passwordInput = this.mountNode?.querySelector('#current-password');
    if (emailInput && emailInput.value.trim().length > 0 && passwordInput) {
      passwordInput.focus();
    } else {
      emailInput?.focus();
    }
  }
}
