"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, ZoomControl, useMap, Tooltip } from "react-leaflet";
import L from "leaflet";
import { interpAt, nearestDist, formatT } from "../lib/runplan";

const TILES = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
};

function FitBounds({ points, fitKey }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length < 2) return;
    const b = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
    setTimeout(() => { map.invalidateSize(); map.fitBounds(b, { padding: [44, 44] }); }, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function Resizer() {
  const map = useMap();
  useEffect(() => {
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    const t = setTimeout(onResize, 200);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(t); };
  }, [map]);
  return null;
}

const runnerIcon = L.divIcon({
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  html:
    '<div style="position:relative;width:24px;height:24px">' +
    '<div style="position:absolute;inset:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--bg),0 0 14px var(--accent)"></div>' +
    '<div style="position:absolute;inset:0;border-radius:50%;border:2px solid var(--accent);animation:pulsering 1.7s ease-out infinite"></div>' +
    "</div>",
});

export default function MapView({ points, segs, hoverSeg, theme, fitKey, dispDist, onHover, onHoverEnd, onCommit }) {
  const center = points && points.length ? [points[0].lat, points[0].lon] : [59.05, 10.03];
  const kmMarkers = useMemo(() => {
    if (!points || points.length < 2) return [];
    const total = points[points.length - 1].dist;
    const out = [];
    for (let k = 1; k <= Math.floor(total / 1000); k++) {
      const p = interpAt(points, k * 1000);
      out.push({ km: k, lat: p.lat, lon: p.lon });
    }
    return out;
  }, [points]);

  const runner = points && points.length ? interpAt(points, dispDist) : null;
  const start = points && points.length ? points[0] : null;
  const finish = points && points.length ? points[points.length - 1] : null;

  return (
    <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }} zoomControl={false} scrollWheelZoom attributionControl>
      <ZoomControl position="topright" />
      <TileLayer
        key={theme}
        url={TILES[theme] || TILES.dark}
        subdomains="abcd"
        maxZoom={20}
        attribution="© OpenStreetMap · © CARTO"
      />
      <Resizer />
      <FitBounds points={points} fitKey={fitKey} />

      {segs &&
        segs.map((s) =>
          s.draw && s.positions.length > 1 ? (
            <Polyline key={`halo-${s.idx}`} positions={s.positions}
              pathOptions={{ color: s.color, weight: 12, opacity: 0.16, lineCap: "round", lineJoin: "round" }} interactive={false} />
          ) : null
        )}

      {segs &&
        segs.map((s) =>
          s.draw && s.positions.length > 1 ? (
            <Polyline
              key={`line-${s.idx}`}
              positions={s.positions}
              pathOptions={{
                color: s.color,
                weight: hoverSeg == null ? 5 : hoverSeg === s.idx ? 8.5 : 4,
                opacity: hoverSeg == null ? 0.95 : hoverSeg === s.idx ? 1 : 0.28,
                lineCap: "round",
                lineJoin: "round",
              }}
              eventHandlers={{
                mousemove: (e) => onHover && onHover(nearestDist(points, e.latlng.lat, e.latlng.lng, s.cs, s.ce), s.idx),
                mouseout: () => onHoverEnd && onHoverEnd(),
                click: (e) => onCommit && onCommit(nearestDist(points, e.latlng.lat, e.latlng.lng, s.cs, s.ce)),
              }}
            >
              <Tooltip sticky>
                <strong>{s.song.name}</strong>
                <br />
                {(s.cs / 1000).toFixed(2)}–{(s.ce / 1000).toFixed(2)} km
                {s.song.bpm ? ` · ${s.song.bpm} BPM` : ""}
              </Tooltip>
            </Polyline>
          ) : null
        )}

      {kmMarkers.map((m) => (
        <CircleMarker key={`km-${m.km}`} center={[m.lat, m.lon]} radius={3.5}
          pathOptions={{ color: "#fff", weight: 1.5, fillColor: "rgba(0,0,0,0.6)", fillOpacity: 0.75 }}>
          <Tooltip direction="top">{m.km} km</Tooltip>
        </CircleMarker>
      ))}

      {start && (
        <CircleMarker center={[start.lat, start.lon]} radius={7}
          pathOptions={{ color: "#fff", weight: 3, fillColor: "oklch(0.7 0.17 150)", fillOpacity: 1 }}>
          <Tooltip direction="top">Start</Tooltip>
        </CircleMarker>
      )}
      {finish && (
        <CircleMarker center={[finish.lat, finish.lon]} radius={7}
          pathOptions={{ color: "#fff", weight: 3, fillColor: "oklch(0.62 0.2 25)", fillOpacity: 1 }}>
          <Tooltip direction="top">Finish</Tooltip>
        </CircleMarker>
      )}

      {runner && <Marker position={[runner.lat, runner.lon]} icon={runnerIcon} interactive={false} zIndexOffset={1000} />}
    </MapContainer>
  );
}
