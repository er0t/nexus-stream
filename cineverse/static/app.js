/**
 * CineVerse — Mobile Native Streaming App Logic
 * Designed for Android App & Mobile Screen Experience.
 */

// Dynamic Host Detection: Standalone Android APK vs Local Web Dev
function getApiBase() {
  // If running inside standalone Android Capacitor APK, all /api calls are intercepted device-side in MainActivity.java!
  const isNativeCapacitor = (typeof window !== 'undefined' && window.Capacitor !== undefined) || 
                            window.location.protocol === 'capacitor:' || 
                            (window.location.hostname === 'localhost' && window.location.port === '');
  
  if (isNativeCapacitor) {
    return ''; // Device-side native OkHttp proxy in MainActivity.java handles it
  }

  const saved = localStorage.getItem('cineverse_api_host');
  if (saved) return saved.replace(/\/+$/, '');

  if (window.location.protocol.startsWith('http') && (window.location.port === '8000' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return window.location.origin;
  }
  return 'http://192.168.11.181:8000';
}

let API_BASE = getApiBase();

// ==========================================================================
// Toast & Native Error Notification System
// ==========================================================================
let toastActiveTimer = null;

function showToast(msg, duration = 3200) {
  if (!msg) return;

  // 1. Trigger Native Android system Toast if available via MainActivity bridge
  if (window.AndroidBridge && typeof window.AndroidBridge.showToast === 'function') {
    try { window.AndroidBridge.showToast(msg); } catch (e) {}
  }

  // 2. Render in-DOM Toast Notification for unified TV & mobile experience
  let container = document.getElementById('nexus-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'nexus-toast-container';
    container.className = 'nexus-toast-container';
    document.body.appendChild(container);
  }

  container.innerHTML = '';

  const toast = document.createElement('div');
  toast.className = 'nexus-toast';
  toast.innerHTML = `
    <span class="nexus-toast-icon">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    </span>
    <span class="nexus-toast-text">${msg}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  clearTimeout(toastActiveTimer);
  toastActiveTimer = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 280);
  }, duration);
}
window.showToast = showToast;

window.onNativeStreamError = function (errorMsg) {
  console.warn('[Nexus TV] Native Stream Error caught:', errorMsg);
  const video = document.getElementById('native-video');
  const spinner = document.getElementById('player-spinner');
  const notice = document.getElementById('player-notice');
  const noticeMsg = document.getElementById('player-notice-msg');
  const centerCtrl = document.getElementById('player-center-controls');

  if (spinner) spinner.style.display = 'none';
  if (centerCtrl) centerCtrl.style.display = 'none';

  if (video) {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.classList.remove('active-stream');
    } catch (e) {}
  }

  if (notice) {
    if (noticeMsg) {
      noticeMsg.textContent = errorMsg || 'Stream playback error. Please try another quality or title.';
    }
    notice.style.display = 'flex';
  }

  showToast(errorMsg || 'Stream failed to load from CDN');
};

// App State
let allHomeSections = [];
let currentDetailData = null;
let currentDetailSubject = null;
let currentStreams = [];
let currentSeasonIdx = 0;
let searchTimer = null;
const detailCache = new Map();
let currentOpeningId = null;

async function fetchDetail(subjectId) {
  if (detailCache.has(subjectId)) {
    return detailCache.get(subjectId);
  }
  const res = await fetch(`${API_BASE}/api/detail/${subjectId}`);
  const data = await res.json();
  detailCache.set(subjectId, data);
  return data;
}

function prefetchDetail(subjectId) {
  if (!subjectId || detailCache.has(subjectId)) return;
  fetchDetail(subjectId).catch(() => {});
}

// ==========================================================================
// Watch History & Resume Playback System
// ==========================================================================
const WATCH_HISTORY_KEY = 'nexustv_watch_history';
let currentPlaybackMeta = null;
let lastSavedProgressTime = 0;

const WatchHistory = {
  getAll() {
    try {
      const raw = localStorage.getItem(WATCH_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  save(entry) {
    if (!entry || (!entry.id && !entry.subjectId)) return;
    try {
      const subjectId = String(entry.subjectId || entry.id);
      let list = this.getAll();
      list = list.filter(item => String(item.id || item.subjectId) !== subjectId);

      const posMs = entry.positionMs || Math.round((entry.currentTime || 0) * 1000);
      const durMs = entry.durationMs || Math.round((entry.duration || 0) * 1000);
      const curTime = entry.currentTime !== undefined ? entry.currentTime : (posMs / 1000);
      const totalDur = entry.duration !== undefined ? entry.duration : (durMs / 1000);

      // If finished (>92% watched)
      if (totalDur > 0 && (curTime / totalDur) >= 0.92) {
        if (entry.subjectType === 2 && currentDetailData && currentDetailData.seasons) {
          const nextEp = findNextEpisode(currentDetailData.seasons, entry.season, entry.episode);
          if (nextEp) {
            entry.season = nextEp.season;
            entry.episode = nextEp.episode;
            entry.title = entry.title.replace(/\s+S\d+:E\d+/, '') + ` S${nextEp.season}:E${nextEp.episode}`;
            entry.currentTime = 0;
            entry.positionMs = 0;
            entry.progressPercent = 0;
            entry.timestamp = Date.now();
            entry.updatedAt = Date.now();
            list.unshift(entry);
          }
        }
      } else if (curTime > 5 || posMs > 5000) {
        let progress = 0;
        if (durMs > 0 && posMs > 0) {
          progress = Math.min(100, Math.max(0, Math.round((posMs * 100) / durMs)));
        }
        const record = {
          subjectId: subjectId,
          id: subjectId,
          title: entry.title || 'Untitled',
          poster: entry.poster || entry.cover || '',
          cover: entry.cover || entry.poster || '',
          season: Number(entry.season) || 0,
          episode: Number(entry.episode) || 0,
          positionMs: posMs,
          durationMs: durMs,
          currentTime: curTime,
          duration: totalDur,
          progressPercent: progress,
          subjectType: Number(entry.subjectType) || 1,
          detailPath: entry.detailPath || '',
          timestamp: entry.timestamp || Date.now(),
          updatedAt: Date.now()
        };
        list.unshift(record);
      }

      if (list.length > 20) list = list.slice(0, 20);
      localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(list));
      renderContinueWatchingRail();
    } catch (e) {
      console.warn('[WatchHistory] Save error:', e);
    }
  },

  remove(id) {
    try {
      let list = this.getAll();
      list = list.filter(item => item.id !== id);
      localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(list));
      renderContinueWatchingRail();
    } catch (e) {}
  },

  getResumePoint(id, season = 0, episode = 0) {
    const list = this.getAll();
    const found = list.find(item => item.id === id);
    if (found) {
      if (found.subjectType === 2) {
        if (found.season === season && found.episode === episode) {
          return found.currentTime || 0;
        }
      } else {
        return found.currentTime || 0;
      }
    }
    return 0;
  }
};

// ==========================================================================
// My Watchlist / Favorites Management
// ==========================================================================
const WATCHLIST_KEY = 'nexustv_watchlist';
let currentWatchlistFilter = 'all';

const Watchlist = {
  getAll() {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  has(id) {
    if (!id) return false;
    const list = this.getAll();
    return list.some(item => String(item.id) === String(id));
  },

  add(item) {
    if (!item || !item.id) return;
    let list = this.getAll().filter(x => String(x.id) !== String(item.id));
    list.unshift({
      id: String(item.id),
      title: item.title || 'Untitled',
      cover: item.cover || '',
      subjectType: Number(item.subjectType) || 1,
      releaseDate: item.releaseDate || item.year || '',
      score: item.score || item.rating || '8.5',
      genre: item.genre || '',
      detailPath: item.detailPath || '',
      addedAt: Date.now()
    });
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[Watchlist] Save error:', e);
    }
  },

  remove(id) {
    if (!id) return;
    let list = this.getAll().filter(x => String(x.id) !== String(id));
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    } catch (e) {}
  },

  toggle(item) {
    if (!item || !item.id) return false;
    if (this.has(item.id)) {
      this.remove(item.id);
      return false;
    } else {
      this.add(item);
      return true;
    }
  }
};

function renderWatchlistView(filter = 'all') {
  currentWatchlistFilter = filter;
  const grid = document.getElementById('watchlist-grid');
  const countBadge = document.getElementById('watchlist-count-badge');
  if (!grid) return;

  const allItems = Watchlist.getAll();
  let filtered = allItems;
  if (filter === 'movies') {
    filtered = allItems.filter(x => Number(x.subjectType) === 1);
  } else if (filter === 'series') {
    filtered = allItems.filter(x => Number(x.subjectType) === 2);
  }

  if (countBadge) {
    countBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'Title' : 'Titles'}`;
  }

  if (filtered.length === 0) {
    const emptyDesc = filter === 'all'
      ? 'Tap "+ Watchlist" on any movie or series to save it for quick access.'
      : `No ${filter} saved in your watchlist yet.`;

    grid.innerHTML = `
      <div class="watchlist-empty-state">
        <div class="watchlist-empty-icon">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <h3 class="watchlist-empty-title">Your Watchlist is Empty</h3>
        <p class="watchlist-empty-desc">${emptyDesc}</p>
        <button class="watchlist-explore-btn" id="watchlist-explore-btn" tabindex="0">Explore Catalog</button>
      </div>
    `;

    const exploreBtn = document.getElementById('watchlist-explore-btn');
    if (exploreBtn) {
      exploreBtn.onclick = () => switchView('view-home');
    }
    return;
  }

  grid.innerHTML = '';
  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'app-card';
    card.setAttribute('tabindex', '0');
    const posterUrl = downsampleImageUrl(item.cover, 'poster');
    card.dataset.id = item.id;
    card.dataset.title = item.title || '';
    card.dataset.cover = posterUrl;
    card.dataset.score = item.score || '8.5';
    card.dataset.year = item.releaseDate ? item.releaseDate.split('-')[0] : '';
    card.dataset.genre = item.genre || '';
    card.dataset.subjectType = item.subjectType || 1;
    card.dataset.detailPath = item.detailPath || '';
    card.dataset.description = item.description || '';

    card.addEventListener('focus', () => {
      if (typeof window.setupHero === 'function') {
        window.setupHero(card.dataset);
      }
    });

    card.innerHTML = `
      <div class="card-poster">
        <img src="${posterUrl}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async">
        <span class="card-type-tag">${Number(item.subjectType) === 2 ? 'Series' : 'Movie'}</span>
        <div class="card-badge-rating">★ ${item.score || '8.5'}</div>
      </div>
      <div class="card-meta-box">
        <div class="card-name" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="card-sub">${item.releaseDate ? item.releaseDate.split('-')[0] : ''} ${Number(item.subjectType) === 2 ? '• Series' : '• Movie'}</div>
      </div>
    `;

    card.addEventListener('pointerdown', () => prefetchDetail(item.id), { passive: true });

    card.onclick = () => {
      openDetailSheet(item.id, {
        title: item.title,
        cover: item.cover,
        year: item.releaseDate ? item.releaseDate.split('-')[0] : '',
        type: Number(item.subjectType) === 2 ? 'TV SERIES' : 'MOVIE'
      });
    };

    grid.appendChild(card);
  });
}

