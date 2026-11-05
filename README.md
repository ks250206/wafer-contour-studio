# Wafer Visualization Studio

Interactive wafer contour-map and mask-map tools built with Next.js, React, Observable Plot, and `kriging-rs-wasm`.

## Overview

Wafer Visualization Studio lets you:

- edit wafer measurement points directly on the wafer map or in the point table
- interpolate contour maps across a 100 mm wafer with an orientation flat
- switch kriging variogram models and contour color palettes
- export point data, kriging prediction data, and SVG images
- author wafer mask layouts from schema JSON or direct editing
- visualize arbitrary numeric properties, composition ratios, and phases per opening
- compare two mask-map views side by side as `Primary` and `Secondary`
- load and save full mask-map projects as JSON

## Routes

- `/` : landing page
- `/contour-map` : main wafer contour map editor
- `/mask-map` : mask-layout-based wafer property map editor

## Development

Use Node.js 26 LTS (26.13.0 or later in the 26.x series) and Vite+ 1.5 or later.
Run project commands through `vp`.

Install dependencies:

```bash
vp install
```

Start the development server:

```bash
vp run dev
```

Run formatting, lint, and type checks:

```bash
vp check
```

Run tests:

```bash
vp test
```

Build and serve the production app:

```bash
vp run build
vp run start
```

## Main Features

- `/contour-map`
- 4-inch wafer coordinate system with `x, y` in the range `-50 mm` to `50 mm`
- wafer map with grid, rulers, and editable numbered points
- contour plot clipped to the wafer boundary and orientation flat
- multiple kriging models and contour color palettes
- paginated point table with `10 / 20 / 50 / 100` rows per page
- JSON export/import for point data
- separate JSON export for kriging prediction results
- SVG export for wafer map and contour plot

- `/mask-map`
- schema-driven mask layout import plus direct manual opening editing
- arbitrary numeric properties per opening, including default `thickness`
- composition ratio editing, modal composition editing from the openings table, and multi-phase visualization
- dual wafer views (`Primary` and `Secondary`) with independent mode/key/palette settings
- hover tooltip with opening properties and inline opening selection / deletion modes
- paginated openings table with `10 / 20 / 50 / 100` rows per page
- project save/load, layout export, dataset export, and separate `Primary` / `Secondary` SVG and PNG export

## Stack

- Next.js App Router
- React 19
- Tailwind CSS 4
- `@observablehq/plot`
- `kriging-rs-wasm`

## License

MIT. See [LICENSE](./LICENSE).
