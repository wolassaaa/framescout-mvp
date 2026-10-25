import { type ChangeEvent, type Dispatch, FormEvent, useEffect, useRef, useState } from "react";
import type { HumanDisposition, ProjectPreset, ReviewAsset } from "@framescout/contracts";
import { ResilientAssetImage } from "../../components/ResilientAssetImage";
import { presetCatalog, presetDefinition } from "../../data/presets";
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  EyeOff,
  Link2,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  ScanSearch,
  Sparkles,
  ShieldCheck,
  Swords,
  Tag,
  Unlink,
  X
} from "lucide-react";
import type { ReviewAction, ReviewState } from "./reviewState";
import { hasReviewPreview, visibleAssets } from "./reviewState";
import { AiReviewMark } from "./AiReviewMark";
import { SelectionToolbar } from "./SelectionToolbar";
import { formatCopy, type UiLanguage, uiCopy } from "../../i18n/uiCopy";
import { localizedProjectedTag, projectAssetTags } from "../coverage/tagProjection";

function localizedSignal(language: UiLanguage, label: string, value: string) {
  if (language === "en") return { label, value };
  const text = uiCopy[language].review;
  if (label === "Allowed subjects") {
    const count = value.match(/^(\d+) detected$/)?.[1];
    return {
      label: text.allowedSubjects,
      value: count ? formatCopy(text.detectedPeople, { count }) : value === "detector unavailable" ? text.detectorUnavailable : value
    };
  }
  const labels: Record<string, string> = {
    "Subject focus": text.subjectFocus,
    "Global focus": text.globalFocus,
    People: text.people,
    Exposure: text.exposure,
    Preset: text.preset
  };
  const values: Record<string, string> = {
    "sharp crop": text.sharpCrop,
    "soft crop": text.softCrop,
    weak: text.weak,
    "none detected": text.noneDetected,
    usable: text.usable,
    "low light usable": text.lowLightUsable,
    "Matchday story preserves": text.matchdayPreserves
  };
  const detectedCount = value.match(/^(\d+) detected$/)?.[1];
  return { label: labels[label] ?? label, value: detectedCount ? formatCopy(text.detectedPeople, { count: detectedCount }) : values[value] ?? value };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("[contenteditable=true]"))));
}

function AiEvidencePanel({ asset, language }: { asset: ReviewAsset; language: UiLanguage }) {
  const text = uiCopy[language].review;
  const confidences = asset.evidence.flatMap((signal) => signal.confidence == null ? [] : [signal.confidence]);
  const overallConfidence = confidences.length > 0 ? Math.round(Math.max(...confidences) * 100) : null;

  return (
    <section className="ai-evidence" aria-label={text.aiAnalysis}>
      <div className="ai-evidence-heading">
        <span><Sparkles size={14} />{text.aiAnalysis}</span>
        <small>{asset.evidence.length} {text.signalsFound}</small>
      </div>
      <div className={`ai-verdict ${asset.aiDisposition}`}>
        <strong>{text.suggestion[asset.aiDisposition]}</strong>
        <span>{overallConfidence == null ? text.policySignal : `${overallConfidence}% ${text.confidence}`}</span>
      </div>
      <div className="evidence-list">
        {asset.evidence.map((signal) => {
          const localized = localizedSignal(language, signal.label, signal.value);
          const confidence = signal.confidence == null ? null : Math.round(signal.confidence * 100);
          return (
            <div className={`evidence-row ${signal.tone}`} key={signal.label}>
              <div className="evidence-copy"><span>{localized.label}</span><strong>{localized.value}</strong></div>
              <div className="confidence-track" role={confidence == null ? undefined : "progressbar"} aria-label={`${localized.label} ${text.confidence}`} aria-valuenow={confidence ?? undefined} aria-valuemin={confidence == null ? undefined : 0} aria-valuemax={confidence == null ? undefined : 100}>
                <i style={{ width: confidence == null ? "100%" : `${confidence}%` }} />
              </div>
              <small>{confidence == null ? text.policySignal : `${confidence}%`}</small>
            </div>
          );
        })}
      </div>
      <p className="ai-disclaimer">{text.aiDisclaimer}</p>
    </section>
  );
}

