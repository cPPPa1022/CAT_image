# SillyImage Lab — 提示词工程体系

## 目录结构

```
prompts/
├── README.md                       # 本文件
├── static-profile/                 # 角色静态外貌提取
│   ├── system.txt                  #   system prompt：角色定义 + 规则 + 输出格式
│   ├── rules.json                  #   提取规则分类表（6条规则）
│   └── examples.json               #   4个 few-shot 示例
└── aux-pipeline/                   # 对话场景生图管线
    ├── system.txt                  #   system prompt：三项任务 + 双段输出格式
    ├── rules.json                  #   规则细化（10条规则）
    └── examples.json               #   3个完整管线示例
```

## 一份 prompt = 三个文件

| 文件 | 用途 | 谁修改 |
|------|------|--------|
| `system.txt` | 角色定义 + 核心规则 + 输出格式 | 提示词工程师 |
| `rules.json` | 分类规则表，可快速增删规则 | 任何人都可修改 |
| `examples.json` | few-shot 示例，帮助模型理解输出格式 | 用真实案例替换 |

## 格式约定

- **system.txt**：Markdown 结构（纯文本，不做代码块包装）
- **rules.json**：JSON 数组，每项含 `rule_id`、`description`、规则字段
- **examples.json**：JSON 数组，每项含 `input` 和 `expected_output`

## 语言规范

所有提示词为**全中文**。仅保留以下为英文：
- JSON 字段名（`"main"`, `"dynamic"`, `"npcs"`, `"appearances"`, `"static"`, `"ephemeral"`）
- API 参数名
- ComfyUI 节点类型

## 维护指南

### 修改提示词的正确流程

1. 编辑 `prompts/` 下对应文件
2. 刷新 ST 页面（Ctrl+Shift+R）
3. 检查控制台是否有 `prompt 加载失败` 日志
4. 触发对应管线测试
5. 查看 📋 日志面板确认新版提示词生效

### 新增管线提示词

如需新增第三个提示词管线，按以下步骤：
1. 在 `prompts/` 下新建文件夹，如 `new-pipeline/`
2. 创建 `system.txt`、`rules.json`、`examples.json` 三个文件
3. 在 `loader.js` 中添加对应文件的加载路径
4. 在 `index.js` 中通过 `PROMPTS['new-pipeline/system.txt']` 引用
