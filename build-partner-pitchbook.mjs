#!/usr/bin/env node
// Build the PARTNER PITCHBOOK as a GUIDED, SECTIONED walk-through (cover -> clickable
// contents -> one section per view with back/next), instead of one long scroll of tables.
//
// Cloned from the VC catalog builder, retargeted to a PUBLIC, partner-facing proposal:
// no passphrase gate (it is shared as a plain link), partner-appropriate section transforms.
//
// Content is SOURCED FROM the markdown (CIVIC-CHAIN-PARTNER-PITCHBOOK.md) at build time and
// split client-side into sections, so an edit to the pitchbook flows straight to the page.
// Fonts, logos, civic-grid texture, and the renderer are inlined as data-URIs => ZERO external
// calls once built.
//
// Usage:
//   node build-partner-pitchbook.mjs            -> site-preview/index.html  (for review)
//   node build-partner-pitchbook.mjs --deploy   -> site/index.html          (for deploy)
//   (both are the same public page; --deploy just writes to the published site/ folder)
//
// Brand source: https://civicchain-v2.vercel.app (DM Serif Text/DM Sans, logos, civic-grid.svg).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const SRC = 'CIVIC-CHAIN-PARTNER-PITCHBOOK.md';
const ITER = 250000;
const BRAND = 'https://civicchain-v2.vercel.app';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';
const WORDS = ['harbor','ledger','quorum','granite','beacon','tide','charter','summit','anchor','maple','cobalt','mercer','vantage','haven','sterling','compass'];

function genPass() {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return [...b].map(i => WORDS[i % WORDS.length]).join('-') + '-' + (crypto.getRandomValues(new Uint8Array(1))[0] % 90 + 10);
}
const b64 = (buf) => Buffer.from(buf).toString('base64');
const text = async (url) => (await fetch(url, { headers: { 'User-Agent': UA } })).text();
const svgDataUri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);

async function inlineFonts() {
  const url = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Text:ital@0;1&display=swap';
  try {
    let css = await text(url);
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map(m => m[1]))];
    for (const u of urls) {
      const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
      css = css.split(u).join('data:font/woff2;base64,' + buf.toString('base64'));
    }
    return { style: `<style>${css}</style>`, kb: css.length / 1024 };
  } catch (e) {
    console.warn('font inline failed (' + e.message + '); falling back to Google Fonts <link>');
    return { style: `<link rel="stylesheet" href="${url}">`, kb: 0 };
  }
}

async function inlineBrand() {
  try {
    const [wordmark, icon, grid] = await Promise.all([
      text(BRAND + '/brand/civic-logo-w-text-horizontal.svg'),
      text(BRAND + '/brand/civic-chain-logo.svg'),
      text(BRAND + '/design-assets/bg-textures/civic-grid.svg'),
    ]);
    return { ok: true, wordmark: svgDataUri(wordmark), icon: svgDataUri(icon), grid: svgDataUri(grid) };
  } catch (e) {
    console.warn('brand asset fetch failed (' + e.message + '); using text wordmark');
    return { ok: false };
  }
}

