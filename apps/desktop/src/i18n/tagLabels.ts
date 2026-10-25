import type { UiLanguage } from "./uiCopy";

export const machineTagLabels: Record<string, Record<UiLanguage, string>> = {
  "player": { zh: "运动员", en: "player" },
  "coach": { zh: "教练", en: "coach" },
  "crowd": { zh: "观众", en: "crowd" },
  "stage": { zh: "舞台", en: "stage" },
  "screen": { zh: "屏幕", en: "screen" },
  "trophy": { zh: "奖杯", en: "trophy" },
  "venue": { zh: "场地", en: "venue" },
  "close": { zh: "近景", en: "close" },
  "finals": { zh: "决赛", en: "finals" },
  "needs-review": { zh: "需要复核", en: "needs review" },
  "soft-focus": { zh: "焦点偏软", en: "soft focus" },
  "ai-reject": { zh: "AI 淘汰", en: "AI reject" },
  "subject:person": { zh: "人物", en: "Person" },
  "subject:athlete": { zh: "运动员", en: "Athlete" },
  "subject:car": { zh: "汽车", en: "Car" },
  "subject:vehicle": { zh: "车辆", en: "Vehicle" },
  "subject:close": { zh: "近景", en: "Close subject" },
  "object:car": { zh: "汽车", en: "Car" },
  "object:trophy": { zh: "奖杯", en: "Trophy" },
  "object:screen": { zh: "屏幕", en: "Screen" },
  "scene:empty": { zh: "空镜", en: "Empty scene" },
  "scene:crowd": { zh: "观众", en: "Crowd" },
  "scene:stadium": { zh: "体育场", en: "Stadium" },
  "scene:stage": { zh: "舞台", en: "Stage" },
  "quality:sharp": { zh: "清晰", en: "Sharp" },
  "quality:soft": { zh: "模糊", en: "Soft focus" },
  "quality:soft-focus": { zh: "焦点偏软", en: "Soft focus" },
  "quality:motion-blur": { zh: "运动模糊", en: "Motion blur" },
  "person:group-01": { zh: "人物组 01", en: "People group 01" },
  "person:group-02": { zh: "人物组 02", en: "People group 02" },
  "action:celebrate": { zh: "庆祝", en: "Celebrate" },
  "action:run": { zh: "奔跑", en: "Run" },
  "action:interaction": { zh: "互动", en: "Interaction" },
  "color:red": { zh: "红色", en: "Red" },
  "color:blue": { zh: "蓝色", en: "Blue" },
  "color:black": { zh: "黑色", en: "Black" },
  "composition:close": { zh: "近景构图", en: "Close composition" },
  "composition:wide": { zh: "广角构图", en: "Wide composition" },
  "composition:negative-space": { zh: "负空间", en: "Negative space" },
  "editorial:hero": { zh: "主视觉", en: "Hero" },
  "editorial:story": { zh: "故事", en: "Story" },
  "editorial:retouch": { zh: "待修图", en: "Retouch" },
  "ai:reviewed": { zh: "AI 已审", en: "AI reviewed" }
};

export function localizedTag(tag: string, language: UiLanguage): string {
  const known = machineTagLabels[tag]?.[language];
  if (known) return known;
  if (tag.startsWith("manual:")) return tag.slice(7).replace(/-/g, " ");
  return tag;
}
