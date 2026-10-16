// ── SillyImage Lab 视图 v2.7（SnowCat：主视图 Feed + 分层子页） ──
import { CAT, CAT_THEMES, TEXT_THEMES, applyTheme, THEME_ORDER, THEME_ICONS } from './theme.js';
import { card, groupTitle, cell, cardHead, lbl, chip, btnMain, btnGhost, btnSm, btnDanger, switchHTML, empty } from './primitives.js';
import { catSVG, catStatusText } from './cat.js';
import { toast, esc, escAttr, fi, chkProf } from './utils.js';
import { settings, saveSettings, getActiveMode } from '../settings.js';
import { slLogDump, getLogCount, slClearLogs, slLog } from '../log.js';
import { getProfiles, getCharacterName } from '../pipeline/profile.js';
import { startPolling, stopPolling, getScannerStatus } from '../scanner.js';
import { getQueueLength, enqueueTask } from '../queue.js';
import { cleanAnimePrompt } from '../text-utils.js';
import { rosterEntries } from '../roster.js';
import { openSubPanel } from './sub-panels.js';
import * as panel from './panel.js';
var pushPage = panel.pushPage;
import * as compact from './compact-bar.js';
import * as story from '../story.js';
import { refreshCoopCards } from '../sync-cards.js';
import { initFrontendBridge, stopFrontendBridge, getFeBridgeStatus, probeFrontendApp, injectTestCard, injectTestDirector } from '../frontend-bridge.js';
import { getPrompt, isPromptsLoaded } from '../../prompts/loader.js';

// ═══════════ 主视图（Feed） ═══════════
export function renderHomeTab() {
  var body = jQuery('#sl_panel_body'); if (!body.length) return;
  body.find('.sl-page').remove();
  var cn = getCharacterName() || '未选择角色', hp = chkProf(), ss = getScannerStatus(), ql = getQueueLength(),
    ha = !!(settings.auxUrl && settings.auxModel), hc = !!settings.cUrl, hw = !!(settings.cWf && settings.cWf.length > 50),
    allReady = ha && hc && hw, h = '';
  // 顶部：状态猫大卡
  var catFaceState = ss === 'scanning' ? 'busy' : (ql > 0 ? 'queuing' : (hp ? 'healthy' : 'idle'));
  h += '<div style="' + card() + ';padding:18px;display:flex;flex-direction:column;align-items:center;gap:2px;">';
  h += '<span class="sl-cat-hero" style="color:' + CAT.accent + ';display:flex;">' + catSVG(catFaceState, 76) + '</span>';
  h += '<div style="font-size:13px;font-weight:700;color:' + CAT.text + ';margin-top:6px;">' + catStatusText(catFaceState) + '</div>';
  h += '<div style="font-size:11px;color:' + CAT.sub + ';">' + (ss === 'scanning' ? '扫描角色档案中…' : (ql > 0 ? '队列 ' + ql + ' 张待画' : (hp ? '档案已就绪' : '档案还没备好'))) + '</div>';
  h += '</div>';
  // 角色卡
  h += '<div class="sl-hover-card" style="' + card() + 'padding:16px;">';
  h += '<div style="display:flex;align-items:center;gap:13px;">';
  h += '<span style="width:48px;height:48px;border-radius:14px;background:' + CAT.bg + ';display:flex;align-items:center;justify-content:center;font-size:23px;flex-shrink:0;color:' + CAT.accent + ';">' + catSVG('healthy', 30) + '</span>';
  h += '<div style="flex:1;min-width:0;"><div style="font-weight:800;font-size:16px;color:' + CAT.text + ';">' + esc(cn) + '</div><div style="font-size:11px;color:' + CAT.sub + ';margin-top:2px;">' + '🎬 导演模式 · 主模型指挥' + ' · ' + (settings.autoGen === 1 ? '自动出图' : '手动出图') + '</div></div>';
  h += '</div>';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">';
  h += '<span style="' + chip(CAT.bg, CAT.sub) + '">' + ({ zit: '🖼️ ZIT', anime: '🎬 Anime', anime_tag: '🎬 Tag', anima: '🎬 Anima' }[getActiveMode()] || '🖼️ ZIT') + '</span>';
  var _pn = 0; try { _pn = rosterEntries().length; } catch (e0) {}
  h += '<span style="' + chip(_pn ? CAT.green + '1F' : CAT.bg, _pn ? CAT.green : CAT.sub) + '">' + (_pn ? '🐾 已建档 ' + _pn + ' 人' : '🐾 暂无档案') + '</span>';
  h += '<span style="' + chip(CAT.bg, CAT.sub) + '">🐟 队列 ' + ql + '</span>';
  h += '</div></div>';
  // 快捷操作：一键补排（建档已改为聊天中自动完成，不再需要手动扫描）
  h += '<div style="display:flex;gap:8px;"><button id="sl_btn_gen_all" style="flex:1;' + btnMain() + '">一键排图</button></div>';
  // v1.2：画师模式已移除，只剩导演模式 → 不再需要模式切换
  h += '<div style="font-size:10px;color:' + CAT.mute + ';text-align:center;margin:2px 0 10px;">🎬 导演模式：主模型在正文写 [img:] 占位符（位置+画面要点），插件 AI 只负责把要点写成生图提示词（最省 token，需角色卡配置指令）</div>';
  // 设置与工具（分组列表）
  h += groupTitle('角色与世界');
  h += '<div style="' + card() + ';padding:4px 8px;">';
  h += cell('🐾', '角色档案', '人物外貌锚点 · 生成立绘', (_pn ? '已建档 ' + _pn + ' 人' : '暂无档案'), 'data-nav="archive"');
  h += cell('🧶', '剧情库', '每轮正文自动存档 · 标签 · 总结', storyCountText(), 'data-nav="story"');
  h += '</div>';
  h += groupTitle('生图与设置');
  h += '<div style="' + card() + ';padding:4px 8px;">';
  h += cell('🎨', 'ComfyUI & 工作流', '连 ComfyUI 出图：地址/工作流/画风/负面词', (hc ? '已连接' : '未连接'), 'data-nav="comfy"');
  h += cell('🧠', 'AI 助理', '配辅助 AI：写提示词、分析档案用哪个模型', (ha ? '已就绪' : '未配置'), 'data-nav="aux"');
  h += cell('🖼️', '模型与偏好', '提示词风格 · 配图频率 · 额外词条', '', 'data-nav="settings"');
  h += '</div>';
  h += groupTitle('外观与维护');
  h += '<div style="' + card() + ';padding:4px 8px;">';
  h += cell('🐱', '主题外观', '雪白猫 · 墨黑夜猫 …', (settings.uiTheme || '雪白猫'), 'data-nav="theme"');
  h += cell('📊', '运行日志', '看这只猫在干嘛', '', 'data-nav="log"');
  h += cell('⚙️', '高级与重置', 'NSFW · Debug · 重置插件', '', 'data-nav="advanced"');
  h += '</div>';
  // 底部品牌
  // [Fix v1.1.3] 版本号原先是写死的字符串（一直是 v1.1.1，升版本也不变，排查时误导人）→ 跟随实际版本变量
  var _ver = (typeof window !== 'undefined' && window.SILLYLAB_VERSION) ? window.SILLYLAB_VERSION : '';
  h += '<div style="text-align:center;padding:14px 0 6px;color:' + CAT.mute + ';font-size:10px;letter-spacing:1px;">小猫的生图插件 ' + esc(_ver) + '</div>';
  body.html(h);
  // 交互绑定
  body.off('click', '#sl_btn_gen_all').on('click', '#sl_btn_gen_all', compact.triggerGenAll);
  body.off('click', '.sl-cell[data-nav]').on('click', '.sl-cell[data-nav]', function () {
    var nav = jQuery(this).data('nav');
    if (nav === 'archive') renderArchivePage();
    else if (nav === 'story') renderStoryPage();
    else if (nav === 'comfy') openSubPanel('comfy');
    else if (nav === 'aux') openSubPanel('aux');
    else if (nav === 'settings') renderSettingsPage();
    else if (nav === 'theme') renderThemePage();
    else if (nav === 'log') renderLogPage();
    else if (nav === 'advanced') openSubPanel('advanced');
  });
}
function storyCountText() {
  try { var ov = settings.storyOverview && settings.storyOverview.count; return ov != null ? ov + ' 条' : ''; } catch (e) { return ''; }
}

