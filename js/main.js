/**
 * PARKTRACE Main Application Entrypoint (js/main.js)
 *
 * Coordinates both:
 * 1. The Public Homepage:
 *    - Minimal top-right Header ("Reviews", "Support")
 *    - Official PARKTRACE logo + Editorial Lockup + Glass Authentication Panel
 *    - Support Modal (<dialog closedby="any">)
 *    - Compact, click-to-reveal Public Reviews & Likes Section
 * 2. The Authenticated Cinematic Hub:
 *    - Floating horizontal Glass Navigation Bar (Overview, Find Parking, My Vehicle, Reviews,
 *      [Staff Controls], Support, Profile, Log out)
 *    - Parking discovery, saved-vehicle retrieval, shared persistent reviews, and staff controls
 */

import { ASSET_CONFIG } from './config.js';
import { authService } from './services/authService.js';
import { initAccessibleValidation } from './utils/validation.js';
import { Header } from './components/Header.js';
import { AuthPanel } from './components/AuthPanel.js';
import { SupportModal } from './components/SupportModal.js';
import { ReviewSection } from './components/ReviewSection.js';
import { CinematicHub } from './components/CinematicHub.js';

function initApp() {
  // 1. Configure hero background image source if overridden in ASSET_CONFIG
  const heroImg = document.getElementById('hero-bg-img');
  if (heroImg && ASSET_CONFIG.heroImageUrl) {
    if (heroImg.getAttribute('src') !== ASSET_CONFIG.heroImageUrl) {
      heroImg.setAttribute('src', ASSET_CONFIG.heroImageUrl);
    }
    heroImg.setAttribute('alt', ASSET_CONFIG.heroImageAlt ?? '');
  }

  // 2. Mount Public Components & Authenticated Cinematic Hub
  const heroStage = document.querySelector('.hero-stage');
  const headerMount = document.getElementById('header-mount');
  const authMount = document.getElementById('auth-panel-mount');
  const supportMount = document.getElementById('support-modal-mount');
  const reviewsMount = document.getElementById('reviews-section');
  const hubMount = document.getElementById('authenticated-hub-mount');
  const skipLink = document.querySelector('.skip-link');
  const robotsMeta = document.querySelector('meta[name="robots"]');

  let headerComponent = null;
  let authComponent = null;
  let supportComponent = null;
  let reviewsComponent = null;
  let hubComponent = null;

  headerComponent = new Header({
    mountNode: headerMount,
    onToggleReviews: () => {
      const isNowOpen = reviewsComponent?.toggle();
      headerComponent?.setReviewsExpanded(isNowOpen);
    },
    onOpenSupport: (triggerBtn) => {
      supportComponent?.open(triggerBtn);
    },
  });

  supportComponent = new SupportModal({
    mountNode: supportMount,
    getReturnFocusElement: () => headerComponent?.getSupportTrigger(),
  });

  authComponent = new AuthPanel({
    mountNode: authMount,
    onOpenReviews: () => {
      if (!reviewsComponent?.isOpen) {
        reviewsComponent?.open();
        headerComponent?.setReviewsExpanded(true);
      } else {
        reviewsMount?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },
  });

  reviewsComponent = new ReviewSection({
    mountNode: reviewsMount,
    mode: 'public',
    onCloseReviews: () => {
      headerComponent?.setReviewsExpanded(false);
    },
    onRequestLoginFocus: () => {
      authService.setIntendedDestination('reviews');
      reviewsComponent?.close();
      headerComponent?.setReviewsExpanded(false);
      authComponent?.focusLoginPanel('Log in or sign up to post or like a review.');
    },
  });

  hubComponent = new CinematicHub({
    mountNode: hubMount,
    onOpenSupport: (triggerBtn) => {
      supportComponent?.open(triggerBtn);
    },
    onSignedOut: () => {
      syncInterfaceMode(null);
      try {
        window.history.replaceState({ parktraceAuth: false }, '', window.location.pathname);
      } catch {
        // Ignore history state errors
      }
    },
  });

  headerComponent.render();
  supportComponent.render();
  authComponent.init();
  reviewsComponent.init();
  hubComponent.init();

  function syncInterfaceMode(session) {
    if (session) {
      // Transition to Authenticated Cinematic Hub
      if (reviewsComponent?.isOpen) {
        reviewsComponent.close();
        headerComponent?.setReviewsExpanded(false);
      }
      if (heroStage) {
        heroStage.hidden = true;
      }
      if (reviewsMount) {
        reviewsMount.hidden = true;
      }
      if (skipLink) {
        skipLink.setAttribute('href', '#hub-main-content');
      }
      if (robotsMeta) {
        robotsMeta.setAttribute('content', 'noindex, nofollow');
      }

      const targetView = authService.consumeIntendedDestination() || hubComponent.activeView || 'overview';
      hubComponent.activate(targetView);

      try {
        window.history.replaceState({ parktraceAuth: true, view: targetView }, '', window.location.pathname);
      } catch {
        // Ignore history state errors
      }
    } else {
      // Transition to Public Homepage
      hubComponent.deactivate();
      if (heroStage) {
        heroStage.hidden = false;
      }
      if (skipLink) {
        skipLink.setAttribute('href', '#main-content');
      }
      if (robotsMeta) {
        robotsMeta.setAttribute('content', 'index, follow');
      }
      document.title = 'PARKTRACE | Campus Vehicle Parking & Retrieval';
    }
  }

  // Subscribe to auth state transitions
  authService.subscribe((session) => {
    syncInterfaceMode(session);
  });

  // Prevent browser Back/Forward or bfcache from displaying protected views after logout
  window.addEventListener('popstate', () => {
    if (!authService.isAuthenticated()) {
      syncInterfaceMode(null);
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      authService.restoreSession();
    }
  });

  // 3. Initialize accessible post-interaction validation
  initAccessibleValidation(document);

  // 4. Restore server session if an authentication backend is configured
  authService.restoreSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
