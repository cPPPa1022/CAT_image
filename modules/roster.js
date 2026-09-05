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
// 人物档案优先级规则（导演/画师统一）：
//   - 插件扫描过该角色卡 → 用插件的档案（base=扫描锚点，权威，LLM 信息不覆盖身份维度）
//   - 没有扫描 → 用酒馆 AI 发过来的（live=占位符人物指导/正文描写，逐轮更新）
// 展现/发送时 = base + live 合成（身份维度来自扫描，衣着/状态等变化来自酒馆 AI）
export function composePersonAppearance(e) {
    var base = e.base || '', live = e.live || '';
    if (!live) return base || (e.appearance || '');
    if (!base) return live;
    if (live.indexOf(base) >= 0) return live;   // live 已包含 base → 只发 live
    if (base.indexOf(live) >= 0) return base;   // base 已包含 live → 只发 base
    return base + '，' + live;
}
export function upsertPerson(name, identity, appearance, source) {
    try {
        var r = ensureRoster();
        if (!r) return null;
        var key = personKey(name, identity);
        if (!key) return null;
        var existing = r.list[key];
        var isCast = source === 'cast';
        if (!existing) {
            // _updated=true（仅 LLM 来源）：协作卡索引下一轮显示 *更新*，主 LLM 确认"人物指导已入库"
            r.list[key] = {
                key: key, name: name, identity: identity || '',
                appearance: appearance || '',
                source: source || 'roster',
                fromCard: isCast,
                base: isCast ? (appearance || '') : '',
                live: isCast ? '' : (appearance || ''),
                _updated: !isCast
            };
            slLog('人物表建档: ' + key + (isCast ? '（角色卡档案）' : '（酒馆AI收集）') + (appearance ? '，' + appearance.slice(0, 20) + '…' : ''));
        } else {
            var newApp = String(appearance || '');
            var changed = false;
            if (isCast) {
                // 插件扫描档案 → 权威 base（扫描锚点优先，更详者胜），已有 live 不动
                if (existing.fromCard && existing.base) {
                    if (newApp && newApp.length > String(existing.base).length) {
                        existing.base = newApp;
                        changed = true;
                    }
                } else {
                    existing.base = newApp || existing.appearance || '';
                    // 旧条目迁移：此前"酒馆AI收集"的外观降级为 live（动态层），不当权威 base
                    if (existing.appearance && existing.appearance !== existing.base && existing.live == null) {
                        existing.live = existing.appearance;
                    }
                    changed = true;
                }
                existing.fromCard = true;
                existing.source = 'cast';
            } else {
                // 酒馆 AI 发来的 → live 逐轮覆盖（不碰 base）
                if (newApp) {
                    if (existing.live == null && !existing.fromCard) existing.live = existing.appearance || '';  // 旧条目迁移
                    existing.live = newApp;
                    changed = true;
                }
                existing.source = source || existing.source;
            }
            if (identity && !existing.identity) { existing.identity = identity; changed = true; }
            // 重组展示/发送内容 = 基础(扫描) + 动态(酒馆AI)
            existing.appearance = composePersonAppearance(existing);
            // 只有"酒馆AI发来的"更新才打 *更新* ACK；扫描库导入是后台动作，不打标
            if (changed && !isCast) existing._updated = true;
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
// 身份维度过滤器：档案只保留"脸部/身材/永久标记"（用户规则）——
// 发型/衣着/配饰/状态等可变维度由酒馆AI按轮次写（插件AI只做 档案+酒馆AI提示词 → 图片prompt）。
export function identityAnchorOnly(text) {
    if (!text) return '';
    var lines = String(text).split('\n');
    var keep = [];
    for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].trim();
        if (!ln) continue;
        if (/^(发型|衣着|配饰|状态|临时|服饰|发型与发色|衣着与配饰)/.test(ln)) continue;  // 可变维度 → 丢弃
        keep.push(ln);
    }
    return keep.join('\n').replace(/【[^】]+】/g, '').trim();
}

export function importFromCast(cast) {
    if (!cast) return 0;
    var n = 0;
    var mode = getActiveMode();
    for (var name in cast) {
        var c = cast[name];
        if (!c) continue;
        var label = (c.label || '').trim();
        var appearance = '';
        if (mode === 'anime' && c.enPrompt) appearance = c.enPrompt;      // 英文锚点为整体描述，暂不拆维度
        else if (mode === 'anime_tag' && c.enTags) appearance = c.enTags;
        else appearance = identityAnchorOnly(c.static || '');             // 中文：只保留脸/身形/永久标记
        if (c.body && appearance && !/身形/.test(appearance)) appearance += '；身形：' + c.body;
        if (!appearance) continue;
        // 用户规则：人物表 key = 名字（身份标签）；同名不同身份标签 = 各存各条
        //（两个柳如烟都发给插件AI，由其按占位符里的标签+场景自决）；同 key 由 upsert 做"更长者胜"。
        upsertPerson(name, label, appearance, 'cast');
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

// ── 清档同步：删掉"角色卡扫描"来源的 base（保留酒馆AI收集的 live） ──
// 用户删除角色卡档案后，人物表不再持有过期的扫描锚点；若之后重新扫描会自动按规则重建 base。
export function dropCastBases(charName, chatId) {
    try {
        var chat = settings.roster && settings.roster[charName] && settings.roster[charName][chatId];
        if (!chat) return 0;
        var n = 0;
        for (var k in chat) {
            var e = chat[k];
            if (e && e.fromCard) {
                e.fromCard = false;
                e.base = '';
                e.appearance = e.live || '';
                n++;
            }
        }
        if (n) { saveSettings(); try { refreshCoopCards(); } catch (e2) {} }
        return n;
    } catch (e) { return 0; }
}
export function clearRosterChat(charName, chatId) {
    try {
        if (settings.roster && settings.roster[charName] && settings.roster[charName][chatId]) {
            delete settings.roster[charName][chatId];
            saveSettings();
            try { refreshCoopCards(); } catch (e2) {}
        }
    } catch (e) {}
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
