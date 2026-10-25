import type {
  DecisionSetRequest,
  DecisionSetResponse,
  DecisionSetBatchRequest,
  DecisionSetBatchResponse,
  AnalysisEnqueueRequest,
  AnalysisEnqueueResponse,
  AnalysisStatusResponse,
  AnalysisConfigResponse,
  AnalysisConfigSetRequest,
  ExportCommitRequest,
  ExportCommitResponse,
  ExportPreviewRequest,
  ExportPreviewResponse,
  FrameScoutCommand,
  GroupOpenRequest,
  GroupOpenResponse,
  PersistedProject,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectLoadActiveResponse,
  ProjectIndexStatusResponse,
  ProjectSaveSnapshotRequest,
  ProjectSaveSnapshotResponse,
  MappingSetManualRequest,
  MappingSetManualResponse,
  MetadataRefreshRequest,
  MetadataRefreshResponse,
  ReviewNextRequest,
  ReviewNextResponse,
  SelectionGoalSetRequest,
  SelectionGoalSetResponse,
  TagApplyBatchRequest,
  TagApplyBatchResponse,
  TagApplyRequest,
  TagApplyResponse
} from "@framescout/contracts";
import { convertFileSrc } from "@tauri-apps/api/core";

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const commandMap = {
  "project.create": "project_create",
  "project.loadActive": "project_load_active",
  "project.indexStatus": "project_index_status",
  "project.saveSnapshot": "project_save_snapshot",
  "mapping.setManual": "mapping_set_manual",
  "analysis.configGet": "analysis_config_get",
  "analysis.configSet": "analysis_config_set",
  "analysis.enqueue": "analysis_enqueue",
  "analysis.status": "analysis_status",
  "metadata.refresh": "metadata_refresh",
  "selection.goalSet": "selection_goal_set",
  "review.next": "review_next",
  "decision.set": "decision_set",
  "decision.setBatch": "decision_set_batch",
  "tag.apply": "tag_apply",
  "tag.applyBatch": "tag_apply_batch",
  "group.open": "group_open",
  "export.preview": "export_preview",
  "export.commit": "export_commit"
} as const satisfies Partial<Record<FrameScoutCommand, string>>;

export const tauriProjectCommands = Object.keys(commandMap) as (keyof typeof commandMap)[];

export interface TauriProjectClient {
  readonly commands: readonly FrameScoutCommand[];
  loadActive(): Promise<ProjectLoadActiveResponse>;
  getIndexStatus(projectId: string): Promise<ProjectIndexStatusResponse>;
  create(input: ProjectCreateRequest): Promise<ProjectCreateResponse>;
  saveSnapshot(input: ProjectSaveSnapshotRequest): Promise<ProjectSaveSnapshotResponse>;
  setManualMapping(project: PersistedProject, input: MappingSetManualRequest): Promise<MappingSetManualResponse>;
  getAnalysisConfig(): Promise<AnalysisConfigResponse>;
  setAnalysisConfig(input: AnalysisConfigSetRequest): Promise<AnalysisConfigResponse>;
  enqueueAnalysis(project: PersistedProject, input: AnalysisEnqueueRequest): Promise<AnalysisEnqueueResponse>;
  getAnalysisStatus(projectId: string): Promise<AnalysisStatusResponse>;
  refreshMetadata(project: PersistedProject, input: MetadataRefreshRequest): Promise<MetadataRefreshResponse>;
  setSelectionGoal(project: PersistedProject, input: SelectionGoalSetRequest): Promise<SelectionGoalSetResponse>;
  reviewNext(project: PersistedProject, input: ReviewNextRequest): Promise<ReviewNextResponse>;
  setDecision(project: PersistedProject, input: DecisionSetRequest): Promise<DecisionSetResponse>;
  setDecisions(project: PersistedProject, input: DecisionSetBatchRequest): Promise<DecisionSetBatchResponse>;
  applyTag(project: PersistedProject, input: TagApplyRequest): Promise<TagApplyResponse>;
  applyTags(project: PersistedProject, input: TagApplyBatchRequest): Promise<TagApplyBatchResponse>;
  openGroup(project: PersistedProject, input: GroupOpenRequest): Promise<GroupOpenResponse>;
  exportPreview(project: PersistedProject, input: ExportPreviewRequest): Promise<ExportPreviewResponse>;
  exportCommit(project: PersistedProject, input: ExportCommitRequest): Promise<ExportCommitResponse>;
}

