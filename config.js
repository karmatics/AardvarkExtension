// Centralized Aardvark Extension Configuration
const AARDVARK_CONFIG = {
  DEV_PORT: 8080,
  DEV_HOST: 'http://localhost:8080',
  PLAYER_URL: 'http://localhost:8080/AardvarkPlaylist/',
  PROD_URL: 'https://karmatics.github.io/AardvarkPlaylist/',
  YT_EMBED_MATCHES: [
    'http://localhost:8080/*',
    'http://127.0.0.1:8080/*',
    'https://*.github.io/*'
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = AARDVARK_CONFIG;
globalThis.AARDVARK_CONFIG = AARDVARK_CONFIG;