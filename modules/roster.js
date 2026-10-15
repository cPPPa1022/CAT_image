// ── SillyImage Lab v2.4 人物表（简化档案：不分静态/动态） ──
// 酒馆AI模式专用：主LLM通过占位符 [img:…|人物:名字（身份），外貌|…] 提供建档信息，
// 插件直接存人物表；提示词由插件AI按人物表外貌+占位符要点补全。
// key = 名字（身份标签）→ 重名天然区分（同名不同人）。

import { slLog } from './log.js';
import { settings, saveSettings, getSTContext, getActiveMode } from './settings.js';
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
        // v1.3：主模型在占位符里写的「静态锚点」也进 base（来源 'anchor'）
        // 优先级（高者永不被低者覆盖）：expanded(辅助AI具象化) > cast(角色卡扫描) > anchor(主模型原文)
        var isAnchor = source === 'anchor';
        var writesBase = isCast || isAnchor;
        var newSrc = isCast ? 'cast' : (isAnchor ? 'anchor' : '');
        var BASE_RANK = { expanded: 3, cast: 2, anchor: 1, '': 0 };
        // [Fix] 同人识别：精确 key 不存在时按名字找同名条目（同一人不同 key 形式：
        // "温若兰" vs "温若兰（邻家人妻）"）——单条→合并；多条→按新来标签精确匹配；仍无→才新建
        if (!existing) {
            var _sameName = [];
            for (var _sk in r.list) {
                if (_sk === name || _sk.indexOf(name + '（') === 0) _sameName.push(r.list[_sk]);
            }
            if (_sameName.length === 1) {
                // [Fix] 仅"至少一侧无标签"才合并（同一人不同 key 形式：裸名↔带标签）；
                // 双方都有非空标签且不同 → 视为同名不同人，各存各条（用户规则：两个柳如烟）
                var _cand = _sameName[0];
                if (!identity || !_cand.identity) existing = _cand;
            } else if (_sameName.length > 1 && identity) {
                for (var _mi = 0; _mi < _sameName.length; _mi++) {
                    if (_sameName[_mi] && String(_sameName[_mi].identity || '') === String(identity)) { existing = _sameName[_mi]; break; }
                }
            } else if (_sameName.length > 1 && !identity) {
                // 同名多条且未指定标签：无法安全合并（避免把 A 的信息并给 B），跳过并告警
                slLog('同名多条且人物段未带标签，跳过更新（避免合并错人）: ' + name + '（共' + _sameName.length + '条，建议人物段带身份标签）');
                try { refreshCoopCards(); } catch (e5) {}
                return null;
            }
        }
        if (!existing) {
            // _updated=true（仅 LLM 来源）：协作卡索引下一轮显示 *更新*，主 LLM 确认"人物指导已入库"
            r.list[key] = {
                key: key, name: name, identity: identity || '',
                appearance: appearance || '',
                source: source || 'roster',
                fromCard: writesBase,
                baseSrc: writesBase ? newSrc : '',
                base: writesBase ? (appearance || '') : '',
                live: writesBase ? '' : (appearance || ''),
                _updated: !writesBase
            };
            slLog('人物表建档: ' + key + (isCast ? '（角色卡扫描）' : isAnchor ? '（主模型锚点）' : '（酒馆AI收集）') + (appearance ? '，' + appearance.slice(0, 20) + '…' : ''));
        } else {
            var newApp = String(appearance || '');
            var changed = false;
            if (writesBase) {
                // 静态锚点 → 权威 base。来源优先级：expanded > cast > anchor，同级才比长度（防写短退化）
                var curSrc = existing.baseSrc || (existing.fromCard ? 'cast' : '');
                var curRank = BASE_RANK[curSrc] || 0, newRank = BASE_RANK[newSrc] || 0;
                var took = false;
                if (newRank > curRank) {
                    // 更高优先级来源：接管 base（原有 appearance 若有内容降级为 live）
                    if (existing.live == null && existing.appearance && !existing.base) existing.live = existing.appearance;
                    existing.base = newApp || existing.base || '';
                    existing.baseSrc = newSrc;
                    took = true;
                } else if (newRank === curRank) {
                    if (newApp && newApp.length > String(existing.base || '').length) { existing.base = newApp; took = true; }
                }
                if (took) {
                    if (existing.appearance && existing.appearance !== existing.base && existing.live == null) existing.live = existing.appearance;
                    changed = true;
                    existing.source = newSrc;
                }
                existing.fromCard = true;
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
        return existing || r.list[key];
    } catch (e) { slLog('人物表upsert异常: ' + e.message); return null; }
}

