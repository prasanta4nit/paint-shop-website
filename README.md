# Aahana Enterprises – website

A fast, mobile-friendly website for **Aahana Enterprises – Premium Paints & Sanitary Solutions**, Baramasya, Bokaro (Jharkhand 828134).

Plain HTML, CSS and a little vanilla JavaScript. There are no frameworks and nothing to `npm install`: a small Node script assembles the pages into `dist/`, which you upload to any static host.

## Pages

| Page | File | What's on it |
|---|---|---|
| Home | `index.html` | Hero, brands, product categories, featured colours, interior/exterior, store photos, offers, Google reviews, map, FAQ |
| Brands & Products | `products.html` | Berger, Asian Paints, Birla Opus, Astral Pipes, Benson; 8 product categories, each with a WhatsApp enquiry |
| Colour Catalogue | `colours.html` | 87 shades with search and family filters, a room preview (full or accent wall), pairing suggestions, a saved palette you can send on WhatsApp |
| Interior & Exterior | `solutions.html` | Room-by-room advice, exterior and waterproofing, a 4-step process, **paint quantity calculator** |
| Offers | `offers.html` | Offer cards driven by `site.config.json`; expired offers hide themselves |
| Contact | `contact.html` | Call / WhatsApp / directions, Google Map, opening hours with today highlighted, enquiry form that opens WhatsApp |

On every page:
- a floating WhatsApp button (on phones, a Call · WhatsApp · Directions bar instead)
- a live "Open now · closes 8:00 PM" status, calculated in India time
- a **हिंदी / English** switch

## English and Hindi

Every page exists in both languages. English is at the site root (`/products.html`) and Hindi under `/hi/` (`/hi/products.html`). The header switch jumps to the same page in the other language.

Each page tells Google about its other-language version (`hreflang` links, and pairs in `sitemap.xml`), so Hindi searches like "बरमस्य पेंट की दुकान" can show the Hindi page. The Hindi pages load Devanagari fonts (Mukta and Noto Serif Devanagari); English pages don't download them.

WhatsApp messages from the Hindi pages arrive in Hindi. That includes the calculator estimate, the colour enquiries and the enquiry form.

| What to change | English | Hindi |
|---|---|---|
| Page text | `src/pages/*.html` | `src/pages/hi/*.html` |
| Menu, footer, buttons, hours, calculator and colour-tool messages | `src/i18n/en.json` | `src/i18n/hi.json` |
| Shop name, address, description | top-level fields in `site.config.json` | the `"hi"` block in `site.config.json` |
| Offers, reviews, brand notes | each item's fields | each item's `"hi": { ... }` |
| Colour names | `"name"` in `src/data/colours.json` | `"hi"` on the same colour |

Spellings for the Hindi name and address (आहना एंटरप्राइजेज, बरमस्य, बोकारो, चंदनकियारी, झारखंड) are taken from Google Maps' Hindi listing. The second Google review uses the customer's original Hindi words.

**Adding a page:** create it in both `src/pages/` and `src/pages/hi/` with the same file name. If the Hindi version is missing, the build warns you and the language switch falls back to the Hindi home page.

**When adding an offer,** remember its `"hi"` block. Without one, the Hindi page shows the English text.

## Quick start

```bash
node build.mjs      # builds the site into ./dist
node serve.mjs      # preview at http://localhost:8080
```

Requires Node 18 or newer. `npm run build` and `npm start` do the same.

## Before you publish

The build prints a reminder for each of these until it is done.

1. **Set your domain.** Change `siteUrl` in `site.config.json` from `https://www.example.com` to your real address. Canonical links, the sitemap, social previews and structured data all use it.
2. **Replace the sample offers.** The four offers in `site.config.json` are examples I wrote. Replace them with your real offers and delete `"sample": true`.
3. **Check these details**, which I inferred and couldn't confirm:
   - **Product ranges** listed on `products.html`, such as Royale, Silk Glamor, WeatherCoat and Luxol. Remove anything you don't stock.
   - **"1000s of shades"** in the hero. This assumes in-store tinting; the pink machine in the shop photos looks like a Birla Opus tinting machine.
   - **Pipe types.** Astral CPVC/UPVC pipes are assumed; SWR/Drainmaster is visible in the photos.

## Editing content

Almost everything you will change is in **`site.config.json`**:

| Field | Used for |
|---|---|
| `name`, `fullName`, `phone`, `whatsapp`, `email` | Header, footer, buttons, structured data (`email` is hidden when empty) |
| `address`, `geo`, `areaServed` | Footer, contact page, map, local SEO data |
| `google.placeId`, `mapsUrl`, `mapEmbedUrl` | Directions, "Write a review" and the embedded map |
| `google.rating`, `google.reviewCount` | Rating badge. Update these as new reviews arrive. |
| `hours` | Opening-hours table, open/closed status, structured data |
| `social` | Facebook, Instagram or YouTube links; they appear in the footer once filled in |
| `paintBrands`, `sanitaryBrands` | Brand strip and brand cards |
| `offers` | Offer cards. `validTill` (YYYY-MM-DD) hides the offer automatically after that date. |
| `reviews` | Review cards. Copy real reviews from Google; never invent them. |

