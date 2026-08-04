import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const executedStatuses = new Set(["passed", "failed", "pending", "todo"]);
const normalizeTestName = (name) => name.replaceAll(" > ", " ");

export const partitionTestNames = (names, requestedShardCount) => {
  if (!Number.isInteger(requestedShardCount) || requestedShardCount < 1) {
    throw new Error("Electron shard count must be a positive integer");
  }
  const shardCount = Math.min(requestedShardCount, Math.max(1, names.length));
  const shards = Array.from({ length: shardCount }, () => []);
  names.forEach((name, index) => shards[index % shardCount].push(name));
  return shards;
};

export const splitExclusiveTestNames = (names, requestedExclusiveNames) => {
  const available = new Set(names);
  const requested = [...new Set(requestedExclusiveNames)];
  const missing = requested.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`Exclusive Electron tests were not found: ${missing.join(", ")}`);
  }
  const exclusive = new Set(requested);
  return {
    exclusive: names.filter((name) => exclusive.has(name)),
    parallel: names.filter((name) => !exclusive.has(name))
  };
};

export const executedAssertionsFromReport = (report) =>
  (report.testResults ?? []).flatMap((result) =>
    (result.assertionResults ?? []).filter((assertion) =>
      executedStatuses.has(assertion.status)
    )
  );

export const assertExactTestCoverage = (expectedNames, executedNames) => {
  const expected = new Set(expectedNames);
  const counts = new Map();
  for (const name of executedNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const missing = [...expected].filter((name) => !counts.has(name));
  const duplicate = [...counts]
    .filter(([name, count]) => expected.has(name) && count > 1)
    .map(([name]) => name);
  const unexpected = [...counts.keys()].filter((name) => !expected.has(name));
  if (missing.length === 0 && duplicate.length === 0 && unexpected.length === 0) return;
  throw new Error([
    "Electron test coverage mismatch.",
    `missing: ${missing.join(", ") || "none"}`,
    `duplicate: ${duplicate.join(", ") || "none"}`,
    `unexpected: ${unexpected.join(", ") || "none"}`
  ].join("\n"));
};

export const mergeVitestReports = (reports) => {
  const partialResults = reports.flatMap((report) =>
    (report.testResults ?? []).map((result) => {
      const assertionResults = (result.assertionResults ?? []).filter((assertion) =>
        executedStatuses.has(assertion.status)
      );
      return { ...result, assertionResults };
    }).filter((result) => result.assertionResults.length > 0)
  );
  const groupedResults = new Map();
  for (const result of partialResults) {
    const current = groupedResults.get(result.name);
    groupedResults.set(result.name, current
      ? {
          ...current,
          assertionResults: [...current.assertionResults, ...result.assertionResults],
          endTime: Math.max(current.endTime ?? 0, result.endTime ?? 0),
          message: [current.message, result.message].filter(Boolean).join("\n"),
          startTime: Math.min(current.startTime ?? Infinity, result.startTime ?? Infinity),
          status: current.status === "failed" || result.status === "failed" ? "failed" : "passed"
        }
      : result);
  }
  const testResults = [...groupedResults.values()];
  const assertions = testResults.flatMap((result) => result.assertionResults);
  const count = (status) => assertions.filter((assertion) => assertion.status === status).length;
  const failed = count("failed");
  const pending = count("pending") + count("todo");
  return {
    numTotalTestSuites: testResults.length,
    numPassedTestSuites: testResults.filter((result) => result.status === "passed").length,
    numFailedTestSuites: testResults.filter((result) => result.status === "failed").length,
    numPendingTestSuites: 0,
    numTotalTests: assertions.length,
    numPassedTests: count("passed"),
    numFailedTests: failed,
    numPendingTests: pending,
    numTodoTests: count("todo"),
    snapshot: reports[0]?.snapshot ?? {},
    startTime: Math.min(...reports.map((report) => report.startTime ?? Date.now())),
    success: reports.every((report) => report.success === true) && failed === 0,
    testResults
  };
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseWorkerCount = () => {
  const raw = process.env.AGENTENV_ELECTRON_WORKERS ?? "2";
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error("AGENTENV_ELECTRON_WORKERS must be an integer from 1 to 4");
  }
  return value;
};

const listTests = async ({ projectRoot, vitestEntry, file }) => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [vitestEntry, "list", file, "--json"],
    { cwd: projectRoot, env: process.env, maxBuffer: 40 * 1024 * 1024 }
  );
  return JSON.parse(stdout).map((item) => normalizeTestName(item.name));
};

