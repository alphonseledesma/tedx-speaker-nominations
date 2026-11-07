(function () {
  'use strict';

  var CFG = window.PORTAL_CONFIG || {};
  // Must match CONFIG.MAX_CHARS in Code.gs
  var CAPS = { 'text': 200, 'number': 3, 'dropdown': 100, 'email': 200, 'long text': 6000 };
  var SELF_DESCRIBE = 'Prefer to self-describe';
  var DRAFT_PREFIX = 'tedx-nomination-draft:';

  var state = {
    config: null,
    token: '',
    tokenExp: 0,
    user: null,
    pendingSubmit: false,
    busy: false,
    started: false,  // true once the visitor clicks "Begin nomination"
    queue: [],       // screens waiting for the introduction to end
  };
  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var controls = {};
  var keys = [];

  // ---------- Small helpers ----------
  function $(id) { return document.getElementById(id); }
  function show(id, on) { $(id).hidden = !on; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function countWords(s) {
    s = String(s || '').trim();
    return s ? s.split(/\s+/).length : 0;
  }
  function decodeJwt(token) {
    try {
      var part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var bin = atob(part + '==='.slice((part.length + 3) % 4));
      var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return null;
    }
  }

  // ---------- API ----------
  function parseJson(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  function apiGet(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(CFG.API_URL + '?' + qs).then(parseJson);
  }
  function apiPost(body) {
    // No custom headers: a plain text body avoids a CORS preflight, which Apps Script does not answer.
    return fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body) }).then(parseJson);
  }

  // ---------- Screens ----------
  function setLoading(text) {
    $('loadingText').textContent = text || 'Loading...';
    show('loading', !!text);
  }
  function fatal(message) {
    onStage(function () {
      setLoading('');
      $('fatalText').textContent = message;
      show('fatal', true);
    });
  }

  // The introduction is written in index.html. The Sheet only sets the tab title and deadline.
  function renderHero(cfg) {
    if (cfg.title) document.title = cfg.title;
    if (cfg.deadlineText && cfg.open) {
      $('deadline').textContent = 'Nominations close ' + cfg.deadlineText;
      show('deadline', true);
    }
  }

  // ---------- Introduction → form ----------
  // Screens requested before the visitor clicks "Begin nomination" wait here.
  function onStage(fn) {
    if (state.started) fn();
    else state.queue.push(fn);
  }

  function begin() {
    if (state.started || $('beginBtn').disabled) return;
    $('beginBtn').disabled = true;
    var intro = $('introScene');
    intro.classList.add('is-leaving');
    setTimeout(function () {
      intro.hidden = true;
      intro.classList.remove('is-leaving');
      window.scrollTo(0, 0);
      state.started = true;
      document.dispatchEvent(new CustomEvent('stage:begin'));
      var waiting = state.queue;
      state.queue = [];
      if (!waiting.length) setLoading('Setting the stage...');
      waiting.forEach(function (fn) { fn(); });
    }, REDUCED_MOTION ? 0 : 700);
  }

  function renderAccount() {
    var u = state.user;
    $('who').textContent = u.name ? u.name + ' (' + u.email + ')' : u.email;
    show('account', true);
  }

  function renderMine(list) {
    list = list || [];
    var ul = $('mineList');
    ul.textContent = '';
    list.forEach(function (n) {
      var li = el('li');
      li.appendChild(el('span', 'mine-name', n.name || 'Unnamed nominee'));
      li.appendChild(el('span', 'mine-meta', n.id + (n.submittedAt ? ', sent ' + n.submittedAt : '')));
      ul.appendChild(li);
    });
    show('mine', list.length > 0);
  }

  function showLimit(title, text) {
    $('limitTitle').textContent = title || 'You can no longer submit';
    $('limitText').textContent = text || '';
    show('nomForm', false);
    show('limitNotice', true);
  }

  // ---------- Form building ----------
  function buildForm(questions) {
    var box = $('fields');
    box.textContent = '';
    controls = {};
    keys = [];
    questions.forEach(function (q, i) { buildQuestion(box, q, i, questions.length); });
  }

  function buildQuestion(box, q, i, total) {
    var id = 'f-' + q.key;
    var wrap = el('div', 'q');
    wrap.appendChild(el('div', 'q-num', (i + 1) + ' of ' + total));

    var label = el('label', 'q-label', q.label);
    label.htmlFor = id;
    if (q.required) {
      var star = el('span', 'req', ' *');
      star.setAttribute('aria-hidden', 'true');
      label.appendChild(star);
    }
    wrap.appendChild(label);

    var describedBy = [];
    if (q.description) {
      var desc = el('p', 'q-desc', q.description);
      desc.id = id + '-desc';
      describedBy.push(desc.id);
      wrap.appendChild(desc);
    }

    var input;
    if (q.type === 'long text') {
      input = el('textarea');
      input.rows = q.wordLimit ? 10 : 5;
    } else if (q.type === 'dropdown') {
      input = el('select');
      var first = el('option', null, 'Choose one');
      first.value = '';
      input.appendChild(first);
      q.options.forEach(function (o) {
        var opt = el('option', null, o);
        opt.value = o;
        input.appendChild(opt);
      });
    } else {
      input = el('input');
      input.type = q.type === 'email' ? 'email' : 'text';
      if (q.type === 'number') {
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
      }
    }
    input.id = id;
    input.name = q.key;
    if (input.tagName !== 'SELECT') {
      input.maxLength = CAPS[q.type] || 1000;
      if (q.placeholder) input.placeholder = q.placeholder;
    }
    if (q.required) input.setAttribute('aria-required', 'true');
    wrap.appendChild(input);

    var other = null;
    if (q.type === 'dropdown' && q.options.indexOf(SELF_DESCRIBE) !== -1) {
      other = el('input');
      other.type = 'text';
      other.name = q.key + 'Other';
      other.maxLength = 60;
      other.placeholder = 'Please describe';
      other.setAttribute('aria-label', q.label + ', self-description');
      other.hidden = true;
      wrap.appendChild(other);
      input.addEventListener('change', function () {
        other.hidden = input.value !== SELF_DESCRIBE;
        if (!other.hidden) other.focus();
      });
    }

    var counter = null;
    if (q.wordLimit) {
      counter = el('p', 'counter');
      wrap.appendChild(counter);
    }

    var error = el('p', 'field-error');
    error.id = id + '-err';
    describedBy.push(error.id);
    input.setAttribute('aria-describedby', describedBy.join(' '));
    wrap.appendChild(error);

    controls[q.key] = { q: q, wrap: wrap, input: input, other: other, counter: counter, error: error };
    keys.push(q.key);
    box.appendChild(wrap);
    updateCounter(q.key);
  }

  function updateCounter(key) {
    var c = controls[key];
    if (!c || !c.counter) return;
    var n = countWords(c.input.value);
    c.counter.textContent = n + ' / ' + c.q.wordLimit + ' words';
    c.counter.classList.toggle('over', n > c.q.wordLimit);
  }

  function collect() {
    var data = {};
    keys.forEach(function (k) {
      var c = controls[k];
      data[k] = c.input.value;
      if (c.other) data[k + 'Other'] = c.other.value;
    });
    return data;
  }

  function fill(data) {
    keys.forEach(function (k) {
      var c = controls[k];
      if (data[k] !== undefined) c.input.value = data[k];
      if (c.other) {
        c.other.value = data[k + 'Other'] || '';
        c.other.hidden = c.input.value !== SELF_DESCRIBE;
      }
      updateCounter(k);
    });
  }

  function formIsEmpty() {
    var data = collect();
    return Object.keys(data).every(function (k) { return !String(data[k]).trim(); });
  }

  function resetForm() {
    $('nomForm').reset();
    keys.forEach(function (k) {
      if (controls[k].other) controls[k].other.hidden = true;
      updateCounter(k);
    });
    showErrors({});
    $('formError').textContent = '';
    $('draftStatus').textContent = '';
  }

  // ---------- Validation ----------
  function validate(data) {
    var errs = {};
    keys.forEach(function (k) {
      var q = controls[k].q;
      var v = String(data[k] || '').trim();
      if (!v) {
        if (q.required) errs[k] = 'This question is required.';
        return;
      }
      if (q.type === 'number' && (!/^\d{1,3}$/.test(v) || +v < 1 || +v > 120)) {
        errs[k] = 'Enter a whole number between 1 and 120.';
        return;
      }
      if (q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        errs[k] = 'Enter a valid email address.';
        return;
      }
      if (q.type === 'dropdown' && v === SELF_DESCRIBE && !String(data[k + 'Other'] || '').trim()) {
        errs[k] = 'Please describe, or choose another option.';
        return;
      }
      if (q.wordLimit) {
        var n = countWords(v);
        if (n > q.wordLimit) errs[k] = 'Please keep this to ' + q.wordLimit + ' words or fewer. It is ' + n + ' words now.';
      }
    });
    return errs;
  }

  function showErrors(errs, focusFirst) {
    var first = null;
    keys.forEach(function (k) {
      var c = controls[k];
      var msg = errs[k] || '';
      c.error.textContent = msg;
      c.wrap.classList.toggle('invalid', !!msg);
      c.input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg && !first) first = c;
    });
    if (focusFirst && first) {
      first.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first.input.focus({ preventScroll: true });
    }
  }

  // ---------- Drafts (saved in this browser only) ----------
  var storage = (function () {
    try {
      var t = '__t';
      window.localStorage.setItem(t, t);
      window.localStorage.removeItem(t);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  })();
  var draftTimer = null;

  function draftKey() { return state.user ? DRAFT_PREFIX + state.user.email : ''; }

  function saveDraftNow() {
    clearTimeout(draftTimer);
    if (!storage || !state.user) return;
    try {
      if (formIsEmpty()) {
        storage.removeItem(draftKey());
        $('draftStatus').textContent = '';
      } else {
        storage.setItem(draftKey(), JSON.stringify(collect()));
        $('draftStatus').textContent = 'Draft saved on this device';
      }
    } catch (e) { /* storage full or blocked: drafts are a convenience only */ }
  }
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 800);
  }
  function restoreDraft() {
    if (!storage || !state.user) return;
    try {
      var data = JSON.parse(storage.getItem(draftKey()) || 'null');
      if (data) {
        fill(data);
        $('draftStatus').textContent = 'We restored your unsent draft';
      }
    } catch (e) { /* ignore a broken draft */ }
  }
  function clearDraft() {
    clearTimeout(draftTimer);
    if (storage && state.user) {
      try { storage.removeItem(draftKey()); } catch (e) { /* ignore */ }
    }
    $('draftStatus').textContent = '';
  }

  // ---------- Google sign-in ----------
  function whenGsiReady(fn) {
    var tries = 0;
    (function check() {
      if (window.google && google.accounts && google.accounts.id) return fn();
      if (++tries > 150) {
        $('signinError').textContent = 'Google sign-in could not load. Check that your browser or an extension is not blocking accounts.google.com, then refresh.';
        return;
      }
      setTimeout(check, 100);
    })();
  }

  function initGsi() {
    google.accounts.id.initialize({
      client_id: CFG.GOOGLE_CLIENT_ID,
      callback: onCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    renderGsiButton($('gsiButton'));
  }

  function renderGsiButton(target) {
    target.textContent = '';
    google.accounts.id.renderButton(target, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'left',
      locale: 'en',  // always English, whatever the visitor's phone language is
      width: Math.min(320, Math.max(200, target.clientWidth || 320)),
    });
  }

  function onCredential(resp) {
    var token = resp && resp.credential;
    var claims = decodeJwt(token);
    if (!claims) {
      $('signinError').textContent = 'Sign-in did not work. Please try again.';
      return;
    }
    state.token = token;
    state.tokenExp = (claims.exp || 0) * 1000;
    $('signinError').textContent = '';

    var wasPending = state.pendingSubmit;
    var previousEmail = state.user ? state.user.email : '';
    var formVisible = !$('nomForm').hidden;

    show('signin', false);
    show('reauth', false);
    if (!formVisible) setLoading('Signing you in...');

    apiPost({ action: 'session', idToken: token }).then(function (res) {
      setLoading('');
      if (!res.ok) {
        state.pendingSubmit = false;
        if (res.code === 'AUTH') return backToSignIn('We could not confirm your Google sign-in. Please try again.');
        return backToSignIn(res.message || 'Sign-in did not work. Please try again.');
      }

      state.user = { email: res.email, name: res.name };
      renderAccount();
      renderMine(res.myNominations);

      if (!res.canSubmit) {
        state.pendingSubmit = false;
        return showLimit(res.limitTitle, res.limitMessage);
      }

      show('limitNotice', false);
      show('done', false);
      if (formIsEmpty()) restoreDraft();
      show('nomForm', true);
      if (!formVisible) window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });

      state.pendingSubmit = false;
      if (wasPending && previousEmail === res.email) submit();
      else if (wasPending) $('formError').textContent = 'You signed in with a different account. Check your answers, then press Submit.';
    }).catch(function (err) {
      console.error(err);
      setLoading('');
      state.pendingSubmit = false;
      backToSignIn('We could not reach the server. Check your connection and try again.');
    });
  }

  function backToSignIn(message) {
    state.token = '';
    state.tokenExp = 0;
    state.user = null;
    ['account', 'mine', 'limitNotice', 'nomForm', 'done', 'reauth'].forEach(function (id) { show(id, false); });
    show('signin', true);
    $('signinError').textContent = message || '';
  }

  function askReauth() {
    state.pendingSubmit = true;
    show('reauth', true);
    renderGsiButton($('gsiReauth'));
    $('reauth').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function switchAccount() {
    saveDraftNow();
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    resetForm();
    backToSignIn('');
  }

  // ---------- Submit ----------
  function setBusy(on) {
    state.busy = on;
    var btn = $('submitBtn');
    btn.disabled = on;
    btn.textContent = on ? 'Submitting...' : 'Submit nomination';
  }

  function submit() {
    if (state.busy) return;
    var data = collect();
    var errs = validate(data);
    showErrors(errs, true);
    if (Object.keys(errs).length) {
      $('formError').textContent = 'Please check the highlighted questions.';
      return;
    }
    $('formError').textContent = '';

    // Google sign-in tokens last about an hour. Ask again before it runs out.
    if (!state.token || Date.now() > state.tokenExp - 60 * 1000) return askReauth();

    setBusy(true);
    apiPost({ action: 'submit', idToken: state.token, answers: data }).then(function (res) {
      setBusy(false);
      if (res.ok) return onSubmitted(res, data);
      if (res.code === 'AUTH') return askReauth();
      if (res.code === 'INVALID') {
        showErrors(res.errors || {}, true);
        $('formError').textContent = res.message || 'Please check the highlighted questions.';
        return;
      }
      if (res.code === 'CLOSED' || res.code === 'LIMIT') {
        saveDraftNow();
        return showLimit(res.code === 'CLOSED' ? 'Nominations are closed' : 'You can no longer submit', res.message);
      }
      $('formError').textContent = res.message || 'Something went wrong. Please try again.';
    }).catch(function (err) {
      console.error(err);
      setBusy(false);
      $('formError').textContent = 'We could not reach the server. Check your connection and press Submit again. Your answers are still here.';
    });
  }

  function onSubmitted(res, data) {
    clearDraft();
    renderMine(res.myNominations);
    var name = String(data.nomineeName || '').trim();
    $('doneHeading').textContent = name ? 'Thank you for nominating ' + name + '.' : 'Thank you for your nomination.';
    var msg = (state.config && state.config.confirmationMessage) || '';
    if (res.emailSent) msg += (msg ? ' ' : '') + 'We sent a copy of your answers to ' + state.user.email + '.';
    $('doneMessage').textContent = msg;
    $('doneRef').textContent = res.id;
    show('anotherBtn', !!res.canSubmitAgain);
    show('nomForm', false);
    show('done', true);
    $('done').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('done').focus({ preventScroll: true });
  }

  function nominateAnother() {
    resetForm();
    show('done', false);
    show('nomForm', true);
    $('nomForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    var first = keys.length ? controls[keys[0]].input : null;
    if (first) first.focus({ preventScroll: true });
  }

  // ---------- Events ----------
  function onFieldInput(e) {
    var name = e.target && e.target.name;
    if (!name) return;
    var key = controls[name] ? name : name.replace(/Other$/, '');
    var c = controls[key];
    if (c) {
      updateCounter(key);
      if (c.error.textContent) {
        c.error.textContent = '';
        c.wrap.classList.remove('invalid');
        c.input.setAttribute('aria-invalid', 'false');
      }
    }
    $('formError').textContent = '';
    saveDraftSoon();
  }

  // ---------- Start ----------
  function boot() {
    var form = $('nomForm');
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    form.addEventListener('input', onFieldInput);
    form.addEventListener('change', onFieldInput);
    $('switchBtn').addEventListener('click', switchAccount);
    $('beginBtn').addEventListener('click', begin);
    $('anotherBtn').addEventListener('click', nominateAnother);
    window.addEventListener('pagehide', saveDraftNow);

    if (!CFG.API_URL || /PASTE/.test(CFG.API_URL) || !CFG.GOOGLE_CLIENT_ID || /PASTE/.test(CFG.GOOGLE_CLIENT_ID)) {
      return fatal('This portal is not set up yet. Fill in config.js with the web app URL and the Google client ID.');
    }

    apiGet({ action: 'config' }).then(function (cfg) {
      if (!cfg || !cfg.ok) throw new Error((cfg && cfg.message) || 'Bad config response');
      state.config = cfg;
      renderHero(cfg);
      if (cfg.open) buildForm(cfg.questions || []);
      onStage(function () {
        setLoading('');
        if (!cfg.open) {
          $('closedMessage').textContent = cfg.closedMessage || '';
          return show('closed', true);
        }
        show('signin', true);
        whenGsiReady(initGsi);
      });
    }).catch(function (err) {
      console.error(err);
      fatal('We could not load the nomination form. Please refresh the page in a minute.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
