// ── SillyImage Lab 紧凑状态条 v2.6（胶囊猫条） ──
import { CAT, getCatStatusFace } from './theme.js';
import { catSVG, catStatusText } from './cat.js';
import { setHeadStatus } from './panel.js';
import { toast, chkProf } from './utils.js';
import { settings, saveSettings } from '../settings.js';
import { getCharacterName, scanCharacterProfile } from '../pipeline/profile.js';
import { getScannerStatus } from '../scanner.js';
import { getQueueLength } from '../queue.js';
import * as panel from './panel.js';  // 循环依赖：仅函数体内引用，运行时安全

var _compactEl = null, _compactTimer = null, _compDragMoved = false;

export function getCompactEl() { return _compactEl; }

export function setPluginEnabled(enabled) {
    if (enabled) {
        if (_compactEl) _compactEl.show();
        if (!_compactTimer) { _compactTimer = setInterval(refreshCompactBar, 3000); }
    } else {
        if (_compactEl) _compactEl.hide();
        if (_compactTimer) { clearInterval(_compactTimer); _compactTimer = null; }
    }
}

export function rebuildCompactBar() {
    if (_compactEl) { clearInterval(_compactTimer); _compactEl.remove(); _compactEl = null; _compactTimer = null; }
    createCompactBar();
}
export function createCompactBar() {
  if (_compactEl && _compactEl.parent().length) return;
  var saved = { x: null, y: null };
  try { var s = localStorage.getItem('sl_compact_pos'); if (s) saved = JSON.parse(s); } catch (e) { }
  var x = saved.x || null, y = saved.y || null;
  var l = x != null ? x + 'px' : 'auto', t = y != null ? y + 'px' : 'auto', r = x != null ? 'auto' : '16px', b = y != null ? 'auto' : '16px';
  var W = 300, H = Math.round(W * 0.66);
  var bar = '';
  bar += '<div id="sl_compact" style="position:fixed;z-index:30000;bottom:' + b + ';right:' + r + ';left:' + l + ';top:' + t + ';width:' + W + 'px;height:' + H + 'px;background:' + CAT.card + ';border-radius:' + CAT.radius + ';box-shadow:0 14px 44px rgba(150,100,60,0.22);border:' + CAT.borderStyle + ' ' + CAT.line + ';font-family:' + CAT.font + ';font-size:12px;color:' + CAT.text + ';user-select:none;overflow:hidden;display:flex;flex-direction:column;">';
  // 头部：猫脸泡泡 + 文案 + 日志爪印
  bar += '<div id="sl_comp_header" style="display:flex;align-items:center;gap:9px;padding:10px 12px 8px;cursor:move;border-bottom:1px solid ' + CAT.line + ';flex-shrink:0;height:26%;background:linear-gradient(135deg,' + CAT.accent + '14,transparent);">';
  bar += '<span id="sl_cat_icon" style="width:34px;height:34px;border-radius:12px;background:' + CAT.bg + ';display:flex;align-items:center;justify-content:center;pointer-events:none;color:' + CAT.accent + ';"></span>';
  bar += '<span style="font-weight:800;font-size:13px;flex:1;pointer-events:none;letter-spacing:0.4px;color:' + CAT.text + ';">偷懒小猫</span>';
  bar += '<button id="sl_comp_panel_btn" style="border:none;background:none;cursor:pointer;font-size:14px;color:' + CAT.sub + ';padding:4px 7px;border-radius:9px;">🐾</button></div>';
  // 信息行：角色名 + 胶囊
  bar += '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:8px 12px 6px;flex-shrink:0;height:22%;">';
  bar += '<span id="sl_comp_char" style="font-size:13px;color:' + CAT.text + ';font-weight:700;">--</span>';
  bar += '<span id="sl_comp_model" style="' + 'font-size:9.5px;line-height:1;padding:3.5px 9px;border-radius:999px;background:' + CAT.accent + '1F;color:' + CAT.accent + ';"></span>';
  bar += '<span id="sl_comp_profile" style="font-size:9.5px;line-height:1;padding:3.5px 9px;border-radius:999px;"></span>';
  bar += '<button id="sl_comp_scan" style="display:none;font-size:9.5px;padding:3.5px 10px;border:none;border-radius:999px;background:' + CAT.accent + ';color:#fff;cursor:pointer;font-weight:700;">🐾 扫描</button></div>';
  // 状态行：状态点+状态+队列+模式
  bar += '<div style="padding:4px 12px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;height:26%;">';
  bar += '<div style="display:flex;align-items:center;gap:7px;font-size:11.5px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + CAT.green + ';box-shadow:0 0 0 3px ' + CAT.green + '22;"></span><span id="sl_comp_status" style="font-weight:700;color:' + CAT.text + ';">打盹中 zZ</span><span style="color:' + CAT.mute + ';">·</span><span id="sl_comp_queue_txt" style="color:' + CAT.sub + ';">🐟 排队 0</span><span style="color:' + CAT.mute + ';">·</span><span id="sl_comp_mode" style="color:' + CAT.sub + ';">⚡ 自动</span></div>';
  bar += '<div id="sl_comp_event" style="font-size:10px;color:' + CAT.mute + ';margin-top:3px;">🐾 小猫候命中…</div></div>';
  // 按钮区
  bar += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px 12px;flex-shrink:0;height:26%;"><button id="sl_comp_gen" style="flex:1.35;font-size:12px;padding:0;height:36px;border:none;border-radius:13px;background:linear-gradient(135deg,' + CAT.accent + ',' + (CAT.accentHover || CAT.accent) + ');color:#fff;cursor:pointer;font-weight:800;box-shadow:' + CAT.btnShadow + ';">🐟 排图</button><button id="sl_comp_auto" style="flex:1;font-size:12px;padding:0;height:36px;border:1px solid ' + CAT.line + ';border-radius:13px;background:' + CAT.card + ';color:' + CAT.text + ';cursor:pointer;font-weight:700;">⚡ 自动</button></div></div>';
  _compactEl = jQuery(bar).appendTo('body');
  (function () { var dragging = false, sx, sy, ox, oy; jQuery('#sl_comp_header').on('mousedown touchstart', function (e) { if (jQuery(e.target).is('button')) return; e.preventDefault(); dragging = true; _compDragMoved = false; var p = (e.touches || [e])[0]; sx = p.clientX; sy = p.clientY; var o = _compactEl.offset(); ox = o.left; oy = o.top; _compactEl.css({ right: 'auto', bottom: 'auto', left: ox + 'px', top: oy + 'px' }); }).on('dblclick', function(e) { e.preventDefault(); _compactEl.css({ left: 'auto', top: 'auto', right: '16px', bottom: '16px' }); try { localStorage.removeItem('sl_compact_pos'); } catch(e){} }); jQuery(document).on('mousemove touchmove', function (e) { if (!dragging) return; var p = (e.touches || [e])[0]; if (Math.abs(p.clientX - sx) > 2 || Math.abs(p.clientY - sy) > 2) _compDragMoved = true; var newLeft = ox + p.clientX - sx, newTop = oy + p.clientY - sy; var maxX = window.innerWidth - _compactEl.outerWidth(), maxY = window.innerHeight - _compactEl.outerHeight(); newLeft = Math.max(0, Math.min(newLeft, maxX)); newTop = Math.max(0, Math.min(newTop, maxY)); _compactEl.css({ left: newLeft + 'px', top: newTop + 'px' }); }).on('mouseup touchend', function () { if (!dragging) return; dragging = false; if (_compDragMoved) { var o = _compactEl.offset(); var maxX2 = window.innerWidth - _compactEl.outerWidth(), maxY2 = window.innerHeight - _compactEl.outerHeight(); var clX = Math.max(0, Math.min(o.left, maxX2)), clY = Math.max(0, Math.min(o.top, maxY2)); _compactEl.css({ left: clX + 'px', top: clY + 'px' }); try { localStorage.setItem('sl_compact_pos', JSON.stringify({ x: clX, y: clY })); } catch (e) { } } }); })();
  jQuery('#sl_comp_header').on('click', function (e) { var was = _compDragMoved; _compDragMoved = false; if (jQuery(e.target).is('button') || was) return; panel.togglePanel(); });
  jQuery('#sl_comp_panel_btn').on('click', function (e) { e.stopPropagation(); panel.togglePanel(); });
  jQuery('#sl_comp_gen').on('click', function (e) { e.stopPropagation(); triggerGenAll(); });
  jQuery('#sl_comp_auto').on('click', function (e) { e.stopPropagation(); settings.autoGen = settings.autoGen === 1 ? 0 : 1; saveSettings(); refreshCompactBar(); });
  jQuery('#sl_comp_scan').on('click', async function (e) { e.stopPropagation(); var b = jQuery(this); b.prop('disabled', true).text('扫描中...'); try { await scanCharacterProfile(); toast('success', '扫描完成喵~ ✨'); } catch (e2) { toast('error', '扫描失败喵…'); } b.prop('disabled', false).text('🐾 扫描'); refreshCompactBar(); });
  _compactTimer = setInterval(refreshCompactBar, 3000); refreshCompactBar();
}
export function refreshCompactBar() {
  if (!_compactEl || !_compactEl.is(':visible')) return;
  var cn = getCharacterName() || '', hasChat = !!cn;
  jQuery('#sl_comp_char').text(hasChat ? cn : '还没有选角色喵~');
  jQuery('#sl_comp_model').text(hasChat ? ((settings.modelType === 'anime' || settings.modelType === 'anime_tag') ? '🎬 ANIME' : '🖼️ ZIT') : '');
  var hp = chkProf();
  if (!hasChat) { jQuery('#sl_comp_profile').text('').hide(); jQuery('#sl_comp_scan').hide(); }
  else if (hp) { jQuery('#sl_comp_profile').text('📦 已扫描' + (function(){try{var p=JSON.parse(localStorage.sillab_settings);var cn=Object.keys(p.profiles||{})[0];var m=p.profiles[cn]&&p.profiles[cn].meta&&p.profiles[cn].meta.modelMode;return m?(' 🔒'+({zit:'ZIT',anime:'Anime',anime_tag:'Tag'}[m]||m)):'';}catch(e){return'';}})()).css({ background: CAT.green + '1F', color: CAT.green }).show(); jQuery('#sl_comp_scan').hide(); }
  else { jQuery('#sl_comp_profile').text('🔍 未扫描').css({ background: CAT.red + '1F', color: CAT.red }).show(); jQuery('#sl_comp_scan').show(); }
  var ss = getScannerStatus(), sm = { off: '猫尾收起', idle: '打盹中 zZ', waiting_body: '等故事来…', waiting_end: '猫爪码字中…', scanning: '思考小鱼干中…' };
  jQuery('#sl_comp_status').text(sm[ss] || ss);
  var dotColor = ss === 'scanning' ? CAT.yellow : (getQueueLength() > 0 ? CAT.accent : CAT.green);
  jQuery('#sl_comp_status').prev().css('background', dotColor).css('box-shadow', '0 0 0 3px ' + dotColor + '22');
  var ql = getQueueLength();
  jQuery('#sl_comp_queue_txt').text('🐟 排队 ' + ql);
  jQuery('#sl_comp_mode').text(settings.autoGen === 1 ? '⚡ 自动' : '🖐 手动');
  jQuery('#sl_comp_auto').text(settings.autoGen === 1 ? '⚡ 自动' : '🖐 手动');
  var cs = 'idle'; if (ss === 'scanning') cs = 'busy'; else if (ql > 0) cs = ql > 5 ? 'busy' : 'queuing';
  jQuery('#sl_cat_icon').html(catSVG(cs, 26));
  try { setHeadStatus(sm[ss] || ss, dotColor); } catch (e) {}
  var evText = '🐾 小猫候命中…';
  if (ss === 'scanning') evText = '🧠 脑内小剧场启动…';
  else if (ql > 0) evText = '🐟 小鱼干排队 ' + ql + ' 张';
  jQuery('#sl_comp_event').text(evText);
}
export function triggerGenAll() { var c = 0; jQuery('.sl_img_btn[data-prompt]').each(function () { var b = jQuery(this); if (b.text().indexOf('排队') < 0 && b.text().indexOf('🔄') < 0 && b.text().indexOf('生成图片') >= 0) { b.trigger('click'); c++; } }); if (c === 0) toast('info', '没有可生成的小鱼干喵~'); else toast('success', '已排队 ' + c + ' 张图片喵~ ✨'); }
