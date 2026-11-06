/* notesync.js - Duck Dashboard
   Two-way link with the Sticky Notes extension (michaelmjh/NotepadExtension).
   Sticky Notes owns the notes; the dashboard keeps a local copy so it still
   works when Sticky Notes isn't installed.

   Protocol (chrome.runtime external messages):
     Sticky Notes -> Dashboard  { app: 'sticky-notes', type: 'hello' | 'notes', notes: { yellow: '...', ... } }
     Dashboard -> Sticky Notes  { app: 'duck-dashboard', type: 'get-notes' }      reply { ok, notes }
     Dashboard -> Sticky Notes  { app: 'duck-dashboard', type: 'set-notes', notes: { blue: '...' } }  (only changed colours)

   Sticky Notes learns this extension's ID from the fixed "key" in
   manifest.json (ID kgnlnhdenhgddbggpccmpodgogfhkggh). The dashboard learns
   Sticky Notes' ID from the first message it sends, stored as notepadLink.

   Loaded by newtab.html and, via importScripts, by background.js. */

(function (root) {
  'use strict';

  // Dashboard note order. Index matches the note tabs.
  const COLOURS = ['yellow', 'blue', 'green', 'purple', 'orange'];
  const APP = 'duck-dashboard';
  const PEER = 'sticky-notes';

  function hasMessaging() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.id;
  }

  /* Sends a message to Sticky Notes. Resolves null when it isn't there. */
  function send(peerId, message) {
    return new Promise((resolve) => {
      if (!peerId || !hasMessaging()) return resolve(null);
      try {
        chrome.runtime.sendMessage(peerId, Object.assign({ app: APP }, message), (reply) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(reply || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /* Three-way merge of Sticky Notes' texts into the dashboard's note items
     (in place). base holds the texts both sides last agreed on, so an edit
     made on one side while the other was away is kept rather than
     overwritten. Without a base (first link), a blank remote note never
     wipes a dashboard note that has text.

     Returns { changed, pushBack, base }:
       changed  - items were updated from Sticky Notes
       pushBack - colour -> text that Sticky Notes should take, or null
       base     - the new agreed texts */
  function merge(items, remote, base, { skipIndex = -1 } = {}) {
    let changed = false;
    const pushBack = {};
    const nextBase = Object.assign({}, base || {});
    COLOURS.forEach((colour, i) => {
      const r = remote ? remote[colour] : undefined;
      if (typeof r !== 'string' || !items[i] || i === skipIndex) return;
      const l = items[i].text || '';
      const b = base ? base[colour] : undefined;

      if (r === l) {
        nextBase[colour] = r;
        return;
      }
      const localOnly = typeof b === 'string' ? r === b : !r && !!l;
      if (localOnly) {
        pushBack[colour] = l;
        nextBase[colour] = l;
        return;
      }
      // Remote changed (or both did): Sticky Notes wins.
      items[i].text = r;
      items[i].updated = Date.now();
      nextBase[colour] = r;
      changed = true;
    });
    return { changed, pushBack: Object.keys(pushBack).length ? pushBack : null, base: nextBase };
  }

  /* Texts keyed by colour, for sending. */
  function toRemote(items) {
    const out = {};
    COLOURS.forEach((colour, i) => { out[colour] = (items[i] && items[i].text) || ''; });
    return out;
  }

  root.NoteSync = { COLOURS, APP, PEER, send, merge, toRemote, hasMessaging };
})(typeof self !== 'undefined' ? self : window);