// ═══════════ 子页：设置 ═══════════
export function renderSettingsPage() {
  pushPage(function (body) {
    var f = fi(), h = '';
    h += '<div style="' + card() + ';padding:14px 16px;">' + switchHTML('sl_plugin_on', settings.pluginOn !== false, '插件开启', '关掉就停止扫描与出图') + '</div>';
    h += '<div style="' + card() + '">' + cardHead('🖼️', '模型类型', '决定提示词语言') + '<select id="sl_model_type" style="' + f + '"><option value="zit"' + (settings.modelType === 'zit' ? ' selected' : '') + '>ZIT（中文提示词）</option><option value="anima"' + (settings.modelType === 'anima' ? ' selected' : '') + '>🎬 Anima 混合（标签定结构 + 自然语言写氛围）★ Anima 系模型推荐</option><option value="anime"' + (settings.modelType === 'anime' ? ' selected' : '') + '>Anime（纯英文描述）</option><option value="anime_tag"' + (settings.modelType === 'anime_tag' ? ' selected' : '') + '>Anime Tag（纯英文标签）</option></select><div style="font-size:10px;color:' + CAT.mute + ';margin-top:6px;line-height:1.6;">Anima 系模型由 Danbooru 标签 + 自然语言 caption 混合训练：<b>纯标签丢氛围，纯描述丢结构</b> → 用混合模式效果最好。</div></div>';
    h += '<div style="' + card() + '">' + cardHead('🐟', '配图偏好', '这只猫什么时候画图') + '<select id="sl_image_mode" style="' + f + '"><option value="always"' + (settings.imageMode === 'always' ? ' selected' : '') + '>总是配图（每轮 ≥1 张）</option><option value="encourage"' + (settings.imageMode === 'encourage' ? ' selected' : '') + '>鼓励配图（该插就插）</option><option value="key"' + (settings.imageMode === 'key' ? ' selected' : '') + '>关键场景（宁缺毋滥）</option></select></div>';
    h += '<div style="' + card() + '">' + cardHead('🖼️', '图块尺寸', '图卡里图片的宽度（分辨率低建议调小）') + '<select id="sl_img_width" style="' + f + '"><option value="100%"' + ((settings.imgBlockWidth || '55%') === '100%' ? ' selected' : '') + '>大（100%）</option><option value="75%"' + ((settings.imgBlockWidth || '55%') === '75%' ? ' selected' : '') + '>中（75%）</option><option value="55%"' + ((settings.imgBlockWidth || '55%') === '55%' ? ' selected' : '') + '>小（55% · 默认）</option><option value="40%"' + ((settings.imgBlockWidth || '55%') === '40%' ? ' selected' : '') + '>迷你（40%）</option></select></div>';
    h += '<div style="' + card() + '">' + cardHead('🎬', '配图方式：导演模式', '主模型写 [img:] 占位符 → 插件 AI 写提示词') + '<div style="font-size:10.5px;color:' + CAT.sub + ';margin:6px 0 10px;line-height:1.6;">主模型在正文写 <code>[img:场景|人物:名字（标签）：静态外貌特征|要点]</code> 标记图片位置+画面要点 → 插件按「占位符 + 人物档案」写提示词出图，<b>不读正文</b>（最省 token）。<br>需要在角色卡 / 预设 / 世界书贴「小猫指令」（👇 一键复制）。</div><div style="margin-bottom:10px;">' + switchHTML('sl_director_cast', settings.directorCastImport === true, '把卡级旧扫描档案带进每个聊天', '默认关闭 —— 人物档案跟着聊天走：每个聊天各存一套，同卡不同聊天【不继承】。开启后，新聊天第一次出图时会把卡级的旧扫描档案导入本聊天（一般不需要）') + '</div><button id="sl_copy_instr" style="width:100%;' + btnGhost() + 'color:' + CAT.accent + ';">复制 小猫指令</button></div>';
    h += '<div style="' + card() + '">' + cardHead('🖥️', '前端卡配图（酒馆助手 iframe 应用）', 'Narrator / 检查站这类"重前端卡"专用') +
      switchHTML('sl_fe_bridge', settings.feBridge !== false, '接管前端应用（推荐）', '前端卡的剧情由卡自己调 AI 画在自己界面里，从不写进聊天消息，插件按消息扫描永远扫不到。打开后：从卡内 AI 调用结果截获剧情 → 走导演管线出图 → 图卡注入应用自己的叙事区（找不到叙事区就放应用内浮层）') +
      '<div style="margin-top:10px;"><span style="' + lbl() + '">走哪条管线</span><select id="sl_fe_mode" style="' + f + '">' +
      '<option value="auto"' + ((settings.feBridgeMode || 'auto') === 'auto' ? ' selected' : '') + '>自动识别（推荐）— 剧情里有 [img:] 就走导演（占位符原位出图），没有则本轮跳过</option>' +
      '<option value="director"' + (settings.feBridgeMode === 'director' ? ' selected' : '') + '>强制导演 + 注入指令 — 预设里没缝「小猫指令」时用，插件会把 [img:] 协议补进卡内请求</option>' +
      '</select><div style="font-size:10px;color:' + CAT.mute + ';margin-top:6px;line-height:1.6;">你的预设里已经缝了小猫指令 → 保持「自动识别」即可：主模型写出 [img:…] 时，插件把它原位换成图卡（占位符原文会被吃掉，不会留在正文里）。</div></div>' +
      '<div style="margin-top:10px;">' + switchHTML('sl_fe_inline', settings.feBridgeInline !== false, '图卡插入应用叙事区', '关闭则改为应用右下角浮层（当你觉得图卡插在正文里挡视线时用小浮层）') + '</div>' +
      '<div style="font-size:10.5px;color:' + CAT.sub + ';margin:10px 0 8px;line-height:1.6;">状态：' + esc(getFeBridgeStatus()) + '</div>' +
      '<button id="sl_fe_testd" style="width:100%;' + btnGhost() + 'color:' + CAT.accent + ';margin-bottom:8px;">🧪 测试导演原位替换（不出图，插一段带 [img:] 的假剧情）</button>' +
      '<button id="sl_fe_test" style="width:100%;' + btnGhost() + 'color:' + CAT.accent + ';margin-bottom:8px;">🧪 测试末尾插卡（不出图，插一张占位图卡）</button>' +
      '<button id="sl_fe_probe" style="width:100%;' + btnGhost() + '">🩺 诊断（写进日志）</button>' +
      '<div style="font-size:10px;color:' + CAT.mute + ';margin-top:8px;line-height:1.6;">前端卡必须装「酒馆助手 / JS-Slash-Runner」才能跑；每条剧情都会多一次辅助 AI 调用（导演管线的开销）。</div></div>';
    h += '<div style="' + card() + '">' + cardHead('📝', '前置提示词', '拼到每张提示词最前') + '<input id="sl_prompt_prefix" type="text" value="' + escAttr(settings.promptPrefix || '') + '" style="' + f + '" placeholder="留空则不生效"></div>';
    h += '<div style="' + card() + ';padding:14px 16px;">' + switchHTML('sl_show_prompt', settings.showGenPrompt === true, '图块显示完整提示词', '默认关闭：图块只显示短标题（详细字段只进生成链，用户看不到）；调试时打开可看到每张图的完整生成提示词') + '</div>';
    h += '<div id="sl_anime_opts" style="' + card() + 'background:' + CAT.bg + ';' + (settings.modelType === 'anime' || settings.modelType === 'anime_tag' || settings.modelType === 'anima' ? '' : 'display:none;') + '">' + cardHead('🎬', 'Anime 增强', 'Anime / Tag / Anima 模式生效') + '<span style="' + lbl() + '">质量前缀</span><input id="sl_anime_prefix" type="text" value="' + escAttr(settings.animeQualityPrefix || '') + '" style="' + f + 'margin-bottom:10px;"><span style="' + lbl() + '">艺术家标签</span><input id="sl_anime_artist" type="text" value="' + escAttr(settings.animeArtist || '') + '" style="' + f + '" placeholder="留空则不使用"></div>';
    h += '<div style="text-align:center;font-size:10px;color:' + CAT.mute + ';padding:6px 0 2px;">所有改动即时保存 · 无需手动保存</div>';
    body.html(h);
    bindSettingsEvents(body);
  }, '模型与偏好', { key: '模型与偏好' });
}
export function bindSettingsEvents(b) {
  b.off('change', '#sl_plugin_on').on('change', '#sl_plugin_on', function () { settings.pluginOn = jQuery(this).is(':checked'); saveSettings(); if (settings.pluginOn) { startPolling(); compact.setPluginEnabled(true); } else { stopPolling(); compact.setPluginEnabled(false); } });
  b.off('change', '#sl_model_type').on('change', '#sl_model_type', function () { settings.modelType = jQuery(this).val(); jQuery('#sl_anime_opts').toggle(settings.modelType === 'anime' || settings.modelType === 'anime_tag' || settings.modelType === 'anima'); saveSettings(); });
  b.off('change', '#sl_image_mode').on('change', '#sl_image_mode', function () { settings.imageMode = jQuery(this).val(); saveSettings(); });
  b.off('change', '#sl_img_width').on('change', '#sl_img_width', function () { settings.imgBlockWidth = jQuery(this).val(); saveSettings(); });
  b.off('change', '#sl_director_cast').on('change', '#sl_director_cast', function () { settings.directorCastImport = jQuery(this).is(':checked'); saveSettings(); try { refreshCoopCards(); } catch (e) {} toast('success', settings.directorCastImport !== false ? '已开启：卡库档案导入人物表' : '已关闭：扫描仅用于立绘/档案，人物表只留占位符收集'); });
  b.off('click', '#sl_copy_instr').on('click', '#sl_copy_instr', function () { var t = isPromptsLoaded() ? (getPrompt('main-llm-instruction.txt') || '') : ''; if (!t) t = '[img:画面描述] 指令未加载，请刷新重试'; if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(function () { toast('success', '指令已复制，贴到角色卡/预设/世界书'); }, function () { toast('error', '复制失败'); }); } else { toast('error', '浏览器不支持剪贴板'); } });
  // ── v1.1.2 前端卡桥 ──
  b.off('change', '#sl_fe_bridge').on('change', '#sl_fe_bridge', function () {
    settings.feBridge = jQuery(this).is(':checked'); saveSettings();
    if (settings.feBridge) { initFrontendBridge(); toast('success', '已开启：前端卡配图'); }
    else { stopFrontendBridge(); toast('info', '已关闭：前端卡配图'); }
    renderSettingsPage();
  });
  b.off('change', '#sl_fe_inline').on('change', '#sl_fe_inline', function () { settings.feBridgeInline = jQuery(this).is(':checked'); saveSettings(); toast('info', settings.feBridgeInline !== false ? '图卡插入应用叙事区' : '图卡改为应用内浮层'); });
  b.off('change', '#sl_fe_mode').on('change', '#sl_fe_mode', function () {
    settings.feBridgeMode = jQuery(this).val(); saveSettings();
    var m = settings.feBridgeMode;
    toast('success', m === 'director' ? '前端卡：强制导演 + 注入指令' : '前端卡：自动识别（有 [img:] 就导演原位，否则本轮跳过）');
    setTimeout(function () { try { renderSettingsPage(); } catch (e) {} }, 400);
  });
  b.off('click', '#sl_fe_testd').on('click', '#sl_fe_testd', function () {
    var ok = injectTestDirector();
    toast(ok ? 'success' : 'error', ok ? '已插入带 [img:] 的假剧情并原位替换：看图卡有没有落在正文里、[img:] 有没有被吃掉' : '没找到前端应用（当前聊天不是前端卡 / 酒馆助手没启用）');
    setTimeout(function () { try { renderSettingsPage(); } catch (e) {} }, 400);
  });
  b.off('click', '#sl_fe_test').on('click', '#sl_fe_test', function () {
    var ok = injectTestCard();
    toast(ok ? 'success' : 'error', ok ? '已插入测试图卡：看前端应用界面里有没有出现🐱图卡' : '没找到前端应用（当前聊天不是前端卡 / 酒馆助手没启用 / 应用还没挂载）');
    setTimeout(function () { try { renderSettingsPage(); } catch (e) {} }, 400);
  });
  b.off('click', '#sl_fe_probe').on('click', '#sl_fe_probe', function () {
    var r = probeFrontendApp();
    toast(r.hooked ? 'success' : 'warning', '钩子' + (r.hooked ? '已挂' : '未挂') + ' · ' + (r.appFound ? '找到前端应用' : '未找到前端应用') + ' · 详细写进日志页');
    setTimeout(function () { try { renderSettingsPage(); } catch (e) {} }, 400);
  });
  b.off('change input', '#sl_prompt_prefix').on('change input', '#sl_prompt_prefix', function () { settings.promptPrefix = jQuery(this).val(); saveSettings(); });
  b.off('change', '#sl_show_prompt').on('change', '#sl_show_prompt', function () { settings.showGenPrompt = jQuery(this).is(':checked'); saveSettings(); });
  b.off('change input', '#sl_anime_prefix').on('change input', '#sl_anime_prefix', function () { settings.animeQualityPrefix = jQuery(this).val(); saveSettings(); });
  b.off('change input', '#sl_anime_artist').on('change input', '#sl_anime_artist', function () { settings.animeArtist = jQuery(this).val(); saveSettings(); });
}

