class YouTubeService {
  constructor() {
      this.playerTabId = null;
      this.connectionState = 'DISCONNECTED';
      this.currentSessionId = null;
      this.lastPlayerMessageTime = 0;
      this.isAppReady = false;

      // Initialize the missing transactions map to prevent runtime crashes upon APP_ACK receipt
      this.activeTransactions = new Map();

      // Set to dev as primary origin
      this.PROD_ORIGIN = 'https://karmatics.github.io';
      this.DEV_ORIGIN = 'http://localhost:8080';
      this.playerPath = '/AardvarkPlaylist/';

      this.isCreatingTab = false;
      this.lastTabCreateTime = 0;
    }

  init() {
      console.log('YouTubeService: Service Worker Initialized');

      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'YT_Video_Op') {
          this.forwardToPlayer(request.data)
            .then((res) => sendResponse(res))
            .catch((err) => sendResponse({ error: err.message }));
          return true;
        }

        // Recognize direct bridge messages as well as legacy wrappers
        const isPlayerMsg =
          request.type === 'YT_Player_Status' ||
          request.type === 'PLAYER_READY' ||
          request.type === 'BRIDGE_HEARTBEAT' ||
          request.type === 'APP_ACK' ||
          request.type === 'SYNC_PLAYLIST';

        if (isPlayerMsg) {
          const data = request.data || request.payload || request;

          if (sender.tab && sender.tab.id) {
            this._updatePlayerTabRef(sender.tab.id);
          }

          if (
            request.type === 'PLAYER_READY' ||
            data.type === 'PLAYER_READY' ||
            data.type === 'HANDSHAKE' ||
            request.type === 'BRIDGE_HEARTBEAT'
          ) {
            this.isAppReady = true;
            this.connectionState = 'CONNECTED';
            if (sender.tab && sender.tab.id) {
              this.playerTabId = sender.tab.id;
            }
            console.log('YouTubeService: App confirmed ready on tab:', this.playerTabId);
          }

          const msgId = data.msgId || (data.payload && data.payload.msgId);
          if ((request.type === 'APP_ACK' || data.type === 'APP_ACK') && msgId) {
            this.logAndBroadcast(`Received APP_ACK for transaction: ${msgId}`);
            const tx = this.activeTransactions.get(msgId);
            if (tx) {
              clearTimeout(tx.timeoutId);
              tx.resolve({ success: true });
              this.activeTransactions.delete(msgId);
            }
            this.broadcastStatus({
              type: 'YT_VIDEO_OP_ACK',
              msgId: msgId,
            });
          }

          const sId = request.sessionId || data.sessionId;
          if (sId && this.currentSessionId !== sId) {
            this.currentSessionId = sId;
            this.broadcastStatus({
              type: 'PLAYER_CONNECTED',
              sessionId: this.currentSessionId,
            });
          }

          this.forwardToYouTubeTabs(data);
          sendResponse({ success: true });
          return false;
        }

