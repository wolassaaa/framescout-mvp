export type ProjectPreset =
  | "action-coverage"
  | "matchday-story"
  | "motorsport"
  | "esports-stage"
  | "portrait"
  | "custom";

export type AiDisposition = "keep" | "review" | "reject";
export type HumanDisposition = "unseen" | "candidate" | "select" | "hold" | "reject";
export type MappingStatus = "mapped" | "proxy_only" | "ambiguous" | "missing_master" | "manually_mapped";
export type MappingMethod = "same_folder" | "mirrored_tree" | "manifest" | "manual" | "none";
export type MappingConfidence = "exact" | "probable" | "unresolved";

export interface EvidenceSignal {
  label: string;
  value: string;
  confidence?: number;
  tone: "keep" | "review" | "reject" | "neutral";
}

export interface ReviewAsset {
  id: string;
  fileName: string;
  sourcePath?: string;
  fileFingerprint?: string;
  /** Per-asset optimistic-concurrency revision for decision.set. */
  decisionRevision?: number;
  rawPartnerId?: string;
  mappedMasterPath?: string;
  mappingStatus?: MappingStatus;
  mappingMethod?: MappingMethod;
  mappingConfidence?: MappingConfidence;
  thumbnailCachePath?: string;
  displayCachePath?: string;
  previewState?: "pending" | "ready" | "raw-placeholder" | "needs-relink" | "failed" | "fixture";
  missingState?: "present" | "missing" | "relinked";
  captureTime: string;
  camera: string;
  lens: string;
  exposure: string;
  iso: number;
  previewUrl: string;
  /** Downscaled review image; previewUrl remains the lightweight grid thumbnail. */
  displayUrl?: string;
  aiDisposition: AiDisposition;
  humanDisposition: HumanDisposition;
  reasons: string[];
  tags: string[];
  groupId?: string;
  evidence: EvidenceSignal[];
  /** Project-wide AI recommendation rank. This never changes the human decision. */
  aiSelectionRank?: number;
  aiSelectionScore?: number;
  aiRecommended?: boolean;
}

export interface SelectionGoal {
  targetCount: number;
  mode: "exact";
  diversity: "burst-aware";
  preserveHumanDecisions: true;
}

export interface ProjectSummary {
  id: string;
  name: string;
  preset: ProjectPreset;
  sourceFolder: string;
  coverUrl: string;
  reviewed: number;
  selected: number;
  aiRejects: number;
  total: number;
  lastOpened: string;
}

export interface PersistedProject {
  id: string;
  name: string;
  preset: ProjectPreset;
  sourceFolder: string;
  createdAt: string;
  updatedAt: string;
  /** Folder discovery runs in bounded batches and may continue after the project opens. */
  indexingState?: "indexing" | "complete" | "failed";
  assets: ReviewAsset[];
  analysisRuns?: AnalysisRun[];
  decisionRevision: number;
  /** Project-level optimistic-concurrency revision, independent from asset decision revisions. */
  snapshotRevision?: number;
  decisionEvents: DecisionEvent[];
  tagEvents?: TagEvent[];
  selectionGoal?: SelectionGoal;
}

export interface ProjectCreateRequest {
  name: string;
  roots: string[];
  rawRoots?: string[];
  mappingManifestPath?: string;
  preset: ProjectPreset;
  settings?: {
    keepOriginalsUntouched: true;
    thumbnailCachePath?: string;
    cacheLimitMb?: number;
    backend?: "cpu" | "gpu" | "auto";
    selectionTargetCount?: number;
  };
}

export interface SelectionGoalSetRequest {
  targetCount: number;
}

export interface SelectionGoalSetResponse {
  project: PersistedProject;
}

export interface ProjectCreateResponse {
  project: ProjectSummary;
}

export interface ProjectLoadActiveResponse {
  project: PersistedProject | null;
}

export interface ProjectSaveSnapshotRequest {
  project: PersistedProject;
  optimisticRevision: number;
}

export interface ProjectSaveSnapshotResponse {
  project: PersistedProject;
}

export interface MappingSetManualRequest {
  assetId: string;
  masterPath?: string;
}

export interface MappingSetManualResponse {
  project: PersistedProject;
}

export interface DecisionSetRequest {
  assetId: string;
  humanDisposition: Exclude<HumanDisposition, "unseen">;
  assetRevision: number;
}

export interface DecisionEvent {
  assetId: string;
  previousHumanDisposition?: HumanDisposition;
  humanDisposition: HumanDisposition;
  revision: number;
  changedAt: string;
  actor: "human";
}

export interface DecisionSetResponse {
  event: DecisionEvent;
  project: PersistedProject;
}

export interface DecisionSetBatchRequest {
  changes: DecisionSetRequest[];
}

export interface DecisionSetBatchResponse {
  events: DecisionEvent[];
  project: PersistedProject;
}

export interface TagApplyRequest {
  assetIds: string[];
  tag: string;
  mutation: "add" | "remove";
}

export interface TagEvent {
  assetIds: string[];
  tag: string;
  mutation: "add" | "remove";
  changedAt: string;
  actor: "human";
}

export interface TagApplyResponse {
  event: TagEvent;
  project: PersistedProject;
}

export interface TagApplyBatchRequest {
  mutations: TagApplyRequest[];
}

export interface TagApplyBatchResponse {
  events: TagEvent[];
  project: PersistedProject;
}

export interface ReviewNextRequest {
  projectId: string;
  cursor: number;
  direction?: "next" | "previous";
  showAiRejects?: boolean;
}

