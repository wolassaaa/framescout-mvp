import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResilientAssetImage } from "./ResilientAssetImage";

afterEach(() => vi.useRealTimers());

describe("ResilientAssetImage", () => {
  it("retries a failed preview twice and then shows a bilingual failure state", () => {
    vi.useFakeTimers();
    const view = render(<ResilientAssetImage src="/preview.jpg" alt="frame" language="zh" previewState="ready" />);
    const image = view.getByAltText("frame");

    fireEvent.error(image);
    expect(view.getByText("正在重试")).toBeTruthy();
    act(() => vi.advanceTimersByTime(300));
    expect(image.getAttribute("src")).toContain("fs_retry=1");

    fireEvent.error(image);
    act(() => vi.advanceTimersByTime(600));
    fireEvent.error(image);
    expect(view.getByText("缩略图失败")).toBeTruthy();
  });

  it("explains pending and relink states instead of leaving a blank box", () => {
    const pending = render(<ResilientAssetImage src="/pending.jpg" alt="pending" language="en" previewState="pending" />);
    expect(pending.getByText("Generating preview")).toBeTruthy();
    pending.unmount();

    const relink = render(<ResilientAssetImage src="/missing.jpg" alt="missing" language="zh" previewState="needs-relink" />);
    expect(relink.getByText("需要重新关联")).toBeTruthy();
  });
});
