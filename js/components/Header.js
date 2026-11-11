/**
 * Minimal Top-Right Header Component (js/components/Header.js)
 *
 * Renders only the required "Reviews" and "Support" actions in the upper-right corner,
 * keeping the left and center viewport unobstructed for the cinematic background.
 */

export class Header {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.mountNode
   * @param {Function} options.onToggleReviews
   * @param {Function} options.onOpenSupport
   */
  constructor({ mountNode, onToggleReviews, onOpenSupport, onDemoLogin }) {
    this.mountNode = mountNode;
    this.onToggleReviews = onToggleReviews;
    this.onOpenSupport = onOpenSupport;
    this.onDemoLogin = onDemoLogin;
    this.reviewsButton = null;
    this.supportButton = null;
    this.demoLoginButton = null;
  }

  render() {
    if (!this.mountNode) return;

    this.mountNode.innerHTML = `
      <nav class="top-nav" aria-label="Primary actions">
        <div class="top-nav__actions">
          <button
            type="button"
            id="header-demo-login-btn"
            class="nav-pill-btn nav-pill-btn--demo"
            data-quick-demo-login
          >
            <span class="auth-demo-btn__icon" aria-hidden="true">⚡</span>
            <span class="nav-pill-btn__label">Quick Demo Login</span>
          </button>
          <button
            type="button"
            id="nav-reviews-btn"
            class="nav-pill-btn"
            aria-expanded="false"
            aria-controls="reviews-section"
          >
            <span class="nav-pill-btn__label">Reviews</span>
          </button>
          <button
            type="button"
            id="nav-support-btn"
            class="nav-pill-btn"
            aria-haspopup="dialog"
            aria-controls="support-modal"
          >
            <span class="nav-pill-btn__label">Support</span>
          </button>
        </div>
      </nav>
    `;

    this.demoLoginButton = this.mountNode.querySelector('#header-demo-login-btn');
    this.reviewsButton = this.mountNode.querySelector('#nav-reviews-btn');
    this.supportButton = this.mountNode.querySelector('#nav-support-btn');

    this.demoLoginButton?.addEventListener('click', () => {
      this.onDemoLogin?.();
    });

    this.reviewsButton?.addEventListener('click', () => {
      this.onToggleReviews?.(this.reviewsButton);
    });

    this.supportButton?.addEventListener('click', () => {
      this.onOpenSupport?.(this.supportButton);
    });
  }

  /**
   * Updates the ARIA expanded state on the Reviews trigger button.
   */
  setReviewsExpanded(isExpanded) {
    if (!this.reviewsButton) return;
    this.reviewsButton.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    this.reviewsButton.classList.toggle('is-active', Boolean(isExpanded));
  }

  getSupportTrigger() {
    return this.supportButton;
  }
}

