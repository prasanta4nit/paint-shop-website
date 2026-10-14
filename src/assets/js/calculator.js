/* Paint quantity calculator (no dependencies) */
(() => {
  'use strict';

  const root = document.querySelector('.calc');
  if (!root) return;
  const form = root.querySelector('#calc-form');
  const out = (key) => root.querySelector(`[data-out="${key}"]`);
  const S = window.SITE_STRINGS;
  const tpl = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

  // Typical coverage on a smooth, previously painted surface (sq. ft. per litre, per coat).
  const COVERAGE = {
    interior: { low: 120, high: 140, label: S.interiorPaint },
    exterior: { low: 100, high: 110, label: S.exteriorPaint },
  };
  const PRIMER_COVERAGE = 100;          // sq. ft. per litre, one coat
  const PUTTY_COVERAGE = { low: 12, high: 18 }; // sq. ft. per kg, two coats
  const DOOR_AREA = 21;                 // 7 ft × 3 ft
  const WINDOW_AREA = 15;               // 5 ft × 3 ft
  const PACKS = [20, 10, 4, 1];         // common emulsion pack sizes in litres

  let surface = 'interior';

  const num = (name) => Math.max(0, parseFloat(form.elements[name].value) || 0);
  const roundUpHalf = (v) => Math.ceil(v * 2) / 2;
  const fmtL = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  // Cheapest-looking combination of packs: least leftover paint, then fewest tins.
  function packsFor(litres) {
    if (litres <= 0) return [];
    let best = null;
    const max20 = Math.ceil(litres / 20) + 1;
    for (let a = 0; a <= max20; a++)
      for (let b = 0; b <= 2; b++)
        for (let c = 0; c <= 3; c++)
          for (let d = 0; d <= 4; d++) {
            const total = a * 20 + b * 10 + c * 4 + d;
            if (total < litres) continue;
            const cans = a + b + c + d;
            const score = (total - litres) * 10 + cans;
            if (!best || score < best.score) best = { score, counts: [a, b, c, d] };
          }
    return best.counts.map((n, i) => ({ n, size: PACKS[i] })).filter((p) => p.n);
  }

  function calculate() {
    const height = num('height');
    const openings = num('doors') * DOOR_AREA + num('windows') * WINDOW_AREA;
    const coats = Number(form.elements.coats.value);
    let area;
    let summary;

    if (surface === 'interior') {
      const length = num('roomLength');
      const width = num('roomWidth');
      const ceiling = form.elements.ceiling.checked ? length * width : 0;
      area = Math.max(0, 2 * (length + width) * height - openings) + ceiling;
      summary = tpl(S.summaryInterior, { l: length, w: width, h: height }) + (ceiling ? S.ceilingIncluded : '');
    } else {
      const perimeter = num('perimeter');
      area = Math.max(0, perimeter * height - openings);
      summary = tpl(S.summaryExterior, { p: perimeter, h: height });
    }
    area = Math.round(area);

    const cov = COVERAGE[surface];
    const paintLow = roundUpHalf((area * coats) / cov.high);
    const paintHigh = roundUpHalf((area * coats) / cov.low);
    const primer = roundUpHalf(area / PRIMER_COVERAGE);
    const newWall = form.elements.newwall.checked;
    const puttyLow = Math.ceil(area / PUTTY_COVERAGE.high);
    const puttyHigh = Math.ceil(area / PUTTY_COVERAGE.low);
    const paintText = paintLow === paintHigh ? fmtL(paintHigh) : `${fmtL(paintLow)}–${fmtL(paintHigh)}`;
    const puttyText = `${puttyLow === puttyHigh ? puttyHigh : `${puttyLow}–${puttyHigh}`} ${S.kg}`;
    const coatsText = tpl(coats > 1 ? S.coatMany : S.coatOne, { n: coats });
    const packs = packsFor(paintHigh);

    out('paint').textContent = paintText;
    out('paintType').textContent = `${cov.label} (${coatsText})`;
    out('area').textContent = `${area.toLocaleString('en-IN')} ${S.sqft}`;
    out('primer').textContent = `${fmtL(primer)} ${S.litre}`;
    out('putty').textContent = puttyText;
    root.querySelector('[data-out-row="putty"]').hidden = !newWall;
    out('packs').innerHTML = packs.length
      ? packs.map((p) => `<span>${p.n} × ${p.size} ${S.litre}</span>`).join('')
      : `<span>${S.enterMeasurements}</span>`;

    const lines = [
      S.calcIntro,
      summary,
      tpl(S.calcArea, { area }),
      tpl(S.calcEstimate, { paint: paintText, label: cov.label, coats: coatsText, primer: fmtL(primer) })
        + (newWall ? tpl(S.calcPutty, { putty: puttyText }) : ''),
      S.calcConfirm,
    ];
    out('wa').href = `https://wa.me/${root.dataset.waNumber}?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  root.querySelectorAll('[data-surface]').forEach((btn) => btn.addEventListener('click', () => {
    surface = btn.dataset.surface;
    root.querySelectorAll('[data-surface]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    form.querySelectorAll('[data-for]').forEach((f) => { f.hidden = f.dataset.for !== surface; });
    form.elements.height.value = surface === 'exterior' ? 20 : 10;
    calculate();
  }));
  form.addEventListener('input', calculate);
  form.addEventListener('change', calculate);
  form.addEventListener('submit', (e) => e.preventDefault());
  calculate();
})();
