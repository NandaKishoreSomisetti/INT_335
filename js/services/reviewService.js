/**
 * Shared Persistent Reviews & Likes Service Layer (js/services/reviewService.js)
 *
 * GitHub Pages & Static-Host Compatible:
 * - Operates directly in the browser without calling `/api/reviews` POST/PUT/DELETE
 *   endpoints that return 405 Method Not Allowed on GitHub Pages.
 */

const REVIEWS_STORAGE_KEY = 'parktrace.reviews.v1';

export class ReviewConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReviewConfigurationError';
    this.isConfigurationMissing = true;
  }
}

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

function readStoredReviews() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(REVIEWS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeStoredReviews(list) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage quota errors
  }
}

class ReviewService {
  constructor() {
    this.reviews = [];
    this.listeners = new Set();
  }

  isConfigured() {
    return true;
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
    const likedBy = Array.isArray(item.likedByUserIds) ? item.likedByUserIds : [];
    const likeCount =
      typeof item.likeCount === 'number' && !Array.isArray(item.likedByUserIds)
        ? Math.max(0, item.likeCount)
        : likedBy.length;
    const likedByCurrentUser = currentUserId
      ? likedBy.includes(currentUserId)
      : Boolean(item.likedByCurrentUser);

    return {
      id: String(item.id),
      authorId,
      authorName: String(item.authorName || 'Campus Member'),
      text: String(item.text || ''),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || null,
      likeCount,
      likedByCurrentUser,
      isOwnReview: Boolean(currentUserId && authorId && currentUserId === authorId),
    };
  }

  async fetchReviews(currentUser = null) {
    const rawList = readStoredReviews();
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

    const rawList = readStoredReviews();
    const existing = rawList.find((r) => String(r.authorId) === String(user.id));
    if (existing) {
      throw new Error(
        'You have already submitted a review. You can edit or delete your existing review.'
      );
    }

    const newRecord = {
      id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      authorId: String(user.id),
      authorName: user.fullName || 'Campus Member',
      text: cleanText,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      likedByUserIds: [],
    };

    rawList.unshift(newRecord);
    writeStoredReviews(rawList);

    const normalized = this.normalizeReview(newRecord, user);
    this.reviews = sortReviews(rawList.map((r) => this.normalizeReview(r, user)));
    this.notify();
    return normalized;
  }

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

    const rawList = readStoredReviews();
    const item = rawList.find((r) => String(r.id) === String(reviewId));
    if (!item) {
      throw new Error('Review not found.');
    }
    if (String(item.authorId) !== String(user.id)) {
      throw new Error('You can only edit or delete your own review.');
    }

    item.text = cleanText;
    item.authorName = user.fullName || item.authorName;
    item.updatedAt = new Date().toISOString();
    writeStoredReviews(rawList);

    const normalized = this.normalizeReview(item, user);
    this.reviews = sortReviews(rawList.map((r) => this.normalizeReview(r, user)));
    this.notify();
    return normalized;
  }

  async deleteReview({ reviewId, user }) {
    if (!user) {
      throw new Error('Please log in to delete your review.');
    }

    const rawList = readStoredReviews();
    const idx = rawList.findIndex((r) => String(r.id) === String(reviewId));
    if (idx === -1) {
      throw new Error('Review not found.');
    }
    if (String(rawList[idx].authorId) !== String(user.id)) {
      throw new Error('You can only edit or delete your own review.');
    }

    rawList.splice(idx, 1);
    writeStoredReviews(rawList);

    this.reviews = sortReviews(rawList.map((r) => this.normalizeReview(r, user)));
    this.notify();
    return { ok: true, id: String(reviewId) };
  }

  async toggleLike({ reviewId, shouldLike, user }) {
    if (!user) {
      throw new Error('Log in to like reviews.');
    }

    const rawList = readStoredReviews();
    const item = rawList.find((r) => String(r.id) === String(reviewId));
    if (!item) {
      throw new Error('Review not found.');
    }

    if (!Array.isArray(item.likedByUserIds)) {
      item.likedByUserIds = [];
    }

    const userId = String(user.id);
    const hasLiked = item.likedByUserIds.includes(userId);
    if (shouldLike && !hasLiked) {
      item.likedByUserIds.push(userId);
    } else if (!shouldLike && hasLiked) {
      item.likedByUserIds = item.likedByUserIds.filter((id) => id !== userId);
    }

    writeStoredReviews(rawList);

    this.reviews = sortReviews(rawList.map((r) => this.normalizeReview(r, user)));
    this.notify();

    return {
      id: String(reviewId),
      likeCount: item.likedByUserIds.length,
      likedByCurrentUser: item.likedByUserIds.includes(userId),
    };
  }
}

export const reviewService = new ReviewService();
