import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeRoot } from "./RuntimeRoot";
import { createBrowserProjectClient } from "./features/project/projectClient";
import type { RuntimeProjectClient } from "./features/project/runtimeProjectClient";

afterEach(cleanup);

describe("RuntimeRoot", () => {
  it("shows a recovery screen instead of fixture photos while the service is offline", async () => {
    const createClient = vi.fn<() => Promise<RuntimeProjectClient>>().mockResolvedValue({
      kind: "offline",
      activeProject: null,
      apiUrl: "http://127.0.0.1:4310",
      message: "connection refused"
    });

    render(<RuntimeRoot createClient={createClient} />);

    expect(await screen.findByRole("heading", { name: "本地服务未连接" })).toBeVisible();
    expect(screen.getByText("http://127.0.0.1:4310")).toBeVisible();
    expect(screen.queryByText("Friday night finals")).not.toBeInTheDocument();
  });

  it("retries the service connection from the recovery screen", async () => {
    const createClient = vi.fn<() => Promise<RuntimeProjectClient>>()
      .mockResolvedValueOnce({
        kind: "offline",
        activeProject: null,
        apiUrl: "http://127.0.0.1:4310",
        message: "connection refused"
      })
      .mockResolvedValueOnce({
        kind: "browser",
        activeProject: null,
        client: createBrowserProjectClient(window.localStorage)
      });

    render(<RuntimeRoot createClient={createClient} />);
    fireEvent.click(await screen.findByRole("button", { name: "重新连接" }));

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "本地服务未连接" })).not.toBeInTheDocument());
  });
});
