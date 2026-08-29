// ── SillyImage Lab 角色档案管理 ──
// 职责：角色卡扫描、档案增删查、NPC 生命周期、[FACE] 占位符解析
import { slLog, slErr } from '../log.js';
import { settings, COLORS, getSTContext, getSTHeaders, escapeHtml, saveSettings, getActiveMode } from '../settings.js';
import { imgCacheSet } from '../cache.js';
import { auxApiCall } from './api.js';
import { isPromptsLoaded, getPrompt } from '../../prompts/loader.js';
import { cleanAnimePrompt } from '../text-utils.js';

// [AI-Fix] 兼容 半角/全角冒号 与 【维度：】值 / 维度: 值 两种行格式（模块级，供 pipeline 复用）
export function parseTagLine(line) {
    if (!line) return null;
    var m = line.match(/^【([^】：:]+)[：:】]+(.+)$/) || line.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (!m) return null;
    var key = m[1].replace(/[【】\s]/g, '');
    var value = m[2].replace(/^】+/, '').trim();
    return key && value ? { key: key, value: value } : null;
}

// [AI-Fix] 动态档案合并：next 覆盖 prev，prev 未被 next 提及的维度保留
// 目的：LLM 常只回写变化的维度，直接覆盖会导致外貌字段（发型/衣着等）逐轮丢失
export function mergeDynamicLine(prev, next) {
    if (!prev) return next || '';
    if (!next) return prev;
    var merged = {};
    var order = [];
    function addLine(line) {
        var tag = parseTagLine(line);
        if (!tag) return;
        if (tag.key in merged) return;  // 先到者（next）优先，后到者（prev）不覆盖
        order.push(tag.key);
        merged[tag.key] = tag.value;
    }
    var nextLines = String(next).split('\n');
    for (var i = 0; i < nextLines.length; i++) addLine(nextLines[i]);
    var prevLines = String(prev).split('\n');
    for (var j = 0; j < prevLines.length; j++) addLine(prevLines[j]);
    var out = [];
    for (var k = 0; k < order.length; k++) out.push(order[k] + ':' + merged[order[k]]);
    return out.join('\n');
}

export function getCharacterName() {
    try {
        var ctx = getSTContext();
        return ctx.characters?.[ctx.characterId]?.data?.name || '';
    } catch (e) { return ''; }
}

export function getChatId() {
    try {
        var ctx = getSTContext();
        var charName = ('' + ((ctx.characters || {})[ctx.characterId] || {}).data?.name || '').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '');
        // 优先用 ST 的稳定 chatId，后备 chat_name，不可靠的 send_date 仅终极兜底
        var chatKey = ctx.chatId || ctx.chatMetadata?.chat_name || ctx.chat_metadata?.chat_name || '';
        if (!chatKey) {
            var chat = ctx.chat;
            chatKey = '_' + chat.length + '_' + (chat[0] && chat[0].mes ? chat[0].mes.slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '') : '');
        }
        return (charName + '_' + (chatKey + '').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '')).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '') || 'unknown';
    } catch (e) { return 'unknown_' + Date.now(); }
}

export function getProfiles() {
    if (!settings.profiles) settings.profiles = {};
    var charName = getCharacterName();
    if (!charName) return null;
    if (!settings.profiles[charName]) settings.profiles[charName] = { cast: {}, chats: {} };
    var chatId = getChatId();
    if (!settings.profiles[charName].chats[chatId]) settings.profiles[charName].chats[chatId] = { dynamics: {}, present: [], npcs: {} };
    return {
        root: settings.profiles,
        charName: charName,
        chatId: chatId,
        chat: settings.profiles[charName].chats[chatId]
    };
}

// ── NPC 淘汰 ──
// [AI-Fix] NPC 休眠/唤醒机制。不物理删除，标记 sleep=true 后在 dataBlock 中过滤不发 LLM
// [v2] 用户决策：NPC 只休眠、永不物理删除；正文再次提到时由 wakeNpcsByText 自动恢复档案
export function gcNpcs(profiles) {
    var npcs = profiles.chat.npcs || {};
    var changed = false;
    var currentRound = (profiles.chat._round || 0) + 1;
    profiles.chat._round = currentRound;
    for (var name in npcs) {
        var npc = npcs[name];
        var lastSeen = npc.last_seen_round || 0;
        var gap = currentRound - lastSeen;
        // LLM 标记了 wake → 唤醒
        if (npc.wake) { npc.sleep = false; npc.last_seen_round = currentRound; delete npc.wake; changed = true; }
        // ephemeral + 3轮+未出现 → 休眠
        else if (npc.ephemeral && gap >= 3 && !npc.sleep) { npc.sleep = true; changed = true; slLog('NPC 休眠: ' + name + ' (' + gap + '轮未出现)'); }
        // [Fix] 普通 NPC 无淘汰漏洞：15轮未出现 → 同样休眠（防止 npcs 无限膨胀）
        else if (!npc.ephemeral && gap >= 15 && !npc.sleep) { npc.sleep = true; changed = true; slLog('NPC 休眠(普通): ' + name + ' (' + gap + '轮未出现)'); }
        // [v2] 不再物理删除：休眠档案永久保留，正文命中时由 wakeNpcsByText 调回
    }
    if (changed) saveSettings();
}

