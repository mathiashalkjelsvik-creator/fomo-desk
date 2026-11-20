// app.js - the desk on the iPhone (STEP 10). Plain JS, no framework, no build step, no outside requests.
// Plan B (hosting B, GitHub Pages): opened once as {URL}#d={DATA_PATH}&k={DATA_KEY}. The fragment never reaches a
// server; both are kept in localStorage and the fragment is wiped from the address bar at once. Every file under
// d/{DATA_PATH}/ is AES-256-GCM (12-byte nonce + ciphertext) and is decrypted here with WebCrypto.
// Plan A (local API): opened as {URL}#t={APP_TOKEN}; token sent as a header, never in a URL.
// Every FOMO link shown is a "link" string from the desk (links.py). This file never builds a FOMO URL.
(function(){
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const TZ = "Europe/Oslo";
const hm = ts => ts ? new Date(ts * 1000).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit", timeZone: TZ}) : "";
const hms = ts => ts ? new Date(ts * 1000).toLocaleTimeString("en-GB", {timeZone: TZ}) : "";
const usd = (v, d = 2) => v == null || isNaN(v) ? "—" : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", {minimumFractionDigits: d, maximumFractionDigits: d});
const price = v => { if (v == null) return "—"; if (v >= 1) return usd(v); const s = v.toPrecision(3); return "$" + (+s).toString().replace(/e-(\d+)/, (m, n) => "e-" + n); };
const compact = v => v == null ? "—" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + Math.round(v);
const pct = (v, d = 2) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const COLOR = {scanner: "#64d2ff", analyst: "#ffd60a", brain: "#bf5af2", executor: "#00d35a", risk: "#ff6b9a"};
const CAP = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const fomoLink = (link, label = "Open on FOMO") => link ? `<a class="fomo" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${label}</a>` : "";

// ---------------------------------------------------------------- source (plan B encrypted files / plan A API) ----
const Src = {
  mode: null, path: null, key: null, token: null,
  init(){
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("d") && h.get("k")){ localStorage.setItem("desk_d", h.get("d")); localStorage.setItem("desk_k", h.get("k")); }
    if (h.get("t")) localStorage.setItem("desk_token", h.get("t"));
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);   // wipe the fragment
    this.path = localStorage.getItem("desk_d"); const k = localStorage.getItem("desk_k"); this.token = localStorage.getItem("desk_token");
    this.mode = this.path && k ? "B" : this.token ? "A" : null;
    this.keyB64 = k;
  },
  async cryptoKey(){
    if (!this.key){
      const b = atob(this.keyB64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - this.keyB64.length % 4) % 4));
      this.key = await crypto.subtle.importKey("raw", Uint8Array.from(b, c => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
    }
    return this.key;
  },
  async raw(rel){
    const r = await fetch(`d/${this.path}/${rel}?v=${Math.floor(Date.now() / 15000)}`, {cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"});
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    const buf = new Uint8Array(await r.arrayBuffer());
    return new Uint8Array(await crypto.subtle.decrypt({name: "AES-GCM", iv: buf.slice(0, 12)}, await this.cryptoKey(), buf.slice(12)));
  },
  apiPath(rel, q){
    if (rel === "state.json") return "/api/state";
    if (rel === "activity.json") return "/api/activity";
    if (rel === "account.json") return "/api/account";
    if (rel === "settings.json") return "/api/settings";
    if (rel === "orders.json") return "/api/orders";
    let m = rel.match(/^bots\/(\w+)\.json$/); if (m) return `/api/bots/${m[1]}/decisions`;
    m = rel.match(/^coin\/(\w+)\.json$/); if (m) return `/api/coin/${m[1]}`;
    if (rel === "chart.json") return `/api/chart?range=${q || "LIVE"}`;
    return null;
  },
  async api(path, opts = {}){
    const r = await fetch(path, {...opts, cache: "no-store", headers: {...(opts.headers || {}), Authorization: "Bearer " + this.token, "Content-Type": "application/json"}});
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; try { e.detail = (await r.json()).detail; } catch (_) {} throw e; }
    return r;
  },
  async json(rel, q){
    if (this.mode === "B") return JSON.parse(new TextDecoder().decode(await this.raw(rel)));
    const j = await (await this.api(this.apiPath(rel, q))).json();
    if (rel === "chart.json") return {[q || "LIVE"]: j};
    if (rel.startsWith("coin/")) { try { j.audit = await (await this.api("/api/audit/" + rel.slice(5, -5))).json(); } catch (_) { j.audit = null; } }
    return j;
  },
  async screenBlob(){
    if (this.mode === "B") return new Blob([await this.raw("screen.jpg")], {type: "image/jpeg"});
    const r = await this.api("/api/screen.jpg"); if (r.status === 423) throw Object.assign(new Error("private"), {status: 423});
    return await r.blob();
  },
  get writable(){ return this.mode === "A"; },
};

// ---------------------------------------------------------------- store ----
const S = {state: null, chart: null, activity: null, account: null, settings: null, bots: {}, coins: {}, lastOk: 0, err: null,
           retryAt: 0, range: "LIVE", seenPush: +localStorage.getItem("desk_seen_push") || 0};
const POLL_S = () => Src.mode === "B" ? 15 : 3;
const SCREEN_S = () => Src.mode === "B" ? 15 : 1;
const STALE_S = 20 * 60;          // plan B publishes every 6 min; older than 20 min = the desk stopped publishing

async function load(rel, q){ return await Src.json(rel, q); }

async function poll(){
  try {
    const [st, ch] = await Promise.all([load("state.json"), load("chart.json", S.range)]);
    S.state = st; S.chart = Object.assign(S.chart || {}, ch); S.lastOk = Date.now(); S.err = null;
    if (Date.now() / 1000 - st.ts > STALE_S) S.err = "stale";
    load("activity.json").then(a => { S.activity = a; render(true); }).catch(() => {});
  } catch (e) { S.err = e.status === 404 && !S.state ? "nodata" : "offline"; }
  S.retryAt = Date.now() + POLL_S() * 1000;
  render(true);
  setTimeout(poll, POLL_S() * 1000);
}
setInterval(() => offlineRow(), 1000);

function offlineRow(){
  const el = $("#offline");
  if (!S.err){ el.hidden = true; return; }
  const n = Math.max(0, Math.ceil((S.retryAt - Date.now()) / 1000));
  const last = S.state ? hm(S.state.ts) : "never";
  el.textContent = S.err === "nodata" ? `Desk offline · retrying in ${n}s · no data published yet`
                 : `Desk offline · retrying in ${n}s · last update ${last}`;
  el.hidden = false;
}

// ---------------------------------------------------------------- odometer ----
function odometer(el, text){
  const old = el.dataset.v || "";
  if (old === text) return;
  el.dataset.v = text;
  const rolling = !reduce() && old.length > 0;
  if (!rolling || old.length !== text.length || el.children.length !== text.length){
    el.innerHTML = [...text].map(ch => /\d/.test(ch)
      ? `<span class="d"><span class="col" style="transform:translateY(-${(rolling ? +ch : +ch) * 1.02}em)">${"0123456789".split("").map(n => `<span>${n}</span>`).join("")}</span></span>`
      : `<span class="c">${esc(ch)}</span>`).join("");
    return;
  }
  [...text].forEach((ch, i) => {
    const d = el.children[i]; if (!d.classList.contains("d") || ch === old[i]) return;
    const col = d.firstChild; col.style.transitionDelay = `${(text.length - 1 - i) * 30}ms`;
    col.style.transform = `translateY(-${+ch * 1.02}em)`;
  });
}

// ---------------------------------------------------------------- router ----
const stack = [];   // pushed screens over a tab: {name, arg}
let tab = "home";
function go(name, arg){ stack.push({name, arg}); history.pushState({depth: stack.length}, ""); render(); window.scrollTo(0, 0); }
window.addEventListener("popstate", () => { if (closeOverlay()) { history.pushState({depth: stack.length}, ""); return; } stack.pop(); render(); });
document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => {
  tab = b.dataset.tab; stack.length = 0; render(); window.scrollTo(0, 0);
}));

