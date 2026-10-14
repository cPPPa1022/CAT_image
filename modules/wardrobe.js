// ── SillyImage Lab 造型库（v1.5.0）──
// 作用：服装/发型/鞋袜/配饰/妆容 —— 主模型写 key，插件具象化一次并存档，之后原样复用。
// 为什么需要：这些维度原先写在【要点】里，是自由文本，辅助AI 每轮都可能换一种说法 →
//             同一件衣服画出两个样。存档后每轮原样复用即可消除漂移。
//
// 存档位置：settings.wardrobe[角色卡名][聊天ID][key] = { key, slot, detail, src, ts }
// 作用域：**按聊天**（用户选择：换一场聊天衣柜清零）
//
// 本模块分两层：
//   · 纯逻辑（可脱离浏览器单测）：normKey / parseStyleSegment / matchEntry / 槽名表
//   · 存档层（需要 ST 上下文）：ensureWardrobe / upsertEntry / resolveSlots / 索引文本

import { slLog } from './log.js';
import { settings } from './settings.js';
import { getCharacterName, getChatId } from './pipeline/profile.js';
// 槽位表与造型段解析放在 text-utils（零依赖、可直接单测），这里复用
import { WARDROBE_SLOTS, normalizeSlot, parseStyleSegment } from './text-utils.js';
export { WARDROBE_SLOTS, normalizeSlot, parseStyleSegment };

// ── key 归一化（用于模糊匹配）──
export function normKey(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[\s·・\/\\|｜\-—_~～]+/g, '')
        .replace(/[（）()【】\[\]「」『』""''《》<>]/g, '')
        .replace(/[的着了过]/g, '')
        .trim();
}

// ── 四级匹配 ──
// ① exact  完全相等
// ② norm   归一化后相等（去标点/空格/的）
// ③ charset 字符集包含（query 的每个字都出现在候选里，允许乱序）——覆盖「夏季校服」↔「XX中学·校服（夏季）」
// 返回 { key, level } 或 null
export function matchEntry(allKeys, query) {
    if (!query) return null;
    var q = String(query).trim();
    // ①
    for (var i = 0; i < allKeys.length; i++) if (allKeys[i] === q) return { key: allKeys[i], level: 'exact' };
    // ②
    var nq = normKey(q);
    if (!nq) return null;
    for (var j = 0; j < allKeys.length; j++) if (normKey(allKeys[j]) === nq) return { key: allKeys[j], level: 'norm' };
    // ③
    if (nq.length < 2) return null;
    var best = null, bestDiff = Infinity;
    for (var k = 0; k < allKeys.length; k++) {
        var nk = normKey(allKeys[k]);
        if (nk.length < nq.length) continue;
        var hit = true;
        for (var c = 0; c < nq.length; c++) {
            if (nk.indexOf(nq.charAt(c)) < 0) { hit = false; break; }
        }
        if (hit) {
            var diff = nk.length - nq.length;
            if (diff < bestDiff) { bestDiff = diff; best = allKeys[k]; }
        }
    }
    if (best) return { key: best, level: 'charset' };
    return null;
}

// ══════════════════════════════
// ── 存档层 ──

// 确保当前 角色卡 × 聊天 的造型库存在
export function ensureWardrobe() {
    try {
        var charName = getCharacterName();
        if (!charName) return null;
        var chatId = getChatId();
        if (!settings.wardrobe) settings.wardrobe = {};
        if (!settings.wardrobe[charName]) settings.wardrobe[charName] = {};
        if (!settings.wardrobe[charName][chatId]) settings.wardrobe[charName][chatId] = {};
        return { charName: charName, chatId: chatId, list: settings.wardrobe[charName][chatId] };
    } catch (e) { return null; }
}

// 来源优先级：expanded(辅助AI具象化) > anchor(主模型原文)
var SRC_RANK = { expanded: 2, anchor: 1, '': 0 };

// ── 纯逻辑：往一个 list 里写（脱离 ST 上下文，可单测）──
export function upsertIntoList(list, slot, key, detail, src) {
    if (!list || !key) return null;
    var k = String(key).trim();
    if (!k) return null;
    var s = String(src || 'anchor');
    var existing = list[k];
    if (!existing) {
        list[k] = { key: k, slot: slot, detail: String(detail || ''), src: s, ts: Date.now() };
        return list[k];
    }
    var curRank = SRC_RANK[existing.src] || 0, newRank = SRC_RANK[s] || 0;
    var newD = String(detail || '');
    var took = false;
    if (newRank > curRank) { existing.detail = newD || existing.detail; existing.src = s; took = true; }
    else if (newRank === curRank && newD && newD.length > String(existing.detail || '').length) { existing.detail = newD; took = true; }
    if (!existing.slot) existing.slot = slot;
    if (took) existing.ts = Date.now();
    return existing;
}

