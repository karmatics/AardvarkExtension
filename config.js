// Aardvark Extension Configuration Matrix
const CONFIG = {
  // Legal Chrome match patterns (ports are stripped because Chrome tabs.query rejects ports)
  PLAYER_URL_PATTERNS: [
    "*://localhost/*",
    "*://127.0.0.1/*",
    "https://*.github.io/*"
  ],
  DEFAULT_PLAYER_URL: "http://localhost:8080/AardvarkPlaylist/index.html",
  PRODUCTION_PLAYER_URL: "https://karmatics.github.io/AardvarkPlaylist/index.html",
  DEV_PORT: "8080",
  APP_PATH: "/AardvarkPlaylist/"
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
if (typeof globalThis !== 'undefined') {
  globalThis.CONFIG = CONFIG;
  globalThis.AARDVARK_CONFIG = CONFIG;
}