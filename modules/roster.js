// ── SillyImage Lab v2.4 人物表（简化档案：不分静态/动态） ──
// 酒馆AI模式专用：主LLM通过占位符 [img:…|人物:名字（身份），外貌|…] 提供建档信息，
// 插件直接存人物表；提示词由插件AI按人物表外貌+占位符要点补全。
// key = 名字（身份标签）→ 重名天然区分（同名不同人）。

import { slLog } from './log.js';
import { settings, saveSettings, getSTContext, getActiveMode } from './settings.js';
import { getCharacterName, getChatId } from './pipeline/profile.js';
import { refreshCoopCards } from './sync-cards.js';  // [Fix] 人物表变化时刷新导演模式协作卡索引
import { stripSeedText, parseSeedSegment, formatSeed, hasSeedField, findLostNumbers } from './text-utils.js';  // v1.11.1 种子剥离（+ v1.13.6 数字保真）

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
export function upsertPerson(name, identity, appearance, source, seed) {
    try {
        var r = ensureRoster();
        if (!r) return null;
        var key = personKey(name, identity);
        if (!key) return null;
        // [Fix v1.11.1] 种子不是外貌：从 appearance 里剥出来单独存（entry.seed）
        // 留在 base 里会被当成"静态锚点"喂给辅助AI、还会被动态要素兜底抄进提示词
        var _seedRaw = String(seed || '').trim();
        try {
            if (!_seedRaw && appearance && hasSeedField(appearance)) _seedRaw = formatSeed(parseSeedSegment(appearance));
            if (appearance && hasSeedField(appearance)) appearance = stripSeedText(appearance);
        } catch (eSeed) {}
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
                // [Fix v1.11] 身份标签变了 ≠ 换了一个人，但也 ≠ 一定是同一人 —— 要分两种情况：
                //   ① 剧情里她改嫁/被赎身/升职/落难 → 标签变了但**外貌还是同一套** → 合并（否则新建空条目 → 重新捏脸 = OOC）
                //   ② 真·同名不同人（柳如烟（千金小姐）/ 柳如烟（青楼妓女））→ 标签不同且**外貌也不同** → 各存各条
                // 判据 = 新旧外貌文本的 Dice 相似度（≥0.75 → 同一人换身份）
                var _cand = _sameName[0];
                if (!identity || !_cand.identity) {
                    existing = _cand;
                } else if (String(_cand.identity) !== String(identity)) {
                    var _sim = _appearanceSimilarity(appearance, _cand.base || _cand.appearance || '');
                    if (_sim >= 0.75) {
                        if (!_cand.aliases) _cand.aliases = [];
                        if (_cand.aliases.indexOf(identity) < 0) _cand.aliases.push(identity);
                        slLog('🔒 身份标签变化（外貌相似度 ' + _sim.toFixed(2) + '）→ 判定同一人换身份，合并不新建: '
                            + _cand.key + ' ← 新标签「' + identity + '」记为别名');
                        existing = _cand;
                    } else {
                        slLog('同名但标签与外貌都不同（相似度 ' + _sim.toFixed(2) + '）→ 视为另一个同名人物，新建: ' + key);
                    }
                } else {
                    existing = _cand;
                }
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
                seed: _seedRaw || '',
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
            // 种子是"方向"不是"锚点"：后写的覆盖前面的（不参与冻结，也不影响长相）
            if (_seedRaw && _seedRaw !== existing.seed) { existing.seed = _seedRaw; changed = true; }
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
        var _sd = '';
        try {
            if (s.seedObj && Object.keys(s.seedObj).length) _sd = formatSeed(s.seedObj);
            else if (s.seed) _sd = String(s.seed);
        } catch (eS) {}
        upsertPerson(s.name, s.identity, s.appearance, src, _sd);
        n++;
    }
    return n;
}