function SourceHealth({
  asset,
  language,
  onMarkMissing,
  onRelinkAsset
}: {
  asset: ReviewAsset;
  language: UiLanguage;
  onMarkMissing: (assetId: string) => void;
  onRelinkAsset: (assetId: string, files: File[]) => Promise<void> | void;
}) {
  const text = uiCopy[language].review;
  const inputRef = useRef<HTMLInputElement>(null);
  const isMissing = asset.missingState === "missing" || asset.previewState === "needs-relink";

  const onFileChanged = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) void onRelinkAsset(asset.id, files);
    event.target.value = "";
  };

  return (
    <section className="detail-section source-status" aria-label={text.sourceStatus}>
      <div className={isMissing ? "source-state missing" : "source-state"}>
        {isMissing ? <Unlink size={15} /> : <ShieldCheck size={15} />}
        <strong>{isMissing ? text.sourceMissing : text.sourceAvailable}</strong>
      </div>
      <p>{asset.sourcePath ?? asset.fileName}</p>
      <div className="detail-actions">
        <button type="button" onClick={() => onMarkMissing(asset.id)} disabled={isMissing}>{text.markMissing}</button>
        <button type="button" onClick={() => inputRef.current?.click()}><Link2 size={14} /> {text.relink}</button>
      </div>
      <input ref={inputRef} className="hidden-file-input" type="file" onChange={onFileChanged} />
    </section>
  );
}

function Inspector({
  asset,
  language,
  projectPreset,
  selectionTargetCount,
  recommendedCount,
  onProjectPresetChange,
  onSelectionTargetChange,
  onToggle,
  onMarkMissing,
  onRelinkAsset
}: {
  asset: ReviewAsset;
  language: UiLanguage;
  projectPreset: ProjectPreset;
  selectionTargetCount: number;
  recommendedCount: number;
  onProjectPresetChange: (preset: ProjectPreset) => void;
  onSelectionTargetChange: (targetCount: number) => void;
  onToggle: () => void;
  onMarkMissing: (assetId: string) => void;
  onRelinkAsset: (assetId: string, files: File[]) => Promise<void> | void;
}) {
  const text = uiCopy[language].review;
  const activePreset = presetDefinition(projectPreset);
  const activePresetText = uiCopy[language].presets[activePreset.copyKey];
  return (
    <aside className="inspector" aria-label={text.details}>
      <div className="inspector-heading">
        <span>{text.details}</span>
        <button className="icon-button" onClick={onToggle} title={text.hideDetails}><PanelRightClose size={17} /></button>
      </div>
      <AiEvidencePanel asset={asset} language={language} />
      <section className="detail-section">
        <span className="detail-label">{text.capture}</span>
        <strong>{asset.fileName}</strong>
        <p>{asset.camera}<br />{asset.lens}<br />{asset.exposure} · ISO {asset.iso}</p>
      </section>
      <section className="detail-section tag-section">
        <span className="detail-label">{text.tags}</span>
        <div className="tag-cloud">{projectAssetTags(asset).map((tag) => <span key={tag.key} title={tag.key}>{localizedProjectedTag(tag, language)}</span>)}</div>
      </section>
      <SourceHealth asset={asset} language={language} onMarkMissing={onMarkMissing} onRelinkAsset={onRelinkAsset} />
      <label className="policy-control">
        <span>{text.policy}</span>
        <select aria-label={text.projectPolicy} value={projectPreset} onChange={(event) => onProjectPresetChange(event.target.value as ProjectPreset)}>
          {presetCatalog.map((definition) => <option key={definition.id} value={definition.id}>{uiCopy[language].presets[definition.copyKey].name}</option>)}
        </select>
        <small>{activePresetText.note}</small>
      </label>
      <label className="policy-control selection-goal-control">
        <span>{text.target}</span>
        <div className="selection-goal-input">
          <input
            aria-label={text.selectionTarget}
            type="number"
            min={1}
            max={100000}
            value={selectionTargetCount}
            onChange={(event) => onSelectionTargetChange(Math.max(1, Math.min(100000, Number(event.target.value) || 1)))}
          />
          <strong>{text.recommendedProgress} {recommendedCount}/{selectionTargetCount}</strong>
        </div>
        <small>{text.targetNote}</small>
      </label>
    </aside>
  );
}

function ManualTagEditor({ language, onApply, onClose }: { language: UiLanguage; onApply: (tag: string) => void; onClose: () => void }) {
  const text = uiCopy[language].review;
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.trim()) onApply(draft);
  };

  return (
    <form className="review-tag-editor" role="dialog" aria-label={text.addTag} onSubmit={submit}>
      <label><span>{text.addTag}</span><input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} placeholder={text.placeholder} /></label>
      <button type="submit" className="primary-action" disabled={!draft.trim()}>{text.add}</button>
      <button type="button" className="compact-command" onClick={onClose}>{text.cancel}</button>
    </form>
  );
}

