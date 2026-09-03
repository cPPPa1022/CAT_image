// ── SillyImage Lab v2.4 生图协作卡 + 人物档案索引（对主LLM的"对讲卡"） ──
// 用 ST 原生 setExtensionPrompt 每轮注入，让酒馆AI知道：怎么配合写 [img:] 占位、插件知道哪些人。
// position = 2 (BEFORE_PROMPT, ST script.js extension_prompt_types.BEFORE_PROMPT)

import { slLog } from './log.js';
import { settings, getSTContext, getActiveMode } from './settings.js';
import { rosterEntries, rosterIndexText } from './roster.js';

var MODULE = 'sillycat_coop';
var POSITION = 2; // BEFORE_PROMPT

// 模式中文描述
function modeDesc(m) {
    if (m === 'anime') return 'anime（提示词用英文描述）';
    if (m === 'anime_tag') return 'anime_tag（提示词用英文标签）';
    return 'zit（中文提示词）';
}

export function buildCoopCardText() {
    var lines = [];
    lines.push('【生图协作卡·sillycat】');
    lines.push('· 正文中适合配图的瞬间写 1-3 个占位符 [img:画面描述]，占位符位置就是图片显示位置；占位数量 = 本轮图片数。');
    lines.push('· [img:] 写画面要素：人物（谁+动作+表情）+ 场景氛围 + 可选构图（特写/近景/远景/双人）；想强调细节时用 | 追加： [img:场景|特写手部，琴弦，油灯]');
    lines.push('· 已建档人物（见下方索引）插件认识长相，不用描述外貌；未建档人物必须写明：[img:场景|人物:名字（身份标签），外貌概要；可多人分号分隔]。');
    lines.push('· 人物穿着（上衣/下装/内衣等）如实写入画面要素，生图按描述呈现。');
    var _modeNow = getActiveMode();
    // [Fix] 画风预设只在 ZIT 模式实际应用（comfyui.js generateImage），anime 模式不再谎称"已自动应用"（C4）
    lines.push('· 当前模式：' + modeDesc(_modeNow) + '；' + (settings.stylePreset ? ('画风预设：「' + settings.stylePreset + '」' + (_modeNow === 'zit' || !_modeNow ? '已自动应用；' : '（中文预设，生图时未自动应用，按需在画面要点中体现风格）；')) : '画风预设：未选择；') + (settings.nsfwEnhance ? '成人内容：按卡内容如实配图。' : ''));
    lines.push('【人物档案索引】');
    // [Fix] *更新* ACK 机制：人物表条目刚建立/更新时带 _updated 标记，索引里显示 *更新*（只显示一轮），
    // 主 LLM 据此确认"上一轮写的人物指导已入库"，从而不需要重复描写外貌。
    var entries = rosterEntries();
    var names = [];
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var mark = '';
        if (e._updated) { mark = '*更新*'; e._updated = false; }
        names.push(e.key + mark);
    }
    if (names.length) {
        lines.push('已建档（' + (settings.directorCastImport !== false ? '插件的角色卡扫描档案+历轮收集' : '插件历轮从占位符收集') + '，插件认识其长相）：' + names.join('、'));
        lines.push('索引带 *更新* 的人物 = 上一轮刚建立/更新了档案（你写的人物指导已入库，可放心引用）；不带标记 = 长期未变，无需重复外貌；人物外貌有新变化时才在占位符写明，下一轮该人物会带 *更新* 标记。');
        lines.push('已建档人物只需写“谁+在做什么”，无需描述外貌；未建档的新人物请在占位符中写明外貌，插件将建立长期档案。');
    } else {
        lines.push('（暂无建档人物；出现的所有人物都请在占位符中写明外貌，插件将建档。）');
    }
    return lines.join('\n');
}

// 刷新注入（启动/切聊天/档案变化/设置变化时调用）
export function refreshCoopCards() {
    try {
        var ctx = getSTContext();
        if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;
        if (settings.imgMode !== 'main' || settings.injectCards === false) {
            if (ctx.setExtensionPrompt) ctx.setExtensionPrompt(MODULE, '', POSITION, 0);
            return;
        }
        var text = buildCoopCardText();
        ctx.setExtensionPrompt(MODULE, text, POSITION, 0);
        slLog('协作卡已注入: ' + text.length + '字, 人物索引 ' + rosterEntries().length + ' 人');
    } catch (e) { slLog('协作卡注入异常: ' + e.message); }
}

export var COOP_MODULE = MODULE;
