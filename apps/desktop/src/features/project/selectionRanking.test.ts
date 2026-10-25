import { describe, expect, it } from "vitest";
import type { ReviewAsset } from "@framescout/contracts";
import { rankAssetsForSelection } from "./selectionRanking";

const asset = (id: string, groupId: string, confidence: number): ReviewAsset => ({
  id, groupId, fileName: `${id}.jpg`, captureTime: "", camera: "", lens: "", exposure: "", iso: 0,
  previewUrl: id, previewState: "ready", aiDisposition: "keep", humanDisposition: "unseen",
  reasons: [], tags: [], evidence: [{ label: "quality", value: "usable", confidence, tone: "keep" }]
});

describe("selection ranking", () => {
  it("returns exactly the requested number when enough eligible frames exist", () => {
    const ranked = rankAssetsForSelection([
      asset("a", "burst-1", 0.9), asset("b", "burst-1", 0.8), asset("c", "burst-2", 0.7), asset("d", "burst-3", 0.6)
    ], 3);
    expect(ranked.filter((item) => item.aiRecommended)).toHaveLength(3);
    expect(ranked.find((item) => item.id === "a")?.aiSelectionRank).toBe(1);
  });

  it("protects burst diversity before filling additional slots", () => {
    const ranked = rankAssetsForSelection([
      asset("a", "burst-1", 0.99), asset("b", "burst-1", 0.98), asset("c", "burst-2", 0.5)
    ], 2);
    expect(ranked.filter((item) => item.aiRecommended).map((item) => item.id).sort()).toEqual(["a", "c"]);
  });

  it("does not rank RAW placeholders or missing proxies", () => {
    const raw = { ...asset("raw", "burst-2", 1), previewState: "raw-placeholder" as const };
    const ranked = rankAssetsForSelection([asset("a", "burst-1", 0.5), raw], 2);
    expect(ranked.filter((item) => item.aiRecommended)).toHaveLength(1);
    expect(ranked.find((item) => item.id === "raw")?.aiRecommended).toBe(false);
  });

  it("does not fill the target with AI rejects", () => {
    const rejected = { ...asset("reject", "burst-2", 1), aiDisposition: "reject" as const };
    const ranked = rankAssetsForSelection([asset("a", "burst-1", 0.5), rejected], 2);
    expect(ranked.filter((item) => item.aiRecommended).map((item) => item.id)).toEqual(["a"]);
  });

  it("does not create AI recommendations before a ready proxy has AI evidence", () => {
    const pending = { ...asset("pending", "burst-1", 1), previewState: "pending" as const };
    const unscored = { ...asset("unscored", "burst-2", 1), evidence: [] };
    const ranked = rankAssetsForSelection([pending, unscored], 50);

    expect(ranked.filter((item) => item.aiRecommended)).toHaveLength(0);
  });
});
