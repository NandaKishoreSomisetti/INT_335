/**
 * Shared Reviews & Likes Section Component (js/components/ReviewSection.js)
 *
 * Supports two display contexts backed by the exact same persistent backend (`reviewService`):
 * 1. `mode: 'public'` — Remains collapsed (`hidden`) on the public homepage until
 *    the user clicks "Reviews" in the header; reveals, revalidates, and scrolls into view.
 * 2. `mode: 'hub'` — Displayed inside the authenticated Cinematic Hub Reviews page.
 *
 * Features:
 * - Form heading: "Share your parking experience"
 * - One review per account: author can create, edit, or delete their review
 * - One like per account per review, sorted by likes descending then newest first
 * - Optimistic like updates with automatic rollback on failure
 * - Distinct Loading, Empty ("No reviews yet"), and Unavailable (with Retry) states
 */

import { REVIEWS_CONFIG } from '../config.js?v=sb5';
import { authService } from '../services/authService.js?v=sb5';
import { reviewService, sortReviews } from '../services/reviewService.js?v=sb5';
import { ReviewCard } from './ReviewCard.js?v=sb5';
import { validateFormOnSubmit } from '../utils/validation.js?v=sb5';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class ReviewSection {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.mountNode
   * @param {'public' | 'hub'} [options.mode='public']
   * @param {string} [options.idPrefix='public']
   * @param {Function} [options.onCloseReviews]
   * @param {Function} [options.onRequestLoginFocus]
   */
  constructor({
    mountNode,
    mode = 'public',
    idPrefix = mode === 'hub' ? 'hub' : 'public',
    onCloseReviews,
    onRequestLoginFocus,
  }) {
    this.mountNode = mountNode;
    this.mode = mode;
    this.idPrefix = idPrefix;
    this.onCloseReviews = onCloseReviews;
    this.onRequestLoginFocus = onRequestLoginFocus;

    this.isOpen = mode === 'hub';
    this.isLoading = false;
    this.isSubmitting = false;
    this.isDeleting = false;
    this.isEditingOwn = false;
    this.editDraftText = '';
    this.backendAvailable = false;
    this.reviews = [];
    this.visibleCount = REVIEWS_CONFIG.pageSize || 6;
    this.pendingLikes = new Set();
    this.feedbackBanner = null; // { type: 'error' | 'config' | 'info' | 'success', message: string }
  }

  init() {
    this.render();
    authService.subscribe(() => {
      if (this.isOpen) {
        this.refreshReviews({ silent: true });
      }
    });
    reviewService.subscribe((updatedReviews) => {
      this.reviews = sortReviews(updatedReviews);
      if (this.isOpen && !this.isLoading) {
        this.render();
      }
    });
  }

  async refreshReviews({ silent = false } = {}) {
    if (!this.mountNode) return;
    if (!silent) {
      this.isLoading = true;
      this.feedbackBanner = null;
      this.render();
    }

    try {
      const { reviews, available } = await reviewService.fetchReviews(authService.currentUser);
      this.backendAvailable = Boolean(available);
      this.reviews = sortReviews(reviews);
    } catch {
      this.backendAvailable = false;
      this.reviews = [];
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  async open() {
    if (!this.mountNode) return;
    this.isOpen = true;
    this.mountNode.hidden = false;
    this.isLoading = true;
    this.feedbackBanner = null;
    this.render();

    if (this.mode === 'public') {
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      requestAnimationFrame(() => {
        this.mountNode.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'nearest',
        });
      });
    }

    await this.refreshReviews({ silent: true });
  }

  close() {
    if (!this.mountNode || this.mode === 'hub') return;
    this.isOpen = false;
    this.feedbackBanner = null;
    this.isEditingOwn = false;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });

    this.mountNode.hidden = true;
    this.onCloseReviews?.();
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
    return this.isOpen;
  }

  findUserOwnReview(user) {
    if (!user) return null;
    return (
      this.reviews.find(
        (r) => r.isOwnReview || (r.authorId && String(r.authorId) === String(user.id))
      ) || null
    );
  }

  render() {
    if (!this.mountNode) return;
    if (this.mode === 'public') {
      this.mountNode.hidden = !this.isOpen;
      if (!this.isOpen) return;
    }

    const pfx = this.idPrefix;
    const user = authService.currentUser;
    const sorted = sortReviews(this.reviews);
    const visibleReviews = sorted.slice(0, this.visibleCount);
    const hasMore = sorted.length > this.visibleCount;
    const ownReview = this.findUserOwnReview(user);

    let composerMarkup = '';
    if (!user) {
      composerMarkup = `
        <div class="glass-panel review-auth-prompt">
          <div class="review-auth-prompt__copy">
            <h3 class="review-auth-prompt__title">Share your parking experience</h3>
            <p class="review-auth-prompt__sub">
              Log in to write a review or like existing feedback on bike, car, and campus vehicle parking.
            </p>
          </div>
          <button type="button" id="${pfx}-login-to-review-btn" class="btn-secondary btn-compact">
            Log in to write a review
          </button>
        </div>
      `;
    } else if (ownReview && !this.isEditingOwn) {
      composerMarkup = `
        <div class="glass-panel review-own-summary">
          <div class="review-own-summary__header">
            <div>
              <h3 class="review-composer__heading">Share your parking experience</h3>
              <p class="review-own-summary__meta">
                Published as <strong>${escapeHtml(user.fullName || 'Campus Member')}</strong> · One review per account
              </p>
            </div>
            <div class="review-own-summary__actions">
              <button
                type="button"
                id="${pfx}-edit-own-review-btn"
                class="btn-secondary btn-compact"
                ${this.isDeleting ? 'disabled' : ''}
              >
                Edit review
              </button>
              <button
                type="button"
                id="${pfx}-delete-own-review-btn"
                class="btn-ghost-pill btn-ghost-pill--danger"
                ${this.isDeleting ? 'disabled' : ''}
              >
                ${this.isDeleting ? 'Deleting…' : 'Delete review'}
              </button>
            </div>
          </div>
          <p class="review-own-summary__text">${escapeHtml(ownReview.text)}</p>
        </div>
      `;
    } else {
      const isEditing = Boolean(ownReview && this.isEditingOwn);
      const initialText = isEditing ? this.editDraftText || ownReview.text : '';
      composerMarkup = `
        <form id="${pfx}-review-submit-form" class="glass-panel review-composer" novalidate>
          <div class="review-composer__header">
            <div>
              <h3 class="review-composer__heading">Share your parking experience</h3>
              <label for="${pfx}-review-text-input" class="form-label">
                ${
                  isEditing
                    ? `Update your published review as <strong>${escapeHtml(user.fullName || 'Campus Member')}</strong>`
                    : `Posting publicly as <strong>${escapeHtml(user.fullName || 'Campus Member')}</strong>`
                }
              </label>
            </div>
            <span id="${pfx}-review-text-hint" class="field-hint">Max 400 characters · Email and phone are never shown</span>
          </div>
          <div class="review-composer__body">
            <textarea
              id="${pfx}-review-text-input"
              name="reviewText"
              class="form-input form-textarea"
              rows="3"
              maxlength="400"
              required
              placeholder="Which parking section did you use, and how was finding or retrieving your bike, car, or other vehicle?"
              aria-describedby="${pfx}-review-text-hint"
              aria-errormessage="${pfx}-review-text-error"
            >${escapeHtml(initialText)}</textarea>
            <div id="${pfx}-review-text-error" class="field-error" role="alert">
              <span aria-hidden="true" class="field-error__icon">!</span>
              <span class="error-text">Please write your review before submitting (up to 400 characters).</span>
            </div>
          </div>
          <div class="review-composer__footer">
            ${
              isEditing
                ? `
                  <button
                    type="button"
                    id="${pfx}-cancel-edit-review-btn"
                    class="btn-secondary btn-compact"
                    ${this.isSubmitting ? 'disabled' : ''}
                  >
                    Cancel
                  </button>
                `
                : ''
            }
            <button
              type="submit"
              id="${pfx}-review-submit-btn"
              class="btn-primary btn-compact"
              ${this.isSubmitting ? 'disabled' : ''}
            >
              ${
                this.isSubmitting
                  ? `<progress aria-label="Saving review" class="loading-spinner"></progress><span>Saving…</span>`
                  : `<span>${isEditing ? 'Save changes' : 'Post review'}</span>`
              }
            </button>
          </div>
        </form>
      `;
    }

    let listContentMarkup = '';
    if (this.isLoading) {
      listContentMarkup = `
        <div class="glass-panel reviews-empty-state" role="status" aria-live="polite">
          <progress aria-label="Loading reviews" class="loading-spinner"></progress>
          <p class="reviews-empty-state__text">Loading campus parking reviews…</p>
        </div>
      `;
    } else if (!this.backendAvailable) {
      listContentMarkup = `
        <div class="glass-panel reviews-empty-state" role="status" aria-live="polite">
          <p class="reviews-empty-state__text">
            Reviews are temporarily unavailable.
          </p>
          <button type="button" id="${pfx}-reviews-retry-btn" class="btn-secondary btn-compact">
            Retry
          </button>
        </div>
      `;
    } else if (visibleReviews.length === 0) {
      listContentMarkup = `
        <div class="glass-panel reviews-empty-state" role="status" aria-live="polite">
          <p class="reviews-empty-state__text">
            No reviews yet. Be the first to share your parking experience.
          </p>
        </div>
      `;
    } else {
      const cardsHtml = visibleReviews
        .map((review) =>
          new ReviewCard(review).renderMarkup({
            isAuthenticated: Boolean(user),
            isPending: this.pendingLikes.has(review.id),
            currentUserId: user?.id || null,
          })
        )
        .join('');

      listContentMarkup = `
        <div class="reviews-grid" role="feed" aria-label="Submitted campus parking reviews">
          ${cardsHtml}
        </div>
        ${
          hasMore
            ? `
              <div class="reviews-pagination">
                <button type="button" id="${pfx}-reviews-load-more-btn" class="btn-secondary btn-compact">
                  Load more reviews (${sorted.length - this.visibleCount} remaining)
                </button>
              </div>
            `
            : ''
        }
      `;
    }

    const headerActions =
      this.mode === 'public'
        ? `
          <button
            type="button"
            id="close-reviews-btn"
            class="btn-ghost-pill"
            aria-label="Back to top and close reviews"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m18 15-6-6-6 6"></path>
            </svg>
            <span>Back to top / Close reviews</span>
          </button>
        `
        : `
          <button
            type="button"
            id="${pfx}-refresh-reviews-btn"
            class="btn-ghost-pill"
            aria-label="Refresh campus parking reviews"
          >
            <span>Refresh feed</span>
          </button>
        `;

    const titleId = this.mode === 'public' ? 'reviews-section-title' : `${pfx}-reviews-title`;

    this.mountNode.innerHTML = `
      <div class="reviews-container">
        <div class="reviews-header">
          <div>
            <p class="reviews-header__eyebrow">Community Feedback · Sorted by Most Liked</p>
            <h2 id="${titleId}" class="reviews-header__title">Campus Parking Reviews</h2>
          </div>
          ${headerActions}
        </div>

        <div id="${pfx}-reviews-feedback-slot" aria-live="polite">
          ${
            this.feedbackBanner
              ? `
                <div class="status-banner status-banner--${escapeHtml(this.feedbackBanner.type)}" role="alert">
                  <div class="status-banner__content">
                    <p class="status-banner__message">${escapeHtml(this.feedbackBanner.message)}</p>
                  </div>
                </div>
              `
              : ''
          }
        </div>

        ${composerMarkup}

        ${listContentMarkup}
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    if (!this.mountNode) return;
    const pfx = this.idPrefix;

    // Close / Back to top button (public mode)
    this.mountNode.querySelector('#close-reviews-btn')?.addEventListener('click', () => {
      this.close();
    });

    // Refresh button (hub mode)
    this.mountNode.querySelector(`#${pfx}-refresh-reviews-btn`)?.addEventListener('click', () => {
      this.refreshReviews();
    });

    // Retry button on fetch failure
    this.mountNode.querySelector(`#${pfx}-reviews-retry-btn`)?.addEventListener('click', () => {
      this.refreshReviews();
    });

    // Signed-out "Log in to write a review" button
    this.mountNode.querySelector(`#${pfx}-login-to-review-btn`)?.addEventListener('click', () => {
      authService.setIntendedDestination('reviews');
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      window.scrollTo({
        top: 0,
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
      this.onRequestLoginFocus?.();
    });

    // Load more pagination button
    this.mountNode.querySelector(`#${pfx}-reviews-load-more-btn`)?.addEventListener('click', () => {
      this.visibleCount += REVIEWS_CONFIG.pageSize || 6;
      this.render();
    });

    // Start editing own review (from summary banner or card button)
    const startEditing = () => {
      const own = this.findUserOwnReview(authService.currentUser);
      if (!own) return;
      this.isEditingOwn = true;
      this.editDraftText = own.text;
      this.feedbackBanner = null;
      this.render();
      this.mountNode.querySelector(`#${pfx}-review-text-input`)?.focus();
    };

    this.mountNode.querySelector(`#${pfx}-edit-own-review-btn`)?.addEventListener('click', startEditing);
    this.mountNode.querySelectorAll('[data-edit-review]').forEach((btn) => {
      btn.addEventListener('click', startEditing);
    });

    // Cancel editing own review
    this.mountNode.querySelector(`#${pfx}-cancel-edit-review-btn`)?.addEventListener('click', () => {
      this.isEditingOwn = false;
      this.editDraftText = '';
      this.feedbackBanner = null;
      this.render();
    });

    // Delete own review (from summary banner or card button)
    const handleDeleteOwnReview = async () => {
      const user = authService.currentUser;
      const own = this.findUserOwnReview(user);
      if (!own || this.isDeleting) return;

      this.isDeleting = true;
      this.feedbackBanner = null;
      this.render();

      try {
        await reviewService.deleteReview({ reviewId: own.id, user });
        this.isDeleting = false;
        this.isEditingOwn = false;
        this.editDraftText = '';
        this.feedbackBanner = {
          type: 'info',
          message: 'Your review has been deleted.',
        };
        this.render();
      } catch (err) {
        this.isDeleting = false;
        this.feedbackBanner = {
          type: 'error',
          message: err?.message || 'Unable to delete your review right now.',
        };
        this.render();
      }
    };

    this.mountNode
      .querySelector(`#${pfx}-delete-own-review-btn`)
      ?.addEventListener('click', handleDeleteOwnReview);
    this.mountNode.querySelectorAll('[data-delete-review]').forEach((btn) => {
      btn.addEventListener('click', handleDeleteOwnReview);
    });

    // Review create / update submission form
    const reviewForm = this.mountNode.querySelector(`#${pfx}-review-submit-form`);
    reviewForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (this.isSubmitting) return;

      this.feedbackBanner = null;
      if (!validateFormOnSubmit(reviewForm)) {
        return;
      }

      const textarea = reviewForm.querySelector(`#${pfx}-review-text-input`);
      const text = textarea?.value || '';
      const user = authService.currentUser;
      const own = this.findUserOwnReview(user);
      const isEditing = Boolean(own && this.isEditingOwn);

      this.isSubmitting = true;
      this.editDraftText = text;
      this.render();

      try {
        if (isEditing) {
          await reviewService.updateReview({
            reviewId: own.id,
            text,
            user,
          });
        } else {
          await reviewService.createReview({
            text,
            user,
          });
        }
        this.backendAvailable = true;
        this.isSubmitting = false;
        this.isEditingOwn = false;
        this.editDraftText = '';
        this.feedbackBanner = {
          type: 'info',
          message: isEditing
            ? 'Your review has been updated.'
            : 'Thank you! Your parking review is now published.',
        };
        this.render();
      } catch (err) {
        this.isSubmitting = false;
        this.feedbackBanner = {
          type: err?.isConfigurationMissing ? 'config' : 'error',
          message:
            err?.message || 'Reviews are temporarily unavailable. Your review could not be saved.',
        };
        this.render();
        const restoredTextarea = this.mountNode.querySelector(`#${pfx}-review-text-input`);
        if (restoredTextarea) {
          restoredTextarea.value = text;
        }
      }
    });

    // Like buttons with optimistic update and rollback on failure
    const likeButtons = this.mountNode.querySelectorAll('[data-like-review]');
    likeButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reviewId = btn.getAttribute('data-like-review');
        if (!reviewId || this.pendingLikes.has(reviewId)) return;

        const user = authService.currentUser;
        if (!user) {
          authService.setIntendedDestination('reviews');
          this.feedbackBanner = {
            type: 'info',
            message: 'Please log in to like a review. You will be returned to Reviews after signing in.',
          };
          this.render();
          this.onRequestLoginFocus?.();
          return;
        }

        const targetIndex = this.reviews.findIndex((r) => String(r.id) === String(reviewId));
        if (targetIndex === -1) return;

        const previousSnapshot = { ...this.reviews[targetIndex] };
        const nextLikedState = !previousSnapshot.likedByCurrentUser;
        const nextLikeCount = Math.max(
          0,
          (Number(previousSnapshot.likeCount) || 0) + (nextLikedState ? 1 : -1)
        );

        // Optimistic UI update
        this.pendingLikes.add(reviewId);
        this.reviews[targetIndex] = {
          ...previousSnapshot,
          likedByCurrentUser: nextLikedState,
          likeCount: nextLikeCount,
        };
        this.reviews = sortReviews(this.reviews);
        this.feedbackBanner = null;
        this.render();

        try {
          await reviewService.toggleLike({
            reviewId,
            shouldLike: nextLikedState,
            user,
          });
        } catch (err) {
          // Roll back optimistic update on failure
          const rollbackIdx = this.reviews.findIndex((r) => String(r.id) === String(reviewId));
          if (rollbackIdx !== -1) {
            this.reviews[rollbackIdx] = previousSnapshot;
            this.reviews = sortReviews(this.reviews);
          }
          this.feedbackBanner = {
            type: err?.isConfigurationMissing ? 'config' : 'error',
            message:
              err?.message || 'Unable to save your like. Your change has been reverted.',
          };
        } finally {
          this.pendingLikes.delete(reviewId);
          this.render();
        }
      });
    });
  }
}
