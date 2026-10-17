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

// ══════════════════════════════
// ── v1.11.1 种子（seed）解析 / 剥离 ──
// 主模型在「种子:」段（或误写进人物段）里给的是**取词方向**：气质=…；调性=…；重心=…；反差=…
// ⛔ 它不是画面素材。实测 bug：`反差=看着懒散邋遢` 里的「着」命中 DYNAMIC_CUE，
//    被 extractDynamicBits 当成"本轮动态要素"抄进了成图提示词 → 提示词尾部出现
//    「，反差=看着懒散邋遢，白色棉质背心…」这种垃圾。所以所有兜底路径必须先剥种子。
export var SEED_FIELDS = ['气质', '调性', '重心', '反差'];

// 从一段文本里抽出种子字段 → { 气质, 调性, 重心, 反差 }
export function parseSeedSegment(text) {
    var body = String(text || '').replace(/^s*(?:种子|印象)s*[：:]?s*/, '');
    var out = {};
    if (!body.trim()) return out;
    var re = /(气质|调性|重心|反差|第一印象)s*[=＝]s*([^；;|]*)/g;
    var m;
    while ((m = re.exec(body)) !== null) {
        var k = (m[1] === '第一印象') ? '气质' : m[1];
        var v = String(m[2] || '').trim();
        if (!v) continue;
        out[k] = out[k] ? (out[k] + '；' + v) : v;
    }
    return out;
}

// 种子对象 → 标准写法（气质=…；调性=…；重心=…；反差=…）
export function formatSeed(obj) {
    if (!obj) return '';
    var out = [];
    for (var i = 0; i < SEED_FIELDS.length; i++) {
        var k = SEED_FIELDS[i];
        if (obj[k]) out.push(k + '=' + obj[k]);
    }
    return out.join('；');
}

// 把种子从任意文本里剥掉（人物段 / 场景 / 要点 都可能混进种子）
export function stripSeedText(text) {
    var t = String(text || '');
    if (!t) return t;
    // ① 「种子：」之后到段尾（种子习惯写在最后）
    t = t.replace(/(?:^|[。；;|])s*种子s*[：:][sS]*$/, '');
    // ② 散落的 气质=/调性=/重心=/反差= 字段，各自到下一个分号/竖线
    t = t.replace(/(?:气质|调性|重心|反差|第一印象)s*[=＝]s*[^；;|]*/g, '');
    // ③ 收尾清理
    return t.replace(/[；;，,]{2,}/g, '，').replace(/^[；;，,。\s]+/, '').replace(/[；;，,。\s]+$/, '').trim();
}

// 文本里是否含种子字段
export function hasSeedField(text) {
    return /(?:气质|调性|重心|反差)s*[=＝]/.test(String(text || ''));
}

// ══════════════════════════════
// ── v1.5.0 造型段解析（衣柜/造型库）──
// 语法：造型:服装=XX中学·校服（夏季）；发型=温若兰·短发扎尾；配饰=A、B
// 槽之间用「；」，槽名与 key 用「=」，一个槽多个 key 用「、」
// key 由主模型写全（含作用域前缀），插件原样使用，不做作用域判断
export var WARDROBE_SLOTS = ['服装', '发型', '鞋袜', '配饰', '妆容'];

export var WARDROBE_SLOT_ALIAS = {
    '服装': '服装', '衣服': '服装', '衣着': '服装', '穿搭': '服装', '套装': '服装', '服饰': '服装',
    '发型': '发型', '头发': '发型', '发型发色': '发型',
    '鞋袜': '鞋袜', '鞋': '鞋袜', '袜子': '鞋袜', '鞋子': '鞋袜',
    '配饰': '配饰', '饰品': '配饰', '首饰': '配饰', '配件': '配饰',
    '妆容': '妆容', '妆': '妆容', '化妆': '妆容', '妆造': '妆容'
};

