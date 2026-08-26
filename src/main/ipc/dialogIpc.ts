import { BrowserWindow, dialog } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { createSkillArchiveService } from "../skillArchiveService";
import type { TargetRegistry } from "../targets/registry";
import { parseId, type IpcRegistrationHandles } from "./registration";

export const registerDialogIpc = (
  { diagnosticHandle }: Pick<IpcRegistrationHandles, "diagnosticHandle">,
  { targetRegistry }: { targetRegistry: TargetRegistry }
) => {
  const skillArchiveService = createSkillArchiveService();
  const selectDirectory = async (
    event: Electron.IpcMainInvokeEvent,
    options: Electron.OpenDialogOptions
  ) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  };

  diagnosticHandle("dialog:select-skill-folder", (event) =>
    selectDirectory(event, {
      title: "Select skill folder",
      properties: ["openDirectory"]
    })
  );
  diagnosticHandle("dialog:select-local-skill-source", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Select Skill folder or ZIP",
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "Skill sources", extensions: ["zip"] }]
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return undefined;
    const selectedPath = result.filePaths[0];
    const selectedStats = await stat(selectedPath);
    if (selectedStats.isDirectory()) {
      const path = resolve(selectedPath);
      return { kind: "folder", path, rootPath: path };
    }
    return skillArchiveService.prepare(selectedPath);
  });
  diagnosticHandle("dialog:select-instruction-file", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Import Instruction file",
      properties: ["openFile"],
      filters: [{ name: "Markdown and text", extensions: ["md", "markdown", "txt"] }]
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return undefined;
    const path = resolve(result.filePaths[0]);
    const stats = await stat(path);
    if (!stats.isFile() || stats.size > 2_000_000) {
      throw new Error("Instruction file must be a text file smaller than 2 MB");
    }
    const base = basename(path, extname(path));
    return { name: base || "Imported instructions", path, content: await readFile(path, "utf8") };
  });
  diagnosticHandle("skills:release-archive", (_event, token: unknown) =>
    skillArchiveService.release(String(token))
  );
  diagnosticHandle("dialog:select-target-config-root", (event, targetId: unknown) => {
    const target = targetRegistry.get(parseId(targetId, "target id")).descriptor;
    return selectDirectory(event, {
      title: `Select ${target.name} configuration folder`,
      properties: ["openDirectory", "createDirectory"]
    });
  });
  diagnosticHandle("dialog:select-comparison-workspace", (event) =>
    selectDirectory(event, {
      title: "Select Workspace folder for comparison",
      properties: ["openDirectory"]
    })
  );
  diagnosticHandle("dialog:select-project-folder", (event) =>
    selectDirectory(event, {
      title: "Add Project folder",
      buttonLabel: "Add Project",
      properties: ["openDirectory"]
    })
  );
  diagnosticHandle("dialog:select-conversation-workspace", (event) =>
    selectDirectory(event, {
      title: "Move conversation to working directory",
      buttonLabel: "Choose",
      properties: ["openDirectory"]
    })
  );
};
