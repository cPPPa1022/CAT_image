// ── SillyImage Lab 消息扫描与触发 ──
import { slLog, slErr } from './log.js';
import { settings, getSTContext, escapeHtml, saveSettings } from './settings.js';
import { extractBodyText, extractBodyContent, hasBodyMarker, stripAiTags } from './text-utils.js';
import { getProfiles, getChatId } from './pipeline/profile.js';
import { runAuxPipeline } from './pipeline/pipeline.js';
import { runRosterPipeline } from './pipeline/roster-pipeline.js';
import { refreshCoopCards } from './sync-cards.js';
import { renderBodyEnhanced, renderEnhanced, renderEnhancedLite, setRestoreDeps, restoreImageBlocks } from './render.js';

// 注入 render 模块需要的依赖
setRestoreDeps(getChatId, getSTContext);

// ── 扫描会话管理 ──
var scanSession = null;
var sessionIdCounter = 0;

function startScanSession(msgElement, mesId, chatId) {
    // [AI-Fix] 如果当前会话正在 scanning（await runAuxPipeline 期间），新消息的扫描请求不能覆写它。
    // 原因：覆写后旧 await 的 DOM 引用失效，渲染到僵尸 DOM，消息永久无法显示图片（致命缺陷 1）。
    // 修复：scanning 阶段拒绝新会话，等当前会话 completed 后才允许。
    // 同一条消息正在扫描（await 管线进行中）→ 不重复启动
    // [AI-Fix] 仅 scanning 阶段拒绝：wait_marker/wait_end 是待命会话（无 await，仅定时器），
    // 编辑/swipe 清除标记后必须允许替换，否则 startScanSession 被守卫拦截 → 该消息永不重扫（静默死锁）。
    if (scanSession && scanSession.mesid === mesId && scanSession.phase === 'scanning') return;
    // [AI-Fix] 不同消息但在 scanning 阶段 → 拒绝覆盖，等当前管线完成
    if (scanSession && scanSession.phase === 'scanning' && scanSession.mesid !== mesId) {
        slLog('扫描会话 #' + scanSession.id + ' 正在 scanning，拒绝 #' + mesId + ' 的覆盖请求');
        return;
    }
    sessionIdCounter++;
    var sessionId = sessionIdCounter;
    if (scanSession) {
        clearTimeout(scanSession.timer);
        slLog('扫描会话 #' + scanSession.id + ' 被 #' + sessionId + ' 替代');
    }
    scanSession = { id: sessionId, msgEl: msgElement, mesid: mesId, chatId: chatId, phase: 'wait_marker', timer: null, tries: 0, _startTime: Date.now() };
    // 标记会话已启动（和 sl_aux_scanned 分开，避免 auxImageScan 误判）
    msgElement.data('sl_session_started', 1);
    slLog('扫描会话 #' + sessionId + ' 启动');
    scheduleMarkerCheck(sessionId);
}

function scheduleMarkerCheck(sessionId) {
    var session = scanSession;
    if (!session || session.id !== sessionId) return;
    clearTimeout(session.timer);
    session.timer = setTimeout(function() { doMarkerCheck(sessionId); }, 5000);
}

