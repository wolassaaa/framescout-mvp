import { describe, expect, it } from "vitest";
import { assets } from "../../data/fixtures";
import { projectAssetTags } from "./tagProjection";

describe("projectAssetTags", () => {
  it("keeps authored content and projects AI, human, organization, and technical states", () => {
    const asset = {
      ...assets[0],
      aiRecommended: true,
      aiSelectionRank: 7,
      humanDisposition: "select" as const,
      rawPartnerId: "raw-001",
      mappingStatus: "mapped" as const,
      previewState: "ready" as const
    };

    const tags = projectAssetTags(asset);

    expect(tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "player", category: "content", source: "authored", exportableByDefault: true }),
      expect.objectContaining({ key: "workflow:ai:keep", category: "ai-workflow", source: "derived" }),
      expect.objectContaining({ key: "workflow:ai:recommended", value: "7", category: "ai-workflow" }),
      expect.objectContaining({ key: "workflow:human:select", category: "human-workflow", source: "derived" }),
      expect.objectContaining({ key: "organization:raw:mapped", category: "organization", source: "derived" }),
      expect.objectContaining({ key: "organization:preview:ready", category: "organization", source: "derived" }),
      expect.objectContaining({ key: "technical:camera:Canon EOS 6D Mark II", category: "technical", source: "derived" })
    ]));
  });
});