// ── 批量应用占位符人物段 ──
// v1.3：占位符人物段里的 appearance = 静态锚点（照抄角色卡）→ 默认写入 base（source='anchor'）
export function applyPersonSegments(segments, source) {
    var n = 0;
    if (!segments || !segments.length) return n;
    var src = source || 'anchor';
    for (var i = 0; i < segments.length; i++) {
        var s = segments[i];
        if (!s || !s.name) continue;
        upsertPerson(s.name, s.identity, s.appearance, src);
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
        // anima 混合模式：结构用标签，所以优先 enTags；没有则退回 enPrompt
        if (mode === 'anima' && (c.enTags || c.enPrompt)) appearance = c.enTags || c.enPrompt;
        else if (mode === 'anime' && c.enPrompt) appearance = c.enPrompt;   // 英文锚点为整体描述，暂不拆维度
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

// ══════════════════════════════
// ── 已解析锚点（v1.6.2 · 和造型库同构）──
// 问题：档案 base 里是【主模型写的中文锚点】，英文三模式每轮都要重新翻译 → 每轮措辞可能不同 → 长相漂移。
// 做法：辅助 AI 第一次具象化产出的「模型语言锚点」按【模式】存进这个人，
//       之后每轮以「✅ 已解析锚点（逐字复用）」下发，不再重译。
// 写入规则：首次写入即冻结；之后只接受「包含旧文且更长」的版本（= 追加缺失维度，而不是重写措辞）。
export function getAtomAnchor(entry, mode) {
    try {
        if (!entry || !entry.atoms) return '';
        var m = mode || getActiveMode();
        return entry.atoms[m] || '';
    } catch (e) { return ''; }
}

export function setAtomAnchor(name, identity, mode, text) {
    try {
        var t = String(text || '').trim();
        if (!t) return null;
        var r = ensureRoster();
        if (!r) return null;
        var key = personKey(name, identity);
        var e = r.list[key];
        if (!e) {   // 容错：按名字找同名条目（裸名 ↔ 带标签）
            for (var sk in r.list) { if (sk === name || sk.indexOf(name + '（') === 0) { e = r.list[sk]; break; } }
        }
        if (!e) return null;
        var m = mode || getActiveMode();
        if (!e.atoms) e.atoms = {};
        var old = e.atoms[m] || '';
        if (!old) {
            e.atoms[m] = t;
            slLog('锚点建档[' + m + ']: ' + e.key + '，' + t.slice(0, 40) + '…');
        } else if (t.length > old.length && t.indexOf(old) >= 0) {
            e.atoms[m] = t;   // 只在"旧文是新文的一部分"时才更新（追加维度，不是换措辞）
            slLog('锚点追加[' + m + ']: ' + e.key);
        } else {
            slLog('锚点回传被忽略（旧文已冻结，防重写）: ' + e.key);
        }
        return e.atoms[m];
    } catch (e2) { return null; }
}

// ── 人物表正文（按名字过滤，不再全量发送） ──
// 酒馆AI 只在占位符人物段注明"图里出现了谁"（名字即可）；插件按名字匹配：
// 档案里有几个同名（不同身份标签）就发几个，由画师按场景自选。
export function rosterDataTextFor(nameList) {
    try {
        var r = ensureRoster();
        if (!r || !nameList || !nameList.length) return '';
        var keys = Object.keys(r.list);
        var lines = [];
        var seen = {};
        for (var i = 0; i < nameList.length; i++) {
            var nm = String(nameList[i] || '').trim();
            if (!nm) continue;
            var nmCount = 0;
            var nmLabels = [];
            var nmLines = [];
            for (var j = 0; j < keys.length; j++) {
                var k = keys[j];
                if (seen[k]) continue;
                if (k === nm || k.indexOf(nm + '（') === 0) {
                    var e = r.list[k];
                    var _atom = getAtomAnchor(e);
                    if (_atom) {
                        // 已有模型语言锚点 → 逐字复用（零漂移）；同时给出主模型原文供"补全缺失维度"对照
                        nmLines.push('■ ' + e.key);
                        nmLines.push('   ✅ 已解析锚点【' + getActiveMode() + '】（**逐字写进提示词，禁止改写、禁止同义替换**）：' + _atom);
                        nmLines.push('   ⚠️ 原始锚点（主模型原文，**只用于对照是否缺维度，不要照抄**）：' + (e.base || e.appearance || '').slice(0, 200));
                    } else {
                        nmLines.push('■ ' + e.key + '：' + (e.appearance || '（仅有名字，无外貌信息）'));
                    }
                    nmCount++;
                    if (e.identity) nmLabels.push(e.identity);
                    seen[k] = true;
                }
            }
            // [Fix] 同名提醒：多重档案让画师明确"这是同一名字的不同身份，按本轮场景/要点选用"，防止误当重复
            if (nmCount > 1) {
                for (var q = 0; q < nmLines.length; q++) lines.push(nmLines[q]);
                lines.push('（同名提醒：名字"' + nm + '"档案共 ' + nmCount + ' 份（' + nmLabels.join('/') + '）——请按本轮【占位符】场景/要点选用正确的一位，其余忽略）');
            } else {
                for (var q2 = 0; q2 < nmLines.length; q2++) lines.push(nmLines[q2]);
            }
        }
        return lines.join('\n');
    } catch (e) { return ''; }
}

// ── 人物表正文旧接口（全量；保留兼容，管线改用上面的过滤版） ──
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

// ── 已知人名拆段（多人解析） ──
// 酒馆AI 可能写"人物:柳如烟，赵云飞"（逗号分隔多人）：解析器会把"赵云飞"误当柳如烟外貌。
// 用已知人名集（人物表+卡库）判断：外貌块中被逗号/分号切出的已知人名 → 拆为独立人物段。
// 返回修正后的 segments（原对象不改，新建）。
export function splitKnownPersonSegments(segments, knownNames) {
    if (!segments || !segments.length) return segments || [];
    var names = {};
    for (var i = 0; i < (knownNames || []).length; i++) {
        var nm = String(knownNames[i] || '').trim();
        if (nm.length >= 2) names[nm] = true;
    }
    var out = [];
    for (var j = 0; j < segments.length; j++) {
        var s = segments[j];
        if (!s || !s.name) { if (s) out.push(s); continue; }
        if (!s.appearance || !names[s.name]) { out.push(s); continue; }
        var parts = String(s.appearance).split(/[，,；;]/);
        var keepApp = [];
        var extra = [];
        for (var k = 0; k < parts.length; k++) {
            var p = (parts[k] || '').trim();
            if (!p) continue;
            if (names[p] && p !== s.name) extra.push({ name: p, identity: '', appearance: '' });
            else keepApp.push(p);
        }
        if (extra.length) {
            var ns = { name: s.name, identity: s.identity || '', appearance: keepApp.join('，') };
            out.push(ns);
            for (var e = 0; e < extra.length; e++) out.push(extra[e]);
        } else {
            out.push(s);
        }
    }
    return out;
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
