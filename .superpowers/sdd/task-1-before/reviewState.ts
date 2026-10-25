import type { HumanDisposition, ReviewAsset } from "@framescout/contracts";

export interface ReviewState {
  cursor: number;
  assets: ReviewAsset[];
  showAiRejects: boolean;
  reviewFilter: ReviewFilter;
  inspectorOpen: boolean;
  loupeOpen: boolean;
  tagEditorOpen: boolean;
  gridSelection: string[];
  gridDensity: number;
  history: ReviewAsset[][];
  future: ReviewAsset[][];
}

export type ReviewFilter = "all" | "recommended" | "keep" | "review" | "reject" | "selected" | "no-athlete" | "soft-focus";

export type ReviewAction =
  | { type: "next" }
  | { type: "previous" }
  | { type: "setCursor"; cursor: number }
  | { type: "replaceAssets"; assets: ReviewAsset[] }
  | { type: "setSelectionRanking"; assets: ReviewAsset[] }
  | { type: "toggleRejects" }
  | { type: "setReviewFilter"; filter: ReviewFilter }
  | { type: "toggleInspector" }
  | { type: "toggleLoupe" }
  | { type: "toggleTagEditor" }
  | { type: "closeTagEditor" }
  | { type: "setDecision"; disposition: Exclude<HumanDisposition, "unseen"> }
  | { type: "setDecisionFor"; assetId: string; disposition: Exclude<HumanDisposition, "unseen"> }
  | { type: "setDecisionForMany"; assetIds: string[]; disposition: Exclude<HumanDisposition, "unseen"> }
  | { type: "toggleGridSelection"; assetId: string }
  | { type: "clearGridSelection" }
  | { type: "adjustGridDensity"; delta: -1 | 1 }
  | { type: "applyManualTag"; assetIds: string[]; tag: string }
  | { type: "removeManualTag"; assetIds: string[]; tag: string }
  | { type: "undo" }
  | { type: "redo" };

function matchesReviewFilter(asset: ReviewAsset, filter: ReviewFilter): boolean {
  if (filter === "all") return true;
  if (filter === "recommended") return asset.aiRecommended === true;
  if (filter === "keep" || filter === "review" || filter === "reject") return asset.aiDisposition === filter;
  if (filter === "selected") return asset.humanDisposition === "select";
  if (filter === "no-athlete") return asset.reasons.includes("no_allowed_subject_preserved_by_matchday") || asset.tags.includes("venue");
  return asset.reasons.includes("subject_out_of_focus") || asset.tags.includes("soft-focus");
}

export const hasReviewPreview = (asset: ReviewAsset) =>
  asset.previewState === undefined
  || asset.previewState === "ready"
  || asset.previewState === "fixture"
  || asset.previewState === "needs-relink";

export const visibleAssets = (state: ReviewState) =>
  state.assets.filter(
    (asset) =>
      hasReviewPreview(asset) &&
      (state.showAiRejects || asset.aiDisposition !== "reject" || asset.humanDisposition !== "unseen") &&
      matchesReviewFilter(asset, state.reviewFilter)
  );

export function createInitialReviewState(assets: ReviewAsset[]): ReviewState {
  return {
    cursor: 0,
    assets,
    showAiRejects: false,
    reviewFilter: "all",
    inspectorOpen: true,
    loupeOpen: false,
    tagEditorOpen: false,
    gridSelection: [],
    gridDensity: 4,
    history: [],
    future: []
  };
}