function initWatchlistView() {
  const chips = document.querySelectorAll('#watchlist-filter-chips .watchlist-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const filter = chip.getAttribute('data-filter') || 'all';
      renderWatchlistView(filter);
    });
  });
}

function extractEpNumber(item, index) {
  if (item.episodeNumber) return parseInt(item.episodeNumber, 10);
  if (item.episode) return parseInt(item.episode, 10);
  if (item.ep) return parseInt(item.ep, 10);
  const str = item.name || item.title || "";
  const match = str.match(/(?:E|EP|Episode|\d+x)[.\s_-]*(\d+)/i) || str.match(/^(\d+)[.\s_-]/);
  return match ? parseInt(match[1], 10) : (index + 1);
}

function findNextEpisode(seasons, currentSeason, currentEpisode) {
  if (!seasons || seasons.length === 0) return null;
  const sIdx = seasons.findIndex(s => s.season === currentSeason);
  if (sIdx !== -1) {
    const currentSeasonObj = seasons[sIdx];
    const epIdx = (currentSeasonObj.episodes || []).findIndex(e => e.episode === currentEpisode);
    if (epIdx !== -1 && epIdx < currentSeasonObj.episodes.length - 1) {
      const nextEp = currentSeasonObj.episodes[epIdx + 1];
      return { season: currentSeason, episode: nextEp.episode, title: nextEp.title };
    }
    if (sIdx < seasons.length - 1) {
      const nextSeasonObj = seasons[sIdx + 1];
      if (nextSeasonObj.episodes && nextSeasonObj.episodes.length > 0) {
        const nextEp = nextSeasonObj.episodes[0];
        return { season: nextSeasonObj.season, episode: nextEp.episode, title: nextEp.title };
      }
    }
  }
  return null;
}

function renderContinueWatchingRail() {
  const container = document.getElementById('continue-watching-section');
  if (!container) return;

  const history = WatchHistory.getAll();
  if (history.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div class="rail-header">
      <h2 class="rail-title">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#38BDF8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:8px;">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        Continue Watching
      </h2>
    </div>
    <div class="rail-track continue-watching-track" id="continue-watching-track"></div>
  `;

  const track = document.getElementById('continue-watching-track');
  history.forEach(item => {
    const card = document.createElement('div');
    card.className = 'continue-card app-card';
    card.tabIndex = 0;

    const pos = item.positionMs || Math.round((item.currentTime || 0) * 1000);
    const dur = item.durationMs || Math.round((item.duration || 0) * 1000);
    const remainingSecs = Math.max(0, (dur > 0 ? (dur - pos) / 1000 : 0));
    const remainingMins = Math.round(remainingSecs / 60);
    const timeLabel = remainingMins > 0 ? `${remainingMins}m left` : 'Resume';
    const subLabel = item.subjectType === 2 
      ? `S${item.season} : E${item.episode} • ${timeLabel}`
      : `${timeLabel}`;

    let progress = 0;
    if (dur > 0 && pos > 0) {
      progress = Math.min(100, Math.max(0, Math.round((pos * 100) / dur)));
    }

    card.innerHTML = `
      <div class="continue-thumb-box">
        <img src="${item.poster || item.cover || ''}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity='0'; this.parentElement.classList.add('fallback-thumb');">
        <div class="continue-play-overlay">
          <div class="continue-play-bubble">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
        </div>
        <button class="continue-remove-btn" title="Remove from list" tabindex="-1">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <div class="continue-progress-bar" style="${(dur > 0 && pos > 0) ? '' : 'display: none;'}">
          <div class="continue-progress-fill" style="width: ${progress}%"></div>
        </div>
      </div>
      <div class="continue-meta-box">
        <div class="continue-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="continue-sub">${subLabel}</div>
      </div>
    `;

    const removeBtn = card.querySelector('.continue-remove-btn');
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      WatchHistory.remove(item.id || item.subjectId);
    };

    card.onclick = () => {
      const fullTitle = item.subjectType === 2 
        ? `${item.title.replace(/\s+S\d+:E\d+/, '')} S${item.season}:E${item.episode}`
        : item.title;
      const resumeSecs = pos > 0 ? (pos / 1000) : (item.currentTime || 0);
      playStream(item.id || item.subjectId, fullTitle, item.season || 0, item.episode || 0, item.detailPath, resumeSecs);
    };

    track.appendChild(card);
  });
}

// ==========================================================================
// In-App Auto-Updater Engine
// ==========================================================================
const CURRENT_APP_VERSION_CODE = 1;

async function checkForUpdates(isManual = false) {
  try {
    const res = await fetch(`${API_BASE}/api/version`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    let installedCode = CURRENT_APP_VERSION_CODE;
    if (window.AndroidBridge && window.AndroidBridge.getAppVersionCode) {
      try {
        installedCode = window.AndroidBridge.getAppVersionCode();
      } catch (e) {}
    }

    console.log(`[AutoUpdater] Installed: ${installedCode}, Remote: ${data.versionCode}`);

    if (data.versionCode > installedCode) {
      showUpdateModal(data);
    } else if (isManual) {
      showToast(`Nexus TV is up to date (v${data.versionName || '1.1.0'})`);
    }
  } catch (err) {
    console.warn('[AutoUpdater] Check error:', err);
    if (isManual) {
      showToast('Could not reach update server. Check WiFi connection.');
    }
  }
}

function showUpdateModal(info) {
  const modal = document.getElementById('update-modal');
  if (!modal) return;

  const pill = document.getElementById('update-version-pill');
  const summary = document.getElementById('update-summary-text');
  const notesList = document.getElementById('update-notes-list');
  const progressWrap = document.getElementById('update-progress-wrap');
  const laterBtn = document.getElementById('update-later-btn');
  const nowBtn = document.getElementById('update-now-btn');

  if (pill) pill.textContent = `v${info.versionName || '1.1.0'} AVAILABLE`;
  if (summary) summary.textContent = `A new version of Nexus TV is ready with updated features (${info.fileSize || '8.15 MB'}).`;

  if (notesList) {
    notesList.innerHTML = '';
    const notes = info.releaseNotes || ['New performance enhancements and features.'];
    notes.forEach(note => {
      const li = document.createElement('li');
      li.textContent = note;
      notesList.appendChild(li);
    });
  }

  if (progressWrap) progressWrap.style.display = 'none';

  if (info.forceUpdate && laterBtn) {
    laterBtn.style.display = 'none';
  } else if (laterBtn) {
    laterBtn.style.display = 'block';
    laterBtn.onclick = () => {
      modal.style.display = 'none';
    };
  }

  nowBtn.onclick = () => {
    startApkDownload(info.downloadUrl || '/download');
  };

  modal.style.display = 'flex';

  if (window.SpatialNav && window.SpatialNav.isTvMode()) {
    setTimeout(() => {
      window.SpatialNav.setFocus(nowBtn);
    }, 100);
  }
}

function startApkDownload(downloadUrl) {
  const progressWrap = document.getElementById('update-progress-wrap');
  const fill = document.getElementById('update-progress-fill');
  const percentText = document.getElementById('update-percent-text');
  const statusText = document.getElementById('update-status-text');
  const nowBtn = document.getElementById('update-now-btn');
  const laterBtn = document.getElementById('update-later-btn');
  const modal = document.getElementById('update-modal');

  if (progressWrap) progressWrap.style.display = 'block';
  if (nowBtn) {
    nowBtn.disabled = true;
    nowBtn.style.opacity = '0.7';
    nowBtn.textContent = 'Opening Download...';
  }
  if (laterBtn) laterBtn.style.display = 'none';

  const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${API_BASE}${downloadUrl}`;

  if (fill) fill.style.width = '100%';
  if (percentText) percentText.textContent = '100%';
  if (statusText) statusText.textContent = 'Starting APK download in browser...';

  setTimeout(() => {
    if (window.AndroidBridge && window.AndroidBridge.openDownloadUrl) {
      window.AndroidBridge.openDownloadUrl(fullUrl);
    } else {
      window.location.href = fullUrl;
    }
    showToast('Download started. Open downloaded APK to install update.');
    if (modal) {
      setTimeout(() => { modal.style.display = 'none'; }, 1800);
    }
  }, 400);
}

function initUpdater() {
  const checkBtn = document.getElementById('check-update-btn');
  if (checkBtn) {
    checkBtn.onclick = () => checkForUpdates(true);
  }
  setTimeout(() => checkForUpdates(false), 2500);
}

document.addEventListener('DOMContentLoaded', () => {
  initBottomNav();
  initServerConfig();
  initHomeFeed();
  initSearch();
  initWatchlistView();
  initSheetListeners();
  initPlayerListeners();
  initUpdater();
});

// ==========================================================================
// 1. Navigation & Server Config
// ==========================================================================
function initBottomNav() {
  const tabs = document.querySelectorAll('.nav-tab');
  const sidebarItems = document.querySelectorAll('.tv-sidebar-item');

  tabs.forEach(tab => {
    // 0ms instantaneous switch on touch (eliminates mobile 300ms click delay)
    tab.addEventListener('pointerdown', (e) => {
      const targetId = tab.getAttribute('data-tab');
      if (!tab.classList.contains('active')) {
        switchView(targetId);
      }
    });

    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = tab.getAttribute('data-tab');
      if (!tab.classList.contains('active')) {
        switchView(targetId);
      }
    });
  });

  sidebarItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const targetId = item.getAttribute('data-tab');
      if (!item.classList.contains('active')) {
        switchView(targetId);
      }
    });
  });

  // Top header search icon triggers Search view
  const headerSearch = document.getElementById('nav-search-trigger');
  if (headerSearch) {
    headerSearch.onclick = () => {
      switchView('view-search');
      document.getElementById('main-search-input').focus();
    };
  }
}