let lastKey = "";
function render(fromPoll){
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  offlineRow();
  const top = stack[stack.length - 1];
  const key = top ? top.name + ":" + top.arg : tab;
  const view = $("#view");
  if (fromPoll && key === lastKey && view.firstChild){ (UPDATE[top ? top.name : tab] || (() => {}))(view, top && top.arg); return; }
  lastKey = key;
  view.innerHTML = "";
  (SCREENS[top ? top.name : tab])(view, top && top.arg);
}

// ---------------------------------------------------------------- shared bits ----
const sk = (h, w = "100%", r = 10, m = "0") => `<div class="sk" style="height:${h}px;width:${w};border-radius:${r}px;margin:${m}"></div>`;
function checks(c){
  c = c || {};
  const one = (k, l) => `<span class="chk ${c[k] === true ? "ok" : c[k] === false ? "bad" : ""}"><i>${c[k] === true ? "✓" : c[k] === false ? "✕" : "·"}</i>${l}</span>`;
  return `<span class="checks">${one("screen", "screen")}${one("api", "api")}${one("chain", "chain")}</span>`;
}
function orderLine(o){
  if (!o) return `<span class="muted">No orders yet</span>`;
  const verb = o.side === "buy" ? "Bought" : "Sold";
  const st = o.status === "done" ? (o.checks && o.checks.screen && o.checks.api ? "verified" : (S.state && S.state.mode === "PAPER" ? "PAPER fill" : "done"))
           : o.status === "skipped" ? "skipped" : o.status;
  const amt = o.fillUsd != null ? usd(o.fillUsd) : o.usd != null ? usd(o.usd) : (o.pct ? o.pct + "%" : "");
  const title = o.status === "done" ? `${verb} ${esc(o.symbol)} · ${amt} · ${st}` : `${CAP(o.side)} ${esc(o.symbol)} · ${amt} · ${esc(st)}${o.error ? " · " + esc(o.error) : ""}`;
  return `<span>${title}</span>${checks(o.checks)}`;
}
function avatar(sym, color){ return `<div class="ic" style="background:${color || "#2c2c2e"};color:${color ? "#000" : "rgba(235,235,245,.6)"}">${esc((sym || "?").replace(/^\$/, "").slice(0, 2).toUpperCase())}</div>`; }
function toast(t){ const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 1800); }

// ---------------------------------------------------------------- overlay (sheet / full screen) ----
function closeOverlay(){ const o = $("#overlay"); if (!o.firstChild) return false; o.innerHTML = ""; stopFullTimer(); return true; }
function sheet(html, bind){
  const o = $("#overlay"); o.innerHTML = `<div class="scrim"></div><div class="sheet"><div class="grab"></div>${html}</div>`;
  $(".scrim", o).onclick = closeOverlay; bind && bind($(".sheet", o));
}
function planBSheet(title, cmd, why){
  sheet(`<h3>${esc(title)}</h3><p>${esc(why || "This copy of the app reads encrypted files (plan B) and can't change the desk. Send this to the desk on Telegram:")}</p>
    <div class="cmd">${esc(cmd)}</div><button class="btn" id="cp">Copy</button><p class="faint">Telegram commands arrive with STEP 11.</p>`,
    s => { $("#cp", s).onclick = async () => { try { await navigator.clipboard.writeText(cmd); toast("Copied"); } catch (_) { toast("Select the text to copy"); } }; });
}