function doMarkerCheck(sessionId) {
    var session = scanSession;
    if (!session || session.id !== sessionId) return;
    session.tries++;
    var text = session.msgEl.text();
    // ── v2.4 酒馆AI模式：检测 [img:] 占位符，文本稳定后触发（不依赖正文###标记，该标记由酒馆侧决定） ──
    if (settings.imgMode === 'main') {
        if (text.indexOf('[img:') < 0) {
            // 流式输出中可能尚未写出占位符：继续等，最多 8 次(40s)
            if (text !== session.lastText) {
                // [Fix] 文本仍在流式变化（[img:] 常在长消息文末）：流式时间不计入 40s 超时，
                // 重置等待计数；否则慢流式消息在占位符出现前就被放弃（A2）。
                session.tries = 0;
                session.lastText = text;
                scheduleMarkerCheck(sessionId);
            } else if (session.tries < 8) {
                session.lastText = text;
                scheduleMarkerCheck(sessionId);
            } else {
                session.phase = 'done';
                // [Fix] 放弃时必须清除 sl_session_started，否则该消息被永久标记"已有会话"
                // 而永远不会重扫（即使随后 [img:] 出现）（A2）。
                try { session.msgEl.removeData('sl_session_started'); } catch (e) {}
                slLog('扫描 #' + sessionId + ' 40s 未检测到 [img:]，放弃');
            }
            return;
        }
        if (session.lastText !== text) {
            // 文本仍在变化（流式/重生成）：记住当前指纹再等一轮
            session.lastText = text;
            scheduleMarkerCheck(sessionId);
            return;
        }
        session.phase = 'done';
        slLog('扫描 #' + sessionId + ' 占位符文本已稳定，触发协作管线');
        var mainBody = extractBodyText(text);
        // [Fix] 与 runAuxImageScan 内部阈值(80/20)对齐：10 字会放行后被管线内部判过短
        // 且不复位会话 phase → 扫描会话永久卡在 scanning 死锁（A1）。
        var mainMinLen = settings.storyMode === 'comic' ? 20 : 80;
        if (mainBody.length >= mainMinLen) {
            runAuxImageScan(session.msgEl);
        } else {
            slLog('正文过短(' + mainBody.length + ')，跳过');
            if (scanSession) scanSession.phase = 'completed';
        }
        return;
    }
    var clean = stripAiTags(text);
    var startIdx = clean.indexOf('正文###');
    var endIdx = clean.indexOf('结尾###', startIdx + 1);
    if (startIdx >= 0 && endIdx > startIdx) {
        session.phase = 'done';
        slLog('扫描 #' + sessionId + ' 检测到完整标记，提取正文(' + (endIdx - startIdx - 5) + '字)');
        var rawStart = text.indexOf('正文###');
        var rawEnd = text.indexOf('结尾###', rawStart + 1);
        var bodyText = (rawStart >= 0 && rawEnd > rawStart) ? text.slice(rawStart + 5, rawEnd) : text.slice(startIdx + 5, endIdx);
        var minBody = settings.storyMode === 'comic' ? 20 : 80;
        if (bodyText.length >= minBody) {
            slLog('触发管线(标记模式)');
            runAuxImageScan(session.msgEl);
        } else { slLog('正文过短(' + bodyText.length + ')，跳过'); }
        return;
    }
    if (startIdx >= 0 && endIdx < 0) {
        session.phase = 'wait_end';
        slLog('扫描 #' + sessionId + ' 检测到 正文###，等待 结尾###');
        scheduleEndCheck(sessionId);
        return;
    }
    if (session.tries < 3) {
        slLog('扫描 #' + sessionId + ' 第' + session.tries + '次未检测到标记');
        scheduleMarkerCheck(sessionId);
    } else {
        session.phase = 'done';
        slLog('扫描 #' + sessionId + ' 3次未检测到标记，使用回退 8s');
        var backupText = extractBodyText(text);
        if (backupText.length >= (settings.storyMode === 'comic' ? 20 : 80)) {
            clearTimeout(session.timer);
            session.timer = setTimeout(function() {
                slLog('触发管线(回退模式)');
                runAuxImageScan(session.msgEl);
            }, 8000);
        }
    }
}

function scheduleEndCheck(sessionId) {
    var session = scanSession;
    if (!session || session.id !== sessionId) return;
    clearTimeout(session.timer);
    session.timer = setTimeout(function() { doEndCheck(sessionId); }, 2000);
}

