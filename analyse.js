/* Onglet Analyse : bandeau de performance, heatmaps, edge par dimension, simulateur de gestion.
   Tout est calculé à l'affichage depuis les trades réels (window.CabaJournal, exposé par app.js).
   Aucune donnée en dur. Sous n = 30, chaque chiffre porte le badge low_n. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var J, filter = "all", dim = "scenario", sim = { tp: 2, be: 0 };
  var DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
  var DIMS = [
    ["scenario", "Scénario", function (t) { return t.scenario ? String(t.scenario).split(/\s[—–-]\s/)[0].trim() : null; }],
    ["entry_level", "Level d'entrée", function (t) { return t.entry_level; }],
    ["setup_score", "Score /4", function (t) { return t.setup_score == null ? null : t.setup_score + "/4"; }],
    ["entry_type", "Principale / secondaire", function (t) { return t.entry_type; }],
    ["gex_regime", "Régime GEX", function (t) { return t.gex_regime === "negative" ? "GEX −" : t.gex_regime === "positive" ? "GEX +" : null; }],
    ["direction", "Direction", function (t) { return t.direction; }],
    ["regime_dir", "Régime × direction", function (t) { return t.gex_regime ? (t.gex_regime === "negative" ? "GEX −" : "GEX +") + " · " + t.direction : null; }],
    ["plan_source", "Source du plan", function (t) { return t.plan_source; }],
    ["exit_reason", "Raison de sortie", function (t) { return t.exit_reason; }],
    ["plan_respected", "Plan respecté", function (t) { return t.plan_respected === false ? "Non" : "Oui"; }],
    ["session", "Session", function (t) { return t.session; }],
    ["weekday", "Jour", function (t) { var d = wd(t); return d == null ? null : DAYS[d]; }]
  ];

  function wd(t) { if (!t.date) return null; var d = new Date(t.date + "T12:00:00").getDay(); return d >= 1 && d <= 5 ? d - 1 : null; }
  function hr(t) { var m = /^(\d{1,2})/.exec(t.time_guyane || ""); return m ? +m[1] : null; }
  function live() {
    return J.state.trades.filter(function (t) { return t.status !== "no_trade" && J.computeR(t) != null && (filter === "all" || t.session === filter); }).sort(J.byTime);
  }
  function lowN(n) { return n < 30 ? ' <span class="chip lown">low_n</span>' : ""; }

  /* ---------- Bandeau de performance ---------- */
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function renderStrip() {
    var all = J.state.trades.filter(function (t) { return t.status !== "no_trade" && J.computeR(t) != null; }).sort(J.byTime);
    var now = new Date(), today = iso(now), mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    var week = iso(mon), month = today.slice(0, 8) + "01";
    var sum = function (from) { var s = all.filter(function (t) { return t.date >= from; }); return { r: s.reduce(function (a, t) { return a + J.computeR(t); }, 0), n: s.length }; };
    var d = sum(today), w = sum(week), m = sum(month);
    var cum = 0, peak = 0; all.forEach(function (t) { cum += J.computeR(t); peak = Math.max(peak, cum); });
    var streak = 0, sign = 0;
    for (var i = all.length - 1; i >= 0; i--) { var r = J.computeR(all[i]), s = r > 0.05 ? 1 : r < -0.05 ? -1 : 0; if (!s) break; if (!sign) sign = s; if (s !== sign) break; streak++; }
    function cell(l, v, sub, c) { return '<div class="ps-cell"><span class="ps-l">' + l + '</span><b class="ps-v ' + (c || "") + '">' + v + '</b><span class="ps-s">' + sub + "</span></div>"; }
    $("perfStrip").innerHTML =
      cell("Aujourd'hui", d.n ? J.fmtR(d.r) : "—", d.n + " trade" + (d.n > 1 ? "s" : ""), J.cls(d.n ? d.r : null)) +
      cell("Semaine", w.n ? J.fmtR(w.r) : "—", w.n + " trade" + (w.n > 1 ? "s" : ""), J.cls(w.n ? w.r : null)) +
      cell("Mois", m.n ? J.fmtR(m.r) : "—", m.n + " trade" + (m.n > 1 ? "s" : ""), J.cls(m.n ? m.r : null)) +
      cell("Série en cours", streak ? (sign > 0 ? "▲ " : "▼ ") + streak : "—", sign > 0 ? "gagnants" : sign < 0 ? "perdants" : "aucune", sign > 0 ? "pos" : sign < 0 ? "neg" : "") +
      cell("Drawdown actuel", all.length ? J.fmtR(cum - peak) : "—", "depuis le plus haut " + (all.length ? J.fmtR(peak) : "—"), cum - peak < -0.05 ? "neg" : "pos");
  }

  /* ---------- Heatmaps ---------- */
  function heat(el, rows, cols, keyR, keyC, list) {
    var cells = {}, mx = 0.5;
    list.forEach(function (t) { var a = keyR(t), b = keyC(t); if (a == null || b == null) return; var k = a + "|" + b; (cells[k] = cells[k] || []).push(t); });
    Object.keys(cells).forEach(function (k) { var s = J.stats(cells[k]); cells[k] = s; mx = Math.max(mx, Math.abs(s.exp)); });
    var h = '<div class="hm" style="grid-template-columns:72px repeat(' + cols.length + ',minmax(0,1fr))"><span></span>' +
      cols.map(function (c) { return '<span class="hm-h">' + c[1] + "</span>"; }).join("");
    rows.forEach(function (r) {
      h += '<span class="hm-r">' + r[1] + "</span>";
      cols.forEach(function (c) {
        var s = cells[r[0] + "|" + c[0]];
        if (!s) { h += '<span class="hm-c empty"></span>'; return; }
        var a = Math.min(1, Math.abs(s.exp) / mx), col = s.exp > 0.05 ? "var(--win)" : s.exp < -0.05 ? "var(--loss)" : "var(--be)";
        h += '<span class="hm-c" style="--c:' + col + ";--a:" + (0.18 + a * 0.62).toFixed(2) + '" data-tip="' + r[1] + " · " + c[1] + "&#10;Esp. " + J.fmtR(s.exp) + " · WR " + J.pct(s.wr) + "&#10;Total " + J.fmtR(s.total) + " · n " + s.n + '"><b>' + J.fmtR(s.exp) + "</b><i>n " + s.n + "</i></span>";
      });
    });
    $(el).innerHTML = h + "</div>";
  }
  function renderHeatmaps(list) {
    var sess = [["Asian", '<span class="c-Asian">Asian</span>'], ["London", '<span class="c-London">London</span>'], ["NY", '<span class="c-NY">NY</span>']];
    heat("hmDay", sess, DAYS.map(function (d, i) { return [i, d]; }), function (t) { return t.session; }, wd, list);
    var hours = {}; list.forEach(function (t) { var h = hr(t); if (h != null) hours[h] = 1; });
    var hs = Object.keys(hours).map(Number).sort(function (a, b) { return a - b; });
    if (!hs.length) { $("hmHour").innerHTML = '<div class="kpi-s">Renseigne l\'heure de tes trades pour remplir cette carte.</div>'; return; }
    heat("hmHour", sess, hs.map(function (h) { return [h, String(h).padStart(2, "0") + "h"]; }), function (t) { return t.session; }, hr, list);
  }

  /* ---------- Edge par dimension ---------- */
  function renderEdge(list) {
    var d = DIMS.filter(function (x) { return x[0] === dim; })[0], gs = {};
    list.forEach(function (t) { var k = d[2](t); if (k == null || k === "") k = "—"; (gs[k] = gs[k] || []).push(t); });
    var rows = Object.keys(gs).map(function (k) {
      var rs = J.rsOf(gs[k]), s = J.stats(gs[k]), w = rs.filter(function (r) { return r > 0.05; }).length;
      return { k: k, s: s, wci: J.wilson(w, s.n), eci: J.bootMean(rs) };
    }).sort(function (a, b) { return b.s.total - a.s.total; });
    if (!rows.length) { $("edgeTable").innerHTML = '<div class="kpi-s">Pas encore de trade.</div>'; return; }
    var mx = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.s.exp) || 0; }).concat([0.5]));
    $("edgeTable").innerHTML = '<table class="edge"><thead><tr><th></th><th>Espérance</th><th class="r">WR</th><th class="r">PF</th><th class="r">Total</th><th class="r">n</th></tr></thead><tbody>' + rows.map(function (r, i) {
      var e = r.s.exp || 0, w = Math.min(50, Math.abs(e) / mx * 50);
      return '<tr style="--i:' + i + '"><td class="lbl">' + J.esc(r.k) + "</td>" +
        '<td><div class="ebar" data-tip="' + J.esc(r.k) + "&#10;Esp. " + J.fmtR(r.s.exp) + (r.eci ? "&#10;IC95 " + J.fmtR(r.eci[0]) + " → " + J.fmtR(r.eci[1]) : "") + '"><i class="' + (e >= 0 ? "up" : "dn") + '" style="width:' + w.toFixed(1) + '%"></i><span class="res ' + J.cls(r.s.exp) + '">' + J.fmtR(r.s.exp) + "</span></div>" +
        (r.eci ? '<div class="kpi-s">IC95 ' + J.fmtR(r.eci[0]) + " → " + J.fmtR(r.eci[1]) + "</div>" : "") + "</td>" +
        '<td class="r">' + J.pct(r.s.wr) + (r.wci ? '<div class="kpi-s">' + J.pct(r.wci[0]) + "–" + J.pct(r.wci[1]) + "</div>" : "") + "</td>" +
        '<td class="r">' + (r.s.pf == null ? "—" : r.s.pf === Infinity ? "∞" : r.s.pf.toFixed(2)) + "</td>" +
        '<td class="r res ' + J.cls(r.s.total) + '">' + J.fmtR(r.s.total) + "</td>" +
        '<td class="r">' + r.s.n + lowN(r.s.n) + "</td></tr>";
    }).join("") + "</tbody></table>";
  }

  /* ---------- Simulateur de gestion ----------
     Pour chaque trade avec MFE : TP fixe à X R, BE optionnel à Y R.
     Ordre MFE/MAE inconnu → fourchette, jamais un chiffre unique inventé. */
  function simulate(list, X, Y) {
    var o = { n: 0, real: 0, lo: 0, hi: 0, hit: 0, amb: 0, unk: 0, pts: [] };
    list.forEach(function (t) {
      var r = J.computeR(t), k = J.riskPts(t);
      if (r == null || !k || t.mfe_pts == null) return;
      var mfe = +t.mfe_pts / k, mae = t.mae_pts == null ? null : +t.mae_pts / k, lo, hi;
      var stopped = r <= -0.95;
      if (mfe >= X) {
        o.hit++;
        if (mae != null && mae < 1 && !(Y && mfe >= Y && mae > 0.01)) { lo = hi = X; }
        else { o.amb++; lo = Y && mfe >= Y ? 0 : -1; hi = X; }
      } else if (Y && mfe >= Y) {
        if (stopped || r < 0) { lo = hi = 0; }
        else { o.unk++; lo = 0; hi = Math.max(r, 0); }
      } else if (stopped || Math.abs(r - mfe) < 0.05) { lo = hi = r; }
      else { o.unk++; lo = Math.min(r, -1); hi = Math.max(r, X); }
      o.n++; o.real += r; o.lo += lo; o.hi += hi; o.pts.push({ id: t.id, r: r, lo: lo, hi: hi });
    });
    return o;
  }
  function renderSim(list) {
    var o = simulate(list, sim.tp, sim.be);
    $("simTpV").textContent = sim.tp.toFixed(1) + "R"; $("simBeV").textContent = sim.be ? "+" + sim.be.toFixed(1) + "R" : "off";
    if (!o.n) { $("simOut").innerHTML = '<div class="kpi-s">Le simulateur a besoin du MFE (et idéalement du MAE) sur tes trades.</div>'; $("simChart").innerHTML = ""; return; }
    var rng = function (a, b) { return Math.abs(b - a) < 0.005 ? J.fmtR(a) : J.fmtR(a) + " → " + J.fmtR(b); };
    var dlo = o.lo - o.real, dhi = o.hi - o.real;
    $("simOut").innerHTML =
      '<div class="sim-k"><span>Réel</span><b class="' + J.cls(o.real) + '">' + J.fmtR(o.real) + "</b></div>" +
      '<div class="sim-k"><span>Simulé</span><b class="' + J.cls((o.lo + o.hi) / 2) + '">' + rng(o.lo, o.hi) + "</b></div>" +
      '<div class="sim-k"><span>Écart</span><b class="' + J.cls((dlo + dhi) / 2) + '">' + rng(dlo, dhi) + "</b></div>" +
      '<div class="sim-k"><span>Base</span><b>' + o.n + "</b><em>" + [o.hit + " TP touché" + (o.hit > 1 ? "s" : ""), o.amb ? o.amb + " ambigu" + (o.amb > 1 ? "s" : "") : "", o.unk ? o.unk + " inconnu" + (o.unk > 1 ? "s" : "") : ""].filter(Boolean).join(" · ") + lowN(o.n) + "</em></div>";
    var svg = $("simChart"), W = Math.max(280, Math.round(svg.getBoundingClientRect().width) || 600), H = 180, P = { l: 34, r: 8, t: 10, b: 18 };
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var cr = [0], cl = [0], ch = [0];
    o.pts.forEach(function (p) { cr.push(cr[cr.length - 1] + p.r); cl.push(cl[cl.length - 1] + p.lo); ch.push(ch[ch.length - 1] + p.hi); });
    var all = cr.concat(cl, ch), mn = Math.min.apply(null, all), mx = Math.max.apply(null, all); if (mx - mn < 2) { mx += 1; mn -= 1; }
    var x = function (i) { return P.l + (W - P.l - P.r) * i / (cr.length - 1); }, y = function (v) { return P.t + (H - P.t - P.b) * (1 - (v - mn) / (mx - mn)); };
    var line = function (a) { return a.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" "); };
    var band = line(ch) + " " + cl.slice().reverse().map(function (v, i) { return "L" + x(cl.length - 1 - i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ") + " Z";
    svg.innerHTML = '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--line-2)"/>' +
      '<text x="' + (P.l - 6) + '" y="' + (y(0) + 3) + '" text-anchor="end">0R</text>' +
      '<path d="' + band + '" fill="var(--accent)" fill-opacity=".16"/>' +
      '<path d="' + line(cr) + '" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>' +
      '<path class="draw" pathLength="1" d="' + line(cl) + '" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
      '<path class="draw" pathLength="1" d="' + line(ch) + '" fill="none" stroke="var(--accent)" stroke-opacity=".5" stroke-width="1.4" vector-effect="non-scaling-stroke"/>';
  }

  function render(api) {
    J = api; if (!$("tab-analyse")) return;
    renderStrip();
    var list = live();
    $("anHint").textContent = list.length + " trade" + (list.length > 1 ? "s" : "") + " réels" + (list.length < 30 ? " · low_n" : "");
    renderHeatmaps(list); renderEdge(list); renderSim(list);
  }

  function wire() {
    var sel = $("edgeDim");
    sel.innerHTML = DIMS.map(function (d) { return '<option value="' + d[0] + '">' + d[1] + "</option>"; }).join("");
    sel.value = dim;
    sel.addEventListener("change", function () { dim = sel.value; if (J) renderEdge(live()); });
    document.querySelectorAll("#anFilters button").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.getAttribute("data-af");
        document.querySelectorAll("#anFilters button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        if (J) render(J);
      });
    });
    $("simTp").addEventListener("input", function () { sim.tp = +this.value; if (J) renderSim(live()); });
    $("simBe").addEventListener("input", function () { sim.be = +this.value; if (J) renderSim(live()); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
  window.CabaAnalyse = { render: render };
})();
