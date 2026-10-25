import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const strategyDirectory = resolve("strategies");
const schema = JSON.parse(readFileSync(resolve(strategyDirectory, "review-strategy.schema.json"), "utf8"));
const strategies = readdirSync(strategyDirectory)
  .filter((name) => name.endsWith(".strategy.json"))
  .map((name) => ({ name, value: JSON.parse(readFileSync(resolve(strategyDirectory, name), "utf8")) }));

describe("review strategy authoring format", () => {
  it("publishes a versioned JSON Schema with non-negotiable safety constants", () => {
    expect(schema.$schema).toContain("2020-12");
    expect(schema.properties.signals.properties.aesthetic.properties.canHardReject.const).toBe(false);
    expect(schema.properties.decisionPolicy.properties.humanDecisionWins.const).toBe(true);
    expect(schema.properties.selectionGoal.properties.preserveHumanDecisions.const).toBe(true);
    expect(schema.properties.fallbackPolicy.properties.rawUploadAllowed.const).toBe(false);
  });

  it.each(strategies)("keeps $name structurally complete and conservative", ({ value }) => {
    expect(value.schemaVersion).toBe(1);
    expect(value.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(value.name.zh.length).toBeGreaterThanOrEqual(2);
    expect(value.note.zh.length).toBeGreaterThanOrEqual(2);
    expect(value.subjects.allowedLabels.length).toBeGreaterThan(0);
    expect(value.signals.focus.rejectBelow).toBeLessThanOrEqual(value.signals.focus.reviewBelow);
    expect(value.signals.aesthetic.canHardReject).toBe(false);
    expect(value.decisionPolicy.humanDecisionWins).toBe(true);
    expect(value.decisionPolicy.ambiguousAction).toBe("review");
    expect(value.selectionGoal.defaultTargetCount).toBeGreaterThan(0);
    expect(value.selectionGoal.mode).toBe("exact");
    expect(value.selectionGoal.preserveHumanDecisions).toBe(true);
    expect(value.fallbackPolicy.subjectDetectorUnavailable).toBe("review");
    expect(value.fallbackPolicy.rawUploadAllowed).toBe(false);
    expect(value.acceptanceExamples.length).toBeGreaterThanOrEqual(5);
  });
});
