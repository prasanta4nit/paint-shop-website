#!/usr/bin/env node
/**
 * Zero-dependency static site builder.
 *
 *   node build.mjs        → writes the finished website to ./dist
 *
 * - Shop details, offers and reviews come from site.config.json
 * - Pages live in src/pages/*.html with a small front-matter block
 * - Template tags:
 *     {{ key.path }}                       escaped value from the context
 *     {{{ key.path }}}                     raw HTML from the context
 *     {{wa "message"}}                     WhatsApp link with a pre-filled message
 *     {{img "name" "alt" "sizes" "eager"}} responsive <img> from src/assets/img/name-<width>.webp
 */
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist');

const site = JSON.parse(await readFile(path.join(ROOT, 'site.config.json'), 'utf8'));
const colourData = JSON.parse(await readFile(path.join(SRC, 'data', 'colours.json'), 'utf8'));
const layout = await readFile(path.join(SRC, 'layout.html'), 'utf8');
const warnings = [];

// ---------------------------------------------------------------- helpers
const esc = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const siteUrl = site.siteUrl.replace(/\/+$/, '');
const abs = (p) => `${siteUrl}/${p.replace(/^\/+/, '')}`;
const icon = (id, fill = false) => `<svg class="i${fill ? ' i-fill' : ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

const waUrl = (msg) => `https://wa.me/${site.whatsapp}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
// "919213900158" → "+91 92139 00158"
const whatsappDisplay = site.whatsapp.replace(/^91(\d{5})(\d{5})$/, '+91 $1 $2');
const telHref = `tel:${site.phone.replace(/[^\d+]/g, '')}`;
const { lat, lng } = site.geo;
const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${site.google.placeId}`;
const reviewsUrl = `https://search.google.com/local/reviews?placeid=${site.google.placeId}`;
const writeReviewUrl = `https://search.google.com/local/writereview?placeid=${site.google.placeId}`;

const listText = (arr) => arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} & ${arr.at(-1)}`;
const shortBrand = (n) => n.replace(/ Paints$/, '');

// ---------------------------------------------------------------- hours
const DAYS = [
  ['Mo', 'Monday'], ['Tu', 'Tuesday'], ['We', 'Wednesday'], ['Th', 'Thursday'],
  ['Fr', 'Friday'], ['Sa', 'Saturday'], ['Su', 'Sunday'],
];
const fmtTime = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const hoursByDay = Object.fromEntries(DAYS.map(([code]) => [code, site.hours.find((h) => h.days.includes(code)) || null]));
const allSame = DAYS.every(([c]) => hoursByDay[c] && hoursByDay[c] === hoursByDay.Mo);
const hoursSummary = allSame
  ? `Open all 7 days · ${fmtTime(hoursByDay.Mo.opens)} – ${fmtTime(hoursByDay.Mo.closes)}`
  : 'See opening hours';
const hoursTableHtml = `<table class="hours-table"><caption class="visually-hidden">Opening hours</caption><tbody>${DAYS.map(([code, day]) => {
  const h = hoursByDay[code];
  return `<tr data-day="${code}"><th scope="row">${day}</th><td>${h ? `${fmtTime(h.opens)} – ${fmtTime(h.closes)}` : 'Closed'}</td></tr>`;
}).join('')}</tbody></table>`;

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

function imgTag(name, alt, sizes = '100vw', opts = '') {
  const list = images[name];
  if (!list) throw new Error(`Image "${name}" not found in src/assets/img`);
  const big = list.at(-1);
  const eager = opts.includes('eager');
  const srcset = list.map((i) => `${i.file} ${i.w}w`).join(', ');
  return `<img src="${list[0].file}" srcset="${srcset}" sizes="${esc(sizes)}" width="${big.w}" height="${big.h}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}
