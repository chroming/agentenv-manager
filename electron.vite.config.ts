import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    define: {
      __AGENTENV_TELEMETRY_ENDPOINT__: JSON.stringify(
        process.env.AGENTENV_TELEMETRY_ENDPOINT ?? ""
      )
    },
    build: {
      rollupOptions: {
        input: resolve(rootDir, "src/main/main.ts")
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(rootDir, "src/preload/index.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].js"
        }
      }
    }
  },
  renderer: {
    define: {
      global: "globalThis"
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: "globalThis"
        }
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(rootDir, "src/renderer/index.html")
      }
    }
  }
});
