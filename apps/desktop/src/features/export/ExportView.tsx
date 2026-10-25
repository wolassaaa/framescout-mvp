import { useEffect, useMemo, useState } from "react";
import type { ExportCommitResponse, ExportPreviewResponse, ExportSettings, ReviewAsset } from "@framescout/contracts";
import { folderGroupFor } from "../project/projectExport";
import { Check, Copy, Download, FileSpreadsheet, FolderInput, RefreshCw, ShieldCheck } from "lucide-react";
import { type UiLanguage, uiCopy } from "../../i18n/uiCopy";
import { localizedTag } from "../../i18n/tagLabels";
import { localizedProjectedTag, projectAssetTags, type ProjectedTag } from "../coverage/tagProjection";

function displayExportTag(projected: ProjectedTag, language: UiLanguage): string {
  if (projected.category === "content") {
    const tag = projected.key;
    return localizedTag(tag, language);
  }
  return localizedProjectedTag(projected, language);
}

export function ExportView({
  language,
  preview,
  assets,
  settings,
  onSettingsChange,
  onPreview,
  onCommit,
  onRefreshMetadata,
  onDownloadCsv,
  onCopySelectedPaths
}: {
  language: UiLanguage;
  preview: ExportPreviewResponse | null;
  assets: ReviewAsset[];
  settings: ExportSettings;
  onSettingsChange: (settings: ExportSettings) => void;
  onPreview: () => Promise<void> | void;
  onCommit: () => Promise<ExportCommitResponse> | ExportCommitResponse;
  onRefreshMetadata: () => Promise<void> | void;
  onDownloadCsv: (preview: ExportPreviewResponse) => void;
  onCopySelectedPaths: (language: UiLanguage) => Promise<string>;
}) {
  const t = uiCopy[language].export;
  const [confirmed, setConfirmed] = useState(false);
  const [commitResponse, setCommitResponse] = useState<ExportCommitResponse | null>(null);
  const [utilityStatus, setUtilityStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterTab, setFilterTab] = useState<"decision" | "folders" | "tags" | "recipe">("decision");
  const [tagRuleMode, setTagRuleMode] = useState<"include" | "exclude">("include");
  const canExport = settings.destinationDir.trim().length > 0;
  const rawEnabled = settings.media !== "proxies";
  const copySummary = useMemo(() => preview?.filesToCopy.reduce((counts, file) => {
    counts[file.kind] += 1;
    return counts;
  }, { proxy: 0, raw: 0 }) ?? { proxy: 0, raw: 0 }, [preview]);
  const folderGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assets) {
      const group = folderGroupFor(asset.sourcePath);
      if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [assets]);
  const availableTags = useMemo(() => {
    const counts = new Map<string, { tag: ProjectedTag; count: number }>();
    for (const asset of assets) {
      for (const tag of projectAssetTags(asset)) {
        const row = counts.get(tag.key) ?? { tag, count: 0 };
        row.count += 1;
        counts.set(tag.key, row);
      }
    }
    return [...counts.values()].sort((left, right) => left.tag.key.localeCompare(right.tag.key));
  }, [assets]);

  useEffect(() => {
    setConfirmed(false);
    setCommitResponse(null);
  }, [preview]);

  useEffect(() => setUtilityStatus(null), [language]);

  const update = (patch: Partial<ExportSettings>) => onSettingsChange({ ...settings, ...patch });
  const toggle = (key: "includedFolderGroups" | "includedTags" | "excludedTags", value: string) => {
    const values = settings[key];
    update({ [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] });
  };
  const refreshMetadata = async () => {
    setBusy(true);
    try {
      await onRefreshMetadata();
      setUtilityStatus(t.metadataStarted);
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    try {
      setCommitResponse(await onCommit());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="export-view" aria-label={t.region}>
      <header className="export-header">
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <span>{t.subtitle}</span>
        </div>
        <button className="compact-command" disabled={busy} onClick={() => void refreshMetadata()}><RefreshCw size={15} /> {t.refreshMetadata}</button>
      </header>

      <section className="export-config" aria-label={t.settings}>
        <label className="export-path-field">
          <span>{t.destination}</span>
          <div><FolderInput size={17} /><input value={settings.destinationDir} onChange={(event) => update({ destinationDir: event.target.value })} placeholder={t.destinationPlaceholder} aria-label={t.destination} /></div>
          <small>{t.destinationHelp}</small>
        </label>

        <div className="export-setting-grid">
          <label>
            <span>{t.scope}</span>
            <select value={settings.selectionScope} onChange={(event) => update({ selectionScope: event.target.value as ExportSettings["selectionScope"] })}>
              <option value="selected">{t.selectedOnly}</option>
              <option value="decided">{t.decided}</option>
            </select>
          </label>
          <div className="export-mode-control">
            <span>{t.media}</span>
            <div role="group" aria-label={t.mediaLabel}>
              {([
                ["proxies", t.proxies],
                ["raw", t.raw],
                ["proxies-and-raw", t.both]
              ] as const).map(([value, label]) => <button key={value} className={settings.media === value ? "active" : ""} aria-pressed={settings.media === value} onClick={() => update({ media: value })}>{label}</button>)}
            </div>
          </div>
          {rawEnabled && <label>
            <span>{t.rawFolder}</span>
            <select value={settings.rawLayout} onChange={(event) => update({ rawLayout: event.target.value as ExportSettings["rawLayout"] })}>
              <option value="raw-subfolder">{t.rawSubfolder}</option>
              <option value="same-folder">{t.sameFolder}</option>
            </select>
          </label>}
          <label className="export-check"><input type="checkbox" checked={settings.preserveFolderStructure} onChange={(event) => update({ preserveFolderStructure: event.target.checked })} /><span>{t.preserveFolders}</span></label>
          <label className="export-check"><input type="checkbox" checked={settings.includeXmp} onChange={(event) => update({ includeXmp: event.target.checked })} /><span>{t.includeXmp}</span></label>
          <label className="export-check"><input type="checkbox" checked={settings.includeCsv} onChange={(event) => update({ includeCsv: event.target.checked })} /><span>{t.includeCsv}</span></label>
        </div>
        <section className="export-filter-workbench" aria-label={t.selectionFilters}>
          <div className="export-filter-tabs" role="tablist" aria-label={t.filters}>
            {([
              ["decision", t.decisions],
              ["folders", `${t.folders} ${settings.includedFolderGroups.length}`],
              ["tags", `${t.tags} ${settings.includedTags.length + settings.excludedTags.length}`],
              ["recipe", t.recipe]
            ] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" aria-selected={filterTab === tab} className={filterTab === tab ? "active" : ""} onClick={() => setFilterTab(tab)}>{label}</button>)}
          </div>
          {filterTab === "decision" && <div className="export-filter-copy"><strong>{t.decisionTitle}</strong><span>{t.decisionHelp}</span></div>}
          {filterTab === "folders" && <div className="export-filter-list">
            {folderGroups.length === 0 ? <span>{t.noFolders}</span> : folderGroups.map(([folder, count]) => <button type="button" key={folder} className={settings.includedFolderGroups.includes(folder) ? "active" : ""} onClick={() => toggle("includedFolderGroups", folder)}><span>{folder}</span><small>{count}</small></button>)}
          </div>}
          {filterTab === "tags" && <><div className="export-tag-rule" role="group" aria-label={t.tags}><button type="button" className={tagRuleMode === "include" ? "active" : ""} onClick={() => setTagRuleMode("include")}>{t.includeList} {settings.includedTags.length}</button><button type="button" className={tagRuleMode === "exclude" ? "active" : ""} onClick={() => setTagRuleMode("exclude")}>{t.excludeList} {settings.excludedTags.length}</button><span>{tagRuleMode === "include" ? t.includeHelp : t.excludeHelp}</span></div><div className="export-filter-list export-tag-list">
            {availableTags.length === 0 ? <span>{t.noTags}</span> : availableTags.map(({ tag, count }) => <button type="button" key={tag.key} className={(tagRuleMode === "include" ? settings.includedTags : settings.excludedTags).includes(tag.key) ? "active" : ""} onClick={() => toggle(tagRuleMode === "include" ? "includedTags" : "excludedTags", tag.key)}><span>{displayExportTag(tag, language)}<small aria-hidden="true">{tag.category}</small></span><small>{count}</small></button>)}
          </div></>}
          {filterTab === "recipe" && <div className="export-filter-copy export-filter-recipe"><div><strong>{t.recipeTitle}</strong><span>{t.recipeHelp}</span></div><div className="export-match-control" role="group" aria-label={t.recipe}><button type="button" className={settings.filterMatch === "all" ? "active" : ""} onClick={() => update({ filterMatch: "all" })}>{t.matchAll}</button><button type="button" className={settings.filterMatch === "any" ? "active" : ""} onClick={() => update({ filterMatch: "any" })}>{t.matchAny}</button></div></div>}
        </section>
        <button className="primary-action" disabled={!canExport || busy} onClick={() => void onPreview()}><FileSpreadsheet size={17} /> {t.preview}</button>
      </section>

      {preview && <>
        <div className="export-summary">
          <div><strong>{copySummary.proxy}</strong><span>{t.proxyCopies}</span></div>
          <div><strong>{copySummary.raw}</strong><span>{t.rawCopies}</span></div>
          <div><strong>{preview.xmpFilesToWrite}</strong><span>{t.xmpFiles}</span></div>
          <div><strong>{preview.skipped.length}</strong><span>{t.skipped}</span></div>
        </div>

        <div className="export-columns export-delivery-columns">
          <section className="export-targets" aria-label={t.copyTargets}>
            <div className="export-section-title"><strong>{t.copyList}</strong><span>{t.copyListHelp}</span></div>
            {preview.filesToCopy.length === 0 ? <p className="export-empty-list">{t.emptyCopyList}</p> : preview.filesToCopy.slice(0, 32).map((file) => (
              <article key={`${file.kind}-${file.sourcePath}`}>
                <div><strong>{file.destinationPath}</strong><span>{file.kind === "raw" ? t.rawMapping : t.proxy}</span></div>
                <small>{file.sourcePath}</small>
              </article>
            ))}
            {preview.filesToCopy.length > 32 && <p className="export-more">{preview.filesToCopy.length - 32} {t.moreFiles}</p>}
          </section>

          <aside className="export-checkpoint">
            <ShieldCheck size={20} />
            <strong>{t.confirmTitle}</strong>
            <span>{t.confirmPrefix} {preview.filesToCopy.length} {t.confirmSuffix}</span>
            <label className="export-confirmation"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{t.confirmLabel}</span></label>
            <button className="primary-action wide" disabled={!confirmed || busy || preview.filesToCopy.length === 0} onClick={() => void commit()}><Check size={17} /> {t.commit}</button>
            {commitResponse && <p className="export-commit-status">{commitResponse.committed ? `${t.copied} ${commitResponse.filesCopied} ${t.files} ${commitResponse.rawFilesCopied} ${t.xmp} ${commitResponse.xmpFilesWritten} ${t.xmpEnd}` : t.commitUnavailable}</p>}
          </aside>
        </div>

        <div className="export-utilities" role="region" aria-label={t.utilities}>
          <button className="compact-command" onClick={() => onDownloadCsv(preview)}><Download size={15} /> {t.downloadCsv}</button>
          <button className="compact-command" onClick={() => void onCopySelectedPaths(language).then(setUtilityStatus)}><Copy size={15} /> {t.copyPaths}</button>
          {utilityStatus && <span>{utilityStatus}</span>}
        </div>

        <section className="export-metadata" aria-label={t.metadataMap}>
          <div className="export-section-title"><strong>{t.metadataList}</strong><span>{preview.metadataRecords.length} {t.rows}</span></div>
          <pre>{preview.csvPreview}</pre>
        </section>
      </>}
    </section>
  );
}
