import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Cpu, FolderPlus, LockKeyhole, Play } from "lucide-react";
import type { ProjectPreset } from "@framescout/contracts";
import { presetCatalog } from "../../data/presets";
import { type UiLanguage, uiCopy } from "../../i18n/uiCopy";
import { isSupportedPhaseOneFile } from "../project/projectStore";

export interface ImportStartInput {
  files: File[];
  name: string;
  preset: ProjectPreset;
  roots: string[];
  rawRoots?: string[];
  selectionTargetCount: number;
}

interface ImportViewProps {
  language: UiLanguage;
  onStart: (input: ImportStartInput) => Promise<void> | void;
  onChooseNativeFolder?: () => Promise<string | null>;
  onChooseNativeRawFolder?: () => Promise<string | null>;
}

export function ImportView({ language, onStart, onChooseNativeFolder, onChooseNativeRawFolder }: ImportViewProps) {
  const text = uiCopy[language].import;
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetText = uiCopy[language].presets;
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState(() => text.defaultProjectName);
  const [preset, setPreset] = useState<ProjectPreset>("matchday-story");
  const [selectionTargetCount, setSelectionTargetCount] = useState(50);
  const [nativeRoot, setNativeRoot] = useState<string | null>(null);
  const [nativeRawRoot, setNativeRawRoot] = useState<string | null>(null);
  const supportedFiles = useMemo(() => files.filter(isSupportedPhaseOneFile), [files]);
  const sourceRoot = supportedFiles[0]?.webkitRelativePath?.split("/").filter(Boolean)[0] || "browser-selected-files";
  const sourceLabel = nativeRoot ?? (supportedFiles.length === 0
    ? text.chooseFolder
    : sourceRoot === "browser-selected-files" ? text.localFiles : sourceRoot);
  const canStart = name.trim().length > 0 && (nativeRoot !== null || supportedFiles.length > 0);

  useEffect(() => {
    const folderInput = folderInputRef.current as (HTMLInputElement & { webkitdirectory?: boolean }) | null;
    if (folderInput) folderInput.webkitdirectory = true;
  }, []);

  useEffect(() => {
    setName((current) => current === uiCopy.zh.import.defaultProjectName || current === uiCopy.en.import.defaultProjectName
      ? text.defaultProjectName
      : current);
  }, [text.defaultProjectName]);

  const onFilesChanged = (event: ChangeEvent<HTMLInputElement>) => {
    setNativeRoot(null);
    setFiles(Array.from(event.target.files ?? []));
  };

  const chooseFolder = async () => {
    if (!onChooseNativeFolder) {
      folderInputRef.current?.click();
      return;
    }
    const root = await onChooseNativeFolder();
    if (root) {
      setFiles([]);
      setNativeRoot(root);
    }
  };

  return (
    <section className="import-view" aria-label={text.region}>
      <div className="import-copy">
        <p className="eyebrow">{text.eyebrow}</p>
        <h1>{text.title}</h1>
        <div className="locked-note"><LockKeyhole size={18} /> {text.originalsUntouched}</div>
      </div>
      <div className="import-sheet">
        <label>
          {text.projectName}
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="folder-drop" type="button" onClick={() => void chooseFolder()}>
          <FolderPlus size={28} />
          <span>{sourceLabel}</span>
          <small>{nativeRoot ? text.nativeScan : `${supportedFiles.length} ${text.supportedAssets}`}</small>
        </button>
        <input
          ref={folderInputRef}
          className="hidden-file-input"
          type="file"
          multiple
          onChange={onFilesChanged}
        />
        {onChooseNativeRawFolder && (
          <button
            className="compact-command import-file-command"
            type="button"
            onClick={() => void onChooseNativeRawFolder().then((root) => root && setNativeRawRoot(root))}
          >
            {nativeRawRoot ? `${text.rawMasters}: ${nativeRawRoot}` : text.addRawFolder}
          </button>
        )}
        {!onChooseNativeFolder && (
          <button className="compact-command import-file-command" type="button" onClick={() => fileInputRef.current?.click()}>
            {text.addFiles}
          </button>
        )}
        <input
          ref={fileInputRef}
          className="hidden-file-input"
          data-testid="import-file-input"
          type="file"
          multiple
          onChange={onFilesChanged}
        />
        <div className="preset-grid">
          {presetCatalog.map((definition) => (
            <button
              className={definition.id === preset ? "preset-tile selected" : "preset-tile"}
              key={definition.id}
              onClick={() => setPreset(definition.id)}
              aria-pressed={definition.id === preset}
            >
              <strong>{presetText[definition.copyKey].name}</strong>
              <span>{presetText[definition.copyKey].note}</span>
            </button>
          ))}
        </div>
        <label className="selection-target-field">
          <span>{text.selectionTarget}</span>
          <input
            type="number"
            min={1}
            max={100000}
            step={1}
            value={selectionTargetCount}
            onChange={(event) => setSelectionTargetCount(Math.max(1, Math.min(100000, Number(event.target.value) || 1)))}
          />
          <small>{text.selectionTargetHelp}</small>
        </label>
        <details>
          <summary><Cpu size={16} /> {text.advanced}</summary>
          <div className="advanced-row">
            <span>{text.backend}</span>
            <strong>{text.browserAdapter}</strong>
          </div>
          <div className="advanced-row">
            <span>{text.previewSupport}</span>
            <strong>{text.previewDetail}</strong>
          </div>
        </details>
        <button
          className="primary-action wide"
          disabled={!canStart}
          onClick={() => void onStart({
            files: supportedFiles,
            name,
            preset,
            roots: [nativeRoot ?? sourceRoot],
            rawRoots: nativeRawRoot ? [nativeRawRoot] : undefined,
            selectionTargetCount
          })}
        >
          <Play size={18} /> {text.start}
        </button>
      </div>
    </section>
  );
}
