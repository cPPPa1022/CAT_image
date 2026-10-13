// ── SillyImage Lab 渲染 ──
import { slLog, slErr } from './log.js';
import { settings, COLORS, escapeHtml, getActiveMode } from './settings.js';

import { imgCacheGet, imgCacheGetById } from './cache.js';
import { extractImagePrompt, cleanAnimePrompt, imgBlockHead } from './text-utils.js';
import { resolveFacePrompt } from './pipeline/profile.js';

// ── 构造 img 卡片 HTML ──
export function buildImgCard(scene, fullPrompt, cachedImage, blockId) {
    // [Fix] 短标题：详细字段只走生成链（【提示词】/data属性/缓存），不外显——
    // 标题取场景首句(≤14字)，提示词小字默认隐藏（设置 showGenPrompt 可开，调试用）
    var shortTitle = String(scene || '');
    var commaAt = shortTitle.search(/[，。！？、,;!?]/);
    if (commaAt > 0) shortTitle = shortTitle.slice(0, commaAt);
    var truncated = shortTitle.length > 14;
    if (truncated) shortTitle = shortTitle.slice(0, 14);
    var titleText = shortTitle + (truncated ? '…' : '');
    return '<div class="sl_img_block" style="margin:8px 0;padding:10px 12px;border-radius:10px;background:' + COLORS.card + ';border:1px solid ' + COLORS.line + ';" title="' + escapeHtml(titleText) + '">' +
        '<div style="font-size:11px;color:' + COLORS.sub + ';margin-bottom:4px;">🖼️ ' + escapeHtml(titleText) + '</div>' +
        (cachedImage ? '<img src="' + escapeHtml(cachedImage) + '" style="max-width:' + (settings.imgBlockWidth || '55%') + ';border-radius:12px;margin-top:6px;display:block;">' : '') +
        '<span class="sl_img_btn" data-prompt="' + escapeHtml(fullPrompt) + '"' + (blockId ? ' data-slid="' + escapeHtml(blockId) + '"' : '') + ' style="display:inline-block;padding:5px 14px;margin-top:4px;background:' + (cachedImage ? COLORS.card : COLORS.blue) + ';color:' + (cachedImage ? COLORS.text : '#fff') + ';border-radius:8px;cursor:pointer;font-size:11px;font-weight:600;">' + (cachedImage ? '\u21bb \u91cd\u65b0\u751f\u6210' : '\u2726 \u751f\u6210\u56fe\u7247') + '</span>' +
        (settings.showGenPrompt && fullPrompt !== scene ? '<div style="font-size:10px;color:#aeaeb2;font-family:Consolas,monospace;line-height:1.4;margin-top:6px;padding-top:4px;border-top:1px dotted ' + COLORS.line + ';word-break:break-all;">🐱 ' + escapeHtml(fullPrompt) + '</div>' : '') +
        '</div>';
}

// ── 已移除（v1.2）：renderEnhancedBodyHtml / renderBodyEnhanced / renderEnhanced ──
// 这三个是「画师模式」专用的标记式(正文###…结尾###)渲染器，全量重建消息 HTML。
// 导演模式只需原地替换 [img:] 占位符 → 统一走 renderEnhancedLite()，不再重建消息。

// ── 绑定生图按钮（事件委托：绑定一次永久有效，不受 DOM 重建影响） ──
// [v1.1.2 前端卡桥] 图卡可能落在酒馆助手的 iframe 文档里（重前端卡），
// 顶层 document 的委托收不到那里的 click → 按文档分别绑定。
export function bindImageButtonsIn(doc) {
    if (!doc || doc.__sl_imgbtn_bound) return;
    doc.__sl_imgbtn_bound = true;
    jQuery(doc).on('click', '.sl_img_btn', async function() {
        var btn = jQuery(this), prompt = btn.data('prompt');
        if (btn.text() === '排队中…') return;
        enqueueGen(btn, prompt);
    });
}
var _imgBtnBound = false;
function bindImageButtonsGlobal() {
    if (_imgBtnBound) return;
    _imgBtnBound = true;
    bindImageButtonsIn(document);
}
bindImageButtonsGlobal();
// 排队引用由 queue.js / index.js 提供，这里先声明
var _enqueueGen = null;
export function setEnqueueGen(fn) { _enqueueGen = fn; }
function enqueueGen(btn, prompt) { if (_enqueueGen) _enqueueGen(btn, prompt); else { slErr('enqueueGen 未初始化'); } }

