// ── SillyImage Lab 渲染 ──
import { slLog, slErr } from './log.js';
import { settings, COLORS, escapeHtml, getSTContext, saveSettings, getActiveMode } from './settings.js';

// ── 增强文本主题 CSS ──
export function getThemeCSS() {
    var t = settings.enhancedTheme || 'default';
    switch (t) {
        case 'book':
            return {
                background: '#ede4d3',
                'border-left': '3px solid #8b7355',
                'border-right': '1px solid #c4b698',
                padding: '14px 20px',
                'border-radius': '6px',
                'line-height': '1.9',
                color: '#3d2b1f',
                'font-size': '13px',
                'font-family': 'Georgia, "Noto Serif SC", serif',
                overflow: 'visible'
            };
        case 'minimal':
            return {
                background: 'transparent',
                'border-left': 'none',
                'border-bottom': '1px solid #e0e0e0',
                padding: '8px 0',
                'border-radius': '0',
                'line-height': '1.8',
                color: COLORS.text,
                'font-size': '13px',
                overflow: 'visible'
            };
        case 'dark':
            return {
                background: '#111',
                'border-left': '3px solid #5af',
                padding: '12px 16px',
                'border-radius': '10px',
                'line-height': '1.8',
                color: '#fff',
                'font-size': '13px',
                overflow: 'visible'
            };
        case 'cat':
            return {
                background: 'linear-gradient(135deg, #fff5f5 0%, #ffe8ec 100%)',
                'border-left': '4px solid #ff9eb5',
                'border-top': '2px solid #ffb8c9',
                'border-right': '2px solid #ffb8c9',
                'border-bottom': '2px solid #ffb8c9',
                padding: '16px 20px',
                'border-radius': '16px',
                'line-height': '1.9',
                color: '#3d2b3d',
                'font-size': '13px',
                overflow: 'visible',
                'box-shadow': '0 2px 12px rgba(255,158,181,0.2), inset 0 0 0 1px rgba(255,158,181,0.15)',
                position: 'relative',
                'font-family': '"Noto Sans SC", "Segoe UI Emoji", sans-serif'
            };
        default: // 'default'
            return {
                background: '#f5f0eb',
                'border-left': '3px solid #5fa88c',
                padding: '12px 16px',
                'border-radius': '10px',
                'line-height': '1.8',
                color: '#2d3e4f',
                'font-size': '13px',
                overflow: 'visible'
            };
    }
}
import { imgCacheGet, imgCacheSet } from './cache.js';
import { extractImagePrompt, extractBodyContent, hasBodyMarker, cleanAnimePrompt } from './text-utils.js';
import { resolveFacePrompt } from './pipeline/profile.js';
import { generateImage } from './comfyui.js';

// ── 构造 img 卡片 HTML ──
export function buildImgCard(scene, fullPrompt, cachedImage) {
    return '<div class="sl_img_block" style="margin:8px 0;padding:10px 12px;border-radius:10px;background:' + COLORS.card + ';border:1px solid ' + COLORS.line + ';" title="' + escapeHtml(fullPrompt) + '">' +
        '<div style="font-size:11px;color:' + COLORS.sub + ';margin-bottom:4px;">' + escapeHtml(scene.slice(0, 100)) + '</div>' +
        (cachedImage ? '<img src="' + escapeHtml(cachedImage) + '" style="max-width:100%;border-radius:12px;margin-top:6px;display:block;">' : '') +
        '<span class="sl_img_btn" data-prompt="' + escapeHtml(fullPrompt) + '" style="display:inline-block;padding:5px 14px;margin-top:4px;background:' + (cachedImage ? COLORS.card : COLORS.blue) + ';color:' + (cachedImage ? COLORS.text : '#fff') + ';border-radius:8px;cursor:pointer;font-size:11px;font-weight:600;">' + (cachedImage ? '\u21bb \u91cd\u65b0\u751f\u6210' : '\u2726 \u751f\u6210\u56fe\u7247') + '</span>' +
        (fullPrompt !== scene ? '<div style="font-size:10px;color:#aeaeb2;font-family:Consolas,monospace;line-height:1.4;margin-top:6px;padding-top:4px;border-top:1px dotted ' + COLORS.line + ';word-break:break-all;">🐱 ' + escapeHtml(fullPrompt) + '</div>' : '') +
        '</div>';
}

