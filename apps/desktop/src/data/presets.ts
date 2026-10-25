import type { ProjectPreset } from "@framescout/contracts";
import type { uiCopy } from "../i18n/uiCopy";

export type PresetCopyKey = keyof typeof uiCopy.en.presets;

export interface PresetDefinition {
  id: ProjectPreset;
  copyKey: PresetCopyKey;
}

export const presetCatalog: PresetDefinition[] = [
  { id: "action-coverage", copyKey: "actionCoverage" },
  { id: "matchday-story", copyKey: "matchdayStory" },
  { id: "motorsport", copyKey: "motorsport" },
  { id: "esports-stage", copyKey: "esportsStage" },
  { id: "portrait", copyKey: "portrait" },
  { id: "custom", copyKey: "custom" }
];

export function presetDefinition(id: ProjectPreset): PresetDefinition {
  return presetCatalog.find((preset) => preset.id === id) ?? presetCatalog[presetCatalog.length - 1];
}