// ── 纯逻辑：按 list 解析（脱离 ST 上下文，可单测）──
export function resolveAgainstList(list, styleGroups) {
    var resolved = [], pending = [];
    var allKeys = Object.keys(list || {});
    for (var i = 0; i < styleGroups.length; i++) {
        var g = styleGroups[i];
        for (var j = 0; j < g.keys.length; j++) {
            var q = g.keys[j];
            var hit = matchEntry(allKeys, q);
            if (hit && list[hit.key] && list[hit.key].detail) {
                resolved.push({ slot: g.slot, query: q, key: hit.key, detail: list[hit.key].detail, level: hit.level });
            } else {
                pending.push({ slot: g.slot, key: q });
            }
        }
    }
    return { resolved: resolved, pending: pending };
}

// 写入/更新一条（同级才比长度，高优先级不被低优先级覆盖）
export function upsertEntry(slot, key, detail, src) {
    try {
        var w = ensureWardrobe();
        if (!w || !key) return null;
        var k = String(key).trim();
        if (!k) return null;
        var s = String(src || 'anchor');
        var existing = w.list[k];
        if (!existing) {
            w.list[k] = { key: k, slot: slot, detail: String(detail || ''), src: s, ts: Date.now() };
            slLog('造型建档[' + slot + ']: ' + k + (detail ? '，' + String(detail).slice(0, 24) + '…' : '（空）'));
            return w.list[k];
        }
        var curRank = SRC_RANK[existing.src] || 0, newRank = SRC_RANK[s] || 0;
        var newD = String(detail || '');
        var took = false;
        if (newRank > curRank) { existing.detail = newD || existing.detail; existing.src = s; took = true; }
        else if (newRank === curRank && newD && newD.length > String(existing.detail || '').length) { existing.detail = newD; took = true; }
        if (!existing.slot) existing.slot = slot;
        if (took) { existing.ts = Date.now(); slLog('造型更新[' + slot + ']: ' + k); }
        return existing;
    } catch (e) { slLog('造型写入异常: ' + e.message); return null; }
}

// 解析一批造型段 → { resolved:[{slot,key,detail,level}], pending:[{slot,key}], unmatched:[] }
export function resolveSlots(styleGroups) {
    try {
        var w = ensureWardrobe();
        if (!w) return { resolved: [], pending: [] };
        return resolveAgainstList(w.list, styleGroups);
    } catch (e) { slLog('造型解析异常: ' + e.message); return { resolved: [], pending: [] }; }
}

// 索引文本（注入协作卡）：按槽分组列出已有 key
export function wardrobeIndexText() {
    try {
        var w = ensureWardrobe();
        if (!w) return '';
        var keys = Object.keys(w.list);
        if (!keys.length) return '';
        var bySlot = {};
        for (var i = 0; i < keys.length; i++) {
            var e = w.list[keys[i]];
            var s = e.slot || '其他';
            if (!bySlot[s]) bySlot[s] = [];
            bySlot[s].push(e.key);
        }
        var lines = [];
        for (var s2 = 0; s2 < WARDROBE_SLOTS.length; s2++) {
            var name = WARDROBE_SLOTS[s2];
            if (bySlot[name] && bySlot[name].length) lines.push('  ' + name + '：' + bySlot[name].join('、'));
        }
        return lines.join('\n');
    } catch (e) { return ''; }
}

// 造型文本（发给辅助AI）：已解析的给详情，未命中的给待办
export function wardrobeDataTextFor(styleGroups) {
    try {
        var r = resolveSlots(styleGroups);
        var lines = [];
        if (r.resolved.length) {
            lines.push('✅ 已解析（库里已有，**逐字写进提示词，禁止改写**）：');
            for (var i = 0; i < r.resolved.length; i++) {
                var it = r.resolved[i];
                lines.push('   [' + it.slot + '] ' + it.key + ' → ' + it.detail);
            }
        }
        if (r.pending.length) {
            lines.push('⚠️ 待具象化（库里没有，你负责补全并回传 ---WARDROBE---）：');
            for (var j = 0; j < r.pending.length; j++) lines.push('   [' + r.pending[j].slot + '] ' + r.pending[j].key);
        }
        return { text: lines.join('\n'), resolved: r.resolved, pending: r.pending };
    } catch (e) { return { text: '', resolved: [], pending: [] }; }
}

export function clearWardrobeChat(charName, chatId) {
    try {
        if (settings.wardrobe && settings.wardrobe[charName] && settings.wardrobe[charName][chatId]) {
            delete settings.wardrobe[charName][chatId];
        }
    } catch (e) {}
}
