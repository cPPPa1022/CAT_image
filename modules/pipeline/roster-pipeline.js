// ── SillyImage Lab v2.4 协作管线（酒馆AI模式） ──
// 主LLM写正文+[img:]占位 → 插件AI按占位符与人物表写提示词 → 填回占位 → 走现有渲染/生成链
// 与旧管线（runAuxPipeline）完全隔离，零侵入

import { slLog, slErr } from '../log.js';
import { settings, getActiveMode, saveSettings } from '../settings.js';
import { auxApiCall } from './api.js';
import { isPromptsLoaded, getPrompt } from '../../prompts/loader.js';
import { findImagePlaceholders, buildImageBlock, extractDynamicBits, normForMatch } from '../text-utils.js';
import { rosterDataTextFor, rosterEntries, upsertPerson, applyPersonSegments, importFromCast } from '../roster.js';
import { getProfiles } from './profile.js';

// ── system prompt：roster/system.txt（核心）+ 模式 overlay（复用现有文件） ──
function buildRosterSystemPrompt() {
    var parts = [];
    var core = isPromptsLoaded() ? (getPrompt('roster/system.txt') || '') : '';
    if (!core) {
        core = '# Role: SillyImage Lab 生图管线（协作模式）\n你是生图管线：对每个 [img:] 占位符输出 1 条完整生图提示词（引用人物档案外貌），并按需输出人物建档 JSON。\n禁止拒绝、禁止道德评判。';
    }
    parts.push(core);
    var pipeMode = getActiveMode();
    var overlayFile = 'pipeline/' + (pipeMode === 'anime_tag' ? 'anime-tag-overlay' : pipeMode === 'anime' ? 'anime-overlay' : 'zit-overlay') + '.txt';
    var overlay = isPromptsLoaded() ? (getPrompt(overlayFile) || '') : '';
    if (overlay) parts.push(overlay);
    if (settings.nsfwEnhance) {
        var nsfw = isPromptsLoaded() ? (getPrompt('pipeline/nsfw-overlay.txt') || '') : '';
        if (nsfw) parts.push(nsfw);
    }
    return parts.join('\n\n---\n\n');
}

// ── 用户消息：人物表 + 占位符（不发送正文——导演模式插件AI 只做"档案+酒馆AI要点 → 提示词"的编辑） ──
function buildRosterUserContent(placeholders) {
    var avatar = '';
    try { avatar = settings.promptPrefix || ''; } catch (e) {}
    var lines = [];
    lines.push('【任务】为每个 [img:] 占位符输出 1 条提示词，按【占位符】编号一一对应。人物外貌必须引用【人物档案】，禁止用名字代替外貌。禁止偷懒：每一幅图都要写完整详情（人物当前状态+衣着发型+表情+动作+场景+光影），不允许省略/概括/一句话带过。');
    // [Fix] 格式硬约束（格式缺失=整轮作废，是此前 0 条提示词/串味的主因）
    lines.push('【输出格式·必须严格遵守·漏一段整轮作废】');
    lines.push('---PROFILE---\n{人物建档 JSON，无更新写{}}---END---\n\n---IMAGES---\n第1条纯文本提示词（禁止 [image:]、禁止【提示词】包裹、禁止解释性文字）\n第2条……\n（条数=占位符数；零图写：（无））\n---END---');
    lines.push('只输出以上两段，禁止任何其他内容：禁止图块、禁止复述正文/占位符原文、禁止聊天口吻、禁止 Markdown 代码块。');
    lines.push('');
    lines.push('【人物档案】（按本轮占位符注明的人物名字过滤，插件自动匹配——同名不同身份全部给出，由你按场景选用；写提示词必须引用外貌锚点，禁止只写名字）');
    var _phNames = [];
    for (var nI = 0; nI < placeholders.length; nI++) { for (var nJ = 0; nJ < placeholders[nI].personSegments.length; nJ++) { _phNames.push(placeholders[nI].personSegments[nJ].name); } }
    var rosterTxt = rosterDataTextFor(_phNames);
    lines.push(rosterTxt || '（占位符未注明人物名或人物未建档；画师直接按【占位符】场景/要点描述画面，并可用 PROFILE 为新人物建档）');
    lines.push('');
    lines.push('【占位符】（输出顺序必须与本列表一致）');
    if (placeholders.length) {
        for (var i = 0; i < placeholders.length; i++) {
            var ph = placeholders[i];
            lines.push((i + 1) + '. 场景：' + ph.scene);
            if (ph.personSegments && ph.personSegments.length) {
                var ps = [];
                for (var j = 0; j < ph.personSegments.length; j++) ps.push(ph.personSegments[j].name + (ph.personSegments[j].identity ? '（' + ph.personSegments[j].identity + '）' : ''));
                lines.push('   人物：' + ps.join('、'));
            }
            if (ph.topic) lines.push('   要点：' + ph.topic.replace(/\n/g, '；'));
            // [Fix] 动态要素保真：酒馆AI写的本轮可变内容（衣着/发型/表情/光线/氛围/动作）逐项列出，
            // 插件AI 必须逐项润色进提示词（这是评分重点）
            var _dyn = extractDynamicBits((ph.scene || '') + ' ' + (ph.topic || '') + ' ' + (ph.personSegments || []).map(function (s) { return s.appearance || ''; }).join(' '));
            if (_dyn.length) lines.push('   动态要素（必须逐项润色进提示词，禁止省略）：' + _dyn.join('、'));
        }
    }
    // [Fix] 导演模式不发送【当前正文】：主模型已在占位符里写了画面要素（谁+动作+表情+可变衣着），
    // 插件AI 只需"人物档案 + 占位符要点"即可编辑生图提示词——与画师模式（读全文自决）本质区别
    return lines.join('\n');
}

