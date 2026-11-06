/* settings.js - Duck Dashboard
   Settings dialog: personalisation, weather, quick links and notes.
   Uses the helpers newtab.js puts on window.Dash. */

(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const Dash = window.Dash;
  const { debounce, svgIcon, escapeHtml } = Dash.helpers;

  const dialog = $('#settingsDialog');
  const tabs = $$('.settings-tabs [role="tab"]');
  const TAB_IDS = tabs.map((t) => t.dataset.tab);
  let settings = null;

  /* ---------- Tabs ---------- */

  function selectTab(id, { focusTab = false } = {}) {
    if (!TAB_IDS.includes(id)) id = 'personal';
    tabs.forEach((tab) => {
      const selected = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $('#' + tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focusTab) tab.focus();
    });
    if (id === 'links') renderLinksList();
    if (id === 'weather') fillWeatherForm();
    if (settings && settings.settingsTab !== id) {
      settings.settingsTab = id;
      Store.set('settings', settings);
    }
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));

  $('.settings-tabs').addEventListener('keydown', (e) => {
    const current = TAB_IDS.indexOf(tabs.find((t) => t.getAttribute('aria-selected') === 'true').dataset.tab);
    let next = null;
    if (e.key === 'ArrowRight') next = (current + 1) % TAB_IDS.length;
    if (e.key === 'ArrowLeft') next = (current - 1 + TAB_IDS.length) % TAB_IDS.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = TAB_IDS.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectTab(TAB_IDS[next], { focusTab: true });
  });

  /* ---------- Open ---------- */

  /* Opens settings on a tab. focusSel focuses a field; preset pre-fills
     weather form values (used when "Custom" is picked with no place set). */
  Dash.openSettings = async function (tab, focusSel, preset) {
    settings = await Store.get('settings');
    $('#userNameInput').value = settings.userName || '';
    $$('input[name="theme"]').forEach((r) => { r.checked = r.value === (settings.theme || 'system'); });
    selectTab(tab || settings.settingsTab || 'personal');
    if (preset) fillWeatherForm(preset);
    const focusEl = focusSel ? $(focusSel) : tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    Dash.openDialog(dialog, focusEl);
  };

  $('#settingsBtn').addEventListener('click', () => Dash.openSettings());

  /* ---------- Personalisation ---------- */

  const saveName = debounce(async (value) => {
    settings.userName = value.trim();
    await Store.set('settings', settings);
  }, 300);

  $('#userNameInput').addEventListener('input', (e) => {
    Dash.setUserName(e.target.value);
    saveName(e.target.value);
  });

  $$('input[name="theme"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      settings.theme = radio.value;
      Store.applyTheme(radio.value);
      await Store.set('settings', settings);
      Dash.toast(`${radio.value.charAt(0).toUpperCase() + radio.value.slice(1)} theme on`);
    });
  });

  // Keep other open tabs in step with theme and name changes.
  Store.onChange('settings', (value) => {
    Store.applyTheme(value.theme);
    Dash.setUserName(value.userName);
    if (settings) settings = value;
  });

  /* ---------- Weather ---------- */

  const providerSelect = $('#providerSelect');
  Object.values(WeatherService.providers).forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    providerSelect.append(opt);
  });

  function selectedLocation() {
    const checked = $('input[name="sLoc"]:checked');
    return checked ? checked.value : 'glasgow';
  }

  function updateWeatherFieldVisibility() {
    $('#customLocField').hidden = selectedLocation() !== 'custom';
    const provider = WeatherService.providers[providerSelect.value];
    $('#apiKeyField').hidden = !(provider && provider.needsKey);
    $('.instructions').hidden = !(provider && provider.needsKey);
  }

  function fillWeatherForm(preset) {
    const prefs = Object.assign(Dash.weather ? Dash.weather.prefs() : {}, preset || {});
    $$('input[name="sLoc"]').forEach((r) => { r.checked = r.value === (prefs.location || 'glasgow'); });
    $('#customLocInput').value = prefs.custom || '';
    providerSelect.value = prefs.provider || 'openweathermap';
    $('#apiKeyInput').value = prefs.apiKey || '';
    updateWeatherFieldVisibility();
  }

  $$('input[name="sLoc"]').forEach((r) => r.addEventListener('change', () => {
    updateWeatherFieldVisibility();
    if (r.value === 'custom' && r.checked) $('#customLocInput').focus();
  }));
  providerSelect.addEventListener('change', updateWeatherFieldVisibility);

  $('#toggleKeyBtn').addEventListener('click', (e) => {
    const input = $('#apiKeyInput');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(show));
  });

  $('#weatherForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const location = selectedLocation();
    const custom = $('#customLocInput').value.trim();
    if (location === 'custom' && !custom) {
      $('#customLocInput').focus();
      Dash.toast('Type a place name for your custom location');
      return;
    }
    await Dash.weather.setPrefs({
      location,
      custom,
      provider: providerSelect.value,
      apiKey: $('#apiKeyInput').value.trim()
    });
    Dash.toast('Weather settings saved ✓');
  });

  /* ---------- Quick links ---------- */

  const list = $('#settingsLinks');

  function renderLinksList() {
    const links = Dash.links.all();
    list.replaceChildren();
    $('#settingsLinksEmpty').hidden = links.length > 0;

    links.forEach((link, i) => {
      const li = document.createElement('li');
      li.className = 'settings-link';
      li.dataset.id = link.id;

      const text = document.createElement('div');
      text.className = 'settings-link-text';
      text.innerHTML = `<strong>${escapeHtml(link.title)}</strong><span>${escapeHtml(link.url)}</span>`;

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const t = escapeHtml(link.title);
      actions.innerHTML =
        `<button type="button" class="icon-btn" data-act="up" aria-label="Move ${t} up" title="Move up" ${i === 0 ? 'disabled' : ''}>${svgIcon('i-up')}</button>` +
        `<button type="button" class="icon-btn" data-act="down" aria-label="Move ${t} down" title="Move down" ${i === links.length - 1 ? 'disabled' : ''}>${svgIcon('i-down')}</button>` +
        `<button type="button" class="icon-btn" data-act="edit" aria-label="Edit ${t}" title="Edit">${svgIcon('i-edit')}</button>` +
        `<button type="button" class="icon-btn del" data-act="delete" aria-label="Delete ${t}" title="Delete">${svgIcon('i-trash')}</button>`;

      li.append(Dash.buildLinkIcon(link), text, actions);
      list.append(li);
    });
  }

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const id = btn.closest('.settings-link').dataset.id;
    const link = Dash.links.all().find((l) => l.id === id);
    if (!link) return;
    const act = btn.dataset.act;

    if (act === 'up' || act === 'down') {
      await Dash.links.move(id, act === 'up' ? -1 : 1);
      // Keep focus on the same button of the moved row.
      const row = $(`.settings-link[data-id="${CSS.escape(id)}"]`, list);
      let target = row && $(`[data-act="${act}"]`, row);
      if (target && target.disabled) target = $(`[data-act="${act === 'up' ? 'down' : 'up'}"]`, row);
      if (target) target.focus();
    } else if (act === 'edit') {
      Dash.openLinkDialog(link);
    } else if (act === 'delete') {
      await Dash.confirmDeleteLink(link);
    }
  });

  Dash.on('links-changed', () => {
    if (dialog.open) renderLinksList();
  });

  $('#settingsAddLink').addEventListener('click', () => Dash.openLinkDialog());

  $('#settingsResetLinks').addEventListener('click', async () => {
    const ok = await Dash.confirm({
      title: 'Restore default links?',
      message: 'Your quick links will be replaced with Outlook, Teams, OneDrive, GitHub, Stack Overflow and BBC News.',
      confirmLabel: 'Restore'
    });
    if (ok) {
      await Dash.links.restoreDefaults();
      Dash.toast('Default links restored');
    }
  });

  /* ---------- Notes ---------- */

  $('#exportNotesBtn').addEventListener('click', () => {
    const data = Dash.notes.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `duck-dashboard-notes-${stamp}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    Dash.toast('Notes exported ✓');
  });

  const fileInput = $('#importNotesInput');
  $('#importNotesBtn').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      Dash.toast('That file isn\'t a notes backup');
      return;
    }
    const ok = await Dash.confirm({
      title: 'Import notes?',
      message: 'Your current five notes will be replaced with the ones in this backup.',
      confirmLabel: 'Import'
    });
    if (!ok) return;
    try {
      await Dash.notes.importData(data);
      Dash.toast('Notes imported ✓');
    } catch (e) {
      Dash.toast('That file isn\'t a notes backup');
    }
  });

  $('#clearNotesBtn').addEventListener('click', async () => {
    const ok = await Dash.confirm({
      title: 'Clear all notes?',
      message: 'All five notes will be emptied. Export a backup first if you might want them back.',
      confirmLabel: 'Clear notes',
      danger: true
    });
    if (ok) {
      await Dash.notes.clearAll();
      Dash.toast('All notes cleared');
    }
  });
})();
