import { C } from './utils.js';

export function renderReviews(reviews) {
    const container = document.createElement('div');
    container.className = 'reviews-container';

    reviews.forEach((review, i) => {
        const reviewElement = document.createElement('div');
        reviewElement.className = 'review';

        // ── Header row: author name + stars ──────────────────────────
        const headerEl = document.createElement('div');
        headerEl.className = 'review-header';

        const oldie = review[C.DATETIME] < +new Date('2022')

        // Author name
        const authorNameEl = document.createElement('div');
        authorNameEl.className = 'review-author-name';
        if (review[C.HITCHHIKER] && review[C.HITCHHIKER] !== 'Anonymous') {
            const userLink = document.createElement('a');
            userLink.href = `/?user=${encodeURIComponent(review[C.HITCHHIKER])}`;
            userLink.textContent = review[C.HITCHHIKER];
            authorNameEl.appendChild(userLink);
        } else {
            authorNameEl.textContent = 'Anonymous';
        }
        headerEl.appendChild(authorNameEl);

        // Stars
        if (!oldie && review[C.RATING]) {
            const starsEl = document.createElement('div');
            starsEl.className = 'review-stars';
            starsEl.textContent = '★'.repeat(review[C.RATING]) + '☆'.repeat(5 - review[C.RATING]);
            headerEl.appendChild(starsEl);
        }

        reviewElement.appendChild(headerEl);

        // ── Date line ─────────────────────────────────────────────────
        function formatDateTime(dateString) {
            if (!dateString) return null;
            const [datePart, timePart] = dateString.split('T');
            const [year, month, day] = datePart.split('-').map(Number);
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const dayName = days[new Date(year, month - 1, day).getDay()];
            return `${dayName} ${day} ${months[month - 1]} ${year} · ${timePart}`;
        }
        function formatDateFallback(dateString) {
            if (!dateString) return '';
            return new Date(dateString).toLocaleDateString(
                document.documentElement.lang, { month: 'long', year: 'numeric' });
        }

        const dateStr = formatDateTime(review[C.RIDE_DATETIME]) || formatDateFallback(review[C.DATETIME]);
        if (dateStr) {
            const dateEl = document.createElement('div');
            dateEl.className = 'review-date';
            dateEl.textContent = dateStr;
            reviewElement.appendChild(dateEl);
        }

        // ── Comment ───────────────────────────────────────────────────
        let commentEl;
        if (review[C.COMMENT]) {
            commentEl = document.createElement('div');
            commentEl.className = 'review-comment';
            commentEl.textContent = review[C.COMMENT];
            reviewElement.appendChild(commentEl);
        }

        // ── Pills: wait + ride ────────────────────────────────────────
        const pillsRow = document.createElement('div');
        pillsRow.className = 'review-pills';

        if (!oldie && review[C.WAIT]) {
            const p = document.createElement('span');
            p.className = 'review-pill-tag';
            p.innerHTML = `wait <strong>${review[C.WAIT]} min</strong>`;
            pillsRow.appendChild(p);
        }
        if (review[C.RIDE_DISTANCE]) {
            const p = document.createElement('span');
            p.className = 'review-pill-tag';
            p.innerHTML = `ride <strong>${Math.round(review[C.RIDE_DISTANCE])} km${review[C.ARROWS] ? ' ' + review[C.ARROWS] : ''}</strong>`;
            pillsRow.appendChild(p);
        }
        if (pillsRow.children.length) reviewElement.appendChild(pillsRow);

        // ── Translation toggle ────────────────────────────────────────
        if (commentEl && !review[C.IS_ORIGINAL]) {
            const viewOriginalTemplate = document.querySelector('#templates .view-original');
            const viewTranslationTemplate = document.querySelector('#templates .view-translation');
            if (viewOriginalTemplate && viewTranslationTemplate) {
                const toggleDiv = document.createElement('div');
                const toggleAnchor = document.createElement('a');
                toggleAnchor.href = 'javascript:;';
                toggleAnchor.className = 'toggle-original';
                toggleAnchor.textContent = viewOriginalTemplate.textContent;

                let isShowingOriginal = false;
                let originalComment = null;
                const translatedComment = review[C.COMMENT];

                toggleAnchor.addEventListener('click', async (e) => {
                    e.preventDefault();
                    if (!isShowingOriginal) {
                        if (!originalComment) {
                            try {
                                const response = await fetch(`/original-comment/${review[C.SHORT_ID]}`);
                                if (response.ok) {
                                    const data = await response.json();
                                    originalComment = data.comment;
                                }
                            } catch (error) { return; }
                        }
                        if (originalComment) {
                            commentEl.textContent = originalComment;
                            toggleAnchor.textContent = viewTranslationTemplate.textContent;
                            isShowingOriginal = true;
                        }
                    } else {
                        commentEl.textContent = translatedComment;
                        toggleAnchor.textContent = viewOriginalTemplate.textContent;
                        isShowingOriginal = false;
                    }
                });
                toggleDiv.appendChild(toggleAnchor);
                reviewElement.appendChild(toggleDiv);
            }
        }

        if (!reviewElement.querySelector('.review-comment, .review-pills')) return;
        container.appendChild(reviewElement);
    });

    return container;
}
