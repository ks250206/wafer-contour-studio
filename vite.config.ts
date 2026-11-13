import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  base: process.env.VITE_GITHUB_PAGES === "true" ? "/wafer-contour-studio/" : "/",
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // The WASM loader resolves its binary relative to its original module URL in dev.
    exclude: ["kriging-rs-wasm"],
  },
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    plugins: ["react", "jsx-a11y", "typescript", "unicorn", "oxc"],
    rules: { "react/exhaustive-deps": "warn" },
    options: { typeAware: true, typeCheck: true },
  },
});
