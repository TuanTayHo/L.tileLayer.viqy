(function (L) {
  const FastBitSet = require('../source/fastbitset');

  L.TileLayer.Viqy = L.TileLayer.extend({
    _delays: {},
    _retryCount: {},
    _errorCache: {},
    _items: [],
    _layerToIndexMap: new Map(),
    _isCleanupScheduled: false,
    _cacheSizeLimit: 1000, // Giới hạn số lượng tile trong cache
    _bitSet: null,

    options: {
      minNativeZoom: 0,
      timeout: null,
      doubleSize: false,
      maxRetries: 3,
      adaptiveTimeout: 2000,
      useServiceWorker: true,
      useBingMaps: false,
      bingMapsKey: null,
    },

    _refreshEnabled: false,

    initialize: function (url, options) {
      L.TileLayer.prototype.initialize.call(this, url, options);
      this._bitSet = new FastBitSet();
      if (this.options.useServiceWorker && 'serviceWorker' in navigator) {
        this._registerServiceWorker();
      }
      this.on('add', () => {
        this._setupMapEvents();
        this._updateBounds();
        this._refreshEnabled = true;
      });
      this.on('remove', () => {
        this._refreshEnabled = false;
      });
    },

    _registerServiceWorker: function () {
      const ownUrl = new URL('../source/tileworker.js', location.href);
      navigator.serviceWorker.register(ownUrl).then((registration) => {
        let worker;
        if (registration.installing) {
          worker = registration.installing;
        } else if (registration.waiting) {
          worker = registration.waiting;
        } else if (registration.active) {
          worker = registration.active;
        }
        if (worker) {
          this._onWorkerState(worker);
          worker.addEventListener('statechange', (e) => {
            this._onWorkerState(e.target);
          });
        }
      }).catch((error) => {
        console.error('Could not register service worker:', error);
      });
    },

    _onWorkerState: function (worker) {
      if (worker.state !== 'activated') { return; }
      console.log('Service worker is active:', worker);
      worker.postMessage({
        type: 'registerTileLayer',
        url: this._url,
        useBingMaps: this.options.useBingMaps,
        bingMapsKey: this.options.bingMapsKey,
      });
    },

    _setupMapEvents: function () {
      this._map.on('dragend zoomend', () => {
        if (this._refreshEnabled) {
          this._refresh();
        }
      });
    },

    _addItem: function (layer, feature) {
      this._items.push({
        layer: layer,
        feature: feature,
        off: false
      });
      var index = this._items.length - 1;
      this._layerToIndexMap.set(this._getLayerIdentifier(layer), index);
      this._bitSet.add(index, feature.geometry.coordinates[0], feature.geometry.coordinates[1]);
      this._scheduleCleanup();
    },

    _turnOnLayer: function (layer, skipAddingLayer = false) {
      var layerIdentifier = this._getLayerIdentifier(layer);
      if (!this._layerToIndexMap.has(layerIdentifier)) return;
      var index = this._layerToIndexMap.get(layerIdentifier);
      this._items[index].off = false;
      if (!skipAddingLayer) {
        this._map.addLayer(layer);
      }
      this._bitSet.add(index, layer.feature.geometry.coordinates[0], layer.feature.geometry.coordinates[1]);
      this._scheduleCleanup();
    },

    _turnOffLayer: function (layer) {
      var layerIdentifier = this._getLayerIdentifier(layer);
      if (!this._layerToIndexMap.has(layerIdentifier)) return;
      var index = this._layerToIndexMap.get(layerIdentifier);
      this._items[index].off = true;
      if (this._map.hasLayer(layer)) {
        this._map.removeLayer(layer);
      }
      this._bitSet.remove(index);
      this._scheduleCleanup();
    },

    _eachVisible: function (fn) {
      const visibleItems = this._bitSet.kdbushRange(this._sw.lng, this._sw.lat, this._ne.lng, this._ne.lat);
      visibleItems.forEach(index => {
        const item = this._items[index];
        if (item && !item.off && this._isInViewPort(item.feature)) {
          fn.call(this, item.layer, item.feature, item);
        }
      });
    },

    _updateBounds: function () {
      if (!this._map) {
        console.warn('Layer added to a map instance before invoking _updateBounds');
        return;
      }
      this._bounds = this._map.getBounds();
      this._ne = this._bounds._northEast;
      this._sw = this._bounds._southWest;
    },

    _refresh: function () {
      if (!this._map || !this._refreshEnabled) {
        console.warn('Layer not yet added to a map instance hoặc refresh bị vô hiệu hóa trước khi gọi _refresh');
        return;
      }
      this._updateBounds();
      this._items.forEach((item) => {
        if (item.feature && this._isFeatureValid(item.feature)) {
          var coordinates = item.feature.geometry.coordinates;
          var lat = coordinates[1];
          var lon = coordinates[0];
          if (lat < this._sw.lat || lat > this._ne.lat || lon < this._sw.lng || lon > this._ne.lng) {
            if (this._map.hasLayer(item.layer)) {
              item.layer._refresh();
            } else {
              item.layer.addTo(this._map);
              item.layer._refresh();
            }
          }
        }
      });
    },

    _mapEventHandler: function (eventName) {
      if (this._map && this._map.hasLayer(this)) {
        this._refresh();
      }
    },

    _isInViewPort: function (feature) {
      if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
        return false;
      }
      var coordinates = feature.geometry.coordinates;
      var lat = coordinates[1];
      var lon = coordinates[0];
      return lat > this._sw.lat && lat < this._ne.lat && lon > this._sw.lng && lon < this._ne.lng;
    },

    _isFeatureValid: function (feature) {
      return feature && feature.geometry && Array.isArray(feature.geometry.coordinates);
    },

    _scheduleCleanup: function () {
      if (!this._isCleanupScheduled) {
        this._isCleanupScheduled = true;
        requestIdleCallback(() => {
          this._cleanup();
          this._isCleanupScheduled = false;
        });
      }
    },

    _cleanup: function () {
      var newItems = [];
      var newIndex = 0;
      this._items.forEach((item) => {
        if (!item.off && this._isFeatureValid(item.feature)) {
          newItems.push(item);
          this._layerToIndexMap.set(this._getLayerIdentifier(item.layer), newIndex);
          newIndex++;
        }
      });
      this._items = newItems;

      // Giới hạn kích thước của cache
      if (this._items.length > this._cacheSizeLimit) {
        this._items.splice(0, this._items.length - this._cacheSizeLimit);
      }
    },

    _getLayerIdentifier: function (layer) {
      if (layer.options && layer.options.name) {
        return layer.options.name;
      } else if (layer._leaflet_id) {
        return layer._leaflet_id;
      } else {
        return JSON.stringify({
          options: layer.options,
          properties: layer.feature ? layer.feature.properties : null
        });
      }
    },

    getTileUrl: function (coords) {
      if (this.options.useBingMaps) {
        const quadKey = this._toQuadKey(coords.x, coords.y, coords.z);
        return `https://ecn.t${(coords.x + coords.y) % 8}.tiles.virtualearth.net/tiles/a${quadKey}.jpeg?g=1&mkt=en-US&n=z&key=${this.options.bingMapsKey}`;
      }
      return L.TileLayer.prototype.getTileUrl.call(this, coords);
    },

    _toQuadKey: function (x, y, z) {
      let quadKey = '';
      for (let i = z; i > 0; i--) {
        let digit = 0;
        const mask = 1 << (i - 1);
        if ((x & mask) !== 0) {
          digit++;
        }
        if ((y & mask) !== 0) {
          digit++;
          digit++;
        }
        quadKey += digit;
      }
      return quadKey;
    },

    createCanvas: function (canvas, tilePoint, done) {
      var ctx = canvas.getContext("2d"),
        tileSize = this.getTileSize(),
        doubleSize = this.options.doubleSize,
        actualTileSizeX = doubleSize ? 2 * tileSize.x : tileSize.x,
        actualTileSizeY = doubleSize ? 2 * tileSize.y : tileSize.y,
        tileUrl = this.getTileUrl(tilePoint),
        errorCallback = (error) => {
          if (!canvas._tileLayerCanvasErrorHandled) {
            canvas._tileLayerCanvasErrorHandled = true;
            done(error, canvas);
          }
        };

      canvas.width = actualTileSizeX;
      canvas.height = actualTileSizeY;

      var img = new Image();

      img.onload = function () {
        try {
          ctx.drawImage(img, 0, 0, actualTileSizeX, actualTileSizeY);
          canvas.complete = true;
          if (!canvas._tileLayerCanvasErrorHandled) {
            done(null, canvas);
          }
        } catch (e) {
          errorCallback(e);
        }
      };

      var zoom = this._getZoomForUrl(tilePoint);
      img.onerror = function () {
        errorCallback(new Error('Image load error'));
      };

      img.src = isNaN(zoom) ? "" : tileUrl;
    },

    _loadTile: function (tile, coords) {
      tile._layer = this;
      tile.onload = () => {
        this._tileOnLoad(tile);
        if (tile.src.startsWith("blob:")) {
          URL.revokeObjectURL(tile.src);
        }
      };

      tile.onerror = (e) => {
        console.error(`Error loading tile at ${coords.x}, ${coords.y}, ${coords.z}:`, e);
        this._tileOnError(tile, coords, e);
      };

      const tileUrl = this.getTileUrl(coords);
      if (this.options.useServiceWorker && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.active.postMessage({
            type: 'fetchTile',
            url: tileUrl,
            tileId: tile._leaflet_id,
            coords: coords
          });
        }).catch(error => {
          console.error(`Fetch error for tile at ${coords.x}, ${coords.y}, ${coords.z}:`, error);
          this.createCanvas(tile, coords, () => { });
        });
      } else {
        this.createCanvas(tile, coords, () => { });
      }

      this._addItem(tile, {
        geometry: {
          coordinates: [coords.x, coords.y]
        }
      });
    },

    _tileOnError: function (tile, coords, e) {
      const errorKey = `${coords.x}-${coords.y}-${coords.z}`;
      if (this._errorCache[errorKey]) {
        return this._handleTileError(tile, e);
      }

      var retries = this._retryCount[coords.z] || 0;
      if (retries < this.options.maxRetries) {
        this._retryCount[coords.z] = retries + 1;
        this._loadTile(tile, coords);
      } else {
        this._errorCache[errorKey] = true;
        this._handleTileError(tile, e);
      }
    },

    createTile: function (coords, done) {
      var tile = document.createElement("canvas"),
        timeout = this.options.timeout;

      if (timeout) {
        var delay = setTimeout(() => {
          this.createCanvas(tile, coords, done);
        }, timeout);
        this._addDelay(coords.z, delay);
      } else {
        this.createCanvas(tile, coords, done);
      }
      return tile;
    },

    _addDelay: function (zoom, delay) {
      if (!this._delays[zoom]) {
        this._delays[zoom] = [];
      }
      this._delays[zoom].push(delay);
    },

    _clearDelaysForZoom: function () {
      var delays = this._delays[this._delaysForZoom];
      if (delays) {
        delays.forEach(clearTimeout);
        delete this._delays[this._delaysForZoom];
      }
    },

    _cleanUpTiles: function () {
      for (var zoom in this._delays) {
        if (this._delays.hasOwnProperty(zoom)) {
          this._delays[zoom].forEach(clearTimeout);
        }
      }
      this._delays = {};
    },

    _handleTileError: function (tile, error) {
      var originalCoords = tile._originalCoords,
        currentCoords = tile._currentCoords = tile._currentCoords || this._createCurrentCoords(originalCoords),
        fallbackZoom = tile._fallbackZoom = tile._fallbackZoom === undefined ? originalCoords.z - 1 : originalCoords.z - 1,
        scale = tile._fallbackScale = (tile._fallbackScale || 1) * 2,
        tileSize = this.getTileSize(),
        actualTileSizeX = tileSize.x * scale,
        actualTileSizeY = tileSize.y * scale,
        style = tile.style,
        newUrl,
        top,
        left;

      if (fallbackZoom < this.options.minNativeZoom) {
        return this._originalTileOnError(tile, error);
      }

      currentCoords.z = fallbackZoom;
      currentCoords.x = Math.floor(currentCoords.x / 2);
      currentCoords.y = Math.floor(currentCoords.y / 2);
      newUrl = this.getTileUrl(currentCoords);
      style.width = actualTileSizeX + 'px';
      style.height = actualTileSizeY + 'px';
      top = (originalCoords.y - currentCoords.y * scale) * tileSize.y;
      style.marginTop = -top + 'px';
      left = (originalCoords.x - currentCoords.x * scale) * tileSize.x;
      style.marginLeft = -left + 'px';
      style.clip = `rect(${top}px, ${left + actualTileSizeX}px, ${top + actualTileSizeY}px, ${left}px)`;

      this.viqy('tilefallback', {
        tile: tile,
        url: tile._originalSrc,
        urlMissing: tile.src,
        urlFallback: newUrl
      });
      tile.src = newUrl;
    }
  });

  L.tileLayer.viqy = function (url, options) {
    return new L.TileLayer.Viqy(url, options);
  };

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data.type === 'tileResponse') {
        const tile = document.querySelector(`[data-tile-id="${event.data.tileId}"]`);
        if (tile) {
          const blob = new Blob([event.data.blob], { type: event.data.type });
          tile.src = URL.createObjectURL(blob);
        }
      }
    });
  }
})(L);