export function normalizeSlot(name) {
    var s = String(name || '').trim();
    return WARDROBE_SLOT_ALIAS[s] || '';
}

// 造型段整段 → [{ slot, keys:[...] }]
export function parseStyleSegment(text) {
    var out = [];
    var body = String(text || '').replace(/^(造型|穿搭|衣柜)[：:]\s*/, '');
    if (!body.trim()) return out;
    var groups = body.split(/[；;]/);
    for (var i = 0; i < groups.length; i++) {
        var g = (groups[i] || '').trim();
        if (!g) continue;
        var m = g.match(/^([^=＝]{1,8})\s*[=＝]\s*([\s\S]+)$/);
        if (!m) continue;
        var slot = normalizeSlot(m[1]);
        if (!slot) continue;
        var keys = m[2].split(/[、,，]/).map(function(k) { return k.trim(); }).filter(Boolean);
        if (keys.length) out.push({ slot: slot, keys: keys });
    }
    return out;
}

// ══════════════════════════════
// ── v1.9.0 状态段解析（时效性状态：半永久 / 跨轮暂时）──
// 语法：状态:+晒黑；+左颈吻痕；-淤青
//   +key = 激活（库里命中 → 复用 detail；未命中 → 辅助AI 具象化建档）
//   -key = 取消激活（条目保留，不删档，以后可再 +）
// detail 只存"是什么"（左颈暗红色吻痕），不存"现在怎么样"（淡了/更明显了 → 写要点）
export function parseStatusSegment(text) {
    var out = [];
    var body = String(text || '').replace(/^(状态|时效|变化)[：:]\s*/, '');
    if (!body.trim()) return out;
    var parts = body.split(/[；;]/);
    for (var i = 0; i < parts.length; i++) {
        var p = (parts[i] || '').trim();
        if (!p) continue;
        var op = '+';
        if (/^[-－—]/.test(p)) { op = '-'; p = p.replace(/^[-－—]\s*/, ''); }
        else if (/^[+＋]/.test(p)) { p = p.replace(/^[+＋]\s*/, ''); }
        p = p.trim();
        if (!p) continue;
        out.push({ op: op, key: p });
    }
    return out;
}

