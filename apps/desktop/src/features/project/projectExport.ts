import type {
  ExportMetadataRecord,
  ExportSettings,
  ExportCopyTarget,
  ExportPreviewResponse,
  ExportPreviewSkippedAsset,
  ExportPreviewTarget,
  HumanDisposition,
  PersistedProject,
  ReviewAsset
} from "@framescout/contracts";
import { projectAssetTags } from "../coverage/tagProjection";

const dispositionExportMap: Record<Exclude<HumanDisposition, "unseen">, { rating: number; colorLabel: string }> = {
  candidate: { rating: 3, colorLabel: "Yellow" },
  select: { rating: 5, colorLabel: "Green" },
  hold: { rating: 2, colorLabel: "Blue" },
  reject: { rating: 1, colorLabel: "Red" }
};

const browserModelVersion = "browser-phase-1";

export const defaultExportSettings: ExportSettings = {
  destinationDir: "",
  selectionScope: "selected",
  includedFolderGroups: [],
  includedTags: [],
  excludedTags: [],
  filterMatch: "all",
  media: "proxies-and-raw",
  rawLayout: "raw-subfolder",
  preserveFolderStructure: true,
  includeXmp: true,
  includeCsv: true,
  collision: "rename"
};

export function folderGroupFor(sourcePath?: string): string | null {
  const normalized = sourcePath?.trim().replace(/\\/g, "/");
  if (!normalized) return null;
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : null;
}

function matchesExportFilters(asset: ReviewAsset, settings: ExportSettings): boolean {
  const projectedTags = projectAssetTags(asset).map((tag) => tag.key);
  if (projectedTags.some((tag) => settings.excludedTags.includes(tag))) return false;
  const folderGroups = settings.includedFolderGroups;
  const tags = settings.includedTags;
  if (folderGroups.length === 0 && tags.length === 0) return true;

  const folderMatches = folderGroups.length > 0 && folderGroups.includes(folderGroupFor(asset.sourcePath) ?? "");
  const tagMatches = tags.length > 0 && projectedTags.some((tag) => tags.includes(tag));
  if (folderGroups.length === 0) return tagMatches;
  if (tags.length === 0) return folderMatches;
  return settings.filterMatch === "all" ? folderMatches && tagMatches : folderMatches || tagMatches;
}

export function sidecarPathFor(sourcePath: string): string | null {
  const normalized = sourcePath.trim().replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0")) return null;

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return null;

  const fileName = segments.at(-1);
  if (!fileName) return null;
  const extensionIndex = fileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  if (!stem) return null;

  segments[segments.length - 1] = `${stem}.xmp`;
  return segments.join("/");
}

function keywordsFor(asset: ReviewAsset, includeAiReasonKeywords: boolean): string[] {
  const humanTags = projectAssetTags(asset).filter((tag) => tag.exportableByDefault).map((tag) => tag.key);
  const aiReasons = includeAiReasonKeywords ? asset.reasons.map((reason) => `ai:${reason}`) : [];
  return Array.from(new Set([...humanTags, `framescout:${asset.humanDisposition}`, ...aiReasons]));
}

function skipped(asset: ReviewAsset, reason: ExportPreviewSkippedAsset["reason"]): ExportPreviewSkippedAsset {
  return {
    assetId: asset.id,
    fileName: asset.fileName,
    reason
  };
}

function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function metadataRecordsFor(project: PersistedProject): ExportMetadataRecord[] {
  return project.assets.map((asset) => {
    const lastDecisionAt = project.decisionEvents
      ?.filter((event) => event.assetId === asset.id)
      .at(-1)?.changedAt;
    const lastTagAt = project.tagEvents
      ?.filter((event) => event.assetIds.includes(asset.id))
      .at(-1)?.changedAt;

    return {
      assetId: asset.id,
      fileName: asset.fileName,
      sourcePath: asset.sourcePath,
      humanDisposition: asset.humanDisposition,
      aiDisposition: asset.aiDisposition,
      tags: [...asset.tags],
      reasons: [...asset.reasons],
      lastDecisionAt,
      lastTagAt,
      modelVersion: browserModelVersion
    };
  });
}

