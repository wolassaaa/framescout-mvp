import { type CSSProperties, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { FileOutput, FolderOpen, Grid2X2, Image, Import, Languages, Minus, PanelRight, Plus, RotateCcw, Search, Settings2, SlidersHorizontal, Tags } from "lucide-react";
import type { AnalysisConfigResponse, AnalysisConfigSetRequest, AnalysisProfileId, ExportCommitResponse, ExportPreviewResponse, ExportSettings, ProjectIndexStatusResponse, ProjectPreset } from "@framescout/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { assets } from "./data/fixtures";
import { AnalysisQueueView } from "./features/analysis/AnalysisQueueView";
import { AnalysisProfileSwitcher } from "./features/analysis/AnalysisProfileSwitcher";
import { CoverageView } from "./features/coverage/CoverageView";
import { quickTagForKey } from "./features/coverage/tagTaxonomy";
import { GridView } from "./features/grid/GridView";
import { DuelView } from "./features/duel/DuelView";
import { ExportView } from "./features/export/ExportView";
import { type ImportStartInput, ImportView } from "./features/import/ImportView";
import { ProjectsView } from "./features/projects/ProjectsView";
import { buildExportPreview, defaultExportSettings } from "./features/project/projectExport";
import { openGroup } from "./features/project/projectGroup";
import { isServiceRuntime, type ConnectedRuntimeProjectClient } from "./features/project/runtimeProjectClient";
import { chooseLocalServiceFolder } from "./features/project/localWebProjectClient";
import {
  emptyServiceProject,
  fixtureProjectFromAssets,
  prepareBrowserProjectFiles,
  projectToSummary,
  projectWithAssetSnapshot,
  projectWithMissingState,
  projectWithPolicy,
  projectWithRelinkedAsset,
  projectWithSelectionGoal,
  normalizeManualTag
} from "./features/project/projectStore";
import { rankAssetsForSelection } from "./features/project/selectionRanking";
import { ReviewDesk } from "./features/review/ReviewDesk";
import { createInitialReviewState, reviewReducer, visibleAssets } from "./features/review/reviewState";
import { documentLanguage, formatCopy, type UiLanguage, uiCopy } from "./i18n/uiCopy";

type Screen = "projects" | "import" | "analysis" | "review" | "grid" | "coverage" | "duel" | "export";

const UI_SCALE_STORAGE_KEY = "framescout.ui-scale";
const UI_LANGUAGE_STORAGE_KEY = "framescout.ui-language";
const SHORTCUTS_STORAGE_KEY = "framescout.shortcuts";
const DEFAULT_UI_SCALE = 100;
type ShortcutAction = keyof typeof uiCopy.en.app.shortcuts;

const defaultShortcuts: Record<ShortcutAction, string> = {
  tag: "F",
  batchTag: "Alt+F",
  loupe: "C",
  undo: "Ctrl+Z",
  redo: "Ctrl+Shift+Z"
};

function initialUiScale() {
  const saved = Number(window.localStorage.getItem(UI_SCALE_STORAGE_KEY));
  return Number.isFinite(saved) && saved >= 80 && saved <= 160 ? saved : DEFAULT_UI_SCALE;
}

function initialShortcuts(): Record<ShortcutAction, string> {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SHORTCUTS_STORAGE_KEY) ?? "{}") as Partial<Record<ShortcutAction, string>>;
    return { ...defaultShortcuts, ...Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "string" && value.length > 0)) } as Record<ShortcutAction, string>;
  } catch {
    return defaultShortcuts;
  }
}

function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  const parts = [event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : ""].filter(Boolean);
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...parts, key].join("+");
}

function matchesShortcut(event: KeyboardEvent, configured: string): boolean {
  if (!event.ctrlKey && !event.altKey && !event.metaKey && configured.length === 1) {
    return event.key.toUpperCase() === configured.toUpperCase();
  }
  return shortcutFromEvent(event) === configured;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("[contenteditable=true]"))));
}

const nav = [
  { screen: "projects" as const, copyKey: "projects" as const, icon: FolderOpen },
  { screen: "import" as const, copyKey: "import" as const, icon: Import },
  { screen: "review" as const, copyKey: "review" as const, icon: Image },
  { screen: "grid" as const, copyKey: "grid" as const, icon: Grid2X2 },
  { screen: "coverage" as const, copyKey: "coverage" as const, icon: Tags },
  { screen: "export" as const, copyKey: "export" as const, icon: FileOutput }
] as const;

