"use client";

import { useEffect, useMemo, useState } from "react";
import { PointProps } from "./point";

interface PointTableProps {
  points: PointProps[];
  selectedValueKey: string;
  onPointPositionChange: (pointIndex: number, axis: "x" | "y", value: number) => void;
  onPointValueChange: (pointIndex: number, value: number) => void;
  onPointDelete: (pointIndex: number) => void;
}

export const PointTable = ({
  points,
  selectedValueKey,
  onPointPositionChange,
  onPointValueChange,
  onPointDelete,
}: PointTableProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpPage, setJumpPage] = useState("1");
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const format3 = (value: number) => value.toFixed(3);

  const valueKeys = useMemo(
    () =>
      Array.from(
        points.reduce((acc, point) => {
          point.value.forEach((_, key) => acc.add(key));
          return acc;
        }, new Set<string>()),
      ),
    [points],
  );

  const totalPages = Math.max(1, Math.ceil(points.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedPoints = useMemo(() => {
    const start = (safePage - 1) * rowsPerPage;
    return points.slice(start, start + rowsPerPage).map((point, index) => ({
      ...point,
      originalIndex: start + index,
    }));
  }, [points, rowsPerPage, safePage]);

  useEffect(() => {
    if (currentPage !== safePage) {
      setCurrentPage(safePage);
    }
  }, [currentPage, safePage]);

  useEffect(() => {
    setJumpPage(String(safePage));
  }, [safePage]);

  useEffect(() => {
    setDraftValues({});
  }, [points, selectedValueKey]);

  const handleDraftChange = (key: string, value: string) => {
    setDraftValues((current) => ({ ...current, [key]: value }));
  };

  const clearDraft = (key: string) => {
    setDraftValues((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const commitPositionChange = (draftKey: string, pointIndex: number, axis: "x" | "y") => {
    const nextValue = draftValues[draftKey];
    clearDraft(draftKey);
    if (nextValue == null) return;

    const parsed = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsed)) return;
    onPointPositionChange(pointIndex, axis, parsed);
  };

  const commitValueChange = (draftKey: string, pointIndex: number) => {
    const nextValue = draftValues[draftKey];
    clearDraft(draftKey);
    if (nextValue == null) return;

    const parsed = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsed)) return;
    onPointValueChange(pointIndex, parsed);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
          Point Table
        </h2>
        <span className="text-sm text-zinc-600">{points.length} points</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white">
        <table className="min-w-full border-collapse text-sm text-black">
          <thead className="sticky top-0 bg-zinc-100">
            <tr>
              <th className="border-b border-zinc-200 px-2 py-2 text-left">No.</th>
              <th className="border-b border-zinc-200 px-2 py-2 text-left">x</th>
              <th className="border-b border-zinc-200 px-2 py-2 text-left">y</th>
              {valueKeys.map((key) => (
                <th key={key} className="border-b border-zinc-200 px-2 py-2 text-left">
                  {key}
                </th>
              ))}
              <th className="border-b border-zinc-200 px-2 py-2 text-left">Delete</th>
            </tr>
          </thead>
          <tbody>
            {paginatedPoints.map((point) => (
              <tr key={point.originalIndex} className="hover:bg-zinc-50">
                <td className="border-b border-zinc-100 px-2 py-1 font-medium">{point.no}</td>
                <td className="border-b border-zinc-100 px-2 py-1">
                  {(() => {
                    const draftKey = `${point.originalIndex}-x`;
                    return (
                      <input
                        type="number"
                        step="0.001"
                        value={draftValues[draftKey] ?? format3(point.x)}
                        onChange={(e) => handleDraftChange(draftKey, e.target.value)}
                        onBlur={() => commitPositionChange(draftKey, point.originalIndex, "x")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-32 rounded bg-transparent px-1 py-1 text-black outline-none focus:bg-zinc-100 focus:shadow-[0_0_0_1px_rgba(115,115,115,0.45)]"
                      />
                    );
                  })()}
                </td>
                <td className="border-b border-zinc-100 px-2 py-1">
                  {(() => {
                    const draftKey = `${point.originalIndex}-y`;
                    return (
                      <input
                        type="number"
                        step="0.001"
                        value={draftValues[draftKey] ?? format3(point.y)}
                        onChange={(e) => handleDraftChange(draftKey, e.target.value)}
                        onBlur={() => commitPositionChange(draftKey, point.originalIndex, "y")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-32 rounded bg-transparent px-1 py-1 text-black outline-none focus:bg-zinc-100 focus:shadow-[0_0_0_1px_rgba(115,115,115,0.45)]"
                      />
                    );
                  })()}
                </td>
                {valueKeys.map((key) => (
                  <td key={key} className="border-b border-zinc-100 px-2 py-1">
                    {key === selectedValueKey ? (
                      (() => {
                        const draftKey = `${point.originalIndex}-${key}`;
                        return (
                          <input
                            type="number"
                            step="0.001"
                            value={
                              draftValues[draftKey] ??
                              (point.value.get(key) == null
                                ? ""
                                : format3(point.value.get(key) ?? 0))
                            }
                            onChange={(e) => handleDraftChange(draftKey, e.target.value)}
                            onBlur={() => commitValueChange(draftKey, point.originalIndex)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.currentTarget.blur();
                              }
                            }}
                            className="w-32 rounded bg-transparent px-1 py-1 text-black outline-none focus:bg-zinc-100 focus:shadow-[0_0_0_1px_rgba(115,115,115,0.45)]"
                          />
                        );
                      })()
                    ) : (
                      <div className="w-32 px-1 py-1">
                        {point.value.get(key)?.toFixed(3) ?? "-"}
                      </div>
                    )}
                  </td>
                ))}
                <td className="border-b border-zinc-100 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => onPointDelete(point.originalIndex)}
                    className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-700"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-zinc-700">
        <span>
          {points.length === 0
            ? "0 / 0"
            : `${(safePage - 1) * rowsPerPage + 1}-${Math.min(safePage * rowsPerPage, points.length)} / ${points.length}`}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <span>Rows</span>
            <select
              value={String(rowsPerPage)}
              onChange={(e) => {
                setRowsPerPage(Number.parseInt(e.target.value, 10) || 20);
                setCurrentPage(1);
              }}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-black"
            >
              {[10, 20, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={safePage === 1}
            className="rounded border border-zinc-300 bg-white px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={safePage === totalPages}
            className="rounded border border-zinc-300 bg-white px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
          <input
            type="number"
            min="1"
            max={totalPages}
            value={jumpPage}
            onChange={(e) => setJumpPage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const page = Math.min(totalPages, Math.max(1, Number.parseInt(jumpPage, 10) || 1));
                setCurrentPage(page);
              }
            }}
            className="w-14 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-black outline-none focus:ring-2 focus:ring-zinc-300"
          />
          <button
            type="button"
            onClick={() => {
              const page = Math.min(totalPages, Math.max(1, Number.parseInt(jumpPage, 10) || 1));
              setCurrentPage(page);
            }}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-black transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
};