function doEndCheck(sessionId) {
    var session = scanSession;
    if (!session || session.id !== sessionId) return;
    // [Fix] 等待 结尾### 设上限（30 次×2s=60s）：原实现无限轮询，消息若永远没有 结尾###
    //（停流/手动输入含标记文本/截断）则每 2s 空转一次永不停（C1）。
    session.tries++;
    if (session.tries > 30) {
        session.phase = 'completed';
        try { session.msgEl.removeData('sl_session_started'); } catch (e) {}
        slLog('扫描 #' + sessionId + ' 等待结尾###超时(60s)，放弃（消息有变化时会重新扫描）');
        return;
    }
    var text = session.msgEl.text();
    var clean = stripAiTags(text);
    var startIdx = clean.indexOf('正文###');
    var endIdx = clean.indexOf('结尾###', startIdx + 1);
    if (endIdx >= 0) {
        session.phase = 'done';
        var rawStart = text.indexOf('正文###');
        var rawEnd = text.indexOf('结尾###', rawStart + 1);
        var bodyText = (rawStart >= 0 && rawEnd > rawStart) ? text.slice(rawStart + 5, rawEnd) : text.slice(startIdx + 5, endIdx);
        slLog('扫描 #' + sessionId + ' 检测到 结尾###，提取正文(' + bodyText.length + '字)');
        if (bodyText.length >= (settings.storyMode === 'comic' ? 20 : 80)) {
            slLog('触发管线(标记模式)');
            runAuxImageScan(session.msgEl);
        } else { slLog('正文过短(' + bodyText.length + ')，跳过'); }
        return;
    }
    scheduleEndCheck(sessionId);
}

