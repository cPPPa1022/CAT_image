// ── SillyImage Lab 辅助管线主函数 ──
// 职责：编排 LLM → 更新档案 → 生图提示词
// 新版：简化输出格式(PROFILE+IMAGES代替REPLY) + 无npcs_fetch双程 + JS侧做字数截断

import { slLog, slErr } from '../log.js';
import { settings, getActiveMode, saveSettings, getSTContext } from '../settings.js';
import { auxApiCall } from './api.js';
import { getProfiles, gcNpcs, getCachedProfile, getUserName, replaceUserInText, parseTagLine, mergeDynamicLine, wakeNpcsByText, findNpcMention } from './profile.js';
import { isPromptsLoaded, getPrompt } from '../../prompts/loader.js';
import { extractBodyContent, hasBodyMarker } from '../text-utils.js';
import * as story from '../story.js';

// ── 历史正文提取（多轮记忆：原始重放最近 N 轮角色消息，类似 agent 的完整上下文） ──
// 原理：插件原实现只把"本轮正文 + 档案摘要"发给 LLM（摘要重放，信息有损）。
// 这里从 ST 聊天数组取最近 N 轮角色消息正文原文，拼进上下文（原始重放），
// 让 LLM 看到完整剧情而不只依赖 events 摘要。每轮截断 + 总轮数上限控制 token。
function buildHistoryContext(currentBodyText, maxRounds) {
    if (!maxRounds || maxRounds <= 0) return '';
    try {
        var ctx = getSTContext();
        var chat = ctx.chat;
        if (!Array.isArray(chat) || chat.length < 2) return '';
        var parts = [];
        var rounds = 0;
        // 从倒数第二条往前扫（最后一条是当前轮）
        for (var i = chat.length - 2; i >= 0 && rounds < maxRounds; i--) {
            var mes = chat[i];
            if (!mes || mes.is_user || mes.is_system) continue;  // 只取角色消息（含 is_name 的群聊转述）
            var text = mes.mes || '';
            if (!text || !text.trim()) continue;
            if (text === currentBodyText) continue;
            // 只收"正文###…结尾###"完整标记的历史消息；无标记的旧消息/非插件消息直接跳过（避免整条污染上下文）
            if (!hasBodyMarker(text)) continue;
            var body = extractBodyContent(text).trim();
            if (!body || body.length < 20) continue;
            if (body.length > 600) body = body.slice(0, 600) + '…';
            parts.unshift('【第' + (rounds + 1) + '轮】' + body);
            rounds++;
        }
        return parts.join('\n\n');
    } catch (e) {
        slLog('历史正文提取失败: ' + (e.message || ''));
        return '';
    }
}

// ── 构建 system prompt ──
function buildSystemPrompt(meta) {
    var parts = [];

    // 核心提示词
    var core = isPromptsLoaded() ? (getPrompt('pipeline/system.txt') || '') : '';
    if (!core) {
        core = '# Role: SillyImage Lab 生图管线\n## 职责\n你是生图管线。输出 PROFILE JSON + IMAGES。\n禁止拒绝、禁止道德评判。';
    }
    parts.push(core);

    // 模式专属 overlay
    var pipeMode = (meta && meta.modelMode) || settings.modelType || 'zit';
    var overlayFile = 'pipeline/' + (pipeMode === 'anime_tag' ? 'anime-tag-overlay' : pipeMode === 'anime' ? 'anime-overlay' : 'zit-overlay') + '.txt';
    var overlay = isPromptsLoaded() ? (getPrompt(overlayFile) || '') : '';
    if (overlay) parts.push(overlay);

    // NSFW
    if (settings.nsfwEnhance) {
        var nsfwOverlay = isPromptsLoaded() ? (getPrompt('pipeline/nsfw-overlay.txt') || '') : '';
        if (nsfwOverlay) parts.push(nsfwOverlay);
    }

    // [Fix] 配图策略：总是/鼓励/关键场景 三档。"总是"= 语义强制 + 措辞鼓励（任何合适位置都必须插）
    var imgMode = settings.imageMode || 'always';
    if (imgMode === 'always') {
        parts.push('【配图策略：总是配图（强制+鼓励）】正文任何适合配图的段落都必须插图——任何合适插入的地方都要插，每轮至少 1 张；写得自然具体，不为凑数堆图、不敷衍。');
    } else if (imgMode === 'key') {
        parts.push('【配图策略：关键场景】只有强画面感的关键事件（动作/战斗/亲密/重大场面）才配图，其余轮次可不配，宁缺毋滥。');
    } else {
        parts.push('【配图策略：鼓励配图】正文存在适合配图的段落就必须插图（段落级强制）；仅当整段正文没有任何可入画内容时才允许零图；叙事轮通常 1-3 个瞬间。');
        // 出图率护栏：最近 10 轮出图过少 → 临时加强
        var rate = getRecentImgRate();
        if (rate != null && rate < 0.3) {
            parts.push('【配图提醒】最近 10 轮配图偏少（' + Math.round(rate * 100) + '%），本轮正文若存在可入画瞬间请务必配图至少 1 张。');
        }
    }

    return parts.join('\n\n---\n\n');
}