// ---------------------------------------------------------------- HOME ----
let line = null, screenTimer = null, curImg = 0;
const SCREENS = {}, UPDATE = {};
SCREENS.home = (v) => {
  const st = S.state;
  v.innerHTML = `
  <div class="navbar">
    <button class="avatar" id="av" aria-label="Account">M</button>
    <button class="title" id="who">Grok Bot <small>›</small></button>
    <span class="sp"></span>
    <button class="iconbtn" id="srch" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>
    <button class="iconbtn" id="bell" aria-label="Notifications"><svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></svg><span class="dot" hidden></span></button>
  </div>
  <div id="hbody"></div>`;
  $("#av").onclick = $("#who").onclick = () => { tab = "account"; stack.length = 0; render(); };
  $("#srch").onclick = searchSheet; $("#bell").onclick = pushesSheet;
  const b = $("#hbody");
  if (!st){ b.innerHTML = sk(70, "70%", 12, "8px 0") + sk(22, "45%", 8, "4px 0 14px") + sk(230, "100%", 14) + sk(44, "100%", 10, "8px 0") +
      `<div class="sk" style="aspect-ratio:16/9;border-radius:22px;margin-top:8px"></div>` + sk(26, "40%", 8, "26px 0 10px") +
      `<div style="display:flex;gap:10px">${sk(190, "78%", 18)}${sk(190, "22%", 18)}</div>` + sk(26, "40%", 8, "26px 0 10px") + sk(300, "100%", 14);
    return; }
  b.innerHTML = `
  <div class="bal-row"><div class="balance odo" id="bal"></div><span class="pill paper" id="paper" ${st.mode === "PAPER" ? "" : "hidden"}>PAPER</span></div>
  <div class="today"><span id="todayp"></span><span class="pill mult" id="mult"></span></div>
  <div class="chart"><canvas id="lc"></canvas><div class="empty-chart" id="lce" hidden>Waiting for the first trade</div></div>
  <div class="ranges" id="rng">${["LIVE","1H","4H","1D","1W","ALL"].map(r => `<button data-r="${r}" class="${r === S.range ? "on" : ""}">${r}</button>`).join("")}</div>
  <div class="screen" id="scr"><img id="si0" alt=""><img id="si1" alt="" style="opacity:0"><div class="nof" id="nof">No frame yet</div>
    <div class="tl" id="stl"><span class="ldot"></span><span>Last frame —</span></div><div class="tr" id="str">Idle</div></div>
  <div class="lastorder" id="lo"></div>
  <div class="sec-h"><h2 id="bh">Bots</h2></div>
  <div class="carousel" id="car"></div>
  <div class="sec-h"><h2>Activity</h2><button id="seeall">See all</button></div>
  <div id="act5"></div>`;
  line = new DeskCharts.LineChart($("#lc"));
  $("#rng").onclick = async e => { const r = e.target.dataset.r; if (!r) return; S.range = r;
    $("#rng").querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.r === r));
    if (!(S.chart && S.chart[r])) { try { S.chart = Object.assign(S.chart || {}, await load("chart.json", r)); } catch (_) {} }
    UPDATE.home(v); };
  $("#seeall").onclick = () => { tab = "activity"; stack.length = 0; render(); };
  $("#scr").onclick = fullScreen;
  UPDATE.home(v); startScreen();
};
UPDATE.home = (v) => {
  const st = S.state; if (!st || !$("#bal")) { if (st) SCREENS.home(v); return; }
  odometer($("#bal"), st.balance != null ? usd(st.balance) : "—");
  $("#paper").hidden = st.mode !== "PAPER";
  const tp = $("#todayp"); tp.textContent = st.todayPct != null ? pct(st.todayPct) + " today" : "";
  tp.className = st.todayPct >= 0 ? "up" : "down";
  const m = $("#mult"); m.hidden = st.multiplier == null; m.textContent = st.multiplier != null ? st.multiplier.toFixed(2) + "×" : "";
  m.classList.toggle("down", st.multiplier != null && st.multiplier < 1);
  const ch = S.chart && S.chart[S.range];
  const has = ch && ch.points && ch.points.length > 1;
  $("#lce").hidden = has;
  if (has) line.set(ch.points, ch.marks, ch.startLine); else line.set([], [], null);
  const ex = (st.bots || []).find(x => x.name === "executor");
  $("#lo").innerHTML = orderLine(ex && ex.lastOrder);
  const running = (st.bots || []).filter(x => x.status === "running").length;
  $("#bh").textContent = `Bots · ${running} running`;
  $("#car").innerHTML = (st.bots || []).map(botCard).join("");
  $("#car").querySelectorAll("[data-ring]").forEach(c => DeskCharts.ring(c, c.dataset.ring === "" ? null : +c.dataset.ring));
  const rows = S.activity ? S.activity.rows.slice(0, 5) : null;
  $("#act5").innerHTML = rows == null ? sk(300, "100%", 14) : rows.length ? `<div class="list">${rows.map(actRow).join("")}</div>` : `<div class="empty">Waiting for the first trade</div>`;
  bindActRows($("#act5"));
  const dot = $("#bell .dot"); if (dot) dot.hidden = !(st.pushes && st.pushes.length && st.pushes[0].ts > S.seenPush);
  screenLabels();
};

