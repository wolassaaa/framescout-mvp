import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { assets } from "../../data/fixtures";
import { AiReviewMark } from "./AiReviewMark";

describe("AiReviewMark", () => {
  it("renders no mark for an asset without persisted AI evidence", () => {
    const { container } = render(createElement(AiReviewMark, {
      asset: { ...assets[0], evidence: [] },
      language: "en"
    }));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector(".ai-review-mark")).toBeNull();
  });

  it.each([
    ["en", ["AI keep", "AI review", "AI reject"]],
    ["zh", ["AI \u4fdd\u7559", "AI \u590d\u6838", "AI \u6dd8\u6c70"]]
  ] as const)("renders localized persisted marks in %s", (language, labels) => {
    const { unmount } = render(createElement("div", null,
      ...assets.map((asset) => createElement(AiReviewMark, { key: asset.id, asset, language }))
    ));

    assets.forEach((asset, index) => {
      const mark = screen.getByRole("img", { name: labels[index] });
      expect(mark).toHaveAttribute("title", labels[index]);
      expect(mark).toHaveClass("ai-review-mark", asset.aiDisposition);
    });

    unmount();
  });
});
