// ── SillyImage Lab 视图 v2.7（SnowCat：主视图 Feed + 分层子页） ──
import { CAT, CAT_THEMES, TEXT_THEMES, applyTheme, THEME_ORDER, THEME_ICONS } from './theme.js';
import { card, groupTitle, cell, cardHead, lbl, chip, btnMain, btnGhost, btnSm, btnDanger, switchHTML, empty } from './primitives.js';
import { catSVG, catStatusText } from './cat.js';
import { toast, esc, escAttr, fi, chkProf } from './utils.js';
import { settings, saveSettings, getActiveMode } from '../settings.js';
import { slLogDump, getLogCount, slClearLogs, slLog } from '../log.js';
import { getProfiles, scanCharacterProfile, getCharacterName, deleteCharacterProfile, setCardType } from '../pipeline/profile.js';
import { startPolling, stopPolling, getScannerStatus } from '../scanner.js';
import { getQueueLength, enqueueTask } from '../queue.js';
import { cleanAnimePrompt } from '../text-utils.js';
import { openSubPanel } from './sub-panels.js';
import * as panel from './panel.js';
var pushPage = panel.pushPage;
import * as compact from './compact-bar.js';
import * as story from '../story.js';
import { refreshCoopCards } from '../sync-cards.js';
import { getPrompt, isPromptsLoaded } from '../../prompts/loader.js';

