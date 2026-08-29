# 🐱 小猫的生图插件 v1.0

**SillyTavern 1.18 第三方扩展**：在角色对话中自动为剧情配图——AI 像专属画师一样理解剧情、调用 ComfyUI 生成插图，人物长相/衣着/场景氛围逐章稳定。

## 两种配图模式

| | 🎨 画师模式（默认） | 🎬 导演模式 |
|---|---|---|
| 谁配图 | 专属 AI（额外 API）：扫描角色卡建档 → 每轮精读原文 → 写提示词 | 主模型在正文写 [img:] 标记位置+画面要点，画师只补提示词 |
| 人物一致性 | 👑 最还原（档案留存：7 维锚点+身形） | 良好（人物表+占位符建档） |
| Token 成本 | 每轮多一次 AI 调用 | 🌱 最省（不额外扫卡） |
| 配置 | 零配置 | 需在角色卡粘贴 prompts/main-llm-instruction.txt |

## 环境要求

- SillyTavern **1.18**（1.17+，推荐 1.18）
- **ComfyUI**（本地/远程，aki 整合包可用），工作流需含 %prompt% 占位符
- 一个 **Chat Completions API**（画师模式写提示词/建档；导演模式建议也配）

## 安装

1. 克隆/解压到 data/default-user/extensions/sillyCAT（或任意名目录）
2. 刷新酒馆页面，右下角出现🐱状态条
3. 面板 → 设置：配置 **AI 助理**（API/Key/模型）→ 测试连接
4. 配置 **ComfyUI & 工作流** → 导入工作流（含 %prompt%）
5. 点主界面 **🎨 扫描角色卡**（画师模式建档）→ 开聊

## 目录结构

```
index.js / manifest.json / announcement.txt
modules/
  scanner.js        事件驱动扫描与触发
  roster.js         人物表（导演模式人设档案）
  sync-cards.js     生图协作卡（主模型提示注入）
  pipeline/         管线（api.js 辅助API / pipeline.js 画师管线 / roster-pipeline.js 导演管线）
  comfyui.js render.js queue.js cache.js story.js text-utils.js settings.js log.js export.js
  ui/               SnowCat 界面（cat.js 状态猫 / panel.js 抽屉 / tabs.js 视图 / theme.js 主题）
prompts/            提示词素材（pipeline + roster + 角色卡指令模板）
```

## 常见问题

- **人物不一致？** 确认扫描过角色卡（画师模式）；角色卡新人物在正文/占位符里报一次外貌
- **提示词是中文剧情文字？** 检查辅助模型是否遵守 prompts/roster/system.txt（禁止照抄场景）
- **刷新后历史图片不显示？** v1.0 已修复：页面加载后自动恢复历史图片缓存（1.5s 延迟）

---

*v1.0 全新章节：SnowCat 界面 + 画师/导演双模式 · 作者 cPPPa1022*