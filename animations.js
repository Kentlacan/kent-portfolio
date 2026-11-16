/* Page animations for kentsc-portfolio (GSAP + ScrollTrigger). */
(function () {
  var root = document.documentElement;
  function reveal() { root.classList.add('anim-ready'); }

  if (!window.gsap || !window.ScrollTrigger) { reveal(); return; }
  gsap.registerPlugin(ScrollTrigger);

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var EASE = 'power3.out';

  // Wrap each <br>-separated line of a heading in a mask so it can slide up.
  function splitLines(el) {
    if (!el || el.dataset.split) return [];
    var parts = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = parts.map(function (p) {
      return '<span class="line-mask"><span class="line-inner">' + p.trim() + '</span></span>';
    }).join('');
    el.dataset.split = '1';
    return $$('.line-inner', el);
  }

  // Fly an element in when it scrolls into view.
  function flyIn(targets, vars, trigger) {
    targets = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
    if (!targets.length) return;
    gsap.from(targets, Object.assign({
      autoAlpha: 0, y: 48, duration: 0.9, ease: EASE, stagger: 0.12,
      scrollTrigger: { trigger: trigger || targets[0], start: 'clamp(top 85%)', once: true }
    }, vars));
  }

  // Workflow diagram: nodes pop in one by one, connectors draw from left to right.
  function buildFlow(container, trigger, delay) {
    if (!container) return;
    var items = $$(':scope > div', container);
    if (!items.length) return;
    var tl = gsap.timeline({
      delay: delay || 0,
      scrollTrigger: { trigger: trigger || container, start: 'clamp(top 85%)', once: true }
    });
    items.forEach(function (item) {
      var isConnector = item.offsetHeight <= 2;
      if (isConnector) {
        tl.from(item, { scaleX: 0, transformOrigin: 'left center', duration: 0.35, ease: 'power2.inOut' }, '-=0.05');
      } else {
        tl.from(item, { autoAlpha: 0, y: 14, scale: 0.92, duration: 0.45, ease: 'back.out(1.6)' }, '-=0.1');
      }
    });
  }

  var mm = gsap.matchMedia();

  mm.add('(prefers-reduced-motion: no-preference)', function () {
    // ---------- Header ----------
    var header = $('header');
    if (header) gsap.from(header, { yPercent: -100, autoAlpha: 0, duration: 0.8, ease: EASE });

    // ---------- Home hero ----------
    var hero = $('section[aria-label="Introduction"]');
    if (hero) {
      var h1 = $('h1', hero);
      var lines = splitLines(h1);
      var tl = gsap.timeline({ defaults: { ease: EASE } });
      tl.from($('p', hero), { autoAlpha: 0, x: -24, duration: 0.7 }, 0.2)
        .from(lines, { yPercent: 110, duration: 1.1, stagger: 0.12, ease: 'power4.out' }, 0.3)
        .from(h1.nextElementSibling, { autoAlpha: 0, y: 24, duration: 0.8 }, 0.75)
        .from(h1.nextElementSibling.nextElementSibling, { autoAlpha: 0, y: 24, duration: 0.8 }, 0.9)
        .from($$(':scope > div:last-child > span', hero), { autoAlpha: 0, y: 16, duration: 0.6, stagger: 0.08 }, 1.05);
    }

    // ---------- Section headings (eyebrow + h2) ----------
    $$('section h2').forEach(function (h2) {
      // Contact and case-study story columns have their own sequences.
      if (h2.closest('#contact') || h2.closest('section[aria-label="Project story"]')) return;
      var eyebrow = h2.previousElementSibling;
      flyIn([eyebrow, h2], { y: 40 }, h2);
    });
    // Short intro paragraph beside a section heading (Work, Process)
    $$('#work h2, #process h2').forEach(function (h2) {
      var intro = h2.parentElement && h2.parentElement.nextElementSibling;
      if (intro && intro.tagName === 'P') flyIn(intro, { x: 40, y: 0 }, h2);
    });

    // ---------- About ----------
    var about = $('#about');
    if (about) {
      var photo = $('[role="img"]', about);
      if (photo) {
        gsap.from(photo, {
          autoAlpha: 0, x: -80, duration: 1.1, ease: EASE,
          scrollTrigger: { trigger: photo, start: 'clamp(top 85%)', once: true }
        });
        var mono = photo.firstElementChild;
        if (mono) gsap.from(mono, {
          scale: 0.8, autoAlpha: 0, duration: 1.2, delay: 0.25, ease: EASE,
          scrollTrigger: { trigger: photo, start: 'clamp(top 85%)', once: true }
        });
      }
      var aboutH2 = $('h2', about);
      var panel = aboutH2 && aboutH2.nextElementSibling;
      flyIn(panel, { x: 80, y: 0, duration: 1 }, panel);
      flyIn(panel && panel.nextElementSibling, { y: 30 }, panel && panel.nextElementSibling);
      var chips = panel && panel.nextElementSibling ? $$('li', panel.nextElementSibling) : [];
      flyIn(chips, { y: 16, duration: 0.5, stagger: 0.06 }, chips[0]);
    }

    // ---------- Work cards ----------
    $$('#work .card').forEach(function (card, i) {
      gsap.from(card, {
        autoAlpha: 0, y: 70, duration: 1, ease: EASE, delay: (i % 2) * 0.12,
        scrollTrigger: { trigger: card, start: 'clamp(top 88%)', once: true }
      });
      buildFlow($('[aria-hidden="true"]', card), card, 0.35 + (i % 2) * 0.12);
    });

    // ---------- Process steps ----------
    var steps = $$('#process ol > li');
    if (steps.length) {
      gsap.from(steps, {
        autoAlpha: 0, x: -40, duration: 0.8, ease: EASE, stagger: 0.15,
        scrollTrigger: { trigger: steps[0], start: 'clamp(top 85%)', once: true }
      });
    }

    // ---------- Contact ----------
    var contact = $('#contact');
    if (contact) {
      var ch2 = $('h2', contact);
      var ctl = gsap.timeline({ scrollTrigger: { trigger: ch2, start: 'clamp(top 85%)', once: true }, defaults: { ease: EASE } });
      ctl.from(ch2.previousElementSibling, { autoAlpha: 0, x: -24, duration: 0.6 })
        .from(ch2, { autoAlpha: 0, y: 60, duration: 1.1 }, '-=0.3')
        .from(ch2.nextElementSibling, { autoAlpha: 0, y: 24, duration: 0.7 }, '-=0.6');
      flyIn($('footer', contact), { y: 20, duration: 0.7 });
    }

    // ---------- Case study page ----------
    var cs = $('section[aria-labelledby="cs-title"]');
    if (cs) {
      var csH1 = $('h1', cs);
      var ctl2 = gsap.timeline({ defaults: { ease: EASE } });
      ctl2.from(csH1.previousElementSibling, { autoAlpha: 0, x: -24, duration: 0.7 }, 0.2)
        .from(csH1, { autoAlpha: 0, y: 60, duration: 1.1 }, 0.3)
        .from(csH1.nextElementSibling, { autoAlpha: 0, y: 24, duration: 0.8 }, 0.65)
        .from($$('dl > div', cs), { autoAlpha: 0, y: 20, duration: 0.6, stagger: 0.08 }, 0.85);
      var diagram = $('[role="img"] > [aria-hidden="true"]');
      if (diagram) {
        flyIn(diagram.parentElement, { y: 50, duration: 1 }, diagram.parentElement);
        buildFlow(diagram, diagram.parentElement, 0.4);
      }
      var storyCols = $$('section[aria-label="Project story"] h2').map(function (h) { return h.parentElement; });
      if (storyCols.length) {
        gsap.from(storyCols, {
          autoAlpha: 0, y: 50, duration: 0.9, ease: EASE, stagger: 0.15,
          scrollTrigger: { trigger: storyCols[0], start: 'clamp(top 85%)', once: true }
        });
      }
      var next = $('a.next');
      if (next) flyIn(next, { x: -60, y: 0, duration: 1 }, next);
    }

    // Recalculate trigger positions once web fonts change the layout.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  });

  // Mobile menu: slide its links in each time it opens.
  var menu = document.getElementById('mobile-menu');
  var openBtn = document.getElementById('menu-open');
  if (menu && openBtn) {
    openBtn.addEventListener('click', function () {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      gsap.fromTo($$('nav a', menu), { autoAlpha: 0, x: -32 }, { autoAlpha: 1, x: 0, duration: 0.6, stagger: 0.07, ease: EASE, delay: 0.05 });
    });
  }

  reveal();
})();