// ── 纯渲染 enhanced 正文为 HTML ──
export function renderEnhancedBodyHtml(enhanced) {
    var imageScenes = [];
    var pid = 0;
    var safe = enhanced.replace(/\[image:\s*[\s\S]*?\]/g, function(m, cap, off) {
        var match = m.match(/\[image:\s*([\s\S]*?)\]/);
        var scene = (match && match[1]) ? match[1].trim() : '';
        // [Fix] 记录该 [image:] 块在原文中的位置，提示词按位置提取（B4）
        imageScenes.push({ scene: scene, idx: off });
        return '__SLIMG' + (pid++) + '__';
    });
    safe = safe.replace(/\n?\s*【💬 💬 提示词】[^\n]*\n?/g, '\n');
    safe = safe.replace(/\n?\s*【提示词[】:：][^\n]*【\/提示词】/g, '\n');
    safe = safe.replace(/\n?\s*【提示词[】:：][\s\S]*?【\/提示词】/g, '\n');
    safe = safe.replace(/\n?\s*【提示词[】:：][^\n]*/g, '\n');
    safe = safe.replace(/\n{1,2}/g, '\n\n');
    return safe.split('\n').map(function(line) { return escapeHtml(line); }).join('<br>')
        .replace(/__SLIMG(\d+)__/g, function(_, n) {
            var imgInfo = imageScenes[+n] || {};
            var scene = imgInfo.scene || '';
            var imageTag = '[image: ' + scene + ']';
            // [Fix] 按该块位置提取提示词：同场景多图不再共用第一块的【提示词】（B4）
            var pc = extractImagePrompt(enhanced, imageTag, imgInfo.idx) || '';
            var fullPrompt = resolveFacePrompt(pc || scene);
            if (getActiveMode() === 'anime' || getActiveMode() === 'anime_tag') { var _c = cleanAnimePrompt(fullPrompt); if (_c) fullPrompt = _c; }  // 使用 getActiveMode 统一查询锁定的模式；删空则保留原文（防中文提示词被清成空串）
            // [Fix] 旧缓存 key 兼容：644d40c 前缓存 key=scene+', '+prompt，否则刷新后需重新生成
            return buildImgCard(scene, fullPrompt, imgCacheGet(fullPrompt) || (pc && scene ? imgCacheGet(scene + ', ' + pc) : null));
        });
}

// ── 正文###...结尾### 区间渲染 ──
export function renderBodyEnhanced(element, enhanced, startIdx, endIdx) {
    // 外部传入了纯文本定位 → 用纯文本切分重建
    if (startIdx !== undefined && endIdx !== undefined) {
        var html2 = element.html();
        var bodyIdx = html2.indexOf('正文###');
        if (bodyIdx === -1) { renderEnhanced(element, enhanced); return; }
        var beforeHtml = html2.slice(0, bodyIdx);
        var afterHtml = html2.slice(html2.indexOf('结尾###', bodyIdx + 1) + 5);
        var rebuilt = beforeHtml + renderEnhancedBodyHtml(enhanced) + afterHtml;
        element.html(rebuilt);
    } else {
        // 旧逻辑：HTML 地图找标记
        var html = element.html();
        startIdx = html.indexOf('正文###');
        endIdx = html.indexOf('结尾###', startIdx + 1);
        if (startIdx === -1 || endIdx === -1) { renderEnhanced(element, enhanced); return; }
        
    var cssStr = Object.keys(getThemeCSS()).map(function(k) { return k + ":" + getThemeCSS()[k]; }).join(";");
    element.html(html.slice(0, startIdx) + '<div class="sl_enhanced" style="' + cssStr + '">' + renderEnhancedBodyHtml(enhanced) + '</div>' + html.slice(endIdx + 5));

    }
    element.css(getThemeCSS());
    element.addClass('sl_enhanced');
    // 小猫模式装饰
    if (settings.enhancedTheme === 'cat' && !element.find('.sl_cat_deco').length) {
        element.prepend('<div class="sl_cat_deco" style="font-size:20px;line-height:1;margin-bottom:4px;opacity:0.5;user-select:none;">🐱<span style="font-size:10px;margin-left:4px;color:#ff9eb5;">meow~</span></div>');
    }
    if (settings.autoGen === 1 && !_restoringBlocks) { setTimeout(function() { element.find('.sl_img_btn').each(function() { var b = jQuery(this); if (b.text().indexOf('生成图片') >= 0) b.trigger('click'); }); }, 600); }
}

