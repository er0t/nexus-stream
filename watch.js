/**
 * Nexus Web — Minimalist Cinema & Series Streaming Client
 * Mobile App Color Identity: Midnight Navy, Sky Cyan (#38BDF8) & Sapphire Blue (#2563EB)
 * Connects to live backend API (https://nexus-backend-71wf.onrender.com)
 */

(function () {
  'use strict';

  // ==========================================================================
  // Configuration & API Base Detection
  // ==========================================================================
  const DEFAULT_API = 'https://nexus-backend-71wf.onrender.com';

  function getApiBase() {
    const saved = localStorage.getItem('nexus_api_endpoint');
    if (saved) return saved.replace(/\/+$/, '');
    // If the page itself is served directly by the local FastAPI backend on port 8000 or on Render
    if (window.location.protocol.startsWith('http')) {
      if (window.location.port === '8000') {
        return window.location.origin;
      }
      if (window.location.hostname.includes('onrender.com')) {
        return window.location.origin;
      }
    }
    // Default to the production backend for localhost dev servers (port 3000, 5500, etc.) and Vercel/custom domains
    return DEFAULT_API;
  }

  let API_BASE = getApiBase();

  // ==========================================================================
  // App State
  // ==========================================================================
  const state = {
    currentTab: 'discover', // 'discover' | 'movies' | 'series' | 'library' | 'search'
    activeGenre: 'all',
    homeData: null,
    heroItems: [],
    currentHeroIndex: 0,
    heroTimer: null,
    currentDetail: null,
    currentStreams: [],
    currentCaptions: [],
    selectedSeason: 1,
    selectedEpisode: 1,
    currentPlaying: null, // { subjectId, title, cover, season, episode, streamUrl }
    watchHistory: JSON.parse(localStorage.getItem('nexus_watch_history') || '{}'),
    watchlist: JSON.parse(localStorage.getItem('nexus_watchlist') || '[]'),
    searchDebounce: null,
  };

  // ==========================================================================
  // DOM Elements Cache
  // ==========================================================================
  const el = {
    // Nav
    navItems: document.querySelectorAll('.nav-item'),
    brandIcon: document.getElementById('brand-icon-btn'),
    btnGetApps: document.getElementById('btn-get-apps'),
    btnSettings: document.getElementById('btn-settings'),
    serverStatusBadge: document.getElementById('server-status-badge'),

    // Top Bar & Filters
    searchInput: document.getElementById('search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    filtersBar: document.getElementById('filters-bar'),
    filterChips: document.querySelectorAll('.filter-chip'),

    // View Sections
    views: {
      discover: document.getElementById('view-discover'),
      movies: document.getElementById('view-movies'),
      series: document.getElementById('view-series'),
      library: document.getElementById('view-library'),
      search: document.getElementById('view-search'),
    },

    // Discover Hero
    heroBanner: document.getElementById('hero-banner'),
    heroBackdrop: document.getElementById('hero-backdrop'),
    heroTag: document.getElementById('hero-tag'),
    heroRating: document.getElementById('hero-rating'),
    heroTitle: document.getElementById('hero-title'),
    heroYear: document.getElementById('hero-year'),
    heroDuration: document.getElementById('hero-duration'),
    heroGenre: document.getElementById('hero-genre'),
    heroOverview: document.getElementById('hero-overview'),
    btnHeroPlay: document.getElementById('btn-hero-play'),
    btnHeroList: document.getElementById('btn-hero-list'),

    // Catalog Containers
    discoverSections: document.getElementById('discover-sections'),
    moviesGrid: document.getElementById('movies-grid'),
    seriesGrid: document.getElementById('series-grid'),
    libraryContinueGrid: document.getElementById('library-continue-grid'),
    libraryWatchlistGrid: document.getElementById('library-watchlist-grid'),
    searchResultsGrid: document.getElementById('search-results-grid'),
    searchQueryLabel: document.getElementById('search-query-label'),

    // Metamodal / Detail Screen
    modalOverlay: document.getElementById('detail-modal-overlay'),
    detailModal: document.getElementById('detail-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    detailBackdropImg: document.getElementById('detail-backdrop-img'),
    detailPosterImg: document.getElementById('detail-poster-img'),
    btnDetailPlay: document.getElementById('btn-detail-play'),
    btnDetailPlayText: document.getElementById('btn-detail-play-text'),
    btnDetailWatchlist: document.getElementById('btn-detail-watchlist'),
    detailTitle: document.getElementById('detail-title'),
    detailScore: document.getElementById('detail-score'),
    detailYear: document.getElementById('detail-year'),
    detailDuration: document.getElementById('detail-duration'),
    detailCountry: document.getElementById('detail-country'),
    detailGenres: document.getElementById('detail-genres'),
    detailSynopsis: document.getElementById('detail-synopsis'),
    detailCastRow: document.getElementById('detail-cast-row'),
    seriesSection: document.getElementById('detail-series-section'),
    seasonSelector: document.getElementById('detail-season-selector'),
    episodesGrid: document.getElementById('detail-episodes-grid'),
    streamsSection: document.getElementById('detail-streams-section'),
    streamsList: document.getElementById('detail-streams-list'),

    // Video Player
    playerContainer: document.getElementById('player-container'),
    mainVideo: document.getElementById('main-video'),
    playerOverlay: document.getElementById('player-controls-overlay'),
    playerBackBtn: document.getElementById('player-back-btn'),
    playerTitleDisplay: document.getElementById('player-title-display'),
    playerBackendBadge: document.getElementById('player-backend-badge'),
    playerCenterPlay: document.getElementById('player-center-play'),
    btnPlayPause: document.getElementById('ctrl-play-pause'),
    btnSkipBack: document.getElementById('ctrl-skip-back'),
    btnSkipFwd: document.getElementById('ctrl-skip-fwd'),
    btnNextEp: document.getElementById('ctrl-next-ep'),
    timeDisplay: document.getElementById('time-display'),
    timeline: document.getElementById('timeline-container'),
    timelineProgress: document.getElementById('timeline-progress'),
    timelineBuffered: document.getElementById('timeline-buffered'),
    timelineThumb: document.getElementById('timeline-thumb'),
    btnMute: document.getElementById('ctrl-mute'),
    volumeSlider: document.getElementById('volume-slider'),
    btnSubtitles: document.getElementById('ctrl-subtitles'),
    menuSubtitles: document.getElementById('menu-subtitles'),
    btnQuality: document.getElementById('ctrl-quality'),
    menuQuality: document.getElementById('menu-quality'),
    btnPip: document.getElementById('ctrl-pip'),
    btnFullscreen: document.getElementById('ctrl-fullscreen'),

    // Dialogs
    appsModal: document.getElementById('apps-modal-overlay'),
    appsModalClose: document.getElementById('apps-modal-close'),
    settingsModal: document.getElementById('settings-modal-overlay'),
    settingsModalClose: document.getElementById('settings-modal-close'),
    apiInput: document.getElementById('settings-api-input'),
    btnSaveApi: document.getElementById('btn-save-api'),
    btnResetApi: document.getElementById('btn-reset-api'),
  };

  // ==========================================================================
  // Toast Helper
  // ==========================================================================
  function showToast(message) {
    const existing = document.querySelector('.toast-msg');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent-cyan)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
      <span>${escapeHtml(message)}</span>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
    });
  }

  // ==========================================================================
  // Fetch API Layer
  // ==========================================================================
  async function apiGet(endpoint, params = {}) {
    let url = `${API_BASE}${endpoint}`;
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        searchParams.append(k, v);
      }
    }
    const queryString = searchParams.toString();
    if (queryString) url += `?${queryString}`;

    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`API request failed for ${url}:`, err);
      throw err;
    }
  }

  // ==========================================================================
  // Navigation & Tabs System
  // ==========================================================================
  function switchTab(tabName) {
    state.currentTab = tabName;
    el.navItems.forEach(item => {
      const isTarget = item.getAttribute('data-tab') === tabName;
      item.classList.toggle('active', isTarget);
    });

    Object.entries(el.views).forEach(([name, viewEl]) => {
      if (viewEl) viewEl.classList.toggle('active', name === tabName);
    });

    // Filter chips only shown on discover, movies, series
    if (el.filtersBar) {
      el.filtersBar.style.display = (tabName === 'discover' || tabName === 'movies' || tabName === 'series') ? 'flex' : 'none';
    }

    if (tabName === 'library') {
      renderLibraryView();
    } else if (tabName === 'movies' && el.moviesGrid && !el.moviesGrid.hasChildNodes()) {
      renderCategorizedGrid('movies');
    } else if (tabName === 'series' && el.seriesGrid && !el.seriesGrid.hasChildNodes()) {
      renderCategorizedGrid('series');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==========================================================================
  // Media Card Component (Inspired by dexter.pw)
  // ==========================================================================
  function createMediaCard(item) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.setAttribute('data-id', item.id);

    const isSeries = item.subjectType === 2;
    const qualityLabel = isSeries ? 'HD' : (parseFloat(item.score || 0) >= 8.2 ? '4K' : 'HD');
    const year = (item.releaseDate || '').substring(0, 4) || '2024';
    const score = item.score ? Number(item.score).toFixed(1) : '8.4';
    const coverUrl = item.cover || 'https://via.placeholder.com/300x450/0f1015/38bdf8?text=Nexus';
    const primaryGenre = item.genre ? escapeHtml(item.genre.split(',')[0].trim()) : (isSeries ? 'Series' : 'Movie');

    card.innerHTML = `
      <!-- Poster Image (Micro-Zoom) -->
      <img 
        class="poster-img" 
        src="${coverUrl}" 
        alt="${escapeHtml(item.title)}" 
        loading="lazy" 
        onerror="this.src='https://via.placeholder.com/300x450/0f1015/38bdf8?text=Nexus'"
      />

      <!-- Scrim Gradient Overlay -->
      <div class="scrim-overlay"></div>

      <!-- Top Glass Badges -->
      <div class="card-glass-badges">
        <span class="badge-quality">${qualityLabel}</span>
        <span class="badge-rating">
          <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          <span>${score}</span>
        </span>
      </div>

      <!-- Centered Play Icon on Hover -->
      <div class="card-play-action">
        <div class="play-btn-circle" title="Play">
          <svg class="play-svg" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>

      <!-- Bottom Metadata (Translates upward on hover) -->
      <div class="card-metadata">
        <h3 class="card-title" title="${escapeHtml(item.title)}">
          ${escapeHtml(item.title)}
        </h3>
        <div class="card-sub">
          <span>${primaryGenre}</span>
          <span class="dot">•</span>
          <span>${year}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-play-action') || e.target.closest('.play-btn-circle')) {
        e.stopPropagation();
        playMediaDirectly(item);
      } else {
        openDetail(item.id);
      }
    });

    return card;
  }

  // ==========================================================================
  // Direct Play Engine (1-Click Play from Hero, Card or Metamodal)
  // ==========================================================================
  async function playMediaDirectly(item, season = 0, episode = 0) {
    const se = (item.subjectType === 2 && season === 0) ? 1 : season;
    const ep = (item.subjectType === 2 && episode === 0) ? 1 : episode;
    showToast(`Loading "${item.title}"...`);

    // 1. If detailPath is already known on item, launch instantly with 0 latency!
    if (item.detailPath) {
      launchVideoPlayer({
        subjectId: item.id,
        title: item.title,
        cover: item.cover,
        season: se,
        episode: ep,
        detailPath: item.detailPath,
        streamUrl: '',
        streams: [],
        captions: [],
        subjectType: item.subjectType || 1
      });

      // Background stream pre-fetch for direct stream & subtitles
      apiGet(`/api/play/${item.id}`, { season: se, episode: ep, detailPath: item.detailPath })
        .then(res => {
          if (res && res.streams && res.streams.length && state.currentPlaying && state.currentPlaying.subjectId === item.id) {
            state.currentPlaying.streamUrl = res.streams[0].raw_url || res.streams[0].stream_url;
            state.currentPlaying.streams = res.streams;
            state.currentPlaying.captions = res.captions || [];
            setupSubtitles(res.captions || []);
            setupQualityPicker(res.streams, state.currentPlaying.streamUrl);
          }
        })
        .catch(err => console.log('Background stream pre-fetch notice:', err));

      return;
    }

    // 2. If detailPath is not yet attached, fetch title detail to resolve detailPath
    try {
      const data = await apiGet(`/api/detail/${item.id}`);
      const subject = data.subject || item;
      const dp = subject.detailPath || item.detailPath;

      launchVideoPlayer({
        subjectId: item.id,
        title: subject.title || item.title,
        cover: subject.cover || item.cover,
        season: se,
        episode: ep,
        detailPath: dp,
        streamUrl: '',
        streams: [],
        captions: [],
        subjectType: subject.subjectType || item.subjectType || 1
      });
    } catch (err) {
      console.warn('Direct play exception, opening title details:', err);
      openDetail(item.id);
    }
  }

  // ==========================================================================
  // Discover Feed & Hero Rotation
  // ==========================================================================
  async function loadHomeFeed() {
    try {
      el.serverStatusBadge.innerHTML = `<span class="status-pulse"></span> Connecting...`;
      const data = await apiGet('/api/home');
      state.homeData = data;
      state.heroItems = data.hero || [];

      el.serverStatusBadge.innerHTML = `<span class="status-pulse"></span> Online`;

      // 1. Setup Hero Banner
      if (state.heroItems.length > 0) {
        setupHeroShowcase();
      }

      // 2. Render Sections Carousels with smooth scroll arrows
      renderDiscoverSections(data.sections || []);

    } catch (err) {
      console.error('Home feed loading error:', err);
      el.serverStatusBadge.innerHTML = `<span class="status-pulse" style="background:#ef4444;box-shadow:0 0 8px #ef4444"></span> Offline`;
      el.discoverSections.innerHTML = `
        <div style="text-align:center; padding: 4rem 1rem;">
          <h3 style="font-size: 1.3rem; margin-bottom: 0.5rem;">Could not connect to streaming backend</h3>
          <p style="color: var(--text-dim); margin-bottom: 1.5rem;">Check your network or server endpoint configuration in Settings.</p>
          <button class="btn-primary" onclick="location.reload()">Retry Connection</button>
        </div>
      `;
    }
  }

  function setupHeroShowcase() {
    if (!state.heroItems.length) return;
    state.currentHeroIndex = 0;
    renderHero(state.heroItems[0]);

    if (state.heroTimer) clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => {
      state.currentHeroIndex = (state.currentHeroIndex + 1) % state.heroItems.length;
      renderHero(state.heroItems[state.currentHeroIndex]);
    }, 8000);
  }

  function renderHero(item) {
    if (!item) return;
    el.heroBackdrop.src = item.cover || '';
    el.heroTag.textContent = item.subjectType === 2 ? 'FEATURED SERIES' : 'FEATURED MOVIE';
    el.heroRating.innerHTML = `
      <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
      <span>${item.score || '8.8'}</span>
    `;
    el.heroTitle.textContent = item.title;
    el.heroYear.textContent = (item.releaseDate || '').substring(0, 4) || '2024';
    el.heroDuration.textContent = item.duration ? `${Math.floor(item.duration / 60)}h ${item.duration % 60}m` : (item.subjectType === 2 ? 'TV Series' : '1h 55m');
    el.heroGenre.textContent = item.genre || 'Action, Drama';
    el.heroOverview.textContent = item.description || `Stream ${item.title} in crystal-clear high definition with multi-language audio and zero mid-roll interruptions.`;

    // Direct 1-Click Play on Hero button!
    el.btnHeroPlay.onclick = () => playMediaDirectly(item);
    el.btnHeroList.onclick = () => toggleWatchlist(item);
  }

  function renderDiscoverSections(sections) {
    el.discoverSections.innerHTML = '';
    if (!sections || !sections.length) return;

    // 1. Build Signature "Top 10 Worldwide Today" Rail (dexter.pw / Netflix format)
    const allItems = [];
    const seenTopIds = new Set();
    sections.forEach(s => {
      (s.items || []).forEach(it => {
        if (!seenTopIds.has(it.id)) {
          seenTopIds.add(it.id);
          allItems.push(it);
        }
      });
    });

    const top10Items = allItems.slice(0, 10);
    if (top10Items.length >= 5) {
      const top10Sec = document.createElement('section');
      top10Sec.className = 'catalog-section top10-section';
      top10Sec.innerHTML = `
        <div class="section-header">
          <div class="section-title-wrap">
            <h2 class="section-title">Top 10 Worldwide Today</h2>
            <span class="collection-pill">
              <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              Global Daily Ranks
            </span>
          </div>
        </div>
        <div class="carousel-wrap">
          <button class="carousel-arrow prev" title="Previous">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <div class="cards-carousel top10-carousel"></div>
          <button class="carousel-arrow next" title="Next">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      `;

      const top10Carousel = top10Sec.querySelector('.cards-carousel');
      const prevBtn = top10Sec.querySelector('.carousel-arrow.prev');
      const nextBtn = top10Sec.querySelector('.carousel-arrow.next');

      prevBtn.addEventListener('click', () => {
        top10Carousel.scrollBy({ left: -top10Carousel.clientWidth * 0.75, behavior: 'smooth' });
      });
      nextBtn.addEventListener('click', () => {
        top10Carousel.scrollBy({ left: top10Carousel.clientWidth * 0.75, behavior: 'smooth' });
      });

      top10Items.forEach((item, index) => {
        const wrap = document.createElement('div');
        wrap.className = 'ranked-card-wrap';
        wrap.innerHTML = `<span class="rank-number">${index + 1}</span>`;
        wrap.appendChild(createMediaCard(item));
        top10Carousel.appendChild(wrap);
      });

      el.discoverSections.appendChild(top10Sec);
    }

    // 2. Render Curated Franchise, Genre & Status Rails
    sections.forEach(sec => {
      const items = sec.items || [];
      if (!items.length) return;

      const secEl = document.createElement('section');
      secEl.className = 'catalog-section';

      const isCollection = sec.title.toLowerCase().includes('fantasy') ||
                           sec.title.toLowerCase().includes('superhero') ||
                           sec.title.toLowerCase().includes('animation') ||
                           sec.title.toLowerCase().includes('drama');

      const pillHtml = isCollection
        ? `<span class="collection-pill">
             <svg viewBox="0 0 24 24"><path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM5 8h14v10H5V8z"/></svg>
             ${items.length} Titles • Franchise Collection
           </span>`
        : '';

      secEl.innerHTML = `
        <div class="section-header">
          <div class="section-title-wrap">
            <h2 class="section-title">${escapeHtml(sec.title)}</h2>
            ${pillHtml}
          </div>
        </div>
        <div class="carousel-wrap">
          <button class="carousel-arrow prev" title="Previous">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <div class="cards-carousel"></div>
          <button class="carousel-arrow next" title="Next">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      `;

      const carousel = secEl.querySelector('.cards-carousel');
      const prevBtn = secEl.querySelector('.carousel-arrow.prev');
      const nextBtn = secEl.querySelector('.carousel-arrow.next');

      prevBtn.addEventListener('click', () => {
        carousel.scrollBy({ left: -carousel.clientWidth * 0.75, behavior: 'smooth' });
      });

      nextBtn.addEventListener('click', () => {
        carousel.scrollBy({ left: carousel.clientWidth * 0.75, behavior: 'smooth' });
      });

      items.forEach(item => {
        carousel.appendChild(createMediaCard(item));
      });

      el.discoverSections.appendChild(secEl);
    });
  }

  function renderCategorizedGrid(type) {
    const targetGrid = type === 'movies' ? el.moviesGrid : el.seriesGrid;
    if (!targetGrid || !state.homeData) return;

    targetGrid.innerHTML = '';
    const items = [];
    const seen = new Set();

    (state.homeData.sections || []).forEach(sec => {
      (sec.items || []).forEach(item => {
        const matchesType = (type === 'movies' && item.subjectType !== 2) || (type === 'series' && item.subjectType === 2);
        if (matchesType && !seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      });
    });

    items.forEach(item => {
      targetGrid.appendChild(createMediaCard(item));
    });
  }

  // ==========================================================================
  // Genre Filter Handling
  // ==========================================================================
  el.filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      el.filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const genre = chip.getAttribute('data-genre') || 'all';
      state.activeGenre = genre;
      filterSectionsByGenre(genre);
    });
  });

  function filterSectionsByGenre(genre) {
    const cards = document.querySelectorAll('#view-discover .media-card');
    cards.forEach(card => {
      if (genre === 'all') {
        card.style.display = 'block';
      } else {
        const sub = card.querySelector('.card-sub span:last-child');
        const text = (sub ? sub.textContent : '').toLowerCase();
        card.style.display = text.includes(genre) ? 'block' : 'none';
      }
    });
  }

  // ==========================================================================
  // Comprehensive Search System (Upstream + Catalog Merge)
  // ==========================================================================
  el.searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    el.searchClearBtn.style.display = query ? 'block' : 'none';

    if (state.searchDebounce) clearTimeout(state.searchDebounce);
    if (!query) {
      if (state.currentTab === 'search') switchTab('discover');
      return;
    }

    state.searchDebounce = setTimeout(() => {
      executeSearch(query);
    }, 280);
  });

  el.searchClearBtn.addEventListener('click', () => {
    el.searchInput.value = '';
    el.searchClearBtn.style.display = 'none';
    if (state.currentTab === 'search') switchTab('discover');
  });

  async function executeSearch(query) {
    switchTab('search');
    el.searchQueryLabel.textContent = `"${query}"`;
    el.searchResultsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-dim);">
        Searching titles...
      </div>
    `;

    const seen = new Set();
    const mergedResults = [];

    // 1. Upstream Backend API Search
    try {
      const res = await apiGet('/api/search', { q: query, pageSize: 40 });
      (res.items || []).forEach(it => {
        const sid = String(it.id);
        if (sid && !seen.has(sid)) {
          seen.add(sid);
          mergedResults.push(it);
        }
      });
    } catch (err) {
      console.warn('Backend search notice:', err);
    }

    // 2. Comprehensive in-catalog search to guarantee all catalog movies/shows are found
    if (state.homeData) {
      const qLow = query.toLowerCase().trim();
      const tokens = qLow.split(/\s+/).filter(Boolean);
      (state.homeData.sections || []).forEach(sec => {
        (sec.items || []).forEach(it => {
          const sid = String(it.id);
          if (sid && !seen.has(sid)) {
            const t = (it.title || '').toLowerCase();
            const g = (it.genre || '').toLowerCase();
            const d = (it.description || '').toLowerCase();
            const matches = tokens.length ? tokens.every(tok => t.includes(tok) || g.includes(tok) || d.includes(tok)) : false;
            if (matches || t.includes(qLow) || g.includes(qLow)) {
              seen.add(sid);
              mergedResults.push(it);
            }
          }
        });
      });
      (state.heroItems || []).forEach(it => {
        const sid = String(it.id);
        if (sid && !seen.has(sid)) {
          const t = (it.title || '').toLowerCase();
          const d = (it.description || '').toLowerCase();
          const matches = tokens.length ? tokens.every(tok => t.includes(tok) || d.includes(tok)) : false;
          if (matches || t.includes(qLow)) {
            seen.add(sid);
            mergedResults.push(it);
          }
        }
      });
    }

    if (!mergedResults.length) {
      el.searchResultsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem;">
          <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem; color: #fff;">No titles found for "${escapeHtml(query)}"</h3>
          <p style="color: var(--text-dim);">Try searching with fewer words, or browse popular titles in Discover.</p>
        </div>
      `;
      return;
    }

    el.searchResultsGrid.innerHTML = '';
    mergedResults.forEach(item => {
      el.searchResultsGrid.appendChild(createMediaCard(item));
    });
  }

  // ==========================================================================
  // Detail Metamodal (Desktop Cinema Enhanced)
  // ==========================================================================
  async function openDetail(subjectId) {
    el.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Reset fields
    el.detailTitle.textContent = 'Loading...';
    el.detailSynopsis.textContent = 'Fetching metadata and stream sources...';
    el.detailGenres.innerHTML = '';
    el.detailCastRow.innerHTML = '';
    el.seriesSection.style.display = 'none';
    el.streamsList.innerHTML = `<div style="color: var(--text-dim); padding: 0.5rem;">Resolving available streams...</div>`;
    el.btnDetailPlayText.textContent = 'Watch Now';

    try {
      const data = await apiGet(`/api/detail/${subjectId}`);
      const subject = data.subject || {};
      const seasons = data.seasons || [];
      state.currentDetail = { ...subject, seasons };

      // Render Metadata
      el.detailBackdropImg.src = subject.cover || '';
      el.detailPosterImg.src = subject.cover || '';
      el.detailTitle.textContent = subject.title || 'Untitled';
      el.detailScore.textContent = subject.score || '8.4';
      el.detailYear.textContent = (subject.releaseDate || '').substring(0, 4) || '2024';
      el.detailDuration.textContent = subject.duration ? `${Math.floor(subject.duration / 60)}h ${subject.duration % 60}m` : (subject.subjectType === 2 ? 'TV Series' : 'Movie');
      el.detailCountry.textContent = subject.country || 'Global';
      el.detailSynopsis.textContent = subject.description || 'No synopsis provided.';

      // Genres
      el.detailGenres.innerHTML = '';
      const genreList = (subject.genre || 'Action, Drama').split(',');
      genreList.forEach(g => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = g.trim();
        el.detailGenres.appendChild(tag);
      });

      // Cast
      el.detailCastRow.innerHTML = '';
      const stars = subject.stars || [];
      if (stars.length) {
        stars.forEach(s => {
          const chip = document.createElement('div');
          chip.className = 'cast-chip';
          chip.innerHTML = `
            <img class="cast-avatar" src="${s.avatar || 'https://via.placeholder.com/60'}" onerror="this.src='https://via.placeholder.com/60'">
            <span>${escapeHtml(s.name)}</span>
          `;
          el.detailCastRow.appendChild(chip);
        });
      }

      // Watchlist Button State
      updateWatchlistBtnState(subject.id);
      el.btnDetailWatchlist.onclick = () => toggleWatchlist(subject);

      // Primary Play Button Action
      el.btnDetailPlay.onclick = () => {
        launchVideoPlayer({
          subjectId: subject.id,
          title: subject.title,
          cover: subject.cover,
          season: state.selectedSeason,
          episode: state.selectedEpisode,
          detailPath: subject.detailPath,
          streamUrl: (state.currentStreams[0] && (state.currentStreams[0].raw_url || state.currentStreams[0].stream_url)) || '',
          streams: state.currentStreams,
          captions: state.currentCaptions,
          subjectType: subject.subjectType,
        });
      };

      // Series vs Movie Flow
      if (subject.subjectType === 2 && seasons.length > 0) {
        el.seriesSection.style.display = 'flex';
        el.btnDetailPlayText.textContent = `Watch S${seasons[0].season} E1`;
        renderSeasonPicker(seasons, subject.id);
      } else {
        el.seriesSection.style.display = 'none';
        el.btnDetailPlayText.textContent = 'Watch Movie';
        state.selectedSeason = 0;
        state.selectedEpisode = 0;
        fetchStreamsForMedia(subject.id, 0, 0, subject.detailPath);
      }

    } catch (err) {
      console.error('Failed to load detail:', err);
      el.detailSynopsis.textContent = 'Could not load details for this title. Please try again.';
      el.streamsList.innerHTML = `<div style="color: var(--accent-crimson);">Stream sources unavailable.</div>`;
    }
  }

  function closeDetailModal() {
    el.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  el.modalCloseBtn.addEventListener('click', closeDetailModal);
  el.modalOverlay.addEventListener('click', (e) => {
    if (e.target === el.modalOverlay) closeDetailModal();
  });

  // Series Season & Episode Picker
  function renderSeasonPicker(seasons, subjectId) {
    el.seasonSelector.innerHTML = '';
    state.selectedSeason = seasons[0].season;

    seasons.forEach((s, idx) => {
      const btn = document.createElement('button');
      btn.className = `season-btn ${idx === 0 ? 'active' : ''}`;
      btn.textContent = `Season ${s.season}`;
      btn.addEventListener('click', () => {
        el.seasonSelector.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedSeason = s.season;
        renderEpisodesList(s.episodes || [], subjectId, s.season);
      });
      el.seasonSelector.appendChild(btn);
    });

    renderEpisodesList(seasons[0].episodes || [], subjectId, seasons[0].season);
  }

  function renderEpisodesList(episodes, subjectId, seasonNum) {
    el.episodesGrid.innerHTML = '';
    state.selectedEpisode = episodes[0] ? episodes[0].episode : 1;

    episodes.forEach((ep, idx) => {
      const card = document.createElement('div');
      card.className = `episode-card ${idx === 0 ? 'active' : ''}`;
      card.innerHTML = `
        <div class="episode-title">${ep.episode}. ${escapeHtml(ep.title || `Episode ${ep.episode}`)}</div>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--accent-cyan)">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      `;

      card.addEventListener('click', () => {
        el.episodesGrid.querySelectorAll('.episode-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        state.selectedEpisode = ep.episode;
        el.btnDetailPlayText.textContent = `Watch S${seasonNum} E${ep.episode}`;
        fetchStreamsForMedia(subjectId, seasonNum, ep.episode, state.currentDetail.detailPath);
      });

      el.episodesGrid.appendChild(card);
    });

    if (episodes.length > 0) {
      fetchStreamsForMedia(subjectId, seasonNum, episodes[0].episode, state.currentDetail.detailPath);
    }
  }

  // Fetch Streams for Movie or Selected Episode
  async function fetchStreamsForMedia(subjectId, season, episode, detailPath) {
    el.streamsList.innerHTML = `<div style="color: var(--text-dim); padding: 0.5rem;">Resolving available CDN sources...</div>`;

    try {
      const res = await apiGet(`/api/play/${subjectId}`, {
        season,
        episode,
        detailPath: detailPath || undefined,
      });

      state.currentStreams = res.streams || [];
      state.currentCaptions = res.captions || [];

      if (!state.currentStreams.length) {
        el.streamsList.innerHTML = `
          <div style="color: var(--text-dim); padding: 0.75rem; text-align: center;">
            No direct streams available for this item currently.
          </div>
        `;
        return;
      }

      el.streamsList.innerHTML = '';
      state.currentStreams.forEach((stream, idx) => {
        const item = document.createElement('div');
        item.className = 'stream-item';

        const resLabel = stream.resolution || (idx === 0 ? '1080p' : '720p');
        const streamUrl = stream.raw_url || stream.stream_url;

        item.innerHTML = `
          <div class="stream-left">
            <span class="stream-res-badge">${escapeHtml(resLabel)}</span>
            <span class="stream-name">⚡ Fast CDN Server ${idx + 1} (${stream.format || 'MP4'})</span>
          </div>
          <div class="stream-play-btn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            <span>Play Now</span>
          </div>
        `;

        item.addEventListener('click', () => {
          launchVideoPlayer({
            subjectId,
            title: state.currentDetail.title,
            cover: state.currentDetail.cover,
            season,
            episode,
            streamUrl,
            streams: state.currentStreams,
            captions: state.currentCaptions,
            detailPath: state.currentDetail.detailPath,
            subjectType: state.currentDetail.subjectType,
          });
        });

        el.streamsList.appendChild(item);
      });

    } catch (err) {
      console.error('Playback resolution error:', err);
      el.streamsList.innerHTML = `<div style="color: var(--accent-crimson);">Could not resolve stream source.</div>`;
    }
  }

  // ==========================================================================
  // Video Player Engine (Native Stremio Cinema Player powered by Backend API)
  // ==========================================================================
  let playerHideTimer = null;

  function loadAndPlayStream(streamUrl) {
    if (!streamUrl) return;

    let finalUrl = streamUrl;
    if (finalUrl.startsWith('http://')) {
      finalUrl = 'https://' + finalUrl.substring(7);
    }

    el.mainVideo.src = finalUrl;
    el.mainVideo.load();

    const playPromise = el.mainVideo.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          if (el.playerCenterPlay) el.playerCenterPlay.style.display = 'none';
        })
        .catch(e => {
          console.log('Autoplay interaction required:', e);
          if (el.playerCenterPlay) el.playerCenterPlay.style.display = 'flex';
          showPlayerControls();
        });
    }
  }

  async function launchVideoPlayer(playData) {
    closeDetailModal();
    state.currentPlaying = playData;

    el.playerContainer.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Format title
    let displayTitle = playData.title || 'Now Playing';
    if (playData.season > 0 && playData.episode > 0) {
      displayTitle += ` — S${playData.season} E${playData.episode}`;
    }
    el.playerTitleDisplay.textContent = displayTitle;

    // Next Episode Button Visibility
    const isSeries = playData.subjectType === 2;
    el.btnNextEp.style.display = isSeries ? 'flex' : 'none';

    // Reset video state
    el.mainVideo.pause();
    el.mainVideo.removeAttribute('src');
    el.mainVideo.load();
    el.mainVideo.style.display = 'block';

    // Reset Subtitles & Quality Picker
    setupSubtitles(playData.captions || []);
    setupQualityPicker(playData.streams || [], playData.streamUrl);

    showPlayerControls();

    // If stream URL is already known and ready, play immediately
    if (playData.streamUrl) {
      loadAndPlayStream(playData.streamUrl);
      return;
    }

    // Resolve stream directly from our backend API
    showToast(`Connecting to stream for "${playData.title}"...`);
    try {
      const res = await apiGet(`/api/play/${playData.subjectId}`, {
        season: playData.season,
        episode: playData.episode,
        detailPath: playData.detailPath,
      });

      if (res && res.streams && res.streams.length) {
        state.currentPlaying.streams = res.streams;
        state.currentPlaying.captions = res.captions || [];

        setupSubtitles(res.captions || []);

        const initialStream = res.streams[0].raw_url || res.streams[0].stream_url;
        state.currentPlaying.streamUrl = initialStream;
        setupQualityPicker(res.streams, initialStream);

        loadAndPlayStream(initialStream);
      } else {
        showToast('No stream sources returned by backend for this title.');
      }
    } catch (err) {
      console.error('Failed to resolve stream from backend:', err);
      showToast('Could not connect to streaming backend.');
    }
  }

  function closeVideoPlayer() {
    savePlaybackProgress();
    el.mainVideo.pause();
    el.mainVideo.removeAttribute('src');
    el.mainVideo.load();
    el.playerContainer.classList.remove('active');
    document.body.style.overflow = '';
    renderLibraryView();
  }

  el.playerBackBtn.addEventListener('click', closeVideoPlayer);

  // Play / Pause Controls
  function togglePlayPause() {
    if (el.mainVideo.paused) {
      el.mainVideo.play();
    } else {
      el.mainVideo.pause();
    }
  }

  el.btnPlayPause.addEventListener('click', togglePlayPause);
  el.playerCenterPlay.addEventListener('click', togglePlayPause);
  el.mainVideo.addEventListener('click', togglePlayPause);

  el.mainVideo.addEventListener('play', () => {
    el.btnPlayPause.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
      </svg>
    `;
    el.playerCenterPlay.style.display = 'none';
  });

  el.mainVideo.addEventListener('pause', () => {
    el.btnPlayPause.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
    `;
    el.playerCenterPlay.style.display = 'flex';
    showPlayerControls();
  });

  // 10s Skips
  el.btnSkipBack.addEventListener('click', () => {
    el.mainVideo.currentTime = Math.max(0, el.mainVideo.currentTime - 10);
  });
  el.btnSkipFwd.addEventListener('click', () => {
    el.mainVideo.currentTime = Math.min(el.mainVideo.duration || 0, el.mainVideo.currentTime + 10);
  });

  // Next Episode for Series
  el.btnNextEp.addEventListener('click', () => {
    if (!state.currentPlaying || !state.currentDetail) return;
    const nextEp = state.currentPlaying.episode + 1;
    showToast(`Loading Episode ${nextEp}...`);
    fetchStreamsForMedia(state.currentPlaying.subjectId, state.currentPlaying.season, nextEp, state.currentDetail.detailPath);
  });

  // Time Update & Scrubbing
  el.mainVideo.addEventListener('timeupdate', () => {
    const cur = el.mainVideo.currentTime || 0;
    const dur = el.mainVideo.duration || 0;

    el.timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;

    if (dur > 0) {
      const pct = (cur / dur) * 100;
      el.timelineProgress.style.width = `${pct}%`;
      el.timelineThumb.style.left = `${pct}%`;
    }
  });

  el.mainVideo.addEventListener('progress', () => {
    if (el.mainVideo.buffered.length > 0 && el.mainVideo.duration > 0) {
      const end = el.mainVideo.buffered.end(el.mainVideo.buffered.length - 1);
      const pct = (end / el.mainVideo.duration) * 100;
      el.timelineBuffered.style.width = `${pct}%`;
    }
  });

  el.timeline.addEventListener('click', (e) => {
    const rect = el.timeline.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    if (el.mainVideo.duration) {
      el.mainVideo.currentTime = pos * el.mainVideo.duration;
    }
  });

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Volume
  el.volumeSlider.addEventListener('input', (e) => {
    el.mainVideo.volume = parseFloat(e.target.value);
    el.mainVideo.muted = false;
  });

  el.btnMute.addEventListener('click', () => {
    el.mainVideo.muted = !el.mainVideo.muted;
  });

  // Fullscreen & PiP
  el.btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      el.playerContainer.requestFullscreen().catch(err => console.log(err));
    } else {
      document.exitFullscreen();
    }
  });

  el.btnPip.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await el.mainVideo.requestPictureInPicture();
      }
    } catch (e) {
      console.log('PiP not supported:', e);
    }
  });

  // Subtitles Integration (WebVTT from backend proxy)
  function setupSubtitles(captions) {
    while (el.mainVideo.firstChild) {
      el.mainVideo.removeChild(el.mainVideo.firstChild);
    }
    el.menuSubtitles.innerHTML = '';

    const offBtn = document.createElement('button');
    offBtn.className = 'menu-item active';
    offBtn.textContent = 'Off';
    offBtn.addEventListener('click', () => {
      Array.from(el.mainVideo.textTracks).forEach(t => t.mode = 'disabled');
      el.menuSubtitles.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
      offBtn.classList.add('active');
      el.menuSubtitles.classList.remove('active');
    });
    el.menuSubtitles.appendChild(offBtn);

    captions.forEach(c => {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = c.label || c.lang;
      track.srclang = c.lang || 'en';
      track.src = `${API_BASE}${c.url}`;
      el.mainVideo.appendChild(track);

      const btn = document.createElement('button');
      btn.className = 'menu-item';
      btn.textContent = c.label || c.lang;
      btn.addEventListener('click', () => {
        Array.from(el.mainVideo.textTracks).forEach(t => {
          t.mode = (t.label === track.label) ? 'showing' : 'disabled';
        });
        el.menuSubtitles.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
        btn.classList.add('active');
        el.menuSubtitles.classList.remove('active');
        showToast(`Subtitles: ${c.label}`);
      });
      el.menuSubtitles.appendChild(btn);
    });

    el.btnSubtitles.style.display = captions.length > 0 ? 'flex' : 'none';
  }

  el.btnSubtitles.addEventListener('click', () => {
    el.menuSubtitles.classList.toggle('active');
    el.menuQuality.classList.remove('active');
  });

  // Quality Picker
  function setupQualityPicker(streams, currentUrl) {
    el.menuQuality.innerHTML = '';
    streams.forEach((s, idx) => {
      const btn = document.createElement('button');
      const isCur = (s.raw_url === currentUrl || s.stream_url === currentUrl);
      btn.className = `menu-item ${isCur ? 'active' : ''}`;
      btn.textContent = `${s.resolution || 'Auto'} (Server ${idx + 1})`;

      btn.addEventListener('click', () => {
        const curTime = el.mainVideo.currentTime;
        let url = s.raw_url || s.stream_url;
        if (url.includes('hakunaymatata.com') || url.includes('bcdnxw') || url.includes('aoneroom.com')) {
          url = `${API_BASE}/api/proxy-stream?url=${encodeURIComponent(url)}`;
        }
        el.mainVideo.src = url;
        el.mainVideo.currentTime = curTime;
        el.mainVideo.play();
        el.menuQuality.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
        btn.classList.add('active');
        el.menuQuality.classList.remove('active');
        showToast(`Switched to Server ${idx + 1}`);
      });

      el.menuQuality.appendChild(btn);
    });

    el.btnQuality.style.display = streams.length > 1 ? 'flex' : 'none';
  }

  el.btnQuality.addEventListener('click', () => {
    el.menuQuality.classList.toggle('active');
    el.menuSubtitles.classList.remove('active');
  });

  // Auto-Hide Controls on Inactivity
  function showPlayerControls() {
    el.playerOverlay.classList.add('visible');
    if (playerHideTimer) clearTimeout(playerHideTimer);
    playerHideTimer = setTimeout(() => {
      if (!el.mainVideo.paused) {
        el.playerOverlay.classList.remove('visible');
        el.menuSubtitles.classList.remove('active');
        el.menuQuality.classList.remove('active');
      }
    }, 3500);
  }

  el.playerContainer.addEventListener('mousemove', showPlayerControls);
  el.playerContainer.addEventListener('touchstart', showPlayerControls);

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (!el.playerContainer.classList.contains('active')) {
      if (e.key === '/' || (e.ctrlKey && e.key === 'k')) {
        e.preventDefault();
        el.searchInput.focus();
      }
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        el.mainVideo.currentTime = Math.max(0, el.mainVideo.currentTime - 10);
        showPlayerControls();
        break;
      case 'ArrowRight':
        e.preventDefault();
        el.mainVideo.currentTime = Math.min(el.mainVideo.duration || 0, el.mainVideo.currentTime + 10);
        showPlayerControls();
        break;
      case 'ArrowUp':
        e.preventDefault();
        el.mainVideo.volume = Math.min(1, el.mainVideo.volume + 0.1);
        el.volumeSlider.value = el.mainVideo.volume;
        showPlayerControls();
        break;
      case 'ArrowDown':
        e.preventDefault();
        el.mainVideo.volume = Math.max(0, el.mainVideo.volume - 0.1);
        el.volumeSlider.value = el.mainVideo.volume;
        showPlayerControls();
        break;
      case 'f':
      case 'F':
        el.btnFullscreen.click();
        break;
      case 'm':
      case 'M':
        el.btnMute.click();
        break;
      case 'Escape':
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          closeVideoPlayer();
        }
        break;
    }
  });

  // Save Playback Progress
  setInterval(savePlaybackProgress, 5000);

  function savePlaybackProgress() {
    if (!state.currentPlaying || !el.mainVideo || !el.mainVideo.duration) return;
    const cur = el.mainVideo.currentTime;
    const dur = el.mainVideo.duration;
    if (cur < 5) return;

    const key = `${state.currentPlaying.subjectId}_s${state.currentPlaying.season}_e${state.currentPlaying.episode}`;
    state.watchHistory[key] = {
      id: state.currentPlaying.subjectId,
      title: state.currentPlaying.title,
      cover: state.currentPlaying.cover,
      season: state.currentPlaying.season,
      episode: state.currentPlaying.episode,
      subjectType: state.currentPlaying.subjectType,
      progress: Math.floor(cur),
      duration: Math.floor(dur),
      timestamp: Date.now(),
    };

    localStorage.setItem('nexus_watch_history', JSON.stringify(state.watchHistory));
  }

  // ==========================================================================
  // Library View (Continue Watching & Watchlist)
  // ==========================================================================
  function renderLibraryView() {
    const historyItems = Object.values(state.watchHistory)
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter(i => i.progress < (i.duration - 20));

    el.libraryContinueGrid.innerHTML = '';
    if (!historyItems.length) {
      el.libraryContinueGrid.innerHTML = `<div style="color: var(--text-dim); padding: 1rem;">No recent playback history.</div>`;
    } else {
      historyItems.slice(0, 12).forEach(item => {
        const card = createMediaCard(item);
        const pct = Math.round((item.progress / item.duration) * 100);
        const bar = document.createElement('div');
        bar.style.cssText = `
          position: absolute; bottom: 0; left: 0; right: 0; height: 4px;
          background: rgba(255,255,255,0.2); z-index: 5;
        `;
        bar.innerHTML = `<div style="height:100%;width:${pct}%;background:var(--accent-cyan)"></div>`;
        card.querySelector('.poster-box').appendChild(bar);
        el.libraryContinueGrid.appendChild(card);
      });
    }

    el.libraryWatchlistGrid.innerHTML = '';
    if (!state.watchlist.length) {
      el.libraryWatchlistGrid.innerHTML = `<div style="color: var(--text-dim); padding: 1rem;">Your watchlist is currently empty.</div>`;
    } else {
      state.watchlist.forEach(item => {
        el.libraryWatchlistGrid.appendChild(createMediaCard(item));
      });
    }
  }

  function toggleWatchlist(item) {
    const idx = state.watchlist.findIndex(i => String(i.id) === String(item.id));
    if (idx >= 0) {
      state.watchlist.splice(idx, 1);
      showToast(`Removed from My Watchlist`);
    } else {
      state.watchlist.push({
        id: item.id,
        title: item.title,
        cover: item.cover,
        score: item.score,
        releaseDate: item.releaseDate,
        genre: item.genre,
        subjectType: item.subjectType,
      });
      showToast(`Added to My Watchlist!`);
    }
    localStorage.setItem('nexus_watchlist', JSON.stringify(state.watchlist));
    updateWatchlistBtnState(item.id);
  }

  function updateWatchlistBtnState(subjectId) {
    if (!el.btnDetailWatchlist) return;
    const inList = state.watchlist.some(i => String(i.id) === String(subjectId));
    el.btnDetailWatchlist.classList.toggle('in-watchlist', inList);
    el.btnDetailWatchlist.innerHTML = inList ? `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
      <span>In Watchlist</span>
    ` : `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
      <span>+ Add to Watchlist</span>
    `;
  }

  // ==========================================================================
  // Apps Download & Settings Modals
  // ==========================================================================
  el.btnGetApps.addEventListener('click', () => {
    el.appsModal.classList.add('active');
  });
  el.appsModalClose.addEventListener('click', () => {
    el.appsModal.classList.remove('active');
  });
  el.appsModal.addEventListener('click', (e) => {
    if (e.target === el.appsModal) el.appsModal.classList.remove('active');
  });

  el.btnSettings.addEventListener('click', () => {
    el.apiInput.value = API_BASE;
    el.settingsModal.classList.add('active');
  });
  el.settingsModalClose.addEventListener('click', () => {
    el.settingsModal.classList.remove('active');
  });
  el.settingsModal.addEventListener('click', (e) => {
    if (e.target === el.settingsModal) el.settingsModal.classList.remove('active');
  });

  el.btnSaveApi.addEventListener('click', () => {
    const val = el.apiInput.value.trim();
    if (val) {
      localStorage.setItem('nexus_api_endpoint', val);
      API_BASE = val;
      showToast('Endpoint saved! Connecting...');
      el.settingsModal.classList.remove('active');
      loadHomeFeed();
    }
  });

  el.btnResetApi.addEventListener('click', () => {
    localStorage.removeItem('nexus_api_endpoint');
    API_BASE = DEFAULT_API;
    el.apiInput.value = DEFAULT_API;
    showToast('Reset to default cloud server!');
    el.settingsModal.classList.remove('active');
    loadHomeFeed();
  });

  // ==========================================================================
  // Sidebar Navigation Event Binding
  // ==========================================================================
  el.navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });

  el.brandIcon.addEventListener('click', () => switchTab('discover'));

  // ==========================================================================
  // Boot Sequence
  // ==========================================================================
  loadHomeFeed();

})();
