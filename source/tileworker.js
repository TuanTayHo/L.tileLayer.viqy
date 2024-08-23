"use strict";

const TILE_CACHE_NAME = "viqy-cache-tiles";
let tileRegExp = null;

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(TILE_CACHE_NAME).then(cache => {
      return cache.addAll([]).catch(error => {
        console.error("Failed to cache assets during installation:", error);
      });
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(
        keyList.map(key => {
          if (key !== TILE_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (tileRegExp && tileRegExp.test(url.href)) {
    event.respondWith(
      caches.match(event.request).then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(fetchResponse => {
          return caches.open(TILE_CACHE_NAME).then(cache => {
            cache.put(event.request, fetchResponse.clone());
            return fetchResponse;
          });
        }).catch(() => {
          return new Response({
            headers: {
              "Content-Type": "text/plain"
            }
          });
        });
      })
    );
  } else {
    event.respondWith(fetch(event.request));
  }
});

self.addEventListener('message', function(event) {
  if (event.data.type === 'registerTileLayer') {
    console.log('Worker received registerTileLayer message');
    const urlTemplate = event.data.url;
    const regExpText = urlTemplate
      .replace(/{s}/g, '.*')
      .replace(/{x}/g, '(\\d+)')
      .replace(/{y}/g, '(\\d+)')
      .replace(/{z}/g, '(\\d+)')
      .replace(/{quadKey}/g, '([0-3]+)')
      .replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    tileRegExp = new RegExp(regExpText);
    console.log('Tile URL RegExp:', tileRegExp);
  } else if (event.data.type === 'fetchTile') {
    const tileUrl = event.data.url;

    fetch(tileUrl).then(response => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return caches.open(TILE_CACHE_NAME).then(function(cache) {
        cache.put(tileUrl, response.clone());
        return response.blob().then(blob => {
          return { blob: blob, type: response.headers.get('Content-Type') };
        });
      });
    }).then(data => {
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'tileResponse',
            blob: data.blob,
            tileId: event.data.tileId,
            coords: event.data.coords,
            tileUrl: tileUrl,
            contentType: data.type
          });
        });
      });
    }).catch(error => {
      console.error('Fetch error:', error);
    });
  }
});
