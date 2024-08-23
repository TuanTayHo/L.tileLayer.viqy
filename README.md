# L.TileLayer.ViQy

L.TileLayer.ViQy is a Leaflet plugin that enhances the default tile layer management with advanced features like WebAssembly integration, service workers, and spatial indexing using KDBush. This plugin provides optimized caching, improved performance, and supports alternative map services such as Bing Maps.

## Features

- **WebAssembly Integration**: Utilizes FastBitSet for efficient spatial indexing and performance.
- **Service Workers**: Provides offline capabilities and optimized tile caching.
- **KDBush Spatial Indexing**: Enhances tile management by using spatial indexing for quick lookups.
- **Bing Maps Support**: Optionally use Bing Maps as a tile source with adaptive retries for tile loading.
- **Dynamic Tile Loading**: Automatically adjusts tile loading based on the viewport for better performance.

## Installation

To use this plugin, include it in your Leaflet project.

### Example

```javascript
const L = require('leaflet');
require('./source/L.tileLayer.ViQy');

document.addEventListener("DOMContentLoaded", function() {
    const map = L.map('map').setView([21.028511, 105.804817], 13);

    L.tileLayer.viqy('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    }).addTo(map);

    L.marker([21.028511, 105.804817]).addTo(map)
        .bindPopup('Hà Nội, Việt Nam')
        .openPopup();
});