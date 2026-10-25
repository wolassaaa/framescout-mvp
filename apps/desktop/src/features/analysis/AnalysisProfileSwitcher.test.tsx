import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisConfigResponse } from "@framescout/contracts";
import { uiCopy } from "../../i18n/uiCopy";
import { AnalysisProfileSwitcher } from "./AnalysisProfileSwitcher";

const config: AnalysisConfigResponse = {
  activeProfileId: "qwen-cloud",
  executionMode: "cloud",
  cloudBudgetCents: 500,
  cloudConcurrency: 2,
  secretStorage: "terminal-environment",
  maxCloudProxyPixels: 2_560_000,
  profiles: [{
    id: "qwen-cloud",
    provider: "qwen",
    model: "qwen3-vl-plus",
    backend: "cloud",
    available: true,
    sendsProxyOffDevice: true
  }]
};

describe("AnalysisProfileSwitcher", () => {
  it("edits cloud routing without exposing an API key or fake hybrid lane", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    const text = uiCopy.zh.profile;
    render(<AnalysisProfileSwitcher language="zh" config={config} busy={false} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /AI/ }));

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: text.cloudFirst })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(text.proxyOnlyPrivacy)).toBeVisible();
    expect(screen.queryByLabelText(/API Key/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(text.cloudBudget), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText(text.cloudConcurrency), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: text.saveRouting }));

    expect(onSelect).toHaveBeenCalledWith("qwen-cloud", {
      executionMode: "cloud",
      cloudBudgetCents: 800,
      cloudConcurrency: 3
    });
  });
});