function preloadTag(name, sizes) {
  const list = images[name];
  return `<link rel="preload" as="image" href="${list[0].file}" imagesrcset="${list.map((i) => `${i.file} ${i.w}w`).join(', ')}" imagesizes="${esc(sizes)}" fetchpriority="high">`;
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

// ---------------------------------------------------------------- navigation
const NAV = [
  { id: 'home', href: 'index.html', label: 'Home' },
  { id: 'products', href: 'products.html', label: 'Brands & Products' },
  { id: 'colours', href: 'colours.html', label: 'Colours' },
  { id: 'solutions', href: 'solutions.html', label: 'Interior & Exterior' },
  { id: 'offers', href: 'offers.html', label: 'Offers' },
  { id: 'contact', href: 'contact.html', label: 'Contact' },
];
const navHtml = (active) => NAV.map((n) =>
  `<li><a href="${n.href}"${n.id === active ? ' aria-current="page"' : ''}>${n.label}</a></li>`).join('\n          ');

// ---------------------------------------------------------------- data-driven chunks
const today = new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

function offerCard(o) {
  const msg = `Hello! I'd like to know more about your offer: "${o.title}".`;
  const valid = o.validTill
    ? `<p class="valid">${icon('clock')}Valid till ${fmtDate(o.validTill)}</p>`
    : `<p class="valid">${icon('check')}Ongoing offer</p>`;
  return `<article class="card offer-card reveal" style="--c:${esc(o.colour || '#f4b400')}"${o.validTill ? ` data-valid-till="${esc(o.validTill)}"` : ''}>
      <span class="tag">${esc(o.tag)}</span>
      <h3>${esc(o.title)}</h3>
      <p>${esc(o.text)}</p>
      ${valid}
      <a class="btn btn--wa btn--sm" href="${esc(waUrl(msg))}" target="_blank" rel="noopener">${icon('wa', true)}Ask about this offer</a>
    </article>`;
}
const activeOffers = site.offers.filter((o) => !o.validTill || o.validTill >= today);
const offersHtml = site.offers.map(offerCard).join('\n    ');
const offersTeaserHtml = activeOffers.slice(0, 3).map(offerCard).join('\n    ');

const stars = (n) => `<span class="stars-row" aria-label="${n} out of 5 stars">${Array.from({ length: 5 }, (_, i) =>
  `<svg class="i i-fill" aria-hidden="true" style="${i < n ? '' : 'opacity:.25'}"><use href="#i-star"/></svg>`).join('')}</span>`;
const reviewsHtml = site.reviews.map((r) => `<figure class="card review-card reveal">
      <svg class="quote-mark i-fill" aria-hidden="true"><use href="#i-quote"/></svg>
      ${stars(r.rating)}
      <blockquote><p>${esc(r.text)}</p></blockquote>
      <footer>
        <span class="review-avatar" aria-hidden="true">${icon('star', true)}</span>
        <span><strong>${r.author ? esc(r.author) : 'Customer review'}</strong>${esc(r.note ? `${r.source} · ${r.note}` : `Posted on ${r.source}`)}</span>
      </footer>
    </figure>`).join('\n    ');

const brandCard = (b) => `<article class="card brand-card reveal" style="--c:${esc(b.colour)}">
        <span class="wordmark">${esc(b.name)}</span>
        <p>${esc(b.note)}</p>
        <a class="link-arrow" href="${esc(waUrl(`Hello! Do you have ${b.name} products in stock? I'm looking for: `))}" target="_blank" rel="noopener">Ask about ${esc(shortBrand(b.name))} ${icon('arrow')}</a>
      </article>`;
const brandCardsHtml = [...site.paintBrands, ...site.sanitaryBrands].map(brandCard).join('\n      ');
const brandStripHtml = [...site.paintBrands, ...site.sanitaryBrands]
  .map((b) => `<span class="wordmark" style="--wm:${esc(b.colour)}">${esc(b.name)}</span>`).join('\n        ');

// Colour catalogue (rendered into HTML so names are crawlable; colours.js adds interactivity)
const familyLabel = Object.fromEntries(colourData.families.map((f) => [f.id, f.label]));
const familyFirstHex = Object.fromEntries(colourData.families.map((f) => [f.id, colourData.colours.find((c) => c.family === f.id)?.hex]));
const colourTile = (c) => `<button type="button" class="colour-tile" id="c-${slug(c.name)}" data-name="${esc(c.name)}" data-hex="${c.hex}" data-family="${c.family}" style="--c:${c.hex}">
            <span class="chipcolour"></span>
            <span class="meta"><strong>${esc(c.name)}</strong><code>${c.hex}</code></span>
            <span class="saved-flag" aria-hidden="true"><svg class="i"><use href="#i-heart"/></svg></span>
          </button>`;
const colourCatalogueHtml = colourData.families.map((f) => {
  const list = colourData.colours.filter((c) => c.family === f.id);
  return `<section class="colour-family" data-family-section="${f.id}" aria-labelledby="fam-${f.id}">
        <h2 id="fam-${f.id}">${esc(f.label)} <small>${list.length} shades</small></h2>
        <div class="colour-grid">
          ${list.map(colourTile).join('\n          ')}
        </div>
      </section>`;
}).join('\n      ');
const familyFiltersHtml = [
  `<button type="button" class="filter-btn" data-filter="all" aria-pressed="true">All colours</button>`,
  ...colourData.families.map((f) => `<button type="button" class="filter-btn" data-filter="${f.id}" aria-pressed="false" style="--c:${familyFirstHex[f.id]}"><i></i>${esc(f.label)}</button>`),
].join('\n            ');
const featuredSwatchesHtml = colourData.featured.map((name) => {
  const c = colourData.colours.find((x) => x.name === name);
  if (!c) throw new Error(`Featured colour "${name}" missing from colours.json`);
  return `<a class="swatch-card reveal" href="colours.html#c-${slug(c.name)}" style="--c:${c.hex}">
          <span class="chipcolour"></span>
          <span class="meta"><strong>${esc(c.name)}</strong><span>${esc(familyLabel[c.family])}</span></span>
        </a>`;
}).join('\n        ');

const socialFooterHtml = Object.entries(site.social).filter(([, url]) => url)
  .map(([k, url]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener">${k[0].toUpperCase() + k.slice(1)}</a></li>`).join('');
