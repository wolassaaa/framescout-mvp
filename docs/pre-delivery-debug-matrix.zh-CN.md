# FrameScout 交付前调试矩阵

目标：每一项都必须能重复验证，且所有测试都不得修改、复制、移动或删除源照片。

| 场景 | 输入 / 触发 | 预期结果 | 当前验证方式 |
| --- | --- | --- | --- |
| 大批量导入 | 500-1000 张 JPEG，递归文件夹 | UI 先进入项目；资产和代理持续增长；浏览器不持有原图 Base64 | 真实 `G:\f1` 数据集 |
| 资源叉文件 | 名称以 `._` 开头的 JPEG 旁车文件 | 不计入项目、网格、审阅或 AI 队列 | 服务端路径过滤 + 浏览器投影过滤 |
| 导入中重启 | 索引状态为 `indexing` 时重启 localhost 服务 | 只恢复 `pending` 的真实代理任务，不重复扫描或重复插入资产 | `resume_pending_proxy_generation` |
| 缩略图 / 审阅图 | 8192px JPEG | 网格为最长边 512px；审阅图最长边 2560px；源图不被浏览器读取 | libvips 实图 smoke test |
| 缓存未就绪 | `pending`、`failed`、`needs-relink` 资产 | 不进入审阅和网格；不显示破图 | `hasReviewPreview` 回归测试 |
| 本地 URL 适配 | localhost `/api/media/{id}` | Web client 保留 HTTP URL，不替换为 Tauri 文件协议 | `tauriProjectClient` 回归测试 |
| CUDA 模型健康 | YOLOX-S / YOLOX-Nano + GPU profile | worker 返回 `CUDAExecutionProvider`；检测器不可用时分析直接失败 | 单图 worker smoke test |
| AI 输入边界 | 导入尚未完成 | AI 只分析 `ready` 的展示/缩略代理，绝不回退读取全尺寸 sourcePath | `analysis_image_path` + enqueue guard |
| 无代理时 AI | 没有 ready 代理的项目 | 返回明确错误，不创建空分析 run | `analysis_enqueue` guard |
| 云端密钥缺失 | 选择 Qwen / 自定义云端但未设置密钥 | 配置标为不可用，分析命令返回明确配置错误 | `analysis_config_get` |
| 推荐目标 | 目标为 50 | 仅从 `ready` 且拥有 AI evidence 的非拒绝照片选出至多 50 张；未分析时为 0/50 | `selectionRanking` 回归测试 |
| 导出安全 | 选择导出、含 RAW 映射 | 预览计划先生成；提交仅写目标目录；源目录不写入 | 导出 preview / commit 测试 |

## 当前真实运行记录

- 数据集：`G:\f1`，只读。
- 本地模型：YOLOX-S，CUDA 成功启用，provider 为 `CUDAExecutionProvider`。
- 代理层：8192x5464 JPEG 已验证生成 2560x1708 审阅代理与 512x342 缩略图。
- 运行时资源：代理服务维持数百 MB 以内；AI 每张顺序使用 GPU，不将全尺寸照片保存在浏览器内存。

## 发布门槛

1. `npm test`、`npm run build`、`cargo check -p framescout-local-service` 全部通过。
2. 上表每个场景至少有一个自动化断言或一次可保存的人工 smoke record。
3. 至少完成一次真实 GPU 小批量分析，并确认 AI evidence、标签和 Top-N 推荐都进入 UI。
4. 交付测试目录与源照片目录分离；测试结束后复核源照片未产生写入。
