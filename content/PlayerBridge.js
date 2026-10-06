(() => {
  if (window !== window.top) return;
  if (window.__aardvarkPlayerBridgeLoaded) return;
  window.__aardvarkPlayerBridgeLoaded = true;

  const sessionId = 'bridge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  let isAppReady = false;
  const pendingQueue = [];

  function flushPendingQueue() {
    if (!isAppReady || pendingQueue.length === 0) return;
    const items = [...pendingQueue];
    pendingQueue.length = 0;
    items.forEach((payload) => {
      window.postMessage({ type: 'YT_BRIDGE_TO_PAGE', payload }, '*');
      window.postMessage(payload, '*');
    });
  }

  // 1. Listen for background messages (YouTubeService.js)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;

    if (message.type === 'PING_BRIDGE') {
      sendResponse({
        success: true,
        status: 'ok',
        bridgeReady: true,
        sessionId,
        pageReady: isAppReady,
        appReady: isAppReady
      });
      return true;
    }

    // Extract inner payload if wrapped
    const inner = (message.type === 'YT_BRIDGE_TO_PAGE' && message.payload) ? message.payload : message;

    if (!isAppReady) {
      console.log('[PlayerBridge] Buffering incoming video command until app is ready:', inner.type);
      pendingQueue.push(inner);
      sendResponse({ status: 'buffered', sessionId });
      try {
        const bootMsg = document.getElementById('aardvark-boot-msg');
        if (bootMsg && inner.title) {
          bootMsg.textContent = 'Queuing: ' + inner.title;
        }
      } catch (e) {}
    } else {
      window.postMessage({ type: 'YT_BRIDGE_TO_PAGE', payload: inner }, '*');
      window.postMessage(inner, '*');
      sendResponse({ status: 'relayed', sessionId });
    }
    return true;
  });

  // 2. Listen for messages from the Player Web Page (CoopManager.js)
  window.addEventListener('message', (event) => {
    let data = event.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return; }
    }
    if (!data || typeof data !== 'object') return;

    let type = data.type;
    let payload = data;
    if (type === 'PAGE_TO_YT_BRIDGE' && data.payload) {
      type = data.payload.type;
      payload = data.payload;
    }

    if (type === 'PLAYER_READY' || type === 'HANDSHAKE') {
      isAppReady = true;
      flushPendingQueue();
      try {
        chrome.runtime.sendMessage({
          type: 'PLAYER_READY',
          sessionId,
          payload
        });
      } catch (err) {}
    }

    if (type === 'APP_ACK' || type === 'SYNC_PLAYLIST') {
      try {
        chrome.runtime.sendMessage({
          type: type,
          sessionId,
          payload
        });
      } catch (err) {}
    }
  });

  // 3. Announce existence on load
  try {
    chrome.runtime.sendMessage({ type: 'BRIDGE_HEARTBEAT', sessionId });
  } catch (e) {}
  window.postMessage({ type: 'BRIDGE_HEARTBEAT', sessionId }, '*');
})();