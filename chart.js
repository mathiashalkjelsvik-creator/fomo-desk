// chart.js - canvas charts, devicePixelRatio aware, no library. LineChart (Home balance) + CandleChart (Coin).
(function(){
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function setup(canvas){
    const dpr = Math.max(1, window.devicePixelRatio || 1), r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr){ canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return {ctx, w, h};
  }
  const COLORS = {blue:"#0a84ff", green:"#00d35a", red:"#ff453a"};

  // points: [[ts,value],...]; marks: [{ts,text,color}], start: number|null
  class LineChart {
    constructor(canvas){ this.c = canvas; this.pts = []; this.marks = []; this.start = null; this.anim = 1; this.prevLast = null;
      new ResizeObserver(() => this.draw()).observe(canvas); }
    set(points, marks, start){
      const grew = this.pts.length && points.length > this.pts.length && points[0] && this.pts[0] && points[0][0] === this.pts[0][0];
      this.prevLast = grew ? this.pts[this.pts.length - 1] : null;
      this.pts = points || []; this.marks = marks || []; this.start = start;
      if (grew && !reduce()){ const t0 = performance.now();
        const step = t => { this.anim = Math.min(1, (t - t0) / 250); this.draw(); if (this.anim < 1) requestAnimationFrame(step); };
        this.anim = 0; requestAnimationFrame(step);
      } else { this.anim = 1; this.draw(); }
    }
    draw(){
      const {ctx, w, h} = setup(this.c); const p = this.pts;
      if (p.length < 2) return;
      const top = 44, bot = h - 10, padL = 16, padR = 16;
      let lo = Math.min(...p.map(q => q[1])), hi = Math.max(...p.map(q => q[1]));
      if (this.start != null){ lo = Math.min(lo, this.start); hi = Math.max(hi, this.start); }
      if (hi - lo < 1e-9){ hi += 1; lo -= 1; }
      const t0 = p[0][0], t1 = p[p.length - 1][0] || t0 + 1;
      const X = t => padL + (t - t0) / Math.max(1, t1 - t0) * (w - padL - padR);
      const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
      let pts = p.map(q => [X(q[0]), Y(q[1])]);
      if (this.anim < 1 && this.prevLast){       // new point slides in
        const a = pts[pts.length - 2], b = pts[pts.length - 1];
        pts[pts.length - 1] = [a[0] + (b[0] - a[0]) * this.anim, a[1] + (b[1] - a[1]) * this.anim];
      }
      const up = p[p.length - 1][1] >= (this.start != null ? this.start : p[0][1]);
      const col = up ? "#00d35a" : "#ff453a";
      // gradient under the line
      const g = ctx.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, up ? "rgba(0,211,90,.28)" : "rgba(255,69,58,.28)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath(); ctx.moveTo(pts[0][0], bot); pts.forEach(q => ctx.lineTo(q[0], q[1])); ctx.lineTo(pts[pts.length - 1][0], bot); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      // dashed start line
      if (this.start != null){ ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(235,235,245,.3)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Y(this.start)); ctx.lineTo(w, Y(this.start)); ctx.stroke(); ctx.restore(); }
      ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
      const last = pts[pts.length - 1]; ctx.beginPath(); ctx.arc(last[0], last[1], 3.5, 0, 7); ctx.fillStyle = col; ctx.fill();
      // marks above the line: a later mark moves up a row, never overlaps
      ctx.font = "600 12px -apple-system, system-ui, sans-serif"; ctx.textBaseline = "middle";
      const rows = []; // per row: right edge of the last label
      for (const m of this.marks){
        if (m.ts < t0 || m.ts > t1) continue;
        const x = X(m.ts), tw = ctx.measureText(m.text).width + 14;
        let lx = Math.min(Math.max(2, x - tw / 2), w - tw - 2), r = 0;
        while (rows[r] != null && rows[r] > lx - 4) r++;
        rows[r] = lx + tw; const y = Math.max(10, 14 + r * 22);
        ctx.fillStyle = COLORS[m.color] || "#0a84ff";
        const rr = 9; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, y - rr, tw, rr * 2, rr) : ctx.rect(lx, y - rr, tw, rr * 2); ctx.fill();
        ctx.fillStyle = m.color === "blue" ? "#fff" : "#000"; ctx.fillText(m.text, lx + 7, y + .5);
        ctx.strokeStyle = COLORS[m.color] || "#0a84ff"; ctx.globalAlpha = .5; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y + rr); ctx.lineTo(x, (pts.find(q => q[0] >= x) || last)[1]); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
  }

  // candles: [[t,o,h,l,c],...], exit: number|null (orange dashed exit line)
  class CandleChart {
    constructor(canvas){ this.c = canvas; this.k = []; this.exit = null; new ResizeObserver(() => this.draw()).observe(canvas); }
    set(k, exit){ this.k = k || []; this.exit = exit; this.draw(); }
    draw(){
      const {ctx, w, h} = setup(this.c); const k = this.k.slice(-90);
      if (!k.length) return;
      let lo = Math.min(...k.map(q => q[3])), hi = Math.max(...k.map(q => q[2]));
      if (this.exit != null){ lo = Math.min(lo, this.exit); hi = Math.max(hi, this.exit); }
      if (hi - lo < 1e-15){ hi *= 1.01; lo *= .99; }
      const top = 10, bot = h - 10, cw = (w - 32) / Math.max(k.length, 20);
      const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
      k.forEach((q, i) => {
        const x = 16 + i * cw + cw / 2, upc = q[4] >= q[1], col = upc ? "#00d35a" : "#ff453a";
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, Y(q[2])); ctx.lineTo(x, Y(q[3])); ctx.stroke();
        ctx.fillStyle = col; const y1 = Y(Math.max(q[1], q[4])), y2 = Y(Math.min(q[1], q[4]));
        ctx.fillRect(x - Math.max(1, cw * .35), y1, Math.max(2, cw * .7), Math.max(1, y2 - y1));
      });
      if (this.exit != null){ ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#ff9f0a"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, Y(this.exit)); ctx.lineTo(w, Y(this.exit)); ctx.stroke(); ctx.restore(); }
    }
  }

  function ring(canvas, score){
    const {ctx, w, h} = setup(canvas), r = Math.min(w, h) / 2 - 4;
    ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.strokeStyle = "#2c2c2e"; ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
    if (score == null) return;
    ctx.strokeStyle = score >= 70 ? "#00d35a" : "#ff453a";
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(100, score)) / 100); ctx.stroke();
  }
  window.DeskCharts = {LineChart, CandleChart, ring};
})();
