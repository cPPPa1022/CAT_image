// ── SillyImage Lab v1.23 事实通道（原样通过，不认词表）──
//
// 为什么改成这样：
//   v1.21 我按「怀孕/绷带/纹身/晒黑/吻痕」写了一份 FACT_RULES 白名单 —— 那是针对性修复。
//   实测 8 个同型事实（截肢/化疗/义眼/双胞胎/石膏/眼镜/发色…）它只抓到 2 个，
//   而且"抓到"的那 2 个还是因为我恰好手写了。
//
//   真正的机制是：辅助模型被告知"禁止照抄占位符原文，要改写成画面"，
//   于是「怀孕16周」被翻译成「小腹隆起」、「左臂截肢」被翻译成「袖管空荡荡」。
//   事实是无穷集合，任何枚举都必然漏；能覆盖无穷的只有**位置协议**（这段原样通过），
//   和造型库 / 状态库 / 人物锚点是同一个范式。
//
// 所以这里只做两件事：
//   1. 把 `事实:` 段的字符串原样拼到提示词最前面（权重最高处）
//   2. 用**归一化逐字包含**校验：`fact` 的每个字（去标点空格）都得在提示词里出现
//      —— 不需要知道它是什么词，所以永远不会因为"新维度"而漏。

// 归一化：去空白 / 常见中英标点 → 只留可比较的字符
export function normFact(s) {
    return String(s || '')
        .replace(/[\s\u3000]/g, '')
        .replace(/[，。、；：,.;:!?！？""''「」『』（）()【】\[\]《》<>·\-—_/\\|]/g, '')
        .toLowerCase();
}

// 这条提示词里有没有这个事实（逐字，允许标点/空格差异）
export function promptHasFact(prompt, fact) {
    var f = normFact(fact);
    if (!f) return true;
    return normFact(prompt).indexOf(f) >= 0;
}

// 缺失的事实列表
export function missingFacts(facts, prompt) {
    var out = [];
    for (var i = 0; i < (facts || []).length; i++) {
        if (!promptHasFact(prompt, facts[i])) out.push(facts[i]);
    }
    return out;
}

// 批量校验：placeholders[i].facts vs prompts[i]
// 返回 [{ i, facts: [...] }]；只做告警/回填判断，不做语义推断
export function findLostFactsInPrompts(placeholders, prompts) {
    var misses = [];
    if (!placeholders || !prompts) return misses;
    var n = Math.min(placeholders.length, prompts.length);
    for (var i = 0; i < n; i++) {
        var facts = (placeholders[i] && placeholders[i].facts) || [];
        if (!facts.length) continue;
        var lost = missingFacts(facts, prompts[i]);
        if (lost.length) misses.push({ i: i, facts: lost });
    }
    return misses;
}