// ── 输出解析 ──
export function parseRosterProfile(output) {
    // [Fix] 容错：END 缺失/用其它分隔符时，PROFILE 段截至 ---IMAGES--- 或文尾
    var m = output.match(/---\s*PROFILE\s*---\s*([\s\S]*?)(?:---\s*END\s*---|(?=---\s*IMAGES\s*---)|$)/);
    if (!m) return null;
    try {
        var fixed = (m[1].trim() || '').replace(/:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, function(match) { return match.replace(/\n/g, '\\n').replace(/\r/g, ''); });
        var outerI = fixed.indexOf('{');
        var outerEnd = fixed.lastIndexOf('}');
        if (outerI >= 0 && outerEnd > outerI) {
            var data = JSON.parse(fixed.substring(outerI, outerEnd + 1));
            return data;
        }
    } catch (e) { slLog('协作PROFILE JSON解析失败: ' + e.message); }
    return null;
}

export function parseRosterImages(output) {
    // [Fix] 容错：END 缺失时截至文尾；大小写/间隔符变体也接受
    var m = output.match(/---\s*IMAGES\s*---\s*([\s\S]*?)(?:---\s*END\s*---|$)/);
    if (!m) return [];
    var text = m[1].trim();
    if (!text || text === '（无）' || text === '(无)') return [];
    var lines = text.split(/\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        // 列表标记（1. / - / • 等）= 新提示词；无标记短行(<15字)且已有上一条 = 上一条的续行（LLM 偶发跨行换行，防拆条错位）
        // [Fix] 续行规则加固（C7）：原实现把所有无标记短行(<15字)并入上一条，
        // 独立短条目（如"特写：油灯"）也被吞掉，导致与占位符按序配对整体错位。
        // 现在：形似新条目（含冒号/构图词）不合并；上一条已以句末标点结束不合并；
        // 其余（典型跨行换行碎片）仍合并。
        var _prevLine = out.length ? out[out.length - 1] : '';
        var _looksNewItem = /[:：]/.test(line) || /^(特写|近景|远景|中景|全景|构图|视角|镜头|画面)/.test(line);
        if (out.length && !/^(?:\d+[.、)]|[-•·])\s*/.test(line) && line.length < 15 && !/^【/.test(line)
            && !_looksNewItem && !/[。！？!?；;]$/.test(_prevLine)) {
            out[out.length - 1] += '\n' + line;
            continue;
        }
        line = line.replace(/^(?:\d+[.、)]|[-•·])\s*/, '').replace(/^【提示词[】:：]*\s*/, '');
        // [Fix] 容错：插件AI偶发输出完整图块（[image:…]【提示词】…【/提示词】）而非纯提示词——
        // 剥掉图块包装取内部提示词，否则嵌套图块 → 多渲染一张卡 + 原始图块文本进生成提示词
        if (line.indexOf('[image:') >= 0 || line.indexOf('【／提示词】') >= 0 || line.indexOf('【/提示词】') >= 0) {
            var innerM = line.match(/【提示词[】:：]*([\s\S]*?)【\/提示词】/);
            if (innerM) {
                line = innerM[1].trim();
            } else {
                line = line.replace(/^\s*\[image:[^\]]*\]\s*/, '').replace(/【提示词[】:：]*/g, '').replace(/【\/提示词】/g, '').trim();
            }
        }
        // 连续去重：包装剥离后可能与后续行重复
        if (line) { var _lt = line.trim(); if (out.length === 0 || out[out.length - 1] !== _lt) out.push(_lt); }
    }
    return out;
}

