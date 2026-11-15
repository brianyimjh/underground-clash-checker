// Clash detection between a proposed underground route and existing utilities.
//
// Model (deliberately simple, for learning):
// - Each line has a constant depth (metres below ground) and a diameter (metres).
// - Coordinates are WGS84 [lon, lat]. For a few hundred metres around Singapore,
//   an equirectangular projection to local metres is accurate enough.
// - Two lines clash when BOTH clearances fail, measured edge to edge:
//     horizontal gap = plan distance between centrelines - (r1 + r2)
//     vertical gap   = |depth1 - depth2|                   - (r1 + r2)
//   i.e. a crossing is fine if the pipes are far enough apart vertically,
//   and lines at the same depth are fine if they are far enough apart in plan.

(function (root) {
  const M_PER_DEG_LAT = 110574;
  const M_PER_DEG_LON_EQ = 111320;

  function makeProjector(lat0, lon0) {
    const kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
    return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG_LAT];
  }

  function pointSegmentDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + t * dx;
    const cy = a[1] + t * dy;
    return Math.hypot(p[0] - cx, p[1] - cy);
  }

  function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  function segmentsIntersect(a, b, c, d) {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  function segmentSegmentDistance(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
      pointSegmentDistance(a, c, d),
      pointSegmentDistance(b, c, d),
      pointSegmentDistance(c, a, b),
      pointSegmentDistance(d, a, b)
    );
  }

  // Minimum plan distance (metres) between two polylines given as [[lon, lat], ...].
  function polylineDistance(lineA, lineB, project) {
    const A = lineA.map(project);
    const B = lineB.map(project);
    let min = Infinity;
    for (let i = 0; i < A.length - 1; i++) {
      for (let j = 0; j < B.length - 1; j++) {
        min = Math.min(min, segmentSegmentDistance(A[i], A[i + 1], B[j], B[j + 1]));
      }
    }
    return min;
  }

  // Returns a list of error messages; empty means the inputs are usable.
  // Without this, a blank field becomes NaN, every comparison is false, and the
  // check silently reports "no clashes".
  function validateInputs({ depth_m, diameter_m, rules }) {
    const errors = [];
    const fin = (v) => typeof v === "number" && Number.isFinite(v);
    if (!fin(depth_m) || depth_m < 0) errors.push("Depth must be a number ≥ 0.");
    if (!fin(diameter_m) || diameter_m <= 0) errors.push("Diameter must be a number > 0.");
    if (!fin(rules.horizontal_m) || rules.horizontal_m < 0) errors.push("Min horizontal gap must be a number ≥ 0.");
    if (!fin(rules.vertical_m) || rules.vertical_m < 0) errors.push("Min vertical gap must be a number ≥ 0.");
    return errors;
  }

  /**
   * @param proposed  { coords: [[lon,lat],...], depth_m, diameter_m }
   * @param utilities [{ id, type, coords, depth_m, diameter_m, ... }]
   * @param rules     { horizontal_m, vertical_m } minimum clearances (edge to edge)
   * @returns array of { utility, horizontalGap, verticalGap, clash }, closest first
   */
  function checkClashes(proposed, utilities, rules) {
    if (!proposed.coords || proposed.coords.length < 2) throw new Error("Route needs at least two points.");
    const errors = validateInputs({ depth_m: proposed.depth_m, diameter_m: proposed.diameter_m, rules });
    if (errors.length) throw new Error(errors.join(" "));
    const [lon0, lat0] = proposed.coords[0];
    const project = makeProjector(lat0, lon0);
    const r1 = proposed.diameter_m / 2;

    return utilities
      .map((u) => {
        const radii = r1 + u.diameter_m / 2;
        const plan = polylineDistance(proposed.coords, u.coords, project);
        const horizontalGap = plan - radii;
        const verticalGap = Math.abs(proposed.depth_m - u.depth_m) - radii;
        const clash = horizontalGap < rules.horizontal_m && verticalGap < rules.vertical_m;
        return { utility: u, horizontalGap, verticalGap, clash };
      })
      .sort((x, y) => x.horizontalGap - y.horizontalGap);
  }

  const api = { checkClashes, polylineDistance, makeProjector, validateInputs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Clash = api;
})(typeof window !== "undefined" ? window : globalThis);