function switchView(viewId) {
  // Always guarantee page scrolling is free and never locked
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';

  const views = document.querySelectorAll('.view-panel');
  const tabs = document.querySelectorAll('.nav-tab');
  const sidebarItems = document.querySelectorAll('.tv-sidebar-item');

  for (let i = 0; i < views.length; i++) {
    if (views[i].id === viewId) {
      views[i].classList.add('active');
    } else {
      views[i].classList.remove('active');
    }
  }

  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute('data-tab') === viewId) {
      tabs[i].classList.add('active');
    } else {
      tabs[i].classList.remove('active');
    }
  }

  for (let i = 0; i < sidebarItems.length; i++) {
    if (sidebarItems[i].getAttribute('data-tab') === viewId) {
      sidebarItems[i].classList.add('active');
    } else {
      sidebarItems[i].classList.remove('active');
    }
  }

  window.scrollTo(0, 0);

  if (viewId === 'view-watchlist') {
    renderWatchlistView(currentWatchlistFilter);
  }

  if (window.SpatialNav && window.SpatialNav.isTvMode()) {
    setTimeout(window.SpatialNav.initDefaultFocus, 80);
  }
}

function initServerConfig() {
  const btn = document.getElementById('server-settings-btn');
  if (btn) {
    btn.onclick = () => {
      showToast('Nexus TV is running in 100% Standalone On-Device Mode.');
    };
  }
}

// ==========================================================================
// 2. Home Feed & Category Rails
// ==========================================================================
async function initHomeFeed() {
  const railsContainer = document.getElementById('rails-container');
  const loader = document.getElementById('home-loader');

  try {
    const res = await fetch(`${API_BASE}/api/home`);
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    const data = await res.json();

    loader.style.display = 'none';
    allHomeSections = data.sections || [];

    // 0. Render Continue Watching if user has saved history
    try {
      renderContinueWatchingRail();
    } catch (cwErr) {
      console.warn('Continue watching error:', cwErr);
    }

    // 1. Render Featured Hero
    try {
      if (data.hero && data.hero.length > 0) {
        setupHero(data.hero[0]);
      }
    } catch (heroErr) {
      console.warn('Hero setup error:', heroErr);
    }

    // 2. Render Curated Rails on Home
    try {
      if (railsContainer) {
        allHomeSections.forEach((section, idx) => {
          if (section.items && section.items.length > 0) {
            const railEl = createRailElement(section, idx);
            railsContainer.appendChild(railEl);
          }
        });
      }
    } catch (railErr) {
      console.warn('Rails render error:', railErr);
    }

    // 3. Populate Dedicated Series & Movies Tabs
    try {
      populateCategoryTabs(allHomeSections);
    } catch (catErr) {
      console.warn('Category tabs error:', catErr);
    }

  } catch (err) {
    console.error('Home load error:', err);
    if (loader) {
      loader.innerHTML = `
        <p style="color: #FF3366;">Failed to load catalog.</p>
        <button class="app-btn btn-play" onclick="location.reload()" style="margin-top: 10px;">Retry</button>
      `;
    }
  }
}

