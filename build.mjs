#!/usr/bin/env node
/**
 * Zero-dependency static site builder.
 *
 *   node build.mjs        → writes the finished website to ./dist
 *
 * - Shop details, offers and reviews come from site.config.json
 *   (a "hi" block, on the root or on any offer/review/brand, holds the Hindi text)
 * - English pages live in src/pages/*.html, Hindi pages in src/pages/hi/*.html → dist/hi/
 * - Shared interface text lives in src/i18n/<lang>.json
 * - Template tags:
 *     {{ key.path }}                       escaped value from the context
 *     {{{ key.path }}}                     raw HTML from the context
 *     {{wa "message"}}                     WhatsApp link with a pre-filled message
 *     {{img "name" "alt" "sizes" "eager"}} responsive <img> from src/assets/img/name-<width>.webp
 */
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist');

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const site = await readJson(path.join(ROOT, 'site.config.json'));
const colourData = await readJson(path.join(SRC, 'data', 'colours.json'));
const layout = await readFile(path.join(SRC, 'layout.html'), 'utf8');
const warnings = [];

const LANGS = ['en', 'hi'];
const DEFAULT_LANG = 'en';
const strings = Object.fromEntries(await Promise.all(LANGS.map(async (l) => [l, await readJson(path.join(SRC, 'i18n', `${l}.json`))])));

// ---------------------------------------------------------------- helpers
const esc = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const fmt = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
// While siteUrl is still the placeholder, builds on Vercel use the project's production domain
// (your custom domain once added, otherwise <project>.vercel.app).
const isPlaceholderUrl = /example\.com/.test(site.siteUrl);
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const siteUrl = (isPlaceholderUrl && vercelUrl ? `https://${vercelUrl}` : site.siteUrl).replace(/\/+$/, '');
const abs = (p) => `${siteUrl}/${p.replace(/^\/+/, '')}`;
const icon = (id, fill = false) => `<svg class="i${fill ? ' i-fill' : ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

const waUrl = (msg) => `https://wa.me/${site.whatsapp}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
// "918826654761" → "+91 88266 54761"
const whatsappDisplay = site.whatsapp.replace(/^91(\d{5})(\d{5})$/, '+91 $1 $2');
const telHref = `tel:${site.phone.replace(/[^\d+]/g, '')}`;
const { lat, lng } = site.geo;
const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${site.google.placeId}`;
const reviewsUrl = `https://search.google.com/local/reviews?placeid=${site.google.placeId}`;
const writeReviewUrl = `https://search.google.com/local/writereview?placeid=${site.google.placeId}`;

const listText = (arr, and) => arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} ${and} ${arr.at(-1)}`;
const shortBrand = (n) => n.replace(/ Paints$/, '');

// Merge an item's translation ("hi": {...}) over its English fields.
const localize = (obj, lang) => (lang !== DEFAULT_LANG && obj[lang] ? { ...obj, ...obj[lang] } : obj);
const siteFor = (lang) => {
  const tr = lang === DEFAULT_LANG ? {} : site[lang] || {};
  return { ...site, ...tr, address: { ...site.address, ...(tr.address || {}) } };
};
const langDir = (lang) => (lang === DEFAULT_LANG ? '' : `${lang}/`);
const pageUrl = (lang, file) => `${siteUrl}/${langDir(lang)}${file === 'index.html' ? '' : file}`;

// ---------------------------------------------------------------- hours
const DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_NAMES_EN = strings.en.days;
const hoursByDay = Object.fromEntries(DAY_CODES.map((code) => [code, site.hours.find((h) => h.days.includes(code)) || null]));
const allSame = DAY_CODES.every((c) => hoursByDay[c] && hoursByDay[c] === hoursByDay.Mo);
function fmtTime(t, lang) {
  const [h, m] = t.split(':').map(Number);
  const clock = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
  if (lang === 'hi') return `${h < 4 ? 'रात' : h < 12 ? 'सुबह' : h < 16 ? 'दोपहर' : h < 19 ? 'शाम' : 'रात'} ${clock}`;
  return `${clock} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------------------------------------------------------------- images
