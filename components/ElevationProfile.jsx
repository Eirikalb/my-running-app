"use client";

import { interpAt, segPoints } from "../lib/runplan";

const C = { CW: 1000, CH: 240, padT: 18, padB: 26 };

export default function ElevationProfile({ points, segs, total, dispDist, hoverSeg }) {
  if (!points || points.length < 2 || !total) {
    return <div style={{ height: 118, marginBottom: 6 }} />;
  }
  const baseY = C.CH - C.padB;
  const eles = points.map((p) => p.ele ?? 0);
  let minE = Math.min(...eles), maxE = Math.max(...eles);
  if (maxE - minE < 1) maxE = minE + 1;
  const padE = (maxE - minE) * 0.14;
  minE -= padE; maxE += padE;
  const xOf = (d) => (d / total) * C.CW;
  const yOf = (e) => C.padT + (1 - (e - minE) / (maxE - minE)) * (C.CH - C.padT - C.padB);

  const areas = segs
    .filter((s) => s.draw)
    .map((s) => {
      const pts = segPoints(points, s.cs, s.ce);
      let d = `M ${xOf(s.cs).toFixed(1)} ${baseY}`;
      pts.forEach((p) => { d += ` L ${xOf(p.dist).toFixed(1)} ${yOf(p.ele ?? 0).toFixed(1)}`; });
      d += ` L ${xOf(s.ce).toFixed(1)} ${baseY} Z`;
      const lit = hoverSeg == null || hoverSeg === s.idx;
      return { d, fill: lit ? s.fill : "oklch(0.6 0.02 80 / 0.06)", key: s.idx };
    });

  let ridge = `M ${xOf(points[0].dist).toFixed(1)} ${yOf(points[0].ele ?? 0).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) ridge += ` L ${xOf(points[i].dist).toFixed(1)} ${yOf(points[i].ele ?? 0).toFixed(1)}`;

  const kmCount = Math.floor(total / 1000);
  const kmLabels = [];
  for (let k = 1; k <= kmCount; k++) kmLabels.push({ k, pct: (k * 1000 / total) * 100 });

  const scrubPct = total ? (dispDist / total) * 100 : 0;
  const curEle = interpAt(points, dispDist).ele ?? 0;
  const scrubTopPct = (yOf(curEle) / C.CH) * 100;

  return (
    <>
      <div style={{ position: "relative", width: "100%", height: 118, marginBottom: 6 }}>
        <svg viewBox="0 0 1000 240" preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", overflow: "visible" }}>
          {areas.map((a) => <path key={a.key} d={a.d} fill={a.fill} />)}
          <path d={ridge} fill="none" stroke="var(--ridge)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </svg>
        {kmLabels.map((k) => (
          <div key={k.k} style={{ position: "absolute", top: 0, bottom: "16px", width: "1px", background: "var(--grid)", left: k.pct + "%" }} />
        ))}
        <div style={{ position: "absolute", top: 0, bottom: 0, width: "2px", left: scrubPct + "%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: scrubPct + "%", top: scrubTopPct + "%", width: "11px", height: "11px", marginLeft: "-5.5px", marginTop: "-5.5px", borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 0 3px var(--panel), 0 0 10px var(--accent)", pointerEvents: "none" }} />
      </div>
      <div style={{ position: "relative", height: 14, marginBottom: 10 }}>
        {kmLabels.map((k) => (
          <span key={k.k} className="mono" style={{ position: "absolute", bottom: 0, left: k.pct + "%", transform: "translateX(-50%)", fontSize: "9px", color: "var(--faint)" }}>{k.k}</span>
        ))}
      </div>
    </>
  );
}
