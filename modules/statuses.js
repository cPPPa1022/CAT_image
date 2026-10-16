// ── SillyImage Lab 状态库（v1.9.0）──
// 时效性状态（半永久 / 跨轮暂时）：晒黑、染发、新纹身、吻痕、抓痕、淤青、缠绷带、怀孕…
//
// 和造型库（wardrobe.js）**完全同构**：
//   主模型写 key → 插件具象化一次并存档 → 之后原样复用（零漂移）
//   主模型用 `+key` 激活 / `-key` 取消
//
// 存档位置：settings.statuses[角色卡][聊天ID][key] = { key, detail, active, since, ts }
//
// ⚠️ 时效：**没有自动过期** —— 插件读不到剧情时间，过期只能由主模型显式 `-key`。
//    兜底：面板列出「当前生效的状态」+ 已持续轮数 + 手动取消按钮。

import { slLog } from './log.js';
import { settings } from './settings.js';
import { getCharacterName, getChatId } from './pipeline/profile.js';
import { normKey, matchEntry } from './wardrobe.js';

// ── 确保当前 角色卡 × 聊天 的状态库存在 ──
export function ensureStatuses() {
    try {
        var charName = getCharacterName();
        if (!charName) return null;
        var chatId = getChatId();
        if (!settings.statuses) settings.statuses = {};
        if (!settings.statuses[charName]) settings.statuses[charName] = {};
        if (!settings.statuses[charName][chatId]) settings.statuses[charName][chatId] = {};
        return { charName: charName, chatId: chatId, list: settings.statuses[charName][chatId] };
    } catch (e) { return null; }
}

// ── 纯逻辑：往 list 里写（脱离 ST 上下文，可单测）──
// 已存在 → **不覆盖 detail**（只增不减，防每轮重措辞）；只有原来为空时才补上
export function upsertIntoList(list, key, detail) {
    if (!list || !key) return null;
    var k = String(key).trim();
    if (!k) return null;
    var d = String(detail || '').trim();
    var e = list[k];
    if (!e) {
        list[k] = { key: k, detail: d, active: true, since: 0, ts: Date.now() };
        return list[k];
    }
    if (!e.detail && d) { e.detail = d; e.ts = Date.now(); }
    return e;
}

// ── 纯逻辑：解析一批状态操作（脱离 ST 上下文，可单测）──
// ops: [{ op:'+'|'-', key }] → { resolved:[{op,key,detail}], pending:[{op,key}], off:[key] }
export function resolveOpsAgainstList(list, ops) {
    var resolved = [], pending = [], off = [];
    var allKeys = Object.keys(list || {});
    for (var i = 0; i < (ops || []).length; i++) {
        var o = ops[i] || {};
        var q = String(o.key || '').trim();
        if (!q) continue;
        if (o.op === '-') { off.push(q); continue; }
        var hit = matchEntry(allKeys, q);
        if (hit && list[hit.key] && list[hit.key].detail) {
            resolved.push({ op: '+', key: hit.key, query: q, detail: list[hit.key].detail, level: hit.level });
        } else {
            pending.push({ op: '+', key: q });
        }
    }
    return { resolved: resolved, pending: pending, off: off };
}

// ── 存档层：建档 / 更新（沿用纯逻辑）──
export function upsertStatus(key, detail) {
    try {
        var s = ensureStatuses();
        if (!s || !key) return null;
        var e = upsertIntoList(s.list, key, detail);
        if (e) slLog('状态建档: ' + e.key + (e.detail ? '，' + String(e.detail).slice(0, 30) + '…' : '（空）'));
        return e;
    } catch (e2) { slLog('状态写入异常: ' + e2.message); return null; }
}

// ── 激活 / 取消（主模型 +/- 触发）──
export function setStatusActive(key, active) {
    try {
        var s = ensureStatuses();
        if (!s || !key) return null;
        var k = String(key).trim();
        var e = s.list[k];
        if (!e) {
            // 容错：四级匹配找现有条目
            var hit = matchEntry(Object.keys(s.list), k);
            if (hit) e = s.list[hit.key];
        }
        if (!e) return null;
        var want = !!active;
        if (e.active === want) return e;
        e.active = want;
        if (want) { e.since = (typeof e.since === 'number' ? e.since : 0) || Date.now(); slLog('状态激活: ' + e.key); }
        else { slLog('状态取消: ' + e.key + '（条目保留，可再激活）'); }
        return e;
    } catch (e2) { return null; }
}

// ── 解析一批状态段 → { resolved, pending, off }（读当前库）──
export function resolveStatusOps(ops) {
    try {
        var s = ensureStatuses();
        if (!s) return { resolved: [], pending: [], off: [] };
        return resolveOpsAgainstList(s.list, ops);
    } catch (e) { return { resolved: [], pending: [], off: [] }; }
}

// ── 当前生效的状态（给提示词兜底 / 面板用）──
export function activeStatuses() {
    try {
        var s = ensureStatuses();
        if (!s) return [];
        var out = [];
        var ks = Object.keys(s.list);
        for (var i = 0; i < ks.length; i++) {
            var e = s.list[ks[i]];
            if (e && e.active && e.detail) out.push({ key: e.key, detail: e.detail, since: e.since || 0 });
        }
        return out;
    } catch (e) { return []; }
}

// ── 发给辅助 AI 的文本 ──
export function statusesDataTextFor(ops) {
    try {
        var r = resolveStatusOps(ops);
        var lines = [];
        if (r.resolved.length) {
            lines.push('✅ 已解析（库里已有，**逐字写进提示词，禁止改写**）：');
            for (var i = 0; i < r.resolved.length; i++) lines.push('   ' + r.resolved[i].query + ' → ' + r.resolved[i].detail);
        }
        if (r.pending.length) {
            lines.push('⚠️ 待具象化（库里没有，你负责补全并通过 ---STATUSES--- 回传）：');
            for (var j = 0; j < r.pending.length; j++) lines.push('   ' + r.pending[j].key);
        }
        if (r.off.length) lines.push('⛔ 取消（本轮起不再生效，不要写进提示词）：' + r.off.join('、'));
        // 库里还有多少在生效（供 AI 知道这个人现在身上带着什么）
        var act = activeStatuses();
        if (act.length) {
            lines.push('· 当前仍在生效的状态（**按景别决定写不写**，看不见就不写）：');
            for (var k = 0; k < act.length; k++) lines.push('   ' + act[k].key + ' → ' + act[k].detail);
        }
        return { text: lines.join('\n'), resolved: r.resolved, pending: r.pending, off: r.off };
    } catch (e) { return { text: '', resolved: [], pending: [], off: [] }; }
}

// ── 索引文本（注入协作卡）──
export function statusesIndexText() {
    try {
        var s = ensureStatuses();
        if (!s) return '';
        var ks = Object.keys(s.list);
        if (!ks.length) return '';
        var act = [], idle = [];
        for (var i = 0; i < ks.length; i++) {
            var e = s.list[ks[i]];
            if (e && e.active) act.push(e.key); else idle.push(e.key);
        }
        var lines = [];
        if (act.length) lines.push('  ✅ 生效中：' + act.join('、'));
        if (idle.length) lines.push('  ⏸ 已取消（可再次 + 激活）：' + idle.join('、'));
        return lines.join('\n');
    } catch (e) { return ''; }
}

export function clearStatusesChat(charName, chatId) {
    try {
        if (settings.statuses && settings.statuses[charName] && settings.statuses[charName][chatId]) {
            delete settings.statuses[charName][chatId];
        }
    } catch (e) {}
}
