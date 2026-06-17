"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseGpx } from "../lib/gpx";
import { detectBpmFromUrl } from "../lib/bpm-detect";
import {
  computeSegs, matchOf, formatT, paceLabelOf,
  artStyle, monoOf, hueOf,
} from "../lib/runplan";

// Persist a freshly-detected BPM to the local index (cache-on-detect), so the
// index grows for free from real usage. Fire-and-forget — never blocks the UI.
function cacheBpm(track, preview, bpm) {
  fetch("/api/bpm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: track.name,
      artist: track.artist,
      bpm,
      itunesId: preview?.itunesId ?? null,
      durationMs: preview?.durationMs ?? track.durationMs ?? null,
      previewUrl: preview?.previewUrl ?? null,
      art: preview?.art ?? track.art ?? null,
    }),
  }).catch(() => {});
}

const MapView = dynamic(() => import("../components/MapView"), {
  ssr: false,
  loading: () => <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)" }}>Loading map…</div>,
});
import ElevationProfile from "../components/ElevationProfile";

let uid = 0;
const newId = () => `s${++uid}`;

const MATCH_C = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)", none: "var(--muted)" };
const MATCH_BG = { good: "var(--good-bg)", warn: "var(--warn-bg)", bad: "var(--bad-bg)", none: "var(--inset)" };

