import {
  BrowserWindow,
  clipboard,
  Menu,
  type MenuItemConstructorOptions
} from "electron";
import { parseDesktopContextMenuItems } from "../../shared/desktopContextMenu";
import type { ConversationService } from "../conversations/conversationService";
import { parseId, type IpcRegistrationHandles } from "./registration";

interface ConversationIpcServices {
  conversationService: ConversationService;
}

export const registerConversationIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle">,
  services: ConversationIpcServices
) => {
  const { diagnosticHandle } = handles;
  const { conversationService } = services;

  diagnosticHandle("clipboard:write-text", (_event, text: unknown) => {
    clipboard.writeText(String(text));
  });
  diagnosticHandle("conversations:list", (_event, input: unknown) =>
    conversationService.list(input && typeof input === "object" ? input : undefined)
  );
  diagnosticHandle("conversations:search", (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Conversation search requires a query");
    }
    const value = input as { query?: unknown; limit?: unknown };
    const query = String(value.query ?? "").trim().slice(0, 500);
    if (!query) return [];
    const requestedLimit = Number(value.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(20, Math.trunc(requestedLimit)))
      : 6;
    return conversationService.search({ query, limit });
  });
  diagnosticHandle("conversations:read", (_event, id: unknown, input: unknown) =>
    conversationService.read(
      String(id ?? ""),
      input && typeof input === "object" ? input : undefined
    )
  );
  diagnosticHandle("conversations:refresh", () => conversationService.refresh());
  diagnosticHandle("conversations:open-original", (_event, id: unknown) =>
    conversationService.openOriginal(String(id ?? ""))
  );
  diagnosticHandle("conversations:preview-continue", (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Conversation continuation requires a source and target");
    }
    const value = input as { conversationId?: unknown; targetId?: unknown };
    return conversationService.previewContinuation({
      conversationId: String(value.conversationId ?? ""),
      targetId: parseId(value.targetId, "target id")
    });
  });
  diagnosticHandle("conversations:continue", (_event, previewId: unknown) =>
    conversationService.continue(String(previewId ?? ""))
  );
  diagnosticHandle("menu:open-context", (event, value: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return undefined;
    const items = parseDesktopContextMenuItems(value);

    return new Promise<string | undefined>((resolveSelection) => {
      let resolved = false;
      const finish = (selection?: string) => {
        if (resolved) return;
        resolved = true;
        resolveSelection(selection);
      };
      const template: MenuItemConstructorOptions[] = items.map((item) =>
        "type" in item
          ? { type: "separator" }
          : {
              label: item.label,
              enabled: item.enabled,
              click: () => finish(item.id)
            }
      );
      Menu.buildFromTemplate(template).popup({
        window,
        callback: () => setImmediate(() => finish())
      });
    });
  });
};
