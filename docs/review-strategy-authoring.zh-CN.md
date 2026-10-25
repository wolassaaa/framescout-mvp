# FrameScout 审查策略编写规范

版本：1.0 草案  
对应格式：`strategies/review-strategy.schema.json`

## 1. 这份文档解决什么问题

审查策略不是一句提示词，而是一份可追溯的摄影筛选规则。它告诉 FrameScout：

1. 这类拍摄中什么算主体；
2. 哪些画面必须保护，不能因为普通技术指标被误删；
3. 清晰度、曝光、人脸、闭眼和审美信号分别如何参与判断；
4. 什么情况可以建议保留、进入复核或建议淘汰；
5. 模型不可用时怎样保守降级；
6. 用哪些样例验证策略没有误伤。

以后可以让 AI 批量生成 `*.strategy.json`，但每份文件都必须通过 Schema 校验和人工样例复核。

> 当前程序中的六个策略仍由代码内置，尚不会自动加载 `strategies/` 目录。这里先固定未来的作者格式；接入动态策略加载时，不需要重新发明字段。

## 2. 最小结构

一份策略至少包含以下部分：

```json
{
  "$schema": "./review-strategy.schema.json",
  "schemaVersion": 1,
  "id": "portrait-select",
  "version": 1,
  "name": { "zh": "人像精选", "en": "Portrait select" },
  "note": { "zh": "一句简短批注。", "en": "One short note." },
  "intent": "这份策略希望保护什么、优先筛掉什么。",
  "subjects": {},
  "signals": {},
  "decisionPolicy": {},
  "selectionGoal": {},
  "burstPolicy": {},
  "fallbackPolicy": {},
  "acceptanceExamples": []
}
```

### 命名规则

- `id`：稳定的英文小写 ID，只能使用 `a-z`、数字和连字符；发布后不要改名。
- `version`：规则含义变化时加一。只改错别字可以不加。
- `name.zh`：界面主名称，建议 2 至 6 个汉字。
- `note.zh`：名称下方的小批注，建议 15 至 35 个汉字，不写模型宣传语。
- `intent`：给审核者和 AI 作者看的完整目标，可以比界面批注更具体。

## 3. 参数说明

### `subjects`

- `allowedLabels`：允许主体类别，例如 `person`、`car`、`motorcycle`。
- `minimumConfidence`：主体检测最低置信度。初始值建议 `0.25`，必须用真实样本校准。
- `protectSmallSubjects`：远处或占画面比例很小的主体是否仍应受到保护。
- `protectedContexts`：即使主体不明显也要保留复核的环境，例如观众、舞台、维修区、场地全景。

### `signals.focus`

- `enabled`：是否使用清晰度信号。
- `regionPriority`：检测顺序，通常为 `face`、`subject`、`global`。
- `reviewBelow`：低于该值进入复核。
- `rejectBelow`：低于该值才允许建议淘汰，必须小于或等于 `reviewBelow`。
- `protectIntentionalMotion`：是否保护追焦、动感模糊等有意效果。

这些阈值不是跨相机通用真理。ISO、主体大小、镜头和代理图尺寸都会改变清晰度数值。

### `signals.exposure`

- `enabled`：是否使用曝光信号。
- `shadowClipReviewAbove`：阴影截断比例超过该值时复核。
- `highlightClipReviewAbove`：高光截断比例超过该值时复核。
- `protectLowLight`：舞台、夜景和电竞环境是否允许低亮度但主体可用的照片继续保留。

### `signals.face`

- `mode`：`off`、`optional` 或 `required`。
- `checkEyes`：是否检查闭眼。
- `checkExpression`：是否检查表情异常。
- `minimumFacePixels`：脸部短边不足该像素时，不得声称闭眼或表情判断可靠。
- `closedEyesAction`：闭眼时进入 `review` 还是 `reject`。默认应为 `review`。

### `signals.aesthetic`

- `mode`：建议使用 `rank-within-group`，只在同一连拍组内排序。
- `weight`：审美分数在排序中的权重。
- `canHardReject`：必须保持 `false`；审美模型不能单独淘汰照片。

### `decisionPolicy`

- `noAllowedSubject`：没有允许主体时采取 `keep`、`review` 或 `reject`。
- `unreadablePreview`：代理图无法读取时的动作。
- `hardRejectRequires`：硬淘汰必须同时满足的证据名称。
- `humanDecisionWins`：必须为 `true`，重新分析不能覆盖人工决定。
- `ambiguousAction`：证据冲突时建议使用 `review`。

