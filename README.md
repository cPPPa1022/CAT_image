# 🐱 CATimage v1.0

**SillyTavern 1.18 第三方扩展 · 文生图人物一致性方案**

CATimage 从角色卡提取外貌锚点（脸型/眉眼/鼻唇/肤色/体型/发型/衣着 7 维 + 身形），每轮读完正文后更新动态档案，出图时逐轮引用——角色不换脸，衣着、场景、氛围跟着剧情走。

## 支持的模型（按提示词语言三档）

| 档位 | 提示词 | 生图模型 | 状态 |
|---|---|---|---|
| ZIT | 中文 | Z-Image Turbo | 优先适配、主要优化 |
| Anime | 英文自然语言 | Anima Base | 与 ZIT 同级适配 |
| Anime Tag | 英文标签链 | SDXL 等 tag 系模型 | 未实测，理论可用 |

## 支持的 LLM

- DeepSeek（Chat Completions API），管线按 DeepSeek 行为调优
- 兼容任一同协议的自定义端点（设置中选自定义）

## 双模式（比旧版更省 token）

| | 🎨 画师模式（默认） | 🎬 导演模式 |
|---|---|---|
| 配图方式 | 专属 AI 助手：扫卡建档 → 精读原文 → 写提示词 | 主模型标记 [img:] 位置+画面要点，画师只补提示词 |
| 一致性 | 最强（档案持久引用） | 好（人物表+标记） |
| Token | 常规 | 最省（不额外扫卡分析档案） |
| 配置 | 零配置 | 需在角色卡粘贴 prompts/main-llm-instruction.txt |

## 环境要求

- SillyTavern 1.18（1.17+，推荐 1.18）
- ComfyUI（本地/远程，aki 整合包可用），工作流需含 %prompt% 占位符
- Chat Completions API（推荐 DeepSeek）

## 安装

1. 解压到 data/default-user/extensions/（任意文件夹名）
2. 刷新酒馆，右下角出现猫咪状态条
3. 面板 → 设置：AI 助理填 DeepSeek 端点/Key → 测试连接
4. ComfyUI & 工作流：填地址 → 导入工作流（含 %prompt%）
5. 点主界面 🎨 扫描角色卡（建档）→ 开聊

## 目录结构

```
index.js / manifest.json / announcement.txt
modules/
  scanner.js        事件驱动扫描与触发
  roster.js         人物表（人设档案）
  sync-cards.js     生图协作卡（主模型提示注入）
  pipeline/         管线（api.js 辅助API / pipeline.js 画师管线 / roster-pipeline.js 导演管线）
  comfyui.js render.js queue.js cache.js story.js text-utils.js settings.js log.js export.js
  ui/               SnowCat 界面（cat.js 状态猫 / panel.js 抽屉 / tabs.js 视图 / theme.js 主题）
prompts/            提示词素材（pipeline + roster + 角色卡指令模板）
```

## 常见问题

- 人物不一致？确认扫描过角色卡（画师模式）；新人物在正文/占位符报一次外貌
- 提示词像中文剧情文字？检查辅助模型是否遵守 prompts/roster/system.txt（禁止照抄场景）
- 刷新后历史图片不显示？v1.0 已修复：加载后 1.5s 自动恢复历史图片

---

*v1.0 全新章节：SnowCat 界面 + 画师/导演双模式 · 作者 cPPPa1022 · MIT License*