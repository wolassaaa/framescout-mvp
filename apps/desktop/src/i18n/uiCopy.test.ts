import { describe, expect, expectTypeOf, it } from "vitest";
import indexSource from "../../index.html?raw";
import appSource from "../App.tsx?raw";
import presetSource from "../data/presets.ts?raw";
import analysisSource from "../features/analysis/AnalysisQueueView.tsx?raw";
import coverageSource from "../features/coverage/CoverageView.tsx?raw";
import duelSource from "../features/duel/DuelView.tsx?raw";
import exportSource from "../features/export/ExportView.tsx?raw";
import gridSource from "../features/grid/GridView.tsx?raw";
import importSource from "../features/import/ImportView.tsx?raw";
import projectsSource from "../features/projects/ProjectsView.tsx?raw";
import reviewDeskSource from "../features/review/ReviewDesk.tsx?raw";
import { presetCatalog } from "../data/presets";
import { localizedTag } from "./tagLabels";
import { formatCopy, uiCopy } from "./uiCopy";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, nested]) => flattenKeys(nested, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe("UI copy catalog", () => {
  it("preserves the localized nested catalog shape", () => {
    expectTypeOf(uiCopy.zh.grid.needsReview).toEqualTypeOf<string>();
    expectTypeOf(uiCopy.en.reviewMode["reject-audit"]).toEqualTypeOf<string>();
    expectTypeOf(uiCopy.zh.review.suggestion.keep).toEqualTypeOf<string>();
  });

  it("keeps Chinese and English catalogs structurally identical", () => {
    expect(flattenKeys(uiCopy.zh)).toEqual(flattenKeys(uiCopy.en));
  });

  it("localizes stable machine tags and preserves manual or unknown tags", () => {
    expect(localizedTag("subject:person", "zh")).toBe("人物");
    expect(localizedTag("subject:person", "en")).toBe("Person");
    expect(localizedTag("manual:portfolio-pick", "zh")).toBe("portfolio pick");
    expect(localizedTag("object:unknown", "zh")).toBe("object:unknown");
  });

  it("keeps App-level visible copy bound to the unified catalog", () => {
    expect(appSource).not.toContain('type UiLanguage = "zh" | "en"');
    expect(appSource).not.toContain("const shortcutLabels");
    expect(appSource).not.toMatch(/label: \{ zh:/);
    expect(appSource).not.toContain('language === "zh" ?');
    expect(reviewDeskSource).not.toContain("Top {asset.aiSelectionRank}");
  });

  it("keeps the document language and reviewed static UI copy catalog-bound", () => {
    expect(indexSource).toContain('<html lang="zh-CN">');

    const namedScreenSources = [
      appSource,
      analysisSource,
      coverageSource,
      duelSource,
      exportSource,
      gridSource,
      importSource,
      projectsSource,
      reviewDeskSource
    ].join("\n");
    const reviewedLiterals = [
      "A local change could not be saved. Your next edit will retry.",
      "AI configuration could not be loaded.",
      "AI configuration could not be saved.",
      "AI analysis could not be started.",
      "AI progress could not be refreshed.",
      "Import progress could not be refreshed.",
      "无法生成导出预览：",
      "No selected source paths to copy.",
      "Clipboard access is unavailable.",
      "Choose the RAW master for this proxy",
      "Choose a FrameScout source folder",
      "Choose an optional RAW master folder",
      "Friday night finals",
      "D:\\\\Retouch\\\\Friday-finals"
    ];

    for (const literal of reviewedLiterals) expect(namedScreenSources).not.toContain(literal);
    expect(namedScreenSources).not.toMatch(/\b(?:zh|en):\s*["']/);
  });

  it("keeps preset copy only in uiCopy behind stable typed keys", () => {
    expect(presetSource).not.toMatch(/\b(?:name|note):/);
    expect(presetSource).not.toMatch(/[\u3400-\u9fff]/);

    for (const preset of presetCatalog) {
      expect(uiCopy.zh.presets[preset.copyKey].name).toBeTypeOf("string");
      expect(uiCopy.en.presets[preset.copyKey].note).toBeTypeOf("string");
    }
    expect(importSource).toContain("presetText[definition.copyKey]");
    expect(analysisSource).toContain("presets[presetDefinition(project.preset).copyKey]");
    expect(reviewDeskSource).toContain("presets[activePreset.copyKey]");
  });

  it("formats localized count-sensitive statuses and localizes Export tag labels", () => {
    expect(formatCopy(uiCopy.zh.app.selectedPathsCopied, { count: 2, paths: uiCopy.zh.app.sourcePaths })).toBe("已复制 2 个精选源路径。");
    expect(formatCopy(uiCopy.en.app.selectedPathsCopied, { count: 1, paths: uiCopy.en.app.sourcePath })).toBe("Copied 1 selected source path.");
    expect(exportSource).toContain("localizedTag(tag, language)");
  });
});
