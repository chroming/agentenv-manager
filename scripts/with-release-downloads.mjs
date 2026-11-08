import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const repositories = new Map([
  ["electron", "electron/electron"],
  ["builder", "electron-userland/electron-builder-binaries"],
]);
const assetHosts = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

function redirect(response, location) {
  const url = new URL(location ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.port || !assetHosts.has(url.hostname)) {
    throw new Error("Unexpected GitHub release asset redirect");
  }
  response.writeHead(302, { Location: url.href }).end();
}

export async function startReleaseDownloads({ fetchAsset = fetch, log = console } = {}) {
  const useApi = new Set();
  const apiHeaders = { "X-GitHub-Api-Version": "2022-11-28" };
  const shutdown = new AbortController();
  const request = (url, options = {}, timeout = 15_000) => fetchAsset(url, {
    redirect: "manual",
    signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(timeout)]),
    ...options,
  });
  const server = createServer(async (incoming, response) => {
    const match = /^\/(electron|builder)\/([\w.@-]+)\/([\w.-]+)$/.exec(incoming.url ?? "");
    const [, kind, tag, filename] = match ?? [];
    if (incoming.method !== "GET" || !tag || [tag, filename].some((part) => part === "." || part === "..")) {
      response.writeHead(404).end();
      return;
    }
    const repo = repositories.get(kind);
    try {
      const directUrl = `https://github.com/${repo}/releases/download/${tag}/${filename}`;
      if (!useApi.has(repo)) {
        const direct = await request(directUrl, { method: "HEAD" }).catch(() => undefined);
        if (direct?.status === 302) {
          redirect(response, direct.headers.get("location"));
          return;
        }
        if (direct?.ok) {
          response.writeHead(302, { Location: directUrl }).end();
          return;
        }
        if (direct && direct.status < 500 && direct.status !== 429) {
          response.writeHead(direct.status).end();
          return;
        }
        useApi.add(repo);
        log.warn(`Official release download unavailable for ${repo} (${direct?.status ?? "network error"}); using GitHub's asset API.`);
      }

      const base = `https://api.github.com/repos/${repo}/releases`;
      const release = await request(`${base}/tags/${encodeURIComponent(tag)}`, {
        headers: { ...apiHeaders, Accept: "application/vnd.github+json" },
      });
      if (!release.ok) throw new Error(`release lookup returned HTTP ${release.status}`);
      const { assets } = await release.json();
      const id = assets?.find((asset) => asset.name === filename)?.id;
      if (!Number.isSafeInteger(id)) {
        response.writeHead(404).end();
        return;
      }
      const asset = await request(`${base}/assets/${id}`, {
        headers: { ...apiHeaders, Accept: "application/octet-stream" },
      }, 10 * 60_000);
      if (asset.status === 302) {
        redirect(response, asset.headers.get("location"));
      } else if (asset.ok && asset.body && !asset.headers.get("content-type")?.includes("json")) {
        response.writeHead(200, { "Content-Type": "application/octet-stream" });
        await pipeline(Readable.fromWeb(asset.body), response);
      } else {
        throw new Error(`asset download returned HTTP ${asset.status} without a usable file`);
      }
    } catch (error) {
      log.error(`Release asset request failed for ${repo} ${tag}/${filename}: ${error.message}`);
      if (!response.headersSent) response.writeHead(502).end("Official GitHub asset download failed");
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      shutdown.abort();
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { npm_execpath, ...env } = process.env;
  if (!npm_execpath || process.argv.length < 3) throw new Error("Run npm run with:release-downloads -- <npm arguments>");
  const downloads = await startReleaseDownloads();
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [npm_execpath, ...process.argv.slice(2)], {
        env: {
          ...env,
          ELECTRON_MIRROR: `${downloads.origin}/electron/`,
          ELECTRON_BUILDER_BINARIES_MIRROR: `${downloads.origin}/builder/`,
        },
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await downloads.close();
  }
}
