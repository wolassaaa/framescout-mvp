import type { ReviewAsset } from "@framescout/contracts";
import type { UiLanguage } from "../../i18n/uiCopy";
import { localizedTag } from "../../i18n/tagLabels";

export type ProjectedTagCategory = "content" | "ai-workflow" | "human-workflow" | "organization" | "technical";
export type ProjectedTagSource = "authored" | "ai" | "manual" | "derived";

export interface ProjectedTag {
  key: string;
  value: string;
  category: ProjectedTagCategory;
  source: ProjectedTagSource;
  exportableByDefault: boolean;
}

const hiddenAuthoredPrefixes = ["system:", "preview:", "pair:", "source:"];

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function add(tags: ProjectedTag[], tag: ProjectedTag) {
  if (!tags.some((item) => item.key === tag.key)) tags.push(tag);
}

function sourceForAuthoredTag(tag: string): ProjectedTagSource {
  if (tag.startsWith("ai:")) return "ai";
  if (tag.startsWith("manual:")) return "manual";
  return "authored";
}

function known(value: string | undefined, pendingPrefix?: string): value is string {
  if (!value?.trim()) return false;
  return !(pendingPrefix && value.startsWith(pendingPrefix));
}

export function projectAssetTags(asset: ReviewAsset): ProjectedTag[] {
  const tags: ProjectedTag[] = [];

  for (const tag of asset.tags) {
    if (hiddenAuthoredPrefixes.some((prefix) => tag.startsWith(prefix))) continue;
    add(tags, { key: tag, value: tag, category: "content", source: sourceForAuthoredTag(tag), exportableByDefault: true });
  }

  add(tags, { key: `workflow:ai:${asset.aiDisposition}`, value: asset.aiDisposition, category: "ai-workflow", source: "derived", exportableByDefault: false });
  add(tags, { key: `workflow:human:${asset.humanDisposition}`, value: asset.humanDisposition, category: "human-workflow", source: "derived", exportableByDefault: false });
  if (asset.aiRecommended) add(tags, { key: "workflow:ai:recommended", value: String(asset.aiSelectionRank ?? "recommended"), category: "ai-workflow", source: "derived", exportableByDefault: false });
  for (const reason of asset.reasons) add(tags, { key: `workflow:ai:reason:${reason}`, value: reason, category: "ai-workflow", source: "ai", exportableByDefault: false });
  for (const evidence of asset.evidence) {
    const key = `workflow:ai:evidence:${slug(evidence.label)}:${slug(evidence.value)}`;
    add(tags, { key, value: `${evidence.label}: ${evidence.value}`, category: "ai-workflow", source: "ai", exportableByDefault: false });
  }

  if (asset.groupId) add(tags, { key: `organization:burst:${asset.groupId}`, value: asset.groupId, category: "organization", source: "derived", exportableByDefault: false });
  if (asset.rawPartnerId || asset.mappingStatus === "mapped" || asset.mappingStatus === "manually_mapped") add(tags, { key: "organization:raw:mapped", value: asset.mappingStatus ?? "mapped", category: "organization", source: "derived", exportableByDefault: false });
  else if (asset.mappingStatus) add(tags, { key: `organization:raw:${asset.mappingStatus}`, value: asset.mappingStatus, category: "organization", source: "derived", exportableByDefault: false });
  if (asset.previewState) add(tags, { key: `organization:preview:${asset.previewState}`, value: asset.previewState, category: "organization", source: "derived", exportableByDefault: false });
  if (asset.missingState) add(tags, { key: `organization:source:${asset.missingState}`, value: asset.missingState, category: "organization", source: "derived", exportableByDefault: false });
  if (asset.sourcePath) {
    const folder = asset.sourcePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    if (folder) add(tags, { key: `organization:folder:${folder}`, value: folder, category: "organization", source: "derived", exportableByDefault: false });
  }

  if (known(asset.camera, "Pending")) add(tags, { key: `technical:camera:${asset.camera}`, value: asset.camera, category: "technical", source: "derived", exportableByDefault: false });
  if (known(asset.lens, "Pending")) add(tags, { key: `technical:lens:${asset.lens}`, value: asset.lens, category: "technical", source: "derived", exportableByDefault: false });
  if (known(asset.exposure, "Pending")) add(tags, { key: `technical:exposure:${asset.exposure}`, value: asset.exposure, category: "technical", source: "derived", exportableByDefault: false });
  if (asset.iso > 0) add(tags, { key: `technical:iso:${asset.iso}`, value: String(asset.iso), category: "technical", source: "derived", exportableByDefault: false });
  if (known(asset.captureTime, "Pending")) add(tags, { key: `technical:capture:${asset.captureTime}`, value: asset.captureTime, category: "technical", source: "derived", exportableByDefault: false });

  return tags;
}

export function tagSearchText(asset: ReviewAsset): string {
  return projectAssetTags(asset).flatMap((tag) => [tag.key, tag.value]).join(" ").toLowerCase();
}

export function localizedProjectedTag(tag: ProjectedTag, language: UiLanguage): string {
  if (tag.category === "content") return localizedTag(tag.key, language);
  const fixed: Record<string, [string, string]> = {
    "workflow:ai:keep": ["AI 建议保留", "AI keep"],
    "workflow:ai:review": ["AI 需要复核", "AI review"],
    "workflow:ai:reject": ["AI 建议淘汰", "AI reject"],
    "workflow:ai:recommended": ["AI 推荐", "AI recommended"],
    "workflow:human:unseen": ["人工未判断", "Human unrated"],
    "workflow:human:candidate": ["人工候选", "Human candidate"],
    "workflow:human:select": ["人工精选", "Human selected"],
    "workflow:human:hold": ["人工保留观察", "Human hold"],
    "workflow:human:reject": ["人工淘汰", "Human reject"]
  };
  const label = fixed[tag.key];
  if (label) return label[language === "zh" ? 0 : 1];
  if (tag.category === "ai-workflow" && tag.key.startsWith("workflow:ai:reason:")) return language === "zh" ? `AI 判断 · ${tag.value}` : `AI reason · ${tag.value}`;
  if (tag.category === "ai-workflow" && tag.key.startsWith("workflow:ai:evidence:")) return language === "zh" ? `AI 证据 · ${tag.value}` : `AI evidence · ${tag.value}`;
  if (tag.category === "organization") return language === "zh" ? `文件 · ${tag.value}` : `File · ${tag.value}`;
  return language === "zh" ? `拍摄 · ${tag.value}` : `Technical · ${tag.value}`;
}
