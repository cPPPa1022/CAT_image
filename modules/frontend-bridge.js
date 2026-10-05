// ── SillyImage Lab 前端应用桥 v1.1.2 ────────────────────────────────
// 为什么需要它：
//   "重前端卡"（前端卡 / App 卡）把游戏本体放在 iframe 里（酒馆助手 JS-Slash-Runner 挂载），
//   叙事正文由卡自己调 TavernHelper.generate 生成、画在自己的 UI 里，**从不写进聊天消息**。
//   插件按 .mes_text 扫描正文（正文### / [img:]）→ 永远扫不到 → 一张图都不出。
//
// 桥接思路（零侵入角色卡）：
//   1) 包住 window.TavernHelper.generate（以及各 iframe 内的同名副本）；
//   2) 卡内每次 LLM 调用返回时，从返回值里取出叙事正文（JSON 的 narrative 字段）；
//   3) 把正文喂给插件现有"画师管线"（runAuxPipeline）→ 出提示词 + [image:] 图块；
//   4) 把图卡注入前端应用自己的叙事区（#narrativeArea / .narrative-area），
//      找不到容器 → 退化为应用内浮层；再不行 → 退化为酒馆页浮层。
//
// 与卡内 prompt 无关：不需要卡配合写占位符，纯插件侧完成，卡更新也不影响。

import { slLog, slErr } from './log.js';
import { settings } from './settings.js';
import { runAuxPipeline } from './pipeline/pipeline.js';
import { extractImgBlocksFromEnhanced, buildImgCard } from './render.js';
import { enqueueGen } from './queue.js';
import { stripAiTags } from './text-utils.js';
import { getChatId } from './pipeline/profile.js';

// ── 状态 ──
var _state = {
    turns: 0,
    busy: false,
    pending: null,
    records: [],        // [{ turn, key, blocks, node }]
    seen: {},           // 去重指纹
    observer: null,
    observedArea: null,
    targetLogged: false,
    _reinjecting: false,
};

var TEST_IMG = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='240'%3E%3Crect width='100%25' height='100%25' fill='%23f5f0eb'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' font-size='19' fill='%236e6e73'%3E%E5%B0%8F%E7%8C%AB%E5%89%8D%E7%AB%AF%E6%A1%A5%E6%B5%8B%E8%AF%95%E5%9B%BE%3C/text%3E%3C/svg%3E";

// ══════════════ 1. iframe / 前端应用探测 ══════════════

// 遍历所有可访问的 iframe（含嵌套，深度<=3）；跨域/未加载的自动跳过
function eachFrame(cb, rootDoc, depth) {
    rootDoc = rootDoc || document;
    depth = depth || 0;
    if (depth > 3) return;
    var list;
    try { list = rootDoc.querySelectorAll('iframe'); } catch (e) { return; }
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
        var f = list[i], w = null, d = null;
        try { w = f.contentWindow; d = f.contentDocument; } catch (e) { continue; }
        if (!w || !d) continue;
        try { cb(f, w, d); } catch (e) { slLog('前端桥: 遍历 iframe 出错 ' + (e.message || '')); }
        eachFrame(cb, d, depth + 1);
    }
}

// 找前端应用的"叙事区"：本卡用 #narrativeArea / .narrative-area；
// 其它前端卡退化为"最后一个 .msg-narrator 的父容器"
function findAppTarget() {
    var found = null;
    eachFrame(function (f, w, d) {
        if (found) return;
        var area = null;
        try { area = d.getElementById('narrativeArea') || d.querySelector('.narrative-area'); } catch (e) {}
        if (!area) {
            var narrs = null;
            try { narrs = d.querySelectorAll('.msg-narrator'); } catch (e) {}
            if (narrs && narrs.length) area = narrs[narrs.length - 1].parentNode;
        }
        if (area) found = { frame: f, win: w, doc: d, area: area, overlay: false };
    });
    return found;
}

// 顶层文档兜底浮层（图卡总得有地方落）
function topOverlayTarget() {
    return { frame: null, win: window, doc: document, area: null, overlay: true };
}