// ── 全量渲染（无标记 fallback） ──
export function renderEnhanced(element, text) {
    var protect = {}, pid = 0;
    var safe = text.replace(/\[image:\s*[\s\S]*?\]/g, function(m) {
        var key = '__SLIMG' + (pid++) + '__';
        protect[key] = m;
        return key;
    });
    safe = safe.replace(/\n?\s*【💬 💬 提示词】[^\n]*\n?/g, '\n');
    safe = safe.replace(/\n?\s*【提示词】[^\n]*\n?/g, '\n');
    safe = safe.replace(/\n{1,2}/g, '\n\n');
    element.html(safe.split('\n').map(function(l) { return escapeHtml(l); }).join('<br>')
        .replace(/__SLIMG(\d+)__/g, function(_, n) { return protect['__SLIMG' + n + '__']; }));
    scanDom(element);
    element.css(getThemeCSS());
    if (settings.enhancedTheme === 'cat' && !element.find('.sl_cat_deco').length) {
        element.prepend('<div class="sl_cat_deco" style="font-size:20px;line-height:1;margin-bottom:4px;opacity:0.5;user-select:none;">🐱<span style="font-size:10px;margin-left:4px;color:#ff9eb5;">meow~</span></div>');
    }
    element.addClass('sl_enhanced');
    if (settings.autoGen === 1 && !_restoringBlocks) { setTimeout(function() { element.find('.sl_img_btn').each(function() { var b = jQuery(this); if (b.text().indexOf('生成图片') >= 0) b.trigger('click'); }); }, 600); }
}

// ── 绑定生图按钮（事件委托：绑定一次永久有效，不受 DOM 重建影响） ──
var _imgBtnBound = false;
function bindImageButtonsGlobal() {
    if (_imgBtnBound) return;
    _imgBtnBound = true;
    jQuery(document).on('click', '.sl_img_btn', async function() {
        var btn = jQuery(this), prompt = btn.data('prompt');
        if (btn.text() === '排队中…') return;
        enqueueGen(btn, prompt);
    });
}
bindImageButtonsGlobal();
// 排队引用由 queue.js / index.js 提供，这里先声明
var _enqueueGen = null;
export function setEnqueueGen(fn) { _enqueueGen = fn; }
function enqueueGen(btn, prompt) { if (_enqueueGen) _enqueueGen(btn, prompt); else { slErr('enqueueGen 未初始化'); } }

