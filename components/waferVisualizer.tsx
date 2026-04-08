"use client";
import { useEffect, useRef, useState } from "react";
import { PointTable } from "./pointTable";
import { Wafer } from "./wafer";
import { PointProps, Points } from "./point";
import { WAFER_MAP_PADDING } from "./waferGeometry";
import { buildKrigingPrediction, loadKrigingModule } from "./krigingPrediction";
import dynamic from "next/dynamic";
import { contourColorPalettes, type ContourColorPalette } from "./contourPlot";

const ContourPlot = dynamic(() => import("./contourPlot"), { ssr: false });

export interface WaferVisualizerProps {
  size: number;
  diameter: number;
}

const variogramTypes = [
  "spherical",
  "exponential",
  "gaussian",
  "cubic",
  "stable",
  "matern",
] as const;

const controlTabs = ["model", "values", "view", "data"] as const;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const NOMINAL_WAFER_RADIUS_MM = 50;
const MIN_POINT_DISTANCE_MM = 0.5;
const clampCoordinate = (value: number) =>
  Math.max(-NOMINAL_WAFER_RADIUS_MM, Math.min(NOMINAL_WAFER_RADIUS_MM, value));
const isInsideNominalWafer = (x: number, y: number) => Math.hypot(x, y) <= NOMINAL_WAFER_RADIUS_MM;
const hasNearbyPoint = (points: PointProps[], x: number, y: number, excludeIndex?: number) =>
  points.some((point, index) => {
    if (excludeIndex != null && index === excludeIndex) return false;
    return Math.hypot(point.x - x, point.y - y) < MIN_POINT_DISTANCE_MM;
  });