// 应用内浮层（找不到叙事区时用；fixed 定位，不动卡自己的布局）
function overlayBody(target) {
    var doc = target.doc;
    if (target._slOverlayBody && target._slOverlayBody.parentNode) return target._slOverlayBody;
    var box = doc.createElement('div');
    box.style.cssText = 'position:fixed;right:14px;bottom:14px;max-width:52%;max-height:70%;overflow:auto;z-index:99999;' +
        'background:rgba(245,240,235,0.97);border:1px solid #d1d1d6;border-radius:14px;padding:10px 12px;' +
        'box-shadow:0 10px 30px rgba(0,0,0,0.35);font-family:inherit;';
    var head = doc.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px;color:#6e6e73;cursor:pointer;user-select:none;';
    head.innerHTML = '<span>🐱 小猫配图</span><span style="margin-left:auto;">▾</span>';
    var bodyEl = doc.createElement('div');
    head.addEventListener('click', function () {
        bodyEl.style.display = (bodyEl.style.display === 'none') ? '' : 'none';
    });
    box.appendChild(head);
    box.appendChild(bodyEl);
    (doc.body || doc.documentElement).appendChild(box);
    target._slOverlayBody = bodyEl;
    return bodyEl;
}

// ══════════════ 2. LLM 挂钩 ══════════════

// 包住某个 window 上的 TavernHelper.generate
function wrapGenerate(win, label) {
    try {
        var TH = win && win.TavernHelper;
        if (!TH || typeof TH.generate !== 'function') return false;
        var g = TH.generate;
        if (g.__sillab_fe) return false;                      // 已包过
        if (g.__sillab_orig && g.__sillab_orig.__sillab_fe) return false;
        var wrapped = function (params) {
            var self = this, args = arguments;
            var ret = g.apply(self, args);
            if (ret && typeof ret.then === 'function') {
                return ret.then(function (res) {
                    try { onExternalRaw(params, res, label); } catch (e) { slErr('前端桥处理异常: ' + (e.message || e)); }
                    return res;
                });
            }
            try { onExternalRaw(params, ret, label); } catch (e) { slErr('前端桥处理异常: ' + (e.message || e)); }
            return ret;
        };
        wrapped.__sillab_fe = true;
        wrapped.__sillab_orig = g;
        TH.generate = wrapped;
        slLog('前端桥: 挂钩 TavernHelper.generate [' + label + ']');
        return true;
    } catch (e) {
        slLog('前端桥: 挂钩 ' + label + ' 失败 ' + (e.message || ''));
        return false;
    }
}

// 安装/补装钩子（覆盖顶层 + 各 iframe 副本 + iframe 内按钮点击）
export function installFrontendHook() {
    if (settings.feBridge === false) return false;
    wrapGenerate(window, 'top');
    eachFrame(function (f, w, d) {
        wrapGenerate(w, f.id || 'iframe');
        bindFrameClicks(d);
    });
    return true;
}

// iframe 内的图卡按钮点击：原生委托，不依赖 jQuery 跨文档行为
function bindFrameClicks(doc) {
    if (!doc || doc.__sl_fe_click) return;
    doc.__sl_fe_click = true;
    doc.addEventListener('click', function (ev) {
        var el = ev.target;
        while (el && el.nodeType === 1 && el !== doc) {
            var cls = (typeof el.className === 'string') ? el.className : '';
            if (cls.indexOf('sl_img_btn') >= 0) {
                var b = jQuery(el);
                if (b.text() === '排队中…') return;
                enqueueGen(b, b.data('prompt'));
                return;
            }
            el = el.parentNode;
        }
    }, true);
}

