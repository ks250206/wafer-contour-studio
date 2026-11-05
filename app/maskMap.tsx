import { Link } from "@tanstack/react-router";
import { MaskMapEditor } from "../components/maskMapEditor";

export default function MaskMapPage() {
  return (
    <div className="min-h-screen bg-zinc-100 p-4">
      <div className="mx-auto max-w-[1680px] space-y-4">
        <div className="rounded-2xl border border-zinc-300 bg-zinc-50 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Mask Map
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
                Wafer Mask Map Studio
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                Build wafer hole layouts from schema JSON or direct editing, then visualize
                arbitrary numeric properties, composition ratios, and phases on the wafer.
              </p>
            </div>
            <Link
              to="/"
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              Back to Home
            </Link>
          </div>
        </div>
        <MaskMapEditor size={420} />
      </div>
    </div>
  );
}
