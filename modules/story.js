// ── SillyImage Lab 剧情库（长期记忆：存档 + 标签 + 滚动总结 + 归档） ──
// 设计文档：sillycat-story-lib-design.md v0.3
// 存储：data/<user>/user/files/sillyCAT_story_<hash>_<seq>.json（ST files API，扁平文件名）
// 说明：files API 的 validateAssetFileName 仅允许 [a-zA-Z0-9_\-.]，不支持子目录，故用扁平前缀命名。
import { slLog, slErr } from './log.js';
import { settings, getSTHeaders } from './settings.js';
import { getChatId, getProfiles } from './pipeline/profile.js';
import { auxApiCall } from './pipeline/api.js';
import { isPromptsLoaded, getPrompt } from '../prompts/loader.js';

// ── 常量 ──
var SLICE_SIZE = 100;        // 每条分片最多 100 条
var MAX_BODY = 600;          // 单条正文上限（与历史正文一致）
var MAX_PROBE = 300;         // 分片探测上限
var CACHE_TTL = 30000;       // 最后分片内存缓存 30s
var MAX_COVERED = 500;       // coveredMesids 保留上限

// ── 状态 ──
var _cache = { lastSeq: 0, data: null, ts: 0, initialized: false };
var _coveredMesids = [];
var _lastSummary = null;
var _writeChain = Promise.resolve();
var _summarizing = false;

// 总结模板（loader 加载 prompts/pipeline/summary.txt 优先，加载失败用此兜底）
var SUMMARIZE_FALLBACK = [
    '# Role: SillyImage Lab 剧情总结器',
    '你是剧情压缩引擎。把输入的【旧总结】与【新增剧情】合并压缩为一份新的滚动总结。',
    '输出不超过 800 字，固定小节：',
    '剧情主线：……（2-3 句，覆盖全部历史）',
    '关键转折：……（逐条列出）',
    '当前局面：……',
    '人物状态：……（所有出场过的角色逐人一行：名字+外貌锚点+当前状态；含休眠/已删除的 NPC——它们可能重新出场，必须保留可识别信息）',
    '未解伏笔：……（悬而未决的线索）',
    '地点与物品：……（重要地点/物品当前状态）',
    '要求：',
    '1. 继承旧总结中仍有效的信息，丢弃已过时的',
    '2. 禁止编造细节；NPC 名单内所有角色必须逐人交代',
    '3. 只输出总结正文，不要任何其他内容'
].join('\n');

// ── 工具 ──
function hash16(str) {
    var h1 = 5381, h2 = 52711;
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        h1 = ((h1 << 5) + h1 + c) | 0;
        h2 = ((h2 << 5) + h2 + c) | 0;
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
function storyKey() {
    try { return hash16(getChatId()); } catch (e) { return 'unknown'; }
}
function sliceFileName(seq) { return 'sillyCAT_story_' + storyKey() + '_' + seq + '.json'; }
function summaryFileName() { return 'sillyCAT_story_' + storyKey() + '_summary.json'; }
function b64(str) {
    try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { return ''; }
}
function utf8(str) {
    try { return decodeURIComponent(escape(str)); } catch (e) { return str; }
}

// ── 文件读写（ST files API） ──
async function readFile(name) {
    var resp = await fetch('/user/files/' + name, { headers: getSTHeaders() });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error('读文件 HTTP ' + resp.status);
    return resp.json();
}
async function writeFile(name, data) {
    var resp = await fetch('/api/files/upload', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getSTHeaders()),
        body: JSON.stringify({ name: name, data: b64(JSON.stringify(data)) })
    });
    if (!resp.ok) throw new Error('写文件 HTTP ' + resp.status);
}
async function deleteFile(name) {
    var resp = await fetch('/api/files/delete', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getSTHeaders()),
        body: JSON.stringify({ path: '/user/files/' + name })
    });
    if (!resp.ok && resp.status !== 404) throw new Error('删文件 HTTP ' + resp.status);
}

// ── 初始化：探测最后分片 + 读取总结 ──
async function ensureInit() {
    if (_cache.initialized) return;
    _cache.initialized = true;
    try {
        var seq = 1, lastFound = 0, miss = 0;
        while (seq <= MAX_PROBE) {
            var resp = await fetch('/user/files/' + sliceFileName(seq), { headers: getSTHeaders() });
            if (resp.status === 404) { miss++; if (miss >= 3) break; }
            else if (resp.ok) { lastFound = seq; miss = 0; }
            else break;
            seq++;
        }
        _cache.lastSeq = lastFound;
        try {
            var sd = await readFile(summaryFileName());
            if (sd) { _lastSummary = sd; _coveredMesids = Array.isArray(sd.coveredMesids) ? sd.coveredMesids.slice(-MAX_COVERED) : []; }
        } catch (e) { slLog('剧情库: 总结文件读取跳过: ' + e.message); }
        slLog('剧情库: 初始化完成, 最后分片 #' + _cache.lastSeq + (_lastSummary ? ', 已总结至第' + _lastSummary.toRound + '轮' : ''));
    } catch (e) { slLog('剧情库: 初始化失败: ' + e.message); }
}

