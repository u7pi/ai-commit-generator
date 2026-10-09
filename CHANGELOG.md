# Changelog

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
