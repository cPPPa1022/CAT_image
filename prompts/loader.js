// ── SillyImage Lab 提示词加载器 ──
// 从 prompts/ 文件夹异步加载提示词文件，缓存到内存

var PROMPTS_CACHE = {};
var PROMPTS_LOADED = false;

export async function loadPrompts(baseUrl) {
    var files = [
        'static-profile/system.txt',
        'roster/system.txt',
        'atomic-vocab.txt',
        'ratio-to-atom.txt',
        'pipeline/zit-overlay.txt',
        'pipeline/anime-overlay.txt',
        'pipeline/anime-tag-overlay.txt',
        'pipeline/nsfw-overlay.txt',
        'pipeline/summary.txt',
        'main-llm-instruction.txt',
    ];
    var loaded = 0;
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        try {
            var url = baseUrl.replace(/\/+$/, '') + '/' + f + '?t=' + Date.now();
            var r = await fetch(url);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            PROMPTS_CACHE[f] = f.endsWith('.json') ? await r.json() : await r.text();
            loaded++;
        } catch (e) {
            console.warn('[SillyLab] 提示词加载跳过: ' + f + ' — ' + (e.message || '').slice(0, 80));
        }
    }
    PROMPTS_LOADED = true;
    console.warn('[SillyLab] 提示词加载: ' + loaded + '/' + files.length + (loaded === 0 ? ' (全部失败，使用默认值)' : ''));
}

export function getPrompt(path) {
    return PROMPTS_CACHE[path];
}

export function isPromptsLoaded() {
    return PROMPTS_LOADED;
}