import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(rootDir, "src/main/main.ts")
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(rootDir, "src/preload/index.ts")
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(rootDir, "src/renderer/index.html")
      }
    }
  }
});
