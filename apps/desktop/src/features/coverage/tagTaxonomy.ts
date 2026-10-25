export interface TagCategory {
  id: string;
  label: string;
  examples: string[];
}

export const tagTaxonomy: TagCategory[] = [
  { id: "subject", label: "Subject", examples: ["subject:person", "subject:athlete", "subject:car"] },
  { id: "person", label: "People groups", examples: ["person:group-01", "person:group-02"] },
  { id: "scene", label: "Scene", examples: ["scene:empty", "scene:crowd", "scene:stadium"] },
  { id: "object", label: "Object", examples: ["object:car", "object:trophy", "object:screen"] },
  { id: "action", label: "Action", examples: ["action:celebrate", "action:run", "action:interaction"] },
  { id: "color", label: "Color", examples: ["color:red", "color:blue", "color:black"] },
  { id: "composition", label: "Composition", examples: ["composition:close", "composition:wide", "composition:negative-space"] },
  { id: "quality", label: "Quality", examples: ["quality:sharp", "quality:soft-focus", "quality:motion-blur"] },
  { id: "editorial", label: "Editorial", examples: ["editorial:hero", "editorial:story", "editorial:retouch"] }
];

export const quickTagSlots = [
  { key: "Alt+1", tag: "subject:person" },
  { key: "Alt+2", tag: "scene:empty" },
  { key: "Alt+3", tag: "scene:crowd" },
  { key: "Alt+4", tag: "object:car" },
  { key: "Alt+5", tag: "quality:sharp" },
  { key: "Alt+6", tag: "editorial:hero" }
] as const;

export function quickTagForKey(key: string): string | null {
  return quickTagSlots.find((slot) => slot.key === key)?.tag ?? null;
}
