// ── SillyImage Lab v2.0 — 入口文件 ──
import { extension_settings, getContext } from '../../../extensions.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { loadPrompts } from './prompts/loader.js';

import { slLog, slErr, slLogDump, getLogCount } from './modules/log.js';
import { initSettings, settings, getDefaults, COLORS, getSTContext, getSTHeaders, escapeHtml, saveSettings } from './modules/settings.js';
import { buildUI } from './modules/ui.js';
import { setEnqueueGen, restoreImageBlocks } from './modules/render.js';
import { enqueueGen } from './modules/queue.js';
import { imgStoreInit } from './modules/imgstore.js';
import { startPolling, stopPolling, getScannerStatus, hasCastCache } from './modules/scanner.js';
import { refreshCoopCards } from './modules/sync-cards.js';
import { cleanLegacyAnchors } from './modules/roster.js';
import { imgCacheClear } from './modules/cache.js';
import { initFrontendBridge } from './modules/frontend-bridge.js';

// ── 版本 ──
window.SILLYLAB_VERSION = 'v1.26.4';
slLog('LOADED v1.26.4');

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

// ── v1.22：图片缓存仓（IndexedDB）──
// 历史图缓存不再随设置进 localStorage（那里只够放 50 条、还是全库共享）。
// 这里把 IDB 里的缓存装回内存，装完立刻恢复一次历史消息里的图。
imgStoreInit().then(function (r) {
    try { restoreImageBlocks(); } catch (e) { slLog('历史图恢复跳过: ' + e.message); }
    slLog('图片仓装填完成：' + ((r && r.loaded) || 0) + ' 条（本会话历史图上限已解除）');
});

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

// ── v2.0：档案跟着聊天走 ──
// 人物档案 = settings.roster[角色卡][聊天ID]，同卡不同聊天【不继承】。
// 老的一次性迁移（把 directorCastImport 强制改成 true）已移除 —— 它会让每个新聊天自动继承卡级旧扫描档案。
if (settings.directorCastImport === true && !localStorage.getItem('sillab_cast_import_off_v2')) {
    settings.directorCastImport = false;   // 历史 true 统一落回"不继承"
    try { saveSettings(); localStorage.setItem('sillab_cast_import_off_v2', '1'); } catch (e) {}
    slLog('档案已改为「跟着聊天走」：同卡不同聊天不再继承旧扫描档案');
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

// ── v2.0 锚点库改版：一次性清掉【旧版本残留】的分模式锚点 ──
// 旧版：四种模式各存一份锚点（roster[卡][聊天][人物].atoms.<模式>）。anima 那份因为 PROFILE 示例
//       全是中文，被辅助 AI 照抄成中文 → 立绘走 cleanAnimePrompt 时被整段删空 → 只剩框架词 →
//       画出与角色无关的路人（2026-10-17 实测 8/8 全废）。
// 新版：锚点只有一套、只写英文（entry.anchor）+ zit 中文呈现缓存（entry.atoms.zit）。
// 旧桶一律作废：清掉后辅助 AI 下一轮会按新规范重建（英文 anchor + 中文 anchor_zh）。
// ⚠️ 只动锚点字段：base / appearance / live / portrait 全部保留，
//    API 配置（auxUrl / auxKey / auxModel / cUrl / cWf…）一个字都不碰。
if (!localStorage.getItem('sillab_anchor_v2_clean')) {
    try {
        var _ac = cleanLegacyAnchors();
        try { saveSettings(); } catch (e) {}
        localStorage.setItem('sillab_anchor_v2_clean', '1');
        slLog('🧹 锚点库 v2.0：清掉旧版分模式锚点 ' + _ac.slots + ' 条（涉及 ' + _ac.persons + ' 人）'
            + (_ac.bad ? '，另清掉 ' + _ac.bad + ' 条非英文锚点' : '')
            + '，人物档案/立绘/API 配置未动 → 下一轮聊天会自动重建【英文权威锚点】');
    } catch (e) { slLog('锚点清理跳过: ' + e.message); }
}

slLog('v1.17.0 init');

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
try { buildUI(extension_settings); slLog('v1.17.0 UI OK'); } catch (e) { slErr('buildUI失败: ' + e.message); console.error('[sillab] buildUI失败:', e); }

// ── 启动轮询 + 事件钩子 ──
startPolling();

// ── v1.1.2 前端卡桥（重前端卡：酒馆助手 iframe 应用） ──
// 前端卡的叙事不进聊天消息 → 常规扫描扫不到；这里挂 TavernHelper.generate 截获叙事出图
try { initFrontendBridge(); } catch (e) { slErr('前端桥初始化失败: ' + e.message); }

// ── v2.4 协作卡注入（酒馆AI模式：通知主LLM占位符协议+人物索引） ──
try { refreshCoopCards(); slLog('v2.4 协作卡初始化: 导演模式'); } catch (e) { slErr('协作卡初始化失败: ' + e.message); }

