
(function () {
  var state = { trades: [], filter: "all", live: false };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fmtR = function (r) { return r == null || isNaN(r) ? "—" : (r > 0 ? "+" : "") + r.toFixed(2) + "R"; };
  var cls = function (r) { return r == null ? "" : r > 0.05 ? "pos" : r < -0.05 ? "neg" : "flat"; };

  function computeR(t) {
    if (t.status === "no_trade") return null;
    var e = +t.entry_price, s = +t.sl_price, x = +t.exit_price;
    if (isFinite(e) && isFinite(s) && isFinite(x) && e !== s) {
      var dir = t.direction === "short" ? -1 : 1;
      return dir * (x - e) / Math.abs(e - s);
    }
    return typeof t.result_r === "number" ? t.result_r : null;
  }
  function pts(t) {
    var e = +t.entry_price, x = +t.exit_price;
    if (!isFinite(e) || !isFinite(x)) return null;
    return (t.direction === "short" ? -1 : 1) * (x - e);
  }
  function plannedRR(t) {
    var e = +t.entry_price, s = +t.sl_price, tp = +t.tp_price;
    if (!isFinite(e) || !isFinite(s) || !isFinite(tp) || e === s) return null;
    return Math.abs(tp - e) / Math.abs(e - s);
  }
  function stats(list) {
    var rs = list.map(computeR).filter(function (r) { return r != null; });
    var n = rs.length, wins = rs.filter(function (r) { return r > 0.05; }), losses = rs.filter(function (r) { return r < -0.05; });
    var sum = rs.reduce(function (a, b) { return a + b; }, 0);
    var gw = wins.reduce(function (a, b) { return a + b; }, 0), gl = -losses.reduce(function (a, b) { return a + b; }, 0);
    return { n: n, wr: n ? wins.length / n : null, exp: n ? sum / n : null, total: sum, pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null),
      avgW: wins.length ? gw / wins.length : null, avgL: losses.length ? -gl / losses.length : null, be: n - wins.length - losses.length };
  }

  function filtered() {
    var t = state.trades.slice().sort(function (a, b) { return String(a.date + (a.time_guyane || "")).localeCompare(String(b.date + (b.time_guyane || ""))); });
    return state.filter === "all" ? t : t.filter(function (x) { return x.session === state.filter; });
  }

  function kpi(label, value, sub, c) { return '<div class="kpi"><div class="kpi-l">' + label + '</div><div class="kpi-v ' + (c || "") + '">' + value + '</div><div class="kpi-s">' + (sub || "&nbsp;") + '</div></div>'; }

  function renderKpis(list) {
    var s = stats(list), noTrade = list.filter(function (t) { return t.status === "no_trade"; }).length;
    var plan = list.filter(function (t) { return t.status !== "no_trade"; });
    var resp = plan.length ? plan.filter(function (t) { return t.plan_respected !== false; }).length / plan.length : null;
    $("kpis").innerHTML =
      kpi("Trades", s.n, noTrade ? noTrade + " session(s) no-trade" : "exécutés") +
      kpi("Win rate", s.wr == null ? "—" : Math.round(s.wr * 100) + "%", s.n ? (s.n - s.be) + " décidés · " + s.be + " BE" : "") +
      kpi("Espérance", fmtR(s.exp), "par trade", cls(s.exp)) +
      kpi("Total", fmtR(s.n ? s.total : null), "R cumulés", cls(s.total)) +
      kpi("Profit factor", s.pf == null ? "—" : s.pf === Infinity ? "∞" : s.pf.toFixed(2), s.avgW != null ? "gain moy " + fmtR(s.avgW) : "") +
      kpi("Plan respecté", resp == null ? "—" : Math.round(resp * 100) + "%", s.avgL != null ? "perte moy " + fmtR(s.avgL) : "");
    var w = $("sampleWarn");
    if (s.n === 0) { w.textContent = "Aucun trade pour ce filtre."; }
    else if (s.n < 30) { w.textContent = "Sample : " + s.n + " trade" + (s.n > 1 ? "s" : "") + ". Sous 30, ces chiffres sont du bruit statistique. Lecture indicative uniquement."; }
    else if (s.n < 100) { w.textContent = "Sample : " + s.n + " trades. Tendance lisible, pas encore solide (objectif 100+)."; }
    else { w.textContent = "Sample : " + s.n + " trades. Base exploitable."; }
  }

  function renderCurve(list) {
    var svg = $("curve"), rs = list.map(computeR).filter(function (r) { return r != null; });
    var W = 800, H = 220, P = { l: 40, r: 12, t: 12, b: 22 };
    if (!rs.length) { svg.innerHTML = '<text x="400" y="110" text-anchor="middle">La courbe apparaît au premier trade.</text>'; $("curveHint").textContent = ""; return; }
    var cum = [0]; rs.forEach(function (r) { cum.push(cum[cum.length - 1] + r); });
    var mn = Math.min.apply(null, cum), mx = Math.max.apply(null, cum);
    if (mx - mn < 2) { mx += 1; mn -= 1; }
    var step = (mx - mn) > 12 ? 5 : (mx - mn) > 5 ? 2 : 1;
    var x = function (i) { return P.l + (W - P.l - P.r) * (cum.length === 1 ? 0 : i / (cum.length - 1)); };
    var y = function (v) { return P.t + (H - P.t - P.b) * (1 - (v - mn) / (mx - mn)); };
    var g = "";
    for (var v = Math.ceil(mn / step) * step; v <= mx; v += step) {
      g += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="1"' + (v === 0 ? '' : ' stroke-dasharray="2 4"') + '/>';
      g += '<text x="' + (P.l - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + (v > 0 ? "+" : "") + v + 'R</text>';
    }
    var d = cum.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
    var area = d + " L" + x(cum.length - 1).toFixed(1) + " " + y(0).toFixed(1) + " L" + x(0).toFixed(1) + " " + y(0).toFixed(1) + " Z";
    var last = cum[cum.length - 1], col = last >= 0 ? "var(--win)" : "var(--loss)";
    var peak = 0, dd = 0; cum.forEach(function (v) { peak = Math.max(peak, v); dd = Math.min(dd, v - peak); });
    g += '<path d="' + area + '" fill="' + col + '" fill-opacity="0.12"/>';
    g += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    cum.forEach(function (v, i) { if (i) g += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (i === cum.length - 1 ? 4 : 2.2) + '" fill="' + (rs[i - 1] > 0.05 ? "var(--win)" : rs[i - 1] < -0.05 ? "var(--loss)" : "var(--be)") + '"/>'; });
    g += '<text x="' + P.l + '" y="' + (H - 6) + '">départ</text><text x="' + (W - P.r) + '" y="' + (H - 6) + '" text-anchor="end">trade ' + rs.length + '</text>';
    svg.innerHTML = g;
    $("curveHint").textContent = "max drawdown " + fmtR(dd);
  }

  function groupTable(el, list, keyFn, labelFn) {
    var groups = {};
    list.forEach(function (t) { if (t.status === "no_trade") return; var k = keyFn(t); if (k == null || k === "") k = "—"; (groups[k] = groups[k] || []).push(t); });
    var keys = Object.keys(groups);
    if (!keys.length) { $(el).innerHTML = '<div class="kpi-s">Pas encore de data.</div>'; return; }
    var rows = keys.map(function (k) { return { k: k, s: stats(groups[k]) }; }).sort(function (a, b) { return b.s.n - a.s.n; });
    var h = '<table><thead><tr><th>' + "" + '</th><th class="r">WR</th><th class="r">Esp.</th><th class="r">n</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var wr = r.s.wr == null ? 0 : r.s.wr;
      h += '<tr><td>' + (labelFn ? labelFn(r.k) : esc(r.k)) + '<div class="bar"><i style="width:' + Math.round(wr * 100) + '%"></i></div></td><td class="r">' + (r.s.wr == null ? "—" : Math.round(wr * 100) + "%") + '</td><td class="r res ' + cls(r.s.exp) + '">' + fmtR(r.s.exp) + '</td><td class="r">' + r.s.n + '</td></tr>';
    });
    $(el).innerHTML = h + '</tbody></table>';
  }

  function renderAttribution(list) {
    groupTable("bySession", list, function (t) { return t.session; }, function (k) { return '<span class="chip s-' + esc(k) + '">' + esc(k) + '</span>'; });
    groupTable("byLevel", list, function (t) { return t.entry_level; });
    groupTable("byScore", list, function (t) { return t.setup_score == null ? null : t.setup_score + "/4"; });
    groupTable("byPlan", list, function (t) { return t.plan_respected === false ? "Non" : "Oui"; });
    groupTable("byEntry", list, function (t) { return t.entry_type; });
    groupTable("byRegime", list, function (t) { return (t.gex_regime ? (t.gex_regime === "negative" ? "GEX −" : "GEX +") : "GEX ?") + " · " + (t.direction || "?"); });
  }

  function row(label, v) { return v == null || v === "" ? "" : "<dt>" + label + "</dt><dd>" + v + "</dd>"; }
  function actions(t) {
    if (!state.canWrite) return "";
    return '<div class="t-actions"><button type="button" class="btn" data-edit="' + esc(t._id) + '">Modifier</button><button type="button" class="btn danger" data-del="' + esc(t._id) + '">Supprimer</button></div>';
  }

  function renderLedger(list) {
    var el = $("ledger");
    if (!state.trades.length) {
      el.innerHTML = '<div class="empty"><h3>Registre vide</h3><ol>' +
        '<li>Après ta session, envoie à Claude <b>la capture du trade</b> + <b>le gameplan Caba</b> suivi (HTML, et le XML DeepCharts si tu l\'as).</li>' +
        '<li>Précise ce que la capture ne montre pas : sortie réelle, contrats, plan respecté ou pas, ce que tu as ressenti.</li>' +
        '<li>Claude extrait entrée, stop, target, levels, scénario, score /4, et ajoute la ligne ici. Les stats se recalculent seules.</li>' +
        '<li>Session sans trade ? Envoie-la aussi : les no-trade comptent pour mesurer la discipline.</li>' +
        '<li>Tu peux aussi saisir un trade toi-même avec <b>+ Ajouter un trade</b>.</li></ol></div>';
      $("ledgerHint").textContent = ""; return;
    }
    var rev = list.slice().reverse();
    $("ledgerHint").textContent = rev.length + " entrée" + (rev.length > 1 ? "s" : "");
    el.innerHTML = rev.map(function (t) {
      var r = computeR(t), p = pts(t), rr = plannedRR(t), nt = t.status === "no_trade";
      var stripe = nt ? "var(--line)" : r > 0.05 ? "var(--win)" : r < -0.05 ? "var(--loss)" : "var(--be)";
      var head = '<summary><span class="stripe" style="background:' + stripe + '"></span>' +
        '<span class="t-date">' + esc(t.date) + (t.time_guyane ? ' · ' + esc(t.time_guyane) : '') + '</span>' +
        '<span class="t-sess"><span class="chip s-' + esc(t.session) + '">' + esc(t.session || "?") + '</span></span>' +
        '<span class="t-main"><b>' + (nt ? "No trade" : esc((t.direction || "").toUpperCase()) + " " + esc(t.entry_price)) + '</b> ' + (t.scenario ? '· ' + esc(t.scenario) : '') +
        '<div class="t-lv">' + (nt ? esc(t.notes || "") : esc(t.entry_level || "level ?") + " → " + esc(t.tp_level || "target ?")) + '</div></span>' +
        '<span class="t-r ' + cls(r) + '">' + (nt ? "—" : fmtR(r)) + '</span>' +
        '<span class="t-pts">' + (p == null ? "" : (p > 0 ? "+" : "") + p.toFixed(2) + " pts") + '</span></summary>';
      if (nt) return '<details class="trade">' + head + '<div class="t-body"><div>' + (t.lessons ? '<div class="note"><small>Pourquoi pas de trade</small>' + esc(t.lessons) + '</div>' : '') + actions(t) + '</div></div></details>';
      var kv = '<dl class="kv">' +
        row("Instrument", esc(t.instrument || "MNQ") + (t.contracts ? " × " + esc(t.contracts) : "")) +
        row("Source plan", esc(t.plan_source)) +
        row("Scénario", esc(t.scenario)) +
        row("Entrée", '<span class="mono">' + esc(t.entry_price) + '</span> · ' + esc(t.entry_level) + (t.entry_type ? ' <span class="chip">' + esc(t.entry_type) + '</span>' : '')) +
        row("Stop", '<span class="mono">' + esc(t.sl_price) + '</span>' + (t.sl_level ? ' · ' + esc(t.sl_level) : '') + (isFinite(+t.entry_price) && isFinite(+t.sl_price) ? ' · ' + Math.abs(t.entry_price - t.sl_price).toFixed(2) + ' pts' : '')) +
        row("Target", '<span class="mono">' + esc(t.tp_price) + '</span> · ' + esc(t.tp_level)) +
        row("R:R prévu", rr == null ? "" : "1:" + rr.toFixed(2)) +
        row("Sortie", '<span class="mono">' + esc(t.exit_price) + '</span>' + (t.exit_reason ? ' · ' + esc(t.exit_reason) : '')) +
        row("Résultat", '<span class="res ' + cls(r) + '">' + fmtR(r) + '</span>' + (p == null ? '' : ' · ' + (p > 0 ? "+" : "") + p.toFixed(2) + ' pts')) +
        row("MFE / MAE", (t.mfe_pts != null || t.mae_pts != null) ? '<span class="mono">+' + esc(t.mfe_pts == null ? "?" : t.mfe_pts) + ' / −' + esc(t.mae_pts == null ? "?" : t.mae_pts) + ' pts</span>' : "") +
        row("Score setup", t.setup_score == null ? "" : esc(t.setup_score) + "/4") +
        row("Régime", [t.gex_regime ? "GEX " + (t.gex_regime === "negative" ? "négatif" : "positif") : "", t.cvd ? "CVD " + esc(t.cvd) : ""].filter(Boolean).join(" · ")) +
        row("Plan respecté", t.plan_respected === false ? '<span class="neg">Non</span>' : '<span class="pos">Oui</span>') +
        '</dl>' +
        (t.notes ? '<div class="note"><small>Déroulé</small>' + esc(t.notes) + '</div>' : '') +
        (t.lessons ? '<div class="note"><small>Leçon</small>' + esc(t.lessons) + '</div>' : '');
      var img = t.image_path ? (state.imgUrls && state.imgUrls[t.image_path] ? '<img class="shot" loading="lazy" alt="Capture du trade du ' + esc(t.date) + '" src="' + esc(state.imgUrls[t.image_path]) + '">' : '<div class="kpi-s">Chargement de la capture…</div>') : '<div class="kpi-s">Pas de capture jointe.</div>';
      return '<details class="trade">' + head + '<div class="t-body"><div>' + kv + actions(t) + '</div><div>' + img + '</div></div></details>';
    }).join("");
  }

  function render() {
    var list = filtered();
    renderKpis(list); renderCurve(list); renderAttribution(list); renderLedger(list);
  }

  document.querySelectorAll(".filters button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.filter = b.getAttribute("data-f");
      document.querySelectorAll(".filters button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      render();
    });
  });

  render();

  var setStatus = function (t, live) { $("status").textContent = t; $("dot").className = "dot" + (live ? " live" : ""); };

  /* ---------- Formulaire manuel ---------- */
  var form = $("tradeForm"), editing = null;
  var F = function (id) { return $("i-" + id); };
  var num = function (id) { var v = F(id).value.trim(); return v === "" ? null : +v; };
  var txt = function (id) { var v = F(id).value.trim(); return v === "" ? null : v; };
  function syncType() { $("tradeFields").hidden = F("status").value === "no_trade"; updatePreview(); }
  function updatePreview() {
    if (F("status").value === "no_trade") { $("rPreview").textContent = "No trade"; return; }
    var t = { direction: F("direction").value, entry_price: num("entry"), sl_price: num("sl"), exit_price: num("exit"), tp_price: num("tp") };
    var r = computeR(t), rr = plannedRR(t);
    $("rPreview").textContent = "R " + fmtR(r) + (rr ? " · R:R prévu 1:" + rr.toFixed(2) : "");
    $("rPreview").className = "preview " + cls(r);
  }
  function setVal(id, v) { F(id).value = v == null ? "" : v; }
  function openForm(t) {
    editing = t ? t._id : null;
    $("formTitle").textContent = t ? "Modifier le trade" : "Nouveau trade";
    var d = new Date();
    t = t || { date: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"), session: "London", status: "trade", direction: "long", entry_type: "principale", plan_source: "MenthorQ", instrument: "MNQ", gex_regime: "positive", exit_reason: "TP" };
    setVal("date", t.date); setVal("time", t.time_guyane); setVal("session", t.session || "London"); setVal("status", t.status || "trade");
    setVal("direction", t.direction || "long"); setVal("entrytype", t.entry_type || "principale"); setVal("source", t.plan_source || "MenthorQ");
    setVal("instrument", t.instrument || "MNQ"); setVal("contracts", t.contracts); setVal("scenario", t.scenario);
    setVal("score", t.setup_score == null ? "" : String(t.setup_score)); setVal("regime", t.gex_regime || "positive");
    setVal("entry", t.entry_price); setVal("entrylevel", t.entry_level); setVal("sl", t.sl_price); setVal("sllevel", t.sl_level);
    setVal("tp", t.tp_price); setVal("tplevel", t.tp_level); setVal("exit", t.exit_price); setVal("exitreason", t.exit_reason || "TP");
    setVal("mfe", t.mfe_pts); setVal("mae", t.mae_pts); setVal("cvd", t.cvd); setVal("plan", t.plan_respected === false ? "no" : "yes");
    setVal("notes", t.notes); setVal("lessons", t.lessons); F("image").value = "";
    $("formMsg").textContent = ""; $("formMsg").className = "msg";
    form.hidden = false; syncType(); form.scrollIntoView({ behavior: "smooth", block: "start" }); F("date").focus({ preventScroll: true });
  }
  function closeForm() { form.hidden = true; editing = null; }
  ["status"].forEach(function (id) { F(id).addEventListener("change", syncType); });
  ["direction", "entry", "sl", "tp", "exit"].forEach(function (id) { F(id).addEventListener("input", updatePreview); });
  $("addBtn").addEventListener("click", function () { openForm(null); });
  $("cancelBtn").addEventListener("click", closeForm);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("formMsg"); msg.className = "msg";
    var date = txt("date"), session = F("session").value, nt = F("status").value === "no_trade";
    if (!date) { msg.textContent = "Indique la date."; msg.className = "msg err"; return; }
    var o = { date: date, time_guyane: txt("time"), session: session, status: nt ? "no_trade" : "trade", lessons: txt("lessons"), notes: txt("notes") };
    if (!nt) {
      if (num("entry") == null || num("sl") == null || num("exit") == null) { msg.textContent = "Entrée, stop et sortie réelle sont obligatoires pour calculer le R."; msg.className = "msg err"; return; }
      if (num("entry") === num("sl")) { msg.textContent = "Le stop ne peut pas être égal à l'entrée."; msg.className = "msg err"; return; }
      Object.assign(o, { direction: F("direction").value, entry_type: F("entrytype").value, plan_source: F("source").value, instrument: F("instrument").value,
        contracts: num("contracts"), scenario: txt("scenario"), setup_score: F("score").value === "" ? null : +F("score").value, gex_regime: F("regime").value,
        entry_price: num("entry"), entry_level: txt("entrylevel"), sl_price: num("sl"), sl_level: txt("sllevel"), tp_price: num("tp"), tp_level: txt("tplevel"),
        exit_price: num("exit"), exit_reason: F("exitreason").value, mfe_pts: num("mfe"), mae_pts: num("mae"), cvd: txt("cvd"), plan_respected: F("plan").value === "yes" });
    }
    var TRADE_FIELDS = ["direction","entry_type","plan_source","instrument","contracts","scenario","setup_score","gex_regime","entry_price","entry_level","sl_price","sl_level","tp_price","tp_level","exit_price","exit_reason","mfe_pts","mae_pts","cvd","plan_respected"];
    if (nt) TRADE_FIELDS.forEach(function (k) { o[k] = null; });
    var id = editing;
    if (!id) { var n = 1; while (state.trades.some(function (t) { return t._id === date + "-" + session + "-" + n; })) n++; id = date + "-" + session + "-" + n; }
    o.id = id;
    $("saveBtn").disabled = true; msg.textContent = "Enregistrement…";
    var file = F("image").files && F("image").files[0];
    var up = Promise.resolve();
    if (file) {
      var ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      var path = id + "-" + Date.now() + "." + ext;
      up = sb.storage.from("shots").upload(path, file, { contentType: file.type || "image/png" }).then(function (r) { if (r.error) throw r.error; o.image_path = path; });
    }
    up.then(function () { return sb.from("trades").upsert(o); })
      .then(function (r) { if (r && r.error) throw r.error; msg.textContent = "Enregistré."; closeForm(); return load(); })
      .catch(function (err) { msg.textContent = "Échec de l'enregistrement : " + (err && err.message || "erreur") + ". Réessaie."; msg.className = "msg err"; })
      .then(function () { $("saveBtn").disabled = false; });
  });

  $("ledger").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var eid = b.getAttribute("data-edit"), did = b.getAttribute("data-del");
    if (eid) { openForm(state.trades.filter(function (t) { return t._id === eid; })[0]); return; }
    if (did) {
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmer la suppression"; setTimeout(function () { b.classList.remove("armed"); b.textContent = "Supprimer"; }, 4000); return; }
      b.disabled = true; b.textContent = "Suppression…";
      sb.from("trades").delete().eq("id", did).then(function (r) { if (r.error) throw r.error; return load(); })
        .catch(function () { b.disabled = false; b.textContent = "Échec, réessaie"; });
    }
  });

  /* ---------- Supabase ---------- */
  var sb = window.supabase.createClient(window.JOURNAL_CONFIG.url, window.JOURNAL_CONFIG.key);
  state.imgUrls = {};
  function signShots() {
    var paths = state.trades.map(function (t) { return t.image_path; }).filter(function (p) { return p && !state.imgUrls[p]; });
    if (!paths.length) return;
    sb.storage.from("shots").createSignedUrls(paths, 3600).then(function (r) {
      (r.data || []).forEach(function (x) { if (x.signedUrl) state.imgUrls[x.path] = x.signedUrl; });
      render();
    });
  }
  function load() {
    return sb.from("trades").select("*").then(function (r) {
      if (r.error) { setStatus("Erreur base : " + r.error.message, false); return; }
      state.trades = r.data.map(function (o) { o._id = o.id; return o; });
      setStatus(state.trades.length + " entrée" + (state.trades.length > 1 ? "s" : "") + " · synchro", true);
      render(); signShots();
    });
  }
  function showApp(session) {
    var email = session && session.user && session.user.email;
    $("login").hidden = !!session; $("app").hidden = !session;
    $("who").textContent = email || "";
    if (!session) return;
    state.canWrite = true; $("addBtn").hidden = false; $("imgField").hidden = false;
    load();
  }
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("l-email").value.trim(), pass = $("l-pass").value, m = $("loginMsg");
    if (!email) { m.textContent = "Entre ton email."; return; }
    m.textContent = pass ? "Connexion…" : "Envoi…";
    if (pass) {
      sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
        m.textContent = r.error ? "Échec : email ou mot de passe incorrect." : "";
      });
      return;
    }
    sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } }).then(function (r) {
      if (!r.error) { m.textContent = "Lien envoyé. Ouvre l'email sur cet appareil et touche le lien."; return; }
      m.textContent = /rate limit/i.test(r.error.message) ? "Trop d'emails envoyés, réessaie dans une heure ou utilise ton mot de passe." : "Échec : " + r.error.message;
    });
  });
  $("pwToggle").addEventListener("click", function () { $("pwForm").hidden = !$("pwForm").hidden; if (!$("pwForm").hidden) $("pw-new").focus(); });
  $("pwForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var p = $("pw-new").value, m = $("pwMsg");
    if (p.length < 8) { m.textContent = "8 caractères minimum."; return; }
    m.textContent = "Enregistrement…";
    sb.auth.updateUser({ password: p }).then(function (r) {
      if (r.error) { m.textContent = "Échec : " + r.error.message; return; }
      $("pw-new").value = ""; m.textContent = "Mot de passe enregistré. Tu peux l'utiliser sur tous tes appareils.";
    });
  });
  $("logoutBtn").addEventListener("click", function () { sb.auth.signOut(); });
  sb.auth.getSession().then(function (r) { showApp(r.data.session); });
  sb.auth.onAuthStateChange(function (_ev, session) { showApp(session); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("app").hidden) load(); });
})();