// ==========================================================================
// Lightweight Image Downsampler for 10-Foot TV Performance
// ==========================================================================
function downsampleImageUrl(url, type = 'poster') {
  if (!url || typeof url !== 'string') return '';
  let cleanUrl = url;

  if (cleanUrl.includes('image.tmdb.org') || cleanUrl.includes('/original/')) {
    if (type === 'backdrop') {
      cleanUrl = cleanUrl.replace(/\/original\//g, '/w780/').replace(/\/w1280\//g, '/w780/');
    } else {
      cleanUrl = cleanUrl.replace(/\/original\//g, '/w342/').replace(/\/w780\//g, '/w342/').replace(/\/w1280\//g, '/w342/');
    }
  } else if (cleanUrl.includes('/w1280/')) {
    cleanUrl = type === 'backdrop' ? cleanUrl.replace(/\/w1280\//g, '/w780/') : cleanUrl.replace(/\/w1280\//g, '/w342/');
  }

  return cleanUrl;
}

function setupHero(item) {
  if (!item) return;

  const bg = document.getElementById('hero-bg') || document.getElementById('hero-card');
  const title = document.getElementById('hero-title');
  const typeBadge = document.getElementById('hero-type-badge') || document.getElementById('hero-type');
  const ratingEl = document.getElementById('hero-rating');
  const yearEl = document.getElementById('hero-year');
  const descEl = document.getElementById('hero-desc') || document.getElementById('hero-meta');

  // Zero layout thrashing: Direct textContent and style property updates
  if (bg && item.cover) {
    const backdropUrl = downsampleImageUrl(item.cover, 'backdrop');
    bg.style.backgroundImage = `url('${backdropUrl}')`;
  }
  if (title && item.title) title.textContent = item.title;
  if (typeBadge) typeBadge.textContent = Number(item.subjectType) === 2 ? 'TV SERIES' : 'FEATURE FILM';
  if (ratingEl) ratingEl.textContent = `★ ${item.score || '8.8'}`;
  if (yearEl && (item.releaseDate || item.year)) yearEl.textContent = (item.releaseDate || item.year).split('-')[0];
  if (descEl) descEl.textContent = item.description || `${item.genre || 'Trending'} • 4K Full Stream Ready`;

  const heroContent = document.getElementById('hero-content');
  if (heroContent) heroContent.classList.add('loaded');
  const qualityEl = document.getElementById('hero-quality');
  if (qualityEl) qualityEl.style.display = 'inline-block';

  const playBtn = document.getElementById('hero-play-btn');
  if (playBtn) {
    playBtn.onclick = () => {
      const se = Number(item.subjectType) === 2 ? 1 : 0;
      const ep = Number(item.subjectType) === 2 ? 1 : 0;
      playStream(item.id, item.title, se, ep, item.detailPath);
    };
  }

  const infoBtn = document.getElementById('hero-info-btn');
  if (infoBtn) {
    infoBtn.onclick = () => {
      openDetailSheet(item.id, {
        title: item.title,
        cover: downsampleImageUrl(item.cover, 'poster'),
        year: (item.releaseDate || item.year || '2026').split('-')[0],
        type: Number(item.subjectType) === 2 ? 'TV SERIES' : 'MOVIE'
      });
    };
  }
}
window.setupHero = setupHero;
window.updateHeroShowcase = setupHero;

function createRailElement(section, index) {
  const wrap = document.createElement('section');
  wrap.className = 'rail-section';

  const header = document.createElement('div');
  header.className = 'rail-header';
  header.innerHTML = `<h2 class="rail-title">${escapeHtml(section.title)}</h2>`;

  const track = document.createElement('div');
  track.className = 'rail-track';

  const INITIAL_COUNT = 10;
  let renderedCount = 0;

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'app-card';
    card.tabIndex = 0;
    const posterUrl = downsampleImageUrl(item.cover, 'poster');
    card.dataset.id = item.id;
    card.dataset.title = item.title || '';
    card.dataset.cover = posterUrl;
    card.dataset.score = item.score || '8.5';
    card.dataset.year = item.releaseDate ? item.releaseDate.split('-')[0] : '2026';
    card.dataset.genre = item.genre ? item.genre.split(',')[0] : 'Trending';
    card.dataset.subjectType = item.subjectType || 1;
    card.dataset.detailPath = item.detailPath || '';
    card.dataset.description = item.description || `${item.genre || 'Trending'} • 4K Full Stream Ready`;

    card.addEventListener('focus', () => {
      setupHero({
        id: card.dataset.id,
        title: card.dataset.title,
        cover: card.dataset.cover,
        score: card.dataset.score,
        releaseDate: card.dataset.year,
        genre: card.dataset.genre,
        subjectType: Number(card.dataset.subjectType),
        detailPath: card.dataset.detailPath,
        description: card.dataset.description
      });
      // When reaching near the end of currently rendered items, render next chunk
      if (renderedCount < section.items.length && track.lastElementChild === card) {
        renderNextBatch();
      }
    });

    card.innerHTML = `
      <div class="card-poster">
        <img src="${posterUrl}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity='0'; this.parentElement.classList.add('poster-fallback');">
        <span class="card-type-tag">${item.subjectType === 2 ? 'Series' : 'Movie'}</span>
        <div class="card-badge-rating">★ ${item.score || '8.5'}</div>
      </div>
      <div class="card-meta-box">
        <div class="card-name" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="card-sub">${item.releaseDate ? item.releaseDate.split('-')[0] : 'HD'} • ${item.genre ? item.genre.split(',')[0] : 'Popular'}</div>
      </div>
    `;

    card.addEventListener('pointerdown', () => prefetchDetail(item.id), { passive: true });

    card.onclick = () => openDetailSheet(item.id, {
      title: item.title,
      cover: card.dataset.cover,
      year: item.releaseDate ? item.releaseDate.split('-')[0] : '2026',
      type: item.subjectType === 2 ? 'TV SERIES' : 'MOVIE'
    });

    track.appendChild(card);
    renderedCount++;
  }

  function renderNextBatch() {
    if (renderedCount >= section.items.length) return;
    const nextItems = section.items.slice(renderedCount, renderedCount + 10);
    nextItems.forEach(renderCard);
  }

  // Initial load: render first 10 items only (eliminates startup lag)
  section.items.slice(0, INITIAL_COUNT).forEach(renderCard);

  // Lazy render remaining items on horizontal scroll
  track.addEventListener('scroll', () => {
    if (renderedCount < section.items.length && (track.scrollLeft + track.clientWidth >= track.scrollWidth - 350)) {
      renderNextBatch();
    }
  }, { passive: true });

  wrap.appendChild(header);
  wrap.appendChild(track);
  return wrap;
}

let cachedSeriesItems = [];
let cachedMoviesItems = [];
let seriesRenderIndex = 0;
let moviesRenderIndex = 0;
const BATCH_SIZE = 36;

function appendCardToGrid(item, isSeries, grid) {
  const card = document.createElement('div');
  card.className = 'app-card';
  card.tabIndex = 0;
  const posterUrl = downsampleImageUrl(item.cover, 'poster');
  card.dataset.id = item.id;
  card.dataset.title = item.title || '';
  card.dataset.cover = posterUrl;
  card.dataset.score = item.score || '8.5';
  card.dataset.year = item.releaseDate ? item.releaseDate.split('-')[0] : '2026';
  card.dataset.genre = item.genre ? item.genre.split(',')[0] : 'HD';
  card.dataset.subjectType = isSeries ? 2 : 1;
  card.dataset.detailPath = item.detailPath || '';
  card.dataset.description = item.description || '';

  card.addEventListener('focus', () => {
    setupHero({
      id: card.dataset.id,
      title: card.dataset.title,
      cover: card.dataset.cover,
      score: card.dataset.score,
      releaseDate: card.dataset.year,
      genre: card.dataset.genre,
      subjectType: Number(card.dataset.subjectType),
      detailPath: card.dataset.detailPath,
      description: card.dataset.description
    });
  });

  card.innerHTML = `
    <div class="card-poster">
      <img src="${posterUrl}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity='0'; this.parentElement.classList.add('poster-fallback');">
      <span class="card-type-tag">${isSeries ? 'Series' : 'Movie'}</span>
      <div class="card-badge-rating">★ ${item.score || '8.5'}</div>
    </div>
    <div class="card-meta-box">
      <div class="card-name" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
      <div class="card-sub">${item.releaseDate ? item.releaseDate.split('-')[0] : 'HD'}</div>
    </div>
  `;
  card.addEventListener('pointerdown', () => prefetchDetail(item.id), { passive: true });
  card.onclick = () => openDetailSheet(item.id, {
    title: item.title,
    cover: card.dataset.cover,
    year: item.releaseDate ? item.releaseDate.split('-')[0] : '2026',
    type: isSeries ? 'TV SERIES' : 'MOVIE'
  });
  grid.appendChild(card);
}

function renderMoreSeries() {
  const grid = document.getElementById('series-grid');
  if (!grid || seriesRenderIndex >= cachedSeriesItems.length) return;
  const next = cachedSeriesItems.slice(seriesRenderIndex, seriesRenderIndex + BATCH_SIZE);
  next.forEach(item => appendCardToGrid(item, true, grid));
  seriesRenderIndex += next.length;
}

function renderMoreMovies() {
  const grid = document.getElementById('movies-grid');
  if (!grid || moviesRenderIndex >= cachedMoviesItems.length) return;
  const next = cachedMoviesItems.slice(moviesRenderIndex, moviesRenderIndex + BATCH_SIZE);
  next.forEach(item => appendCardToGrid(item, false, grid));
  moviesRenderIndex += next.length;
}

function populateCategoryTabs(sections) {
  const seriesGrid = document.getElementById('series-grid');
  const moviesGrid = document.getElementById('movies-grid');
  if (!seriesGrid || !moviesGrid) return;

  seriesGrid.innerHTML = '';
  moviesGrid.innerHTML = '';
  cachedSeriesItems = [];
  cachedMoviesItems = [];
  seriesRenderIndex = 0;
  moviesRenderIndex = 0;

  const seenSeries = new Set();
  const seenMovies = new Set();

  sections.forEach(sec => {
    sec.items.forEach(item => {
      const isSeries = item.subjectType === 2 || (sec.title.toLowerCase().includes('drama') || sec.title.toLowerCase().includes('series'));
      if (isSeries && !seenSeries.has(item.id)) {
        seenSeries.add(item.id);
        cachedSeriesItems.push(item);
      } else if (!isSeries && !seenMovies.has(item.id)) {
        seenMovies.add(item.id);
        cachedMoviesItems.push(item);
      }
    });
  });

  // Render initial batch of 16 items immediately (0ms DOM layout overhead)
  renderMoreSeries();
  renderMoreMovies();

  // Infinite scroll listener for category tabs
  if (!window._hasCategoryScrollListener) {
    window._hasCategoryScrollListener = true;
    window.addEventListener('scroll', () => {
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 600) {
        const activeTab = document.querySelector('.nav-tab.active');
        if (!activeTab) return;
        const currentTab = activeTab.getAttribute('data-tab');
        if (currentTab === 'view-series') renderMoreSeries();
        if (currentTab === 'view-movies') renderMoreMovies();
      }
    }, { passive: true });
  }
}

// ==========================================================================
// 3. Dedicated Search Tab
// ==========================================================================
function initSearch() {
  const input = document.getElementById('main-search-input');
  const clearBtn = document.getElementById('main-search-clear');
  const grid = document.getElementById('search-grid');
  const chips = document.querySelectorAll('.chip');

  const executeSearch = async (query) => {
    const q = query.trim();
    if (!q) {
      grid.innerHTML = '<div class="search-hint">Type a title or pick a genre chip above.</div>';
      return;
    }

    grid.innerHTML = '<div class="app-loader" style="grid-column: 1 / -1;"><div class="pulse-spinner"></div><p>Searching catalog...</p></div>';

    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&pageSize=30`);
      const data = await res.json();
      const items = data.items || [];

      if (items.length === 0) {
        grid.innerHTML = `<div class="search-hint">No results found for "${escapeHtml(q)}"</div>`;
        return;
      }

      grid.innerHTML = '';
      items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'app-card';
        card.tabIndex = 0;
        const posterUrl = downsampleImageUrl(item.cover, 'poster');
        card.dataset.id = item.id;
        card.dataset.title = item.title || '';
        card.dataset.cover = posterUrl;
        card.dataset.score = item.score || '8.5';
        card.dataset.year = item.releaseDate ? item.releaseDate.split('-')[0] : '2026';
        card.dataset.genre = item.genre || '';
        card.dataset.subjectType = item.subjectType || 1;
        card.dataset.detailPath = item.detailPath || '';
        card.dataset.description = item.description || '';
        card.style.flex = 'auto';
        card.innerHTML = `
          <div class="card-poster">
            <img src="${posterUrl}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async">
            <span class="card-type-tag">${item.subjectType === 2 ? 'Series' : 'Movie'}</span>
          </div>
          <div class="card-meta-box">
            <div class="card-name">${escapeHtml(item.title)}</div>
            <div class="card-sub">${item.releaseDate ? item.releaseDate.split('-')[0] : 'HD'} • ${item.genre ? item.genre.split(',')[0] : 'Media'}</div>
          </div>
        `;
        card.addEventListener('pointerdown', () => prefetchDetail(item.id), { passive: true });
        card.onclick = () => openDetailSheet(item.id, {
          title: item.title,
          cover: posterUrl,
          year: item.releaseDate ? item.releaseDate.split('-')[0] : '2026',
          type: item.subjectType === 2 ? 'TV SERIES' : 'MOVIE'
        });
        grid.appendChild(card);
      });

    } catch (err) {
      grid.innerHTML = '<div class="search-hint" style="color: #FF3366;">Search service unavailable.</div>';
    }
  };

  input.addEventListener('input', () => {
    clearBtn.style.display = input.value ? 'block' : 'none';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => executeSearch(input.value), 350);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    grid.innerHTML = `
      <div class="search-empty-state">
        <div class="empty-icon-svg">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
        <h3 class="empty-title">Discover Movies & Series</h3>
        <p class="empty-desc">Type any title, genre, or click a category above to explore.</p>
      </div>`;
    input.focus();
  });

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const filter = chip.getAttribute('data-filter');
      input.value = filter === 'all' ? '' : filter;
      executeSearch(input.value);
    });
  });
}

// ==========================================================================
// 4. Series Seasons & Episodes Sheet / Modal
// ==========================================================================
function populateDetailSheetUI(data) {
  currentDetailData = data;
  const sub = data.subject || {};
  currentDetailSubject = sub;

  // Header info
  document.getElementById('sheet-title').textContent = sub.title || 'Untitled';
  const posterEl = document.getElementById('sheet-poster');
  if (posterEl && sub.cover) posterEl.src = downsampleImageUrl(sub.cover, 'poster');
  if (sub.cover) {
    document.getElementById('sheet-hero').style.backgroundImage = `url('${downsampleImageUrl(sub.cover, 'backdrop')}')`;
  }
  document.getElementById('sheet-year').textContent = sub.releaseDate ? sub.releaseDate.split('-')[0] : '2026';
  document.getElementById('sheet-score').textContent = `★ ${sub.score || '8.4'}`;
  document.getElementById('sheet-synopsis').textContent = sub.description || 'No synopsis provided.';

  const isSeries = sub.subjectType === 2 && data.seasons && data.seasons.length > 0;
  document.getElementById('sheet-type-badge').textContent = isSeries ? 'TV SERIES' : 'MOVIE';
  document.getElementById('sheet-duration').textContent = isSeries 
    ? `${data.seasons.length} Season${data.seasons.length > 1 ? 's' : ''}` 
    : (sub.duration ? `${Math.round(sub.duration / 60)} min` : 'Feature Film');

  // Genre pills
  const genresWrap = document.getElementById('sheet-genres');
  genresWrap.innerHTML = '';
  if (sub.genre) {
    sub.genre.split(',').forEach(g => {
      const pill = document.createElement('span');
      pill.className = 'genre-pill';
      pill.textContent = g.trim();
      genresWrap.appendChild(pill);
    });
  }

  // Main action button with Resume Support
  const playBtn = document.getElementById('sheet-play-btn');
  const playText = document.getElementById('sheet-play-text');
  const hasStream = sub.hasResource !== false;

  const savedHistory = WatchHistory.getAll().find(item => item.id === sub.id);

  if (!hasStream) {
    document.getElementById('sheet-type-badge').textContent = 'COMING SOON';
    playText.textContent = 'Unreleased (Coming Soon)';
    playBtn.style.opacity = '0.6';
    playBtn.onclick = () => {
      alert('This title has not been released yet and does not have streaming sources.');
    };
  } else if (isSeries) {
    playBtn.style.opacity = '1';
    if (savedHistory && savedHistory.season > 0 && savedHistory.episode > 0) {
      const resumeLabel = savedHistory.currentTime > 10 
        ? `Resume S${savedHistory.season}:E${savedHistory.episode} (${formatTime(savedHistory.currentTime)})`
        : `Play S${savedHistory.season} : Episode ${savedHistory.episode}`;
      playText.textContent = resumeLabel;
      playBtn.onclick = () => {
        closeDetailSheet();
        playStream(sub.id, `${sub.title} S${savedHistory.season}:E${savedHistory.episode}`, savedHistory.season, savedHistory.episode, sub.detailPath, savedHistory.currentTime);
      };
    } else {
      playText.textContent = 'Play S1 : Episode 1';
      playBtn.onclick = () => {
        closeDetailSheet();
        playStream(sub.id, `${sub.title} S1:E1`, 1, 1, sub.detailPath);
      };
    }
    buildSeasonsAndEpisodesUI(data.seasons, sub);
  } else {
    playBtn.style.opacity = '1';
    if (savedHistory && savedHistory.currentTime > 10) {
      playText.textContent = `Resume Movie (${formatTime(savedHistory.currentTime)})`;
      playBtn.onclick = () => {
        closeDetailSheet();
        playStream(sub.id, sub.title, 0, 0, sub.detailPath, savedHistory.currentTime);
      };
    } else {
      playText.textContent = 'Start Streaming Movie';
      playBtn.onclick = () => {
        closeDetailSheet();
        playStream(sub.id, sub.title, 0, 0, sub.detailPath);
      };
    }
    document.getElementById('series-episodes-section').style.display = 'none';
  }

  // Watchlist Button State Synchronization
  const watchlistBtn = document.getElementById('sheet-watchlist-btn');
  const watchlistText = document.getElementById('sheet-watchlist-text');
  if (watchlistBtn) {
    const updateWatchlistState = () => {
      const inList = Watchlist.has(sub.id);
      if (inList) {
        watchlistBtn.classList.add('active');
        if (watchlistText) watchlistText.textContent = 'In List';
      } else {
        watchlistBtn.classList.remove('active');
        if (watchlistText) watchlistText.textContent = 'My List';
      }
    };

    updateWatchlistState();

    watchlistBtn.onclick = (e) => {
      e.stopPropagation();
      const added = Watchlist.toggle(sub);
      updateWatchlistState();
      showToast(added ? 'Added to My Watchlist' : 'Removed from Watchlist');

      const activeView = document.querySelector('.view-panel.active');
      if (activeView && activeView.id === 'view-watchlist') {
        renderWatchlistView(currentWatchlistFilter);
      }
    };
  }

  // Cast section
  const stars = sub.stars || [];
  if (stars.length > 0) {
    buildCastUI(stars);
  } else {
    document.getElementById('sheet-cast-section').style.display = 'none';
  }
}

async function openDetailSheet(subjectId, initialMeta) {
  const sheet = document.getElementById('detail-sheet');
  currentOpeningId = subjectId;

  // 1. INSTANT ZERO-DELAY RENDER: If title is already cached in memory, render EVERYTHING before sliding up!
  if (detailCache.has(subjectId)) {
    populateDetailSheetUI(detailCache.get(subjectId));
    sheet.classList.add('active');
    return;
  }

  // 2. Pre-populate header cleanly if initial card metadata is provided
  if (initialMeta) {
    if (initialMeta.title) document.getElementById('sheet-title').textContent = initialMeta.title;
    if (initialMeta.cover) {
      document.getElementById('sheet-hero').style.backgroundImage = `url('${downsampleImageUrl(initialMeta.cover, 'backdrop')}')`;
      const posterEl = document.getElementById('sheet-poster');
      if (posterEl) posterEl.src = downsampleImageUrl(initialMeta.cover, 'poster');
    }
    if (initialMeta.year) document.getElementById('sheet-year').textContent = initialMeta.year;
    if (initialMeta.type) document.getElementById('sheet-type-badge').textContent = initialMeta.type;
  }

  const watchlistBtn = document.getElementById('sheet-watchlist-btn');
  const watchlistText = document.getElementById('sheet-watchlist-text');
  if (watchlistBtn) {
    if (Watchlist.has(subjectId)) {
      watchlistBtn.classList.add('active');
      if (watchlistText) watchlistText.textContent = 'In List';
    } else {
      watchlistBtn.classList.remove('active');
      if (watchlistText) watchlistText.textContent = 'My List';
    }
  }

  document.getElementById('sheet-synopsis').textContent = 'Loading title details & streaming nodes...';
  document.getElementById('sheet-genres').innerHTML = '';
  document.getElementById('series-episodes-section').style.display = 'none';
  document.getElementById('sheet-cast-section').style.display = 'none';

  // Slide up
  sheet.classList.add('active');

  try {
    const data = await fetchDetail(subjectId);
    if (currentOpeningId === subjectId && sheet.classList.contains('active')) {
      populateDetailSheetUI(data);
    }
  } catch (err) {
    if (currentOpeningId === subjectId) {
      document.getElementById('sheet-synopsis').textContent = 'Failed to load streaming information.';
    }
  }
}

function buildSeasonsAndEpisodesUI(seasons, sub) {
  const section = document.getElementById('series-episodes-section');
  const tabsContainer = document.getElementById('season-tabs-container');
  const listContainer = document.getElementById('episodes-list');

  section.style.display = 'block';
  tabsContainer.innerHTML = '';
  currentSeasonIdx = 0;

  // Strict numerical sorting for seasons
  seasons.sort((a, b) => Number(a.season || 1) - Number(b.season || 1));

  // 1. Render Season Tab Buttons
  seasons.forEach((seasonObj, idx) => {
    const tabBtn = document.createElement('button');
    tabBtn.className = `season-tab-btn ${idx === 0 ? 'active' : ''}`;
    tabBtn.textContent = `Season ${seasonObj.season}`;
    tabBtn.onclick = async () => {
      document.querySelectorAll('.season-tab-btn').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      currentSeasonIdx = idx;

      // Ensure clicking SEASON 2 (or any tab) empties the container immediately before rendering clean array
      const listContainer = document.getElementById('episodes-list');
      if (listContainer) listContainer.innerHTML = '';

      // Update active pill focus without desyncing series ID
      if (window.SpatialNav && window.SpatialNav.setFocus) {
        window.SpatialNav.setFocus(tabBtn);
      }

      // If season has an independent subjectId, fetch its detail payload
      let activeSub = { ...sub };
      const seasonSubjectId = seasonObj.subjectId || sub.id;
      if (seasonObj.subjectId && String(seasonObj.subjectId) !== String(sub.id)) {
        try {
          const sDetail = await fetchDetail(seasonObj.subjectId);
          if (sDetail && sDetail.seasons && sDetail.seasons.length > 0) {
            const matchS = sDetail.seasons.find(s => Number(s.season) === Number(seasonObj.season)) || sDetail.seasons[0];
            if (matchS && matchS.episodes) {
              seasonObj.episodes = matchS.episodes;
            }
            if (sDetail.subject) {
              activeSub = { ...sDetail.subject, id: String(seasonObj.subjectId) };
            }
          }
        } catch (err) {
          console.warn('[SeasonTab] Error fetching separate season detail:', err);
        }
      }

      // Update main Play button to match current season's first episode
      const playText = document.getElementById('sheet-play-text');
      const playBtn = document.getElementById('sheet-play-btn');
      const rawList = seasonObj.episodes || [];
      const cleanEps = rawList.map((ep, eIdx) => {
        const epNum = Number(ep.episode || ep.episodeNumber || ep.ep || (eIdx + 1));
        return {
          ...ep,
          displayNumber: epNum,
          displayText: `Episode ${epNum}`
        };
      });
      cleanEps.sort((a, b) => a.displayNumber - b.displayNumber);
      const firstEp = cleanEps[0] || { displayNumber: 1 };
      const epNum = firstEp.displayNumber;
      if (playText) playText.textContent = `Play S${seasonObj.season} : Episode ${epNum}`;
      if (playBtn) {
        playBtn.onclick = () => {
          closeDetailSheet();
          playStream(activeSub.id, `${activeSub.title} S${seasonObj.season}:E${epNum}`, seasonObj.season, epNum, activeSub.detailPath);
        };
      }

      renderEpisodesList(seasonObj, activeSub);
    };
    tabsContainer.appendChild(tabBtn);
  });

  // 2. Initial Render of Season 1
  if (seasons.length > 0) {
    const listContainer = document.getElementById('episodes-list');
    if (listContainer) listContainer.innerHTML = '';
    renderEpisodesList(seasons[0], sub);
  }
}

function renderEpisodesList(seasonObj, sub) {
  const listContainer = document.getElementById('episodes-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const seasonEpisodes = seasonObj.episodes || [];
  console.log("RAW EPISODES FOR SEASON:", JSON.stringify(seasonEpisodes));

  // Must strictly use the season-relative episode number (1, 2, 3... N) for display
  const cleanEpisodes = seasonEpisodes.map((ep, idx) => {
    const epNum = Number(ep.episode || ep.episodeNumber || ep.ep || (idx + 1));
    return {
      ...ep,
      displayNumber: epNum,
      displayText: `Episode ${epNum}`
    };
  });

  // Sort strictly by this numerical integer before appending elements to the DOM
  cleanEpisodes.sort((a, b) => a.displayNumber - b.displayNumber);
  console.log("PROCESSED EPISODES FOR SEASON:", JSON.stringify(cleanEpisodes.map(e => e.displayNumber)));

  cleanEpisodes.forEach(ep => {
    const epNum = ep.displayNumber;
    const card = document.createElement('div');
    card.className = 'episode-row-card';
    card.tabIndex = 0;

    const epHistory = WatchHistory.getAll().find(item => item.id === sub.id && item.season === seasonObj.season && item.episode === epNum);
    let epSubText = `Season ${seasonObj.season} • Full Stream Ready`;
    let resumeTime = 0;

    if (epHistory && epHistory.progressPercent > 0) {
      if (epHistory.progressPercent >= 92) {
        epSubText = `✓ Watched • Season ${seasonObj.season}`;
      } else {
        epSubText = `Resume at ${formatTime(epHistory.currentTime)} (${epHistory.progressPercent}%)`;
        resumeTime = epHistory.currentTime;
      }
    }

    let titleText = ep.title || (ep.name ? ep.name : ep.displayText);
    if (!titleText || /^Episode\s+\d+$/i.test(String(titleText).trim())) {
      titleText = ep.displayText;
    }

    card.innerHTML = `
      <div class="ep-left">
        <div class="ep-badge-num">${String(epNum).padStart(2, '0')}</div>
        <div class="ep-info-text">
          <span class="ep-title">${escapeHtml(titleText)}</span>
          <span class="ep-sub">${epSubText}</span>
        </div>
      </div>
      <div class="ep-play-circle">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </div>
    `;

    card.onclick = () => {
      closeDetailSheet();
      playStream(sub.id, `${sub.title} S${seasonObj.season}:E${epNum}`, seasonObj.season, epNum, sub.detailPath, resumeTime);
    };

    listContainer.appendChild(card);
  });
}

function buildCastUI(stars) {
  const castSection = document.getElementById('sheet-cast-section');
  const castRow = document.getElementById('sheet-cast-row');
  castSection.style.display = 'block';
  castRow.innerHTML = '';

  stars.forEach(star => {
    const c = document.createElement('div');
    c.className = 'cast-card';
    c.innerHTML = `
      <div class="cast-avatar">
        <img src="${star.avatar || ''}" alt="${escapeHtml(star.name)}" loading="lazy">
      </div>
      <div class="cast-name">${escapeHtml(star.name)}</div>
      <div class="cast-char">${escapeHtml(star.character || '')}</div>
    `;
    castRow.appendChild(c);
  });
}

function closeDetailSheet() {
  const sheet = document.getElementById('detail-sheet');
  if (sheet) sheet.classList.remove('active');
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
}

function initSheetListeners() {
  const sheet = document.getElementById('detail-sheet');
  const closeBtn = document.getElementById('sheet-close-btn');
  const dragHandle = document.querySelector('.sheet-drag-handle');
  if (closeBtn) closeBtn.onclick = closeDetailSheet;
  if (dragHandle) dragHandle.onclick = closeDetailSheet;
  if (sheet) {
    sheet.onclick = (e) => {
      if (e.target === sheet) closeDetailSheet();
    };
  }
}

// ==========================================================================
// 5. Cinema Video Player
// ==========================================================================
async function playStream(subjectId, title, season = 0, episode = 0, detailPath = null, resumeTime = null) {
  const overlay = document.getElementById('player-overlay');
  const video = document.getElementById('native-video');
  const titleEl = document.getElementById('player-title-text');
  const tagEl = document.getElementById('player-tag-text');
  const spinner = document.getElementById('player-spinner');
  const msgEl = document.getElementById('player-loading-msg');
  const qualityPicker = document.getElementById('player-quality-picker');
  const notice = document.getElementById('player-notice');

  currentPlaybackMeta = {
    id: subjectId,
    title: title,
    cover: currentDetailSubject ? currentDetailSubject.cover : '',
    subjectType: currentDetailSubject ? currentDetailSubject.subjectType : (season > 0 ? 2 : 1),
    season: season,
    episode: episode,
    detailPath: detailPath
  };

  // Automatically switch phone orientation to horizontal (landscape) for cinematic playback!
  if (window.AndroidBridge && window.AndroidBridge.setOrientation) {
    try { window.AndroidBridge.setOrientation('landscape'); } catch (e) {}
  }

  overlay.classList.add('active');
  if (notice) notice.style.display = 'none';
  spinner.style.display = 'flex';
  const centerCtrl = document.getElementById('player-center-controls');
  if (centerCtrl) centerCtrl.style.display = 'none'; // Never mix loading spinner with play button

  msgEl.textContent = 'Buffering cinema stream...';
  titleEl.textContent = title;
  tagEl.textContent = 'Resolving CDN node...';

  // Detach previous video callbacks and timeouts before resetting to avoid false error triggers
  video.oncanplay = null;
  video.onloadedmetadata = null;
  video.onerror = null;

  // Completely reset video and remove controls to prevent Android default play button
  video.pause();
  video.removeAttribute('src');
  video.src = '';
  video.removeAttribute('controls');
  video.classList.remove('active-stream');

  try {
    let url = `${API_BASE}/api/play/${subjectId}?season=${season}&episode=${episode}`;
    if (detailPath) url += `&detailPath=${encodeURIComponent(detailPath)}`;

    const res = await fetch(url);
    const data = await res.json();
    currentStreams = data.streams || [];

    if (!data.hasResource || currentStreams.length === 0) {
      spinner.style.display = 'none';
      overlay.classList.remove('active');
      showToast('Stream source unavailable for this episode');
      return;
    }

    // Populate Quality Dropdown
    qualityPicker.innerHTML = '';
    currentStreams.forEach((stream, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${stream.resolution}p`;
      qualityPicker.appendChild(opt);
    });

    qualityPicker.onchange = () => {
      const chosen = currentStreams[qualityPicker.value];
      applyStream(chosen);
    };

    // Populate Subtitles Dropdown
    const subtitlePicker = document.getElementById('player-subtitle-picker');
    const currentCaptions = data.captions || [];

    if (subtitlePicker) {
      subtitlePicker.innerHTML = '<option value="off">Subs: Off</option>';
      currentCaptions.forEach((cap, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = cap.label;
        subtitlePicker.appendChild(opt);
      });

      subtitlePicker.onchange = () => {
        if (subtitlePicker.value === 'off') {
          clearSubtitles();
        } else {
          const cap = currentCaptions[parseInt(subtitlePicker.value, 10)];
          applySubtitle(cap);
        }
      };

      // Auto-select English subtitle if available, or first subtitle
      const enIdx = currentCaptions.findIndex(c => c.lang === 'en');
      if (enIdx !== -1) {
        subtitlePicker.value = enIdx;
        applySubtitle(currentCaptions[enIdx]);
      } else if (currentCaptions.length > 0) {
        subtitlePicker.value = 0;
        applySubtitle(currentCaptions[0]);
      } else {
        clearSubtitles();
      }
    }

    // Auto-pick best available quality and apply resume point
    const initialResumePoint = (resumeTime !== null && resumeTime > 0)
      ? resumeTime
      : WatchHistory.getResumePoint(subjectId, season, episode);

    applyStream(currentStreams[0], initialResumePoint);

  } catch (err) {
    console.error('Play stream failed:', err);
    spinner.style.display = 'none';
    if (notice) {
      document.getElementById('player-notice-msg').textContent =
        'Network error connecting to stream proxy. Please try again.';
      notice.style.display = 'flex';
    }
    showToast('Network error connecting to stream. Please try again.');
  }
}