export interface ReviewNextResponse {
  asset: ReviewAsset | null;
  cursor: number;
  queueLength: number;
}

export interface GroupOpenRequest {
  projectId: string;
  groupId: string;
  focusAssetId?: string;
}

export interface GroupOpenResponse {
  groupId: string;
  assets: ReviewAsset[];
  focusIndex: number;
  evidence: EvidenceSignal[];
}

export type AnalysisStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface AnalysisRun {
  id: string;
  projectId: string;
  status: AnalysisStatus;
  totalAssets: number;
  previewsReady: number;
  rawPlaceholders: number;
  missingAssets: number;
  progress: number;
  backend: "browser" | "cpu" | "gpu" | "cloud" | "auto";
  queuedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface AnalysisEnqueueRequest {
  projectId: string;
  priority?: "normal" | "high";
}

export interface AnalysisEnqueueResponse {
  run: AnalysisRun;
  project: PersistedProject;
}

export interface AnalysisStatusResponse {
  run: AnalysisRun | null;
}

export interface ProjectIndexStatusResponse {
  projectId: string;
  state: "indexing" | "complete" | "failed";
  discovered: number;
  indexed: number;
  previewsReady: number;
  failed: number;
}

export type AnalysisProfileId = "local-gpu-quality" | "local-gpu-fast" | "local-cpu-fast" | "qwen-cloud" | "custom-cloud";
export type AnalysisProvider = "local" | "qwen" | "openai-compatible";
export type AnalysisExecutionMode = "local" | "cloud" | "hybrid";

export interface AnalysisProfile {
  id: AnalysisProfileId;
  provider: AnalysisProvider;
  model: string;
  backend: "cpu" | "gpu" | "cloud";
  available: boolean;
  unavailableReason?: string;
  sendsProxyOffDevice: boolean;
  endpoint?: string;
}

export interface AnalysisConfigResponse {
  activeProfileId: AnalysisProfileId;
  profiles: AnalysisProfile[];
  secretStorage: "terminal-environment";
  maxCloudProxyPixels: number;
  executionMode: AnalysisExecutionMode;
  cloudBudgetCents: number;
  cloudConcurrency: number;
}

export interface AnalysisConfigSetRequest {
  profileId: AnalysisProfileId;
  endpoint?: string;
  model?: string;
  executionMode?: AnalysisExecutionMode;
  cloudBudgetCents?: number;
  cloudConcurrency?: number;
}

export interface ExportPreviewRequest {
  projectId: string;
  includeAiReasonKeywords?: boolean;
  settings?: ExportSettings;
}

export interface ExportSettings {
  destinationDir: string;
  selectionScope: "selected" | "decided";
  /** Optional folder groups and tags refine the base decision scope. */
  includedFolderGroups: string[];
  includedTags: string[];
  excludedTags: string[];
  filterMatch: "all" | "any";
  media: "proxies" | "raw" | "proxies-and-raw";
  rawLayout: "same-folder" | "raw-subfolder";
  preserveFolderStructure: boolean;
  includeXmp: boolean;
  includeCsv: boolean;
  collision: "rename";
}

export interface ExportCopyTarget {
  assetId: string;
  sourcePath: string;
  destinationPath: string;
  kind: "proxy" | "raw";
}

export interface ExportPreviewTarget {
  assetId: string;
  sourceAssetId: string;
  fileName: string;
  sidecarPath: string;
  humanDisposition: Exclude<HumanDisposition, "unseen">;
  rating: number;
  colorLabel: string;
  keywords: string[];
  operation: "add-or-update";
}

export interface ExportPreviewSkippedAsset {
  assetId: string;
  fileName: string;
  reason: "unseen" | "missing-source" | "no-source-path" | "unsafe-source-path";
}

export interface ExportMetadataRecord {
  assetId: string;
  fileName: string;
  sourcePath?: string;
  humanDisposition: HumanDisposition;
  aiDisposition: AiDisposition;
  tags: string[];
  reasons: string[];
  lastDecisionAt?: string;
  lastTagAt?: string;
  modelVersion: string;
}

export interface ExportPreviewResponse {
  projectId: string;
  originalFilesModified: 0;
  settings: ExportSettings;
  filesToCopy: ExportCopyTarget[];
  xmpFilesToWrite: number;
  targets: ExportPreviewTarget[];
  skipped: ExportPreviewSkippedAsset[];
  metadataRecords: ExportMetadataRecord[];
  csvPreview: string;
}

export interface ExportCommitRequest {
  projectId: string;
  preview: ExportPreviewResponse;
  settings: ExportSettings;
  dryRun?: boolean;
  explicitConfirmation: true;
}

export interface ExportCommitResponse {
  projectId: string;
  committed: boolean;
  reason?: "native-export-not-wired" | "dry-run";
  originalFilesModified: 0;
  xmpFilesWritten: 0;
  filesCopied: number;
  rawFilesCopied: number;
  destinationDir?: string;
}

export interface MetadataRefreshRequest {
  projectId: string;
}

export interface MetadataRefreshResponse {
  project: PersistedProject;
  started: boolean;
}

export type FrameScoutCommand =
  | "project.create"
  | "project.loadActive"
  | "project.indexStatus"
  | "project.saveSnapshot"
  | "mapping.setManual"
  | "analysis.configGet"
  | "analysis.configSet"
  | "analysis.enqueue"
  | "analysis.status"
  | "selection.goalSet"
  | "metadata.refresh"
  | "review.next"
  | "decision.set"
  | "decision.setBatch"
  | "tag.apply"
  | "tag.applyBatch"
  | "group.open"
  | "export.preview"
  | "export.commit";