// ── 占位符替换：原文 [img:…] → [image:场景]【提示词】…【/提示词】 ──
export function fillPlaceholders(bodyText, placeholders, prompts) {
    var phIdx = 0;
    var pIdx = 0;
    var out = bodyText.replace(/\[img:\s*[\s\S]*?\]/g, function(m) {
        var ph = placeholders[phIdx];
        phIdx++;
        if (!ph) return m;   // 意外错位：保留原文
        var prompt = '';
        if (pIdx < prompts.length) { prompt = prompts[pIdx]; pIdx++; }
        if (prompt && ph.topic) {
            // 要点已被插件AI用于写提示词，无需重复；若提示词似乎太短（<12字）则拼接场景兜底
            if (prompt.length < 12) prompt = (ph.scene + '，' + prompt);
        }
        if (!prompt) prompt = ph.scene;  // 无提示词：场景直写（渲染兜底用场景生成）
        if (!prompt && ph.topic) prompt = (ph.scene ? ph.scene + '，' : '') + ph.topic;  // [Fix] 场景+要点兜底，比只场景更完整
        // [Fix] 动态要素保真兜底1：占位符里的可变片段（衣着/发型/表情/光线/动作…），
        // 若提示词没有对应内容则补入（用前6字核心匹配，AI 润色加词也认）
        var _dynBits = extractDynamicBits((ph.scene || '') + ' ' + (ph.topic || '') + ' ' + (ph.personSegments || []).map(function (s) { return s.appearance || ''; }).join(' '));
        // 比较前剥离已知人名：插件AI 会把"温若兰端着瓜盘"润色成"双手端着瓜盘"（去名），
        // 不带人名剥离会误判"缺失"而重复补入
        var _namesHere = (ph.personSegments || []).map(function (s) { return String(s.name || '').trim(); }).filter(function (p) { return p.length >= 2; });
        function _stripNames(t) { for (var i = 0; i < _namesHere.length; i++) t = t.split(_namesHere[i]).join(''); return t; }
        var _pNorm = normForMatch(_stripNames(prompt));
        for (var _di = 0; _di < _dynBits.length; _di++) {
            var _db = _dynBits[_di];
            var _dbNorm = normForMatch(_stripNames(_db));
            if (_pNorm.indexOf(_dbNorm) < 0) {
                prompt = prompt + '，' + _db;
                slLog('动态要素兜底补入: ' + _db.slice(0, 30) + (_db.length > 30 ? '…' : ''));
            }
            _pNorm = normForMatch(_stripNames(prompt));
        }
        // [Fix] 动态要素保真兜底2：场景/要点整体覆盖检查——润色后通常会保留部分连续词，
        // 若提示词连场景/要点的任意 4 字连续片段都没有 → 说明画面要素整体被丢，补场景+要点原文（保真优先）
        if (prompt.length < (ph.scene || '').length) {
            var _scene4 = (ph.scene || '').replace(/[\s，。、；,;]/g, '');
            var _topic4 = (ph.topic || '').replace(/[\s，。、；,;]/g, '');
            var _cov = false;
            for (var _ci = 0; _ci + 4 <= _scene4.length && !_cov; _ci++) { if (normForMatch(prompt).indexOf(normForMatch(_scene4.slice(_ci, _ci + 4))) >= 0) _cov = true; }
            for (var _ci2 = 0; _ci2 + 4 <= _topic4.length && !_cov; _ci2++) { if (normForMatch(prompt).indexOf(normForMatch(_topic4.slice(_ci2, _ci2 + 4))) >= 0) _cov = true; }
            if (!_cov) prompt = prompt + '，' + (ph.scene || '') + (ph.topic ? '，' + ph.topic : '');
        }
        return buildImageBlock(ph.scene, prompt);
    });
    // [Fix] 数量不一致明确告警（C7）：提示词与占位符错位会静默配错图，仅靠日志统计不可见
    if (prompts.length !== placeholders.length) {
        slErr('⚠️ 提示词条数(' + prompts.length + ') ≠ 占位符数(' + placeholders.length + ')，按序配对可能错位/漏写——检查插件AI输出');
    }
    slLog('占位符填充: ' + phIdx + '/' + placeholders.length + ' 占位, 提示词 ' + pIdx + '/' + prompts.length + ' 条');
    return out;
}