// ═══════════ 子页：主题外观 ═══════════
export function renderThemePage() {
  pushPage(function (body) {
    var h = '';
    h += '<div style="' + card() + '">' + cardHead('🐱', '主题', '七只小猫，七套皮肤');
    h += '<div style="display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;">';
    for (var ti = 0; ti < THEME_ORDER.length; ti++) {
      var tname = THEME_ORDER[ti], tcol = CAT_THEMES[tname], active = settings.uiTheme === tname;
      h += '<button class="sl_theme_pick" data-theme="' + escAttr(tname) + '" style="flex:1;min-width:88px;padding:12px 8px 10px;border-radius:14px;cursor:pointer;border:2px solid ' + (active ? CAT.accent : CAT.line) + ';background:' + CAT.card + ';display:flex;flex-direction:column;align-items:center;gap:7px;transition:all .2s ease;">';
      h += '<span style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,' + tcol.accent + ',' + tcol.bg + ');border:2px solid rgba(0,0,0,0.05);box-shadow:0 2px 8px rgba(0,0,0,0.12);"></span>';
      h += '<span style="font-size:10px;color:' + (active ? CAT.accent : CAT.sub) + ';font-weight:700;white-space:nowrap;">' + (THEME_ICONS[tname] || '') + ' ' + esc(tname) + '</span>';
      h += '</button>';
    }
    h += '</div></div>';
    h += '<div style="' + card() + '">' + cardHead('📖', '正文渲染', '图片周围文字的阅读样式') + '<select id="sl_text_theme" style="' + fi() + '">';
    for (var tk2 in TEXT_THEMES) h += '<option value="' + escAttr(tk2) + '"' + (settings.enhancedTheme === tk2 ? ' selected' : '') + '>' + tk2 + '</option>';
    h += '</select></div>';
    body.html(h);
    body.off('click', '.sl_theme_pick').on('click', '.sl_theme_pick', function () { var name = jQuery(this).data('theme'); if (!name || name === settings.uiTheme) return; settings.uiTheme = name; saveSettings(); applyTheme(name); compact.rebuildCompactBar(); panel.hidePanel(); setTimeout(function () { panel.showPanel(); renderThemePage(); toast('info', '换好啦：' + name); }, 300); });
    body.off('change', '#sl_text_theme').on('change', '#sl_text_theme', function () { settings.enhancedTheme = jQuery(this).val(); saveSettings(); });
  }, '主题外观', { key: '主题外观' });
}

