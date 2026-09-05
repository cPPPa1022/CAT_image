// ── SillyImage Lab 文本处理工具 ──

// 清洗 AI 模型输出的 XML/思考标签
export function stripAiTags(text) {
    if (!text) return '';
    return text
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .replace(/<fox_selc>[\s\S]*?<\/fox_selc>/gi, '')
        .replace(/<fox_tip>[\s\S]*?<\/fox_tip>/gi, '')
        .replace(/<CEstuff>[\s\S]*?<\/CEstuff>/gi, '')
        .replace(/<catsay>[\s\S]*?<\/catsay>/gi, '');
}

// 提取正文：从 正文###...结尾### 区间取内容
export function extractBodyText(message) {
    if (!message) return '';
    var startIdx = message.indexOf('正文###');
    var endIdx = message.indexOf('结尾###', startIdx + 1);
    if (startIdx >= 0 && endIdx > startIdx) return message.slice(startIdx + 5, endIdx);

    var endMarker = message.indexOf('\n结尾###');
    if (endMarker >= 0) return message.slice(0, endMarker);
    endMarker = message.indexOf('结尾###');
    if (endMarker >= 0) return message.slice(0, endMarker);

    var contentMatch = message.match(/<content>\s*([\s\S]*?)\s*<\/content>/i);
    if (contentMatch) return contentMatch[1].trim();

    var result = stripAiTags(message)
        .replace(/<backgrounds>[\s\S]*?<\/backgrounds>/gi, '')
        .replace(/<bginfor>[\s\S]*?<\/bginfor>/gi, '')
        .replace(/\n{3,}/g, '\n\n').trim();
    return result;
}

// 提取标记区间正文（用于缓存，不 trim）
export function extractBodyContent(text) {
    var startIdx = text.indexOf('正文###');
    var endIdx = text.indexOf('结尾###', startIdx + 1);
    if (startIdx >= 0 && endIdx > startIdx) return text.slice(startIdx + 5, endIdx);
    return text;
}

export function hasBodyMarker(text) {
    return text.indexOf('正文###') >= 0 && text.indexOf('结尾###') >= text.indexOf('正文###') + 5;
}

// 从增强文本中提取 [image:] 对应的【提示词】
export function extractImagePrompt(rawText, imageTag, fromIndex) {
    if (!rawText || !imageTag) return '';
    // [Fix] 支持 fromIndex：同场景多张图时按上一次匹配位置向后找，
    // 否则第二个相同 [image:] 块会取到第一块的【提示词】（B4）。
    var idx = fromIndex != null ? rawText.indexOf(imageTag, fromIndex) : rawText.indexOf(imageTag);
    if (idx < 0) return '';
    var remaining = rawText.slice(idx + imageTag.length);
    var m = remaining.match(/^\s*\n?\s*【提示词[】:：]*\s*([\s\S]*?)【\/提示词】/);
    if (m) return m[1].replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]+>/g,'').trim();
    var match = remaining.match(/^\s*\n?\s*【提示词[】:：]*\s*([\s\S]*?)(?=\n\n|\n?【|<[a-zA-Z\/!]|$)/);
    if (match) return match[1].replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]+>/g,'').trim();
    return '';
}

// Anime 模式下清除 prompt 中的中文字符
export function cleanAnimePrompt(prompt) {
    if (!prompt) return prompt;
    return prompt
        .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+[：:]\s*[^,\n]+/g, '')
        .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, '')
        .replace(/\s*,\s*,+/g, ',')
        .replace(/,\s*$/, '')
        .trim();
}

// ══════════════════════════════
// ── v2.4 占位符协议：[img:…] 解析 ──
// 语法（酒馆AI模式，主LLM写入）：
//   [img:场景描述]
//   [img:场景描述|提示词要点]
//   [img:场景描述|人物:柳如烟（同船歌女），青丝如瀑，碧色罗裙|特写手部，琴弦，油灯]
//   [img:场景描述|人物:柳如烟（同船歌女），青丝如瀑；人物:阿福（车夫），络腮胡|……]
// 分段规则（| 分隔）：
//   第1段=场景描述（必填）；其余段："人物:" 前缀=建档段（分号可多条），无前缀=提示词要点

// 从文本中提取所有 [img:…] 占位符 → [{ scene, personSegments:[{name,identity,appearance}], topic, raw }]
export function findImagePlaceholders(text) {
    var result = [];
    if (!text) return result;
    var re = /\[img:\s*([\s\S]*?)\]/g;
    var m;
    while ((m = re.exec(text)) !== null) {
        var content = (m[1] || '').trim();
        if (!content) continue;
        var segs = content.split('|');
        var scene = '';
        var topicParts = [];
        var personSegments = [];
        for (var i = 0; i < segs.length; i++) {
            var seg = segs[i].trim();
            if (!seg) continue;
            if (i === 0) {
                scene = seg;
                continue;
            }
            var pm = seg.match(/^人物[：:]\s*([\s\S]*)$/);
            if (pm) {
                var persons = pm[1].split('；');
                for (var pIdx = 0; pIdx < persons.length; pIdx++) {
                    var pStr = persons[pIdx].trim().replace(/^人物[：:]\s*/, '');
                    if (!pStr) continue;
                    var nameM = pStr.match(/^([^（(]{1,20})[（(]([^）)]{1,30})[）)]\s*[，,]?\s*([\s\S]*)$/) || pStr.match(/^([^，,]{1,20})\s*[，,]\s*([\s\S]*)$/);
                    if (nameM) {
                        personSegments.push({
                            name: nameM[1].trim(),
                            identity: (nameM[2] !== undefined ? nameM[2].trim() : ''),
                            appearance: (nameM[3] !== undefined ? nameM[3].trim() : '')
                        });
                    } else {
                        personSegments.push({ name: pStr, identity: '', appearance: '' });
                    }
                }
            } else {
                topicParts.push(seg);
            }
        }
        result.push({
            scene: scene,
            personSegments: personSegments,
            topic: topicParts.join('\n'),
            raw: content
        });
    }
    return result;
}

// ── 着装/可变要素提取（导演模式着装保真：占位符里写到的衣着必须出现在提示词里） ──
var CLOTH_CUE = /(穿|着|披|围|戴|系|套|衣|裤|裙|袜|丝|鞋|靴|帽|开衫|风衣|马甲|吊带|抹胸|内衣|内搭|束腰|领口|束带)/;
export function extractClothingSegments(text) {
    if (!text) return [];
    var parts = String(text).split(/[，。；、\n,;]/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var seg = (parts[i] || '').trim();
        if (!seg) continue;
        if (CLOTH_CUE.test(seg) && seg.length >= 4 && seg.length <= 40 && out.indexOf(seg) === -1) out.push(seg);
    }
    return out;
}

// 组装成现有 [image:] 图卡格式（render.js 零改动）：
// [image:场景]\n【提示词】提示词【/提示词】
export function buildImageBlock(scene, prompt, styleHint) {
    var s = scene && scene.trim() ? scene.trim() : '未命名画面';
    if (s.length > 100) s = s.slice(0, 100) + '…';
    var p = (prompt || '').trim();
    var head = '[image: ' + s + ']';
    if (!p) return head;
    if ((styleHint || '').trim()) p = styleHint.trim() + ', ' + p;
    return head + '\n【提示词】' + p + '【/提示词】';
}
