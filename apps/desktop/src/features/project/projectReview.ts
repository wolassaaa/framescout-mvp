import type { PersistedProject, ReviewAsset, ReviewNextResponse } from "@framescout/contracts";

export function reviewQueue(project: PersistedProject, options: { showAiRejects?: boolean } = {}): ReviewAsset[] {
  return options.showAiRejects
    ? project.assets
    : project.assets.filter((asset) => asset.aiDisposition !== "reject" || asset.humanDisposition !== "unseen");
}

export function reviewNext(
  project: PersistedProject,
  input: { cursor: number; direction?: "next" | "previous"; showAiRejects?: boolean }
): ReviewNextResponse {
  const queue = reviewQueue(project, { showAiRejects: input.showAiRejects });
  if (queue.length === 0) {
    return {
      asset: null,
      cursor: 0,
      queueLength: 0
    };
  }
  const delta = input.direction === "previous" ? -1 : 1;
  const cursor = Math.max(0, Math.min(input.cursor + delta, queue.length - 1));
  return {
    asset: queue[cursor],
    cursor,
    queueLength: queue.length
  };
}
