# FrameScout Windows 交付说明

FrameScout 的交付入口是浏览器 Web 界面加本地服务终端：服务运行时会显示进度日志，浏览器负责全部图片索引、筛选、标签、导出和 AI 请求界面。所有通信都只在本机 `127.0.0.1` 进行，原始照片不会被改写。

导入使用固定 32 张的数据库批次和固定 16 项的缩略图队列；网页不保留原图 Base64，只保留缩略图 URL。审阅胶片条只渲染当前照片附近的 48 张，网格每次渲染 240 张，以避免大项目占满内存。

## 安装后的数据位置

- 项目数据库和缓存：`%APPDATA%\\com.framescout.desktop`
- 本地模型目录：`%LOCALAPPDATA%\\FrameScout\\models`
- 可选覆盖：`FRAMESCOUT_MODELS_DIR`、`FRAMESCOUT_AI_MODEL`、`FRAMESCOUT_AI_FAST_MODEL`、`FRAMESCOUT_AI_PYTHON`

模型不随首个安装包分发。把已审核的模型文件放入模型目录后，重启客户端即可识别：`yolox_s.onnx` 为质量模式，`yolox_nano.onnx` 为快速模式。云端模型通过设置页面配置，API 密钥只从 `FRAMESCOUT_CLOUD_API_KEY` 环境变量读取，不写入项目数据库。

## 启动 Web 客户端

```powershell
npm run web:open
```

## 生成人工 review 包

这个包包含已构建的 Web UI、本地服务可执行文件、可审查源码和启动说明，不包含源照片、开发缓存或尚未通过授权复核的模型权重：

```powershell
npm run package:review
```

压缩包默认生成在仓库同级的 `framescout-review-bundles` 目录。解压后运行根目录的 `START-REVIEW.ps1` 即可打开浏览器版本。

## 生成桌面壳（备用）

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1
```

若安装器工具链尚未准备好，可先生成可启动的桌面可执行文件：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1 -NoBundle
```