// Subtitle cue database for live DOM subtitle rendering
let activeSubCues = [];

function parseSubtitles(rawText) {
  const cues = [];
  if (!rawText) return cues;
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const blocks = normalized.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;
    let timeIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeIndex = i;
        break;
      }
    }
    if (timeIndex !== -1) {
      const timeLine = lines[timeIndex];
      const textLines = lines.slice(timeIndex + 1);
      const parts = timeLine.split('-->');
      if (parts.length === 2) {
        const start = parseTimestamp(parts[0].trim());
        const end = parseTimestamp(parts[1].trim().split(' ')[0]);
        if (start !== null && end !== null) {
          cues.push({
            start,
            end,
            text: textLines.join('\n').replace(/<[^>]+>/g, '').trim()
          });
        }
      }
    }
  }
  return cues;
}

function parseTimestamp(t) {
  if (!t) return null;
  const parts = t.replace(',', '.').split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return null;
}

async function applySubtitle(cap) {
  clearSubtitles();
  if (!cap) return;

  try {
    let text = '';
    // Priority 1: Use Native Android Bridge if available (direct device-side bypass)
    if (window.AndroidBridge && window.AndroidBridge.fetchSubtitle && cap.raw_url) {
      text = window.AndroidBridge.fetchSubtitle(cap.raw_url);
    }

    // Priority 2: Fallback fetch
    if (!text || text.length === 0) {
      const targetUrl = cap.url || cap.raw_url;
      if (targetUrl) {
        const fullSubUrl = targetUrl.startsWith('http') ? targetUrl : `${API_BASE}${targetUrl}`;
        const res = await fetch(fullSubUrl);
        text = await res.text();
      }
    }

    activeSubCues = parseSubtitles(text);
    console.log(`[Nexus TV] Loaded ${activeSubCues.length} subtitle cues for ${cap.label}`);
    showToast(`Subtitles: ${cap.label}`);
  } catch (e) {
    console.warn('[Nexus TV] Subtitle fetch error:', e);
  }
}

