import { type CSSProperties, type Dispatch, useEffect, useMemo, useState } from "react";
import type { ExportPreviewResponse } from "@framescout/contracts";
import { Check, CircleAlert, Search, Tag, X } from "lucide-react";
import { hasReviewPreview, type ReviewAction, type ReviewState } from "../review/reviewState";

type GridFilter = "needs-review" | "no-athlete" | "soft-focus" | "selected" | "matchday-story";
const GRID_BATCH_SIZE = 240;

const filterLabels: Record<GridFilter, string> = {
  "needs-review": "Needs review",
  "no-athlete": "No athlete",
  "soft-focus": "Soft focus",
  selected: "Selected",
  "matchday-story": "Matchday story"
};

function matchesFilter(asset: ReviewState["assets"][number], filter: GridFilter): boolean {
  if (filter === "selected") return asset.humanDisposition === "select";
  if (filter === "no-athlete") return asset.reasons.includes("no_allowed_subject_preserved_by_matchday") || asset.tags.includes("venue");
  if (filter === "soft-focus") return asset.reasons.includes("subject_out_of_focus") || asset.tags.includes("soft-focus");
  if (filter === "matchday-story") return asset.tags.includes("finals") || asset.tags.includes("venue") || asset.tags.includes("wide");
  return asset.humanDisposition === "unseen";
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
  state,
  dispatch,
  exportPreview,
  onExportPreview,
  manualTagDraft,
  onManualTagDraftChange,
  onApplyManualTag,
  onOpenDuel
}: {
  state: ReviewState;
  dispatch: Dispatch<ReviewAction>;
  exportPreview: ExportPreviewResponse | null;
  onExportPreview: () => void;
  manualTagDraft: string;
  onManualTagDraftChange: (value: string) => void;
  onApplyManualTag: (assetIds: string[], tag: string) => void;
  onOpenDuel: (groupId: string, focusAssetId: string) => void;
}) {
  const [activeFilter, setActiveFilter] = useState<GridFilter>("needs-review");
  const [bulkDisposition, setBulkDisposition] = useState<"candidate" | "select" | "hold" | "reject">("select");
  const [keyboardCursor, setKeyboardCursor] = useState(0);
  const [tagQuery, setTagQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(GRID_BATCH_SIZE);
  const selectedAssetIds = state.gridSelection;
  const groupedSelectedAsset = state.assets.find((asset) => selectedAssetIds.includes(asset.id) && asset.groupId);
  const filteredAssets = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    return state.assets.filter((asset) => hasReviewPreview(asset) && matchesFilter(asset, activeFilter) && (!query || asset.tags.some((tag) => tag.toLowerCase().includes(query)) || asset.reasons.some((reason) => reason.toLowerCase().includes(query))));
  }, [activeFilter, state.assets, tagQuery]);

  useEffect(() => {
    setKeyboardCursor((current) => Math.min(current, Math.max(filteredAssets.length - 1, 0)));
  }, [filteredAssets.length]);

  useEffect(() => {
    setVisibleCount(GRID_BATCH_SIZE);
  }, [activeFilter, tagQuery]);

  const renderedAssets = filteredAssets.slice(0, visibleCount);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d"].includes(key) || renderedAssets.length === 0) return;
      event.preventDefault();
      setKeyboardCursor((current) => {
        const next = moveGalleryCursor(current, key as "w" | "a" | "s" | "d", state.gridDensity, renderedAssets.length);
        window.requestAnimationFrame(() => {
          const target = document.querySelector<HTMLButtonElement>(`[data-gallery-index="${next}"]`);
          target?.focus({ preventScroll: true });
          target?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        return next;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [renderedAssets.length, state.gridDensity]);
  const applyManualTag = () => {
    onApplyManualTag(selectedAssetIds, manualTagDraft);
    onManualTagDraftChange("");
  };
  const applyBulkDecision = () => {
    dispatch({ type: "setDecisionForMany", assetIds: selectedAssetIds, disposition: bulkDisposition });
    dispatch({ type: "clearGridSelection" });
  };

  return (
    <section className="grid-view" aria-label="Grid">
      <aside className="grid-filters">
        <strong>Filters</strong>
        <label className="grid-tag-search"><Search size={14} /><input value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="Search tags" aria-label="Search tags" /></label>
        {(Object.keys(filterLabels) as GridFilter[]).map((filter) => (
          <button
            key={filter}
            className={activeFilter === filter ? "active" : undefined}
            onClick={() => setActiveFilter(filter)}
          >
            {filterLabels[filter]}
          </button>
        ))}
      </aside>
      <div className="contact-sheet" style={{ "--grid-columns": state.gridDensity } as CSSProperties}>
        {renderedAssets.map((asset, index) => {
          const Icon = asset.aiDisposition === "keep" ? Check : asset.aiDisposition === "review" ? CircleAlert : X;
          return (
            <button
              className={`contact-thumb ${asset.aiDisposition} ${selectedAssetIds.includes(asset.id) ? "selected" : ""} ${keyboardCursor === index ? "keyboard-current" : ""}`}
              key={asset.id}
              data-gallery-index={index}
              onFocus={() => setKeyboardCursor(index)}
              onClick={() => dispatch({ type: "toggleGridSelection", assetId: asset.id })}
              aria-pressed={selectedAssetIds.includes(asset.id)}
            >
              <img loading="lazy" src={asset.previewUrl} alt="" />
              <span><Icon size={14} /> {asset.fileName}</span>
              <small>{asset.humanDisposition}</small>
            </button>
          );
        })}
        {filteredAssets.length === 0 && <div className="empty-filter">No frames match this filter</div>}
        {filteredAssets.length > renderedAssets.length && (
          <button className="grid-load-more" type="button" onClick={() => setVisibleCount((count) => count + GRID_BATCH_SIZE)}>
            Load next {Math.min(GRID_BATCH_SIZE, filteredAssets.length - renderedAssets.length)}
          </button>
        )}
      </div>
      <aside className="bulk-actions">
        <strong>Actions</strong>
        <span className="grid-density"><kbd>[</kbd><kbd>]</kbd> {state.gridDensity} columns</span>
        <label className="bulk-decision-control">
          <span>Decision</span>
          <select value={bulkDisposition} onChange={(event) => setBulkDisposition(event.target.value as typeof bulkDisposition)} aria-label="Bulk decision">
            <option value="candidate">Candidate</option>
            <option value="select">Select</option>
            <option value="hold">Hold</option>
            <option value="reject">Reject</option>
          </select>
        </label>
        <button onClick={applyBulkDecision} disabled={selectedAssetIds.length === 0}>Set decision</button>
        <label className="manual-tag-control">
          <span>{selectedAssetIds.length} marked</span>
          <input
            id="grid-manual-tag"
            value={manualTagDraft}
            onChange={(event) => onManualTagDraftChange(event.target.value)}
            placeholder="manual tag"
            aria-label="Manual tag"
          />
        </label>
        <button onClick={applyManualTag} disabled={selectedAssetIds.length === 0 || manualTagDraft.trim().length === 0}>
          <Tag size={14} /> Apply manual tag
        </button>
        <button
          onClick={() => groupedSelectedAsset && onOpenDuel(groupedSelectedAsset.groupId!, groupedSelectedAsset.id)}
          disabled={!groupedSelectedAsset}
        >
          Open duel
        </button>
        <button onClick={onExportPreview}>Export preview</button>
        {exportPreview && (
          <div className="export-preview" role="region" aria-label="Export preview">
            <span>{exportPreview.xmpFilesToWrite} XMP files</span>
            <span>{exportPreview.originalFilesModified} originals modified</span>
            <span>{exportPreview.metadataRecords.length} metadata rows</span>
            {exportPreview.targets.slice(0, 3).map((target) => (
              <small key={target.sidecarPath}>
                {target.sidecarPath} · {target.colorLabel} · {target.rating} stars
              </small>
            ))}
          </div>
        )}
      </aside>
    </section>
  );
}
