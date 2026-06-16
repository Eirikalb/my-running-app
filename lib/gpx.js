// GPX parsing + geo helpers. Runs in the browser (uses DOMParser).

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Parse a GPX string into a normalized track.
// Returns { points: [{lat, lon, ele, dist}], totalDist, elevGain, name }
// `dist` is cumulative distance in meters; `ele` may be null.
export function parseGpx(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  const parseErr = doc.querySelector("parsererror");
  if (parseErr) throw new Error("Could not parse this file as GPX/XML.");

  // Support both <trkpt> (tracks) and <rtept> (routes).
  let nodes = Array.from(doc.getElementsByTagName("trkpt"));
  if (nodes.length === 0) nodes = Array.from(doc.getElementsByTagName("rtept"));
  if (nodes.length === 0) throw new Error("No track points (<trkpt>/<rtept>) found in this GPX.");

  const nameNode = doc.querySelector("trk > name, metadata > name, rte > name");
  const name = nameNode ? nameNode.textContent.trim() : "Imported route";

  const points = [];
  let totalDist = 0;
  let elevGain = 0;
  let prev = null;
  let prevEle = null;

  for (const n of nodes) {
    const lat = parseFloat(n.getAttribute("lat"));
    const lon = parseFloat(n.getAttribute("lon"));
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const eleNode = n.getElementsByTagName("ele")[0];
    const ele = eleNode ? parseFloat(eleNode.textContent) : null;

    if (prev) totalDist += haversine(prev.lat, prev.lon, lat, lon);
    if (ele != null && prevEle != null && ele > prevEle) elevGain += ele - prevEle;

    points.push({ lat, lon, ele: isFinite(ele) ? ele : null, dist: totalDist });
    prev = { lat, lon };
    if (ele != null && isFinite(ele)) prevEle = ele;
  }

  if (points.length < 2) throw new Error("GPX has too few valid points to draw a route.");
  return { points, totalDist, elevGain, name };
}
