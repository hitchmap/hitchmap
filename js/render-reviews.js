import { C } from './utils.js';

export function renderReviews(reviews) {
    const container = document.createElement('div');
    container.className = 'reviews-container';
    
    reviews.forEach((review, i) => {
        const reviewElement = document.createElement('div');
        reviewElement.className = 'review';
        
        // Render comment
        if (review[C.COMMENT]) {
            const commentEl = document.createElement('div');
            commentEl.className = 'review-comment';
            commentEl.textContent = review[C.COMMENT];
            reviewElement.appendChild(commentEl);
        }
        
        // Render meta information (rating, wait, distance)
        const metaEl = document.createElement('div');
        metaEl.className = 'review-meta';
        
        if (review[C.RATING]) {
            const ratingEl = document.createElement('span');
            ratingEl.className = 'review-rating';
            ratingEl.textContent = `rating: ${review[C.RATING]}/5`;
            metaEl.appendChild(ratingEl);
        }
        
        if (review[C.WAIT]) {
            const waitEl = document.createElement('span');
            waitEl.className = 'review-wait';
            waitEl.textContent = `, wait: ${review[C.WAIT]} min`;
            metaEl.appendChild(waitEl);
        }
        
        if (review[C.RIDE_DISTANCE]) {
            const distanceEl = document.createElement('span');
            distanceEl.className = 'review-distance';
            distanceEl.textContent = `, ride: ${Math.round(review[C.RIDE_DISTANCE])} km ${review[C.ARROWS] || ''}`;
            metaEl.appendChild(distanceEl);
        }
        
        // oldie metadata can be average metadata
        if (metaEl.children.length > 0 && review[C.DATETIME] > +new Date('2021')) {
            reviewElement.appendChild(metaEl);
        }

        if (!reviewElement.firstChild) return
        
        // Render author and datetime
        const authorDateTimeEl = document.createElement('div');
        authorDateTimeEl.className = 'review-author-datetime';
        function formatDateTime(dateString) {
            if (!dateString) return '';
            const date = new Date(dateString);
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            
            const dayName = days[date.getDay()];
            const day = date.getDate();
            const month = months[date.getMonth()];
            const year = date.getFullYear();
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            
            return `, ${dayName} ${day} ${month} ${year}, ${hours}:${minutes}`;
        }
        function formatDateFallback(dateString) {
            if (!dateString) return '';
            return ', ' + new Date(dateString).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
        // Create user link span
        const userLinkSpan = document.createElement('span');
        userLinkSpan.textContent = '―';
        
        if (review[C.HITCHHIKER] && review[C.HITCHHIKER] !== 'Anonymous') {
            const userLink = document.createElement('a');
            userLink.href = `/?user=${encodeURIComponent(review[C.HITCHHIKER])}`;
            userLink.textContent = review[C.HITCHHIKER];
            userLinkSpan.appendChild(userLink);
        } else {
            userLinkSpan.textContent += 'Anonymous';
        }
        
        authorDateTimeEl.appendChild(userLinkSpan);
        
        // Add datetime
        const datetimeText = formatDateTime(review[C.RIDE_DATETIME]) || formatDateFallback(review[C.DATETIME]) || '';
        if (datetimeText) {
            const datetimeSpan = document.createElement('span');
            datetimeSpan.textContent = datetimeText;
            authorDateTimeEl.appendChild(datetimeSpan);
        }
        
        reviewElement.appendChild(authorDateTimeEl);
        
        // Add HR separator except for the last review
        if (i < reviews.length - 1) {
            const hr = document.createElement('hr');
            reviewElement.appendChild(hr);
        }
        
        container.appendChild(reviewElement);
    });
    
    return container;
}