function botCard(b){
  const c = COLOR[b.name], head = `<div class="hd"><span class="sdot ${b.status}"></span><span class="nm" style="color:${c}">${CAP(b.name)}</span></div>`;
  let body = "";
  if (b.name === "scanner"){
    body = `<ul class="feed">${(b.feed || []).slice(0, 4).map(f => f.verdict === "kill"
      ? `<li><span class="k">${esc(f.symbol)}</span><span class="r">${esc(f.reason || "")}</span></li>`
      : `<li><span>${esc(f.symbol)}</span><span class="r p">${f.verdict === "pass" ? "→ Analyst" : esc(f.verdict)}</span></li>`).join("") || `<li class="muted">Listening for new pools</li>`}</ul>`;
  } else if (b.name === "analyst"){
    const L = b.layers && b.layers.length ? b.layers : Array(8).fill(null);
    body = `<div style="display:flex;gap:12px;align-items:center"><div style="flex:1"><div class="strips">${L.map(x => `<i class="${x === true ? "ok" : x === false ? "bad" : ""}"></i>`).join("")}</div>
      <div class="muted" style="font-size:14px">${b.lastSymbol ? esc(b.lastSymbol) : "No coin yet"}${b.social === "off" ? " · Social: off" : b.socialPts != null ? ` · Social ${b.socialPts >= 0 ? "+" : ""}${b.socialPts}` : ""}</div></div>
      <div class="ring"><canvas data-ring="${b.score == null ? "" : b.score}"></canvas><b>${b.score == null ? "–" : b.score}</b></div></div>`;
  } else if (b.name === "brain"){
    body = `<div style="font-size:17px">${b.line ? esc(b.line) : `<span class="muted">Nothing to size yet</span>`}</div>
      <div class="muted" style="font-size:14px;margin-top:6px">${esc(b.rule || "")} / under = half size</div>`;
  } else if (b.name === "executor"){
    const o = b.lastOrder;
    const bar = o && o.status === "clicking" ? "Clicking Buy..." : b.bar ? b.bar : o && o.status === "done" && o.side === "buy" ? (o.checks && o.checks.screen && o.checks.api ? "✓ Bought · verified" : "✓ Bought") : "Idle";
    body = `<div class="bar" style="${bar.startsWith("✓") ? "color:#00d35a" : ""}">${esc(bar)}</div>`;
  } else if (b.name === "risk"){
    body = `<div class="pills">${(b.pills || []).map(p => `<span class="tpill ${p.color}">${esc(p.text)}</span>`).join("")}</div>
      <div class="muted" style="font-size:14px;margin-top:10px">${b.open ? b.open + " open position" + (b.open > 1 ? "s" : "") : "No open positions"}</div>`;
  }
  return `<div class="bcard">${head}<div class="t">${esc(b.title || "")}</div>${body}</div>`;
}

// live screen: double buffered, never flashes
let lastBlobUrl = [null, null], screenTs = 0;
function startScreen(){ clearTimeout(screenTimer); tickScreen(); }
async function tickScreen(){
  clearTimeout(screenTimer);
  if (!$("#si0") && !$("#fimg")) return;
  try {
    const blob = await Src.screenBlob();
    const url = URL.createObjectURL(blob);
    const next = 1 - curImg, img = $("#si" + next);
    if (img){
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
      img.style.opacity = 1; const prev = $("#si" + curImg); if (prev) prev.style.opacity = 0;
      if (lastBlobUrl[next]) URL.revokeObjectURL(lastBlobUrl[next]); lastBlobUrl[next] = url; curImg = next;
      $("#nof") && ($("#nof").hidden = true);
    }
    const f = $("#fimg"); if (f) f.src = url;
    S.screenOk = true;
  } catch (e) { if (e.status === 423 && $("#nof")) { $("#nof").hidden = false; $("#nof").textContent = "Paused · private"; } }
  screenLabels();
  screenTimer = setTimeout(tickScreen, SCREEN_S() * 1000);
}
function screenLabels(){
  const sc = S.state && S.state.screen; const tl = $("#stl"), tr = $("#str");
  if (!tl || !sc) return;
  const age = sc.ts ? Date.now() / 1000 - sc.ts : Infinity;
  tl.innerHTML = age < 5 ? `<span class="ldot live"></span><span>Live · Bot's computer</span>` : `<span class="ldot"></span><span>${sc.ts ? "Last frame " + hm(sc.ts) : "No frame yet"}</span>`;
  const busy = sc.bot && sc.status && sc.status !== "Idle";
  tr.textContent = sc.private ? "Paused · private" : busy ? sc.status : "Idle"; tr.style.color = busy ? COLOR[sc.bot] || "#fff" : "#fff";
  if (sc.private && $("#nof")) { $("#nof").hidden = false; $("#nof").textContent = "Paused · private"; }
}
let fullTimer = null; function stopFullTimer(){ clearTimeout(fullTimer); }
function fullScreen(){
  const sc = (S.state && S.state.screen) || {};
  const o = $("#overlay");
  o.innerHTML = `<div class="full"><div class="top"><button class="back" id="fx"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Done</button>
    <span class="muted" style="font-size:13px">${sc.ts ? "Frame " + hms(sc.ts) : ""}</span></div>
    <div class="stage"><img id="fimg" alt="Bot's computer" src="${esc(($("#si" + curImg) || {}).src || "")}"></div>
    <div class="bottom">${sc.link ? `<a class="btn primary" href="${esc(sc.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : `<button class="btn" disabled>No coin on screen</button>`}</div></div>`;
  $("#fx").onclick = closeOverlay;
}