// 从文本中提取所有 [img:…] 占位符 → [{ scene, personSegments:[{name,identity,appearance}], styleGroups, statusOps, topic, raw }]
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
        var styleGroups = [];
        var statusOps = [];
        var seedObj = {};
        for (var i = 0; i < segs.length; i++) {
            var seg = segs[i].trim();
            if (!seg) continue;
            if (i === 0) {
                scene = stripSeedText(seg);
                continue;
            }
            // v1.11.1：种子段（可选，以「种子:/印象:」开头）—— 只给插件看，绝不进提示词
            if (/^(?:种子|印象)\s*[：:]/.test(seg)) {
                var _sd = parseSeedSegment(seg);
                for (var _sdk in _sd) { seedObj[_sdk] = seedObj[_sdk] ? (seedObj[_sdk] + '；' + _sd[_sdk]) : _sd[_sdk]; }
                continue;
            }
            // v1.9.0：状态段（可选，以「状态:/时效:/变化:」开头）
            if (/^(?:状态|时效|变化)[：:]/.test(seg)) {
                var _so = parseStatusSegment(seg);
                for (var _soi = 0; _soi < _so.length; _soi++) statusOps.push(_so[_soi]);
                continue;
            }
            // v1.5.0：造型段（可选，以「造型:/穿搭:/衣柜:」开头）
            if (/^(?:造型|穿搭|衣柜)[：:]/.test(seg)) {
                var _sg = parseStyleSegment(seg);
                for (var _gi = 0; _gi < _sg.length; _gi++) styleGroups.push(_sg[_gi]);
                continue;
            }
            var pm = seg.match(/^人物[：:]\s*([\s\S]*)$/);
            if (pm) {
                var persons = splitPersonList(pm[1]);
                for (var pIdx = 0; pIdx < persons.length; pIdx++) {
                    var _ps = parsePersonString(persons[pIdx]);
                    if (!_ps) continue;
                    // [Fix v1.11.1] 主模型常把种子直接写在人物段末尾 → 从这里剥出来，
                    // 否则它会被当成外貌喂给辅助AI / 被动态要素兜底抄进提示词
                    if (_ps.appearance && hasSeedField(_ps.appearance)) {
                        var _pd = parseSeedSegment(_ps.appearance);
                        for (var _pk in _pd) { seedObj[_pk] = seedObj[_pk] ? (seedObj[_pk] + '；' + _pd[_pk]) : _pd[_pk]; }
                        _ps.appearance = stripSeedText(_ps.appearance);
                    }
                    _ps.seedObj = {};
                    personSegments.push(_ps);
                }
            } else {
                var _topicSeg = stripSeedText(seg);
                if (_topicSeg) topicParts.push(_topicSeg);
            }
        }
        var _seedText = formatSeed(seedObj);
        // 把种子挂到各自的人物段上（同一个人有多段时不重复塞）
        for (var _psi = 0; _psi < personSegments.length; _psi++) {
            if (!personSegments[_psi].seedObj || !Object.keys(personSegments[_psi].seedObj).length) {
                personSegments[_psi].seedObj = seedObj;
            }
        }
        result.push({
            scene: scene,
            personSegments: personSegments,
            styleGroups: styleGroups,
            statusOps: statusOps,
            topic: topicParts.join('\n'),
            seed: _seedText,
            seedObj: seedObj,
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
    // [Fix v1.11.1] 先剥种子：`反差=看着懒散邋遢` 里的「着」会命中 DYNAMIC_CUE → 被当成动态要素抄进提示词
    text = stripSeedText(text);
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

// ══════════════════════════════════════════════════════════════
// ── v1.13.6 数字保真（数值不许在管线里"蒸发"）──
// 主模型写下的数字是硬事实：年龄 14岁 / 身高 168cm / 体重 52kg。
// 它也是最容易被"润色"掉的一类信息 —— 实测链路：
//   主模型「14岁女性」→ 辅助AI 具象化成英文锚点 age:teenage girl
//   → 之后每张图逐字复用锚点 → 提示词里只剩「少女」→ 数字彻底消失，且**没有任何环节报警**。
// 这里只做一件事：把"源文本里有的数字"和"目标文本里已经没有的数字"对出来。
var NUM_TOKEN_RE = /(\d+(?:\.\d+)?)\s*(岁|周岁|cm|CM|厘米|kg|KG|公斤)/g;

function _cnNum(v) {
    var n = Number(v);
    if (!isFinite(n) || n !== Math.floor(n) || n < 0 || n > 99) return '';
    var d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (n < 10) return d[n];
    if (n === 10) return '十';
    if (n < 20) return '十' + d[n % 10];
    var t = Math.floor(n / 10), o = n % 10;
    return d[t] + '十' + (o ? d[o] : '');
}

// 返回 ['14岁', '168cm'] —— 源里有、目标里没有的数字（中文数字也算"在"：十四岁左右）
export function findLostNumbers(source, target) {
    var src = String(source || ''), tgt = String(target || '');
    if (!src || !tgt) return [];
    var out = [], seen = {};
    NUM_TOKEN_RE.lastIndex = 0;
    var m;
    while ((m = NUM_TOKEN_RE.exec(src)) !== null) {
        var num = m[1], key = num + m[2];
        if (seen[key]) continue;
        seen[key] = 1;
        if (tgt.indexOf(num) >= 0) continue;       // 数字原样在
        var cn = _cnNum(num);
        if (cn && tgt.indexOf(cn) >= 0) continue;  // 中文数字在（十四岁左右）
        out.push(key);
    }
    return out;
}