// ── 分片读取（带缓存） ──
async function readSlice(seq) {
    if (seq === _cache.lastSeq && _cache.data && Date.now() - _cache.ts < CACHE_TTL) return _cache.data;
    var data = await readFile(sliceFileName(seq));
    if (seq === _cache.lastSeq) { _cache.data = data; _cache.ts = Date.now(); }
    return data;
}
async function readAllEntries() {
    await ensureInit();
    var all = [];
    for (var seq = 1; seq <= _cache.lastSeq; seq++) {
        try {
            var slice = await readFile(sliceFileName(seq));
            if (slice && Array.isArray(slice.entries)) all = all.concat(slice.entries);
        } catch (e) { /* 单片失败跳过 */ }
    }
    all.sort(function (a, b) { return (a.round || 0) - (b.round || 0); });
    return all;
}

// ── 追加条目（写队列串行，不阻塞主流程） ──
export function appendEntry(entry) {
    if (settings.storyLib === false) return;
    if (!entry || !entry.body) return;
    var body = String(entry.body).slice(0, MAX_BODY);
    _writeChain = _writeChain.then(async function () {
        try {
            await ensureInit();
            var seq = _cache.lastSeq || 1;
            var slice = await readSlice(seq);
            var list = (slice && Array.isArray(slice.entries)) ? slice.entries : [];
            // 去重：同 round / 同 mesid / 已被总结归档
            for (var i = 0; i < list.length; i++) if (list[i].round === entry.round || (entry.mesid && list[i].mesid === entry.mesid)) return;
            if (entry.mesid && _coveredMesids.indexOf(entry.mesid) >= 0) return;
            list.push({ mesid: entry.mesid || '', round: entry.round || 0, time: Date.now(), scene: entry.scene || '', tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 5) : [], body: body });
            if (list.length > SLICE_SIZE) {
                seq = seq + 1;
                _cache.lastSeq = seq;
                await writeFile(sliceFileName(seq), { chatId: getChatId(), slice: seq, updatedAt: Date.now(), entries: [list[list.length - 1]] });
            } else {
                await writeFile(sliceFileName(seq), { chatId: getChatId(), slice: seq, updatedAt: Date.now(), entries: list });
            }
            _cache.data = null; _cache.ts = 0;
            slLog('剧情库: 已存 第' + (entry.round || 0) + '轮 (' + body.length + '字, 片#' + seq + ')');
        } catch (e) { slLog('剧情库写入失败: ' + e.message); }
    });
}

// ── 滚动总结 ──
export function maybeSummarize() {
    if (settings.storyLib === false || _summarizing) return;
    try {
        var prof = getProfiles();
        if (!prof || !prof.chat) return;
        var currentRound = (prof.chat._round || 0) + 1;
        var since = _lastSummary ? (_lastSummary.toRound || 0) : 0;
        var gap = parseInt(settings.summaryGap, 10) || 15;
        if (currentRound - since < gap) return;
        _summarizing = true;
        summarize().catch(function (e) { slLog('剧情总结失败: ' + e.message); })
            .then(function () { _summarizing = false; });
    } catch (e) { slLog('剧情总结触发异常: ' + e.message); }
}

