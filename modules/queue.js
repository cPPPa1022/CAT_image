// ── SillyImage Lab 生图排队 ──
import { slLog } from './log.js';
import { settings, COLORS, getSTContext, getActiveMode, isEnglishMode, escapeHtml } from './settings.js';
import { imgCacheSet, imgCacheSetById } from './cache.js';
import { generateImage } from './comfyui.js';
import { cleanAnimePrompt } from './text-utils.js';
import { resolveFacePrompt, getCharacterName, getChatId } from './pipeline/profile.js';
import { galleryAdd } from './gallery.js';

// v1.21：生成时刻的归属（图库按【角色卡 × 聊天】归档）。入队时抓一次，避免排队期间切聊天串台。
function _genOwner() {
    var o = { charName: '', chatKey: '' };
    try { o.charName = getCharacterName() || ''; } catch (e) {}
    try { o.chatKey = getChatId() || ''; } catch (e) {}
    return o;
}

var imageQueue = [];
var queueRunning = false;

async function processImageQueue() {
    if (queueRunning || !imageQueue.length) return;
    queueRunning = true;
    var task = imageQueue.shift();
    slLog('排队处理:', task.id, '剩余:', imageQueue.length);
    try {
        var workflow = JSON.parse(settings.cWf);
        var prompt = task.prompt;
        // Anime 模式强制清理中文（删空则保留原文，防空提示词）
        if (isEnglishMode()) { var _clean = cleanAnimePrompt(prompt); if (_clean) prompt = _clean; }
        var result = await generateImage(workflow, prompt);
        imgCacheSet(task.prompt, result.url);
        // v1.21 图库：每张产出的图都记一笔（独立账本，不受 msgMap 50 条上限影响）
        try {
            galleryAdd(result.url, {
                kind: task.custom ? 'portrait' : 'chat',
                scene: task.scene || (task.custom ? String(task.id || '').replace(/^portrait_/, '立绘_') : ''),
                charName: task.charName,
                chatKey: task.chatKey
            });
        } catch (eG) { slLog('图库记录跳过: ' + eG.message); }
        // [Fix] 图块精确缓存：按块标识（消息key#序号）记录，同一提示词内容不再互相覆盖
        var _slid = task.btn && task.btn.data ? task.btn.data('slid') : '';
        if (_slid) imgCacheSetById(_slid, result.url);
        if (task.custom) {
            // [Fix] 通用任务（如生成立绘）：由调用方回调处理结果
            task.custom.onSuccess(result);
            slLog('排队完成(任务):', task.id);
        } else {
            task.btn.text('\u21bb \u91cd\u65b0\u751f\u6210').css({ background: COLORS.card, color: COLORS.text });
            task.btn.siblings('img').remove();
            // [v1.1.2 前端卡桥] 按钮可能位于酒馆助手的 iframe 文档中：
            // 图片元素必须用该文档创建（跨文档 append 在部分浏览器不渲染），src 用 attr 赋值避免 data URL 被转义
            var _od = (task.btn[0] && task.btn[0].ownerDocument) ? task.btn[0].ownerDocument : document;
            var imgEl = jQuery(_od.createElement('img'));
            imgEl.attr('src', result.url).attr('style', 'max-width:' + (settings.imgBlockWidth || '55%') + ';border-radius:12px;margin-top:6px;display:block;');
            task.btn.after(imgEl);
            imgEl[0].offsetHeight;
            task.btn.parent()[0].offsetHeight;
            getSTContext().saveMetadataDebounced && getSTContext().saveMetadataDebounced();
            // 重新绑定点击，恢复按钮功能
            task.btn.on('click', async function() {
                var b = jQuery(this);
                if (b.text() === '排队中\u2026') return;
                enqueueGen(b, b.data('prompt'));
            });
            slLog('排队完成:', task.id);
        }
    } catch (e) {
        if (task.custom) {
            if (task.custom.onFail) task.custom.onFail(e);
            slLog('排队失败(任务):', task.id, e.message);
        } else {
            task.btn.text('\u2715 \u91cd\u8bd5').css({ background: COLORS.red, color: '#fff' });
            task.btn.on('click', async function() {
                var b = jQuery(this);
                if (b.text() === '排队中\u2026') return;
                enqueueGen(b, b.data('prompt'));
            });
            slLog('排队失败:', task.id, e.message);
        }
    }
    queueRunning = false;
    processImageQueue();
}

export function enqueueGen(btn, prompt) {
    var id = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    btn.text('排队中\u2026').css({ background: COLORS.orange, color: '#fff' }).off('click');
    var _own = _genOwner(), _scene = '';
    try { _scene = String(btn.closest('.sl_img_block').find('div').first().text() || '').replace(/^🖼️\s*/, '').slice(0, 60); } catch (eS) {}
    imageQueue.push({ id: id, btn: btn, prompt: prompt, scene: _scene, charName: _own.charName, chatKey: _own.chatKey });
    slLog('入队:', id, '队列长度:', imageQueue.length);
    processImageQueue();
}

// [Fix] 通用排队任务（立绘等非聊天图按钮的生成）：与聊天图共用同一队列，串行打 ComfyUI
export function enqueueTask(id, prompt, onSuccess, onFail) {
    var _own = _genOwner();
    imageQueue.push({ id: id, prompt: prompt, custom: { onSuccess: onSuccess, onFail: onFail }, charName: _own.charName, chatKey: _own.chatKey });
    slLog('入队(任务):', id, '队列长度:', imageQueue.length);
    processImageQueue();
}

export function getQueueLength() {
    return imageQueue.length;
}

export function clearQueue() {
    imageQueue = [];
    queueRunning = false;
    slLog('排队已清空');
}