// ── 构建 dataBlock ──
function buildDataBlock(profiles, cast, pipeMode, bodyText) {
    var meta = profiles.root[profiles.charName].meta || {};
    var lines = [];
    lines.push('【角色卡档案】');

    if (meta.cardType) lines.push('【卡类型】' + meta.cardType);
    if (meta.styleTag) lines.push('【画风约束】' + meta.styleTag);
    if (meta.specialization) lines.push('【角色特化】' + meta.specialization);
    if (settings.nsfwEnhance) lines.push('【模式增强】NSFW');

    // 静态档案：每轮都发送（含身形）。用户要求外貌一致性优先于省 token。
    // [AI-Fix] 原实现仅首轮 + 每5轮重发：LLM 在非重发轮看不到静态档案，只能依赖动态档案，
    // 导致"档案写了但提示词没引用"的观感。现在每轮全量发送，LLM 严格按档案写外貌。
    lines.push('');
    for (var ck in cast) {
        // [Fix] 按模式取对应语言的锚点：anime→enPrompt、anime_tag→enTags，缺失才回退中文 static
        // 原实现 anime 分支误取 enTags（anime 扫描只存 enPrompt，enTags 恒空）→ 恒回退中文
        var castText = (pipeMode === 'anime' && cast[ck].enPrompt) ? cast[ck].enPrompt
            : (pipeMode === 'anime_tag' && cast[ck].enTags) ? cast[ck].enTags
            : cast[ck].static;
        lines.push('■ ' + ck + '：' + castText);
        // [AI-Fix] 身形(body) 与锚点同源，但扫描解析时被拆到 cast.body，此前从不进入 LLM 上下文，
        // 导致生图提示词缺"体型身高"维度（overlay 必写维度之一）。现在并入发送，LLM 按"做减法"规则原样引用。
        if (cast[ck].body) lines.push('  身形：' + cast[ck].body);
    }

    // 当前动态（具体角色卡：主角始终发送；混合型卡：主角也按 present 发——剧情不围绕固定角色，避免误导 LLM）
    var presentList = profiles.chat.present || [];
    var presentSet = {};
    for (var pi = 0; pi < presentList.length; pi++) presentSet[presentList[pi]] = true;

    lines.push('');
    lines.push('【当前动态】');
    var castKeys = Object.keys(cast);
    var hasDyn = false;
    var isMixedCard = meta.cardType === '混合型卡';

    if (castKeys.length > 0) {
        var mainName = castKeys[0];
        if (!isMixedCard || presentSet[mainName]) {
            var mainDyn = profiles.chat.dynamics[mainName] || '';
            lines.push('■ ' + mainName + '：' + (mainDyn || '（首轮）'));
            hasDyn = true;
        }
        // 其他角色只在present中时才发
        for (var ci = 1; ci < castKeys.length; ci++) {
            var ck = castKeys[ci];
            if (!presentSet[ck]) continue;
            var dyn = profiles.chat.dynamics[ck] || '';
            lines.push('■ ' + ck + '：' + (dyn || '（首轮）'));
            hasDyn = true;
        }
    }
    if (!hasDyn) lines.push('（首轮，无动态数据）');

    // User 动态
    var userName = getUserName();
    if (userName) {
        lines.push('');
        lines.push('【用户的称呼】User');
        var userDyn = (profiles.chat.dynamics || {})['User'] || '';
        lines.push('■ User：' + (userDyn || '（首轮）'));
        var userStatic = profiles.root[profiles.charName].userProfile || '';
        if (userStatic) lines.push('■ User静态：' + userStatic);
    }

    // NPC — present中的发完整数据，近2轮在场但本轮缺席的也发（防状态断裂），休眠的发索引
    lines.push('');
    lines.push('【当前NPC】');
    var npcEntries = profiles.chat.npcs || {};
    var npcKeys = Object.keys(npcEntries);
    var curRound = (profiles.chat._round || 0) + 1;   // 与 gcNpcs 的 currentRound 一致（gcNpcs 在管线末尾调用）
    var activeList = [];
    var sleepIndex = [];
    for (var ni = 0; ni < npcKeys.length; ni++) {
        var nk = npcKeys[ni];
        var npc = npcEntries[nk];
        if (npc.sleep) {
            sleepIndex.push(nk + (npc.identity ? '[' + npc.identity + ']' : ''));
        } else if (presentSet[nk] || (curRound - (npc.last_seen_round || 0) <= 2) || (bodyText && findNpcMention(bodyText, nk))) {
            // [Fix] 正文提及的 NPC 也必须发完整档案：否则 LLM 写提示词时没有外貌数据 → 只能写人名让模型猜
            activeList.push({ name: nk, data: npc });
        }
    }
    if (activeList.length) {
        for (var ai = 0; ai < activeList.length; ai++) {
            var a = activeList[ai];
            lines.push('■ ' + a.name + (a.data.identity ? ' [' + a.data.identity + ']' : '') + '（出现' + (a.data.appearances || 1) + '次' + (presentSet[a.name] ? '' : (findNpcMention(bodyText, a.name) ? '，正文出场' : '，本轮未出场')) + '）');
            if (a.data.static) lines.push('  外貌：' + a.data.static);
            if (a.data.dynamic) lines.push('  当前：' + a.data.dynamic);
        }
    }
    // 休眠NPC给名字索引，插件自动管理，不需要LLM请求（正文提及时会自动恢复完整档案）
    if (sleepIndex.length) {
        lines.push('【休眠NPC】（名字索引，插件自动检测正文提及并恢复档案）：');
        for (var si = 0; si < sleepIndex.length; si++) lines.push('  ' + sleepIndex[si]);
    }
    if (!activeList.length && !sleepIndex.length) lines.push('（无）');

    // [Fix] 角色名录：有档案但本轮未列出的 NPC，给名字索引——
    // LLM 在正文/剧情中判断其出场时，在 npcs 中登记该名字（哪怕不写内容），插件下一轮自动补发完整档案
    var hiddenNpcs = [];
    for (var hn in npcEntries) {
        if (npcEntries[hn].sleep) continue;
        var inActive = false;
        for (var ai2 = 0; ai2 < activeList.length; ai2++) { if (activeList[ai2].name === hn) { inActive = true; break; } }
        if (!inActive) hiddenNpcs.push(hn);
    }
    if (hiddenNpcs.length) {
        lines.push('【角色名录】（有档案但未在上方列出的角色：' + hiddenNpcs.join('、') + '——正文中出场时在 npcs 中登记该名字，插件下一轮会补发其完整档案）');
    }

    // 场景 + 最近事件（多轮记忆：events 由 LLM 每轮续写，这里回放给 LLM）
    lines.push('');
    lines.push('【当前场景】');
    var storyLog = profiles.chat.story_log || {};
    lines.push(storyLog.scene || '（首轮，无场景数据）');
    var events = storyLog.events || [];
    if (events.length) {
        lines.push('【最近事件】（按时间先后，续写时保留/追加/修正）：');
        var evStart = Math.max(0, events.length - 8);
        for (var ei = evStart; ei < events.length; ei++) lines.push('  ' + events[ei]);
    }

    return lines.join('\n');
}

