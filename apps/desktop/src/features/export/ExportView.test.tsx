import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assets } from "../../data/fixtures";
import { defaultExportSettings } from "../project/projectExport";
import { ExportView } from "./ExportView";

afterEach(cleanup);

describe("ExportView", () => {
  it("renders a localized known tag while retaining its raw settings key", () => {
    const onSettingsChange = vi.fn();

    render(<ExportView
      language="zh"
      preview={null}
      assets={[{ ...assets[0], tags: ["subject:person"] }]}
      settings={defaultExportSettings}
      onSettingsChange={onSettingsChange}
      onPreview={vi.fn()}
      onCommit={vi.fn()}
      onRefreshMetadata={vi.fn()}
      onDownloadCsv={vi.fn()}
      onCopySelectedPaths={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("tab", { name: "标签 0" }));
    const tagButton = screen.getByRole("button", { name: "人物 1" });
    expect(tagButton).toBeVisible();
    expect(screen.queryByText("subject:person")).not.toBeInTheDocument();

    fireEvent.click(tagButton);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...defaultExportSettings,
      includedTags: ["subject:person"]
    });
  });
});
