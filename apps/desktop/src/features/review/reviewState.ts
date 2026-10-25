import type { HumanDisposition, ReviewAsset } from "@framescout/contracts";
import { aiReviewStatus, matchesReviewMode, type ReviewMode } from "./aiReview";

export interface ReviewState {
  cursor: number;
  assets: ReviewAsset[];
  reviewMode: ReviewMode;
  showAiRejects: boolean;
  reviewFilter: ReviewFilter;
  inspectorOpen: boolean;
  loupeOpen: boolean;
  tagEditorOpen: boolean;
  gridSelection: string[];
  gridDensity: number;
  history: ReviewPatch[];
  future: ReviewPatch[];
}

interface ReversibleAssetState {
  humanDisposition: HumanDisposition;
  tags: string[];
}

export interface AssetChange {
  assetId: string;
  before: ReversibleAssetState;
  after: ReversibleAssetState;
}

export interface ReviewPatch {
  changes: AssetChange[];
}

const HISTORY_LIMIT = 100;

export type ReviewFilter = "all" | "recommended" | "keep" | "review" | "reject" | "selected" | "no-athlete" | "soft-focus";

export type ReviewAction =
  | { type: "next" }
  | { type: "previous" }
  | { type: "setCursor"; cursor: number }
  | { type: "replaceAssets"; assets: ReviewAsset[] }
  | { type: "setSelectionRanking"; assets: ReviewAsset[] }
  | { type: "toggleRejects" }
  | { type: "setReviewFilter"; filter: ReviewFilter }
  | { type: "setReviewMode"; mode: ReviewMode }
  | { type: "toggleInspector" }
  | { type: "toggleLoupe" }
  | { type: "toggleTagEditor" }
  | { type: "closeTagEditor" }
  | { type: "setDecision"; disposition: Exclude<HumanDisposition, "unseen"> }
  | { type: "setDecisionFor"; assetId: string; disposition: Exclude<HumanDisposition, "unseen"> }
  | { type: "setDecisionForMany"; assetIds: string[]; disposition: Exclude<HumanDisposition, "unseen"> }
  | { type: "toggleGridSelection"; assetId: string }
  | { type: "clearGridSelection" }
  | { type: "selectAssets"; assetIds: string[] }
  | { type: "clearSelectedAssets"; assetIds?: string[] }
  | { type: "adjustGridDensity"; delta: -1 | 1 }
  | { type: "applyManualTag"; assetIds: string[]; tag: string }
  | { type: "removeManualTag"; assetIds: string[]; tag: string }
  | { type: "undo" }
  | { type: "redo" };

function matchesReviewFilter(asset: ReviewAsset, filter: ReviewFilter): boolean {
  if (filter === "all") return true;
  if (filter === "recommended") return asset.aiRecommended === true;
  if (filter === "keep" || filter === "review" || filter === "reject") return aiReviewStatus(asset) === filter;
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
      matchesReviewFilter(asset, state.reviewFilter) &&
      (state.reviewFilter !== "all" || matchesReviewMode(asset, state.reviewMode))
  );

