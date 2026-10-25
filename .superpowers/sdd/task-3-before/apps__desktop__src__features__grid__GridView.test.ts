import { describe, expect, it } from "vitest";
import { moveGalleryCursor } from "./GridView";

describe("moveGalleryCursor", () => {
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
});
