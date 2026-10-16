// ── SillyImage Lab v2.4 生图协作卡 + 人物档案索引（对主LLM的"对讲卡"） ──
// 用 ST 原生 setExtensionPrompt 每轮注入，让酒馆AI知道：怎么配合写 [img:] 占位、插件知道哪些人。
// position = 2 (BEFORE_PROMPT, ST script.js extension_prompt_types.BEFORE_PROMPT)

import { slLog } from './log.js';
import { settings, getSTContext, getActiveMode } from './settings.js';
import { rosterEntries, rosterIndexText } from './roster.js';
import { wardrobeIndexText } from './wardrobe.js';
import { statusesIndexText } from './statuses.js';

var MODULE = 'sillycat_coop';
var POSITION = 2; // BEFORE_PROMPT

// 模式中文描述
function modeDesc(m) {
    if (m === 'anima') return 'anima 混合（Danbooru 标签定结构/构图 + 自然语言写光影/氛围/情绪）';
    if (m === 'anime') return 'anime（纯英文自然语言）';
    if (m === 'anime_tag') return 'anime_tag（纯 Danbooru 英文标签）';
    return 'zit（中文提示词）';
}

export function buildCoopCardText() {
    var lines = [];
    lines.push('【生图协作卡·sillycat】');
    lines.push('· 正文中适合配图的瞬间写 1-3 个占位符 [img:…]，占位符位置就是图片显示位置；占位数量 = 本轮图片数。');
    lines.push('· 【占位符语法·必须严格】（写错格式插件解析会漏人/错位）：');
    lines.push('    [img:场景描述|人物:名字（身份标签）：静态外貌特征|要点1，要点2]');
    lines.push('  ① 必须半角 [img: 开头；② 用 | 分隔三段：场景 / 人物 / 要点；③ 人物段必须以「人物:」开头，多人用分号分隔；');
    lines.push('  ④ 「名字（身份标签）」后面必须跟一个冒号「：」，冒号后面写该人物的静态外貌特征；');
    lines.push('  ⑤ 人物段内部**只用逗号「，」**；分号「；」**只用来分隔多个人物**（人物:甲…；人物:乙…）。');
    lines.push('· 【要点必写两项】① **景别**（特写/近景/中景/中全景/全景/远景 —— 插件靠它裁剪：中景就不写腿/臀/脚）　② **主体**（画面焦点是谁，多人画面必须写「主体:甲、乙」；亲吻/拥抱时两人都是主体）');
    lines.push('· 【一轮图组 1-5】多人场景**优先拆成单人图**（N 人 → N 张单人图，合起来算 1 个图组）；亲密/互动镜头可 1 张同框（≤2 人）；**3 人以上不同框**（会串脸）。');
    lines.push('· 【人物段 = 静态锚点·每轮必写】从角色卡/世界书【照抄原文】，禁止改写、缩写、省略。必含这 7 项硬需求（缺一项插件AI只能瞎猜，身材/年龄就丢）：');
    lines.push('    ① 人种（角色卡没写明就写「亚洲人」）　② 年龄　③ 性征（女/男；人妖·伪娘·变性等写「外在X·内在Y」，如 外在女·内在男）　④ 身材轮廓（拆成 2-4 个独立标签：细腰，大胸，长腿 —— 不要拼成「细腰大胸」）　⑤ 胸部（平/小巧/适中/丰满/巨乳）　⑥ 永久标记（痣/疤/胎记，没有就写「无」）　⑦ 面部基础（脸型/眼型/瞳色 —— 没写插件只能瞎猜）');
    lines.push('  后面接角色卡里的脸型/五官。例：');
    lines.push('    人物:温若兰（邻家人妻）：亚洲人，26岁女性，高挑，细腰，大胸，长腿，胸部丰满，左眼角有美人痣，鹅蛋脸，杏眼，深棕瞳，眉形柔和，鼻梁挺直，唇形偏薄');
    lines.push('  ⚠️ 【身材轮廓 + 胸部 禁止留空】——只写「纤细/匀称」这类体脂词，生图模型缺体型标签时会默认画成**幼态（萝莉）**；必须把胸部与腰臀写清。永久标记也要写「无」，别留空（留空会被脑补出一颗痣）。');
    lines.push('· 【要点 = 本轮动态】**怎么穿**（滑落/卷袖/敞开/湿透）+ 表情/神态/动作/姿势/光线/氛围/构图，写详细。');
    lines.push('· 静态 vs 动态分界：痣/疤/胎记/瞳色/身高体型 = 静态（写人物段）；受伤/淤青/脸红/换衣服/换发型 = 本轮（写要点）。');
    lines.push('· 人物穿着（上衣/下装/内衣等）如实写入要点，生图按描述呈现。');
    var _modeNow = getActiveMode();
    // [Fix] 画风预设只在 ZIT 模式实际应用（comfyui.js generateImage），anime 模式不再谎称"已自动应用"（C4）
    lines.push('· 当前模式：' + modeDesc(_modeNow) + '；' + (settings.stylePreset ? ('画风预设：「' + settings.stylePreset + '」' + (_modeNow === 'zit' || !_modeNow ? '已自动应用；' : '（中文预设，生图时未自动应用，按需在画面要点中体现风格）；')) : '画风预设：未选择；') + (settings.nsfwEnhance ? '成人内容：按卡内容如实配图。' : ''));
    lines.push('【人物档案索引】（引用时必须用这里的原始名字，禁止自创简称/标签）');
    // v1.3：不再按「角色卡人物/剧情收集人物」分，改为按「有没有静态锚点」分——
    // 原来那套把"名字在表里但外貌是空的"的人也标成"已建档"，直接导致主模型永远不写外貌（死循环）。
    var entries = rosterEntries();
    var withAnchor = [], noAnchor = [];
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var mark = '';
        if (e._updated) { mark = '*更新*'; e._updated = false; }
        var hasBase = !!(e.base && String(e.base).length >= 20);
        (hasBase ? withAnchor : noAnchor).push(e.key + mark);
    }
    if (withAnchor.length) lines.push('· 已有静态锚点：' + withAnchor.join('、'));
    if (noAnchor.length) lines.push('· ⚠️ 尚无锚点（人物段必须写全 7 项硬需求 + 角色卡外貌）：' + noAnchor.join('、'));
    if (!withAnchor.length && !noAnchor.length) lines.push('（暂无记录；出现的所有人物都按上面的硬需求写。）');
    lines.push('· 【不管在不在索引里，人物段的静态锚点都要照写】写重复没有任何代价（插件按"来源优先级+更长者胜"合并，不会被写短顶掉）；写漏了才会永久丢长相。');
    lines.push('· 身份标签必须与索引一致（同名人物靠标签区分）。');
    // ── v1.5.0【造型段】：服装/发型/鞋袜/配饰/妆容 ──
    // 为什么要它：这三样写在【要点】里是自由文本，插件AI 每轮换一种说法 → 同一件衣服画出两个样。
    // 改成"写 key → 插件存档 → 之后原样复用"即可消除漂移。
    lines.push('');
    lines.push('【造型段·第三段·可选但强烈建议】写在这一段里，位置在【要点】之前：');
    lines.push('    [img:场景描述|人物:名字（标签）：静态外貌特征|造型:服装=key；发型=key；鞋袜=key；配饰=key；妆容=key|要点1，要点2]');
    lines.push('· 五个槽：服装 / 发型 / 鞋袜 / 配饰 / 妆容（一个槽多个 key 用「、」分隔；不需要的槽可省略）');
    lines.push('· 【key 由你写全·命名规范】');
    lines.push('    共享服装 = 机构/学校/门派名·套装名   例：XX中学·校服（夏季）、帝国军·尉官制服、和服（正式）');
    lines.push('    个人造型 = 人名·造型名               例：温若兰·真丝吊带+开衫、温若兰·短发扎尾');
    lines.push('    ⚠️ **同校/同机构的人写同一个 key → 自动共用同一套**（一套校服只需具象化一次）');
    lines.push('    ⚠️ **发型必须带人名**（千人千面：不同人的「短发」不是同一个东西）');
    lines.push('· 【只写"是什么"，不写"怎么穿"】：造型段写"哪套衣服/哪个发型"；「滑落/卷袖/湿透/敞开/褪到肘」写【要点】');
    lines.push('  （写进造型段会被存档冻死，下一轮想穿上都穿不回来）');
    lines.push('· 【造型库索引】下面列出的 key 直接照抄即可命中，插件会原样复用、不会漂：');
    lines.push('');
    lines.push('【状态段·第四段·可选】时效性状态（晒黑/染发/吻痕/淤青/缠绷带…），写在这一段里：');
    lines.push('    [img:场景|人物:…|造型:…|状态:+晒黑；+左颈吻痕；-淤青|要点]');
    lines.push('  +key = 激活/新增（库里没有 → 插件具象化建档）；-key = 取消（条目保留，可再 +）');
    lines.push('  ⚠️ 每张图都写当前生效的状态；只写是什么，不写淡了/快消了（那是要点）');
    lines.push('  ⚠️ 不会自动过期 —— 该取消时务必写 -key，否则会一直画在她身上');
    lines.push('⛔ 别搞混：永久纹身/疤/痣/穿孔 → 写【人物段】，只写一次（插件会并入档案）');
    var _wIdx = wardrobeIndexText();
    if (_wIdx) lines.push(_wIdx); else lines.push('  （本场聊天暂无存档——你写的新 key 会被具象化并存档，之后一直复用）');
    lines.push('');
    lines.push('· 【状态库索引】下面列出的 key **直接照抄**（连"左颈"这种位置一起抄），插件按 key 命中就不会重复建档：');
    var _sIdx = statusesIndexText();
    if (_sIdx) lines.push(_sIdx); else lines.push('  （本场聊天暂无状态存档——你写的新 key 会被具象化并存档，之后用 +key 复用）');
    lines.push('  ⚠️ 状态要**每张图都写**（写当前生效的那些）；想撤销就写 -key');
    lines.push('· 你是编剧也是导演：表情/姿态/光线/构图按剧情写详细；选用户最想看的画面——亲密/性感/精彩瞬间/绝美场景，按剧情如实，不做回避。');
    return lines.join('\n');
}

// 刷新注入（启动/切聊天/档案变化/设置变化时调用）
export function refreshCoopCards() {
    try {
        var ctx = getSTContext();
        if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;
        if (settings.injectCards === false) {
            if (ctx.setExtensionPrompt) ctx.setExtensionPrompt(MODULE, '', POSITION, 0);
            return;
        }
        var text = buildCoopCardText();
        ctx.setExtensionPrompt(MODULE, text, POSITION, 0);
        slLog('协作卡已注入: ' + text.length + '字, 人物索引 ' + rosterEntries().length + ' 人');
    } catch (e) { slLog('协作卡注入异常: ' + e.message); }
}

export var COOP_MODULE = MODULE;