const IMG_DIR = path.join(SRC, 'assets', 'img');
function webpSize(buf) {
  const type = buf.toString('ascii', 12, 16);
  if (type === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (type === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (type === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  throw new Error('Unknown WebP format');
}
const images = {};
for (const file of await readdir(IMG_DIR)) {
  const m = file.match(/^(.+)-(\d+)\.webp$/);
  if (!m) continue;
  const size = webpSize(await readFile(path.join(IMG_DIR, file)));
  (images[m[1]] ||= []).push({ file: `assets/img/${file}`, ...size });
}
for (const list of Object.values(images)) list.sort((a, b) => a.w - b.w);

function imgTag(name, alt, sizes = '100vw', opts = '', root = '') {
  const list = images[name];
  if (!list) throw new Error(`Image "${name}" not found in src/assets/img`);
  const big = list.at(-1);
  const eager = opts.includes('eager');
  const srcset = list.map((i) => `${root}${i.file} ${i.w}w`).join(', ');
  return `<img src="${root}${list[0].file}" srcset="${srcset}" sizes="${esc(sizes)}" width="${big.w}" height="${big.h}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}
function preloadTag(name, sizes, root) {
  const list = images[name];
  return `<link rel="preload" as="image" href="${root}${list[0].file}" imagesrcset="${list.map((i) => `${root}${i.file} ${i.w}w`).join(', ')}" imagesizes="${esc(sizes)}" fetchpriority="high">`;
}

// ---------------------------------------------------------------- asset fingerprints (cache busting)
const fingerprint = async (rel) => {
  const hash = createHash('sha1').update(await readFile(path.join(SRC, rel))).digest('hex').slice(0, 8);
  return `${rel}?v=${hash}`;
};
const assets = {
  css: await fingerprint('assets/css/styles.css'),
  main: await fingerprint('assets/js/main.js'),
  colours: await fingerprint('assets/js/colours.js'),
  calculator: await fingerprint('assets/js/calculator.js'),
};

const FONTS = {
  en: 'family=Fraunces:opsz,wght@9..144,500..700&family=Plus+Jakarta+Sans:wght@400..800',
  hi: 'family=Fraunces:opsz,wght@9..144,500..700&family=Plus+Jakarta+Sans:wght@400..800&family=Mukta:wght@400;500;600;700;800&family=Noto+Serif+Devanagari:wght@500..700',
};

const NAV_IDS = [
  ['home', 'index.html'], ['products', 'products.html'], ['colours', 'colours.html'],
  ['solutions', 'solutions.html'], ['offers', 'offers.html'], ['contact', 'contact.html'],
];

// ---------------------------------------------------------------- structured data (shared by both languages)
const a = site.address;
const businessLd = {
  '@context': 'https://schema.org',
  '@type': 'HardwareStore',
  '@id': `${siteUrl}/#business`,
  name: site.name,
  alternateName: [site.fullName, site.hi?.name].filter(Boolean),
  description: site.description,
  url: `${siteUrl}/`,
  telephone: site.phone.replace(/\s+/g, ''),
  ...(site.email ? { email: site.email } : {}),
  image: [abs('assets/img/og-image.jpg'), abs(images['store-front'].at(-1).file)],
  logo: abs('assets/img/apple-touch-icon.png'),
  priceRange: '₹₹',
  currenciesAccepted: 'INR',
  address: {
    '@type': 'PostalAddress',
    streetAddress: a.street,
    addressLocality: a.locality,
    addressRegion: a.region,
    postalCode: a.postalCode,
    addressCountry: a.country,
  },
  geo: { '@type': 'GeoCoordinates', latitude: lat, longitude: lng },
  hasMap: site.google.mapsUrl,
  openingHoursSpecification: site.hours.map((h) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: h.days.map((d) => DAY_NAMES_EN[d]),
    opens: h.opens,
    closes: h.closes,
  })),
  areaServed: site.areaServed.map((name) => ({ '@type': 'Place', name })),
  sameAs: [site.google.mapsUrl, ...Object.values(site.social).filter(Boolean)],
};
const ldScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

// ---------------------------------------------------------------- template engine
// One pass, so inserted HTML is never re-scanned for tags.
const TAG = /\{\{img\s+"([^"]+)"\s+"([^"]*)"(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?\s*\}\}|\{\{wa\s+"([^"]*)"\s*\}\}|\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g;
function render(tpl, ctx) {
  return tpl.replace(TAG, (_, imgName, alt, sizes, opts, waMsg, raw, key) => {
    if (imgName) return imgTag(imgName, alt, sizes, opts, ctx.root);
    if (waMsg !== undefined) return esc(waUrl(waMsg));
    if (raw) return String(lookup(ctx, raw));
    return esc(lookup(ctx, key));
  });
}
function lookup(ctx, key) {
  const v = get(ctx, key);
  if (v === undefined) throw new Error(`Unknown template key "${key}"`);
  return v;
}
function parsePage(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) throw new Error('Missing front matter');
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

// ---------------------------------------------------------------- per-language context
const today = new Date().toISOString().slice(0, 10);

function langContext(lang) {
  const t = strings[lang];
  const L = siteFor(lang);
  const root = lang === DEFAULT_LANG ? '' : '../';
  const la = L.address;

  const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(t.htmlLang, { day: 'numeric', month: 'long', year: 'numeric' });
  const hoursSummary = allSame
    ? `${t.openAllDays} · ${fmtTime(hoursByDay.Mo.opens, lang)} – ${fmtTime(hoursByDay.Mo.closes, lang)}`
    : t.seeHours;
  const hoursTableHtml = `<table class="hours-table"><caption class="visually-hidden">${esc(t.openingHours)}</caption><tbody>${DAY_CODES.map((code) => {
    const h = hoursByDay[code];
    return `<tr data-day="${code}"><th scope="row">${esc(t.days[code])}</th><td>${h ? `${fmtTime(h.opens, lang)} – ${fmtTime(h.closes, lang)}` : esc(t.closed)}</td></tr>`;
  }).join('')}</tbody></table>`;

  function offerCard(raw) {
    const o = localize(raw, lang);
    const valid = o.validTill
      ? `<p class="valid">${icon('clock')}${esc(fmt(t.validTill, { date: fmtDate(o.validTill) }))}</p>`
      : `<p class="valid">${icon('check')}${esc(t.ongoingOffer)}</p>`;
    return `<article class="card offer-card reveal" style="--c:${esc(o.colour || '#f4b400')}"${o.validTill ? ` data-valid-till="${esc(o.validTill)}"` : ''}>
      <span class="tag">${esc(o.tag)}</span>
      <h3>${esc(o.title)}</h3>
      <p>${esc(o.text)}</p>
      ${valid}
      <a class="btn btn--wa btn--sm" href="${esc(waUrl(fmt(t.offerMsg, { title: o.title })))}" target="_blank" rel="noopener">${icon('wa', true)}${esc(t.askOffer)}</a>
    </article>`;
  }
  const activeOffers = site.offers.filter((o) => !o.validTill || o.validTill >= today);

  const stars = (n) => `<span class="stars-row" aria-label="${esc(fmt(t.starsAria, { n }))}">${Array.from({ length: 5 }, (_, i) =>
    `<svg class="i i-fill" aria-hidden="true" style="${i < n ? '' : 'opacity:.25'}"><use href="#i-star"/></svg>`).join('')}</span>`;
  const reviewsHtml = site.reviews.map((raw) => localize(raw, lang)).map((r) => `<figure class="card review-card reveal">
      <svg class="quote-mark i-fill" aria-hidden="true"><use href="#i-quote"/></svg>
      ${stars(r.rating)}
      <blockquote><p>${esc(r.text)}</p></blockquote>
      <footer>
        <span class="review-avatar" aria-hidden="true">${icon('star', true)}</span>
        <span><strong>${esc(r.author || t.customerReview)}</strong>${esc(r.note ? `${r.source} · ${r.note}` : fmt(t.postedOn, { source: r.source }))}</span>
      </footer>
    </figure>`).join('\n    ');

  const brands = [...site.paintBrands, ...site.sanitaryBrands].map((b) => localize(b, lang));
  const brandCardsHtml = brands.map((b) => `<article class="card brand-card reveal" style="--c:${esc(b.colour)}">
        <span class="wordmark">${esc(b.name)}</span>
        <p>${esc(b.note)}</p>
        <a class="link-arrow" href="${esc(waUrl(fmt(t.brandMsg, { brand: b.name })))}" target="_blank" rel="noopener">${esc(fmt(t.askAboutBrand, { brand: shortBrand(b.name) }))} ${icon('arrow')}</a>
      </article>`).join('\n      ');
  const brandStripHtml = brands
    .map((b) => `<span class="wordmark" style="--wm:${esc(b.colour)}">${esc(b.name)}</span>`).join('\n        ');

  // Colour catalogue (rendered into HTML so names are crawlable; colours.js adds interactivity)
  const label = (c) => (lang === DEFAULT_LANG ? c.name : c[lang] || c.name);
  const familyLabel = Object.fromEntries(colourData.families.map((f) => [f.id, lang === DEFAULT_LANG ? f.label : f[lang] || f.label]));
  const familyFirstHex = Object.fromEntries(colourData.families.map((f) => [f.id, colourData.colours.find((c) => c.family === f.id)?.hex]));
  const colourTile = (c) => `<button type="button" class="colour-tile" id="c-${slug(c.name)}" data-name="${esc(c.name)}" data-label="${esc(label(c))}" data-hex="${c.hex}" data-family="${c.family}" style="--c:${c.hex}">
            <span class="chipcolour"></span>
            <span class="meta"><strong>${esc(label(c))}</strong><code>${c.hex}</code></span>
            <span class="saved-flag" aria-hidden="true"><svg class="i"><use href="#i-heart"/></svg></span>
          </button>`;
  const colourCatalogueHtml = colourData.families.map((f) => {
    const list = colourData.colours.filter((c) => c.family === f.id);
    return `<section class="colour-family" data-family-section="${f.id}" aria-labelledby="fam-${f.id}">
        <h2 id="fam-${f.id}">${esc(familyLabel[f.id])} <small>${esc(fmt(t.shades, { n: list.length }))}</small></h2>
        <div class="colour-grid">
          ${list.map(colourTile).join('\n          ')}
        </div>
      </section>`;
  }).join('\n      ');
  const familyFiltersHtml = [
    `<button type="button" class="filter-btn" data-filter="all" aria-pressed="true">${esc(t.allColours)}</button>`,
    ...colourData.families.map((f) => `<button type="button" class="filter-btn" data-filter="${f.id}" aria-pressed="false" style="--c:${familyFirstHex[f.id]}"><i></i>${esc(familyLabel[f.id])}</button>`),
  ].join('\n            ');
  const featuredSwatchesHtml = colourData.featured.map((name) => {
    const c = colourData.colours.find((x) => x.name === name);
    if (!c) throw new Error(`Featured colour "${name}" missing from colours.json`);
    return `<a class="swatch-card reveal" href="colours.html#c-${slug(c.name)}" style="--c:${c.hex}">
          <span class="chipcolour"></span>
          <span class="meta"><strong>${esc(label(c))}</strong><span>${esc(familyLabel[c.family])}</span></span>
        </a>`;
  }).join('\n        ');

  const n = site.google.reviewCount;
  const ctx = {
    ...L,
    lang,
    root,
    siteUrl,
    telHref,
    whatsappDisplay,
    waHref: waUrl(t.waDefault),
    directionsUrl,
    reviewsUrl,
    writeReviewUrl,
    mapEmbedUrl: site.google.mapEmbedUrl,
    ratingText: Number(site.google.rating).toFixed(1),
    reviewCount: n,
    reviewCountText: fmt(n === 1 ? t.reviewCountOne : t.reviewCount, { n }),
    addressLines: fmt(t.addressFormat, la),
    addressShort: `${la.locality}, ${la.district}, ${la.region}`,
    areaServedText: listText(L.areaServed, t.and),
    paintBrandText: listText(site.paintBrands.map((b) => b.name), t.and),
    hoursSummary,
    hoursTableHtml,
    hoursJson: JSON.stringify(site.hours),
    year: new Date().getFullYear(),
    ogImage: abs('assets/img/og-image.jpg'),
    assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, root + v])),
    fontsHtml: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${FONTS[lang]}&display=swap">`,
    jsStrings: JSON.stringify({ ...t.js, days: t.days }).replace(/</g, '\\u003c'),
    offersHtml: site.offers.map(offerCard).join('\n    '),
    offersTeaserHtml: activeOffers.slice(0, 3).map(offerCard).join('\n    '),
    reviewsHtml,
    brandCardsHtml,
    brandStripHtml,
    colourCatalogueHtml,
    familyFiltersHtml,
    featuredSwatchesHtml,
    colourCount: colourData.colours.length,
    socialFooterHtml: Object.entries(site.social).filter(([, url]) => url)
      .map(([k, url]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener">${k[0].toUpperCase() + k.slice(1)}</a></li>`).join(''),
    emailFooterHtml: site.email ? `<li><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></li>` : '',
    footerNavHtml: NAV_IDS.map(([id, href]) => `<li><a href="${href}">${esc(t.nav[id])}</a></li>`).join('\n          '),
  };
  // Interface strings may contain template tags ({{ phone }} etc.) – resolve them once per language.
  ctx.t = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'string' ? render(v, ctx) : v]));
  return ctx;
}

