/* pairux.com for Fire TV: remote-control navigation for any page in the WebView.
 *
 * Chromium's WebView scrolls on arrow keys instead of moving between links, so
 * the activity hands every D-pad press to pitNav() and OK to pitEnter(). Both
 * return a short string the activity acts on. Written in ES5 on purpose: Fire
 * OS 5 devices still ship WebView 70-something.
 */
(function () {
  if (window.__pitTV) return;
  window.__pitTV = true;

  var SEL = 'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),' +
    'select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
  var TEXT = /^(search|text|email|url|tel|number|password|)$/;
  var field = null; // the text field OK was pressed on, while the keyboard is up

  // The focus ring is set through CSSOM on the element itself: pairux.com (and
  // many sites) ship style-src 'self', which blocks an injected <style> but not
  // element.style. A TV needs a ring you can see from the couch.
  var RING = [['outline', '4px solid #3b82f6'], ['outline-offset', '3px'],
    ['box-shadow', '0 0 0 8px rgba(15,23,42,.85)']];
  function ring(el, on) {
    if (!el || !el.style) return;
    for (var i = 0; i < RING.length; i++) {
      if (on) el.style.setProperty(RING[i][0], RING[i][1], 'important');
      else el.style.removeProperty(RING[i][0]);
    }
  }
  var styled = false;
  function addStyle() {
    if (styled) return;
    styled = true;
    document.addEventListener('focusin', function (e) { ring(e.target, true); }, true);
    document.addEventListener('focusout', function (e) { ring(e.target, false); }, true);
    var a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement) ring(a, true);
  }

  function shown(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    for (var p = el; p && p.nodeType === 1; p = p.parentNode) {
      if (p.hidden || p.getAttribute('aria-hidden') === 'true' || p.inert) return false;
    }
    return true;
  }

  function isText(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return !el.readOnly;
    return el.tagName === 'INPUT' && TEXT.test((el.getAttribute('type') || '').toLowerCase()) && !el.readOnly;
  }

  function go(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    var r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight - 60) {
      window.scrollBy(0, r.top + r.height / 2 - window.innerHeight / 2);
    }
    return 'moved';
  }

  function scroll(dir) {
    var step = Math.round(window.innerHeight * 0.6);
    var before = window.pageYOffset;
    if (dir === 'down') window.scrollBy(0, step);
    else if (dir === 'up') window.scrollBy(0, -step);
    else return 'edge';
    return window.pageYOffset === before ? 'edge' : 'scrolled';
  }

  // Distance along the press direction, plus how far off-axis the target sits.
  // Overlapping ranges on the cross axis count as perfectly aligned.
  function gap(a1, a2, b1, b2) {
    if (b2 < a1) return a1 - b2;
    if (b1 > a2) return b1 - a2;
    return 0;
  }

  window.pitNav = function (dir) {
    addStyle();
    var cur = document.activeElement;
    var all = document.querySelectorAll(SEL);
    var vh = window.innerHeight, i, el, r;

    if (!cur || cur === document.body || cur === document.documentElement || !shown(cur)) {
      for (i = 0; i < all.length; i++) {
        el = all[i];
        if (!shown(el)) continue;
        r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) return go(el);
      }
      return scroll(dir);
    }

    var c = cur.getBoundingClientRect();
    var best = null, bestScore = Infinity, main, cross;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (el === cur || cur.contains(el) || el.contains(cur) || !shown(el)) continue;
      r = el.getBoundingClientRect();
      if (dir === 'down') { if (r.top < c.bottom - 4) continue; main = r.top - c.bottom; cross = gap(c.left, c.right, r.left, r.right); }
      else if (dir === 'up') { if (r.bottom > c.top + 4) continue; main = c.top - r.bottom; cross = gap(c.left, c.right, r.left, r.right); }
      else if (dir === 'right') { if (r.left < c.right - 4) continue; main = r.left - c.right; cross = gap(c.top, c.bottom, r.top, r.bottom); }
      else { if (r.right > c.left + 4) continue; main = c.left - r.right; cross = gap(c.top, c.bottom, r.top, r.bottom); }
      // Sideways moves only go to things on roughly the same row.
      if ((dir === 'left' || dir === 'right') && cross > c.height * 2) continue;
      var score = Math.max(main, 0) + cross * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }

    // Long gaps (a block of prose, a big image) are read by scrolling, not skipped.
    if ((dir === 'up' || dir === 'down') && (!best || bestScore > vh * 0.8)) {
      var moved = scroll(dir);
      if (moved === 'scrolled') return moved;
    }
    return best ? go(best) : 'edge';
  };

  // OK on the remote. Text fields go to the native Fire TV keyboard, which a
  // WebView never raises reliably; everything else is clicked here.
  window.pitEnter = function () {
    addStyle();
    var el = document.activeElement;
    if (!el || el === document.body) return 'none';
    if (isText(el)) {
      field = el;
      return 'text:' + JSON.stringify({
        value: el.value || '',
        hint: el.getAttribute('placeholder') || el.getAttribute('aria-label') || '',
        type: (el.getAttribute('type') || 'text').toLowerCase()
      });
    }
    if (el.tagName === 'SELECT') return 'native';
    el.click();
    return 'clicked';
  };

  // The keyboard's answer goes back into the field; a search box submits.
  window.pitFill = function (value) {
    var el = field && document.contains(field) ? field : document.activeElement;
    field = null;
    if (!isText(el)) return 'gone';
    el.value = value;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (el.form && (type === 'search' || el.name === 'q')) {
      if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit();
      return 'submitted';
    }
    return 'filled';
  };

  addStyle();
})();
