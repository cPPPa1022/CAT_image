// ── SillyImage Lab 生图排队 ──
import { slLog } from './log.js';
import { settings, COLORS, getSTContext, getActiveMode, escapeHtml } from './settings.js';
import { imgCacheSet } from './cache.js';
import { generateImage } from './comfyui.js';
import { cleanAnimePrompt } from './text-utils.js';
import { resolveFacePrompt } from './pipeline/profile.js';

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
        if (getActiveMode() === 'anime' || getActiveMode() === 'anime_tag') { var _clean = cleanAnimePrompt(prompt); if (_clean) prompt = _clean; }
        var result = await generateImage(workflow, prompt);
        imgCacheSet(task.prompt, result.url);
        if (task.custom) {
            // [Fix] 通用任务（如生成立绘）：由调用方回调处理结果
            task.custom.onSuccess(result);
            slLog('排队完成(任务):', task.id);
        } else {
            task.btn.text('\u21bb \u91cd\u65b0\u751f\u6210').css({ background: COLORS.card, color: COLORS.text });
            task.btn.siblings('img').remove();
            var imgEl = jQuery('<img src="' + escapeHtml(result.url) + '" style="max-width:100%;border-radius:12px;margin-top:6px;display:block;" onload="this.style.display=\'block\'">');
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
    imageQueue.push({ id: id, btn: btn, prompt: prompt });
    slLog('入队:', id, '队列长度:', imageQueue.length);
    processImageQueue();
}

// [Fix] 通用排队任务（立绘等非聊天图按钮的生成）：与聊天图共用同一队列，串行打 ComfyUI
export function enqueueTask(id, prompt, onSuccess, onFail) {
    imageQueue.push({ id: id, prompt: prompt, custom: { onSuccess: onSuccess, onFail: onFail } });
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