function searchSheet(){
  sheet(`<h3>Search</h3><div class="search"><input class="field" id="q" placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off"></div><div id="res"></div>`, s => {
    const q = $("#q", s); q.focus();
    q.oninput = () => {
      const t = q.value.trim().toLowerCase(); const idx = (S.state && S.state.coins) || [];
      const hits = !t ? [] : idx.filter(c => (c.symbol || "").toLowerCase().includes(t) || (c.name || "").toLowerCase().includes(t) || c.mint.toLowerCase() === t || (t.length > 5 && c.mint.toLowerCase().startsWith(t))).slice(0, 20);
      $("#res", s).innerHTML = !t ? "" : hits.length ? `<div class="list">${hits.map(c => `<div class="row"><button class="tx" data-m="${esc(c.mint)}"><div class="tt">${esc(c.symbol || c.mint.slice(0, 6))}</div><div class="st">${esc(c.name || c.mint)}</div></button>${fomoLink(c.link)}</div>`).join("")}</div>`
        : `<p>Not in tonight's coins.</p>`;
      $("#res", s).querySelectorAll("[data-m]").forEach(b => b.onclick = () => { closeOverlay(); go("coin", b.dataset.m); });
    };
  });
}
function pushesSheet(){
  const p = (S.state && S.state.pushes) || [];
  if (p.length) { S.seenPush = p[0].ts; localStorage.setItem("desk_seen_push", S.seenPush); }
  sheet(`<h3>Pushes</h3>${p.length ? `<div class="list">${p.map(x => `<div class="row"><div class="tx"><div class="tt" style="white-space:normal">${esc(x.text)}</div><div class="st">Grok Bot · ${hm(x.ts)}</div></div>${fomoLink(x.link, "FOMO")}</div>`).join("")}</div>` : `<p>No pushes tonight.</p>`}`);
  render(true);
}

// ---------------------------------------------------------------- ACTIVITY ----
function actRow(r){
  const color = {bought: "#0a84ff", sold: "#00d35a", stopped: "#ff453a", rejected: null}[r.kind];
  const val = r.value || "", vc = /^\+/.test(val) ? "up" : /^-/.test(val) ? "down" : r.kind === "rejected" ? "muted" : "";
  return `<div class="row"><button class="tx" data-open="${r.opens}" data-m="${esc(r.mint || "")}" style="display:flex;gap:12px;align-items:center;text-align:left;min-width:0">
    ${avatar(r.title.split(" ").slice(1).join(" "), color)}<div style="min-width:0"><div class="tt">${esc(r.title)}</div><div class="st">${esc(r.subtitle || "")}</div></div></button>
    <div class="rv"><div class="${vc}">${esc(val)}</div>${fomoLink(r.link)}</div></div>`;
}
function bindActRows(el){ el.querySelectorAll("[data-open]").forEach(b => b.onclick = () => { if (b.dataset.m) go(b.dataset.open, b.dataset.m); }); }
SCREENS.activity = (v) => {
  v.innerHTML = `<h1 class="big" style="margin-top:52px">Activity</h1><div id="al"></div>`; UPDATE.activity(v);
};
UPDATE.activity = (v) => {
  const a = S.activity, el = $("#al"); if (!el) return;
  el.innerHTML = !a ? sk(60, "100%", 14, "0 0 2px").repeat(6) : a.rows.length ? `<div class="list">${a.rows.map(actRow).join("")}</div>` : `<div class="empty">Nothing yet tonight</div>`;
  bindActRows(el);
};

// ---------------------------------------------------------------- BOTS TAB ----
SCREENS.bots = (v) => {
  v.innerHTML = `<h1 class="big" style="margin-top:52px">Bots</h1><div id="bl"></div>`; UPDATE.bots(v);
  ["scanner","analyst","brain","executor","risk"].forEach(n => load(`bots/${n}.json`).then(d => { S.bots[n] = d; UPDATE.bots(v); }).catch(() => {}));
};
UPDATE.bots = (v) => {
  const el = $("#bl"), st = S.state; if (!el) return;
  if (!st){ el.innerHTML = sk(220, "100%", 18, "0 0 12px").repeat(5); return; }
  const open = (st.positions || []).length;
  el.innerHTML = st.bots.map(b => {
    const locked = b.name === "risk" && open > 0, on = b.status !== "paused";
    const dec = S.bots[b.name] ? S.bots[b.name].rows.slice(0, 20) : null;
    return `<div class="bfull"><div class="hd"><span class="sdot ${b.status}"></span><span class="nm" style="color:${COLOR[b.name]}">${CAP(b.name)}</span>
      <span class="muted" style="font-size:15px">${esc(b.title)}</span>
      <button class="swwrap" data-pause="${b.name}" data-on="${on ? 1 : 0}" ${locked ? 'data-locked="1"' : ""} aria-label="Pause ${b.name}"><span class="switch ${on ? "on" : ""} ${locked ? "locked" : ""}"></span></button></div>
      ${locked ? `<div class="faint" style="font-size:13px">Locked while a position is open</div>` : ""}
      <ul class="dec">${dec == null ? `<li class="faint">Loading…</li>` : dec.length ? dec.map(d => `<li><span class="w tnum">${hm(d.ts)}</span><span class="s">${esc(d.symbol || "")} · ${esc(d.decision || "")}${d.reason ? " · " + esc(d.reason) : ""}</span>${fomoLink(d.link, "FOMO")}</li>`).join("") : `<li class="faint">No decisions tonight</li>`}</ul>
      <button class="linkbtn" data-settings="${b.name}">Settings</button></div>`;
  }).join("");
  el.querySelectorAll("[data-pause]").forEach(b => b.onclick = async () => {
    const n = b.dataset.pause, on = b.dataset.on === "1";
    if (b.dataset.locked) { toast("Risk can't pause while a position is open"); return; }
    if (!Src.writable) return planBSheet(`${on ? "Pause" : "Resume"} ${CAP(n)}`, `${on ? "pause" : "resume"} ${CAP(n)}`);
    try { await Src.api(`/api/bots/${n}/${on ? "pause" : "resume"}`, {method: "POST"}); toast(`${CAP(n)} ${on ? "paused" : "running"}`); poll(); } catch (e) { toast(e.detail || "Failed"); }
  });
  el.querySelectorAll("[data-settings]").forEach(b => b.onclick = () => { tab = "account"; stack.length = 0; render(); setTimeout(() => { const g = document.getElementById("g-" + b.dataset.settings); g && g.scrollIntoView({behavior: reduce() ? "auto" : "smooth"}); }, 300); });
};