export async function summarize(force) {
    await ensureInit();
    var prof = getProfiles();
    if (!prof || !prof.chat) return false;
    var since = _lastSummary ? (_lastSummary.toRound || 0) : 0;
    var all = await readAllEntries();
    var pending = all.filter(function (en) { return en.round > since; });
    var threshold = parseInt(settings.summaryThreshold, 10) || 40;
    if (!force && pending.length < threshold) {
        slLog('剧情总结: 未总结条目不足(' + pending.length + '/' + threshold + ')');
        return false;
    }
    if (pending.length < 5) { slLog('剧情总结: 增量过少(' + pending.length + '条)'); return false; }

    var input = [];
    if (_lastSummary && _lastSummary.summary) input.push('【旧总结】\n' + _lastSummary.summary);
    var recent = pending.slice(-15);
    input.push('【新增剧情】\n' + recent.map(function (en) { return '【第' + en.round + '轮】' + en.body; }).join('\n\n'));
    var npcNames = Object.keys(prof.chat.npcs || {});
    if (npcNames.length) {
        input.push('【NPC名单】（必须逐人交代）\n' + npcNames.map(function (n) {
            var x = prof.chat.npcs[n];
            return n + (x && x.identity ? '[' + x.identity + ']' : '') + (x && x.sleep ? '(休眠)' : '');
        }).join('、'));
    }
    var sysPrompt = (isPromptsLoaded() && getPrompt('pipeline/summary.txt')) || SUMMARIZE_FALLBACK;
    var output = await auxApiCall(sysPrompt, input.join('\n\n'), 2048, 0.3);
    if (!output) { slLog('剧情总结: LLM 返回空'); return false; }

    var maxRound = recent[recent.length - 1].round;
    var covered = [];
    // 归档：删除 round <= maxRound 的原始条目（"把前面的删了"）
    for (var seq = 1; seq <= _cache.lastSeq; seq++) {
        try {
            var slice = await readFile(sliceFileName(seq));
            if (!slice || !Array.isArray(slice.entries)) continue;
            var keep = slice.entries.filter(function (en) {
                if (en.round <= maxRound) { if (en.mesid) covered.push(en.mesid); return false; }
                return true;
            });
            if (keep.length !== slice.entries.length) {
                if (keep.length === 0) { await deleteFile(sliceFileName(seq)); }
                else { slice.entries = keep; slice.updatedAt = Date.now(); await writeFile(sliceFileName(seq), slice); }
            }
        } catch (e) { slLog('剧情库归档单片失败(# ' + seq + '): ' + e.message); }
    }
    var sd = { chatId: prof.chatId, updatedAt: Date.now(), fromRound: since + 1, toRound: maxRound, summary: output.trim(), coveredMesids: covered };
    _lastSummary = sd;
    _coveredMesids = _coveredMesids.concat(covered).slice(-MAX_COVERED);
    await writeFile(summaryFileName(), sd);
    _cache.lastSeq = 0; _cache.initialized = false; // 分片可能被删/重写，强制重新探测
    slLog('剧情总结: 第' + sd.fromRound + '~' + sd.toRound + '轮, ' + output.trim().length + '字, 归档' + covered.length + '条');
    return true;
}

// ── 检索：按标签找早期相关剧情（v2） ──
export async function searchByTags(tags, limit) {
    if (!tags || !tags.length) return [];
    try {
        await ensureInit();
        var all = await readAllEntries();
        var hits = [];
        for (var i = 0; i < all.length; i++) {
            var en = all[i], et = en.tags || [];
            for (var j = 0; j < tags.length; j++) {
                if (et.indexOf(tags[j]) >= 0) { hits.push(en); break; }
            }
        }
        hits.sort(function (a, b) { return (b.round || 0) - (a.round || 0); });
        return hits.slice(0, limit || 2);
    } catch (e) { slLog('剧情库检索失败: ' + e.message); return []; }
}

export async function getSummary() {
    try { await ensureInit(); return _lastSummary ? (_lastSummary.summary || '') : ''; }
    catch (e) { return ''; }
}

// ── UI 概览 ──
export async function getOverview() {
    try {
        await ensureInit();
        var all = await readAllEntries();
        var tagCount = {};
        for (var i = 0; i < all.length; i++) {
            var et = all[i].tags || [];
            for (var j = 0; j < et.length; j++) tagCount[et[j]] = (tagCount[et[j]] || 0) + 1;
        }
        var last = all[all.length - 1];
        return {
            count: all.length,
            slices: _cache.lastSeq,
            lastRound: last ? last.round : 0,
            tags: tagCount,
            summary: _lastSummary ? { toRound: _lastSummary.toRound || 0, text: (_lastSummary.summary || '').slice(0, 200) } : null,
            entries: all.slice(-50).reverse()
        };
    } catch (e) { slLog('剧情库概览失败: ' + e.message); return { count: 0, slices: 0, lastRound: 0, tags: {}, summary: null, entries: [] }; }
}

// ── 删除单条 / 清空 ──
export async function deleteEntry(mesid) {
    try {
        await ensureInit();
        for (var seq = 1; seq <= _cache.lastSeq; seq++) {
            var slice = await readFile(sliceFileName(seq));
            if (!slice || !Array.isArray(slice.entries)) continue;
            var keep = slice.entries.filter(function (en) { return en.mesid !== mesid; });
            if (keep.length !== slice.entries.length) {
                if (keep.length === 0) { await deleteFile(sliceFileName(seq)); }
                else { slice.entries = keep; await writeFile(sliceFileName(seq), slice); }
                _cache.lastSeq = 0; _cache.initialized = false;
                slLog('剧情库: 已删除条目 ' + mesid);
                return true;
            }
        }
        return false;
    } catch (e) { slLog('剧情库删除失败: ' + e.message); return false; }
}

export async function clearStory() {
    try {
        await ensureInit();
        for (var seq = 1; seq <= _cache.lastSeq; seq++) {
            try { await deleteFile(sliceFileName(seq)); } catch (e) {}
        }
        try { await deleteFile(summaryFileName()); } catch (e) {}
        _cache = { lastSeq: 0, data: null, ts: 0, initialized: false };
        _coveredMesids = [];
        _lastSummary = null;
        slLog('剧情库: 已清空');
        return true;
    } catch (e) { slLog('剧情库清空失败: ' + e.message); return false; }
}
