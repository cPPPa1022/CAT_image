// ── SillyImage Lab 🎨 ComfyUI连接 通信 ──
import { slLog } from './log.js';
import { settings, getSTHeaders, saveSettings, escapeHtml, getActiveMode } from './settings.js';
import { uploadImageToST } from './cache.js';
import { getProfiles } from './pipeline/profile.js';

// [Fix] 提示词角色名过滤（最后防线）：LLM 偶发违规把角色名写进提示词，或 FACE 占位符残留。
// 角色名是生图模型无法理解的概念噪音，且会把名字当成画面元素画出来。
export function stripCharacterNames(prompt) {
    if (!prompt) return prompt;
    try {
        var prof = getProfiles();
        if (!prof) return prompt;
        var names = [prof.charName, 'User'];
        if (prof.root && prof.root[prof.charName]) {
            var cast = prof.root[prof.charName].cast || {};
            for (var nk in cast) names.push(nk);
        }
        var npcs = (prof.chat && prof.chat.npcs) || {};
        for (var n2 in npcs) names.push(n2);
        var changed = false;
        for (var i = 0; i < names.length; i++) {
            var nm = names[i];
            if (!nm || nm.length < 2) continue;
            var re;
            try { re = new RegExp(nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'); } catch (e) { continue; }
            if (re.test(prompt)) { prompt = prompt.replace(re, ''); changed = true; }
        }
        if (changed) {
            prompt = prompt.replace(/[，,]\s*[，,]+/g, '，').replace(/[，,]\s*$/g, '').replace(/\s+/g, ' ').trim();
        }
    } catch (e) { /* 过滤失败不影响生成 */ }
    return prompt;
}
// 画风预设表
export var STYLE_PRESETS = {
    '': '',
    '柯达金200胶片质感，暖黄色调，细腻胶片颗粒，复古写实质感': '柯达金200胶片质感，暖黄色调，细腻胶片颗粒，复古写实质感',
    '水墨写意画，宣纸质感，墨色浓淡晕染，大面积留白，东方写意意境': '水墨写意画，宣纸质感，墨色浓淡晕染，大面积留白，东方写意意境',
    '水彩画风格，半透明叠色水痕，水彩纸纹理，自然晕染过渡': '水彩画风格，半透明叠色水痕，水彩纸纹理，自然晕染过渡',
    '厚涂油画风格，刮刀笔触肌理，亚麻布纹理，厚重色彩堆叠': '厚涂油画风格，刮刀笔触肌理，亚麻布纹理，厚重色彩堆叠',
    '铅笔素描风格，细腻排线塑造，黑白灰层次分明，素描纸质感，手绘质感': '铅笔素描风格，细腻排线塑造，黑白灰层次分明，素描纸质感，手绘质感',
    'Anime 赛璐璐：赛璐珞胶片质感，清晰黑色轮廓线，纯色平涂色块，硬边分层阴影': 'Anime 赛璐璐：赛璐珞胶片质感，清晰黑色轮廓线，纯色平涂色块，硬边分层阴影',
    'Anime 日系轻小说：anime style，2D，赛璐璐上色，细腻线稿，柔光，精致眼部高光，通透清新': 'Anime 日系轻小说：anime style，2D，赛璐璐上色，细腻线稿，柔光，精致眼部高光，通透清新',
    'Anime 日本动画：anime style，2D，cel shading，vibrant colors，clean lineart，anime key visual': 'Anime 日本动画：anime style，2D，cel shading，vibrant colors，clean lineart，anime key visual',
    'Anime 精致平涂：日本アニメスタイル，セル画調，くっきり黒線，フラット彩色，鮮やかな色彩，ベタ塗り色面，クリーンな線画': 'Anime 精致平涂：日本アニメスタイル，セル画調，くっきり黒線，フラット彩色，鮮やかな色彩，ベタ塗り色面，クリーンな線画',
    'Anime 立体精致：日本アニメスタイル，厚塗り×セル画混合，立体感ある陰影，柔らかな明暗グラデーション，繊細な線画，透明感': 'Anime 立体精致：日本アニメスタイル，厚塗り×セル画混合，立体感ある陰影，柔らかな明暗グラデーション，繊細な線画，透明感',
    'monochrome manga style，black and white，screentone shading，ink lines，hand-drawn comic，speed lines，crosshatch，黑白漫画': 'monochrome manga style，black and white，screentone shading，ink lines，hand-drawn comic，speed lines，crosshatch，黑白漫画',
    'Anime Q版萌系：大头小身比例，圆润简洁线条，扁平化可爱造型，明快纯色块': 'Anime Q版萌系：大头小身比例，圆润简洁线条，扁平化可爱造型，明快纯色块',
    'Anime 2.5D立体：保留赛璐璐平涂色块边界，硬边分层阴影，低多边形立体造型': 'Anime 2.5D立体：保留赛璐璐平涂色块边界，硬边分层阴影，低多边形立体造型',
    '国风厚涂插画，工笔白描线稿，东方人物骨相，典雅国风配色，水墨质感厚涂': '国风厚涂插画，工笔白描线稿，东方人物骨相，典雅国风配色，水墨质感厚涂',
    '皮克斯卡通3D风格，柔和全局光照，次表面散射质感，哑光黏土质感，圆润卡通造型': '皮克斯卡通3D风格，柔和全局光照，次表面散射质感，哑光黏土质感，圆润卡通造型',
    '写实3D渲染，PBR物理级材质，全局光照，真实织物与皮肤纹理，超写实质感': '写实3D渲染，PBR物理级材质，全局光照，真实织物与皮肤纹理，超写实质感',
    'Anime 昭和赛璐璐：粗黑硬朗轮廓线，复古低饱和配色，大块平涂填色，轻微胶片颗粒': 'Anime 昭和赛璐璐：粗黑硬朗轮廓线，复古低饱和配色，大块平涂填色，轻微胶片颗粒',
    'Anime 90年代少年漫：硬朗墨线，网点纸阴影质感，写实人物比例，手绘漫画质感': 'Anime 90年代少年漫：硬朗墨线，网点纸阴影质感，写实人物比例，手绘漫画质感',
    'Anime 90年代魔法少女：大眼睛精致高光，柔和流畅线条，明亮复古配色，赛璐璐平涂': 'Anime 90年代魔法少女：大眼睛精致高光，柔和流畅线条，明亮复古配色，赛璐璐平涂'
};


// 后端通信
async function comfyFetch(path, body) {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 30000);
    var response;
    try {
        response = await fetch('/api/sd/comfy' + path, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, getSTHeaders()),
            body: JSON.stringify(body || {}),
            signal: ctrl.signal
        });
    } catch (e) {
        clearTimeout(timer);
        throw new Error(e && e.name === 'AbortError' ? 'ComfyUI请求超时(30s)' : (e ? e.message : 'fetch失败'));
    }
    clearTimeout(timer);
    if (!response.ok) { var text = await response.text(); throw new Error(text.slice(0, 500)); }
    var text = await response.text();
    if (!text || !text.trim()) return { ok: true };
    try { return JSON.parse(text); } catch (e) { return text; }
}

