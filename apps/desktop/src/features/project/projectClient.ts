import type {
  DecisionSetRequest,
  DecisionSetResponse,
  AnalysisEnqueueRequest,
  AnalysisEnqueueResponse,
  ExportCommitRequest,
  ExportCommitResponse,
  ExportPreviewRequest,
  ExportPreviewResponse,
  FrameScoutCommand,
  GroupOpenRequest,
  GroupOpenResponse,
  MetadataRefreshRequest,
  MetadataRefreshResponse,
  PersistedProject,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectLoadActiveResponse,
  ProjectSaveSnapshotRequest,
  ProjectSaveSnapshotResponse,
  ProjectSummary,
  ReviewNextRequest,
  ReviewNextResponse,
  SelectionGoalSetRequest,
  SelectionGoalSetResponse,
  TagApplyRequest,
  TagApplyResponse
} from "@framescout/contracts";
import {
  type BrowserProjectFile,
  type ProjectCreateInput,
  createLocalProjectStore,
  projectWithSelectionGoal
} from "./projectStore";
import { buildExportPreview } from "./projectExport";
import { openGroup } from "./projectGroup";
import { reviewNext as getReviewNext } from "./projectReview";

export interface BrowserProjectCreateRequest extends ProjectCreateRequest {
  files: BrowserProjectFile[];
}

export interface PhaseOneProjectClient {
  readonly commands: readonly FrameScoutCommand[];
  loadActive(): ProjectLoadActiveResponse;
  loadProject(projectId: string): ProjectLoadActiveResponse;
  listProjects(): ProjectSummary[];
  create(input: BrowserProjectCreateRequest): ProjectCreateResponse & { persisted: PersistedProject };
  saveSnapshot(input: ProjectSaveSnapshotRequest): ProjectSaveSnapshotResponse;
  enqueueAnalysis(project: PersistedProject, input: AnalysisEnqueueRequest): AnalysisEnqueueResponse;
  refreshMetadata(project: PersistedProject, input: MetadataRefreshRequest): MetadataRefreshResponse;
  setSelectionGoal(project: PersistedProject, input: SelectionGoalSetRequest): SelectionGoalSetResponse;
  reviewNext(project: PersistedProject, input: ReviewNextRequest): ReviewNextResponse;
  setDecision(project: PersistedProject, input: DecisionSetRequest): DecisionSetResponse;
  applyTag(project: PersistedProject, input: TagApplyRequest): TagApplyResponse;
  openGroup(project: PersistedProject, input: GroupOpenRequest): GroupOpenResponse;
  exportPreview(project: PersistedProject, input: ExportPreviewRequest): ExportPreviewResponse;
  exportCommit(project: PersistedProject, input: ExportCommitRequest): ExportCommitResponse;
  toSummary(project: PersistedProject): ProjectSummary;
}

const supportedCommands = [
  "project.create",
  "project.loadActive",
  "project.saveSnapshot",
  "analysis.enqueue",
  "metadata.refresh",
  "selection.goalSet",
  "review.next",
  "decision.set",
  "tag.apply",
  "group.open",
  "export.preview",
  "export.commit"
] as const satisfies readonly FrameScoutCommand[];

function toStoreInput(input: BrowserProjectCreateRequest): ProjectCreateInput {
  return {
    name: input.name,
    preset: input.preset,
    files: input.files,
    sourceFolder: input.roots[0],
    selectionTargetCount: input.settings?.selectionTargetCount
  };
}

export function createBrowserProjectClient(storage: Storage): PhaseOneProjectClient {
  const store = createLocalProjectStore(storage);

  return {
    commands: supportedCommands,
    loadActive() {
      return { project: store.loadActiveProject() };
    },
    loadProject(projectId) {
      return { project: store.loadProject(projectId) };
    },
    listProjects() {
      return store.listProjects().map((project) => store.toSummary(project));
    },
    create(input) {
      const persisted = store.createProject(toStoreInput(input));
      return {
        project: store.toSummary(persisted),
        persisted
      };
    },
    saveSnapshot(input) {
      if ((input.project.snapshotRevision ?? 0) < input.optimisticRevision) {
        throw new Error("Project snapshot revision is older than the optimistic revision.");
      }
      store.saveProject(input.project);
      return { project: input.project };
    },
    enqueueAnalysis(project, input) {
      if (project.id !== input.projectId) {
        throw new Error("Analysis enqueue project id mismatch.");
      }
      const updated = store.enqueueAnalysis(project);
      return {
        run: updated.analysisRuns?.at(-1)!,
        project: updated
      };
    },
    refreshMetadata(project, input) {
      if (project.id !== input.projectId) throw new Error("Metadata refresh project id mismatch.");
      return { project, started: false };
    },
    setSelectionGoal(project, input) {
      const updated = projectWithSelectionGoal(project, input.targetCount);
      store.saveProject(updated);
      return { project: updated };
    },
    reviewNext(project, input) {
      if (project.id !== input.projectId) {
        throw new Error("Review next project id mismatch.");
      }
      return getReviewNext(project, input);
    },
    setDecision(project, input) {
      const asset = project.assets.find((candidate) => candidate.id === input.assetId);
      if (!asset) {
        throw new Error("Decision asset was not found.");
      }
      if ((asset.decisionRevision ?? 0) !== input.assetRevision) {
        throw new Error("Decision revision conflict.");
      }
      const updated = store.updateDecision(project, input.assetId, input.humanDisposition);
      return {
        project: updated,
        event: {
          assetId: input.assetId,
          humanDisposition: input.humanDisposition,
          revision: updated.assets.find((candidate) => candidate.id === input.assetId)?.decisionRevision ?? 0,
          changedAt: updated.updatedAt,
          actor: "human"
        }
      };
    },
    applyTag(project, input) {
      return store.applyTag(project, input.assetIds, input.tag, input.mutation);
    },
    openGroup(project, input) {
      if (project.id !== input.projectId) {
        throw new Error("Group open project id mismatch.");
      }
      return openGroup(project, input);
    },
    exportPreview(project, input) {
      if (project.id !== input.projectId) {
        throw new Error("Export preview project id mismatch.");
      }
      return buildExportPreview(project, {
        includeAiReasonKeywords: input.includeAiReasonKeywords,
        settings: input.settings
      });
    },
    exportCommit(project, input) {
      if (project.id !== input.projectId || input.preview.projectId !== input.projectId) {
        throw new Error("Export commit project id mismatch.");
      }
      if (input.explicitConfirmation !== true) {
        throw new Error("Export commit requires explicit confirmation.");
      }
      return {
        projectId: input.projectId,
        committed: false,
        reason: "native-export-not-wired",
        originalFilesModified: 0,
        xmpFilesWritten: 0,
        filesCopied: 0,
        rawFilesCopied: 0
      };
    },
    toSummary(project) {
      return store.toSummary(project);
    }
  };
}
