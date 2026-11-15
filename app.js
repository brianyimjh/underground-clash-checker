require([
  "esri/Map",
  "esri/Basemap",
  "esri/layers/OpenStreetMapLayer",
  "esri/views/SceneView",
  "esri/layers/GraphicsLayer",
  "esri/Graphic",
], (Map, Basemap, OpenStreetMapLayer, SceneView, GraphicsLayer, Graphic) => {
  // Colour convention loosely based on common utility marking colours.
  const COLORS = {
    telecom: [255, 140, 0],
    power: [220, 30, 30],
    water: [30, 110, 230],
    gas: [240, 200, 0],
    sewer: [40, 160, 70],
    drainage: [140, 90, 200],
  };
  const CLASH_COLOR = [255, 0, 255];
  const PROPOSED_COLOR = [20, 20, 20];

  // OpenStreetMap basemap: no API key needed.
  const map = new Map({
    basemap: new Basemap({ baseLayers: [new OpenStreetMapLayer()] }),
  });

  // Let the camera go below the ground, and make the ground see-through.
  map.ground.navigationConstraint = { type: "none" };
  map.ground.opacity = 0.4;

  const utilitiesLayer = new GraphicsLayer({
    title: "Existing and planned utilities",
    elevationInfo: { mode: "absolute-height" },
  });
  const proposedLayer = new GraphicsLayer({
    title: "Proposed route",
    elevationInfo: { mode: "absolute-height" },
  });
  map.addMany([utilitiesLayer, proposedLayer]);

  const view = new SceneView({
    container: "viewDiv",
    map,
    viewingMode: "local", // local scenes suit small, city-scale 3D work
    camera: {
      position: { longitude: 103.8436, latitude: 1.2772, z: 120 },
      tilt: 65,
      heading: 20,
    },
  });

  // ---------- Symbols ----------

  function pipeSymbol(color, diameter, dashedPlanned = false) {
    // Pipes are drawn as 3D tubes. Very thin lines are bumped up so you can see them.
    const size = Math.max(diameter, 0.25);
    return {
      type: "line-3d",
      symbolLayers: [
        {
          type: "path",
          profile: "circle",
          width: size,
          height: size,
          material: { color: [...color, dashedPlanned ? 0.45 : 1] },
        },
      ],
    };
  }

  function toPath(coords, depth) {
    return coords.map(([lon, lat]) => [lon, lat, -depth]);
  }

  // ---------- Load utilities ----------

  let utilities = []; // { id, type, status, depth_m, diameter_m, coords, graphic }

  fetch("data/utilities.geojson")
    .then((r) => r.json())
    .then((geojson) => {
      utilities = geojson.features.map((f) => {
        const p = f.properties;
        const graphic = new Graphic({
          geometry: {
            type: "polyline",
            hasZ: true,
            paths: [toPath(f.geometry.coordinates, p.depth_m)],
            spatialReference: { wkid: 4326 },
          },
          symbol: pipeSymbol(COLORS[p.type], p.diameter_m, p.status === "planned"),
          attributes: p,
          popupTemplate: {
            title: "{id} ({type})",
            content:
              "Status: {status}<br>Depth: {depth_m} m<br>Diameter: {diameter_m} m",
          },
        });
        utilitiesLayer.add(graphic);
        return { ...p, coords: f.geometry.coordinates, graphic };
      });
      renderLegend();
    })
    .catch((err) => {
      document.getElementById("summary").textContent =
        "Could not load data. Serve the folder over HTTP (see README).";
      console.error(err);
    });

  function renderLegend() {
    document.getElementById("legend").innerHTML =
      Object.entries(COLORS)
        .map(([t, c]) => `<div><span class="swatch" style="background:rgb(${c})"></span>${t}</div>`)
        .join("") +
      `<div><span class="swatch" style="background:rgb(${CLASH_COLOR})"></span>clash</div>` +
      `<div><span class="swatch" style="background:rgb(${PROPOSED_COLOR})"></span>proposed route</div>`;
  }

  // ---------- Drawing the proposed route ----------

  const drawBtn = document.getElementById("drawBtn");
  let drawing = false;
  let routeCoords = [];

  drawBtn.addEventListener("click", () => {
    drawing = !drawing;
    drawBtn.classList.toggle("active", drawing);
    drawBtn.textContent = drawing ? "Finish drawing" : "Start drawing";
    view.container.style.cursor = drawing ? "crosshair" : "";
    if (drawing) {
      routeCoords = [];
      redrawRoute();
    } else {
      runCheck();
    }
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    routeCoords = [];
    drawing = false;
    drawBtn.classList.remove("active");
    drawBtn.textContent = "Start drawing";
    view.container.style.cursor = "";
    view.closePopup();
    redrawRoute();
    resetUtilityColors();
    document.getElementById("results").innerHTML = "";
    document.getElementById("summary").textContent = "Draw a route to run the check.";
  });

  const sameAsLast = (pt) => {
    const last = routeCoords[routeCoords.length - 1];
    return last && Math.abs(last[0] - pt[0]) < 1e-7 && Math.abs(last[1] - pt[1]) < 1e-7;
  };

  view.on("click", (event) => {
    if (!drawing || !event.mapPoint) return;
    event.stopPropagation(); // don't open popups while drawing
    const pt = [event.mapPoint.longitude, event.mapPoint.latitude];
    if (!sameAsLast(pt)) routeCoords.push(pt); // a double-click also fires clicks
    redrawRoute();
  });

  // While drawing: Backspace removes the last point, Escape cancels.
  document.addEventListener("keydown", (e) => {
    if (!drawing || e.target.matches("input")) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      routeCoords.pop();
      redrawRoute();
    } else if (e.key === "Escape") {
      document.getElementById("clearBtn").click();
    }
  });

  view.on("double-click", (event) => {
    if (!drawing) return;
    event.stopPropagation(); // don't zoom
    // The view doesn't always fire "click" for a double-click, so add the
    // final point here unless it's already the last one.
    if (event.mapPoint) {
      const pt = [event.mapPoint.longitude, event.mapPoint.latitude];
      if (!sameAsLast(pt)) routeCoords.push(pt);
    }
    drawBtn.click();
  });

  function currentInputs() {
    const num = (id) => parseFloat(document.getElementById(id).value);
    return {
      depth_m: num("depth"),
      diameter_m: num("diameter"),
      rules: { horizontal_m: num("hClear"), vertical_m: num("vClear") },
    };
  }

  function redrawRoute(hasClash = false) {
    proposedLayer.removeAll();
    if (routeCoords.length < 1) return;
    let { depth_m, diameter_m } = currentInputs();
    // Keep drawing usable while a field is being edited.
    if (!Number.isFinite(depth_m)) depth_m = 0;
    if (!(diameter_m > 0)) diameter_m = 0.25;

    // The route at its design depth...
    if (routeCoords.length >= 2) {
      proposedLayer.add(
        new Graphic({
          geometry: {
            type: "polyline",
            hasZ: true,
            paths: [toPath(routeCoords, depth_m)],
            spatialReference: { wkid: 4326 },
          },
          symbol: pipeSymbol(hasClash ? CLASH_COLOR : PROPOSED_COLOR, diameter_m),
        })
      );
    }
    // ...and markers on the surface so you can see where you clicked.
    routeCoords.forEach(([lon, lat]) =>
      proposedLayer.add(
        new Graphic({
          geometry: { type: "point", longitude: lon, latitude: lat, z: 0 },
          symbol: {
            type: "point-3d",
            symbolLayers: [{ type: "icon", size: 8, resource: { primitive: "circle" }, material: { color: PROPOSED_COLOR } }],
          },
        })
      )
    );
  }

  // ---------- Clash check ----------

  function resetUtilityColors() {
    utilities.forEach((u) => {
      u.graphic.symbol = pipeSymbol(COLORS[u.type], u.diameter_m, u.status === "planned");
    });
  }

  const summaryEl = document.getElementById("summary");
  const resultsEl = document.getElementById("results");

  function showMessage(html) {
    summaryEl.innerHTML = html;
    resultsEl.innerHTML = "";
  }

  function runCheck() {
    if (routeCoords.length < 2) {
      resetUtilityColors();
      redrawRoute();
      showMessage(routeCoords.length
        ? `<span class="badge clash">Add at least two points.</span> Press Start drawing and click the ground.`
        : "Draw a route to run the check.");
      return;
    }
    const { depth_m, diameter_m, rules } = currentInputs();
    const errors = Clash.validateInputs({ depth_m, diameter_m, rules });
    if (errors.length) {
      resetUtilityColors();
      redrawRoute();
      showMessage(`<span class="badge clash">Check not run.</span> ${errors.join(" ")}`);
      return;
    }
    const results = Clash.checkClashes({ coords: routeCoords, depth_m, diameter_m }, utilities, rules);

    resetUtilityColors();
    results.filter((r) => r.clash).forEach((r) => {
      const u = r.utility;
      u.graphic.symbol = pipeSymbol(CLASH_COLOR, u.diameter_m, u.status === "planned");
    });

    const clashes = results.filter((r) => r.clash).length;
    redrawRoute(clashes > 0);
    summaryEl.innerHTML = clashes
      ? `<span class="badge clash">${clashes} clash${clashes > 1 ? "es" : ""} found.</span> Try another depth or route.`
      : `<span class="badge ok">No clashes.</span> Route meets the clearance rules.`;

    // Always list every clash, then pad with the nearest non-clashing utilities.
    const shown = results.filter((r, i) => r.clash || i < 10);
    lastResults = shown;
    const rows = shown
      .map(
        (r, i) => `<tr class="${r.clash ? "clash" : ""}" data-i="${i}" tabindex="0" title="Zoom to ${r.utility.id}">
          <td>${r.utility.id}${r.utility.status === "planned" ? " <small>(planned)</small>" : ""}</td>
          <td>${r.utility.depth_m} m</td>
          <td>${fmt(r.horizontalGap)}</td>
          <td>${fmt(r.verticalGap)}</td>
          <td class="badge ${r.clash ? "clash" : "ok"}">${r.clash ? "CLASH" : "OK"}</td>
        </tr>`
      )
      .join("");
    resultsEl.innerHTML =
      `<tr><th>ID</th><th>Depth</th><th>H gap</th><th>V gap</th><th></th></tr>${rows}`;
  }

  // Click (or Enter on) a result row to fly to that utility and open its popup.
  let lastResults = [];
  function zoomToRow(tr) {
    const r = tr && lastResults[tr.dataset.i];
    if (!r) return;
    const g = r.utility.graphic;
    view.goTo({ target: g, tilt: 65 }).then(() =>
      view.openPopup({ features: [g], location: g.geometry.extent.center })
    ).catch(() => {});
  }
  resultsEl.addEventListener("click", (e) => zoomToRow(e.target.closest("tr[data-i]")));
  resultsEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") zoomToRow(e.target.closest("tr[data-i]"));
  });

  const fmt = (m) => (m < 0 ? "overlap" : `${m.toFixed(2)} m`);

  // Re-run whenever an input changes.
  ["depth", "diameter", "hClear", "vClear"].forEach((id) =>
    document.getElementById(id).addEventListener("input", () => {
      if (!drawing) runCheck();
      else redrawRoute();
    })
  );

  document.getElementById("opacity").addEventListener("input", (e) => {
    map.ground.opacity = parseFloat(e.target.value);
  });
});
