import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

type JsonObject = Record<string, any>;

const strategyDirectory = resolve("strategies");
const schema = JSON.parse(readFileSync(resolve(strategyDirectory, "review-strategy.schema.json"), "utf8"));
const strategies = readdirSync(strategyDirectory)
  .filter((name) => name.endsWith(".strategy.json"))
  .map((name) => ({ name, value: JSON.parse(readFileSync(resolve(strategyDirectory, name), "utf8")) }));

function resolveReference(reference: string): JsonObject {
  return reference
    .slice(2)
    .split("/")
    .reduce((value, key) => value[key], schema as JsonObject);
}

function validate(value: any, rule: JsonObject, path = "$"): string[] {
  if (rule.$ref) return validate(value, resolveReference(rule.$ref), path);

  const errors: string[] = [];
  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  const typeMatches =
    !rule.type ||
    (rule.type === "object" && isObject) ||
    (rule.type === "array" && Array.isArray(value)) ||
    (rule.type === "string" && typeof value === "string") ||
    (rule.type === "boolean" && typeof value === "boolean") ||
    (rule.type === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (rule.type === "integer" && Number.isInteger(value));

  if (!typeMatches) return [`${path}: expected ${rule.type}`];
  if ("const" in rule && value !== rule.const) errors.push(`${path}: expected constant ${String(rule.const)}`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${path}: value is outside enum`);

  if (typeof value === "string") {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${path}: string is too short`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${path}: string does not match pattern`);
  }

  if (typeof value === "number") {
    if (rule.minimum !== undefined && value < rule.minimum) errors.push(`${path}: number is below minimum`);
    if (rule.maximum !== undefined && value > rule.maximum) errors.push(`${path}: number is above maximum`);
  }

  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${path}: array has too few items`);
    if (rule.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push(`${path}: array items are not unique`);
    }
    if (rule.items) value.forEach((item, index) => errors.push(...validate(item, rule.items, `${path}[${index}]`)));
  }

  if (isObject) {
    for (const key of rule.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing ${key}`);
    }
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (rule.properties ?? {}))) errors.push(`${path}: unexpected ${key}`);
      }
    }
    for (const [key, childRule] of Object.entries(rule.properties ?? {})) {
      if (key in value) errors.push(...validate(value[key], childRule as JsonObject, `${path}.${key}`));
    }
  }

  return errors;
}

describe("review strategy authoring format", () => {
  it("ships the complete built-in strategy catalog", () => {
    expect(strategies.map(({ name }) => name).sort()).toEqual([
      "action-coverage.strategy.json",
      "base.strategy.json",
      "esports-stage.strategy.json",
      "matchday-story.strategy.json",
      "motorsport.strategy.json",
      "portrait.strategy.json",
    ]);
  });

  it("publishes a versioned JSON Schema with non-negotiable safety constants", () => {
    expect(schema.$schema).toContain("2020-12");
    expect(schema.properties.signals.properties.aesthetic.properties.canHardReject.const).toBe(false);
    expect(schema.properties.decisionPolicy.properties.humanDecisionWins.const).toBe(true);
    expect(schema.properties.selectionGoal.properties.preserveHumanDecisions.const).toBe(true);
    expect(schema.properties.fallbackPolicy.properties.rawUploadAllowed.const).toBe(false);
  });

  it.each(strategies)("validates $name against review-strategy.schema.json", ({ value }) => {
    expect(validate(value, schema)).toEqual([]);
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

  it.each([
    ["action-coverage.strategy.json", ["person"], [], "reject", false],
    ["matchday-story.strategy.json", ["person"], ["crowd", "venue", "trophy"], "review", false],
    ["motorsport.strategy.json", ["person", "car", "motorcycle", "bus", "truck"], ["pit", "track", "crowd"], "review", true],
    ["esports-stage.strategy.json", ["person", "tv", "laptop"], ["stage", "screen", "crowd", "trophy"], "review", false],
  ])(
    "publishes the binding policy mapping for %s",
    (name, allowedLabels, protectedContexts, noAllowedSubject, protectIntentionalMotion) => {
      const strategy = strategies.find((candidate) => candidate.name === name)?.value;
      expect(strategy).toBeDefined();
      expect(strategy.subjects.allowedLabels).toEqual(allowedLabels);
      expect(strategy.subjects.protectedContexts).toEqual(protectedContexts);
      expect(strategy.decisionPolicy.noAllowedSubject).toBe(noAllowedSubject);
      expect(strategy.signals.focus.protectIntentionalMotion).toBe(protectIntentionalMotion);
      expect(strategy.decisionPolicy.humanDecisionWins).toBe(true);
      expect(strategy.decisionPolicy.ambiguousAction).toBe("review");
      expect(strategy.fallbackPolicy.rawUploadAllowed).toBe(false);
      expect(strategy.acceptanceExamples).toHaveLength(5);
    },
  );
});
