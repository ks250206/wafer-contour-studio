# Wafer Contour Studio

Interactive 4-inch wafer mapping workspace built with Next.js, React, Observable Plot, and `kriging-rs-wasm`.

## Overview

Wafer Contour Studio lets you:

- edit wafer measurement points directly on the wafer map or in the point table
- interpolate contour maps across a 100 mm wafer with an orientation flat
- switch kriging variogram models and contour color palettes
- export point data, kriging prediction data, and SVG images

## Routes

- `/` : landing page
- `/workspace` : main wafer contour workspace

## Development

This project uses Vite+ as the command wrapper. Use `vp`, not `npm`, `pnpm`, or `yarn`.

Install dependencies:

```bash
vp install
```

Start the development server:

```bash
vp dev
```

Run formatting, lint, and type checks:

```bash
vp check
```

Run tests:

```bash
vp test
```

## Main Features

- 4-inch wafer coordinate system with `x, y` in the range `-50 mm` to `50 mm`
- wafer map with grid, rulers, cursor coordinates, and editable numbered points
- contour plot clipped to the wafer boundary and orientation flat
- multiple contour color palettes
- paginated point table with direct page jump
- JSON export/import for point data
- separate JSON export for kriging prediction results
- SVG export for wafer map and contour plot

## Stack

- Next.js App Router
- React 19
- Tailwind CSS 4
- `@observablehq/plot`
- `kriging-rs-wasm`

## License

MIT. See [LICENSE](./LICENSE).
