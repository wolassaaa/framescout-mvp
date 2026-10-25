import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assets } from "../../data/fixtures";
import { GridView, matchesTagSearch, moveGalleryCursor } from "./GridView";
import { createInitialReviewState } from "../review/reviewState";

afterEach(cleanup);

describe("moveGalleryCursor", () => {
  it("finds AI workflow and technical tags through the same grid search", () => {
    expect(matchesTagSearch({ ...assets[0], aiRecommended: true }, "workflow:ai:recommended")).toBe(true);
    expect(matchesTagSearch(assets[0], "technical:camera:canon eos 6d mark ii")).toBe(true);
  });

  it("offers review modes plus AI-reviewed and awaiting-AI filters", () => {
    const dispatch = vi.fn();

    render(createElement(GridView, {
      language: "en",
      state: createInitialReviewState([
        ...assets,
        { ...assets[0], id: "pending-ai", evidence: [] }
      ]),
      dispatch,
      exportPreview: null,
      onExportPreview: vi.fn(),
      manualTagDraft: "",
      onManualTagDraftChange: vi.fn(),
      onApplyManualTag: vi.fn(),
      onOpenDuel: vi.fn()
    }));

    expect(screen.getByRole("button", { name: "Assisted" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reject audit" })).toBeVisible();
    expect(screen.getByRole("button", { name: "AI reviewed" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Awaiting AI" })).toBeVisible();
    expect(screen.getByRole("button", { name: "AI picks" })).toBeVisible();
  });

  it("lets an explicit soft-focus filter reveal an AI reject hidden by assisted mode", () => {
    render(createElement(GridView, {
      language: "en",
      state: createInitialReviewState(assets),
      dispatch: vi.fn(),
      exportPreview: null,
      onExportPreview: vi.fn(),
      manualTagDraft: "",
      onManualTagDraftChange: vi.fn(),
      onApplyManualTag: vi.fn(),
      onOpenDuel: vi.fn()
    }));

    fireEvent.click(screen.getByRole("button", { name: "Soft focus" }));

    expect(screen.getByRole("button", { name: /6D2_7423\.CR2/ })).toBeVisible();
  });

  it("moves within rows without wrapping across row edges", () => {
    expect(moveGalleryCursor(0, "a", 4, 8)).toBe(0);
    expect(moveGalleryCursor(3, "d", 4, 8)).toBe(3);
    expect(moveGalleryCursor(1, "d", 4, 8)).toBe(2);
  });

  it("moves vertically only when the target cell exists", () => {
    expect(moveGalleryCursor(1, "s", 4, 8)).toBe(5);
    expect(moveGalleryCursor(1, "s", 4, 3)).toBe(1);
    expect(moveGalleryCursor(5, "w", 4, 8)).toBe(1);
  });

  it("selects every logical filtered result beyond the 240-tile render cap without changing decisions", () => {
    const logicalAssets = Array.from({ length: 241 }, (_, index) => ({
      ...assets[0],
      id: `logical-${index}`,
      humanDisposition: "unseen" as const,
      previewState: "fixture" as const
    }));
    const baseline = structuredClone(logicalAssets);
    const dispatch = vi.fn();

    render(createElement(GridView, {
      language: "en",
      state: createInitialReviewState(logicalAssets),
      dispatch,
      exportPreview: null,
      onExportPreview: vi.fn(),
      manualTagDraft: "",
      onManualTagDraftChange: vi.fn(),
      onApplyManualTag: vi.fn(),
      onOpenDuel: vi.fn()
    }));

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "selectAssets",
      assetIds: logicalAssets.map((asset) => asset.id)
    });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setDecisionForMany" }));
    expect(logicalAssets).toEqual(baseline);
  });

  it("uses one unambiguous Select all command for the complete session", () => {
    const sessionAssets = [
      { ...assets[0], id: "session-visible", humanDisposition: "unseen" as const, previewState: "fixture" as const },
      { ...assets[1], id: "session-selected", humanDisposition: "select" as const, previewState: "fixture" as const }
    ];
    const dispatch = vi.fn();

    render(createElement(GridView, {
      language: "en",
      state: createInitialReviewState(sessionAssets),
      dispatch,
      exportPreview: null,
      onExportPreview: vi.fn(),
      manualTagDraft: "",
      onManualTagDraftChange: vi.fn(),
      onApplyManualTag: vi.fn(),
      onOpenDuel: vi.fn()
    }));

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "selectAssets",
      assetIds: sessionAssets.map((asset) => asset.id)
    });
    expect(screen.queryByRole("button", { name: "Select session" })).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setDecisionForMany" }));

    dispatch.mockClear();
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(dispatch).toHaveBeenCalledWith({
      type: "selectAssets",
      assetIds: sessionAssets.map((asset) => asset.id)
    });
  });
});
