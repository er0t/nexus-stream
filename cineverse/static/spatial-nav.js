/**
 * Nexus TV — Deterministic Spatial D-Pad Remote Navigation Engine
 * Hardware-Accelerated • 10-Foot Leanback Architecture (Stremio / Nuvio model)
 * Zero GPU Overhead • Native Android TV & Amazon Firestick Remote Control
 */

(function () {
  'use strict';

  // Standard TV Remote & Browser D-Pad Keycodes
  const KEY_UP = ['ArrowUp', 'Up', 19, 38];
  const KEY_DOWN = ['ArrowDown', 'Down', 20, 40];
  const KEY_LEFT = ['ArrowLeft', 'Left', 21, 37];
  const KEY_RIGHT = ['ArrowRight', 'Right', 22, 39];
  const KEY_ENTER = ['Enter', 'Select', 'Ok', 23, 66, 13];
  const KEY_BACK = ['Escape', 'Back', 4, 27, 8];
  const KEY_MEDIA_PLAY_PAUSE = ['MediaPlayPause', 85, 126, 127];
  const KEY_MEDIA_REWIND = ['MediaRewind', 89];
  const KEY_MEDIA_FORWARD = ['MediaFastForward', 90];

  let currentFocus = null;
  let isTvMode = true; // Nexus TV is a dedicated TV build
  let seekFeedbackTimer = null;

  // Focusable elements selector
  const FOCUSABLE_SELECTOR = `
    .tv-sidebar-item,
    .app-card,
    .app-btn,
    .season-tab-btn,
    .episode-row-card,
    .cast-card,
    .chip,
    .watchlist-chip,
    .watchlist-explore-btn,
    .sheet-close-btn,
    .player-hud-btn,
    .player-tool-pill,
    .quality-dropdown,
    .ctrl-btn,
    #main-search-input,
    #main-search-clear,
    [tabindex="0"]
  `;

  function isKey(event, keyList) {
    return keyList.includes(event.key) || keyList.includes(event.keyCode);
  }

  function getFocusableElements(container) {
    const root = container || document;
    const elements = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR));
    return elements.filter(el => {
      const style = window.getComputedStyle(el);
      const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      const isConnected = el.isConnected && el.offsetParent !== null;
      return isVisible && isConnected;
    });
  }

  let heroShowcaseDebounceTimer = null;

  function debouncedHeroShowcase(dataset, immediate = false) {
    clearTimeout(heroShowcaseDebounceTimer);
    if (immediate) {
      if (typeof window.updateHeroShowcase === 'function') {
        window.updateHeroShowcase(dataset);
      }
      return;
    }
    heroShowcaseDebounceTimer = setTimeout(() => {
      if (typeof window.updateHeroShowcase === 'function') {
        window.updateHeroShowcase(dataset);
      }
    }, 250);
  }

  function setFocus(element, scroll = true) {
    if (!element) return;

    if (currentFocus && currentFocus !== element) {
      currentFocus.classList.remove('tv-focused');
    }

    currentFocus = element;
    currentFocus.classList.add('tv-focused');

    try {
      currentFocus.focus({ preventScroll: true });
    } catch (e) {}

    // Expand Left Navigation Rail when focused on sidebar, collapse when moving to content
    const sidebar = document.getElementById('tv-sidebar');
    if (sidebar) {
      if (sidebar.contains(currentFocus)) {
        sidebar.classList.add('expanded');
      } else {
        sidebar.classList.remove('expanded');
      }
    }

    // Top Dynamic Hero Showcase: Debounced by 250ms so rapid remote ticks never trigger image loads or layout shifts
    if (currentFocus.classList.contains('app-card') && currentFocus.dataset && currentFocus.dataset.title) {
      debouncedHeroShowcase(currentFocus.dataset, false);
    }

    if (scroll) {
      if (currentFocus.closest('.rail-track')) {
        currentFocus.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      } else {
        currentFocus.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
      }
    }
  }

  function focusSidebar() {
    const sidebar = document.getElementById('tv-sidebar');
    if (sidebar) {
      const activeItem = sidebar.querySelector('.tv-sidebar-item.active') || sidebar.querySelector('.tv-sidebar-item');
      if (activeItem) {
        setFocus(activeItem, false);
      }
    }
  }

  function initDefaultFocus() {
    const player = document.getElementById('player-overlay');
    if (player && player.classList.contains('active')) {
      const playBtn = document.getElementById('ctrl-play-pause');
      if (playBtn) return setFocus(playBtn);
      const backBtn = document.getElementById('player-back-btn');
      if (backBtn) return setFocus(backBtn);
    }

    const sheet = document.getElementById('detail-sheet');
    if (sheet && sheet.classList.contains('active')) {
      const sheetPlayBtn = document.getElementById('sheet-play-btn');
      if (sheetPlayBtn && sheetPlayBtn.offsetParent !== null) return setFocus(sheetPlayBtn);
    }

    // In Home view: focus the hero play button or the first card
    const activeView = document.querySelector('.view-panel.active');
    if (activeView && activeView.id === 'view-home') {
      const heroPlayBtn = document.getElementById('hero-play-btn');
      if (heroPlayBtn && heroPlayBtn.offsetParent !== null) {
        return setFocus(heroPlayBtn);
      }
    }

    const cards = getFocusableElements(activeView || document);
    if (cards.length > 0) {
      return setFocus(cards[0]);
    }

    focusSidebar();
  }

  function findNearestElement(current, direction, candidates) {
    if (!current || candidates.length === 0) return null;

    const cRect = current.getBoundingClientRect();
    const cCenter = {
      x: cRect.left + cRect.width / 2,
      y: cRect.top + cRect.height / 2
    };

    let bestCandidate = null;
    let minDistance = Infinity;

    candidates.forEach(cand => {
      if (cand === current) return;

      const candRect = cand.getBoundingClientRect();
      const candCenter = {
        x: candRect.left + candRect.width / 2,
        y: candRect.top + candRect.height / 2
      };

      const dx = candCenter.x - cCenter.x;
      const dy = candCenter.y - cCenter.y;

      let isDirectional = false;
      let primaryDiff = 0;
      let secondaryDiff = 0;

      if (direction === 'up' && dy < -5) {
        isDirectional = true;
        primaryDiff = Math.abs(dy);
        secondaryDiff = Math.abs(dx);
      } else if (direction === 'down' && dy > 5) {
        isDirectional = true;
        primaryDiff = Math.abs(dy);
        secondaryDiff = Math.abs(dx);
      } else if (direction === 'left' && dx < -5) {
        isDirectional = true;
        primaryDiff = Math.abs(dx);
        secondaryDiff = Math.abs(dy);
      } else if (direction === 'right' && dx > 5) {
        isDirectional = true;
        primaryDiff = Math.abs(dx);
        secondaryDiff = Math.abs(dy);
      }

      if (isDirectional) {
        const score = primaryDiff + secondaryDiff * 2.2;
        if (score < minDistance) {
          minDistance = score;
          bestCandidate = cand;
        }
      }
    });

    return bestCandidate;
  }

  function handleDirectionalMove(direction) {
    const isPlayerActive = document.getElementById('player-overlay')?.classList.contains('active');
    const isSheetActive = document.getElementById('detail-sheet')?.classList.contains('active');

    if (isPlayerActive) {
      handlePlayerDpad(direction);
      return;
    }

    if (isSheetActive) {
      const sheetCandidates = getFocusableElements(document.getElementById('detail-sheet'));
      const next = findNearestElement(currentFocus, direction, sheetCandidates);
      if (next) setFocus(next);
      return;
    }

    if (!currentFocus || !currentFocus.isConnected || currentFocus.offsetParent === null) {
      initDefaultFocus();
      return;
    }

    // 1. If currently inside Left Navigation Rail (.tv-sidebar)
    const sidebar = document.getElementById('tv-sidebar');
    if (sidebar && sidebar.contains(currentFocus)) {
      const items = Array.from(sidebar.querySelectorAll('.tv-sidebar-item'));
      const idx = items.indexOf(currentFocus);
      if (direction === 'down' && idx !== -1 && idx < items.length - 1) {
        setFocus(items[idx + 1]);
        return;
      }
      if (direction === 'up' && idx > 0) {
        setFocus(items[idx - 1]);
        return;
      }
      if (direction === 'right') {
        sidebar.classList.remove('expanded');
        const activeView = document.querySelector('.view-panel.active');
        if (activeView && activeView.id === 'view-home') {
          const heroPlay = document.getElementById('hero-play-btn');
          if (heroPlay && heroPlay.offsetParent !== null) {
            setFocus(heroPlay);
            return;
          }
        }
        const firstCard = (activeView || document).querySelector('.app-card');
        if (firstCard) {
          setFocus(firstCard);
          return;
        }
      }
      return;
    }

    // 2. If currently on Hero action buttons (#hero-play-btn, #hero-info-btn)
    if (currentFocus.id === 'hero-play-btn' || currentFocus.id === 'hero-info-btn') {
      if (direction === 'left') {
        if (currentFocus.id === 'hero-info-btn') {
          setFocus(document.getElementById('hero-play-btn'));
        } else {
          focusSidebar();
        }
        return;
      }
      if (direction === 'right') {
        if (currentFocus.id === 'hero-play-btn') {
          setFocus(document.getElementById('hero-info-btn'));
        }
        return;
      }
      if (direction === 'down') {
        const firstCard = document.querySelector('.rail-section .app-card');
        if (firstCard) {
          setFocus(firstCard);
          return;
        }
      }
      return;
    }

    // 3. If currently inside a horizontal rail (.rail-track)
    const currentRail = currentFocus.closest('.rail-track');
    if (currentRail) {
      const railCards = Array.from(currentRail.querySelectorAll('.app-card'));
      const idx = railCards.indexOf(currentFocus);

      if (direction === 'right') {
        if (idx !== -1 && idx < railCards.length - 1) {
          setFocus(railCards[idx + 1]);
          return;
        }
      } else if (direction === 'left') {
        if (idx > 0) {
          setFocus(railCards[idx - 1]);
          return;
        } else if (idx === 0) {
          focusSidebar();
          return;
        }
      } else if (direction === 'down') {
        const currentSection = currentFocus.closest('.rail-section');
        if (currentSection) {
          let nextSection = currentSection.nextElementSibling;
          while (nextSection && (!nextSection.classList.contains('rail-section') || nextSection.style.display === 'none')) {
            nextSection = nextSection.nextElementSibling;
          }
          if (nextSection) {
            const nextCards = Array.from(nextSection.querySelectorAll('.app-card'));
            if (nextCards.length > 0) {
              const targetIdx = Math.min(idx >= 0 ? idx : 0, nextCards.length - 1);
              setFocus(nextCards[targetIdx]);
              return;
            }
          }
        }
      } else if (direction === 'up') {
        const currentSection = currentFocus.closest('.rail-section');
        if (currentSection) {
          let prevSection = currentSection.previousElementSibling;
          while (prevSection && (!prevSection.classList.contains('rail-section') || prevSection.style.display === 'none')) {
            prevSection = prevSection.previousElementSibling;
          }
          if (prevSection) {
            const prevCards = Array.from(prevSection.querySelectorAll('.app-card'));
            if (prevCards.length > 0) {
              const targetIdx = Math.min(idx >= 0 ? idx : 0, prevCards.length - 1);
              setFocus(prevCards[targetIdx]);
              return;
            }
          } else {
            const heroPlay = document.getElementById('hero-play-btn');
            if (heroPlay && heroPlay.offsetParent !== null) {
              setFocus(heroPlay);
              return;
            }
          }
        }
      }
    }

    // 4. Default 2D spatial navigation fallback (for category grids, search results, watchlist)
    const activeView = document.querySelector('.view-panel.active') || document;
    const candidates = getFocusableElements(activeView);
    const next = findNearestElement(currentFocus, direction, candidates);
    if (next) {
      setFocus(next);
    } else if (direction === 'left') {
      focusSidebar();
    }
  }

  function showSeekFeedback(text) {
    let indicator = document.getElementById('tv-seek-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'tv-seek-indicator';
      indicator.className = 'tv-seek-indicator';
      document.body.appendChild(indicator);
    }
    indicator.textContent = text;
    indicator.classList.add('active');

    clearTimeout(seekFeedbackTimer);
    seekFeedbackTimer = setTimeout(() => {
      indicator.classList.remove('active');
    }, 1000);
  }

  function handlePlayerDpad(direction) {
    const video = document.getElementById('native-video');
    if (!video) return;

    if (direction === 'left') {
      video.currentTime = Math.max(0, video.currentTime - 10);
      showSeekFeedback('<< -10s');
    } else if (direction === 'right') {
      video.currentTime = Math.min(video.duration || 999999, video.currentTime + 10);
      showSeekFeedback('>> +10s');
    } else if (direction === 'up') {
      const topHud = document.getElementById('player-hud-top');
      if (topHud) {
        topHud.classList.remove('hidden');
        const qualSelect = document.getElementById('player-quality-select');
        if (qualSelect) setFocus(qualSelect);
      }
    } else if (direction === 'down') {
      const bottomHud = document.getElementById('player-hud-bottom');
      if (bottomHud) {
        bottomHud.classList.remove('hidden');
        const playBtn = document.getElementById('ctrl-play-pause');
        if (playBtn) setFocus(playBtn);
      }
    }
  }

  function handleBackKey() {
    const updateModal = document.getElementById('update-modal');
    if (updateModal && updateModal.style.display === 'flex') {
      updateModal.style.display = 'none';
      setTimeout(initDefaultFocus, 100);
      return;
    }

    const player = document.getElementById('player-overlay');
    if (player && player.classList.contains('active')) {
      if (typeof window.closePlayer === 'function') {
        window.closePlayer();
      } else {
        player.classList.remove('active');
      }
      setTimeout(initDefaultFocus, 100);
      return;
    }

    const sheet = document.getElementById('detail-sheet');
    if (sheet && sheet.classList.contains('active')) {
      if (typeof window.closeDetailSheet === 'function') {
        window.closeDetailSheet();
      } else {
        sheet.classList.remove('active');
      }
      setTimeout(initDefaultFocus, 100);
      return;
    }

    const activeView = document.querySelector('.view-panel.active');
    if (activeView && activeView.id !== 'view-home') {
      if (typeof window.switchView === 'function') {
        window.switchView('view-home');
        setTimeout(initDefaultFocus, 100);
      }
      return;
    }

    // In Home view: move focus to Left Navigation Rail
    const sidebar = document.getElementById('tv-sidebar');
    if (sidebar && !sidebar.contains(currentFocus)) {
      focusSidebar();
      return;
    }
  }

  // Master Keydown Listener
  window.addEventListener('keydown', (e) => {
    if (isKey(e, KEY_UP)) {
      e.preventDefault();
      handleDirectionalMove('up');
    } else if (isKey(e, KEY_DOWN)) {
      e.preventDefault();
      handleDirectionalMove('down');
    } else if (isKey(e, KEY_LEFT)) {
      e.preventDefault();
      handleDirectionalMove('left');
    } else if (isKey(e, KEY_RIGHT)) {
      e.preventDefault();
      handleDirectionalMove('right');
    } else if (isKey(e, KEY_ENTER)) {
      const player = document.getElementById('player-overlay');
      if (player && player.classList.contains('active')) {
        const video = document.getElementById('native-video');
        if (video && (!currentFocus || !currentFocus.closest('#player-hud-top, #player-hud-bottom'))) {
          if (video.paused) {
            video.play();
            showSeekFeedback('Play');
          } else {
            video.pause();
            showSeekFeedback('Pause');
          }
          e.preventDefault();
          return;
        }
      }

      if (currentFocus) {
        currentFocus.click();
        e.preventDefault();
      }
    } else if (isKey(e, KEY_BACK)) {
      e.preventDefault();
      handleBackKey();
    } else if (isKey(e, KEY_MEDIA_PLAY_PAUSE)) {
      e.preventDefault();
      const video = document.getElementById('native-video');
      if (video) {
        if (video.paused) video.play();
        else video.pause();
      }
    } else if (isKey(e, KEY_MEDIA_REWIND)) {
      e.preventDefault();
      handlePlayerDpad('left');
    } else if (isKey(e, KEY_MEDIA_FORWARD)) {
      e.preventDefault();
      handlePlayerDpad('right');
    }
  }, { passive: false });

  window.SpatialNav = {
    setFocus,
    initDefaultFocus,
    focusSidebar,
    isTvMode: () => true
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('tv-mode');
    setTimeout(initDefaultFocus, 400);
  });

})();
