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

// ── 多人切分（v1.4.1）──
// 【为什么不能直接 split('；')】占位符里 '；' 有两种含义：
//   ① 分隔多个人物：人物:甲（标签）：外貌；人物:乙（标签）：外貌
//   ② 人物段内部的字段分层：人物:甲（标签）：脸；身高；痣   ← 会被误拆成 3 个假人物（"身高168cm" / "左眼角有美人痣"）
// 规则：以「人物:」开头的片段 = 下一个人；否则，若当前已解析出带外貌的人物（含「：」）→ 视为外貌续行合并回去；
//       若当前只是裸名（无「：」）→ 视为下一个人（兼容「人物:甲；乙」）。
export function splitPersonList(raw) {
    var parts = String(raw || '').split('；');
    var out = [], cur = '';
    for (var i = 0; i < parts.length; i++) {
        var frag = parts[i];
        var isNew;
        if (i === 0) isNew = true;
        else if (/^\s*人物[：:]/.test(frag)) isNew = true;
        else isNew = !/[：:]/.test(cur);          // 当前还是裸名 → 新人；已有外貌 → 续行
        if (isNew) { if (cur.trim()) out.push(cur.trim()); cur = frag; }
        else { cur += '；' + frag; }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

// ── 人物段解析（v1.3 新增冒号式）──
// ① 冒号式（主推）：名字（可选标签）：静态锚点
//      [img:…|人物:温若兰（邻家人妻）：鹅蛋脸，杏眼，168cm，胸臀丰满|要点]
//      冒号是「硬边界」，不受标签/逗号影响，解析零歧义
// ② 括号式（旧）：名字（标签），外貌
// ③ 逗号式（旧）：名字，外貌
// ④ 裸名：名字（只有名字，无外貌）
export function parsePersonString(pStr) {
    var s = String(pStr || '').trim().replace(/^人物[：:]\s*/, '');
    if (!s) return null;
    // ① 冒号式（最优先）
    var cm = s.match(/^([^：:（(]{1,20})(?:[（(]([^）)]{1,30})[）)])?\s*[：:]\s*([\s\S]+)$/);
    if (cm) return { name: (cm[1] || '').trim(), identity: (cm[2] || '').trim(), appearance: (cm[3] || '').trim() };
    // ② 括号式
    var bm = s.match(/^([^（(]{1,20})[（(]([^）)]{1,30})[）)]\s*[，,]?\s*([\s\S]*)$/);
    if (bm) return { name: (bm[1] || '').trim(), identity: (bm[2] || '').trim(), appearance: (bm[3] || '').trim() };
    // ③ 逗号式（[Fix] 原实现读 nameM[3] 恒为 undefined → 外貌被误存进 identity、appearance 为空）
    var km = s.match(/^([^，,]{1,20})\s*[，,]\s*([\s\S]*)$/);
    if (km) return { name: (km[1] || '').trim(), identity: '', appearance: (km[2] || '').trim() };
    // ④ 裸名
    return { name: s, identity: '', appearance: '' };
}

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
                var persons = splitPersonList(pm[1]);
                for (var pIdx = 0; pIdx < persons.length; pIdx++) {
                    var _ps = parsePersonString(persons[pIdx]);
                    if (_ps) personSegments.push(_ps);
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

// ── 动态要素提取（导演模式保真：占位符里酒馆AI写的一切动态内容——衣着/发型/表情/光线/氛围/动作——
// 都是"本轮可变、由酒馆AI写"的部分，必须逐项润色进提示词，不得省略）
var DYNAMIC_CUE = /(穿|着|披|围|戴|系|套|衣|裤|裙|袜|丝|鞋|靴|帽|开衫|风衣|马甲|吊带|抹胸|内衣|内搭|束腰|领口|束带|头发|发丝|发色|刘海|马尾|表情|神态|眼神|目光|微笑|皱眉|浅笑|光线|灯光|烛光|阳光|阴影|氛围|动作|姿势|站|坐|靠|蹲|跪|转身|弯腰|低头|抬头|抬手|伸手|撑|倚|抱|吻)/;
export function extractDynamicBits(text) {
    if (!text) return [];
    var parts = String(text).split(/[，。；、\n,;]/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var seg = (parts[i] || '').trim();
        if (!seg) continue;
        if (DYNAMIC_CUE.test(seg) && seg.length >= 4 && seg.length <= 40 && out.indexOf(seg) === -1) out.push(seg);
    }
    return out;
}

// ── 消息头部指纹（占位符感知） ──
// 导演模式正文可能整个就是占位符：原文以 [img:…] 开头、缓存以 [image: …] 开头，
// 前40字直接比较永远失配。取首个占位符的场景开头(≤30字)比较；无占位符回退前40字。
// 匹配归一化：去空白与助词（的/地/得/色/个），用于"是否已包含"判断——
// AI 润色把"浅灰开衫"写成"浅灰色开衫"时仍能认出已包含，避免重复补入
export function normForMatch(s) {
    return String(s || '').replace(/\s+/g, '').replace(/[的地得色个只]/g, '');
}

export function imgBlockHead(text) {
    var m = String(text || '').match(/\[(?:img|image):\s*([^\]]{2,30})/);
    return m ? m[1].replace(/\s/g, '') : String(text || '').slice(0, 40).replace(/\s/g, '');
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
