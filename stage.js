/* The stage: one full-screen canvas behind the whole site.
   Mostly black. A few large, soft blurs of red (with a little pink and pale grey layered in)
   drift very slowly, and a faint striped circle sits inside the main one. Everything is drawn
   small and stretched, so every shape is out of focus and nothing has an edge.
   The entrance uses the same canvas: the blurs fade up out of black around the logo, then
   drift to where they rest on the page. Purely visual. The form logic lives in app.js. */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var html = document.documentElement;
  var canvas = document.getElementById('field');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var INK = [11, 6, 6];
  var COLORS = [
    [226, 44, 34],     // 0 red
    [196, 28, 30],     // 1 deeper red
    [96, 12, 18],      // 2 wine
    [236, 150, 146],   // 3 soft pink
    [198, 192, 200],   // 4 pale grey
  ];
  var STRIPE = { hot: [255, 226, 206], mid: [255, 120, 80], red: [238, 36, 54] };
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a < 0 ? 0 : a) + ')'; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function span(t, a, b) { return clamp01((t - a) / (b - a)); }
  function ease(u) { u = clamp01(u); return u * u * u * (u * (u * 6 - 15) + 10); }   // very gentle start and stop

  // ------------------------------------------------------------ Sizes
  var W = 0, H = 0;
  var soft = document.createElement('canvas');    // the blurs: tiny, then stretched
  var sctx = soft.getContext('2d');
  var mid = document.createElement('canvas');     // the striped circle: small, then stretched, so it is out of focus too
  var mctx = mid.getContext('2d');
  var MID = 0.3;

  function size() {
    W = window.innerWidth;
    H = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    soft.width = Math.max(40, Math.round(W * 0.07));
    soft.height = Math.max(40, Math.round(H * 0.07));
    mid.width = Math.max(80, Math.round(W * MID));
    mid.height = Math.max(80, Math.round(H * MID));
  }

  // ------------------------------------------------------------ Scenes
  // A scene is five blurs and the circle. Blur: [x, y, width, height, strength], as shares of the
  // screen (sizes are shares of the longer side). Blur n always uses COLORS[n].
  // The circle: [x, y, radius in px, strength].
  function sceneOpening() {
    // red gathers at the edges and leaves the middle black for the logo
    return {
      blobs: [[0.24, 0.0, 0.17, 0.12, 0.56], [1.03, 0.44, 0.13, 0.2, 0.6], [0.46, 1.07, 0.17, 0.11, 0.5], [1.0, 0.44, 0.05, 0.07, 0], [0.5, 0.5, 0.05, 0.05, 0]],
      circle: [W / 2, H / 2, Math.min(W, H) * 0.2, 0],
    };
  }
  function sceneHero() {
    if (W < 760) {
      return {
        blobs: [[0.72, 0.19, 0.21, 0.13, 0.68], [1.06, 0.52, 0.12, 0.12, 0.34], [0.0, 1.06, 0.18, 0.09, 0.3], [0.64, 0.27, 0.16, 0.055, 0.4], [0.78, 0.29, 0.07, 0.045, 0.28]],
        circle: [W * 0.7, H * 0.22, W * 0.3, 0.3],
      };
    }
    return {
      // one large red blur on the right, a pink bar and a pale spot layered into it; the left stays black for the title
      blobs: [[0.77, 0.28, 0.17, 0.17, 0.68], [1.04, 0.78, 0.13, 0.17, 0.36], [0.04, 1.1, 0.22, 0.11, 0.3], [0.74, 0.42, 0.15, 0.065, 0.42], [0.81, 0.45, 0.07, 0.055, 0.28]],
      circle: [W * 0.77, H * 0.33, Math.min(W * 0.14, H * 0.22), 0.3],
    };
  }
  function sceneAmbient() {
    // behind the form and the privacy page: mostly black, with a few faint blurs that slowly
    // wander across the whole screen (roam), each on its own path
    return {
      blobs: [[0.72, 0.3, 0.13, 0.13, 0.36], [0.28, 0.72, 0.12, 0.12, 0.28], [0.55, 0.9, 0.16, 0.09, 0.3], [0.3, 0.28, 0.11, 0.045, 0.16], [0.66, 0.62, 0.06, 0.045, 0.1]],
      circle: [W * 1.0, H * 0.12, Math.min(W, H) * 0.2, 0],
      roam: 1,
    };
  }
  function blend(a, b, u) {
    var o = { blobs: [], circle: [] };
    for (var i = 0; i < a.blobs.length; i++) {
      o.blobs.push(a.blobs[i].map(function (v, k) { return lerp(v, b.blobs[i][k], u); }));
    }
    for (var k = 0; k < 4; k++) o.circle.push(lerp(a.circle[k], b.circle[k], u));
    o.roam = lerp(a.roam || 0, b.roam || 0, u);
    return o;
  }

  var intro = document.getElementById('introScene');
  var rest = intro ? sceneHero : sceneAmbient;      // the scene the page is resting on
  var glide = null;                                 // { from, to, start, ms }

  function glideTo(sceneFn, ms) {
    glide = { from: currentScene(performance.now()), to: sceneFn, start: performance.now(), ms: ms };
    rest = sceneFn;
  }
  function currentScene(now) {
    if (!glide) return rest();
    var u = (now - glide.start) / glide.ms;
    if (u >= 1) { glide = null; return rest(); }
    return blend(glide.from, glide.to(), ease(u));
  }

  // ------------------------------------------------------------ Drawing
  var scrollY = 0;

  // level: overall brightness (the entrance fades it up from 0). still: no drifting (used for pictures).
  function drawScene(t, s, level, still) {
    var w = soft.width, h = soft.height, m = Math.max(w, h);
    sctx.globalCompositeOperation = 'source-over';
    sctx.fillStyle = rgba(INK, 1);
    sctx.fillRect(0, 0, w, h);
    for (var i = 0; i < s.blobs.length; i++) {
      var b = s.blobs[i];
      var a = b[4] * level;
      if (a <= 0.004) continue;
      // each blur wanders on its own slow path: a little on the introduction, across the
      // whole screen behind the form (roam)
      var roam = s.roam || 0;
      var sp = 0.00011 + roam * (0.00003 + i * 0.000012);
      var dx = still ? 0 : Math.sin(t * sp + i * 1.7) * (0.022 + roam * 0.3);
      var dy = still ? 0 : Math.cos(t * sp * 0.77 + i * 2.3) * (0.018 + roam * 0.26);
      var rx = b[2] * m, ry = b[3] * m;
      sctx.save();
      sctx.translate((b[0] + dx) * w, (b[1] + dy) * h);
      sctx.scale(rx / ry, 1);
      var g = sctx.createRadialGradient(0, 0, 0, 0, 0, ry * 1.9);
      g.addColorStop(0, rgba(COLORS[i], a));
      g.addColorStop(0.34, rgba(COLORS[i], a * 0.92));     // a flat, even middle like a blurred shape...
      g.addColorStop(0.62, rgba(COLORS[i], a * 0.4));
      g.addColorStop(1, rgba(COLORS[i], 0));               // ...and a long fall into black
      sctx.fillStyle = g;
      sctx.fillRect(-ry * 1.9, -ry * 1.9, ry * 3.8, ry * 3.8);
      sctx.restore();
    }

    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(soft, 0, 0, W, H);
    drawCursorGlow(level);

    // the striped circle, faint and slightly out of focus, laid into the main blur as extra light
    var c = s.circle, ca = c[3] * level;
    if (ca > 0.01 && c[2] > 2) {
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, mid.width, mid.height);
      drawStripes(mctx, c[0] * MID, c[1] * MID, c[2] * MID, t);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = ca;
      ctx.drawImage(mid, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // Horizontal bands of light inside a circle, warmest at the middle, drifting slowly downward.
  // The whole circle fades out toward its rim, so it sinks into the blur around it.
  function drawStripes(g2, cx, cy, R, t) {
    g2.save();
    g2.beginPath();
    g2.arc(cx, cy, R, 0, Math.PI * 2);
    g2.clip();
    var bands = 13;
    var step = (2 * R) / bands;
    var offset = ((t * 0.0018) % step + step) % step;
    for (var i = -1; i <= bands; i++) {
      var yc = cy - R + step * (i + 0.5) + offset;
      var dy = (yc - cy) / R;
      if (Math.abs(dy) >= 1) continue;
      var half = Math.sqrt(1 - dy * dy) * R;
      var h = step * (0.3 + 0.3 * (1 - Math.abs(dy)));
      var hot = clamp01(1 - Math.abs(dy) * 1.2);
      var core = mix(STRIPE.red, STRIPE.hot, Math.pow(hot, 1.6));
      var midc = mix(STRIPE.red, STRIPE.mid, hot);
      var fade = 1 - Math.pow(Math.abs(dy), 2.2);                   // top and bottom bands thin out
      var g = g2.createLinearGradient(cx - half, 0, cx + half, 0);
      g.addColorStop(0, rgba(STRIPE.red, 0));
      g.addColorStop(0.3, rgba(midc, 0.55 * fade));
      g.addColorStop(0.5, rgba(core, 0.9 * fade));
      g.addColorStop(0.7, rgba(midc, 0.55 * fade));
      g.addColorStop(1, rgba(STRIPE.red, 0));
      g2.fillStyle = g;
      g2.fillRect(cx - half, yc - h / 2, half * 2, h);
    }
    g2.restore();
  }

  // On the introduction, the blurs slide up and dim as the page scrolls, so the reading sections are calm.
  function settle(s) {
    if (rest !== sceneHero || glide || !scrollY) return s;
    var k = clamp01(scrollY / (H * 0.9));
    var o = blend(s, s, 0);
    for (var i = 0; i < o.blobs.length; i++) {
      o.blobs[i][1] -= (scrollY / H) * 0.32;
      o.blobs[i][4] *= 1 - 0.55 * k;
    }
    o.circle[1] -= scrollY * 0.32;
    o.circle[3] *= 1 - 0.8 * k;
    return o;
  }

  // ------------------------------------------------------------ The entrance
  // Slow and quiet: red blurs rise out of the black at the edges of the screen, the logo comes into
  // focus in the dark middle, and then the blurs drift across to where they rest as the page fades in.
  var opening = document.getElementById('opening');
  var playing = false;
  var t0 = 0;
  var revealed = false;
  var skipEvents = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
  var T = { rise: 200, risen: 2200, logoA: 900, logoB: 2300, drift: 3300, reveal: 3800, end: 5600 };   // ms

  function setLogo(opacity, zoom, blur) {
    if (!opening) return;
    opening.style.setProperty('--lo', opacity.toFixed(3));
    opening.style.setProperty('--lz', zoom.toFixed(4));
    opening.style.setProperty('--lb', blur.toFixed(2) + 'px');
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    html.classList.remove('is-opening');
    if (opening) opening.classList.add('is-leaving');
  }

  function finish() {
    playing = false;
    reveal();
    skipEvents.forEach(function (ev) { window.removeEventListener(ev, skip, true); });
    if (opening && opening.parentNode) opening.parentNode.removeChild(opening);
  }

  // Skipping moves straight to the drift, so the page still arrives in one smooth move.
  function skip() {
    var t = performance.now() - t0;
    if (playing && t < T.drift) t0 = performance.now() - T.drift;
  }

  function drawOpening(now) {
    var t = now - t0;
    var a = sceneOpening();
    var rise = ease(span(t, T.rise, T.risen));
    // the blurs start a little further out and ease inward as they brighten
    for (var i = 0; i < a.blobs.length; i++) {
      a.blobs[i][0] = 0.5 + (a.blobs[i][0] - 0.5) * (1.14 - 0.14 * rise);
      a.blobs[i][1] = 0.5 + (a.blobs[i][1] - 0.5) * (1.14 - 0.14 * rise);
    }
    var li = ease(span(t, T.logoA, T.logoB));
    var lo = ease(span(t, T.drift, T.drift + 700));
    setLogo(li * (1 - lo), 0.985 + 0.015 * li + 0.02 * lo, (1 - li) * 9 + lo * 6);

    var s = a;
    if (t >= T.drift) {
      s = blend(a, sceneHero(), ease(span(t, T.drift, T.end)));
      if (t >= T.reveal) reveal();
    }
    drawScene(t, s, rise, false);
    if (t >= T.end) finish();
  }

  // ------------------------------------------------------------ The cursor glow
  // A soft red light that trails the mouse, a little behind it. Only on computers with a mouse or
  // trackpad, never on touch screens, and not when someone has asked for reduced motion.
  var hoverable = !reduce && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var cur = { x: 0, y: 0, tx: 0, ty: 0, seen: false, on: 0, want: 0 };

  function stepCursor() {
    cur.x += (cur.tx - cur.x) * 0.09;
    cur.y += (cur.ty - cur.y) * 0.09;
    cur.on += (cur.want - cur.on) * 0.06;
    return Math.abs(cur.tx - cur.x) > 0.4 || Math.abs(cur.ty - cur.y) > 0.4 || Math.abs(cur.want - cur.on) > 0.004;
  }

  function drawCursorGlow(level) {
    if (!hoverable || !cur.seen || cur.on < 0.004) return;
    var r = Math.max(W, H) * 0.22;
    var a = cur.on * level;
    var g = ctx.createRadialGradient(cur.x, cur.y, 0, cur.x, cur.y, r);
    g.addColorStop(0, rgba([240, 92, 84], 0.34 * a));
    g.addColorStop(0.3, rgba([220, 44, 46], 0.18 * a));
    g.addColorStop(0.65, rgba([130, 18, 24], 0.06 * a));
    g.addColorStop(1, rgba([120, 16, 22], 0));
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(cur.x - r, cur.y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  if (hoverable) {
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      cur.tx = e.clientX;
      cur.ty = e.clientY;
      if (!cur.seen) { cur.x = cur.tx; cur.y = cur.ty; cur.seen = true; }
      cur.want = 1;
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', function () { cur.want = 0; });
    window.addEventListener('blur', function () { cur.want = 0; });
  }

  // ------------------------------------------------------------ Loop and events
  var frame = 0;
  function draw(now) { drawScene(now, settle(currentScene(now)), 1, reduce); }
  function loop(now) {
    frame++;
    var cursorMoving = hoverable && stepCursor();
    if (playing) drawOpening(now);
    // the drift is slow, so half the frames is plenty, except while the cursor glow is following the mouse
    else if (glide || cursorMoving || frame % 2 === 0) draw(now);
    requestAnimationFrame(loop);
  }

  window.addEventListener('scroll', function () {
    scrollY = window.scrollY;
    if (reduce) draw(0);
  }, { passive: true });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      size();
      if (reduce) draw(0);
    }, 120);
  });

  // "Begin nomination": the blurs drift out to the corners and the screen settles into black for the form.
  document.addEventListener('stage:begin', function () {
    scrollY = 0;
    if (reduce) { rest = sceneAmbient; draw(0); }
    else glideTo(sceneAmbient, 2000);
  });

  size();
  if (reduce || !opening) {
    if (opening && opening.parentNode) opening.parentNode.removeChild(opening);
    html.classList.remove('is-opening');
    if (reduce) draw(0);
    else requestAnimationFrame(loop);
  } else {
    playing = true;
    html.classList.add('is-opening');
    t0 = performance.now();
    skipEvents.forEach(function (ev) { window.addEventListener(ev, skip, { capture: true, passive: true }); });
    requestAnimationFrame(loop);
  }
})();