const runJob = async ({ job, projectRoot, reportRoot, vitestEntry }) => {
  const reportPath = join(reportRoot, `${job.id}.json`);
  const startedAt = Date.now();
  process.stdout.write(`[electron-tests] START ${job.label}\n`);
  let processError;
  try {
    await execFileAsync(process.execPath, [
      vitestEntry,
      "run",
      job.file,
      ...(job.pattern ? ["--testNamePattern", job.pattern] : []),
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--reporter=json",
      `--outputFile=${reportPath}`
    ], {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 40 * 1024 * 1024
    });
  } catch (error) {
    processError = error;
  }
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    if (processError) throw processError;
    throw error;
  }
  const executed = executedAssertionsFromReport(report);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(
    `[electron-tests] ${report.success && !processError ? "PASS" : "FAIL"} ${job.label} ` +
    `${executed.length} tests in ${elapsed}s\n`
  );
  return { job, processError, report };
};

export const runElectronTestSuite = async ({
  exclusiveTestNames = [],
  heavyFile,
  outputFile,
  projectRoot,
  testFiles,
  vitestEntry
}) => {
  const workerCount = parseWorkerCount();
  const reportRoot = await mkdtemp(join(tmpdir(), "agentenv-electron-tests-"));
  try {
    const expectedByFile = new Map();
    for (const file of testFiles) {
      expectedByFile.set(file, await listTests({ projectRoot, vitestEntry, file }));
    }
    const heavyNames = expectedByFile.get(heavyFile) ?? [];
    const heavySelection = splitExclusiveTestNames(heavyNames, exclusiveTestNames);
    const heavyShards = heavySelection.parallel.length > 0
      ? partitionTestNames(heavySelection.parallel, workerCount)
      : [];
    const heavyJobs = heavyShards.map((names, index) => ({
      id: `heavy-${index + 1}`,
      file: heavyFile,
      label: `${heavyFile} shard ${index + 1}/${heavyShards.length}`,
      pattern: heavyShards.length === 1
        ? undefined
        : `^(?:${names.map(escapeRegExp).join("|")})$`
    }));
    const smallJobs = testFiles
      .filter((file) => file !== heavyFile)
      .map((file, index) => ({
        id: `electron-${index + 1}`,
        file,
        label: file
      }));
    const run = (job) => runJob({ job, projectRoot, reportRoot, vitestEntry });
    const heavyPromises = heavyJobs.map((job) => run(job));
    await Promise.race(heavyPromises);
    const smallResultsPromise = (async () => {
      const items = [];
      for (const job of smallJobs) items.push(await run(job));
      return items;
    })();
    const [heavyResults, smallResults] = await Promise.all([
      Promise.all(heavyPromises),
      smallResultsPromise
    ]);
    const exclusiveResults = [];
    for (const [index, name] of heavySelection.exclusive.entries()) {
      exclusiveResults.push(await run({
        id: `exclusive-${index + 1}`,
        file: heavyFile,
        label: `${heavyFile} exclusive: ${name}`,
        pattern: `^${escapeRegExp(name)}$`
      }));
    }
    const results = [...heavyResults, ...smallResults, ...exclusiveResults];

    const reports = results.map((result) => result.report);
    const expectedNames = [...expectedByFile.values()].flat();
    const executedNames = reports.flatMap((report) =>
      executedAssertionsFromReport(report).map((assertion) => assertion.fullName)
    );
    assertExactTestCoverage(expectedNames, executedNames);
    const merged = mergeVitestReports(reports);
    if (outputFile) {
      await writeFile(outputFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    }
    const processFailures = results.filter((result) => result.processError);
    if (!merged.success || processFailures.length > 0) {
      const failures = merged.testResults.flatMap((result) =>
        result.assertionResults.filter((assertion) => assertion.status === "failed")
      );
      for (const failure of failures) {
        process.stderr.write(`\n${failure.fullName}\n${failure.failureMessages.join("\n")}\n`);
      }
      throw new Error(
        `Electron tests failed: ${merged.numFailedTests} assertions across ` +
        `${processFailures.length} failed processes`
      );
    }
    process.stdout.write(
      `[electron-tests] COMPLETE ${merged.numPassedTests}/${expectedNames.length} tests; ` +
      `coverage exact\n`
    );
    return merged;
  } finally {
    await rm(reportRoot, { recursive: true, force: true });
  }
};