function csvPreviewFor(records: ExportMetadataRecord[]): string {
  const header = [
    "file",
    "source_path",
    "human_decision",
    "ai_disposition",
    "tags",
    "reasons",
    "last_decision_at",
    "last_tag_at",
    "model_version"
  ];
  const rows = records.map((record) =>
    [
      record.fileName,
      record.sourcePath,
      record.humanDisposition,
      record.aiDisposition,
      record.tags.join(";"),
      record.reasons.join(";"),
      record.lastDecisionAt,
      record.lastTagAt,
      record.modelVersion
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

export function buildExportPreview(
  project: PersistedProject,
  options: { includeAiReasonKeywords?: boolean; settings?: ExportSettings } = {}
): ExportPreviewResponse {
  const settings = options.settings ?? defaultExportSettings;
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const targetsBySidecar = new Map<string, ExportPreviewTarget>();
  const skippedAssets: ExportPreviewSkippedAsset[] = [];
  const filesToCopy: ExportCopyTarget[] = [];

  for (const asset of project.assets) {
    if (asset.missingState === "missing") {
      skippedAssets.push(skipped(asset, "missing-source"));
      continue;
    }
    const included = settings.selectionScope === "selected"
      ? asset.humanDisposition === "select"
      : asset.humanDisposition !== "unseen" && asset.humanDisposition !== "reject";
    if (!included || !matchesExportFilters(asset, settings)) {
      skippedAssets.push(skipped(asset, "unseen"));
      continue;
    }
    const targetAsset = asset.rawPartnerId ? assetsById.get(asset.rawPartnerId) ?? asset : asset;
    if (!targetAsset.sourcePath) {
      skippedAssets.push(skipped(asset, "no-source-path"));
      continue;
    }

    const humanDisposition = asset.humanDisposition as Exclude<HumanDisposition, "unseen">;
    const exportPolicy = dispositionExportMap[humanDisposition];
    const sidecarPath = sidecarPathFor(targetAsset.sourcePath);
    if (!sidecarPath) {
      skippedAssets.push(skipped(asset, "unsafe-source-path"));
      continue;
    }
    targetsBySidecar.set(sidecarPath, {
      assetId: targetAsset.id,
      sourceAssetId: asset.id,
      fileName: targetAsset.fileName,
      sidecarPath,
      humanDisposition,
      rating: exportPolicy.rating,
      colorLabel: exportPolicy.colorLabel,
      keywords: keywordsFor(asset, Boolean(options.includeAiReasonKeywords)),
      operation: "add-or-update"
    });
    if (settings.destinationDir) {
      const destinationRoot = settings.destinationDir.replace(/[\\/]+$/, "");
      if (settings.media !== "raw") {
        filesToCopy.push({
          assetId: asset.id,
          sourcePath: asset.sourcePath ?? "",
          destinationPath: `${destinationRoot}/selected/${asset.fileName}`,
          kind: "proxy"
        });
      }
      if (settings.media !== "proxies" && targetAsset.sourcePath) {
        filesToCopy.push({
          assetId: targetAsset.id,
          sourcePath: targetAsset.sourcePath,
          destinationPath: `${destinationRoot}/${settings.rawLayout === "raw-subfolder" ? "RAW" : "selected"}/${targetAsset.fileName}`,
          kind: "raw"
        });
      }
    }
  }

  const targets = Array.from(targetsBySidecar.values()).sort((left, right) => left.sidecarPath.localeCompare(right.sidecarPath));
  const metadataRecords = metadataRecordsFor(project);
  return {
    projectId: project.id,
    originalFilesModified: 0,
    settings,
    filesToCopy,
    xmpFilesToWrite: settings.includeXmp ? targets.length : 0,
    targets,
    skipped: skippedAssets,
    metadataRecords,
    csvPreview: csvPreviewFor(metadataRecords)
  };
}
