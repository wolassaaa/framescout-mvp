export type UiLanguage = "zh" | "en";

type CopyLeaf = readonly [string, string];
type CopyTree = CopyLeaf | { readonly [key: string]: CopyTree };
type Localized<T> = T extends readonly [string, string]
  ? string
  : T extends object
    ? { readonly [Key in keyof T]: Localized<T[Key]> }
    : never;

function isCopyLeaf(tree: CopyTree): tree is CopyLeaf {
  return Array.isArray(tree);
}

function localize<T extends CopyTree>(tree: T, language: UiLanguage): Localized<T>;
function localize(tree: CopyTree, language: UiLanguage): unknown {
  if (isCopyLeaf(tree)) return tree[language === "zh" ? 0 : 1];
  return Object.fromEntries(Object.entries(tree).map(([key, value]) => [key, localize(value, language)]));
}

const catalog = {
  nav: {
    projects: ["项目", "Projects"], import: ["导入", "Import"], review: ["审阅台", "Review Desk"],
    grid: ["网格", "Grid"], coverage: ["标签", "Tags"], export: ["导出", "Export"]
  },
  app: {
    interfaceLanguage: ["界面语言", "Interface language"], localService: ["本地服务", "Local service"],
    desktopBridge: ["桌面桥接", "Desktop bridge"], browserFallback: ["浏览器模式", "Browser fallback"],
    ready: ["张就绪", "ready"], selected: ["张已选", "selected"], marked: ["张已标记", "marked"], displayScale: ["显示缩放", "Display scale"],
    interfaceScale: ["界面缩放", "Interface scale"], currentInterfaceScale: ["当前界面缩放", "Current interface scale"],
    scaleStepper: ["缩放步进", "Scale stepper"], zoomOut: ["缩小", "Zoom out"], zoomIn: ["放大", "Zoom in"],
    resetScale: ["恢复 100%", "Reset scale"], keyboardShortcuts: ["键盘快捷键", "Keyboard shortcuts"],
    reset: ["恢复默认", "Reset"], backgroundProgress: ["后台任务进度", "Background task progress"],
    proxy: ["代理", "Proxy"], indexed: ["已索引", "indexed"], previews: ["预览", "previews"],
    move: ["移动", "Move"], aiAnalysis: ["AI 分析", "AI analysis"], gallery: ["图库", "Gallery"],
    review: ["返回审阅", "Review"], density: ["密度", "Density"], previousNext: ["上一张 / 下一张", "Previous / next"],
    tools: ["工具窗口", "Tools"], galleryNavigation: ["图库导航", "Gallery navigation"], gridDensity: ["网格密度", "Grid density"],
    undo: ["撤销", "Undo"], redo: ["重做", "Redo"], shortcutsRail: ["快捷键", "Shortcuts"],
    chineseLanguage: ["中", "中"], englishLanguage: ["EN", "EN"],
    proxyProgress: ["代理生成：{ready}/{total}", "Proxy generation: {ready}/{total}"], analysisProgress: ["AI 分析：{ready}/{total}", "AI analysis: {ready}/{total}"],
    localChangeSaveFailed: ["本地更改无法保存。下次编辑时将重试。", "A local change could not be saved. Your next edit will retry."],
    analysisConfigLoadFailed: ["无法加载 AI 配置。", "AI configuration could not be loaded."], analysisConfigSaveFailed: ["无法保存 AI 配置。", "AI configuration could not be saved."],
    analysisStartFailed: ["无法开始 AI 分析。", "AI analysis could not be started."], analysisProgressRefreshFailed: ["无法刷新 AI 进度。", "AI progress could not be refreshed."], analysisRunFailed: ["AI 分析未完成，请检查模型、预算或服务终端。", "AI analysis did not finish. Check the model, budget, or service terminal."],
    importProgressRefreshFailed: ["无法刷新导入进度。", "Import progress could not be refreshed."], exportPreviewFailedWithMessage: ["无法生成导出预览：{message}", "Could not generate the export preview: {message}"],
    exportPreviewFailed: ["无法生成导出预览。请确认项目仍在本地服务中。", "Could not generate the export preview. Confirm the project is still available in the local service."],
    noSelectedPaths: ["没有可复制的精选源路径。", "No selected source paths to copy."], selectedPathsCopied: ["已复制 {count} 个精选源{paths}。", "Copied {count} selected source {paths}."],
    sourcePath: ["路径", "path"], sourcePaths: ["路径", "paths"], clipboardUnavailable: ["无法访问剪贴板。", "Clipboard access is unavailable."],
    chooseRawMasterTitle: ["为此代理图选择 RAW 母版", "Choose the RAW master for this proxy"], rawMastersFilter: ["RAW 母版", "RAW masters"],
    chooseSourceFolderTitle: ["选择 FrameScout 源文件夹", "Choose a FrameScout source folder"], chooseOptionalRawFolderTitle: ["选择可选 RAW 母版文件夹", "Choose an optional RAW master folder"],
    shortcuts: { tag: ["当前照片标签", "Tag current frame"], batchTag: ["批量标签", "Batch tag"], loupe: ["放大镜", "Loupe"], undo: ["撤销", "Undo"], redo: ["重做", "Redo"] }
  },
  selection: { group: ["已标记项目", "Marked frames"], selectAll: ["全选", "Select all"], clearCurrentResult: ["清除选择", "Clear selection"], marked: ["已标记", "marked"] },
  selectionSession: ["全选会话", "Select session"],
  aiMark: { keep: ["AI 保留", "AI keep"], review: ["AI 复核", "AI review"], reject: ["AI 淘汰", "AI reject"] },
  reviewMode: { assisted: ["辅助审阅", "Assisted"], all: ["全部", "All"], "reject-audit": ["淘汰复查", "Reject audit"] },
  review: {
    region: ["审阅台", "Review Desk"], filters: ["审阅筛选", "Review filters"], selectionTarget: ["AI 精选目标", "AI selection target"],
    suggestion: { keep: ["建议保留", "Suggested keep"], review: ["建议复核", "Worth another look"], reject: ["可能淘汰", "Likely reject"] },
    human: { unseen: ["未判断", "Unrated"], candidate: ["候选", "Candidate"], select: ["精选", "Selected"], hold: ["保留观察", "On hold"], reject: ["淘汰", "Rejected"] },
    decision: { candidate: ["候选", "Candidate"], select: ["精选", "Select"], hold: ["保留观察", "Hold"], reject: ["淘汰", "Reject"] },
    sourceAvailable: ["原始文件可用", "Original source available"], sourceMissing: ["需要重新关联源文件", "Source needs relinking"],
    markMissing: ["标记缺失", "Mark missing"], relink: ["重新关联", "Relink"], sourceStatus: ["源文件状态", "Source status"],
    details: ["画面详情", "Frame details"], hideDetails: ["收起详情", "Hide details"], noNote: ["暂无自动说明", "No automated note"],
    capture: ["拍摄信息", "Capture"], signals: ["判断依据", "Signals"], tags: ["标签", "Tags"], policy: ["审阅策略", "Review policy"],
    projectPolicy: ["项目策略", "Project policy"], addTag: ["添加标签", "Add a tag"], add: ["添加", "Add"], cancel: ["取消", "Cancel"],
    placeholder: ["编辑精选", "editor pick"], noMatch: ["当前筛选条件下没有照片。", "No frames match this filter."],
    queue: ["待审队列", "Queue"], all: ["全部照片", "All frames"], recommended: ["AI 推荐", "AI picks"], needsReview: ["需要复核", "Needs review"], selected: ["已精选", "Selected"],
    footnote: ["AI 只提供建议，最终决定由你做出。", "AI is a suggestion. Your decision is final."], target: ["推荐目标", "Recommendation target"],
    targetNote: ["按全项目评分，并优先覆盖不同连拍组。", "Ranks the project while favoring burst diversity."], recommendedProgress: ["当前推荐", "Recommended"],
    of: ["/", "of"], compare: ["组内对比", "Compare burst"], showDetails: ["显示详情", "Show details"], focus: ["焦点检查", "Focus check"],
    rejectsHidden: ["已隐藏 AI 淘汰项", "AI rejects are hidden"], setDecision: ["设置决定", "Set decision"], filmstrip: ["胶片条", "Filmstrip"],
    previous: ["上一张", "Previous frame"], next: ["下一张", "Next frame"], aiAnalysis: ["AI 分析", "AI analysis"], aiEvidence: ["显示 AI 证据", "Show AI evidence"],
    hideAiEvidence: ["隐藏 AI 证据", "Hide AI evidence"], signalsFound: ["条证据", "signals"], confidence: ["置信度", "confidence"],
    policySignal: ["策略规则", "Policy rule"], topRank: ["推荐第 {rank} 名", "Top {rank}"], aiDisclaimer: ["证据用于辅助筛选，不会覆盖人工决定。", "Evidence assists review and never overrides your decision."],
    allowedSubjects: ["允许主体", "Allowed subjects"], subjectFocus: ["主体清晰度", "Subject focus"], globalFocus: ["全局清晰度", "Global focus"], people: ["人物识别", "People"], exposure: ["曝光可用性", "Exposure"], preset: ["项目策略", "Preset"],
    sharpCrop: ["局部清晰", "sharp crop"], softCrop: ["局部偏虚", "soft crop"], weak: ["较弱", "weak"], detectedPeople: ["识别到 {count} 人", "{count} detected"], noneDetected: ["未识别到人物", "none detected"], usable: ["可用", "usable"], lowLightUsable: ["低照度可用", "low light usable"], matchdayPreserves: ["比赛故事策略保护", "Matchday story preserves"], detectorUnavailable: ["检测器不可用", "detector unavailable"]
  },
  grid: {
    title: ["网格", "Grid"], filters: ["筛选", "Filters"], searchTags: ["搜索标签", "Search tags"], needsReview: ["需要复核", "Needs review"],
    noAthlete: ["无人主体", "No athlete"], softFocus: ["焦点偏软", "Soft focus"], selected: ["已精选", "Selected"], matchdayStory: ["比赛故事", "Matchday story"],
    aiReviewed: ["AI 已审", "AI reviewed"], awaitingAi: ["等待 AI", "Awaiting AI"], actions: ["操作", "Actions"], columns: ["列", "columns"],
    decision: ["决定", "Decision"], bulkDecision: ["批量决定", "Bulk decision"], setDecision: ["设置决定", "Set decision"], manualTag: ["手动标签", "Manual tag"],
    manualTagPlaceholder: ["手动标签", "manual tag"], applyManualTag: ["应用手动标签", "Apply manual tag"], openDuel: ["打开对决", "Open duel"], exportPreview: ["导出预览", "Export preview"],
    empty: ["没有照片符合此筛选条件", "No frames match this filter"], loadNext: ["加载下一批", "Load next"], xmpFiles: ["XMP 文件", "XMP files"], originalsModified: ["修改的原件", "originals modified"], metadataRows: ["元数据行", "metadata rows"], stars: ["星", "stars"]
  },
  coverage: {
    region: ["标签与覆盖", "Tags and coverage"], eyebrow: ["标签工作台", "Tag workbench"], title: ["让照片按创作语言被找到。", "Find frames through the language of your work."],
    filterTags: ["筛选标签", "Filter tags"], manualTagging: ["手动标注", "Manual tagging"], tagSource: ["标签来源", "Tag source"], all: ["全部", "All"], auto: ["AI 自动", "AI automatic"], manual: ["人工与项目", "Manual and project"],
    tagName: ["标签名称", "Tag name"], tagPlaceholder: ["例如 scene:empty、subject:person、color:red", "e.g. scene:empty, subject:person, color:red"], annotate: ["标注 {count} 张", "Tag {count} frames"],
    helper: ["不写命名空间时会归为 manual；AI 标签始终以 ai: 标记，便于审查与筛选。", "Tags without a namespace become manual. AI tags stay prefixed with ai: for review and filtering."],
    taxonomy: ["标签分类和快捷位", "Tag taxonomy and quick slots"], quickTags: ["快捷标签", "Quick tags"], selectedFrames: ["已精选照片", "selected frames"], coveredTags: ["已覆盖标签", "covered tags"], unselectedSets: ["未精选标签组", "unselected tag sets"],
    matrix: ["覆盖矩阵", "Coverage matrix"], tag: ["标签", "Tag"], selected: ["已选", "Selected"], empty: ["没有标签符合此筛选条件。", "No tags match this filter."],
    taggedFrames: ["带标签的照片", "Tagged frames"], frames: ["张", "frames"], inspect: ["选择标签以查看照片。", "Select a tag to inspect its frames."],
    source: ["主体", "Subject"], people: ["人物组", "People groups"], scene: ["场景", "Scene"], object: ["对象", "Object"], action: ["动作", "Action"], color: ["颜色", "Color"], composition: ["构图", "Composition"], quality: ["质量", "Quality"], editorial: ["编辑", "Editorial"]
  },
  projects: { region: ["项目", "Projects"], eyebrow: ["本地审阅室", "Local review room"], title: ["每一张出现在眼前的照片都值得注意。", "Every frame you see deserves attention."], newReview: ["新建审阅", "New review"], openExisting: ["打开现有项目", "Open existing project"], settings: ["设置", "Settings"], reviewed: ["已审阅", "reviewed"], selected: ["已精选", "selected"], aiRejects: ["AI 淘汰", "AI rejects"] },
  analysis: {
    region: ["分析队列", "Analysis queue"], eyebrow: ["本地分析", "Local analysis"], ready: ["可以开始审阅。", "Review can begin."], preparing: ["正在准备审阅台。", "Preparing the review desk."], enterReview: ["进入审阅台", "Enter Review Desk"],
    imagesDiscovered: ["已发现图片", "images discovered"], aiAnalyzed: ["AI 已分析", "AI analyzed"], rawPlaceholders: ["RAW 占位", "RAW placeholders"], backend: ["后端", "backend"], previewMosaic: ["预览拼图", "Preview mosaic"], status: ["分析状态", "Analysis status"],
    queueReady: ["审阅队列就绪", "Review queue ready"], running: ["分析进行中", "Analysis running"], evidence: ["张照片已有本地 AI 证据。", "frames have local AI evidence."], missing: ["条缺失源记录。", "missing source records."], cr2: ["CR2 在原生提取前保持可见占位。", "CR2 stays a visible placeholder until native extraction."],
    mapping: ["代理与 RAW 映射", "Proxy and RAW mapping"], mappedExactly: ["精确映射", "mapped exactly"], proxyOnly: ["仅代理", "proxy-only"], ambiguous: ["映射不明确", "ambiguous"], missingMasters: ["缺失母版", "missing masters"], manuallyMapped: ["手动映射", "manually mapped"], multipleRaw: ["多个 RAW 候选", "Multiple RAW candidates"], mappedRawUnavailable: ["映射的 RAW 不可用", "Mapped RAW is unavailable"], chooseRaw: ["选择 RAW", "Choose RAW"]
  },
  import: {
    region: ["新建审阅", "New review"], eyebrow: ["新建审阅", "New review"], title: ["在分析开始前设定规则。", "Set the rules before analysis starts."], originalsUntouched: ["原始文件会保持不变，直到明确导出 XMP。", "Originals stay untouched until explicit XMP export."],
    projectName: ["项目名称", "Project name"], defaultProjectName: ["周五晚间决赛", "Friday night finals"], chooseFolder: ["选择本地文件夹", "Choose a local folder"], localFiles: ["已选择本地文件", "Local files selected"], nativeScan: ["原生扫描将发现支持的素材", "Native scan will discover supported assets"], supportedAssets: ["个支持的第一阶段素材已发现", "supported Phase 1 assets discovered"],
    rawMasters: ["RAW 母版", "RAW masters"], addRawFolder: ["添加可选 RAW 母版文件夹", "Add optional RAW master folder"], addFiles: ["添加单个文件", "Add individual files"], selectionTarget: ["AI 最终推荐数量", "AI recommendation target"], selectionTargetHelp: ["例如从 5000 张中推荐最好的 50 张；不会替代人工精选。", "For example, recommend the best 50 of 5,000 without replacing human selections."],
    advanced: ["高级分析", "Advanced analysis"], backend: ["后端", "Backend"], browserAdapter: ["本地浏览器适配器", "Local browser adapter"], previewSupport: ["预览支持", "Preview support"], previewDetail: ["JPEG/PNG 浏览器预览，CR2 占位", "JPEG/PNG browser preview, CR2 placeholder"], start: ["开始本地项目", "Start local project"]
  },
  duel: { region: ["连拍对决", "Burst Duel"], empty: ["这个组至少需要两张照片才能比较。", "This group needs at least two frames for comparison."], back: ["返回审阅", "Back to review"], evidence: ["AI 认为：{side} 主体更清晰", "AI sees: {side} subject sharper"], left: ["左侧", "left"], right: ["右侧", "right"], choose: ["选择 {side}", "Choose {side}"], actions: ["对决操作", "Duel actions"], pinBoth: ["保留两张", "Pin both"], rejectWeaker: ["淘汰较弱", "Reject weaker"], frames: ["张", "frames"], burstFrames: ["连拍照片", "Burst frames"], unseen: ["未判断", "Unseen"] },
  profile: {
    switch: ["切换 AI 模型", "Switch AI model"], lane: ["AI 通道", "AI lane"], analysisLane: ["分析通道", "Analysis lane"], chooseLane: ["选择 AI 分析通道", "Choose AI analysis lane"], applies: ["切换后从下一次分析生效", "Applies to the next analysis run"], rawNeverUploads: ["永不上传", "never uploads"], local: ["本机", "ON THIS COMPUTER"], cloud: ["云端 API", "CLOUD API"], proxyLeaves: ["代理图会离开此电脑", "Proxy leaves this computer"], endpoint: ["兼容接口地址", "Compatible endpoint"], modelName: ["模型名称", "Model name"], saveSwitch: ["保存并切换", "Save and switch"], keys: ["密钥只从服务终端读取：DASHSCOPE_API_KEY 或 FRAMESCOUT_CLOUD_API_KEY", "Keys are read only from the service terminal: DASHSCOPE_API_KEY or FRAMESCOUT_CLOUD_API_KEY"],
    executionMode: ["算力运行方式", "Compute routing"], cloudFirst: ["云端识别", "Cloud analysis"], localFirst: ["本机识别", "Local analysis"], proxyOnlyPrivacy: ["仅发送代理图，RAW 始终留在本机", "Only proxies are sent; RAW always stays local"], cloudBudget: ["项目云端预算上限（分）", "Project cloud budget cap (cents)"], cloudConcurrency: ["云端并发", "Cloud concurrency"], saveRouting: ["保存运行设置", "Save routing"], budgetEstimate: ["预算按项目与模型累计，并按保守估算硬停止；供应商账单以实际用量为准。", "The cap accumulates per project and model and hard-stops on a conservative estimate; provider billing follows actual usage."],
    localGpuQuality: ["RTX 高质量", "RTX Quality"], localGpuQualityDetail: ["完整检测，适合最终筛选", "Full detection for final culling"], localGpuFast: ["RTX 快速", "RTX Fast"], localGpuFastDetail: ["轻量模型，适合快速初筛", "Light model for a fast first pass"], localCpuFast: ["CPU 兼容", "CPU Compatible"], localCpuFastDetail: ["没有独显时在本机运行", "Runs locally without a discrete GPU"], qwenCloud: ["千问视觉", "Qwen Vision"], qwenCloudDetail: ["云端视觉理解，仅发送缩小代理图", "Cloud vision; downscaled proxies only"], customCloud: ["自定义 API", "Custom API"], customCloudDetail: ["OpenAI 兼容视觉接口", "OpenAI-compatible vision endpoint"]
  },
  export: {
    region: ["交付导出", "Export hand-off"], eyebrow: ["交付导出", "Delivery export"], title: ["整理给修图的可用文件。", "Prepare files for retouching."], subtitle: ["所有源文件保持原位；这里只会向目标目录复制并写入新的侧车文件。", "All sources stay in place. FrameScout only copies files and writes new sidecars in the destination."], refreshMetadata: ["重新读取拍摄信息", "Refresh capture metadata"], metadataStarted: ["已开始从原始文件重新读取拍摄信息；完成后刷新导出预览即可看到新信息。", "Metadata refresh started from the original files. Refresh the export preview when it completes."], destination: ["交付位置", "Destination"], destinationPlaceholder: ["D:\\修图\\周五决赛", "D:\\Retouch\\Friday-finals"], destinationHelp: ["使用本机绝对路径。FrameScout 会在此创建交付文件而不改动源文件夹。", "Use an absolute local path. FrameScout creates outputs here without changing source folders."],
    scope: ["导出范围", "Export scope"], selectedOnly: ["只导出人工精选", "Human selections only"], decided: ["导出候选、精选与保留观察", "Candidates, selections, and holds"], media: ["文件内容", "File content"], proxies: ["仅代理图", "Proxies only"], raw: ["仅映射 RAW", "Mapped RAW only"], both: ["代理图 + RAW", "Proxies + RAW"], rawFolder: ["RAW 目录", "RAW layout"], rawSubfolder: ["单独放入 RAW 文件夹", "Separate RAW folder"], sameFolder: ["与代理图放在同一目录", "Alongside proxies"], preserveFolders: ["保留原始子目录结构", "Preserve source subfolders"], includeXmp: ["在导出副本旁写入 XMP 评分与标签", "Write XMP ratings and tags beside exported copies"], includeCsv: ["生成 FrameScout CSV 交付清单", "Create a FrameScout CSV manifest"],
    filters: ["交付筛选", "Delivery filters"], decisions: ["人工决定", "Decisions"], folders: ["文件夹组", "Folder groups"], tags: ["标签", "Tags"], recipe: ["组合规则", "Match rule"], decisionTitle: ["先确定基础范围", "Choose the base scope"], decisionHelp: ["人工精选只交付标为精选的照片；已做决定也会带上候选与保留观察。", "Human selections exports only selected photos. Decided frames also includes candidates and holds."], noFolders: ["当前项目还没有可用的文件夹组。", "No folder groups are available in this project."], includeList: ["白名单", "Include"], excludeList: ["黑名单", "Exclude"], includeHelp: ["选中的标签作为交付条件", "Selected tags are required for delivery"], excludeHelp: ["带有选中标签的照片永不导出", "Photos with selected tags are never exported"], noTags: ["尚未添加可用于交付的人工标签。", "No manual tags are available for delivery filters."], recipeTitle: ["作品组件交集规则", "Portfolio component rule"], recipeHelp: ["文件夹组与标签都选中时，决定照片需满足全部条件或任意一个条件。", "When folder groups and tags are selected, choose whether a photo must match every condition or any condition."], matchAll: ["全部符合", "Match all"], matchAny: ["符合任意", "Match any"], preview: ["生成复制预览", "Generate copy preview"], proxyCopies: ["代理图副本", "Proxy copies"], rawCopies: ["映射 RAW 副本", "Mapped RAW copies"], xmpFiles: ["XMP 侧车文件", "XMP sidecars"], skipped: ["未纳入交付", "Excluded"], copyList: ["复制清单", "Copy manifest"], copyListHelp: ["以下文件将复制到目标位置", "These files will be copied to the destination"], emptyCopyList: ["当前设置下没有可复制的文件。", "No files match these settings."], rawMapping: ["RAW 映射", "RAW mapping"], proxy: ["代理图", "Proxy"], moreFiles: ["个附加文件已包含在本次交付中。", "additional files are included in this delivery."], confirmTitle: ["执行前确认", "Confirm export"], confirmPrefix: ["FrameScout 将创建目标文件夹并复制", "FrameScout will create destination folders and copy"], confirmSuffix: ["个文件。源照片、RAW 与 XMP 都不会被修改。", "files. Source photos, RAW files, and XMP files remain unchanged."], confirmLabel: ["我已核对交付路径与复制清单", "I checked the destination and copy manifest"], commit: ["执行复制导出", "Run copy export"], commitUnavailable: ["当前运行环境无法写入文件，未执行导出。", "This runtime cannot write files, so no export was performed."], copied: ["已复制", "Copied"], files: ["个文件，其中 RAW", "files, including"], xmp: ["个；XMP", "RAW and"], xmpEnd: ["个。", "XMP files."], downloadCsv: ["下载 CSV 预览", "Download CSV preview"], copyPaths: ["复制精选源路径", "Copy selected source paths"], utilities: ["导出工具", "Export utilities"], metadataList: ["元数据清单", "Metadata manifest"], rows: ["行", "rows"], settings: ["导出设置", "Export settings"], mediaLabel: ["导出媒体", "Export media"], selectionFilters: ["导出选择筛选", "Export selection filters"], copyTargets: ["复制目标", "Copy targets"], metadataMap: ["元数据映射预览", "Metadata map preview"]
  },
  presets: {
    actionCoverage: { name: ["动作筛选", "Action coverage"], note: ["严格检查空镜，保护清晰的运动主体。", "Check empty action frames while protecting sharp subjects."] },
    matchdayStory: { name: ["赛事故事", "Matchday story"], note: ["保留场地、观众、氛围与叙事镜头。", "Preserve venue, crowd, atmosphere and story frames."] },
    motorsport: { name: ["赛车追焦", "Motorsport panning"], note: ["识别人与车辆，保护有意的追焦运动模糊。", "Recognize people and vehicles while protecting intentional panning blur."] },
    esportsStage: { name: ["电竞舞台", "Esports stage"], note: ["关注选手、舞台、观众与屏幕环境。", "Keep players, stage, crowd and screen context visible."] },
    portrait: { name: ["人像精选", "Portrait select"], note: ["优先主体与面部清晰；眼睛和表情检查后续增强。", "Prioritize subject and face sharpness; eye and expression checks are coming next."] },
    custom: { name: ["自定义", "Custom"], note: ["为特殊拍摄任务保留人工规则入口。", "Keep a manual policy entry point for unusual assignments."] }
  }
} as const satisfies CopyTree;

export const uiCopy = {
  zh: localize(catalog, "zh"),
  en: localize(catalog, "en")
} as const;

export function documentLanguage(language: UiLanguage): "zh-CN" | "en" {
  return language === "zh" ? "zh-CN" : "en";
}

export function formatCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
