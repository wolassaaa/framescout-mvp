import type { AnalysisRun, DecisionEvent, HumanDisposition, PersistedProject, ProjectPreset, ProjectSummary, ReviewAsset, SelectionGoal, TagEvent } from "@framescout/contracts";

const ACTIVE_PROJECT_KEY = "framescout.activeProjectId";
const PROJECT_PREFIX = "framescout.project.";
const PROJECT_INDEX_KEY = "framescout.projectIndex";

const supportedPreviewExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const supportedRawExtensions = new Set(["cr2"]);

export const supportedPhaseOneExtensions = new Set([...supportedPreviewExtensions, ...supportedRawExtensions]);

export interface BrowserProjectFile {
  name: string;
  size: number;
  lastModified: number;
  type?: string;
  webkitRelativePath?: string;
  previewDataUrl?: string;
}

export interface ProjectCreateInput {
  name: string;
  preset: ProjectPreset;
  files: BrowserProjectFile[];
  sourceFolder?: string;
  selectionTargetCount?: number;
}

export interface ProjectStore {
  loadActiveProject(): PersistedProject | null;
  loadProject(projectId: string): PersistedProject | null;
  listProjects(): PersistedProject[];
  saveProject(project: PersistedProject): void;
  createProject(input: ProjectCreateInput): PersistedProject;
  enqueueAnalysis(project: PersistedProject): PersistedProject;
  updateDecision(project: PersistedProject, assetId: string, disposition: Exclude<HumanDisposition, "unseen">): PersistedProject;
  applyTag(project: PersistedProject, assetIds: string[], tag: string, mutation: "add" | "remove"): { event: TagEvent; project: PersistedProject };
  updateMissingState(project: PersistedProject, assetIds: string[], missingState: NonNullable<ReviewAsset["missingState"]>): PersistedProject;
  relinkAsset(project: PersistedProject, assetId: string, file: BrowserProjectFile): PersistedProject;
  toSummary(project: PersistedProject): ProjectSummary;
}

export function projectWithAssetSnapshot(project: PersistedProject, assets: ReviewAsset[], changedAt = new Date().toISOString()): PersistedProject {
  const previousAssets = new Map(project.assets.map((asset) => [asset.id, asset]));
  let revision = project.decisionRevision;
  const decisionEvents: DecisionEvent[] = [];
  const revisionedAssets = assets.map((asset) => {
    const previous = previousAssets.get(asset.id);
    if (!previous || previous.humanDisposition === asset.humanDisposition) return asset;
    const assetRevision = (previous.decisionRevision ?? 0) + 1;
    return { ...asset, decisionRevision: assetRevision };
  });

  for (const asset of revisionedAssets) {
    const previous = previousAssets.get(asset.id);
    if (!previous || previous.humanDisposition === asset.humanDisposition) continue;
    revision += 1;
    decisionEvents.push({
      assetId: asset.id,
      previousHumanDisposition: previous.humanDisposition,
      humanDisposition: asset.humanDisposition,
      revision: asset.decisionRevision ?? 0,
      changedAt,
      actor: "human"
    });
  }

  return {
    ...project,
    assets: revisionedAssets,
    updatedAt: decisionEvents.length > 0 ? changedAt : project.updatedAt,
    decisionRevision: revision,
    snapshotRevision: (project.snapshotRevision ?? 0) + decisionEvents.length,
    decisionEvents: [...(project.decisionEvents ?? []), ...decisionEvents]
  };
}

export function projectWithPolicy(
  project: PersistedProject,
  preset: ProjectPreset,
  changedAt = new Date().toISOString()
): PersistedProject {
  if (project.preset === preset) return project;

  const assets = project.assets.map((asset) => {
    const hasNoAllowedSubjectEvidence = asset.reasons.includes("no_allowed_subject_preserved_by_matchday");
    if (!hasNoAllowedSubjectEvidence) return asset;

    const hasVehicleEvidence = asset.tags.includes("vehicle") || asset.tags.includes("subject:vehicle");
    const aiDisposition: ReviewAsset["aiDisposition"] = preset === "action-coverage"
      ? "reject"
      : preset === "motorsport" && !hasVehicleEvidence
        ? "reject"
        : "review";

    return aiDisposition === asset.aiDisposition ? asset : { ...asset, aiDisposition };
  });

  return {
    ...project,
    preset,
    assets,
    updatedAt: changedAt,
    snapshotRevision: (project.snapshotRevision ?? 0) + 1
  };
}

