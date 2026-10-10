/**
 * Nexus Web — Stremio-Inspired Minimalist Streaming Client
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
    if (window.location.protocol.startsWith('http') && 
       (window.location.port === '8000' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      return window.location.origin;
    }
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
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
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

    // Control filter bar visibility (only on Discover, Movies, Series)
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
  // Media Card Rendering Component (Stremio 2:3 Ratio)
  // ==========================================================================
  function createMediaCard(item) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.setAttribute('data-id', item.id);

    const isSeries = item.subjectType === 2;
    const typeLabel = isSeries ? 'Series' : 'Movie';
    const year = (item.releaseDate || '').substring(0, 4) || '2024';
    const score = item.score || '8.4';
    const coverUrl = item.cover || 'https://via.placeholder.com/300x450/141322/7c5cfc?text=Nexus';

    card.innerHTML = `
      <div class="poster-box">
        <img class="poster-img" src="${coverUrl}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x450/141322/7c5cfc?text=Nexus'">
        <div class="card-badge-top-left">${typeLabel}</div>
        <div class="card-badge-top-right">
          <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          <span>${score}</span>
        </div>
        <div class="card-play-overlay">
          <div class="play-circle">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="card-sub">
          <span>${year}</span>
          <span>${item.genre ? escapeHtml(item.genre.split(',')[0]) : ''}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openDetail(item.id));
    return card;
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

      // 2. Render Sections Carousels
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

    el.btnHeroPlay.onclick = () => openDetail(item.id);
    el.btnHeroList.onclick = () => toggleWatchlist(item);
  }

  function renderDiscoverSections(sections) {
    el.discoverSections.innerHTML = '';

    sections.forEach(sec => {
      const items = sec.items || [];
      if (!items.length) return;

      const secEl = document.createElement('section');
      secEl.className = 'catalog-section';

      secEl.innerHTML = `
        <div class="section-header">
          <h2 class="section-title">${escapeHtml(sec.title)}</h2>
        </div>
        <div class="carousel-wrap">
          <div class="cards-carousel"></div>
        </div>
      `;

      const carousel = secEl.querySelector('.cards-carousel');
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
  // Instant Search System
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
    }, 300);
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

    let items = [];
    try {
      const res = await apiGet('/api/search', { q: query, pageSize: 40 });
      items = res.items || [];
    } catch (err) {
      console.warn('Backend search notice:', err);
    }

    // Smart Catalog Fallback if backend returned 0 or during network hiccup
    if (!items.length && state.homeData) {
      const qLow = query.toLowerCase();
      const seen = new Set();
      (state.homeData.sections || []).forEach(sec => {
        (sec.items || []).forEach(it => {
          if (!seen.has(it.id)) {
            const t = (it.title || '').toLowerCase();
            const g = (it.genre || '').toLowerCase();
            if (t.includes(qLow) || g.includes(qLow)) {
              seen.add(it.id);
              items.push(it);
            }
          }
        });
      });
      (state.heroItems || []).forEach(it => {
        if (!seen.has(it.id)) {
          const t = (it.title || '').toLowerCase();
          if (t.includes(qLow)) {
            seen.add(it.id);
            items.push(it);
          }
        }
      });
    }

    if (!items.length) {
      el.searchResultsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem;">
          <h3 style="font-size: 1.2rem; margin-bottom: 0.5rem;">No results found for "${escapeHtml(query)}"</h3>
          <p style="color: var(--text-dim);">Try checking the spelling or searching for a different actor or title.</p>
        </div>
      `;
      return;
    }

    el.searchResultsGrid.innerHTML = '';
    items.forEach(item => {
      el.searchResultsGrid.appendChild(createMediaCard(item));
    });
  }

  // ==========================================================================
  // Detail Metamodal (Stremio Signature Split Layout)
  // ==========================================================================
  async function openDetail(subjectId) {
    el.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Reset fields
    el.detailTitle.textContent = 'Loading...';
    el.detailSynopsis.textContent = 'Fetching metadata and stream availability...';
    el.detailGenres.innerHTML = '';
    el.detailCastRow.innerHTML = '';
    el.seriesSection.style.display = 'none';
    el.streamsList.innerHTML = `<div style="color: var(--text-dim); padding: 0.5rem;">Resolving high-speed streams...</div>`;

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

      // Series vs Movie Flow
      if (subject.subjectType === 2 && seasons.length > 0) {
        el.seriesSection.style.display = 'flex';
        renderSeasonPicker(seasons, subject.id);
      } else {
        // Single Movie
        el.seriesSection.style.display = 'none';
        state.selectedSeason = 0;
        state.selectedEpisode = 0;
        fetchStreamsForMedia(subject.id, 0, 0, subject.detailPath);
      }

    } catch (err) {
      console.error('Failed to load detail:', err);
      el.detailSynopsis.textContent = 'Could not load details for this title. Please try again.';
      el.streamsList.innerHTML = `<div style="color: var(--accent-danger);">Stream sources unavailable.</div>`;
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
        <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--accent-primary)">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      `;

      card.addEventListener('click', () => {
        el.episodesGrid.querySelectorAll('.episode-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        state.selectedEpisode = ep.episode;
        fetchStreamsForMedia(subjectId, seasonNum, ep.episode, state.currentDetail.detailPath);
      });

      el.episodesGrid.appendChild(card);
    });

    // Automatically load streams for the first episode
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
            subjectType: state.currentDetail.subjectType,
          });
        });

        el.streamsList.appendChild(item);
      });

    } catch (err) {
      console.error('Playback resolution error:', err);
      el.streamsList.innerHTML = `<div style="color: var(--accent-danger);">Could not resolve stream source.</div>`;
    }
  }

  // ==========================================================================
  // Video Player Engine (Stremio Cinema Fullscreen Mode)
  // ==========================================================================
  let playerHideTimer = null;

  function launchVideoPlayer(playData) {
    closeDetailModal();
    state.currentPlaying = playData;

    el.playerContainer.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Format title
    let displayTitle = playData.title;
    if (playData.season > 0 && playData.episode > 0) {
      displayTitle += ` — S${playData.season} E${playData.episode}`;
    }
    el.playerTitleDisplay.textContent = displayTitle;

    // Next Episode Button Visibility
    const isSeries = playData.subjectType === 2;
    el.btnNextEp.style.display = isSeries ? 'flex' : 'none';

    // Resolve Stream Source URL:
    // When playing in browser, route protected CDN streams via /api/proxy-stream with Referer injection
    let finalStreamUrl = playData.streamUrl;
    if (finalStreamUrl.includes('hakunaymatata.com') || finalStreamUrl.includes('bcdnxw') || finalStreamUrl.includes('aoneroom.com')) {
      finalStreamUrl = `${API_BASE}/api/proxy-stream?url=${encodeURIComponent(playData.streamUrl)}`;
    }
    el.mainVideo.src = finalStreamUrl;
    el.mainVideo.load();

    // Check saved resume point
    const historyKey = `${playData.subjectId}_s${playData.season}_e${playData.episode}`;
    const saved = state.watchHistory[historyKey];
    if (saved && saved.progress > 5 && saved.progress < (saved.duration - 30)) {
      el.mainVideo.currentTime = saved.progress;
      showToast(`Resumed playback at ${formatTime(saved.progress)}`);
    }

    el.mainVideo.play().catch(e => console.log('Autoplay prevented:', e));

    // Inject Subtitles if available
    setupSubtitles(playData.captions || []);

    // Setup Quality Picker
    setupQualityPicker(playData.streams || [], playData.streamUrl);

    showPlayerControls();
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
    // Clear existing text tracks
    while (el.mainVideo.firstChild) {
      el.mainVideo.removeChild(el.mainVideo.firstChild);
    }
    el.menuSubtitles.innerHTML = '';

    // "Off" option
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
        el.mainVideo.src = s.raw_url || s.stream_url;
        el.mainVideo.currentTime = curTime;
        el.mainVideo.play();
        el.menuQuality.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
        btn.classList.add('active');
        el.menuQuality.classList.remove('active');
        showToast(`Switched to ${s.resolution || 'Stream'}`);
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

  // Save Playback Progress for Continue Watching
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
    // 1. Continue Watching
    const historyItems = Object.values(state.watchHistory)
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter(i => i.progress < (i.duration - 20));

    el.libraryContinueGrid.innerHTML = '';
    if (!historyItems.length) {
      el.libraryContinueGrid.innerHTML = `<div style="color: var(--text-dim); padding: 1rem;">No recent playback history.</div>`;
    } else {
      historyItems.slice(0, 12).forEach(item => {
        const card = createMediaCard(item);
        // Add progress bar overlay
        const pct = Math.round((item.progress / item.duration) * 100);
        const bar = document.createElement('div');
        bar.style.cssText = `
          position: absolute; bottom: 0; left: 0; right: 0; height: 4px;
          background: rgba(255,255,255,0.2); z-index: 5;
        `;
        bar.innerHTML = `<div style="height:100%;width:${pct}%;background:var(--accent-primary)"></div>`;
        card.querySelector('.poster-box').appendChild(bar);
        el.libraryContinueGrid.appendChild(card);
      });
    }

    // 2. Watchlist
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
      showToast('Endpoint saved! Reloading feed...');
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