// ═══════════ 主视图（Feed） ═══════════
export function renderHomeTab() {
  var body = jQuery('#sl_panel_body'); if (!body.length) return;
  body.find('.sl-page').remove();
  var cn = getCharacterName() || '未选择角色', hp = chkProf(), ss = getScannerStatus(), ql = getQueueLength(),
    ha = !!(settings.auxUrl && settings.auxModel), hc = !!settings.cUrl, hw = !!(settings.cWf && settings.cWf.length > 50),
    isMain = settings.imgMode === 'main',
    allReady = ha && hc && hw && (isMain ? true : hp), h = '';
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
  h += '<div style="flex:1;min-width:0;"><div style="font-weight:800;font-size:16px;color:' + CAT.text + ';">' + esc(cn) + '</div><div style="font-size:11px;color:' + CAT.sub + ';margin-top:2px;">' + (isMain ? '🎬 导演模式 · 主模型指挥' : '🎨 画师模式 · 专属AI读文') + ' · ' + (settings.autoGen === 1 ? '自动出图' : '手动出图') + '</div></div>';
  h += '</div>';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">';
  h += '<span style="' + chip(CAT.bg, CAT.sub) + '">' + ((getActiveMode() === 'anime' || getActiveMode() === 'anime_tag') ? '🎬 Anime' : '🖼️ ZIT') + '</span>';
  h += '<span style="' + chip(hp ? CAT.green + '1F' : CAT.red + '1F', hp ? CAT.green : CAT.red) + '">' + (hp ? '📦 已扫描' : '🔍 未扫描') + '</span>';
  h += '<span style="' + chip(CAT.bg, CAT.sub) + '">🐟 队列 ' + ql + '</span>';
  h += '</div></div>';
  // 快捷操作（两大按钮）：画师/导演模式通用——扫描建档 + 一键补排。
  // [B1] 原 if/else 两分支完全一致（条件无意义），合并为单一分支防止"只改一半"。
  h += '<div style="display:flex;gap:8px;"><button id="sl_btn_scan_cast" style="flex:1;' + btnMain() + '">扫描角色卡</button><button id="sl_btn_gen_all" style="flex:1;' + btnGhost() + '">一键排图</button></div>';
  // 协作模式快捷切换（高频项浅放：一键切换 插件AI/酒馆AI）
  h += '<div style="' + card() + ';padding:8px;display:flex;gap:6px;">';
  h += '<button class="sl_mode_seg' + (isMain ? '' : ' active') + '" data-mode="plugin" style="flex:1;padding:9px 0;border:none;border-radius:12px;cursor:pointer;font-size:11.5px;font-weight:700;' + (isMain ? 'color:' + CAT.sub + ';background:transparent;' : 'color:#fff;background:' + CAT.accent + ';box-shadow:' + CAT.btnShadow + ';') + '">🎨 画师模式</button>';
  h += '<button class="sl_mode_seg' + (isMain ? ' active' : '') + '" data-mode="main" style="flex:1;padding:9px 0;border:none;border-radius:12px;cursor:pointer;font-size:11.5px;font-weight:700;' + (isMain ? 'color:#fff;background:' + CAT.accent + ';box-shadow:' + CAT.btnShadow + ';' : 'color:' + CAT.sub + ';background:transparent;') + '">🎬 导演模式</button>';
  h += '</div>';
  h += '<div style="font-size:10px;color:' + CAT.mute + ';text-align:center;margin:-4px 0 10px;">' + (isMain ? '主模型当导演：正文标记配图位置+画面要点，画师只补提示词；最省 token，需角色卡配置指令' : '专属 AI 画师：扫卡建档 → 每轮精读原文 → 写提示词；人物最还原，每轮多费一点 token') + '</div>';
  // 设置与工具（分组列表）
  h += groupTitle('角色与世界');
  h += '<div style="' + card() + ';padding:4px 8px;">';
  h += cell('🐾', '角色档案', hp ? '外观锚点已就绪' : '扫描角色卡建立外貌锚点', (hp ? '已扫描' : '未扫描'), 'data-nav="archive"');
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
  h += '<div style="text-align:center;padding:14px 0 6px;color:' + CAT.mute + ';font-size:10px;letter-spacing:1px;">小猫的生图插件 v1.1.1</div>';
  body.html(h);
  // 交互绑定
  body.off('click', '#sl_btn_scan_cast').on('click', '#sl_btn_scan_cast', async function () { var b = jQuery(this); b.prop('disabled', true).text('扫描中…'); try { var sr = await scanCharacterProfile(); if (sr) { toast('success', '扫描完成'); } else { toast('error', '扫描没成功'); } renderHomeTab(); compact.refreshCompactBar(); } catch (e) { toast('error', '扫描失败'); } b.prop('disabled', false).text('扫描角色卡'); });
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
  // 协作模式一键切换
  body.off('click', '.sl_mode_seg').on('click', '.sl_mode_seg', function () {
    var mode = jQuery(this).data('mode');
    if (!mode || mode === settings.imgMode) return;
    settings.imgMode = mode; saveSettings();
    try { refreshCoopCards(); } catch (e) {}
    renderHomeTab(); compact.refreshCompactBar();
    toast('success', mode === 'main' ? '已切换：🎬 导演模式（主模型指挥配图，省 token）' : '已切换：🎨 画师模式（专属AI读文写图，人物最还原）');
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
    h += '<div style="' + card() + '">' + cardHead('🖼️', '模型类型', '决定提示词语言') + '<select id="sl_model_type" style="' + f + '"><option value="zit"' + (settings.modelType === 'zit' ? ' selected' : '') + '>ZIT（中文提示词）</option><option value="anime"' + (settings.modelType === 'anime' ? ' selected' : '') + '>Anime（英文描述）</option><option value="anime_tag"' + (settings.modelType === 'anime_tag' ? ' selected' : '') + '>Anime Tag（英文标签）</option></select></div>';
    h += '<div style="' + card() + '">' + cardHead('🐟', '配图偏好', '这只猫什么时候画图') + '<select id="sl_image_mode" style="' + f + '"><option value="always"' + (settings.imageMode === 'always' ? ' selected' : '') + '>总是配图（每轮 ≥1 张）</option><option value="encourage"' + (settings.imageMode === 'encourage' ? ' selected' : '') + '>鼓励配图（该插就插）</option><option value="key"' + (settings.imageMode === 'key' ? ' selected' : '') + '>关键场景（宁缺毋滥）</option></select></div>';
    h += '<div style="' + card() + '">' + cardHead('🖼️', '图块尺寸', '图卡里图片的宽度（分辨率低建议调小）') + '<select id="sl_img_width" style="' + f + '"><option value="100%"' + ((settings.imgBlockWidth || '55%') === '100%' ? ' selected' : '') + '>大（100%）</option><option value="75%"' + ((settings.imgBlockWidth || '55%') === '75%' ? ' selected' : '') + '>中（75%）</option><option value="55%"' + ((settings.imgBlockWidth || '55%') === '55%' ? ' selected' : '') + '>小（55% · 默认）</option><option value="40%"' + ((settings.imgBlockWidth || '55%') === '40%' ? ' selected' : '') + '>迷你（40%）</option></select></div>';
    h += '<div style="' + card() + '">' + cardHead('🐾', '配图方式', '选一种配图流程') + '<select id="sl_img_mode" style="' + f + '"><option value="plugin"' + (settings.imgMode === 'plugin' ? ' selected' : '') + '>🎨 画师模式（默认）— 用专属 AI（额外 API）：扫描角色卡留存外貌档案 → 每轮精读原文 → 写提示词。人物最还原、最懂剧情，代价是每轮多一次 AI 调用</option><option value="main"' + (settings.imgMode === 'main' ? ' selected' : '') + '>🎬 导演模式 — 主模型在正文写 [img:] 标记图片位置+画面要点，画师只补提示词。最省 token（不用额外分析角色卡），需在角色卡粘贴指令</option></select><div style="font-size:10.5px;color:' + CAT.mute + ';margin:8px 0 10px;">🎬 导演模式需要：把「小猫指令」贴进角色卡/预设/世界书（👇 一键复制）；画师模式无需任何配置</div><div style="margin-bottom:10px;">' + switchHTML('sl_director_cast', settings.directorCastImport !== false, '导演模式：扫描档案作为人物基础档案', '默认开启（人物档案规则：扫描过→用插件档案做权威外貌 base，酒馆AI发来的只做衣着/状态等动态 live；没扫→全部用酒馆AI发来的）；关闭则扫描仅用于立绘/档案查看，人物表全是酒馆AI收集，更省 token') + '</div><button id="sl_copy_instr" style="width:100%;' + btnGhost() + 'color:' + CAT.accent + ';">复制 小猫指令</button></div>';
    h += '<div style="' + card() + '">' + cardHead('📝', '前置提示词', '拼到每张提示词最前') + '<input id="sl_prompt_prefix" type="text" value="' + escAttr(settings.promptPrefix || '') + '" style="' + f + '" placeholder="留空则不生效"></div>';
    h += '<div style="' + card() + ';padding:14px 16px;">' + switchHTML('sl_show_prompt', settings.showGenPrompt === true, '图块显示完整提示词', '默认关闭：图块只显示短标题（详细字段只进生成链，用户看不到）；调试时打开可看到每张图的完整生成提示词') + '</div>';
    h += '<div id="sl_anime_opts" style="' + card() + 'background:' + CAT.bg + ';' + (settings.modelType === 'anime' || settings.modelType === 'anime_tag' ? '' : 'display:none;') + '">' + cardHead('🎬', 'Anime 增强', '仅 Anime / Tag 模式生效') + '<span style="' + lbl() + '">质量前缀</span><input id="sl_anime_prefix" type="text" value="' + escAttr(settings.animeQualityPrefix || '') + '" style="' + f + 'margin-bottom:10px;"><span style="' + lbl() + '">艺术家标签</span><input id="sl_anime_artist" type="text" value="' + escAttr(settings.animeArtist || '') + '" style="' + f + '" placeholder="留空则不使用"></div>';
    h += '<div style="text-align:center;font-size:10px;color:' + CAT.mute + ';padding:6px 0 2px;">所有改动即时保存 · 无需手动保存</div>';
    body.html(h);
    bindSettingsEvents(body);
  }, '模型与偏好', { key: '模型与偏好' });
}
export function bindSettingsEvents(b) {
  b.off('change', '#sl_plugin_on').on('change', '#sl_plugin_on', function () { settings.pluginOn = jQuery(this).is(':checked'); saveSettings(); if (settings.pluginOn) { startPolling(); compact.setPluginEnabled(true); } else { stopPolling(); compact.setPluginEnabled(false); } });
  b.off('change', '#sl_model_type').on('change', '#sl_model_type', function () { settings.modelType = jQuery(this).val(); jQuery('#sl_anime_opts').toggle(settings.modelType === 'anime' || settings.modelType === 'anime_tag'); saveSettings(); });
  b.off('change', '#sl_image_mode').on('change', '#sl_image_mode', function () { settings.imageMode = jQuery(this).val(); saveSettings(); });
  b.off('change', '#sl_img_width').on('change', '#sl_img_width', function () { settings.imgBlockWidth = jQuery(this).val(); saveSettings(); });
  b.off('change', '#sl_img_mode').on('change', '#sl_img_mode', function () { settings.imgMode = jQuery(this).val(); saveSettings(); try { refreshCoopCards(); } catch (e) {} toast('success', settings.imgMode === 'main' ? '已切到：🎬 导演模式' : '已切到：🎨 画师模式'); });
  b.off('change', '#sl_director_cast').on('change', '#sl_director_cast', function () { settings.directorCastImport = jQuery(this).is(':checked'); saveSettings(); try { refreshCoopCards(); } catch (e) {} toast('success', settings.directorCastImport !== false ? '已开启：卡库档案导入人物表' : '已关闭：扫描仅用于立绘/档案，人物表只留占位符收集'); });
  b.off('click', '#sl_copy_instr').on('click', '#sl_copy_instr', function () { var t = isPromptsLoaded() ? (getPrompt('main-llm-instruction.txt') || '') : ''; if (!t) t = '[img:画面描述] 指令未加载，请刷新重试'; if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(function () { toast('success', '指令已复制，贴到角色卡/预设/世界书'); }, function () { toast('error', '复制失败'); }); } else { toast('error', '浏览器不支持剪贴板'); } });
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
function renderArchiveInto(body) {
  var pf = getProfiles();
  if (!pf || !pf.charName) { body.html(empty('还没进入聊天，去左边找你的猫猫角色', '🐱')); return; }
  var cast = pf.root[pf.charName].cast || {};
  var meta = pf.root[pf.charName].meta || {};
  var dynamics = pf.chat.dynamics || {};
  var npcs = pf.chat.npcs || {};
  var hasCast = Object.keys(cast).length > 0;
  var isWorld = meta.cardType === '世界观卡' || meta.cardType === '混合型卡';
  var h = '';
  if (!hasCast && !isWorld) {
    h = '<div style="' + card() + '">' + cardHead('🐾', '扫描角色卡', '建立外貌锚点，画出不变的猫猫') + '<div style="margin-bottom:10px;"><span style="' + lbl() + '">画风模式</span>' + scanModeSelectHTML(settings.modelType || 'zit') + '</div>';
    h += '<div style="margin-bottom:12px;"><span style="' + lbl() + '">卡类型</span>' + cardTypeSelectHTML(meta.cardType || '具体角色卡') + '</div>';
    h += '<button id="sl_btn_scan_cast3" style="width:100%;' + btnMain() + '">扫描角色卡</button></div>';
    h += userCardInto();
    h += storyCardInto();
    body.html(h); bindArchiveEvents(body); body.find('#sl_btn_scan_cast3').on('click', function(){ scanFromArchive(body); }); bindStoryEvents(body);
    return;
  }
  if (isWorld && !hasCast) {
    h = '<div style="' + card() + ';margin-bottom:10px;">' + cardHead('🌐', '世界设定卡', '角色由聊天动态生成');
    if (meta.coreChar) h += '<div style="font-size:10.5px;color:' + CAT.accent + ';margin-bottom:8px;">核心角色: ' + esc(meta.coreChar) + '</div>';
    h += '<div style="margin-bottom:10px;"><span style="' + lbl() + '">画风模式</span>' + scanModeSelectHTML(meta.modelMode || settings.modelType || 'zit') + '</div>';
    h += '<div style="margin-bottom:10px;"><span style="' + lbl() + '">卡类型</span>' + cardTypeSelectHTML(meta.cardType || '具体角色卡') + '</div>';
    h += '<div style="margin-bottom:12px;"><span style="' + lbl() + '">角色特化</span><input id="sl_specialization" type="text" value="' + escAttr(meta.specialization || '') + '" placeholder="如：雌小鬼、御姐…" style="' + fi() + '"></div>';
    h += '<button id="sl_btn_scan_cast3" style="width:100%;' + btnGhost() + 'color:' + CAT.accent + ';">重新扫描</button></div>';
    h += groupTitle('聊天里的猫猫们');
    if (Object.keys(npcs).length) {
      for (var n in npcs) { var npc = npcs[n]; h += '<div style="' + card() + 'padding:12px 14px;"><div style="font-weight:700;font-size:12px;color:' + CAT.text + ';">' + esc(n) + ' <span style="font-weight:400;font-size:10px;color:' + CAT.mute + ';">出现 ' + (npc.appearances || 1) + ' 次</span></div>'; if (npc.static) h += '<div style="font-size:10.5px;color:' + CAT.sub + ';white-space:pre-wrap;margin-top:4px;line-height:1.6;">' + esc(npc.static).substring(0, 150) + '</div>'; h += '</div>'; }
    } else { h += empty('聊天中出现的角色会自动出现在这里', '🐾'); }
    h += '<div style="margin-top:8px;"><button id="sl_btn_clear_cast" style="width:100%;' + btnDanger() + '">清除本卡档案</button></div>';
    h += userCardInto(); h += storyCardInto();
    body.html(h); bindArchiveEvents(body); bindStoryEvents(body);
    return;
  }
  // 具体角色卡
  h += '<div style="' + card() + ';padding:12px 14px;">';
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="' + lbl() + 'margin:0;">画风（锁定）</span><div style="flex:1;">' + scanModeSelectHTML(meta.modelMode || settings.modelType || 'zit') + '</div><button id="sl_btn_scan_cast3" style="' + btnSm() + 'font-size:10px;">重扫</button></div>';
  h += '<div style="display:flex;align-items:center;gap:8px;"><span style="' + lbl() + 'margin:0;">特化</span><input id="sl_specialization" type="text" value="' + escAttr(meta.specialization || '') + '" placeholder="如：雌小鬼、御姐…" style="flex:1;min-width:140px;' + fi() + '"></div></div>';
  h += '<div style="display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid ' + CAT.line + ';">';
  h += '<button class="sl_arch_st active" data-ast="0" style="padding:9px 18px;border:none;border-radius:12px 12px 0 0;cursor:pointer;font-size:11.5px;font-weight:700;background:' + CAT.accent + ';color:#fff;">静态档案</button>';
  h += '<button class="sl_arch_st" data-ast="1" style="padding:9px 18px;border:none;border-radius:12px 12px 0 0;cursor:pointer;font-size:11.5px;font-weight:600;background:transparent;color:' + CAT.sub + ';">动态档案</button></div>';
  h += '<div id="sl_arch_static">';
  for (var ck in cast) {
    if (ck === 'User') continue;
    var cv = cast[ck], anchor = cv.static || '', bodyT = cv.body || '', purl = cv.portrait || '';
    h += '<div style="' + card() + 'padding:12px 14px;">';
    h += '<div style="display:flex;gap:12px;align-items:flex-start;">';
    h += '<div id="sl_port_' + escAttr(ck).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_') + '" style="width:72px;height:96px;border-radius:12px;background:' + CAT.bg + ';display:flex;align-items:center;justify-content:center;border:1.5px dashed ' + CAT.line + ';font-size:9px;color:' + CAT.sub + ';text-align:center;flex-shrink:0;' + (purl ? 'background-image:url(' + purl + ');background-size:cover;background-position:top center;border:1.5px solid ' + CAT.accent + ';color:transparent;' : '') + '">' + (purl ? '' : '🐱\n立绘') + '</div>';
    h += '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:12.5px;color:' + CAT.text + ';margin-bottom:4px;">' + esc(ck) + '</div>';
    if (anchor) h += '<div style="font-size:10px;color:' + CAT.sub + ';margin-bottom:4px;line-height:1.6;">' + esc(anchor).substring(0, 120) + (anchor.length > 120 ? '…' : '') + '</div>';
    if (bodyT) h += '<div style="font-size:9.5px;color:' + CAT.mute + ';">身形: ' + esc(bodyT).substring(0, 60) + '</div>';
    h += '<div style="display:flex;gap:5px;margin-top:7px;"><button class="sl_port_btn" data-char="' + escAttr(ck) + '" style="' + btnSm() + 'font-size:10px;padding:6px 12px;">生成立绘</button></div>';
    h += '<div class="sl_edit_box" data-char="' + escAttr(ck) + '" style="display:none;margin-top:8px;"><textarea class="sl_edit_ta" data-char="' + escAttr(ck) + '" style="width:100%;min-height:60px;' + fi() + 'font-size:10.5px;resize:vertical;">' + esc(anchor) + '</textarea><div style="display:flex;gap:5px;margin-top:6px;"><button class="sl_save_btn" data-char="' + escAttr(ck) + '" style="' + btnSm() + 'font-size:10px;background:' + CAT.green + ';box-shadow:none;">保存</button><button class="sl_cancel_btn" data-char="' + escAttr(ck) + '" style="' + btnGhost() + 'font-size:10px;padding:6px 12px;">取消</button></div></div></div></div></div>';
  }
  h += '</div>';
  h += '<div id="sl_arch_dynamic" style="display:none;">';
  if (Object.keys(dynamics).length) {
    for (var dk in dynamics) { if (!dynamics[dk]) continue;
      h += '<div style="' + card() + 'padding:11px 14px;"><div style="font-weight:700;font-size:12px;color:' + CAT.text + ';">' + esc(dk) + '</div>';
      h += '<div style="font-size:10.5px;color:' + CAT.sub + ';white-space:pre-wrap;margin:5px 0 7px;line-height:1.6;">' + esc(dynamics[dk]) + '</div>';
      h += '<button class="sl_dyn_edit_btn" data-char="' + escAttr(dk) + '" style="' + btnSm() + 'font-size:10px;padding:6px 12px;background:' + CAT.sub + ';box-shadow:none;">编辑</button>';
      h += '<div class="sl_dyn_edit_box" data-char="' + escAttr(dk) + '" style="display:none;margin-top:7px;"><textarea class="sl_dyn_edit_ta" data-char="' + escAttr(dk) + '" style="width:100%;min-height:50px;' + fi() + 'font-size:10.5px;resize:vertical;">' + esc(dynamics[dk]) + '</textarea><div style="display:flex;gap:5px;margin-top:6px;"><button class="sl_dyn_save_btn" data-char="' + escAttr(dk) + '" style="' + btnSm() + 'font-size:10px;background:' + CAT.green + ';box-shadow:none;">保存</button><button class="sl_dyn_cancel_btn" data-char="' + escAttr(dk) + '" style="' + btnGhost() + 'font-size:10px;padding:6px 12px;">取消</button></div></div></div>';
    }
  } else { h += empty('还没聊过天，动态档案会逐步积累', '💬'); }
  h += '</div>';
  h += '<div style="margin-top:8px;"><button id="sl_btn_clear_cast" style="width:100%;' + btnDanger() + '">清除本卡档案</button></div>';
  h += userCardInto(); h += storyCardInto();
  body.html(h); bindArchiveEvents(body); bindStoryEvents(body);
}
function scanFromArchive(body) {
  var btn = body.find('#sl_btn_scan_cast3'); btn.prop('disabled', true).text('扫描中…');
  (async function(){ try { var scanMode = body.find('#sl_scan_mode').val() || 'zit';
    // [Fix] 卡类型选择器只存在于扫描页/世界观卡页；具体角色卡页（含混合型卡+有档案）没有该元素，
    // 原实现取到 undefined 一律按'具体角色卡' setCardType，会把混合型卡/世界观卡静默降级（重扫即丢失）。
    // 改为：有选择器读选择器，没有则沿用当前 meta.cardType。
    var cardTypeEl = body.find('#sl_card_type');
    var cardType = cardTypeEl.length ? cardTypeEl.val() : (function(){ try { var pf = getProfiles(); return (pf && pf.root[pf.charName] && pf.root[pf.charName].meta && pf.root[pf.charName].meta.cardType) || '具体角色卡'; } catch (e5) { return '具体角色卡'; } })();
    try { setCardType(getCharacterName(), cardType); } catch (e2) {} await scanCharacterProfile(scanMode); toast('success', '扫描完成，已锁定'); renderArchiveInto(body); compact.refreshCompactBar(); } catch (e) { toast('error', '扫描失败'); } })();
}
function userCardInto() {
  var pf = getProfiles();
  var up = (pf && pf.root[pf.charName] && pf.root[pf.charName].userProfile) || '';
  var h = '<div style="' + card() + 'margin-top:12px;">' + cardHead('👤', 'User 设定', '你在画里的样子');
  if (up) h += '<div style="font-size:10.5px;color:' + CAT.sub + ';margin-bottom:8px;white-space:pre-wrap;line-height:1.6;">' + esc(up).substring(0, 200) + '</div>';
  h += '<input id="sl_user_name" type="text" value="' + escAttr(settings.userName || '') + '" style="' + fi() + 'margin-bottom:8px;" placeholder="你的名字">';
  h += '<input id="sl_user_desc" type="text" value="' + escAttr(settings.userDesc || '') + '" style="' + fi() + '" placeholder="外貌描述"></div>';
  return h;
}
export function bindArchiveEvents(b) {
  b.off('click', '#sl_btn_clear_cast').on('click', '#sl_btn_clear_cast', function(){if(!confirm('确定清除当前角色卡档案？聊天记录不受影响'))return;deleteCharacterProfile(false);toast('warning','档案已清除，需要重新扫描');renderArchiveInto(b);compact.refreshCompactBar();});
  b.off('click', '#sl_btn_scan_cast3').on('click', '#sl_btn_scan_cast3', function () { scanFromArchive(b); });
  b.off('change input', '#sl_user_name,#sl_user_desc').on('change input', '#sl_user_name,#sl_user_desc', function () { settings.userName = b.find('#sl_user_name').val(); settings.userDesc = b.find('#sl_user_desc').val(); saveSettings(); });
  b.off('change input', '#sl_specialization').on('change input', '#sl_specialization', function () { var pf = getProfiles(); if (pf && pf.root[pf.charName] && pf.root[pf.charName].meta) { pf.root[pf.charName].meta.specialization = jQuery(this).val(); saveSettings(); } });
  b.off('click', '.sl_arch_st').on('click', '.sl_arch_st', function () { var st = parseInt(jQuery(this).data('ast')); b.find('.sl_arch_st').css({ background: 'transparent', color: CAT.sub, fontWeight: '600' }); jQuery(this).css({ background: CAT.accent, color: '#fff', fontWeight: '700' }); b.find('#sl_arch_static').toggle(st === 0); b.find('#sl_arch_dynamic').toggle(st === 1); });
  b.off('click', '.sl_cancel_btn').on('click', '.sl_cancel_btn', function () { b.find('.sl_edit_box[data-char="' + jQuery(this).data('char') + '"]').hide(); });
  b.off('click', '.sl_save_btn').on('click', '.sl_save_btn', function () { var cn = jQuery(this).data('char'), nt = b.find('.sl_edit_ta[data-char="' + cn + '"]').val(), pf = getProfiles(); if (pf && pf.root[pf.charName] && pf.root[pf.charName].cast && pf.root[pf.charName].cast[cn]) { pf.root[pf.charName].cast[cn].static = nt; pf.root[pf.charName].cast[cn].anchor = nt.slice(0, 80); saveSettings(); toast('success', cn + ' 已保存'); renderArchiveInto(b); } });
  b.off('click', '.sl_port_btn').on('click', '.sl_port_btn', function () { var cn = jQuery(this).data('char'), btn = jQuery(this), pf = getProfiles(), cast = pf && pf.root[pf.charName] && pf.root[pf.charName].cast; if (!cast || !cast[cn] || !cast[cn].static) { toast('error', '没有静态档案'); return; } var anchor = cast[cn].static; var bm=(pf&&pf.root[pf.charName]&&pf.root[pf.charName].meta&&pf.root[pf.charName].meta.modelMode)||settings.modelType; if(bm==='anime'&&cast[cn].enPrompt)anchor=cast[cn].enPrompt; else if(bm==='anime_tag'&&cast[cn].enTags)anchor=cast[cn].enTags; var bodyT = cast[cn].body || '', prompt = anchor + ((bm==='anime'||bm==='anime_tag')?'':(bodyT?', '+bodyT:'')) + ', standing, front view, full body, simple background, neutral expression'; if (bm === 'anime' || bm === 'anime_tag') prompt = cleanAnimePrompt(prompt); var wf = JSON.parse(settings.cWf || '{}'); if (!Object.keys(wf).length) { toast('error', '工作流未配置'); return; } btn.prop('disabled', true).text('排队中…'); enqueueTask('portrait_' + Date.now() + '_' + cn, prompt, function(result) { if (result && result.url) { cast[cn].portrait = result.url; saveSettings(); b.find('#sl_port_' + cn.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')).css({ backgroundImage: 'url(' + result.url + ')', backgroundSize: 'cover', backgroundPosition: 'top center', border: '1.5px solid ' + CAT.accent, color: 'transparent' }).html(''); toast('success', cn + ' 立绘生成完毕'); } btn.prop('disabled', false).text('生成立绘'); }, function() { toast('error', '立绘生成失败'); btn.prop('disabled', false).text('生成立绘'); }); });
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
  var opts = [['zit', 'ZIT（中文提示词）'], ['anime', 'Anime（英文描述）'], ['anime_tag', 'Anime Tag（英文标签）']];
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
