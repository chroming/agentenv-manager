import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";

let root = "";
let app: ElectronApplication | undefined;

requireCurrentElectronBuild();

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const writeExecutable = async (path: string, content: string) => {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
};

describe("SSH Linux Profile endpoint", () => {
  it("adds a device through desktop IPC and applies a Profile through isolated SSH", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-remote-electron-"));
    const binDir = join(root, "bin");
    const homeDir = join(root, "home");
    const remoteHome = join(root, "remote-home");
    await mkdir(binDir, { recursive: true });
    await mkdir(join(homeDir, ".ssh"), { recursive: true });
    await mkdir(remoteHome, { recursive: true });
    await writeFile(join(homeDir, ".ssh", "config"), [
      "Host fixture-host",
      "  HostName 10.0.0.12",
      "  User fixture-user",
      "  Port 2202"
    ].join("\n"));
    await writeExecutable(join(binDir, "opencode"), "#!/bin/sh\nprintf 'opencode fixture\\n'\n");
    await writeExecutable(join(binDir, "uname"), `#!/bin/sh
if [ "$1" = "-m" ]; then printf 'x86_64\\n'; else printf 'Linux\\n'; fi
`);
    await writeExecutable(join(binDir, "sha256sum"), "#!/bin/sh\nexec shasum -a 256 \"$@\"\n");
    await writeExecutable(join(binDir, "ssh"), `#!/bin/sh
if [ "$1" = "-G" ]; then
  printf 'hostname 10.0.0.12\\nuser fixture-user\\nport 2202\\n'
  exit 0
fi
command=""
for argument in "$@"; do command="$argument"; done
HOME="$AGENTENV_REMOTE_HOME" PATH="$AGENTENV_REMOTE_BIN:/usr/bin:/bin" /bin/sh -c "$command"
`);

    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [
        `--user-data-dir=${join(root, "electron-user-data")}`,
        join(process.cwd(), "out", "main", "main.js")
      ],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_DATA_ROOT: join(root, "data"),
        AGENTENV_HOME: homeDir,
        AGENTENV_CACHE_ROOT: join(root, "cache"),
        AGENTENV_AUTOMATION_TARGET_PATH: binDir,
        AGENTENV_REMOTE_HOME: remoteHome,
        AGENTENV_REMOTE_BIN: binDir,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
      }
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 920, height: 620 });
    await page.getByRole("heading", { name: "Agents" }).waitFor({ state: "visible" });
    const agentChooser = page.getByRole("dialog", { name: "Choose Agents" });
    if (await agentChooser.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
      await agentChooser.getByRole("button", { name: "Not now" }).click();
      await agentChooser.waitFor({ state: "hidden" });
    }

    await page.getByRole("button", { name: "More Agent actions" }).click();
    await page.getByRole("menuitem", { name: "Add SSH device" }).click();
    const addDeviceDialog = page.getByRole("dialog", { name: "Add SSH device" });
    await addDeviceDialog.getByRole("combobox", { name: "SSH config host" }).selectOption("fixture-host");
    await addDeviceDialog.getByText("fixture-user@10.0.0.12:2202", { exact: false }).waitFor({
      state: "visible"
    });
    await addDeviceDialog.getByRole("button", { name: "Add device", exact: true }).click();
    await addDeviceDialog.waitFor({ state: "hidden" });
    const remoteDeviceGroup = page.locator(".remote-location-group").filter({ hasText: "fixture-host" });
    await remoteDeviceGroup.waitFor({ state: "visible" });
    await remoteDeviceGroup.getByText("OpenCode", { exact: true }).waitFor({ state: "visible" });
    await remoteDeviceGroup.getByRole("button", { name: "Refresh fixture-host" }).click();
    await remoteDeviceGroup.getByText("Ready · 1 Agent", { exact: true }).waitFor({ state: "visible" });
    const typography = await page.locator(".target-list").evaluate((list) => {
      const remoteGroup = list.querySelector<HTMLElement>(".remote-location-group")!;
      const remoteDeviceName = remoteGroup.querySelector<HTMLElement>(".remote-location-header__name")!;
      const remoteDeviceHost = remoteGroup.querySelector<HTMLElement>(".remote-location-header__host")!;
      const remoteAgentName = remoteGroup.querySelector<HTMLElement>(
        ".target-workflow-name-action > strong"
      )!;
      const style = (element: HTMLElement) => {
        const computed = getComputedStyle(element);
        return {
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          lineHeight: computed.lineHeight
        };
      };
      return {
        remoteAgent: style(remoteAgentName),
        remoteDevice: style(remoteDeviceName),
        remoteHost: style(remoteDeviceHost)
      };
    });
    expect(typography.remoteAgent).toEqual({
      fontSize: "13px",
      fontWeight: "500",
      lineHeight: "normal"
    });
    expect(typography.remoteDevice).toEqual({
      fontSize: "12px",
      fontWeight: "500",
      lineHeight: "16px"
    });
    expect(typography.remoteHost).toEqual({
      fontSize: "11px",
      fontWeight: "400",
      lineHeight: "15px"
    });
    const remoteLayout = await remoteDeviceGroup.evaluate((group) => {
      const header = group.querySelector<HTMLElement>(".remote-location-header")!;
      const headerBox = header.getBoundingClientRect();
      const actions = header.querySelector<HTMLElement>(".remote-location-header__actions")!;
      const actionButtons = Array.from(actions.querySelectorAll<HTMLElement>("button"));
      const remoteRow = group.querySelector<HTMLElement>(".target-workflow-header")!;
      const remoteName = remoteRow.querySelector<HTMLElement>(".target-workflow-name-action > strong")!;
      const remoteStatus = remoteRow.querySelector<HTMLElement>(".target-health-status")!;
      const remoteProfile = remoteRow.querySelector<HTMLElement>(".target-workflow-environment")!;
      const tableHeader = group.parentElement?.querySelector<HTMLElement>(".target-list__header")!;
      const textLeft = (element: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return Math.round(range.getBoundingClientRect().left);
      };
      return {
        actionsContained: actions.getBoundingClientRect().right <= headerBox.right,
        actionSizes: actionButtons.map((button) => {
          const box = button.getBoundingClientRect();
          return `${Math.round(box.width)}x${Math.round(box.height)}`;
        }),
        nameAligned: Math.abs(
          textLeft(remoteName) - textLeft(tableHeader.children[1] as HTMLElement)
        ) <= 1,
        profileAligned: Math.abs(
          remoteProfile.getBoundingClientRect().left -
          (tableHeader.children[3] as HTMLElement).getBoundingClientRect().left
        ) <= 1,
        statusAligned: Math.abs(
          remoteStatus.getBoundingClientRect().left -
          (tableHeader.children[2] as HTMLElement).getBoundingClientRect().left
        ) <= 1,
        statusText: remoteStatus.textContent?.trim()
      };
    });
    expect(remoteLayout).toEqual({
      actionsContained: true,
      actionSizes: ["28x28", "28x28"],
      nameAligned: true,
      profileAligned: true,
      statusAligned: true,
      statusText: "Ready"
    });

    const result = await page.evaluate(async () => {
      const created = await window.agentEnv.createProfile({
        preferredTargetId: "opencode",
        name: "Remote fixture"
      });
      const profile = await window.agentEnv.saveProfile({
        manifest: created.manifest,
        instructions: "# Remote fixture instructions\n",
        resources: created.resources,
        expectedContentHash: created.contentHash
      });
      const endpoint = (await window.agentEnv.listRemoteEndpoints?.(true))?.find(
        (candidate) => candidate.agentId === "opencode"
      );
      if (!endpoint) throw new Error("OpenCode SSH endpoint was not discovered");
      const preview = await window.agentEnv.previewApply(profile.manifest.id, endpoint.id);
      const applied = await window.agentEnv.applyProfile(profile.manifest.id, preview.id);
      const state = (await window.agentEnv.listRemoteTargetStates?.())?.find(
        (candidate) => candidate.targetId === endpoint.id
      );
      return { endpoint, preview, applied, state };
    });

    expect(result.endpoint.availability).toBe("ready");
    expect(result.preview.changes).toEqual([
      expect.objectContaining({ category: "instructions", action: "write" })
    ]);
    expect(result.applied).toMatchObject({ ok: true });
    expect(result.state).toMatchObject({
      activeProfileId: expect.stringContaining("remote-fixture"),
      lifecycleStatus: "applied"
    });
    await expect(readFile(join(remoteHome, ".config", "opencode", "AGENTS.md"), "utf8"))
      .resolves.toBe("# Remote fixture instructions\n");

    const listGeometry = await page.locator(".target-list").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      children: [...element.children].map((child) => ({
        className: child.className,
        left: child.getBoundingClientRect().left,
        right: child.getBoundingClientRect().right,
        scrollWidth: child.scrollWidth
      }))
    }));
    expect(
      listGeometry.scrollWidth - listGeometry.clientWidth,
      JSON.stringify(listGeometry)
    ).toBeLessThanOrEqual(2);
  }, 45_000);
});
