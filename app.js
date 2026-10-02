(function () {
  "use strict";
  var state = { trades: [], plans: [], research: [], gex: [], bts: [], btt: [], filter: "all", btKind: "all", btSess: "all", imgUrls: {}, pending: {} };
  var TAGS = [["chase", "Chase"], ["early", "Entrée early"], ["late", "Entrée tardive"], ["stop_moved", "Stop déplacé"], ["early_exit", "Sortie anticipée"], ["revenge", "Revenge"], ["off_window", "Hors fenêtre"], ["size", "Sur-taille"]];
  var tagLabel = function (k) { var f = TAGS.filter(function (t) { return t[0] === k; })[0]; return f ? f[1] : k; };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fmtR = function (r) { return r == null || isNaN(r) ? "—" : (r > 0 ? "+" : "") + r.toFixed(2) + "R"; };
  var cls = function (r) { return r == null ? "" : r > 0.05 ? "pos" : r < -0.05 ? "neg" : "flat"; };
  var pct = function (x) { return x == null ? "—" : Math.round(x * 100) + "%"; };
  var sb = window.supabase.createClient(window.JOURNAL_CONFIG.url, window.JOURNAL_CONFIG.key);
  var BUCKET = "shots";

  /* ================= Calculs ================= */
  function computeR(t) {
    if (t.status === "no_trade") return null;
    var e = +t.entry_price, s = +t.sl_price, x = +t.exit_price;
    if (t.entry_price != null && t.sl_price != null && t.exit_price != null && e !== s) return (t.direction === "short" ? -1 : 1) * (x - e) / Math.abs(e - s);
    return null;
  }
  function pts(t) {
    if (t.entry_price == null || t.exit_price == null) return null;
    return (t.direction === "short" ? -1 : 1) * (+t.exit_price - +t.entry_price);
  }
  function plannedRR(t) {
    if (t.entry_price == null || t.sl_price == null || t.tp_price == null || +t.entry_price === +t.sl_price) return null;
    return Math.abs(+t.tp_price - +t.entry_price) / Math.abs(+t.entry_price - +t.sl_price);
  }
  function stats(list) {
    var rs = list.map(computeR).filter(function (r) { return r != null; });
    var n = rs.length, wins = rs.filter(function (r) { return r > 0.05; }), losses = rs.filter(function (r) { return r < -0.05; });
    var sum = rs.reduce(function (a, b) { return a + b; }, 0);
    var gw = wins.reduce(function (a, b) { return a + b; }, 0), gl = -losses.reduce(function (a, b) { return a + b; }, 0);
    return { n: n, wr: n ? wins.length / n : null, exp: n ? sum / n : null, total: sum, pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null),
      avgW: wins.length ? gw / wins.length : null, avgL: losses.length ? -gl / losses.length : null, be: n - wins.length - losses.length };
  }
  /* IC 95 % : Wilson pour le win rate, bootstrap (graine fixe) pour l'espérance */
  function wilson(k, n) {
    if (!n) return null;
    var z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }
  function bootMean(rs) {
    var n = rs.length; if (n < 3) return null;
    var seed = 1234567, rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    var means = [];
    for (var b = 0; b < 2000; b++) { var s = 0; for (var i = 0; i < n; i++) s += rs[Math.floor(rnd() * n)]; means.push(s / n); }
    means.sort(function (a, c) { return a - c; });
    return [means[49], means[1949]];
  }
  function rsOf(list) { return list.map(computeR).filter(function (r) { return r != null; }); }
  var ciTxt = function (ci, f) { return ci ? "IC95 " + f(ci[0]) + " → " + f(ci[1]) : ""; };
  var byTime = function (a, b) { return String(a.date + (a.time_guyane || "")).localeCompare(String(b.date + (b.time_guyane || ""))); };
  function filtered() {
    var t = state.trades.slice().sort(byTime);
    return state.filter === "all" ? t : t.filter(function (x) { return x.session === state.filter; });
  }
  function fmtDate(d) { if (!d) return ""; var p = String(d).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }

  /* ================= Fichiers ================= */
  function extOf(a) { var m = /\.([a-z0-9]+)$/i.exec(a.name || a.path || ""); return m ? m[1].toLowerCase() : ""; }
  function kindOf(a) {
    var t = a.type || "", e = extOf(a);
    if (t.indexOf("image/") === 0 || /^(png|jpe?g|gif|webp|avif)$/.test(e)) return "image";
    if (t === "application/pdf" || e === "pdf") return "pdf";
    if (/^html?$/.test(e) || t === "text/html") return "html";
    return "file";
  }
  function images(list) { return (list || []).filter(function (a) { return kindOf(a) === "image"; }); }
  function others(list) { return (list || []).filter(function (a) { return kindOf(a) !== "image"; }); }

  function signImages(list) {
    var paths = list.filter(function (a) { return kindOf(a) === "image" && !state.imgUrls[a.path] && !state.pending[a.path]; }).map(function (a) { return a.path; });
    if (!paths.length) return;
    paths.forEach(function (p) { state.pending[p] = true; });
    sb.storage.from(BUCKET).createSignedUrls(paths, 3600).then(function (r) {
      (r.data || []).forEach(function (x) { if (x.signedUrl) state.imgUrls[x.path] = x.signedUrl; delete state.pending[x.path]; });
      document.querySelectorAll(".thumb.loading[data-path]").forEach(function (b) {
        var u = state.imgUrls[b.getAttribute("data-path")];
        if (u) { b.classList.remove("loading"); b.innerHTML = '<img alt="" src="' + esc(u) + '"><span class="cap">' + esc(b.getAttribute("data-name")) + "</span>"; }
      });
    });
  }
  var groups = {};
  function registerGroup(key, list) { groups[key] = list || []; return key; }
  function galleryHtml(list, group) {
    var imgs = images(list), rest = others(list), h = "";
    if (imgs.length) {
      h += '<div class="gallery' + (imgs.length === 1 ? " solo" : "") + '">';
      imgs.forEach(function (a, i) {
        var u = state.imgUrls[a.path], name = a.name || "image";
        h += '<button type="button" class="thumb' + (u ? "" : " loading") + '" data-open="' + esc(group) + '" data-i="' + i + '" data-path="' + esc(a.path) + '" data-name="' + esc(name) + '" aria-label="Agrandir ' + esc(name) + '">' +
          (u ? '<img alt="" loading="lazy" src="' + esc(u) + '"><span class="cap">' + esc(name) + "</span>" : "Chargement…") + "</button>";
      });
      h += "</div>";
    }
    if (rest.length) {
      h += '<div class="files">';
      rest.forEach(function (a, i) {
        var e = extOf(a) || "fichier";
        h += '<button type="button" class="file" data-file="' + esc(group) + '" data-i="' + i + '"><span class="ext ' + esc(e) + '">' + esc(e.toUpperCase()) + '</span><span class="fn">' + esc(a.name || a.path) + "</span></button>";
      });
      h += "</div>";
    }
    return h;
  }

  function uploadAll(prefix, files) {
    var list = Array.prototype.slice.call(files || []);
    return Promise.all(list.map(function (f, i) {
      var safe = (f.name || "fichier").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);
      var path = prefix + "/" + Date.now() + "-" + i + "-" + safe;
      return sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false }).then(function (r) {
        if (r.error) throw r.error;
        return { path: path, name: f.name, type: f.type || "", size: f.size };
      });
    }));
  }
  function removeFiles(paths) { if (paths.length) sb.storage.from(BUCKET).remove(paths); }

  /* ================= Visionneuse ================= */
  var viewer = { list: [], i: 0 };
  function openViewer(list, i) {
    if (!list.length) return;
    viewer.list = list; viewer.i = i || 0; $("viewer").hidden = false; document.body.style.overflow = "hidden"; showCurrent();
  }
  function closeViewer() { $("viewer").hidden = true; $("viewerBody").innerHTML = ""; if ($("drawer").hidden) document.body.style.overflow = ""; }
  function showCurrent() {
    var a = viewer.list[viewer.i], body = $("viewerBody"), k = kindOf(a), open = $("viewerOpen");
    $("viewerName").textContent = (a.name || a.path) + (viewer.list.length > 1 ? "  ·  " + (viewer.i + 1) + "/" + viewer.list.length : "");
    $("viewerPrev").hidden = $("viewerNext").hidden = viewer.list.length < 2;
    body.innerHTML = '<span class="vmsg">Chargement…</span>';
    if (k === "html") {
      open.hidden = true;
      sb.storage.from(BUCKET).download(a.path).then(function (r) {
        if (r.error) throw r.error; return r.data.text();
      }).then(function (html) {
        var f = document.createElement("iframe");
        f.setAttribute("sandbox", "allow-popups");
        f.setAttribute("title", a.name || "Gameplan");
        f.srcdoc = html; body.innerHTML = ""; body.appendChild(f);
      }).catch(function () { body.innerHTML = '<span class="vmsg">Impossible de charger ce fichier.</span>'; });
      return;
    }
    var opts = k === "file" ? { download: a.name || true } : undefined;
    sb.storage.from(BUCKET).createSignedUrl(a.path, 3600, opts).then(function (r) {
      if (r.error) throw r.error;
      var u = r.data.signedUrl; open.hidden = false; open.href = u; open.textContent = "Ouvrir";
      if (k === "image") body.innerHTML = '<img alt="' + esc(a.name || "") + '" src="' + esc(u) + '">';
      else if (k === "pdf") body.innerHTML = '<iframe title="' + esc(a.name || "PDF") + '" src="' + esc(u) + '"></iframe>';
      else { body.innerHTML = '<span class="vmsg">Pas d\'aperçu pour ce type de fichier. Utilise « Télécharger ».</span>'; open.textContent = "Télécharger"; }
    }).catch(function () { body.innerHTML = '<span class="vmsg">Impossible de charger ce fichier.</span>'; });
  }
  $("viewerClose").addEventListener("click", closeViewer);
  $("viewerPrev").addEventListener("click", function () { viewer.i = (viewer.i - 1 + viewer.list.length) % viewer.list.length; showCurrent(); });
  $("viewerNext").addEventListener("click", function () { viewer.i = (viewer.i + 1) % viewer.list.length; showCurrent(); });
  document.addEventListener("keydown", function (e) {
    if (!$("viewer").hidden) {
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowLeft") $("viewerPrev").click();
      else if (e.key === "ArrowRight") $("viewerNext").click();
    } else if (!$("drawer").hidden && e.key === "Escape") closeDrawer();
  });

  /* ================= Journal ================= */
  function kpi(label, value, sub, c) { return '<div class="kpi"><div class="kpi-l">' + label + '</div><div class="kpi-v ' + (c || "") + '">' + value + '</div><div class="kpi-s">' + (sub || "&nbsp;") + "</div></div>"; }
  function renderKpiBox(boxId, warnId, list, respFn, respLabel, unit) {
    var s = stats(list), rs = rsOf(list), noTrade = list.filter(function (t) { return t.status === "no_trade"; }).length;
    var tr = list.filter(function (t) { return t.status !== "no_trade"; });
    var resp = tr.length ? tr.filter(respFn).length / tr.length : null;
    var wins = rs.filter(function (r) { return r > 0.05; }).length, wci = wilson(wins, s.n), eci = bootMean(rs);
    $(boxId).innerHTML =
      kpi(unit || "Trades", s.n, noTrade ? noTrade + " no-trade" : (s.n ? (s.n - s.be) + " décidés · " + s.be + " BE" : "exécutés")) +
      kpi("Win rate", pct(s.wr), ciTxt(wci, pct)) +
      kpi("Espérance", fmtR(s.exp), ciTxt(eci, fmtR) || "par trade", cls(s.exp)) +
      kpi("Total", fmtR(s.n ? s.total : null), "R cumulés", cls(s.total)) +
      kpi("Profit factor", s.pf == null ? "—" : s.pf === Infinity ? "∞" : s.pf.toFixed(2), s.avgW != null ? "gain moy " + fmtR(s.avgW) : "") +
      kpi(respLabel, pct(resp), s.avgL != null ? "perte moy " + fmtR(s.avgL) : "");
    var w = $(warnId), verdict = "";
    if (eci) verdict = eci[0] > 0 ? " L'IC de l'espérance est entièrement au-dessus de 0." : eci[1] < 0 ? " L'IC de l'espérance est entièrement sous 0 : système perdant à ce stade." : " L'IC de l'espérance contient 0 : edge non démontré.";
    if (s.n === 0) w.textContent = "Aucun trade pour ce filtre.";
    else if (s.n < 30) w.textContent = "Sample : " + s.n + " trade" + (s.n > 1 ? "s" : "") + " sur 30 minimum (low_n). En dessous, ces chiffres sont du bruit statistique." + verdict;
    else if (s.n < 100) w.textContent = "Sample : " + s.n + " trades. Tendance lisible, pas encore solide (objectif 100+)." + verdict;
    else w.textContent = "Sample : " + s.n + " trades. Base exploitable." + verdict;
  }
  function renderKpis(list) { renderKpiBox("kpis", "sampleWarn", list, function (t) { return t.plan_respected !== false; }, "Plan respecté"); }

  function renderCurve(list, svgId, hintId) {
    svgId = svgId || "curve"; hintId = hintId || "curveHint";
    var svg = $(svgId), rs = list.map(computeR).filter(function (r) { return r != null; });
    var W = Math.max(300, Math.round(svg.getBoundingClientRect().width) || 800), H = 220, P = { l: 40, r: 12, t: 12, b: 22 };
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    if (!rs.length) { svg.innerHTML = '<text x="' + (W / 2) + '" y="110" text-anchor="middle">La courbe apparaît au premier trade.</text>'; $(hintId).textContent = ""; return; }
    var cum = [0]; rs.forEach(function (r) { cum.push(cum[cum.length - 1] + r); });
    var mn = Math.min.apply(null, cum), mx = Math.max.apply(null, cum);
    if (mx - mn < 2) { mx += 1; mn -= 1; }
    var step = (mx - mn) > 12 ? 5 : (mx - mn) > 5 ? 2 : 1;
    var x = function (i) { return P.l + (W - P.l - P.r) * (i / (cum.length - 1)); };
    var y = function (v) { return P.t + (H - P.t - P.b) * (1 - (v - mn) / (mx - mn)); };
    var g = "";
    for (var v = Math.ceil(mn / step) * step; v <= mx; v += step) {
      g += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="1"' + (v === 0 ? "" : ' stroke-dasharray="2 4"') + "/>";
      g += '<text x="' + (P.l - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + (v > 0 ? "+" : "") + v + "R</text>";
    }
    var d = cum.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
    var area = d + " L" + x(cum.length - 1).toFixed(1) + " " + y(0).toFixed(1) + " L" + x(0).toFixed(1) + " " + y(0).toFixed(1) + " Z";
    var last = cum[cum.length - 1], col = last >= 0 ? "var(--win)" : "var(--loss)";
    var peak = 0, dd = 0; cum.forEach(function (v) { peak = Math.max(peak, v); dd = Math.min(dd, v - peak); });
    g += '<path d="' + area + '" fill="' + col + '" fill-opacity="0.12"/>';
    g += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    cum.forEach(function (v, i) { if (i) g += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (i === cum.length - 1 ? 4 : 2.2) + '" fill="' + (rs[i - 1] > 0.05 ? "var(--win)" : rs[i - 1] < -0.05 ? "var(--loss)" : "var(--be)") + '"/>'; });
    g += '<text x="' + P.l + '" y="' + (H - 6) + '">départ</text><text x="' + (W - P.r) + '" y="' + (H - 6) + '" text-anchor="end">trade ' + rs.length + "</text>";
    svg.innerHTML = g;
    $(hintId).textContent = "max drawdown " + fmtR(dd);
  }

  function groupTable(el, list, keyFn, labelFn) {
    var gs = {};
    list.forEach(function (t) { if (t.status === "no_trade") return; var k = keyFn(t); if (k == null || k === "") k = "—"; (gs[k] = gs[k] || []).push(t); });
    var keys = Object.keys(gs);
    if (!keys.length) { $(el).innerHTML = '<div class="kpi-s">Pas encore de data.</div>'; return; }
    var rows = keys.map(function (k) { return { k: k, s: stats(gs[k]) }; }).sort(function (a, b) { return b.s.n - a.s.n; });
    var h = '<table><thead><tr><th></th><th class="r">WR</th><th class="r">Esp.</th><th class="r">n</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td class="lbl">' + (labelFn ? labelFn(r.k) : esc(r.k)) + '<div class="bar"><i style="width:' + Math.round((r.s.wr || 0) * 100) + '%"></i></div></td><td class="r">' + pct(r.s.wr) + '</td><td class="r res ' + cls(r.s.exp) + '">' + fmtR(r.s.exp) + '</td><td class="r">' + r.s.n + "</td></tr>";
    });
    $(el).innerHTML = h + "</tbody></table>";
  }
  function renderAttribution(list) {
    groupTable("bySession", list, function (t) { return t.session; }, function (k) { return '<span class="chip s-' + esc(k) + '">' + esc(k) + "</span>"; });
    groupTable("byLevel", list, function (t) { return t.entry_level; });
    groupTable("byScore", list, function (t) { return t.setup_score == null ? null : t.setup_score + "/4"; });
    groupTable("byPlan", list, function (t) { return t.plan_respected === false ? "Non" : "Oui"; });
    groupTable("byEntry", list, function (t) { return t.entry_type; });
    groupTable("byRegime", list, function (t) { return (t.gex_regime ? (t.gex_regime === "negative" ? "GEX −" : "GEX +") : "GEX ?") + " · " + (t.direction || "?"); });
    var planned = state.plans.filter(function (p) { return state.filter === "all" || p.session === state.filter; }).length;
    var noTrade = list.filter(function (t) { return t.status === "no_trade"; }).length;
    var moved = list.filter(function (t) { return t.sl_moved_price != null; }).length;
    $("discipline").innerHTML = "<div><b>" + planned + "</b><span>sessions avec gameplan</span></div><div><b>" + noTrade + "</b><span>no-trade logués</span></div><div><b>" + moved + "</b><span>stops déplacés</span></div>";
  }

  function row(label, v) { return v == null || v === "" ? "" : "<dt>" + label + "</dt><dd>" + v + "</dd>"; }
  function planById(id) { return state.plans.filter(function (p) { return p.id === id; })[0]; }
  function tradeById(id) { return state.trades.filter(function (t) { return t.id === id; })[0]; }

  function renderLedger(list) {
    var el = $("ledger");
    if (!state.trades.length) {
      el.innerHTML = '<div class="empty"><h3>Registre vide</h3><ol>' +
        "<li>Avant la session : crée la <b>session</b> et joins le gameplan HTML + XML.</li>" +
        "<li>Après : envoie capture + infos à Claude, ou saisis le trade avec <b>+ Trade</b>.</li>" +
        "<li>Les no-trade comptent aussi : ils mesurent la discipline.</li></ol></div>";
      $("ledgerHint").textContent = ""; return;
    }
    var rev = list.slice().reverse();
    $("ledgerHint").textContent = rev.length + " entrée" + (rev.length > 1 ? "s" : "");
    if (!rev.length) { el.innerHTML = '<div class="kpi-s">Aucun trade pour ce filtre.</div>'; return; }
    el.innerHTML = rev.map(function (t) {
      var r = computeR(t), p = pts(t), rr = plannedRR(t), nt = t.status === "no_trade", att = t.attachments || [];
      var plan = t.plan_id ? planById(t.plan_id) : null, planAtt = plan ? plan.attachments || [] : [];
      var stripe = nt ? "var(--line)" : r > 0.05 ? "var(--win)" : r < -0.05 ? "var(--loss)" : "var(--be)";
      var nFiles = att.length + planAtt.length;
      var head = '<summary><span class="stripe" style="background:' + stripe + '"></span>' +
        '<span class="t-date">' + esc(fmtDate(t.date)) + (t.time_guyane ? "<br>" + esc(t.time_guyane) : "") + "</span>" +
        '<span class="t-sess"><span class="chip s-' + esc(t.session) + '">' + esc(t.session || "?") + "</span></span>" +
        '<span class="t-main"><b>' + (nt ? "No trade" : esc((t.direction || "").toUpperCase()) + " " + esc(t.entry_price)) + "</b>" + (t.scenario ? " · " + esc(t.scenario) : "") +
        '<div class="t-lv">' + (nt ? esc(t.lessons || "") : esc(t.entry_level || "level ?") + " → " + esc(t.tp_level || "target ?")) + "</div></span>" +
        '<span class="t-clip">' + (nFiles ? nFiles + " fichier" + (nFiles > 1 ? "s" : "") : "") + "</span>" +
        '<span class="t-r ' + cls(r) + '"><b>' + (nt ? "—" : fmtR(r)) + "</b><span>" + (p == null ? "" : (p > 0 ? "+" : "") + p.toFixed(2) + " pts") + "</span></span></summary>";
      var media = att.length ? '<div class="kpi-l">Trade</div>' + galleryHtml(att, registerGroup("t:" + t.id, att)) : '<div class="empty-media">Pas de capture du trade. <b>Modifier</b> pour ajouter captures, PDF ou fichiers.</div>';
      if (plan) media += '<div class="plan-link"><span class="kpi-l" style="margin:0">Gameplan</span><a href="#sessions" class="chip s-' + esc(plan.session) + '">' + esc(fmtDate(plan.date) + " · " + plan.session + (plan.label ? " · " + plan.label : "")) + "</a></div>" +
        (planAtt.length ? galleryHtml(planAtt, registerGroup("tp:" + t.id, planAtt)) : '<div class="kpi-s">Aucun fichier joint à cette session.</div>');
      var kv = nt ? "" : '<dl class="kv">' +
        row("Instrument", esc(t.instrument || "MNQ") + (t.contracts ? " × " + esc(t.contracts) : "")) +
        row("Scénario", esc(t.scenario)) +
        row("Entrée", '<span class="mono">' + esc(t.entry_price) + "</span> · " + esc(t.entry_level) + (t.entry_type ? ' <span class="chip">' + esc(t.entry_type) + "</span>" : "")) +
        row("Stop", '<span class="mono">' + esc(t.sl_price) + "</span>" + (t.sl_level ? " · " + esc(t.sl_level) : "") + (t.entry_price != null && t.sl_price != null ? " · " + Math.abs(t.entry_price - t.sl_price).toFixed(2) + " pts" : "")) +
        row("Stop déplacé", t.sl_moved_price == null ? "" : '<span class="mono">' + esc(t.sl_moved_price) + '</span> <span class="chip">pendant le trade</span>') +
        row("Target", '<span class="mono">' + esc(t.tp_price) + "</span> · " + esc(t.tp_level)) +
        row("R:R prévu", rr == null ? "" : "1:" + rr.toFixed(2)) +
        row("Sortie", '<span class="mono">' + esc(t.exit_price) + "</span>" + (t.exit_reason ? " · " + esc(t.exit_reason) : "")) +
        row("Résultat", '<span class="res ' + cls(r) + '">' + fmtR(r) + "</span>" + (p == null ? "" : " · " + (p > 0 ? "+" : "") + p.toFixed(2) + " pts")) +
        row("MFE / MAE", t.mfe_pts != null || t.mae_pts != null ? '<span class="mono">+' + esc(t.mfe_pts == null ? "?" : t.mfe_pts) + " / −" + esc(t.mae_pts == null ? "?" : t.mae_pts) + " pts</span>" : "") +
        row("Score", t.setup_score == null ? "" : esc(t.setup_score) + "/4") +
        row("Régime", [t.gex_regime ? "GEX " + (t.gex_regime === "negative" ? "négatif" : "positif") : "", t.cvd ? "CVD " + esc(t.cvd) : ""].filter(Boolean).join(" · ")) +
        row("Source", esc(t.plan_source)) +
        row("Plan respecté", t.plan_respected === false ? '<span class="neg">Non</span>' : '<span class="pos">Oui</span>') +
        row("Erreurs", (t.error_tags || []).map(function (k) { return '<span class="chip tag-err">' + esc(tagLabel(k)) + "</span>"; }).join(" ")) + "</dl>";
      var notes = (t.notes ? '<div class="note"><small>Déroulé</small>' + esc(t.notes) + "</div>" : "") + (t.lessons ? '<div class="note"><small>' + (nt ? "Pourquoi pas de trade" : "Leçon") + "</small>" + esc(t.lessons) + "</div>" : "");
      var actions = '<div class="t-actions"><button type="button" class="btn small" data-edit="' + esc(t.id) + '">Modifier</button><button type="button" class="btn small danger" data-del="' + esc(t.id) + '">Supprimer</button></div>';
      return '<details class="trade" id="trade-' + esc(t.id) + '">' + head + '<div class="t-body"><div>' + kv + notes + actions + "</div><div>" + media + "</div></div></details>";
    }).join("");
    signImages([].concat.apply([], rev.map(function (t) { var p = t.plan_id ? planById(t.plan_id) : null; return (t.attachments || []).concat(p ? p.attachments || [] : []); })));
  }

  function renderJournal() { var list = filtered(); renderKpis(list); renderCurve(list); renderDiscipline(list); renderDistribution(list); renderLab(list); renderAttribution(list); renderLedger(list); }

  /* ================= Discipline ================= */
  function renderDiscipline(list) {
    var tr = list.filter(function (t) { return t.status !== "no_trade"; });
    var inP = tr.filter(function (t) { return t.plan_respected !== false; }), out = tr.filter(function (t) { return t.plan_respected === false; });
    var a = stats(inP), b = stats(out);
    function cell(title, s) {
      return '<div class="split-cell"><div class="kpi-l">' + title + '</div><div class="split-v ' + cls(s.n ? s.total : null) + '">' + (s.n ? fmtR(s.total) : "—") + "</div>" +
        '<div class="kpi-s">n ' + s.n + " · WR " + pct(s.wr) + " · esp. " + fmtR(s.exp) + "</div></div>";
    }
    var cost = b.n && b.total < 0 ? '<div class="cost">Les écarts au plan t\'ont coûté <b class="neg">' + fmtR(b.total) + "</b> sur la période." + (a.n ? " Dans le plan : " + fmtR(a.total) + "." : "") + "</div>" : "";
    $("planSplit").innerHTML = tr.length ? '<div class="split">' + cell("Dans le plan", a) + cell("Hors plan", b) + "</div>" + cost : '<div class="kpi-s">Pas encore de data.</div>';
    var gs = {}, untagged = 0;
    tr.forEach(function (t) {
      var tags = t.error_tags || [];
      if (!tags.length) { if (t.plan_respected === false) untagged++; return; }
      tags.forEach(function (k) { (gs[k] = gs[k] || []).push(t); });
    });
    var keys = Object.keys(gs);
    var h = keys.length ? '<table><thead><tr><th>Erreur</th><th class="r">n</th><th class="r">R total</th></tr></thead><tbody>' + keys.map(function (k) { return { k: k, s: stats(gs[k]) }; })
      .sort(function (x, y) { return x.s.total - y.s.total; }).map(function (r) {
        return '<tr><td class="lbl"><span class="chip tag-err">' + esc(tagLabel(r.k)) + '</span></td><td class="r">' + r.s.n + '</td><td class="r res ' + cls(r.s.total) + '">' + fmtR(r.s.total) + "</td></tr>";
      }).join("") + "</tbody></table>" : '<div class="kpi-s">Aucune erreur cochée pour l\'instant.</div>';
    if (untagged) h += '<div class="kpi-s warn-line">' + untagged + " trade" + (untagged > 1 ? "s" : "") + " hors plan sans erreur cochée. <b>Modifier</b> pour préciser ce qui s'est passé.</div>";
    $("byTag").innerHTML = h;
  }

  /* ================= Distribution ================= */
  function svgW(svg, fallback) { return Math.max(260, Math.round(svg.getBoundingClientRect().width) || fallback); }
  function renderDistribution(list) {
    var svg = $("hist"), rs = rsOf(list), H = 160, W = svgW(svg, 400), P = { l: 28, r: 8, t: 10, b: 22 };
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    if (!rs.length) { svg.innerHTML = '<text x="' + W / 2 + '" y="80" text-anchor="middle">Pas encore de trade.</text>'; $("streaks").innerHTML = ""; $("distHint").textContent = ""; return; }
    var step = 0.5, lo = Math.min(-1, Math.floor(Math.min.apply(null, rs) / step) * step), hi = Math.max(2, Math.ceil(Math.max.apply(null, rs) / step) * step);
    var nb = Math.round((hi - lo) / step) + 1, bins = []; for (var i = 0; i < nb; i++) bins.push(0);
    rs.forEach(function (r) { bins[Math.min(nb - 1, Math.max(0, Math.round((r - lo) / step)))]++; });
    var mx = Math.max.apply(null, bins), bw = (W - P.l - P.r) / nb, g = "";
    var yy = function (v) { return P.t + (H - P.t - P.b) * (1 - v / mx); };
    for (var v = 1; v <= mx; v++) if (mx <= 6 || v % Math.ceil(mx / 4) === 0) g += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + yy(v) + '" y2="' + yy(v) + '" stroke="var(--line)" stroke-dasharray="2 4"/><text x="' + (P.l - 5) + '" y="' + (yy(v) + 3) + '" text-anchor="end">' + v + "</text>";
    bins.forEach(function (c, k) {
      var mid = lo + k * step, col = mid > 0.05 ? "var(--win)" : mid < -0.05 ? "var(--loss)" : "var(--be)", cx = P.l + (k + 0.5) * bw;
      if (c) g += '<rect x="' + (cx - bw / 2 + 2).toFixed(1) + '" y="' + yy(c).toFixed(1) + '" width="' + Math.max(1, bw - 4).toFixed(1) + '" height="' + (H - P.b - yy(c)).toFixed(1) + '" rx="2" fill="' + col + '" fill-opacity=".85"><title>' + c + " trade(s) autour de " + (mid > 0 ? "+" : "") + mid + "R</title></rect>";
      if (Math.abs(mid - Math.round(mid)) < 1e-9) g += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + (mid > 0 ? "+" : "") + mid + "R</text>";
    });
    svg.innerHTML = g;
    var bw2 = 0, bl = 0, cw = 0, cl = 0, cum = 0, peak = 0, dd = 0, ddLen = 0, curLen = 0, maxLen = 0;
    rs.forEach(function (r) {
      if (r > 0.05) { cw++; cl = 0; } else if (r < -0.05) { cl++; cw = 0; } else { cw = 0; cl = 0; }
      bw2 = Math.max(bw2, cw); bl = Math.max(bl, cl);
      cum += r; if (cum >= peak) { peak = cum; curLen = 0; } else { curLen++; maxLen = Math.max(maxLen, curLen); } dd = Math.min(dd, cum - peak);
    });
    var last = rs[rs.length - 1], cur = last > 0.05 ? cw + " gagnant" + (cw > 1 ? "s" : "") : last < -0.05 ? cl + " perdant" + (cl > 1 ? "s" : "") : "BE";
    function st(l, v, c) { return '<div><b class="' + (c || "") + '">' + v + "</b><span>" + l + "</span></div>"; }
    $("streaks").innerHTML = st("série gagnante max", bw2, "pos") + st("série perdante max", bl, "neg") + st("série en cours", cur) +
      st("meilleur trade", fmtR(Math.max.apply(null, rs)), "pos") + st("pire trade", fmtR(Math.min.apply(null, rs)), "neg") + st("drawdown max · durée", fmtR(dd) + " · " + maxLen + " tr.", dd < 0 ? "neg" : "");
    $("distHint").textContent = "pas de 0,5R · n " + rs.length;
  }

  /* ================= Labo MFE / MAE ================= */
  var TICK = 0.25, BE_RULE = 1.5;
  function riskPts(t) { return t.entry_price == null || t.sl_price == null ? null : Math.abs(+t.entry_price - +t.sl_price); }
  function simBE(list, X) {
    var o = { lo: 0, hi: 0, real: 0, n: 0, saved: 0, amb: 0, unk: 0 };
    list.forEach(function (t) {
      var r = computeR(t), risk = riskPts(t);
      if (r == null || !risk || t.mfe_pts == null) return;
      var mfeR = +t.mfe_pts / risk, maeR = t.mae_pts == null ? null : +t.mae_pts / risk, tpR = plannedRR(t);
      o.n++; o.real += r;
      if (r < -0.05) { if (mfeR >= X) { o.saved++; } else { o.lo += r; o.hi += r; } }
      else if (r <= 0.05) { if (mfeR >= X) { o.lo += r; o.hi += r; } else { o.unk++; o.lo += -1; o.hi += tpR != null ? tpR : r; } }
      else if (mfeR < X) { o.lo += r; o.hi += r; }
      else if (maeR != null && maeR * risk <= TICK) { o.lo += r; o.hi += r; }
      else { o.amb++; o.hi += r; }
    });
    return o;
  }
  function renderLab(list) {
    var tr = list.filter(function (t) { return t.status !== "no_trade" && computeR(t) != null; });
    var pts2 = tr.filter(function (t) { return t.mfe_pts != null && t.mae_pts != null && riskPts(t); });
    var withMfe = tr.filter(function (t) { return t.mfe_pts != null && riskPts(t); }).length;
    $("labHint").textContent = withMfe + "/" + tr.length + " trades avec MFE · " + pts2.length + " avec MFE + MAE";
    var svg = $("scatter"), H = 240, W = svgW(svg, 400), P = { l: 34, r: 10, t: 10, b: 24 };
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    if (!pts2.length) svg.innerHTML = '<text x="' + W / 2 + '" y="115" text-anchor="middle">Renseigne MFE et MAE sur tes trades pour remplir ce graphe.</text>';
    else {
      var data = pts2.map(function (t) { var k = riskPts(t); return { x: +t.mae_pts / k, y: +t.mfe_pts / k, r: computeR(t), tp: plannedRR(t), id: t.id }; });
      var mxX = Math.max(1.25, Math.max.apply(null, data.map(function (d) { return d.x; })) * 1.1), mxY = Math.max(2.5, Math.max.apply(null, data.map(function (d) { return Math.max(d.y, d.tp || 0); })) * 1.1);
      var x = function (v) { return P.l + (W - P.l - P.r) * v / mxX; }, y = function (v) { return P.t + (H - P.t - P.b) * (1 - v / mxY); }, g = "";
      for (var v = 0; v <= mxY; v += mxY > 5 ? 1 : 0.5) g += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-dasharray="2 4"/><text x="' + (P.l - 5) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + v + "R</text>";
      for (var u = 0; u <= mxX; u += 0.5) g += '<text x="' + x(u) + '" y="' + (H - 7) + '" text-anchor="middle">' + u + "R</text>";
      g += '<line x1="' + x(1) + '" x2="' + x(1) + '" y1="' + P.t + '" y2="' + (H - P.b) + '" stroke="var(--loss)" stroke-opacity=".5"/><text x="' + (x(1) + 4) + '" y="' + (P.t + 10) + '" style="fill:var(--loss)">stop</text>';
      g += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(BE_RULE) + '" y2="' + y(BE_RULE) + '" stroke="var(--accent)" stroke-opacity=".7" stroke-dasharray="6 4"/><text x="' + (W - P.r - 2) + '" y="' + (y(BE_RULE) - 4) + '" text-anchor="end" style="fill:var(--accent)">règle BE +' + BE_RULE + "R</text>";
      data.forEach(function (d) {
        var c = d.r > 0.05 ? "var(--win)" : d.r < -0.05 ? "var(--loss)" : "var(--be)";
        if (d.tp) g += '<line x1="' + (x(d.x) - 6) + '" x2="' + (x(d.x) + 6) + '" y1="' + y(d.tp) + '" y2="' + y(d.tp) + '" stroke="' + c + '" stroke-width="2" stroke-opacity=".6"/>';
        g += '<circle cx="' + x(d.x).toFixed(1) + '" cy="' + y(d.y).toFixed(1) + '" r="5" fill="' + c + '" stroke="var(--panel)" stroke-width="1.5"><title>' + esc(d.id) + " · MAE " + d.x.toFixed(2) + "R · MFE " + d.y.toFixed(2) + "R · résultat " + fmtR(d.r) + "</title></circle>";
      });
      svg.innerHTML = g;
    }
    var rows = [0.5, 1, 1.5, 2].map(function (X) { return { X: X, o: simBE(tr, X) }; }), n = rows[0].o.n;
    if (!n) { $("beSim").innerHTML = '<div class="kpi-s">Aucun trade avec MFE renseigné : le simulateur a besoin du MFE (et idéalement du MAE) de chaque trade.</div>'; $("beNote").textContent = ""; return; }
    var rng = function (o) { return Math.abs(o.hi - o.lo) < 0.005 ? fmtR(o.lo) : fmtR(o.lo) + " → " + fmtR(o.hi); };
    $("beSim").innerHTML = '<table><thead><tr><th>BE à</th><th class="r">R simulé</th><th class="r">vs réel</th></tr></thead><tbody>' + rows.map(function (row) {
      var o = row.o, dlo = o.lo - o.real, dhi = o.hi - o.real;
      return '<tr' + (row.X === BE_RULE ? ' class="hl"' : "") + '><td class="mono">+' + row.X + "R" + (row.X === BE_RULE ? ' <span class="chip">règle</span>' : "") + '</td><td class="r"><span class="res">' + rng(o) + '</span><div class="kpi-s">' +
        [o.saved ? o.saved + " sauvé" + (o.saved > 1 ? "s" : "") : "", o.amb ? o.amb + " ambigu" + (o.amb > 1 ? "s" : "") : "", o.unk ? o.unk + " inconnu" + (o.unk > 1 ? "s" : "") : ""].filter(Boolean).join(" · ") + '</div></td><td class="r res ' + cls((dlo + dhi) / 2) + '">' + (Math.abs(dhi - dlo) < 0.005 ? fmtR(dlo) : fmtR(dlo) + " → " + fmtR(dhi)) + "</td></tr>";
    }).join("") + "</tbody></table>";
    $("beNote").innerHTML = "Base : " + n + " trade" + (n > 1 ? "s" : "") + " avec MFE, réel " + fmtR(rows[0].o.real) + ". <b>Sauvé</b> = perdant qui avait touché le seuil : BE l'aurait sorti à 0. " +
      "<b>Ambigu</b> = gagnant passé par le seuil avec un MAE &gt; 1 tick : on ne sait pas si le recul est venu avant ou après, d'où la fourchette. <b>Inconnu</b> = sorti BE sans atteindre le seuil : borné entre −1R et le TP. " +
      (n < 30 ? '<span class="neg">n &lt; 30 : indicatif seulement.</span>' : "");
  }

  /* ================= Sessions ================= */
  function renderPlans() {
    var el = $("plans");
    if (!state.plans.length) { el.innerHTML = '<div class="empty"><h3>Aucune session</h3><p>Crée une session avant de trader et joins le gameplan HTML, le XML DeepCharts et tes captures.</p></div>'; return; }
    var plans = state.plans.slice().sort(function (a, b) { return String(b.date + b.session).localeCompare(String(a.date + a.session)); });
    el.innerHTML = plans.map(function (p) {
      var trades = state.trades.filter(function (t) { return t.plan_id === p.id; }).sort(byTime), s = stats(trades), att = p.attachments || [];
      return '<article class="plan"><div class="plan-head"><div class="plan-title"><span class="chip s-' + esc(p.session) + '">' + esc(p.session) + "</span><b>" + esc(fmtDate(p.date)) + "</b>" + (p.label ? '<span class="muted">' + esc(p.label) + "</span>" : "") + "</div>" +
        '<div class="plan-meta"><span>' + esc(p.source || "") + "</span><span>" + trades.length + " trade" + (trades.length > 1 ? "s" : "") + '</span><span class="' + cls(s.n ? s.total : null) + '">' + (s.n ? fmtR(s.total) : "—") + "</span></div></div>" +
        (p.thesis ? '<p class="plan-thesis">' + esc(p.thesis) + "</p>" : "") +
        (att.length ? galleryHtml(att, registerGroup("p:" + p.id, att)) : '<div class="empty-media">Aucun fichier. <b>Modifier</b> pour joindre le gameplan HTML, le XML et les captures.</div>') +
        (trades.length ? '<div class="plan-trades">' + trades.map(function (t) { var r = computeR(t); return '<a class="chip ' + cls(r) + '" href="#journal" data-goto="' + esc(t.id) + '">' + (t.status === "no_trade" ? "no-trade" : esc((t.direction || "").toUpperCase()) + " " + fmtR(r)) + "</a>"; }).join("") + "</div>" : "") +
        (p.notes ? '<div class="note"><small>Bilan</small>' + esc(p.notes) + "</div>" : "") +
        '<div class="t-actions"><button type="button" class="btn small" data-editplan="' + esc(p.id) + '">Modifier</button><button type="button" class="btn small danger" data-delplan="' + esc(p.id) + '">Supprimer</button></div></article>';
    }).join("");
    signImages([].concat.apply([], state.plans.map(function (p) { return p.attachments || []; })));
  }

  /* ================= Recherche ================= */
  function renderResearch() {
    var rows = state.research.slice().sort(function (a, b) { return b.n - a.n; });
    $("researchHint").textContent = rows.length ? "mis à jour " + fmtDate(String(rows.map(function (r) { return r.updated_at; }).sort().pop()).slice(0, 10)) : "";
    $("research").innerHTML = !rows.length ? '<div class="kpi-s">Aucun résultat. Codex ou Claude les ajoutent dans la table research_results.</div>' :
      '<table><thead><tr><th>Setup</th><th>Session</th><th>Période</th><th class="r">n</th><th class="r">WR</th><th class="r">Esp.</th><th>Statut</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="lbl"><b>' + esc(r.setup) + "</b>" + (r.method ? '<div class="kpi-s">' + esc(r.method) + "</div>" : "") + (r.notes ? '<div class="kpi-s">' + esc(r.notes) + "</div>" : "") +
          "</td><td>" + esc(r.session || "") + '</td><td class="mono">' + esc(r.period_start ? fmtDate(r.period_start) + " → " + fmtDate(r.period_end) : "") + '</td><td class="r">' + esc(r.n) +
          '</td><td class="r">' + (r.win_rate == null ? "—" : pct(+r.win_rate)) + '</td><td class="r res ' + cls(r.expectancy_r == null ? null : +r.expectancy_r) + '">' + (r.expectancy_r == null ? "—" : fmtR(+r.expectancy_r)) +
          '</td><td><span class="chip st-' + esc(r.status) + '">' + esc(r.status) + "</span></td></tr>";
      }).join("") + "</tbody></table>";
    var gx = state.gex.slice().sort(function (a, b) { return String(b.captured_at).localeCompare(String(a.captured_at)); });
    $("gexHint").textContent = gx.length + " snapshot" + (gx.length > 1 ? "s" : "");
    $("gexList").innerHTML = gx.length ? gx.slice(0, 12).map(function (g) {
      return '<div class="gex-row"><span class="chip s-' + esc(g.session) + '">' + esc(g.session) + "</span><span>" + esc(fmtDate(g.target_date)) + " · " + esc(g.source) + (g.net_gex != null ? ' · <span class="mono">' + esc(g.net_gex) + " $M</span>" : "") +
        '</span><span class="' + (g.regime === "negative" ? "neg" : g.regime === "positive" ? "pos" : "muted") + '">' + (g.regime === "negative" ? "GEX −" : g.regime === "positive" ? "GEX +" : "?") + "</span></div>";
    }).join("") : '<div class="kpi-s">Aucun snapshot pour l\'instant.</div>';
  }

  function renderAll() { groups = {}; renderJournal(); renderPlans(); renderBacktest(); renderResearch(); }

  /* ================= Onglets & filtres ================= */
  var TABS = ["journal", "sessions", "backtest", "recherche"];
  function showTab() {
    var tab = (location.hash || "#journal").slice(1); if (TABS.indexOf(tab) < 0) tab = "journal";
    TABS.forEach(function (k) { $("tab-" + k).hidden = k !== tab; });
    document.querySelectorAll(".tab").forEach(function (a) { if (a.getAttribute("data-tab") === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  function redrawCharts() {
    var tab = (location.hash || "#journal").slice(1);
    if (tab === "journal") { var l = filtered(); renderCurve(l); renderDistribution(l); renderLab(l); }
    else if (tab === "backtest") renderCurve(btFiltered(), "btCurve", "btCurveHint");
  }
  window.addEventListener("hashchange", function () { showTab(); redrawCharts(); });
  var rz; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(redrawCharts, 150); });
  document.querySelectorAll(".filters button[data-f]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.filter = b.getAttribute("data-f");
      document.querySelectorAll(".filters button[data-f]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      renderAll();
    });
  });

  /* ================= Tiroir ================= */
  function openDrawer(title, formId) {
    ["tradeForm", "planForm", "gexForm", "btSessForm", "btTradeForm"].forEach(function (id) { $(id).hidden = id !== formId; });
    $("drawerTitle").textContent = title; $("drawer").hidden = false; document.body.style.overflow = "hidden";
    $("drawer").querySelector(".drawer-panel").scrollTop = 0;
  }
  function closeDrawer() { $("drawer").hidden = true; document.body.style.overflow = ""; }
  $("drawer").addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeDrawer(); });
  var today = function () { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  var setVal = function (id, v) { $(id).value = v == null ? "" : v; };
  var num = function (id) { var v = $(id).value.trim(); return v === "" ? null : +v; };
  var txt = function (id) { var v = $(id).value.trim(); return v === "" ? null : v; };

  function renderAttEdit(el, ctx) {
    $(el).innerHTML = ctx.list.length ? ctx.list.map(function (a, i) {
      var e = extOf(a) || "fichier", gone = !!ctx.removed[i];
      return '<span class="file' + (gone ? " removed" : "") + '"><span class="ext ' + esc(e) + '">' + esc(e.toUpperCase()) + '</span><span class="fn">' + esc(a.name || a.path) +
        '</span><button type="button" class="rm" data-rm="' + i + '" aria-label="' + (gone ? "Garder " : "Retirer ") + esc(a.name || "") + '">' + (gone ? "↺" : "✕") + "</button></span>";
    }).join("") : '<span class="kpi-s">Aucune pièce jointe pour l\'instant.</span>';
  }
  function wireAttEdit(el, getCtx) {
    $(el).addEventListener("click", function (e) {
      var b = e.target.closest("[data-rm]"); if (!b) return;
      var ctx = getCtx(), i = +b.getAttribute("data-rm"); ctx.removed[i] = !ctx.removed[i]; renderAttEdit(el, ctx);
    });
  }
  function wireDrop(inputId) {
    var z = document.querySelector('label[for="' + inputId + '"]');
    ["dragenter", "dragover"].forEach(function (ev) { z.addEventListener(ev, function (e) { e.preventDefault(); z.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { z.addEventListener(ev, function () { z.classList.remove("over"); }); });
    z.addEventListener("drop", function (e) { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) $(inputId).files = e.dataTransfer.files; });
  }

  /* ---- Trade ---- */
  var tctx = { editing: null, list: [], removed: {} };
  wireAttEdit("tradeAtt", function () { return tctx; });
  wireDrop("i-files");
  function fillPlanSelect(date, session, current) {
    var opts = state.plans.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    $("i-plan").innerHTML = '<option value="">— aucun —</option>' + opts.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(fmtDate(p.date) + " · " + p.session + (p.label ? " · " + p.label : "")) + "</option>"; }).join("");
    $("i-plan").value = current || (planById(date + "-" + session) ? date + "-" + session : "");
  }
  $("i-tags").innerHTML = TAGS.map(function (t) { return '<label class="tagopt"><input type="checkbox" value="' + t[0] + '"><span>' + esc(t[1]) + "</span></label>"; }).join("");
  function setTags(list) { $("i-tags").querySelectorAll("input").forEach(function (c) { c.checked = (list || []).indexOf(c.value) >= 0; }); }
  function getTags() { return Array.prototype.filter.call($("i-tags").querySelectorAll("input"), function (c) { return c.checked; }).map(function (c) { return c.value; }); }
  function syncType() { $("tradeFields").hidden = $("i-status").value === "no_trade"; updatePreview(); }
  function updatePreview() {
    if ($("i-status").value === "no_trade") { $("rPreview").textContent = "No trade"; $("rPreview").className = "preview"; return; }
    var t = { direction: $("i-direction").value, entry_price: num("i-entry"), sl_price: num("i-sl"), exit_price: num("i-exit"), tp_price: num("i-tp") };
    var r = computeR(t), rr = plannedRR(t);
    $("rPreview").textContent = "R " + fmtR(r) + (rr ? " · R:R prévu 1:" + rr.toFixed(2) : "");
    $("rPreview").className = "preview " + cls(r);
  }
  $("i-status").addEventListener("change", syncType);
  ["i-direction", "i-entry", "i-sl", "i-tp", "i-exit"].forEach(function (id) { $(id).addEventListener("input", updatePreview); });
  ["i-date", "i-session"].forEach(function (id) { $(id).addEventListener("change", function () { if (!tctx.editing) fillPlanSelect($("i-date").value, $("i-session").value); }); });

  function openTrade(t) {
    tctx = { editing: t ? t.id : null, list: t ? (t.attachments || []).slice() : [], removed: {} };
    t = t || { date: today(), session: "London", status: "trade", direction: "long", entry_type: "principale", plan_source: "MenthorQ", gex_regime: "positive", exit_reason: "TP" };
    setVal("i-date", t.date); setVal("i-time", t.time_guyane); setVal("i-session", t.session); setVal("i-status", t.status || "trade");
    setVal("i-direction", t.direction || "long"); setVal("i-entrytype", t.entry_type || "principale"); setVal("i-source", t.plan_source || "MenthorQ");
    setVal("i-contracts", t.contracts); setVal("i-scenario", t.scenario); setVal("i-score", t.setup_score == null ? "" : String(t.setup_score)); setVal("i-regime", t.gex_regime || "positive");
    setVal("i-entry", t.entry_price); setVal("i-entrylevel", t.entry_level); setVal("i-sl", t.sl_price); setVal("i-sllevel", t.sl_level); setVal("i-slmoved", t.sl_moved_price);
    setVal("i-tp", t.tp_price); setVal("i-tplevel", t.tp_level); setVal("i-exit", t.exit_price); setVal("i-exitreason", t.exit_reason || "TP");
    setVal("i-mfe", t.mfe_pts); setVal("i-mae", t.mae_pts); setVal("i-cvd", t.cvd); setVal("i-respected", t.plan_respected === false ? "no" : "yes");
    setVal("i-notes", t.notes); setVal("i-lessons", t.lessons); $("i-files").value = ""; setTags(t.error_tags);
    fillPlanSelect(t.date, t.session, t.plan_id);
    renderAttEdit("tradeAtt", tctx);
    $("tradeMsg").textContent = ""; $("tradeMsg").className = "msg";
    openDrawer(tctx.editing ? "Modifier le trade" : "Nouveau trade", "tradeForm"); syncType();
  }
  $("addTradeBtn").addEventListener("click", function () { openTrade(null); });

  $("tradeForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("tradeMsg"); msg.className = "msg";
    var date = txt("i-date"), session = $("i-session").value, nt = $("i-status").value === "no_trade";
    if (!date) { msg.textContent = "Indique la date."; msg.className = "msg err"; return; }
    if (!nt && (num("i-entry") == null || num("i-sl") == null || num("i-exit") == null)) { msg.textContent = "Entrée, stop et sortie réelle sont obligatoires pour calculer le R."; msg.className = "msg err"; return; }
    if (!nt && num("i-entry") === num("i-sl")) { msg.textContent = "Le stop ne peut pas être égal à l'entrée."; msg.className = "msg err"; return; }
    var o = { date: date, time_guyane: txt("i-time"), session: session, status: nt ? "no_trade" : "trade", plan_id: $("i-plan").value || null, notes: txt("i-notes"), lessons: txt("i-lessons") };
    var T = { direction: $("i-direction").value, entry_type: $("i-entrytype").value, plan_source: $("i-source").value, instrument: "MNQ", contracts: num("i-contracts"), scenario: txt("i-scenario"),
      setup_score: $("i-score").value === "" ? null : +$("i-score").value, gex_regime: $("i-regime").value, entry_price: num("i-entry"), entry_level: txt("i-entrylevel"),
      sl_price: num("i-sl"), sl_level: txt("i-sllevel"), sl_moved_price: num("i-slmoved"), tp_price: num("i-tp"), tp_level: txt("i-tplevel"), exit_price: num("i-exit"), exit_reason: $("i-exitreason").value,
      mfe_pts: num("i-mfe"), mae_pts: num("i-mae"), cvd: txt("i-cvd"), plan_respected: $("i-respected").value === "yes" };
    Object.keys(T).forEach(function (k) { o[k] = nt ? null : T[k]; });
    o.error_tags = nt ? [] : getTags();
    var id = tctx.editing;
    if (!id) { var n = 1; while (tradeById(date + "-" + session + "-" + n)) n++; id = date + "-" + session + "-" + n; }
    o.id = id;
    var keep = tctx.list.filter(function (_, i) { return !tctx.removed[i]; });
    var drop = tctx.list.filter(function (_, i) { return tctx.removed[i]; }).map(function (a) { return a.path; });
    $("tradeSave").disabled = true; msg.textContent = "Enregistrement…";
    uploadAll("trades/" + id, $("i-files").files).then(function (added) {
      o.attachments = keep.concat(added);
      return sb.from("trades").upsert(o);
    }).then(function (r) {
      if (r.error) throw r.error; removeFiles(drop); closeDrawer(); return load();
    }).catch(function (err) { msg.textContent = "Échec : " + (err && err.message || "erreur") + ". Réessaie."; msg.className = "msg err"; })
      .then(function () { $("tradeSave").disabled = false; });
  });

  /* ---- Session / plan ---- */
  var pctx = { editing: null, list: [], removed: {} };
  wireAttEdit("planAtt", function () { return pctx; });
  wireDrop("p-files");
  function openPlan(p) {
    pctx = { editing: p ? p.id : null, list: p ? (p.attachments || []).slice() : [], removed: {} };
    p = p || { date: today(), session: "London", source: "MenthorQ" };
    setVal("p-date", p.date); setVal("p-session", p.session); setVal("p-source", p.source || "MenthorQ"); setVal("p-label", p.label);
    setVal("p-thesis", p.thesis); setVal("p-notes", p.notes); $("p-files").value = "";
    $("p-date").disabled = $("p-session").disabled = !!pctx.editing;
    renderAttEdit("planAtt", pctx);
    $("planMsg").textContent = ""; $("planMsg").className = "msg";
    openDrawer(pctx.editing ? "Modifier la session" : "Nouvelle session", "planForm");
  }
  $("addPlanBtn").addEventListener("click", function () { openPlan(null); });
  $("planForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("planMsg"), date = txt("p-date"), session = $("p-session").value;
    if (!date) { msg.textContent = "Indique la date."; msg.className = "msg err"; return; }
    var id = pctx.editing || date + "-" + session;
    if (!pctx.editing && planById(id)) { msg.textContent = "Cette session existe déjà : ouvre-la avec Modifier."; msg.className = "msg err"; return; }
    var o = { id: id, date: date, session: session, source: $("p-source").value, label: txt("p-label"), thesis: txt("p-thesis"), notes: txt("p-notes") };
    var keep = pctx.list.filter(function (_, i) { return !pctx.removed[i]; });
    var drop = pctx.list.filter(function (_, i) { return pctx.removed[i]; }).map(function (a) { return a.path; });
    $("planSave").disabled = true; msg.className = "msg"; msg.textContent = "Enregistrement…";
    uploadAll("plans/" + id, $("p-files").files).then(function (added) {
      o.attachments = keep.concat(added);
      return sb.from("plans").upsert(o);
    }).then(function (r) {
      if (r.error) throw r.error; removeFiles(drop); closeDrawer(); return load();
    }).catch(function (err) { msg.textContent = "Échec : " + (err && err.message || "erreur") + ". Réessaie."; msg.className = "msg err"; })
      .then(function () { $("planSave").disabled = false; });
  });

  /* ---- Snapshot GEX ---- */
  $("addGexBtn").addEventListener("click", function () {
    setVal("g-date", today()); setVal("g-session", "London"); setVal("g-source", "Quin"); setVal("g-regime", ""); setVal("g-spot", ""); setVal("g-net", ""); setVal("g-raw", "");
    $("gexMsg").textContent = ""; $("gexMsg").className = "msg"; openDrawer("Snapshot GEX pré-session", "gexForm");
  });
  $("gexForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("gexMsg");
    if (!txt("g-date")) { msg.textContent = "Indique la date de la session."; msg.className = "msg err"; return; }
    if (!txt("g-raw") && num("g-net") == null) { msg.textContent = "Colle la sortie brute ou indique au moins le Net GEX."; msg.className = "msg err"; return; }
    var o = { captured_at: new Date().toISOString(), target_date: txt("g-date"), session: $("g-session").value, source: $("g-source").value,
      regime: $("g-regime").value || null, spot: num("g-spot"), net_gex: num("g-net"), raw: txt("g-raw") };
    $("gexSave").disabled = true; msg.className = "msg"; msg.textContent = "Enregistrement…";
    sb.from("gex_snapshots").insert(o).then(function (r) {
      if (r.error) throw r.error; closeDrawer(); return load();
    }).catch(function (err) { msg.textContent = "Échec : " + (err && err.message || "erreur"); msg.className = "msg err"; })
      .then(function () { $("gexSave").disabled = false; });
  });

  /* ================= Backtest ================= */
  function btSessById(id) { return state.bts.filter(function (s) { return s.id === id; })[0]; }
  function btAll(kindOnly) {
    var out = [];
    state.btt.forEach(function (t) {
      var s = btSessById(t.bt_session_id); if (!s) return;
      if (state.btKind !== "all" && s.kind !== state.btKind) return;
      if (!kindOnly && state.btSess !== "all" && s.session !== state.btSess) return;
      out.push(Object.assign({}, t, { date: s.date, session: s.session, gex_regime: s.gex_regime, kind: s.kind }));
    });
    return out.sort(byTime);
  }
  function btFiltered() { return btAll(false); }
  function renderLiveVsBt() {
    var live = state.trades.filter(function (t) { return t.status !== "no_trade"; }), bt = btAll(true);
    var segs = [["Tout", function () { return true; }], ["Asian", function (t) { return t.session === "Asian"; }], ["London", function (t) { return t.session === "London"; }], ["NY", function (t) { return t.session === "NY"; }],
      ["GEX +", function (t) { return t.gex_regime === "positive"; }], ["GEX −", function (t) { return t.gex_regime === "negative"; }]];
    $("liveVsBt").innerHTML = '<table><thead><tr><th></th><th class="r">Live</th><th class="r">Backtest</th><th class="r">Écart</th></tr></thead><tbody>' + segs.map(function (sg) {
      var a = stats(live.filter(sg[1])), b = stats(bt.filter(sg[1]));
      if (!a.n && !b.n) return "";
      var gap = a.n && b.n ? a.exp - b.exp : null, ok = a.n >= 30 && b.n >= 30;
      var lbl = /^(Asian|London|NY)$/.test(sg[0]) ? '<span class="chip s-' + sg[0] + '">' + sg[0] + "</span>" : esc(sg[0]);
      return '<tr><td class="lbl">' + lbl + '</td><td class="r"><span class="res ' + cls(a.exp) + '">' + fmtR(a.exp) + '</span><div class="kpi-s">n ' + a.n + '</div></td><td class="r"><span class="res ' + cls(b.exp) + '">' + fmtR(b.exp) + '</span><div class="kpi-s">n ' + b.n +
        '</div></td><td class="r">' + (gap == null ? "—" : '<span class="res ' + (ok ? cls(gap) : "muted") + '">' + fmtR(gap) + "</span>" + (ok ? "" : '<div class="kpi-s">low_n</div>')) + "</td></tr>";
    }).join("") + "</tbody></table>";
  }
  function renderBacktest() {
    var list = btFiltered();
    renderKpiBox("btKpis", "btWarn", list, function (t) { return t.rules_respected !== false; }, "Règles respectées");
    if ((location.hash || "").slice(1) === "backtest") renderCurve(list, "btCurve", "btCurveHint");
    renderLiveVsBt();
    var ss = state.bts.filter(function (s) { return (state.btKind === "all" || s.kind === state.btKind) && (state.btSess === "all" || s.session === state.btSess); })
      .sort(function (a, b) { return String(b.date + b.session + b.id).localeCompare(String(a.date + a.session + a.id)); });
    $("btHint").textContent = ss.length + " session" + (ss.length > 1 ? "s" : "");
    var el = $("btSessions");
    if (!state.bts.length) { el.innerHTML = '<div class="empty"><h3>Aucun backtest</h3><ol><li>Crée une <b>session backtest</b> : date rejouée, session, setup testé, règles.</li><li>Rejoue la session sur DeepCharts et logue chaque trade avec <b>+ Trade</b>, MFE et MAE compris.</li><li>Ici tu compares ensuite live vs backtest, segment par segment.</li></ol></div>'; return; }
    if (!ss.length) { el.innerHTML = '<div class="kpi-s">Aucune session pour ce filtre.</div>'; return; }
    el.innerHTML = ss.map(function (s) {
      var ts = state.btt.filter(function (t) { return t.bt_session_id === s.id; }).sort(byTime), st = stats(ts), att = s.attachments || [], plan = s.plan_id ? planById(s.plan_id) : null;
      var rows = ts.length ? '<div class="tbl-wrap"><table class="bt-table"><thead><tr><th>Heure</th><th>Trade</th><th class="r">R</th><th>Sortie</th><th></th></tr></thead><tbody>' + ts.map(function (t) {
        var r = computeR(t);
        return "<tr><td class=\"mono\">" + esc(t.time_guyane || "—") + '</td><td class="lbl"><b>' + esc(t.direction.toUpperCase()) + " " + esc(t.entry_price) + "</b>" + (t.entry_level ? ' <span class="muted">· ' + esc(t.entry_level) + "</span>" : "") +
          '<div class="kpi-s">stop ' + esc(t.sl_price) + (t.tp_price != null ? " · TP " + esc(t.tp_price) : "") + (t.mfe_pts != null ? " · MFE " + esc(t.mfe_pts) : "") + (t.mae_pts != null ? " · MAE " + esc(t.mae_pts) : "") + (t.rules_respected === false ? ' · <span class="neg">règles non respectées</span>' : "") + "</div>" +
          (t.notes ? '<div class="kpi-s">' + esc(t.notes) + "</div>" : "") + '</td><td class="r res ' + cls(r) + '">' + fmtR(r) + '</td><td class="mono">' + esc(t.exit_price) + '<div class="kpi-s">' + esc(t.exit_reason || "") + '</div></td><td class="r"><button type="button" class="icon-btn sm" data-btedit="' + t.id + '" aria-label="Modifier">✎</button> <button type="button" class="icon-btn sm danger" data-btdel="' + t.id + '" aria-label="Supprimer">✕</button></td></tr>';
      }).join("") + "</tbody></table></div>" : '<div class="empty-media">Aucun trade logué sur cette session.</div>';
      return '<article class="plan"><div class="plan-head"><div class="plan-title"><span class="chip s-' + esc(s.session) + '">' + esc(s.session) + "</span><b>" + esc(fmtDate(s.date)) + '</b><span class="chip k-' + esc(s.kind) + '">' + esc(s.kind) + "</span>" + (s.setup ? '<span class="muted">' + esc(s.setup) + "</span>" : "") + "</div>" +
        '<div class="plan-meta">' + (s.gex_regime ? '<span class="' + (s.gex_regime === "negative" ? "neg" : "pos") + '">' + (s.gex_regime === "negative" ? "GEX −" : "GEX +") + "</span>" : "") + (s.source ? "<span>" + esc(s.source) + "</span>" : "") + "<span>" + ts.length + " trade" + (ts.length > 1 ? "s" : "") + '</span><span class="' + cls(st.n ? st.total : null) + '">' + (st.n ? fmtR(st.total) : "—") + "</span></div></div>" +
        (s.method ? '<div class="note"><small>Règles</small>' + esc(s.method) + "</div>" : "") +
        (plan ? '<div class="plan-link"><span class="kpi-l" style="margin:0">Gameplan</span><a href="#sessions" class="chip s-' + esc(plan.session) + '">' + esc(fmtDate(plan.date) + " · " + plan.session + (plan.label ? " · " + plan.label : "")) + "</a></div>" : "") +
        rows + (att.length ? galleryHtml(att, registerGroup("b:" + s.id, att)) : "") +
        (s.notes ? '<div class="note"><small>Notes</small>' + esc(s.notes) + "</div>" : "") +
        '<div class="t-actions"><button type="button" class="btn small primary" data-btadd="' + s.id + '">+ Trade</button><button type="button" class="btn small" data-bteditsess="' + s.id + '">Modifier</button><button type="button" class="btn small danger" data-btdelsess="' + s.id + '">Supprimer</button></div></article>';
    }).join("");
    signImages([].concat.apply([], ss.map(function (s) { return s.attachments || []; })));
  }
  document.querySelectorAll("#btFilters button").forEach(function (b) {
    b.addEventListener("click", function () {
      var k = b.hasAttribute("data-bf") ? "data-bf" : "data-bs";
      if (k === "data-bf") state.btKind = b.getAttribute(k); else state.btSess = b.getAttribute(k);
      document.querySelectorAll("#btFilters button[" + k + "]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      groups = {}; renderBacktest();
    });
  });

  /* ---- Session backtest ---- */
  var bctx = { editing: null, list: [], removed: {} };
  wireAttEdit("btAtt", function () { return bctx; });
  wireDrop("b-files");
  function openBtSess(s) {
    bctx = { editing: s ? s.id : null, list: s ? (s.attachments || []).slice() : [], removed: {} };
    s = s || { kind: "replay", date: "", session: "London" };
    setVal("b-kind", s.kind); setVal("b-date", s.date); setVal("b-session", s.session); setVal("b-source", s.source || ""); setVal("b-setup", s.setup);
    setVal("b-regime", s.gex_regime || ""); setVal("b-method", s.method); setVal("b-notes", s.notes); $("b-files").value = "";
    $("b-plan").innerHTML = '<option value="">— aucun —</option>' + state.plans.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })
      .map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(fmtDate(p.date) + " · " + p.session + (p.label ? " · " + p.label : "")) + "</option>"; }).join("");
    setVal("b-plan", s.plan_id || "");
    renderAttEdit("btAtt", bctx); $("btSessMsg").textContent = ""; $("btSessMsg").className = "msg";
    openDrawer(bctx.editing ? "Modifier la session backtest" : "Nouvelle session backtest", "btSessForm");
  }
  $("addBtBtn").addEventListener("click", function () { openBtSess(null); });
  ["b-date", "b-session"].forEach(function (id) { $(id).addEventListener("change", function () { var k = $("b-date").value + "-" + $("b-session").value; if (!$("b-plan").value && planById(k)) $("b-plan").value = k; }); });
  $("btSessForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("btSessMsg"); msg.className = "msg";
    if (!txt("b-date")) { msg.textContent = "Indique la date rejouée."; msg.className = "msg err"; return; }
    var o = { kind: $("b-kind").value, date: txt("b-date"), session: $("b-session").value, source: $("b-source").value || null, setup: txt("b-setup"), gex_regime: $("b-regime").value || null,
      plan_id: $("b-plan").value || null, method: txt("b-method"), notes: txt("b-notes"), updated_at: new Date().toISOString() };
    var keep = bctx.list.filter(function (_, i) { return !bctx.removed[i]; }), drop = bctx.list.filter(function (_, i) { return bctx.removed[i]; }).map(function (a) { return a.path; });
    $("btSessSave").disabled = true; msg.textContent = "Enregistrement…";
    uploadAll("bt/" + (bctx.editing || "s" + Date.now()), $("b-files").files).then(function (added) {
      o.attachments = keep.concat(added);
      return bctx.editing ? sb.from("bt_sessions").update(o).eq("id", bctx.editing) : sb.from("bt_sessions").insert(o);
    }).then(function (r) { if (r.error) throw r.error; removeFiles(drop); closeDrawer(); return load(); })
      .catch(function (err) { msg.textContent = "Échec : " + (err && err.message || "erreur") + ". Réessaie."; msg.className = "msg err"; })
      .then(function () { $("btSessSave").disabled = false; });
  });

  /* ---- Trade backtest ---- */
  var btctx = { session: null, editing: null };
  function btPreview() {
    var t = { direction: $("bt-direction").value, entry_price: num("bt-entry"), sl_price: num("bt-sl"), exit_price: num("bt-exit"), tp_price: num("bt-tp") }, r = computeR(t), rr = plannedRR(t);
    $("btPreview").textContent = "R " + fmtR(r) + (rr ? " · R:R prévu 1:" + rr.toFixed(2) : ""); $("btPreview").className = "preview " + cls(r);
  }
  ["bt-direction", "bt-entry", "bt-sl", "bt-tp", "bt-exit"].forEach(function (id) { $(id).addEventListener("input", btPreview); });
  function openBtTrade(sessionId, t) {
    var s = btSessById(sessionId); btctx = { session: sessionId, editing: t ? t.id : null };
    t = t || { direction: "long", entry_type: "principale", exit_reason: "TP", rules_respected: true };
    setVal("bt-time", t.time_guyane); setVal("bt-direction", t.direction); setVal("bt-entrytype", t.entry_type || "principale"); setVal("bt-score", t.setup_score == null ? "" : String(t.setup_score));
    setVal("bt-scenario", t.scenario); setVal("bt-entry", t.entry_price); setVal("bt-entrylevel", t.entry_level); setVal("bt-sl", t.sl_price); setVal("bt-sllevel", t.sl_level);
    setVal("bt-tp", t.tp_price); setVal("bt-tplevel", t.tp_level); setVal("bt-exit", t.exit_price); setVal("bt-exitreason", t.exit_reason || "TP");
    setVal("bt-mfe", t.mfe_pts); setVal("bt-mae", t.mae_pts); setVal("bt-rules", t.rules_respected === false ? "no" : "yes"); setVal("bt-notes", t.notes);
    $("btTradeMsg").textContent = ""; $("btTradeMsg").className = "msg"; btPreview();
    openDrawer((btctx.editing ? "Modifier · " : "Trade backtest · ") + (s ? fmtDate(s.date) + " " + s.session : ""), "btTradeForm");
  }
  $("btTradeForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("btTradeMsg"); msg.className = "msg";
    if (num("bt-entry") == null || num("bt-sl") == null || num("bt-exit") == null) { msg.textContent = "Entrée, stop et sortie sont obligatoires pour calculer le R."; msg.className = "msg err"; return; }
    if (num("bt-entry") === num("bt-sl")) { msg.textContent = "Le stop ne peut pas être égal à l'entrée."; msg.className = "msg err"; return; }
    var o = { bt_session_id: btctx.session, time_guyane: txt("bt-time"), direction: $("bt-direction").value, entry_type: $("bt-entrytype").value, scenario: txt("bt-scenario"),
      setup_score: $("bt-score").value === "" ? null : +$("bt-score").value, entry_price: num("bt-entry"), entry_level: txt("bt-entrylevel"), sl_price: num("bt-sl"), sl_level: txt("bt-sllevel"),
      tp_price: num("bt-tp"), tp_level: txt("bt-tplevel"), exit_price: num("bt-exit"), exit_reason: $("bt-exitreason").value, mfe_pts: num("bt-mfe"), mae_pts: num("bt-mae"),
      rules_respected: $("bt-rules").value === "yes", notes: txt("bt-notes") };
    $("btTradeSave").disabled = true; msg.textContent = "Enregistrement…";
    (btctx.editing ? sb.from("bt_trades").update(o).eq("id", btctx.editing) : sb.from("bt_trades").insert(o))
      .then(function (r) { if (r.error) throw r.error; closeDrawer(); return load(); })
      .catch(function (err) { msg.textContent = "Échec : " + (err && err.message || "erreur") + ". Réessaie."; msg.className = "msg err"; })
      .then(function () { $("btTradeSave").disabled = false; });
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var id;
    if ((id = b.getAttribute("data-btadd"))) openBtTrade(+id, null);
    else if ((id = b.getAttribute("data-bteditsess"))) openBtSess(btSessById(+id));
    else if ((id = b.getAttribute("data-btedit"))) { var t = state.btt.filter(function (x) { return x.id === +id; })[0]; if (t) openBtTrade(t.bt_session_id, t); }
    else if ((id = b.getAttribute("data-btdel"))) {
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "?"; setTimeout(function () { b.classList.remove("armed"); b.textContent = "✕"; }, 4000); return; }
      b.disabled = true; sb.from("bt_trades").delete().eq("id", +id).then(function (r) { if (r.error) throw r.error; return load(); }).catch(function () { b.disabled = false; });
    }
    else if ((id = b.getAttribute("data-btdelsess"))) {
      var s = btSessById(+id);
      armDelete(b, function () { return sb.from("bt_sessions").delete().eq("id", +id).then(function (r) { if (r.error) throw r.error; removeFiles((s.attachments || []).map(function (a) { return a.path; })); return load(); }); });
    }
  });

  /* ---- Clics dans les listes ---- */
  function armDelete(b, fn) {
    if (!b.classList.contains("armed")) { var label = b.textContent; b.classList.add("armed"); b.textContent = "Confirmer la suppression"; setTimeout(function () { b.classList.remove("armed"); b.textContent = label; }, 4000); return; }
    b.disabled = true; b.textContent = "Suppression…"; fn().catch(function () { b.disabled = false; b.textContent = "Échec, réessaie"; });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button, a"); if (!b) return;
    var id;
    if ((id = b.getAttribute("data-open"))) { openViewer(images(groups[id] || []), +b.getAttribute("data-i")); }
    else if ((id = b.getAttribute("data-file"))) { openViewer(others(groups[id] || []), +b.getAttribute("data-i")); }
    else if ((id = b.getAttribute("data-edit"))) openTrade(tradeById(id));
    else if ((id = b.getAttribute("data-del"))) {
      var t = tradeById(id);
      armDelete(b, function () { return sb.from("trades").delete().eq("id", id).then(function (r) { if (r.error) throw r.error; removeFiles((t.attachments || []).map(function (a) { return a.path; })); return load(); }); });
    }
    else if ((id = b.getAttribute("data-editplan"))) openPlan(planById(id));
    else if ((id = b.getAttribute("data-delplan"))) {
      var p = planById(id);
      armDelete(b, function () { return sb.from("plans").delete().eq("id", id).then(function (r) { if (r.error) throw r.error; removeFiles((p.attachments || []).map(function (a) { return a.path; })); return load(); }); });
    }
    else if ((id = b.getAttribute("data-goto"))) {
      setTimeout(function () { var d = $("trade-" + id); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); } }, 60);
    }
  });

  /* ================= Données & auth ================= */
  var setStatus = function (t, live) { $("status").textContent = t; $("dot").className = "dot" + (live ? " live" : ""); };
  function load() {
    return Promise.all([
      sb.from("trades").select("*"), sb.from("plans").select("*"),
      sb.from("research_results").select("*"), sb.from("gex_snapshots").select("id,captured_at,target_date,session,source,spot,net_gex,regime"),
      sb.from("bt_sessions").select("*"), sb.from("bt_trades").select("*")
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { setStatus("Erreur : " + bad.error.message, false); return; }
      state.trades = rs[0].data; state.plans = rs[1].data; state.research = rs[2].data; state.gex = rs[3].data; state.bts = rs[4].data; state.btt = rs[5].data;
      setStatus(state.trades.length + " trade" + (state.trades.length > 1 ? "s" : "") + " · synchro", true);
      var open = Array.prototype.map.call(document.querySelectorAll("details.trade[open], details.bt[open]"), function (d) { return d.id; });
      renderAll();
      open.forEach(function (id) { var d = $(id); if (d) d.open = true; });
    });
  }
  function showApp(session) {
    $("login").hidden = !!session; $("app").hidden = !session;
    $("who").textContent = session && session.user ? session.user.email : "";
    if (session) { showTab(); load(); }
  }
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("l-email").value.trim(), pass = $("l-pass").value, m = $("loginMsg");
    if (!email) { m.textContent = "Entre ton email."; return; }
    m.textContent = pass ? "Connexion…" : "Envoi…";
    if (pass) { sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) { m.textContent = r.error ? "Email ou mot de passe incorrect." : ""; }); return; }
    sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } }).then(function (r) {
      if (!r.error) { m.textContent = "Lien envoyé. Ouvre l'email sur cet appareil et touche le lien."; return; }
      m.textContent = /rate limit/i.test(r.error.message) ? "Trop d'emails envoyés : réessaie dans une heure ou utilise ton mot de passe." : "Échec : " + r.error.message;
    });
  });
  $("pwForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var p = $("pw-new").value, m = $("pwMsg");
    if (p.length < 8) { m.textContent = "8 caractères minimum."; return; }
    m.textContent = "Enregistrement…";
    sb.auth.updateUser({ password: p }).then(function (r) {
      if (r.error) { m.textContent = /different/i.test(r.error.message) ? "C'est déjà ton mot de passe actuel." : "Échec : " + r.error.message; return; }
      $("pw-new").value = ""; m.textContent = "Mot de passe enregistré.";
    });
  });
  $("logoutBtn").addEventListener("click", function () { sb.auth.signOut(); });
  sb.auth.getSession().then(function (r) { showApp(r.data.session); });
  sb.auth.onAuthStateChange(function (ev, session) { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") showApp(session); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("app").hidden && $("drawer").hidden && $("viewer").hidden) load(); });
})();
