import { spawn } from "node:child_process";
import { resolve } from "node:path";

if (process.platform !== "darwin") {
  throw new Error("The macOS signing certificate can only be trusted on macOS");
}

const certificatePath = resolve("build", "macos-signing-certificate.pem");
const child = spawn(
  "/usr/bin/security",
  [
    "add-trusted-cert",
    "-r",
    "trustRoot",
    "-p",
    "codeSign",
    "-k",
    `${process.env.HOME}/Library/Keychains/login.keychain-db`,
    certificatePath
  ],
  { stdio: "inherit" }
);

await new Promise((resolvePromise, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolvePromise();
    else reject(new Error(`security add-trusted-cert exited with ${signal ?? code}`));
  });
});

process.stdout.write("AgentEnv Manager Release Signing is trusted for code signing.\n");
