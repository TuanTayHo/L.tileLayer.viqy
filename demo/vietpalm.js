
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
