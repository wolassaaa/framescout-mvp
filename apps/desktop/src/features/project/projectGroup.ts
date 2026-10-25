import type { EvidenceSignal, GroupOpenResponse, PersistedProject } from "@framescout/contracts";

function groupEvidence(projectAssetCount: number, groupAssetCount: number): EvidenceSignal[] {
  return [
    {
      label: "Group size",
      value: `${groupAssetCount} of ${projectAssetCount} project assets`,
      tone: "neutral"
    },
    {
      label: "Comparison basis",
      value: "import order and shared group id",
      tone: "review"
    }
  ];
}

export function openGroup(
  project: PersistedProject,
  input: { groupId: string; focusAssetId?: string }
): GroupOpenResponse {
  const assets = project.assets.filter((asset) => asset.groupId === input.groupId);
  const focusIndex = Math.max(
    0,
    input.focusAssetId ? assets.findIndex((asset) => asset.id === input.focusAssetId) : 0
  );

  return {
    groupId: input.groupId,
    assets,
    focusIndex,
    evidence: groupEvidence(project.assets.length, assets.length)
  };
}
