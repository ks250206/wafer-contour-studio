"use client";

import { PointProps } from "./point";
import { isInsideWafer } from "./waferGeometry";

export type VariogramType =
  | "spherical"
  | "exponential"
  | "gaussian"
  | "cubic"
  | "stable"
  | "matern";

export interface KrigingPredictionResult {
  grid: number[][];
  minVal: number;
  maxVal: number;
  gridSize: number;
  variogram: {
    variogramType: string;
    nugget: number;
    sill: number;
    range: number;
    shape: number;
  };
}

let krigingModulePromise: Promise<any> | null = null;

export const loadKrigingModule = async () => {
  if (!krigingModulePromise) {
    krigingModulePromise = (async () => {
      const mod = await import("kriging-rs-wasm");
      const wasmBytes = await fetch("/wasm/kriging_rs_bg.wasm").then((r) => {
        if (!r.ok) throw new Error("Failed to load wasm");
        return r.arrayBuffer();
      });
      await mod.default(wasmBytes);
      return mod;
    })();
  }

  return krigingModulePromise;
};

export const buildKrigingPrediction = ({
  krigingModule,
  points,
  diameter,
  gridSize,
  valueKey,
  variogramType,
}: {
  krigingModule: any;
  points: PointProps[];
  diameter: number;
  gridSize: number;
  valueKey: string;
  variogramType: VariogramType;
}): KrigingPredictionResult | null => {
  if (!krigingModule || points.length < 3) return null;

  const maxExtent = diameter / 2;
  const normalizeCoord = (v: number) => v / maxExtent;

  const xs = points.map((p) => normalizeCoord(p.x));
  const ys = points.map((p) => normalizeCoord(p.y));
  const values = points.map((p) => p.value.get(valueKey) ?? 0);

  if (values.some((v) => !Number.isFinite(v))) return null;

  const fitted = krigingModule.fitVariogram({
    sampleLats: ys,
    sampleLons: xs,
    values,
    variogramType,
    nBins: 12,
  });

  const kriging = new krigingModule.OrdinaryKriging({
    lats: ys,
    lons: xs,
    values,
    variogram: {
      variogramType: fitted.variogramType,
      nugget: fitted.nugget,
      sill: fitted.sill,
      range: fitted.range,
      shape: fitted.shape,
    },
  });

  const gridLats: number[] = [];
  const gridLons: number[] = [];
  const insideMask: boolean[] = [];

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x = (j / (gridSize - 1)) * 2 - 1;
      const y = (i / (gridSize - 1)) * 2 - 1;

      const waferX = x * maxExtent;
      const waferY = y * maxExtent;
      if (isInsideWafer(waferX, waferY, diameter)) {
        gridLats.push(waferY / maxExtent);
        gridLons.push(waferX / maxExtent);
        insideMask.push(true);
      } else {
        gridLats.push(0);
        gridLons.push(0);
        insideMask.push(false);
      }
    }
  }

  const { values: predictions } = kriging.predictBatchArrays(gridLats, gridLons);

  const grid: number[][] = [];
  let minVal = Number.POSITIVE_INFINITY;
  let maxVal = Number.NEGATIVE_INFINITY;
  let idx = 0;

  for (let i = 0; i < gridSize; i++) {
    const row: number[] = [];
    for (let j = 0; j < gridSize; j++) {
      if (insideMask[idx]) {
        const value = predictions[idx];
        row.push(value);
        if (Number.isFinite(value)) {
          minVal = Math.min(minVal, value);
          maxVal = Math.max(maxVal, value);
        }
      } else {
        row.push(Number.NaN);
      }
      idx++;
    }
    grid.push(row);
  }

  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return null;

  return {
    grid,
    minVal,
    maxVal,
    gridSize,
    variogram: {
      variogramType: fitted.variogramType,
      nugget: fitted.nugget,
      sill: fitted.sill,
      range: fitted.range,
      shape: fitted.shape,
    },
  };
};
