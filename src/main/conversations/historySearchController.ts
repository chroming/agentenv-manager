import { createHash } from "node:crypto";
import { z } from "zod";
import { readFile, mkdir, chmod, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { HistorySearchConfigSchema, type HistorySearchConfig, type HistorySearchStatus, type HistorySource, type HistorySourceProgress } from "../../shared/conversationSearch";
import type { ConversationDetail, ConversationRefreshResult, RemoteDevice } from "../../shared/types";
import type { AgentEnvPaths } from "../paths";
import type { TargetRegistry } from "../targets/registry";
import type { SettingsStore } from "../settingsStore";
import type { RemoteDeviceStore } from "../remoteDevices/remoteDeviceStore";
import type { SshTransport } from "../remoteDevices/systemSshTransport";
import type { AgentConversationCandidate } from "../targets/types";
import type { ConversationIndexStore } from "./conversationIndexStore";
import { writeAtomic } from "../fileUtils";
import { candidateForFile, createConversationDetail, listFilesRecursively, sourceByteSize, sourceIdFromFilename } from "./adapterUtils";
import { remoteHistoryRequest, type RemoteHistoryRecord } from "../targets/conversations/remoteHistoryReader";
import { additionalHistoryDirectoriesFor, historyFilePath, historyReaderPolicy, historyRootsFor, parseHistoryText } from "../targets/conversations/historySourceAdapter";

const emptyConfig = (): HistorySearchConfig => ({ version: 1, enabled: false, paused: false, sources: [] });
const keyFor = (source: Omit<HistorySource, "id">) => createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 24);

