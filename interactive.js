/* Interactive extras for kentsc-portfolio: agent demo, 3D card tilt, magnetic buttons. */
(function () {
  var hasGsap = !!window.gsap;
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var GOLD = '#FF5F1F';
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------------ */
  /* 1. WhatsApp agent demo (simulation with sample data)                */
  /* ------------------------------------------------------------------ */
  var demo = $('#agent-demo');
  if (demo) {
    var chat = $('#demo-chat', demo);
    var status = $('#demo-status', demo);
    var presence = $('#demo-presence', demo);
    var flow = $('#demo-flow', demo);
    var dot = $('#demo-dot', demo);
    var nodes = $$('.demo-node', demo);
    var buttons = $$('.demo-q', demo);
    var running = false;

    var QA = {
      stock: {
        q: 'Is the linen throw in stock?',
        lookup: 'Checking stock in Shopify…',
        a: 'Yes! The Linen Throw in Sand has 12 left in stock. Want me to send you the checkout link?'
      },
      order: {
        q: 'Where is my order #1042?',
        lookup: 'Looking up order #1042 in Shopify…',
        a: 'Order #1042 was shipped yesterday and should arrive in 2–3 days. I can send you the tracking link.'
      },
      ship: {
        q: 'Do you ship to Medan?',
        lookup: 'Checking shipping zones in Shopify…',
        a: 'Yes, we ship across Indonesia. Delivery to Medan usually takes 3–5 business days.'
      }
    };

    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, reduceMQ.matches ? Math.min(ms, 350) : ms); }); };

    function bubble(text, who) {
      var el = document.createElement('div');
      el.className = 'bubble bubble-' + who;
      el.textContent = text;
      var base = 'max-width: 85%; padding: 10px 14px; font-size: 15px; line-height: 1.5; ';
      el.style.cssText = who === 'user'
        ? base + 'align-self: flex-end; background: ' + GOLD + '; color: #1F1E1C; border-radius: 12px 12px 2px 12px;'
        : base + 'align-self: flex-start; background: #2B2A27; border: 1px solid #403E3A; color: #FBFBFB; border-radius: 12px 12px 12px 2px;';
      chat.appendChild(el);
      // keep the log short
      while (chat.children.length > 6) chat.removeChild(chat.firstElementChild);
      chat.scrollTop = chat.scrollHeight;
      if (hasGsap && !reduceMQ.matches) gsap.from(el, { autoAlpha: 0, y: 12, scale: 0.97, duration: 0.35, ease: 'power2.out' });
      return el;
    }

    function typing() {
      var el = document.createElement('div');
      el.className = 'bubble bubble-typing';
      el.setAttribute('aria-label', 'Agent is typing');
      el.style.cssText = 'align-self: flex-start; padding: 12px 14px; background: #2B2A27; border: 1px solid #403E3A; border-radius: 12px 12px 12px 2px; display: flex; gap: 5px;';
      el.innerHTML = '<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>';
      chat.appendChild(el);
      chat.scrollTop = chat.scrollHeight;
      return el;
    }

    function setNode(i, state) {
      var n = nodes[i]; if (!n) return;
      if (state === 'active') { n.style.borderColor = GOLD; n.style.color = GOLD; n.style.boxShadow = '0 0 0 4px rgba(255,95,31,.12)'; }
      else if (state === 'done') { n.style.borderColor = 'rgba(255,95,31,.55)'; n.style.color = '#FBFBFB'; n.style.boxShadow = 'none'; }
      else { n.style.borderColor = '#4A4843'; n.style.color = '#A3A09A'; n.style.boxShadow = 'none'; }
    }

    function nodeCenter(i) {
      var n = nodes[i];
      return n.offsetLeft + n.offsetWidth / 2;
    }

    function moveDot(i) {
      var x = nodeCenter(i);
      if (!hasGsap || reduceMQ.matches) { dot.style.left = x + 'px'; dot.style.opacity = '1'; return wait(250); }
      return new Promise(function (r) {
        gsap.to(dot, { left: x, opacity: 1, duration: i === 0 ? 0.01 : 0.55, ease: 'power2.inOut', onComplete: r });
      });
    }

    function setStatus(t) { status.textContent = t; }

    async function run(key, btn) {
      if (running) return;
      running = true;
      var qa = QA[key];
      buttons.forEach(function (b) { b.disabled = true; b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      nodes.forEach(function (_, i) { setNode(i, 'idle'); });

      bubble(qa.q, 'user');
      await wait(350);

      var steps = [
        'Message received on WhatsApp',
        'AI agent is reading the question…',
        qa.lookup,
        'Writing the reply…'
      ];
      for (var i = 0; i < steps.length; i++) {
        await moveDot(i);
        if (i > 0) setNode(i - 1, 'done');
        setNode(i, 'active');
        setStatus(steps[i]);
        if (i === 1) presence.textContent = 'typing…';
        await wait(i === 2 ? 900 : 650);
      }

      var t = typing();
      await wait(900);
      chat.removeChild(t);
      bubble(qa.a, 'agent');
      presence.textContent = 'online';
      setNode(3, 'done');
      setStatus('Reply sent. Try another question.');
      if (hasGsap) gsap.to(dot, { opacity: 0, duration: 0.3 }); else dot.style.opacity = '0';

      buttons.forEach(function (b) { b.disabled = false; });
      running = false;
    }

    buttons.forEach(function (b) {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { run(b.getAttribute('data-q'), b); });
    });
    window.addEventListener('resize', function () { if (!running) dot.style.opacity = '0'; });
  }

  /* ------------------------------------------------------------------ */
  /* 2. 3D tilt on project cards + magnetic gold buttons (desktop only)   */
  /* ------------------------------------------------------------------ */
  function setupTilt() {
    if (!hasGsap || reduceMQ.matches || !finePointer.matches) return;
    document.documentElement.classList.add('tilt-on');

    $$('#work .card').forEach(function (card) {
      gsap.set(card, { transformPerspective: 1000 });
      var rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3.out' });
      var ry = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3.out' });
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;   // 0..1
        var py = (e.clientY - r.top) / r.height;   // 0..1
        var max = r.width > 900 ? 2.5 : 5;         // wide featured card tilts less
        ry((px - 0.5) * 2 * max);
        rx((0.5 - py) * 2 * max);
        card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      });
      card.addEventListener('pointerleave', function () { rx(0); ry(0); });
    });

    $$('.btn-gold, .nav-cta').forEach(function (btn) {
      var mx = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3.out' });
      var my = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3.out' });
      btn.addEventListener('pointermove', function (e) {
        var r = btn.getBoundingClientRect();
        mx((e.clientX - (r.left + r.width / 2)) * 0.25);
        my((e.clientY - (r.top + r.height / 2)) * 0.35);
      });
      btn.addEventListener('pointerleave', function () { mx(0); my(0); });
    });
  }

  setupTilt();
})();
