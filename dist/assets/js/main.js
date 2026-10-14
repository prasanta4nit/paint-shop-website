/* Aahana Enterprises – site-wide behaviour (no dependencies) */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // Interface text for the page's language, injected by the build (src/i18n/<lang>.json → "js").
  const S = window.SITE_STRINGS;
  const tpl = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  window.siteStrings = { S, tpl };

  /* ---------- Toast ---------- */
  const toastEl = $('.toast');
  let toastTimer;
  window.siteToast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2200);
  };

  /* ---------- Mobile navigation ---------- */
  const toggle = $('.nav-toggle');
  const nav = $('#site-nav');
  const setNav = (open) => {
    if (!toggle || !nav) return;
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? S.closeMenu : S.openMenu);
    toggle.querySelector('use').setAttribute('href', open ? '#i-x' : '#i-menu');
  };
  toggle?.addEventListener('click', () => setNav(toggle.getAttribute('aria-expanded') !== 'true'));
  nav?.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });
  matchMedia("(min-width: 1181px)").addEventListener?.('change', (e) => { if (e.matches) setNav(false); });

  /* ---------- Header shadow on scroll ---------- */
  const header = $('.site-header');
  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Open / closed status (shop time = India Standard Time) ---------- */
  const DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const WEEKDAY_TO_CODE = { Mon: 'Mo', Tue: 'Tu', Wed: 'We', Thu: 'Th', Fri: 'Fr', Sat: 'Sa', Sun: 'Su' };
  const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  // Same format as the build: "8:00 PM" in English, "रात 8:00" in Hindi.
  const fmt = (t) => {
    const [h, m] = t.split(':').map(Number);
    const clock = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
    if (S.lang === 'hi') return `${h < 4 ? 'रात' : h < 12 ? 'सुबह' : h < 16 ? 'दोपहर' : h < 19 ? 'शाम' : 'रात'} ${clock}`;
    return `${clock} ${h < 12 ? 'AM' : 'PM'}`;
  };

  function shopNow() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return {
      day: WEEKDAY_TO_CODE[p.weekday],
      minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
      date: `${p.year}-${p.month}-${p.day}`,
    };
  }

  let hours = [];
  try { hours = JSON.parse(document.body.dataset.hours || '[]'); } catch { /* keep static text */ }
  const hoursFor = (code) => hours.find((h) => h.days.includes(code));

  if (hours.length) {
    const now = shopNow();
    const today = hoursFor(now.day);
    let open = false;
    let text;
    if (today && now.minutes >= toMinutes(today.opens) && now.minutes < toMinutes(today.closes)) {
      open = true;
      text = tpl(S.openNow, { time: fmt(today.closes) });
    } else if (today && now.minutes < toMinutes(today.opens)) {
      text = tpl(S.opensToday, { time: fmt(today.opens) });
    } else {
      const idx = DAY_CODES.indexOf(now.day);
      for (let i = 1; i <= 7; i++) {
        const code = DAY_CODES[(idx + i) % 7];
        const h = hoursFor(code);
        if (h) {
          text = i === 1 ? tpl(S.opensTomorrow, { time: fmt(h.opens) }) : tpl(S.opensDay, { day: S.days[code], time: fmt(h.opens) });
          break;
        }
      }
    }
    $$('[data-open-status]').forEach((el) => {
      el.classList.add(open ? 'is-open' : 'is-closed');
      const t = $('[data-open-text]', el);
      if (t && text) t.textContent = text;
    });
    $$(`.hours-table tr[data-day="${now.day}"]`).forEach((tr) => tr.classList.add('is-today'));

    /* ---------- Hide offers that have expired ---------- */
    $$('[data-valid-till]').forEach((card) => {
      if (card.dataset.validTill < now.date) card.classList.add('is-expired');
    });
    $$('[data-offers]').forEach((grid) => {
      const visible = $$('.offer-card', grid).some((c) => !c.classList.contains('is-expired'));
      if (!visible) $('[data-offers-empty]')?.classList.add('is-visible');
    });
  }

  /* ---------- Reveal on scroll ---------- */
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el, i) => {
      el.style.transitionDelay = `${(i % 3) * 70}ms`;
      io.observe(el);
    });
  } else {
    reveals.forEach((el) => el.classList.add('is-in'));
  }

  /* ---------- Enquiry form → WhatsApp ---------- */
  const form = $('#enquiry-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const lines = [
      S.enqIntro,
      `${S.enqName}: ${data.get('name').trim()}`,
      data.get('place').trim() && `${S.enqArea}: ${data.get('place').trim()}`,
      `${S.enqNeed}: ${data.get('need')}`,
      data.get('message').trim() && `${S.enqDetails}: ${data.get('message').trim()}`,
    ].filter(Boolean);
    const url = `https://wa.me/${form.dataset.waNumber}?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank', 'noopener');
  });
})();