### `selectionGoal`

这是“从 5000 张里推荐最好的 50 张”使用的全项目数量目标。它和单张照片的 `keep/review/reject` 不同：前者负责排序并截取 Top N，后者负责说明照片是否可用。

- `defaultTargetCount`：新项目默认推荐数量，例如 `50`；创建项目后允许用户覆盖。
- `mode`：当前固定为 `exact`，有足够合格照片时必须恰好推荐目标数量。
- `rankingScope`：当前固定为 `project`，在整个项目内比较，而不是每批各选 50 张。
- `diversity`：推荐 `burst-aware`，先从每个连拍组取最优一张，再按总分补足数量；`score-only` 仅按总分排序。
- `insufficientEligible`：固定为 `return-all-eligible`。如果只有 37 张可用，不得用明显废片凑够 50 张。
- `preserveHumanDecisions`：必须为 `true`。AI 推荐名单不等于人工“精选”，也不能覆盖人工决定。

数量目标只决定推荐名单，不允许直接删除、移动照片或写入人工决定。并列分数必须使用稳定顺序打破并列，使同一批输入和同一模型可以复现结果。

### `fallbackPolicy`

为每类模型缺失定义降级动作。推荐默认值：

- 主体检测器缺失：`review`，不能据此说“没有主体”；
- 人脸模型缺失：跳过闭眼和表情信号；
- 审美模型缺失：保持原顺序；
- 云端不可用：退回本机信号，不自动上传原图。

## 4. 保守原则

1. 策略只能给出建议，不能删除或移动源照片。
2. 不确定时进入复核，不要为了高自动化率制造误淘汰。
3. `AI Reject` 必须能展示具体证据，不能只显示总分。
4. 人工精选、候选、保留观察和淘汰永远覆盖 AI 建议。
5. 审美信号只排序，不作为硬淘汰依据。
6. RAW 永不发送到云端；云端只能接收明确授权的缩小代理图。
7. 模型不可用时必须显示降级状态，不能伪造零检测结果。

## 5. 验收样例怎么写

每份策略至少写 5 个 `acceptanceExamples`：

- 两个必须保护的正例；
- 两个应该进入复核或淘汰的反例；
- 一个模型缺失或证据冲突的降级例。

每个样例包含：

- `case`：短名称；
- `given`：画面条件；
- `expected`：期望动作；
- `reason`：为什么；
- `requiredSignals`：至少应该出现哪些证据。

这些是规则验收条件，不是训练图片，也不能包含私人图片路径。

## 6. 批量让 AI 生成策略的提示词

```text
你是 FrameScout 摄影审片策略作者。

请根据下面的拍摄类型，生成一份严格符合
strategies/review-strategy.schema.json 的 JSON，不要输出 Markdown。

拍摄类型：<填写，例如婚礼纪实、棚拍人像、鸟类摄影>
主要主体：<填写>
必须保护的画面：<填写>
常见废片原因：<填写>
允许的有意模糊或特殊曝光：<填写>
是否需要人脸/闭眼检查：<填写>
是否允许云端分析：<填写>
默认希望最终推荐多少张：<填写，例如 50>

要求：
1. 中文名称 2-6 个字，批注 15-35 个字；
2. 不确定时使用 review；
3. aesthetic.canHardReject 必须为 false；
4. humanDecisionWins 必须为 true；
5. 不得允许上传 RAW；
6. 至少生成 5 个 acceptanceExamples；
7. 不要编造尚不存在的检测能力，缺失能力写入 fallbackPolicy。
8. selectionGoal.mode 必须为 exact，preserveHumanDecisions 必须为 true；
9. 数量不足时返回全部合格照片，不得用明显废片强行凑数。
```

## 7. 人工审核清单

- 名称和批注是否一眼能懂？
- 允许主体是否遗漏，例如赛车策略不能只写 `person`？
- 是否保护了追焦、低光、舞台灯等拍摄意图？
- 是否存在“一个低分就硬淘汰”的危险规则？
- 模型缺失时是否会误判为零主体？
- 是否写了足够的正反验收样例？
- 阈值是否标记为待真实样本校准？
- 是否明确人工决定优先、源照片不修改、RAW 不上传？

## 8. 参考文件

- 保守基础策略：`strategies/base.strategy.json`
- 人像示例策略：`strategies/portrait.strategy.json`
- 机器校验规则：`strategies/review-strategy.schema.json`
