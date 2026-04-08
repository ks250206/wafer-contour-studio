"use client";

import { useState } from "react";
import { PointProps } from "./point";
import { getWaferSvgPath, WAFER_MAP_PADDING } from "./waferGeometry";

export interface WaferProps {
  size: number;
  diameter: number;
  points: PointProps[];
  onWaferClick: (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => void;
  className?: string;
}

export const Wafer = ({ size, diameter, points, onWaferClick, className }: WaferProps) => {
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const padding = WAFER_MAP_PADDING;
  const displayDiameter = size - padding * 2;
  const pxPerUnit = displayDiameter / diameter;
  const waferPath = getWaferSvgPath(size / 2, size / 2, pxPerUnit, pxPerUnit, diameter);
  const radius = diameter / 2;
  const gridLines = Array.from({ length: Math.floor(diameter / 10) + 1 }, (_, index) => {
    const value = -radius + index * 10;
    return value <= radius ? value : null;
  }).filter((value): value is number => value !== null);
  const pointsFiltered = points.map((point) => {
    const x = size / 2 + point.x * pxPerUnit;
    const y = size / 2 - point.y * pxPerUnit;
    return { x, y, no: point.no };
  });
  const rulerLabels = gridLines.filter((value) => value > -radius && value < radius);
  const handlePointerMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    const x = (xPx - size / 2) / pxPerUnit;
    const y = (size / 2 - yPx) / pxPerUnit;
    setCursorPosition({ x, y });
  };

  return (
    <div className={`flex h-full flex-col ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
          Wafer Map
        </h2>
        <span className="text-sm text-zinc-600">Click to add points</span>
      </div>
      <div className="flex flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-white">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          onClick={onWaferClick}
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setCursorPosition(null)}
          className="cursor-crosshair"
        >
          <rect x={0} y={0} width={size} height={size} fill="#fbfdff" />
          <path d={waferPath} fill="#FEFEFE" stroke="black" strokeWidth="1" />
          <defs>
            <clipPath id="wafer-map-clip" clipPathUnits="userSpaceOnUse">
              <path d={waferPath} />
            </clipPath>
          </defs>
          {gridLines.map((value) => {
            const x = size / 2 + value * pxPerUnit;
            return (
              <line
                key={`grid-x-${value}`}
                x1={x}
                y1={0}
                x2={x}
                y2={size}
                stroke={value === 0 ? "#9ca3af" : "#d4d4d8"}
                strokeWidth={value === 0 ? "1.2" : "0.8"}
              />
            );
          })}
          {gridLines.map((value) => {
            const y = size / 2 - value * pxPerUnit;
            return (
              <line
                key={`grid-y-${value}`}
                x1={0}
                y1={y}
                x2={size}
                y2={y}
                stroke={value === 0 ? "#9ca3af" : "#d4d4d8"}
                strokeWidth={value === 0 ? "1.2" : "0.8"}
              />
            );
          })}
          <path d={waferPath} fill="none" stroke="black" strokeWidth="1" />
          <g>
            {rulerLabels.map((value) => {
              const x = size / 2 + value * pxPerUnit;
              return (
                <g key={`ruler-x-${value}`}>
                  <line
                    x1={x}
                    y1={size - 18}
                    x2={x}
                    y2={size - 12}
                    stroke="#71717a"
                    strokeWidth="0.8"
                  />
                  <text x={x} y={size - 2} fontSize="9" fill="#71717a" textAnchor="middle">
                    {value}
                  </text>
                </g>
              );
            })}
            {rulerLabels.map((value) => {
              const y = size / 2 - value * pxPerUnit;
              return (
                <g key={`ruler-y-${value}`}>
                  <line x1={12} y1={y} x2={18} y2={y} stroke="#71717a" strokeWidth="0.8" />
                  <text x={14} y={y + 3} fontSize="9" fill="#71717a" textAnchor="end">
                    {value}
                  </text>
                </g>
              );
            })}
          </g>
          <text x={22} y={22} fontSize="11" fill="#18181b">
            ↑ y (mm)
          </text>
          <text x={size - 14} y={size - 22} fontSize="11" fill="#18181b" textAnchor="end">
            x (mm) →
          </text>
          {pointsFiltered.map((point) => (
            <g key={point.no}>
              <circle cx={point.x} cy={point.y} r="2.5" fill="#dc2626" />
              <text x={point.x + 6} y={point.y - 6} fontSize="10" fill="#dc2626" textAnchor="start">
                {point.no}
              </text>
            </g>
          ))}
          {cursorPosition ? (
            <g>
              <rect
                x={size - 126}
                y={10}
                width={116}
                height={32}
                rx={8}
                fill="rgba(255,255,255,0.92)"
                stroke="#d4d4d8"
              />
              <text x={size - 118} y={30} fontSize="11" fill="#3f3f46">
                {`x: ${cursorPosition.x.toFixed(1)}, y: ${cursorPosition.y.toFixed(1)}`}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
};
