import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

if (process.platform === "darwin" && process.env.RUNNER_TEMP) {
  const keychainPath = join(process.env.RUNNER_TEMP, "agentenv-release-signing.keychain-db");
  const p12Path = join(process.env.RUNNER_TEMP, "agentenv-release-signing.p12");
  const certificatePath = join(process.env.RUNNER_TEMP, "agentenv-release-signing.pem");

  await execFileAsync(
    "/usr/bin/sudo",
    ["-n", "/usr/bin/security", "remove-trusted-cert", "-d", certificatePath],
    { encoding: "utf8" }
  ).catch(() => undefined);
  await execFileAsync("/usr/bin/security", ["delete-keychain", keychainPath], {
    encoding: "utf8"
  }).catch(() => undefined);
  await Promise.all([
    rm(keychainPath, { force: true }),
    rm(p12Path, { force: true }),
    rm(certificatePath, { force: true })
  ]);
}
