import { describe, expect, it } from "vitest";
import { localeTag, resolveAppLocale, translate } from "../../src/renderer/i18n";

describe("renderer i18n", () => {
  it("maps system language variants to the supported locales", () => {
    expect(resolveAppLocale("system", ["en-GB"])).toBe("en");
    expect(resolveAppLocale("system", ["zh-CN"])).toBe("zh_CN");
    expect(resolveAppLocale("system", ["zh-Hans-SG"])).toBe("zh_CN");
    expect(resolveAppLocale("system", ["zh-TW"])).toBe("zh_TW");
    expect(resolveAppLocale("system", ["zh-Hant-HK"])).toBe("zh_TW");
    expect(resolveAppLocale("system", ["fr-FR", "zh-CN"])).toBe("en");
  });

  it("honors an explicit preference independently of the system language", () => {
    expect(resolveAppLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveAppLocale("zh_CN", ["en-US"])).toBe("zh_CN");
    expect(resolveAppLocale("zh_TW", ["en-US"])).toBe("zh_TW");
  });

  it("translates core product terms and interpolates values", () => {
    expect(translate("zh_CN", "Profiles")).toBe("配置方案");
    expect(translate("zh_CN", "{{count}} skills", { count: 3 })).toBe("3 个技能");
    expect(translate("zh_TW", "Profiles")).toBe("設定檔");
    expect(translate("zh_TW", "Import skills")).toBe("匯入技能");
    expect(translate("zh_TW", "Apply preview for {{name}}", { name: "OpenCode" })).toBe(
      "套用至 OpenCode 的預覽"
    );
  });

  it("falls back to the source message and exposes stable locale tags", () => {
    expect(translate("zh_CN", "User-defined text")).toBe("User-defined text");
    expect(localeTag("en")).toBe("en-US");
    expect(localeTag("zh_CN")).toBe("zh-CN");
    expect(localeTag("zh_TW")).toBe("zh-TW");
  });
});
