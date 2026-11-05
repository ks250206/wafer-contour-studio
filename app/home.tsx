import { Link } from "@tanstack/react-router";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
      <div className="w-full max-w-4xl rounded-[32px] border border-zinc-300 bg-zinc-50 p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
          Wafer Analysis
        </p>
        <h1 className="mt-4 max-w-2xl text-5xl font-semibold tracking-tight text-zinc-950">
          Wafer Visualization Studio
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600">
          Explore contour maps from wafer measurement points or build mask-layout-based wafer
          property maps from JSON and direct editing.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            to="/contour-map"
            className="inline-flex min-w-44 justify-center rounded-full border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            Contour Map
          </Link>
          <p className="text-sm text-zinc-500">
            Edit measurement points, tune kriging controls, and export contour visuals.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Link
            to="/mask-map"
            className="inline-flex min-w-44 justify-center rounded-full border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            Mask Map
          </Link>
          <p className="text-sm text-zinc-500">
            Upload mask layout JSON, edit openings directly, and visualize arbitrary properties.
          </p>
        </div>
      </div>
    </main>
  );
}
