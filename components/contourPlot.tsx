"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { PointProps } from "./point";
import { getWaferSvgPath } from "./waferGeometry";
import { buildKrigingPrediction, loadKrigingModule, VariogramType } from "./krigingPrediction";
import * as Plot from "@observablehq/plot";

export const contourColorPalettes = {
  turbo: {
    label: "Turbo",
    scheme: "turbo",
    gradient:
      "linear-gradient(to top, #30123b 0%, #4145ab 16%, #4675ed 32%, #39a2fc 48%, #1bcfd4 60%, #6df36c 72%, #c8ef34 84%, #f9ba38 92%, #e4450a 100%)",
  },
  viridis: {
    label: "Viridis",
    scheme: "viridis",
    gradient:
      "linear-gradient(to top, #440154 0%, #482878 20%, #3e4989 40%, #31688e 56%, #26828e 68%, #1f9e89 78%, #35b779 88%, #6ece58 94%, #b5de2b 98%, #fde725 100%)",
  },
  plasma: {
    label: "Plasma",
    scheme: "plasma",
    gradient:
      "linear-gradient(to top, #0d0887 0%, #5b02a3 20%, #9a179b 40%, #cb4679 58%, #ed7953 76%, #fb9f3a 88%, #fdca26 96%, #f0f921 100%)",
  },
  cividis: {
    label: "Cividis",
    scheme: "cividis",
    gradient:
      "linear-gradient(to top, #00204c 0%, #243b6b 18%, #43566c 36%, #62736a 54%, #859164 72%, #b3af5f 88%, #fee838 100%)",
  },
  inferno: {
    label: "Inferno",
    scheme: "inferno",
    gradient:
      "linear-gradient(to top, #000004 0%, #1b0c41 18%, #4a0c6b 34%, #781c6d 50%, #a52c60 64%, #cf4446 78%, #ed6925 90%, #fb9b06 96%, #fcffa4 100%)",
  },
  magma: {
    label: "Magma",
    scheme: "magma",
    gradient:
      "linear-gradient(to top, #000004 0%, #180f3d 18%, #440f76 36%, #721f81 52%, #9e2f7f 68%, #cd4071 82%, #f1605d 92%, #fd9668 97%, #fcfdbf 100%)",
  },
  cubehelix: {
    label: "Cubehelix",
    scheme: "cubehelix",
    gradient:
      "linear-gradient(to top, #000000 0%, #163d4e 20%, #54792f 40%, #d07e93 62%, #c0b8ff 82%, #ffffff 100%)",
  },
  warm: {
    label: "Warm",
    scheme: "warm",
    gradient:
      "linear-gradient(to top, #6e40aa 0%, #9c4ec4 20%, #c85ad6 36%, #e46cbe 52%, #f58c94 68%, #f6b26b 84%, #e6d74d 100%)",
  },
  cool: {
    label: "Cool",
    scheme: "cool",
    gradient:
      "linear-gradient(to top, #6e40aa 0%, #5d6fd3 20%, #4c94e6 38%, #3db7dd 54%, #32d1c0 70%, #58e39a 84%, #a4ee6f 100%)",
  },
} as const;

export type ContourColorPalette = keyof typeof contourColorPalettes;

interface ContourPlotProps {
  points: PointProps[];
  size: number;
  diameter: number;
  valueKey?: string;
  contourLevels?: number;
  showDots?: boolean;
  showContours?: boolean;
  variogramType?: VariogramType;
  colorPalette?: ContourColorPalette;
}