// ---------------------------------------------------------------- build
// Empty dist/ rather than deleting it – Windows refuses to remove a folder that a shell or server has open.
await mkdir(OUT, { recursive: true });
for (const entry of await readdir(OUT)) await rm(path.join(OUT, entry), { recursive: true, force: true });
await cp(path.join(SRC, 'assets'), path.join(OUT, 'assets'), { recursive: true });
await cp(path.join(SRC, 'static'), OUT, { recursive: true });

const pagesDir = (lang) => path.join(SRC, 'pages', langDir(lang));
const pageFiles = Object.fromEntries(await Promise.all(LANGS.map(async (l) =>
  [l, existsSync(pagesDir(l)) ? (await readdir(pagesDir(l))).filter((f) => f.endsWith('.html')) : []])));

const sitemap = [];
let pageCount = 0;
for (const lang of LANGS) {
  const base = langContext(lang);
  const t = base.t;
  const other = LANGS.find((l) => l !== lang);
  await mkdir(path.join(OUT, langDir(lang)), { recursive: true });

  for (const file of pageFiles[lang]) {
    const { meta, body } = parsePage(await readFile(path.join(pagesDir(lang), file), 'utf8'));
    const isHome = file === 'index.html';
    const isError = file === '404.html';
    const canonical = pageUrl(lang, file);
    const langs = LANGS.filter((l) => pageFiles[l].includes(file));

    const ld = [];
    const schema = (meta.schema || '').split(',').map((s) => s.trim());
    if (schema.includes('business')) ld.push(businessLd);
    if (schema.includes('website')) ld.push({
      '@context': 'https://schema.org', '@type': 'WebSite', name: base.name, url: pageUrl(lang, 'index.html'),
      inLanguage: t.htmlLang, publisher: { '@id': `${siteUrl}/#business` },
    });
    if (!isHome && !isError) ld.push({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t.breadcrumbHome, item: pageUrl(lang, 'index.html') },
        { '@type': 'ListItem', position: 2, name: meta.crumb || meta.title, item: canonical },
      ],
    });

    // Language switcher: same page in the other language, or its home page if there's no translation yet.
    const target = pageFiles[other].includes(file) ? file : 'index.html';
    const langSwitchHref = lang === DEFAULT_LANG ? `${langDir(other)}${target}` : `${other === DEFAULT_LANG ? '../' : `../${langDir(other)}`}${target}`;
    const alternatesHtml = isError ? '' : [
      ...langs.map((l) => `<link rel="alternate" hreflang="${strings[l].htmlLang}" href="${pageUrl(l, file)}">`),
      `<link rel="alternate" hreflang="x-default" href="${pageUrl(DEFAULT_LANG, langs.includes(DEFAULT_LANG) ? file : 'index.html')}">`,
    ].join('\n  ');

    let preloadHtml = '';
    if (meta.preload) {
      const [name, sizes] = meta.preload.split('|').map((s) => s.trim());
      preloadHtml = preloadTag(name, sizes, base.root);
    }
    const scriptsHtml = (meta.scripts || '').split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => `<script src="${base.assets[s]}" defer></script>`).join('\n  ');

    const ctx = {
      ...base,
      navHtml: NAV_IDS.map(([id, href]) =>
        `<li><a href="${href}"${id === meta.nav ? ' aria-current="page"' : ''}>${esc(t.nav[id])}</a></li>`).join('\n          '),
      langSwitchHref,
      otherLang: other,
      ogLocaleAlt: strings[other].ogLocale,
    };
    ctx.page = {
      title: render(meta.title, ctx),
      description: render(meta.description, ctx),
      crumb: meta.crumb || '',
      canonical,
      robots: isError ? 'noindex, follow' : 'index, follow, max-image-preview:large',
      // The 404 page is served at any URL, so its relative links need an absolute base.
      baseHtml: isError ? `<base href="${siteUrl}/">` : '',
      alternatesHtml,
      jsonLd: ld.map(ldScript).join('\n  '),
      preloadHtml,
      scriptsHtml,
    };
    ctx.content = render(body, ctx);
    await writeFile(path.join(OUT, langDir(lang), file), render(layout, ctx));
    pageCount++;

    if (!isError) sitemap.push({ loc: canonical, priority: isHome ? '1.0' : '0.8', alternates: langs.map((l) => [strings[l].htmlLang, pageUrl(l, file)]) });
    console.log(`  ✓ ${langDir(lang)}${file}`);
  }
}