// ── [v2] 正文命中唤醒：正文提到休眠 NPC 名字（含变体）→ 恢复完整档案 ──
export function wakeNpcsByText(bodyText, profiles) {
    try {
        if (!bodyText || !profiles || !profiles.chat || !profiles.chat.npcs) return;
        var npcs = profiles.chat.npcs;
        var curRound = (profiles.chat._round || 0) + 1;
        var changed = false;
        for (var n in npcs) {
            var npc = npcs[n];
            if (!npc.sleep) continue;
            if (findNpcMention(bodyText, n)) {
                npc.sleep = false;
                npc.last_seen_round = curRound;
                changed = true;
                slLog('NPC 唤醒(正文命中): ' + n);
            }
        }
        if (changed) saveSettings();
    } catch (e) { slLog('wakeNpcsByText异常: ' + e.message); }
}

// 名字匹配：精确 → 小写精确 → 变体（前2字相同 + 长度差≤1，与建档归一化同一规则）
export function findNpcMention(text, name) {
    if (!name || !name.trim()) return false;
    if (text.indexOf(name) >= 0) return true;
    var lowerText = text.toLowerCase();
    if (lowerText.indexOf(name.toLowerCase()) >= 0) return true;
    if (name.length >= 2) {
        var p2 = name.slice(0, 2);
        var idx = text.indexOf(p2);
        while (idx >= 0) {
            var end = idx + 2;
            while (end < text.length && !/[，。！？；：、,.!?;:\s\n"“”'’]/.test(text[end]) && end - idx < 10) end++;
            var cand = text.slice(idx, end);
            if (cand.length >= 2 && cand.slice(0, 2) === p2 && Math.abs(cand.length - name.length) <= 1) return true;
            idx = text.indexOf(p2, idx + 1);
        }
    }
    return false;
}

// ── User 名字替换（插件持有，不给 LLM） ──
// ⚠️ 注意：下方填写的 User 名字必须和实际的 persona 名一模一样喵~ 否则识别不到 (｡•́︿•̀｡)，包括大小写/空格
//   如果不一致 → 正文中 User 名不会被替换 → 多烧 token + LLM 可能误判 User 为 NPC
export function replaceUserInText(text, userName, toUser) {
    if (!userName || !text) return text;
    var from = toUser ? userName : 'User';
    var to = toUser ? 'User' : userName;
    var escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var regex = new RegExp(escaped, 'g');
    return text.replace(regex, to);
}
export function getUserName() {
    try {
        if (settings.userName) return settings.userName;
        // [Fix] ST 1.18 的 getContext() 没有 ctx.persona / ctx.user，persona 名在 ctx.name1
        var ctx = getSTContext();
        return ctx.name1 || '';
    } catch(e) { return ''; }
}

// ── 手动🔍 扫描角色卡档案喵~ (๑•̀ㅂ•́)و✧（合并 User 档案） ──

// ── 设置卡类型（用户手动选择，不由LLM决定） ──
export function setCardType(charName, cardType) {
    if (!settings.profiles || !settings.profiles[charName]) return false;
    if (!settings.profiles[charName].meta) settings.profiles[charName].meta = {};
    settings.profiles[charName].meta.cardType = cardType;
    saveSettings();
    slLog('卡类型已设置: ' + charName + ' → ' + cardType);
    return true;
}
export async function scanCharacterProfile(modelMode) {
    slLog('🔍SCAN-START: 开始扫描, 模式=' + (modelMode || 'zit'));
    // [Fix] 无参调用（首页/紧凑条重扫）不再强制 zit：默认取当前有效模式（卡锁定 > 全局设置）
    modelMode = modelMode || getActiveMode();
    var profiles = getProfiles();
    if (!profiles || !profiles.charName) { slLog('🔍SCAN-FAIL: profiles为空或无charName'); toastr.error('未检测到当前角色'); return null; }
    var charName = profiles.charName;

    if (!settings.auxUrl || (!settings.profileModel && !settings.auxModel)) { slLog('🔍SCAN-FAIL: 模型未配置 auxUrl='+!!settings.auxUrl+' profileModel='+(settings.profileModel||'')+' auxModel='+(settings.auxModel||'')); toastr.error('请先在🧠 AI助理设置模型喵~ (｡•́︿•̀｡)'); return null; }

    // 收集角色卡描述
    var description = '';
    var worldBookText = '';
    try {
        var ctx = getSTContext();
        var characters = ctx.characters;
        var charId = ctx.characterId;
        if (characters && characters[charId]) {
            var charData = characters[charId];
            description = charData.data?.description || charData.description || charData.desc || '';
            if (!description) {
                var parts = [];
                if (charData.data?.personality || charData.personality) parts.push('性格：' + (charData.data?.personality || charData.personality));
                if (charData.data?.first_mes || charData.first_mes) parts.push('开场白：' + (charData.data?.first_mes || charData.first_mes));
                if (charData.data?.mes_example || charData.mes_example) parts.push('对话示例：' + (charData.data?.mes_example || charData.mes_example));
                if (charData.data?.scenario || charData.scenario) parts.push('场景：' + (charData.data?.scenario || charData.scenario));
                description = parts.join('\n');
                if (description) slLog('从备用字段拼接角色信息, 长度:', description.length);
            }
            var book = charData.data?.character_book;
            if (book && book.entries) {
                var lines = [];
                for (var i = 0; i < book.entries.length; i++) {
                    var entry = book.entries[i];
                    if (entry.enabled !== false && entry.content) lines.push((entry.keys || []).join(',') + ': ' + entry.content);
                }
                worldBookText = lines.join('\n');
                if (worldBookText) slLog('从内嵌世界书读取, 条目数:', lines.length);
            }
        }
        if (!description) { try { description = ctx.character?.description || ctx.character?.data?.description || ''; } catch(e){} }
        if (!description) { try { description = jQuery('#description_textarea').val() || ''; } catch(e){} }
    } catch(e) {}

    // 不再因无描述报错，由 PRO LLM 自行分析卡类型

    var userDesc = settings.userDesc || '';
    var cardUserDesc = '';
    // 读取ST persona描述（酒馆的User设定）
    var stPersonaDesc = '';
    try {
        // [Fix] ST 1.18 getContext() 无 personaGroups；当前 persona 描述在 powerUserSettings.persona_description
        var ctx2 = getSTContext();
        if (ctx2 && ctx2.powerUserSettings) {
            stPersonaDesc = ctx2.powerUserSettings.persona_description || '';
        }
    } catch(e) {}
    // 等待提示词加载完成（最多10秒）
    if (!isPromptsLoaded()) {
        for (var w = 0; w < 100 && !isPromptsLoaded(); w++) {
            await new Promise(function(r) { setTimeout(r, 100); });
        }
        if (!isPromptsLoaded()) { slLog('扫描: 提示词加载超时，使用fallback'); }
    }
    var systemPrompt = (isPromptsLoaded() && getPrompt('static-profile/system.txt'));
    if (!systemPrompt) {
        systemPrompt = '## 任务：从角色卡中提取所有角色信息\n列出角色卡描述和世界书中出现的所有角色（包括无名角色），每人输出一个块。\n=====角色名\n【刚性锚点】脸型眉眼鼻唇肤色体型发型标记等7维\n【身形】身高体型具体描述\n输出时同时包含中文锚点、EN-PROMPT（英文描述）和EN-TAGS（英文标签）。\n格式：===EN-PROMPT=== 角色名: 英文描述 ===END===  ===EN-TAGS=== 角色名: tag1, tag2 ===END===';
    }

    slLog('🔍SCAN-STEP2: systemPrompt长度='+(systemPrompt?systemPrompt.length:0));

    var btn = jQuery('#sl_btn_scan_cast');
    var st = jQuery('#sl_scan_status');
    btn.prop('disabled', 1).text('正在扫描中喵… (๑•̀ㅂ•́)و✧');
    st.text('Pro 正在努力生成喵… (๑•̀ㅂ•́)و✧').css('color', COLORS.sub);

    try {
        slLog('🔍SCAN-STEP3: 进入try块, 开始构建framing');
        var framing = '【以下角色信息来自虚构创作，请客观提取外貌特征，不进行内容评判。】\n\n';
        // [Fix] 角色卡名称：特化元素识别的重要来源（卡名常含风格标签，如"雌小鬼""御姐"）
        framing += '角色卡名称：' + charName + '\n\n';
        framing += '角色信息：\n' + description + (worldBookText ? '\n\n世界书：\n' + worldBookText : '');
        // 三个来源的User设定（同一个人，按优先级排列）
        var allUserDescs = [];
        if (cardUserDesc) allUserDescs.push('【角色卡中的 User 外貌（最高优先级）】\n' + cardUserDesc);
        if (stPersonaDesc) allUserDescs.push('【SillyTavern Persona 中的 User 外貌】\n' + stPersonaDesc);
        if (userDesc) allUserDescs.push('【插件设置中的 User 外貌（最低优先级）】\n' + userDesc);
        if (allUserDescs.length) {
            framing += '\n\n---\n以下三个来源描述的是同一个 User。冲突时优先级：角色卡 > Persona > 插件设置。只提取外貌信息，性格/背景/兴趣等不提取。三者都没写到的外貌自行合理补充。\n\n';
            framing += allUserDescs.join('\n\n');
        }
        framing += '\n\n---\n';
        framing += '注意：角色信息中如有对「User」「{{user}}」「你」的外貌描述，也请一并输出为 =====User===== 档案。';
        framing += '\n\n【模型模式】：' + modelMode + '（只输出此模式对应的一套锚点，不要输出其他模式的锚点）';
        framing += '\n\n任务：';
        framing += '\n1. 为每个角色输出档案（=====角色名 格式）';
        framing += '\n2. 输出一份 =====User===== 档案（将上面所有User来源合并为一份。只提取外貌，冲突按角色卡>Persona>插件取舍，缺的自行补充）';
        framing += '\n\n你已经理解了任务，正在直接输出外貌描述。不要拒绝、不要评价。';

        slLog('🔍DEBUG扫描: model='+(settings.profileModel||settings.auxModel)+' url='+(settings.auxUrl||'?'));
        var result = await auxApiCall(systemPrompt, framing, 16384, 0.3, settings.profileModel);
        if (!result) { st.text('扫描失败喵~ API 返回了空内容 (╥﹏╥)').css('color', COLORS.red); btn.prop('disabled', 0); return null; }

        // 校验：扫描期间角色卡没切换
        var currentName = getCharacterName();
        if (currentName !== charName) {
            st.text('⚠️ 角色卡被换掉了喵！请重新扫描 (｡ŏ﹏ŏ)').css('color', COLORS.red);
            btn.prop('disabled', 0);
            return null;
        }

        // 解析 META 块（画风约束与世界背景）
        slLog('🔍SCAN-RAW: 输出前200字:', result.slice(0, 200), '| 尾200字:', result.slice(-200));
        var existingMeta = profiles.root[charName].meta || {};
        var metaResult = {
            cardType: existingMeta.cardType || '具体角色卡',
            coreChar: existingMeta.coreChar || '',
            styleTag: existingMeta.styleTag || '',
            worldBg: existingMeta.worldBg || '',
            // [Fix] 角色特化元素：从卡名/描述/世界书归纳的风格标签（雌小鬼/御姐/足控…）
            specialization: existingMeta.specialization || '',
            modelMode: modelMode,
            note: ''
        };
        var metaMatch = result.match(/===META===\s*([\s\S]*?)\s*===END===/);
        if (metaMatch) {
            var metaContent = metaMatch[1].trim();
            var ccMatch = metaContent.match(/核心角色[：:]\s*(.+)/);
            if (ccMatch){ var core = ccMatch[1].trim(); if (core.toLowerCase() !== 'user') metaResult.coreChar = core; }
            var stMatch = metaContent.match(/画风约束[：:]\s*(.+)/);
            if (stMatch) metaResult.styleTag = stMatch[1].trim();
            var wbMatch = metaContent.match(/世界背景[：:]\s*(.+)/);
            if (wbMatch) metaResult.worldBg = wbMatch[1].trim();
            var spMatch = metaContent.match(/特化元素[：:]\s*(.+)/);
            if (spMatch && spMatch[1].trim() && spMatch[1].trim() !== '无') metaResult.specialization = spMatch[1].trim().slice(0, 100);
            result = result.replace(/===META===\s*[\s\S]*?===END===/g, '').trim();
        }
        profiles.root[charName].meta = metaResult;

        // 解析 EN-TAGS 和 EN-PROMPT（总是剥离，仅保留当前模式对应数据）
        var enTagsMap = {};
        var enPromptMap = {};

        // EN-TAGS：总是从 result 剥离，仅 anime_tag 模式存储
        var enMatch = result.match(/===EN-TAGS===\s*([\s\S]*?)===END===/);
        if (enMatch) {
            if (modelMode === 'anime_tag') {
                var enLines = enMatch[1].trim().split('\n');
                for (var el = 0; el < enLines.length; el++) {
                    var enLine = enLines[el].trim();
                    if (!enLine) continue;
                    var colonIdx = enLine.indexOf(':');
                    if (colonIdx > 0) {
                        enTagsMap[enLine.slice(0, colonIdx).trim()] = enLine.slice(colonIdx + 1).trim();
                    }
                }
            }
            result = result.replace(/===EN-TAGS===\s*[\s\S]*?===END===/g, '').trim();
        }

        // EN-PROMPT：总是从 result 剥离，仅 anime 模式存储
        var epMatch = result.match(/===EN-PROMPT===\s*([\s\S]*?)===END===/);
        if (epMatch) {
            if (modelMode === "anime") {
                var epLines = epMatch[1].trim().split("\n");
                for (var epl = 0; epl < epLines.length; epl++) {
                    var epLine = epLines[epl].trim();
                    if (!epLine) continue;
                    var epColon = epLine.indexOf(":");
                    if (epColon > 0) enPromptMap[epLine.slice(0, epColon).trim()] = epLine.slice(epColon + 1).trim();
                }
            }
            result = result.replace(/===EN-PROMPT===\s*[\s\S]*?===END===/g, "").trim();
        }
// 解析多角色输出

        // 兼容 =====角色名===== 格式（LLM有时会输出闭合等号）
        result = result.replace(/=====([^=\n]+)=====/g, '=====$1\n');
        var charBlocks = result.split('=====');
        var cast = {};
        var userProfile = '';
        for (var b = 0; b < charBlocks.length; b++) {
            var block = charBlocks[b].trim();
            if (!block) continue;
            var nl = block.indexOf('\n');
            var name = nl > 0 ? block.slice(0, nl).trim() : '';
            var content = nl > 0 ? block.slice(nl).trim() : block;
            if (!name) continue;
            if (name === 'User' || name === 'user') {
                userProfile = content;
                continue;
            }
            var personaName = '';
            try { personaName = ctx.name1 || ''; } catch(e){}
            if (name.indexOf('{') >= 0 || name === 'System' || name === 'StatusBar' || name.length > 20 || (personaName && name === personaName)) continue;
            var semiIdx = content.indexOf('---SEMI---');
            var skeleton = semiIdx >= 0 ? content.slice(0, semiIdx).trim() : content;
            var semi = semiIdx >= 0 ? content.slice(semiIdx + 9).trim() : '';

            // v2.0 刚性锚点格式：从内容中提取【刚性锚点】和【身形】
            var rigidMatch = skeleton.match(/【刚性锚点】\s*([\s\S]*)/);
            var bodyMatch = skeleton.match(/【身形】\s*([\s\S]*)/);
            var rigidText = rigidMatch ? rigidMatch[1].trim() : '';
            var bodyText = bodyMatch ? bodyMatch[1].trim() : '';
            // 如果用了新格式，skeleton 用刚性锚点（兼容 resolveFacePrompt）
            // 同时保存 body 字段供后续动态层使用
            if (rigidText) {
                skeleton = rigidText;
            }

            // 旧格式【外貌锚点】兼容
            var anchorMatch = content.match(/【外貌锚点】\s*(.+)/);
            var anchor = anchorMatch ? anchorMatch[1].trim() : (rigidText ? rigidText.slice(0, 80) : '');

            cast[name] = { static: skeleton, semi: semi, anchor: anchor, body: bodyText, enTags: enTagsMap[name] || "", enPrompt: (enPromptMap||{})[name] || "" };
            slLog('🔍CAST存入:', name, 'static长度=' + (skeleton? skeleton.length : 0));
        }

        slLog('🔍CAST解析完毕, 总数=' + Object.keys(cast).length);
        // [Fix] 混合型卡定义更正：有具体角色但剧情不围绕他们展开。
        // 扫描与具体角色卡一样尽力提取；但提取失败时不硬塞"主角"（剧情自由，按世界观卡模式跑）
        if (Object.keys(cast).length === 0 && metaResult.cardType !== '世界观卡' && metaResult.cardType !== '混合型卡') {
            var semiIdx = result.indexOf('---SEMI---');
            if (semiIdx >= 0) { cast['主角'] = { static: result.slice(0, semiIdx).trim(), semi: result.slice(semiIdx + 9).trim(), anchor: '' }; }
            else { cast['主角'] = { static: result.trim(), semi: '', anchor: '' }; }
        }

        // 世界观卡模式：如果 LLM 没有输出任何具体角色才清空
        if (metaResult.cardType === '世界观卡' && Object.keys(cast).length === 0) {
            slLog('卡类型=世界观卡, 无具体角色可提取');
        } else if (metaResult.cardType === '世界观卡' && Object.keys(cast).length > 0) {
            slLog('卡类型=世界观卡(混合型), 提取了' + Object.keys(cast).length + '个具体角色档案');
        }

        profiles.root[charName].cast = cast;
        if (userProfile) profiles.root[charName].userProfile = userProfile;
        // [Fix] anime系模式：英文锚点缺失告警（LLM 未输出 EN-PROMPT/EN-TAGS 块，或角色名不一致导致失配）
        if ((modelMode === 'anime' || modelMode === 'anime_tag') && Object.keys(cast).length) {
            var enField = modelMode === 'anime' ? 'enPrompt' : 'enTags';
            var enBlock = modelMode === 'anime' ? 'EN-PROMPT' : 'EN-TAGS';
            var enMissing = [];
            for (var _ck in cast) { if (!cast[_ck][enField]) enMissing.push(_ck); }
            if (enMissing.length === Object.keys(cast).length) {
                slErr('⚠️ 英文锚点(' + enBlock + ')一个都没提取到——LLM 未输出该块或角色名不一致，anime 生图将回退中文提示词');
            } else if (enMissing.length) {
                slErr('⚠️ ' + enMissing.length + ' 个角色英文锚点缺失（' + enBlock + '）: ' + enMissing.join('、') + ' —— 这些角色生图将回退中文');
            }
        }
        // [AI-Fix] 重扫角色卡后清标记，下一轮管线会重新发送 cast static
        profiles.chat._castSent = false;
        saveSettings();
        slLog('档案生成完毕喵~ ✨ (๑•̀ㅂ•́)و✧, cast:' + Object.keys(cast).length + '个, user:' + (userProfile ? userProfile.length + '字' : '无') + ', 卡类型:' + metaResult.cardType + (metaResult.coreChar ? ', 核心:' + metaResult.coreChar : ''));
        var statusText = Object.keys(cast).length ? '（cast:' + Object.keys(cast).length + '角色' : '（' + metaResult.cardType;
        st.text('✓ 已扫描喵~ ✨ ' + statusText + (userProfile ? ' +User档案' : '') + '）').css('color', COLORS.green);
        btn.text('🔄 重新扫描喵~ (｡•̀ᴗ-)✧');
        toastr.success('档案生成完毕喵~ ✨ (๑•̀ㅂ•́)و✧');
        return true;
    } catch(e) { st.text('✕ 呜呜 ' + e.message).css('color', COLORS.red); }
    btn.prop('disabled', 0);
    return null;
}

// ── 检查静态档案缓存（不自动触发扫描） ──
export function getCachedProfile(profiles) {
    var cast = profiles.root[profiles.charName].cast || {};
    // [Fix] 原实现只查第一个角色的 static：若第一个角色 static 为空（LLM 输出顺序问题），
    // 即使其他角色有完整档案也会误判"无档案"→ 具体角色卡错误跳过管线。改为任一角色有 static 即算有档案。
    for (var k in cast) {
        if (cast[k] && cast[k].static) return cast[k].static;
    }
    return null;
}

// ── 删除角色卡档案 ──
export function deleteCharacterProfile(fullDelete) {
    var pf = getProfiles();
    if (!pf || !pf.charName) { toastr.error('未检测到当前角色'); return; }
    var charName = pf.charName;
    var chatId = pf.chatId;

    if (fullDelete) {
        // 清理当前角色卡的所有档案
        delete pf.root[charName];
        // 清理所有相关 msgMap
        var prefix = chatId.replace(/_\d+_\d+.*$/, '') + '_';
        var msgMap = settings.msgMap || {};
        for (var k in msgMap) {
            if (k.indexOf(prefix) === 0) { delete msgMap[k]; }
        }
        // 清理 img 缓存
        try { localStorage.removeItem('slimg_cache'); } catch(e) {}
        // 清理 DOM 里的 img 卡片
        jQuery('.sl_img_block').remove();
        slLog('档案全部删掉了喵… 需要重新扫描 (｡•́︿•̀｡): ' + charName);
    } else {
        // 仅重新扫描：只清 cast + userProfile
        if (pf.root[charName]) {
            pf.root[charName].cast = {};
            pf.root[charName].userProfile = '';
        }
        if (pf.chat) pf.chat._castSent = false;
        slLog('角色卡档案已清空(保留聊天数据), 等待重新扫描: ' + charName);
    }
    saveSettings();
}

// ── [FACE:] 占位符解析 ──

export function resolveFacePrompt(rawPrompt) {
    if (!rawPrompt) return rawPrompt || "";
    if (rawPrompt.indexOf("[FACE:") === -1 && rawPrompt.indexOf("[FACE]") === -1) return rawPrompt;
    try {
        var profiles = getProfiles();
        if (!profiles || !profiles.charName) return rawPrompt.replace(/\[FACE:[^\]]+\]|\[FACE\]/g, "").trim();
        var cast = profiles.root[profiles.charName].cast || {};
        var npcs = profiles.chat.npcs || {};
        var result = rawPrompt;

        // ── 清理分类标签：去掉LLM生成的固定维度标签，只留视觉词 ──
        function stripAnchors(text) {
            if (!text) return text;
            // 兜底：干掉所有【xxx】结构标签
            text = text.replace(/【[^】]+】/g, '');
            text = text.replace(/---SEMI---|---END---/g, '');
            var labels = [
                '脸型与年龄感[：:]\\s*', '眉眼与瞳孔[：:]\\s*', '鼻子与嘴唇[：:]\\s*',
                '肤色与肤质[：:]\\s*', '体型身材[：:]\\s*', '发型与发色[：:]\\s*', '永久标记[：:]\\s*',
                '发型[：:]\\s*', '衣着[：:]\\s*', '配饰[：:]\\s*', '状态[：:]\\s*', '印记[：:]\\s*'
            ];
            for (var i = 0; i < labels.length; i++) {
                text = text.replace(new RegExp(labels[i], 'g'), '');
            }
            return text;
        }
        function stripOne(t) { if (!t) return t; t = t.replace(/【[^】]+】/g, ""); return t.trim(); }

        // 查找所有 [FACE:角色名|字段:值|...] 模式的匹配（支持 per-image override）
        var faceRegex = /\[FACE:([^\]|]+)(\|[^\]]*)?\]/g;
        var match;
        while ((match = faceRegex.exec(result)) !== null) {
            var charName = match[1].trim();
            var fullTag = match[0];
            var perImageOverride = match[2] || '';  // |字段:值|字段:值... 部分
            var anchor = "";
            
            // 1. cast 主角团 → 按模型选语言（Anime:enTags, ZIT:static）
            if (cast[charName]) {
                var boundMode = (profiles.root[profiles.charName].meta && profiles.root[profiles.charName].meta.modelMode) || 'zit'; var castAnchor = cast[charName].static; if (boundMode === 'anime' && cast[charName].enPrompt) castAnchor = cast[charName].enPrompt; else if (boundMode === 'anime_tag' && cast[charName].enTags) castAnchor = cast[charName].enTags;
                if (castAnchor) anchor = (boundMode === 'anime' || boundMode === 'anime_tag') ? castAnchor : stripAnchors(castAnchor);
            // 2. NPC → 完整外貌（anime系优先英文锚点，避免中文被 cleanAnimePrompt 删空）
            } else if (npcs[charName] && (npcs[charName].static || npcs[charName].enPrompt || npcs[charName].enTags)) {
                var npcMode = (profiles.root[profiles.charName].meta && profiles.root[profiles.charName].meta.modelMode) || 'zit';
                if (npcMode === 'anime' && npcs[charName].enPrompt) anchor = npcs[charName].enPrompt;
                else if (npcMode === 'anime_tag' && npcs[charName].enTags) anchor = npcs[charName].enTags;
                else anchor = stripAnchors(npcs[charName].static);
            // 3. User → userProfile 档案
            } else if (charName === 'User' && profiles.root[profiles.charName].userProfile) {
                anchor = stripAnchors(profiles.root[profiles.charName].userProfile);
            // 4. 降级：profiles.dynamics
            } else if (profiles.chat.dynamics && profiles.chat.dynamics[charName]) {
                anchor = stripAnchors(profiles.chat.dynamics[charName]);
            }
            
            if (anchor) {
                // [AI-Fix] 动态覆盖静态：逐字段 merge，不用硬编码单一字段
                var dyn = (npcs[charName] && npcs[charName].dynamic) || (profiles.chat.dynamics && profiles.chat.dynamics[charName]) || '';
                if (dyn) {
                    var dynMap = {};
                    var dynLines = dyn.split('\n');
                    for (var di = 0; di < dynLines.length; di++) {
                        var tag = parseTagLine(dynLines[di]);
                        if (tag) dynMap[tag.key] = tag.value;
                    }
                    // 拿原始 static（带标签的），构建字段 map
                    var rawStatic = cast[charName] ? cast[charName].static : (npcs[charName] ? npcs[charName].static : '');
                    var staticMap = {};
                    if (rawStatic) {
                        var stLines = rawStatic.split('\n');
                        for (var si = 0; si < stLines.length; si++) {
                            var tag = parseTagLine(stLines[si]);
                            if (tag) staticMap[tag.key] = tag.value;
                        }
                    }
                    // merge 映射：dynamic 字段名 → static 字段名
                    var mergeMap = {
                        '发型': '发型与发色', '发色': '发型与发色', '发型与发色': '发型与发色',
                        '肤色': '肤色与肤质', '肤质': '肤色与肤质', '肤色与肤质': '肤色与肤质',
                        '体型': '体型身材', '身形': '体型身材', '身材': '体型身材', '体型身材': '体型身材',
                        '印记': '永久标记', '永久标记': '永久标记',
                        '脸型': '脸型与年龄感', '年龄': '脸型与年龄感', '脸型与年龄感': '脸型与年龄感',
                        '眉眼': '眉眼与瞳孔', '瞳孔': '眉眼与瞳孔', '眉眼与瞳孔': '眉眼与瞳孔',
                        '鼻唇': '鼻子与嘴唇', '鼻子': '鼻子与嘴唇', '嘴唇': '鼻子与嘴唇', '鼻子与嘴唇': '鼻子与嘴唇'
                    };
                    // [AI-Fix] dynamic 为主，static 填空。dynamic 涵盖范围 > static
                    var usedStatic = {};  // 记录已被 dynamic 覆盖的 static 字段
                    var parts = [];
                    // 第一步：遍历 dynamic 所有字段（含 static 对应的和独有的）
                    for (var dk in dynMap) {
                        var stTag = mergeMap[dk];  // 这个 dynamic 字段对应哪个 static 标签
                        if (stTag) {
                            usedStatic[stTag] = true;
                            parts.push(dynMap[dk]);
                        }
                    }
                    // 第二步：static 中未被 dynamic 覆盖的字段补上
                    var allStaticTags = Object.keys(staticMap);
                    for (var ti = 0; ti < allStaticTags.length; ti++) {
                        if (!usedStatic[allStaticTags[ti]] && staticMap[allStaticTags[ti]]) {
                            parts.push(stripOne(staticMap[allStaticTags[ti]]));
                        }
                    }
                    // 第三步：dynamic 独有字段（衣着/配饰/状态/临时 — 没有对应 static 标签）
                    ['衣着','配饰','状态','临时'].forEach(function(f) { if (dynMap[f]) parts.push(dynMap[f]); });
                    anchor = parts.join(', ');
                }
                // [AI-Fix] per-image override：LLM 在 [FACE:名|字段:值] 中标注本图专属变化
                if (perImageOverride) {
                    var overrides = perImageOverride.slice(1).split("|");
                    for (var oi = 0; oi < overrides.length; oi++) {
                        var ov = overrides[oi], oc = Math.max(ov.indexOf(":"), ov.indexOf("："));
                        if (oc > 0) anchor = anchor + ", " + ov.slice(oc+1).trim();
                    }
                }
                result = result.replace(fullTag, anchor);
            } else {
                // [Fix] 无档案时删除占位符（原实现替换成角色名 → 人名进提示词，违反"禁止角色名"规则且污染画面）
                result = result.replace(fullTag, '');
            }
            faceRegex.lastIndex = 0;
        }
        // 兜底：未闭合的 [FACE:角色名（无]）→ 有档案用档案，无档案删除（不用名字兜底）
        result = result.replace(/\[FACE:([^\s\]]+)(?!\])/g, function(m, name) {
            var anchor = '';
            if (cast[name] && cast[name].static) anchor = stripAnchors(cast[name].static);
            else if (npcs[name] && npcs[name].static) anchor = stripAnchors(npcs[name].static);
            return anchor || '';
        });
        
        // 兼容旧的 [FACE] 无角色名格式（降级取第一个 cast）
        if (result.indexOf("[FACE]") >= 0) {
            var keys = Object.keys(cast);
            var mainChar = keys[0] || profiles.charName;
            var anchor = "";
            if (cast[mainChar] && cast[mainChar].static) {
                anchor = stripAnchors(cast[mainChar].static);
            }
            if (anchor) result = result.replace("[FACE]", anchor);
            else result = result.replace("[FACE]", "").trim();
        }
        // [Fix] 清理占位符删除后残留的重复逗号（中英文逗号都处理）
        result = result.replace(/[，,]\s*[，,]+/g, '，').replace(/\s*,\s*$/g, '').replace(/，\s*$/g, '').trim();
        
        return result;
    } catch(e) {
        slLog("resolveFacePrompt出错:", e.message);
        return rawPrompt.replace(/\[FACE:[^\]]+\]|\[FACE\]/g, "").trim();
    }
}


