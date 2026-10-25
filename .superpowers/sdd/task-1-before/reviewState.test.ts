import { describe, expect, it } from "vitest";
import { assets } from "../../data/fixtures";
import { createInitialReviewState, normalizeManualTag, reviewReducer, visibleAssets } from "./reviewState";

describe("reviewReducer", () => {
  it("keeps AI rejects recoverable but hidden by default", () => {
    const state = createInitialReviewState(assets);

    expect(visibleAssets(state).map((asset) => asset.aiDisposition)).toEqual(["keep", "review"]);

    const withRejects = reviewReducer(state, { type: "toggleRejects" });
    expect(visibleAssets(withRejects).map((asset) => asset.aiDisposition)).toEqual(["keep", "review", "reject"]);
  });

  it("keeps pending and failed proxies out of the review queue", () => {
    const state = createInitialReviewState([
      { ...assets[0], id: "pending", previewState: "pending" },
      { ...assets[0], id: "failed", previewState: "failed" },
      { ...assets[0], id: "ready", previewState: "ready" }
    ]);

    expect(visibleAssets(state).map((asset) => asset.id)).toEqual(["ready"]);
  });

  it("filters the review queue without mutating the underlying project assets", () => {
    const state = createInitialReviewState(assets);
    const noAthlete = reviewReducer(state, { type: "setReviewFilter", filter: "no-athlete" });
    const softFocus = reviewReducer(state, { type: "setReviewFilter", filter: "soft-focus" });
    const rejects = reviewReducer(state, { type: "setReviewFilter", filter: "reject" });

    expect(visibleAssets(noAthlete).map((asset) => asset.id)).toEqual(["fs-002"]);
    expect(visibleAssets(softFocus).map((asset) => asset.id)).toEqual([]);
    expect(visibleAssets(rejects).map((asset) => asset.id)).toEqual(["fs-003"]);
    expect(rejects.assets).toEqual(assets);
  });

  it("shows only the project-wide AI recommendation list", () => {
    const state = createInitialReviewState(assets.map((asset, index) => ({
      ...asset,
      aiRecommended: index < 2,
      aiSelectionRank: index < 2 ? index + 1 : undefined
    })));
    const recommended = reviewReducer(state, { type: "setReviewFilter", filter: "recommended" });

    expect(recommended.reviewFilter).toBe("recommended");
    expect(visibleAssets(recommended).map((asset) => asset.id)).toEqual(["fs-001", "fs-002"]);
  });

  it("records human decisions without changing AI disposition", () => {
    const state = createInitialReviewState(assets);
    const next = reviewReducer(state, { type: "setDecision", disposition: "select" });

    expect(next.assets[0].humanDisposition).toBe("select");
    expect(next.assets[0].aiDisposition).toBe("keep");
  });

  it("updates a specified burst frame without moving the review cursor", () => {
    const state = createInitialReviewState(assets);
    const next = reviewReducer(state, { type: "setDecisionFor", assetId: "fs-003", disposition: "select" });

    expect(next.cursor).toBe(0);
    expect(next.assets.find((asset) => asset.id === "fs-003")).toMatchObject({
      aiDisposition: "reject",
      humanDisposition: "select"
    });
    expect(reviewReducer(next, { type: "undo" }).assets.find((asset) => asset.id === "fs-003")?.humanDisposition).toBe("unseen");
  });

  it("opens and closes the Review Desk manual-tag editor without changing assets", () => {
    const state = createInitialReviewState(assets);
    const opened = reviewReducer(state, { type: "toggleTagEditor" });
    const closed = reviewReducer(opened, { type: "closeTagEditor" });

    expect(opened.tagEditorOpen).toBe(true);
    expect(opened.assets).toEqual(assets);
    expect(closed.tagEditorOpen).toBe(false);
  });

  it("keeps grid selection separate from human decisions and applies a bulk decision deliberately", () => {
    const state = createInitialReviewState(assets);
    const marked = reviewReducer(reviewReducer(state, { type: "toggleGridSelection", assetId: "fs-001" }), {
      type: "toggleGridSelection",
      assetId: "fs-002"
    });
    const decided = reviewReducer(marked, {
      type: "setDecisionForMany",
      assetIds: marked.gridSelection,
      disposition: "hold"
    });

    expect(marked.gridSelection).toEqual(["fs-001", "fs-002"]);
    expect(marked.assets.every((asset) => asset.humanDisposition === "unseen")).toBe(true);
    expect(decided.assets.slice(0, 2).map((asset) => asset.humanDisposition)).toEqual(["hold", "hold"]);
    expect(reviewReducer(decided, { type: "clearGridSelection" }).gridSelection).toEqual([]);
  });

  it("clamps Grid density to the supported three-to-eight column range", () => {
    let state = createInitialReviewState(assets);
    for (let index = 0; index < 8; index += 1) state = reviewReducer(state, { type: "adjustGridDensity", delta: 1 });
    expect(state.gridDensity).toBe(8);
    for (let index = 0; index < 10; index += 1) state = reviewReducer(state, { type: "adjustGridDensity", delta: -1 });
    expect(state.gridDensity).toBe(3);
  });

  it("keeps human-rescued AI rejects visible in the normal queue", () => {
    const state = createInitialReviewState(assets);
    const withRejects = reviewReducer(state, { type: "toggleRejects" });
    const rejectCursor = visibleAssets(withRejects).findIndex((asset) => asset.aiDisposition === "reject");
    const focusedReject = reviewReducer(withRejects, { type: "setCursor", cursor: rejectCursor });
    const selectedReject = reviewReducer(focusedReject, { type: "setDecision", disposition: "select" });
    const normalQueue = reviewReducer(selectedReject, { type: "toggleRejects" });

    expect(visibleAssets(normalQueue).map((asset) => asset.id)).toContain("fs-003");
    expect(visibleAssets(normalQueue).find((asset) => asset.id === "fs-003")).toMatchObject({
      aiDisposition: "reject",
      humanDisposition: "select"
    });
  });

  it("keeps assets that need relinking visible so the source can be repaired", () => {
    const missingAsset = {
      ...assets[0],
      missingState: "missing" as const,
      previewState: "needs-relink" as const
    };
    const state = createInitialReviewState([missingAsset]);

    expect(visibleAssets(state)).toEqual([missingAsset]);
  });

  it("applies manual tags without overwriting system tags and supports undo", () => {
    const state = createInitialReviewState(assets);
    const tagged = reviewReducer(state, { type: "applyManualTag", assetIds: ["fs-001"], tag: "Portfolio Pick" });
    const taggedAgain = reviewReducer(tagged, { type: "applyManualTag", assetIds: ["fs-001"], tag: "manual:portfolio-pick" });
    const undone = reviewReducer(taggedAgain, { type: "undo" });

    expect(normalizeManualTag(" Portfolio Pick ")).toBe("manual:portfolio-pick");
    expect(tagged.assets[0].tags).toEqual(expect.arrayContaining(["player", "manual:portfolio-pick"]));
    expect(taggedAgain.assets[0].tags.filter((tag) => tag === "manual:portfolio-pick")).toHaveLength(1);
    expect(undone.assets[0].tags.filter((tag) => tag === "manual:portfolio-pick")).toHaveLength(1);
  });

  it("supports undo and redo for keyboard review", () => {
    const state = createInitialReviewState(assets);
    const selected = reviewReducer(state, { type: "setDecision", disposition: "select" });
    const undone = reviewReducer(selected, { type: "undo" });
    const redone = reviewReducer(undone, { type: "redo" });

    expect(undone.assets[0].humanDisposition).toBe("unseen");
    expect(redone.assets[0].humanDisposition).toBe("select");
  });
});