Other things you can edit:

- **Colours:** `src/data/colours.json`. Add `{ "name": "...", "hex": "#RRGGBB", "family": "blues" }`. The `featured` list controls the eight swatches on the homepage.
- **Page text:** `src/pages/*.html`. The block at the top of each page sets its title and description for Google.
- **Shared header and footer:** `src/layout.html`.
- **Styles:** `src/assets/css/styles.css`. Colours are CSS variables at the top of the file.
- **Images:** put WebP files in `src/assets/img/` named `name-<width>.webp`, for example `shop-inside-640.webp` and `shop-inside-1200.webp`. Use them in a page with `{{img "shop-inside" "Alt text" "(max-width: 640px) 100vw, 50vw"}}`. The build creates the responsive `srcset`.

After any change, run `node build.mjs` again and upload the new `dist/`.

## Deploying

### Vercel (set up)

`vercel.json` already tells Vercel to run `node build.mjs` and serve `dist/`. It also adds caching and security headers. While `siteUrl` is still the placeholder, builds on Vercel use the project's production domain automatically.

```bash
npx vercel login          # once – opens the browser to sign in
npx vercel --prod         # build on Vercel and publish to production
```

The first `npx vercel --prod` asks a few setup questions. Accept the defaults, but name the project something like `aahana-enterprises` so the address becomes `aahana-enterprises.vercel.app` (if that name is free).

To redeploy after changing `site.config.json` or the pages, run `npx vercel --prod` again.

**Custom domain:** in Vercel go to Project → Settings → Domains. Once it's added, set `siteUrl` in `site.config.json` to it and redeploy.

Alternatively, push the folder to GitHub and use **Import Project** on vercel.com. It picks up `vercel.json`, and every push redeploys.

### Other hosts

Upload the **contents of `dist/`**:

- **Netlify:** drag the `dist` folder onto app.netlify.com/drop.
- **Cloudflare Pages:** build command `node build.mjs`, output directory `dist`.
- **GitHub Pages / shared hosting:** copy `dist/` to the web root.

Links are relative, so the site also works from a sub-folder. `404.html` is picked up automatically by Netlify, Cloudflare Pages and GitHub Pages.

## Local SEO: already built in

- Page titles and descriptions target "paint shop" + Baramasya / Bokaro / Jharkhand.
- `HardwareStore` (LocalBusiness) structured data: address, map coordinates, opening hours, phone, area served, Google Maps link.
- Breadcrumb and WebSite structured data, `sitemap.xml`, `robots.txt`, canonical URLs, Open Graph image (the storefront photo).
- The same name, address and phone (NAP) on every page, matching the Google Business Profile.
- Crawlable colour and product names; fast loading through WebP images, lazy loading and no frameworks.

### Do these off-site; they matter more than the website

1. **Google Business Profile:** add the website URL, and check the hours and phone match the site.
   - Add the extra category "Plumbing supply store" alongside "Paint store".
   - Upload new photos regularly.
   - Post your offers as Google Posts.
2. **Ask happy customers for reviews.** Share the review link (it's on the site footer and contact page):
   `https://search.google.com/local/writereview?placeid=ChIJsx_vP0yD9jkRAtibM_2DcaQ`
3. **Google Search Console:** verify the domain and submit `https://<your-domain>/sitemap.xml`.
4. **Bing Places**, plus **JustDial / IndiaMART** listings, using exactly the same name, address and phone.

## Credits

- **Shop photos:** from the business's own Google Business Profile.
- **Room, house and paint photos:** [Unsplash](https://unsplash.com) (Unsplash License, free for commercial use).
- **Icons:** [Lucide](https://lucide.dev) (ISC licence); WhatsApp glyph from [Simple Icons](https://simpleicons.org) (CC0).
- **Fonts:** Fraunces and Plus Jakarta Sans from Google Fonts (OFL).
- **Trademarks:** brand names belong to their owners; no brand logos are used.

## Project structure

```
site.config.json     ← shop details, offers, reviews (edit this most)
build.mjs            ← builds dist/ (no dependencies)
serve.mjs            ← local preview server
vercel.json          ← Vercel build settings and headers
src/
  layout.html        ← shared <head>, header, footer
  pages/*.html       ← English pages
  pages/hi/*.html    ← Hindi pages (same file names)
  i18n/en.json, hi.json ← menu, footer, buttons and script messages per language
  data/colours.json  ← colour catalogue (English + Hindi names)
  assets/css, js, img
  static/            ← favicon.ico, site.webmanifest (copied to the site root)
dist/                ← generated website: upload this
```