export default function ContourPlot({
  points,
  size,
  diameter,
  valueKey = "z",
  contourLevels = 8,
  showDots = true,
  showContours = true,
  variogramType = "spherical",
  colorPalette = "turbo",
}: ContourPlotProps) {
  const [wasmReady, setWasmReady] = useState(false);
  const [krigingModule, setKrigingModule] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameWidth = size + 96;
  const frameHeight = size + 24;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mod = await loadKrigingModule();
        if (!cancelled) {
          setKrigingModule(mod);
          setWasmReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const gridSize = Math.max(260, Math.min(480, Math.round(size * 0.75)));

  const krigingResult = useMemo(() => {
    if (!wasmReady || !krigingModule || points.length < 3) return null;
    return buildKrigingPrediction({
      krigingModule,
      points,
      diameter,
      gridSize,
      valueKey,
      variogramType,
    });
  }, [wasmReady, krigingModule, points, diameter, gridSize, valueKey, variogramType]);

  useEffect(() => {
    if (!containerRef.current || !krigingResult) return;

    containerRef.current.innerHTML = "";

    const { grid, minVal, maxVal } = krigingResult;

    const flatGrid = grid.flat();
    const validValues = flatGrid.filter((v) => isFinite(v));

    if (validValues.length === 0) return;

    const thresholds: number[] = [];
    if (showContours && contourLevels > 0) {
      const range = maxVal - minVal;
      for (let i = 1; i <= contourLevels; i++) {
        thresholds.push(minVal + (range * i) / (contourLevels + 1));
      }
    }

    const maxExtent = diameter / 2;
    const axisPadding = diameter * 0.06;
    const waferMin = -maxExtent;
    const waferMax = maxExtent;
    const plotMin = waferMin - axisPadding;
    const plotMax = waferMax + axisPadding;
    const paletteConfig = contourColorPalettes[colorPalette];
    const plot = Plot.plot({
      width: size,
      height: size,
      marginLeft: 48,
      marginRight: 16,
      marginTop: 16,
      marginBottom: 40,
      x: {
        domain: [plotMin, plotMax],
        label: "x (mm)",
      },
      y: {
        domain: [plotMin, plotMax],
        label: "y (mm)",
      },
      color: {
        type: "linear",
        domain: [minVal, maxVal],
        scheme: paletteConfig.scheme,
        label: valueKey,
        legend: false,
      },
      style: {
        background: "#FEFEFE",
        color: "black",
        fontSize: "12px",
      },
      marks: [
        Plot.raster(grid.flat(), {
          width: gridSize,
          height: gridSize,
          x1: waferMin,
          x2: waferMax,
          y1: waferMin,
          y2: waferMax,
          fill: Plot.identity,
        }),
        ...(showContours && contourLevels > 0
          ? [
              Plot.contour(grid.flat(), {
                width: gridSize,
                height: gridSize,
                x1: waferMin,
                x2: waferMax,
                y1: waferMin,
                y2: waferMax,
                fill: "none",
                stroke: "black",
                strokeWidth: 0.5,
                thresholds: thresholds,
              }),
            ]
          : []),
        ...(showDots
          ? [
              Plot.dot(
                points.map((p) => ({ x: p.x, y: p.y })),
                { x: "x", y: "y", r: 4, fill: "red", stroke: "white" },
              ),
            ]
          : []),
      ],
    });

    const svg = plot as unknown as SVGSVGElement;
    const ns = "http://www.w3.org/2000/svg";
    const defs = svg.querySelector("defs") ?? document.createElementNS(ns, "defs");
    if (!defs.parentNode) {
      svg.insertBefore(defs, svg.firstChild);
    }

    const innerLeft = 48;
    const innerRight = size - 16;
    const innerTop = 16;
    const innerBottom = size - 40;
    const scaleX = (value: number) =>
      innerLeft + ((value - plotMin) / (plotMax - plotMin)) * (innerRight - innerLeft);
    const scaleY = (value: number) =>
      innerBottom - ((value - plotMin) / (plotMax - plotMin)) * (innerBottom - innerTop);

    const clipId = `wafer-clip-${Math.random().toString(36).slice(2)}`;
    const clipPath = document.createElementNS(ns, "clipPath");
    clipPath.setAttribute("id", clipId);
    clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");

    const clipShape = document.createElementNS(ns, "path");
    clipShape.setAttribute(
      "d",
      getWaferSvgPath(
        scaleX(0),
        scaleY(0),
        Math.abs(scaleX(waferMax) - scaleX(0)) / waferMax,
        Math.abs(scaleY(waferMax) - scaleY(0)) / waferMax,
        diameter,
      ),
    );
    clipPath.appendChild(clipShape);
    defs.appendChild(clipPath);

    svg
      .querySelectorAll("g[aria-label='raster'], g[aria-label='contour']")
      .forEach((node) => node.setAttribute("clip-path", `url(#${clipId})`));

    const waferOutline = document.createElementNS(ns, "path");
    waferOutline.setAttribute(
      "d",
      getWaferSvgPath(
        scaleX(0),
        scaleY(0),
        Math.abs(scaleX(waferMax) - scaleX(0)) / waferMax,
        Math.abs(scaleY(waferMax) - scaleY(0)) / waferMax,
        diameter,
      ),
    );
    waferOutline.setAttribute("fill", "none");
    waferOutline.setAttribute("stroke", "#111827");
    waferOutline.setAttribute("stroke-width", "1");
    svg.appendChild(waferOutline);

    const wrapper = document.createElement("div");
    wrapper.className = "flex items-start gap-4";

    const legend = document.createElement("div");
    legend.className = "flex items-start gap-2 pt-6";

    const bar = document.createElement("div");
    bar.className = "h-64 w-4 rounded";
    bar.style.background = paletteConfig.gradient;

    const tickContainer = document.createElement("div");
    tickContainer.className = "flex h-64 flex-col justify-between text-xs text-black";

    const ticks = 5;
    for (let i = 0; i < ticks; i++) {
      const ratio = 1 - i / (ticks - 1);
      const value = minVal + (maxVal - minVal) * ratio;
      const tick = document.createElement("div");
      tick.textContent = value.toFixed(3);
      tickContainer.appendChild(tick);
    }

    const legendLabel = document.createElement("div");
    legendLabel.className = "mr-1 text-sm font-medium text-black [writing-mode:vertical-rl]";
    legendLabel.textContent = valueKey;

    legend.appendChild(legendLabel);
    legend.appendChild(bar);
    legend.appendChild(tickContainer);

    wrapper.appendChild(plot);
    wrapper.appendChild(legend);
    containerRef.current.appendChild(wrapper);
  }, [
    krigingResult,
    points,
    size,
    diameter,
    valueKey,
    contourLevels,
    showDots,
    showContours,
    colorPalette,
  ]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ width: frameWidth, height: frameHeight }}
      >
        <div className="p-4 text-red-500">{error}</div>
      </div>
    );
  }
  if (!wasmReady) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ width: frameWidth, height: frameHeight }}
      >
        <div className="p-4 text-black">Loading Kriging WASM...</div>
      </div>
    );
  }
  if (points.length < 3) {
    return (
      <div
        className="flex items-center justify-center text-gray-500"
        style={{ width: frameWidth, height: frameHeight }}
      >
        <p>At least 3 measurement points are required to draw contours.</p>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: frameWidth, minHeight: frameHeight }} />;
}
