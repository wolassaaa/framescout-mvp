import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assets } from "../../data/fixtures";
import { CoverageView } from "./CoverageView";

describe("CoverageView", () => {
  afterEach(cleanup);
  it("opens a derived AI workflow tag and its matching assets", () => {
    const dispatch = vi.fn();

    render(createElement(CoverageView, {
      language: "en",
      assets: [assets[0]],
      selectedAssetIds: [],
      dispatch,
      onApplyManualTag: vi.fn()
    }));

    fireEvent.click(screen.getByRole("button", { name: "AI keep 1 0" }));

    expect(screen.getByRole("button", { name: `${assets[0].fileName} Unrated` })).toBeVisible();
  });

  it("uses the shared session selection when marking frames from a tag", () => {
    const tagged = { ...assets[0], tags: ["player"] };
    const dispatch = vi.fn();

    render(createElement(CoverageView, {
      language: "en",
      assets: [tagged],
      selectedAssetIds: [],
      dispatch,
      onApplyManualTag: vi.fn()
    }));

    fireEvent.click(screen.getByRole("button", { name: "player 1 0" }));
    fireEvent.click(screen.getByRole("button", { name: `${tagged.fileName} Unrated` }));

    expect(dispatch).toHaveBeenCalledWith({ type: "toggleGridSelection", assetId: tagged.id });
  });
});