export function normalizeManualTag(tag: string): string | null {
  const normalized = tag.trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) return null;
  return normalized.startsWith("manual:") ? normalized : `manual:${normalized}`;
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  const queue = visibleAssets(state);
  switch (action.type) {
    case "replaceAssets":
      return {
        ...state,
        cursor: 0,
        assets: action.assets,
        showAiRejects: false,
        reviewFilter: "all",
        tagEditorOpen: false,
        gridSelection: [],
        history: [],
        future: []
      };
    case "setSelectionRanking": {
      const unchanged = state.assets.length === action.assets.length && state.assets.every((asset, index) => {
        const next = action.assets[index];
        return asset.id === next.id
          && asset.aiRecommended === next.aiRecommended
          && asset.aiSelectionRank === next.aiSelectionRank
          && asset.aiSelectionScore === next.aiSelectionScore;
      });
      return unchanged ? state : { ...state, assets: action.assets };
    }
    case "next":
      return { ...state, cursor: Math.min(state.cursor + 1, Math.max(queue.length - 1, 0)) };
    case "previous":
      return { ...state, cursor: Math.max(state.cursor - 1, 0) };
    case "setCursor":
      return { ...state, cursor: Math.max(0, Math.min(action.cursor, Math.max(queue.length - 1, 0))) };
    case "toggleRejects":
      return {
        ...state,
        showAiRejects: !state.showAiRejects,
        reviewFilter: state.showAiRejects && state.reviewFilter === "reject" ? "all" : state.reviewFilter,
        cursor: 0
      };
    case "setReviewFilter":
      return {
        ...state,
        reviewFilter: action.filter,
        showAiRejects: action.filter === "reject" ? true : state.showAiRejects,
        cursor: 0
      };
    case "toggleInspector":
      return { ...state, inspectorOpen: !state.inspectorOpen };
    case "toggleLoupe":
      return { ...state, loupeOpen: !state.loupeOpen };
    case "toggleTagEditor":
      return { ...state, tagEditorOpen: !state.tagEditorOpen };
    case "closeTagEditor":
      return { ...state, tagEditorOpen: false };
    case "setDecision": {
      const current = queue[state.cursor];
      if (!current) return state;
      return {
        ...state,
        assets: state.assets.map((asset) =>
          asset.id === current.id ? { ...asset, humanDisposition: action.disposition } : asset
        ),
        history: [...state.history, state.assets],
        future: []
      };
    }
    case "setDecisionFor": {
      if (!state.assets.some((asset) => asset.id === action.assetId)) return state;
      return {
        ...state,
        assets: state.assets.map((asset) =>
          asset.id === action.assetId ? { ...asset, humanDisposition: action.disposition } : asset
        ),
        history: [...state.history, state.assets],
        future: []
      };
    }
    case "setDecisionForMany": {
      const targetIds = new Set(action.assetIds);
      if (targetIds.size === 0) return state;
      return {
        ...state,
        assets: state.assets.map((asset) =>
          targetIds.has(asset.id) ? { ...asset, humanDisposition: action.disposition } : asset
        ),
        history: [...state.history, state.assets],
        future: []
      };
    }
    case "toggleGridSelection": {
      if (!state.assets.some((asset) => asset.id === action.assetId)) return state;
      const selected = new Set(state.gridSelection);
      if (selected.has(action.assetId)) selected.delete(action.assetId);
      else selected.add(action.assetId);
      return { ...state, gridSelection: Array.from(selected) };
    }
    case "clearGridSelection":
      return state.gridSelection.length === 0 ? state : { ...state, gridSelection: [] };
    case "adjustGridDensity":
      return { ...state, gridDensity: Math.max(3, Math.min(8, state.gridDensity + action.delta)) };
    case "applyManualTag": {
      const tag = normalizeManualTag(action.tag);
      if (!tag || action.assetIds.length === 0) return state;
      const targetIds = new Set(action.assetIds);
      return {
        ...state,
        assets: state.assets.map((asset) =>
          targetIds.has(asset.id) ? { ...asset, tags: Array.from(new Set([...asset.tags, tag])) } : asset
        ),
        history: [...state.history, state.assets],
        future: []
      };
    }
    case "removeManualTag": {
      const tag = normalizeManualTag(action.tag);
      if (!tag || action.assetIds.length === 0) return state;
      const targetIds = new Set(action.assetIds);
      return {
        ...state,
        assets: state.assets.map((asset) =>
          targetIds.has(asset.id) ? { ...asset, tags: asset.tags.filter((item) => item !== tag) } : asset
        ),
        history: [...state.history, state.assets],
        future: []
      };
    }
    case "undo": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return {
        ...state,
        assets: previous,
        history: state.history.slice(0, -1),
        future: [state.assets, ...state.future]
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        assets: next,
        history: [...state.history, state.assets],
        future: state.future.slice(1)
      };
    }
    default:
      return state;
  }
}