export async function loadWorkflowList() {
    try {
        var data = await comfyFetch('/workflows');
        var selector = $('#sl_wf_sel');
        selector.empty();
        for (var name of data) {
            var sel = name === settings.cWfName ? ' selected' : '';
            selector.append('<option value="' + escapeHtml(name) + '"' + sel + '>' + escapeHtml(name) + '</option>');
        }
    } catch (e) { $('#sl_wf_sel').html('<option>📂 📂 加载失败</option>'); }
}

export async function loadWorkflow(name) {
    var data = await comfyFetch('/workflow', { file_name: name });
    var wf = typeof data === 'string' ? data : JSON.stringify(data);
    settings.cWf = wf;
    settings.cWfName = name;
    saveSettings();
    $('#sl_wf').val(wf);
    toastr.success('📂 加载好啦喵~ (｡•̀ᴗ-)✧  ' + name);
}

export async function saveWorkflow(name, wf) {
    settings.cWf = wf;
    settings.cWfName = name;
    saveSettings();
    await comfyFetch('/save-workflow', { file_name: name, workflow: wf });
}

export async function deleteWorkflow(name) {
    await comfyFetch('/delete-workflow', { file_name: name });
    if (settings.cWfName === name) {
        settings.cWfName = '';
    }
    saveSettings();
}

