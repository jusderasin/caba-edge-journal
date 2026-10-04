/* Bandeau de marché : horloges + frise des fenêtres de trading (heure de Guyane).
   Aucune donnée de trade ici, uniquement l'heure. Les fenêtres sont celles d'Erwann. */
(function () {
  "use strict";
  var TZ = "America/Cayenne";
  var WINDOWS = [
    { key: "Asian", start: 20 * 60, end: 22 * 60 + 30 },
    { key: "London", start: 2 * 60 + 50, end: 6 * 60 + 30 },
    { key: "NY", start: 10 * 60, end: 12 * 60 }
  ];
  var CLOCKS = [
    { label: "Cayenne", tz: TZ },
    { label: "Paris", tz: "Europe/Paris" },
    { label: "New York", tz: "America/New_York" },
    { label: "Tokyo", tz: "Asia/Tokyo" }
  ];

  function parts(date, tz) {
    var o = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    return { wd: o.weekday, h: +o.hour, m: +o.minute, s: +o.second };
  }
  function hm(p) { return String(p.h).padStart(2, "0") + ":" + String(p.m).padStart(2, "0"); }
  function dur(min) { var h = Math.floor(min / 60), m = min % 60; return h ? h + " h " + String(m).padStart(2, "0") : m + " min"; }

  // CME Globex : fermé du vendredi 17:00 au dimanche 18:00 (heure de New York).
  function marketClosed(now) {
    var ny = parts(now, "America/New_York"), t = ny.h * 60 + ny.m;
    if (ny.wd === "Sat") return true;
    if (ny.wd === "Fri" && t >= 17 * 60) return true;
    if (ny.wd === "Sun" && t < 18 * 60) return true;
    return false;
  }

  function build(el) {
    var clocks = CLOCKS.map(function (c, i) {
      return '<div class="clk' + (i === 0 ? " home" : "") + '"><span class="clk-l">' + c.label + '</span><span class="clk-t" data-tz="' + c.tz + '">--:--</span></div>';
    }).join("");
    var segs = WINDOWS.map(function (w) {
      var l = (w.start / 1440) * 100, wd = ((w.end - w.start) / 1440) * 100;
      return '<span class="seg s-' + w.key + '" style="left:' + l + "%;width:" + wd + '%"><em>' + w.key + "</em></span>";
    }).join("");
    var ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24].map(function (h) {
      return '<span class="tick" style="left:' + (h / 24) * 100 + '%">' + String(h).padStart(2, "0") + "</span>";
    }).join("");
    el.innerHTML =
      '<div class="ribbon-in">' +
        '<div class="clocks">' + clocks + "</div>" +
        '<div class="track-wrap"><div class="track" aria-hidden="true">' + segs + '<span class="now" id="trackNow"></span></div><div class="ticks" aria-hidden="true">' + ticks + "</div></div>" +
        '<div class="sess-state" id="sessState" aria-live="polite"></div>' +
      "</div>";
  }

  function tick(el) {
    var now = new Date();
    el.querySelectorAll(".clk-t").forEach(function (n) { n.textContent = hm(parts(now, n.getAttribute("data-tz"))); });
    var g = parts(now, TZ), t = g.h * 60 + g.m;
    var nowEl = document.getElementById("trackNow");
    if (nowEl) nowEl.style.left = (t / 1440) * 100 + "%";

    var state = document.getElementById("sessState"), closed = marketClosed(now);
    el.classList.toggle("closed", closed);
    WINDOWS.forEach(function (w) {
      var seg = el.querySelector(".seg.s-" + w.key);
      if (seg) seg.classList.toggle("live", !closed && t >= w.start && t < w.end);
    });
    if (closed) { state.innerHTML = '<b>Marché fermé</b><span>Réouverture dim. 18:00 NY</span>'; return; }
    var live = WINDOWS.filter(function (w) { return t >= w.start && t < w.end; })[0];
    if (live) { state.innerHTML = '<b class="c-' + live.key + '">' + live.key + " en cours</b><span>" + dur(live.end - t) + " restantes</span>"; return; }
    var next = WINDOWS.map(function (w) { return { w: w, d: (w.start - t + 1440) % 1440 }; }).sort(function (a, b) { return a.d - b.d; })[0];
    state.innerHTML = '<b>Prochaine : <span class="c-' + next.w.key + '">' + next.w.key + "</span></b><span>dans " + dur(next.d) + "</span>";
  }

  function init() {
    var el = document.getElementById("ribbon");
    if (!el) return;
    build(el); tick(el);
    setInterval(function () { tick(el); }, 15000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
