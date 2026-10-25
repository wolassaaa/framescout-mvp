import { describe, expect, it } from "vitest";
import type { PersistedProject, ReviewAsset } from "@framescout/contracts";
import { buildExportPreview, defaultExportSettings } from "./projectExport";

const asset = (overrides: Partial<ReviewAsset>): ReviewAsset => ({
  id: "asset-1",
  fileName: "frame-001.jpg",
  sourcePath: "shoot/frame-001.jpg",
  fileFingerprint: "shoot/frame-001.jpg::100::1",
  previewState: "ready",
  missingState: "present",
  captureTime: "Pending EXIF",
  camera: "Pending EXIF",
  lens: "Pending EXIF",
  exposure: "Pending EXIF",
  iso: 0,
  previewUrl: "data:image/jpeg;base64,abc",
  aiDisposition: "keep",
  humanDisposition: "unseen",
  reasons: ["subject_is_sharp"],
  tags: ["system:imported", "player", "preview:ready"],
  evidence: [],
  ...overrides
});

const project = (assets: ReviewAsset[]): PersistedProject => ({
  id: "project-1",
  name: "Export preview",
  preset: "matchday-story",
  sourceFolder: "shoot",
  createdAt: "2026-07-11T00:00:00Z",
  updatedAt: "2026-07-11T00:00:00Z",
  assets,
  decisionRevision: 0,
  decisionEvents: [],
  tagEvents: []
});

describe("buildExportPreview", () => {
  it("projects selected JPEG decisions to the paired RAW sidecar without modifying originals", () => {
    const raw = asset({
      id: "raw-1",
      fileName: "frame-001.cr2",
      sourcePath: "shoot/frame-001.cr2",
      fileFingerprint: "shoot/frame-001.cr2::200::1",
      previewState: "raw-placeholder"
    });
    const jpeg = asset({
      id: "jpeg-1",
      rawPartnerId: raw.id,
      humanDisposition: "select"
    });

    const preview = buildExportPreview(project([jpeg, raw]));

    expect(preview.originalFilesModified).toBe(0);
    expect(preview.xmpFilesToWrite).toBe(1);
    expect(preview.targets[0]).toMatchObject({
      assetId: raw.id,
      sourceAssetId: jpeg.id,
      sidecarPath: "shoot/frame-001.xmp",
      humanDisposition: "select",
      rating: 5,
      colorLabel: "Green",
      operation: "add-or-update"
    });
    expect(preview.targets[0].keywords).toEqual(["player", "framescout:select"]);
  });

  it("includes a reversible CSV/JSON metadata map for every asset", () => {
    const selected = asset({
      id: "selected-1",
      humanDisposition: "select",
      tags: ["system:imported", "player", "manual:portfolio-pick", "preview:ready"],
      reasons: ["subject_is_sharp", "exposure_usable"]
    });
    const preview = buildExportPreview({
      ...project([selected]),
      decisionEvents: [
        {
          assetId: selected.id,
          previousHumanDisposition: "unseen",
          humanDisposition: "select",
          revision: 1,
          changedAt: "2026-07-11T00:01:00Z",
          actor: "human"
        }
      ],
      tagEvents: [
        {
          assetIds: [selected.id],
          tag: "manual:portfolio-pick",
          mutation: "add",
          changedAt: "2026-07-11T00:02:00Z",
          actor: "human"
        }
      ]
    });

    expect(preview.metadataRecords).toEqual([
      {
        assetId: "selected-1",
        fileName: "frame-001.jpg",
        sourcePath: "shoot/frame-001.jpg",
        humanDisposition: "select",
        aiDisposition: "keep",
        tags: ["system:imported", "player", "manual:portfolio-pick", "preview:ready"],
        reasons: ["subject_is_sharp", "exposure_usable"],
        lastDecisionAt: "2026-07-11T00:01:00Z",
        lastTagAt: "2026-07-11T00:02:00Z",
        modelVersion: "browser-phase-1"
      }
    ]);
    expect(preview.csvPreview.split("\n")[0]).toBe(
      "file,source_path,human_decision,ai_disposition,tags,reasons,last_decision_at,last_tag_at,model_version"
    );
    expect(preview.csvPreview).toContain('"system:imported;player;manual:portfolio-pick;preview:ready"');
    expect(preview.csvPreview).toContain('"browser-phase-1"');
  });

  it("skips unseen and missing assets from sidecar targets", () => {
    const preview = buildExportPreview(
      project([
        asset({ id: "unseen", fileName: "unseen.jpg", humanDisposition: "unseen" }),
        asset({ id: "missing", fileName: "missing.jpg", humanDisposition: "hold", missingState: "missing" })
      ])
    );

    expect(preview.targets).toHaveLength(0);
    expect(preview.skipped).toEqual([
      { assetId: "unseen", fileName: "unseen.jpg", reason: "unseen" },
      { assetId: "missing", fileName: "missing.jpg", reason: "missing-source" }
    ]);
  });

  it("does not project sidecars for paths containing traversal segments", () => {
    const preview = buildExportPreview(
      project([
        asset({
          id: "unsafe",
          fileName: "frame-001.jpg",
          sourcePath: "shoot/../../outside/frame-001.jpg",
          humanDisposition: "select"
        })
      ])
    );

    expect(preview.targets).toEqual([]);
    expect(preview.xmpFilesToWrite).toBe(0);
    expect(preview.skipped).toEqual([{ assetId: "unsafe", fileName: "frame-001.jpg", reason: "unsafe-source-path" }]);
  });

  it("normalizes Windows separators without changing a valid absolute source target", () => {
    const preview = buildExportPreview(
      project([
        asset({
          sourcePath: "D:\\Matchday\\frame.001.jpg",
          humanDisposition: "select"
        })
      ])
    );

    expect(preview.targets[0]?.sidecarPath).toBe("D:/Matchday/frame.001.xmp");
  });

  it("refines a decided export with folder and tag workset filters", () => {
    const portrait = asset({
      id: "portrait",
      sourcePath: "shoot/portraits/hero.jpg",
      fileName: "hero.jpg",
      humanDisposition: "select",
      tags: ["portfolio"]
    });
    const crowd = asset({
      id: "crowd",
      sourcePath: "shoot/crowd/hero.jpg",
      fileName: "hero.jpg",
      humanDisposition: "candidate",
      tags: ["atmosphere"]
    });

    const preview = buildExportPreview(project([portrait, crowd]), {
      settings: {
        ...defaultExportSettings,
        selectionScope: "decided",
        includedFolderGroups: ["shoot/portraits"],
        includedTags: ["portfolio"],
        filterMatch: "all"
      }
    });

    expect(preview.targets.map((target) => target.sourceAssetId)).toEqual(["portrait"]);
  });

  it("uses AI workflow tags as export filters without writing them into delivery keywords", () => {
    const preview = buildExportPreview(project([
      asset({ id: "keep", humanDisposition: "select", aiDisposition: "keep", tags: ["player"] }),
      asset({ id: "review", humanDisposition: "select", aiDisposition: "review", tags: ["player"] })
    ]), {
      settings: { ...defaultExportSettings, includedTags: ["workflow:ai:keep"] }
    });

    expect(preview.targets.map((target) => target.sourceAssetId)).toEqual(["keep"]);
    expect(preview.targets[0]?.keywords).not.toContain("workflow:ai:keep");
  });
});
