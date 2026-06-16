// Shared run-plan geometry + helpers, ported from the RunMap design.
// Pure functions over a route's point array (each point: {lat, lon, ele, dist}).

// One color per song — 9 evenly-spread hues.
export const PALETTE = [18, 45, 132, 168, 196, 248, 286, 322, 352].map((h) => ({
  line: `oklch(0.74 0.15 ${h})`,
  fill: `oklch(0.74 0.15 ${h} / 0.24)`,
}));
export const paletteAt = (i) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

// Position interpolated at distance d (meters) along the route.
export function interpAt(points, d) {
  if (!points || !points.length) return { lat: 0, lon: 0, ele: 0, dist: 0 };
  if (d <= points[0].dist) return points[0];
  const last = points[points.length - 1];
  if (d >= last.dist) return last;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (d >= a.dist && d <= b.dist) {
      const t = (d - a.dist) / ((b.dist - a.dist) || 1);
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele: a.ele + (b.ele - a.ele) * t, dist: d };
    }
  }
  return last;
}

// Real route vertices between s and e, with interpolated endpoints.
export function segPoints(points, s, e) {
  const arr = [interpAt(points, s)];
  for (const pt of points) if (pt.dist > s && pt.dist < e) arr.push(pt);
  arr.push(interpAt(points, e));
  return arr;
}

// BPM match vs target cadence — half-tempo aware (1× or 2×).
export function matchOf(songBpm, perfect) {
  if (songBpm == null) return { delta: null, ratio: null, level: "none", label: "?" };
  const d1 = Math.abs(perfect - songBpm), d2 = Math.abs(perfect - songBpm * 2);
  const delta = Math.min(d1, d2);
  const ratio = d2 <= d1 ? "2×" : "1×";
  const level = delta <= 3 ? "good" : delta <= 8 ? "warn" : "bad";
  const eff = d2 <= d1 ? songBpm * 2 : songBpm;
  const label = delta === 0 ? "match" : (eff > perfect ? "+" : "−") + delta;
  return { delta, ratio, level, label };
}

// Lay songs over the route by time: each song covers (duration / pace) km.
export function computeSegs(points, totalDist, songs, paceSecPerKm, perfect) {
  let cum = 0;
  const out = [];
  songs.forEach((s, i) => {
    const dur = (s.durationMs || 0) / 1000;
    const startM = cum;
    const lenM = (dur / paceSecPerKm) * 1000;
    const endM = startM + lenM;
    cum = endM;
    const cs = Math.min(startM, totalDist);
    const ce = Math.min(endM, totalDist);
    const m = matchOf(s.bpm, perfect);
    out.push({
      song: s, idx: i, order: i + 1, startM, endM, cs, ce, dur,
      off: startM >= totalDist, draw: ce > cs,
      positions: ce > cs ? segPoints(points, cs, ce).map((p) => [p.lat, p.lon]) : [],
      color: paletteAt(i).line, fill: paletteAt(i).fill,
      ...m,
    });
  });
  return out;
}

export function formatT(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
export const paceLabelOf = (secPerKm) => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}`;

export function monoOf(name) {
  const w = (name || "").replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/);
  return ((w[0]?.[0] || "") + (w[1]?.[0] || w[0]?.[1] || "")).toUpperCase();
}
export function hueOf(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

// Album-art style object: real art → cover image; otherwise a colored monogram tile.
export function artStyle(url, size, radius, hue, fontSize) {
  const base = { width: size + "px", height: size + "px", borderRadius: radius + "px", flexShrink: 0 };
  if (url) return { ...base, backgroundImage: `url("${url}")`, backgroundSize: "cover", backgroundPosition: "center", backgroundColor: "var(--panel-2)" };
  return { ...base, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: fontSize + "px", color: `oklch(0.95 0.04 ${hue})`, background: `oklch(0.45 0.09 ${hue})` };
}

// Nearest route distance to a lat/lon, optionally constrained to [lo, hi] meters.
export function nearestDist(points, lat, lon, lo, hi) {
  if (!points || !points.length) return 0;
  const r = Math.PI / 180;
  const dist2 = (p) => {
    const dLat = (p.lat - lat) * r;
    const dLon = (p.lon - lon) * r * Math.cos(lat * r);
    return dLat * dLat + dLon * dLon;
  };
  let best = lo != null ? lo : 0, bd = Infinity;
  for (const p of points) {
    if (lo != null && (p.dist < lo || p.dist > hi)) continue;
    const d = dist2(p);
    if (d < bd) { bd = d; best = p.dist; }
  }
  return best;
}
