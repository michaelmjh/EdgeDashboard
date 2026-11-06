/* newtab.js - Duck Dashboard
   Header (greeting, date, clock), search, quick links, sticky notes and the
   weather widget. Shared helpers (dialogs, toast, confirm) live on
   window.Dash so settings.js can use them. */

(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const Dash = (window.Dash = window.Dash || {});
  const events = new EventTarget();
  Dash.on = (name, fn) => events.addEventListener(name, (e) => fn(e.detail));
  Dash.emit = (name, detail) => events.dispatchEvent(new CustomEvent(name, { detail }));

  /* ======================================================================
     Helpers
     ====================================================================== */

  function debounce(fn, ms) {
    let timer = null;
    const wrapped = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, ms);
    };
    wrapped.flush = (...args) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        fn(...args);
      }
    };
    wrapped.pending = () => timer !== null;
    return wrapped;
  }

  function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function svgIcon(id, cls = 'i') {
    return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const pad = (n) => String(n).padStart(2, '0');

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  Dash.helpers = { debounce, uid, svgIcon, escapeHtml };

  /* ---------- Toast (floating status pill) ---------- */

  const toastEl = $('#toast');
  let toastTimer = null;
  Dash.toast = function (message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  };

  /* ---------- Dialog helpers (animated open and close) ---------- */

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  Dash.openDialog = function (dialog, focusEl) {
    if (dialog.open) return;
    dialog._returnFocus = document.activeElement;
    dialog.showModal();
    requestAnimationFrame(() => dialog.classList.add('is-open'));
    if (focusEl) setTimeout(() => focusEl.focus(), 30);
  };

  Dash.closeDialog = function (dialog) {
    if (!dialog.open || dialog._closing) return;
    dialog._closing = true;
    dialog.classList.remove('is-open');
    const finish = () => {
      dialog._closing = false;
      dialog.close();
      const back = dialog._returnFocus;
      if (back && document.contains(back)) back.focus();
    };
    if (reduceMotion()) finish();
    else setTimeout(finish, 200);
  };

  // Shared behaviour for every dialog: Esc and backdrop clicks animate closed.
  $$('dialog.dialog').forEach((dialog) => {
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      Dash.closeDialog(dialog);
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) Dash.closeDialog(dialog);
      if (e.target.closest('[data-close]')) Dash.closeDialog(dialog);
    });
  });

  /* ---------- Confirm dialog ---------- */

  const confirmDialog = $('#confirmDialog');
  Dash.confirm = function ({ title = 'Are you sure?', message = '', confirmLabel = 'OK', danger = false } = {}) {
    return new Promise((resolve) => {
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = message;
      const ok = $('#confirmOk');
      const cancel = $('#confirmCancel');
      ok.textContent = confirmLabel;
      ok.className = 'btn ' + (danger ? 'danger' : 'primary');

      const done = (value) => {
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        confirmDialog.removeEventListener('close', onClose);
        resolve(value);
      };
      const onOk = () => { Dash.closeDialog(confirmDialog); done(true); };
      const onCancel = () => { Dash.closeDialog(confirmDialog); done(false); };
      const onClose = () => done(false);

      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      confirmDialog.addEventListener('close', onClose);
      Dash.openDialog(confirmDialog, cancel);
    });
  };

  /* ======================================================================
     Header: greeting, date and time
     ====================================================================== */

  let userName = '';

  function renderHeader() {
    const now = new Date();
    const h = now.getHours();
    const part = h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening';
    $('#greeting').textContent = userName ? `${part}, ${userName}` : part;
    $('#date').textContent = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    const time = $('#time');
    time.textContent = `${pad(h)}:${pad(now.getMinutes())}`;
    time.dateTime = now.toISOString();
  }

  function startClock() {
    renderHeader();
    // Line up with the start of each minute, then tick once a minute.
    const wait = 60000 - (Date.now() % 60000) + 50;
    setTimeout(() => {
      renderHeader();
      setInterval(renderHeader, 60000);
    }, wait);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderHeader();
    });
  }

  Dash.setUserName = function (name) {
    userName = (name || '').trim();
    renderHeader();
  };

  /* ======================================================================
     Search (Google and DuckDuckGo) with per-engine history
     ====================================================================== */

  const ENGINES = {
    google: { name: 'Google', base: 'https://www.google.com/search?' },
    duckduckgo: { name: 'DuckDuckGo', base: 'https://duckduckgo.com/?' }
  };
  const HISTORY_MAX = 10;
  let searchHistory = { google: [], duckduckgo: [] };

  function searchUrl(engine, query) {
    // URLSearchParams encodes spaces as "+": ?q=weather+glasgow
    return ENGINES[engine].base + new URLSearchParams({ q: query }).toString();
  }

  function openInNewTab(url) {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  async function addHistory(engine, query) {
    const list = searchHistory[engine].filter((q) => q.toLowerCase() !== query.toLowerCase());
    list.unshift(query);
    searchHistory[engine] = list.slice(0, HISTORY_MAX);
    await Store.set('searchHistory', searchHistory);
  }

  function setupSearchForm(form) {
    const engine = form.dataset.engine;
    const input = $('.search-input', form);
    const pop = $('.history-pop', form);
    let activeIndex = -1;
    let matches = [];

    function closePop() {
      pop.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
    }

    function renderPop() {
      const term = input.value.trim().toLowerCase();
      matches = searchHistory[engine].filter((q) => !term || q.toLowerCase().includes(term));
      if (!matches.length || (term && matches.length === 1 && matches[0].toLowerCase() === term)) {
        closePop();
        return;
      }
      pop.innerHTML = '<li class="history-label" role="presentation">Recent searches</li>' +
        matches.map((q, i) =>
          `<li class="history-option" role="option" id="${pop.id}-opt-${i}" data-index="${i}" aria-selected="false">` +
          `${svgIcon('i-history')}<span>${escapeHtml(q)}</span></li>`).join('') +
        // Last option clears this engine's history.
        `<li class="history-option history-clear-opt" role="option" id="${pop.id}-opt-clear" data-index="clear" aria-selected="false">` +
        `${svgIcon('i-trash')}<span>Clear recent searches</span></li>`;
      pop.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      activeIndex = -1;
    }

    function setActive(index) {
      const options = $$('.history-option', pop);
      if (!options.length) return;
      activeIndex = (index + options.length) % options.length;
      options.forEach((o, i) => o.setAttribute('aria-selected', String(i === activeIndex)));
      input.setAttribute('aria-activedescendant', options[activeIndex].id);
      options[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    async function runSearch(query) {
      query = query.trim();
      if (!query) {
        input.focus();
        Dash.toast(`Type something to search ${ENGINES[engine].name}`);
        return;
      }
      openInNewTab(searchUrl(engine, query));
      input.value = '';
      closePop();
      await addHistory(engine, query);
    }

    async function clearHistory() {
      searchHistory[engine] = [];
      await Store.set('searchHistory', searchHistory);
      closePop();
      Dash.toast(`${ENGINES[engine].name} history cleared`);
    }

    function pick(index) {
      if (index === 'clear' || index === matches.length) clearHistory();
      else runSearch(matches[Number(index)]);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch(input.value);
    });

    input.addEventListener('focus', renderPop);
    input.addEventListener('input', renderPop);
    input.addEventListener('blur', () => setTimeout(closePop, 120));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (pop.hidden) renderPop();
        setActive(activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        if (pop.hidden) return;
        e.preventDefault();
        setActive(activeIndex - 1);
      } else if (e.key === 'Enter' && !pop.hidden && activeIndex >= 0) {
        e.preventDefault();
        pick(activeIndex);
      } else if (e.key === 'Escape' && !pop.hidden) {
        e.preventDefault();
        closePop();
      }
    });

    // mousedown keeps focus in the input; click runs the search.
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', (e) => {
      const option = e.target.closest('.history-option');
      if (option) pick(option.dataset.index);
    });

  }

  async function initSearch() {
    searchHistory = await Store.get('searchHistory');
    searchHistory.google = searchHistory.google || [];
    searchHistory.duckduckgo = searchHistory.duckduckgo || [];
    $$('.search-row').forEach(setupSearchForm);

    Store.onChange('searchHistory', (value) => {
      searchHistory = Object.assign({ google: [], duckduckgo: [] }, value);
    });
  }

  /* ======================================================================
     Quick links
     ====================================================================== */

  let links = [];
  const linksGrid = $('#linksGrid');
  const TILE_COLOURS = ['var(--blue)', 'var(--green)', 'var(--purple)', 'var(--orange)', 'var(--yellow)'];

  function normaliseUrl(raw) {
    let value = (raw || '').trim();
    if (!value) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = 'https://' + value;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
      return url.href;
    } catch (e) {
      return null;
    }
  }

  function tileColour(text) {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return TILE_COLOURS[h % TILE_COLOURS.length];
  }

  function faviconUrl(pageUrl) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`;
    }
    return null;
  }

  /* Builds the icon box for a link: custom emoji, custom image, the site's
     favicon, or a coloured initial as the last resort. */
  function buildLinkIcon(link) {
    const box = document.createElement('span');
    box.className = 'link-icon';
    box.setAttribute('aria-hidden', 'true');
    box.style.setProperty('--tile', tileColour(link.title || link.url));
    const initial = (link.title || '?').trim().charAt(0).toUpperCase() || '?';
    const icon = (link.icon || '').trim();

    const useInitial = () => { box.textContent = initial; };
    const useImage = (src) => {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', useInitial, { once: true });
      img.src = src;
      box.replaceChildren(img);
    };

    if (icon && /^(https:\/\/|data:image\/)/i.test(icon)) useImage(icon);
    else if (icon) box.textContent = Array.from(icon).slice(0, 2).join('');
    else {
      const fav = faviconUrl(link.url);
      if (fav) useImage(fav);
      else useInitial();
    }
    return box;
  }
  Dash.buildLinkIcon = buildLinkIcon;

  function renderLinks() {
    linksGrid.replaceChildren();
    $('#linksEmpty').hidden = links.length > 0;

    links.forEach((link) => {
      const li = document.createElement('li');
      li.className = 'link-item';
      li.draggable = true;
      li.dataset.id = link.id;

      const a = document.createElement('a');
      a.className = 'link-tile';
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = link.url;
      a.setAttribute('aria-label', `${link.title} (opens in a new tab)`);
      const title = document.createElement('span');
      title.className = 'link-title';
      title.textContent = link.title;
      a.append(buildLinkIcon(link), title);

      const actions = document.createElement('div');
      actions.className = 'link-actions';
      actions.innerHTML =
        `<button type="button" class="mini-btn edit" aria-label="Edit ${escapeHtml(link.title)}" title="Edit">${svgIcon('i-edit')}</button>` +
        `<button type="button" class="mini-btn del" aria-label="Delete ${escapeHtml(link.title)}" title="Delete">${svgIcon('i-trash')}</button>`;

      li.append(a, actions);
      linksGrid.append(li);
    });
  }

  async function saveLinks() {
    renderLinks();
    Dash.emit('links-changed', links);
    await Store.set('quickLinks', links);
  }

  Dash.links = {
    all: () => links.slice(),
    normaliseUrl,
    async add(link) {
      links.push(Object.assign({ id: uid(), icon: '' }, link));
      await saveLinks();
    },
    async update(id, changes) {
      const link = links.find((l) => l.id === id);
      if (!link) return;
      Object.assign(link, changes);
      await saveLinks();
    },
    async remove(id) {
      links = links.filter((l) => l.id !== id);
      await saveLinks();
    },
    async move(id, delta) {
      const from = links.findIndex((l) => l.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= links.length) return false;
      const [item] = links.splice(from, 1);
      links.splice(to, 0, item);
      await saveLinks();
      return true;
    },
    async moveTo(id, targetIndex) {
      const from = links.findIndex((l) => l.id === id);
      if (from < 0) return;
      const [item] = links.splice(from, 1);
      links.splice(Math.max(0, Math.min(targetIndex, links.length)), 0, item);
      await saveLinks();
    },
    async restoreDefaults() {
      links = JSON.parse(JSON.stringify(Store.DEFAULTS.quickLinks));
      await saveLinks();
    }
  };

  async function confirmDeleteLink(link) {
    const ok = await Dash.confirm({
      title: 'Delete link?',
      message: `"${link.title}" will be removed from your quick links.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (ok) {
      await Dash.links.remove(link.id);
      Dash.toast('Link deleted');
    }
    return ok;
  }
  Dash.confirmDeleteLink = confirmDeleteLink;

  /* ---------- Add / edit link dialog ---------- */

  const linkDialog = $('#linkDialog');
  const linkForm = $('#linkForm');
  let editingId = null;

  Dash.openLinkDialog = function (link) {
    editingId = link ? link.id : null;
    $('#linkDialogTitle').textContent = link ? 'Edit link' : 'Add link';
    $('#linkTitle').value = link ? link.title : '';
    $('#linkUrl').value = link ? link.url : '';
    $('#linkIcon').value = link ? link.icon || '' : '';
    $('#linkError').textContent = '';
    $('#linkUrl').removeAttribute('aria-invalid');
    Dash.openDialog(linkDialog, link ? $('#linkTitle') : $('#linkTitle'));
  };

  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = normaliseUrl($('#linkUrl').value);
    if (!url) {
      $('#linkError').textContent = 'That web address doesn\'t look quite right. Try something like bbc.co.uk/news.';
      $('#linkUrl').setAttribute('aria-invalid', 'true');
      $('#linkUrl').focus();
      return;
    }
    let title = $('#linkTitle').value.trim();
    if (!title) {
      const host = new URL(url).hostname.replace(/^www\./, '');
      title = host.charAt(0).toUpperCase() + host.slice(1);
    }
    const icon = $('#linkIcon').value.trim();
    if (editingId) {
      await Dash.links.update(editingId, { title, url, icon });
      Dash.toast('Link updated');
    } else {
      await Dash.links.add({ title, url, icon });
      Dash.toast('Link added');
    }
    Dash.closeDialog(linkDialog);
  });

  /* ---------- Tile interactions: edit, delete, keyboard reorder ---------- */

  linksGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.mini-btn');
    if (!btn) return;
    e.preventDefault();
    const id = btn.closest('.link-item').dataset.id;
    const link = links.find((l) => l.id === id);
    if (!link) return;
    if (btn.classList.contains('edit')) Dash.openLinkDialog(link);
    else confirmDeleteLink(link);
  });

  linksGrid.addEventListener('keydown', async (e) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const item = e.target.closest('.link-item');
    if (!item || !e.target.classList.contains('link-tile')) return;
    e.preventDefault();
    const id = item.dataset.id;
    const moved = await Dash.links.move(id, e.key === 'ArrowLeft' ? -1 : 1);
    const tile = $(`.link-item[data-id="${CSS.escape(id)}"] .link-tile`, linksGrid);
    if (tile) tile.focus();
    if (moved) {
      const idx = links.findIndex((l) => l.id === id);
      Dash.toast(`Moved to position ${idx + 1} of ${links.length}`);
    }
  });

  /* ---------- Drag and drop ordering ---------- */

  let dragId = null;

  function clearDropMarks() {
    $$('.drop-before, .drop-after', linksGrid).forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  linksGrid.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.link-item');
    if (!item) return;
    dragId = item.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-duckdash-link', dragId);
    requestAnimationFrame(() => item.classList.add('dragging'));
  });

  linksGrid.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const item = e.target.closest('.link-item');
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    if (!item || item.dataset.id === dragId) return;
    const rect = item.getBoundingClientRect();
    item.classList.add(e.clientX < rect.left + rect.width / 2 ? 'drop-before' : 'drop-after');
  });

  linksGrid.addEventListener('drop', async (e) => {
    if (!dragId) return;
    e.preventDefault();
    const item = e.target.closest('.link-item');
    const id = dragId;
    clearDropMarks();
    if (!item || item.dataset.id === id) return;
    const rect = item.getBoundingClientRect();
    const after = e.clientX >= rect.left + rect.width / 2;
    const without = links.filter((l) => l.id !== id);
    let target = without.findIndex((l) => l.id === item.dataset.id);
    if (after) target += 1;
    await Dash.links.moveTo(id, target);
  });

  linksGrid.addEventListener('dragend', () => {
    dragId = null;
    clearDropMarks();
    $$('.dragging', linksGrid).forEach((el) => el.classList.remove('dragging'));
  });

  async function initLinks() {
    links = await Store.get('quickLinks');
    links.forEach((l) => { if (!l.id) l.id = uid(); });
    renderLinks();
    $('#addLinkBtn').addEventListener('click', () => Dash.openLinkDialog());
    $('#emptyAddLinkBtn').addEventListener('click', () => Dash.openLinkDialog());

    // Changes from another new tab.
    Store.onChange('quickLinks', (value) => {
      if (JSON.stringify(value) === JSON.stringify(links)) return;
      links = Array.isArray(value) ? value : [];
      renderLinks();
      Dash.emit('links-changed', links);
    });
  }

  /* ======================================================================
     Sticky notes
     ====================================================================== */

  const NOTE_META = [
    { label: 'Yellow', colour: 'var(--yellow)' },
    { label: 'Purple', colour: 'var(--purple)' },
    { label: 'Orange', colour: 'var(--orange)' },
    { label: 'Green', colour: 'var(--green)' },
    { label: 'Blue', colour: 'var(--blue)' }
  ];

  const notesCard = $('#notesCard');
  const editor = $('#noteEditor');
  const tabsEl = $('#noteTabs');
  const saveStatus = $('#saveStatus');
  let notes = null;
  let saveStatusTimer = null;

  function showSaved() {
    saveStatus.textContent = 'Saved ✓';
    saveStatus.classList.add('show');
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => {
      saveStatus.classList.remove('show');
      setTimeout(() => { if (!saveStatus.classList.contains('show')) saveStatus.textContent = ''; }, 250);
    }, 1600);
  }

  // "Saved ✓" shows when typed text is written, not for caret-only saves.
  let announceSave = false;
  const persistNotes = debounce(async () => {
    const announce = announceSave;
    announceSave = false;
    await Store.set('notes', notes);
    if (announce) showSaved();
    pushToNotepad();
  }, 400);

  function queueSave(announce) {
    if (announce) announceSave = true;
    persistNotes();
  }

  /* ---------- Link with the Sticky Notes extension (see notesync.js) ---------- */

  const link = { id: null, base: null, connected: false };

  // The note being typed in is never overwritten by an incoming change.
  let lastTypedAt = 0;
  function isTyping() {
    return persistNotes.pending() || Date.now() - lastTypedAt < 1500;
  }
  let pushing = Promise.resolve();

  function setLinkState(connected) {
    if (link.connected === connected) return;
    link.connected = connected;
    $('#notepadBadge').hidden = !connected;
    Dash.emit('notepad-link', Dash.notepadLink.status());
  }

  async function saveLinkBase() {
    const stored = (await Store.get('notepadLink')) || {};
    if (stored.id && stored.id !== link.id) return;
    await Store.set('notepadLink', Object.assign({}, stored, { id: link.id, base: link.base, lastSeen: Date.now() }));
  }

  /* Sends notes that differ from what both sides last agreed on. */
  function pushToNotepad() {
    pushing = pushing.then(async () => {
      if (!link.id || !notes) return;
      const changes = {};
      NoteSync.COLOURS.forEach((colour, i) => {
        const text = notes.items[i].text;
        if (!link.base || link.base[colour] !== text) changes[colour] = text;
      });
      if (!Object.keys(changes).length) return;
      const reply = await NoteSync.send(link.id, { type: 'set-notes', notes: changes });
      if (!reply || !reply.ok) {
        setLinkState(false);
        return;
      }
      link.base = Object.assign({}, link.base, changes);
      setLinkState(true);
      await saveLinkBase();
    });
    return pushing;
  }

  /* Pulls Sticky Notes' notes and merges them in. */
  async function pullFromNotepad() {
    if (!link.id) {
      setLinkState(false);
      return;
    }
    const reply = await NoteSync.send(link.id, { type: 'get-notes' });
    if (!reply || !reply.ok || !reply.notes) {
      setLinkState(false);
      return;
    }
    setLinkState(true);
    const busy = isTyping();
    const result = NoteSync.merge(notes.items, reply.notes, link.base, { skipIndex: busy ? notes.active : -1 });
    link.base = result.base;
    if (result.changed) {
      if (busy) updateTabStates();
      else loadNoteIntoEditor();
      await Store.set('notes', notes);
    }
    if (result.pushBack) {
      const ok = await NoteSync.send(link.id, { type: 'set-notes', notes: result.pushBack });
      if (!ok) setLinkState(false);
    }
    await saveLinkBase();
    if (busy) pushToNotepad();
  }

  async function initNotepadLink() {
    if (!NoteSync.hasMessaging()) return;
    const stored = await Store.get('notepadLink');
    link.id = stored && stored.id ? stored.id : null;
    link.base = stored && stored.base ? stored.base : null;
    await pullFromNotepad();

    // Sticky Notes introduced itself (via background.js) or the base moved on.
    Store.onChange('notepadLink', (value) => {
      if (!value || !value.id) return;
      const isNew = value.id !== link.id;
      link.id = value.id;
      if (value.base) link.base = value.base;
      setLinkState(true);
      if (isNew) pullFromNotepad();
    });
  }

  Dash.notepadLink = {
    status: () => ({ id: link.id, connected: link.connected }),
    refresh: () => pullFromNotepad()
  };

  function renderTabs() {
    tabsEl.replaceChildren();
    NOTE_META.forEach((meta, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'note-tab';
      tab.id = `note-tab-${i}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'notePanel');
      tab.style.setProperty('--c', meta.colour);
      tab.title = `${meta.label} note (Ctrl+${i + 1})`;
      tab.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="tab-label">${meta.label}</span>`;
      tab.setAttribute('aria-label', `${meta.label} note`);
      tab.addEventListener('click', () => selectNote(i, { focus: true }));
      tabsEl.append(tab);
    });
    updateTabStates();
  }

  function updateTabStates() {
    $$('.note-tab', tabsEl).forEach((tab, i) => {
      const selected = i === notes.active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle('has-text', notes.items[i].text.length > 0);
    });
  }

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  tabsEl.addEventListener('keydown', (e) => {
    const keys = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };
    if (!(e.key in keys)) return;
    e.preventDefault();
    let next = keys[e.key] === 'first' ? 0 : keys[e.key] === 'last' ? NOTE_META.length - 1
      : (notes.active + keys[e.key] + NOTE_META.length) % NOTE_META.length;
    selectNote(next);
    $(`#note-tab-${next}`).focus();
  });

  function formatEdited(ts) {
    if (!ts) return 'Not edited yet';
    const d = new Date(ts);
    const now = new Date();
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (now - d < 60000) return 'Edited just now';
    if (sameDay(d, now)) return `Edited today at ${time}`;
    if (sameDay(d, yesterday)) return `Edited yesterday at ${time}`;
    const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`;
    return `Edited ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${year} at ${time}`;
  }

  function renderNoteMeta() {
    const note = notes.items[notes.active];
    const text = editor.value;
    const chars = text.length;
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    $('#noteCounts').textContent =
      `${chars.toLocaleString('en-GB')} character${chars === 1 ? '' : 's'} · ${words.toLocaleString('en-GB')} word${words === 1 ? '' : 's'}`;
    $('#noteEdited').textContent = formatEdited(note.updated);
  }

  function rememberCursor() {
    if (!notes) return;
    const note = notes.items[notes.active];
    note.selStart = editor.selectionStart;
    note.selEnd = editor.selectionEnd;
    note.scroll = editor.scrollTop;
  }

  function loadNoteIntoEditor() {
    const note = notes.items[notes.active];
    const meta = NOTE_META[notes.active];
    notesCard.dataset.note = String(notes.active);
    editor.value = note.text;
    $('#noteEditorLabel').textContent = `${meta.label} note`;
    editor.setAttribute('aria-labelledby', `note-tab-${notes.active}`);
    const len = note.text.length;
    editor.setSelectionRange(Math.min(note.selStart || 0, len), Math.min(note.selEnd || 0, len));
    editor.scrollTop = note.scroll || 0;
    renderNoteMeta();
    updateTabStates();
  }

  function selectNote(index, { focus = false, animate = true } = {}) {
    if (index < 0 || index >= NOTE_META.length) return;
    if (index === notes.active) {
      if (focus) editor.focus({ preventScroll: true });
      return;
    }
    rememberCursor();
    notes.active = index;

    const swap = () => {
      loadNoteIntoEditor();
      editor.classList.remove('switching');
      if (focus) editor.focus({ preventScroll: true });
      // Focus resets the caret in some browsers, so restore it afterwards.
      const note = notes.items[notes.active];
      const len = note.text.length;
      editor.setSelectionRange(Math.min(note.selStart || 0, len), Math.min(note.selEnd || 0, len));
      editor.scrollTop = note.scroll || 0;
    };

    if (animate && !reduceMotion()) {
      editor.classList.add('switching');
      setTimeout(swap, 120);
    } else {
      swap();
    }
    queueSave(false);
  }

  editor.addEventListener('input', () => {
    lastTypedAt = Date.now();
    const note = notes.items[notes.active];
    note.text = editor.value;
    note.updated = Date.now();
    rememberCursor();
    renderNoteMeta();
    updateTabStates();
    queueSave(true);
  });

  // Keep the caret position up to date without spamming storage.
  const saveCursor = debounce(() => {
    rememberCursor();
    queueSave(false);
  }, 800);
  ['keyup', 'click', 'select'].forEach((ev) => editor.addEventListener(ev, saveCursor));
  editor.addEventListener('scroll', saveCursor, { passive: true });
  editor.addEventListener('blur', () => {
    rememberCursor();
    queueSave(false);
    persistNotes.flush();
  });

  // Make sure the last few keystrokes are written when the tab closes.
  window.addEventListener('pagehide', () => {
    if (!notes) return;
    rememberCursor();
    persistNotes.flush();
  });

  $('#resetNoteBtn').addEventListener('click', async () => {
    const meta = NOTE_META[notes.active];
    if (!notes.items[notes.active].text) {
      Dash.toast(`The ${meta.label.toLowerCase()} note is already empty`);
      return;
    }
    const ok = await Dash.confirm({
      title: `Reset ${meta.label.toLowerCase()} note?`,
      message: 'Everything in this note will be cleared. This can\'t be undone.',
      confirmLabel: 'Reset note',
      danger: true
    });
    if (!ok) return;
    notes.items[notes.active] = Store.emptyNote();
    loadNoteIntoEditor();
    queueSave(true);
    persistNotes.flush();
    editor.focus();
  });

  // Ctrl+1..5 (or Alt+1..5) switch notes from anywhere on the page.
  document.addEventListener('keydown', (e) => {
    if (e.shiftKey || !(e.ctrlKey || e.metaKey || e.altKey)) return;
    if ((e.ctrlKey || e.metaKey) && e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= NOTE_META.length) {
      e.preventDefault();
      selectNote(n - 1, { focus: true });
    }
  });

  /* Takes note texts written elsewhere (another new tab, or Sticky Notes via
     background.js). The note being typed in here is left alone. */
  function applyExternalNotes(value) {
    const incoming = Store.normaliseNotes(value);
    const busy = isTyping();
    let activeChanged = false;
    let any = false;
    incoming.items.forEach((n, i) => {
      if (busy && i === notes.active) return;
      if (n.text === notes.items[i].text) return;
      notes.items[i].text = n.text;
      notes.items[i].updated = n.updated;
      any = true;
      if (i === notes.active) activeChanged = true;
    });
    if (!any) return;
    if (activeChanged) loadNoteIntoEditor();
    else updateTabStates();
  }

  Dash.notes = {
    exportData() {
      rememberCursor();
      return {
        app: 'Duck Dashboard',
        version: 1,
        exported: new Date().toISOString(),
        notes: notes.items.map((n, i) => ({ colour: NOTE_META[i].label, text: n.text, updated: n.updated }))
      };
    },
    async importData(data) {
      const list = Array.isArray(data) ? data : data && Array.isArray(data.notes) ? data.notes : null;
      if (!list) throw new Error('bad-format');
      // Match by colour when the backup names it (older backups used another order).
      const byLabel = {};
      list.forEach((src) => {
        if (src && typeof src.colour === 'string') byLabel[src.colour.toLowerCase()] = src;
      });
      const items = Array.from({ length: Store.NOTE_COUNT }, (_, i) => {
        const src = byLabel[NOTE_META[i].label.toLowerCase()] || (Object.keys(byLabel).length ? null : list[i]);
        const text = typeof src === 'string' ? src : src && typeof src.text === 'string' ? src.text : '';
        const updated = src && typeof src.updated === 'number' ? src.updated : (text ? Date.now() : null);
        return Object.assign(Store.emptyNote(), { text, updated });
      });
      notes = { order: 2, active: 0, items };
      loadNoteIntoEditor();
      await Store.set('notes', notes);
      pushToNotepad();
    },
    async clearAll() {
      notes = { order: 2, active: notes.active, items: Array.from({ length: Store.NOTE_COUNT }, Store.emptyNote) };
      loadNoteIntoEditor();
      await Store.set('notes', notes);
      pushToNotepad();
    }
  };

  async function initNotes() {
    notes = await Store.get('notes');
    renderTabs();
    loadNoteIntoEditor();

    // Auto-focus the last note, with the caret where it was left.
    if (!document.activeElement || document.activeElement === document.body) {
      editor.focus({ preventScroll: true });
      const note = notes.items[notes.active];
      const len = note.text.length;
      editor.setSelectionRange(Math.min(note.selStart || 0, len), Math.min(note.selEnd || 0, len));
      editor.scrollTop = note.scroll || 0;
    }

    initNotepadLink();

    // Edits made in another new tab: pick them up unless we're typing here.
    Store.onChange('notes', applyExternalNotes);

    // Refresh relative "Edited ..." text when coming back to the tab.
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        rememberCursor();
        persistNotes.flush();
        return;
      }
      applyExternalNotes(await Store.get('notes'));
      renderNoteMeta();
      pullFromNotepad();
    });
  }

  /* ======================================================================
     Weather widget
     ====================================================================== */

  const weatherCard = $('#weatherCard');
  const weatherBody = $('#weatherBody');
  const weatherFoot = $('#weatherFoot');
  let weatherPrefs = null;
  let weatherRequest = 0;

  const WEATHER_MESSAGES = {
    'no-location': ['Weather unavailable.', 'Add a custom location in Settings.'],
    'not-found': ['Weather unavailable.', 'Check your location settings.'],
    'bad-key': ['Weather unavailable.', 'Your API key isn\'t working yet. New keys can take a couple of hours.'],
    network: ['Weather unavailable.', 'Check your connection or location settings.']
  };

  function renderWeather(data) {
    const group = data.condition === 'clear' && !data.isDay ? 'clear-night' : data.condition;
    weatherCard.dataset.wx = group;
    weatherCard.setAttribute('aria-busy', 'false');
    const deg = '<sup>°C</sup>';
    weatherBody.innerHTML = `
      <div class="weather-main">
        ${WeatherService.icon(data.condition, data.isDay)}
        <div>
          <div class="wx-temp">${data.temp}${deg}</div>
          <p class="wx-place">${escapeHtml(data.location)}</p>
          <p class="wx-desc">${escapeHtml(data.description)}</p>
        </div>
      </div>
      <dl class="wx-stats">
        <div class="wx-stat"><dt>Feels like</dt><dd>${data.feelsLike}°C</dd></div>
        <div class="wx-stat"><dt>Humidity</dt><dd>${data.humidity}%</dd></div>
        <div class="wx-stat"><dt>Wind</dt><dd>${data.wind} mph</dd></div>
        <div class="wx-stat"><dt>High / Low</dt><dd>${data.high}° / ${data.low}°</dd></div>
      </dl>`;
    $('.wx-icon', weatherBody).setAttribute('aria-hidden', 'true');

    const updated = new Date(data.fetchedAt);
    const at = `${pad(updated.getHours())}:${pad(updated.getMinutes())}`;
    if (data.demo) {
      weatherFoot.innerHTML = '<span class="demo-badge">Demo data</span> Add a free API key in Settings for live weather.';
    } else {
      const source = data.provider === 'openmeteo' ? 'Open-Meteo' : 'OpenWeatherMap';
      weatherFoot.textContent = `Updated ${at} · ${source}`;
    }
  }

  function renderWeatherError(code) {
    const [title, text] = WEATHER_MESSAGES[code] || WEATHER_MESSAGES.network;
    weatherCard.dataset.wx = 'cloudy';
    weatherCard.setAttribute('aria-busy', 'false');
    weatherBody.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">🌥️</div>
        <p class="empty-title">${escapeHtml(title)}</p>
        <p class="empty-text">${escapeHtml(text)}</p>
        <button type="button" class="btn secondary btn-sm" data-open-settings="weather">Weather settings</button>
      </div>`;
    weatherFoot.textContent = '';
  }

  function renderWeatherLoading() {
    weatherCard.setAttribute('aria-busy', 'true');
    weatherBody.innerHTML = `<div class="weather-skeleton" aria-hidden="true">
      <span class="sk sk-icon"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span></div>
      <span class="sr-only">Loading weather</span>`;
  }

  function syncLocationPills() {
    $$('#weatherLocations input').forEach((r) => { r.checked = r.value === weatherPrefs.location; });
    const custom = (weatherPrefs.custom || '').trim();
    $('#wxCustomLabel').textContent = custom || 'Custom';
    $('#wxCustomLabel').parentElement.title = custom || 'Custom location';
  }

  async function loadWeather({ force = false } = {}) {
    const request = ++weatherRequest;
    const key = WeatherService.cacheKey(weatherPrefs);

    if (!force) {
      const cache = await Store.get('weatherCache');
      if (cache && cache.key === key && Date.now() - cache.data.fetchedAt < WeatherService.CACHE_TTL) {
        renderWeather(cache.data);
        return;
      }
    }

    renderWeatherLoading();
    try {
      const data = await WeatherService.getWeather(weatherPrefs);
      if (request !== weatherRequest) return;
      renderWeather(data);
      await Store.set('weatherCache', { key, data });
    } catch (err) {
      if (request !== weatherRequest) return;
      renderWeatherError(err && err.code);
    }
  }

  Dash.weather = {
    async setPrefs(prefs, { force = true } = {}) {
      weatherPrefs = Object.assign({}, weatherPrefs, prefs);
      await Store.set('weather', weatherPrefs);
      syncLocationPills();
      await loadWeather({ force });
    },
    prefs: () => Object.assign({}, weatherPrefs)
  };

  async function initWeather() {
    weatherPrefs = await Store.get('weather');
    syncLocationPills();

    $('#weatherLocations').addEventListener('change', (e) => {
      const value = e.target.value;
      if (value === 'custom' && !(weatherPrefs.custom || '').trim()) {
        syncLocationPills();
        Dash.openSettings && Dash.openSettings('weather', '#customLocInput', { location: 'custom' });
        return;
      }
      Dash.weather.setPrefs({ location: value }, { force: false });
    });

    $('#weatherRefresh').addEventListener('click', () => loadWeather({ force: true }));

    weatherBody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open-settings]');
      if (btn && Dash.openSettings) Dash.openSettings(btn.dataset.openSettings);
    });

    await loadWeather();
  }

  /* ======================================================================
     Start
     ====================================================================== */

  async function init() {
    const settings = await Store.get('settings');
    Store.applyTheme(settings.theme);
    userName = (settings.userName || '').trim();
    startClock();

    await Promise.all([initNotes(), initLinks(), initSearch()]);
    initWeather();
    Dash.emit('ready');
    Dash.isReady = true;
  }

  init();
})();
