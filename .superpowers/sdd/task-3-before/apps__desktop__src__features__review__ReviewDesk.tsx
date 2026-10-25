import { type ChangeEvent, type Dispatch, FormEvent, useEffect, useRef, useState } from "react";
import type { AiDisposition, HumanDisposition, ProjectPreset, ReviewAsset } from "@framescout/contracts";
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

type UiLanguage = "zh" | "en";

const reviewCopy = {
  zh: {
    suggestion: { keep: "建议保留", review: "建议复核", reject: "可能淘汰" } as Record<AiDisposition, string>,
    human: { unseen: "未判断", candidate: "候选", select: "精选", hold: "保留观察", reject: "淘汰" } as Record<HumanDisposition, string>,
    decision: { candidate: "候选", select: "精选", hold: "保留观察", reject: "淘汰" },
    sourceAvailable: "原始文件可用", sourceMissing: "需要重新关联源文件", markMissing: "标记缺失", relink: "重新关联",
    details: "画面详情", hideDetails: "收起详情", noNote: "暂无自动说明", capture: "拍摄信息", signals: "判断依据", tags: "标签", policy: "审阅策略",
    addTag: "添加标签", add: "添加", cancel: "取消", placeholder: "编辑精选", noMatch: "当前筛选条件下没有照片",
    queue: "待审队列", all: "全部照片", recommended: "AI 推荐", needsReview: "需要复核", selected: "已精选", footnote: "AI 只提供建议，最终决定由你做出。",
    target: "推荐目标", targetNote: "按全项目评分，并优先覆盖不同连拍组。", recommendedProgress: "当前推荐",
    of: "/", compare: "组内对比", showDetails: "显示详情", focus: "焦点检查", rejectsHidden: "已隐藏 AI 淘汰项",
    setDecision: "设置决定", filmstrip: "胶片条", previous: "上一张", next: "下一张"
    , aiAnalysis: "AI 识别", aiEvidence: "显示 AI 证据", hideAiEvidence: "隐藏 AI 证据", signalsFound: "条证据", confidence: "置信度",
    policySignal: "策略规则", aiDisclaimer: "证据用于辅助筛选，不会覆盖人工决定。"
  },
  en: {
    suggestion: { keep: "Suggested keep", review: "Worth another look", reject: "Likely reject" } as Record<AiDisposition, string>,
    human: { unseen: "Unrated", candidate: "Candidate", select: "Selected", hold: "On hold", reject: "Rejected" } as Record<HumanDisposition, string>,
    decision: { candidate: "Candidate", select: "Select", hold: "Hold", reject: "Reject" },
    sourceAvailable: "Original source available", sourceMissing: "Source needs relinking", markMissing: "Mark missing", relink: "Relink",
    details: "Frame details", hideDetails: "Hide details", noNote: "No automated note", capture: "Capture", signals: "Signals", tags: "Tags", policy: "Review policy",
    addTag: "Add a tag", add: "Add", cancel: "Cancel", placeholder: "editor pick", noMatch: "No frames match this filter.",
    queue: "Queue", all: "All frames", recommended: "AI picks", needsReview: "Needs review", selected: "Selected", footnote: "AI is a suggestion. Your decision is final.",
    target: "Recommendation target", targetNote: "Ranks the project while favoring burst diversity.", recommendedProgress: "Recommended",
    of: "of", compare: "Compare burst", showDetails: "Show details", focus: "Focus check", rejectsHidden: "AI rejects are hidden",
    setDecision: "Set decision", filmstrip: "Filmstrip", previous: "Previous frame", next: "Next frame"
    , aiAnalysis: "AI analysis", aiEvidence: "Show AI evidence", hideAiEvidence: "Hide AI evidence", signalsFound: "signals", confidence: "confidence",
    policySignal: "Policy rule", aiDisclaimer: "Evidence assists review and never overrides your decision."
  }
};

const signalTranslations: Record<string, { label: string; values?: Record<string, string> }> = {
  "Allowed subjects": { label: "\u5141\u8bb8\u4e3b\u4f53" },
  "Subject focus": { label: "主体清晰度", values: { "sharp crop": "局部清晰", "soft crop": "局部偏虚" } },
  "Global focus": { label: "全局清晰度", values: { weak: "较弱" } },
  People: { label: "人物识别", values: { "2 detected": "识别到 2 人", "none detected": "未识别到人物" } },
  Exposure: { label: "曝光可用性", values: { usable: "可用", "low light usable": "低照度可用" } },
  Preset: { label: "项目策略", values: { "Matchday story preserves": "比赛故事策略保护" } }
};