// ---------------------------------------------------------------- COIN ----
const backBar = (label = "Back") => `<div class="navbar"><button class="back" id="bk"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>${label}</button></div>`;
function bindBack(v){ $("#bk", v).onclick = () => history.back(); }
async function coinData(m){
  if (S.coins[m] && Date.now() - S.coins[m]._t < POLL_S() * 1000) return S.coins[m];
  const c = await load(`coin/${m}.json`); c._t = Date.now(); S.coins[m] = c; return c;
}
const indexLink = m => { const c = ((S.state && S.state.coins) || []).find(x => x.mint === m); return c && c.link; };
SCREENS.coin = (v, m) => {
  v.innerHTML = backBar() + `<div id="cb">${sk(30, "50%", 8, "4px 0") + sk(18, "40%", 8, "6px 0") + sk(70, "70%", 12, "10px 0") + sk(220, "100%", 14) + `<div class="stats">${sk(56, "100%", 14).repeat(3)}</div>`}</div>`;
  bindBack(v);
  coinData(m).then(c => { if (lastKey === "coin:" + m) drawCoin(v, c); }).catch(e => {
    const link = indexLink(m);
    $("#cb", v).innerHTML = `<div class="empty">${e.status === 404 ? "This coin isn't in tonight's data." : "Can't load this coin right now."}</div>${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ""}`;
  });
};
UPDATE.coin = (v, m) => { coinData(m).then(c => drawCoin(v, c)).catch(() => {}); };
function drawCoin(v, c){
  const p = c.position, open = p && !p.closedAt, mode = S.state && S.state.mode;
  const age = c.ageMin == null ? "" : c.ageMin >= 60 ? Math.round(c.ageMin / 60) + "h old" : c.ageMin + "m old";
  const since = p && p.sinceEntryPct != null ? p.sinceEntryPct : null;
  const html = `
    <div style="display:flex;align-items:center;gap:10px">${avatar(c.symbol)}<div style="flex:1;min-width:0"><div style="font:700 24px var(--display)">${esc(c.name || c.symbol || c.mint.slice(0, 6))}</div>
      <div class="muted" style="font-size:15px">${esc(c.symbol || "")} · Solana${age ? " · " + age : ""}</div></div>${mode === "PAPER" ? `<span class="pill paper">PAPER</span>` : ""}</div>
    <div class="chips">${c.shield ? `<span class="shield"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>${esc(c.shield)}</span>` : ""}
      ${c.audit ? `<button class="linkbtn" id="aud">Audit ›</button>` : ""}</div>
    <div class="price odo" id="cp"></div>
    <div class="${since == null ? "muted" : since >= 0 ? "up" : "down"}" style="font-size:17px">${since == null ? (p ? "Closed · " + esc(p.exitReason || "") : "No position") : (since >= 0 ? "▲ " : "▼ ") + Math.abs(since).toFixed(2) + "% since entry"}</div>
    <div class="chart" style="height:220px"><canvas id="cc"></canvas>${c.candles && c.candles.length ? "" : `<div class="empty-chart">No candles yet</div>`}</div>
    <div class="stats"><div class="stat"><div class="l">Market cap</div><div class="v">${compact(c.marketCap)}</div></div>
      <div class="stat"><div class="l">Liquidity</div><div class="v">${compact(c.liquidityUsd)}</div></div>
      <div class="stat"><div class="l">Holders</div><div class="v">${c.holders == null ? "—" : c.holders.toLocaleString("en-US")}</div></div></div>
    ${p ? `<div class="list"><div class="arow"><div class="l">Your position · ${usd(p.sizeUsd)} in · Executor</div><div class="v ${p.pnlUsd >= 0 ? "up" : "down"}">${p.pnlUsd == null ? "" : (p.pnlUsd >= 0 ? "+" : "") + usd(p.pnlUsd)}</div></div></div>` : ""}
    <div class="btns"><a class="btn" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a><button class="btn danger" id="sell" ${open ? "" : "disabled"}>Sell now</button></div>`;
  $("#cb", v).innerHTML = html;
  odometer($("#cp", v), price(c.price));
  if (c.candles && c.candles.length) new DeskCharts.CandleChart($("#cc", v)).set(c.candles, c.exitLine);
  $("#aud", v) && ($("#aud", v).onclick = () => go("audit", c.mint));
  $("#sell", v).onclick = () => sellSheet(c);
}
function sellSheet(c){
  let pick = 100;
  sheet(`<h3>Sell ${esc(c.symbol || "")}</h3><div class="seg" id="sp">${[25, 50, 100].map(n => `<button data-p="${n}" class="${n === 100 ? "on" : ""}">${n}%</button>`).join("")}</div>
    <p>Executor clicks it on FOMO, then verifies.</p><button class="btn danger" id="cs">Confirm sell</button>`, s => {
    $("#sp", s).onclick = e => { if (!e.target.dataset.p) return; pick = +e.target.dataset.p; $("#sp", s).querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.p === pick)); };
    $("#cs", s).onclick = async () => {
      if (!Src.writable) { closeOverlay(); return planBSheet(`Sell ${pick}% of ${c.symbol || ""}`, `sell ${c.symbol || c.mint} ${pick}`); }
      try { await Src.api(`/api/sell/${c.mint}`, {method: "POST", body: JSON.stringify({pct: pick, confirm: true})}); closeOverlay(); toast("Sell queued · Executor"); }
      catch (e) { toast(e.detail || "Sell failed"); }
    };
  });
}

