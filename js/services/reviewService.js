/**
 * Shared Persistent Reviews & Likes Service Layer (js/services/reviewService.js)
 *
 * Used by BOTH the public homepage Reviews section and the authenticated Reviews page
 * against the same persistent backend (`REVIEWS_CONFIG.baseUrl`).
 *
 * Responsibilities:
 * 1. Fetches, creates, edits, deletes, and likes reviews via `REVIEWS_CONFIG.baseUrl`.
 * 2. Enforces one review per account and author ownership on edit/delete.
 * 3. Consistently sorts reviews by `likeCount` descending, breaking ties by `createdAt`
 *    descending (newest first).
 * 4. Notifies all subscribed views so public and authenticated review feeds stay in sync.
 */

import { REVIEWS_CONFIG } from '../config.js';

export class ReviewConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReviewConfigurationError';
    this.isConfigurationMissing = true;
  }
}

/**
 * Pure comparator for sorting reviews:
 * 1. Highest `likeCount` first.
 * 2. Newest `createdAt` timestamp first when `likeCount` is equal.
 * 3. Deterministic ID comparison if timestamps are identical.
 */
export function sortReviews(reviews) {
  return [...reviews].sort((a, b) => {
    const likesA = Number(a.likeCount) || 0;
    const likesB = Number(b.likeCount) || 0;
    if (likesB !== likesA) {
      return likesB - likesA;
    }

    const timeA = Date.parse(a.createdAt) || 0;
    const timeB = Date.parse(b.createdAt) || 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }

    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

class ReviewService {
  constructor() {
    this.reviews = [];
    this.listeners = new Set();
  }

  isConfigured() {
    return Boolean(REVIEWS_CONFIG.baseUrl && REVIEWS_CONFIG.baseUrl.trim().length > 0);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.reviews);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  normalizeReview(item, currentUser = null) {
    const authorId = item.authorId ? String(item.authorId) : null;
    const currentUserId = currentUser?.id ? String(currentUser.id) : null;
    return {
      id: String(item.id),
      authorId,
      authorName: String(item.authorName || 'Campus Member'),
      text: String(item.text || ''),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || null,
      likeCount: Math.max(0, Number(item.likeCount) || 0),
      likedByCurrentUser: Boolean(item.likedByCurrentUser),
      isOwnReview:
        typeof item.isOwnReview === 'boolean'
          ? item.isOwnReview
          : Boolean(currentUserId && authorId && currentUserId === authorId),
    };
  }

  /**
   * Fetches submitted reviews from the shared persistent backend.
   * Distinguishes between an unavailable backend (`available: false`) and a confirmed
   * empty response (`available: true, reviews: []`).
   */
  async fetchReviews(currentUser = null) {
    if (!this.isConfigured()) {
      this.reviews = [];
      return {
        reviews: [],
        configured: false,
        available: false,
      };
    }

    const response = await fetch(REVIEWS_CONFIG.baseUrl.replace(/\/$/, ''), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error('Reviews are temporarily unavailable.');
    }

    const data = await response.json();
    const rawList = Array.isArray(data)
      ? data
      : Array.isArray(data.reviews)
      ? data.reviews
      : [];

    this.reviews = sortReviews(
      rawList.map((item) => this.normalizeReview(item, currentUser))
    );
    this.notify();

    return {
      reviews: this.reviews,
      configured: true,
      available: true,
    };
  }

  /**
   * Submits a new review for an authenticated user (one review per account).
   */
  async createReview({ text, user }) {
    if (!user) {
      throw new Error('Please log in to submit a review.');
    }

    const cleanText = (text || '').trim();
    if (!cleanText) {
      throw new Error('Please write your review before submitting.');
    }
    if (cleanText.length > 400) {
      throw new Error('Review text must be 400 characters or fewer.');
    }

    if (!this.isConfigured()) {
      throw new ReviewConfigurationError(
        'Reviews are temporarily unavailable. Your review could not be saved.'
      );
    }

    const response = await fetch(REVIEWS_CONFIG.baseUrl.replace(/\/$/, ''), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text: cleanText,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload.message || 'Reviews are temporarily unavailable. Please try again later.'
      );
    }

    const saved = payload.review || payload;
    const normalized = this.normalizeReview(
      {
        ...saved,
        authorId: saved.authorId || user.id,
        authorName: saved.authorName || user.fullName || 'Campus Member',
        text: saved.text || cleanText,
        isOwnReview: true,
      },
      user
    );

    this.reviews = sortReviews([
      normalized,
      ...this.reviews.filter((r) => String(r.id) !== String(normalized.id)),
    ]);
    this.notify();
    return normalized;
  }

  /**
   * Updates an existing review owned by the authenticated user.
   */
  async updateReview({ reviewId, text, user }) {
    if (!user) {
      throw new Error('Please log in to edit your review.');
    }

    const cleanText = (text || '').trim();
    if (!cleanText) {
      throw new Error('Review text cannot be empty.');
    }
    if (cleanText.length > 400) {
      throw new Error('Review text must be 400 characters or fewer.');
    }

    if (!this.isConfigured()) {
      throw new ReviewConfigurationError(
        'Reviews are temporarily unavailable. Your changes could not be saved.'
      );
    }

    const endpoint = `${REVIEWS_CONFIG.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(reviewId)}`;
    const response = await fetch(endpoint, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ text: cleanText }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to update your review right now.');
    }

    const saved = payload.review || payload;
    const normalized = this.normalizeReview(saved, user);

    this.reviews = sortReviews(
      this.reviews.map((r) => (String(r.id) === String(reviewId) ? normalized : r))
    );
    this.notify();
    return normalized;
  }

  /**
   * Deletes an existing review owned by the authenticated user.
   */
  async deleteReview({ reviewId, user }) {
    if (!user) {
      throw new Error('Please log in to delete your review.');
    }

    if (!this.isConfigured()) {
      throw new ReviewConfigurationError(
        'Reviews are temporarily unavailable. Your review could not be deleted.'
      );
    }

    const endpoint = `${REVIEWS_CONFIG.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(reviewId)}`;
    const response = await fetch(endpoint, {
      method: 'DELETE',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Unable to delete your review right now.');
    }

    this.reviews = sortReviews(
      this.reviews.filter((r) => String(r.id) !== String(reviewId))
    );
    this.notify();
    return { ok: true, id: String(reviewId) };
  }

  /**
   * Toggles the current authenticated user's like on a specific review.
   * Server enforces one unique like per authenticated user per review.
   */
  async toggleLike({ reviewId, shouldLike, user }) {
    if (!user) {
      throw new Error('Log in to like reviews.');
    }

    if (!this.isConfigured()) {
      throw new ReviewConfigurationError(
        'Reviews are temporarily unavailable. Your like could not be saved.'
      );
    }

    const endpoint = `${REVIEWS_CONFIG.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(reviewId)}/likes`;
    const response = await fetch(endpoint, {
      method: shouldLike ? 'POST' : 'DELETE',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Could not update your like right now.');
    }

    const result = {
      id: String(reviewId),
      likeCount:
        typeof payload.likeCount === 'number' ? Math.max(0, payload.likeCount) : undefined,
      likedByCurrentUser:
        typeof payload.likedByCurrentUser === 'boolean'
          ? payload.likedByCurrentUser
          : shouldLike,
    };

    const idx = this.reviews.findIndex((r) => String(r.id) === String(reviewId));
    if (idx !== -1) {
      this.reviews[idx] = {
        ...this.reviews[idx],
        likedByCurrentUser: result.likedByCurrentUser,
        likeCount:
          typeof result.likeCount === 'number'
            ? result.likeCount
            : this.reviews[idx].likeCount,
      };
      this.reviews = sortReviews(this.reviews);
      this.notify();
    }

    return result;
  }
}

export const reviewService = new ReviewService();