// ── 扫描 DOM 中的 [image:] 标记 ──
export function scanDom(messageDiv) {
    if (/sl_img_btn/.test(messageDiv.html()) || /sl_img_block/.test(messageDiv.html())) return;
    var raw = messageDiv.text();
    if (!/\[image:/.test(raw)) return;
    var rawOriginal = raw;
    raw = raw.replace(/\n?\s*【💬 提示词】[^\n]*\n?/g, '\n');
    var parts = raw.split(/(\[image:\s*[\s\S]*?\])/g);
    var posCursor = 0;
    var html = parts.map(function(part) {
        if (/^\[image:/.test(part)) {
            var match = part.match(/\[image:\s*([\s\S]*?)\]/);
            var scene = (match && match[1]) ? match[1].trim() : '';
            // [Fix] 从当前位置向后取提示词，同场景多图不共用第一块（B4）
            var partIdx = rawOriginal.indexOf(part, posCursor);
            if (partIdx >= 0) posCursor = partIdx + part.length;
            var promptContent = extractImagePrompt(rawOriginal, part, partIdx >= 0 ? partIdx : 0) || '';
            // [Fix] 提示词只用【提示词】块内容（无则回退场景）：场景段是"画面描述/标题"用途，
            // 拼进提示词会把剧情叙述文字+角色名一起喂给生图模型（与 renderEnhancedBodyHtml 对齐）
            var fullPrompt = resolveFacePrompt(promptContent || scene);
            if (getActiveMode() === 'anime' || getActiveMode() === 'anime_tag') { var _c2 = cleanAnimePrompt(fullPrompt); if (_c2) fullPrompt = _c2; }  // 使用 getActiveMode 统一查询锁定的模式；删空则保留原文
            // [Fix] 旧缓存 key 兼容（644d40c 前缓存 key=scene+', '+prompt）
            return buildImgCard(scene, fullPrompt, imgCacheGet(fullPrompt) || (promptContent && scene ? imgCacheGet(scene + ', ' + promptContent) : null));
        }
        return escapeHtml(part).replace(/\n/g, '<br>');
    }).join('');
    messageDiv.html(html);
}

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
        if (!cached || !/\[image:/.test(cached)) {
            var fpPrefix = key + '_';
            var mHead = (extractBodyContent(mesRawText) || '').slice(0, 40).replace(/\s/g, '');
            var kvMatch = null, kvFallback = null;
            for (var kk in msgMap) {
                if (kk.indexOf(fpPrefix) !== 0 || !msgMap[kk] || !/\[image:/.test(msgMap[kk])) continue;
                if (!kvFallback) kvFallback = msgMap[kk];
                var kHead = (extractBodyContent(msgMap[kk]) || '').slice(0, 40).replace(/\s/g, '');
                if (kHead && mHead && kHead === mHead) {
                    kvMatch = msgMap[kk];
                    if (msgMap[kk].indexOf('结尾###') >= 0) break;  // 优先带完整标记的条目
                }
            }
            cached = kvMatch || kvFallback;
        }
        // 模糊匹配编辑后的 mesId 变化
        if (!cached) {
            var msgText = mesEl.text().slice(0, 120);
            var msgMap = settings.msgMap || {};
            for (var k in msgMap) {
                if (k.indexOf(chatId + '_') === 0 && msgMap[k] && /\[image:/.test(msgMap[k])) {
                    var cachedText = extractBodyContent(msgMap[k]).slice(0, 120);
                    if (cachedText && msgText && (cachedText.indexOf(msgText.slice(0, 40)) >= 0 || msgText.indexOf(cachedText.slice(0, 40)) >= 0)) {
                        // 多条匹配时选有 结尾### 的完整条目
                        var best = msgMap[k];
                        for (var k2 in msgMap) {
                            if (k2 === k || k2.indexOf(chatId + '_') !== 0) continue;
                            var ct2 = extractBodyContent(msgMap[k2]).slice(0,120);
                            if (ct2 && (ct2.indexOf(msgText.slice(0,40))>=0 || msgText.indexOf(ct2.slice(0,40))>=0) && msgMap[k2].indexOf('结尾###')>=0) { best = msgMap[k2]; break; }
                        }
                        cached = best;
                        slLog('编辑恢复: 模糊匹配', k, '→', mesId);
                        break;
                    }
                }
            }
        }
        if (!cached || !/\[image:/.test(cached)) return;
        var bodyOnly = hasBodyMarker(cached) ? extractBodyContent(cached) : null;
        // v2.4 酒馆AI模式：只替换占位符，保留原文 HTML（状态栏等）
        if (settings.imgMode === 'main' && !bodyOnly) {
            renderEnhancedLite(mesEl, cached); restoreImageBlocks._lastCount++;
        } else if (bodyOnly && /\[image:/.test(bodyOnly)) {
            renderBodyEnhanced(mesEl, bodyOnly); restoreImageBlocks._lastCount++;
        } else {
            renderEnhanced(mesEl, cached); restoreImageBlocks._lastCount++;
        }
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
export function extractImgBlocksFromEnhanced(enhancedText) {
    var blocks = [];
    if (!enhancedText) return blocks;
    var re = /\[image:\s*([\s\S]*?)\]/g;
    var m;
    while ((m = re.exec(enhancedText)) !== null) {
        var scene = (m[1] || '').trim();
        // [Fix] 用正则匹配位置定位提示词（同场景多图不共用第一块，B4）
        var promptContent = extractImagePrompt(enhancedText, m[0], m.index) || '';
        // [Fix] 提示词只用【提示词】块内容（无则回退场景）：导演模式场景是主 LLM 写的长叙事
        // （人物动作/表情/衣着），拼进提示词会把剧情文字+角色名喂给生图模型（与 renderEnhancedBodyHtml 对齐）
        var fullPrompt = resolveFacePrompt(promptContent || scene);
        if (getActiveMode() === 'anime' || getActiveMode() === 'anime_tag') { var _c = cleanAnimePrompt(fullPrompt); if (_c) fullPrompt = _c; }
        // [Fix] 旧缓存 key 兼容（644d40c 前缓存 key=scene+', '+prompt），否则刷新后需重新生成
        blocks.push({ scene: scene, prompt: fullPrompt, html: buildImgCard(scene, fullPrompt, imgCacheGet(fullPrompt) || (promptContent && scene ? imgCacheGet(scene + ', ' + promptContent) : null)) });
    }
    return blocks;
}

export function renderEnhancedLite(element, enhancedText) {
    if (!element || !element.length) return;
    if (element.find('.sl_img_block').length) return;  // 已渲染防重
    var blocks = extractImgBlocksFromEnhanced(enhancedText);
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