        return false;
      });

      this.startTabListeners();
      this.reinjectExistingTabs();
    }

  startTabListeners() {
      chrome.tabs.onRemoved.addListener((tabId) => {
        if (tabId === this.playerTabId) {
          console.log('YouTubeService: Player tab closed.');
          this.playerTabId = null;
          this.isAppReady = false;
          this.connectionState = 'DISCONNECTED';
          this.currentSessionId = null;
          this.broadcastStatus({
            type: 'PLAYER_DISCONNECTED',
            reason: 'Tab Closed',
          });
        }
      });

      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (tabId === this.playerTabId && changeInfo.status === 'loading') {
          this.isAppReady = false;
          this.broadcastStatus({
            type: 'PLAYER_CONNECTING',
            reason: 'Reloading',
          });
        }
      });

      // Clear active player tab immediately when user toggles between Local and GitHub Pages
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.bmo_dev_mode) {
          const isDev = !!changes.bmo_dev_mode.newValue;
          this.playerTabId = null;
          this.isAppReady = false;
          this.connectionState = 'DISCONNECTED';
          this.logAndBroadcast(`Switched mode to ${isDev ? 'Localhost (8080)' : 'GitHub Pages'}. Resetting player tab target.`);
        }
      });
    }
  _updatePlayerTabRef(tabId) {
    if (this.playerTabId !== tabId) {
      console.log(`YouTubeService: Registered new Player Tab ID: ${tabId}`);
      this.playerTabId = tabId;
      this.isAppReady = false; // Reset readiness for new tabs
    }
    this.connectionState = 'CONNECTED';
  }

  async broadcastStatus(payload) {
    const fullPayload = { ...payload, timestamp: Date.now() };
    this.forwardToYouTubeTabs(fullPayload);
  }

  async forwardToPlayer(payload) {
        this.logAndBroadcast(`Received request to forward ${payload.type} for video: "${payload.title || 'Untitled'}" (${payload.videoId})`);

        let store = {};
        try { store = await chrome.storage.local.get(['bmo_dev_mode']); } catch (e) {}
        const isDev = store.bmo_dev_mode === true;
        const expectedOrigin = isDev ? this.DEV_ORIGIN : this.PROD_ORIGIN;

        if (payload.type === 'PING') {
          const tabId = await this.findPlayerTab();
          if (tabId) {
            this.playerTabId = tabId;
            this.logAndBroadcast(`PING: Found active player tab: ${tabId}`);
            return { success: true, found: true, tabId: tabId };
          }
          this.logAndBroadcast(`PING: No player tab found.`);
          return { success: true, found: false };
        }

        if (payload.type === 'ADD_VIDEO' || payload.type === 'PLAY_NOW') {
          let targetTabId = this.playerTabId ? await this._verifyTab(this.playerTabId, expectedOrigin) : null;

          if (!targetTabId) {
            targetTabId = await this.findPlayerTab();
          }

          if (!targetTabId) {
            this.logAndBroadcast(`No matching player tab for ${isDev ? 'Local' : 'GitHub Pages'} mode. Opening new tab...`);
            targetTabId = await this.ensurePlayerTab(payload);
            if (!targetTabId) {
              this.logAndBroadcast(`Failed to open/find Player Tab.`, 'error');
              return { error: 'Failed to open/find Player Tab' };
            }

            this.logAndBroadcast(`Opened player tab: ${targetTabId}. Waiting for initial handshake...`);
            await this._waitForPlayerReady(targetTabId, 12000);
          }

          this.playerTabId = targetTabId;

          if (payload.focusPlayer !== false) {
            try {
              const tabInfo = await chrome.tabs.get(targetTabId);
              if (tabInfo && tabInfo.windowId) {
                await chrome.windows.update(tabInfo.windowId, { focused: true });
                await chrome.tabs.update(targetTabId, { active: true });
              }
            } catch (e) {
              this.logAndBroadcast(`Could not focus player tab: ${e.message}`, 'warn');
            }
          }
        }

        const tabId = this.playerTabId || (await this.findPlayerTab());
        if (!tabId) {
          this.playerTabId = null;
          this.logAndBroadcast(`Final check: Player tab not found.`, 'error');
          return { error: 'Player Tab not found (is it open?)', found: false };
        }

        this.logAndBroadcast(`Dispatched ${payload.type} command to player tab ${tabId}.`);

        let sentSuccessfully = false;
        let sendAttempts = 0;
        const maxSendAttempts = 3;

        while (!sentSuccessfully && sendAttempts < maxSendAttempts) {
          sendAttempts++;
          try {
            await chrome.tabs.sendMessage(tabId, {
              type: 'YT_BRIDGE_TO_PAGE',
              payload: payload,
            });
            this.logAndBroadcast(`Successfully sent ${payload.type} to player tab.`);
            sentSuccessfully = true;
          } catch (e) {
            this.logAndBroadcast(`Attempt ${sendAttempts} failed to send message: ${e.message}.`, 'warn');
            if (sendAttempts < maxSendAttempts) {
              await new Promise((resolve) => setTimeout(resolve, 300));
            }
          }
        }

        if (sentSuccessfully) {
          return { success: true };
        } else {
          this.logAndBroadcast(`Failed to send message after ${maxSendAttempts} attempts.`, 'error');
          return { error: 'Bridge Unreachable', found: true };
        }
      }
  async forwardToYouTubeTabs(payload) {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
      for (const tab of tabs) {
        chrome.tabs
          .sendMessage(tab.id, {
            type: 'YT_BRIDGE_TO_EXTENSION_UI',
            payload: payload,
          })
          .catch(() => {});
      }
    } catch (e) {}
  }

    async ensurePlayerTab(initialPayload = null) {
            const existingTab = await this.findPlayerTab();
            if (existingTab) {
              try {
                await chrome.tabs.update(existingTab, { active: true });
                this.playerTabId = existingTab;
                return existingTab;
              } catch (e) {
                this.playerTabId = null;
              }
            }

            if (this.isCreatingTab) return this.playerTabId;
            this.isCreatingTab = true;
            this.connectionState = 'CONNECTING';
            this.isAppReady = false;

            let store = {};
            try { store = await chrome.storage.local.get(['bmo_dev_mode']); } catch (e) {}
            const isDev = store.bmo_dev_mode === true;
            const targetOrigin = isDev ? this.DEV_ORIGIN : this.PROD_ORIGIN;

            let finalUrl = targetOrigin + this.playerPath + 'index.html';
            if (initialPayload && initialPayload.videoId) {
              const q = new URLSearchParams();
              q.set('v', initialPayload.videoId);
              if (initialPayload.title) q.set('title', initialPayload.title);
              if (initialPayload.type === 'PLAY_NOW' || initialPayload.playNow) q.set('play', '1');
              finalUrl += '?' + q.toString();
            }

            this.logAndBroadcast(`Opening player tab (${isDev ? 'Local' : 'GitHub Pages'}): ${finalUrl}`);

            try {
              const newTab = await chrome.tabs.create({ url: finalUrl, active: true });
              this.playerTabId = newTab.id;
              this.isCreatingTab = false;
              return newTab.id;
            } catch (e) {
              this.isCreatingTab = false;
              this.logAndBroadcast(`Failed to create player tab: ${e.message}`, 'error');
              return null;
            }
          }
  async _waitForPlayerReady(tabId, timeout = 12000) {
        const startTime = Date.now();
        const checkInterval = 200;

        return new Promise((resolve) => {
          const check = setInterval(async () => {
            let bridgeAlive = false;
            let appReady = false;
            try {
              const resp = await chrome.tabs.sendMessage(tabId, {
                type: 'PING_BRIDGE',
              });
              if (resp && (resp.success || resp.status === 'ok' || resp.bridgeReady)) {
                bridgeAlive = true;
                if (resp.appReady || resp.pageReady) {
                  appReady = true;
                }
              }
            } catch (e) {
              // Tab still loading or bridge not ready
            }

            if (bridgeAlive && appReady) {
              this.connectionState = 'CONNECTED';
              this.playerTabId = tabId;
              this.isAppReady = true;
              clearInterval(check);
              resolve(true);
              return;
            }

            if (Date.now() - startTime > timeout) {
              clearInterval(check);
              console.warn('YouTubeService: Player ready timeout');
              if (bridgeAlive) {
                this.connectionState = 'CONNECTED';
                this.playerTabId = tabId;
                resolve(true);
              } else {
                resolve(false);
              }
            }
          }, checkInterval);
        });
      }
    async findPlayerTab(preferredOriginOverride = null) {
        let tabs = [];
        try {
          tabs = await chrome.tabs.query({});
        } catch (e) {
          return null;
        }

        let store = {};
        try { store = await chrome.storage.local.get(['bmo_dev_mode']); } catch (e) {}
        const isDev = store.bmo_dev_mode === true;
        const targetOrigin = preferredOriginOverride || (isDev ? this.DEV_ORIGIN : this.PROD_ORIGIN);

        const candidates = [];
        for (const t of tabs) {
          if (!t.url) continue;
          try {
            const u = new URL(t.url);
            const path = u.pathname.toLowerCase();
            const host = u.hostname;

            const isAardvark = path.includes('aardvarkplaylist') || (path.includes('aardvark') && path.includes('playlist'));
            if (!isAardvark) continue;

            // Strictly match only the active mode's domain
            if (isDev) {
              if (host === 'localhost' || host === '127.0.0.1') {
                candidates.push(t);
              }
            } else {
              if (host.endsWith('github.io')) {
                candidates.push(t);
              }
            }
          } catch (e) {}
        }

        if (candidates.length === 0) {
          return null;
        }

        // Ping candidates for the active mode
        for (const tab of candidates) {
          const verified = await this._verifyTab(tab.id, targetOrigin);
          if (verified) {
            this.logAndBroadcast(`Found active ${isDev ? 'Local' : 'Web'} player on tab ${tab.id}: ${tab.url}`);
            this.playerTabId = tab.id;
            this.isAppReady = true;
            this.connectionState = 'CONNECTED';
            return tab.id;
          }
        }

        return null;
      }
  logAndBroadcast(message, type = 'info') {
      console.log(`[YouTubeService] ${message}`);
      this.broadcastStatus({
        type: 'BG_LOG',
        message: message,
        logType: type
      });
    }

  reinjectExistingTabs() {
        this.logAndBroadcast('Checking for existing tabs to re-inject scripts...');

        // Re-inject YouTubeContent into active YouTube tabs and all embedded iframes
        chrome.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
          if (tabs) {
            tabs.forEach((tab) => {
              if (tab.url && !tab.url.startsWith('chrome://')) {
                chrome.scripting.executeScript({
                  target: { tabId: tab.id, allFrames: true },
                  files: ['content/YouTubeContent.js']
                }).catch(() => {});
              }
            });
          }
        });

        // Re-inject PlayerBridge into open player tabs using legal patterns without ports
        const queryPatterns = ['*://localhost/*', '*://127.0.0.1/*', 'https://*.github.io/*'];
        queryPatterns.forEach((pat) => {
          chrome.tabs.query({ url: pat }, (tabs) => {
            if (tabs) {
              tabs.forEach((tab) => {
                if (
                  tab.url &&
                  !tab.url.startsWith('chrome://') &&
                  (tab.url.toLowerCase().includes('aardvarkplaylist') || tab.url.includes(':8080'))
                ) {
                  chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: false },
                    files: ['content/PlayerBridge.js']
                  }).catch(() => {});
                }
              });
            }
          });
        });
      }
  async _verifyTab(tabId, expectedOrigin = null) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !tab.url) return null;

        if (expectedOrigin) {
          const u = new URL(tab.url);
          if (expectedOrigin.includes('github.io') && !u.hostname.endsWith('github.io')) {
            return null;
          }
          if (
            expectedOrigin.includes('localhost') &&
            !u.hostname.includes('localhost') &&
            !u.hostname.includes('127.0.0.1')
          ) {
            return null;
          }
        }

        const resp = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(null), 400);
          chrome.tabs.sendMessage(tabId, { type: 'PING_BRIDGE' }, (r) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) resolve(null);
            else resolve(r);
          });
        });
        return (resp && (resp.success || resp.status === 'ok' || resp.bridgeReady)) ? tabId : null;
      } catch (e) {
        return null;
      }
    }
}