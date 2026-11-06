/* storage.js - Duck Dashboard
   Small promise wrapper around chrome.storage.local, with defaults for every
   key the dashboard keeps. Falls back to localStorage when the page is opened
   outside the extension (handy for quick previews).

   Loaded in <head> without defer so the saved theme is applied before the
   first paint. The theme is mirrored to localStorage for that reason only. */

(function () {
  'use strict';

  const THEME_MIRROR = 'duckdash-theme';
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return darkQuery.matches ? 'dark' : 'light';
  }

  function applyTheme(pref) {
    const root = document.documentElement;
    root.dataset.themePref = pref || 'system';
    root.dataset.theme = resolveTheme(pref);
    try { localStorage.setItem(THEME_MIRROR, pref || 'system'); } catch (e) { /* ignore */ }
  }

  // Theme boot: runs before the body is parsed.
  try {
    const pref = localStorage.getItem(THEME_MIRROR) || 'system';
    document.documentElement.dataset.themePref = pref;
    document.documentElement.dataset.theme = resolveTheme(pref);
  } catch (e) {
    document.documentElement.dataset.theme = resolveTheme('system');
  }

  // Follow the OS when the preference is "system".
  darkQuery.addEventListener('change', () => {
    if ((document.documentElement.dataset.themePref || 'system') === 'system') {
      applyTheme('system');
    }
  });

  /* ---------- Defaults ---------- */

  const NOTE_COUNT = 5;

  function emptyNote() {
    return { text: '', updated: null, selStart: 0, selEnd: 0, scroll: 0 };
  }

  const DEFAULTS = {
    settings: {
      userName: '',
      theme: 'system',
      settingsTab: 'personal'
    },
    quickLinks: [
      { id: 'outlook', title: 'Outlook', url: 'https://outlook.office.com/mail/', icon: '' },
      { id: 'teams', title: 'Teams', url: 'https://teams.microsoft.com/', icon: '' },
      { id: 'onedrive', title: 'OneDrive', url: 'https://onedrive.live.com/', icon: '' },
      { id: 'github', title: 'GitHub', url: 'https://github.com/', icon: '' },
      { id: 'stackoverflow', title: 'Stack Overflow', url: 'https://stackoverflow.com/', icon: '' },
      { id: 'bbcnews', title: 'BBC News', url: 'https://www.bbc.co.uk/news', icon: '' }
    ],
    notes: {
      active: 0,
      items: Array.from({ length: NOTE_COUNT }, emptyNote)
    },
    weather: {
      location: 'glasgow',
      custom: '',
      provider: 'openweathermap',
      apiKey: ''
    },
    weatherCache: null,
    searchHistory: {
      google: [],
      duckduckgo: []
    }
  };

  /* ---------- Backends ---------- */

  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const LS_PREFIX = 'duckdash:';

  const backend = hasChrome
    ? {
        get: (key) => chrome.storage.local.get(key).then((r) => r[key]),
        set: (key, value) => chrome.storage.local.set({ [key]: value }),
        remove: (key) => chrome.storage.local.remove(key)
      }
    : {
        get: async (key) => {
          try {
            const raw = localStorage.getItem(LS_PREFIX + key);
            return raw == null ? undefined : JSON.parse(raw);
          } catch (e) {
            return undefined;
          }
        },
        set: async (key, value) => {
          localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
          window.dispatchEvent(new CustomEvent('duckdash-local-change', { detail: { key, value } }));
        },
        remove: async (key) => localStorage.removeItem(LS_PREFIX + key)
      };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  /* Merge stored objects over their defaults so new fields added in later
     versions always exist. Arrays are taken as stored. */
  function withDefaults(key, stored) {
    const def = DEFAULTS[key];
    if (stored === undefined) return clone(def);
    if (def && typeof def === 'object' && !Array.isArray(def) && stored && typeof stored === 'object') {
      return Object.assign(clone(def), stored);
    }
    return stored;
  }

  function normaliseNotes(value) {
    const items = Array.isArray(value.items) ? value.items : [];
    value.items = Array.from({ length: NOTE_COUNT }, (_, i) => Object.assign(emptyNote(), items[i] || {}));
    const active = Number(value.active);
    value.active = Number.isInteger(active) && active >= 0 && active < NOTE_COUNT ? active : 0;
    return value;
  }

  async function get(key) {
    let value;
    try {
      value = await backend.get(key);
    } catch (e) {
      value = undefined;
    }
    value = withDefaults(key, value);
    if (key === 'notes') value = normaliseNotes(value);
    if (key === 'quickLinks' && !Array.isArray(value)) value = clone(DEFAULTS.quickLinks);
    return value;
  }

  async function set(key, value) {
    await backend.set(key, value);
    return value;
  }

  async function remove(key) {
    await backend.remove(key);
  }

  /* Listen for changes to one key, including changes made in other tabs. */
  function onChange(key, callback) {
    if (hasChrome && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[key]) {
          callback(withDefaults(key, changes[key].newValue));
        }
      });
    } else {
      window.addEventListener('storage', (e) => {
        if (e.key === LS_PREFIX + key) {
          try { callback(withDefaults(key, JSON.parse(e.newValue))); } catch (err) { /* ignore */ }
        }
      });
      window.addEventListener('duckdash-local-change', (e) => {
        if (e.detail.key === key) callback(e.detail.value);
      });
    }
  }

  window.Store = {
    NOTE_COUNT,
    DEFAULTS,
    emptyNote,
    get,
    set,
    remove,
    onChange,
    applyTheme,
    resolveTheme,
    normaliseNotes
  };
})();
