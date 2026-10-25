import type { AiDisposition, ReviewAsset } from "@framescout/contracts";

export type AiReviewStatus = "pending" | AiDisposition;
export type ReviewMode = "assisted" | "all" | "reject-audit";

export function aiReviewStatus(asset: ReviewAsset): AiReviewStatus {
  return asset.evidence.length > 0 ? asset.aiDisposition : "pending";
}

export function matchesReviewMode(asset: ReviewAsset, mode: ReviewMode): boolean {
  const status = aiReviewStatus(asset);

  if (mode === "all") return true;
  if (mode === "reject-audit") return status === "reject";
  return status !== "reject" || asset.humanDisposition !== "unseen";
}