// Pages that exist in English but not yet in another language
for (const lang of LANGS.filter((l) => l !== DEFAULT_LANG)) {
  const untranslated = pageFiles[DEFAULT_LANG].filter((f) => f !== '404.html' && !pageFiles[lang].includes(f));
  if (untranslated.length) warnings.push(`No ${lang} version yet for: ${untranslated.join(', ')} (add them to src/pages/${lang}/).`);
}

await writeFile(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemap.map((u) => `  <url>
    <loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.priority}</priority>
${u.alternates.map(([hl, href]) => `    <xhtml:link rel="alternate" hreflang="${hl}" href="${href}"/>`).join('\n')}
  </url>`).join('\n')}
</urlset>
`);
await writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
console.log('  ✓ sitemap.xml, robots.txt');

// ---------------------------------------------------------------- pre-launch checks
if (/example\.com/.test(siteUrl)) warnings.push('siteUrl in site.config.json is still https://www.example.com – set it to your real domain so canonical links, the sitemap and social previews are correct (builds on Vercel fill this in automatically).');
const samples = site.offers.filter((o) => o.sample);
if (samples.length) warnings.push(`${samples.length} offer(s) in site.config.json are marked "sample": true – replace them with your real offers (then delete the "sample" flag) before going live.`);
const expired = site.offers.filter((o) => o.validTill && o.validTill < today);
if (expired.length) warnings.push(`${expired.length} offer(s) have expired and are hidden on the site: ${expired.map((o) => o.title).join(', ')}`);

console.log(`\nBuilt ${pageCount} pages into ./dist`);
if (warnings.length) console.log(`\n⚠  Before publishing:\n${warnings.map((w) => `   • ${w}`).join('\n')}\n`);
