// ── SillyImage Lab v1.22 图片缓存仓（IndexedDB）──
// 为什么要有它：
//   原来 settings.msgMap（消息 key → 带【提示词】的增强文本）整个塞在 settings 里，
//   而 saveSettings() 会把**整份 settings** 写进 localStorage['sillab_settings']。
//   localStorage 只有几 MB → 只能给 msgMap 留 50 条（而且这 50 条是**全库共享**的：
//   跨所有角色卡、所有聊天一起 50 条），一轮 1-3 张图，几十轮之后历史图就开始"莫名消失"。
//
// 现在：
//   · msgMap 只留在**内存** + IndexedDB（容量按磁盘配额，几百 MB 级）
//   · localStorage / ST 的 settings.json 只存设置本身（msgMap 一律剥掉）
//   · 启动时把 IDB 里的历史缓存装回 settings.msgMap → 老消息的图照常恢复
//   · 老版本残留的 settings.msgMap 会在第一次启动时自动迁移进 IDB
//
// 失败降级：浏览器禁 IDB（隐私模式等）→ 只做内存缓存，功能照常，只是刷新后历史图会重新出。

import { settings } from './settings.js';
import { slLog } from './log.js';

var DB_NAME = 'sillab_imgcache';
var DB_VERSION = 1;
var STORE = 'msg';
var _dbPromise = null;
var _ready = false;

function _open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve) {
        try {
            if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () {
                slLog('图片仓打开失败: ' + (req.error && req.error.message));
                resolve(null);
            };
            req.onblocked = function () { resolve(null); };
        } catch (e) { resolve(null); }
    });
    return _dbPromise;
}

function _reader(db) { return db.transaction(STORE, 'readonly').objectStore(STORE); }
function _writer(db) { return db.transaction(STORE, 'readwrite').objectStore(STORE); }

// 启动时调用一次：老数据迁移 → 全量装回内存
export function imgStoreInit() {
    return _open().then(function (db) {
        if (!db) {
            _ready = true;
            slLog('图片仓不可用（隐私模式？）→ 本次只做内存缓存，刷新后历史图需重新生成');
            return { ok: false, loaded: 0 };
        }
        var legacy = settings.msgMap || {};
        var legacyTs = settings.msgMapTs || {};
        var legacyKeys = Object.keys(legacy);
        var migrate = Promise.resolve();
        if (legacyKeys.length) {
            migrate = new Promise(function (res) {
                try {
                    var st = _writer(db);
                    for (var i = 0; i < legacyKeys.length; i++) {
                        var k = legacyKeys[i];
                        if (!legacy[k]) continue;
                        st.put({ text: legacy[k], ts: legacyTs[k] || 0 }, k);
                    }
                    st.transaction.oncomplete = function () { res(); };
                    st.transaction.onerror = function () { res(); };
                    st.transaction.onabort = function () { res(); };
                } catch (e) { res(); }
            });
        }
        return migrate.then(function () {
            return new Promise(function (res) {
                try {
                    var out = {}, n = 0;
                    var req = _reader(db).openCursor();
                    req.onsuccess = function () {
                        var c = req.result;
                        if (!c) return res({ ok: true, loaded: n, data: out });
                        out[c.key] = (c.value && c.value.text) || '';
                        n++;
                        c.continue();
                    };
                    req.onerror = function () { res({ ok: true, loaded: 0, data: out }); };
                } catch (e) { res({ ok: false, loaded: 0, data: {} }); }
            });
        }).then(function (r) {
            settings.msgMap = Object.assign({}, settings.msgMap || {}, r.data || {});
            settings.msgMapTs = settings.msgMapTs || {};
            for (var k in (r.data || {})) if (!settings.msgMapTs[k]) settings.msgMapTs[k] = Date.now();
            _ready = true;
            if (legacyKeys.length) slLog('图片仓迁入旧缓存 ' + legacyKeys.length + ' 条');
            slLog('图片仓就绪：历史图缓存 ' + (r.loaded || 0) + ' 条已装回内存（不再受 50 条上限约束）');
            return r;
        });
    }).catch(function (e) {
        _ready = true;
        slLog('图片仓初始化异常: ' + (e && e.message));
        return { ok: false, loaded: 0 };
    });
}

export function imgStoreReady() { return _ready; }
export function imgStoreCount() { return Object.keys(settings.msgMap || {}).length; }

// 写一条（内存立即生效；IDB 异步落盘，失败不影响本轮）
export function imgStorePut(key, text, ts) {
    if (!key || !text) return;
    try {
        settings.msgMap = settings.msgMap || {};
        settings.msgMapTs = settings.msgMapTs || {};
        settings.msgMap[key] = text;
        settings.msgMapTs[key] = ts || Date.now();
    } catch (e) {}
    _open().then(function (db) {
        if (!db) return;
        try { _writer(db).put({ text: text, ts: ts || Date.now() }, key); } catch (e) {}
    });
}

// 按前缀删（一个聊天 / 一条消息的全部 swipe 分支）
export function imgStoreDeletePrefix(prefix) {
    if (!prefix) return;
    try {
        var mm = settings.msgMap || {};
        for (var k in mm) { if (k.indexOf(prefix) === 0) { delete mm[k]; if (settings.msgMapTs) delete settings.msgMapTs[k]; } }
    } catch (e) {}
    _open().then(function (db) {
        if (!db) return;
        try {
            var st = _writer(db);
            var req = st.openCursor();
            req.onsuccess = function () {
                var c = req.result;
                if (!c) return;
                if (String(c.key).indexOf(prefix) === 0) c.delete();
                c.continue();
            };
        } catch (e) {}
    });
}

// 按 key 列表删（图库级联时用）
export function imgStoreDeleteKeys(keys) {
    if (!keys || !keys.length) return imgStoreDeletePrefix('\u0000__none__');
    try {
        for (var i = 0; i < keys.length; i++) { delete (settings.msgMap || {})[keys[i]]; if (settings.msgMapTs) delete settings.msgMapTs[keys[i]]; }
    } catch (e) {}
    _open().then(function (db) {
        if (!db) return;
        try {
            var st = _writer(db);
            for (var j = 0; j < keys.length; j++) st.delete(keys[j]);
        } catch (e) {}
    });
}
