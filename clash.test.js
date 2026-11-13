// Run with: node --test
const test = require("node:test");
const assert = require("node:assert");
const { checkClashes, polylineDistance, makeProjector } = require("./clash.js");

const LAT = 1.2795;
const LON = 103.8445;
const M = 1 / 111320; // ~1 metre in degrees near the equator

const rules = { horizontal_m: 1.0, vertical_m: 0.5 };

function pipe(id, coords, depth_m, diameter_m = 0.3) {
  return { id, type: "water", coords, depth_m, diameter_m };
}

test("plan distance between parallel lines 10 m apart is about 10 m", () => {
  const a = [[LON, LAT], [LON + 50 * M, LAT]];
  const b = [[LON, LAT + 10 * M], [LON + 50 * M, LAT + 10 * M]];
  const d = polylineDistance(a, b, makeProjector(LAT, LON));
  assert.ok(Math.abs(d - 10) < 0.2, `got ${d}`);
});

test("crossing lines at the same depth clash", () => {
  const proposed = { coords: [[LON, LAT], [LON + 40 * M, LAT]], depth_m: 1.5, diameter_m: 0.3 };
  const existing = pipe("W1", [[LON + 20 * M, LAT - 20 * M], [LON + 20 * M, LAT + 20 * M]], 1.5);
  const [r] = checkClashes(proposed, [existing], rules);
  assert.strictEqual(r.clash, true);
  assert.ok(r.horizontalGap < 0);
});

test("crossing lines with enough vertical separation do not clash", () => {
  const proposed = { coords: [[LON, LAT], [LON + 40 * M, LAT]], depth_m: 1.5, diameter_m: 0.3 };
  const existing = pipe("W1", [[LON + 20 * M, LAT - 20 * M], [LON + 20 * M, LAT + 20 * M]], 3.0);
  const [r] = checkClashes(proposed, [existing], rules);
  assert.strictEqual(r.clash, false);
  assert.ok(r.verticalGap >= rules.vertical_m);
});

test("parallel lines at the same depth but far apart do not clash", () => {
  const proposed = { coords: [[LON, LAT], [LON + 40 * M, LAT]], depth_m: 1.5, diameter_m: 0.3 };
  const existing = pipe("W1", [[LON, LAT + 5 * M], [LON + 40 * M, LAT + 5 * M]], 1.5);
  const [r] = checkClashes(proposed, [existing], rules);
  assert.strictEqual(r.clash, false);
});

test("results are sorted closest first", () => {
  const proposed = { coords: [[LON, LAT], [LON + 40 * M, LAT]], depth_m: 1.5, diameter_m: 0.3 };
  const far = pipe("FAR", [[LON, LAT + 30 * M], [LON + 40 * M, LAT + 30 * M]], 1.5);
  const near = pipe("NEAR", [[LON, LAT + 3 * M], [LON + 40 * M, LAT + 3 * M]], 1.5);
  const results = checkClashes(proposed, [far, near], rules);
  assert.deepStrictEqual(results.map((r) => r.utility.id), ["NEAR", "FAR"]);
});