function localizedSignal(language: UiLanguage, label: string, value: string) {
  if (language === "en") return { label, value };
  if (label === "Allowed subjects") {
    const count = value.match(/^(\d+) detected$/)?.[1];
    return {
      label: "\u5141\u8bb8\u4e3b\u4f53",
      value: count ? `\u8bc6\u522b\u5230 ${count} \u4e2a\u4e3b\u4f53` : value === "detector unavailable" ? "\u68c0\u6d4b\u5668\u4e0d\u53ef\u7528" : value
    };
  }
  const translation = signalTranslations[label];
  return { label: translation?.label ?? label, value: translation?.values?.[value] ?? value };
}

function AiEvidencePanel({ asset, language }: { asset: ReviewAsset; language: UiLanguage }) {
  const text = reviewCopy[language];
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
  const text = reviewCopy[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const isMissing = asset.missingState === "missing" || asset.previewState === "needs-relink";

  const onFileChanged = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) void onRelinkAsset(asset.id, files);
    event.target.value = "";
  };

  return (
    <section className="detail-section source-status" aria-label="Source status">
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
  const text = reviewCopy[language];
  const activePreset = presetDefinition(projectPreset);
  return (
    <aside className="inspector" aria-label="Frame details">
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
        <div className="tag-cloud">{asset.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      </section>
      <SourceHealth asset={asset} language={language} onMarkMissing={onMarkMissing} onRelinkAsset={onRelinkAsset} />
      <label className="policy-control">
        <span>{text.policy}</span>
        <select aria-label="Project policy" value={projectPreset} onChange={(event) => onProjectPresetChange(event.target.value as ProjectPreset)}>
          {presetCatalog.map((definition) => <option key={definition.id} value={definition.id}>{definition.name[language]}</option>)}
        </select>
        <small>{activePreset.note[language]}</small>
      </label>
      <label className="policy-control selection-goal-control">
        <span>{text.target}</span>
        <div className="selection-goal-input">
          <input
            aria-label="AI selection target"
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
  const text = reviewCopy[language];
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.trim()) onApply(draft);
  };

  return (
    <form className="review-tag-editor" role="dialog" aria-label="Add manual tag" onSubmit={submit}>
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
  const text = reviewCopy[language];
  const queue = visibleAssets(state);
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

  if (!asset) return <section className="review-desk empty-review" aria-label="Review Desk">{text.noMatch}</section>;

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
    <section className={state.inspectorOpen ? "review-desk" : "review-desk inspector-collapsed"} aria-label="Review Desk">
      <aside className="filter-rail" aria-label="Review filters">
        <div className="rail-heading"><span>{text.queue}</span><strong>{queue.length}</strong></div>
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
            {asset.aiRecommended && <span className="ai-rank-badge"><Sparkles size={13} /> Top {asset.aiSelectionRank}</span>}
          </div>
          <div className="frame-tools">
            {asset.groupId && <button className="duel-entry" onClick={() => onOpenDuel(asset.groupId!, asset.id)}><Swords size={15} /> {text.compare}</button>}
            <button className="icon-button" onClick={() => dispatch({ type: "toggleTagEditor" })} title={text.addTag}><Tag size={17} /></button>
            <button className="icon-button" onClick={() => dispatch({ type: "toggleInspector" })} title={text.showDetails}><PanelRightOpen size={17} /></button>
          </div>
        </header>
        <div className="image-stage">
          <img src={displayUrl} alt={asset.fileName} />
          {state.loupeOpen && <div className="loupe"><ScanSearch size={16} /><img src={displayUrl} alt="" /><span>{text.focus}</span></div>}
          {!state.showAiRejects && <div className="recoverable-note"><EyeOff size={14} /> {text.rejectsHidden}</div>}
        </div>
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
                <img loading="lazy" src={item.previewUrl} alt={item.fileName} /><span>{text.human[item.humanDisposition]}</span>
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
