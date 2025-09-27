import {summaryText} from './utils';
import {renderReviews} from './render-reviews';

export function exportAsGPX() {
    var script = document.createElement("script");
    script.src = 'https://cdn.jsdelivr.net/npm/togpx@0.5.4/togpx.js';
    script.onload = function () {
        let features = allMarkers.map(m => ({
            "type": "Feature",
            "properties": {
                "text": summaryText(m.options._row) + '\n\n' + renderReviews(m.options._reviews).textContent,
                "url": `https://hitchmap.com/${m.options._row[0]},${m.options._row[1]}`
            },
            "geometry": {
                "coordinates": [m.options._row[1], m.options._row[0]],
                "type": "Point"
            }
        }))
        let geojson = {
            type: "FeatureCollection",
            features
        }

        let div = document.createElement('div')
        function toPlainText(html) {
            div.innerHTML = html.replace(/\<(b|h)r\>/g, '\n')
            return div.textContent
        }

        let gpxStr = togpx(geojson, {
            creator: 'Hitchmap',
            featureDescription: f => toPlainText(f.text),
            featureLink: f => f.url
        });

        function downloadGPX(data) {
            const blob = new Blob([data], { type: 'application/gpx+xml' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'hitchmap.gpx';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        downloadGPX(gpxStr)
    }
    document.body.appendChild(script)
}
