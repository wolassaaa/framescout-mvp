import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("apps/desktop/src/styles/app.css", "utf8");
const app = readFileSync("apps/desktop/src/App.tsx", "utf8");

describe("responsive interface scaling", () => {
  it("scales the complete workspace without the non-standard zoom property", () => {
    expect(css).not.toMatch(/\bzoom\s*:/);
    expect(css).toContain("transform: scale(var(--ui-scale, 1))");
    expect(css).toContain("width: var(--ui-width, 100vw)");
    expect(app).toContain('"--ui-width"');
  });
});