export function normalizeSelectionTarget(targetCount: number): number {
  if (!Number.isFinite(targetCount)) return 1;
  return Math.max(1, Math.min(100_000, Math.round(targetCount)));
}

export function selectionGoal(targetCount: number): SelectionGoal {
  return {
    targetCount: normalizeSelectionTarget(targetCount),
    mode: "exact",
    diversity: "burst-aware",
    preserveHumanDecisions: true
  };
}

export function projectWithSelectionGoal(
  project: PersistedProject,
  targetCount: number,
  changedAt = new Date().toISOString()
): PersistedProject {
  const nextGoal = selectionGoal(targetCount);
  if (project.selectionGoal?.targetCount === nextGoal.targetCount) return project;
  return {
    ...project,
    selectionGoal: nextGoal,
    updatedAt: changedAt,
    snapshotRevision: (project.snapshotRevision ?? 0) + 1
  };
}

export function normalizeManualTag(tag: string): string | null {
  const normalized = tag.trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) return null;
  const [namespace, name, ...rest] = normalized.split(":");
  if (name && rest.length === 0 && /^[a-z][a-z0-9-]*$/.test(namespace) && /^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return `${namespace}:${name}`;
  }
  return `manual:${normalized.replace(/:/g, "-")}`;
}

export function projectWithTagMutation(
  project: PersistedProject,
  assetIds: string[],
  tag: string,
  mutation: "add" | "remove",
  changedAt = new Date().toISOString()
): { event: TagEvent; project: PersistedProject } {
  const normalizedTag = normalizeManualTag(tag);
  if (!normalizedTag) {
    throw new Error("tag.apply needs a non-empty manual tag.");
  }
  const targetIds = new Set(assetIds);
  if (targetIds.size === 0) {
    throw new Error("tag.apply needs at least one asset id.");
  }
  const event: TagEvent = {
    assetIds: Array.from(targetIds),
    tag: normalizedTag,
    mutation,
    changedAt,
    actor: "human"
  };
  const assets = project.assets.map((asset) => {
    if (!targetIds.has(asset.id)) return asset;
    return {
      ...asset,
      tags:
        mutation === "add"
          ? Array.from(new Set([...asset.tags, normalizedTag]))
          : asset.tags.filter((item) => item !== normalizedTag)
    };
  });

  return {
    event,
    project: {
      ...project,
      assets,
      updatedAt: changedAt,
      snapshotRevision: (project.snapshotRevision ?? 0) + 1,
      tagEvents: [...(project.tagEvents ?? []), event]
    }
  };
}

export function projectWithMissingState(
  project: PersistedProject,
  assetIds: string[],
  missingState: NonNullable<ReviewAsset["missingState"]>,
  changedAt = new Date().toISOString()
): PersistedProject {
  const targetIds = new Set(assetIds);
  let changed = false;
  const assets = project.assets.map((asset) => {
    if (!targetIds.has(asset.id)) return asset;
    const previewState = missingState === "missing" ? "needs-relink" : asset.previewState;
    const next = {
      ...asset,
      missingState,
      previewState
    };
    changed ||= asset.missingState !== next.missingState || asset.previewState !== next.previewState;
    return next;
  });

  return {
    ...project,
    assets,
    updatedAt: changed ? changedAt : project.updatedAt,
    snapshotRevision: (project.snapshotRevision ?? 0) + (changed ? 1 : 0)
  };
}

