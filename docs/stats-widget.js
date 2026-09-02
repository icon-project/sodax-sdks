/**
 * Homepage stat strip. Live numbers from the public SODAX backend
 * (api.sodax.com/v1/be, CORS-open, unauthenticated). Only ever reads
 * protocol/infrastructure capacity (networks, assets, tokens), never
 * solver-execution activity (fills/volume), which is Blockzen's, not
 * SODAX's, to report under this brand.
 *
 * Fails silently and leaves the static fallback numbers already in
 * index.md untouched if a request errors or the shape is unexpected.
 */
(function () {
  var API_BASE = 'https://api.sodax.com/v1/be';

  var STAT_IDS = {
    networks: 'sodax-stat-networks',
    assets: 'sodax-stat-assets',
    tokens: 'sodax-stat-tokens',
  };

  function isHome() {
    return location.pathname === '/' || location.pathname === '/index';
  }

  function fmt(n) {
    return n.toLocaleString('en-US') + '+';
  }

  function fetchJSON(path) {
    return fetch(API_BASE + path, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('bad status ' + r.status);
      return r.json();
    });
  }

  function getStats() {
    var stats = {};

    var networks = fetchJSON('/config/spoke/chains')
      .then(function (chains) {
        if (Array.isArray(chains)) stats.networks = chains.length;
      })
      .catch(function () {});

    var assets = fetchJSON('/config/money-market/reserve-assets')
      .then(function (reserves) {
        if (Array.isArray(reserves)) stats.assets = reserves.length;
      })
      .catch(function () {});

    var tokens = fetchJSON('/config/swap/tokens')
      .then(function (byChain) {
        if (byChain && typeof byChain === 'object') {
          var symbols = new Set();
          Object.keys(byChain).forEach(function (chain) {
            (byChain[chain] || []).forEach(function (t) {
              if (t && t.symbol) symbols.add(t.symbol);
            });
          });
          stats.tokens = symbols.size;
        }
      })
      .catch(function () {});

    return Promise.all([networks, assets, tokens]).then(function () {
      return stats;
    });
  }

  function paint(stats) {
    if (!isHome()) return;
    Object.keys(STAT_IDS).forEach(function (key) {
      var value = stats[key];
      if (typeof value !== 'number') return;
      var el = document.getElementById(STAT_IDS[key]);
      if (!el) return;

      // Writing textContent replaces the node's children and so counts as a
      // childList mutation even when the string is unchanged. Painting
      // unconditionally would retrigger the observer below, and since its
      // callback is a microtask it would starve rendering and input handling.
      var next = fmt(value);
      if (el.textContent !== next) el.textContent = next;
    });
  }

  getStats().then(function (stats) {
    paint(stats);

    // Mintlify is a client-routed SPA, so this file only executes once per
    // hard navigation. Keep watching briefly in case the visitor lands
    // here via in-app navigation after this script already ran.
    var observer = new MutationObserver(function () {
      paint(stats);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () {
      observer.disconnect();
    }, 15000);
  });
})();