// ═══════════ 子页：角色档案 ═══════════
export function renderArchivePage() {
  pushPage(function (body) { renderArchiveInto(body); }, '角色档案', { key: '角色档案' });
}
// ── 立绘地址：直接存在人物表条目上（档案跟着聊天走 → 删聊天立绘一起走）──
function getPortraitUrl(ent) { try { return (ent && ent.portrait) || ''; } catch (e) { return ''; } }
function setPortraitUrl(ent, url) { try { if (ent) ent.portrait = url; } catch (e) {} }

// ── 人物列表 = 本聊天的人物表（档案跟着聊天走）──
// 主模型每轮 [img:] 里写到的人物：有则沿用、无则建档，全都记在这次聊天的人物表里
function collectArchivePeople() {
  var out = [];
  try {
    var re = rosterEntries();
    for (var i = 0; i < re.length; i++) {
      var e = re[i];
      if (!e || !e.key) continue;
      out.push({ key: e.key, name: e.name || e.key, identity: e.identity || '', src: e.fromCard ? '角色卡' : '占位符', anchor: e.base || e.appearance || '', live: e.live || '', ent: e });
    }
  } catch (e2) {}
  return out;
}

function renderArchiveInto(body) {
  var pf = getProfiles();
  if (!pf || !pf.charName) { body.html(empty('还没进入聊天，去左边找你的猫猫角色', '🐱')); return; }
  var cast = pf.root[pf.charName].cast || {};
  var meta = pf.root[pf.charName].meta || {};
  var dynamics = pf.chat.dynamics || {};
  var npcs = pf.chat.npcs || {};
  var hasCast = Object.keys(cast).length > 0;
  var isWorld = meta.cardType === '世界观卡' || meta.cardType === '混合型卡';
  var people = collectArchivePeople();
  var h = '';
  // 当前角色卡（只显示卡名）
  h += '<div style="' + card() + ';padding:11px 14px;margin-bottom:10px;"><span style="font-weight:700;font-size:13.5px;color:' + CAT.text + ';">🐾 ' + esc(pf.charName) + '</span></div>';
  if (!people.length) {
    h += '<div style="' + card() + '">' + cardHead('🐾', '还没有人物档案', '聊着聊着就有了');
    h += '<div style="font-size:10.5px;color:' + CAT.sub + ';line-height:1.7;">正常聊天即可 —— 主模型在正文里写 <b>[img:…|人物:名字（标签）：外貌]</b> 占位符时，插件会为该人物自动建档，之后每轮沿用同一套外貌锚点。</div></div>';
    h += userCardInto(); h += storyCardInto();
    body.html(h); bindArchiveEvents(body); bindStoryEvents(body);
    return;
  }
  // 人物卡片：立绘（黄金比 1:1.618）+ 名字 + 标签，点进去看完整档案
  for (var pi = 0; pi < people.length; pi++) {
    var ppl = people[pi];
    var ck = ppl.key, purl = getPortraitUrl(ppl.ent);
    h += '<div class="sl_pcard" data-char="' + escAttr(ck) + '" style="' + card() + 'padding:10px;display:flex;gap:12px;align-items:center;cursor:pointer;">';
    h += '<div style="display:flex;gap:12px;align-items:center;flex:1;min-width:0;">';
    h += '<div id="sl_port_' + escAttr(ck).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_') + '" style="width:78px;height:126px;border-radius:10px;background:' + CAT.bg + ';display:flex;align-items:center;justify-content:center;border:1.5px dashed ' + CAT.line + ';font-size:9px;color:' + CAT.sub + ';text-align:center;flex-shrink:0;' + (purl ? 'background-image:url(' + purl + ');background-size:cover;background-position:top center;border:1.5px solid ' + CAT.accent + ';color:transparent;' : '') + '">' + (purl ? '' : '🐱\n立绘') + '</div>';
    h += '<div style="flex:1;min-width:0;">';
    h += '<div style="font-weight:700;font-size:13px;color:' + CAT.text + ';margin-bottom:3px;">' + esc(ppl.name || ck) + '</div>';
    h += '<div style="font-size:10.5px;color:' + CAT.sub + ';">' + esc(ppl.identity || '（无标签）') + '</div>';
    h += '</div>';
    h += '<div style="color:' + CAT.mute + ';font-size:15px;padding-right:2px;">›</div>';
    h += '</div></div>';
  }
  body.html(h); bindArchiveEvents(body);
}