function clearSubtitles() {
  activeSubCues = [];
  const subEl = document.getElementById('cinema-subtitles-text');
  if (subEl) {
    subEl.textContent = '';
    subEl.style.display = 'none';
  }
}

function applyStream(stream, forcedTime = null) {
  const video = document.getElementById('native-video');
  const spinner = document.getElementById('player-spinner');
  const tagEl = document.getElementById('player-tag-text');
  const notice = document.getElementById('player-notice');

  if (notice) notice.style.display = 'none';
  spinner.style.display = 'flex';
  const centerCtrl = document.getElementById('player-center-controls');
  if (centerCtrl) centerCtrl.style.display = 'none';

  document.getElementById('player-loading-msg').textContent = `Loading ${stream.resolution}p Stream...`;
  tagEl.textContent = `Direct CDN • ${stream.resolution}p • ${stream.format || 'MP4'}`;

  // Remember exact playhead before changing quality, or restore forcedTime on initial play
  const savedTime = (forcedTime !== null && forcedTime > 0)
    ? forcedTime
    : ((video.currentTime && !isNaN(video.currentTime) && video.currentTime > 0.5) ? video.currentTime : 0);

  let streamLoadTimeout = null;

  // Clear previous callbacks
  video.oncanplay = null;
  video.onloadedmetadata = null;
  video.onerror = null;

  // Reset video element
  video.pause();
  video.classList.remove('active-stream');
  video.removeAttribute('controls');

  const fullUrl = stream.stream_url.startsWith('http') ? stream.stream_url : `${API_BASE}${stream.stream_url}`;
  video.src = fullUrl;
  video.load();

  let hasRestoredTime = false;

  video.onloadedmetadata = () => {
    if (savedTime > 0 && !hasRestoredTime) {
      hasRestoredTime = true;
      try {
        video.currentTime = savedTime;
      } catch (e) {
        console.log('Seek error on quality change:', e);
      }
    }
  };

  // Only show notice if stream fails to start after 12 seconds! Never on initial switch!
  streamLoadTimeout = setTimeout(() => {
    if (video.paused && (!video.currentTime || video.currentTime === 0)) {
      spinner.style.display = 'none';
      if (notice) {
        document.getElementById('player-notice-msg').textContent =
          'Stream connection timed out from CDN node. Try selecting another quality or title.';
        notice.style.display = 'flex';
      }
    }
  }, 12000);

  video.oncanplay = () => {
    clearTimeout(streamLoadTimeout);
    spinner.style.display = 'none';
    if (notice) notice.style.display = 'none';
    if (centerCtrl) centerCtrl.style.display = 'flex';
    video.classList.add('active-stream');
    video.play().catch(e => console.log('Autoplay deferred:', e));
    updatePlayPauseIcon(true);
    resetHudTimer();
  };

  video.onerror = (e) => {
    // 1. Guard against empty source, reset, or inactive player overlay
    const currentSrc = video.currentSrc || video.src || '';
    if (!overlay.classList.contains('active') || !currentSrc || currentSrc === '' || currentSrc === window.location.href) {
      return;
    }

    // 2. Ignore transient error code 4 during initial source attachment (let streamLoadTimeout handle it if truly dead)
    if (video.error && video.error.code === 4 && video.readyState === 0 && !video.currentTime) {
      console.warn('[Nexus TV Player] Transient source init event, waiting for buffer...');
      return;
    }

    clearTimeout(streamLoadTimeout);
    spinner.style.display = 'none';
    if (centerCtrl) centerCtrl.style.display = 'none';

    let errorMsg = 'Stream playback failed. The CDN node link may have expired or is unreachable.';
    if (video.error) {
      switch (video.error.code) {
        case 1:
          errorMsg = 'Playback aborted by user or system.';
          break;
        case 2:
          errorMsg = 'Network error downloading media from CDN node.';
          break;
        case 3:
          errorMsg = 'Video decode error: Stream format unplayable.';
          break;
        case 4:
          errorMsg = 'Stream format not supported or CDN link expired.';
          break;
      }
    }

    console.warn('[Nexus TV Player] Video element error:', errorMsg, e, video.error);
    if (notice) {
      document.getElementById('player-notice-msg').textContent = errorMsg;
      notice.style.display = 'flex';
    }
    showToast(errorMsg);
  };
}

