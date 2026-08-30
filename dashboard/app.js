(function () {
  "use strict";

  // ---------------------------------------------------------------- state
  var DATA = null;          // parsed reports
  var currentTab = "overview";
  var riskFilter = "ALL";
  var searchQ = "";

  // ---------------------------------------------------------------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtNum(n) {
    if (n == null || n === "" || (typeof n === "number" && isNaN(n))) return "—";
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function badge(cls, label) {
    return '<span class="badge ' + esc(cls) + '">' + esc(label) + "</span>";
  }

  function scorebar(score) {
    var s = Math.max(0, Math.min(100, Number(score) || 0));
    var color = s >= 60 ? "var(--ready)" : s >= 30 ? "var(--familiar)" : "var(--high)";
    return '<div class="scorebar" title="score ' + fmtNum(score) + '"><div style="width:' +
      s + "%;background:" + color + '"></div></div>';
  }

  function backupStats(b) {
    var stats = "";
    if (b.direct_commits != null) {
      stats += "direct " + b.direct_commits + " commit" + (b.direct_commits === 1 ? "" : "s") + " · ";
    }
    stats += "co-change " + (b.cochanged_files_touched || 0) + " · neighbor " + (b.neighbor_files_touched || 0) + " · " +
      (b.days_since_last_touch != null ? fmtNum(b.days_since_last_touch) + "d ago" : "no recent touch");
    return stats;
  }

  function fileCell(file, high) {
    return '<td class="file-cell">' + esc(file) + "</td>";
  }

  function mon(m) {
    return '<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px">' + esc(m) + "</span>";
  }

  function entryFor(files, file) {
    for (var i = 0; i < files.length; i++) if (files[i].file === file) return files[i];
    return null;
  }

  function riskMap() {
    var m = {};
    (DATA.risk || []).forEach(function (r) { m[r.file] = r; });
    return m;
  }

  // ---------------------------------------------------------------- data load
  function loadData() {
    if (window.INLINE_REPORTS) { DATA = window.INLINE_REPORTS; boot(); return; }
    fetch("/api/all")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { DATA = d.reports || d; boot(); })
      .catch(function (e) {
        $("#view").innerHTML =
          '<div class="card"><h3>Could not load reports</h3><p class="muted">' +
          esc(e.message) + "</p><p class=\"muted\">Run the dashboard server with " +
          mon("python3 dashboard/server.py") + " then open " + mon("http://127.0.0.1:8765") + ".</p></div>";
      });
  }

  // ---------------------------------------------------------------- markdown (tiny)
  function md(s) {
    if (!s) return "";
    s = esc(s);
    var lines = s.split(/\r?\n/);
    var out = [];
    var ulOpen = false;
    function closeUl() { if (ulOpen) { out.push("</blockquote>"); ulOpen = false; } }
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trimEnd();
      l = l.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
           .replace(/\*([^*]+)\*/g, "<em>$1</em>")
           .replace(/`([^`]+)`/g, "<code>$1</code>");
      if (l === "") { closeUl(); continue; }
      if (l.indexOf("|") > -1 && !/^\s*:?-{3,}/.test(l)) {
        closeUl();
        out.push("<pre>" + l + "</pre>");
        continue;
      }
      var m1 = l.match(/^# (.+)$/);
      if (m1) { closeUl(); out.push('<div class="md-h md-h1">' + m1[1] + "</div>"); continue; }
      var m2 = l.match(/^## (.+)$/);
      if (m2) { closeUl(); out.push('<div class="md-h md-h2">' + m2[1] + "</div>"); continue; }
      var m3 = l.match(/^### (.+)$/);
      if (m3) { closeUl(); out.push('<div class="md-h md-h3">' + m3[1] + "</div>"); continue; }
      var mq = l.match(/^&gt;\s?(.*)$/);
      if (mq) { closeUl(); out.push('<div class="md-li muted" style="border-left:2px solid var(--border);padding-left:10px">' + mq[1] + "</div>"); continue; }
      var b = l.match(/^[-*]\s+(.*)$/);
      if (b) { if (!ulOpen) { out.push('<blockquote style="margin:4px 0">'); ulOpen = true; } out.push('<span class="md-li">• ' + b[1] + "</span>"); continue; }
      var no = l.match(/^\d+\.\s+(.*)$/);
      if (no) { closeUl(); out.push('<span class="md-li">' + no[1] + "</span>"); continue; }
      var hr = l.match(/^---+$/);
      if (hr) { closeUl(); out.push("<hr style='border:none;border-top:1px solid var(--border);margin:8px 0'>"); continue; }
      out.push("<pre>" + l + "</pre>");
    }
    closeUl();
    return out.join("");
  }

  // ---------------------------------------------------------------- view: overview
  function stats() {
    var c = DATA.contributor || { files: [], file_count_analyzed: 0 };
    var cm = DATA.complexity;
    var doc = DATA.documentation;
    var r = DATA.risk || [];
    var ob = DATA.onboarding || { files: [] };
    var ex = DATA.extraction || { files: [] };

    var single = c.files.filter(function (f) { return (f.author_count || 0) <= 1; });
    var byLevel = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    r.forEach(function (x) { byLevel[x.risk_level] = (byLevel[x.risk_level] || 0) + 1; });

    var ownerCount = {};
    ob.files.forEach(function (f) { ownerCount[f.dominant_owner] = (ownerCount[f.dominant_owner] || 0) + 1; });
    var siloOwner = null, siloN = 0;
    Object.keys(ownerCount).forEach(function (k) { if (ownerCount[k] > siloN) { siloN = ownerCount[k]; siloOwner = k; } });

    var oldest = null, oldestFile = null;
    c.files.forEach(function (f) { if (oldest === null || f.days_since_last_touch > oldest) { oldest = f.days_since_last_touch; oldestFile = f.file; } });

    var draftMd = ex.files.filter(function (f) { return f.draft_markdown; }).length;

    return {
      contributor: c, complexity: cm, doc: doc, risk: r, ob: ob, ex: ex,
      single, byLevel, siloOwner, siloN, oldest, oldestFile, draftMd,
      totalContrib: c.file_count_analyzed || c.files.length
    };
  }

  function tiles() {
    var s = stats();
    var tiles = [
      { n: s.totalContrib, label: "Files analyzed", note: "contributor agent",
        tip: "Git-tracked files the Contributor Agent scored from real commit history. Files with no history are skipped." },
      { n: s.byLevel.HIGH, label: "HIGH risk · knowledge", note: s.byLevel.HIGH + " of " + s.risk.length + " ranked files", cls: "HIGH",
        tip: "Files ranked HIGH by the risk pipeline: 1–2 known authors, above-median complexity, and a documentation score under 40/100." },
      { n: s.single.length, label: "Single-author files", note: "bus-factor risk", cls: s.single.length ? "danger" : "",
        tip: "Files with exactly one contributor in git history — the owner is a single point of failure (bus factor = 1)." },
      { n: s.ob.files.length, label: "Files with successors ranked", note: "module 2", cls: "ok",
        tip: "Of the HIGH-risk files, how many got a ranked backup-owner shortlist from the Onboarding Agent." },
      { n: s.draftMd, label: "Knowledge drafts drafted", note: "module 3", cls: "ok",
        tip: "HIGH-risk files with an auto-generated knowledge draft: extracted comments, commit history, and review questions for the owner." }
    ];
    return tiles.map(function (t) {
      var numCls = t.cls === "HIGH" ? " style='color:var(--high)'" :
                   t.cls === "danger" ? " style='color:var(--high)'" :
                   t.cls === "ok" ? " style='color:var(--accent-2)'" : "";
      return '<div class="stat"><div class="stat-num"' + numCls + ">" + t.n + "</div>" +
        '<div class="stat-label" data-tip="' + esc(t.tip) + '">' + esc(t.label) + "</div>" +
        '<div class="stat-note">' + esc(t.note) + "</div></div>";
    }).join("");
  }

  function overviewHTML() {
    var s = stats();
    var h = "";
    h += '<div class="view-head"><h2>Suite overview</h2>' +
      '<div class="view-sub">One pipeline — three modules — from git history to onboarding readiness and knowledge drafts.</div></div>';
    h += '<div class="stat-grid">' + tiles() + "</div>";

    h += atlasHTML();

    h += '<div class="banner alert"><strong>Knowledge silo:</strong> ' + esc(s.siloOwner || "—") +
      ' is the dominant owner of ' + s.siloN + " of " + s.ob.files.length +
      " HIGH-risk files. All successor candidates are currently <b>cold</b> — the team has a single point of failure on every hotspot.</div>";
    if (s.oldest !== null) {
      h += '<div class="banner info"><strong>Most stale:</strong> ' + esc(s.oldestFile) +
        ' untouched for ' + fmtNum(s.oldest) + " days, single author. Worst-case bus-factor scenario.</div>";
    }

    h += '<div class="card"><h3>Most complex files</h3>';
    var topC = (s.complexity.files || []).slice().sort(function (a, b) { return b.complexity_score - a.complexity_score; }).slice(0, 5);
    h += '<table class="tbl"><tr><th>File</th><th class="num"><span data-tip="Complexity score 0–100. raw = NLOC + average cyclomatic complexity × 10, normalized so the most complex file in the repo = 100.">Score</span></th><th class="num"><span data-tip="NLOC = Non-Lines of Code: source lines, excluding blank lines and comments.">NLOC</span></th></tr>';
    topC.forEach(function (f) {
      h += "<tr>" + fileCell(f.file) + '<td class="num">' + fmtNum(f.complexity_score) + "</td>" +
        '<td class="num">' + fmtNum(f.metrics.nloc) + "</td></tr>";
    });
    h += "</table></div>";

    h += '<div class="card"><h3>HIGH-risk files — full picture</h3>';
    var risks = s.risk.slice().filter(function (x) { return x.risk_level === "HIGH"; });
    h += '<table class="tbl"><tr><th>File</th><th>Why</th><th class="num"><span data-tip="Days since this file\'s most recent commit in git history. Higher = staler = more knowledge at risk.">Last touch</span></th><th class="num"><span data-tip="Same complexity score (0–100) as in the Most complex files table.">Complexity</span></th></tr>';
    risks.forEach(function (x) {
      var owners = entryFor(s.contributor.files, x.file);
      var last = owners ? owners.days_since_last_touch : x.last_touch_days_ago;
      h += '<tr class="clickable" data-file="' + encodeURIComponent(x.file) + '">' +
        '<td class="file-cell">' + esc(x.file) + "</td>" +
        '<td class="muted">' + esc(x.why) + "</td>" +
        '<td class="num">' + (last == null ? "—" : fmtNum(last) + "d") + "</td>" +
        '<td class="num">' + fmtNum(x.complexity_score) + "</td></tr>";
    });
    h += "</table></div>";
    return h;
  }

  // ---------------------------------------------------------------- module 1: risk
  function atlasHTML() {
    var s = stats();
    var rows = (s.risk || []);
    if (!rows.length) return "";
    var cs = rows.map(function (x) { return x.complexity_score || 0; });
    var mn = Math.min.apply(null, cs), mx = Math.max.apply(null, cs);
    function sizeOf(x) {
      var c = x.complexity_score || 0;
      var t = mx > mn ? (c - mn) / (mx - mn) : 0.5;
      return Math.round(22 + t * 52);
    }
    var lvl = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    rows.forEach(function (x) { lvl[x.risk_level] = (lvl[x.risk_level] || 0) + 1; });
    var h = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">' +
      '<h3>Repo risk atlas</h3>' +
      '<div class="atlas-legend">' +
      '<span><i style="background:var(--high)"></i>HIGH ' + lvl.HIGH + "</span>" +
      '<span><i style="background:var(--medium)"></i>MEDIUM ' + lvl.MEDIUM + "</span>" +
      '<span><i style="background:var(--low)"></i>LOW ' + lvl.LOW + "</span>" +
      '<span class="muted">· square size = complexity</span></div></div>' +
      '<p class="view-sub" style="margin:6px 0 12px">One square per tracked file. Hover for details, click for the full drill-down.</p>' +
      '<div class="atlas">';
    rows.forEach(function (x) {
      var n = sizeOf(x);
      h += '<div class="atlas-cell clickable" data-file="' + encodeURIComponent(x.file) + '" ' +
        'style="width:' + n + 'px;height:' + n + 'px;background:var(--' + (x.risk_level || "low").toLowerCase() + ')"></div>';
    });
    h += "</div></div>";
    return h;
  }

  // ---------------------------------------------------------------- module 1: risk
  function riskHTML() {
    var s = stats();
    var h = "";
    h += '<div class="view-head"><h2>Knowledge-Loss Risk Mapper</h2>' +
      '<div class="view-sub">Every tracked file ranked by author count, staleness, complexity and documentation gap.</div></div>';
    h += '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-num" style="color:var(--high)">' + s.byLevel.HIGH + '</div><div class="stat-label">HIGH risk</div></div>' +
      '<div class="stat"><div class="stat-num" style="color:var(--medium)">' + s.byLevel.MEDIUM + '</div><div class="stat-label">MEDIUM risk</div></div>' +
      '<div class="stat"><div class="stat-num" style="color:var(--low)">' + s.byLevel.LOW + '</div><div class="stat-label">LOW risk</div></div>' +
      '<div class="stat"><div class="stat-num">' + s.single.length + '</div><div class="stat-label">Single-author files</div></div>' +
      "</div>";

    var levels = ["ALL", "HIGH", "MEDIUM", "LOW"];
    h += '<div class="toolbar"><label>Filter</label><div class="seg">' +
      levels.map(function (l) {
        return '<button data-level="' + l + '" class="' + (riskFilter === l ? "active" : "") + '">' + l + "</button>";
      }).join("") +
      '</div><input type="search" id="risk-search" placeholder="Search file name…" value="' + esc(searchQ) + '"></div>';

    var rows = s.risk.slice().sort(function (a, b) {
      var lv = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (lv[a.risk_level] - lv[b.risk_level]) || (b.last_touch_days_ago - a.last_touch_days_ago);
    });
    if (riskFilter !== "ALL") rows = rows.filter(function (x) { return x.risk_level === riskFilter; });
    if (searchQ) rows = rows.filter(function (x) { return x.file.toLowerCase().indexOf(searchQ.toLowerCase()) > -1; });

    h += '<div class="card"><table class="tbl"><tr>' +
      "<th>File</th><th>Level</th><th class=\"num\">Authors</th><th class=\"num\">Stale (days)</th>" +
      '<th class="num">Complexity</th><th class="num">Docs</th><th>Why</th></tr>';
    rows.forEach(function (x) {
      var owners = entryFor(s.contributor.files, x.file);
      h += '<tr class="clickable" data-file="' + encodeURIComponent(x.file) + '">' +
        '<td class="file-cell">' + esc(x.file) + "</td>" +
        "<td>" + badge(x.risk_level, x.risk_level) + "</td>" +
        '<td class="num">' + (owners ? owners.author_count : x.author_count) + "</td>" +
        '<td class="num">' + fmtNum(x.last_touch_days_ago) + "</td>" +
        '<td class="num">' + fmtNum(x.complexity_score) + "</td>" +
        '<td class="num">' + fmtNum(x.doc_score) + "</td>" +
        '<td class="muted">' + esc((x.why || "").slice(0, 120)) + "</td></tr>";
    });
    h += "</table></div>";
    return h;
  }

  // ---------------------------------------------------------------- module 1: contributors
  function busfactorHTML() {
    var c = DATA.contributor || {};
    var h = '';
    h += '<div class="view-head"><h2>Bus-Factor Analysis</h2>' +
      '<div class="view-sub">Distinct contributor count per file — fewest authors first. Files with one author are the bus-factor risk.</div></div>';
    var single = c.files.filter(function (f) { return (f.author_count || 0) <= 1; });
    h += '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-num">' + (c.file_count_analyzed || c.files.length) + '</div><div class="stat-label">Files analyzed</div></div>' +
      '<div class="stat"><div class="stat-num" style="color:var(--high)">' + single.length + '</div><div class="stat-label">Single-author files</div></div>' +
      '<div class="stat"><div class="stat-num" style="color:var(--accent-2)">' + (c.files.length - single.length) + '</div><div class="stat-label">Shared files</div></div>' +
      "</div>";
    h += '<div class="toolbar"><input type="search" id="risk-search" placeholder="Search file name…"></div>';
    var rows = c.files.slice().sort(function (a, b) { return (a.author_count - b.author_count) || (b.days_since_last_touch - a.days_since_last_touch); });
    h += '<div class="card"><table class="tbl"><tr><th>File</th><th class="num">Authors</th><th>Contributors</th><th class="num">Commits</th><th>Last touch</th><th class="num">Stale (days)</th></tr>';
    rows.forEach(function (f) {
      h += '<tr class="clickable' + (f.author_count <= 1 ? " stale" : "") + '" data-file="' + encodeURIComponent(f.file) + '">' +
        '<td class="file-cell">' + esc(f.file) + "</td>" +
        '<td class="num">' + (f.author_count <= 1 ? '<span style="color:var(--high);font-weight:700">' + fmtNum(f.author_count) + "</span>" : fmtNum(f.author_count)) + "</td>" +
        '<td class="muted nowrap">' + esc(Array.isArray(f.authors) ? f.authors.join(", ") : "—") + "</td>" +
        '<td class="num">' + fmtNum(f.commit_count) + "</td>" +
        '<td class="nowrap">' + esc(f.last_touch_date || "") + "</td>" +
        '<td class="num">' + fmtNum(f.days_since_last_touch) + "</td></tr>";
    });
    h += "</table></div>";
    return h;
  }

  // ---------------------------------------------------------------- module 1: complexity
  function complexityHTML() {
    var c = DATA.complexity || {};
    var tracked = (DATA.contributor && (DATA.contributor.file_count_analyzed || DATA.contributor.files.length)) || null;
    var h = '';
    h += '<div class="view-head"><h2>Complexity &amp; Criticality</h2>' +
      '<div class="view-sub">Real cyclomatic complexity (via lizard) + line counts, normalized to 0-100. Only code-containing files are scored; binary and empty files are skipped' +
      (tracked ? ' (' + (c.files || []).length + " of " + tracked + " tracked files)" : "") + '.</div></div>';
    var rows = (c.files || []).slice().sort(function (a, b) { return b.complexity_score - a.complexity_score; });
    var withCC = rows.filter(function (f) { return f.metrics && f.metrics.max_cyclomatic_complexity != null; });
    h += '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-num">' + rows.length + '</div><div class="stat-label">Files scored</div></div>' +
      '<div class="stat"><div class="stat-num">' + (withCC.length) + '</div><div class="stat-label">With cyclomatic data</div></div>' +
      '<div class="stat"><div class="stat-num">' + rows.reduce(function (a, f) { return a + (f.metrics ? f.metrics.nloc || 0 : 0); }, 0).toLocaleString() + '</div><div class="stat-label">Total lines</div></div>' +
      "</div>";
    h += '<div class="card"><table class="tbl"><tr><th>File</th><th class="num">Score</th><th class="num">NLOC</th><th class="num">Functions</th>' +
      '<th class="num">Avg CC</th><th class="num">Max CC</th></tr>';
    rows.forEach(function (f) {
      var m = f.metrics || {};
      h += '<tr class="clickable" data-file="' + encodeURIComponent(f.file) + '">' +
        '<td class="file-cell">' + esc(f.file) + "</td>" +
        '<td class="num"><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><span>' + fmtNum(f.complexity_score) + '</span>' + scorebar(f.complexity_score) + "</div></td>" +
        '<td class="num">' + fmtNum(m.nloc) + "</td>" +
        '<td class="num">' + fmtNum(m.function_count) + "</td>" +
        '<td class="num">' + fmtNum(m.avg_cyclomatic_complexity) + "</td>" +
        '<td class="num">' + fmtNum(m.max_cyclomatic_complexity) + "</td></tr>";
    });
    h += "</table></div>";
    return h;
  }

  // ---------------------------------------------------------------- module 1: documentation
  function documentationHTML() {
    var d = DATA.documentation || {};
    var rows = (d.files || []).slice().sort(function (a, b) { return a.documentation_score - b.documentation_score; });
    var avg = rows.length ? rows.reduce(function (a, f) { return a + (f.documentation_score || 0); }, 0) / rows.length : 0;
    var h = '';
    h += '<div class="view-head"><h2>Documentation Gap</h2>' +
      '<div class="view-sub">How well each file self-documents: comment blocks, docstrings, file descriptions, external docs.</div></div>';
    h += '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-num">' + rows.length + '</div><div class="stat-label">Files scored</div></div>' +
      '<div class="stat"><div class="stat-num">' + fmtNum(avg) + '</div><div class="stat-label">Average score</div></div>' +
      '<div class="stat"><div class="stat-num" style="color:var(--high)">' + rows.filter(function (f) { return f.documentation_score < 30; }).length + '</div><div class="stat-label">Badly documented (&lt; 30)</div></div>' +
      "</div>";
    h += '<div class="card"><table class="tbl"><tr><th>File</th><th class="num">Score</th><th>Signals</th><th>Reason</th></tr>';
    rows.forEach(function (f) {
      var m = f.metrics || {};
      var sig = (m.comment_count || 0) + " comments, " + (m.docstring_count || 0) + " docstrings" +
        (m.has_external_documentation ? ", external docs" : "") +
        (m.has_file_description ? ", description" : "");
      h += '<tr class="clickable" data-file="' + encodeURIComponent(f.file) + '">' +
        '<td class="file-cell">' + esc(f.file) + "</td>" +
        '<td class="num"><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><span>' + fmtNum(f.documentation_score) + '</span>' + scorebar(f.documentation_score) + "</div></td>" +
        '<td class="muted">' + esc(sig) + "</td>" +
        '<td class="muted">' + esc((f.reason || "").slice(0, 140)) + "</td></tr>";
    });
    h += "</table></div>";
    return h;
  }

  // ---------------------------------------------------------------- module 2: onboarding
  function onboardingHTML() {
    var ob = DATA.onboarding || {};
    var s = stats();
    var h = '';
    h += '<div class="view-head"><h2>Onboarding-Readiness Gap Analyzer</h2>' +
      '<div class="view-sub">For each HIGH-risk file: who owns it, and who is closest to taking over if they leave. Readiness = breadth × 0.5 + recency × 0.3 + depth × 0.2.</div></div>';
    h += '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-num">' + ob.files.length + '</div><div class="stat-label">HIGH-risk files</div></div>' +
      '<div class="stat"><div class="stat-num" style="color:var(--high)">' + (s.siloOwner ? s.siloN : 0) + '</div><div class="stat-label">Owned by one person</div></div>' +
      '<div class="stat"><div class="stat-num" style="color:var(--high)">' + ob.files.reduce(function (a, f) { return a + (f.backups || []).filter(function (b) { return b.bucket === "cold"; }).length; }, 0) + '</div><div class="stat-label">Cold successors (no direct history)</div></div>' +
      "</div>";
    if (s.siloOwner) {
      h += '<div class="banner alert"><strong>' + esc(s.siloOwner) + " owns " + s.siloN + " of " + ob.files.length +
        " HIGH-risk files.</strong> Every backup candidate is bucketed <b>cold</b> — nobody has recent hands-on history with these files. If the owner leaves, knowledge goes with them.</div>";
    }
    (ob.files || []).forEach(function (f) {
      var r = riskMap()[f.file];
      var backups = f.backups || [];
      h += '<div class="ob-file"><div class="ob-head">' +
        '<div><span class="file-cell" style="font-weight:700">' + esc(f.file) + "</span> " + badge(r && r.risk_level || f.risk_level, r && r.risk_level || f.risk_level) + "</div>" +
        (backups.length ? '<div style="display:flex;align-items:center;gap:20px"><span class="muted">' + backups.length + " backup" + (backups.length > 1 ? "s" : "") + "</span><span class=\"ob-owner\"></span></div>" : "") +
        "</div>" +
        '<div class="ob-owner"><strong>Dominant owner:</strong> <span style="color:#fff">' + esc(f.dominant_owner || "—") + "</span>" +
        (f.all_owners && f.all_owners.length > 1 ? ' · all owners: ' + esc(f.all_owners.join(", ")) : "") + "</div>";
      h += '<div class="backups">';
      backups.forEach(function (b) {
        var score = Number(b.readiness_score) || 0;
        h += '<div class="backup-row">' +
          '<div class="backup-name">' + esc(b.author) + ' ' + badge(b.bucket, b.bucket) + "</div>" +
          '<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><span class="backup-score" data-tip="Readiness score = breadth × 0.5 + recency × 0.3 + depth × 0.2 (breadth: files co-changed, recency: last touch, depth: direct commits).">' + fmtNum(score) + "</span>" + scorebar(score) + "</div>" +
          '<div class="nowrap muted" style="font-size:12px">' + backupStats(b) + "</div>" +
          '<div class="backup-why">' + esc(b.why) + "</div>" +
          "</div>";
      });
      h += "</div></div>";
    });
    return h;
  }

  // ---------------------------------------------------------------- module 3: extraction
  function extractionHTML() {
    var ex = DATA.extraction || {};
    var h = '';
    h += '<div class="view-head"><h2>Knowledge Extraction Assistant</h2>' +
      '<div class="view-sub">One auditable draft per HIGH-risk file: commit history, extracted comments, owner info, risk metadata, and review questions for the owner.</div></div>';
    var rows = ex.files || [];
    var drafted = ex.high_risk_files_drafted != null ? ex.high_risk_files_drafted : rows.length;
    h += '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-num">' + drafted + '</div><div class="stat-label">Drafts generated</div></div>' +
      '<div class="stat"><div class="stat-num">' + rows.reduce(function (a, f) { return a + (f.comment_count_extracted || 0); }, 0) + '</div><div class="stat-label">Comments extracted</div></div>' +
      '<div class="stat"><div class="stat-num">' + rows.reduce(function (a, f) { return a + (f.commit_count_used || 0); }, 0) + '</div><div class="stat-label">Commits mined</div></div>' +
      "</div>";
    h += '<div class="draft-grid">';
    rows.forEach(function (f) {
      h += '<div class="draft"><div class="draft-head">' +
        '<div class="draft-file">' + esc(f.file) + "</div>" +
        '<div class="draft-meta"><span>' + badge(f.risk_level || "HIGH", f.risk_level || "HIGH") + "</span>" +
        "<span>comments: " + fmtNum(f.comment_count_extracted) + "</span>" +
        "<span>commits: " + fmtNum(f.commit_count_used) + "</span></div>" +
        (f.why ? '<div class="draft-why">' + esc(f.why) + "</div>" : "") +
        "</div>" +
        '<div class="draft-body">' + md(f.draft_markdown || "*No draft body.*") + "</div></div>";
    });
    h += "</div>";
    return h;
  }

  // ---------------------------------------------------------------- orchestration / pipeline
  function pipelineHTML() {
    var s = stats();
    var r = s.risk || [];
    var byLevel = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    r.forEach(function (x) { byLevel[x.risk_level] = (byLevel[x.risk_level] || 0) + 1; });

    function node(name, role, out) {
      return '<div class="pnode"><div><div class="pn-name">' + name + "</div>" +
        '<div class="pn-role">' + role + "</div></div>" +
        '<div class="pn-out">' + out + "</div></div>";
    }
    function arrow(label) {
      return '<div class="parrow"><span class="arlabel">' + label + "</span></div>";
    }

    function whyRow(x) {
      var owners = entryFor(s.contributor.files, x.file);
      var n = owners && owners.author_count != null ? owners.author_count
             : (x.author_count != null ? x.author_count : "—");
      return '<tr><td class="file-cell">' + esc(x.file || "—") + "</td><td>" + badge(x.risk_level, x.risk_level) + "</td><td>" +
        esc(String(n)) + "</td><td class=\"muted\">" + esc(x.why || "—") + "</td></tr>";
    }

    var h = "";
    h += '<div class="view-head"><h2>Orchestration</h2>' +
      '<div class="view-sub">How the pipeline turns raw git history into ranked risk, onboarding shortlists, and knowledge drafts — live from this run.</div></div>';

    h += '<div class="card"><h3>The orchestrator output — from the actual run</h3>' +
      '<table class="tbl"><tr><th>File</th><th>Risk</th><th>Contributors</th><th>Why</th></tr>';
    r.filter(function (x) { return x.risk_level === "HIGH"; }).slice(0, 5).forEach(function (x) { h += whyRow(x); });
    var med = r.find(function (x) { return x.risk_level === "MEDIUM"; });
    var low = r.find(function (x) { return x.risk_level === "LOW"; });
    if (med) h += whyRow(med);
    if (low) h += whyRow(low);
    h += '<tr><td colspan="4" class="muted" style="font-size:12px;padding-top:10px">' +
      esc(r.length) + " files ranked · HIGH " + byLevel.HIGH + " / MEDIUM " + byLevel.MEDIUM + " / LOW " + byLevel.LOW +
      " · median complexity score is the HIGH threshold · ties broken by ascending documentation score.</td></tr></table></div>";

    h += '<div class="pipeline">';

    h += node("git history", "sample-repos/steam-snap source repository", "tracked files");
    h += arrow("read");

    h += '<div class="p-agents">' +
      '<div class="p-agent"><b>Contributor Agent</b><br>owners, author counts, staleness</div>' +
      '<div class="p-agent"><b>Complexity Agent</b><br>NLOC + cyclomatic complexity → 0–100</div>' +
      '<div class="p-agent"><b>Documentation Gap Agent</b><br>comments, docstrings, docs → 0–100</div>' +
      "</div>";
    h += arrow("three independent Bob subagents, run in parallel");

    h += node("orchestrator", "merges the three subagent outputs per file, then classifies and ranks every file into HIGH / MEDIUM / LOW", null);
    h += arrow("risk score → HIGH = 1–2 authors, above-median complexity, doc &lt; 40 · ties by ascending doc score · a plain-English \u201cwhy\u201d per file");

    h += node("risk report", "ranked heatmap", "HIGH " + byLevel.HIGH + " / MEDIUM " + byLevel.MEDIUM + " / LOW " + byLevel.LOW);
    h += arrow("HIGH-risk files feed the next two agents");

    h += '<div class="p-agents">' +
      '<div class="p-agent"><b>Onboarding Agent</b><br>ranks backup owners per file → readiness score</div>' +
      '<div class="p-agent"><b>Extraction Agent</b><br>drafts a reviewable knowledge file per HIGH-risk file</div>' +
      "</div>";
    h += arrow("outputs");

    h += node("knowledge continuity suite", "a ranked, actionable view of where the bus factor is 1 — and who could take over", null);
    h += "</div>";

    h += '<div class="card" style="margin-top:18px"><h3>Built with Bob — known limitations</h3>' +
      '<ul class="pn-role" style="margin:0;padding-left:18px">' +
      "<li>Complexity heuristic can false-positive on config files (e.g. YAML with many conditionals scores high).</li>" +
      "<li>Risk thresholds (author count, doc &lt; 40) are not yet tuned to real multi-contributor projects.</li>" +
      "<li>Validated on steam-snap only — a single, mostly single-author repo.</li>" +
      "</ul></div>";

    return h;
  }

  // ---------------------------------------------------------------- modal drill-down
  function modalHTML(file) {
    var s = stats();
    var r = riskMap()[file];
    var own = entryFor(s.contributor.files, file);
    var cx = entryFor((s.complexity.files || []), file);
    var doc = entryFor((s.doc.files || []), file);
    var ob = entryFor(s.ob.files, file);
    var ex = entryFor(s.ex.files, file);

    var h = "";
    h += '<button class="modal-close" id="modal-close" title="Close">' + String.fromCharCode(215) + "</button>";
    h += '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">';
    h += "<h2 class=\"file-cell\">" + esc(file) + "</h2>";
    if (r) h += badge(r.risk_level, r.risk_level);
    h += "</div>";

    if (r || own) {
      h += '<div class="modal-sec"><h3>Risk profile</h3><dl class="kv">';
      if (own) {
        h += "<dt>Contributors</dt><dd>" + fmtNum(own.author_count) + (own.authors && own.authors.length ? " — " + esc(own.authors.join(", ")) : "") + "</dd>";
        h += "<dt>Last touch</dt><dd>" + esc(own.last_touch_date || "") + (own.days_since_last_touch != null ? " (" + fmtNum(own.days_since_last_touch) + " days ago)" : "") + "</dd>";
        h += "<dt>Commits</dt><dd>" + fmtNum(own.commit_count) + " total on this file</dd>";
      }
      if (r) {
        h += "<dt>Complexity</dt><dd>" + fmtNum(r.complexity_score) + " / 100</dd>";
        h += "<dt>Docs</dt><dd>" + fmtNum(r.doc_score) + " / 100</dd>";
        h += "<dt>Risk driver</dt><dd>" + esc(r.why || "") + "</dd>";
      }
      h += "</dl></div>";
    }
    if (cx) {
      h += '<div class="modal-sec"><h3>Complexity metrics</h3><dl class="kv">';
      h += "<dt>Lines</dt><dd>" + fmtNum(cx.metrics.nloc) + "</dd>";
      h += "<dt>Functions</dt><dd>" + fmtNum(cx.metrics.function_count) + "</dd>";
      h += "<dt>Cyclomatic</dt><dd>avg " + fmtNum(cx.metrics.avg_cyclomatic_complexity) + " · max " + fmtNum(cx.metrics.max_cyclomatic_complexity) + "</dd>";
      h += "</dl></div>";
    }
    if (doc) {
      h += '<div class="modal-sec"><h3>Documentation</h3><dl class="kv">';
      h += "<dt>Score</dt><dd>" + fmtNum(doc.documentation_score) + " / 100</dd>";
      if (doc.metrics) {
        var dm = doc.metrics;
        h += "<dt>Inline comments</dt><dd>" + fmtNum(dm.comment_count) + "</dd>";
        h += "<dt>Docstrings</dt><dd>" + fmtNum(dm.docstring_count) + "</dd>";
        h += "<dt>File description</dt><dd>" + (dm.has_file_description ? "yes" : "no") + "</dd>";
        h += "<dt>External docs</dt><dd>" + (dm.has_external_documentation ? "yes" : "no") + "</dd>";
      }
      if (doc.reason) h += "<dt>Reason</dt><dd>" + esc(doc.reason) + "</dd>";
      h += "</dl></div>";
    }
    if (ob) {
      h += '<div class="modal-sec"><h3>Onboarding successors</h3>';
      if (ob.dominant_owner) h += '<p class="muted" style="margin:0 0 8px;">Dominant owner: <strong style="color:#fff">' + esc(ob.dominant_owner) + "</strong>" +
        (ob.all_owners && ob.all_owners.length > 1 ? ' · all owners: ' + esc(ob.all_owners.join(", ")) : "") + "</p>";
      h += '<div class="backups">';
      (ob.backups || []).forEach(function (b) {
        var score = Number(b.readiness_score) || 0;
        h += '<div class="backup-row">' +
          '<div class="backup-name">' + esc(b.author) + " " + badge(b.bucket, b.bucket) + "</div>" +
          '<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><span>' + fmtNum(score) + "</span>" + scorebar(score) + "</div>" +
          '<div class="nowrap muted" style="font-size:12px">' + backupStats(b) + "</div>" +
          '<div class="backup-why">' + esc(b.why) + "</div></div>";
      });
      h += "</div></div>";
    }
    if (ex) {
      h += '<div class="modal-sec"><h3>Extraction (module 3)</h3><dl class="kv">';
      if (ex.comment_count_extracted != null) h += "<dt>Comments extracted</dt><dd>" + fmtNum(ex.comment_count_extracted) + "</dd>";
      if (ex.commit_count_used != null) h += "<dt>Commits mined</dt><dd>" + fmtNum(ex.commit_count_used) + "</dd>";
      if (ex.why) h += "<dt>Why this file</dt><dd>" + esc(ex.why) + "</dd>";
      h += "</dl></div>";
    }
    if (ex && ex.draft_markdown) {
      h += '<div class="modal-sec"><h3>Knowledge draft</h3><div class="card" style="margin:0">' + md(ex.draft_markdown) + "</div></div>";
    }
    return h;
  }

  // ---------------------------------------------------------------- wiring
  function showTab(name) {
    currentTab = name;
    $$(".tab").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    var v = $("#view");
    switch (name) {
      case "risk": v.innerHTML = riskHTML(); break;
      case "busfactor": v.innerHTML = busfactorHTML(); break;
      case "complexity": v.innerHTML = complexityHTML(); break;
      case "documentation": v.innerHTML = documentationHTML(); break;
      case "onboarding": v.innerHTML = onboardingHTML(); break;
      case "extraction": v.innerHTML = extractionHTML(); break;
      case "pipeline": v.innerHTML = pipelineHTML(); break;
      default: v.innerHTML = overviewHTML();
    }
    wireView(v);
  }

  function wireView(v) {
    var s = $("#risk-search", v);
    if (s) {
      s.addEventListener("input", debounce(function () {
        var pos = s.selectionStart == null ? s.value.length : s.selectionStart;
        searchQ = s.value.trim();
        showTab(currentTab);
        var ni = $("#risk-search");
        if (ni) {
          ni.focus();
          try { ni.setSelectionRange(pos, pos); } catch (e) {}
        }
      }, 150));
    }
    $$(".seg button[data-level]", v).forEach(function (b) {
      b.addEventListener("click", function () { riskFilter = b.dataset.level; showTab(currentTab); });
    });
    $$(".clickable[data-file]", v).forEach(function (tr) {
      tr.addEventListener("click", function () { openModal(decodeURIComponent(tr.dataset.file)); });
    });
  }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function openModal(file) {
    $("#modal").innerHTML = modalHTML(file);
    $("#modal-backdrop").classList.add("open");
    document.body.style.overflow = "hidden";
    var closeBtn = $("#modal-close");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
  }
  function closeModal() {
    $("#modal-backdrop").classList.remove("open");
    document.body.style.overflow = "";
  }

  function tipHTML(file) {
    var x = riskMap()[file];
    var own = entryFor((DATA.contributor && DATA.contributor.files) || [], file);
    if (!x) return null;
    var short = file.split("/").pop();
    var h = "";
    h += "<b>" + esc(short) + "</b> " + badge(x.risk_level, x.risk_level);
    if (own) {
      h += '<div class="tip-row"><span>Authors</span><span>' + esc(String(own.author_count)) + "</span>" +
        '<span>Last touch</span><span>' + (own.days_since_last_touch != null ? fmtNum(own.days_since_last_touch) + "d ago" : "—") + "</span></div>";
    }
    h += '<div class="tip-row"><span>Complexity</span><span>' + fmtNum(x.complexity_score) + "/100</span>" +
      '<span>Documentation</span><span>' + fmtNum(x.doc_score) + "/100</span></div>";
    if (x.why) h += '<div class="tip-why" style="margin-top:5px">' + esc(x.why) + "</div>";
    return h;
  }

  function boot() {
    $$(".tab").forEach(function (b) {
      b.addEventListener("click", function () { showTab(b.dataset.tab); });
    });
    $("#modal-backdrop").addEventListener("click", function (e) { if (e.target === e.currentTarget) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

    var tipEl = document.createElement("div");
    tipEl.id = "atlas-tip";
    document.body.appendChild(tipEl);
    var timer = null;
    document.addEventListener("mouseover", function (e) {
      var cell = e.target.closest ? e.target.closest(".atlas-cell") : null;
      if (!cell) { if (timer) clearTimeout(timer); tipEl.style.display = "none"; return; }
      clearTimeout(timer);
      var html = tipHTML(decodeURIComponent(cell.dataset.file));
      if (!html) return;
      tipEl.innerHTML = html;
      tipEl.style.display = "block";
      var rect = cell.getBoundingClientRect();
      var hgt = tipEl.offsetHeight, wdt = tipEl.offsetWidth;
      var top = rect.top - hgt - 10;
      if (top < 8) top = rect.bottom + 10;
      var left = rect.left;
      if (left + wdt > window.innerWidth - 8) left = Math.max(8, window.innerWidth - wdt - 8);
      tipEl.style.left = left + "px";
      tipEl.style.top = top + "px";
    });
    document.addEventListener("mouseout", function (e) {
      if (e.target.closest && e.target.closest(".atlas-cell")) {
        timer = setTimeout(function () { tipEl.style.display = "none"; }, 120);
      }
    });

    showTab("overview");
  }

  loadData();
})();