// 立绘提示词（生成立绘用的完整提示词，供复制去 ComfyUI 实测）
function buildPortraitPrompt(anchor, bm) {
  if (!anchor) return '';
  var frame = (bm === 'zit') ? '，站立，正面，全身，简洁纯色背景，表情平静' : ', standing, front view, full body, simple background, neutral expression';
  var pr = anchor + frame;
  if (bm === 'anime' || bm === 'anime_tag') pr = cleanAnimePrompt(pr);
  return pr;
}

// ── 人物详情页：完整档案（补全后锚点）+ 编辑锚点 + 提示词 ──
function renderPersonDetail(body, key) {
  var people = collectArchivePeople(), ppl = null;
  for (var i = 0; i < people.length; i++) { if (people[i].key === key) { ppl = people[i]; break; } }
  if (!ppl) { renderArchiveInto(body); return; }
  var bm = getActiveMode() || 'zit';
  var atom = (ppl.ent && ppl.ent.atoms && ppl.ent.atoms[bm]) || '';
  var purl = getPortraitUrl(ppl.ent);
  var safe = String(ppl.key).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
  var h = '';
  h += '<button class="sl_pback" style="' + btnGhost() + 'font-size:11px;padding:6px 14px;margin-bottom:10px;">‹ 返回</button>';
  h += '<div style="' + card() + 'padding:13px;">';
  h += '<div style="display:flex;gap:14px;align-items:flex-start;">';
  h += '<div id="sl_port_' + safe + '" style="width:96px;height:155px;flex-shrink:0;border-radius:10px;background:' + CAT.bg + ';border:1.5px ' + (purl ? 'solid ' + CAT.accent : 'dashed ' + CAT.line) + ';background-size:cover;background-position:top center;display:flex;align-items:center;justify-content:center;font-size:9.5px;color:' + CAT.sub + ';text-align:center;' + (purl ? 'background-image:url(' + purl + ');color:transparent;' : '') + '">' + (purl ? '' : '立绘') + '</div>';
  h += '<div style="flex:1;min-width:0;">';
  h += '<div style="font-weight:700;font-size:14px;color:' + CAT.text + ';margin-bottom:3px;">' + esc(ppl.name || ppl.key) + '</div>';
  h += '<div style="font-size:11px;color:' + CAT.sub + ';margin-bottom:9px;">' + esc(ppl.identity || '（无标签）') + '</div>';
  h += '<div style="font-size:9.5px;color:' + CAT.mute + ';margin-bottom:3px;">完整档案 · 补全后原子锚点【' + esc(bm) + '】</div>';
  h += '<div style="font-size:10px;color:' + CAT.mute + ';line-height:1.75;max-height:190px;overflow:auto;">' + (atom ? esc(atom) : '（还没有补全后的锚点 —— 先正常聊一轮、出一次图，插件就会按 38 维建档）') + '</div>';
  h += '<div style="display:flex;gap:6px;margin-top:11px;flex-wrap:wrap;">';
  h += '<button class="sl_port_btn" data-char="' + escAttr(ppl.key) + '" style="' + btnSm() + 'font-size:10.5px;padding:6px 13px;">生成立绘</button>';
  h += '<button class="sl_edit_btn" data-char="' + escAttr(ppl.key) + '" style="' + btnGhost() + 'font-size:10.5px;padding:6px 13px;">编辑锚点</button>';
  h += '<button class="sl_prompt_btn" data-char="' + escAttr(ppl.key) + '" style="' + btnGhost() + 'font-size:10.5px;padding:6px 13px;">提示词</button>';
  h += '</div>';
  h += '<div class="sl_edit_box" data-char="' + escAttr(ppl.key) + '" style="display:none;margin-top:10px;"><textarea class="sl_edit_ta" data-char="' + escAttr(ppl.key) + '" style="width:100%;min-height:110px;' + fi() + 'font-size:10.5px;resize:vertical;">' + esc(atom) + '</textarea><div style="display:flex;gap:5px;margin-top:6px;"><button class="sl_save_btn" data-char="' + escAttr(ppl.key) + '" style="' + btnSm() + 'font-size:10px;background:' + CAT.green + ';box-shadow:none;">保存</button><button class="sl_cancel_btn" data-char="' + escAttr(ppl.key) + '" style="' + btnGhost() + 'font-size:10px;padding:6px 12px;">取消</button></div><div style="font-size:9.5px;color:' + CAT.mute + ';margin-top:6px;">保存后：下一轮出图时辅助 AI 会看到这份锚点（LLM 没有上轮记忆，所以体感是"下一次生效"）</div></div>';
  h += '<div class="sl_prompt_box" data-char="' + escAttr(ppl.key) + '" style="display:none;margin-top:10px;"><textarea class="sl_prompt_ta" data-char="' + escAttr(ppl.key) + '" readonly style="width:100%;min-height:110px;' + fi() + 'font-size:10.5px;resize:vertical;">' + esc(buildPortraitPrompt(atom, bm)) + '</textarea><div style="margin-top:6px;"><button class="sl_copy_btn" data-char="' + escAttr(ppl.key) + '" style="' + btnSm() + 'font-size:10px;">复制提示词</button></div></div>';
  h += '</div></div></div>';
  body.html(h); bindArchiveEvents(body);
}
export function bindArchiveEvents(b) {
  b.off('change input', '#sl_user_name,#sl_user_desc').on('change input', '#sl_user_name,#sl_user_desc', function () { settings.userName = b.find('#sl_user_name').val(); settings.userDesc = b.find('#sl_user_desc').val(); saveSettings(); });
  b.off('change input', '#sl_specialization').on('change input', '#sl_specialization', function () { var pf = getProfiles(); if (pf && pf.root[pf.charName] && pf.root[pf.charName].meta) { pf.root[pf.charName].meta.specialization = jQuery(this).val(); saveSettings(); } });
  b.off('click', '.sl_arch_st').on('click', '.sl_arch_st', function () { var st = parseInt(jQuery(this).data('ast')); b.find('.sl_arch_st').css({ background: 'transparent', color: CAT.sub, fontWeight: '600' }); jQuery(this).css({ background: CAT.accent, color: '#fff', fontWeight: '700' }); b.find('#sl_arch_static').toggle(st === 0); b.find('#sl_arch_dynamic').toggle(st === 1); });
  b.off('click', '.sl_cancel_btn').on('click', '.sl_cancel_btn', function () { b.find('.sl_edit_box[data-char="' + jQuery(this).data('char') + '"]').hide(); });
  // 保存的是【补全后的锚点】= atoms[当前模式]（不是主模型原文 base）
  b.off('click', '.sl_save_btn').on('click', '.sl_save_btn', function () {
    var cn = jQuery(this).data('char'), nt = b.find('.sl_edit_ta[data-char="' + cn + '"]').val();
    var bm2 = getActiveMode() || 'zit';
    var hit = false;
    try {
      var reS = rosterEntries();
      for (var iS = 0; iS < reS.length; iS++) {
        if (reS[iS] && reS[iS].key === cn) {
          if (!reS[iS].atoms) reS[iS].atoms = {};
          reS[iS].atoms[bm2] = nt;
          hit = true; break;
        }
      }
    } catch (e8) {}
    if (!hit) { toast('error', '找不到该人物档案'); return; }
    saveSettings(); toast('success', cn + ' 锚点已保存（下一次出图生效）');
    renderPersonDetail(b, cn);
  });
  // 卡片 → 详情页；返回
  b.off('click', '.sl_pcard').on('click', '.sl_pcard', function () { renderPersonDetail(b, jQuery(this).data('char')); });
  b.off('click', '.sl_pback').on('click', '.sl_pback', function () { renderArchiveInto(b); });
  // 提示词：打开时按最新锚点重新生成
  b.off('click', '.sl_prompt_btn').on('click', '.sl_prompt_btn', function () {
    var cn2 = jQuery(this).data('char');
    var box = b.find('.sl_prompt_box[data-char="' + cn2 + '"]');
    if (box.is(':visible')) { box.hide(); return; }
    var people2 = collectArchivePeople(), p2 = null;
    for (var i2 = 0; i2 < people2.length; i2++) { if (people2[i2].key === cn2) { p2 = people2[i2]; break; } }
    var bm3 = getActiveMode() || 'zit';
    var atom2 = (p2 && p2.ent && p2.ent.atoms && p2.ent.atoms[bm3]) || '';
    box.find('.sl_prompt_ta').val(buildPortraitPrompt(atom2, bm3));
    box.show();
  });
  b.off('click', '.sl_copy_btn').on('click', '.sl_copy_btn', function () {
    var cn3 = jQuery(this).data('char');
    var ta = b.find('.sl_prompt_ta[data-char="' + cn3 + '"]');
    var txt = ta.val() || '';
    if (!txt) { toast('warning', '还没有提示词（先聊一轮建档）'); return; }
    var done = function () { toast('success', '提示词已复制'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { try { ta[0].select(); document.execCommand('copy'); done(); } catch (e) { toast('error', '复制失败，请手动选中'); } });
      } else { ta[0].select(); document.execCommand('copy'); done(); }
    } catch (e9) { toast('error', '复制失败，请手动选中'); }
  });
  b.off('click', '.sl_port_btn').on('click', '.sl_port_btn', function () { var cn = jQuery(this).data('char'), btn = jQuery(this), pf = getProfiles(), cast = pf && pf.root[pf.charName] && pf.root[pf.charName].cast; if (!cast || !cast[cn] || !cast[cn].static) { toast('error', '没有静态档案'); return; } var anchor = cast[cn].static; var bm=(pf&&pf.root[pf.charName]&&pf.root[pf.charName].meta&&pf.root[pf.charName].meta.modelMode)||settings.modelType; if(bm==='anime'&&cast[cn].enPrompt)anchor=cast[cn].enPrompt; else if(bm==='anime_tag'&&cast[cn].enTags)anchor=cast[cn].enTags; var bodyT = cast[cn].body || '', prompt = anchor + ((bm==='anime'||bm==='anime_tag')?'':(bodyT?', '+bodyT:'')) + ', standing, front view, full body, simple background, neutral expression'; if (bm === 'anime' || bm === 'anime_tag') prompt = cleanAnimePrompt(prompt); var wf = JSON.parse(settings.cWf || '{}'); if (!Object.keys(wf).length) { toast('error', '工作流未配置'); return; } btn.prop('disabled', true).text('排队中…'); enqueueTask('portrait_' + Date.now() + '_' + cn, prompt, function(result) { if (result && result.url) { cast[cn].portrait = result.url; saveSettings(); b.find('#sl_port_' + cn.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')).css({ backgroundImage: 'url(' + result.url + ')', backgroundSize: 'cover', backgroundPosition: 'top center', border: '1.5px solid ' + CAT.accent, color: 'transparent' }).html(''); toast('success', cn + ' 立绘生成完毕'); } btn.prop('disabled', false).text('生成立绘'); }, function() { toast('error', '立绘生成失败'); btn.prop('disabled', false).text('生成立绘'); }); });
  // ── 立绘：只用人物锚点，不带场景/其它人物（展示型全身立绘）──
  b.off('click', '.sl_port_btn').on('click', '.sl_port_btn', function () {
    var cn = jQuery(this).data('char'), btn = jQuery(this);
    var ent = null;
    try { var re2 = rosterEntries(); for (var i2 = 0; i2 < re2.length; i2++) { if (re2[i2] && re2[i2].key === cn) { ent = re2[i2]; break; } } } catch (e9) {}
    if (!ent) { toast('error', '找不到该人物档案'); return; }
    var bm = getActiveMode() || 'zit';
    // [v1.7.6 · 方案A] 立绘**只用补全后的原子锚点**(atoms)，**不退到 base** ——
    // base 是主模型原文，可能夹带衣着/缺维度，会让"对照图"不干净、比对失效
    var _atom = (ent.atoms && ent.atoms[bm]) || '';
    var anchor = _atom;
    if (!anchor) {
      toast('warning', '还没有【已解析锚点】—— 先正常聊一轮（出一次图）让插件按 38 维建档，之后立绘才是干净的对照图');
      return;
    }
    var wf2 = JSON.parse(settings.cWf || '{}');
    if (!Object.keys(wf2).length) { toast('error', '工作流未配置'); return; }
    var _runPortrait = function (anchorText) {
      var frame = (bm === 'zit') ? '，站立，正面，全身，简洁纯色背景，表情平静' : ', standing, front view, full body, simple background, neutral expression';
      var prompt = anchorText + frame;
      if (bm === 'anime' || bm === 'anime_tag') prompt = cleanAnimePrompt(prompt);
      btn.prop('disabled', true).text('排队中…');
      enqueueTask('portrait_' + Date.now() + '_' + cn, prompt, function (result) {
        if (result && result.url) {
          setPortraitUrl(ent, result.url);
          saveSettings();
          var safe = String(cn).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
          b.find('#sl_port_' + safe).css({ backgroundImage: 'url(' + result.url + ')', backgroundSize: 'cover', backgroundPosition: 'top center', border: '1.5px solid ' + CAT.accent, color: 'transparent' }).html('');
          toast('success', cn + ' 立绘生成完毕');
        }
        btn.prop('disabled', false).text('生成立绘');
      }, function () { toast('error', '立绘生成失败'); btn.prop('disabled', false).text('生成立绘'); });
    };
    _runPortrait(anchor);
  });
  b.off('click', '.sl_edit_btn').on('click', '.sl_edit_btn', function () { b.find('.sl_edit_box[data-char="' + jQuery(this).data('char') + '"]').toggle(); });
  b.off('click', '.sl_dyn_edit_btn').on('click', '.sl_dyn_edit_btn', function () { b.find('.sl_dyn_edit_box[data-char="' + jQuery(this).data('char') + '"]').toggle(); });
  b.off('click', '.sl_dyn_cancel_btn').on('click', '.sl_dyn_cancel_btn', function () { b.find('.sl_dyn_edit_box[data-char="' + jQuery(this).data('char') + '"]').hide(); });
  b.off('click', '.sl_dyn_save_btn').on('click', '.sl_dyn_save_btn', function () { var cn = jQuery(this).data('char'), nt = b.find('.sl_dyn_edit_ta[data-char="' + cn + '"]').val(), pf = getProfiles(); if (pf && pf.chat && pf.chat.dynamics) { pf.chat.dynamics[cn] = nt; saveSettings(); toast('success', cn + ' 动态已保存'); renderArchiveInto(b); } });
  b.off('click', '[id^=sl_port_]').on('click', '[id^=sl_port_]', function () { var bg = jQuery(this).css('background-image'); if (!bg || bg === 'none') return; var url = bg.slice(bg.indexOf('(')+1,bg.lastIndexOf(')')).replace(/["']/g,'');
        jQuery('<div style="position:fixed;z-index:30001;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;"><img src="' + url + '" style="max-width:90vw;max-height:90vh;border-radius:16px;box-shadow:0 4px 30px rgba(0,0,0,0.5);"></div>').appendTo('body').on('click', function () { jQuery(this).remove(); }); });
}
function cardTypeSelectHTML(selected) {
  var opts = [['具体角色卡', '剧情围绕固定角色'], ['世界观卡', '角色由聊天动态生成'], ['混合型卡', '有档案但不围绕展开']];
  var h = '<select id="sl_card_type" style="' + fi() + '">';
  for (var i = 0; i < opts.length; i++) h += '<option value="' + opts[i][0] + '"' + (opts[i][0] === selected ? ' selected' : '') + '>' + opts[i][1] + '</option>';
  return h + '</select>';
}
function scanModeSelectHTML(selected) {
  var opts = [['zit', 'ZIT（中文提示词）'], ['anima', 'Anima 混合（标签+自然语言）'], ['anime', 'Anime（纯英文描述）'], ['anime_tag', 'Anime Tag（纯英文标签）']];
  var h = '<select id="sl_scan_mode" style="' + fi() + '">';
  for (var i = 0; i < opts.length; i++) h += '<option value="' + opts[i][0] + '"' + (opts[i][0] === selected ? ' selected' : '') + '>' + opts[i][1] + '</option>';
  return h + '</select>';
}

// ═══════════ 子页：剧情库 ═══════════
export function renderStoryPage() {
  pushPage(function (body) {
    var h = '<div style="' + card() + '">' + cardHead('🧶', '剧情库', '每轮正文自动存档 · 标签 · 滚动总结') + '<div id="sl_story_body">翻找中…</div></div>';
    body.html(h); bindStoryEvents(body);
  }, '剧情库', { key: '剧情库' });
}
function storyCardInto() {
  return '<div style="' + card() + 'margin-top:12px;">' + cardHead('🧶', '剧情库', '每轮正文自动存档 · 标签 · 滚动总结') + '<div id="sl_story_body">翻找中…</div></div>';
}
function bindStoryEvents(b) {
  var bodyEl = b.find('#sl_story_body');
  if (!bodyEl.length) return;
  b.off('click', '#sl_story_refresh').on('click', '#sl_story_refresh', function () { renderStoryPanel(b); });
  b.off('click', '#sl_story_summarize').on('click', '#sl_story_summarize', async function () {
    var btn = jQuery(this); btn.prop('disabled', true).text('总结中…');
    try { var ok = await story.summarize(true); toast(ok ? 'success' : 'warning', ok ? '总结完成，早期条目已归档' : '增量不足，暂未总结'); }
    catch (e) { toast('error', '总结失败'); }
    renderStoryPanel(b); btn.prop('disabled', false).text('立即总结');
  });
  b.off('click', '#sl_story_clear').on('click', '#sl_story_clear', async function () {
    if (!confirm('确定清空当前聊天的剧情库？（聊天记录和图片不受影响）')) return;
    await story.clearStory(); toast('success', '剧情库已清空'); renderStoryPanel(b);
  });
  b.off('click', '.sl_story_toggle').on('click', '.sl_story_toggle', function () {
    var m = jQuery(this).data('mesid'); b.find('.sl_story_detail[data-mesid="' + m + '"]').toggle();
  });
  b.off('click', '.sl_story_del').on('click', '.sl_story_del', async function () {
    var m = jQuery(this).data('mesid'); await story.deleteEntry(m); renderStoryPanel(b);
  });
  b.off('click', '.sl_story_tag').on('click', '.sl_story_tag', function () {
    var tag = jQuery(this).data('tag');
    b.data('sl_story_filter', b.data('sl_story_filter') === tag ? '' : tag);
    renderStoryPanel(b);
  });
  renderStoryPanel(b);
}
async function renderStoryPanel(b) {
  var bodyEl = b.find('#sl_story_body');
  if (!bodyEl.length) return;
  var ov = await story.getOverview();
  var filter = b.data('sl_story_filter') || '';
  var h = '';
  h += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">';
  h += '<span style="font-size:10.5px;color:' + CAT.text + ';flex:1;">' + ov.count + ' 条 · ' + ov.slices + ' 片' + (ov.summary ? ' · 已总结至 ' + ov.summary.toRound + ' 轮' : '') + '</span>';
  h += '<button id="sl_story_summarize" style="' + btnSm() + 'font-size:10px;padding:6px 12px;">立即总结</button>';
  h += '<button id="sl_story_clear" style="' + btnDanger() + 'font-size:10px;padding:6px 12px;">清空</button>';
  h += '<button id="sl_story_refresh" style="' + btnGhost() + 'font-size:10px;padding:6px 10px;">↻</button>';
  h += '</div>';
  if (ov.summary && ov.summary.text) {
    h += '<div style="font-size:10.5px;color:' + CAT.sub + ';background:' + CAT.bg + ';border-radius:12px;padding:8px 10px;margin-bottom:8px;white-space:pre-wrap;line-height:1.7;">📜 ' + esc(ov.summary.text) + (ov.summary.text.length >= 200 ? '…' : '') + '</div>';
  }
  var tagKeys = Object.keys(ov.tags);
  if (tagKeys.length) {
    h += '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">';
    for (var i = 0; i < tagKeys.length; i++) {
      var tk = tagKeys[i], active = tk === filter;
      h += '<button class="sl_story_tag" data-tag="' + escAttr(tk) + '" style="font-size:9.5px;padding:3.5px 10px;border-radius:999px;cursor:pointer;border:1px solid ' + (active ? CAT.accent : CAT.line) + ';background:' + (active ? CAT.accent : 'transparent') + ';color:' + (active ? '#fff' : CAT.sub) + ';">' + esc(tk) + ' (' + ov.tags[tk] + ')</button>';
    }
    h += '</div>';
  }
  var list = filter ? ov.entries.filter(function (en) { return (en.tags || []).indexOf(filter) >= 0; }) : ov.entries;
  if (!list.length) {
    h += empty(ov.count ? '该标签下没有条目' : '剧情库空空如也，每轮正文会自动存进来', '🧶');
  } else {
    for (var j = 0; j < list.length; j++) {
      var en = list[j], mid = escAttr(en.mesid || '');
      h += '<div style="border:1px solid ' + CAT.line + ';border-radius:12px;padding:7px 10px;margin-bottom:5px;">';
      h += '<div style="display:flex;align-items:center;gap:6px;"><button class="sl_story_toggle" data-mesid="' + mid + '" style="flex:1;text-align:left;font-size:10.5px;color:' + CAT.text + ';background:none;border:none;cursor:pointer;padding:0;">[' + en.round + '] <span style="color:' + CAT.accent + ';">' + esc((en.tags || []).join(' ')) + '</span> ' + esc(String(en.body || '').slice(0, 40)) + '</button><button class="sl_story_del" data-mesid="' + mid + '" style="font-size:9px;border:none;background:none;color:' + CAT.red + ';cursor:pointer;">✕</button></div>';
      h += '<div class="sl_story_detail" data-mesid="' + mid + '" style="display:none;font-size:10px;color:' + CAT.sub + ';white-space:pre-wrap;margin-top:5px;border-top:1px dotted ' + CAT.line + ';padding-top:5px;line-height:1.6;">' + esc(en.body) + '</div>';
      h += '</div>';
    }
  }
  bodyEl.html(h);
}

// ═══════════ 子页：运行日志 ═══════════
export function renderLogPage() {
  pushPage(function (body) {
    var h = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span style="flex:1;font-size:11px;color:' + CAT.sub + ';">' + getLogCount() + ' 条运行记录</span><button id="sl_log_clear" style="' + btnDanger() + 'font-size:11px;padding:6px 13px;">清空</button></div>';
    h += '<div style="' + card() + ';padding:12px 14px;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:' + CAT.text + ';white-space:pre-wrap;line-height:1.7;max-height:56vh;overflow-y:auto;" id="sl_log_view">' + esc(slLogDump() || '暂无日志') + '</div>';
    body.html(h);
    body.find('#sl_log_clear').on('click', function () { slClearLogs(); toast('success', '日志已清空'); renderLogPage(); });
    var v = body.find('#sl_log_view')[0]; if (v) v.scrollTop = v.scrollHeight;
  }, '运行日志', { key: '运行日志' });
}

export function showLogViewer() { renderLogPage(); }
