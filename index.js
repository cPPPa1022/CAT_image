// ── SillyImage Lab v2.0 — 入口文件 ──
import { extension_settings, getContext } from '../../../extensions.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { loadPrompts } from './prompts/loader.js';

import { slLog, slErr, slLogDump, getLogCount } from './modules/log.js';
import { initSettings, settings, getDefaults, COLORS, getSTContext, getSTHeaders, escapeHtml, saveSettings } from './modules/settings.js';
import { buildUI } from './modules/ui.js';
import { setEnqueueGen } from './modules/render.js';
import { enqueueGen } from './modules/queue.js';
import { startPolling, stopPolling, getScannerStatus, hasCastCache } from './modules/scanner.js';
import { refreshCoopCards } from './modules/sync-cards.js';
import { imgCacheClear } from './modules/cache.js';
import { initFrontendBridge } from './modules/frontend-bridge.js';

// ── 版本 ──
window.SILLYLAB_VERSION = 'v1.1.2';
slLog('LOADED v1.1.2');

// ── 初始化设置 ──
initSettings(getContext, extension_settings);
try {
    var saved = localStorage.getItem('sillab_settings');
    if (saved) {
        var parsed = JSON.parse(saved);
        Object.assign(settings, getDefaults(), parsed);
        slLog('从 localStorage 加载设置');
    } else {
        Object.assign(settings, getDefaults(), extension_settings.sillab || {});
        saveSettings();
        slLog('从 extension_settings 迁移设置');
    }
} catch (e) {
    Object.assign(settings, getDefaults());
    slLog('设置加载失败，使用默认值: ' + e.message);
}

// [Fix] 配图策略旧默认迁移：上一版默认 encourage（允许零图轮），用户要求默认强制 → 一次性升级为 always。
// 用哨兵键保证只执行一次：之后用户在设置页主动选择的 encourage/关键场景 不会被再次覆盖。
if (settings.imageMode === 'encourage' && !localStorage.getItem('sillab_image_mode_migrated')) {
    settings.imageMode = 'always';
    try {
        saveSettings();
        localStorage.setItem('sillab_image_mode_migrated', '1');
    } catch (e) {}
    slLog('配图策略已迁移: encourage → always（强制+鼓励）');
}

// ── [Fix] 导演模式人物基础档案规则启用迁移 ──
// 旧版本该开关默认值为 false 且保存后的值不会被新默认值覆盖 → 用户有扫描档案却不生效。
// 一次性地把历史 false 迁移为 true（"扫描过→用插件档案"新规则）；哨兵键保证只执行一次，
// 用户之后在设置里的主动选择不会再被覆盖。
if (settings.directorCastImport === false && !localStorage.getItem('sillab_director_cast_migrated')) {
    settings.directorCastImport = true;
    try {
        saveSettings();
        localStorage.setItem('sillab_director_cast_migrated', '1');
    } catch (e) {}
    slLog('导演模式人物基础档案已按新规则启用（扫描过→用插件档案为权威 base）；如需关闭请到 模型与偏好 设置');
}

// ── 清旧缓存哨兵 ──
// [Fix] 这里每次页面加载都会执行——图片缓存（slimg_cache）绝不能在此清：
// 内存 imageCache 在模块已加载时存有旧值，清空后刷新恢复只能渲染出"无图图卡"（图片不见的根因）。
// 缓存只在该清的地方清：下方一次性部署哨兵块（sillab_clean_v210）+ cache.js 的 cleanOldCache。
try {
    localStorage.removeItem('slimg_v2_deployed');
    localStorage.removeItem('sillab_clean_v102');
} catch (e) {}

if (!localStorage.getItem('sillab_clean_v210')) {
    try {
        imgCacheClear();  // [C2] 同步清内存缓存，否则下次 imgCacheSet 会把旧值写回
        if (typeof extension_settings !== 'undefined') { delete extension_settings.sillab; }
        Object.assign(settings, getDefaults());
        try { saveSettings(); } catch (e) {}
        slLog('🧹 v1.0 全新部署喵~ 缓存清空啦 ✨🧹');
    } catch (e) { slLog('清缓存跳过: ' + e.message); }
    localStorage.setItem('sillab_clean_v210', '1');
}

// ── 图块精确缓存上线：一次性清理旧"提示词→图"缓存（旧键内容会互相覆盖，且与块标识不兼容） ──
if (!localStorage.getItem('sillab_slid_cache_v1')) {
    try { imgCacheClear(); } catch (e2) {}
    localStorage.setItem('sillab_slid_cache_v1', '1');
    slLog('🧹 图块精确缓存上线：旧图片缓存已清理（旧消息图片需重新生成一次，新图按块标识精确记录）');
}

slLog('v1.1.2 init');

// ── 注册斜杠命令 ──
SlashCommandParser.addCommandObject(SlashCommand.fromProps({name:'sillylab',callback:function(){var cb=jQuery('#sl_compact');if(cb.length){cb.trigger('click');}else{toastr.info('插件面板尚未初始化喵~');}}}));

// ── v1.1：移除上游版本检测+公告（远端为原作者仓库，会误报新版本/展示上游公告） ──

// ── 启动💬 提示词📂 加载 ──
var PROMPTS_BASE = '';
try { PROMPTS_BASE = new URL('prompts/', import.meta.url).href; } catch (e) { PROMPTS_BASE = '/scripts/extensions/third-party/sillyCAT/prompts/'; slLog('import.meta.url 不可用，使用 fallback 路径'); }
if (PROMPTS_BASE) { slLog('提示词加载器: 📥 从 ' + PROMPTS_BASE + ' 加载'); /* [AI-Fix] loadPrompts 是 async 函数，原代码未 await 也未被 .catch()，提示词加载失败时产生 Unhandled Promise Rejection。加 catch 防止静默失败。 */ loadPrompts(PROMPTS_BASE).catch(function(e) { slErr('提示词加载失败: ' + (e.message||'').slice(0,80)); }); }
else { slLog('提示词加载器: 呜呜 import.meta.url 不可用喵~ (╥﹏╥)'); }

// ── 注入 render 模块的生图排队 ──
setEnqueueGen(enqueueGen);

// ── 构建 UI ──
try { buildUI(extension_settings); slLog('v1.1.2 UI OK'); } catch (e) { slErr('buildUI失败: ' + e.message); console.error('[sillab] buildUI失败:', e); }

// ── 启动轮询 + 事件钩子 ──
startPolling();

// ── v1.1.2 前端卡桥（重前端卡：酒馆助手 iframe 应用） ──
// 前端卡的叙事不进聊天消息 → 常规扫描扫不到；这里挂 TavernHelper.generate 截获叙事出图
try { initFrontendBridge(); } catch (e) { slErr('前端桥初始化失败: ' + e.message); }

// ── v2.4 协作卡注入（酒馆AI模式：通知主LLM占位符协议+人物索引） ──
try { refreshCoopCards(); slLog('v2.4 协作卡初始化: ' + (settings.imgMode === 'main' ? '酒馆AI模式' : '插件AI模式')); } catch (e) { slErr('协作卡初始化失败: ' + e.message); }

