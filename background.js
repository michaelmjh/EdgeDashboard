/* background.js - Duck Dashboard
   Receives note updates from the Sticky Notes extension while no new tab is
   open, and records its extension ID so new tabs can talk to it. */

importScripts('notesync.js');

const NOTE_COUNT = 5;

function emptyNote() {
  return { text: '', updated: null, selStart: 0, selEnd: 0, scroll: 0 };
}

/* Notes saved before v1.2 used the order yellow, blue, green, purple,
   orange. Reorder them to yellow, purple, orange, green, blue. */
const NOTE_ORDER = 2;
const OLD_ORDER = ['yellow', 'blue', 'green', 'purple', 'orange'];
const NEW_ORDER = ['yellow', 'purple', 'orange', 'green', 'blue'];

function migrateNoteOrder(value) {
  if (value.order === NOTE_ORDER) return value;
  if (Array.isArray(value.items)) {
    const old = value.items;
    value.items = NEW_ORDER.map((c) => old[OLD_ORDER.indexOf(c)]);
    const active = Number(value.active);
    if (Number.isInteger(active) && OLD_ORDER[active]) value.active = NEW_ORDER.indexOf(OLD_ORDER[active]);
  }
  value.order = NOTE_ORDER;
  return value;
}

async function readNotes() {
  const { notes } = await chrome.storage.local.get('notes');
  const value = notes && typeof notes === 'object' ? notes : { active: 0, items: [] };
  migrateNoteOrder(value);
  const items = Array.isArray(value.items) ? value.items : [];
  value.items = Array.from({ length: NOTE_COUNT }, (_, i) => Object.assign(emptyNote(), items[i] || {}));
  if (!Number.isInteger(value.active)) value.active = 0;
  return value;
}

async function handle(message, sender) {
  const stored = (await chrome.storage.local.get('notepadLink')).notepadLink;
  const link = stored && stored.id === sender.id ? stored : { id: sender.id, base: null };

  if ((message.type === 'hello' || message.type === 'notes') && message.notes) {
    const notes = await readNotes();
    const result = NoteSync.merge(notes.items, message.notes, link.base);
    if (result.changed) await chrome.storage.local.set({ notes });
    link.base = result.base;
    if (result.pushBack) NoteSync.send(sender.id, { type: 'set-notes', notes: result.pushBack });
  }

  link.lastSeen = Date.now();
  await chrome.storage.local.set({ notepadLink: link });
  return { ok: true, app: NoteSync.APP };
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || message.app !== NoteSync.PEER || !sender.id) return false;
  handle(message, sender).then(sendResponse, () => sendResponse({ ok: false }));
  return true;
});