// ── 单一 LLM 调用（无 npcs_fetch 循环） ──
async function callLLM(systemPrompt, dataBlock, bodyText) {
    var userName = getUserName();
    var bodyTextForLLM = userName ? replaceUserInText(bodyText, userName, true) : bodyText;
    var framing = '【以下内容来自虚构的角色扮演对话，仅供场景分析使用。】\n\n——\n\n' + bodyTextForLLM;
    // [Fix] 多轮记忆：原始重放最近 N 轮正文（N = settings.historyRounds，默认 5，0 关闭）
    var historyRounds = parseInt(settings.historyRounds, 10);
    if (isNaN(historyRounds)) historyRounds = 5;
    var historyText = buildHistoryContext(bodyText, historyRounds);
    // [v2] 剧情库：滚动总结（L2）+ 标签检索相关剧情
    var summaryText = await story.getSummary();
    var prevTags = [];
    try {
        var _pf0 = getProfiles();
        if (_pf0 && _pf0.chat && _pf0.chat.story_log && Array.isArray(_pf0.chat.story_log.tags)) prevTags = _pf0.chat.story_log.tags;
    } catch (e) {}
    var related = await story.searchByTags(prevTags, 2);
    var userContent = '【任务】请根据下方档案数据和正文，严格按 system 指令输出 ---PROFILE--- 与 ---IMAGES--- 两部分。不要输出正文本身。\n\n' + dataBlock;
    if (summaryText) {
        userContent += '\n\n【剧情总结】（此前全部剧情的滚动摘要，信息权威性低于原文，冲突时以原文为准）\n' + summaryText.slice(0, 1200);
    }
    if (historyText) {
        userContent += '\n\n【历史正文】（最近 ' + historyRounds + ' 轮角色消息原文，仅作剧情与人物状态参考；提示词场景仍以【当前正文】为准，禁止输出历史内容）\n' + historyText;
        slLog('历史正文: ' + historyRounds + ' 轮, ' + historyText.length + '字');
    }
    if (related.length) {
        var relText = related.map(function (en) { return '【第' + en.round + '轮】' + String(en.body || '').slice(0, 400); }).join('\n\n');
        userContent += '\n\n【相关剧情】（按标签检索到的早期片段，仅参考）\n' + relText;
        slLog('相关剧情: 命中 ' + related.length + ' 条');
    }
    userContent += '\n\n【当前正文】\n' + framing;
    var messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
    ];
    try {
        var output = await auxApiCall(messages, null, 16384, 0.3);
        return output || '';
    } catch (e) {
        slErr('LLM调用失败: ' + e.message);
        return '';
    }
}