export default function Page() {
  const [route, setRoute] = useState(null); // {name, points, totalDist, elevGain}
  const [paceSec, setPaceSec] = useState(330);
  const [perfectBpm, setPerfectBpm] = useState(180);
  const [playlist, setPlaylist] = useState([]);
  const [currentDist, setCurrentDist] = useState(0);
  const [hoverDist, setHoverDist] = useState(null);
  const [hoverSeg, setHoverSeg] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [theme, setTheme] = useState("light");
  const [showSearch, setShowSearch] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [fitKey, setFitKey] = useState(0);

  const fileRef = useRef(null);
  const importRef = useRef(null);
  const previewAudio = useRef(null);
  const playTimer = useRef(null);
  const trackRef = useRef(null);
  const dragging = useRef(false);

  const total = route?.totalDist || 0;
  const points = route?.points || [];
  const segs = useMemo(
    () => (route ? computeSegs(points, total, playlist, paceSec, perfectBpm) : []),
    [route, points, total, playlist, paceSec, perfectBpm]
  );
  const dispDist = hoverDist != null ? hoverDist : currentDist;
  const cur = segs.find((s) => dispDist >= s.cs && dispDist < s.ce) || segs.filter((s) => s.draw).slice(-1)[0] || segs[0] || null;

  const coveredM = Math.min(segs.reduce((a, s) => Math.max(a, s.ce), 0), total);
  const coveragePct = total ? Math.round((coveredM / total) * 100) : 0;
  const estSec = (total / 1000) * paceSec;

  // ---- route loading ----
  function handleRouteFile(file) {
    if (!file) return;
    const isJson = /\.json$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      try {
        if (isJson || text.trimStart().startsWith("{")) applyPlanData(JSON.parse(text));
        else { const g = parseGpx(text); loadRoute({ name: g.name, points: g.points, totalDist: g.totalDist, elevGain: g.elevGain }); }
      } catch (err) { alert(err.message || String(err)); }
    };
    reader.readAsText(file);
  }
  function loadRoute(r) {
    setRoute(r);
    setCurrentDist(0);
    setHoverDist(null);
    setFitKey((k) => k + 1);
  }

  function applyPlanData(data) {
    const songs = Array.isArray(data.songs) ? data.songs : Array.isArray(data) ? data : null;
    const hasRoute = data.route?.points?.length > 1;
    if (!songs && !hasRoute) throw new Error("This JSON has no route or songs to import.");
    if (typeof data.perfectBpm === "number") setPerfectBpm(data.perfectBpm);
    const sec = data.pace?.secPerKm ?? data.paceSec;
    if (typeof sec === "number" && sec > 0) setPaceSec(sec);
    if (hasRoute) {
      loadRoute({
        name: data.route.name || "Imported route",
        points: data.route.points,
        totalDist: data.route.distanceM ?? data.route.points[data.route.points.length - 1].dist ?? 0,
        elevGain: data.route.elevGainM ?? 0,
      });
    }
    if (songs) {
      setPlaylist(songs.map((s) => ({
        id: newId(), name: s.name || "Untitled", artist: s.artist || "",
        durationMs: Number(s.durationMs) || 0, art: s.art || null,
        spotifyId: s.spotifyId || null, bpm: s.bpm ?? null, previewUrl: s.previewUrl || null,
        bpmLoading: false,
      })));
    }
  }

  // ---- playlist ops ----
  function addSong(track) {
    const item = {
      ...track, id: newId(), spotifyId: track.spotifyId ?? null,
      bpm: track.bpm ?? null, previewUrl: track.previewUrl || null, bpmLoading: false,
    };
    setPlaylist((p) => [...p, item]);
    if (item.bpm == null) fetchBpm(item);
  }
  const removeSong = (i) => setPlaylist((p) => p.filter((_, j) => j !== i));
  function moveSong(i, dir) {
    setPlaylist((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const a = [...p]; [a[i], a[j]] = [a[j], a[i]]; return a;
    });
  }
  async function fetchBpm(item) {
    setPlaylist((p) => p.map((s) => (s.id === item.id ? { ...s, bpmLoading: true } : s)));
    try {
      const r = await fetch(`/api/preview?title=${encodeURIComponent(item.name)}&artist=${encodeURIComponent(item.artist)}`);
      const data = await r.json();
      let bpm = data.cachedBpm ?? null;
      if (bpm == null && data.previewUrl) {
        bpm = await detectBpmFromUrl(data.previewUrl);
        if (bpm != null) cacheBpm(item, data, bpm);
      }
      setPlaylist((p) => p.map((s) => (s.id === item.id ? { ...s, bpm: bpm ?? s.bpm, previewUrl: data.previewUrl || s.previewUrl, bpmLoading: false } : s)));
    } catch {
      setPlaylist((p) => p.map((s) => (s.id === item.id ? { ...s, bpmLoading: false } : s)));
    }
  }

  // ---- audio preview ----
  async function togglePreview(song) {
    const el = previewAudio.current;
    if (!el) return;
    if (playingId === song.id) { el.pause(); setPlayingId(null); return; }
    try {
      let url = song.previewUrl;
      if (!url) {
        const r = await fetch(`/api/preview?title=${encodeURIComponent(song.name)}&artist=${encodeURIComponent(song.artist)}`);
        url = (await r.json()).previewUrl;
        if (url) setPlaylist((p) => p.map((s) => (s.id === song.id ? { ...s, previewUrl: url } : s)));
      }
      if (!url) throw new Error("No preview available");
      el.src = url; await el.play(); setPlayingId(song.id);
    } catch (err) { setPlayingId(null); alert(`Couldn't play preview: ${err.message || err}`); }
  }

  // ---- transport (animate the runner along the route) ----
  function togglePlay() {
    if (!route) return;
    if (playing) { clearInterval(playTimer.current); setPlaying(false); return; }
    if (currentDist >= total - 1) setCurrentDist(0);
    setPlaying(true);
    const inc = total / (38 * 20);
    playTimer.current = setInterval(() => {
      setCurrentDist((d) => {
        const nd = d + inc;
        if (nd >= total) { clearInterval(playTimer.current); setPlaying(false); return total; }
        return nd;
      });
    }, 50);
  }
  useEffect(() => () => { clearInterval(playTimer.current); }, []);

  // Follow the browser's color-scheme preference on first load (light if none).
  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");
    else setTheme("light");
  }, []);

  // ---- scrubber bar interactions ----
  const segIndexAt = (dist) => { const s = segs.find((x) => x.draw && dist >= x.cs && dist < x.ce); return s ? s.idx : null; };
  function seekAt(clientX) {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !total) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const dist = f * total;
    setCurrentDist(dist); setHoverDist(null); setHoverSeg(segIndexAt(dist));
  }
  function onTrackDown(e) {
    if (!total) return;
    dragging.current = true; seekAt(e.clientX);
    const mv = (ev) => seekAt(ev.clientX);
    const up = () => { dragging.current = false; setHoverSeg(null); window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  }
  function onTrackMove(e) {
    if (dragging.current || !total) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const dist = f * total;
    setHoverDist(dist); setHoverSeg(segIndexAt(dist));
  }
  const onTrackLeave = () => { if (!dragging.current) { setHoverDist(null); setHoverSeg(null); } };

  // ---- exports ----
  function exportPlan() {
    const data = {
      type: "paceplaylist", version: 2, exportedAt: new Date().toISOString(),
      pace: { secPerKm: paceSec, label: `${paceLabelOf(paceSec)} /km` }, perfectBpm,
      route: route ? { name: route.name, distanceM: Math.round(total), elevGainM: Math.round(route.elevGain || 0), estTimeSec: Math.round(estSec), points: points.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele, dist: p.dist })) } : null,
      songs: playlist.map((s) => ({ name: s.name, artist: s.artist, durationMs: s.durationMs, art: s.art || null, spotifyId: s.spotifyId || null, spotifyUri: s.spotifyId ? `spotify:track:${s.spotifyId}` : null, bpm: s.bpm ?? null })),
      schedule: segs.map((s) => {
        const m = matchOf(s.song.bpm, perfectBpm);
        return {
          order: s.order, name: s.song.name, artist: s.song.artist, bpm: s.song.bpm ?? null,
          bpmMatch: m.level === "none" ? null : { ratio: m.ratio, delta: m.delta, level: m.level },
          startKm: +(s.cs / 1000).toFixed(2), endKm: +(s.ce / 1000).toFixed(2),
          startTime: formatT((s.cs / 1000) * paceSec), endTime: formatT((s.ce / 1000) * paceSec),
        };
      }),
      summary: { songCount: playlist.length, coveragePct },
    };
    download(`${(route?.name || "race-plan").replace(/[^\w-]+/g, "_").slice(0, 40)}.raceplan.json`, JSON.stringify(data, null, 2), "application/json");
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  async function exportSpotify() {
    const withId = playlist.filter((s) => s.spotifyId);
    if (!withId.length) { alert("No Spotify track IDs yet — add songs from search."); return; }
    const uris = withId.map((s) => `spotify:track:${s.spotifyId}`).join("\n");
    const skipped = playlist.length - withId.length;
    const note = skipped ? `\n\n(${skipped} song(s) without a Spotify ID skipped.)` : "";
    try {
      await navigator.clipboard.writeText(uris);
      alert(`Copied ${withId.length} Spotify track links.\n\nIn the Spotify desktop app: create a playlist, click it, then paste (⌘V) to add them all.${note}`);
    } catch {
      download("spotify-tracks.txt", uris, "text/plain");
      alert(`Saved ${withId.length} Spotify URIs to spotify-tracks.txt — paste into a Spotify playlist.${note}`);
    }
  }

  const distKm = total ? (total / 1000).toFixed(2) : "–";
  const curName = cur ? cur.song.name : "—";
  const curArtist = cur ? cur.song.artist : "";
  const curBpm = cur && cur.song.bpm ? cur.song.bpm + " BPM" : "";
  const scrubPct = total ? (dispDist / total) * 100 : 0;

  return (
    <div data-app={theme} style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100%", background: "var(--bg)", color: "var(--text)", overflow: "hidden" }}>

      {/* HEADER */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: "13px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M2 16 L7 9 L11 13 L16 5 L22 11" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>PacePlaylist</span>
          </div>
          <div style={{ width: 1, height: 26, background: "var(--ring)" }} />
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{route ? route.name : "No route loaded"}</span>
            <span className="mono" style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--muted-2)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{route ? "GPX route" : "Upload a GPX to begin"}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 22, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 20 }}>
            <Stat k="Distance" v={distKm} unit=" km" />
            <Stat k="Elev gain" v={route ? String(Math.round(route.elevGain || 0)) : "–"} unit=" m" />
            <Stat k="Est. time" v={total ? formatT(estSec) : "–"} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <button className="iconbtn" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} title="Toggle light / dark" style={{ width: 38, height: 38 }}>
              {theme === "dark" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 14.2A8 8 0 0 1 9.8 4 8 8 0 1 0 20 14.2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
              )}
            </button>
            <button className="iconbtn btn-hover" onClick={() => fileRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 13px", fontSize: 13, fontWeight: 500 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 16V4M12 4L7 9M12 4l5 5M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Upload GPX
            </button>
            <button onClick={() => setShowSearch(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 10, border: "none", background: "var(--accent)", color: "var(--on-accent)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
              Find songs
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml,.json,application/json" onChange={(e) => { handleRouteFile(e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
          <input ref={importRef} type="file" accept=".json,application/json" onChange={(e) => { handleRouteFile(e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
        </div>
      </header>

      {/* BODY */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 16, padding: 16 }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 16 }}>
          {/* MAP */}
          <div style={{ position: "relative", flex: 1, minHeight: 0, borderRadius: 18, overflow: "hidden", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
            {route ? (
              <MapView
                points={points} segs={segs} hoverSeg={hoverSeg} theme={theme} fitKey={fitKey} dispDist={dispDist}
                onHover={(d, i) => { setHoverDist(d); setHoverSeg(i); }}
                onHoverEnd={() => { setHoverDist(null); setHoverSeg(null); }}
                onCommit={(d) => { setCurrentDist(d); setHoverDist(null); }}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, background: "var(--inset)" }}>
                <span style={{ color: "var(--muted)", fontSize: 14 }}>Upload a GPX (or a saved .raceplan.json) to see your route.</span>
                <button className="iconbtn btn-hover" onClick={() => fileRef.current?.click()} style={{ padding: "9px 14px", fontSize: 13, fontWeight: 600 }}>Choose file</button>
              </div>
            )}
            {route && (
              <div style={{ position: "absolute", top: 14, left: 14, zIndex: 500, display: "flex", alignItems: "center", gap: 9, padding: "8px 13px", borderRadius: 11, background: "var(--chip)", backdropFilter: "blur(10px)", border: "1px solid var(--border-2)", pointerEvents: "none" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />
                <span className="mono" style={{ fontSize: 11, color: "var(--text-2)" }}>km {(dispDist / 1000).toFixed(2)} · {formatT((dispDist / 1000) * paceSec)}</span>
                <span style={{ width: 1, height: 14, background: "var(--border-2)" }} />
                <span style={{ fontSize: 12, fontWeight: 600, maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{curName}</span>
              </div>
            )}
          </div>

          {/* ELEVATION + TRANSPORT */}
          <div style={{ flexShrink: 0, borderRadius: 18, border: "1px solid var(--border)", background: "var(--panel)", padding: "14px 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted-2)" }}>Elevation profile</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--muted-2)" }}>{coveragePct >= 100 ? "Full route covered" : total ? `${(coveredM / 1000).toFixed(1)} of ${distKm} km covered` : ""}</span>
            </div>

            <ElevationProfile points={points} segs={segs} total={total} dispDist={dispDist} hoverSeg={hoverSeg} />

            {/* transport */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button className="iconbtn btn-hover" onClick={togglePlay} disabled={!route} style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0, opacity: route ? 1 : 0.5 }}>
                {playing ? (
                  <svg width="14" height="14" viewBox="0 0 12 12"><rect x="2" y="1.5" width="2.8" height="9" rx="0.6" fill="currentColor" /><rect x="7.2" y="1.5" width="2.8" height="9" rx="0.6" fill="currentColor" /></svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 12 12"><path d="M2.5 1.4 L10.4 6 L2.5 10.6 Z" fill="currentColor" /></svg>
                )}
              </button>

              <div ref={trackRef} onMouseDown={onTrackDown} onMouseMove={onTrackMove} onMouseLeave={onTrackLeave}
                style={{ position: "relative", flex: 1, minWidth: 0, height: 30, borderRadius: 8, overflow: "hidden", background: "var(--inset)", cursor: total ? "pointer" : "default" }}>
                {segs.filter((s) => s.draw).map((s) => (
                  <div key={s.idx} style={{ position: "absolute", top: 0, bottom: 0, left: (s.cs / total * 100) + "%", width: (Math.max(0, s.ce - s.cs) / total * 100) + "%", background: s.color, opacity: hoverSeg == null || hoverSeg === s.idx ? 0.92 : 0.3, borderRight: "1.5px solid var(--inset)", transition: "opacity .12s" }} />
                ))}
                {total > 0 && <>
                  <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, left: scrubPct + "%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", pointerEvents: "none", zIndex: 1 }} />
                  <div style={{ position: "absolute", left: scrubPct + "%", top: "50%", width: 14, height: 14, transform: "translate(-50%,-50%)", borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--panel)", boxShadow: "0 1px 5px rgba(0,0,0,0.45)", pointerEvents: "none", zIndex: 2 }} />
                </>}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
                <ArtTile song={cur?.song} size={38} radius={7} fontSize={13} playing={cur && playingId === cur.song.id} onClick={() => cur && togglePreview(cur.song)} />
                <div style={{ display: "flex", flexDirection: "column", gap: 1, width: 172, flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{curName}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{curArtist}{curBpm ? ` · ${curBpm}` : ""}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div style={{ width: 392, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          {/* CONTROLS */}
          <div style={{ flexShrink: 0, borderRadius: 18, border: "1px solid var(--border)", background: "var(--panel)", padding: "16px 18px" }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted-2)" }}>Run settings</span>
            <div style={{ display: "flex", gap: 22, marginTop: 13 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Target pace</span>
                  <span className="mono" style={{ fontSize: 17, fontWeight: 600, color: "var(--accent)" }}>{paceLabelOf(paceSec)}<span style={{ fontSize: 10, color: "var(--muted-2)", fontWeight: 400 }}> /km</span></span>
                </div>
                <input type="range" min="180" max="360" step="5" value={paceSec} onChange={(e) => setPaceSec(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)", height: 4, cursor: "pointer" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Perfect cadence</span>
                  <span className="mono" style={{ fontSize: 17, fontWeight: 600, color: "var(--blue)" }}>{perfectBpm}<span style={{ fontSize: 10, color: "var(--muted-2)", fontWeight: 400 }}> BPM</span></span>
                </div>
                <input type="range" min="150" max="205" step="1" value={perfectBpm} onChange={(e) => setPerfectBpm(+e.target.value)} style={{ width: "100%", accentColor: "var(--blue)", height: 4, cursor: "pointer" }} />
              </div>
            </div>
            <div style={{ marginTop: 15 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted-2)" }}>Music coverage</span>
                <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>{coveragePct}%</span>
              </div>
              <div style={{ position: "relative", height: 6, borderRadius: 4, overflow: "hidden", background: "var(--inset)" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.min(100, coveragePct) + "%", background: coveragePct >= 100 ? "var(--green)" : "var(--accent)", borderRadius: 4 }} />
              </div>
            </div>
          </div>

          {/* PLAYLIST */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderRadius: 18, border: "1px solid var(--border)", background: "var(--panel)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 18px 11px", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Playlist</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--muted-2)" }}>{playlist.length} songs</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <RailIcon title="Import plan (.json)" onClick={() => importRef.current?.click()} d="M12 16V4M12 16l-5-5M12 16l5-5M5 20h14" />
                <RailIcon title="Export race plan" onClick={exportPlan} disabled={!playlist.length} d="M12 4v12M12 4L7 9M12 4l5 5M5 20h14" />
                <RailIcon title="Export to Spotify" onClick={exportSpotify} disabled={!playlist.length} d="M4 12h16M14 6l6 6-6 6" />
                <button onClick={() => setShowSearch(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--border-2)", background: "transparent", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
                  Add
                </button>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
              {playlist.length === 0 && (
                <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 24 }}>No songs yet — hit <strong>Find songs</strong> to build your playlist.</div>
              )}
              {segs.map((s) => {
                const isCur = cur && cur.idx === s.idx;
                const dim = hoverSeg != null && hoverSeg !== s.idx;
                const m = matchOf(s.song.bpm, perfectBpm);
                return (
                  <div key={s.song.id}
                    onMouseEnter={() => setHoverSeg(s.idx)} onMouseLeave={() => setHoverSeg(null)}
                    onClick={() => { setCurrentDist((s.cs + s.ce) / 2); setHoverDist(null); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px 9px 8px", borderRadius: 12, cursor: "pointer", background: isCur ? "var(--row-cur)" : "transparent", opacity: dim ? 0.4 : 1, boxShadow: isCur ? "inset 0 0 0 1px var(--ring)" : "none", transition: "opacity .12s" }}>
                    <div style={{ width: 4, alignSelf: "stretch", borderRadius: 3, background: s.color, opacity: s.off ? 0.35 : 1, flexShrink: 0, minHeight: 42 }} />
                    <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 16, textAlign: "center", flexShrink: 0 }}>{s.order}</span>
                    <div onClick={(e) => { e.stopPropagation(); togglePreview(s.song); }}>
                      <ArtTile song={s.song} size={42} radius={8} fontSize={14} playing={playingId === s.song.id} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.song.name}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.song.artist}</span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{route ? `${(s.cs / 1000).toFixed(2)}–${(s.ce / 1000).toFixed(2)} km · ${formatT(s.dur)}` : formatT(s.dur)}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{s.song.bpmLoading ? <span className="spin" /> : s.song.bpm ?? "—"}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 7, color: MATCH_C[m.level], background: MATCH_BG[m.level] }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: MATCH_C[m.level], display: "inline-block" }} />
                          <span className="mono" style={{ fontSize: 10, fontWeight: 600 }}>{m.label}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        <RowBtn title="Move up" onClick={() => moveSong(s.idx, -1)} d="M12 19V5M5 12l7-7 7 7" />
                        <RowBtn title="Move down" onClick={() => moveSong(s.idx, 1)} d="M12 5v14M5 12l7 7 7-7" />
                        <RowBtn title="Remove" onClick={() => removeSong(s.idx)} d="M6 6l12 12M18 6L6 18" danger />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {showSearch && (
        <SearchOverlay perfectBpm={perfectBpm} onAdd={addSong} onClose={() => setShowSearch(false)}
          isAdded={(key) => playlist.some((s) => s.name + s.artist === key)}
          onRemove={(key) => setPlaylist((p) => p.filter((s) => s.name + s.artist !== key))} />
      )}

      <audio ref={previewAudio} onEnded={() => setPlayingId(null)} />
    </div>
  );
}

// ---------- small components ----------
function Stat({ k, v, unit }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted-2)" }}>{k}</span>
      <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>{v}{unit && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>{unit}</span>}</span>
    </div>
  );
}

function ArtTile({ song, size, radius, fontSize, playing, onClick }) {
  const hue = song ? hueOf(song.name + song.artist) : 0;
  const style = artStyle(song?.art, size, radius, hue, fontSize);
  const mono = song && !song.art ? monoOf(song.name) : "";
  return (
    <div onClick={onClick} title={onClick ? "Play 30s preview" : undefined} className={onClick ? "arttile" : undefined}
      style={{ ...style, position: "relative", cursor: onClick ? "pointer" : "default" }}>
      {mono}
      {onClick && (
        <div className="art-ov" style={{ position: "absolute", inset: 0, borderRadius: radius, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)", color: "#fff", opacity: playing ? 1 : 0 }}>
          {playing ? (
            <svg width="13" height="13" viewBox="0 0 12 12"><rect x="2" y="1.5" width="2.8" height="9" rx="0.6" fill="currentColor" /><rect x="7.2" y="1.5" width="2.8" height="9" rx="0.6" fill="currentColor" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 12 12"><path d="M2.5 1.4 L10.4 6 L2.5 10.6 Z" fill="currentColor" /></svg>
          )}
        </div>
      )}
    </div>
  );
}

function RailIcon({ title, onClick, disabled, d }) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border-2)", background: "transparent", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

function RowBtn({ title, onClick, d, danger }) {
  return (
    <button title={title} onClick={onClick}
      style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--ring)", background: "transparent", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; e.currentTarget.style.color = danger ? "var(--bad)" : "var(--text)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d={d} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

function SearchOverlay({ perfectBpm, onAdd, onClose, isAdded, onRemove }) {
  const [mode, setMode] = useState("browse"); // "browse" (index) | "search" (Spotify)
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [matchOnly, setMatchOnly] = useState(false);
  // browse controls
  const [browseBpm, setBrowseBpm] = useState(perfectBpm);
  const [genre, setGenre] = useState(null); // null = all
  const [genreList, setGenreList] = useState([]);
  const [browseQ, setBrowseQ] = useState(""); // text search over name/artist/album
  const [sort, setSort] = useState("closeness"); // "closeness" | "popularity"
  const [playingId, setPlayingId] = useState(null);
  const inputRef = useRef(null);
  const timer = useRef(null);
  const audioRef = useRef(null);

  const target = mode === "browse" ? browseBpm : perfectBpm;

  useEffect(() => { if (mode === "search") setTimeout(() => inputRef.current?.focus(), 30); }, [mode]);

  // ---- Spotify text search (main) ----
  useEffect(() => {
    if (mode !== "search") return;
    clearTimeout(timer.current);
    if (!query.trim()) { setResults([]); setError(null); return; }
    timer.current = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Search failed");
        const items = (data.items || []).map((t) => ({ ...t, spotifyId: t.id, key: t.name + t.artist, bpm: undefined }));
        setResults(items);
        items.forEach(detectOne); // auto-fill BPM so match badges populate
      } catch (err) { setError(err.message); setResults([]); }
      finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [query, mode]);

  // ---- Browse the index by genre + cadence (sorted by closeness) ----
  useEffect(() => {
    if (mode !== "browse") return;
    let cancelled = false;
    setLoading(true); setError(null);
    const url = `/api/bpm/search?bpm=${browseBpm}&limit=150`
      + (genre ? `&genre=${encodeURIComponent(genre)}` : "")
      + (browseQ.trim() ? `&q=${encodeURIComponent(browseQ.trim())}` : "")
      + (sort === "popularity" ? "&sort=popularity" : "")
      + (matchOnly ? "&within=3" : "");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(url);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Browse failed");
        if (cancelled) return;
        setGenreList(data.genres || []);
        setResults((data.items || []).map((it) => ({
          id: "idx" + it.id, key: it.title + it.artist,
          name: it.title, artist: it.artist, durationMs: it.duration_ms,
          art: it.art_url, previewUrl: it.preview_url, bpm: it.bpm,
          spotifyId: it.spotify_id || null, popularity: it.popularity ?? null,
        })));
      } catch (err) { if (!cancelled) { setError(err.message); setResults([]); } }
      finally { if (!cancelled) setLoading(false); }
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [mode, browseBpm, genre, matchOnly, browseQ, sort]);

  async function playPreview(track) {
    const el = audioRef.current;
    if (!el) return;
    if (playingId === track.id) { el.pause(); setPlayingId(null); return; }
    let url = track.previewUrl;
    if (!url) {
      try {
        const r = await fetch(`/api/preview?title=${encodeURIComponent(track.name)}&artist=${encodeURIComponent(track.artist)}`);
        url = (await r.json()).previewUrl;
      } catch {}
    }
    if (!url) return;
    el.src = url;
    try { await el.play(); setPlayingId(track.id); } catch { setPlayingId(null); }
  }

  async function detectOne(track) {
    try {
      const pr = await fetch(`/api/preview?title=${encodeURIComponent(track.name)}&artist=${encodeURIComponent(track.artist)}`);
      const data = await pr.json();
      let bpm = data.cachedBpm ?? null;
      if (bpm == null && data.previewUrl) {
        bpm = await detectBpmFromUrl(data.previewUrl);
        if (bpm != null) cacheBpm(track, data, bpm);
      }
      setResults((rs) => rs.map((r) => (r.id === track.id ? { ...r, bpm, previewUrl: data.previewUrl || null } : r)));
    } catch {
      setResults((rs) => rs.map((r) => (r.id === track.id ? { ...r, bpm: null } : r)));
    }
  }

  // Browse filters server-side; search filters client-side.
  const shown = mode === "search" && matchOnly
    ? results.filter((r) => matchOf(r.bpm, target).level === "good")
    : results;
  const totalIndexed = genreList.reduce((a, g) => a + g.n, 0);

  const Tab = ({ id, label }) => (
    <button onClick={() => { setMode(id); setResults([]); setError(null); }}
      style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid " + (mode === id ? "transparent" : "var(--border-2)"), background: mode === id ? "var(--accent)" : "transparent", color: mode === id ? "var(--on-accent)" : "var(--muted)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
      {label}
    </button>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "var(--backdrop)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "64px 24px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 920, maxHeight: "calc(100vh - 128px)", display: "flex", flexDirection: "column", borderRadius: 20, border: "1px solid var(--border-2)", background: "var(--panel)", boxShadow: "0 40px 120px rgba(0,0,0,0.45)", overflow: "hidden" }}>
        {/* tabs + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 22px", borderBottom: "1px solid var(--border)" }}>
          <Tab id="browse" label="Browse catalogue" />
          <Tab id="search" label="Search Spotify" />
          <div style={{ flex: 1 }} />
          <button className="iconbtn btn-hover" onClick={onClose} style={{ width: 40, height: 40, borderRadius: 11 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* search input (search mode only) */}
        {mode === "search" && (
          <div style={{ padding: "16px 22px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 15px", borderRadius: 12, background: "var(--inset)", border: "1px solid var(--border-2)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="7" stroke="var(--muted-2)" strokeWidth="2" /><path d="M20 20l-3.5-3.5" stroke="var(--muted-2)" strokeWidth="2" strokeLinecap="round" /></svg>
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs, artists…" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "'Space Grotesk'", fontSize: 16 }} />
              {loading && <span className="spin" />}
            </div>
          </div>
        )}

        {/* controls row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "14px 22px", borderBottom: "1px solid var(--border)" }}>
          {mode === "browse" ? (
            <>
              {/* catalogue text search (name / artist / album) */}
              <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "1 1 220px", minWidth: 180, padding: "8px 13px", borderRadius: 10, background: "var(--inset)", border: "1px solid var(--border-2)" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="7" stroke="var(--muted-2)" strokeWidth="2" /><path d="M20 20l-3.5-3.5" stroke="var(--muted-2)" strokeWidth="2" strokeLinecap="round" /></svg>
                <input value={browseQ} onChange={(e) => setBrowseQ(e.target.value)} placeholder="Search name, artist, album…" style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "'Space Grotesk'", fontSize: 14 }} />
                {browseQ && <button onClick={() => setBrowseQ("")} title="Clear" style={{ background: "none", border: "none", color: "var(--muted-2)", cursor: "pointer", padding: 0, display: "flex" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>}
              </div>
              {/* genre chips */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <GenreChip label="All" active={genre == null} onClick={() => setGenre(null)} />
                {genreList.map((g) => (
                  <GenreChip key={g.genre} label={`${g.genre} (${g.n})`} active={genre === g.genre} onClick={() => setGenre(g.genre)} />
                ))}
              </div>
              {/* bpm slider */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 13px", borderRadius: 10, background: "var(--blue-bg)", border: "1px solid var(--blue-bd)" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--blue-text)" }}>BPM</span>
                <input type="range" min="120" max="205" step="1" value={browseBpm} onChange={(e) => setBrowseBpm(+e.target.value)} style={{ width: 120, accentColor: "var(--blue)", height: 4, cursor: "pointer" }} />
                <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--blue-text)", width: 30 }}>{browseBpm}</span>
              </div>
              {/* sort */}
              <div style={{ display: "flex", alignItems: "center", gap: 3, padding: 3, borderRadius: 10, background: "var(--inset)", border: "1px solid var(--border-2)" }}>
                <SortBtn label="Best match" active={sort === "closeness"} onClick={() => setSort("closeness")} />
                <SortBtn label="Popular" active={sort === "popularity"} onClick={() => setSort("popularity")} />
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", borderRadius: 10, background: "var(--blue-bg)", border: "1px solid var(--blue-bd)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--blue)" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--blue-text)" }}>Matching to {perfectBpm} BPM</span>
            </div>
          )}
          <button onClick={() => setMatchOnly((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border-2)", background: "transparent", color: "var(--muted)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", background: matchOnly ? "var(--accent)" : "transparent", border: matchOnly ? "none" : "1.5px solid var(--border-2)" }}>
              {matchOnly && <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="var(--on-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </span>
            Good matches only
          </button>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{shown.length} results</span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 22px 22px" }}>
          {error && <div style={{ color: "var(--bad)", fontSize: 13, padding: 12 }}>{error}</div>}
          {!error && !results.length && !loading && (
            <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 24 }}>
              {mode === "search"
                ? (query.trim() ? "No results." : "Type to search Spotify.")
                : (totalIndexed ? "No tracks match — widen the BPM or turn off “good matches only.”" : "The catalogue is empty — run npm run crawl to build the index.")}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {shown.map((r) => {
              const m = matchOf(r.bpm, target);
              const added = isAdded(r.key);
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, overflow: "hidden", padding: 10, borderRadius: 13, background: "var(--inset)", border: "1px solid var(--border-soft)" }}>
                  <ArtTile song={r} size={52} radius={9} fontSize={16} playing={playingId === r.id} onClick={() => playPreview(r)} />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                    <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.artist} · {formatT(r.durationMs / 1000)}</span>
                  </div>
                  {r.popularity != null && (
                    <div title="Popularity (0–100, via Deezer)" className="mono" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: "var(--muted)", flexShrink: 0 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 19V10M10 19V5M16 19v-7M22 19h-21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                      {r.popularity}
                    </div>
                  )}
                  <div style={{ minWidth: 34, textAlign: "center", padding: "3px 7px", borderRadius: 7, fontSize: 12, fontWeight: 600, color: MATCH_C[m.level], background: MATCH_BG[m.level], flexShrink: 0 }} className="mono">
                    {r.bpm === undefined ? <span className="spin" /> : r.bpm ?? "—"}
                  </div>
                  <AddRemoveButton added={added} onAdd={() => onAdd(r)} onRemove={() => onRemove(r.key)} />
                </div>
              );
            })}
          </div>
        </div>
        <audio ref={audioRef} onEnded={() => setPlayingId(null)} />
      </div>
    </div>
  );
}

function SortBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{ padding: "6px 11px", borderRadius: 8, border: "none", background: active ? "var(--accent)" : "transparent", color: active ? "var(--on-accent)" : "var(--muted)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
      {label}
    </button>
  );
}

function AddRemoveButton({ added, onAdd, onRemove }) {
  const [hover, setHover] = useState(false);
  const base = { width: 38, height: 38, borderRadius: 10, border: "none", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" };
  if (!added) {
    return (
      <button title="Add to playlist" onClick={(e) => { e.stopPropagation(); onAdd(); }}
        style={{ ...base, background: "var(--accent)", color: "var(--on-accent)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
      </button>
    );
  }
  // In the playlist → click to remove (✕ on hover).
  return (
    <button title="Remove from playlist" onClick={(e) => { e.stopPropagation(); onRemove(); }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...base, background: hover ? "var(--bad)" : "var(--green)", color: hover ? "#fff" : "var(--on-green)" }}>
      {hover ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </button>
  );
}

function GenreChip({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{ padding: "7px 12px", borderRadius: 9, border: "1px solid " + (active ? "transparent" : "var(--border-2)"), background: active ? "var(--accent)" : "transparent", color: active ? "var(--on-accent)" : "var(--muted)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textTransform: "capitalize", whiteSpace: "nowrap" }}>
      {label}
    </button>
  );
}
