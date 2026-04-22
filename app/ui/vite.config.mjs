import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: path.join(__dirname, "assets", "react"),
    rollupOptions: {
      input: path.join(__dirname, "src", "main.jsx"),
      output: {
        entryFileNames: "cowork-user.js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]"
      }
    },
    sourcemap: false
  }
});