// ---------------------------------------------------------------- AUDIT ----
SCREENS.audit = (v, m) => {
  v.innerHTML = backBar() + `<div id="ab">${sk(30, "50%", 8, "4px 0")}<div class="discs">${`<div class="sk" style="aspect-ratio:1;border-radius:50%"></div>`.repeat(8)}</div>${sk(52, "100%", 14, "0 0 2px").repeat(5)}</div>`;
  bindBack(v);
  coinData(m).then(c => { if (lastKey === "audit:" + m) drawAudit(v, c); }).catch(e => {
    const link = indexLink(m);
    $("#ab", v).innerHTML = `<div class="empty">${e.status === 404 ? "No audit for this coin in tonight's data." : "Can't load the audit right now."}</div>${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ""}`;
  });
};
function drawAudit(v, c){
  const a = c.audit;
  if (!a) { $("#ab", v).innerHTML = `<div class="empty">No audit for this coin.</div><a class="btn primary" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>`; return; }
  const L = a.layers;
  $("#ab", v).innerHTML = `<div style="display:flex;align-items:center;gap:10px">${avatar(a.symbol)}<div style="flex:1"><div style="font:700 24px var(--display)">${esc(a.symbol)}</div>
      <div class="muted" style="font-size:15px">${a.score != null ? "Score " + a.score : ""}${a.reason ? " · " + esc(a.reason) : ""}</div></div>${fomoLink(a.link)}</div>
    <div class="discwrap"><div class="discs" id="dz">${L.map(l => `<div class="disc" data-n="${l.n}"><b>${l.n}</b></div>`).join("")}</div><div class="beam" id="beam" hidden></div></div>
    <div class="list" id="lr">${L.map(l => `<div class="row lrow" data-n="${l.n}" style="opacity:.35"><div class="ic" style="background:#2c2c2e;color:rgba(235,235,245,.6)">${l.n}</div><div class="tx"><div class="tt">${esc(l.name)}</div><div class="st">${esc(l.source || "")}</div></div><div class="rv"><span class="mark"></span> <span>${esc(l.value == null ? "None" : l.value)}</span></div></div>`).join("")}</div>
    <div class="list" style="margin-top:10px"><div class="arow"><div class="l">${esc(a.socialRow || "Social: off")}${a.parts && a.parts.social ? " · " + esc(a.parts.social) : ""}</div></div></div>`;
  const discs = [...v.querySelectorAll(".disc")], rows = [...v.querySelectorAll(".lrow")], beam = $("#beam", v);
  const reveal = i => { const l = L[i], d = discs[i], r = rows[i];
    d.classList.remove("read"); d.classList.add(l.pass === true ? "ok" : l.pass === false ? "bad" : "na"); d.querySelector("b").textContent = l.pass === true ? "✓" : l.pass === false ? "✕" : "–";
    r.style.opacity = 1; r.querySelector(".mark").innerHTML = l.pass === true ? `<span class="up">✓</span>` : l.pass === false ? `<span class="down">✕</span>` : `<span class="faint">–</span>`; };
  if (reduce()) { L.forEach((_, i) => reveal(i)); return; }
  beam.hidden = false; let i = 0;
  const step = () => { if (i >= L.length) { beam.hidden = true; return; } const d = discs[i]; d.classList.add("read");
    beam.style.top = (d.offsetTop + d.offsetHeight / 2) + "px"; setTimeout(() => { reveal(i); i++; step(); }, 320); };
  step();
}