// 非画面调用过滤：卡内还会用同一个 generate 做"状态提取/日终摘要/档案归档"等结构化调用，
// 它们同样带 narrative 字段（如 day_digest / archive_summary），不该拿去配图。
var SKIP_SCHEMA_RE = /(summary|digest|archive|recap|recall|meta|state|extract|analysis|rating)/i;
var SKIP_PROMPT_RE = /(只输出一个\s*JSON|提取角色状态|状态提取|归档摘要|日终摘要|生成摘要)/;
function isSceneCall(params) {
    try {
        if (!params) return true;
        var names = [];
        if (params.json_schema && params.json_schema.name) names.push(String(params.json_schema.name));
        if (params.tools && params.tools.length) {
            for (var i = 0; i < params.tools.length; i++) {
                var t = params.tools[i];
                var nm = (t && t.function && t.function.name) ? String(t.function.name) : '';
                if (nm) names.push(nm);
            }
        }
        for (var j = 0; j < names.length; j++) {
            if (SKIP_SCHEMA_RE.test(names[j])) { slLog('前端桥: 跳过非画面调用（schema=' + names[j] + '）'); return false; }
        }
        var ui = typeof params.user_input === 'string' ? params.user_input : '';
        if (ui && ui.length < 1200 && SKIP_PROMPT_RE.test(ui)) { slLog('前端桥: 跳过非画面调用（结构化提取提示词）'); return false; }
    } catch (e) {}
    return true;
}

// LLM 返回 → 抽叙事正文
function onExternalRaw(params, raw, label) {
    if (settings.feBridge === false) return;
    if (!raw) return;
    if (!isSceneCall(params)) return;
    var text = extractNarrativeText(raw);
    if (!text) return;                       // 非叙事调用（JSON 修复、结构化摘要等）→ 忽略
    text = stripAiTags(text).trim();
    var minLen = settings.storyMode === 'comic' ? 20 : 80;
    if (text.length < minLen) { slLog('前端桥: 叙事过短(' + text.length + '字)，忽略'); return; }
    if (isDuplicate(text)) { slLog('前端桥: 重复叙事（同一次调用被多层钩子看到），忽略'); return; }
    slLog('前端桥: 截获叙事 ' + text.length + '字 [来源 ' + label + ']');
    scheduleTurn(text);
}

var FENCE = '```';

function extractNarrativeText(raw) {
    var s = '';
    if (typeof raw === 'string') s = raw;
    else if (raw && typeof raw === 'object') {
        if (typeof raw.narrative === 'string') return raw.narrative;
        s = String(raw.text || raw.content || raw.message || '');
    }
    s = String(s || '').trim();
    if (!s) return '';
    // ` 包裹的代码块
    if (s.slice(0, 3) === FENCE && s.slice(-3) === FENCE) {
        s = s.slice(3, -3).trim();
        s = s.replace(/^[a-zA-Z]+[ \t]*\r?\n/, '');
    }
    // 标准 JSON（function call / json_schema 模式都是这个形态）
    try {
        var o = JSON.parse(s);
        if (o && typeof o.narrative === 'string') return o.narrative;
    } catch (e) {}
    // 被截断/带前后缀的 JSON：直接抠 narrative 字段
    var m = s.match(/"narrative"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
        try { return JSON.parse('"' + m[1] + '"'); } catch (e2) { return m[1]; }
    }
    // 纯文本流（部分卡直接返回正文，不做 JSON 包装）
    if (s.charAt(0) !== '{' && s.charAt(0) !== '[' && s.length >= 120) return s;
    return '';
}

function isDuplicate(text) {
    var now = Date.now();
    var fp = text.length + '|' + text.slice(0, 120) + '|' + text.slice(-40);
    if (_state.seen[fp] && (now - _state.seen[fp]) < 8000) return true;
    _state.seen[fp] = now;
    var ks = Object.keys(_state.seen);
    if (ks.length > 30) {
        for (var i = 0; i < ks.length; i++) { if ((now - _state.seen[ks[i]]) > 60000) delete _state.seen[ks[i]]; }
    }
    return false;
}

// ══════════════ 3. 管线 + 注入 ══════════════

function scheduleTurn(text) {
    _state.pending = text;
    if (_state.busy) { slLog('前端桥: 管线忙，本轮排队等待'); return; }
    drainTurns();
}

async function drainTurns() {
    _state.busy = true;
    while (_state.pending) {
        var text = _state.pending;
        _state.pending = null;
        try { await runTurn(text); } catch (e) { slErr('前端桥轮次失败: ' + (e.message || e)); }
    }
    _state.busy = false;
}

