import { useMemo, useState, type Dispatch } from "react";
import type { ReviewAsset } from "@framescout/contracts";
import { Check, Search, Tag, Tags } from "lucide-react";
import { ResilientAssetImage } from "../../components/ResilientAssetImage";
import { quickTagSlots, tagTaxonomy } from "./tagTaxonomy";
import { formatCopy, type UiLanguage, uiCopy } from "../../i18n/uiCopy";
import { localizedTag } from "../../i18n/tagLabels";
import { SelectionToolbar } from "../review/SelectionToolbar";
import type { ReviewAction } from "../review/reviewState";
import { projectAssetTags, type ProjectedTag, type ProjectedTagCategory } from "./tagProjection";

type TagScope = "all" | ProjectedTagCategory;
const tagScopes: TagScope[] = ["all", "content", "ai-workflow", "human-workflow", "organization", "technical"];
const COVERAGE_TAG_BATCH_SIZE = 200;
const COVERAGE_ASSET_BATCH_SIZE = 200;

function scopeLabel(scope: TagScope, language: UiLanguage): string {
  const zh: Record<TagScope, string> = { all: "全部标签", content: "内容", "ai-workflow": "AI 工作流", "human-workflow": "人工工作流", organization: "文件与组织", technical: "拍摄信息" };
  const en: Record<TagScope, string> = { all: "All tags", content: "Content", "ai-workflow": "AI workflow", "human-workflow": "Human workflow", organization: "File and organization", technical: "Technical" };
  return (language === "zh" ? zh : en)[scope];
}

function projectedLabel(tag: ProjectedTag, language: UiLanguage): string {
  if (tag.category === "content") return localizedTag(tag.key, language);
  const ai: Record<string, [string, string]> = {
    "workflow:ai:keep": ["AI 建议保留", "AI keep"],
    "workflow:ai:review": ["AI 需要复核", "AI review"],
    "workflow:ai:reject": ["AI 建议淘汰", "AI reject"],
    "workflow:ai:recommended": ["AI 推荐", "AI recommended"]
  };
  const human: Record<string, [string, string]> = {
    "workflow:human:unseen": ["人工未判断", "Human unrated"],
    "workflow:human:candidate": ["人工候选", "Human candidate"],
    "workflow:human:select": ["人工精选", "Human selected"],
    "workflow:human:hold": ["人工保留观察", "Human hold"],
    "workflow:human:reject": ["人工淘汰", "Human reject"]
  };
  const fixed = ai[tag.key] ?? human[tag.key];
  if (fixed) return fixed[language === "zh" ? 0 : 1];
  if (tag.category === "ai-workflow" && tag.key.startsWith("workflow:ai:reason:")) return language === "zh" ? `AI 判断 · ${tag.value}` : `AI reason · ${tag.value}`;
  if (tag.category === "ai-workflow" && tag.key.startsWith("workflow:ai:evidence:")) return language === "zh" ? `AI 证据 · ${tag.value}` : `AI evidence · ${tag.value}`;
  if (tag.category === "organization") return language === "zh" ? `文件 · ${tag.value}` : `File · ${tag.value}`;
  return language === "zh" ? `拍摄 · ${tag.value}` : `Technical · ${tag.value}`;
}

