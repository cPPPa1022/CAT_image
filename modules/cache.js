// ── SillyImage Lab 图片缓存 ──
import { slLog } from './log.js';
import { settings, getSTHeaders, saveSettings } from './settings.js';

var imageCache = {};

export function imgCacheLoad() {
    try {
        var data = localStorage.getItem('slimg_cache');
        if (data) imageCache = JSON.parse(data);
    } catch (e) { imageCache = {}; }
}

export function imgCacheSet(prompt, url) {
    imageCache[prompt] = url;
    try { localStorage.setItem('slimg_cache', JSON.stringify(imageCache)); } catch (e) {}
}

export function imgCacheGet(prompt) {
    return imageCache[prompt];
}

// 清理旧 base64 缓存
export function cleanOldCache() {
    try {
        var changed = false;
        for (var key in imageCache) {
            if (imageCache[key].startsWith('data:') || imageCache[key].startsWith('//')) {
                delete imageCache[key];
                changed = true;
            }
        }
        if (changed) {
            localStorage.setItem('slimg_cache', JSON.stringify(imageCache));
            slLog('旧 base64 缓存已清理');
        }
    } catch (e) {}
}

// 上传图片到 ST 本地存储
export async function uploadImageToST(dataUrl) {
    var match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) throw new Error('无效的 Data URL');
    var format = match[1], raw = match[2];
    var filename = 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    var response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getSTHeaders()),
        body: JSON.stringify({ image: raw, format: format, filename: filename })
    });
    if (!response.ok) { var text = await response.text(); throw new Error(text.slice(0, 200)); }
    var data = await response.json();
    if (!data.path) throw new Error('Upload 返回缺少 path');
    return data.path.startsWith('/') ? data.path : '/' + data.path;
}

imgCacheLoad();
cleanOldCache();
