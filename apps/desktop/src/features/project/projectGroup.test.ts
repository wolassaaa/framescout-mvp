import { describe, expect, it } from "vitest";
import type { PersistedProject, ReviewAsset } from "@framescout/contracts";
import { openGroup } from "./projectGroup";

const asset = (overrides: Partial<ReviewAsset>): ReviewAsset => ({
  id: "asset-1",
  fileName: "frame.jpg",
  captureTime: "Pending EXIF",
  camera: "Pending EXIF",
  lens: "Pending EXIF",
  exposure: "Pending EXIF",
  iso: 0,
  previewUrl: "data:image/jpeg;base64,abc",
  aiDisposition: "keep",
  humanDisposition: "unseen",
  reasons: [],
  tags: [],
  evidence: [],
  ...overrides
});

const project: PersistedProject = {
  id: "project-1",
  name: "Group projection",
  preset: "matchday-story",
  sourceFolder: "shoot",
  createdAt: "2026-07-11T00:00:00Z",
  updatedAt: "2026-07-11T00:00:00Z",
  assets: [
    asset({ id: "a", groupId: "burst-1" }),
    asset({ id: "b", groupId: "burst-1" }),
    asset({ id: "c", groupId: "burst-2" })
  ],
  decisionRevision: 0,
  decisionEvents: []
};

describe("openGroup", () => {
  it("returns ordered group assets and focus index", () => {
    const response = openGroup(project, { groupId: "burst-1", focusAssetId: "b" });

    expect(response.groupId).toBe("burst-1");
    expect(response.assets.map((item) => item.id)).toEqual(["a", "b"]);
    expect(response.focusIndex).toBe(1);
    expect(response.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Group size", value: "2 of 3 project assets" })
      ])
    );
  });
});