export const WaferVisualizer = ({ size, diameter }: WaferVisualizerProps) => {
  const [points, setPoints] = useState<Points>({ points: [] });
  const [selectedValueKey, setSelectedValueKey] = useState<string>("z");
  const [contourLevels, setContourLevels] = useState<number>(20);
  const [contourLevelsDraft, setContourLevelsDraft] = useState<number>(20);
  const [newValueKey, setNewValueKey] = useState("");
  const [renameValueKey, setRenameValueKey] = useState("");
  const [showDots, setShowDots] = useState(true);
  const [showContours, setShowContours] = useState(true);
  const [variogramType, setVariogramType] = useState<(typeof variogramTypes)[number]>("spherical");
  const [colorPalette, setColorPalette] = useState<ContourColorPalette>("turbo");
  const [activeControlTab, setActiveControlTab] = useState<(typeof controlTabs)[number]>("model");
  const waferTileRef = useRef<HTMLDivElement>(null);
  const contourTileRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const valueKeys = Array.from(
    points.points.reduce(
      (acc, point) => {
        point.value.forEach((_, key) => acc.add(key));
        return acc;
      },
      new Set<string>(["z"]),
    ),
  );

  const waferPadding = WAFER_MAP_PADDING;
  const displayDiameter = size - waferPadding * 2;
  const pxPerUnit = displayDiameter / diameter;

  useEffect(() => {
    setContourLevelsDraft(contourLevels);
  }, [contourLevels]);

  const handleWaferClick = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;

    if (xPx < 0 || xPx > size || yPx < 0 || yPx > size) return;

    const xFromCenter = clampCoordinate((xPx - size / 2) / pxPerUnit);
    const yFromCenter = clampCoordinate((size / 2 - yPx) / pxPerUnit);
    if (!isInsideNominalWafer(xFromCenter, yFromCenter)) return;
    if (hasNearbyPoint(points.points, xFromCenter, yFromCenter)) return;

    const val = new Map<string, number>(
      valueKeys.map((key) => [key, key === "z" ? round3(Math.random()) : 0]),
    );
    const nextNo = points.points.reduce((max, point) => Math.max(max, point.no), 0) + 1;
    setPoints({
      points: [...points.points, { no: nextNo, x: xFromCenter, y: yFromCenter, value: val }],
    });
  };

  const handlePointValueChange = (pointIndex: number, newValue: number) => {
    const newPoints = [...points.points];
    const point = newPoints[pointIndex];
    newPoints[pointIndex] = {
      ...point,
      value: new Map(point.value).set(selectedValueKey, round3(newValue)),
    };
    setPoints({ points: newPoints });
  };

  const handlePointPositionChange = (pointIndex: number, axis: "x" | "y", newValue: number) => {
    const newPoints = [...points.points];
    const point = newPoints[pointIndex];
    const nextPoint = {
      ...point,
      [axis]: round3(clampCoordinate(newValue)),
    };

    if (!isInsideNominalWafer(nextPoint.x, nextPoint.y)) return;
    if (hasNearbyPoint(newPoints, nextPoint.x, nextPoint.y, pointIndex)) return;

    newPoints[pointIndex] = nextPoint;
    setPoints({ points: newPoints });
  };

  const handleSelectedValueKeyChange = (key: string) => {
    setSelectedValueKey(key);
  };

  const handlePointDelete = (pointIndex: number) => {
    setPoints({
      points: points.points.filter((_, index) => index !== pointIndex),
    });
  };

  const handleDeleteAllPoints = () => {
    setPoints({ points: [] });
  };

  const handleAddValueColumn = () => {
    const key = newValueKey.trim();
    if (!key) return;

    const existingKeys = new Set(points.points.flatMap((point) => Array.from(point.value.keys())));
    if (existingKeys.has(key)) {
      setSelectedValueKey(key);
      setNewValueKey("");
      return;
    }

    setPoints({
      points: points.points.map((point) => ({
        ...point,
        value: new Map(point.value).set(key, 0),
      })),
    });
    setSelectedValueKey(key);
    setNewValueKey("");
  };

  const handleRenameValueColumn = () => {
    const nextKey = renameValueKey.trim();
    const currentKey = selectedValueKey;
    if (!nextKey || nextKey === currentKey) return;
    if (valueKeys.includes(nextKey)) {
      setSelectedValueKey(nextKey);
      setRenameValueKey("");
      return;
    }

    setPoints({
      points: points.points.map((point) => {
        const nextValue = new Map(point.value);
        const currentValue = nextValue.get(currentKey) ?? 0;
        nextValue.delete(currentKey);
        nextValue.set(nextKey, round3(currentValue));
        return { ...point, value: nextValue };
      }),
    });
    setSelectedValueKey(nextKey);
    setRenameValueKey("");
  };

  const downloadTextFile = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const payload = {
      version: 1,
      diameter,
      selectedValueKey,
      contourLevels,
      showDots,
      showContours,
      variogramType,
      colorPalette,
      points: points.points.map((point) => ({
        no: point.no,
        x: point.x,
        y: point.y,
        value: Object.fromEntries(point.value.entries()),
      })),
    };
    downloadTextFile("wafer-visualize.json", JSON.stringify(payload, null, 2), "application/json");
  };

  const handleExportKrigingJson = async () => {
    const gridSize = Math.max(260, Math.min(480, Math.round(plotSize * 0.75)));
    let krigingPrediction: null | {
      valueKey: string;
      gridSize: number;
      min: number;
      max: number;
      variogram: {
        variogramType: string;
        nugget: number;
        sill: number;
        range: number;
        shape: number;
      };
      grid: Array<Array<number | null>>;
    } = null;

    if (points.points.length >= 3) {
      try {
        const krigingModule = await loadKrigingModule();
        const prediction = buildKrigingPrediction({
          krigingModule,
          points: points.points,
          diameter,
          gridSize,
          valueKey: selectedValueKey,
          variogramType,
        });

        if (prediction) {
          krigingPrediction = {
            valueKey: selectedValueKey,
            gridSize: prediction.gridSize,
            min: prediction.minVal,
            max: prediction.maxVal,
            variogram: prediction.variogram,
            grid: prediction.grid.map((row) =>
              row.map((value) => (Number.isFinite(value) ? value : null)),
            ),
          };
        }
      } catch (error) {
        console.error("Failed to export kriging prediction", error);
      }
    }

    const payload = {
      version: 1,
      diameter,
      selectedValueKey,
      variogramType,
      contourLevels,
      colorPalette,
      prediction: krigingPrediction,
    };
    downloadTextFile(
      "wafer-visualize-kriging.json",
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  };

  const normalizeImportedPoint = (point: Partial<PointProps>, index: number): PointProps => ({
    no: typeof point.no === "number" ? point.no : index + 1,
    x: typeof point.x === "number" ? point.x : 0,
    y: typeof point.y === "number" ? point.y : 0,
    value: new Map(
      Object.entries((point.value as Record<string, number> | undefined) ?? { z: 0 }).map(
        ([key, value]) => [key, typeof value === "number" ? value : 0],
      ),
    ),
  });

  const handleImportJsonClick = () => {
    importInputRef.current?.click();
  };

  const handleImportJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        diameter?: number;
        selectedValueKey?: string;
        contourLevels?: number;
        showDots?: boolean;
        showContours?: boolean;
        variogramType?: (typeof variogramTypes)[number];
        colorPalette?: ContourColorPalette;
        points?: Partial<PointProps>[];
      };

      const importedPoints = Array.isArray(parsed.points)
        ? parsed.points.map(normalizeImportedPoint)
        : [];

      setPoints({ points: importedPoints });
      if (typeof parsed.selectedValueKey === "string") {
        setSelectedValueKey(parsed.selectedValueKey);
      }
      if (typeof parsed.contourLevels === "number") {
        setContourLevels(parsed.contourLevels);
      }
      if (typeof parsed.showDots === "boolean") {
        setShowDots(parsed.showDots);
      }
      if (typeof parsed.showContours === "boolean") {
        setShowContours(parsed.showContours);
      }
      if (parsed.variogramType && variogramTypes.includes(parsed.variogramType)) {
        setVariogramType(parsed.variogramType);
      }
      if (parsed.colorPalette && parsed.colorPalette in contourColorPalettes) {
        setColorPalette(parsed.colorPalette);
      }
    } catch (error) {
      console.error("Failed to import JSON", error);
    } finally {
      event.target.value = "";
    }
  };

  const handleExportSvg = (target: "wafer" | "contour") => {
    const root = target === "wafer" ? waferTileRef.current : contourTileRef.current;
    const svg = root?.querySelector("svg");
    if (!svg) return;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const serialized = new XMLSerializer().serializeToString(clone);
    downloadTextFile(
      target === "wafer" ? "wafer-map.svg" : "contour-plot.svg",
      serialized,
      "image/svg+xml",
    );
  };
  const plotSize = Math.min(620, Math.max(size + 40, Math.round(size * 1.1)));

  return (
    <div className="grid h-full w-full gap-4 xl:grid-cols-2 xl:grid-rows-[minmax(420px,1fr)_minmax(320px,auto)]">
      <div
        ref={waferTileRef}
        className="min-h-[420px] min-w-0 overflow-hidden rounded-2xl border border-zinc-300 bg-zinc-50 p-4"
      >
        <Wafer
          size={size}
          diameter={diameter}
          points={points.points}
          onWaferClick={handleWaferClick}
        />
      </div>
      <div
        ref={contourTileRef}
        className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-300 bg-zinc-50 p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
            Contour Plot
          </h2>
          <span className="text-sm text-zinc-600">{selectedValueKey}</span>
        </div>
        <div className="mb-4 flex items-center gap-4">
          <label className="font-medium text-black">Contour Levels:</label>
          <input
            type="range"
            min="0"
            max="100"
            value={contourLevelsDraft}
            onChange={(e) => setContourLevelsDraft(parseInt(e.target.value))}
            onBlur={() => setContourLevels(contourLevelsDraft)}
            onMouseUp={(e) => setContourLevels(parseInt(e.currentTarget.value))}
            onTouchEnd={(e) => setContourLevels(parseInt(e.currentTarget.value))}
            onKeyUp={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="h-2 w-40 cursor-pointer appearance-none rounded-full bg-zinc-200 accent-zinc-800"
          />
          <span className="text-black w-8">{contourLevelsDraft}</span>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto">
          <ContourPlot
            points={points.points}
            size={plotSize}
            diameter={diameter}
            valueKey={selectedValueKey}
            contourLevels={contourLevels}
            showDots={showDots}
            showContours={showContours}
            variogramType={variogramType}
            colorPalette={colorPalette}
          />
        </div>
      </div>
      <div className="min-h-[320px] min-w-0 rounded-2xl border border-zinc-300 bg-zinc-50 p-4">
        <PointTable
          points={points.points}
          selectedValueKey={selectedValueKey}
          onPointPositionChange={handlePointPositionChange}
          onPointValueChange={handlePointValueChange}
          onPointDelete={handlePointDelete}
        />
      </div>
      <div className="min-h-[320px] min-w-0 rounded-2xl border border-zinc-300 bg-zinc-50 p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
            Controls
          </h2>
        </div>
        <div className="mb-4 grid grid-cols-4 rounded-xl border border-zinc-300 bg-white p-1">
          {controlTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveControlTab(tab)}
              className={`rounded-lg px-3 py-2 text-sm capitalize transition-[background-color,color,box-shadow] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
                activeControlTab === tab
                  ? "bg-zinc-900 text-white shadow-sm hover:bg-zinc-700"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="space-y-4">
          {activeControlTab === "model" ? (
            <>
              <div>
                <label className="mb-2 block font-medium text-black">Value</label>
                <select
                  value={selectedValueKey}
                  onChange={(e) => handleSelectedValueKeyChange(e.target.value)}
                  className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                >
                  {valueKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block font-medium text-black">Kriging Model</label>
                <select
                  value={variogramType}
                  onChange={(e) =>
                    setVariogramType(e.target.value as (typeof variogramTypes)[number])
                  }
                  className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                >
                  {variogramTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block font-medium text-black">Color Palette</label>
                <select
                  value={colorPalette}
                  onChange={(e) => setColorPalette(e.target.value as ContourColorPalette)}
                  className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                >
                  {Object.entries(contourColorPalettes).map(([key, palette]) => (
                    <option key={key} value={key}>
                      {palette.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
                <p>Points: {points.points.length}</p>
                <p>Diameter: {diameter}</p>
                <p>Selected key: {selectedValueKey}</p>
                <p>Contour levels: {contourLevels}</p>
                <p>Variogram: {variogramType}</p>
                <p>Palette: {contourColorPalettes[colorPalette].label}</p>
              </div>
            </>
          ) : null}
          {activeControlTab === "values" ? (
            <>
              <div>
                <label className="mb-2 block font-medium text-black">Add Value Column</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newValueKey}
                    onChange={(e) => setNewValueKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddValueColumn();
                      }
                    }}
                    placeholder="e.g. thickness"
                    className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                  <button
                    type="button"
                    onClick={handleAddValueColumn}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-2 block font-medium text-black">Rename Selected Value</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={renameValueKey}
                    onChange={(e) => setRenameValueKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleRenameValueColumn();
                      }
                    }}
                    placeholder={`rename ${selectedValueKey}`}
                    className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-black"
                  />
                  <button
                    type="button"
                    onClick={handleRenameValueColumn}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    Rename
                  </button>
                </div>
              </div>
            </>
          ) : null}
          {activeControlTab === "view" ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="mb-3 text-sm font-medium text-black">Display Toggles</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDots((value) => !value)}
                    className="rounded border border-zinc-300 px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    Dot: {showDots ? "On" : "Off"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowContours((value) => !value)}
                    className="rounded border border-zinc-300 px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    Contour: {showContours ? "On" : "Off"}
                  </button>
                </div>
              </div>
            </>
          ) : null}
          {activeControlTab === "data" ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="mb-3 text-sm font-medium text-black">JSON</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleExportJson}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    onClick={handleImportJsonClick}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    Import JSON
                  </button>
                  <button
                    type="button"
                    onClick={handleExportKrigingJson}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    Export Kriging JSON
                  </button>
                </div>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportJson}
                  className="hidden"
                />
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="mb-3 text-sm font-medium text-black">Image Export</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleExportSvg("wafer")}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    Export Wafer SVG
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportSvg("contour")}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                  >
                    Export Contour SVG
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="mb-3 text-sm font-medium text-black">Point Actions</p>
                <button
                  type="button"
                  onClick={handleDeleteAllPoints}
                  className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                >
                  Delete All Points
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
