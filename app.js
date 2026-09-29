(function () {
  "use strict";
  var state = { trades: [], plans: [], research: [], gex: [], filter: "all", imgUrls: {}, pending: {} };
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
  function renderKpis(list) {
    var s = stats(list), noTrade = list.filter(function (t) { return t.status === "no_trade"; }).length;
    var tr = list.filter(function (t) { return t.status !== "no_trade"; });
    var resp = tr.length ? tr.filter(function (t) { return t.plan_respected !== false; }).length / tr.length : null;
    $("kpis").innerHTML =
      kpi("Trades", s.n, noTrade ? noTrade + " no-trade" : "exécutés") +
      kpi("Win rate", pct(s.wr), s.n ? (s.n - s.be) + " décidés · " + s.be + " BE" : "") +
      kpi("Espérance", fmtR(s.exp), "par trade", cls(s.exp)) +
      kpi("Total", fmtR(s.n ? s.total : null), "R cumulés", cls(s.total)) +
      kpi("Profit factor", s.pf == null ? "—" : s.pf === Infinity ? "∞" : s.pf.toFixed(2), s.avgW != null ? "gain moy " + fmtR(s.avgW) : "") +
      kpi("Plan respecté", pct(resp), s.avgL != null ? "perte moy " + fmtR(s.avgL) : "");
    var w = $("sampleWarn");
    if (s.n === 0) w.textContent = "Aucun trade pour ce filtre.";
    else if (s.n < 30) w.textContent = "Sample : " + s.n + " trade" + (s.n > 1 ? "s" : "") + " sur 30 minimum. En dessous, ces chiffres sont du bruit statistique.";
    else if (s.n < 100) w.textContent = "Sample : " + s.n + " trades. Tendance lisible, pas encore solide (objectif 100+).";
    else w.textContent = "Sample : " + s.n + " trades. Base exploitable.";
  }

  function renderCurve(list) {
    var svg = $("curve"), rs = list.map(computeR).filter(function (r) { return r != null; });
    var W = Math.max(300, Math.round(svg.getBoundingClientRect().width) || 800), H = 220, P = { l: 40, r: 12, t: 12, b: 22 };
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    if (!rs.length) { svg.innerHTML = '<text x="' + (W / 2) + '" y="110" text-anchor="middle">La courbe apparaît au premier trade.</text>'; $("curveHint").textContent = ""; return; }
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
    $("curveHint").textContent = "max drawdown " + fmtR(dd);
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
    $("discipline").innerHTML = "<div><b>" + planned + "</b><span>sessions avec gameplan</span></div><div><b>" + noTrade + "</b><span>no-trade logués</span></div>";
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
        row("Target", '<span class="mono">' + esc(t.tp_price) + "</span> · " + esc(t.tp_level)) +
        row("R:R prévu", rr == null ? "" : "1:" + rr.toFixed(2)) +
        row("Sortie", '<span class="mono">' + esc(t.exit_price) + "</span>" + (t.exit_reason ? " · " + esc(t.exit_reason) : "")) +
        row("Résultat", '<span class="res ' + cls(r) + '">' + fmtR(r) + "</span>" + (p == null ? "" : " · " + (p > 0 ? "+" : "") + p.toFixed(2) + " pts")) +
        row("MFE / MAE", t.mfe_pts != null || t.mae_pts != null ? '<span class="mono">+' + esc(t.mfe_pts == null ? "?" : t.mfe_pts) + " / −" + esc(t.mae_pts == null ? "?" : t.mae_pts) + " pts</span>" : "") +
        row("Score", t.setup_score == null ? "" : esc(t.setup_score) + "/4") +
        row("Régime", [t.gex_regime ? "GEX " + (t.gex_regime === "negative" ? "négatif" : "positif") : "", t.cvd ? "CVD " + esc(t.cvd) : ""].filter(Boolean).join(" · ")) +
        row("Source", esc(t.plan_source)) +
        row("Plan respecté", t.plan_respected === false ? '<span class="neg">Non</span>' : '<span class="pos">Oui</span>') + "</dl>";
      var notes = (t.notes ? '<div class="note"><small>Déroulé</small>' + esc(t.notes) + "</div>" : "") + (t.lessons ? '<div class="note"><small>' + (nt ? "Pourquoi pas de trade" : "Leçon") + "</small>" + esc(t.lessons) + "</div>" : "");
      var actions = '<div class="t-actions"><button type="button" class="btn small" data-edit="' + esc(t.id) + '">Modifier</button><button type="button" class="btn small danger" data-del="' + esc(t.id) + '">Supprimer</button></div>';
      return '<details class="trade" id="trade-' + esc(t.id) + '">' + head + '<div class="t-body"><div>' + kv + notes + actions + "</div><div>" + media + "</div></div></details>";
    }).join("");
    signImages([].concat.apply([], rev.map(function (t) { var p = t.plan_id ? planById(t.plan_id) : null; return (t.attachments || []).concat(p ? p.attachments || [] : []); })));
  }

  function renderJournal() { var list = filtered(); renderKpis(list); renderCurve(list); renderAttribution(list); renderLedger(list); }

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

  function renderAll() { groups = {}; renderJournal(); renderPlans(); renderResearch(); }

  /* ================= Onglets & filtres ================= */
  var TABS = ["journal", "sessions", "recherche"];
  function showTab() {
    var tab = (location.hash || "#journal").slice(1); if (TABS.indexOf(tab) < 0) tab = "journal";
    TABS.forEach(function (k) { $("tab-" + k).hidden = k !== tab; });
    document.querySelectorAll(".tab").forEach(function (a) { if (a.getAttribute("data-tab") === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  window.addEventListener("hashchange", function () { showTab(); if (location.hash === "#journal" || !location.hash) renderCurve(filtered()); });
  var rz; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { renderCurve(filtered()); }, 150); });
  document.querySelectorAll(".filters button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.filter = b.getAttribute("data-f");
      document.querySelectorAll(".filters button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      renderAll();
    });
  });

  /* ================= Tiroir ================= */
  function openDrawer(title, formId) {
    ["tradeForm", "planForm", "gexForm"].forEach(function (id) { $(id).hidden = id !== formId; });
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
    setVal("i-entry", t.entry_price); setVal("i-entrylevel", t.entry_level); setVal("i-sl", t.sl_price); setVal("i-sllevel", t.sl_level);
    setVal("i-tp", t.tp_price); setVal("i-tplevel", t.tp_level); setVal("i-exit", t.exit_price); setVal("i-exitreason", t.exit_reason || "TP");
    setVal("i-mfe", t.mfe_pts); setVal("i-mae", t.mae_pts); setVal("i-cvd", t.cvd); setVal("i-respected", t.plan_respected === false ? "no" : "yes");
    setVal("i-notes", t.notes); setVal("i-lessons", t.lessons); $("i-files").value = "";
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
      sl_price: num("i-sl"), sl_level: txt("i-sllevel"), tp_price: num("i-tp"), tp_level: txt("i-tplevel"), exit_price: num("i-exit"), exit_reason: $("i-exitreason").value,
      mfe_pts: num("i-mfe"), mae_pts: num("i-mae"), cvd: txt("i-cvd"), plan_respected: $("i-respected").value === "yes" };
    Object.keys(T).forEach(function (k) { o[k] = nt ? null : T[k]; });
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
      sb.from("research_results").select("*"), sb.from("gex_snapshots").select("id,captured_at,target_date,session,source,spot,net_gex,regime")
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { setStatus("Erreur : " + bad.error.message, false); return; }
      state.trades = rs[0].data; state.plans = rs[1].data; state.research = rs[2].data; state.gex = rs[3].data;
      setStatus(state.trades.length + " trade" + (state.trades.length > 1 ? "s" : "") + " · synchro", true);
      var open = Array.prototype.map.call(document.querySelectorAll("details.trade[open]"), function (d) { return d.id; });
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
