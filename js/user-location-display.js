/*
  Copyright (c) 2016 Dominik Moritz
  This was taken from leaflet locate control. It is licensed under the MIT license.
  You can find the project at: https://github.com/domoritz/leaflet-locatecontrol
*/
let { Marker, setOptions, divIcon, LayerGroup, circle } = L;

/**
 * LocationMarker - A marker representing the user's position
 */
const LocationMarker = Marker.extend({
    initialize(latlng, options) {
        setOptions(this, options);
        this._latlng = latlng;
        this.createIcon();
    },

    createIcon() {
        const opt = this.options;
        const style = [
            ["stroke", opt.color],
            ["stroke-width", opt.weight],
            ["fill", opt.fillColor],
            ["fill-opacity", opt.fillOpacity],
            ["opacity", opt.opacity]
        ]
              .filter(([k, v]) => v !== undefined)
              .map(([k, v]) => `${k}="${v}"`)
              .join(" ");

        const icon = this._getIconSVG(opt, style);
        this._locationIcon = divIcon({
            className: icon.className,
            html: icon.svg,
            iconSize: [icon.w, icon.h]
        });
        this.setIcon(this._locationIcon);
    },

    _getIconSVG(options, style) {
        const r = options.radius;
        const w = options.weight;
        const s = r + w;
        const s2 = s * 2;
        const svg =
              `<svg xmlns="http://www.w3.org/2000/svg" width="${s2}" height="${s2}" version="1.1" viewBox="-${s} -${s} ${s2} ${s2}">` +
              `<circle r="${r}" ${style} /></svg>`;
        return {
            className: "leaflet-control-locate-location",
            svg,
            w: s2,
            h: s2
        };
    },

    setStyle(style) {
        setOptions(this, style);
        this.createIcon();
    }
});

/**
 * CompassMarker - An arrow marker showing heading/heading
 */
const CompassMarker = LocationMarker.extend({
    initialize(latlng, heading, options) {
        setOptions(this, options);
        this._latlng = latlng;
        this._heading = heading;
        this.createIcon();
    },

    setHeading(heading) {
        this._heading = heading;
        this.createIcon();  // Add this line to regenerate the icon
    },

    _getIconSVG(options, style) {
        const r = options.radius;
        const s = r + options.weight + options.depth;
        const s2 = s * 2;
        const path = this._arrowPoints(r, options.width, options.depth, this._heading);
        const svg =
              `<svg xmlns="http://www.w3.org/2000/svg" width="${s2}" height="${s2}" version="1.1" viewBox="-${s} -${s} ${s2} ${s2}">` +
              `<path d="${path}" ${style} /></svg>`;
        return {
            className: "leaflet-control-locate-heading",
            svg,
            w: s2,
            h: s2
        };
    },

    _arrowPoints(radius, width, depth, heading) {
        const φ = ((heading - 90) * Math.PI) / 180;
        const ux = Math.cos(φ);
        const uy = Math.sin(φ);
        const vx = -Math.sin(φ);
        const vy = Math.cos(φ);
        const h = width / 2;

        // Base center on circle
        const Cx = radius * ux;
        const Cy = radius * uy;

        // Base corners
        const B1x = Cx + h * vx;
        const B1y = Cy + h * vy;
        const B2x = Cx - h * vx;
        const B2y = Cy - h * vy;

        // Tip outward
        const Tx = Cx + depth * ux;
        const Ty = Cy + depth * uy;

        return `M ${B1x},${B1y} L ${B2x},${B2y} L ${Tx},${Ty} Z`;
    }
});

/**
 * UserLocationDisplay - Manages the visual representation of user location
 */
class UserLocationDisplay {
    constructor(map, options = {}) {
        this._map = map;
        this._layer = new LayerGroup().addTo(map);
        this._marker = null;
        this._circle = null;
        this._compass = null;
        this._latlng = null;
        this._enabled = false;

        // Default styles
        this.options = {
            drawCircle: true,
            drawMarker: true,
            showCompass: true,
            circleStyle: {
                className: "leaflet-control-locate-circle",
                color: "#136AEC",
                fillColor: "#136AEC",
                fillOpacity: 0.15,
                weight: 0
            },
            markerStyle: {
                className: "leaflet-control-locate-marker",
                color: "#fff",
                fillColor: "#2A93EE",
                fillOpacity: 1,
                weight: 3,
                opacity: 1,
                radius: 9
            },
            compassStyle: {
                fillColor: "#2A93EE",
                fillOpacity: 1,
                weight: 0,
                color: "#fff",
                opacity: 1,
                radius: 9,
                width: 9,
                depth: 6
            },
            ...options
        };
    }

    /**
     * Update position and accuracy circle.
     * @param {object} location - Must contain latitude, longitude, and optionally accuracy.
     */
    updateLocation(location) {
        if (!this._enabled) return;

        this._latlng = [location.latitude, location.longitude];
        const accuracy = location.accuracy || 0;

        if (this._marker) this._marker.removeFrom(this._layer);
        if (this._circle) this._circle.removeFrom(this._layer);

        // Draw accuracy circle
        if (this.options.drawCircle) {
            this._circle = circle(this._latlng, accuracy, this.options.circleStyle).addTo(this._layer);
        }

        // Draw position marker
        if (this.options.drawMarker) {
            this._marker = new LocationMarker(this._latlng, this.options.markerStyle).addTo(this._layer);
        }

        // Move compass to new position if it already exists
        if (this._compass) {
            this._compass.removeFrom(this._layer);
            this._compass = new CompassMarker(this._latlng, this._compass.heading, this.options.compassStyle).addTo(this._layer);
        }
    }

    /**
     * Update the compass heading. The compass is placed at the current position,
     * so updateLocation must have been called at least once before this has any effect.
     * Pass null or undefined to remove the compass.
     * @param {number|null|undefined} heading - Heading in degrees, or nullish to remove.
     */
    updateHeading(heading) {
        if (!this._enabled || !this._latlng) return;

        if (this.options.showCompass && heading !== undefined && heading !== null) {
            if (!this._compass) {
                this._compass = new CompassMarker(this._latlng, heading, this.options.compassStyle).addTo(this._layer);
            } else {
                this._compass.setHeading(heading);
            }
        } else if (this._compass) {
            this._compass.removeFrom(this._layer);
            this._compass = null;
        }
    }

    /**
     * Enable display
     */
    enable() {
        this._enabled = true;
    }

    /**
     * Disable display and remove all markers
     */
    disable() {
        this._enabled = false;
        this.clear();
    }

    /**
     * Clear all markers from map
     */
    clear() {
        this._layer.clearLayers();
        this._marker = null;
        this._circle = null;
        this._compass = null;
        this._latlng = null;
    }

    /**
     * Remove from map and cleanup
     */
    remove() {
        this.clear();
        this._layer.removeFrom(this._map);
    }
}

export { LocationMarker, CompassMarker, UserLocationDisplay };