// ---------------------------------------------------------------- ACCOUNT ----
SCREENS.account = (v) => {
  v.innerHTML = `<h1 class="big" style="margin-top:52px">Account</h1><div id="acc">${sk(44, "100%", 10, "0 0 12px") + sk(52, "100%", 14, "0 0 2px").repeat(4) + sk(300, "100%", 14, "20px 0")}</div>`;
  Promise.all([load("account.json"), load("settings.json")]).then(([a, s]) => { S.account = a; S.settings = s; drawAccount(v); }).catch(() => {
    if (S.account) drawAccount(v); else $("#acc", v).innerHTML = `<div class="empty">Account isn't published yet.</div>`; });
};
const LABEL = k => k.split(".")[1].replace(/_/g, " ").replace(/\bpct\b/, "%").replace(/\busd\b/, "$").replace(/\b(min|s|h)\b$/, m => ({min: "(min)", s: "(s)", h: "(h)"}[m]));
function fmtSet(it){ return it.kind === "bool" ? (it.value ? "on" : "off") : String(it.value); }
function drawAccount(v){
  const a = S.account, s = S.settings, mode = a.mode;
  const groups = s ? s.groups : {};
  const order = ["desk", "scanner", "analyst", "social", "brain", "executor", "risk"];
  $("#acc", v).innerHTML = `
    <div class="seg" id="mode"><button data-m="PAPER" class="${mode === "PAPER" ? "on" : ""}">PAPER</button><button data-m="LIVE" class="${mode === "LIVE" ? "on" : ""}">LIVE</button></div>
    <div class="note">${a.liveGate && !a.liveGate.ok ? `LIVE needs a full PAPER night (${a.liveGate.paperNight ? "done" : "not yet"}) and STEP 15 passed (${a.liveGate.step15Passed ? "done" : "not yet"}).` : ""}</div>
    <div class="group">Cash</div>
    <div class="list"><div class="arow"><div class="l">PAPER start cash</div><div class="v tnum">${usd(a.paperStartCash)}</div></div></div>
    <div class="group">FOMO</div>
    <div class="list">
      <a class="arow" href="${esc(a.profileUrl)}" target="_blank" rel="noopener noreferrer"><div class="l">Your FOMO profile</div><div class="v">@${esc(a.fomoHandle)}</div><span class="chev">›</span></a>
      <button class="arow" id="inv"><div class="l">Invite a friend</div><span class="chev">›</span></button>
    </div>
    <div class="group">Copy picks</div>
    <div class="list"><div class="arow"><div class="l">Copy picks</div><div class="seg" style="width:60%">${["off","24h","12h","6h"].map(x => `<button class="${x === "off" ? "on" : ""}" data-cp="${x}">${x}</button>`).join("")}</div></div></div>
    <div class="note">Copy picks (chapter 3) isn't built yet: off.</div>
    <div class="group">Pushes</div>
    <div class="list">
      <div class="arow"><div class="l">Telegram</div><div class="v">${a.notifier === "telegram" ? "connected with STEP 11" : esc(a.notifier)}</div></div>
      <div class="arow"><div class="l">Web push</div><div class="v">${Src.writable ? (a.webPushSubs ? "connected" : "not connected") : "Plan B: Telegram only"}</div></div>
      ${Src.writable && navigator.standalone ? `<button class="arow" id="en"><div class="l" style="color:#0a84ff">Enable notifications</div></button>` : ""}
      <button class="arow" id="tp" ${Src.writable ? "" : "disabled"}><div class="l" style="color:${Src.writable ? "#0a84ff" : "rgba(235,235,245,.3)"}">Send test push</div></button>
      <button class="arow" id="watch"><div class="l" style="color:#0a84ff">Watch in Grok Bot</div></button>
    </div>
    ${order.filter(g => groups[g]).map(g => `<div class="group" id="g-${g}">${CAP(g)}</div><div class="list">${groups[g].filter(it => it.key !== "desk.mode").map(setRow).join("")}</div>`).join("")}
    <div class="note">${Src.writable ? "" : "Plan B: settings are read here and changed on Telegram (\"set stop to -20%\")."} Hosting: ${esc(a.hosting || "")}</div>`;
  $("#mode", v).onclick = e => { const m = e.target.dataset.m; if (!m || m === mode) return; modeSheet(m); };
  $("#inv", v).onclick = async () => { try { if (navigator.share) { await navigator.share({url: a.inviteUrl}); return; } } catch (e) { if (e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(a.inviteUrl); toast("Link copied"); } catch (_) { toast("Link copied"); } };
  $("#watch", v).onclick = () => fullScreen();
  v.querySelectorAll("input[type=range]").forEach(r => {
    const out = r.parentElement.querySelector(".v");
    r.oninput = () => out.textContent = r.value;
    r.onchange = async () => {
      const k = r.dataset.k;
      if (!Src.writable) { planBSheet("Change a setting", `set ${k} to ${r.value}`); r.value = r.dataset.orig; out.textContent = r.dataset.orig; return; }
      try { const j = await (await Src.api("/api/settings", {method: "POST", body: JSON.stringify({key: k, value: +r.value})})).json(); toast(j.text || "Saved"); r.dataset.orig = r.value; }
      catch (e) { toast(e.detail || "Not saved"); r.value = r.dataset.orig; out.textContent = r.dataset.orig; }
    };
  });
}
function setRow(it){
  if ((it.kind === "int" || it.kind === "num") && it.min != null){
    const step = it.kind === "int" ? 1 : (it.max - it.min) <= 2 ? 0.01 : (it.max - it.min) <= 20 ? 0.05 : 0.5;
    return `<div class="setrow"><div class="h"><span>${esc(LABEL(it.key))}</span><span class="v">${esc(it.value)}</span></div>
      <input type="range" min="${it.min}" max="${it.max}" step="${step}" value="${esc(it.value)}" data-k="${esc(it.key)}" data-orig="${esc(it.value)}" aria-label="${esc(it.key)}"></div>`;
  }
  const val = it.key === "desk.withdraw_address" ? (it.value ? "set" : "not set") : fmtSet(it) || "—";
  return `<div class="arow"><div class="l">${esc(LABEL(it.key))}</div><div class="v tnum">${esc(val)}</div></div>`;
}
function modeSheet(m){
  if (m === "PAPER") { if (!Src.writable) return planBSheet("Switch to PAPER", "paper"); }
  sheet(`<h3>Switch to ${m}</h3>${m === "LIVE" ? `<p>Real money. Type LIVE to confirm.</p><input class="field" id="lv" autocomplete="off" autocapitalize="characters" placeholder="LIVE">` : ""}
    <button class="btn ${m === "LIVE" ? "danger" : "primary"}" id="go" style="margin-top:12px" ${m === "LIVE" ? "disabled" : ""}>Switch to ${m}</button>`, s => {
    const lv = $("#lv", s), go_ = $("#go", s); if (lv) lv.oninput = () => go_.disabled = lv.value !== "LIVE";
    go_.onclick = async () => {
      if (!Src.writable) { closeOverlay(); return planBSheet(`Switch to ${m}`, m.toLowerCase()); }
      try { await Src.api("/api/mode", {method: "POST", body: JSON.stringify({mode: m, confirm: m === "LIVE" ? lv.value : undefined})}); closeOverlay(); toast("Mode " + m); poll(); }
      catch (e) { toast(e.detail || "Not switched"); }
    };
  });
}

// ---------------------------------------------------------------- boot ----
Src.init();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
if (!Src.mode){
  $("#tabs").hidden = true;
  $("#view").innerHTML = `<div class="empty" style="margin-top:30vh">Open the private link the desk gave you once.<br><span class="faint">It carries the key in the part after #, which never leaves this phone.</span></div>`;
} else { render(); poll(); }
window.__desk = {S, Src};
})();
