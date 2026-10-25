import type { AnalysisRun, PersistedProject } from "@framescout/contracts";
import { Check, Cpu, Image, Link2, Play } from "lucide-react";
import { presetDefinition } from "../../data/presets";
import { type UiLanguage, uiCopy } from "../../i18n/uiCopy";

export function AnalysisQueueView({
  project,
  language,
  run,
  onEnterReview,
  onCorrectMapping,
  showMapping = false
}: {
  project: PersistedProject;
  language: UiLanguage;
  run?: AnalysisRun;
  onEnterReview: () => void;
  onCorrectMapping?: (assetId: string) => void;
  showMapping?: boolean;
}) {
  const text = uiCopy[language].analysis;
  const ready = run?.previewsReady ?? project.assets.filter((asset) => asset.previewState === "ready" || Boolean(asset.previewUrl)).length;
  const total = run?.totalAssets ?? project.assets.length;
  const complete = run?.status === "completed" || (!run && ready === total);
  const reviewReady = total === 0 || ready > 0;
  const mappingCounts = project.assets.reduce<Record<string, number>>((counts, asset) => {
    const status = asset.mappingStatus ?? "proxy_only";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const unresolvedAssets = project.assets.filter((asset) => {
    const status = asset.mappingStatus ?? "proxy_only";
    return status === "ambiguous" || status === "missing_master";
  });

  return (
    <section className="analysis-queue" aria-label={text.region}>
      <header className="analysis-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{complete ? text.ready : text.preparing}</h1>
          <span>{project.name} / {uiCopy[language].presets[presetDefinition(project.preset).copyKey].name}</span>
        </div>
        <button className="primary-action" onClick={onEnterReview} disabled={!reviewReady}>
          <Play size={17} /> {text.enterReview}
        </button>
      </header>

      <div className="analysis-metrics">
        <div><strong>{total}</strong><span>{text.imagesDiscovered}</span></div>
        <div><strong>{ready}</strong><span>{text.aiAnalyzed}</span></div>
        <div><strong>{run?.rawPlaceholders ?? 0}</strong><span>{text.rawPlaceholders}</span></div>
        <div><Cpu size={17} /><span>{run?.backend ?? "browser"} {text.backend}</span></div>
      </div>

      <div className="analysis-workspace">
        <div className="analysis-mosaic" aria-label={text.previewMosaic}>
          {project.assets.slice(0, 12).map((asset) => (
            <figure key={asset.id} className={asset.previewState === "ready" ? "ready" : "placeholder"}>
              <img src={asset.previewUrl} alt="" />
              <figcaption>{asset.fileName}</figcaption>
            </figure>
          ))}
        </div>
        <aside className="analysis-log" aria-label={text.status}>
          <div><Check size={16} /><strong>{complete ? text.queueReady : text.running}</strong></div>
          <span>{ready}/{total} {text.evidence}</span>
          <span>{run?.missingAssets ?? 0} {text.missing}</span>
          <span><Image size={14} /> {text.cr2}</span>
        </aside>
      </div>

      {showMapping && <section className="mapping-summary" aria-label={text.mapping}>
        <div className="mapping-summary-heading">
          <span><Link2 size={16} /> {text.mapping}</span>
          <strong>{mappingCounts.mapped ?? 0} {text.mappedExactly}</strong>
        </div>
        <div className="mapping-summary-counts">
          <span>{mappingCounts.proxy_only ?? 0} {text.proxyOnly}</span>
          <span>{mappingCounts.ambiguous ?? 0} {text.ambiguous}</span>
          <span>{mappingCounts.missing_master ?? 0} {text.missingMasters}</span>
          <span>{mappingCounts.manually_mapped ?? 0} {text.manuallyMapped}</span>
        </div>
        {unresolvedAssets.length > 0 && (
          <div className="mapping-issues">
            {unresolvedAssets.slice(0, 8).map((asset) => (
              <div key={asset.id}>
                <span>{asset.fileName}</span>
                <small>{asset.mappingStatus === "ambiguous" ? text.multipleRaw : text.mappedRawUnavailable}</small>
                {onCorrectMapping && <button type="button" className="compact-command" onClick={() => onCorrectMapping(asset.id)}>{text.chooseRaw}</button>}
              </div>
            ))}
          </div>
        )}
      </section>}
    </section>
  );
}
