"use client";
import dynamic from "next/dynamic";
import Link from "next/link";

const WaferVisualizer = dynamic(
  () => import("../../components/waferVisualizer").then((m) => m.WaferVisualizer),
  { ssr: false },
);

export default function WorkspacePage() {
  return (
    <div className="min-h-screen bg-zinc-100 p-4">
      <div className="mx-auto max-w-[1560px] space-y-4">
        <div className="rounded-2xl border border-zinc-300 bg-zinc-50 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Workspace
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
                Wafer Contour Studio
              </h1>
              <p className="mt-2 text-sm text-zinc-600">
                4-inch wafer contour mapping with editable point data and kriging controls.
              </p>
            </div>
            <Link
              href="/"
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              Back to Home
            </Link>
          </div>
        </div>
        <WaferVisualizer size={400} diameter={100} />
      </div>
    </div>
  );
}