export async function fetchComfyModels() {
    // 直接调 ComfyUI 的 object_info（不走后端代理，减少依赖）
    var base = (settings.cUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('未配置 ComfyUI 地址');
    var response = await fetch(base + '/object_info');
    if (!response.ok) throw new Error('ComfyUI 返回 ' + response.status);
    var info = await response.json();
    var models = { checkpoints: [], unets: [], clips: [], vaes: [] };
    for (var key in info) {
        var obj = info[key];
        if (!obj || !obj.input || !obj.input.required) continue;
        for (var k in obj.input.required) {
            var v = obj.input.required[k];
            if (!Array.isArray(v) || v.length < 2) continue;
            var list = v[0];
            if (!Array.isArray(list)) continue;
            var cat = null;
            if (/checkpoint|ckpt_name/i.test(k)) cat = 'checkpoints';
            else if (/unet_name/i.test(k)) cat = 'unets';
            else if (/clip_name|text_encoder/i.test(k)) cat = 'clips';
            else if (/vae_name/i.test(k)) cat = 'vaes';
            if (cat) list.forEach(function(m) { if (!models[cat].includes(m)) models[cat].push(m); });
        }
    }
    settings.models = { unet: models.checkpoints, clip: models.clips, vae: models.vaes, lora: [] };
    saveSettings();
    return settings.models;
}

export async function generateImage(workflow, prompt) {
    // [Fix] 角色名过滤（LLM 违规写人名 / FACE 占位符残留的最后防线）
    prompt = stripCharacterNames(prompt);
    slLog('🎨ComfyUI-prompt('+prompt.length+'字):', prompt);
    // 直接从 DOM 读下拉框的最新值（绕过任何事件绑定问题）
    var domVal = (jQuery('#sl_style_preset').length ? jQuery('#sl_style_preset').val() : '') || '';
    var stylePrefix = domVal || settings.stylePreset || '';
    if (stylePrefix) {
        // 如果精确匹配不到，尝试模糊匹配（兼容旧名字和新名字不一致）
        if (!STYLE_PRESETS[stylePrefix]) {
            var matched = null;
            for (var k in STYLE_PRESETS) {
                if (k.indexOf(stylePrefix.slice(0,15)) >= 0 || stylePrefix.indexOf(k.slice(0,15)) >= 0) {
                    matched = k;
                    break;
                }
            }
            if (matched) stylePrefix = matched;
        }
        slLog('DEBUG 画风预设值: 「' + stylePrefix + '」, 来源: ' + (domVal ? 'DOM' : 'settings') + ', 存在预设表: ' + (STYLE_PRESETS[stylePrefix] ? '是' : '否'));
    }
    if (stylePrefix && STYLE_PRESETS[stylePrefix]) {
        var curMode = getActiveMode();
        if (curMode === 'zit' || !curMode) {
            prompt = STYLE_PRESETS[stylePrefix] + ' ' + prompt;
            slLog('画风预设: ' + stylePrefix);
        }
    }

    // [Fix] Anime 质量前缀/艺术家标签接线：原实现仅在设置页保存，generateImage 从未读取（死配置）
    var curMode = getActiveMode();
    if ((curMode === 'anime' || curMode === 'anime_tag') && settings.animeQualityPrefix) {
        prompt = settings.animeQualityPrefix + ', ' + prompt;
        slLog('Anime质量前缀: ' + settings.animeQualityPrefix);
    }
    if ((curMode === 'anime' || curMode === 'anime_tag') && settings.animeArtist) {
        prompt = prompt + ', ' + settings.animeArtist;
        slLog('Anime艺术家标签: ' + settings.animeArtist);
    }

    // 前置提示词（用户自定义）
    if (settings.promptPrefix) {
        prompt = settings.promptPrefix + ', ' + prompt;
        slLog('前置提示词: ' + settings.promptPrefix);
    }

    var matchCount = 0;
    // 遍历节点注入 prompt
    for (var nodeId in workflow) {
        var node = workflow[nodeId];
        if (!node || !node.inputs) continue;
        var classType = node.class_type || '';
        if (/CLIPTextEncode|TextEncode/i.test(classType)) {
            for (var key in node.inputs) {
                if (/(text|prompt|positive|clip_l|t5xxl|clip_g|bert|mt5xl)/i.test(key) && !/negative/i.test(key)) {
                    var original = node.inputs[key];
                    var text = Array.isArray(original) ? original[0] : original;
                    if (typeof text !== 'string') text = '';
                    // [Fix] 负面占位符节点（key 不含 negative 但文本是 %negative_prompt% 的双CLIP结构）
                    if (text.indexOf('%negative_prompt%') >= 0) {
                        if (settings.neg) {
                            text = text.replace(/%negative_prompt%/g, settings.neg);
                            node.inputs[key] = Array.isArray(original) && original.length === 2 ? [text, original[1]] : text;
                            slLog('genWf: 负面占位符已替换 → ' + settings.neg.slice(0, 60));
                        }
                        continue;
                    }
                    if (text.indexOf('%prompt%') >= 0) {
                        text = text.replace(/%prompt%/g, prompt);
                        node.inputs[key] = Array.isArray(original) && original.length === 2 ? [text, original[1]] : text;
                        matchCount++;
                        slLog('genWf: 注入prompt %prompt% → ' + prompt.slice(0, 60));
                    }
                } else if (/negative/i.test(key) && settings.neg) {
                    // [Fix] 负面提示词接线：key 明确带 negative 的输入（negative_prompt/negative_text 等）
                    var negOriginal = node.inputs[key];
                    var negText = Array.isArray(negOriginal) ? negOriginal[0] : negOriginal;
                    if (typeof negText !== 'string') negText = '';
                    if (negText.indexOf('%negative_prompt%') >= 0) {
                        negText = negText.replace(/%negative_prompt%/g, settings.neg);
                    } else {
                        negText = settings.neg;
                    }
                    node.inputs[key] = Array.isArray(negOriginal) && negOriginal.length === 2 ? [negText, negOriginal[1]] : negText;
                    slLog('genWf: 负面提示词已注入 → ' + settings.neg.slice(0, 60));
                }
            }
        }
        // 随机 seed
        if (/ksampler|sampler\b/i.test(classType) && !/scheduler|schedule|upscale/i.test(classType)) {
            for (var key in node.inputs) {
                if (/seed|noise_seed/i.test(key)) {
                    var original = node.inputs[key];
                    var randomSeed = Math.floor(Math.random() * 1000000000000000);
                    node.inputs[key] = Array.isArray(original) && original.length === 2 ? [randomSeed, original[1]] : randomSeed;
                }
            }
        }
    }
    // 保底覆盖
    if (matchCount === 0) {
        for (var nodeId in workflow) {
            var node = workflow[nodeId];
            if (!node || !node.inputs) continue;
            if (/CLIPTextEncode|TextEncode/i.test(node.class_type || '')) {
                for (var key in node.inputs) {
                    if (/(text|prompt|positive|clip_l|t5xxl|clip_g|bert|mt5xl)/i.test(key) && !/negative/i.test(key)) {
                        var original = node.inputs[key];
                        // [Fix] 保底覆盖跳过负面占位符节点，避免把正向 prompt 写进负面输入
                        var fallbackText = Array.isArray(original) ? original[0] : original;
                        if (typeof fallbackText === 'string' && fallbackText.indexOf('%negative_prompt%') >= 0) continue;
                        node.inputs[key] = Array.isArray(original) && original.length === 2 ? [prompt, original[1]] : prompt;
                        matchCount++;
                        slLog('genWf: 没找到%prompt%, 直接覆盖节点 ' + nodeId + ' → ' + prompt.slice(0, 60));
                        break;
                    }
                }
                if (matchCount > 0) break;
            }
        }
    }
    var clientId = 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    var raw = JSON.stringify({ prompt: workflow, client_id: clientId });
    var ctrl2 = new AbortController();
    var timer2 = setTimeout(function() { ctrl2.abort(); }, (settings.cTimeout || 180) * 1000);
    var response;
    try {
        response = await fetch('/api/sd/comfy/generate', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, getSTHeaders()),
            body: JSON.stringify({ url: settings.cUrl, prompt: raw }),
            signal: ctrl2.signal
        });
    } catch (e) {
        clearTimeout(timer2);
        throw new Error(e && e.name === 'AbortError' ? 'ComfyUI生成超时(' + ((settings.cTimeout || 180)) + 's)' : (e ? e.message : 'fetch失败'));
    }
    clearTimeout(timer2);
    if (!response.ok) { var text = await response.text(); throw new Error(text.slice(0, 800)); }
    var data = await response.json();
    if (!data.data) throw new Error('无输出');
    var dataUrl = 'data:image/' + (data.format || 'png') + ';base64,' + data.data;
    try {
        var path = await uploadImageToST(dataUrl);
        slLog('图片已上传:', path);
        return { url: path };
    } catch (e) {
        slLog('上传到 ST 失败，降级使用 base64:', e.message);
        return { url: dataUrl };
    }
}