async function runTurn(text) {
    _state.turns++;
    var turn = _state.turns;
    var key = 'fe_' + getChatId() + '_' + turn;
    slLog('前端桥: 第' + turn + '轮 → 画师管线（key=' + key + '）');
    var res = null;
    try { res = await runAuxPipeline(text, key); } catch (e) { slErr('前端桥管线异常: ' + (e.message || e)); return; }
    if (!res) { slLog('前端桥: 管线返回空（辅助 API 未配置/报错，或本轮判无图）—— 详见上一行管线日志'); return; }
    if (!res.enhanced) { slLog('前端桥: 管线本轮无图块（无图轮），跳过'); return; }
    var blocks = extractImgBlocksFromEnhanced(res.enhanced, key);
    if (!blocks.length) { slLog('前端桥: 解析不到图块，跳过'); return; }
    var record = { turn: turn, key: key, blocks: blocks, node: null };
    _state.records.push(record);
    if (_state.records.length > 30) _state.records.shift();
    injectRecord(record);
}

function makeTurnNode(doc, record) {
    var wrap = doc.createElement('div');
    wrap.className = 'sl_fe_turn';
    wrap.setAttribute('data-sl-fe-turn', String(record.turn));
    wrap.style.cssText = 'margin:10px 0;padding:10px 12px;border-radius:12px;background:rgba(245,240,235,0.97);border:1px solid #d1d1d6;';
    var html = '<div style="font-size:10.5px;color:#6e6e73;margin-bottom:6px;">🐱 小猫配图 · 第 ' + record.turn + ' 轮</div>';
    for (var i = 0; i < record.blocks.length; i++) html += record.blocks[i].html;
    wrap.innerHTML = html;
    return wrap;
}

function injectRecord(record) {
    var target = findAppTarget();
    var where = '前端应用叙事区';
    if (!target) { target = topOverlayTarget(); where = '酒馆页浮层'; }
    bindFrameClicks(target.doc);
    var node = makeTurnNode(target.doc, record);
    var parent;
    if (target.area && settings.feBridgeInline !== false) {
        parent = target.area;
    } else {
        parent = overlayBody(target);
        where = target.overlay ? '酒馆页浮层' : '应用内浮层';
    }
    parent.appendChild(node);
    record.node = node;
    try { if (target.area) target.area.scrollTop = target.area.scrollHeight; } catch (e) {}
    watchAppArea(target);
    autoGenNode(node);
    slLog('前端桥: 已注入 ' + record.blocks.length + ' 张图卡 → ' + where);
}

// 前端应用重绘（swipe / 重开局）会清掉我们的节点 → 自动补回
function watchAppArea(target) {
    if (!target || !target.area || typeof MutationObserver === 'undefined') return;
    if (_state.observedArea === target.area && _state.observer) return;
    try { if (_state.observer) _state.observer.disconnect(); } catch (e) {}
    var MO = (target.win && target.win.MutationObserver) ? target.win.MutationObserver : MutationObserver;
    _state.observedArea = target.area;
    try {
        _state.observer = new MO(function () {
            if (_state._reinjecting) return;
            _state._reinjecting = true;
            setTimeout(function () { _state._reinjecting = false; ensureRecords(target); }, 700);
        });
        _state.observer.observe(target.area, { childList: true });
        slLog('前端桥: 已监视叙事区（应用重绘后自动补回图卡）');
    } catch (e) { slLog('前端桥: 叙事区监视启动失败 ' + (e.message || '')); }
}

function ensureRecords(target) {
    if (!target || !target.area) return;
    var n = 0;
    for (var i = 0; i < _state.records.length; i++) {
        var r = _state.records[i];
        if (r.node && r.node.parentNode) continue;
        var node = makeTurnNode(target.doc, r);
        target.area.appendChild(node);
        r.node = node;
        n++;
    }
    if (n) { slLog('前端桥: 应用重绘后补回 ' + n + ' 组图卡'); try { target.area.scrollTop = target.area.scrollHeight; } catch (e) {} }
}

function autoGenNode(node) {
    if (settings.autoGen !== 1) return;
    setTimeout(function () {
        try {
            var btns = node.querySelectorAll ? node.querySelectorAll('.sl_img_btn') : [];
            for (var i = 0; i < btns.length; i++) {
                var b = jQuery(btns[i]);
                if ((b.text() || '').indexOf('生成图片') < 0) continue;
                enqueueGen(b, b.data('prompt'));
            }
        } catch (e) { slErr('前端桥自动出图失败: ' + (e.message || e)); }
    }, 600);
}

