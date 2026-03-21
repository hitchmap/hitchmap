// Utility functions and global variables
export function $$ (e) { return document.querySelector(e) }

export const bars = document.querySelectorAll('.sidebar, .topbar');

export function bar(selector) {
    bars.forEach(function (el) {
        el.classList.remove('visible')
    })
    if (selector)
        $$(selector).classList.add('visible')
}

export function arrowLine(from, to) {
    return L.polylineDecorator([from, to], {
        patterns: [
            {
                repeat: 10,
                symbol: L.Symbol.arrowHead({
                    pixelSize: 7,
                    polygon: true,
                    pathOptions: {
                        stroke: false,
                        fill: true,
                        fillOpacity: 0.6,
                        fillColor: 'black',
                        pane: 'arrowlines'
                    },
                }),
                offset: 20,
                endOffset: 0
            }
        ]
    })
}

export function restoreView() {
    if (!storageAvailable('localStorage')) {
        return false;
    }
    var storage = window.localStorage;
    if (!this.__initRestore) {
        this.on('moveend', function (e) {
            if (!this._loaded)
                return;  // Never access map bounds if view is not set.

            var view = {
                lat: this.getCenter().lat,
                lng: this.getCenter().lng,
                zoom: this.getZoom()
            };
            storage['mapView'] = JSON.stringify(view);
        }, this);
        this.__initRestore = true;
    }

    var view = storage['mapView'];
    try {
        view = JSON.parse(view || '');
        this.setView(L.latLng(view.lat, view.lng), view.zoom, true);
        return true;
    }
    catch (err) {
        return false;
    }
}

export function storageAvailable(type) {
    try {
        var storage = window[type],
            x = '__storage_test__';
        storage.setItem(x, x);
        storage.removeItem(x);
        return true;
    }
    catch (e) {
        console.warn("Your browser blocks access to " + type);
        return false;
    }
}

export function summaryText(row) {
    return `Rating: ${row[2].toFixed(0)}/5
    Waiting time: ${row[4] == null ? '-' : row[4].toFixed(0) + ' min'}
    Ride distance: ${row[5] == null ? '-' : row[5].toFixed(0) + ' km'}`
}

export function closestMarker(markers, lat, lon) {
    let latlng = L.latLng(lat, lon)
    if (markers.length)
        return markers.sort((a, b) => a.getLatLng().distanceTo(latlng) - b.getLatLng().distanceTo(latlng))[0]
}

export function findClosestPolyline(point, polylines) {
  let minDistSq = Infinity;
  let closestPolyline = null;
  let closestPoint = null;

  polylines.forEach(polyline => {
    let latlngs = polyline.getLatLngs();

    // Flatten MultiPolyline if needed
    if (Array.isArray(latlngs[0][0])) {
      latlngs = latlngs.flat();
    }

    for (let i = 0; i < latlngs.length - 1; i++) {
      const a = latlngs[i];
      const b = latlngs[i + 1];

      const dx = b.lng - a.lng;
      const dy = b.lat - a.lat;
      const lenSq = dx * dx + dy * dy;

      let t = 0;
      if (lenSq !== 0) {
        t = ((point.lng - a.lng) * dx + (point.lat - a.lat) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
      }

      const cx = a.lng + t * dx;
      const cy = a.lat + t * dy;

      const distSq = (point.lng - cx) ** 2 + (point.lat - cy) ** 2;

      if (distSq < minDistSq) {
        minDistSq = distSq;
        closestPolyline = polyline;
        closestPoint = L.latLng(cy, cx);
      }
    }
  });

  return {
    polyline: closestPolyline,
    point: closestPoint,
  };
}

export function markerReviews(marker) {
    const reviewIndices = marker.options._row[6]
    return reviewIndices.map(i => window.reviewData[i])
}

// review-columns.js
const columns = window.reviewColumns || [];
const columnExports = {};

columns.forEach((columnName, index) => {
    const constName = columnName.toUpperCase().replace(/\W/g, '_');
    columnExports[constName] = index;
})

/**
 * Mount an existing HTML element (selected via CSS selector) into
 * Leaflet’s control container at a given position (default: 'topleft').
 * Returns the mounted element so you can immediately attach listeners.
 */
export function addAsLeafletControl(selector, position = 'topleft') {
    const el = document.querySelector(selector);

    const Control = L.Control.extend({
        options: { position },
        onAdd() {
            el.style.display = ''; // unhide in case it was hidden
            return el;
        },
        onRemove() {}
    });

    window.map.addControl(new Control());
    return el;
}
;

export async function clearCacheExceptErrorPage() {
    if (!('caches' in window)) return;
    try {
        const cache = await caches.open('hitchmap-v1');
        const keys = await cache.keys();
        await Promise.all(
            keys
                .filter(req => !req.url.endsWith('/error.html'))
                .map(req => cache.delete(req))
        );
    } catch (error) {
        console.error('Failed to clear cache:', error);
    }
}

// Also export the full object
export const C = columnExports;

const OutlinedPolyline = L.Polyline.extend({
    options: {
        outline: false,
        outlineColor: '#000',
        outlineWidth: 2 // extra width added on each side
    },

    _updatePath() {
        if (!this._renderer || !this._renderer._ctx) {
            return;
        }

        if (this.options.outline) {
            this._updateOutline();
        }

        // Draw the normal line on top
        this._renderer._updatePoly(this, false);
    },

    _updateOutline() {
        const ctx = this._renderer._ctx;
        const weight = this.options.weight || 5;
        const outlineWidth = this.options.outlineWidth || 2;

        // Temporarily override style
        const originalColor = this.options.color;
        const originalWeight = this.options.weight;

        this.options.color = this.options.outlineColor;
        this.options.weight = weight + outlineWidth * 2;

        // Draw outline
        this._renderer._updatePoly(this, false);

        // Restore original style
        this.options.color = originalColor;
        this.options.weight = originalWeight;
    }
});

export function outlinedPolyline (latlngs, options) {
    return new OutlinedPolyline(latlngs, options);
};
