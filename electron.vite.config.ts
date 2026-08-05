import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

type BuildEnvironment = Record<string, string | undefined>;

export const resolvePostHogBuildEnvironment = (environment: BuildEnvironment) => ({
  host: environment.AGENTENV_POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
  projectToken: environment.AGENTENV_POSTHOG_PROJECT_TOKEN?.trim() || ""
});

export const createElectronViteConfig = (
  mode: string,
  processEnvironment: BuildEnvironment = process.env
) => {
  const environment = {
    ...loadEnv(mode, rootDir, ""),
    ...processEnvironment
  };
  const postHog = resolvePostHogBuildEnvironment(environment);

  return {
    main: {
      define: {
        __AGENTENV_POSTHOG_HOST__: JSON.stringify(postHog.host),
        __AGENTENV_POSTHOG_PROJECT_TOKEN__: JSON.stringify(postHog.projectToken)
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
            format: "cjs" as const,
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
  };
};

export default defineConfig(({ mode }) => createElectronViteConfig(mode));
