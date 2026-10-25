import { type CSSProperties, type Dispatch, useEffect, useMemo, useState } from "react";
import type { ExportPreviewResponse } from "@framescout/contracts";
import { Search, Tag } from "lucide-react";
import { ResilientAssetImage } from "../../components/ResilientAssetImage";
import { type UiLanguage, uiCopy } from "../../i18n/uiCopy";
import { AiReviewMark } from "../review/AiReviewMark";
import { aiReviewStatus, matchesReviewMode, type ReviewMode } from "../review/aiReview";
import { hasReviewPreview, type ReviewAction, type ReviewState } from "../review/reviewState";
import { SelectionToolbar } from "../review/SelectionToolbar";
import { tagSearchText } from "../coverage/tagProjection";

type GridFilter = "needs-review" | "recommended" | "no-athlete" | "soft-focus" | "selected" | "matchday-story" | "ai-reviewed" | "awaiting-ai";
const GRID_BATCH_SIZE = 240;
const gridFilters: GridFilter[] = ["needs-review", "recommended", "no-athlete", "soft-focus", "selected", "matchday-story", "ai-reviewed", "awaiting-ai"];

function matchesFilter(asset: ReviewState["assets"][number], filter: GridFilter): boolean {
  if (filter === "recommended") return asset.aiRecommended === true;
  if (filter === "ai-reviewed") return aiReviewStatus(asset) !== "pending";
  if (filter === "awaiting-ai") return aiReviewStatus(asset) === "pending";
  if (filter === "selected") return asset.humanDisposition === "select";
  if (filter === "no-athlete") return asset.reasons.includes("no_allowed_subject_preserved_by_matchday") || asset.tags.includes("venue");
  if (filter === "soft-focus") return asset.reasons.includes("subject_out_of_focus") || asset.tags.includes("soft-focus");
  if (filter === "matchday-story") return asset.tags.includes("finals") || asset.tags.includes("venue") || asset.tags.includes("wide");
  return asset.humanDisposition === "unseen";
}

export function matchesTagSearch(asset: ReviewState["assets"][number], query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return normalized.length === 0 || tagSearchText(asset).includes(normalized);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("[contenteditable=true]"))));
}

export function moveGalleryCursor(current: number, key: "w" | "a" | "s" | "d", columns: number, length: number): number {
  const rowStart = Math.floor(current / columns) * columns;
  const rowEnd = Math.min(rowStart + columns - 1, length - 1);
  if (key === "a" && current > rowStart) return current - 1;
  if (key === "d" && current < rowEnd) return current + 1;
  if (key === "w" && current - columns >= 0) return current - columns;
  if (key === "s" && current + columns < length) return current + columns;
  return current;
}