export const createHistorySearchController = async (options: {
  paths: AgentEnvPaths; registry: TargetRegistry; settings: SettingsStore;
  index: ConversationIndexStore; devices?: RemoteDeviceStore; transport?: SshTransport;
}) => {
  const configPath = join(options.paths.appDataRoot, "conversation-search.json");
  const progressPath = join(dirname(options.paths.conversationIndexPath), "conversation-coverage.json");
  let config = emptyConfig();
  let needsConsent = true;
  let settingsIssue: string | undefined;
  try { config = HistorySearchConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8"))); needsConsent = false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") settingsIssue = "History search settings could not be read. Select and save your sources again; no history has been scanned.";
  }
  type StoredProgress = HistorySourceProgress & { recordIssues?: Record<string, string[]>; suggestedRoots?: string[] };
  let progress: Record<string, StoredProgress> = {};
  try {
    progress = z.record(z.string(), z.object({
      sourceKey: z.string(), phase: z.enum(["pending", "indexing", "ready", "partial", "unavailable"]),
      discovered: z.number().nonnegative(), indexed: z.number().nonnegative(), failed: z.number().nonnegative(), summaryOnly: z.number().nonnegative(),
      suggestedRoots: z.array(z.string()).optional(),
      recordIssues: z.record(z.string(), z.array(z.string())).optional(),
      lastAttemptAt: z.string().optional(), lastSuccessAt: z.string().optional(), issues: z.array(z.string())
    })).parse(JSON.parse(await readFile(progressPath, "utf8")));
  } catch { /* Rebuilt on explicit refresh. */ }
  for (const source of Object.values(progress)) if (source.phase === "indexing") source.phase = "pending";
  let epoch = 0;
  let abort = new AbortController();
  let running: Promise<ConversationRefreshResult> | undefined;
  let disposed = false;
  let configuring = false;
  const devices = () => options.devices?.list() ?? Promise.resolve([] as RemoteDevice[]);
  const allowedIds = () => config.enabled && !needsConsent ? config.sources.map((s) => s.id) : [];
  const available = async () => {
    const settings = await options.settings.readSettings();
    const result: HistorySearchStatus["availableSources"] = [];
    for (const device of [{ id: "local", name: "This Mac" }, ...await devices()]) {
      for (const adapter of options.registry.listAdapters().filter((a) => a.conversations)) {
        const agentId = adapter.descriptor.id;
        const targetPaths = adapter.createTargetPaths({homeDir:options.paths.homeDir,rootDirOverride:settings.targetConfigRoots?.[agentId],environment:process.env});
        const roots = [...new Set([
          ...historyRootsFor(agentId, options.paths.homeDir, targetPaths, device.id === "local"),
          ...(device.id === "local" ? historyRootsFor(agentId, options.paths.homeDir,
            adapter.createTargetPaths({homeDir: options.paths.homeDir, environment: {}}), true, {}) : [])
        ])];
        for (const historyRoot of roots) {
          const source = { deviceId: device.id, agentId, root: historyRoot, kind: "default" as const };
          result.push({ ...source, id: keyFor(source), deviceName: device.id === "local" && process.platform !== "darwin" ? "This device" : device.name, agentName: adapter.descriptor.name });
        }
        for (const root of device.id === "local" ? additionalHistoryDirectoriesFor(agentId, targetPaths) : []) {
          const source = {deviceId: device.id, agentId, root, kind: "directory" as const};
          result.push({...source,id:keyFor(source),deviceName:process.platform === "darwin" ? "This Mac" : "This device",agentName:adapter.descriptor.name});
        }
      }
    }
    for (const source of config.sources) {
      const base = result.find((item) => item.deviceId === source.deviceId && item.agentId === source.agentId);
      if (!base) continue;
      for (const root of progress[source.id]?.suggestedRoots ?? []) {
        const identity = { deviceId: source.deviceId, agentId: source.agentId, root, kind: "default" as const };
        const id = keyFor(identity);
        if (!result.some((item) => item.id === id)) result.push({ ...identity, id, deviceName: base.deviceName, agentName: base.agentName });
      }
    }
    return result;
  };
  const status = async (): Promise<HistorySearchStatus> => ({
    config: structuredClone(config), needsConsent, settingsIssue, running: Boolean(running),
    sources: config.sources.map((s) => progress[s.id] ?? { sourceKey: s.id, phase: "pending", discovered: 0, indexed: 0, failed: 0, summaryOnly: 0, issues: [] }),
    availableSources: await available()
  });
  const configure = async (value: unknown, clearRemoved = true) => {
    if (configuring) throw new Error("History settings are being saved. Try again shortly.");
    configuring = true;
    try {
    const next = HistorySearchConfigSchema.parse(value);
    const validDevices = new Set(["local", ...(await devices()).map((d) => d.id)]);
    for (const source of next.sources) {
      if (!validDevices.has(source.deviceId)) throw new Error("History source device is unavailable");
      if (!options.registry.get(source.agentId).conversations) throw new Error("Agent history is unsupported");
      if (source.root.includes("\0") || (!isAbsolute(source.root) && !source.root.startsWith("~/"))) throw new Error("Choose an absolute history directory");
      if (source.deviceId === "local") source.root = resolve(source.root.startsWith("~/") ? join(options.paths.homeDir, source.root.slice(2)) : source.root);
      else source.root = source.root.replace(/\/+$/, "") || "/";
      const { id: _id, ...identity } = source;
      source.id = keyFor(identity);
    }
    next.sources = [...new Map(next.sources.map((s) => [s.id, s])).values()];
    // Invalidate in-flight results BEFORE any awaited persistence or cleanup.
    epoch += 1;
    abort.abort();
    await running?.catch(() => undefined);
    abort = new AbortController();
    const removed = config.sources.filter((s) => !next.sources.some((n) => n.id === s.id)).map((s) => s.id);
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    await writeAtomic(configPath, JSON.stringify(next));
    await chmod(configPath, 0o600);
    config = next;
    needsConsent = false;
    settingsIssue = undefined;
    if (clearRemoved) options.index.clearSources(next.enabled ? ["", ...removed] : undefined);
    for (const id of removed) delete progress[id];
    if (!next.enabled && clearRemoved) progress = {};
    await writeAtomic(progressPath, JSON.stringify(progress));
    return status();
    } finally { configuring = false; }
  };
  const refresh = (): Promise<ConversationRefreshResult> => {
    if (running) return running;
    if (!config.enabled || config.paused || needsConsent || disposed || configuring) return Promise.resolve({ indexed: 0, unchanged: 0, removed: 0, failures: [], refreshedAt: new Date().toISOString() });
    const generation = epoch;
    const signal = abort.signal;
    const current = () => { signal.throwIfAborted(); if (generation !== epoch || disposed) throw new Error("History indexing stopped"); };
    const run = async () => {
      const result: ConversationRefreshResult = { indexed: 0, unchanged: 0, removed: 0, failures: [], refreshedAt: new Date().toISOString() };
      const remoteDevices = await devices();
      let coverageWrite = Promise.resolve();
      const collectSource = async (source: HistorySource) => {
        current();
        const adapter = options.registry.get(source.agentId);
        const device = remoteDevices.find((d) => d.id === source.deviceId);
        const previousRecordIssues = progress[source.id]?.recordIssues ?? {};
        const coverage: StoredProgress = { sourceKey: source.id, phase: "indexing", discovered: 0, indexed: 0, failed: 0, summaryOnly: 0,
          lastAttemptAt: new Date().toISOString(), lastSuccessAt: progress[source.id]?.lastSuccessAt, issues: [], recordIssues: {}, suggestedRoots: progress[source.id]?.suggestedRoots };
        progress[source.id] = coverage;
        try {
          const paths = adapter.createTargetPaths({ homeDir: options.paths.homeDir, rootDirOverride: source.root, environment: process.env });
          const reader = historyReaderPolicy(source.agentId);
          const context = { homeDir: options.paths.homeDir, targetPaths: paths, environment: process.env, platform: process.platform,
            historyRoots: reader.explicitRoots ? [source.root] : undefined };
          let candidates: AgentConversationCandidate[] = [];
          const remoteRecords = new Map<string, RemoteHistoryRecord>();
          if (source.deviceId !== "local") {
            if (!device || !options.transport) throw new Error("SSH device is unavailable. Check its connection in Agents.");
            const inventory = await remoteHistoryRequest<{ records: RemoteHistoryRecord[]; issues: string[]; missing?: boolean; suggestedRoots?: string[] }>(options.transport, device, source, "scan", signal);
            current();
            coverage.issues.push(...inventory.issues);
            coverage.suggestedRoots = inventory.suggestedRoots ?? [];
            if (inventory.missing && (source.kind === "directory" || options.index.hasSourceRecords(source.id))) coverage.issues.push("The history directory is unavailable. Check its path or connection; cached conversations are kept.");
            for (const record of inventory.records) {
              const recordId = record.sessionId ?? sourceIdFromFilename(record.path);
              const id = `${record.path}:${recordId}`;
              remoteRecords.set(id, record);
              candidates.push({ recordId: id, source: { locator: record.path, version: record.version },
                providerSession: { kind: "native", id: recordId }, updatedAt: record.updatedAt, title: record.title,
                snippet: record.snippet, workspacePath: record.workspacePath, detailState: record.detailState ?? "full", archived: record.path.includes("archived_sessions") });
            }
          } else if (source.kind === "directory" && reader.directoryJsonl) {
            if (!(await stat(source.root)).isDirectory()) throw new Error("History source must be a directory. Check its path in History sources.");
            for (const path of await listFilesRecursively(source.root, (p) => p.endsWith(".jsonl"), { onIssue: (message) => coverage.issues.push(message) })) {
              try { candidates.push(await candidateForFile(path, { recordId: sourceIdFromFilename(path), detailState: "full" })); }
              catch (error) { coverage.issues.push(`${path}: ${String(error)}`); }
            }
          } else {
            const discovery = await adapter.conversations!.discover(context);
            current();
            candidates = discovery.candidates;
            coverage.issues.push(...discovery.failures ?? []);
            if (!discovery.complete && !coverage.issues.length && !(source.kind === "default" && candidates.length === 0 && !options.index.hasSourceRecords(source.id))) coverage.issues.push("No complete history inventory was found at this location. Check the path or add another history directory.");
          }
          coverage.discovered = candidates.length;
          const seen = new Set<string>();
          for (const candidate of candidates) {
            current();
            const nativeId = candidate.providerSession?.id ?? candidate.recordId;
            const id = `${source.id}:${createHash("sha256").update(candidate.source.locator + "\0" + nativeId).digest("hex")}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const issueStart = coverage.issues.length;
            try {
              if (options.index.sourceVersion(id) === candidate.source.version) { result.unchanged++; coverage.indexed++; coverage.issues.push(...previousRecordIssues[id] ?? []); if (candidate.detailState === "summary-only") coverage.summaryOnly++; continue; }
              let detail: ConversationDetail;
              let content: string | undefined;
              const localJsonl = source.deviceId === "local" && candidate.source.locator.endsWith(".jsonl") && sourceByteSize(candidate.source.version) !== undefined;
              const verifyLocalPath = async () => {
                const approved = await realpath(source.root);
                const actual = await realpath(candidate.source.locator);
                const path = relative(approved, actual);
                if (isAbsolute(path) || path === ".." || path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
                  throw new Error("History link changed or leaves the approved source. Add its destination in History sources.");
                }
              };
              if (localJsonl) await verifyLocalPath();
              if (source.deviceId !== "local") {
                if (candidate.detailState === "summary-only") detail = createConversationDetail({id: source.agentId, name: adapter.descriptor.name}, candidate, [], {title: candidate.title, snippet: candidate.snippet});
                else {
                  const response = await remoteHistoryRequest<{ content: string }>(options.transport!, device!, source, "read", signal, remoteRecords.get(candidate.recordId));
                  content = response.content;
                  detail = parseHistoryText(source.agentId, adapter.descriptor.name, candidate, content);
                }
              } else if (source.kind === "directory" && reader.directoryJsonl) {
                content = await readFile(candidate.source.locator, "utf8");
                detail = parseHistoryText(source.agentId, adapter.descriptor.name, candidate, content);
              } else {
                detail = await adapter.conversations!.read(context, candidate);
                if (candidate.source.locator.endsWith(".jsonl")) {
                  try {
                    content = await readFile(candidate.source.locator, "utf8");
                    const parsed = parseHistoryText(source.agentId, adapter.descriptor.name, candidate, content);
                    if (reader.allBranches) detail = parsed;
                    else detail.toolText = parsed.toolText;
                  } catch (error) {
                    coverage.issues.push(`${candidate.source.locator}: tool records could not be indexed; readable messages were kept.`);
                  }
                }
              }
              if (content) {
                const lines = content.split(/\r?\n/).filter((l) => l.trim());
                const bad = lines.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } }).length;
                if (bad) coverage.issues.push(`${candidate.source.locator}: ${bad} unreadable records; readable messages were indexed.`);
              }
              if (localJsonl) {
                await verifyLocalPath();
                const after = await candidateForFile(candidate.source.locator, {recordId:candidate.recordId,detailState:candidate.detailState});
                if (candidate.source.version !== after.source.version && !candidate.source.version.startsWith(after.source.version + ":")) {
                  throw new Error("History changed while reading. Cached text is kept; it will be retried on the next refresh.");
                }
              }
              current();
              options.index.upsert({ ...detail, id, agentId: source.agentId, agentName: adapter.descriptor.name,
                sizeBytes: remoteRecords.get(candidate.recordId)?.size ?? detail.sizeBytes,
                origin: { sourceKey: source.id, deviceId: source.deviceId, deviceName: device?.name ?? "This device",
                  readOnly: source.deviceId !== "local" || source.kind === "directory",
                  connection: device ? `${device.user ? device.user + "@" : ""}${device.host}${device.port ? ":" + device.port : ""}` : undefined,
                  historyPath: historyFilePath(candidate), runtimeHome: candidate.source.runtimeHome,
                  parentSessionId: candidate.source.locator.includes(`${process.platform === "win32" ? "\\" : "/"}subagents`) ? basename(dirname(dirname(candidate.source.locator))) : undefined }
              }, candidate);
              result.indexed++; coverage.indexed++;
              if (detail.detailState === "summary-only") coverage.summaryOnly++;
            } catch (error) {
              current(); coverage.failed++;
              coverage.issues.push(`${candidate.source.locator}: ${error instanceof Error ? error.message : String(error)}`);
            }
            finally {
              const issues = coverage.issues.slice(issueStart);
              if (issues.length) coverage.recordIssues![id] = issues;
            }
            await new Promise<void>((done) => setImmediate(done));
          }
          current();
          coverage.phase = coverage.issues.length || coverage.summaryOnly ? "partial" : "ready";
          if (!coverage.issues.length) {
            coverage.lastSuccessAt = new Date().toISOString();
            result.removed += options.index.removeMissingSource(source.id, seen);
          }
        } catch (error) {
          current(); coverage.phase = "unavailable";
          coverage.issues.push(error instanceof Error ? error.message : String(error));
        }
        result.failures.push(...coverage.issues.map((message) => ({ agentId: source.agentId, message })));
        current();
        coverageWrite = coverageWrite.then(async () => { current(); await writeAtomic(progressPath, JSON.stringify(progress)); });
        await coverageWrite;
      };
      // One collector per device; two devices can progress independently without an SSH fan-out.
      const groups = new Map<string, HistorySource[]>();
      for (const source of config.sources) groups.set(source.deviceId, [...groups.get(source.deviceId) ?? [], source]);
      const queue = [...groups.values()];
      const worker = async () => {
        for (;;) {
          const sources = queue.shift();
          if (!sources) return;
          for (const source of sources) await collectSource(source);
        }
      };
      const workers = await Promise.allSettled([worker(), worker()]);
      const failure = workers.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      current(); options.index.setLastRefreshedAt(result.refreshedAt);
      return result;
    };
    running = run().finally(() => {
      for (const source of Object.values(progress)) if (source.phase === "indexing") source.phase = "pending";
      running = undefined;
    });
    return running;
  };
  return { status, configure, refresh, allowedIds,
    enabled: () => config.enabled && !needsConsent,
    dispose: () => { disposed = true; epoch++; abort.abort(); } };
};
