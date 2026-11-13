# Underground Clash Checker

A small 3D GIS prototype I built to learn how underground utility planning works. It shows a
fictional network of underground utilities in 3D. You can draw a proposed new route, set its
depth, and check it for clashes with existing services against simple clearance rules.

> **Learning project with fictional data.** The utility network is made up and is not
> affiliated with or based on any agency's real data or systems.

<!-- Add a screenshot here: docs/screenshot.png -->

## What it does

- **3D underground scene** with the ArcGIS Maps SDK for JavaScript (`SceneView`, local viewing
  mode). The ground is see-through, and the camera can go below the surface.
- **Utilities as 3D pipes**, drawn as tubes at their real depth and diameter and coloured by type
  (telecom, power, water, gas, sewer, drainage). Planned utilities are drawn semi-transparent.
- **Drawing a proposed route**: click the ground to add points, then double-click to finish. Set
  the depth and diameter.
- **Clash detection**: flags every utility where *both* the horizontal and the vertical
  clearance (edge to edge) are below the minimum. Clashing pipes turn magenta, and a table lists
  the gaps for the nearest utilities.

## Run it locally

Browsers won't load the data file from `file://`, so serve the folder over HTTP:

```bash
npx serve .
# or: python3 -m http.server 8000
```

Then open the URL it prints. No API key is needed, because the basemap is OpenStreetMap.

## Run the tests

The clash logic is a plain JavaScript module with unit tests (Node 18+):

```bash
node --test
```

## Deploy to GitHub Pages

In the repo, go to Settings → Pages, set the source to *Deploy from a branch*, and choose `main` / root.
The site appears at `https://<username>.github.io/underground-clash-checker/`.

## How the clash check works

See `clash.js`. Each line has a constant depth and a diameter. For each existing utility:

```
horizontal gap = min plan distance between centrelines − (r1 + r2)
vertical gap   = |depth1 − depth2|                     − (r1 + r2)
clash          = horizontal gap < min horizontal  AND  vertical gap < min vertical
```

So two pipes can cross in plan view and still be fine if they are far enough apart vertically.
Coordinates are projected to local metres with an equirectangular approximation, which is
accurate to well under a metre at this scale near the equator.

**Try this:** draw a north–south route east of the junction. At 1.5 m it clashes with the shallow
services, and at 2.8 m it clashes with the drainage culvert and a sewer. There's no depth between
them that fits, so you have to reroute or go deeper than the sewer. That trade-off is why early
coordination of underground space matters.

## Limitations and next steps

- Depth is constant per line. Real utilities vary in depth along their length (true 3D polylines).
- Only straight-line clearance checks. Real rules vary by utility type and owner.
- Ideas to extend it:
  - Per-type clearance rules
  - Depth that varies along a line
  - Loading data as an I3S scene layer or glTF models
  - Saving proposals to a backend (e.g. ASP.NET Core + SQL Server with spatial types)
  - A cross-section (profile) view along the proposed route

## Tech

ArcGIS Maps SDK for JavaScript 4.31 · vanilla JavaScript · GeoJSON · Node test runner
