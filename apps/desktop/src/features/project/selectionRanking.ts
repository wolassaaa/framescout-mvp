import type { ReviewAsset } from "@framescout/contracts";

const dispositionWeight = { keep: 300, review: 150, reject: 0 } as const;
const toneWeight = { keep: 1, neutral: 0.25, review: -0.25, reject: -1 } as const;

function scoreAsset(asset: ReviewAsset): number {
  const evidenceScore = asset.evidence.reduce((sum, signal) => {
    const confidence = signal.confidence ?? 0.5;
    return sum + toneWeight[signal.tone] * confidence * 100;
  }, 0);
  const missingPenalty = asset.missingState === "missing" || asset.previewState === "needs-relink" ? 10_000 : 0;
  return Math.round((dispositionWeight[asset.aiDisposition] + evidenceScore - missingPenalty) * 100) / 100;
}

function eligible(asset: ReviewAsset): boolean {
  return (asset.previewState === "ready" || asset.previewState === "fixture")
    && asset.evidence.length > 0
    && asset.aiDisposition !== "reject"
    && asset.missingState !== "missing";
}

/**
 * Builds an exact, deterministic recommendation list. The first pass contributes
 * one best frame per burst; a second pass fills the remaining project-wide slots.
 */
export function rankAssetsForSelection(assets: ReviewAsset[], targetCount: number): ReviewAsset[] {
  const target = Math.max(1, Math.round(targetCount));
  const ranked = assets
    .filter(eligible)
    .map((asset, index) => ({ asset, index, score: scoreAsset(asset) }))
    .sort((left, right) => right.score - left.score || left.asset.fileName.localeCompare(right.asset.fileName) || left.index - right.index);

  const bestPerGroup = new Map<string, typeof ranked[number]>();
  for (const candidate of ranked) {
    const group = candidate.asset.groupId ?? `asset:${candidate.asset.id}`;
    if (!bestPerGroup.has(group)) bestPerGroup.set(group, candidate);
  }
  const firstPass = Array.from(bestPerGroup.values())
    .sort((left, right) => right.score - left.score || left.asset.fileName.localeCompare(right.asset.fileName));
  const chosen = firstPass.slice(0, target);
  const chosenIds = new Set(chosen.map(({ asset }) => asset.id));
  if (chosen.length < target) {
    for (const candidate of ranked) {
      if (chosen.length >= target) break;
      if (chosenIds.has(candidate.asset.id)) continue;
      chosen.push(candidate);
      chosenIds.add(candidate.asset.id);
    }
  }

  const rankById = new Map(chosen.map((candidate, index) => [candidate.asset.id, { rank: index + 1, score: candidate.score }]));
  const scoreById = new Map(ranked.map((candidate) => [candidate.asset.id, candidate.score]));
  return assets.map((asset) => {
    const recommendation = rankById.get(asset.id);
    return {
      ...asset,
      aiRecommended: Boolean(recommendation),
      aiSelectionRank: recommendation?.rank,
      aiSelectionScore: scoreById.get(asset.id)
    };
  });
}
