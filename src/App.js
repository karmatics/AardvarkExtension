class App {
  static async run(env) {
    const container = (env && env.container) || document.getElementById('app-container') || document.body;
    const app = new App();
    window.aardvarkExtensionApp = app;
    await app.init(container);
    return app;
  }

  constructor() {
    this.container = null;
    this.selectedParentDir = null;
    this.targetFolderName = 'AardvarkExtension';
    this.extractedCount = 0;
    this.totalFiles = 0;
    this.isUnpacking = false;
    this.currentStep = 1;
    this.browserName = 'Chrome';
  }

  async init(container) {
    this.container = container || document.body;
    this._detectBrowser();
    this._render();
  }

  _detectBrowser() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('browser')) {
      this.browserName = params.get('browser');
      return;
    }
    const ua = navigator.userAgent;
    if (/Edg\//i.test(ua)) this.browserName = 'Edge';
    else if (/Firefox\//i.test(ua)) this.browserName = 'Firefox';
    else if (/Brave/i.test(ua) || navigator.brave) this.browserName = 'Brave';
    else this.browserName = 'Chrome';
  }

  _getExtensionFiles() {
      return [
        'manifest.json',
        'background.js',
        'config.js',
        'contentScript.js',
        'notification.css',
        'popup.html',
        'popup.js',
        'PopupController.js',
        'dictation.html',
        'dictation.js',
        'hand.svg',
        'images/icon16.png',
        'images/icon48.png',
        'images/icon128.png',
        'services/YouTubeService.js',
        'services/BookmarkService.js',
        'content/ContentController.js',
        'content/YoloPageRelayBridge.js',
        'content/YouTubeContent.js',
        'content/GoogleContent.js',
        'content/PlayerBridge.js',
        'utils/DialogBox.js',
        'utils/KeystrokeHandler.js',
        'utils/WindowMessenger.js',
        'utils/applyCss.js',
        'utils/makeElement.js',
        'features/AardvarkOverlay.js',
        'features/AardvarkActions.js',
        'features/AardvarkStyleEditor.js',
        'features/AardvarkRadialMenu.js',
        'features/Aardvark.js',
        'features/AardvarkDictation.js',
        'features/CurveFitter.js',
        'features/DrawingTool.js',
        'features/LlmHelper.js',
        'features/LlmHelperUI.js',
        'features/VideoLooper.js',
        'features/VideoSegment.js',
        'features/SegmentManager.js',
        'features/TimelineUI.js',
        'features/VideoController.js',
        'features/LooperKeystrokeHandler.js',
        'BookMarksOrganizer/index.html',
        'BookMarksOrganizer/css/bookMarksOrganizer.css',
        'BookMarksOrganizer/js/organizerEntry.js',
        'BookMarksOrganizer/js/BookMarksOrganizer.js',
        'BookMarksOrganizer/js/BookMarksOrganizerActionsDialog.js',
        'BookMarksOrganizer/js/BookMarksOrganizerActiveItem.js',
        'BookMarksOrganizer/js/BookMarksOrganizerIO.js',
        'BookMarksOrganizer/js/BookMarksOrganizerMutations.js',
        'BookMarksOrganizer/js/BookMarksOrganizerTreeOps.js',
        'BookMarksOrganizer/js/BookMarksOrganizerUI.js'
      ];
    }

  async _handlePickAndUnpack() {
      if (!window.showDirectoryPicker) {
        if (confirm('Folder picking is not supported by this browser. Would you like to download the extension as a ZIP file instead?')) {
          return this._handleDownloadZip();
        }
        return;
      }

      try {
        this.isUnpacking = true;
        this._updateStatus('Selecting folder...', 'busy');

        const parentHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        this.selectedParentDir = parentHandle;

        this._updateStatus(`Creating "${this.targetFolderName}" folder inside "${parentHandle.name}"...`, 'busy');
        const targetDirHandle = await parentHandle.getDirectoryHandle(this.targetFolderName, { create: true });

        const files = this._getExtensionFiles();
        this.totalFiles = files.length;
        this.extractedCount = 0;

        for (const filePath of files) {
          this._updateStatus(`Unpacking ${filePath} (${this.extractedCount + 1}/${this.totalFiles})...`, 'busy');
          const content = await this._fetchExtensionFile(filePath);
          await this._writeFileNested(targetDirHandle, filePath, content !== null ? content : '');
          this.extractedCount++;
        }

        this.isUnpacking = false;
        this.currentStep = 2;
        this._updateStatus(`🎉 Success! Unpacked ${this.extractedCount} files into "${parentHandle.name} / ${this.targetFolderName}"`, 'success');
        this._render();
      } catch (err) {
        this.isUnpacking = false;
        if (err.name !== 'AbortError') {
          console.error('Unpack error:', err);
          const shouldZip = confirm(`Folder write failed: ${err.message}\n\nWould you like to download the extension as a ZIP file instead? (Recommended across all machines)`);
          if (shouldZip) {
            return this._handleDownloadZip();
          }
          this._updateStatus(`Folder unpack failed: ${err.message}. Try "Download Extension as ZIP" instead.`, 'error');
        } else {
          this._updateStatus('Folder selection cancelled.', 'normal');
        }
      }
    }
  async _writeFileNested(rootDirHandle, relativePath, content) {
    const parts = relativePath.split('/');
    const fileName = parts.pop();
    let currentDir = rootDirHandle;

    for (const folder of parts) {
      currentDir = await currentDir.getDirectoryHandle(folder, { create: true });
    }

    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  _updateStatus(message, state = 'normal') {
    const statusEl = document.getElementById('bmo-install-status');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `status-banner ${state}`;
    }
  }

  _getExtensionsUrl() {
      if (this.browserName === 'Edge') return 'edge://extensions';
      if (this.browserName === 'Brave') return 'brave://extensions';
      if (this.browserName === 'Firefox') return 'about:debugging#/runtime/this-firefox';
      return 'chrome://extensions';
    }

  _render() {
      const extensionsUrl = this._getExtensionsUrl();
      const parentName = this.selectedParentDir ? this.selectedParentDir.name : null;
      const folderDisplayPath = parentName ? `${parentName} / ${this.targetFolderName}` : null;
      const playerUrl = `${window.location.origin}/AardvarkPlaylist/index.html`;

      this.container.innerHTML = `
        <style>
          .aardvark-install-wrap {
            max-width: 1040px;
            margin: 0 auto;
            padding: 40px 24px 80px 24px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e2e8f0;
            line-height: 1.6;
          }

          .hero-banner {
            display: flex;
            align-items: center;
            gap: 28px;
            background: linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 32px;
            margin-bottom: 36px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            backdrop-filter: blur(12px);
          }

          .hero-logo {
            width: 90px;
            height: 90px;
            object-fit: contain;
            filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
            flex-shrink: 0;
          }

          .hero-text h1 {
            margin: 0 0 8px 0;
            font-size: 28px;
            color: #38bdf8;
            font-weight: 800;
            letter-spacing: -0.5px;
          }

          .hero-text p {
            margin: 0;
            font-size: 15px;
            color: #94a3b8;
            max-width: 700px;
          }

          .steps-container {
            display: flex;
            flex-direction: column;
            gap: 24px;
            margin-bottom: 48px;
          }

          .step-card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 12px;
            padding: 24px;
            transition: border-color 0.2s, box-shadow 0.2s;
          }

          .step-card.active {
            border-color: #38bdf8;
            box-shadow: 0 0 20px rgba(56, 189, 248, 0.15);
          }

          .step-card.completed {
            border-color: #22c55e;
          }

          .step-header {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 14px;
          }

          .step-num {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #334155;
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 15px;
            flex-shrink: 0;
          }

          .step-card.active .step-num {
            background: #0284c7;
            color: #fff;
          }

          .step-card.completed .step-num {
            background: #16a34a;
            color: #fff;
          }

          .step-title {
            font-size: 18px;
            font-weight: 700;
            color: #f8fafc;
            margin: 0;
          }

          .action-button-primary {
            background: #0284c7;
            color: #fff;
            font-size: 15px;
            font-weight: 700;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
            transition: background-color 0.15s, transform 0.1s;
          }

          .action-button-primary:hover {
            background: #0369a1;
            transform: translateY(-1px);
          }

          .action-button-secondary {
            background: #1e293b;
            color: #38bdf8;
            font-size: 14px;
            font-weight: 600;
            padding: 12px 20px;
            border: 1px solid #0284c7;
            border-radius: 8px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: all 0.15s;
          }

          .action-button-secondary:hover {
            background: #0284c7;
            color: #fff;
          }

          .copy-pill-btn {
            background: #334155;
            border: 1px solid #475569;
            color: #cbd5e1;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            font-weight: 600;
            transition: background 0.15s, color 0.15s;
          }

          .copy-pill-btn:hover {
            background: #475569;
            color: #fff;
          }

          .status-banner {
            padding: 10px 16px;
            border-radius: 8px;
            font-size: 13px;
            margin-top: 14px;
            display: inline-block;
          }

          .status-banner.normal { background: rgba(51, 65, 85, 0.5); color: #cbd5e1; }
          .status-banner.busy { background: rgba(14, 165, 233, 0.15); border: 1px solid #0284c7; color: #38bdf8; }
          .status-banner.success { background: rgba(34, 197, 94, 0.15); border: 1px solid #16a34a; color: #4ade80; }
          .status-banner.error { background: rgba(239, 68, 68, 0.15); border: 1px solid #dc2626; color: #f87171; }

          .path-callout {
            background: #0f172a;
            border: 1px solid #334155;
            padding: 12px 16px;
            border-radius: 8px;
            font-family: ui-monospace, monospace;
            font-size: 13px;
            color: #38bdf8;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 12px 0;
          }

          .gallery-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-top: 24px;
          }

          .feature-card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 12px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }

          .feature-img-wrapper {
            width: 100%;
            height: 180px;
            background: #0f172a;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            border-bottom: 1px solid #334155;
          }

          .feature-img-wrapper img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .feature-fallback-badge {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            color: #64748b;
            font-size: 11px;
            font-weight: bold;
          }

          .feature-fallback-badge span.icon {
            font-size: 36px;
          }

          .feature-card-content {
            padding: 16px;
            flex: 1;
          }

          .feature-card-content h3 {
            margin: 0 0 6px 0;
            font-size: 15px;
            color: #f8fafc;
          }

          .feature-card-content p {
            margin: 0;
            font-size: 13px;
            color: #94a3b8;
            line-height: 1.45;
          }

          .external-player-link {
            color: #38bdf8;
            text-decoration: none;
            font-weight: 600;
          }
          .external-player-link:hover {
            text-decoration: underline;
          }
        </style>

        <div class="aardvark-install-wrap">
          <div class="hero-banner">
            <img class="hero-logo" src="../AardvarkPlaylist/assets/icons/vark.png" onerror="this.src='./images/icon128.png';" alt="Aardvark" />
            <div class="hero-text">
              <h1>Aardvark Browser Companion</h1>
              <p>
                Connect YouTube directly to your <a href="${playerUrl}" class="external-player-link" target="_blank">Aardvark Music Player</a>.
                Add songs with one click, enjoy 3D visual piano rolls, loop sections, and keep your playlists clean and ad-free.
              </p>
            </div>
          </div>

          <div class="steps-container">
            <!-- STEP 1 -->
            <div class="step-card ${folderDisplayPath ? 'completed' : 'active'}">
              <div class="step-header">
                <div class="step-num">${folderDisplayPath ? '✓' : '1'}</div>
                <h2 class="step-title">1. Get Extension Files onto Your Computer</h2>
              </div>
              <p style="margin: 0 0 14px 0; color: #cbd5e1; font-size: 14px;">
                Choose either method below. <b>Download as ZIP</b> works on any computer and browser without folder permissions:
              </p>
              <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                <button id="bmo-download-zip-btn" class="action-button-primary">
                  📦 Download Extension as ZIP (.zip)
                </button>
                <button id="bmo-pick-btn" class="action-button-secondary">
                  📁 Unpack Directly to Folder
                </button>
              </div>
              <div id="bmo-install-status" class="status-banner ${folderDisplayPath ? 'success' : 'normal'}">
                ${folderDisplayPath ? `✓ Ready in: ${folderDisplayPath}` : 'Ready to download ZIP or select folder...'}
              </div>
            </div>

            <!-- STEP 2 -->
            <div class="step-card ${folderDisplayPath ? 'active' : ''}">
              <div class="step-header">
                <div class="step-num">2</div>
                <h2 class="step-title">2. Open Extensions in ${this.browserName}</h2>
              </div>
              <p style="margin: 0 0 10px 0; color: #cbd5e1; font-size: 14px;">
                Open a new tab and paste this into your address bar, then press Enter:
              </p>
              <div class="path-callout">
                <span>${extensionsUrl}</span>
                <button class="copy-pill-btn" onclick="navigator.clipboard.writeText('${extensionsUrl}'); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1500);">Copy</button>
              </div>
              <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 13px;">
                👉 In the top right corner of the Extensions page, make sure the <b>Developer mode</b> toggle is turned <b>ON</b>.
              </p>
            </div>

            <!-- STEP 3 -->
            <div class="step-card">
              <div class="step-header">
                <div class="step-num">3</div>
                <h2 class="step-title">3. Click "Load Unpacked" & Select Extension Folder</h2>
              </div>
              <p style="margin: 0 0 10px 0; color: #cbd5e1; font-size: 14px;">
                In ${this.browserName}, click the <b>Load unpacked</b> button in the top left, then select:
              </p>
              <div class="path-callout">
                <span>📁 ${folderDisplayPath || '[Your Extracted AardvarkExtension Folder]'}</span>
                ${folderDisplayPath ? `<button class="copy-pill-btn" onclick="navigator.clipboard.writeText('${folderDisplayPath}'); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1500);">Copy</button>` : ''}
              </div>
              <p style="margin: 8px 0 0 0; color: #4ade80; font-size: 13px; font-weight: 600;">
                ✨ That's it! The Aardvark icon will appear in your extensions bar. Pin it for quick access!
              </p>
            </div>
          </div>

          <h2 style="font-size: 20px; font-weight: 800; color: #f8fafc; margin: 0 0 6px 0;">What Aardvark Gives You</h2>
          <p style="margin: 0 0 18px 0; color: #94a3b8; font-size: 14px;">Explore the features built into your browser companion:</p>

          <div class="gallery-grid">
            <div class="feature-card">
              <div class="feature-img-wrapper">
                <img src="./assets/screenshots/01-youtube-queue.png" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" alt="YouTube Queue Button" />
                <div class="feature-fallback-badge" style="display:none;">
                  <span class="icon">▶️</span>
                  <span>assets/screenshots/01-youtube-queue.png</span>
                </div>
              </div>
              <div class="feature-card-content">
                <h3>One-Click YouTube Queuing</h3>
                <p>Adds subtle "▶" buttons directly onto YouTube search results, channels, and video watch pages to queue songs seamlessly.</p>
              </div>
            </div>

            <div class="feature-card">
              <div class="feature-img-wrapper">
                <img src="./assets/screenshots/02-player-view.png" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" alt="Ad-Free Player" />
                <div class="feature-fallback-badge" style="display:none;">
                  <span class="icon">🎬</span>
                  <span>assets/screenshots/02-player-view.png</span>
                </div>
              </div>
              <div class="feature-card-content">
                <h3>Distraction-Free Video Player</h3>
                <p>Streamlined playback without comments, algorithms, or banner clutter. Perfect for focused listening and study sessions.</p>
              </div>
            </div>

            <div class="feature-card">
              <div class="feature-img-wrapper">
                <img src="./assets/screenshots/03-3d-piano-roll.png" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" alt="3D Piano Roll" />
                <div class="feature-fallback-badge" style="display:none;">
                  <span class="icon">🎹</span>
                  <span>assets/screenshots/03-3d-piano-roll.png</span>
                </div>
              </div>
              <div class="feature-card-content">
                <h3>Interactive 3D Piano Visuals</h3>
                <p>Watch cascading notes sync with audio in real time. Plug in any USB or Bluetooth MIDI keyboard to play along!</p>
              </div>
            </div>

            <div class="feature-card">
              <div class="feature-img-wrapper">
                <img src="./assets/screenshots/04-chrome-extensions.png" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" alt="Load Unpacked" />
                <div class="feature-fallback-badge" style="display:none;">
                  <span class="icon">🧩</span>
                  <span>assets/screenshots/04-chrome-extensions.png</span>
                </div>
              </div>
              <div class="feature-card-content">
                <h3>Private & Completely Local</h3>
                <p>No tracking or data collection. The extension runs directly on your computer from the unpacked folder you control.</p>
              </div>
            </div>

            <div class="feature-card">
              <div class="feature-img-wrapper">
                <img src="./assets/screenshots/05-video-looper.png" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" alt="Video Looper" />
                <div class="feature-fallback-badge" style="display:none;">
                  <span class="icon">🔁</span>
                  <span>assets/screenshots/05-video-looper.png</span>
                </div>
              </div>
              <div class="feature-card-content">
                <h3>Frame-Accurate Video Looper</h3>
                <p>Loop difficult musical phrases or sports clips seamlessly with customizable repeat counters and speed shifting.</p>
              </div>
            </div>

            <div class="feature-card">
              <div class="feature-img-wrapper">
                <img src="./assets/screenshots/06-radial-menu.png" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" alt="Power Tools" />
                <div class="feature-fallback-badge" style="display:none;">
                  <span class="icon">⚡</span>
                  <span>assets/screenshots/06-radial-menu.png</span>
                </div>
              </div>
              <div class="feature-card-content">
                <h3>Built-In Power Tools</h3>
                <p>Includes speech-to-text dictation, on-screen drawing annotations, and page element inspection utilities.</p>
              </div>
            </div>
          </div>
        </div>
      `;

      const zipBtn = document.getElementById('bmo-download-zip-btn');
      if (zipBtn) {
        zipBtn.onclick = () => this._handleDownloadZip();
      }

      const pickBtn = document.getElementById('bmo-pick-btn');
      if (pickBtn) {
        pickBtn.onclick = () => this._handlePickAndUnpack();
      }
    }
  _crc32(bytes) {
      let c = 0xffffffff;
      const table = App._crcTable || (App._crcTable = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let n = i;
          for (let k = 0; k < 8; k++) n = (n & 1) ? (0xedb88320 ^ (n >>> 1)) : (n >>> 1);
          t[i] = n >>> 0;
        }
        return t;
      })());
      for (let i = 0; i < bytes.length; i++) {
        c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      }
      return (c ^ 0xffffffff) >>> 0;
    }

  _createZip(filesMap) {
      const textEncoder = new TextEncoder();
      const fileRecords = [];
      let offset = 0;

      const now = new Date();
      const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
      const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

      for (const rawPath in filesMap) {
        if (!Object.prototype.hasOwnProperty.call(filesMap, rawPath)) continue;
        const cleanPath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
        const content = filesMap[rawPath];
        if (content === undefined || content === null) continue;

        let dataBytes;
        if (content instanceof Uint8Array) {
          dataBytes = content;
        } else if (content instanceof ArrayBuffer) {
          dataBytes = new Uint8Array(content);
        } else {
          dataBytes = textEncoder.encode(String(content));
        }

        const nameBytes = textEncoder.encode(cleanPath);
        const fileCrc = this._crc32(dataBytes);

        const localHeader = new Uint8Array(30 + nameBytes.length + dataBytes.length);
        const view = new DataView(localHeader.buffer);

        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0, true);
        view.setUint16(8, 0, true); // Store (no compression)
        view.setUint16(10, dosTime, true);
        view.setUint16(12, dosDate, true);
        view.setUint32(14, fileCrc, true);
        view.setUint32(18, dataBytes.length, true);
        view.setUint32(22, dataBytes.length, true);
        view.setUint16(26, nameBytes.length, true);
        view.setUint16(28, 0, true);

        localHeader.set(nameBytes, 30);
        localHeader.set(dataBytes, 30 + nameBytes.length);

        fileRecords.push({
          nameBytes,
          crc: fileCrc,
          size: dataBytes.length,
          offset
        });

        offset += localHeader.length;
      }

      let centralDirSize = 0;
      const centralHeaders = [];

      for (let j = 0; j < fileRecords.length; j++) {
        const r = fileRecords[j];
        const cdHeader = new Uint8Array(46 + r.nameBytes.length);
        const cdView = new DataView(cdHeader.buffer);

        cdView.setUint32(0, 0x02014b50, true);
        cdView.setUint16(4, 20, true);
        cdView.setUint16(6, 20, true);
        cdView.setUint16(8, 0, true);
        cdView.setUint16(10, 0, true);
        cdView.setUint16(12, dosTime, true);
        cdView.setUint16(14, dosDate, true);
        cdView.setUint32(16, r.crc, true);
        cdView.setUint32(20, r.size, true);
        cdView.setUint32(24, r.size, true);
        cdView.setUint16(28, r.nameBytes.length, true);
        cdView.setUint16(30, 0, true);
        cdView.setUint16(32, 0, true);
        cdView.setUint16(34, 0, true);
        cdView.setUint16(36, 0, true);
        cdView.setUint32(38, 0x81a40000, true);
        cdView.setUint32(42, r.offset, true);

        cdHeader.set(r.nameBytes, 46);
        centralHeaders.push(cdHeader);
        centralDirSize += cdHeader.length;
      }

      const eocd = new Uint8Array(22);
      const eocdView = new DataView(eocd.buffer);
      eocdView.setUint32(0, 0x06054b50, true);
      eocdView.setUint16(4, 0, true);
      eocdView.setUint16(6, 0, true);
      eocdView.setUint16(8, fileRecords.length, true);
      eocdView.setUint16(10, fileRecords.length, true);
      eocdView.setUint32(12, centralDirSize, true);
      eocdView.setUint32(16, offset, true);
      eocdView.setUint16(20, 0, true);

      const blobParts = [];
      for (let k = 0; k < fileRecords.length; k++) {
        blobParts.push(fileRecords[k].localHeader);
      }
      for (let m = 0; m < centralHeaders.length; m++) {
        blobParts.push(centralHeaders[m]);
      }
      blobParts.push(eocd);

      return new Blob(blobParts, { type: 'application/zip' });
    }

  async _fetchExtensionFile(filePath) {
      const loc = window.location;
      const origin = loc.origin;
      const dirPath = loc.pathname.substring(0, loc.pathname.lastIndexOf('/') + 1);
      const isBinary = /\.(png|jpe?g|gif|webp|ico|wasm)$/i.test(filePath);

      const candidateUrls = [
        new URL(filePath, loc.href).href,
        `${origin}${dirPath}${filePath}`,
        `${origin}${dirPath}extension/${filePath}`,
        `/AardvarkExtension/${filePath}`,
        `/AardvarkExtension/extension/${filePath}`,
        `./${filePath}`,
        `./extension/${filePath}`
      ];

      for (const candidate of candidateUrls) {
        try {
          const res = await fetch(candidate);
          if (res.ok) {
            if (isBinary) {
              const buf = await res.arrayBuffer();
              return new Uint8Array(buf);
            } else {
              const text = await res.text();
              if ((filePath.endsWith('.js') || filePath.endsWith('.json') || filePath.endsWith('.css')) &&
                  (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html'))) {
                continue;
              }
              return text;
            }
          }
        } catch (err) {}
      }
      return null;
    }

  async _handleDownloadZip() {
      try {
        this.isUnpacking = true;
        this._updateStatus('Packaging extension files into ZIP...', 'busy');

        const files = this._getExtensionFiles();
        const filesMap = {};
        let fetchedCount = 0;

        for (const filePath of files) {
          this._updateStatus(`Packaging ${filePath} (${fetchedCount + 1}/${files.length})...`, 'busy');
          const content = await this._fetchExtensionFile(filePath);
          if (content !== null) {
            filesMap[filePath] = content;
            fetchedCount++;
          } else {
            console.warn(`Could not fetch ${filePath}; packaging empty placeholder.`);
            filesMap[filePath] = '';
          }
        }

        this._updateStatus('Building AardvarkExtension.zip...', 'busy');
        const zipBlob = this._createZip(filesMap);
        const blobUrl = URL.createObjectURL(zipBlob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'AardvarkExtension.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);

        this.isUnpacking = false;
        this.currentStep = 2;
        this._updateStatus(`🎉 Downloaded AardvarkExtension.zip (${(zipBlob.size / 1024).toFixed(1)} KB)! Unzip it on your other machine and load in ${this.browserName}.`, 'success');
        this._render();
      } catch (err) {
        this.isUnpacking = false;
        console.error('ZIP download error:', err);
        this._updateStatus(`Error generating ZIP: ${err.message}`, 'error');
      }
    }
}

globalThis.App = App;
if (typeof module !== 'undefined' && module.exports) module.exports = App;