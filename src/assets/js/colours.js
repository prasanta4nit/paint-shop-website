/* Colour catalogue: filter, search, room preview, pairings and a saved palette (no dependencies) */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const catalogue = $('#catalogue');
  if (!catalogue) return;

  const WA = catalogue.dataset.waNumber;
  const waLink = (msg) => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
  const STORE_KEY = 'aahana-palette';

  /* ---------- Colour maths ---------- */
  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const rgbToHsl = ([r, g, b]) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  };
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  /* ---------- Data (read from the server-rendered tiles) ---------- */
  const tiles = $$('.colour-tile');
  const familyLabels = Object.fromEntries($$('[data-family-section]').map((s) => [s.dataset.familySection, $('h2', s).firstChild.textContent.trim()]));
  const colours = tiles.map((tile) => {
    const rgb = hexToRgb(tile.dataset.hex);
    return {
      name: tile.dataset.name,
      hex: tile.dataset.hex,
      family: tile.dataset.family,
      tile,
      lum: luminance(rgb),
      hsl: rgbToHsl(rgb),
    };
  });
  const byName = Object.fromEntries(colours.map((c) => [c.name, c]));
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  /* ---------- Saved palette (per-browser convenience only) ---------- */
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]').filter((n) => byName[n]); } catch { saved = []; }
  const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { /* storage unavailable */ } };

  const paletteBar = $('#palette-bar');
  const paletteToggle = $('#palette-toggle');
  function renderPalette() {
    $$('[data-palette-count]').forEach((el) => { el.textContent = saved.length; });
    colours.forEach((c) => c.tile.classList.toggle('is-saved', saved.includes(c.name)));
    $('[data-palette-dots]').innerHTML = saved.slice(0, 6).map((n) => `<i style="--c:${byName[n].hex}"></i>`).join('');
    paletteBar.classList.toggle('is-visible', saved.length > 0);
    const lines = saved.map((n) => `• ${n} (${byName[n].hex})`).join('\n');
    $('[data-palette-send]').href = waLink(`Hello! Here are the colours I've shortlisted from your website:\n${lines}\nPlease suggest the matching shades and quantities.`);
    if (!saved.length && filters.palette) { filters.palette = false; paletteToggle.setAttribute('aria-pressed', 'false'); applyFilters(); }
  }
  function toggleSaved(name) {
    saved = saved.includes(name) ? saved.filter((n) => n !== name) : [...saved, name];
    persist();
    renderPalette();
    if (filters.palette) applyFilters();
    return saved.includes(name);
  }
  $('[data-palette-clear]').addEventListener('click', () => { saved = []; persist(); renderPalette(); applyFilters(); });

  /* ---------- Filtering & search ---------- */
  const filters = { family: 'all', query: '', palette: false };
  const resultCount = $('#result-count');
  const empty = $('#colour-empty');

  function applyFilters() {
    const q = filters.query.trim().toLowerCase().replace(/^#/, '');
    let shown = 0;
    colours.forEach((c) => {
      const matchFamily = filters.family === 'all' || c.family === filters.family;
      const matchQuery = !q || c.name.toLowerCase().includes(q) || c.hex.toLowerCase().includes(q) || familyLabels[c.family].toLowerCase().includes(q);
      const matchPalette = !filters.palette || saved.includes(c.name);
      const visible = matchFamily && matchQuery && matchPalette;
      c.tile.hidden = !visible;
      if (visible) shown++;
    });
    $$('[data-family-section]').forEach((s) => { s.hidden = !$$('.colour-tile', s).some((t) => !t.hidden); });
    resultCount.textContent = `${shown} colour${shown === 1 ? '' : 's'}`;
    empty.classList.toggle('is-visible', shown === 0);
  }

  $$('.filter-btn[data-filter]').forEach((btn) => btn.addEventListener('click', () => {
    filters.family = btn.dataset.filter;
    $$('.filter-btn[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    applyFilters();
  }));
  $('#colour-search').addEventListener('input', (e) => { filters.query = e.target.value; applyFilters(); });
  paletteToggle.addEventListener('click', () => {
    if (!saved.length) { window.siteToast?.('Tap the heart on a colour to save it first'); return; }
    filters.palette = !filters.palette;
    paletteToggle.setAttribute('aria-pressed', String(filters.palette));
    applyFilters();
  });

  /* ---------- Pairing suggestions ---------- */
  function pairsFor(c) {
    const [h, s, l] = c.hsl;
    const chosen = [];
    const pick = (pool, score) => {
      const best = pool.filter((o) => o !== c && !chosen.includes(o)).sort((a, b) => score(a) - score(b))[0];
      if (best) chosen.push(best);
    };
    const near = (th, ts, tl) => (o) => hueDist(o.hsl[0], th) / 90 + Math.abs(o.hsl[1] - ts) + Math.abs(o.hsl[2] - tl) * 1.5;
    const colourful = colours.filter((o) => o.hsl[1] > 0.2 && o.family !== 'whites' && o.family !== 'neutrals');

    if (s < 0.25 || c.family === 'whites' || c.family === 'neutrals') {
      // Neutral base: suggest a calm accent, a bold accent and a contrasting neutral.
      pick(colourful, near((h + 180) % 360, 0.45, 0.45));
      pick(colourful, near((h + 30) % 360, 0.55, 0.35));
    } else {
      pick(colourful, near((h + 180) % 360, Math.max(s, 0.35), l));
      pick(colourful, near((h + 30) % 360, s, l));
    }
    const neutrals = colours.filter((o) => o.family === 'whites' || o.family === 'neutrals');
    if (l > 0.7) pick(neutrals.filter((o) => o.hsl[2] < 0.5), (o) => hueDist(o.hsl[0], h) / 180 + o.hsl[2]);
    else pick(neutrals.filter((o) => o.hsl[2] > 0.85), (o) => hueDist(o.hsl[0], h) / 180);
    return chosen;
  }

  /* ---------- Detail dialog ---------- */
  const dialog = $('#colour-dialog');
  let current = null;
  let mode = 'full';
  const ACCENT_SIDE = '#f1ece4';

  function paintRoom() {
    if (!current) return;
    $$('.room-wall', dialog).forEach((wall) => {
      wall.setAttribute('fill', mode === 'accent' && wall.dataset.wall === 'side' ? ACCENT_SIDE : current.hex);
    });
  }

  function describe(c) {
    if (c.lum >= 0.5) return { tone: 'Light', use: 'Small rooms, ceilings and rooms with little sunlight' };
    if (c.lum >= 0.18) return { tone: 'Medium', use: 'Living rooms, bedrooms and feature walls' };
    return { tone: 'Deep', use: 'Accent walls, trims, doors and exteriors' };
  }

  function openColour(c, { updateHash = true } = {}) {
    current = c;
    const d = describe(c);
    $('[data-cd-swatch]', dialog).style.setProperty('--c', c.hex);
    $('#cd-name').textContent = c.name;
    $('[data-cd-family]', dialog).textContent = familyLabels[c.family];
    $('[data-cd-hex]', dialog).textContent = c.hex;
    $('[data-cd-tone]', dialog).textContent = d.tone;
    $('[data-cd-lrv]', dialog).textContent = `about ${Math.round(c.lum * 100)}%`;
    $('[data-cd-use]', dialog).textContent = d.use;
    $('[data-cd-pairs]', dialog).innerHTML = pairsFor(c).map((p) =>
      `<button type="button" class="pair-btn" data-pair="${p.name}"><i style="--c:${p.hex}"></i>${p.name}</button>`).join('');
    $('[data-cd-wa]', dialog).href = waLink(`Hello! I'm interested in the colour "${c.name}" (${c.hex}) from your website catalogue. Please suggest the matching brand shade and price.`);
    updateSaveButton();
    paintRoom();
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (updateHash) history.replaceState(null, '', `#c-${slug(c.name)}`);
  }

  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function updateSaveButton() {
    const btn = $('[data-cd-save]', dialog);
    const isSaved = saved.includes(current.name);
    $('span', btn).textContent = isSaved ? 'Saved' : 'Save';
    btn.setAttribute('aria-pressed', String(isSaved));
    $('svg', btn).style.fill = isSaved ? 'currentColor' : 'none';
  }

  dialog.addEventListener('close', () => {
    if (current) current.tile.focus({ preventScroll: true });
    history.replaceState(null, '', location.pathname + location.search);
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) closeDialog();
    const pair = e.target.closest('[data-pair]');
    if (pair) openColour(byName[pair.dataset.pair]);
  });
  $$('.preview-modes button', dialog).forEach((btn) => btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    $$('.preview-modes button', dialog).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    paintRoom();
  }));
  $('[data-cd-save]', dialog).addEventListener('click', () => {
    const nowSaved = toggleSaved(current.name);
    updateSaveButton();
    window.siteToast?.(nowSaved ? `${current.name} saved to your palette` : `${current.name} removed`);
  });
  $('[data-cd-copy]', dialog).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${current.name} ${current.hex}`);
      window.siteToast?.(`Copied ${current.hex}`);
    } catch {
      window.siteToast?.(current.hex);
    }
  });

  catalogue.addEventListener('click', (e) => {
    const tile = e.target.closest('.colour-tile');
    if (tile) openColour(byName[tile.dataset.name]);
  });

  /* ---------- Deep links: colours.html#c-haldi ---------- */
  function openFromHash() {
    const m = location.hash.match(/^#c-(.+)$/);
    if (!m) return;
    const c = colours.find((x) => slug(x.name) === m[1]);
    if (c) {
      c.tile.scrollIntoView({ block: 'center' });
      openColour(c, { updateHash: false });
    }
  }

  renderPalette();
  applyFilters();
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
})();