export function projectWithRelinkedAsset(
  project: PersistedProject,
  assetId: string,
  file: BrowserProjectFile,
  changedAt = new Date().toISOString()
): PersistedProject {
  const relinked = assetFromFile(file);
  let changed = false;
  const assets = project.assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    changed = true;
    return {
      ...asset,
      fileName: relinked.fileName,
      sourcePath: relinked.sourcePath,
      fileFingerprint: relinked.fileFingerprint,
      previewState: relinked.previewState,
      missingState: "relinked" as const,
      previewUrl: relinked.previewUrl,
      tags: Array.from(
        new Set([
          ...asset.tags.filter((tag) => !tag.startsWith("preview:") && !tag.startsWith("source:")),
          ...relinked.tags,
          "source:relinked"
        ])
      ),
      evidence: [
        ...asset.evidence,
        {
          label: "Relinked source",
          value: relinked.sourcePath ?? relinked.fileName,
          tone: "neutral" as const
        }
      ]
    };
  });

  return {
    ...project,
    assets,
    updatedAt: changed ? changedAt : project.updatedAt,
    snapshotRevision: (project.snapshotRevision ?? 0) + (changed ? 1 : 0)
  };
}

function runId(projectId: string, queuedAt: string): string {
  return stableId(`${projectId}::analysis::${queuedAt}`);
}

export function analysisRunForProject(project: PersistedProject, queuedAt = new Date().toISOString()): AnalysisRun {
  const terminalPreviews = project.assets.filter((asset) => asset.previewState === "ready" || asset.previewState === "raw-placeholder").length;
  const missingAssets = project.assets.filter((asset) => asset.missingState === "missing" || asset.previewState === "needs-relink").length;
  const rawPlaceholders = project.assets.filter((asset) => asset.previewState === "raw-placeholder").length;
  const totalAssets = project.assets.length;
  const completed = totalAssets === 0 || terminalPreviews + missingAssets >= totalAssets;

  return {
    id: runId(project.id, queuedAt),
    projectId: project.id,
    status: completed ? "completed" : "running",
    totalAssets,
    previewsReady: terminalPreviews,
    rawPlaceholders,
    missingAssets,
    progress: totalAssets === 0 ? 1 : Math.min(1, (terminalPreviews + missingAssets) / totalAssets),
    backend: "browser",
    queuedAt,
    completedAt: completed ? queuedAt : undefined
  };
}

export function projectWithAnalysisRun(project: PersistedProject, queuedAt = new Date().toISOString()): PersistedProject {
  const run = analysisRunForProject(project, queuedAt);
  return {
    ...project,
    analysisRuns: [...(project.analysisRuns ?? []), run],
    updatedAt: queuedAt
  };
}

const extensionFor = (fileName: string) => fileName.split(".").pop()?.toLowerCase() ?? "";
const pathFor = (file: BrowserProjectFile) => file.webkitRelativePath || file.name;

function pairingKey(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const directory = normalized.includes("/") ? normalized.split("/").slice(0, -1).join("/") : "";
  const baseName = normalized.split("/").at(-1) ?? normalized;
  const stem = baseName.includes(".") ? baseName.split(".").slice(0, -1).join(".") : baseName;
  return `${directory}/${stem}`.toLowerCase();
}

export function isSupportedPhaseOneFile(file: BrowserProjectFile): boolean {
  return supportedPhaseOneExtensions.has(extensionFor(file.name));
}

export function canUseBrowserPreview(file: BrowserProjectFile): boolean {
  return supportedPreviewExtensions.has(extensionFor(file.name));
}

function readFileAsDataUrl(file: File): Promise<string | undefined> {
  if (!canUseBrowserPreview(file)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : undefined);
    });
    reader.addEventListener("error", () => resolve(undefined));
    reader.readAsDataURL(file);
  });
}

export async function prepareBrowserProjectFiles(files: File[]): Promise<BrowserProjectFile[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
      webkitRelativePath: file.webkitRelativePath,
      previewDataUrl: await readFileAsDataUrl(file)
    }))
  );
}