let hudTimer = null;
function resetHudTimer() {
  showControls();
  clearTimeout(hudTimer);
  const video = document.getElementById('native-video');
  if (video && !video.paused) {
    hudTimer = setTimeout(hideControls, 3500);
  }
}

function showControls() {
  const topHud = document.getElementById('player-hud-top');
  const bottomHud = document.getElementById('player-hud-bottom');
  const centerCtrl = document.getElementById('player-center-controls');
  if (topHud) topHud.classList.remove('hidden');
  if (bottomHud) bottomHud.classList.remove('hidden');
  if (centerCtrl) centerCtrl.classList.remove('hidden');
}

function hideControls() {
  const video = document.getElementById('native-video');
  if (video && video.paused) return; // Never hide while paused
  const topHud = document.getElementById('player-hud-top');
  const bottomHud = document.getElementById('player-hud-bottom');
  const centerCtrl = document.getElementById('player-center-controls');
  if (topHud) topHud.classList.add('hidden');
  if (bottomHud) bottomHud.classList.add('hidden');
  if (centerCtrl) centerCtrl.classList.add('hidden');
}

function updatePlayPauseIcon(isPlaying) {
  const playIcon = document.getElementById('ctrl-play-icon');
  const pauseIcon = document.getElementById('ctrl-pause-icon');
  if (playIcon && pauseIcon) {
    playIcon.style.display = isPlaying ? 'none' : 'block';
    pauseIcon.style.display = isPlaying ? 'block' : 'none';
  }
}

function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return '00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function showDoubleTapIndicator(side) {
  const el = document.getElementById(`dt-${side}`);
  if (el) {
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 650);
  }
}