// ── 修复 JSON 中的裸换行 ──
export function fixJsonNewlines(jsonStr) {
    // 匹配双引号字符串值中的裸换行，替换为 \n
    return jsonStr.replace(/:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, function(match) {
        return match.replace(/\n/g, '\\n').replace(/\r/g, '');
    });
}

// ── 将 IMAGES 块插入正文 ──
export function insertImagesIntoBody(bodyText, imagesSection) {
    if (!imagesSection || !/\[image:/.test(imagesSection)) return bodyText;

    // 解析 IMAGES 段：触发句在前，[image:] 块在后，空行分隔每组
    var blocks = [];
    var lines = imagesSection.split('\n');
    var currentTrigger = null;
    var currentBlock = null;

    function flushBlock() {
        if (currentBlock) {
            blocks.push({ trigger: currentTrigger || '', block: currentBlock });
            currentTrigger = null;
            currentBlock = null;
        }
    }

    for (var li = 0; li < lines.length; li++) {
        var line = lines[li].trim();
        if (!line) {
            // 空行 = 块结束
            flushBlock();
            continue;
        }
        if (line.startsWith('[image:')) {
            // 新块开始：先收尾上一个块，再开新块
            flushBlock();
            currentBlock = line;
        } else if (currentBlock) {
            // 收集当前 image 块（可能多行，如【提示词】换行）
            currentBlock += '\n' + line;
        } else {
            // image 块前的非空行 = 触发句
            currentTrigger = line;
        }
    }
    // 最后一组
    flushBlock();

    if (!blocks.length) return bodyText;

    // 按触发句插入
    var paragraphs = bodyText.split('\n\n');
    var inserted = 0;
    var lastPos = -1;  // 最后一个成功插入的段落索引（失败块保序用）
    // [AI-Fix] 称呼不对称：LLM 上下文里用户名已被替换为 'User'（callLLM），触发句若含称呼
    // （如"User 推开门"），在原文（"qwe 推开门"）中精确匹配必失配 → 图片追加末尾。
    // 匹配前把段落归一化为同一视角；插入仍用原段落，避免把用户名写进正文。
    var userName = getUserName();
    var userNameRe = null;
    if (userName) {
        try { userNameRe = new RegExp(userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'); } catch (e) { userNameRe = null; }
    }
    function normPara(p) {
        if (!userName) return p;
        return replaceUserInText(p, userName, true);
    }
    // [AI-Fix] 标点容错：LLM 复制触发句偶尔增删标点，剥掉标点/空白后做二次匹配（只影响定位，不改正文）
    function stripPunct(s) {
        return String(s).replace(/[，。！？；：、,.!?;:""''\s]/g, '');
    }
    // [Fix] 段内精插：图片插到触发句之后（原实现插段尾，长段落里图片远离触发句）。
    // normPara 把 userName 替换成 'User'，插入点前的每个 userName 会让原段落索引多出 (userName.length-4)，
    // 按 normPara 坐标反推原段落位置。
    function insertInPara(paraIdx, normIdx, segLen) {
        var orig = paragraphs[paraIdx];
        var norm = normPara(orig);
        var cnt = 0;
        if (userNameRe) {
            var m = norm.slice(0, normIdx + segLen).match(userNameRe);
            cnt = m ? m.length : 0;
        }
        var insertPos = normIdx + segLen + cnt * (userName.length - 4);
        if (insertPos < 0) insertPos = 0;
        if (insertPos > orig.length) insertPos = orig.length;
        paragraphs[paraIdx] = orig.slice(0, insertPos) + '\n\n' + block + orig.slice(insertPos);
        inserted++;
        lastPos = paraIdx;
    }

    for (var bi = 0; bi < blocks.length; bi++) {
        var trigger = blocks[bi].trigger;
        var block = blocks[bi].block;
        var found = false;

        // ① 精确匹配 → 段内精插（触发句后）
        if (trigger.length > 2) {
            for (var pi = 0; pi < paragraphs.length; pi++) {
                var para = normPara(paragraphs[pi]);
                var idx = para.indexOf(trigger);
                if (idx >= 0) {
                    insertInPara(pi, idx, trigger.length);
                    found = true;
                    break;
                }
            }
        }

        // ② 连续片段匹配（LLM 增删标点时仍能精确定位）：取触发句第一个 ≥5 字连续片段
        if (!found && trigger.length > 2) {
            var seg = (trigger.match(/[\u4e00-\u9fffA-Za-z0-9]{5,}/) || [''])[0];
            if (seg && seg.length >= 5) {
                for (var pi3 = 0; pi3 < paragraphs.length; pi3++) {
                    var para3 = normPara(paragraphs[pi3]);
                    var idx3 = para3.indexOf(seg);
                    if (idx3 >= 0) {
                        insertInPara(pi3, idx3, seg.length);
                        found = true;
                        break;
                    }
                }
            }
        }

        // ③ 剥标点二次匹配（无法映射精确位置 → 插段尾）
        if (!found && trigger.length > 2) {
            var trigClean = stripPunct(trigger);
            if (trigClean.length > 2) {
                for (var pi2 = 0; pi2 < paragraphs.length; pi2++) {
                    if (stripPunct(normPara(paragraphs[pi2])).indexOf(trigClean) >= 0) {
                        paragraphs[pi2] = paragraphs[pi2] + '\n\n' + block;
                        found = true;
                        inserted++;
                        lastPos = pi2;
                        break;
                    }
                }
            }
        }

        // ④ 找不到触发句 → 插到上一个成功插入点之后（保序），首块失败才文末
        if (!found) {
            if (lastPos >= 0) {
                paragraphs.splice(lastPos + 1, 0, block);
                lastPos++;
            } else {
                paragraphs.push(block);
            }
            inserted++;
            slLog('IMAGES插入: 第' + (bi + 1) + '块触发句失配, 已保序插入');
        }
    }

    slLog('IMAGES插入: ' + inserted + '/' + blocks.length + ' 块');
    return paragraphs.join('\n\n');
}

// ── 提示词截断 ──
export function truncatePrompt(prompt, maxChars) {
    if (!prompt || prompt.length <= maxChars) return prompt;
    return prompt.slice(0, maxChars);
}

// ── 入口：执行完整管线 ──
export async function runAuxPipeline(bodyText, mesId) {
    var profiles = getProfiles();
    if (!profiles || !profiles.charName) { slLog('管线: profiles 不可用'); return null; }

    // [v2] 正文命中唤醒：正文提到休眠 NPC → 自动恢复完整档案（dataBlock 呈现前执行）
    wakeNpcsByText(bodyText, profiles);

    var meta = profiles.root[profiles.charName].meta || {};
    var staticResult = getCachedProfile(profiles);
    slLog('runAuxPipeline: staticResult=' + (staticResult ? staticResult.length + '字' : '无') + ', 卡类型=' + (meta.cardType || '未知'));
    // [Fix] v2.2 把 v2.0 的跳过语义写反了（世界观卡无档案时反而被跳过 → 永不出图）。
    // 恢复 v2.0 语义：世界观卡/混合型卡无档案时照常跑管线（角色由聊天动态生成 + NPC 建档）；
    // 仅"具体角色卡"且扫描完全失败（连 fallback 主角都没有）时才跳过省一次调用。
    if (!staticResult && meta.cardType !== '世界观卡' && meta.cardType !== '混合型卡') {
        slLog('无角色卡缓存+具体角色卡扫描失败, 跳过管线');
        return null;
    }

    var cast = profiles.root[profiles.charName].cast || {};
    var pipeMode = (meta && meta.modelMode) || settings.modelType || 'zit';

    // 构建提示词
    var systemPrompt = buildSystemPrompt(meta);
    var dataBlock = buildDataBlock(profiles, cast, pipeMode, bodyText);
    slLog('dataBlock 长度: ' + dataBlock.length + '字');

    // 调用LLM
    var output = await callLLM(systemPrompt, dataBlock, bodyText);
    if (!output) { slLog('LLM返回空'); return null; }

    slLog('LLM返回, 长度: ' + output.length + ' 前200字: ' + output.slice(0, 200));
    // [AI-Fix] 调用成功才记录"已发送静态档案"（原实现 buildDataBlock 内提前置位）
    if (profiles.chat) profiles.chat._castSent = (profiles.chat._castSent || 0) + 1;
      slLog('LLM完整输出: ' + output.slice(0, 800));

    // await 后重新获取 profiles
    var profiles = getProfiles();
    if (!profiles || !profiles.charName) { slLog('管线: profiles 不可用'); return null; }
    var cast = profiles.root[profiles.charName].cast || {};

    // ── 解析 PROFILE ──
    var profileMatch = output.match(/---PROFILE---\s*([\s\S]*?)\s*---END---/);
    if (profileMatch) {
        try {
            var fixedJson = fixJsonNewlines(profileMatch[1].trim());
            // 兼容 LLM 在 JSON 后输出额外内容的情况（尾随逗号/字段）
            var profileData = null;
            var parseAttempt = fixedJson;
            while (parseAttempt.length > 10) {
                try { profileData = JSON.parse(parseAttempt); break; } catch (e) {
                    // 尝试截断最后一个 } 之后的内容
                    var lastBrace = parseAttempt.lastIndexOf("}");
                    if (lastBrace < 0 || lastBrace === parseAttempt.length - 1) break;
                    parseAttempt = parseAttempt.substring(0, lastBrace + 1);
                }
            }
            if (!profileData) { slLog("PROFILE JSON全部解析失败"); profileData = {}; }
            var castKeys = Object.keys(cast);

            // 主角动态
            if (profileData.main) {
                var mainName = castKeys[0] || profiles.charName;
                // 兼容 LLM 输出对象格式 static（自动转字符串）
                if (profileData.main.static && typeof profileData.main.static === 'object' && !profileData.main.dynamic) {
                    profileData.main.dynamic = Object.keys(profileData.main.static).map(function(k) { return k + ":" + profileData.main.static[k]; }).join("\n");
                }
                if (profileData.main.dynamic) {
                    var newMainDyn = typeof profileData.main.dynamic === 'string' ? profileData.main.dynamic : JSON.stringify(profileData.main.dynamic);
                    profiles.chat.dynamics[mainName] = mergeDynamicLine(profiles.chat.dynamics[mainName], newMainDyn);
                }

            }
            // 多角色动态
            for (var ci = 1; ci < castKeys.length; ci++) {
                var ck = castKeys[ci];
                if (profileData[ck] && profileData[ck].dynamic) {
                    profiles.chat.dynamics[ck] = mergeDynamicLine(profiles.chat.dynamics[ck], profileData[ck].dynamic);
                }
            }
            // User 动态
            if (profileData.user && profileData.user.dynamic) {
                profiles.chat.dynamics['User'] = mergeDynamicLine(profiles.chat.dynamics['User'], profileData.user.dynamic);
            }

            // NPC 更新
            if (profileData.npcs) {
                if (!profiles.chat.npcs) profiles.chat.npcs = {};
                for (var n in profileData.npcs) {
                    var npcData = profileData.npcs[n];
                    var npcName = String(n).trim();
                    if (npcName === 'main' || npcName === 'user' || npcName.toLowerCase() === 'user') continue;
                    if (cast[npcName]) continue;
                    // [Fix] 名字归一化：与已有 NPC 前2字相同且长度差≤1 → 视为同一人（防 LLM 输出变体导致重复建档）
                    if (!profiles.chat.npcs[npcName]) {
                        for (var en in profiles.chat.npcs) {
                            if (en.length <= 1) continue;
                            var minLen = Math.min(en.length, npcName.length);
                            if (minLen >= 2 && en.slice(0, 2) === npcName.slice(0, 2) && Math.abs(en.length - npcName.length) <= 1) {
                                slLog('NPC名归一化: ' + npcName + ' → ' + en);
                                npcName = en;
                                break;
                            }
                        }
                    }
                    if (!profiles.chat.npcs[npcName]) {
                        profiles.chat.npcs[npcName] = npcData;
                        profiles.chat.npcs[npcName].last_seen_round = profiles.chat._round || 0;
                        // [Fix] anime系模式：NPC 也存英文锚点（生图时避免中文被 cleanAnimePrompt 删空）
                        if (npcData.en_prompt) profiles.chat.npcs[npcName].enPrompt = npcData.en_prompt;
                        if (npcData.en_tags) profiles.chat.npcs[npcName].enTags = npcData.en_tags;
                    } else {
                        var existing = profiles.chat.npcs[npcName];
                        existing.last_seen_round = profiles.chat._round || 0;
                        if (npcData.wake) { existing.sleep = false; existing.wake = true; }
                        existing.appearances = (existing.appearances || 0) + (npcData.appearances || 1);
                        if (npcData.dynamic) existing.dynamic = mergeDynamicLine(existing.dynamic, npcData.dynamic);
                        if (npcData.identity) existing.identity = npcData.identity;
                        // [Fix] static 终身锁定问题：接受重报，取更详细的一版（首次建档信息最少，后续轮次 LLM 掌握更多信息）
                        if (npcData.static && (!existing.static || String(npcData.static).length > String(existing.static).length)) {
                            existing.static = npcData.static;
                        }
                        if (npcData.en_prompt) existing.enPrompt = npcData.en_prompt;
                        if (npcData.en_tags) existing.enTags = npcData.en_tags;
                    }
                }
            }

            if (profileData.present) profiles.chat.present = profileData.present;
            if (profileData.story_log) {
                // [Fix] 整块覆盖会丢失 LLM 未重报的字段（尤其 events）；改为字段级合并，events 有界保留
                profiles.chat.story_log = Object.assign({}, profiles.chat.story_log || {}, profileData.story_log);
                if (!Array.isArray(profiles.chat.story_log.events)) profiles.chat.story_log.events = [];
                if (profiles.chat.story_log.events.length > 20) profiles.chat.story_log.events = profiles.chat.story_log.events.slice(-20);
                // [v2] 剧情库标签：≤5 个短标签，LLM 未输出则保留旧值
                if (!Array.isArray(profiles.chat.story_log.tags)) profiles.chat.story_log.tags = [];
                profiles.chat.story_log.tags = profiles.chat.story_log.tags.slice(0, 5).map(function (t) { return String(t).slice(0, 12); });
                slLog('story_log 已更新, events:' + profiles.chat.story_log.events.length + ', tags:' + profiles.chat.story_log.tags.length);
            }
            gcNpcs(profiles);
            saveSettings();
            slLog('PROFILE已更新, dynamics:' + Object.keys(profiles.chat.dynamics).length +
                ', present:' + (profileData.present || []).length + ', NPC:' + Object.keys(profiles.chat.npcs || {}).length);
        } catch (e) {
            slLog('PROFILE JSON解析失败: ' + e.message + ' json前100字: ' + profileMatch[1].trim().slice(0, 100));
        }
    }

    // ── 解析 IMAGES ──
    var imagesMatch = output.match(/---IMAGES---\s*([\s\S]*?)\s*---END---/);
    var imagesSection = imagesMatch ? imagesMatch[1].trim() : '';

    if (!imagesSection || !/\[image:/.test(imagesSection)) {
        var noImgMode = settings.imageMode || 'always';
        recordImgRate(false);
        // 无论是否有图，PROFILE 已更新 → 正文存档（round 去重防重试重复）
        if (settings.storyLib !== false) {
            var _sl0 = profiles.chat.story_log || {};
            story.appendEntry({
                mesid: mesId || '',
                round: (profiles.chat._round || 0) + 1,
                scene: _sl0.scene || '',
                tags: Array.isArray(_sl0.tags) ? _sl0.tags : [],
                body: bodyText
            });
            story.maybeSummarize();
        }
        if (noImgMode === 'always') {
            // [Fix] 总是配图是强制的：无图 = 未满足要求，判失败交给 scanner 重试（重试仍无图才放弃）
            slLog('⚠️ 无img块但策略=总是配图(强制), 判失败等待重试');
            return null;
        }
        // 鼓励/关键场景模式：无图轮是合法结果（PROFILE 已更新），不再判失败、不重试
        slLog('无img块: PROFILE已更新, 按无图轮正常完成(' + noImgMode + '模式)');
        return { ok: true, enhanced: null };
    }

    // 将 IMAGES 块插入正文
    var enhanced = insertImagesIntoBody(bodyText, imagesSection);

    // [Fix] 诊断：IMAGES 提示词含角色名 → 告警（LLM 未按规则写外貌；帮助排查档案缺失/违规）
    try {
        var _pf2 = getProfiles();
        var _names = [];
        if (_pf2) {
            if (_pf2.charName) _names.push(_pf2.charName);
            var _cast2 = _pf2.root && _pf2.root[_pf2.charName] ? _pf2.root[_pf2.charName].cast : {};
            for (var _ck2 in _cast2) _names.push(_ck2);
            var _npcs2 = _pf2.chat ? _pf2.chat.npcs : {};
            for (var _n2 in _npcs2) _names.push(_n2);
        }
        for (var _i2 = 0; _i2 < _names.length; _i2++) {
            var _nm2 = _names[_i2];
            if (_nm2 && _nm2.length >= 2 && imagesSection.indexOf(_nm2) >= 0) {
                slErr('⚠️ IMAGES提示词含角色名「' + _nm2 + '」——LLM 用名字代替外貌，请检查该角色档案/正文数据是否缺失');
                break;
            }
        }
    } catch (e) {}

    // JS侧做提示词截断（替换所有【提示词】中的超长内容）
    enhanced = enhanced.replace(/【提示词】([\s\S]*?)【\/提示词】/g, function(m, prompt) {
        return '【提示词】' + truncatePrompt(prompt, 300) + '【/提示词】';
    });

    var imgCount = (enhanced.match(/\[image:/g) || []).length;
    slLog('管线完成, 增强文本长度: ' + enhanced.length + ', img块数: ' + imgCount);
    recordImgRate(true);

    // [v2] 剧情库：本轮正文 + 标签 + 场景 存档；满足阈值时异步触发滚动总结（fire-and-forget，不阻塞主流程）
    if (settings.storyLib !== false) {
        var _sl = profiles.chat.story_log || {};
        story.appendEntry({
            mesid: mesId || '',
            round: (profiles.chat._round || 0) + 1,
            scene: _sl.scene || '',
            tags: Array.isArray(_sl.tags) ? _sl.tags : [],
            body: bodyText
        });
        story.maybeSummarize();
    }

    // 不再替换为[FACE:User]，AI直接从档案数据写外貌描述

    return { ok: true, enhanced: enhanced };
}

// ── 出图率统计（鼓励模式护栏：最近10轮出图过少时临时加强措辞） ──
function recordImgRate(hasImg) {
    try {
        if (!Array.isArray(settings.imgRate)) settings.imgRate = [];
        settings.imgRate.push({ t: Date.now(), img: hasImg ? 1 : 0 });
        if (settings.imgRate.length > 20) settings.imgRate = settings.imgRate.slice(-20);
    } catch (e) {}
}
function getRecentImgRate() {
    try {
        var log = settings.imgRate;
        if (!Array.isArray(log) || log.length < 5) return null;
        var recent = log.slice(-10);
        var imgs = 0;
        for (var i = 0; i < recent.length; i++) if (recent[i].img) imgs++;
        return imgs / recent.length;
    } catch (e) { return null; }
}