function hydrateNativeProject(project: PersistedProject): PersistedProject {
  return {
    ...project,
    assets: project.assets.map((asset) => {
      const nativePath = asset.displayCachePath ?? asset.sourcePath;
      return {
        ...asset,
        previewUrl: isBrowserMediaUrl(asset.previewUrl)
          ? asset.previewUrl
          : nativePath
            ? nativePreviewUrl(nativePath)
            : asset.previewUrl
      };
    })
  };
}

function isBrowserMediaUrl(value: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(value);
}

function nativePreviewUrl(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

function hydrateProjectResponse<T extends { project: PersistedProject }>(response: T): T {
  return { ...response, project: hydrateNativeProject(response.project) };
}

export function createTauriProjectClient(invoke: TauriInvoke): TauriProjectClient {
  return {
    commands: tauriProjectCommands,
    loadActive() {
      return invoke<ProjectLoadActiveResponse>(commandMap["project.loadActive"]).then((response) => ({
        project: response.project ? hydrateNativeProject(response.project) : null
      }));
    },
    getIndexStatus(projectId) {
      return invoke<ProjectIndexStatusResponse>(commandMap["project.indexStatus"], { projectId });
    },
    create(input) {
      return invoke<ProjectCreateResponse>(commandMap["project.create"], { input });
    },
    saveSnapshot(input) {
      return invoke<ProjectSaveSnapshotResponse>(commandMap["project.saveSnapshot"], { input }).then(hydrateProjectResponse);
    },
    setManualMapping(project, input) {
      return invoke<MappingSetManualResponse>(commandMap["mapping.setManual"], {
        projectId: project.id,
        input
      }).then(hydrateProjectResponse);
    },
    getAnalysisConfig() {
      return invoke<AnalysisConfigResponse>(commandMap["analysis.configGet"]);
    },
    setAnalysisConfig(input) {
      return invoke<AnalysisConfigResponse>(commandMap["analysis.configSet"], { input });
    },
    enqueueAnalysis(project, input) {
      return invoke<AnalysisEnqueueResponse>(commandMap["analysis.enqueue"], {
        projectId: project.id,
        input
      }).then(hydrateProjectResponse);
    },
    getAnalysisStatus(projectId) {
      return invoke<AnalysisStatusResponse>(commandMap["analysis.status"], { projectId });
    },
    refreshMetadata(project, input) {
      return invoke<MetadataRefreshResponse>(commandMap["metadata.refresh"], {
        projectId: project.id,
        input
      }).then(hydrateProjectResponse);
    },
    setSelectionGoal(project, input) {
      return invoke<SelectionGoalSetResponse>(commandMap["selection.goalSet"], {
        projectId: project.id,
        input
      }).then(hydrateProjectResponse);
    },
    reviewNext(project, input) {
      return invoke<ReviewNextResponse>(commandMap["review.next"], {
        projectId: project.id,
        input
      });
    },
    setDecision(project, input) {
      return invoke<DecisionSetResponse>(commandMap["decision.set"], {
        projectId: project.id,
        input
      }).then(hydrateProjectResponse);
    },
    setDecisions(project, input) {
      return invoke<DecisionSetBatchResponse>(commandMap["decision.setBatch"], {
        projectId: project.id,
        input
      }).then(hydrateProjectResponse);
    },
    applyTag(project, input) {
      return invoke<TagApplyResponse>(commandMap["tag.apply"], {
        projectId: project.id,
        input
      }).then(hydrateProjectResponse);
    },
    applyTags(project, input) {
      return invoke<TagApplyBatchResponse>(commandMap["tag.applyBatch"], {
        projectId: project.id,
        input
      }).then(hydrateProjectResponse);
    },
    openGroup(project, input) {
      return invoke<GroupOpenResponse>(commandMap["group.open"], {
        projectId: project.id,
        input
      });
    },
    exportPreview(project, input) {
      return invoke<ExportPreviewResponse>(commandMap["export.preview"], {
        projectId: project.id,
        input
      });
    },
    exportCommit(project, input) {
      return invoke<ExportCommitResponse>(commandMap["export.commit"], {
        projectId: project.id,
        input
      });
    }
  };
}