export function App({ runtimeProjectClient }: { runtimeProjectClient: ConnectedRuntimeProjectClient }) {
  const [project, setProject] = useState(() => runtimeProjectClient.activeProject
    ?? (runtimeProjectClient.kind === "browser" ? fixtureProjectFromAssets(assets) : emptyServiceProject()));
  const [recentProjects, setRecentProjects] = useState(() => runtimeProjectClient.kind === "browser"
    ? runtimeProjectClient.client.listProjects()
    : runtimeProjectClient.activeProject ? [projectToSummary(runtimeProjectClient.activeProject)] : []);
  const [screen, setScreen] = useState<Screen>(() => runtimeProjectClient.activeProject || runtimeProjectClient.kind === "browser" ? "review" : "projects");
  const [shortcutOverlay, setShortcutOverlay] = useState(false);
  const [uiScale, setUiScale] = useState(initialUiScale);
  const [shortcuts, setShortcuts] = useState<Record<ShortcutAction, string>>(initialShortcuts);
  const [language, setLanguage] = useState<UiLanguage>(() => window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY) === "en" ? "en" : "zh");
  const [displayControlsOpen, setDisplayControlsOpen] = useState(false);
  const [analysisConfig, setAnalysisConfig] = useState<AnalysisConfigResponse | null>(null);
  const [indexStatus, setIndexStatus] = useState<ProjectIndexStatusResponse | null>(null);
  const [analysisConfigBusy, setAnalysisConfigBusy] = useState(false);
  const [exportPreview, setExportPreview] = useState<ExportPreviewResponse | null>(null);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(defaultExportSettings);
  const [manualTagDraft, setManualTagDraft] = useState("");
  const [nativeSaveError, setNativeSaveError] = useState<string | null>(null);
  const [duel, setDuel] = useState<{ groupId: string; focusAssetId: string } | null>(null);
  const [state, dispatch] = useReducer(reviewReducer, project.assets, createInitialReviewState);
  const nativeProjectRef = useRef(isServiceRuntime(runtimeProjectClient) ? runtimeProjectClient.activeProject : null);
  const nativeDecisionQueueRef = useRef(Promise.resolve());
  const applyManualTagRef = useRef<(assetIds: string[], tag: string) => void>(() => undefined);
  const selected = useMemo(() => state.assets.filter((asset) => asset.humanDisposition === "select").length, [state.assets]);
  const previewReady = useMemo(() => state.assets.filter((asset) => asset.previewState === "ready").length, [state.assets]);
  const lastHydratedPreviewCountRef = useRef(previewReady);
  const selectionTargetCount = project.selectionGoal?.targetCount ?? 50;
  const projectSummary = useMemo(() => projectToSummary({ ...project, assets: state.assets }), [project, state.assets]);
  const latestAnalysisRun = project.analysisRuns?.at(-1);
  const discoveredCount = indexStatus?.discovered ?? state.assets.length;
  const readyPreviewCount = indexStatus?.previewsReady ?? previewReady;
  const importProgress = discoveredCount === 0 ? 0 : Math.min(100, Math.round((readyPreviewCount / discoveredCount) * 100));
  const analysisProgress = latestAnalysisRun
    ? Math.min(100, Math.round((latestAnalysisRun.previewsReady / Math.max(latestAnalysisRun.totalAssets, 1)) * 100))
    : 0;
  const text = uiCopy[language];
  const appText = text.app;
  const runtimeLabel = runtimeProjectClient.kind === "web"
    ? appText.localService
    : runtimeProjectClient.kind === "tauri"
      ? appText.desktopBridge
      : appText.browserFallback;
  const queueNativeWrite = (work: () => Promise<void>) => {
    nativeDecisionQueueRef.current = nativeDecisionQueueRef.current
      .catch(() => undefined)
      .then(work)
      .then(() => setNativeSaveError(null))
      .catch(() => setNativeSaveError(appText.localChangeSaveFailed));
  };

  const updateShortcut = (action: ShortcutAction, value: string) => {
    setShortcuts((current) => {
      const next = { ...current, [action]: value };
      window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    dispatch({ type: "setSelectionRanking", assets: rankAssetsForSelection(state.assets, selectionTargetCount) });
  }, [selectionTargetCount, state.assets]);

  useEffect(() => {
    if (!isServiceRuntime(runtimeProjectClient)) return;
    let cancelled = false;
    runtimeProjectClient.client.getAnalysisConfig()
      .then((config) => { if (!cancelled) setAnalysisConfig(config); })
      .catch((error) => { if (!cancelled) setNativeSaveError(error instanceof Error ? error.message : appText.analysisConfigLoadFailed); });
    return () => { cancelled = true; };
  }, [appText.analysisConfigLoadFailed, runtimeProjectClient]);

  const selectAnalysisProfile = async (profileId: AnalysisProfileId, options?: Omit<AnalysisConfigSetRequest, "profileId">) => {
    if (!isServiceRuntime(runtimeProjectClient)) return;
    setAnalysisConfigBusy(true);
    setNativeSaveError(null);
    try {
      const config = await runtimeProjectClient.client.setAnalysisConfig({ profileId, ...options });
      setAnalysisConfig(config);
    } catch (error) {
      setNativeSaveError(error instanceof Error ? error.message : appText.analysisConfigSaveFailed);
    } finally {
      setAnalysisConfigBusy(false);
    }
  };

  const startAiAnalysis = useCallback(async () => {
    setScreen("analysis");
    setNativeSaveError(null);
    if (project.id === "fixture-phase-0") return;
    try {
      if (isServiceRuntime(runtimeProjectClient)) {
        const active = nativeProjectRef.current;
        if (!active) return;
        const response = await runtimeProjectClient.client.enqueueAnalysis(active, { projectId: active.id, priority: "high" });
        nativeProjectRef.current = response.project;
        setProject(response.project);
        dispatch({ type: "replaceAssets", assets: response.project.assets });
        setRecentProjects([projectToSummary(response.project)]);
        return;
      }
      const response = runtimeProjectClient.client.enqueueAnalysis(project, { projectId: project.id, priority: "high" });
      setProject(response.project);
      dispatch({ type: "replaceAssets", assets: response.project.assets });
      setRecentProjects(runtimeProjectClient.client.listProjects());
    } catch (error) {
      setNativeSaveError(error instanceof Error ? error.message : appText.analysisStartFailed);
    }
  }, [appText.analysisStartFailed, project, runtimeProjectClient]);

  useEffect(() => {
    if (project.id === "fixture-phase-0") return;
    if (isServiceRuntime(runtimeProjectClient)) {
      const desiredAssets = state.assets;
      queueNativeWrite(async () => {
        let persisted = nativeProjectRef.current;
        if (!persisted || persisted.id !== project.id) return;
        const storedById = new Map(persisted.assets.map((asset) => [asset.id, asset]));
        const changes = desiredAssets.flatMap((desired) => {
          const stored = storedById.get(desired.id);
          if (!stored || stored.humanDisposition === desired.humanDisposition || desired.humanDisposition === "unseen") return [];
          return [{
            assetId: desired.id,
            humanDisposition: desired.humanDisposition,
            assetRevision: stored.decisionRevision ?? 0
          }];
        });
        for (let offset = 0; offset < changes.length; offset += 250) {
          const response = await runtimeProjectClient.client.setDecisions(persisted, {
            changes: changes.slice(offset, offset + 250)
          });
          persisted = response.project;
        }
        nativeProjectRef.current = persisted;
        setProject((current) => ({ ...persisted, analysisRuns: current.id === persisted.id ? current.analysisRuns : persisted.analysisRuns }));
        setRecentProjects([projectToSummary(persisted)]);
      });
      return;
    }
    const updated = projectWithAssetSnapshot(project, state.assets);
    if (updated === project || (updated.decisionRevision === project.decisionRevision && updated.assets === project.assets)) return;
    setProject(updated);
    runtimeProjectClient.client.saveSnapshot({
      project: updated,
      optimisticRevision: project.snapshotRevision ?? 0
    });
    setRecentProjects(runtimeProjectClient.client.listProjects());
  }, [state.assets, project.id, runtimeProjectClient]);

  useEffect(() => {
    if (!isServiceRuntime(runtimeProjectClient) || latestAnalysisRun?.status !== "running") return;
    let cancelled = false;
    let inFlight = false;
    const refreshProgress = async () => {
      if (inFlight || cancelled || !nativeProjectRef.current) return;
      inFlight = true;
      try {
        const response = await runtimeProjectClient.client.getAnalysisStatus(nativeProjectRef.current.id);
        if (cancelled || !response.run) return;
        setProject((current) => ({ ...current, analysisRuns: [response.run!] }));
        if (response.run.status !== "running" && response.run.status !== "queued") {
          const loaded = await runtimeProjectClient.client.loadActive();
          if (cancelled || !loaded.project) return;
          nativeProjectRef.current = loaded.project;
          setProject(loaded.project);
          dispatch({ type: "replaceAssets", assets: loaded.project.assets });
          setRecentProjects([projectToSummary(loaded.project)]);
        }
      } catch (error) {
        if (!cancelled) setNativeSaveError(error instanceof Error ? error.message : appText.analysisProgressRefreshFailed);
      } finally {
        inFlight = false;
      }
    };
    void refreshProgress();
    const timer = window.setInterval(() => void refreshProgress(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [appText.analysisProgressRefreshFailed, latestAnalysisRun?.status, runtimeProjectClient]);

  useEffect(() => {
    if (latestAnalysisRun?.status !== "failed") return;
    setNativeSaveError(latestAnalysisRun.errorMessage || appText.analysisRunFailed);
  }, [appText.analysisRunFailed, latestAnalysisRun?.errorMessage, latestAnalysisRun?.status]);

  useEffect(() => {
    if (!isServiceRuntime(runtimeProjectClient) || project.id === "fixture-phase-0" || project.indexingState !== "indexing") return;
    let cancelled = false;
    let inFlight = false;
    const refreshImport = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const status = await runtimeProjectClient.client.getIndexStatus(project.id);
        if (cancelled) return;
        setIndexStatus(status);
        setProject((current) => ({ ...current, indexingState: status.state }));
        const shouldHydrate = status.state !== "indexing"
          || (status.previewsReady > 0 && status.previewsReady - lastHydratedPreviewCountRef.current >= 32);
        if (shouldHydrate) {
          const response = await runtimeProjectClient.client.loadActive();
          if (cancelled || !response.project) return;
          lastHydratedPreviewCountRef.current = status.previewsReady;
          nativeProjectRef.current = response.project;
          setProject((current) => ({
            ...response.project!,
            analysisRuns: response.project!.analysisRuns ?? current.analysisRuns
          }));
          dispatch({ type: "replaceAssets", assets: response.project.assets });
          setRecentProjects([projectToSummary(response.project)]);
        }
        setNativeSaveError(null);
      } catch (error) {
        if (!cancelled) setNativeSaveError(error instanceof Error ? error.message : appText.importProgressRefreshFailed);
      } finally {
        inFlight = false;
      }
    };
    void refreshImport();
    const timer = window.setInterval(() => void refreshImport(), 3_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [appText.importProgressRefreshFailed, project.id, project.indexingState, runtimeProjectClient]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.key === "?") {
        setShortcutOverlay(true);
        return;
      }
      if (screen === "duel") return;

      if (matchesShortcut(event, shortcuts.undo)) {
        event.preventDefault();
        dispatch({ type: "undo" });
        return;
      }
      if (matchesShortcut(event, shortcuts.redo)) {
        event.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (matchesShortcut(event, shortcuts.tag) || matchesShortcut(event, shortcuts.batchTag)) {
        event.preventDefault();
        if (screen === "review") dispatch({ type: "toggleTagEditor" });
        if (screen === "grid") document.querySelector<HTMLInputElement>("#grid-manual-tag")?.focus();
        return;
      }
      if (matchesShortcut(event, shortcuts.loupe) && screen === "review") {
        event.preventDefault();
        dispatch({ type: "toggleLoupe" });
        return;
      }

      if (event.altKey) {
        const quickTag = quickTagForKey(`Alt+${event.key}`);
        if (quickTag) {
          event.preventDefault();
          const reviewAsset = visibleAssets(state)[state.cursor];
          const assetIds = screen === "review"
            ? reviewAsset ? [reviewAsset.id] : []
            : screen === "grid" || screen === "coverage" ? state.gridSelection : [];
          if (assetIds.length > 0) applyManualTagRef.current(assetIds, quickTag);
          return;
        }
      }

      if (key === "q") {
        event.preventDefault();
        void startAiAnalysis();
        return;
      }
      if (key === "g") {
        event.preventDefault();
        setScreen((current) => current === "grid" ? "review" : "grid");
        return;
      }
      if (screen === "review" && key === "e") {
        event.preventDefault();
        dispatch({ type: "toggleInspector" });
        return;
      }
      if (screen === "review" && key === "a" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        dispatch({ type: "previous" });
        return;
      }
      if (screen === "review" && key === "d" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        dispatch({ type: "next" });
        return;
      }

      if (event.key === "1") dispatch({ type: "setDecision", disposition: "candidate" });
      if (event.key === "2") dispatch({ type: "setDecision", disposition: "select" });
      if (event.key === "3") dispatch({ type: "setDecision", disposition: "hold" });
      if (key === "x") dispatch({ type: "setDecision", disposition: "reject" });
      if (screen === "grid" && event.key === "[") {
        event.preventDefault();
        dispatch({ type: "adjustGridDensity", delta: -1 });
      }
      if (screen === "grid" && event.key === "]") {
        event.preventDefault();
        dispatch({ type: "adjustGridDensity", delta: 1 });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "?") setShortcutOverlay(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [screen, shortcuts, startAiAnalysis, state]);

  const createProjectFromFiles = async ({ files, name, preset, roots, rawRoots, selectionTargetCount: targetCount }: ImportStartInput) => {
    if (isServiceRuntime(runtimeProjectClient)) {
      await runtimeProjectClient.client.create({
        name: name.trim(),
        preset,
        roots,
        rawRoots,
        settings: { keepOriginalsUntouched: true, backend: "cpu", selectionTargetCount: targetCount }
      });
      const loaded = (await runtimeProjectClient.client.loadActive()).project;
      if (!loaded) throw new Error("Native project creation did not produce an active project.");
      nativeProjectRef.current = loaded;
      setProject(loaded);
      setRecentProjects([projectToSummary(loaded)]);
      dispatch({ type: "replaceAssets", assets: loaded.assets });
      setExportPreview(null);
      setScreen("analysis");
      return;
    }
    const preparedFiles = await prepareBrowserProjectFiles(files);
    const { persisted } = runtimeProjectClient.client.create({
      name: name.trim(),
      preset,
      roots,
      settings: {
        keepOriginalsUntouched: true,
        backend: "cpu",
        selectionTargetCount: targetCount
      },
      files: preparedFiles
    });
    const { project: nextProject } = runtimeProjectClient.client.enqueueAnalysis(persisted, { projectId: persisted.id });
    setProject(nextProject);
    setRecentProjects(runtimeProjectClient.client.listProjects());
    dispatch({ type: "replaceAssets", assets: nextProject.assets });
    setExportPreview(null);
    setScreen("analysis");
  };

  const saveProjectState = (nextProject: typeof project) => {
    setProject(nextProject);
    dispatch({ type: "replaceAssets", assets: nextProject.assets });
    setExportPreview(null);
    if (runtimeProjectClient.kind === "browser") {
      runtimeProjectClient.client.saveSnapshot({
        project: nextProject,
        optimisticRevision: project.snapshotRevision ?? 0
      });
      setRecentProjects(runtimeProjectClient.client.listProjects());
    } else {
      setRecentProjects([projectToSummary(nextProject)]);
      queueNativeWrite(async () => {
        const persisted = nativeProjectRef.current;
        if (!persisted || persisted.id !== nextProject.id) return;
        const response = await runtimeProjectClient.client.saveSnapshot({
          project: nextProject,
          optimisticRevision: persisted.snapshotRevision ?? 0
        });
        nativeProjectRef.current = response.project;
        setProject((current) => ({ ...response.project, analysisRuns: current.analysisRuns }));
        setRecentProjects([projectToSummary(response.project)]);
      });
    }
  };

  const markAssetMissing = (assetId: string) => {
    saveProjectState(projectWithMissingState({ ...project, assets: state.assets }, [assetId], "missing"));
  };

  const relinkAsset = async (assetId: string, files: File[]) => {
    const preparedFiles = await prepareBrowserProjectFiles(files);
    const file = preparedFiles[0];
    if (!file) return;
    saveProjectState(projectWithRelinkedAsset({ ...project, assets: state.assets }, assetId, file));
  };

  const previewExport = async () => {
    const currentProject = { ...project, assets: state.assets };
    try {
      if (runtimeProjectClient.kind === "browser") {
        setExportPreview(runtimeProjectClient.client.exportPreview(currentProject, { projectId: currentProject.id, settings: exportSettings }));
        return;
      }
      await nativeDecisionQueueRef.current;
      setExportPreview(await runtimeProjectClient.client.exportPreview(nativeProjectRef.current ?? currentProject, {
        projectId: currentProject.id,
        settings: exportSettings
      }));
      setNativeSaveError(null);
    } catch (error) {
      setNativeSaveError(error instanceof Error
        ? formatCopy(appText.exportPreviewFailedWithMessage, { message: error.message })
        : appText.exportPreviewFailed);
    }
  };

  const commitExport = async (): Promise<ExportCommitResponse> => {
    const currentProject = { ...project, assets: state.assets };
    const preview = exportPreview ?? buildExportPreview(currentProject, { settings: exportSettings });
    if (isServiceRuntime(runtimeProjectClient)) {
      await nativeDecisionQueueRef.current;
      return runtimeProjectClient.client.exportCommit(nativeProjectRef.current ?? currentProject, {
        projectId: currentProject.id,
        preview,
        settings: exportSettings,
        explicitConfirmation: true
      });
    }
    return runtimeProjectClient.client.exportCommit(currentProject, {
      projectId: currentProject.id,
      preview,
      settings: exportSettings,
      explicitConfirmation: true
    });
  };

  const updateExportSettings = (settings: ExportSettings) => {
    setExportSettings(settings);
    setExportPreview(null);
  };

  const refreshCameraMetadata = async () => {
    if (!isServiceRuntime(runtimeProjectClient)) return;
    const current = nativeProjectRef.current;
    if (!current) return;
    const response = await runtimeProjectClient.client.refreshMetadata(current, { projectId: current.id });
    nativeProjectRef.current = response.project;
    setProject((active) => ({ ...response.project, analysisRuns: active.analysisRuns }));
    dispatch({ type: "replaceAssets", assets: response.project.assets });
  };

  const downloadCsvReport = (preview: ExportPreviewResponse) => {
    const name = project.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "framescout-report";
    const blob = new Blob([preview.csvPreview], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const copySelectedPaths = async (statusLanguage: UiLanguage): Promise<string> => {
    const statusText = uiCopy[statusLanguage].app;
    const paths = state.assets
      .filter((asset) => asset.humanDisposition === "select")
      .map((asset) => asset.sourcePath)
      .filter((path): path is string => Boolean(path));
    if (paths.length === 0) return statusText.noSelectedPaths;
    const copiedStatus = formatCopy(statusText.selectedPathsCopied, {
      count: paths.length,
      paths: paths.length === 1 ? statusText.sourcePath : statusText.sourcePaths
    });
    const value = paths.join("\n");
    try {
      await navigator.clipboard.writeText(value);
      return copiedStatus;
    } catch {
      const field = document.createElement("textarea");
      field.value = value;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      return copied ? copiedStatus : statusText.clipboardUnavailable;
    }
  };

  const applyManualTag = (assetIds: string[], tag: string) => {
    const normalizedTag = normalizeManualTag(tag);
    if (!normalizedTag) return;
    const currentProject = { ...project, assets: state.assets };
    if (isServiceRuntime(runtimeProjectClient)) {
      const persisted = nativeProjectRef.current;
      if (!persisted) return;
      queueNativeWrite(async () => {
        const current = nativeProjectRef.current;
        if (!current) return;
        const { project: taggedProject } = await runtimeProjectClient.client.applyTags(current, {
          mutations: [{ assetIds, tag: normalizedTag, mutation: "add" }]
        });
        nativeProjectRef.current = taggedProject;
        setProject((active) => ({ ...taggedProject, analysisRuns: active.analysisRuns }));
        setRecentProjects([projectToSummary(taggedProject)]);
        dispatch({ type: "replaceAssets", assets: taggedProject.assets });
        setExportPreview(null);
      });
      return;
    }
    const { project: taggedProject } = runtimeProjectClient.client.applyTag(currentProject, { assetIds, tag: normalizedTag, mutation: "add" });
    setProject(taggedProject);
    setRecentProjects(runtimeProjectClient.client.listProjects());
    dispatch({ type: "replaceAssets", assets: taggedProject.assets });
    setExportPreview(null);
  };
  applyManualTagRef.current = applyManualTag;

  const updateProjectPolicy = (preset: ProjectPreset) => {
    saveProjectState(projectWithPolicy({ ...project, assets: state.assets }, preset));
  };

  const updateSelectionTarget = (targetCount: number) => {
    const currentProject = { ...project, assets: state.assets };
    if (runtimeProjectClient.kind === "browser") {
      const { project: updated } = runtimeProjectClient.client.setSelectionGoal(currentProject, { targetCount });
      setProject(updated);
      setRecentProjects(runtimeProjectClient.client.listProjects());
      return;
    }
    queueNativeWrite(async () => {
      const current = nativeProjectRef.current;
      if (!current) return;
      const { project: updated } = await runtimeProjectClient.client.setSelectionGoal(current, { targetCount });
      nativeProjectRef.current = updated;
      setProject((active) => ({ ...updated, analysisRuns: active.analysisRuns }));
    });
    setProject(projectWithSelectionGoal(currentProject, targetCount));
  };

  const correctNativeMapping = async (assetId: string) => {
    if (runtimeProjectClient.kind !== "tauri" || !nativeProjectRef.current) return;
    const selected = await open({
      multiple: false,
      title: appText.chooseRawMasterTitle,
      filters: [{ name: appText.rawMastersFilter, extensions: ["arw", "cr2", "cr3", "dng", "nef", "orf", "raf", "rw2"] }]
    });
    if (typeof selected !== "string") return;
    const { project: mappedProject } = await runtimeProjectClient.client.setManualMapping(nativeProjectRef.current, {
      assetId,
      masterPath: selected
    });
    nativeProjectRef.current = mappedProject;
    setProject((current) => ({ ...mappedProject, analysisRuns: current.analysisRuns }));
    dispatch({ type: "replaceAssets", assets: mappedProject.assets });
    setRecentProjects([projectToSummary(mappedProject)]);
  };

  const openDuel = (groupId: string, focusAssetId: string) => {
    setDuel({ groupId, focusAssetId });
    setScreen("duel");
  };

  const duelGroup = useMemo(
    () => duel ? openGroup({ ...project, assets: state.assets }, duel) : null,
    [duel, project, state.assets]
  );

  const openProject = (projectId: string) => {
    if (projectId === project.id) {
      setScreen("review");
      return;
    }
    if (isServiceRuntime(runtimeProjectClient)) {
      const nextProject = nativeProjectRef.current?.id === projectId ? nativeProjectRef.current : null;
      if (!nextProject) return;
      setProject(nextProject);
      dispatch({ type: "replaceAssets", assets: nextProject.assets });
      setExportPreview(null);
      setScreen("review");
      return;
    }
    const nextProject = runtimeProjectClient.client.loadProject(projectId).project;
    if (!nextProject) return;
    setProject(nextProject);
    setRecentProjects(runtimeProjectClient.client.listProjects());
    dispatch({ type: "replaceAssets", assets: nextProject.assets });
    setExportPreview(null);
    setScreen("review");
  };

  const updateUiScale = (nextScale: number) => {
    const bounded = Math.max(80, Math.min(160, nextScale));
    setUiScale(bounded);
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(bounded));
  };

  const updateLanguage = (nextLanguage: UiLanguage) => {
    setLanguage(nextLanguage);
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, nextLanguage);
  };

  useEffect(() => {
    document.documentElement.lang = documentLanguage(language);
  }, [language]);

  return (
    <main className={`shell ${screen === "review" ? "review-shell" : ""}`} style={{
      "--ui-scale": String(uiScale / 100),
      "--ui-width": `${10000 / uiScale}vw`,
      "--ui-height": `${10000 / uiScale}vh`
    } as CSSProperties}>
      <header className="topbar">
        <div className="brand-mark">
          <span className="brand-dot" />
          <span>FrameScout</span>
        </div>
        <nav className="nav-tabs" aria-label="FrameScout">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.screen}
                className={screen === item.screen ? "nav-tab active" : "nav-tab"}
                onClick={() => setScreen(item.screen)}
                aria-current={screen === item.screen ? "page" : undefined}
                title={text.nav[item.copyKey]}
              >
                <Icon size={16} />
                <span>{text.nav[item.copyKey]}</span>
              </button>
            );
          })}
        </nav>
        <div className="topbar-meta">
          {isServiceRuntime(runtimeProjectClient) && (
            <AnalysisProfileSwitcher language={language} config={analysisConfig} busy={analysisConfigBusy} onSelect={selectAnalysisProfile} />
          )}
          {isServiceRuntime(runtimeProjectClient) && (project.indexingState === "indexing" || latestAnalysisRun?.status === "running") && (
            <div className="workflow-progress" aria-label={appText.backgroundProgress}>
              {project.indexingState === "indexing" && (
                <div className="workflow-progress-item" title={formatCopy(appText.proxyProgress, { ready: previewReady, total: state.assets.length })}>
                  <span>{appText.proxy}</span>
                  <div className="workflow-progress-track"><i style={{ width: `${importProgress}%` }} /></div>
                  <strong>{importProgress}%</strong>
                </div>
              )}
              {latestAnalysisRun?.status === "running" && (
                <div className="workflow-progress-item" title={formatCopy(appText.analysisProgress, { ready: latestAnalysisRun.previewsReady, total: latestAnalysisRun.totalAssets })}>
                  <span>AI</span>
                  <div className="workflow-progress-track analysis"><i style={{ width: `${analysisProgress}%` }} /></div>
                  <strong>{analysisProgress}%</strong>
                </div>
              )}
            </div>
          )}
          <div className="language-switch" role="group" aria-label={appText.interfaceLanguage}>
            <Languages size={14} aria-hidden="true" />
            <button type="button" aria-pressed={language === "zh"} onClick={() => updateLanguage("zh")}>{appText.chineseLanguage}</button>
            <button type="button" aria-pressed={language === "en"} onClick={() => updateLanguage("en")}>{appText.englishLanguage}</button>
          </div>
          <span className={`runtime-badge ${runtimeProjectClient.kind}`}>
            {runtimeLabel}
          </span>
          <span className="topbar-project-name">{projectSummary.name}</span>
          <span className="topbar-stat topbar-ready">{state.assets.length} {project.indexingState === "indexing" ? appText.indexed : appText.ready}</span>
          {project.indexingState === "indexing" && <span className="topbar-stat topbar-preview">{previewReady} {appText.previews}</span>}
          {latestAnalysisRun && <span className="topbar-stat topbar-preview">{latestAnalysisRun.previewsReady}/{latestAnalysisRun.totalAssets} {appText.previews}</span>}
          <span className="topbar-stat topbar-marked">{state.gridSelection.length} {appText.marked}</span>
          <span className="topbar-stat topbar-selected">{selected} {appText.selected}</span>
          <div className="display-control">
            <button
              className="icon-button display-control-trigger"
              type="button"
              aria-label={appText.displayScale}
              aria-expanded={displayControlsOpen}
              aria-controls="display-scale-panel"
              onClick={() => setDisplayControlsOpen((open) => !open)}
              title={appText.displayScale}
            >
              <Settings2 size={16} />
            </button>
            {displayControlsOpen && (
              <div id="display-scale-panel" className="display-scale-panel" role="dialog" aria-label={appText.displayScale}>
                <label>
                  <span>{appText.interfaceScale}</span>
                  <output aria-label={appText.currentInterfaceScale}>{uiScale}%</output>
                  <input
                    aria-label={appText.interfaceScale}
                    type="range"
                    min="80"
                    max="160"
                    step="10"
                    value={uiScale}
                    onChange={(event) => updateUiScale(Number(event.target.value))}
                  />
                </label>
                <div className="scale-stepper" aria-label={appText.scaleStepper}>
                  <button className="icon-button" type="button" onClick={() => updateUiScale(uiScale - 10)} disabled={uiScale <= 80} title={appText.zoomOut}><Minus size={14} /></button>
                  <button className="icon-button" type="button" onClick={() => updateUiScale(uiScale + 10)} disabled={uiScale >= 160} title={appText.zoomIn}><Plus size={14} /></button>
                </div>
                <button className="compact-command" type="button" onClick={() => updateUiScale(DEFAULT_UI_SCALE)}>{appText.resetScale}</button>
                <section className="shortcut-settings" aria-label={appText.keyboardShortcuts}>
                  <div><strong>{appText.keyboardShortcuts}</strong><button type="button" onClick={() => { setShortcuts(defaultShortcuts); window.localStorage.removeItem(SHORTCUTS_STORAGE_KEY); }}>{appText.reset}</button></div>
                  {(Object.keys(defaultShortcuts) as ShortcutAction[]).map((action) => <label key={action}><span>{appText.shortcuts[action]}</span><input readOnly value={shortcuts[action]} aria-label={appText.shortcuts[action]} onKeyDown={(event) => { const shortcut = shortcutFromEvent(event.nativeEvent); if (!shortcut) return; event.preventDefault(); event.stopPropagation(); updateShortcut(action, shortcut); }} /></label>)}
                </section>
              </div>
            )}
          </div>
        </div>
      </header>

      {nativeSaveError && <div className="native-save-error" role="alert">{nativeSaveError}</div>}

      {screen === "projects" && <ProjectsView language={language} projects={recentProjects} onNewReview={() => setScreen("import")} onOpenProject={openProject} />}
      {screen === "import" && (
        <ImportView
          language={language}
          onStart={createProjectFromFiles}
          onChooseNativeFolder={isServiceRuntime(runtimeProjectClient) ? async () => {
            if (runtimeProjectClient.kind === "tauri") {
              const selected = await open({ directory: true, multiple: false, title: appText.chooseSourceFolderTitle });
              return typeof selected === "string" ? selected : null;
            }
            return chooseLocalServiceFolder(import.meta.env.VITE_FRAMESCOUT_API_URL || "http://127.0.0.1:4310");
          } : undefined}
          onChooseNativeRawFolder={isServiceRuntime(runtimeProjectClient) ? async () => {
            if (runtimeProjectClient.kind === "tauri") {
              const selected = await open({ directory: true, multiple: false, title: appText.chooseOptionalRawFolderTitle });
              return typeof selected === "string" ? selected : null;
            }
            return chooseLocalServiceFolder(import.meta.env.VITE_FRAMESCOUT_API_URL || "http://127.0.0.1:4310");
          } : undefined}
        />
      )}
      {screen === "analysis" && <AnalysisQueueView language={language} project={{ ...project, assets: state.assets }} run={latestAnalysisRun} onEnterReview={() => setScreen("review")} onCorrectMapping={runtimeProjectClient.kind === "tauri" ? (assetId) => void correctNativeMapping(assetId) : undefined} showMapping={runtimeProjectClient.kind === "tauri"} />}
      {screen === "review" && <ReviewDesk language={language} state={state} dispatch={dispatch} projectPreset={project.preset} selectionTargetCount={selectionTargetCount} onProjectPresetChange={updateProjectPolicy} onSelectionTargetChange={updateSelectionTarget} onMarkMissing={markAssetMissing} onRelinkAsset={relinkAsset} onOpenDuel={openDuel} onApplyManualTag={applyManualTag} />}
      {screen === "grid" && (
        <GridView
          language={language}
          state={state}
          dispatch={dispatch}
          exportPreview={exportPreview}
          onExportPreview={previewExport}
          manualTagDraft={manualTagDraft}
          onManualTagDraftChange={setManualTagDraft}
          onApplyManualTag={applyManualTag}
          onOpenDuel={openDuel}
        />
      )}
      {screen === "coverage" && <CoverageView language={language} assets={state.assets} selectedAssetIds={state.gridSelection} dispatch={dispatch} onApplyManualTag={applyManualTag} />}
      {screen === "duel" && duelGroup && <DuelView language={language} group={duelGroup} dispatch={dispatch} onExit={() => setScreen("review")} />}
      {screen === "export" && <ExportView language={language} preview={exportPreview} assets={state.assets} settings={exportSettings} onSettingsChange={updateExportSettings} onPreview={previewExport} onCommit={commitExport} onRefreshMetadata={refreshCameraMetadata} onDownloadCsv={downloadCsvReport} onCopySelectedPaths={copySelectedPaths} />}

      {screen !== "review" && <div className="bottom-rail" aria-label={appText.shortcutsRail}>
        {screen === "grid" && <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {appText.move}</span>}
        <span><kbd>Q</kbd> {appText.aiAnalysis}</span>
        <span><kbd>G</kbd> {screen === "grid" ? appText.review : appText.gallery}</span>
        {screen === "grid" && <span><kbd>[</kbd><kbd>]</kbd> {appText.density}</span>}
        <span><kbd>?</kbd></span>
      </div>}

      {shortcutOverlay && (
        <div className="shortcut-overlay">
          {screen === "review" && <span><kbd>A</kbd><kbd>D</kbd> {appText.previousNext}</span>}
          {screen === "review" && <span><kbd>E</kbd> {appText.tools}</span>}
          {screen === "grid" && <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {appText.galleryNavigation}</span>}
          <span><kbd>Q</kbd> {appText.aiAnalysis}</span>
          <span><kbd>G</kbd> {screen === "grid" ? appText.review : appText.gallery}</span>
          {screen === "grid" && <span><kbd>[</kbd><kbd>]</kbd> {appText.gridDensity}</span>}
          <span><kbd>Z</kbd> {appText.undo}</span>
          <span><kbd>Shift</kbd><kbd>Z</kbd> {appText.redo}</span>
        </div>
      )}

      <div className="utility-stack" aria-hidden="true">
        <Search size={15} />
        <SlidersHorizontal size={15} />
        <PanelRight size={15} />
        <RotateCcw size={15} />
      </div>
    </main>
  );
}
