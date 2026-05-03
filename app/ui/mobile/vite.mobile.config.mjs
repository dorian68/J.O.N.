import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.join(__dirname, "..");

export default defineConfig({
  root: uiRoot,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    outDir: __dirname,
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: path.join(__dirname, "app.js"),
      output: {
        entryFileNames: "bundle.js",
        format: "iife",
        name: "JONMobile",
        inlineDynamicImports: true
      }
    }
  }
});
