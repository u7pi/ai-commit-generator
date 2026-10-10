# 更新日志

## Unreleased

- 同一仓库避免重复生成；生成期间修改草稿或没有暂存更改时保留已有草稿
- 使用通知提供取消入口，按请求总耗时限制超时，并在结束时清理监听和计时器
- 修复 API 地址查询参数拼接，校验数值设置，拒绝仅推理、空文本或被截断的响应
- 新增安全密钥设置／清除命令，经确认后迁移旧配置；迁移失败保留原值，接口错误隐藏密钥
- 长 diff 加入文件统计摘要，摘要、正文和截断提示合计严格遵守字符上限
- 提交 npm 锁文件，固定 VS Code 1.85 类型，新增 Windows／Ubuntu、Node.js 22 CI

## 0.2.6

- 更名为 **Simple AI Committer**，Marketplace 扩展 ID 为 `u7pi.simple-ai-committer`
- Marketplace 描述、默认本地化资源、README 和主更新日志改为英文，保留简体中文资源和中文快速说明
- 内置提示词根据 VS Code 显示语言切换：zh-cn 使用中文，其他语言使用英文；自定义提示词继续优先使用
- systemPrompt 默认值改为空字符串，修正 diff 按字符截断的说明并补全配置文档
- 新增语言回退、自定义提示词和本地化资源完整性测试

## 0.2.5

- 新增“选择 API 地址”快捷选择框，提供 OpenAI、Kimi、DeepSeek、GLM、Ollama 常用地址，并支持直接输入自定义 URL
- 设置页保留 API 地址输入框；快捷选择框在已有工作区配置时更新工作区，否则更新用户设置

## 0.2.4

- 修复：API 响应中断后请求持续等待的问题
- 修复：多仓库根路径前缀相同时选错仓库的问题
- 修复：中文响应跨数据块传输时可能出现乱码的问题
- 修复：`aiCommit.gitPath` 设置未用于 diff 和 status 操作的问题
- 修复：允许本地 Ollama 等无需认证的接口使用空 API Key

## 0.2.3

- 修复：只接受固定 temperature 的模型（如 kimi-for-coding）返回 400 的问题；`aiCommit.temperature` 设为 -1 时请求将不携带该参数

## 0.2.2

- 代码重构：用 simple-git 替代 child_process 执行 Git 操作，多仓库工作区下从对应仓库的 SCM 视图触发时使用该仓库
- 新增配置：`maxDiffChars`（按字符截断 diff）、`temperature`（采样温度）、`timeoutMs`（请求超时）；移除 `maxDiffLines`
- 生成进度条支持取消，取消会中止 API 请求
- 未配置自定义提示词时使用内置的 Conventional Commits 中文指南作为系统提示词
- 增加 Logger 与配置缓存（配置变更自动失效）

## 0.2.1

- 仅分析已暂存的更改，不再自动执行 `git add`，提交范围完全由用户控制
- 空状态提示区分"无任何更改"与"有更改但未暂存"，均未暂存时引导用户先暂存
- 完善 README 细节与功能说明（中英双语），界面提示与实际行为保持一致
- 新增 CHANGELOG.md

## 0.2.0

- 更名为 **AI Commit Generator**（原 AI Commit Message Generator by Humaid）
- 默认系统提示词优化：Conventional Commits 格式（`type(scope): 摘要` + 分条正文），输出语言跟随 diff，默认中文
- 无暂存更改时直接在输入框显示提示，不连接 AI、不消耗 token
- 界面提示（命令标题、设置说明、错误/进度信息）支持中文，默认中文
- 更换新图标（紫靛渐变圆角方块 + 白色星形）
