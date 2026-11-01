/**
 * Review Card Component (js/components/ReviewCard.js)
 *
 * Renders an individual submitted campus parking review inside a dark-glass card
 * with reviewer display name, review text, formatted submission date, an
 * interactive Like button + count, and Edit/Delete controls for the review's author.
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatReviewDate(isoDate) {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return String(isoDate);

  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

export class ReviewCard {
  /**
   * @param {Object} review
   * @param {string} review.id
   * @param {string} review.authorName
   * @param {string} review.text
   * @param {string} review.createdAt
   * @param {string|null} [review.updatedAt]
   * @param {number} review.likeCount
   * @param {boolean} review.likedByCurrentUser
   * @param {boolean} [review.isOwnReview]
   */
  constructor(review) {
    this.review = review;
  }

  renderMarkup({
    isAuthenticated = false,
    isPending = false,
    currentUserId = null,
  } = {}) {
    const {
      id,
      authorId,
      authorName,
      text,
      createdAt,
      updatedAt,
      likeCount,
      likedByCurrentUser,
      isOwnReview,
    } = this.review;

    const formattedDate = formatReviewDate(createdAt);
    const count = Math.max(0, Number(likeCount) || 0);
    const isLiked = Boolean(likedByCurrentUser);
    const isOwner =
      Boolean(isOwnReview) ||
      Boolean(isAuthenticated && currentUserId && authorId && String(currentUserId) === String(authorId));

    const likeAriaLabel = isAuthenticated
      ? `${isLiked ? 'Remove like from' : 'Like'} review by ${authorName} (${count} ${count === 1 ? 'like' : 'likes'})`
      : `Log in to like review by ${authorName} (${count} ${count === 1 ? 'like' : 'likes'})`;

    return `
      <article class="glass-panel review-card ${isOwner ? 'review-card--own' : ''}" data-review-id="${escapeHtml(id)}">
        <header class="review-card__header">
          <div class="review-card__author-group">
            <span class="review-card__avatar" aria-hidden="true">
              ${escapeHtml((authorName || 'R').trim().charAt(0).toUpperCase())}
            </span>
            <div>
              <div class="review-card__author-row">
                <h3 class="review-card__author">${escapeHtml(authorName)}</h3>
                ${isOwner ? `<span class="review-card__you-badge">Your review</span>` : ''}
              </div>
              <time class="review-card__date" datetime="${escapeHtml(createdAt)}">
                ${escapeHtml(formattedDate)}${updatedAt ? ' · Edited' : ''}
              </time>
            </div>
          </div>

          <button
            type="button"
            class="review-like-btn ${isLiked ? 'is-liked' : ''}"
            data-like-review="${escapeHtml(id)}"
            aria-pressed="${isLiked ? 'true' : 'false'}"
            aria-label="${escapeHtml(likeAriaLabel)}"
            ${isPending ? 'disabled' : ''}
          >
            <svg class="review-like-btn__icon" width="16" height="16" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
            </svg>
            <span class="review-like-btn__count">${count}</span>
          </button>
        </header>

        <p class="review-card__text">${escapeHtml(text)}</p>

        ${
          isOwner
            ? `
              <footer class="review-card__owner-actions">
                <button
                  type="button"
                  class="btn-ghost-pill btn-ghost-pill--sm"
                  data-edit-review="${escapeHtml(id)}"
                  aria-label="Edit your review"
                >
                  Edit review
                </button>
                <button
                  type="button"
                  class="btn-ghost-pill btn-ghost-pill--sm btn-ghost-pill--danger"
                  data-delete-review="${escapeHtml(id)}"
                  aria-label="Delete your review"
                >
                  Delete review
                </button>
              </footer>
            `
            : ''
        }
      </article>
    `;
  }
}
