import { describe, expect, it } from "vitest";
import type { PersistedProject, ReviewAsset } from "@framescout/contracts";
import { reviewNext, reviewQueue } from "./projectReview";

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

const project = (assets: ReviewAsset[]): PersistedProject => ({
  id: "project-1",
  name: "Review next",
  preset: "matchday-story",
  sourceFolder: "shoot",
  createdAt: "2026-07-11T00:00:00Z",
  updatedAt: "2026-07-11T00:00:00Z",
  assets,
  decisionRevision: 0,
  decisionEvents: []
});

describe("reviewNext", () => {
  it("skips unseen AI rejects in the normal queue but keeps rescued rejects", () => {
    const keep = asset({ id: "keep", aiDisposition: "keep" });
    const unseenReject = asset({ id: "reject-hidden", aiDisposition: "reject" });
    const selectedReject = asset({ id: "reject-selected", aiDisposition: "reject", humanDisposition: "select" });

    const queue = reviewQueue(project([keep, unseenReject, selectedReject]));

    expect(queue.map((item) => item.id)).toEqual(["keep", "reject-selected"]);
  });

  it("returns the next or previous asset with a bounded cursor", () => {
    const response = reviewNext(project([asset({ id: "first" }), asset({ id: "second" })]), {
      cursor: 0,
      direction: "next"
    });
    const previous = reviewNext(project([asset({ id: "first" }), asset({ id: "second" })]), {
      cursor: 1,
      direction: "previous"
    });

    expect(response).toMatchObject({ cursor: 1, queueLength: 2, asset: { id: "second" } });
    expect(previous).toMatchObject({ cursor: 0, queueLength: 2, asset: { id: "first" } });
  });
});