// ---- The client-side app. Serialized via .toString(); never executed in Node. References
// browser globals (document, crypto, atob, marked) and the injected MODE / MD / DATA consts. ----
function clientApp() {
  function decB64(s){ return Uint8Array.from(atob(s), function(c){ return c.charCodeAt(0); }); }
  function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function stripRule(s){ return s.replace(/\s*\n-{3,}\s*$/,'').trim(); }

  function splitSections(md){
    var parts = md.split(/\n(?=## )/);
    var intro = stripRule(parts[0]);
    var secs = parts.slice(1).map(function(raw){
      var nl = raw.indexOf('\n');
      var head = (nl < 0 ? raw : raw.slice(0, nl)).replace(/^##\s*/, '').trim();
      return { title: head, md: stripRule(raw) };
    });
    return { intro: intro, secs: secs };
  }

  // ---- M2: read a <table> into { headers:[], rows:[[]] } (keeps inner HTML / formatting) ----
  function readTable(t){
    var headers = [].map.call(t.querySelectorAll('thead th'), function(th){ return th.innerHTML.trim(); });
    var rows = [].map.call(t.querySelectorAll('tbody tr'), function(tr){
      return [].map.call(tr.children, function(td){ return td.innerHTML.trim(); });
    });
    return { headers: headers, rows: rows };
  }
  function swap(oldEl, html){
    var w = document.createElement('div'); w.innerHTML = html;
    oldEl.replaceWith(w.firstElementChild);
  }
  function stripTags(s){ return s.replace(/<[^>]*>/g, '').trim(); }

  // ---- Acronym tooltips: define each term on hover/tap, first occurrence per view. ----
  var GLOSSARY = {
    'TLaaS': 'Transparency Layer as a Service: Civic-Chain’s public-record product, the entry product.',
    'BEAD': 'Broadband Equity, Access, and Deployment: the federal broadband grant program.',
    'IIJA': 'Infrastructure Investment and Jobs Act: the 2021 federal infrastructure law.',
    'ARPA': 'American Rescue Plan Act: federal recovery funding to states and localities.',
    'TIF': 'Tax Increment Financing: funding public projects against future tax growth in a district.',
    'IoT': 'Internet of Things: connected sensors and devices.',
    'SOC 2': 'A standard security and controls audit.',
    'SaaS': 'Software as a Service: subscription software.'
  };
  function glossRx(){
    var keys = Object.keys(GLOSSARY).sort(function(a, b){ return b.length - a.length; });
    var e = function(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    return new RegExp('(?<![A-Za-z0-9])(' + keys.map(e).join('|') + ')(?![A-Za-z0-9])', 'g');
  }
  function glossarize(root){
    if (!root) return;
    var rx = glossRx(), used = {};
    root.querySelectorAll('p, li, blockquote, dd').forEach(function(block){
      var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null), tns = [], n;
      while ((n = walker.nextNode())){
        var bad = false, p = n.parentNode;
        while (p && p !== block){ var tag = p.nodeName.toLowerCase(); if (tag === 'a' || tag === 'code' || tag === 'abbr') { bad = true; break; } p = p.parentNode; }
        if (!bad) tns.push(n);
      }
      tns.forEach(function(tn){
        var txt = tn.nodeValue, hits = [], m; rx.lastIndex = 0;
        while ((m = rx.exec(txt))){ if (!used[m[1]]){ used[m[1]] = true; hits.push({ i: m.index, w: m[1] }); } }
        if (!hits.length) return;
        var frag = document.createDocumentFragment(), last = 0;
        hits.forEach(function(h){
          frag.appendChild(document.createTextNode(txt.slice(last, h.i)));
          var ab = document.createElement('abbr'); ab.className = 'gl'; ab.setAttribute('data-def', GLOSSARY[h.w]); ab.textContent = h.w;
          frag.appendChild(ab); last = h.i + h.w.length;
        });
        frag.appendChild(document.createTextNode(txt.slice(last)));
        tn.parentNode.replaceChild(frag, tn);
      });
    });
  }

  // M3: the land-and-expand ladder, built from the §2 rung rows (same source, not forked).
  function ladderFrom(rows){
    var lift = [0, 2, 1];
    var steps = rows.map(function(r, i){
      var rung = stripTags(r[0]);
      var ci = rung.indexOf(',');
      var num = ci < 0 ? rung : rung.slice(0, ci).trim();
      var tag = ci < 0 ? '' : rung.slice(ci + 1).trim();
      var peak = /prize/i.test(tag);
      return '<div class="lstep' + (peak ? ' peak' : '') + '" style="--lift:' + (lift[i] || 0) + '">' +
        '<span class="ln">' + num + '</span><b>' + stripTags(r[1]) + '</b>' +
        '<span class="lr">' + (tag || '&nbsp;') + '</span></div>';
    }).join('');
    return '<figure class="ladder"><div class="lhead"><span class="lstart">Start low</span>' +
      '<span class="lend">Expand up</span></div>' +
      '<div class="lsteps">' + steps + '</div>' +
      '<figcaption>A town starts with the low-cost wedge and expands to the payment product and the upsell over time, the same town spending more, with no new sale for you.</figcaption></figure>';
  }

  // Cover: promote the thesis deck, box the reconciliation hook, demote the front-matter.
  function coverHero(el){
    if (!el) return;
    var cta = el.querySelector('.cta');
    [].slice.call(el.querySelectorAll('p')).forEach(function(p){
      var t = p.textContent;
      if (/^Created:/.test(t)){ p.classList.add('doc-meta'); if (cta) el.insertBefore(p, cta); }
      else if (/^What this is/.test(t)){ p.classList.add('deck'); }
      else if (/^The offer/.test(t)){ p.classList.add('hook'); }
    });
  }

  function miItem(k, v){ return (v && v !== '—') ? '<div class="mi"><dt>' + k + '</dt><dd>' + v + '</dd></div>' : ''; }

  // §2 product-line table -> land-and-expand ladder (hero) + rung cards.
  function rungCards(el){
    var t = el.querySelector('table'); if (!t) return;
    var d = readTable(t);
    t.insertAdjacentHTML('beforebegin', ladderFrom(d.rows));
    var mi = miItem;
    var cards = d.rows.map(function(r){
      var meta = '';
      for (var c = 2; c < d.headers.length; c++) meta += mi(d.headers[c], r[c]);
      return '<div class="rung"><div class="rung-badge">' + r[0] + '</div>' +
        '<div class="rung-name">' + r[1] + '</div><dl class="rung-meta">' + meta + '</dl></div>';
    }).join('');
    swap(t, '<div class="rungs">' + cards + '</div>');
  }

  // §3 ARPU-build table (the one containing "Blended ARPU") -> before/after tiles.
  function arpuTiles(el){
    var t = null;
    el.querySelectorAll('table').forEach(function(x){ if (/Blended ARPU/i.test(x.textContent)) t = x; });
    if (!t) return;
    var d = readTable(t);
    function col(idx){
      return d.rows.map(function(r){
        var total = /Blended ARPU/i.test(r[0]);
        return '<div class="al' + (total ? ' total' : '') + '"><span class="alk">' + r[0] + '</span><span class="alv">' + r[idx] + '</span></div>';
      }).join('');
    }
    swap(t, '<div class="arpu">' +
      '<div class="arpu-col"><div class="arpu-h">' + d.headers[1] + '</div>' + col(1) + '</div>' +
      '<div class="arpu-arrow">grows to</div>' +
      '<div class="arpu-col hi"><div class="arpu-h">' + d.headers[2] + '</div>' + col(2) + '</div></div>');
  }

  // §5 inline "Signed CARR -> ... -> NRR" code line -> a visual flow of chips.
  function carrFlow(el){
    var code = null;
    el.querySelectorAll('code').forEach(function(c){ if (/Signed CARR/.test(c.textContent)) code = c; });
    if (!code) return;
    var chips = code.textContent.split('→').map(function(p, i){
      p = p.trim();
      var gap = /Chasm/i.test(p);
      var label = p.replace(/^[\[\(]\s*/, '').replace(/\s*[\]\)]$/, '');
      return (i ? '<span class="flow-arrow">then</span>' : '') +
        '<span class="flow-chip' + (gap ? ' gap' : '') + '">' + esc(label) + '</span>';
    }).join('');
    var host = code.closest('p') || code;
    swap(host, '<div class="flow">' + chips + '</div>');
  }

  // §9 roadmap table -> a banner of half-circle arcs with a ball bouncing across them,
  // plus a selectable summary card with demo links. Built from the table (same source).
  function roadmapBanner(el){
    var t = el.querySelector('table'); if (!t) return;
    var d = readTable(t); // Stage | Vertical | Streams | TAM | Summary | Demo
    var items = d.rows.map(function(r){
      var demo = stripTags(r[5]); if (demo === '—' || demo === '') demo = '';
      return { stage: stripTags(r[0]), name: r[1], short: stripTags(r[1]).split(/ \+ | \(/)[0].trim(), streams: r[2], tam: r[3], summary: r[4], demo: demo };
    });
    var n = items.length, W = 1000, baseY = 128, pad = 70;
    var step = (W - 2 * pad) / n, r = step / 2, pts = [];
    for (var i = 0; i <= n; i++) pts.push(pad + i * step);
    var dPath = 'M ' + pts[0] + ' ' + baseY;
    for (var j = 1; j <= n; j++) dPath += ' A ' + r + ' ' + r + ' 0 0 1 ' + pts[j] + ' ' + baseY; // sweep=1 -> humps upward
    var nodes = pts.map(function(x){ return '<circle cx="' + x + '" cy="' + baseY + '" r="3.5" class="rm-node"/>'; }).join('');
    // bounce across one arc, then hold ~1s at the valley before the next bounce
    var moveT = 1.5, pauseT = 1.0, dur = (moveT + pauseT) * n;
    var kp = ['0'], kt = ['0'], tAcc = 0;
    for (var a = 0; a < n; a++){
      tAcc += moveT; kp.push(((a + 1) / n).toFixed(4)); kt.push((tAcc / dur).toFixed(4));
      tAcc += pauseT; kp.push(((a + 1) / n).toFixed(4)); kt.push((tAcc / dur).toFixed(4));
    }
    var svg = '<svg class="rm-svg" viewBox="0 0 ' + W + ' 150" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<path id="rmtrack" class="rm-track" fill="none" d="' + dPath + '"/>' + nodes +
      '<circle class="rm-dot" r="8"><animateMotion dur="' + dur + 's" repeatCount="indefinite" rotate="0" calcMode="linear" keyPoints="' + kp.join(';') + '" keyTimes="' + kt.join(';') + '"><mpath xlink:href="#rmtrack"/></animateMotion></circle>' +
      '</svg>';
    var labels = '<div class="rm-labels" style="--n:' + n + '">' + items.map(function(it, i){
      return '<button class="rm-lab" data-i="' + i + '"><span class="rm-stage">' + it.stage + '</span>' + esc(it.short) + '</button>';
    }).join('') + '</div>';
    swap(t, '<div class="rmbanner">' + svg + labels + '<p class="rm-hint">Select a product to see how it earns and its live demo</p><div class="rm-card" id="rmcard"></div></div>');

    var banner = el.querySelector('.rmbanner');
    function select(i){
      var it = items[i];
      banner.querySelectorAll('.rm-lab').forEach(function(b, bi){ b.classList.toggle('on', bi === i); });
      var demo = it.demo
        ? '<a class="rm-demo" href="' + it.demo + '" target="_blank" rel="noopener">Learn more</a>'
        : '';
      banner.querySelector('#rmcard').innerHTML =
        '<div class="rm-cstage">' + it.stage + '</div><div class="rm-ctitle">' + it.name + '</div>' +
        '<div class="rm-cmeta"><div class="rm-mi"><span class="rmk">Revenue</span><span class="rmv">' + it.streams + '</span></div>' +
        '<div class="rm-mi"><span class="rmk">Where it applies</span><span class="rmv">' + it.tam + '</span></div></div>' +
        '<p class="rm-csum">' + it.summary + '</p>' + demo;
    }
    banner.querySelectorAll('.rm-lab').forEach(function(b){
      b.addEventListener('click', function(){ select(parseInt(b.getAttribute('data-i'), 10)); });
    });
    select(0);
  }

  // split a list item into { title (bold lead), body, role (trailing *italic*) }
  function liParts(li, keepHtml){
    var c = li.cloneNode(true);
    var s = c.querySelector('strong'); var title = s ? s.textContent.replace(/[.,:]\s*$/, '').trim() : ''; if (s) s.remove();
    var e = keepHtml ? null : c.querySelector('em'); var role = e ? e.textContent.trim() : ''; if (e) e.remove();
    var body = (keepHtml ? c.innerHTML : c.textContent).replace(/^[\s,.:]+/, '').replace(/\s+/g, ' ').trim();
    return { title: title, body: body, role: role };
  }

  // §1 three-layer bullet list -> "three places to sell" tiles.
  function thesisTiles(el){
    var ul = el.querySelector('ul'); if (!ul) return;
    var lis = [].slice.call(ul.querySelectorAll(':scope > li')); if (lis.length < 2) return;
    var tiles = lis.map(function(li){
      var p = liParts(li, false);
      return '<div class="tile"><div class="t-h">' + esc(p.title) + '</div><div class="t-b">' + esc(p.body) + '</div>' +
        (p.role ? '<span class="t-f">' + esc(p.role) + '</span>' : '') + '</div>';
    }).join('');
    swap(ul, '<div class="tiles">' + tiles + '</div>');
  }

  // §6 moat ordered list -> ranked cards (strongest first is emphasized).
  function moatCards(el){
    var ol = el.querySelector('ol'); if (!ol) return;
    var lis = [].slice.call(ol.querySelectorAll(':scope > li')); if (lis.length < 2) return;
    var cards = lis.map(function(li, i){
      var p = liParts(li, true);
      return '<div class="mcard' + (i === 0 ? ' top' : '') + '"><span class="mn">' + (i + 1) + '</span>' +
        '<div class="mh">' + esc(p.title) + '</div><div class="mb">' + p.body + '</div></div>';
    }).join('');
    swap(ol, '<div class="moat">' + cards + '</div>');
  }

  // §8 "The PMF bar ..." paragraph -> three 80% tiles (additive; prose kept).
  function pmfTiles(el){
    var p = null;
    el.querySelectorAll('p').forEach(function(x){ if (/^The PMF bar/.test(x.textContent)) p = x; });
    if (!p) return;
    var m = p.textContent.match(/We call PMF when (.+?)\./i); if (!m) return;
    var parts = m[1].split(/,?\s*(?:and\s+)?(?=80%)/).filter(function(s){ return /80%/.test(s); });
    if (parts.length < 3) return;
    var tiles = parts.slice(0, 3).map(function(s){
      return '<div class="pmf-t"><div class="pmf-n">80%</div><div class="pmf-l">' +
        esc(s.replace(/^80%\s*/, '').replace(/\s+/g, ' ').trim()) + '</div></div>';
    }).join('');
    p.insertAdjacentHTML('beforebegin', '<div class="pmf">' + tiles + '</div>');
  }

  // "How we work together" table (first header "Step") -> horizontal step timeline.
  function stepTimeline(el){
    var t = null;
    el.querySelectorAll('table').forEach(function(x){ var th = x.querySelector('thead th'); if (!t && th && /^(step|window)/i.test(th.textContent.trim())) t = x; });
    if (!t) t = el.querySelector('table');
    if (!t) return;
    var d = readTable(t); // Step | Phase | Who does what
    var steps = d.rows.map(function(r){
      return '<div class="tl-step"><div class="tl-win">' + r[0] + '</div><div class="tl-phase">' + r[1] + '</div><div class="tl-move">' + r[2] + '</div></div>';
    }).join('');
    swap(t, '<div class="timeline" style="--n:' + d.rows.length + '">' + steps + '</div>');
  }

  // Any table not turned into a visual stays a real table; give it a horizontal scroll box
  // so it never widens the viewport on a phone (body is overflow-x:clip).
  function wrapTables(root){
    if (!root) return;
    root.querySelectorAll('table').forEach(function(t){
      if (t.closest('.tscroll')) return;
      var w = document.createElement('div'); w.className = 'tscroll';
      t.parentNode.insertBefore(w, t); w.appendChild(t);
    });
  }

  // Partner pitchbook section map:
  //  1 Why/now (ul -> tiles) · 2 Product ladder (table -> ladder+cards) · 4 Why-fit (ol -> ranked cards)
  //  5 The offer (ul -> tiles) · 6 How we work (table -> step timeline) · 7 Roadmap (table -> banner)
  function enhance(el, title){
    if (!el) return;
    if (/^1\./.test(title)) thesisTiles(el);
    else if (/^2\./.test(title)) rungCards(el);
    else if (/^4\./.test(title)) moatCards(el);
    else if (/^5\./.test(title)) thesisTiles(el);
    else if (/^6\./.test(title)) stepTimeline(el);
    else if (/^7\./.test(title)) roadmapBanner(el);
  }

  var state = { secs: [], intro: '', idx: 0 }; // idx: 0=cover, 1=contents, 2+=section (idx-2)

  function setBar(){
    var label = document.getElementById('barsec');
    var prog = document.getElementById('barprog');
    if (state.idx === 0){ label.textContent = ''; prog.textContent = ''; }
    else if (state.idx === 1){ label.textContent = 'Contents'; prog.textContent = ''; }
    else { var i = state.idx - 2; label.textContent = state.secs[i].title; prog.textContent = (i + 1) + ' / ' + state.secs.length; }
  }

  function navRow(i){
    var prev = i > 0
      ? '<button class="navbtn" data-sec="' + (i - 1) + '"><span class="nd">Previous</span><span class="nt">' + esc(state.secs[i - 1].title) + '</span></button>'
      : '<button class="navbtn" data-go="contents"><span class="nd">Back</span><span class="nt">Contents</span></button>';
    var next = i < state.secs.length - 1
      ? '<button class="navbtn next" data-sec="' + (i + 1) + '"><span class="nd">Next</span><span class="nt">' + esc(state.secs[i + 1].title) + '</span></button>'
      : '<button class="navbtn next" data-go="contents"><span class="nd">Done</span><span class="nt">Back to contents</span></button>';
    return '<nav class="secnav">' + prev + next + '</nav>';
  }

  function render(){
    var vp = document.getElementById('viewport');
    if (state.idx === 0){
      vp.innerHTML = '<section class="cover">' + marked.parse(state.intro) +
        '<div class="cta"><button class="btn" data-go="contents">View contents</button></div></section>';
      coverHero(vp.querySelector('.cover'));
      glossarize(vp.querySelector('.cover'));
    } else if (state.idx === 1){
      var items = state.secs.map(function(s, i){
        var n = (i + 1 < 10 ? '0' : '') + (i + 1);
        return '<button class="toc" data-sec="' + i + '"><span class="toc-n">' + n + '</span><span class="toc-t">' + esc(s.title) + '</span></button>';
      }).join('');
      vp.innerHTML = '<section class="contents"><p class="eyebrow">Partnership proposal</p><h2 class="vh">Contents</h2>' +
        '<div class="toc-list">' + items + '</div>' +
        '<div class="cta"><button class="btn" data-go="first">Start reading</button></div></section>';
    } else {
      var idx = state.idx - 2;
      var s = state.secs[idx];
      vp.innerHTML = '<article class="section">' + marked.parse(s.md) + '</article>' + navRow(idx);
      enhance(vp.querySelector('.section'), s.title);
      wrapTables(vp.querySelector('.section'));
      glossarize(vp.querySelector('.section'));
    }
    setBar();
    wire();
    window.scrollTo(0, 0);
  }

  function goSec(i){ state.idx = 2 + i; render(); }

  function wire(){
    var vp = document.getElementById('viewport');
    vp.querySelectorAll('[data-sec]').forEach(function(b){
      b.addEventListener('click', function(){ goSec(parseInt(b.getAttribute('data-sec'), 10)); });
    });
    vp.querySelectorAll('[data-go]').forEach(function(b){
      b.addEventListener('click', function(){
        var g = b.getAttribute('data-go');
        if (g === 'contents') state.idx = 1;
        else if (g === 'first') state.idx = 2;
        else if (g === 'cover') state.idx = 0;
        render();
      });
    });
  }

  function boot(md){
    var footerMd = '';
    var fi = md.indexOf('<!-- footer -->');
    if (fi >= 0){ footerMd = md.slice(fi + 15).trim(); md = md.slice(0, fi).trim(); }
    var parsed = splitSections(md);
    state.secs = parsed.secs;
    state.intro = parsed.intro;
    state.idx = 0;
    document.getElementById('appfooter').innerHTML = footerMd ? marked.parse(footerMd) : '';
    document.getElementById('app').style.display = 'block';
    document.getElementById('bar').style.display = 'flex';
    render();
  }

  // Top-bar controls (wired once).
  document.getElementById('bar-home').addEventListener('click', function(){ state.idx = 0; render(); });
  document.getElementById('bar-toc').addEventListener('click', function(){ state.idx = 1; render(); });

  // Tap an acronym to toggle its definition (mobile + a11y); hover handles desktop.
  document.addEventListener('click', function(e){
    var g = e.target && e.target.closest ? e.target.closest('.gl') : null;
    document.querySelectorAll('.gl.on').forEach(function(x){ if (x !== g) x.classList.remove('on'); });
    if (g){ g.classList.toggle('on'); e.stopPropagation(); }
  });

  // Keyboard paging across sections.
  document.addEventListener('keydown', function(e){
    if (document.getElementById('app').style.display === 'none') return;
    if (e.key === 'ArrowRight' && state.idx >= 2 && state.idx - 2 < state.secs.length - 1){ state.idx++; render(); }
    if (e.key === 'ArrowLeft' && state.idx > 0){ state.idx--; render(); }
  });

  // Public pitchbook: no gate, boot straight into the content.
  boot(MD);
}

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const doDeploy = args.includes('--deploy');
const markdown = readFileSync(SRC, 'utf8');
const marked = await text('https://cdn.jsdelivr.net/npm/marked@12/marked.min.js');
const fonts = await inlineFonts();
const brand = await inlineBrand();

const barLogo  = brand.ok ? `<img class="barlogo" src="${brand.wordmark}" alt="Civic Chain">` : `<span class="barword">Civic Chain</span>`;
const gateMark = brand.ok ? `<img class="mark" src="${brand.icon}" alt="" aria-hidden="true">` : '';
const gateLogo = brand.ok ? `<img class="brandmark" src="${brand.wordmark}" alt="Civic Chain">` : `<div class="brand">Civic Chain</div>`;
const gridBg   = brand.ok ? `background-image:url("${brand.grid}");` : '';
const favicon  = brand.ok ? `<link rel="icon" type="image/svg+xml" href="${brand.icon}">` : '';

const STYLE = `<style>
  :root{
    --cream-50:#fffbf4;--cream-100:#fcf8f1;--cream-200:#f5f1ea;--cream-300:#eeebe4;--cream-700:#776e5b;--cream-800:#5d574c;
    --blue-100:#e9eaf5;--blue-700:#3d3c86;--blue-800:#262067;--blue-900:#12004a;
    --gold-200:#f5e5d3;--gold-300:#ebdbc9;--gold-600:#805b2c;--gold-700:#633f0c;
    --green-700:#465c4a;
    --bg:var(--cream-200);--surface:var(--cream-50);--ink:var(--blue-900);--display:var(--blue-800);
    --muted:var(--cream-700);--border:rgba(18,0,74,.12);--accent:var(--gold-700);--link:var(--green-700);
    --serif:"DM Serif Text",Georgia,"Times New Roman",serif;
    --sans:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box}
  html{overflow-x:clip}
  body{margin:0;overflow-x:clip;font-family:var(--sans);color:var(--ink);background-color:var(--bg);${gridBg}line-height:1.62;-webkit-font-smoothing:antialiased}
  /* ---- Gate ---- */
  .gate{min-height:100vh;display:none;align-items:center;justify-content:center;padding:24px}
  .gcard{position:relative;overflow:hidden;background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);border-radius:14px;max-width:460px;width:100%;padding:44px 40px;box-shadow:0 18px 50px rgba(18,0,74,.12)}
  .gcard .mark{position:absolute;right:-22px;bottom:-28px;width:172px;height:auto;opacity:.06;pointer-events:none}
  .gcard > *{position:relative}
  .brandmark{height:40px;width:auto;display:block;margin-bottom:14px}
  .brand{font-size:12px;letter-spacing:.26em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:8px}
  .gcard h1{font-family:var(--serif);font-weight:400;font-size:30px;line-height:1.15;margin:.1em 0 .25em;color:var(--display)}
  .gcard p.sub{color:var(--cream-700);font-size:14.5px;margin:.2em 0 1.5em}
  label{display:block;font-size:12.5px;font-weight:600;margin-bottom:7px}
  input[type=password]{width:100%;padding:13px 15px;font-size:16px;font-family:var(--sans);border:1px solid var(--border);border-radius:9px;background:#fff;color:var(--ink)}
  input[type=password]:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(99,63,12,.16)}
  #f button{margin-top:18px;width:100%;padding:13px;font-size:15px;font-weight:700;font-family:var(--sans);color:var(--cream-50);background:var(--blue-900);border:0;border-radius:9px;cursor:pointer}
  #f button:hover{background:var(--blue-800)}
  .err{color:#9a1b1b;font-size:13px;margin-top:12px;min-height:18px}
  .notice{margin-top:24px;padding-top:18px;border-top:1px solid var(--border);font-size:11.5px;color:var(--cream-700);line-height:1.55}
  /* ---- Sticky bar ---- */
  .bar{position:sticky;top:0;z-index:5;background:var(--blue-900);color:var(--cream-50);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;padding:9px 20px;display:none;justify-content:space-between;align-items:center;gap:14px}
  .bar .barleft{display:flex;align-items:center;gap:13px;min-width:0}
  .barlogo{height:15px;width:auto;display:block;filter:brightness(0) invert(1);opacity:.95}
  .bar button{background:none;border:0;color:var(--cream-50);font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer;opacity:.78;padding:0}
  .bar button:hover{opacity:1}
  .bar .barsec{color:var(--gold-300);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar .barprog{opacity:.6;font-variant-numeric:tabular-nums;white-space:nowrap}
  .bar .sep{opacity:.3}
  /* ---- App shell ---- */
  #app{display:none}
  .wrap{max-width:860px;margin:0 auto;padding:40px 28px 40px;min-height:62vh}
  #appfooter{max-width:860px;margin:0 auto;padding:18px 28px 60px;font-size:11.5px;color:var(--muted);line-height:1.55;border-top:1px solid var(--border)}
  #appfooter p{margin:0;max-width:72ch}
  #appfooter em{font-style:italic}
  .btn{font-family:var(--sans);font-weight:700;font-size:15px;color:var(--cream-50);background:var(--blue-900);border:0;border-radius:10px;padding:13px 26px;cursor:pointer;transition:background .15s}
  .btn:hover{background:var(--blue-800)}
  .cta{margin-top:34px}
  /* ---- Cover ---- */
  .cover h1{font-family:var(--serif);font-weight:400;font-size:clamp(32px,5vw,46px);line-height:1.12;color:var(--display);margin:.1em 0 .5em;padding-bottom:.3em;border-bottom:2px solid var(--accent)}
  .cover p{font-size:16px;max-width:62ch}
  .cover strong{color:var(--blue-800)}
  .cover em{color:var(--cream-800)}
  /* ---- Contents ---- */
  .eyebrow{font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:var(--accent);font-weight:700;margin:0 0 6px}
  .vh{font-family:var(--serif);font-weight:400;font-size:32px;color:var(--display);margin:0 0 24px}
  .toc-list{display:grid;gap:10px}
  .toc{display:flex;align-items:baseline;gap:16px;width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:10px;padding:15px 18px;cursor:pointer;font-family:var(--sans);font-size:16px;color:var(--ink);transition:transform .12s,box-shadow .12s}
  .toc:hover{transform:translateX(3px);box-shadow:0 8px 20px rgba(18,0,74,.08)}
  .toc-n{font-family:var(--serif);font-size:15px;color:var(--accent);min-width:24px}
  .toc-t{font-weight:500}
  /* ---- Section view ---- */
  .section h2{font-family:var(--serif);font-weight:400;font-size:clamp(26px,4vw,34px);line-height:1.15;color:var(--display);border-bottom:2px solid var(--accent);padding-bottom:.26em;margin:0 0 .7em}
  .section h3{font-family:var(--sans);font-weight:700;font-size:16.5px;margin-top:1.7em;color:var(--blue-800)}
  .section p,.section li{font-size:15.5px}
  .section strong{color:var(--blue-800)}
  .section em{color:var(--cream-800)}
  .section a{color:var(--link);text-decoration:underline}
  .section code{background:var(--cream-300);padding:.12em .42em;border-radius:5px;font-size:.88em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .section hr{border:0;border-top:1px solid var(--border);margin:2.2em 0}
  .section blockquote{border-left:3px solid var(--accent);margin:1.4em 0;padding:.6em 1.3em;background:var(--gold-200);color:var(--blue-800);border-radius:0 8px 8px 0}
  .section blockquote p{font-size:15px;margin:.3em 0}
  .section table{border-collapse:collapse;width:100%;margin:1.3em 0;font-size:13.5px;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
  .section th,.section td{border-bottom:1px solid var(--border);border-right:1px solid var(--border);padding:10px 13px;text-align:left;vertical-align:top}
  .section th{background:var(--blue-900);color:var(--cream-50);font-weight:600}
  .section tr:nth-child(even) td{background:var(--cream-100)}
  .section td:last-child,.section th:last-child{border-right:0}
  /* Wide tables scroll inside their own box (body is overflow-clipped) instead of breaking the layout. */
  .tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:1.3em 0;border-radius:10px;max-width:100%}
  .tscroll>table{margin:0}
  /* ---- Section nav ---- */
  .secnav{display:flex;gap:12px;margin-top:46px;padding-top:22px;border-top:1px solid var(--border)}
  .navbtn{flex:1;display:flex;flex-direction:column;gap:3px;background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:13px 17px;cursor:pointer;font-family:var(--sans);color:var(--ink);transition:border-color .12s,box-shadow .12s;min-width:0}
  .navbtn:hover{border-color:var(--accent);box-shadow:0 8px 20px rgba(18,0,74,.07)}
  .navbtn.next{text-align:right;align-items:flex-end}
  .navbtn .nd{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:700}
  .navbtn .nt{font-weight:600;font-size:14.5px;max-width:100%;overflow-wrap:anywhere;line-height:1.25}
  /* ---- M2: cover hero pieces ---- */
  .cover .deck{font-size:19px;color:var(--blue-800);line-height:1.5;max-width:60ch}
  .cover .hook{background:var(--gold-200);border-left:3px solid var(--accent);padding:14px 20px;border-radius:0 10px 10px 0;font-size:15px;color:var(--blue-800);margin:1.4em 0}
  .cover .doc-meta{font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:14px;margin:26px 0 0;line-height:1.5}
  /* ---- M2: rung cards (replaces the §2 product-line table) ---- */
  .rungs{display:grid;gap:16px;margin:1.4em 0}
  .rung{position:relative;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:12px;padding:18px 20px}
  .rung-badge{display:inline-block;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:5px}
  .rung-name{font-family:var(--serif);font-weight:400;font-size:21px;color:var(--display);line-height:1.2;margin-bottom:14px}
  .rung-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:13px 18px;margin:0}
  .mi dt{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:3px}
  .mi dd{margin:0;font-size:13.5px;color:var(--ink);line-height:1.45}
  /* ---- M2: ARPU before/after tiles (replaces the §3 ARPU build table) ---- */
  .arpu{display:flex;align-items:stretch;gap:14px;margin:1.4em 0;flex-wrap:wrap}
  .arpu-col{flex:1;min-width:210px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px}
  .arpu-col.hi{border-top:3px solid var(--accent)}
  .arpu-h{font-weight:700;font-size:13px;color:var(--display);margin-bottom:12px;padding-bottom:9px;border-bottom:1px solid var(--border)}
  .al{display:flex;justify-content:space-between;gap:12px;font-size:13.5px;padding:5px 0}
  .al .alk{color:var(--muted)}
  .al .alv{font-variant-numeric:tabular-nums;text-align:right}
  .al.total{margin-top:7px;padding-top:11px;border-top:1px solid var(--border);font-weight:700;color:var(--display);font-size:15.5px}
  .al.total .alk{color:var(--display)}
  .arpu-arrow{display:flex;align-items:center;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
  @media(max-width:560px){.arpu{flex-direction:column}.arpu-arrow{transform:none;width:100%;justify-content:center;padding:4px 0}}
  /* ---- M2: CARR -> ARR flow (replaces the §5 inline-code line) ---- */
  .flow{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin:1.4em 0;padding:18px;background:var(--surface);border:1px solid var(--border);border-radius:12px}
  .flow-chip{background:var(--blue-900);color:var(--cream-50);padding:9px 15px;border-radius:9px;font-size:13px;font-weight:600;line-height:1.3}
  .flow-chip.gap{background:var(--gold-200);color:var(--gold-700);border:1px dashed var(--accent);font-style:italic;font-weight:500}
  .flow-arrow{color:var(--muted);font-weight:700;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase}
  /* ---- acronym tooltips ---- */
  .gl{border-bottom:1px dotted var(--accent);cursor:help;position:relative;text-decoration:none;font-weight:inherit;font-style:inherit}
  .gl::after{content:attr(data-def);position:absolute;left:0;bottom:142%;background:var(--blue-900);color:var(--cream-50);font-family:var(--sans);font-size:12px;font-weight:400;font-style:normal;line-height:1.45;letter-spacing:0;text-transform:none;padding:9px 12px;border-radius:9px;width:max-content;max-width:min(280px,78vw);box-shadow:0 10px 26px rgba(18,0,74,.28);opacity:0;visibility:hidden;transition:opacity .12s;z-index:20;pointer-events:none;white-space:normal}
  .gl:hover::after,.gl.on::after{opacity:1;visibility:visible}
  /* ---- M3: land-and-expand ladder (built from §2 rung data) ---- */
  .ladder{margin:0 0 1.7em;padding:20px 20px 16px;background:var(--surface);border:1px solid var(--border);border-radius:12px}
  .ladder .lhead{display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:var(--muted)}
  .ladder .lend{color:var(--accent)}
  .lsteps{display:flex;align-items:flex-end;gap:12px;padding:30px 0 6px}
  .lstep{flex:1;transform:translateY(calc(var(--lift,0) * -24px));background:var(--cream-100);border:1px solid var(--border);border-bottom:3px solid var(--accent);border-radius:10px;padding:12px 13px;min-width:0}
  .lstep.peak{background:var(--blue-900);border-color:var(--blue-900)}
  .lstep.peak .ln{color:var(--gold-300)}
  .lstep.peak b,.lstep.peak .lr{color:var(--cream-50)}
  .lstep .ln{display:block;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:4px}
  .lstep b{display:block;font-family:var(--serif);font-weight:400;font-size:16px;color:var(--display);line-height:1.15;margin-bottom:4px}
  .lstep .lr{display:block;font-size:11.5px;color:var(--muted);line-height:1.3}
  .ladder figcaption{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}
  @media(max-width:560px){.lstep{transform:none}.lsteps{align-items:stretch;flex-direction:column}}
  /* ---- M4: roadmap journey banner (bouncing ball over half-circle arcs) ---- */
  .rmbanner{margin:1.4em 0}
  .rm-svg{width:100%;height:auto;display:block;overflow:visible}
  .rm-track{stroke:var(--accent);stroke-width:2.5;stroke-dasharray:3 7;opacity:.5}
  .rm-node{fill:var(--accent);opacity:.65}
  .rm-dot{fill:var(--blue-900);stroke:#fff;stroke-width:2}
  .rm-labels{display:grid;grid-template-columns:repeat(var(--n,4),1fr);gap:10px;padding:0 7%;margin-top:6px}
  .rm-lab{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:11px 8px 12px;cursor:pointer;font-family:var(--sans);font-size:13px;font-weight:600;color:var(--display);line-height:1.25;display:flex;flex-direction:column;gap:5px;align-items:center;text-align:center;box-shadow:0 1px 2px rgba(18,0,74,.05);transition:transform .12s,box-shadow .12s,border-color .12s,background .12s,color .12s}
  .rm-lab:hover{border-color:var(--accent);box-shadow:0 10px 22px rgba(18,0,74,.1);transform:translateY(-2px)}
  .rm-lab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .rm-lab.on{background:var(--blue-900);border-color:var(--blue-900);color:var(--cream-50);box-shadow:0 12px 26px rgba(18,0,74,.16);transform:translateY(-1px)}
  .rm-stage{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700;transition:color .12s}
  .rm-lab.on .rm-stage{color:var(--gold-300)}
  .rm-hint{text-align:center;font-size:11.5px;color:var(--muted);margin:13px 0 1px}
  .rm-card{margin-top:18px;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:12px;padding:18px 22px}
  .rm-cstage{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:5px}
  .rm-ctitle{font-family:var(--serif);font-weight:400;font-size:22px;color:var(--display);margin-bottom:9px;line-height:1.15}
  .rm-cmeta{display:flex;flex-wrap:wrap;gap:12px 26px;margin:2px 0 13px;padding:13px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
  .rm-mi{display:flex;flex-direction:column;gap:2px;min-width:0}
  .rmk{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700}
  .rmv{font-size:13px;color:var(--ink);line-height:1.4}
  .rm-csum{font-size:14.5px;margin:0 0 15px;line-height:1.55}
  .section a.rm-demo{display:inline-block;background:var(--blue-900);color:var(--cream-50);text-decoration:none;font-weight:700;font-size:13px;padding:9px 17px;border-radius:9px}
  .section a.rm-demo:hover{background:var(--blue-800);color:var(--cream-50)}
  .rm-nodemo{font-size:12.5px;color:var(--muted);font-style:italic}
  /* ---- M4: thesis tiles (§1) ---- */
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:1.4em 0}
  .tile{background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);border-radius:12px;padding:16px 18px}
  .tile .t-h{font-family:var(--serif);font-weight:400;font-size:18px;color:var(--display);margin-bottom:7px;line-height:1.18}
  .tile .t-b{font-size:13.5px;color:var(--ink);line-height:1.5}
  .tile .t-f{display:block;margin-top:11px;font-size:11px;letter-spacing:.04em;color:var(--accent);font-weight:700;font-style:normal}
  /* ---- M4: moat ranked cards (§6) ---- */
  .moat{display:grid;gap:13px;margin:1.4em 0}
  .mcard{position:relative;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:12px;padding:16px 18px 16px 58px}
  .mcard .mn{position:absolute;left:17px;top:14px;font-family:var(--serif);font-size:26px;color:var(--accent);line-height:1}
  .mcard.top{background:var(--blue-900);border-color:var(--blue-900)}
  .mcard.top .mh{color:var(--cream-50)}.mcard.top .mb{color:var(--cream-100)}.mcard.top .mn{color:var(--gold-300)}
  .mcard.top .mb em{color:var(--gold-200)}
  .mcard .mh{font-weight:700;font-size:15.5px;color:var(--display);margin-bottom:5px}
  .mcard .mb{font-size:13.5px;line-height:1.5;color:var(--ink)}
  /* ---- M4: PMF 80/80/80 tiles (§8) ---- */
  .pmf{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:1.5em 0}
  .pmf-t{background:var(--blue-900);color:var(--cream-50);border-radius:12px;padding:20px 18px;text-align:center}
  .pmf-n{font-family:var(--serif);font-size:38px;color:var(--gold-300);line-height:1}
  .pmf-l{font-size:12.5px;margin-top:9px;line-height:1.4;opacity:.93}
  @media(max-width:560px){.pmf{grid-template-columns:1fr}}
  /* ---- M4: fiscal-calendar timeline (§9.2) ---- */
  .timeline{display:grid;grid-template-columns:repeat(var(--n,5),1fr);gap:10px;margin:1.4em 0}
  .tl-step{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:16px 13px 14px}
  .tl-step::before{content:"";position:absolute;top:-1px;left:13px;right:13px;height:3px;background:var(--accent);border-radius:3px}
  .tl-win{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:5px}
  .tl-phase{font-family:var(--serif);font-weight:400;font-size:16px;color:var(--display);margin-bottom:8px;line-height:1.15}
  .tl-move{font-size:12.5px;color:var(--ink);line-height:1.45}
  @media(max-width:700px){.timeline{grid-template-columns:1fr}}
  @media(max-width:560px){
    .navbtn .nt{font-size:13px}.wrap{padding:28px 18px 100px}
    .rm-lab{font-size:11px}.rm-labels{grid-template-columns:repeat(2,1fr);padding:0}
    .section table{font-size:12.5px}.section th,.section td{padding:8px 9px}
    .gl::after{max-width:min(260px,72vw)}
    .bar{padding:8px 14px;gap:8px}
    .gcard{padding:32px 24px}.gcard h1{font-size:26px}
  }
</style>`;

const APP = `<div class="bar" id="bar">
  <span class="barleft"><button id="bar-home">${barLogo}</button><span class="sep">|</span><button id="bar-toc">Contents</button><span class="sep">|</span><span class="barsec" id="barsec"></span></span>
  <span class="barprog" id="barprog"></span>
</div>
<main id="app"><div class="wrap" id="viewport"></div><footer id="appfooter"></footer></main>`;

// Public pitchbook: the markdown ships inline (no gate, no ciphertext). It is partner-facing
// outreach, so noindex keeps it out of search while still being a shareable link.
const injected = `const MODE='public';const MD=${JSON.stringify(markdown)};const DATA=null;`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title>Civic-Chain × Broadband Telecom: Partnership Proposal</title>
${favicon}
${fonts.style}
${STYLE}
</head>
<body>
${APP}
<script>${marked}</script>
<script>${injected}
(${clientApp.toString()})();
</script>
</body>
</html>`;

const outDir = doDeploy ? 'site' : 'site-preview';
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + '/index.html', html);
console.log('WROTE ' + outDir + '/index.html  (' + (html.length/1024).toFixed(0) + ' KB; fonts ' + fonts.kb.toFixed(0) + ' KB; brand ' + (brand.ok ? 'inlined' : 'TEXT FALLBACK') + ')  [PUBLIC' + (doDeploy ? ', DEPLOY' : ', PREVIEW') + ']');