export function fingerprintFile(file: BrowserProjectFile): string {
  const path = pathFor(file);
  return `${path}::${file.size}::${file.lastModified}`;
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fs-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function placeholderPreview(fileName: string): string {
  const label = extensionFor(fileName).toUpperCase() || "FILE";
  return `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
      <rect width="1200" height="800" fill="#0B0D10"/>
      <rect x="70" y="70" width="1060" height="660" rx="10" fill="#13171C" stroke="#2B333C"/>
      <text x="600" y="370" text-anchor="middle" font-family="Inter, Segoe UI, sans-serif" font-size="72" fill="#DCE8FF">${label}</text>
      <text x="600" y="440" text-anchor="middle" font-family="Inter, Segoe UI, sans-serif" font-size="28" fill="#9AA5B1">${fileName}</text>
      <text x="600" y="492" text-anchor="middle" font-family="Inter, Segoe UI, sans-serif" font-size="24" fill="#7BA7FF">Preview requires native extractor or relink</text>
    </svg>
  `)}`;
}

export function assetFromFile(file: BrowserProjectFile): ReviewAsset {
  const path = pathFor(file);
  const fingerprint = fingerprintFile(file);
  const extension = extensionFor(file.name);
  const previewState = supportedPreviewExtensions.has(extension)
    ? file.previewDataUrl
      ? "ready"
      : "needs-relink"
    : "raw-placeholder";

  return {
    id: stableId(fingerprint),
    fileName: file.name,
    sourcePath: path,
    fileFingerprint: fingerprint,
    previewState,
    missingState: "present",
    captureTime: "Pending EXIF",
    camera: "Pending EXIF",
    lens: "Pending EXIF",
    exposure: "Pending EXIF",
    iso: 0,
    previewUrl: file.previewDataUrl ?? placeholderPreview(file.name),
    aiDisposition: "keep",
    humanDisposition: "unseen",
    reasons: [],
    tags: [
      "system:imported",
      previewState === "ready"
        ? "preview:ready"
        : previewState === "raw-placeholder"
          ? "preview:raw-placeholder"
          : "preview:needs-relink"
    ],
    evidence: [
      {
        label: "Project asset",
        value: "original untouched",
        tone: "keep"
      },
      {
        label: "Fingerprint",
        value: `${file.size} bytes`,
        tone: "neutral"
      }
    ]
  };
}

export function pairRawPreviewAssets(assets: ReviewAsset[]): ReviewAsset[] {
  const rawByStem = new Map<string, ReviewAsset>();
  for (const asset of assets) {
    const extension = extensionFor(asset.fileName);
    if (supportedRawExtensions.has(extension) && asset.sourcePath) {
      rawByStem.set(pairingKey(asset.sourcePath), asset);
    }
  }

  return assets.map((asset) => {
    const extension = extensionFor(asset.fileName);
    if (!supportedPreviewExtensions.has(extension) || !asset.sourcePath) return asset;
    const rawPartner = rawByStem.get(pairingKey(asset.sourcePath));
    if (!rawPartner) return asset;

    return {
      ...asset,
      rawPartnerId: rawPartner.id,
      tags: Array.from(new Set([...asset.tags, "pair:raw-sidecar-target"])),
      evidence: [
        ...asset.evidence,
        {
          label: "RAW pair",
          value: rawPartner.fileName,
          tone: "neutral" as const
        }
      ]
    };
  });
}

function projectStorageKey(id: string): string {
  return `${PROJECT_PREFIX}${id}`;
}

function projectIds(storage: Storage): string[] {
  const raw = storage.getItem(PROJECT_INDEX_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function projectFromStorage(storage: Storage, projectId: string): PersistedProject | null {
  const raw = storage.getItem(projectStorageKey(projectId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedProject;
  } catch {
    return null;
  }
}

function createBrowserProject(input: ProjectCreateInput): PersistedProject {
  const assets = pairRawPreviewAssets(input.files.filter(isSupportedPhaseOneFile).map(assetFromFile));
  const now = new Date().toISOString();
  const firstPath = assets[0]?.sourcePath ?? "No supported files";
  const sourceFolder = input.sourceFolder || (firstPath.includes("/") ? firstPath.split("/").slice(0, -1).join("/") : "Browser-selected files");
  const id = stableId(`${input.name}::${now}::${assets.length}`);

  return {
    id,
    name: input.name.trim() || "Untitled review",
    preset: input.preset,
    sourceFolder,
    createdAt: now,
    updatedAt: now,
    assets,
    analysisRuns: [],
    decisionRevision: 0,
    snapshotRevision: 0,
    decisionEvents: [],
    tagEvents: [],
    selectionGoal: selectionGoal(input.selectionTargetCount ?? 50)
  };
}

export function projectToSummary(project: PersistedProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    preset: project.preset,
    sourceFolder: project.sourceFolder,
    coverUrl: project.assets[0]?.previewUrl ?? placeholderPreview("No files"),
    reviewed: project.assets.filter((asset) => asset.humanDisposition !== "unseen").length,
    selected: project.assets.filter((asset) => asset.humanDisposition === "select").length,
    aiRejects: project.assets.filter((asset) => asset.aiDisposition === "reject").length,
    total: project.assets.length,
    lastOpened: new Date(project.updatedAt).toLocaleString()
  };
}

export function createLocalProjectStore(storage: Storage): ProjectStore {
  const saveProject = (project: PersistedProject) => {
    const ids = [project.id, ...projectIds(storage).filter((id) => id !== project.id)].slice(0, 24);
    storage.setItem(ACTIVE_PROJECT_KEY, project.id);
    storage.setItem(projectStorageKey(project.id), JSON.stringify(project));
    storage.setItem(PROJECT_INDEX_KEY, JSON.stringify(ids));
  };

  return {
    loadActiveProject() {
      const activeId = storage.getItem(ACTIVE_PROJECT_KEY);
      if (!activeId) return null;
      return projectFromStorage(storage, activeId);
    },
    loadProject(projectId) {
      const project = projectFromStorage(storage, projectId);
      if (project) saveProject(project);
      return project;
    },
    listProjects() {
      return projectIds(storage)
        .map((projectId) => projectFromStorage(storage, projectId))
        .filter((project): project is PersistedProject => project !== null);
    },
    saveProject(project) {
      saveProject(project);
    },
    createProject(input) {
      const project = createBrowserProject(input);
      saveProject(project);
      return project;
    },
    enqueueAnalysis(project) {
      const updated = projectWithAnalysisRun(project);
      saveProject(updated);
      return updated;
    },
    updateDecision(project, assetId, disposition) {
      const updated = projectWithAssetSnapshot(
        project,
        project.assets.map((asset) =>
          asset.id === assetId ? { ...asset, humanDisposition: disposition } : asset
        )
      );
      saveProject(updated);
      return updated;
    },
    applyTag(project, assetIds, tag, mutation) {
      const result = projectWithTagMutation(project, assetIds, tag, mutation);
      saveProject(result.project);
      return result;
    },
    updateMissingState(project, assetIds, missingState) {
      const updated = projectWithMissingState(project, assetIds, missingState);
      saveProject(updated);
      return updated;
    },
    relinkAsset(project, assetId, file) {
      const updated = projectWithRelinkedAsset(project, assetId, file);
      saveProject(updated);
      return updated;
    },
    toSummary: projectToSummary
  };
}

export const fixtureProjectFromAssets = (assets: ReviewAsset[]): PersistedProject => {
  const now = new Date().toISOString();
  return {
    id: "fixture-phase-0",
    name: "Friday night finals",
    preset: "matchday-story",
    sourceFolder: "Fixture data",
    createdAt: now,
    updatedAt: now,
    assets,
    analysisRuns: [],
    decisionRevision: 0,
    snapshotRevision: 0,
    decisionEvents: [],
    tagEvents: [],
    selectionGoal: selectionGoal(50)
  };
};

export const emptyServiceProject = (): PersistedProject => {
  const now = new Date().toISOString();
  return {
    id: "no-active-project",
    name: "",
    preset: "matchday-story",
    sourceFolder: "",
    createdAt: now,
    updatedAt: now,
    assets: [],
    analysisRuns: [],
    decisionRevision: 0,
    snapshotRevision: 0,
    decisionEvents: [],
    tagEvents: [],
    selectionGoal: selectionGoal(50)
  };
};
