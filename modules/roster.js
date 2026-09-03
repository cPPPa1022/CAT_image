// ── SillyImage Lab v2.4 人物表（简化档案：不分静态/动态） ──
// 酒馆AI模式专用：主LLM通过占位符 [img:…|人物:名字（身份），外貌|…] 提供建档信息，
// 插件直接存人物表；提示词由插件AI按人物表外貌+占位符要点补全。
// key = 名字（身份标签）→ 重名天然区分（同名不同人）。

import { slLog } from './log.js';
import { settings, saveSettings, getSTContext } from './settings.js';
import { getCharacterName, getChatId } from './pipeline/profile.js';
import { refreshCoopCards } from './sync-cards.js';  // [Fix] 人物表变化时刷新导演模式协作卡索引

// ── key 归一化 ──
export function personKey(name, identity) {
    name = String(name || '').trim();
    identity = String(identity || '').trim();
    if (!name) return '';
    return identity ? name + '（' + identity + '）' : name;
}

// ── 确保当前角色+会话的人物表存在，返回 {charName, chatId, list} ──
export function ensureRoster() {
    var charName = getCharacterName();
    if (!charName) return null;
    var chatId = getChatId();
    if (!settings.roster) settings.roster = {};
    if (!settings.roster[charName]) settings.roster[charName] = {};
    if (!settings.roster[charName][chatId]) settings.roster[charName][chatId] = {};
    return { charName: charName, chatId: chatId, list: settings.roster[charName][chatId] };
}

// ── 是否有该人物 ──
export function hasPerson(name, identity) {
    try {
        var r = ensureRoster();
        if (!r) return false;
        var key = personKey(name, identity);
        if (key && r.list[key]) return true;
        // 无 identity 时按名字模糊匹配（容忍主LLM没写标签）
        if (!identity) {
            for (var k in r.list) {
                if (k === name || k.indexOf(name + '（') === 0) return true;
            }
        }
        return false;
    } catch (e) { return false; }
}

// ── 查找人物外貌（用于提示词填充/校验） ──
export function findAppearance(name, identity) {
    try {
        var r = ensureRoster();
        if (!r) return '';
        var key = personKey(name, identity);
        if (key && r.list[key]) return r.list[key].appearance || '';
        if (!identity) {
            for (var k in r.list) {
                if (k === name || k.indexOf(name + '（') === 0) return r.list[k].appearance || '';
            }
        }
        return '';
    } catch (e) { return ''; }
}

// ── 建档/更新（appearance 取更长版本，防覆盖丢失） ──
export function upsertPerson(name, identity, appearance, source) {
    try {
        var r = ensureRoster();
        if (!r) return null;
        var key = personKey(name, identity);
        if (!key) return null;
        var existing = r.list[key];
        if (!existing) {
            // [Fix] _updated=true：协作卡索引会在下一轮显示 *更新* 标记（一次），
            // 主 LLM 据此确认"人物指导已入库"，之后不再重复写外貌。
            r.list[key] = { key: key, name: name, identity: identity || '', appearance: appearance || '', source: source || 'roster', _updated: true };
            slLog('人物表建档: ' + key + (appearance ? '（' + appearance.slice(0, 20) + '…）' : ''));
        } else {
            var newApp = String(appearance || '');
            var changed = false;
            if (newApp && newApp.length > String(existing.appearance || '').length) {
                existing.appearance = newApp;
                changed = true;
                slLog('人物表更新(更详版): ' + key);
            }
            if (identity && !existing.identity) { existing.identity = identity; changed = true; }
            existing.source = source || existing.source;
            // 只在内容真变化时打标，避免没变也显示 *更新*
            if (changed) existing._updated = true;
        }
        try { refreshCoopCards(); } catch (e2) { /* 协作卡刷新失败不影响建档 */ }
        return r.list[key];
    } catch (e) { slLog('人物表upsert异常: ' + e.message); return null; }
}

// ── 批量应用占位符人物段 ──
export function applyPersonSegments(segments) {
    var n = 0;
    if (!segments || !segments.length) return n;
    for (var i = 0; i < segments.length; i++) {
        var s = segments[i];
        if (!s || !s.name) continue;
        upsertPerson(s.name, s.identity, s.appearance, 'placeholder');
        n++;
    }
    return n;
}

// ── 索引文本（注入协作卡用） ──
export function rosterIndexText(limit) {
    try {
        var r = ensureRoster();
        if (!r) return [];
        var keys = Object.keys(r.list);
        var out = [];
        for (var i = 0; i < keys.length; i++) {
            out.push(r.list[keys[i]].key);
            if (limit && out.length >= limit) break;
        }
        return out;
    } catch (e) { return []; }
}

// ── 从卡库扫描档案导入人物表（复用 scanCharacterProfile 产出，保证人物一致性） ──
// cast: { 角色名: { static, body, enPrompt, enTags, ... } }
// mode: 'zit' | 'anime' | 'anime_tag' → 选对应语言锚点
// 返回值：导入/更新条数
import { getActiveMode } from './settings.js';
export function importFromCast(cast) {
    if (!cast) return 0;
    var n = 0;
    var mode = getActiveMode();
    for (var name in cast) {
        var c = cast[name];
        if (!c) continue;
        var appearance = '';
        if (mode === 'anime' && c.enPrompt) appearance = c.enPrompt;
        else if (mode === 'anime_tag' && c.enTags) appearance = c.enTags;
        else appearance = c.static || '';
        if (c.body && appearance && !/身形/.test(appearance)) appearance += '；身形：' + c.body;
        if (!appearance) continue;
        // [Fix] 与占位符/身份标签条目去重：人物表里已有同名（含"名字（身份）"key）条目时
        // 走"更长者胜"更新，不再新建无身份的重复条目（导演模式扫描后同一人会出现两条档案）。
        var existingEntry = null;
        try {
            var r0 = ensureRoster();
            if (r0) {
                for (var k0 in r0.list) {
                    if (k0 === name || k0.indexOf(name + '（') === 0) { existingEntry = r0.list[k0]; break; }
                }
            }
        } catch (e4) { existingEntry = null; }
        if (existingEntry) {
            if (String(appearance).length > String(existingEntry.appearance || '').length) {
                existingEntry.appearance = appearance;
                existingEntry._updated = true;
                slLog('人物表更新(卡库更详): ' + existingEntry.key);
            }
            n++;
            continue;
        }
        upsertPerson(name, '', appearance, 'cast');
        n++;
    }
    return n;
}

// ── 人物表正文（发给插件AI用；每行 名字（身份）：外貌） ──
export function rosterDataText() {
    try {
        var r = ensureRoster();
        if (!r) return '';
        var keys = Object.keys(r.list);
        if (!keys.length) return '';
        var lines = [];
        for (var i = 0; i < keys.length; i++) {
            var e = r.list[keys[i]];
            lines.push('■ ' + e.key + '：' + (e.appearance || '（仅有名字，无外貌信息）'));
        }
        return lines.join('\n');
    } catch (e) { return ''; }
}

// ── 人物表全部条目（供管线判断已建档） ──
export function rosterEntries() {
    try {
        var r = ensureRoster();
        if (!r) return [];
        var keys = Object.keys(r.list);
        var out = [];
        for (var i = 0; i < keys.length; i++) out.push(r.list[keys[i]]);
        return out;
    } catch (e) { return []; }
}
