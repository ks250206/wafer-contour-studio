import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
      <div className="w-full max-w-4xl rounded-[32px] border border-zinc-300 bg-zinc-50 p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
          Wafer Analysis
        </p>
        <h1 className="mt-4 max-w-2xl text-5xl font-semibold tracking-tight text-zinc-950">
          Wafer Contour Studio
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600">
          Build 4-inch wafer maps, edit measurement points, and explore kriging-based contour
          predictions from a single workspace.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/workspace"
            className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            Open Workspace
          </Link>
          <p className="text-sm text-zinc-500">
            Open the workspace for contour editing, kriging controls, and exports.
          </p>
        </div>
      </div>
    </main>
  );
}