function initPlayerListeners() {
  const overlay = document.getElementById('player-overlay');
  const video = document.getElementById('native-video');
  const mediaWrap = document.getElementById('player-media-wrap');

  function saveCurrentPlaybackProgress() {
    if (!currentPlaybackMeta || !currentPlaybackMeta.id) return;
    const cur = video.currentTime || 0;
    const dur = video.duration || 0;
    if (cur < 5 || dur <= 0 || isNaN(dur)) return;

    WatchHistory.save({
      id: currentPlaybackMeta.id,
      title: currentPlaybackMeta.title,
      cover: currentPlaybackMeta.cover || (currentDetailSubject ? currentDetailSubject.cover : ''),
      subjectType: currentPlaybackMeta.subjectType || (currentPlaybackMeta.season > 0 ? 2 : 1),
      season: currentPlaybackMeta.season || 0,
      episode: currentPlaybackMeta.episode || 0,
      currentTime: cur,
      duration: dur,
      detailPath: currentPlaybackMeta.detailPath
    });
  }

  const closePlayer = () => {
    saveCurrentPlaybackProgress();

    // Detach all callbacks before resetting to prevent false error triggers
    video.oncanplay = null;
    video.onloadedmetadata = null;
    video.onerror = null;
    clearTimeout(streamLoadTimeout);

    // Automatically switch phone orientation back to vertical (portrait)
    if (window.AndroidBridge && window.AndroidBridge.setOrientation) {
      try { window.AndroidBridge.setOrientation('portrait'); } catch (e) {}
    }

    video.pause();
    video.removeAttribute('src');
    video.src = '';
    video.removeAttribute('controls');
    video.classList.remove('active-stream');
    overlay.classList.remove('active');
    clearSubtitles();
    const centerCtrl = document.getElementById('player-center-controls');
    if (centerCtrl) centerCtrl.style.display = 'none';
    const notice = document.getElementById('player-notice');
    if (notice) notice.style.display = 'none';

    // ALWAYS restore scrolling to the entire app!
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  };
  window.closePlayer = closePlayer;

  document.getElementById('player-back-btn').onclick = closePlayer;
  const noticeClose = document.getElementById('player-notice-close');
  if (noticeClose) noticeClose.onclick = closePlayer;

  // Completely prevent scrolling/dragging the page while in the player
  overlay.addEventListener('touchmove', (e) => {
    if (!e.target.closest('#player-progress-bar')) {
      e.preventDefault();
    }
  }, { passive: false });
  overlay.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

  // Aspect ratio / Fill toggle (Fit vs Zoom vs Fill)
  const fitBtn = document.getElementById('player-fit-btn');
  const fitModes = ['contain', 'cover', 'fill'];
  const fitLabels = ['Fit', 'Zoom', 'Fill'];
  let currentFitIndex = 0;

  if (fitBtn) {
    fitBtn.onclick = (e) => {
      e.stopPropagation();
      currentFitIndex = (currentFitIndex + 1) % fitModes.length;
      video.style.objectFit = fitModes[currentFitIndex];
      fitBtn.textContent = fitLabels[currentFitIndex];
      resetHudTimer();
    };
  }

  // Playback Speed Selector
  const speedPicker = document.getElementById('player-speed-picker');
  if (speedPicker) {
    speedPicker.onchange = (e) => {
      e.stopPropagation();
      video.playbackRate = parseFloat(speedPicker.value);
      resetHudTimer();
    };
  }

  // Center Play/Pause button
  const playPauseBtn = document.getElementById('ctrl-play-pause');
  if (playPauseBtn) {
    playPauseBtn.onclick = (e) => {
      e.stopPropagation();
      if (video.paused) {
        video.play();
        updatePlayPauseIcon(true);
        hudTimer = setTimeout(hideControls, 3000);
      } else {
        video.pause();
        updatePlayPauseIcon(false);
        showControls();
      }
    };
  }

  // 10s Rewind & Fast Forward Buttons
  const seekBackBtn = document.getElementById('ctrl-seek-back');
  if (seekBackBtn) {
    seekBackBtn.onclick = (e) => {
      e.stopPropagation();
      video.currentTime = Math.max(0, video.currentTime - 10);
      showDoubleTapIndicator('left');
      resetHudTimer();
    };
  }

  const seekFwdBtn = document.getElementById('ctrl-seek-forward');
  if (seekFwdBtn) {
    seekFwdBtn.onclick = (e) => {
      e.stopPropagation();
      video.currentTime = Math.min(video.duration || 999999, video.currentTime + 10);
      showDoubleTapIndicator('right');
      resetHudTimer();
    };
  }

  // Scrubber Progress Bar
  const progressBar = document.getElementById('player-progress-bar');
  const currentTimeEl = document.getElementById('player-current-time');
  const totalDurationEl = document.getElementById('player-total-duration');
  let isScrubbing = false;

  if (progressBar) {
    progressBar.addEventListener('input', () => {
      isScrubbing = true;
      if (video.duration) {
        const target = (progressBar.value / 100) * video.duration;
        currentTimeEl.textContent = formatTime(target);
      }
    });

    progressBar.addEventListener('change', () => {
      if (video.duration) {
        video.currentTime = (progressBar.value / 100) * video.duration;
      }
      isScrubbing = false;
      resetHudTimer();
    });
  }

  // Rotate / Fullscreen Button
  const rotateBtn = document.getElementById('player-rotate-btn');
  if (rotateBtn) {
    rotateBtn.onclick = (e) => {
      e.stopPropagation();
      if (!document.fullscreenElement) {
        if (overlay.requestFullscreen) {
          overlay.requestFullscreen();
        } else if (video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
      resetHudTimer();
    };
  }

  // Video timeupdate handler (Time + Scrubber + Subtitle Sync)
  video.addEventListener('timeupdate', () => {
    const cur = video.currentTime;
    const dur = video.duration || 0;

    if (!isScrubbing && currentTimeEl) {
      currentTimeEl.textContent = formatTime(cur);
      if (dur > 0 && progressBar) {
        progressBar.value = (cur / dur) * 100;
        totalDurationEl.textContent = formatTime(dur);
      }
    }

    // Synchronize guaranteed cinema subtitles!
    if (activeSubCues.length > 0) {
      const cue = activeSubCues.find(c => cur >= c.start && cur <= c.end);
      const subEl = document.getElementById('cinema-subtitles-text');
      if (subEl) {
        if (cue && cue.text) {
          subEl.textContent = cue.text;
          subEl.style.display = 'inline-block';
        } else {
          subEl.style.display = 'none';
          subEl.textContent = '';
        }
      }
    }

    // Periodic progress save every 4 seconds
    const now = Date.now();
    if (now - lastSavedProgressTime > 4000) {
      lastSavedProgressTime = now;
      saveCurrentPlaybackProgress();
    }
  });

  video.addEventListener('play', () => updatePlayPauseIcon(true));
  video.addEventListener('pause', () => {
    updatePlayPauseIcon(false);
    saveCurrentPlaybackProgress();
  });

  // Double-tap Seek & Single-tap HUD toggle
  let lastTapTime = 0;
  let lastTapX = 0;

  if (mediaWrap) {
    mediaWrap.addEventListener('click', (e) => {
      if (e.target.closest('.player-center-controls') || e.target.closest('.player-notice') || e.target.closest('select') || e.target.closest('button')) {
        return;
      }

      const now = Date.now();
      const rect = mediaWrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const isDouble = (now - lastTapTime < 320) && (Math.abs(x - lastTapX) < 90);
      lastTapTime = now;
      lastTapX = x;

      if (isDouble) {
        if (x < rect.width * 0.45) {
          video.currentTime = Math.max(0, video.currentTime - 10);
          showDoubleTapIndicator('left');
        } else if (x > rect.width * 0.55) {
          video.currentTime = Math.min(video.duration || 999999, video.currentTime + 10);
          showDoubleTapIndicator('right');
        }
        resetHudTimer();
        return;
      }

      // Single tap: toggle HUD controls
      const topHud = document.getElementById('player-hud-top');
      if (topHud && topHud.classList.contains('hidden')) {
        showControls();
        resetHudTimer();
      } else {
        hideControls();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('active')) {
      closePlayer();
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Native Android Hardware / Gesture Back Button Handler
window.handleAndroidBack = function() {
  // 1. If player is open, close player cleanly
  const player = document.getElementById('player-overlay');
  if (player && player.classList.contains('active')) {
    if (typeof window.closePlayer === 'function') {
      window.closePlayer();
      return true;
    }
    if (window.AndroidBridge && window.AndroidBridge.setOrientation) {
      try { window.AndroidBridge.setOrientation('portrait'); } catch (e) {}
    }
    const video = document.getElementById('native-video');
    if (video) {
      video.oncanplay = null;
      video.onloadedmetadata = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute('src');
      video.src = '';
    }
    player.classList.remove('active');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    return true;
  }

  // 2. If detail bottom sheet is open, close it
  const sheet = document.getElementById('detail-sheet');
  if (sheet && sheet.classList.contains('active')) {
    closeDetailSheet();
    return true;
  }

  // 3. If on Search / Series / Movies tab, go back to Home
  const activeTab = document.querySelector('.nav-tab.active');
  if (activeTab && activeTab.getAttribute('data-tab') !== 'view-home') {
    const homeTab = document.querySelector('.nav-tab[data-tab="view-home"]');
    if (homeTab) {
      homeTab.click();
      return true;
    }
  }

  return false;
};