export function GridView({
  language,
  state,
  dispatch,
  exportPreview,
  onExportPreview,
  manualTagDraft,
  onManualTagDraftChange,
  onApplyManualTag,
  onOpenDuel
}: {
  language: UiLanguage;
  state: ReviewState;
  dispatch: Dispatch<ReviewAction>;
  exportPreview: ExportPreviewResponse | null;
  onExportPreview: () => void;
  manualTagDraft: string;
  onManualTagDraftChange: (value: string) => void;
  onApplyManualTag: (assetIds: string[], tag: string) => void;
  onOpenDuel: (groupId: string, focusAssetId: string) => void;
}) {
  const text = uiCopy[language];
  const [activeFilter, setActiveFilter] = useState<GridFilter>("needs-review");
  const [bulkDisposition, setBulkDisposition] = useState<"candidate" | "select" | "hold" | "reject">("select");
  const [keyboardCursor, setKeyboardCursor] = useState(0);
  const [tagQuery, setTagQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(GRID_BATCH_SIZE);
  const selectedAssetIds = state.gridSelection;
  const groupedSelectedAsset = state.assets.find((asset) => selectedAssetIds.includes(asset.id) && asset.groupId);
  const filteredAssets = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    return state.assets.filter((asset) => hasReviewPreview(asset)
      && (activeFilter !== "needs-review" || matchesReviewMode(asset, state.reviewMode))
      && matchesFilter(asset, activeFilter)
      && matchesTagSearch(asset, query));
  }, [activeFilter, state.assets, state.reviewMode, tagQuery]);
  const resultIds = filteredAssets.map((asset) => asset.id);
  const sessionIds = state.assets.filter(hasReviewPreview).map((asset) => asset.id);

  useEffect(() => setKeyboardCursor((current) => Math.min(current, Math.max(filteredAssets.length - 1, 0))), [filteredAssets.length]);
  useEffect(() => setVisibleCount(GRID_BATCH_SIZE), [activeFilter, state.reviewMode, tagQuery]);

  const renderedAssets = filteredAssets.slice(0, visibleCount);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === "a") {
        event.preventDefault();
        dispatch({ type: "selectAssets", assetIds: sessionIds });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "clearGridSelection" });
        return;
      }
      if (event.ctrlKey || !["w", "a", "s", "d"].includes(key) || renderedAssets.length === 0) return;
      event.preventDefault();
      setKeyboardCursor((current) => {
        const next = moveGalleryCursor(current, key as "w" | "a" | "s" | "d", state.gridDensity, renderedAssets.length);
        window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-gallery-index="${next}"]`)?.focus({ preventScroll: true }));
        return next;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, renderedAssets.length, sessionIds, state.gridDensity]);

  const filterLabel = (filter: GridFilter) => filter === "needs-review" ? text.grid.needsReview
    : filter === "recommended" ? text.review.recommended
    : filter === "no-athlete" ? text.grid.noAthlete
      : filter === "soft-focus" ? text.grid.softFocus
        : filter === "selected" ? text.grid.selected
          : filter === "matchday-story" ? text.grid.matchdayStory
            : filter === "ai-reviewed" ? text.grid.aiReviewed : text.grid.awaitingAi;

  return (
    <section className="grid-view" aria-label={text.grid.title}>
      <aside className="grid-filters">
        <strong>{text.grid.filters}</strong>
        <div className="review-mode-control" role="group" aria-label={text.review.queue}>
          {(["assisted", "all", "reject-audit"] as const).map((mode: ReviewMode) => (
            <button key={mode} type="button" aria-pressed={state.reviewMode === mode} onClick={() => dispatch({ type: "setReviewMode", mode })}>{text.reviewMode[mode]}</button>
          ))}
        </div>
        <label className="grid-tag-search"><Search size={14} /><input value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder={text.grid.searchTags} aria-label={text.grid.searchTags} /></label>
        {gridFilters.map((filter) => <button key={filter} className={activeFilter === filter ? "active" : undefined} onClick={() => setActiveFilter(filter)}>{filterLabel(filter)}</button>)}
      </aside>
      <div className="contact-sheet" style={{ "--grid-columns": state.gridDensity } as CSSProperties}>
        {renderedAssets.map((asset, index) => (
          <button className={`contact-thumb ${asset.aiDisposition} ${selectedAssetIds.includes(asset.id) ? "selected" : ""} ${keyboardCursor === index ? "keyboard-current" : ""}`} key={asset.id} data-gallery-index={index} onFocus={() => setKeyboardCursor(index)} onClick={() => dispatch({ type: "toggleGridSelection", assetId: asset.id })} aria-pressed={selectedAssetIds.includes(asset.id)}>
            <ResilientAssetImage src={asset.previewUrl} alt="" previewState={asset.previewState} language={language} />
            <div className="grid-thumb-meta"><AiReviewMark asset={asset} language={language} /><span>{asset.fileName}</span><small>{text.review.human[asset.humanDisposition]}</small></div>
          </button>
        ))}
        {filteredAssets.length === 0 && <div className="empty-filter">{text.grid.empty}</div>}
        {filteredAssets.length > renderedAssets.length && <button className="grid-load-more" type="button" onClick={() => setVisibleCount((count) => count + GRID_BATCH_SIZE)}>{text.grid.loadNext} {Math.min(GRID_BATCH_SIZE, filteredAssets.length - renderedAssets.length)}</button>}
      </div>
      <aside className="bulk-actions">
        <strong>{text.grid.actions}</strong>
        <SelectionToolbar language={language} sessionIds={sessionIds} selectedIds={selectedAssetIds} dispatch={dispatch} />
        <span className="grid-density"><kbd>[</kbd><kbd>]</kbd> {state.gridDensity} {text.grid.columns}</span>
        <label className="bulk-decision-control"><span>{text.grid.decision}</span><select value={bulkDisposition} onChange={(event) => setBulkDisposition(event.target.value as typeof bulkDisposition)} aria-label={text.grid.bulkDecision}><option value="candidate">{text.review.decision.candidate}</option><option value="select">{text.review.decision.select}</option><option value="hold">{text.review.decision.hold}</option><option value="reject">{text.review.decision.reject}</option></select></label>
        <button onClick={() => { dispatch({ type: "setDecisionForMany", assetIds: selectedAssetIds, disposition: bulkDisposition }); dispatch({ type: "clearGridSelection" }); }} disabled={selectedAssetIds.length === 0}>{text.grid.setDecision}</button>
        <label className="manual-tag-control"><span>{selectedAssetIds.length} {text.selection.marked}</span><input id="grid-manual-tag" value={manualTagDraft} onChange={(event) => onManualTagDraftChange(event.target.value)} placeholder={text.grid.manualTagPlaceholder} aria-label={text.grid.manualTag} /></label>
        <button onClick={() => { onApplyManualTag(selectedAssetIds, manualTagDraft); onManualTagDraftChange(""); }} disabled={selectedAssetIds.length === 0 || manualTagDraft.trim().length === 0}><Tag size={14} /> {text.grid.applyManualTag}</button>
        <button onClick={() => groupedSelectedAsset && onOpenDuel(groupedSelectedAsset.groupId!, groupedSelectedAsset.id)} disabled={!groupedSelectedAsset}>{text.grid.openDuel}</button>
        <button onClick={onExportPreview}>{text.grid.exportPreview}</button>
        {exportPreview && <div className="export-preview" role="region" aria-label={text.grid.exportPreview}><span>{exportPreview.xmpFilesToWrite} {text.grid.xmpFiles}</span><span>{exportPreview.originalFilesModified} {text.grid.originalsModified}</span><span>{exportPreview.metadataRecords.length} {text.grid.metadataRows}</span>{exportPreview.targets.slice(0, 3).map((target) => <small key={target.sidecarPath}>{target.sidecarPath} / {target.colorLabel} / {target.rating} {text.grid.stars}</small>)}</div>}
      </aside>
    </section>
  );
}