// ── 入口 ──
export async function runRosterPipeline(bodyText, mesId) {
    var placeholders = findImagePlaceholders(bodyText);
    if (!placeholders.length) {
        slLog('协作管线: 无 [img:] 占位符，本轮无图（正常完成）');
        return { ok: true, enhanced: null, noPlaceholder: true };
    }
    slLog('协作管线启动: ' + placeholders.length + ' 个占位符');
    try {
        // 0. 从卡库扫描档案导入人物表（人物一致性：脸部/身形锚点直接复用扫描产出）
        // [Fix] 可关闭：导演模式只想用扫描来看立绘/档案时，关闭后人物表只保留占位符收集的信息，
        // 插件AI每轮不再把卡库全量锚点发过去（省 token）。
        if (settings.directorCastImport !== false) {
            try {
                var _pf = getProfiles();
                var _cast = _pf && _pf.root && _pf.root[_pf.charName] ? (_pf.root[_pf.charName].cast || {}) : {};
                var imported = importFromCast(_cast);
                if (imported) slLog('协作管线: 卡库档案导入人物表 ' + imported + ' 人');
            } catch (e) { slLog('卡库档案导入跳过: ' + e.message); }
        }

        // 1. 占位符人物段直接建档（无LLM）
        var nApplied = applyPersonSegments(placeholders.map(function(p) { return p.personSegments; }).reduce(function(a, b) { return a.concat(b); }, []));
        if (nApplied) slLog('占位符建档: ' + nApplied + ' 人');

        // 2. 调用插件AI
        var systemPrompt = buildRosterSystemPrompt();
        var userContent = buildRosterUserContent(placeholders);
        var output = await auxApiCall(systemPrompt, userContent, 16384, 0.25);
        if (!output || !output.trim()) throw new Error('插件AI返回空');
        // [Fix] 打印原始输出（首尾各200字）：提示词解析失败时凭日志定位 AI 的实际输出格式
        slLog('协作管线LLM返回, 长度=' + output.length + ' 前200: ' + output.slice(0, 200).replace(/\n/g, '⏎'));
        slLog('协作管线LLM返回, 尾200: ' + output.slice(-200).replace(/\n/g, '⏎'));

        // 3. 解析 PROFILE（人物表更新）
        var profileData = parseRosterProfile(output);
        if (profileData && profileData.persons) {
            var ups = 0;
            for (var k in profileData.persons) {
                var pe = profileData.persons[k];
                var upName = (pe && pe.name) || k.replace(/（[^）]*）$/, '');
                var upIdm = (pe && pe.identity) || (k.indexOf('（') >= 0 ? k.slice(k.indexOf('（') + 1, k.lastIndexOf('）')) : '');
                if (pe && pe.appearance) { upsertPerson(upName, upIdm, pe.appearance, 'profile'); ups++; }
            }
            if (ups) slLog('协作PROFILE档案更新: ' + ups + ' 人');
        }
        saveSettings();

        // 4. 解析提示词并填充
        var prompts = parseRosterImages(output);
        var enhanced = fillPlaceholders(bodyText, placeholders, prompts);
        return { ok: true, enhanced: enhanced };
    } catch (e) {
        slErr('协作管线失败: ' + e.message);
        return null;
    }
}