export function createInitialReviewState(assets: ReviewAsset[]): ReviewState {
  return {
    cursor: 0,
    assets,
    reviewMode: "assisted",
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

function reversibleState(asset: ReviewAsset): ReversibleAssetState {
  return {
    humanDisposition: asset.humanDisposition,
    tags: [...asset.tags]
  };
}

function sameReversibleState(left: ReversibleAssetState, right: ReversibleAssetState): boolean {
  return left.humanDisposition === right.humanDisposition
    && left.tags.length === right.tags.length
    && left.tags.every((tag, index) => tag === right.tags[index]);
}

function commitReversibleUpdate(
  state: ReviewState,
  update: (asset: ReviewAsset) => ReviewAsset,
  recordNoop = false
): ReviewState {
  const changes: AssetChange[] = [];
  const assets = state.assets.map((asset) => {
    const next = update(asset);
    const before = reversibleState(asset);
    const after = reversibleState(next);
    if (!sameReversibleState(before, after)) {
      changes.push({ assetId: asset.id, before, after });
    }
    return next;
  });
  if (changes.length === 0 && !recordNoop) return state;
  return {
    ...state,
    assets,
    history: [...state.history, { changes }].slice(-HISTORY_LIMIT),
    future: []
  };
}

function applyPatch(assets: ReviewAsset[], patch: ReviewPatch, direction: "before" | "after"): ReviewAsset[] {
  const changes = new Map(patch.changes.map((change) => [change.assetId, change[direction]]));
  return assets.map((asset) => {
    const change = changes.get(asset.id);
    return change
      ? { ...asset, humanDisposition: change.humanDisposition, tags: [...change.tags] }
      : asset;
  });
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  const queue = visibleAssets(state);
  switch (action.type) {
    case "replaceAssets":
      return {
        ...state,
        cursor: 0,
        assets: action.assets,
        reviewMode: "assisted",
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
    case "toggleRejects": {
      const showAiRejects = state.reviewMode === "assisted";
      return {
        ...state,
        reviewMode: showAiRejects ? "all" : "assisted",
        showAiRejects,
        reviewFilter: !showAiRejects && state.reviewFilter === "reject" ? "all" : state.reviewFilter,
        cursor: 0
      };
    }
    case "setReviewFilter": {
      const reviewMode = action.filter === "reject"
        ? "reject-audit"
        : state.reviewMode === "reject-audit"
          ? "all"
          : state.reviewMode;
      return {
        ...state,
        reviewFilter: action.filter,
        reviewMode,
        showAiRejects: reviewMode !== "assisted",
        cursor: 0
      };
    }
    case "setReviewMode":
      return { ...state, reviewMode: action.mode, showAiRejects: action.mode !== "assisted", cursor: 0 };
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
      return commitReversibleUpdate(state, (asset) =>
        asset.id === current.id ? { ...asset, humanDisposition: action.disposition } : asset
      );
    }
    case "setDecisionFor": {
      if (!state.assets.some((asset) => asset.id === action.assetId)) return state;
      return commitReversibleUpdate(state, (asset) =>
        asset.id === action.assetId ? { ...asset, humanDisposition: action.disposition } : asset
      );
    }
    case "setDecisionForMany": {
      const targetIds = new Set(action.assetIds);
      if (targetIds.size === 0) return state;
      return commitReversibleUpdate(state, (asset) =>
        targetIds.has(asset.id) ? { ...asset, humanDisposition: action.disposition } : asset
      );
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
    case "selectAssets": {
      const assetIds = new Set(state.assets.map((asset) => asset.id));
      const selected = new Set(state.gridSelection);
      for (const assetId of action.assetIds) {
        if (assetIds.has(assetId)) selected.add(assetId);
      }
      const gridSelection = Array.from(selected);
      return gridSelection.length === state.gridSelection.length
        && gridSelection.every((assetId, index) => assetId === state.gridSelection[index])
        ? state
        : { ...state, gridSelection };
    }
    case "clearSelectedAssets": {
      if (!action.assetIds) return state.gridSelection.length === 0 ? state : { ...state, gridSelection: [] };
      const idsToClear = new Set(action.assetIds);
      const gridSelection = state.gridSelection.filter((assetId) => !idsToClear.has(assetId));
      return gridSelection.length === state.gridSelection.length ? state : { ...state, gridSelection };
    }
    case "adjustGridDensity":
      return { ...state, gridDensity: Math.max(3, Math.min(8, state.gridDensity + action.delta)) };
    case "applyManualTag": {
      const tag = normalizeManualTag(action.tag);
      if (!tag || action.assetIds.length === 0) return state;
      const targetIds = new Set(action.assetIds);
      return commitReversibleUpdate(state, (asset) =>
        targetIds.has(asset.id) ? { ...asset, tags: Array.from(new Set([...asset.tags, tag])) } : asset
      , true);
    }
    case "removeManualTag": {
      const tag = normalizeManualTag(action.tag);
      if (!tag || action.assetIds.length === 0) return state;
      const targetIds = new Set(action.assetIds);
      return commitReversibleUpdate(state, (asset) =>
        targetIds.has(asset.id) ? { ...asset, tags: asset.tags.filter((item) => item !== tag) } : asset
      , true);
    }
    case "undo": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return {
        ...state,
        assets: applyPatch(state.assets, previous, "before"),
        history: state.history.slice(0, -1),
        future: [previous, ...state.future].slice(0, HISTORY_LIMIT)
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        assets: applyPatch(state.assets, next, "after"),
        history: [...state.history, next].slice(-HISTORY_LIMIT),
        future: state.future.slice(1)
      };
    }
    default:
      return state;
  }
}
