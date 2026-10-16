/* Effets du desk : compteurs animés sur les KPI, info-bulles [data-tip], apparition des panneaux au scroll.
   Purement visuel : ne lit ni n'écrit aucune donnée. Désactivé si l'utilisateur réduit les animations. */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Compteurs : "+0.63R", "44%", "4.34", "9" s'animent depuis 0 ---- */
  function countUp(el) {
    var txt = el.textContent, m = /^([^\d−-]*)([−-]?)(\d+(?:[.,]\d+)?)(.*)$/.exec(txt);
    if (el._anim || !m || reduce || el.dataset.done === txt) return;
    el.dataset.done = txt; el._anim = true;
    var pre = m[1], neg = m[2], target = parseFloat(m[3].replace(",", ".")), dec = (m[3].split(/[.,]/)[1] || "").length, post = m[4], t0 = null, D = 900;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / D), e = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + neg + (target * e).toFixed(dec) + post;
      if (k < 1) requestAnimationFrame(step); else { el.textContent = txt; el._anim = false; }
    }
    requestAnimationFrame(step);
  }
  function watchCounters(root) {
    if (!root) return;
    var run = function () { root.querySelectorAll(".kpi-v, .ps-v, .split-v, .sim-k b").forEach(countUp); };
    new MutationObserver(run).observe(root, { childList: true, subtree: true });
    run();
  }

  /* ---- Info-bulle unique pour tout élément [data-tip] (SVG compris) ---- */
  var tip = document.createElement("div");
  tip.className = "fx-tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  function place(e) {
    var x = e.clientX + 14, y = e.clientY + 14, w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tip.style.transform = "translate(" + Math.max(8, x) + "px," + Math.max(8, y) + "px)";
  }
  document.addEventListener("pointerover", function (e) {
    var t = e.target.closest && e.target.closest("[data-tip]");
    if (!t) return;
    tip.textContent = t.getAttribute("data-tip"); tip.hidden = false; place(e);
  });
  document.addEventListener("pointermove", function (e) { if (!tip.hidden) place(e); });
  document.addEventListener("pointerout", function (e) {
    var t = e.target.closest && e.target.closest("[data-tip]");
    if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) tip.hidden = true;
  });

  /* ---- Apparition des panneaux ---- */
  function reveal() {
    if (reduce || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -40px 0px" });
    var scan = function () {
      document.querySelectorAll(".tabpane:not([hidden]) .panel:not(.fx), .tabpane:not([hidden]) details.trade:not(.fx), .tabpane:not([hidden]) .plan:not(.fx)").forEach(function (el, i) {
        el.classList.add("fx"); el.style.setProperty("--d", Math.min(i, 8) * 45 + "ms"); io.observe(el);
      });
    };
    scan();
    window.addEventListener("hashchange", function () { setTimeout(scan, 30); });
    new MutationObserver(function () { scan(); }).observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
  }

  /* ---- Lueur qui suit le curseur sur les panneaux ---- */
  document.addEventListener("pointermove", function (e) {
    var p = e.target.closest && e.target.closest(".panel, details.trade, .plan");
    if (!p) return;
    var r = p.getBoundingClientRect();
    p.style.setProperty("--mx", (e.clientX - r.left) + "px"); p.style.setProperty("--my", (e.clientY - r.top) + "px");
  });

  function init() {
    document.body.appendChild(tip);
    ["kpis", "btKpis", "perfStrip", "planSplit"].forEach(function (id) { watchCounters(document.getElementById(id)); });
    reveal();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