// ── v1.11.2：主模型漏了哪些外貌维度 ──
// 主模型只写体型时（例如"娇小，平胸，细腰"），辅助AI 会静默按"通用亚洲脸"先验补齐 →
// 卡里写「雪白发/灰白瞳」的角色被画成「深棕发/深棕瞳」。这里把"缺哪些"明确告诉辅助AI。
function _missingFaceDims(t) {
    var s = String(t || '');
    var miss = [];
    if (!/发|辫|髻|寸头|刘海|马尾|束发|盘发|短发|长发/.test(s)) miss.push('发色/发型');
    if (!/脸型|瓜子脸|鹅蛋脸|方脸|圆脸|长脸|心形脸|棱角脸|V脸|小V/.test(s)) miss.push('脸型');
    if (!/瞳/.test(s)) miss.push('瞳色');
    if (!/肤|白化|苍白|白皙|冷白|暖白|雪白|古铜|蜜色|偏黄|薄透|哑光|通透|小麦|油亮/.test(s)) miss.push('肤色');
    return miss;
}

// ── 外貌文本相似度（Dice 2-gram）—— 用于区分"同一人换身份" vs "真·同名不同人" ──
function _appearanceSimilarity(a, b) {
    try {
        var grams = function (t) {
            t = String(t || '').replace(/[\s，,。；;：:、｜|/=]/g, '');
            var s = {};
            for (var i = 0; i + 1 < t.length; i++) s[t.substr(i, 2)] = 1;
            return s;
        };
        var A = grams(a), B = grams(b);
        var na = 0, nb = 0, hit = 0, k;
        for (k in A) { na++; if (B[k]) hit++; }
        for (k in B) nb++;
        if (!na || !nb) return 0;
        return (2 * hit) / (na + nb);
    } catch (e) { return 0; }
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
// ── 锚点库 v2.0 · 英文权威，四种模式共用一份 ──
// 演进：
//   v1.6.2 之前 —— 英文三模式每轮重新翻译主模型的中文锚点 → 措辞漂移（同一特征四种写法）。
//   v1.6.2 做法 —— 按【模式】各存一份"该模式语言"的锚点。但 anima 的锚点规范没写清楚，
//                  辅助AI 照 PROFILE 示例存成了中文 → 立绘走 cleanAnimePrompt 时被整段删空 →
//                  只剩框架词 → 画出与角色无关的路人（2026-10-17 实测 8/8 全废）。
//   v2.0 做法 —— 锚点**只有一套、只写英文**（`维度:值 | …`，维度名与值全 ASCII）：
//      · entry.anchor    = 英文权威锚点（唯一来源，anima / anime / anime_tag / zit 共用）
//      · entry.atoms.zit = 中文呈现缓存（zit 中文模式逐字复用；辅助AI 在 zit 模式回传 anchor_zh）
//      英文三模式一律读 entry.anchor，**绝不读中文**（读了就会被 cleanAnimePrompt 删空 = 低级失误）。
// 写入闸门：英文 → entry.anchor；中文 → 只允许进 atoms.zit 且模式必须是 zit；
//          其余（英文模式收到中文锚点）一律拒绝并记日志。
// 写入规则：首次写入即冻结；之后只接受「包含旧文且更长」的版本（= 追加缺失维度，而不是重写措辞）。
var CJK_RE = /[\u2e80-\u2eff\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
// 是否"可安全进英文提示词"的锚点：不含任何中日韩字符/全角标点，且有英文字母
export function isEnglishAnchor(text) {
    var t = String(text || '');
    if (!t.trim()) return false;
    if (CJK_RE.test(t)) return false;
    return /[A-Za-z]/.test(t);
}
// 旧存档兼容：v2.0 之前按模式分桶存过锚点，挑第一个英文的当权威锚点（只读，不回写）
function _legacyEnglishAtoms(e) {
    try {
        if (!e || !e.atoms) return '';
        for (var m in e.atoms) { if (isEnglishAnchor(e.atoms[m])) return e.atoms[m]; }
    } catch (e2) {}
    return '';
}
export function getEnglishAnchor(entry) {
    try {
        if (!entry) return '';
        if (isEnglishAnchor(entry.anchor)) return entry.anchor;
        return _legacyEnglishAtoms(entry);
    } catch (e) { return ''; }
}
// 该模式下"该用的锚点文本"：zit → 中文呈现缓存（没有才退回英文权威锚点）；英文三模式 → 英文权威锚点
export function getAtomAnchor(entry, mode) {
    try {
        if (!entry) return '';
        var m = mode || getActiveMode();
        if (m === 'zit') return (entry.atoms && entry.atoms.zit) || getEnglishAnchor(entry) || '';
        return getEnglishAnchor(entry);
    } catch (e) { return ''; }
}

// ── 结构化锚点工具（v1.8.1）──
// anchor 格式 = 维度:值 | 维度:值 | …；项数用于"到底补全了没有"的可检测校验
export function atomCount(text) {
    try {
        var t = String(text || '').trim();
        if (!t) return 0;
        if (t.indexOf('|') >= 0) return t.split('|').filter(function (s) { return s.trim(); }).length;
        return t.split(/[，,。；;]/).filter(function (s) { return s.trim(); }).length;   // 兼容旧的逗号串
    } catch (e) { return 0; }
}

// 把结构化锚点还原成生图语言（立绘提示词里不能出现 `维度:` 前缀）
// ⚠️ 分隔符必须跟语言走：英文锚点用 `, ` —— 中文逗号 `，` 属于全角区间，
//    会被 cleanAnimePrompt 当全角字符**删掉**，删掉后标签会粘成一坨（asian1girlsolo）。
export function atomValues(text, mode) {
    try {
        var t = String(text || '').trim();
        if (!t) return '';
        var en = isEnglishAnchor(t);
        var sep = en ? ', ' : '，';
        if (mode === 'zit' && !en) sep = '，';
        var _norm = function (s) {
            s = String(s).replace(/\s*[/、，]\s*/g, sep);
            s = en ? s.replace(/\s*,\s*/g, ', ') : s.replace(/\s*,\s*/g, sep);
            return s.trim();
        };
        if (t.indexOf('|') < 0) return _norm(t);   // 旧格式（纯逗号串）：归一后原样返回
        return t.split('|').map(function (seg) {
            var s = String(seg).trim();
            var i = s.search(/[:：]/);
            if (i >= 0) s = s.slice(i + 1).trim();   // 去掉 `维度:` 前缀（只有值进提示词）
            return _norm(s);
        }).filter(Boolean).join(sep);
    } catch (e) { return String(text || ''); }
}

function _findAnchorEntry(name, identity) {
    var r = ensureRoster();
    if (!r) return null;
    var key = personKey(name, identity);
    var e = r.list[key];
    if (!e) {   // 容错：按名字找同名条目（裸名 ↔ 带标签）
        for (var sk in r.list) { if (sk === name || sk.indexOf(name + '（') === 0) { e = r.list[sk]; break; } }
    }
    return e || null;
}
// 冻结写入：老值不动，只接受"包含旧文且更长"（追加维度）或"旧格式 → 新格式"的升级
function _applyFrozen(old, t) {
    if (!old) return { write: true, why: '建档' };
    if (t === old) return { write: false, why: '' };
    if (t.length > old.length && t.indexOf(old) >= 0) return { write: true, why: '追加' };
    if (old.indexOf('|') < 0 && t.indexOf('|') >= 0) return { write: true, why: '升级为新格式' };
    return { write: false, why: '回传被忽略（旧文已冻结，防重写）' };
}
// ── 英文权威锚点（四种模式共用；英文模式读它出图）──
export function setEnglishAnchor(name, identity, text) {
    try {
        var t = String(text || '').trim();
        if (!t) return null;
        if (!isEnglishAnchor(t)) {   // 闸门：英文槽位只收英文
            slLog('⛔ 英文锚点被拒（含中文/全角字符，防立绘被删空）: ' + name + ' — ' + t.slice(0, 40));
            return null;
        }
        var e = _findAnchorEntry(name, identity);
        if (!e) return null;
        var act = _applyFrozen(e.anchor || '', t);
        if (act.write) {
            e.anchor = t;
            var _n = atomCount(t);
            slLog('英文锚点' + act.why + ': ' + e.key + '（' + _n + ' 项）' + (_n < 20 ? '  ⚠️ 项数偏少，可能没按 38 维补全' : '  ✅')
                + (t.indexOf('|') < 0 ? '  ⚠️ 不是维度:值格式' : ''));
        } else if (act.why) slLog('锚点' + act.why + ': ' + e.key);
        return e.anchor || null;
    } catch (e2) { return null; }
}
// ── zit 中文呈现缓存（只给中文模式用，不参与英文模式）──
export function setZitAnchor(name, identity, text) {
    try {
        var t = String(text || '').trim();
        if (!t) return null;
        var e = _findAnchorEntry(name, identity);
        if (!e) return null;
        if (!e.atoms) e.atoms = {};
        var act = _applyFrozen(e.atoms.zit || '', t);
        if (act.write) {
            e.atoms.zit = t;
            slLog('中文锚点' + act.why + ': ' + e.key + '（' + atomCount(t) + ' 项）');
        }
        return e.atoms.zit || null;
    } catch (e2) { return null; }
}
// ── v2.0 一次性清理：清掉旧版本残留的【分模式锚点】atoms ──
// 旧版四种模式各存一份锚点，anima 那份被辅助 AI 按中文 PROFILE 示例写成了中文 →
// 立绘走 cleanAnimePrompt 时被整段删空 → 只剩框架词 → 画出与角色无关的路人（实测 8/8 全废）。
// 新版只认 entry.anchor（英文权威）+ entry.atoms.zit（中文呈现缓存），旧桶一律作废，
// 由辅助 AI 在下一轮按新规范重建。⚠️ 只动锚点字段：base/appearance/live/portrait 与 API 配置全部保留。
export function cleanLegacyAnchors() {
    var stat = { persons: 0, slots: 0, bad: 0 };
    try {
        var root = settings.roster || {};
        for (var c in root) {
            var chats = root[c] || {};
            for (var ch in chats) {
                var list = chats[ch] || {};
                for (var k in list) {
                    var e = list[k];
                    if (!e) continue;
                    if (e.atoms) {
                        stat.slots += Object.keys(e.atoms).length;
                        delete e.atoms;
                        stat.persons++;
                    }
                    // 保险：非英文的权威锚点（不该存在）一并清掉，避免又被清洗逻辑删空
                    if (e.anchor && !isEnglishAnchor(e.anchor)) { delete e.anchor; stat.bad++; }
                }
            }
        }
    } catch (e3) {}
    return stat;
}
// ── 兼容旧调用：按文本语言自动路由（英文 → 权威锚点；中文 → 仅 zit 模式进中文缓存）──
export function setAtomAnchor(name, identity, mode, text) {
    var t = String(text || '').trim();
    if (!t) return null;
    if (isEnglishAnchor(t)) return setEnglishAnchor(name, identity, t);
    var m = mode || getActiveMode();
    if (m === 'zit') return setZitAnchor(name, identity, t);
    slLog('⛔ 中文锚点被拒（当前模式 ' + m + ' 只用英文锚点）: ' + name + ' — ' + t.slice(0, 40));
    return null;
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
                    var _m = getActiveMode();
                    var _atom = getAtomAnchor(e, _m);
                    if (_atom) {
                        // 已有锚点 → 逐字复用（零漂移）；同时给出主模型原文供"补全缺失维度"对照
                        nmLines.push('■ ' + e.key);
                        nmLines.push('   ✅ 已解析锚点' + (_m === 'zit' ? '（中文呈现 · 逐字复用）' : '（英文权威锚点 · 四种模式共用 · 逐字复用）')
                            + '（**逐字写进提示词，禁止改写、禁止同义替换**）：' + _atom);
                        nmLines.push('   ⚠️ 原始锚点（主模型原文，**只用于对照是否缺维度，不要照抄**）：' + (e.base || e.appearance || '').slice(0, 200));
                        // v1.15.0：锚点里缺【美学基调 aura】→ 点名要回来（老档案都是 v1.14 前建的，全都没有）
                        // 没有 aura 的后果：皮相只能按模型先验补 = 画出来是"真实路人脸"（丑的根源）
                        if (!/(^|\|\s*)(aura|气质)\s*[:：]/i.test(String(_atom))) {
                            nmLines.push('   ⭐ 这位的锚点里还缺【美学基调 aura】（v1.15 新增 · 必须是锚点第一个维度）—— 本轮请按种子补上：'
                                + '取「她美在哪 / 皮相往哪个方向」，用光学质感词写（如 aura:warm luminous skin, healthy glow, refined features），'
                                + '并以「**旧文原样 + aura:…**」的形式回传 anchor，**其余维度一个字不许改**。'
                                + '没有 aura = 皮相交给模型先验 = 画出来是真实路人脸。');
                        }
                        // zit 模式下若英文权威锚点还缺着：顺手让它补一份（英文锚点四种模式共用，缺了英文模式画不了立绘）
                        if (_m === 'zit' && !getEnglishAnchor(e)) {
                            nmLines.push('   ⭐ 另：这位还缺【英文权威锚点】—— 本轮请一并回传 anchor（英文，维度名与值全英文）字段；它与中文呈现表达同一件事，四种模式共用。');
                        }
                    } else if (_m !== 'zit' && e.base) {
                        // [Fix v1.7.4] 只发【静态锚点】，**不夹带上一轮的 live**
                        // （live 是上一轮辅助AI回传的可变状态，喂回去 = 读了之前的东西 → 状态串场）
                        nmLines.push('■ ' + e.key + '：' + e.base);
                        nmLines.push('   （以上是主模型写的中文静态锚点；⭐ 你这一轮必须把它具象化成**英文锚点**并通过 ---PROFILE--- 的 anchor 字段回传（维度名与值全英文），下一轮起即可逐字复用）');
                        nmLines.push('   （本轮衣着/状态/动作一律以【占位符】为准，**不要沿用上一轮**）');
                    } else if (_m === 'zit' && e.base) {
                        nmLines.push('■ ' + e.key + '：' + e.base);
                        nmLines.push('   （以上是静态锚点；本轮衣着/状态/动作一律以【占位符】为准，**不要沿用上一轮**）');
                        // v1.13.7：zit 模式下「有原文但还没锚点」时，原来**从来没有要求过回传 anchor**
                        // （只有英文模式那条分支要求了）→ 锚点会一直空着，每轮重新编脸。
                        nmLines.push('   ⭐ 这位**还没有锚点** —— 本轮必须通过 ---PROFILE--- 回传 anchor（「维度:值 | …」这种格式，zit 模式收中文锚点）+ anchor_zh，之后每轮逐字复用；漏了它 = 之后每张图都要重新编脸。');
                    } else {
                        nmLines.push('■ ' + e.key + '：' + (e.appearance || '（仅有名字，无外貌信息）'));
                    }
                    // v1.11.2：主模型漏维度时明确告知（否则辅助AI 会按"通用亚洲脸"静默补，画出来不是这个角色）
                    var _miss = _missingFaceDims(e.base || e.appearance || '');
                    if (_miss.length) nmLines.push('   ⚠️ 主模型没给：' + _miss.join(' / ') + ' —— 你必须按种子方向推断出具体值（推断值一旦定下就冻结复用，别每轮换）');
                    // v1.13.6 数字保真：主模型原文里的数字若在锚点里蒸发了 → 点名要回来
                    var _lostN = findLostNumbers((e.base || e.appearance || ''), _atom || '');
                    if (_lostN.length) nmLines.push('   🚨 数字保真：锚点里丢了主模型给的 ' + _lostN.join('、') + ' —— 数字（年龄/身高/体重）是硬事实，不会被润色掉。① 提示词里**必须写出来**（写成「十四岁左右」这类自然说法可以，但信息不许消失，⛔ 不许用「少女/女性」这种泛词顶掉）；② 锚点里该维度若只剩档位词，本轮请把它改成带数字的值（如 `age:14`），**其余维度照旧逐字复用**');
                    // v1.11.1：种子单独下发（四个分支都要带上 —— 它是"取词方向"，不是外貌）
                    if (e.seed) nmLines.push('   🌱 种子（主模型给的**取词方向**：气质/调性/重心/反差 —— 按「种子 → 锚点反推」执行，⛔ 禁止把这行原文放进提示词）：' + e.seed);
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

// ══════════════════════════════════════════════════════════════
// ── v1.13.8 立绘提示词（辅助 AI 建档时一并产出，插件不再拼装）──
// 原来立绘是「atomValues(锚点) + 固定尾巴」拼出来的：锚点里没有的东西（骨相/体态/发丝走向）
// 永远出不来，四个视角也只能靠"正面/背面"两个词硬顶。让写锚点的那个人顺手写四条，
// 记忆点更完整、四个视角也更自洽。
export var PORTRAIT_VIEWS = ['front', 'left', 'right', 'back'];

export function setPortraitPrompts(name, identity, obj) {
    try {
        if (!obj || typeof obj !== 'object') return false;
        var key = personKey(name, identity);
        var r = ensureRoster();
        var e = r && r.list && r.list[key];
        if (!e) return false;
        var cur = e.portraitPrompts || {};
        var n = 0;
        for (var i = 0; i < PORTRAIT_VIEWS.length; i++) {
            var v = PORTRAIT_VIEWS[i];
            var t = String(obj[v] || '').trim();
            if (!t) continue;
            cur[v] = t;
            n++;
        }
        if (!n) return false;
        cur.mode = getActiveMode() || 'zit';   // 记住是哪套模式语言写的（中文/英文不许混用）
        e.portraitPrompts = cur;
        return true;
    } catch (e2) { return false; }
}

export function getPortraitPrompt(entry, view) {
    try {
        var pp = entry && entry.portraitPrompts;
        if (!pp) return '';
        // v1.14：非正面视角**不回退到正面** —— 旧写法 pp[view] || pp.front，某个视角没写就用正面那条，
        // 结果四个视角共用一条提示词（实测左右两张几乎一样）。缺就是缺，让上层去补方向/重写。
        if (view && view !== 'front') return String(pp[view] || '').trim();
        return String(pp.front || '').trim();
    } catch (e) { return ''; }
}

export function portraitPromptsMode(entry) {
    try { return (entry && entry.portraitPrompts && entry.portraitPrompts.mode) || ''; } catch (e) { return ''; }
}

// ── 立绘年龄闸门（v1.13.8 引入 · v1.13.9 改窄）──
// 立绘默认是"无衣物遮挡"的体型对照图。**明确写了未成年年龄的角色一律改用素色紧身打底衣** ——
// 代码硬拦，不依赖模型自觉，也不管提示词是谁写的。
// v1.13.9 改窄：删掉「整条档案里出现 少女/萝莉 就当未成年」的启发式 —— 它会误伤成年角色，
//   而且 seed（气质/调性）是**取词方向**，不是年龄证据。现在只看两处真正的年龄来源：
//   ① base / anchor / anchor_zh 里的**明确数字年龄**（14岁 / 十四岁 / 17周岁）
//   ② 锚点里 **age / 年龄 这一维的值**（age:teenage girl / 年龄:少女）—— 只认这一维，不做全文扫描
var _AGE_NUM_RE = /(\d{1,2})\s*(?:岁|周岁)/g;
var _AGE_CN_RE = /(十[一二三四五六七八九]?|[一二三四五六七八九])\s*岁/g;
var _AGE_CN_VAL = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
var _AGE_DIM_RE = /(?:^|\|)\s*(?:age|年龄)\s*[:：]\s*([^|]*)/gi;
var _AGE_TIER_RE = /(teenage|young girl|child|loli|elementary|underage|少女|萝莉|幼女|幼童|儿童|女童)/i;

// 明确数字年龄 < 18？（14岁 / 十四岁 / 17周岁）
function _ageNumUnder18(t) {
    if (!t) return false;
    var m, n;
    _AGE_NUM_RE.lastIndex = 0;
    while ((m = _AGE_NUM_RE.exec(t)) !== null) {
        n = parseInt(m[1], 10);
        if (n > 0 && n < 18) return false;
    }
    _AGE_CN_RE.lastIndex = 0;
    while ((m = _AGE_CN_RE.exec(t)) !== null) {
        var s = m[1];
        n = _AGE_CN_VAL[s] || 0;
        if (!n && s.length === 2 && s[0] === '十') n = 10 + (_AGE_CN_VAL[s[1]] || 0);
        if (!n && s.length === 2) n = (_AGE_CN_VAL[s[0]] || 0) * 10;
        if (n > 0 && n < 18) return false;
    }
    return false;
}

export function isUnderageEntry(entry) {
    try {
        if (!entry) return false;
        var base = String((entry.base || entry.appearance) || '');
        var anchor = String(entry.anchor || '');
        var zh = String((entry.anchor_zh || (entry.atoms && entry.atoms.zit)) || '');
        // ① 明确数字年龄
        if (_ageNumUnder18(base) || _ageNumUnder18(anchor) || _ageNumUnder18(zh)) return true;
        // ② 只认锚点里 age / 年龄 这一维的值（不做全文扫描 —— 少女感 / 少女漫 这类不再算）
        var texts = [anchor, zh];
        for (var k = 0; k < texts.length; k++) {
            _AGE_DIM_RE.lastIndex = 0;
            var m;
            while ((m = _AGE_DIM_RE.exec(texts[k])) !== null) {
                var val = String(m[1] || '').trim();
                if (val && _AGE_TIER_RE.test(val)) return false;
            }
        }
        return false;
    } catch (e) { return false; }
}
