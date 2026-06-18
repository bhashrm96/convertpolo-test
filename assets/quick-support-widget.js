(function () {
  'use strict';

  /*
   * Quick Support Widget — JavaScript
   *
   * Reads all FAQ data from a <script type="application/json"> tag in the DOM
   * (injected by Liquid) rather than making an AJAX call, so the widget works
   * with zero extra network requests after the initial page load.
   *
   * Deep-link URL format:
   *   #qsw=open          — panel open, home view
   *   #qsw=0             — panel open, questions view for category 0
   *   #qsw=0-2           — panel open, answer view: category 0, question 2
   */

  /* ── Read section data ──────────────────────────────────── */

  const dataEl = document.getElementById('qsw-data');
  if (!dataEl) return;

  let data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (e) {
    // Malformed JSON — abort silently so the rest of the page is unaffected
    return;
  }

  const categories = data.categories || [];

  /* ── Element refs ───────────────────────────────────────── */

  const wrapper       = document.getElementById('qsw-launcher-wrapper');
  const launcher      = document.getElementById('qsw-launcher');
  const panel         = document.getElementById('qsw-panel');
  const closeBtn      = document.getElementById('qsw-close');
  const viewHome      = document.getElementById('qsw-view-home');
  const viewQuestions = document.getElementById('qsw-view-questions');
  const viewAnswer    = document.getElementById('qsw-view-answer');
  const backFromQ     = document.getElementById('qsw-back-questions');
  const backFromA     = document.getElementById('qsw-back-answer');
  const questionTitle = document.getElementById('qsw-questions-title');
  const questionList  = document.getElementById('qsw-question-list');
  const answerQ       = document.getElementById('qsw-answer-question');
  const answerCat     = document.getElementById('qsw-answer-cat');
  const answerContent = document.getElementById('qsw-answer-content');
  const prevBtn       = document.getElementById('qsw-prev');
  const nextBtn       = document.getElementById('qsw-next');
  const prevLabel     = document.getElementById('qsw-prev-label');
  const nextLabel     = document.getElementById('qsw-next-label');
  // aria-live region — receives text updates to announce view changes to screen readers
  const srLive        = document.getElementById('qsw-sr-live');

  if (!launcher || !panel) return;

  /* ── State ──────────────────────────────────────────────── */

  let isOpen           = false;
  let activeCatIdx     = -1;
  let activeQIdx       = -1;
  let currentView      = 'home'; // 'home' | 'questions' | 'answer'
  // Tracks which view the user came from when entering the answer view,
  // so the back button knows whether to return to 'home' or 'questions'
  let answerOrigin     = 'questions'; // 'home' | 'questions'

  /* ── Reduced-motion check ───────────────────────────────── */

  // CSS handles disabling visual transitions, but JS also needs to know
  // so it can set timeout durations to 0 (avoiding invisible waits)
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TRANSITION_MS = prefersReducedMotion ? 0 : 220;

  /* ── Panel open / close ─────────────────────────────────── */

  function openPanel() {
    isOpen = true;
    launcher.classList.add('qsw-launcher--hidden');
    launcher.setAttribute('aria-expanded', 'true');
    panel.removeAttribute('hidden');
    panel.classList.add('qsw-panel--visible');
    // A rAF is needed here: removing [hidden] sets display:flex (via CSS),
    // but the browser hasn't painted yet. Without rAF, clearing the inline
    // opacity/transform would happen in the same frame and skip the transition.
    requestAnimationFrame(() => {
      panel.style.opacity = '';
      panel.style.transform = '';
    });
    trapFocus(panel);
    updateHash();
  }

  function closePanel() {
    isOpen = false;
    launcher.setAttribute('aria-expanded', 'false');

    // Apply the closing state inline — these override the CSS :not([hidden]) rule
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(16px) scale(0.97)';

    // After the CSS transition finishes, add [hidden] to remove panel from
    // the accessibility tree and restore the launcher button
    setTimeout(() => {
      panel.setAttribute('hidden', '');
      panel.classList.remove('qsw-panel--visible');
      launcher.classList.remove('qsw-launcher--hidden');
      launcher.focus();
    }, prefersReducedMotion ? 0 : 260);

    clearHash();
  }

  /* ── View transitions ───────────────────────────────────── */

  // Slides the current view out and the next view in with a directional animation.
  // direction: 'forward' (deeper into hierarchy) or 'back' (returning upward)
  function showView(nextView, direction) {
    const viewMap = {
      home: viewHome,
      questions: viewQuestions,
      answer: viewAnswer,
    };

    const current = viewMap[currentView];
    const next = viewMap[nextView];

    if (!next || current === next) return;

    const enterClass = direction === 'forward' ? 'qsw-view--enter-right' : 'qsw-view--enter-left';
    const exitClass  = direction === 'forward' ? 'qsw-view--exit-left'   : 'qsw-view--exit-right';

    // Position the incoming view off-screen before making it visible
    next.classList.add(enterClass);
    next.removeAttribute('hidden');
    next.classList.remove('qsw-view--active');

    requestAnimationFrame(() => {
      // Trigger the transition in the next paint cycle
      current.classList.add(exitClass);
      current.classList.remove('qsw-view--active');
      next.classList.remove(enterClass);
      next.classList.add('qsw-view--active');

      setTimeout(() => {
        current.setAttribute('hidden', '');
        current.classList.remove(exitClass);
        // Move keyboard focus into the newly visible view
        const focusTarget = next.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
        if (focusTarget) focusTarget.focus();
      }, TRANSITION_MS);
    });

    currentView = nextView;

    // Announce the new view to screen readers via the aria-live region
    if (srLive) {
      const viewLabels = { home: 'Support categories', questions: 'Questions list', answer: 'Answer' };
      srLive.textContent = viewLabels[nextView] || '';
    }
  }

  /* ── Category view ──────────────────────────────────────── */

  // Populates the question list for a given category index.
  // Split from openCategory so it can be called without triggering
  // the view transition (used when jumping straight to an answer from home).
  function populateCategoryView(catIdx) {
    const cat = categories[catIdx];
    if (!cat) return false;

    activeCatIdx = catIdx;
    activeQIdx = -1;
    questionTitle.textContent = cat.title;
    questionList.innerHTML = '';

    if (cat.questions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'qsw-empty-state';
      empty.textContent = data.emptyStateText || 'No questions yet.';
      questionList.appendChild(empty);
      return true;
    }

    cat.questions.forEach(function (q, qi) {
      const li = document.createElement('li');
      li.className = 'qsw-question-item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qsw-question-btn';
      btn.innerHTML =
        (q.image ? '<img class="qsw-question-btn__avatar" src="' + q.image + '" alt="" aria-hidden="true">' : '') +
        '<div class="qsw-question-btn__text">' +
          '<span class="qsw-question-btn__title">' + escapeHtml(q.text) + '</span>' +
          '<span class="qsw-question-btn__cat">' + escapeHtml(cat.title) + '</span>' +
        '</div>' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="qsw-question-btn__arrow"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>';

      btn.addEventListener('click', function () {
        answerOrigin = 'questions';
        openAnswer(catIdx, qi);
      });

      li.appendChild(btn);
      questionList.appendChild(li);
    });

    return true;
  }

  function openCategory(catIdx) {
    if (!populateCategoryView(catIdx)) return;
    showView('questions', 'forward');
    updateHash();
  }

  /* ── Featured question shortcut (home → answer) ─────────── */

  // When a featured question is clicked from the home view, we skip the
  // questions view entirely but still populate it so back-navigation works
  function openAnswerFromHome(catIdx, qIdx) {
    if (!populateCategoryView(catIdx)) return;
    answerOrigin = 'home';
    openAnswer(catIdx, qIdx);
  }

  /* ── Featured questions (home view) ─────────────────────── */

  function renderFeaturedQuestions() {
    // Remove any previously rendered featured section (e.g. after a hash re-init)
    const existing = document.getElementById('qsw-featured');
    if (existing) existing.remove();

    const maxPerCat = data.featuredMaxPerCat || 2;
    const featured = [];

    // For each category: use explicitly flagged questions if any exist,
    // otherwise fall back to the first N questions in order
    categories.forEach(function (cat, catIdx) {
      var indexed = cat.questions.map(function (q, idx) { return { q: q, idx: idx }; });
      var flagged = indexed.filter(function (item) { return item.q.featured; });
      var toShow = flagged.length > 0 ? flagged.slice(0, maxPerCat) : indexed.slice(0, maxPerCat);
      toShow.forEach(function (item) {
        featured.push({ catIdx: catIdx, qIdx: item.idx, text: item.q.text, image: item.q.image, catTitle: cat.title });
      });
    });

    if (!featured.length) return;

    const featuredSection = document.createElement('div');
    featuredSection.id = 'qsw-featured';
    featuredSection.className = 'qsw-featured';

    const headingWrap = document.createElement('div');
    headingWrap.className = 'qsw-featured__headings';

    const heading = document.createElement('p');
    heading.className = 'qsw-featured__heading';
    heading.textContent = data.featuredHeading || 'Popular Questions';
    headingWrap.appendChild(heading);

    if (data.featuredSubheading) {
      const sub = document.createElement('p');
      sub.className = 'qsw-featured__subheading';
      sub.textContent = data.featuredSubheading;
      headingWrap.appendChild(sub);
    }

    featuredSection.appendChild(headingWrap);

    const list = document.createElement('ul');
    list.className = 'qsw-featured__list';
    list.setAttribute('role', 'list');

    featured.forEach(function (item) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qsw-question-btn';
      btn.innerHTML =
        (item.image ? '<img class="qsw-question-btn__avatar" src="' + item.image + '" alt="" aria-hidden="true">' : '') +
        '<div class="qsw-question-btn__text">' +
          '<span class="qsw-question-btn__title">' + escapeHtml(item.text) + '</span>' +
          '<span class="qsw-question-btn__cat">' + escapeHtml(item.catTitle) + '</span>' +
        '</div>' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="qsw-question-btn__arrow"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>';
      btn.addEventListener('click', function () {
        openAnswerFromHome(item.catIdx, item.qIdx);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });

    featuredSection.appendChild(list);
    viewHome.appendChild(featuredSection);
  }

  /* ── Answer view ────────────────────────────────────────── */

  // Populates the answer view content and updates the prev/next navigation.
  // Separated from openAnswer so it can be called standalone when already
  // in the answer view (e.g. pressing next/prev — fades content in place).
  function setAnswerContent(cat, q, qIdx) {
    answerQ.textContent = q.text;
    if (answerCat) answerCat.textContent = cat.title;
    // q.answer is Shopify richtext — treated as trusted HTML from the merchant
    answerContent.innerHTML = q.answer;

    var hasPrev = qIdx > 0;
    var hasNext = qIdx < cat.questions.length - 1;
    var prevItem = prevBtn.closest('.qsw-navitem');
    var nextItem = nextBtn.closest('.qsw-navitem');

    if (hasPrev) {
      prevLabel.textContent = cat.questions[qIdx - 1].text;
      // Keep aria-label in sync with the visible label so screen readers announce
      // the actual adjacent question title rather than a generic "Previous"
      prevBtn.setAttribute('aria-label', 'Previous: ' + cat.questions[qIdx - 1].text);
      if (prevItem) prevItem.removeAttribute('hidden');
    } else {
      if (prevItem) prevItem.setAttribute('hidden', '');
    }

    if (hasNext) {
      nextLabel.textContent = cat.questions[qIdx + 1].text;
      nextBtn.setAttribute('aria-label', 'Next: ' + cat.questions[qIdx + 1].text);
      if (nextItem) nextItem.removeAttribute('hidden');
    } else {
      if (nextItem) nextItem.setAttribute('hidden', '');
    }
  }

  function openAnswer(catIdx, qIdx) {
    const cat = categories[catIdx];
    if (!cat) return;
    const q = cat.questions[qIdx];
    if (!q) return;

    activeCatIdx = catIdx;
    activeQIdx   = qIdx;

    if (currentView !== 'answer') {
      // First time entering the answer view — use the slide transition
      setAnswerContent(cat, q, qIdx);
      showView('answer', 'forward');
    } else if (prefersReducedMotion) {
      // Already in answer view, reduced motion — update immediately
      setAnswerContent(cat, q, qIdx);
    } else {
      // Already in answer view — cross-fade content in place rather than
      // sliding to a "new" answer (avoids a jarring slide within the same view)
      var answerView = document.getElementById('qsw-view-answer');
      answerView.style.transition = 'opacity 160ms cubic-bezier(0.4, 0, 0.2, 1)';
      answerView.style.opacity = '0';
      setTimeout(function () {
        setAnswerContent(cat, q, qIdx);
        answerView.style.opacity = '1';
        setTimeout(function () {
          // Clean up inline styles once the fade completes
          answerView.style.transition = '';
          answerView.style.opacity = '';
        }, 160);
      }, 160);
    }

    updateHash();
  }

  /* ── Prev / Next ────────────────────────────────────────── */

  prevBtn.addEventListener('click', function () {
    if (activeQIdx > 0) openAnswer(activeCatIdx, activeQIdx - 1);
  });

  nextBtn.addEventListener('click', function () {
    const cat = categories[activeCatIdx];
    if (cat && activeQIdx < cat.questions.length - 1) {
      openAnswer(activeCatIdx, activeQIdx + 1);
    }
  });

  /* ── Back buttons ───────────────────────────────────────── */

  backFromQ.addEventListener('click', function () {
    showView('home', 'back');
    activeCatIdx = -1;
    activeQIdx   = -1;
    updateHash();
  });

  backFromA.addEventListener('click', function () {
    // If the user arrived at the answer directly from the home view
    // (via a featured question), go back to home, not to the questions list
    if (answerOrigin === 'home') {
      showView('home', 'back');
      activeCatIdx = -1;
    } else {
      showView('questions', 'back');
    }
    activeQIdx = -1;
    updateHash();
  });

  /* ── Deep linking ───────────────────────────────────────── */

  // Writes the current navigation state into the URL hash so users can
  // bookmark or share a link to a specific question or category
  function updateHash() {
    if (!isOpen) {
      return;
    }
    if (currentView === 'home') {
      history.replaceState(null, '', location.pathname + location.search + '#qsw=open');
    } else if (currentView === 'questions') {
      history.replaceState(null, '', location.pathname + location.search + '#qsw=' + activeCatIdx);
    } else if (currentView === 'answer') {
      history.replaceState(null, '', location.pathname + location.search + '#qsw=' + activeCatIdx + '-' + activeQIdx);
    }
  }

  function clearHash() {
    const url = location.pathname + location.search;
    history.replaceState(null, '', url);
  }

  // Reads the URL hash on load and restores the appropriate view
  function readHash() {
    const hash = location.hash;
    if (!hash.startsWith('#qsw=')) return;

    const value = hash.slice(5);

    if (value === 'open') {
      openPanel();
      return;
    }

    // Format: catIdx or catIdx-qIdx
    const parts = value.split('-');
    const catIdx = parseInt(parts[0], 10);
    const qIdx   = parts[1] !== undefined ? parseInt(parts[1], 10) : -1;

    if (isNaN(catIdx) || catIdx < 0 || catIdx >= categories.length) return;

    openPanel();

    if (qIdx >= 0) {
      // Jump straight to answer — populate the questions view first so
      // back-navigation has something to return to
      activeCatIdx = catIdx;
      openCategory(catIdx);
      // Override currentView so openAnswer uses a slide rather than a fade
      currentView = 'questions';
      openAnswer(catIdx, qIdx);
    } else {
      openCategory(catIdx);
    }
  }

  /* ── Category card click delegation ─────────────────────── */

  // Single delegated listener on the home view handles all category card clicks,
  // avoiding N individual event listeners for N category cards
  viewHome.addEventListener('click', function (e) {
    const card = e.target.closest('[data-cat-index]');
    if (!card) return;
    const idx = parseInt(card.dataset.catIndex, 10);
    if (!isNaN(idx)) openCategory(idx);
  });

  /* ── Launcher click ─────────────────────────────────────── */

  launcher.addEventListener('click', function () {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  });

  /* ── Close button ───────────────────────────────────────── */

  closeBtn.addEventListener('click', closePanel);

  /* ── Click outside ──────────────────────────────────────── */

  document.addEventListener('click', function (e) {
    if (!isOpen) return;
    if (!wrapper.contains(e.target)) closePanel();
  });

  /* ── Keyboard: Escape ───────────────────────────────────── */

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) {
      closePanel();
    }
  });

  /* ── Focus trap ─────────────────────────────────────────── */

  // Returns all focusable elements within el that are not inside a [hidden] subtree
  function getFocusable(el) {
    return Array.from(
      el.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (el) {
      // Exclude elements inside hidden views — they are in the DOM but not visible
      return !el.closest('[hidden]');
    });
  }

  function trapFocus(el) {
    el.addEventListener('keydown', handleTrap);
  }

  function handleTrap(e) {
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(panel);
    if (!focusable.length) return;

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    // Wrap Tab at the last element and Shift+Tab at the first element
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /* ── Utility ────────────────────────────────────────────── */

  // Escapes user-supplied strings before inserting them via innerHTML.
  // Prevents XSS when rendering question text and category titles.
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Init ───────────────────────────────────────────────── */

  renderFeaturedQuestions();

  // Restore state from URL hash on page load (e.g. shared links, browser back)
  if (location.hash.startsWith('#qsw=')) {
    readHash();
  }

})();