export function ReviewDesk({
  language,
  state,
  dispatch,
  projectPreset,
  selectionTargetCount,
  onProjectPresetChange,
  onSelectionTargetChange,
  onMarkMissing,
  onRelinkAsset,
  onOpenDuel,
  onApplyManualTag
}: {
  language: UiLanguage;
  state: ReviewState;
  dispatch: Dispatch<ReviewAction>;
  projectPreset: ProjectPreset;
  selectionTargetCount: number;
  onProjectPresetChange: (preset: ProjectPreset) => void;
  onSelectionTargetChange: (targetCount: number) => void;
  onMarkMissing: (assetId: string) => void;
  onRelinkAsset: (assetId: string, files: File[]) => Promise<void> | void;
  onOpenDuel: (groupId: string, focusAssetId: string) => void;
  onApplyManualTag: (assetIds: string[], tag: string) => void;
}) {
  const text = uiCopy[language].review;
  const queue = visibleAssets(state);
  const resultIds = queue.map((item) => item.id);
  const asset = queue[state.cursor] ?? queue[0];
  const filmstripStart = Math.max(0, Math.min(queue.length - 48, state.cursor - 24));
  const filmstripAssets = queue.slice(filmstripStart, filmstripStart + 48);
  const reviewableAssets = state.assets.filter(hasReviewPreview);
  const aiAnalyzedAssets = reviewableAssets.filter((item) => item.evidence.length > 0);
  const counts = {
    all: reviewableAssets.length,
    keep: aiAnalyzedAssets.filter((item) => item.aiDisposition === "keep").length,
    review: aiAnalyzedAssets.filter((item) => item.aiDisposition === "review").length,
    reject: aiAnalyzedAssets.filter((item) => item.aiDisposition === "reject").length,
    selected: reviewableAssets.filter((item) => item.humanDisposition === "select").length,
    recommended: reviewableAssets.filter((item) => item.aiRecommended).length
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.altKey || event.metaKey) return;
      if (event.ctrlKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        dispatch({ type: "selectAssets", assetIds: reviewableAssets.map((item) => item.id) });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "clearGridSelection" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, reviewableAssets]);

  if (!asset) return <section className="review-desk empty-review" aria-label={text.region}>{text.noMatch}</section>;

  const displayUrl = asset.displayUrl ?? asset.previewUrl;
  const decide = (disposition: Exclude<HumanDisposition, "unseen">) => dispatch({ type: "setDecision", disposition });
  const filters: Array<{ id: "all" | "recommended" | "keep" | "review" | "reject" | "selected"; label: string; count: number }> = [
    { id: "all", label: text.all, count: counts.all },
    { id: "recommended", label: text.recommended, count: counts.recommended },
    { id: "keep", label: text.suggestion.keep, count: counts.keep },
    { id: "review", label: text.needsReview, count: counts.review },
    { id: "reject", label: text.suggestion.reject, count: counts.reject },
    { id: "selected", label: text.selected, count: counts.selected }
  ];

  return (
    <section className={state.inspectorOpen ? "review-desk" : "review-desk inspector-collapsed"} aria-label={text.region}>
      <aside className="filter-rail" aria-label={text.filters}>
        <div className="rail-heading"><span>{text.queue}</span><strong>{queue.length}</strong></div>
        <div className="review-mode-control" role="group" aria-label={text.queue}>
          {(["assisted", "all", "reject-audit"] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={state.reviewMode === mode} onClick={() => dispatch({ type: "setReviewMode", mode })}>
              {uiCopy[language].reviewMode[mode]}
            </button>
          ))}
        </div>
        {filters.map((filter) => (
          <button key={filter.id} className={state.reviewFilter === filter.id ? "rail-item active" : "rail-item"} onClick={() => dispatch({ type: "setReviewFilter", filter: filter.id })}>
            <span>{filter.label}</span><strong>{filter.count}</strong>
          </button>
        ))}
        <div className="rail-footnote">{text.footnote}</div>
      </aside>

      <div className="stage-column">
        <header className="frame-header">
          <div className="frame-name">
            <strong>{asset.fileName}</strong>
            <span>{state.cursor + 1} {text.of} {queue.length}</span>
            {asset.aiRecommended && <span className="ai-rank-badge"><Sparkles size={13} /> {formatCopy(text.topRank, { rank: asset.aiSelectionRank ?? "" })}</span>}
          </div>
          <div className="frame-tools">
            {asset.groupId && <button className="duel-entry" onClick={() => onOpenDuel(asset.groupId!, asset.id)}><Swords size={15} /> {text.compare}</button>}
            <button className="icon-button" onClick={() => dispatch({ type: "toggleTagEditor" })} title={text.addTag}><Tag size={17} /></button>
            <button className="icon-button" onClick={() => dispatch({ type: "toggleInspector" })} title={text.showDetails}><PanelRightOpen size={17} /></button>
          </div>
        </header>
        <div className="compact-review-filters" role="group" aria-label={text.filters}>
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={state.reviewFilter === filter.id ? "active" : undefined}
              aria-pressed={state.reviewFilter === filter.id}
              onClick={() => dispatch({ type: "setReviewFilter", filter: filter.id })}
            >
              <span>{filter.label}</span><strong>{filter.count}</strong>
            </button>
          ))}
        </div>
        <div className="image-stage">
          <ResilientAssetImage src={displayUrl} alt={asset.fileName} previewState={asset.previewState} language={language} eager />
          {state.loupeOpen && <div className="loupe"><ScanSearch size={16} /><img src={displayUrl} alt="" /><span>{text.focus}</span></div>}
          {!state.showAiRejects && <div className="recoverable-note"><EyeOff size={14} /> {text.rejectsHidden}</div>}
        </div>
        <SelectionToolbar language={language} sessionIds={reviewableAssets.map((item) => item.id)} selectedIds={state.gridSelection} dispatch={dispatch} />
        <div className="decision-bar" aria-label={text.setDecision}>
          <button className={`decision candidate${asset.humanDisposition === "candidate" ? " active" : ""}`} aria-pressed={asset.humanDisposition === "candidate"} onClick={() => decide("candidate")}><Bookmark size={18} /><span>{text.decision.candidate}</span><kbd>1</kbd></button>
          <button className={`decision select${asset.humanDisposition === "select" ? " active" : ""}`} aria-pressed={asset.humanDisposition === "select"} onClick={() => decide("select")}><Check size={19} /><span>{text.decision.select}</span><kbd>2</kbd></button>
          <button className={`decision hold${asset.humanDisposition === "hold" ? " active" : ""}`} aria-pressed={asset.humanDisposition === "hold"} onClick={() => decide("hold")}><Pause size={18} /><span>{text.decision.hold}</span><kbd>3</kbd></button>
          <button className={`decision reject${asset.humanDisposition === "reject" ? " active" : ""}`} aria-pressed={asset.humanDisposition === "reject"} onClick={() => decide("reject")}><X size={19} /><span>{text.decision.reject}</span><kbd>X</kbd></button>
        </div>
        <nav className="filmstrip" aria-label={text.filmstrip}>
          <button className="filmstrip-nav" onClick={() => dispatch({ type: "previous" })} title={text.previous}><ChevronLeft size={21} /></button>
          <div className="filmstrip-frames">
            {filmstripAssets.map((item, index) => (
              <button className={item.id === asset.id ? "thumb active" : "thumb"} key={item.id} onClick={() => dispatch({ type: "setCursor", cursor: filmstripStart + index })} title={item.fileName}>
                <ResilientAssetImage src={item.previewUrl} alt={item.fileName} previewState={item.previewState} language={language} />
                <span className="filmstrip-meta"><AiReviewMark asset={item} language={language} /><span>{text.human[item.humanDisposition]}</span></span>
              </button>
            ))}
          </div>
          <button className="filmstrip-nav" onClick={() => dispatch({ type: "next" })} title={text.next}><ChevronRight size={21} /></button>
        </nav>
      </div>

      {state.inspectorOpen ? <Inspector asset={asset} language={language} projectPreset={projectPreset} selectionTargetCount={selectionTargetCount} recommendedCount={counts.recommended} onProjectPresetChange={onProjectPresetChange} onSelectionTargetChange={onSelectionTargetChange} onToggle={() => dispatch({ type: "toggleInspector" })} onMarkMissing={onMarkMissing} onRelinkAsset={onRelinkAsset} /> : <button className="inspector-opener" onClick={() => dispatch({ type: "toggleInspector" })} title={text.showDetails}><PanelRightOpen size={18} /></button>}
      {state.tagEditorOpen && <ManualTagEditor language={language} onApply={(tag) => { onApplyManualTag([asset.id], tag); dispatch({ type: "closeTagEditor" }); }} onClose={() => dispatch({ type: "closeTagEditor" })} />}
    </section>
  );
}