// ══════════════ 4. 对外：初始化 / 诊断 / 测试 ══════════════

export function initFrontendBridge() {
    if (settings.feBridge === false) { slLog('前端桥: 设置里已关闭，未启用'); return; }
    installFrontendHook();
    var hasTH = !!(window.TavernHelper && window.TavernHelper.generate);
    slLog('前端桥: ' + (hasTH ? '已挂钩 TavernHelper.generate（前端卡出图已接管）' : '未发现 TavernHelper（酒馆助手未装/未启用 → 前端卡本身跑不起来，桥不生效）'));
    if (initFrontendBridge._timer) clearInterval(initFrontendBridge._timer);
    // 新开的 iframe（新楼/新游戏）与后加载的副本：定时补挂
    initFrontendBridge._timer = setInterval(function () {
        if (settings.feBridge === false) return;
        try {
            installFrontendHook();
            var t = findAppTarget();
            if (t && !_state.targetLogged) {
                _state.targetLogged = true;
                slLog('前端桥: 检测到前端应用叙事区（' + ((t.frame && t.frame.id) ? t.frame.id : 'iframe') + '）→ 图卡注入应用内部');
            }
        } catch (e) {}
    }, 4000);
    try { window.SILLAB_FE = { probe: probeFrontendApp, test: injectTestCard, status: getFeBridgeStatus }; } catch (e) {}
}

export function stopFrontendBridge() {
    if (initFrontendBridge._timer) { clearInterval(initFrontendBridge._timer); initFrontendBridge._timer = null; }
    try { if (_state.observer) _state.observer.disconnect(); } catch (e) {}
    _state.observer = null;
    _state.observedArea = null;
    slLog('前端桥: 已停止定时补挂（已注入的图卡保留）');
}

export function getFeBridgeStatus() {
    if (settings.feBridge === false) return '已关闭（打开后前端卡才会出图）';
    if (!window.TavernHelper) return '未检测到酒馆助手（JS-Slash-Runner）';
    var hooked = !!(window.TavernHelper.generate && window.TavernHelper.generate.__sillab_fe);
    var t = findAppTarget();
    return (hooked ? '钩子已挂' : '钩子未挂（刷新页面重试）') + ' · ' + (t ? '已找到前端应用' : '等待前端应用') + ' · 已注入 ' + _state.records.length + ' 组图卡';
}

export function probeFrontendApp() {
    var t = findAppTarget();
    var r = {
        enabled: settings.feBridge !== false,
        tavernHelper: !!window.TavernHelper,
        generateType: window.TavernHelper ? typeof window.TavernHelper.generate : 'none',
        hooked: !!(window.TavernHelper && window.TavernHelper.generate && window.TavernHelper.generate.__sillab_fe),
        appFound: !!t,
        frameId: (t && t.frame) ? t.frame.id : '',
        narrativeArea: !!(t && t.area),
        areaChildren: (t && t.area) ? t.area.children.length : -1,
        turns: _state.turns,
        records: _state.records.length,
        imgMode: settings.imgMode,
        autoGen: settings.autoGen,
    };
    slLog('前端桥探针: ' + JSON.stringify(r));
    return r;
}

// 手动测试：不调 API、不出图，只往叙事区插一张占位图卡，验证注入通道
export function injectTestCard() {
    var t = findAppTarget();
    if (!t) {
        slLog('前端桥测试: 当前聊天里没找到前端应用（不是前端卡 / 酒馆助手未启用 / 应用还没挂载）');
        return false;
    }
    _state.turns++;
    var key = 'fe_test_' + Date.now();
    var blocks = [{
        scene: '前端桥测试图',
        prompt: '（占位图，仅测试注入通道）',
        id: key + '#0',
        html: buildImgCard('前端桥测试图', '（占位图，仅测试注入通道）', TEST_IMG, key + '#0'),
    }];
    var record = { turn: _state.turns, key: key, blocks: blocks, node: null };
    _state.records.push(record);
    injectRecord(record);
    return true;
}