// ── 恢复图片块（编辑后） ──
var _getChatId, _getSTContext, _restoringBlocks = false; // 从外部注入的函数
export function setRestoreDeps(getChatIdFn, getContextFn) { _getChatId = getChatIdFn; _getSTContext = getContextFn; }

export function restoreImageBlocks() {
    if (!_getChatId || !_getSTContext) return;
    _restoringBlocks = true;
    restoreImageBlocks._lastCount = 0;  // 本次恢复渲染的图卡数（诊断日志用）
    // [AI-Fix] 所有早退路径都归零 _restoringBlocks，否则 autoGen 永久停摆
    if (jQuery('.edit_textarea').length || jQuery('#curEditTextarea').length) { _restoringBlocks = false; return; }
    var chatId = _getChatId();
    jQuery('.mes').each(function() {
        var mesEl = jQuery(this).find('.mes_text');
        if (!mesEl.length) return;
        var mesId = jQuery(this).attr('mesid');
        if (!mesId) { mesId = jQuery(this).attr('data-mesid') || jQuery(this).attr('id'); }
        if (!mesId || !mesId.trim()) return;
        if (/sl_img_btn/.test(mesEl.html()) || mesEl.find('.sl_img_block').length) return;
        // [Fix] 与 scanner.findBestCached 同口径按当前文本匹配（B3）：
        // 原实现按 chatId_mesId_ 前缀取"第一条"，同一消息多条 swipe 分支时会恢复错图
        var msgMap = settings.msgMap || {};
        var mesRawText = mesEl.text() || '';
        var key = chatId + '_' + mesId;
        var cached = msgMap[key];
        var cachedKey = key;
        if (!cached || !/\[image:/.test(cached)) {
            var fpPrefix = key + '_';
            var mHead = imgBlockHead(mesRawText);
            var kvMatch = null, kvMatchK = null;
            for (var kk in msgMap) {
                if (kk.indexOf(fpPrefix) !== 0 || !msgMap[kk] || !/\[image:/.test(msgMap[kk])) continue;
                var kHead = imgBlockHead(msgMap[kk]);
                if (kHead && mHead && kHead === mHead) {
                    kvMatch = msgMap[kk]; kvMatchK = kk;
                    if (msgMap[kk].indexOf('结尾###') >= 0) break;  // 优先带完整标记的条目
                }
            }
            // [Fix] 不再"取任意前缀首条"（swipe 分支随机取错）；仅接受正文前40字全等的条目
            cached = kvMatch;
            cachedKey = kvMatchK || key;
        }
        // [Fix] 已删除"跨聊天/子串模糊兜底"——它会把旧消息的缓存盗用给新消息（覆盖/串台根源）。
        // 消息→缓存仅允许：精确 key / 前缀内正文前40字全等；失败即放弃（按钮自动重生，绝不盗图）。
        if (!cached || !/\[image:/.test(cached)) return;
        // 导演模式：只替换占位符为图卡，保留原文 HTML（状态栏等）
        renderEnhancedLite(mesEl, cached, cachedKey); restoreImageBlocks._lastCount++;
    });
    _restoringBlocks = false;
    // [Fix] 恢复阶段不自动点击（_restoringBlocks），如果确实缺图（缓存未命中）用户得手点——
    // 恢复结束 800ms 后补一次兜底自动出图（仅"⚡ 生成图片"未生成按钮；已缓存/排队/重新生成不触发）
    if (settings.autoGen === 1) {
        setTimeout(function() {
            if (_restoringBlocks) return;
            jQuery('.sl_img_btn').each(function() {
                var b = jQuery(this);
                if (b.text().indexOf('排队') < 0 && b.text().indexOf('🔄') < 0 && b.text().indexOf('生成图片') >= 0) b.trigger('click');
            });
        }, 800);
    }
}

// ══════════════════════════════
// ── v2.4 轻量渲染（酒馆AI模式）：只替换 [img:…] 占位符为图卡，正文/状态栏原文 HTML 全部保留 ──
// 修复：旧 renderEnhanced 全量重建（escape+<br>）→ 文字挤成一坨、原文 HTML 结构（状态栏等）丢失
export function extractImgBlocksFromEnhanced(enhancedText, blockKey) {
    var blocks = [];
    if (!enhancedText) return blocks;
    var re = /\[image:\s*([\s\S]*?)\]/g;
    var m;
    var blockIdx = 0;
    while ((m = re.exec(enhancedText)) !== null) {
        var scene = (m[1] || '').trim();
        // [Fix] 用正则匹配位置定位提示词（同场景多图不共用第一块，B4）
        var promptContent = extractImagePrompt(enhancedText, m[0], m.index) || '';
        // [Fix] 提示词只用【提示词】块内容（无则回退场景）：导演模式场景是主 LLM 写的长叙事
        // （人物动作/表情/衣着），拼进提示词会把剧情文字+角色名喂给生图模型
        var fullPrompt = resolveFacePrompt(promptContent || scene);
        if (getActiveMode() === 'anime' || getActiveMode() === 'anime_tag') { var _c = cleanAnimePrompt(fullPrompt); if (_c) fullPrompt = _c; }
        // [Fix] 旧缓存 key 兼容（644d40c 前缓存 key=scene+', '+prompt），否则刷新后需重新生成
        var bid = blockKey ? blockKey + '#' + blockIdx : '';
        blockIdx++;
        blocks.push({ scene: scene, prompt: fullPrompt, id: bid, html: buildImgCard(scene, fullPrompt, imgCacheGetById(bid) || imgCacheGet(fullPrompt) || (promptContent && scene ? imgCacheGet(scene + ', ' + promptContent) : null), bid) });
    }
    return blocks;
}

export function renderEnhancedLite(element, enhancedText, blockKey) {
    if (!element || !element.length) return;
    if (element.find('.sl_img_block').length) return;  // 已渲染防重
    var blocks = extractImgBlocksFromEnhanced(enhancedText, blockKey);
    if (!blocks.length) return;
    var bi = 0;
    try {
        // 按序在文本节点中找 [img:…] 占位符，原位替换为图卡（其余 HTML 原样保留）
        var walker = document.createTreeWalker(element[0], NodeFilter.SHOW_TEXT, {
            acceptNode: function(n) {
                var v = n.nodeValue || '';
                if (v.indexOf('[img:') >= 0) return NodeFilter.FILTER_ACCEPT;
                return NodeFilter.FILTER_REJECT;
            }
        });
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (var ni = 0; ni < nodes.length && bi < blocks.length; ni++) {
            var node = nodes[ni];
            var val = node.nodeValue || '';
            var idx = val.indexOf('[img:');
            if (idx < 0) continue;
            var close = val.indexOf(']', idx);
            if (close < 0) continue;  // 跨节点未闭合 → 跳过，交给末尾兜底
            var before = val.slice(0, idx);
            var after = val.slice(close + 1);
            var frag = document.createDocumentFragment();
            if (before) frag.appendChild(document.createTextNode(before));
            var tmp = document.createElement('div');
            tmp.innerHTML = blocks[bi].html;
            while (tmp.firstChild) frag.appendChild(tmp.firstChild);
            if (after) frag.appendChild(document.createTextNode(after));
            node.parentNode.replaceChild(frag, node);
            bi++;
            slLog('Lite渲染: 第' + bi + '个占位符已替换为图卡');
        }
    } catch (e) { slLog('Lite渲染节点替换异常: ' + e.message); }
    // 兜底：占位符找不到（节点被切分/包裹）→ 图卡追加消息末尾，不丢图
    if (bi < blocks.length) {
        var left = blocks.length - bi;
        for (; bi < blocks.length; bi++) element.append(blocks[bi].html);
        slLog('Lite渲染: 兜底追加 ' + left + ' 张图卡');
    }
    if (settings.autoGen === 1 && !_restoringBlocks) {
        setTimeout(function() { element.find('.sl_img_btn').each(function() { var b = jQuery(this); if (b.text().indexOf('生成图片') >= 0) b.trigger('click'); }); }, 600);
    }
}