export function CoverageView({ language, assets, selectedAssetIds, dispatch, onApplyManualTag }: {
  language: UiLanguage;
  assets: ReviewAsset[];
  selectedAssetIds: string[];
  dispatch: Dispatch<ReviewAction>;
  onApplyManualTag: (assetIds: string[], tag: string) => void;
}) {
  const text = uiCopy[language].coverage;
  const reviewText = uiCopy[language].review;
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagSource, setTagSource] = useState<"all" | "auto" | "manual">("all");
  const [tagScope, setTagScope] = useState<TagScope>("all");
  const [visibleTagCount, setVisibleTagCount] = useState(COVERAGE_TAG_BATCH_SIZE);
  const [visibleAssetCount, setVisibleAssetCount] = useState(COVERAGE_ASSET_BATCH_SIZE);
  const [draft, setDraft] = useState("");
  const markedAssetIds = selectedAssetIds;
  const projectedByAsset = useMemo(() => new Map(assets.map((asset) => [asset.id, projectAssetTags(asset)])), [assets]);
  const coverage = useMemo(() => {
    const rows = new Map<string, { tag: ProjectedTag; total: number; selected: number }>();
    for (const asset of assets) {
      for (const tag of projectedByAsset.get(asset.id) ?? []) {
        const row = rows.get(tag.key) ?? { tag, total: 0, selected: 0 };
        row.total += 1;
        if (asset.humanDisposition === "select") row.selected += 1;
        rows.set(tag.key, row);
      }
    }
    return [...rows.values()].sort((left, right) => left.tag.key.localeCompare(right.tag.key));
  }, [assets, projectedByAsset]);

  const filteredCoverage = coverage.filter((item) => {
    const sourceMatches = tagSource === "all" || (tagSource === "auto" ? item.tag.source === "ai" || item.tag.category === "ai-workflow" : item.tag.source === "manual" || item.tag.category === "human-workflow");
    const scopeMatches = tagScope === "all" || item.tag.category === tagScope;
    const searchable = `${projectedLabel(item.tag, language)} ${item.tag.key} ${item.tag.value}`.toLowerCase();
    return sourceMatches && scopeMatches && searchable.includes(query.trim().toLowerCase());
  });
  const taggedAssets = activeTag ? assets.filter((asset) => projectedByAsset.get(asset.id)?.some((tag) => tag.key === activeTag)) : [];
  const renderedTaggedAssets = taggedAssets.slice(0, visibleAssetCount);
  const renderedCoverage = filteredCoverage.slice(0, visibleTagCount);
  const apply = () => {
    if (draft.trim() && markedAssetIds.length > 0) {
      onApplyManualTag(markedAssetIds, draft);
      setDraft("");
    }
  };
  const toggleAsset = (assetId: string) => dispatch({ type: "toggleGridSelection", assetId });

  return (
    <section className="coverage-view" aria-label={text.region}>
      <header className="coverage-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
        </div>
        <label className="coverage-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.filterTags} aria-label={text.filterTags} />
        </label>
      </header>

      <section className="tag-workbench" aria-label={text.manualTagging}>
        <div className="tag-source-switch" role="group" aria-label={text.tagSource}><button className={tagSource === "all" ? "active" : ""} onClick={() => setTagSource("all")}>{text.all}</button><button className={tagSource === "auto" ? "active" : ""} onClick={() => setTagSource("auto")}>{text.auto}</button><button className={tagSource === "manual" ? "active" : ""} onClick={() => setTagSource("manual")}>{text.manual}</button></div>
        <label className="tag-compose"><Tag size={15} /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={text.tagPlaceholder} aria-label={text.tagName} /></label>
        <button className="primary-action" onClick={apply} disabled={!draft.trim() || markedAssetIds.length === 0}>{formatCopy(text.annotate, { count: markedAssetIds.length })}</button>
        <span>{text.helper}</span>
      </section>

      <div className="tag-source-switch tag-category-switch" role="group" aria-label={language === "zh" ? "标签类别" : "Tag category"}>
        {tagScopes.map((scope) => <button key={scope} type="button" className={tagScope === scope ? "active" : ""} onClick={() => { setTagScope(scope); setActiveTag(null); setVisibleTagCount(COVERAGE_TAG_BATCH_SIZE); }}>{scopeLabel(scope, language)}</button>)}
      </div>

      <SelectionToolbar
        language={language}
        sessionIds={assets.map((asset) => asset.id)}
        selectedIds={markedAssetIds}
        dispatch={dispatch}
      />

      <section className="tag-library" aria-label={text.taxonomy}>
        <div className="quick-tag-slots"><strong>{text.quickTags}</strong>{quickTagSlots.map((slot) => <button type="button" key={slot.key} onClick={() => setDraft(slot.tag)}><kbd>{slot.key}</kbd><span>{localizedTag(slot.tag, language)}</span></button>)}</div>
        <div className="tag-taxonomy">{tagTaxonomy.map((category) => <section key={category.id}><strong>{{ subject: text.source, person: text.people, scene: text.scene, object: text.object, action: text.action, color: text.color, composition: text.composition, quality: text.quality, editorial: text.editorial }[category.id] ?? category.label}</strong><div>{category.examples.map((tag) => <button type="button" key={tag} onClick={() => setDraft(tag)}>{localizedTag(tag, language)}</button>)}</div></section>)}</div>
      </section>

      <div className="coverage-summary">
        <div><strong>{assets.filter((asset) => asset.humanDisposition === "select").length}</strong><span>{text.selectedFrames}</span></div>
        <div><strong>{coverage.filter((item) => item.selected > 0).length}</strong><span>{text.coveredTags}</span></div>
        <div><strong>{coverage.filter((item) => item.total > 0 && item.selected === 0).length}</strong><span>{text.unselectedSets}</span></div>
      </div>

      <div className="coverage-workspace">
        <section className="coverage-matrix" aria-label={text.matrix}>
          <div className="coverage-heading"><span>{text.tag}</span><span>{text.all}</span><span>{text.selected}</span></div>
          {renderedCoverage.map((item) => (
            <button
              key={item.tag.key}
              className={activeTag === item.tag.key ? "coverage-row active" : "coverage-row"}
              onClick={() => {
                setActiveTag(activeTag === item.tag.key ? null : item.tag.key);
                setVisibleAssetCount(COVERAGE_ASSET_BATCH_SIZE);
              }}
            >
              <span>{projectedLabel(item.tag, language)}</span>
              <strong>{item.total}</strong>
              <strong className={item.selected > 0 ? "covered" : "uncovered"}>{item.selected > 0 ? <Check size={14} /> : null}{item.selected}</strong>
            </button>
          ))}
          {filteredCoverage.length > renderedCoverage.length && <button type="button" className="grid-load-more" onClick={() => setVisibleTagCount((count) => count + COVERAGE_TAG_BATCH_SIZE)}>{language === "zh" ? `加载更多标签 ${Math.min(COVERAGE_TAG_BATCH_SIZE, filteredCoverage.length - renderedCoverage.length)}` : `Load ${Math.min(COVERAGE_TAG_BATCH_SIZE, filteredCoverage.length - renderedCoverage.length)} more tags`}</button>}
          {filteredCoverage.length === 0 && <p className="coverage-empty">{text.empty}</p>}
        </section>

        <aside className="coverage-assets" aria-label={text.taggedFrames}>
          {activeTag ? (
            <>
              <div className="coverage-assets-title"><Tags size={16} /><strong>{projectedLabel(coverage.find((item) => item.tag.key === activeTag)?.tag ?? { key: activeTag, value: activeTag, category: "content", source: "derived", exportableByDefault: false }, language)}</strong><span>{taggedAssets.length} {text.frames}</span></div>
              <div className="coverage-asset-list">
                {renderedTaggedAssets.map((asset) => (
                  <button type="button" className={markedAssetIds.includes(asset.id) ? "tagged-asset marked" : "tagged-asset"} key={asset.id} onClick={() => toggleAsset(asset.id)} aria-pressed={markedAssetIds.includes(asset.id)}>
                    <ResilientAssetImage src={asset.previewUrl} alt="" previewState={asset.previewState} language={language} />
                    <span>{asset.fileName}</span>
                    <small>{reviewText.human[asset.humanDisposition]}</small>
                  </button>
                ))}
                {taggedAssets.length > renderedTaggedAssets.length && (
                  <button type="button" className="grid-load-more" onClick={() => setVisibleAssetCount((count) => count + COVERAGE_ASSET_BATCH_SIZE)}>
                    {language === "zh" ? "加载更多照片" : "Load more frames"} {Math.min(COVERAGE_ASSET_BATCH_SIZE, taggedAssets.length - renderedTaggedAssets.length)}
                  </button>
                )}
              </div>
            </>
          ) : <p>{text.inspect}</p>}
        </aside>
      </div>
    </section>
  );
}