const emailFooterHtml = site.email ? `<li><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></li>` : '';

// ---------------------------------------------------------------- structured data
const a = site.address;
const businessLd = {
  '@context': 'https://schema.org',
  '@type': 'HardwareStore',
  '@id': `${siteUrl}/#business`,
  name: site.name,
  alternateName: site.fullName,
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
    dayOfWeek: h.days.map((d) => DAYS.find(([c]) => c === d)[1]),
    opens: h.opens,
    closes: h.closes,
  })),
  areaServed: site.areaServed.map((name) => ({ '@type': 'Place', name })),
  sameAs: [site.google.mapsUrl, ...Object.values(site.social).filter(Boolean)],
};
const websiteLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: site.name,
  url: `${siteUrl}/`,
  inLanguage: 'en-IN',
  publisher: { '@id': `${siteUrl}/#business` },
};
const breadcrumbLd = (label, file) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
    { '@type': 'ListItem', position: 2, name: label, item: abs(file) },
  ],
});
const ldScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

// ---------------------------------------------------------------- template engine
// One pass, so inserted HTML is never re-scanned for tags.
const TAG = /\{\{img\s+"([^"]+)"\s+"([^"]*)"(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?\s*\}\}|\{\{wa\s+"([^"]*)"\s*\}\}|\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g;
function render(tpl, ctx) {
  return tpl.replace(TAG, (_, imgName, alt, sizes, opts, waMsg, raw, key) => {
    if (imgName) return imgTag(imgName, alt, sizes, opts);
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

// ---------------------------------------------------------------- build
const baseCtx = {
  ...site,
  siteUrl,
  telHref,
  whatsappDisplay,
  waHref: waUrl(`Hello! I have an enquiry about paints / colours.`),
  directionsUrl,
  reviewsUrl,
  writeReviewUrl,
  mapEmbedUrl: site.google.mapEmbedUrl,
  ratingText: Number(site.google.rating).toFixed(1),
  reviewCount: site.google.reviewCount,
  reviewCountText: `${site.google.reviewCount} Google review${site.google.reviewCount === 1 ? '' : 's'}`,
  addressLines: `${a.street === a.locality ? a.locality : `${a.street}, ${a.locality}`}, ${a.district} district, ${a.region} ${a.postalCode}`,
  addressShort: `${a.locality}, ${a.district}, ${a.region}`,
  areaServedText: listText(site.areaServed),
  paintBrandText: listText(site.paintBrands.map((b) => b.name)),
  hoursSummary,
  hoursTableHtml,
  hoursJson: JSON.stringify(site.hours),
  year: new Date().getFullYear(),
  ogImage: abs('assets/img/og-image.jpg'),
  assets: { ...assets },
  offersHtml,
  offersTeaserHtml,
  reviewsHtml,
  brandCardsHtml,
  brandStripHtml,
  colourCatalogueHtml,
  familyFiltersHtml,
  featuredSwatchesHtml,
  colourCount: colourData.colours.length,
  socialFooterHtml,
  emailFooterHtml,
  footerNavHtml: NAV.map((n) => `<li><a href="${n.href}">${n.label}</a></li>`).join('\n          '),
};

// Empty dist/ rather than deleting it – Windows refuses to remove a folder that a shell or server has open.
await mkdir(OUT, { recursive: true });
for (const entry of await readdir(OUT)) await rm(path.join(OUT, entry), { recursive: true, force: true });
await cp(path.join(SRC, 'assets'), path.join(OUT, 'assets'), { recursive: true });
await cp(path.join(SRC, 'static'), OUT, { recursive: true });

const sitemap = [];
for (const file of (await readdir(path.join(SRC, 'pages'))).filter((f) => f.endsWith('.html'))) {
  const { meta, body } = parsePage(await readFile(path.join(SRC, 'pages', file), 'utf8'));
  const isHome = file === 'index.html';
  const isError = file === '404.html';
  const canonical = isHome ? `${siteUrl}/` : abs(file);

  const ld = [];
  const schema = (meta.schema || '').split(',').map((s) => s.trim());
  if (schema.includes('business')) ld.push(businessLd);
  if (schema.includes('website')) ld.push(websiteLd);
  if (!isHome && !isError) ld.push(breadcrumbLd(meta.crumb || meta.title, file));

  let preloadHtml = '';
  if (meta.preload) {
    const [name, sizes] = meta.preload.split('|').map((s) => s.trim());
    preloadHtml = preloadTag(name, sizes);
  }
  const scriptsHtml = (meta.scripts || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => `<script src="${assets[s]}" defer></script>`).join('\n  ');

  const ctx = { ...baseCtx, navHtml: navHtml(meta.nav) };
  ctx.page = {
    title: render(meta.title, ctx),
    description: render(meta.description, ctx),
    crumb: meta.crumb || '',
    canonical,
    robots: isError ? 'noindex, follow' : 'index, follow, max-image-preview:large',
    // The 404 page is served at any URL, so its relative links need an absolute base.
    baseHtml: isError ? `<base href="${siteUrl}/">` : '',
    jsonLd: ld.map(ldScript).join('\n  '),
    preloadHtml,
    scriptsHtml,
  };
  ctx.content = render(body, ctx);
  await writeFile(path.join(OUT, file), render(layout, ctx));

  if (!isError) sitemap.push({ loc: canonical, priority: isHome ? '1.0' : '0.8' });
  console.log(`  ✓ ${file}`);
}

await writeFile(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`);
await writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
console.log('  ✓ sitemap.xml, robots.txt');

// ---------------------------------------------------------------- pre-launch checks
if (/example\.com/.test(siteUrl)) warnings.push('siteUrl in site.config.json is still https://www.example.com – set it to your real domain so canonical links, the sitemap and social previews are correct.');
const samples = site.offers.filter((o) => o.sample);
if (samples.length) warnings.push(`${samples.length} offer(s) in site.config.json are marked "sample": true – replace them with your real offers (then delete the "sample" flag) before going live.`);
const expired = site.offers.filter((o) => o.validTill && o.validTill < today);
if (expired.length) warnings.push(`${expired.length} offer(s) have expired and are hidden on the site: ${expired.map((o) => o.title).join(', ')}`);

console.log(`\nBuilt ${sitemap.length + 1} pages into ./dist`);
if (warnings.length) console.log(`\n⚠  Before publishing:\n${warnings.map((w) => `   • ${w}`).join('\n')}\n`);