// ── 全量消息恢复 ──
export function scanAllMsgs() {
    try {
        if (!settings.cWf || !settings.autoGen) return;
        // 分支切换检测：旧 scanSession 的 DOM 已消失 → 清理
        if (scanSession && (!scanSession.msgEl || !scanSession.msgEl.closest('body').length)) {
            slLog('scanSession DOM 已消失（分支切换？），清理');
            clearTimeout(scanSession.timer);
            scanSession = null;
        }
        if (jQuery('.edit_textarea').length || jQuery('#curEditTextarea').length) return;
        var chatId = getChatId();
        jQuery('.mes').each(function() {
            var mesEl = jQuery(this).find('.mes_text');
            if (!mesEl.length) return;
            var mesId = jQuery(this).attr('mesid');
            if (!mesId || !mesId.trim()) return;
            var cached = findBestCached(chatId, mesId, mesEl.text());
            if (cached && /\[image:/.test(cached)) {
                if (/sl_img_btn/.test(mesEl.html()) || /sl_img_block/.test(mesEl.html())) return;
                if (hasBodyMarker(cached)) {
                    var bodyContent = cached.slice(cached.indexOf('正文###') + 5, cached.indexOf('结尾###', cached.indexOf('正文###') + 5));
                    renderBodyEnhanced(mesEl, bodyContent);
                } else if (settings.imgMode === 'main') {
                    renderEnhancedLite(mesEl, cached);
                } else {
                    renderEnhanced(mesEl, cached);
                }
            }
        });
    } catch (e) {}
}

// [AI-Fix] 保存 mesId/chatId 在 await 之前，await 后用它重新查找 DOM。
// 原因：await runAuxPipeline 可能持续 30+ 秒，期间 ST 可能重渲染消息元素，
// 导致 await 前捕获的 lastMsg 成为脱离 DOM 的僵尸引用（致命缺陷 1 的子问题）。
// 修复：await 后通过 mesId 重新查找 DOM，并校验消息文本未被其他会话覆盖。
export async function runAuxImageScan(messageElement) {
    try {
        slLog('auxImageScan 启动');
        if (scanSession) scanSession.phase = 'scanning';
        // [Fix] 早退统一复位 phase：有分支在 'scanning' 下直接 return 但忘了复位时，
        // startScanSession 的会话守卫会永久拒绝后续所有消息（静默死锁，A1）。
        function sessDone() { if (scanSession) scanSession.phase = 'completed'; }
        var lastMsg = messageElement || jQuery('.mes_text').last();
        if (!lastMsg.length) { slLog('无消息'); sessDone(); return; }
        if (lastMsg.data('sl_aux_scanned')) { slLog('已扫描过, 跳过'); sessDone(); return; }
        lastMsg.removeData('sl_session_started');
        var rawText = lastMsg.text();
        // 记录文本指纹，用于检测重新生成/swipe
        lastMsg.data('sl_text_fp', getMsgFingerprint(rawText) || rawText.slice(0, 50).replace(/\s/g, ''));
        lastMsg.data('sl_aux_scanned', 1);
        var bodyText = extractBodyText(rawText);
        var minLen = settings.storyMode === 'comic' ? 20 : 80;
        if (bodyText.length < minLen) { slLog('过短(' + bodyText.length + ')'); lastMsg.removeData('sl_aux_scanned'); lastMsg.removeData('sl_session_started'); sessDone(); return; }
        slLog('管线启动, 清洗后: ' + bodyText.length);
        // [AI-Fix] await 前抓取 mesId 和 chatId，await 后据此重新查找 DOM
        var mesContainer = lastMsg.closest('.mes');
        var mesId = mesContainer.length ? mesContainer.attr('mesid') : (Date.now() + '');
        var chatId = getChatId();
        var pipeTimeout = (settings.cTimeout || 180) * 1000 + 30000;
        // ── v2.4 模式分发：main=酒馆AI模式（占位符协作管线），plugin=旧管线 ──
        var pipeFn = settings.imgMode === 'main' ? runRosterPipeline : runAuxPipeline;
        // [Fix] 超时改为 resolve({timedOut:true}) 而不是 reject（C8）：
        // (1) 底层管线拿不到 signal，reject 后仍在后台跑完（档案/剧情库写入照常落地），
        //     此时清 sl_aux_scanned 放行重试会跑出第二条管线——双倍 API 调用 + 档案被两次结果互相覆盖；
        // (2) 保留"已扫描"标记，消息在重新生成/swipe 时才自然重扫。
        var pipePromise = pipeFn(bodyText, mesId);
        var pipeResult = await Promise.race([
            pipePromise,
            new Promise(function(resolve) { setTimeout(function() { resolve({ ok: false, timedOut: true }); }, pipeTimeout); })
        ]);
        if (pipeResult && pipeResult.timedOut) {
            slErr('管线整体超时(' + pipeTimeout + 'ms)，保留扫描标记，后台管线完成后档案会落地');
            if (scanSession) scanSession.phase = 'completed';
            return;
        }
        // [Fix] 无图轮：PROFILE 已更新但无插图，属正常完成（鼓励配图模式）——不缓存、不重试、保留已扫描标记
        if (pipeResult && pipeResult.ok && !pipeResult.enhanced) {
            slLog('无图轮: 档案已更新, 无插图, 正常完成');
            if (scanSession) scanSession.phase = 'completed';
            return;
        }
        var enhanced = pipeResult ? pipeResult.enhanced : null;
        // [AI-Fix] 原逻辑 enhanced=null 时只 log 就 return，不清除 sl_aux_scanned，
        // 导致这条消息被永久标记为"已扫描"，永远不再尝试。现在清除标记允许重试。
        if (!enhanced) {
        var retryCount = (lastMsg.data('sl_noimg_retries') || 0) + 1;
        if (retryCount >= 3) {
            slLog('无增强输出已达3次, 不再重试');
            lastMsg.data('sl_aux_scanned', 1);
        } else {
            slLog('无增强输出(第' + retryCount + '次), 清除标记允许重试');
            lastMsg.data('sl_noimg_retries', retryCount);
            lastMsg.removeData('sl_aux_scanned');
            // [B6] 死字段清理（_castSent 无读取方）
        }
        // [Fix] 失败/重试分支复位会话 phase：原实现漏复位，phase 卡在 'scanning'，
        // 会导致后续新消息的扫描被会话守卫永久拒绝（静默死锁）。
        if (scanSession) scanSession.phase = 'completed';
        return;
    }
        if (!settings.msgMap) settings.msgMap = {};
        // [AI-Fix] 通过 mesId 重新查找 DOM，不依赖 30 秒前的 lastMsg 引用
        var freshContainer = mesId ? jQuery('.mes[mesid="' + mesId + '"]') : jQuery();
        var freshMsg = freshContainer.length ? freshContainer.find('.mes_text') : lastMsg;
        // [AI-Fix] 校验消息文本未被其他扫描会话覆盖（致命缺陷 1 的子问题）
        if (freshContainer.length && freshMsg.data('sl_aux_scanned') && freshMsg.text().slice(0, 50) !== rawText.slice(0, 50)) {
            slLog('消息已被其他会话处理，放弃渲染');
            return;
        }
        var key = getMsgKey(chatId, mesId, freshMsg.text());
        var rawBody = freshMsg.text();
        var startIdx = rawBody.indexOf('正文###');
        var endIdx = rawBody.indexOf('结尾###', startIdx + 1);
        if (startIdx >= 0 && endIdx > startIdx) {
            var reconstructed = rawBody.slice(0, startIdx) + '正文###' + enhanced + '结尾###' + rawBody.slice(endIdx + 5);
            settings.msgMap[key] = reconstructed;
            if (!settings.msgMapTs) settings.msgMapTs = {};
            settings.msgMapTs[key] = Date.now();
            renderBodyEnhanced(freshMsg, enhanced, startIdx, endIdx);
            slLog('标记模式: 增强文本已回填到 正文###...结尾### 区间');
        } else if (settings.imgMode === 'main') {
            // v2.4 酒馆AI模式：只替换占位符为图卡，正文/状态栏原文保留（不重建）
            settings.msgMap[key] = enhanced;
            if (!settings.msgMapTs) settings.msgMapTs = {};
            settings.msgMapTs[key] = Date.now();
            renderEnhancedLite(freshMsg, enhanced);
        } else {
            settings.msgMap[key] = enhanced;
            if (!settings.msgMapTs) settings.msgMapTs = {};
            settings.msgMapTs[key] = Date.now();
            renderEnhanced(freshMsg, enhanced);
        }
        var keys = Object.keys(settings.msgMap);
        if (keys.length > 50) {
            var tsMap = settings.msgMapTs || {};
            var oldestK = keys[0], oldestT = tsMap[oldestK] || 0;
            for (var i = 1; i < keys.length; i++) { var t = tsMap[keys[i]] || 0; if (t && t < oldestT) { oldestK = keys[i]; oldestT = t; } }
            delete settings.msgMap[oldestK];
            delete tsMap[oldestK];
        }
        saveSettings();
        slLog('增强文本已缓存, key=' + key + ' (共' + keys.length + '条缓存)');
        slLog('管线完成, img块:' + (enhanced.match(/\[image:/g) || []).length);
        if (scanSession) scanSession.phase = 'completed';
        scanAllMsgs();
    } catch (e) {
        slErr('管线失败: ' + e.message);
        if (scanSession) scanSession.phase = 'completed';

        // [AI-Fix] 异常时清除 sl_aux_scanned 和 sl_session_started 两个标记，
        // 否则这条消息永久无法重新扫描。原逻辑只清 sl_session_started 且用可能已失效的 lastMsg。
        try {
            var errMsg = messageElement || jQuery('.mes_text').last();
            if (errMsg && errMsg.length) {
                errMsg.removeData('sl_session_started');
                errMsg.removeData('sl_aux_scanned');
            }
        } catch (e2) { slErr('清理失败: ' + e2.message); }
    }
}

// ── 消息指纹（正文###后50字，用于检测🔄 重新生成/swipe切换） ──
export function getMsgFingerprint(text) {
    var si = text.indexOf('正文###');
    if (si >= 0) return text.slice(si + 5, si + 55).replace(/\s/g, '');
    return text.slice(0, 50).replace(/\s/g, '');
}
// ── 为消息缓存生成唯一 key（含指纹，支持 swipe 分支独立缓存） ──
export function getMsgKey(chid, mesid, text) {
    return chid + '_' + mesid + '_' + getMsgFingerprint(text || '').slice(0, 20);
}
// ── 模糊匹配缓存（支持 swipe 分支 + 编辑恢复） ──
export function findBestCached(chid, mesid, text) {
    var msgMap = settings.msgMap || {};
    var key = getMsgKey(chid, mesid, text);
    if (msgMap[key] && /\[image:/.test(msgMap[key])) return msgMap[key];
    var prefix = chid + '_' + mesid + '_';
    for (var k in msgMap) {
        if (k.indexOf(prefix) === 0 && msgMap[k] && /\[image:/.test(msgMap[k])) {
            var cachedText = extractBodyContent(msgMap[k]).slice(0, 40).replace(/\s/g, '');
            var msgText = extractBodyContent(text).slice(0, 40).replace(/\s/g, '');
            if (cachedText && msgText && cachedText === msgText) {
                // 如果有多条匹配，选有 结尾### 的完整条目
                var best = msgMap[k], foundComplete = msgMap[k].indexOf('结尾###') >= 0;
                for (var k2 in msgMap) {
                    if (k2 === k || k2.indexOf(prefix) !== 0) continue;
                    if (!msgMap[k2] || !/\[image:/.test(msgMap[k2])) continue;
                    var ct2 = extractBodyContent(msgMap[k2]).slice(0,40).replace(/\s/g,'');
                    if (ct2 === msgText && msgMap[k2].indexOf('结尾###') >= 0) { best = msgMap[k2]; foundComplete = true; break; }
                }
                return best;
            }
        }
    }
    // [兜底] mesId 前缀不匹配时，遍历全部 msgMap 按正文内容匹配
    // 解决 ST 刷新 DOM 后 mesId 变化导致 img 块无法恢复的问题
    for (var k3 in msgMap) {
        if (!msgMap[k3] || !/\[image:/.test(msgMap[k3])) continue;
        var cachedText3 = extractBodyContent(msgMap[k3]).slice(0, 40).replace(/\s/g, '');
        var msgText3 = extractBodyContent(text).slice(0, 40).replace(/\s/g, '');
        if (cachedText3 && msgText3 && cachedText3 === msgText3) {
            return msgMap[k3];
        }
    }
    return null;
}
// ── 清理某条消息的所有 swipe 分支缓存 ──
export function clearMsgCache(chid, mesid) {
    var prefix = chid + '_' + mesid + '_';
    for (var k in (settings.msgMap || {})) {
        if (k.indexOf(prefix) === 0) { delete settings.msgMap[k]; slLog('清理旧缓存: ' + k); }
    }
}

// ── 轮询 + 事件钩子注册 ──

// ── 事件驱动扫描（替代 2s/3s 高频轮询） ──
// [AI-Fix] 原实现：poll1(3s 全量 scanAllMsgs) + poll2(2s 检测最后一条) 双轮询 + 延迟5s注册事件。
//   问题：轮询空转、事件注册延迟导致事件丢失、MESSAGE_UPDATED 只恢复图片不触发扫描。
//   新实现：ST 官方事件驱动（MESSAGE_RECEIVED/GENERATION_ENDED/SWIPED/EDITED/UPDATED/CHAT_CHANGED），
//   仅保留 10s 低频兜底轮询（事件丢失保护），成本约为原来的 1/5。

function checkLastMessage() {
    try {
        if (settings.pluginOn === false) return;
        var all = jQuery('.mes_text');
        if (!all || !all.length) return;
        var last = all.last();
        if (!last || !last.length) return;
        var rawText = last.text() || '';
        // v2.4：main 模式只要求 [img: （正文###标记由酒馆侧决定，插件不管）；plugin 模式维持原逻辑
        if (settings.imgMode === 'main') {
            if (rawText.indexOf('[img:') < 0) return;
        } else {
            // 只检测正文###，不要求结尾###同时存在（startScanSession 会等结尾###）
            if (rawText.indexOf('正文###') < 0) return;
        }
        // 从 DOM 中获取 mesid：优先 closest->parents 兜底
        var mesContainer = last.closest('.mes');
        if (!mesContainer || !mesContainer.length) mesContainer = last.parents('.mes').first();
        var mesId = mesContainer.length ? mesContainer.attr('mesid') : null;
        if (!mesId) { slLog('检查: 未获取到mesId, 跳过'); return; }
        var chatId = getChatId();
        if (last.data('sl_session_started')) return;     // 已有扫描会话，等待完成
        if (last.data('sl_aux_scanned')) {
            var oldFp = last.data('sl_text_fp');
            var newFp = getMsgFingerprint(rawText) || rawText.slice(0, 50).replace(/\s/g, '');
            if (oldFp && oldFp !== newFp) {
                slLog('检查: 检测到文本变化(重新生成/swipe), 清除旧渲染');
                resetMessageMarkers(last);
            } else { return; }
        }
        var bodyText = extractBodyText(rawText);
        if (bodyText.length < (settings.storyMode === 'comic' ? 20 : 80)) { slLog('检查: 正文过短(' + bodyText.length + '字), 跳过'); return; }
        // 已有缓存内容则跳过新扫描（防止重启后二次扫描覆盖缓存）
        var cachedContent = findBestCached(chatId, mesId, rawText);
        if (cachedContent && /\[image:/.test(cachedContent)) { slLog('检查: 已有缓存, 跳过扫描, mesId=' + mesId); return; }
        slLog('检查: 检测到标记, 启动扫描会话, mesId=' + mesId);
        startScanSession(last, mesId, chatId);
    } catch (e) { slErr('消息检查异常: ' + e.message); }
}

function resetMessageMarkers(el) {
    el.removeData('sl_aux_scanned');
    el.removeData('sl_session_started');
    el.find('.sl_img_block, .sl_img_btn').remove();
    el.css({ background: '', 'border-left': '', padding: '', 'border-radius': '', 'line-height': '', color: '', 'font-size': '', overflow: '' });
}

// [AI-Fix] 编辑/swipe：清除该消息旧渲染并按新内容重新扫描
function handleMessageChanged(messageId) {
    try {
        if (settings.pluginOn === false) return;
        var el = messageId != null ? jQuery('.mes[mesid="' + messageId + '"]') : jQuery();
        if (!el || !el.length) { checkLastMessage(); return; }
        var msgText = el.find('.mes_text').first();
        if (!msgText || !msgText.length) { checkLastMessage(); return; }
        slLog('消息变更(编辑/swipe) mesid=' + messageId + ', 清除旧渲染');
        resetMessageMarkers(msgText);
        var text = msgText.text() || '';
        if (settings.imgMode === 'main') { if (text.indexOf('[img:') < 0) return; }
        else { if (text.indexOf('正文###') < 0) return; }
        var bodyText = extractBodyText(text);
        if (bodyText.length < (settings.storyMode === 'comic' ? 20 : 80)) { slLog('变更: 正文过短, 跳过'); return; }
        var cachedContent = findBestCached(getChatId(), messageId, text);
        if (cachedContent && /\[image:/.test(cachedContent)) { slLog('变更: 已有缓存, 跳过扫描'); return; }
        slLog('变更: 启动扫描会话, mesId=' + messageId);
        startScanSession(msgText, messageId, getChatId());
    } catch (e) { slErr('消息变更处理异常: ' + e.message); }
}

export function startPolling() {
    // [AI-Fix] 幂等守卫：防止重复注册定时器和事件钩子
    if (startPolling._active) return;
    startPolling._active = true;
    slLog('startPolling: 启动事件驱动扫描');
    var ctx = null, evSrc = null, evTypes = null;
    try {
        ctx = getSTContext();
        evSrc = ctx.eventSource;
        evTypes = ctx.event_types || ctx.eventTypes;
    } catch (e) { slLog('事件源获取失败, 仅兜底轮询: ' + e.message); }

    if (evSrc && evSrc.on && evTypes) {
        var onReceived = function() { checkLastMessage(); };
        var onGenEnded = function() { checkLastMessage(); };
        var onMsgUpdated = function() { setTimeout(restoreImageBlocks, 300); };
        var onMsgChanged = function(messageId) { handleMessageChanged(messageId); };
        var onChatChanged = function() {
            slLog('检测到聊天切换喵~ 清理旧会话中… ✨');
            if (scanSession) { clearTimeout(scanSession.timer); scanSession = null; }
            try { refreshCoopCards(); } catch (e) { slLog('协作卡刷新异常: ' + e.message); }
            var last = jQuery('.mes_text').last();
            setTimeout(function() { restoreImageBlocks(); scanAllMsgs(); }, 2000);
        };
        if (evTypes.MESSAGE_RECEIVED) evSrc.on(evTypes.MESSAGE_RECEIVED, onReceived);
        if (evTypes.GENERATION_ENDED) evSrc.on(evTypes.GENERATION_ENDED, onGenEnded);
        if (evTypes.MESSAGE_UPDATED) evSrc.on(evTypes.MESSAGE_UPDATED, onMsgUpdated);
        if (evTypes.MESSAGE_SWIPED) evSrc.on(evTypes.MESSAGE_SWIPED, onMsgChanged);
        if (evTypes.MESSAGE_EDITED) evSrc.on(evTypes.MESSAGE_EDITED, onMsgChanged);
        if (evTypes.CHAT_CHANGED) evSrc.on(evTypes.CHAT_CHANGED, onChatChanged);
        startPolling._handlers = { onReceived: onReceived, onGenEnded: onGenEnded, onMsgUpdated: onMsgUpdated, onMsgChanged: onMsgChanged, onChatChanged: onChatChanged };
        slLog('ST 事件钩子就绪喵~ ✨');
        // [BugFix v3.1] 退出重进/刷新后历史图片不恢复：事件驱动改革删除了旧轮询恢复，
        // 但刷新后无任何事件 → restoreImageBlocks/scanAllMsgs 永不被调。首次延迟统一恢复。
        setTimeout(function () { try { restoreImageBlocks(); scanAllMsgs(); slLog('初始恢复: 历史图片扫描完成'); } catch (e) { slErr('初始恢复异常: ' + e.message); } }, 1500);
    } else {
        slLog('事件源不可用, 降级为 10s 兜底轮询');
        setTimeout(function () { try { restoreImageBlocks(); scanAllMsgs(); } catch (e) { slErr('初始恢复异常: ' + e.message); } }, 1500);
    }

    // [AI-Fix] 10s 低频兜底轮询（事件丢失保护），替代原 2s+3s 双轮询
    startPolling._fallback = setInterval(function() {
        try {
            if (settings.pluginOn === false) return;
            checkLastMessage();
        } catch (e) { slErr('兜底轮询异常: ' + e.message); }
    }, 10000);
}

export function stopPolling() {
    slLog('stopPolling: 停止扫描');
    startPolling._active = false;
    if (startPolling._fallback) { clearInterval(startPolling._fallback); startPolling._fallback = null; }
    if (startPolling._hookTimer) { clearTimeout(startPolling._hookTimer); startPolling._hookTimer = null; }
    try {
        var ctx = getSTContext();
        var evSrc = ctx.eventSource;
        var evTypes = ctx.event_types || ctx.eventTypes;
        var hs = startPolling._handlers;
        if (evSrc && evSrc.off && evTypes && hs) {
            if (evTypes.MESSAGE_RECEIVED && hs.onReceived) evSrc.off(evTypes.MESSAGE_RECEIVED, hs.onReceived);
            if (evTypes.GENERATION_ENDED && hs.onGenEnded) evSrc.off(evTypes.GENERATION_ENDED, hs.onGenEnded);
            if (evTypes.MESSAGE_UPDATED && hs.onMsgUpdated) evSrc.off(evTypes.MESSAGE_UPDATED, hs.onMsgUpdated);
            if (evTypes.MESSAGE_SWIPED && hs.onMsgChanged) evSrc.off(evTypes.MESSAGE_SWIPED, hs.onMsgChanged);
            if (evTypes.MESSAGE_EDITED && hs.onMsgChanged) evSrc.off(evTypes.MESSAGE_EDITED, hs.onMsgChanged);
            if (evTypes.CHAT_CHANGED && hs.onChatChanged) evSrc.off(evTypes.CHAT_CHANGED, hs.onChatChanged);
            startPolling._handlers = null;
        }
    } catch (e) { slErr('stopPolling 清理钩子异常: ' + e.message); }
}
// 检查当前角色卡是否有静态档案缓存
export function hasCastCache() {
    try {
        var pf = getProfiles();
        return pf && Object.keys(pf.root[pf.charName].cast || {}).length > 0;
    } catch(e) { return false; }
}

// 暴露扫描器状态给 UI 小窗
export function getScannerStatus() {
    if (!settings.pluginOn) return 'off';
    if (!scanSession) return 'idle';
    var p = scanSession.phase || '';
    if (p === 'wait_marker') return 'waiting_body';
    if (p === 'wait_end') return 'waiting_end';
    if (p === 'scanning') return 'scanning';
    if (p === 'completed') return 'completed';
    if (p === 'done') return 'completed';
    return 'scanning';
}

// ══════════════════════════════




