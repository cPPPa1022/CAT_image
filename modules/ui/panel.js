// ── SillyImage Lab 主面板 v2.7（雪白猫：右侧抽屉 + 分层导航 + 动画） ──
import { slLog } from '../log.js';
import { CAT, applyTheme, injectThemeStyle, THEME_ORDER } from './theme.js';
import { catSVG } from './cat.js';
import { settings, saveSettings } from '../settings.js';
import * as tabs from './tabs.js';
import * as compact from './compact-bar.js';

var _panelEl = null, _maskEl = null, _expandedVisible = false, _pageStack = [], _openGuard = 0;

export function getPanelEl() { return _panelEl; }
// 打开抽屉（渲染主视图 + 清栈）
export function showPanel() {
  if (!_panelEl) createExpandedPanel();
  _expandedVisible = true;
  _openGuard = Date.now();
  applyTheme(settings.uiTheme || '雪白猫');
  _pageStack = [];
  _panelEl.css('display', 'flex');
  _panelEl.addClass('sl-drawer-in');
  if (_maskEl) _maskEl.show().addClass('sl-mask-in');
  var _ce2 = compact.getCompactEl(); if (_ce2) _ce2.hide();
  tabs.renderHomeTab();
}
export function hidePanel() {
  _expandedVisible = false;
  if (_panelEl) { _panelEl.removeClass('sl-drawer-in').addClass('sl-drawer-out'); setTimeout(function () { _panelEl.removeClass('sl-drawer-out'); _panelEl.hide(); }, 260); }
  if (_maskEl) { _maskEl.removeClass('sl-mask-in').hide(); }
  var _ce = compact.getCompactEl(); if (_ce) _ce.show();
  compact.refreshCompactBar();
}
export function togglePanel() { _expandedVisible ? hidePanel() : showPanel(); }

export function createExpandedPanel() {
  if (_panelEl) return;
  var isM = window.innerWidth < 640;
  // 遮罩
  _maskEl = jQuery('<div id="sl_mask" style="position:fixed;z-index:9990;top:0;left:0;width:100%;height:100%;background:rgba(20,20,24,0.32);backdrop-filter:blur(3px);display:none;"></div>').appendTo('body');
  _maskEl.on('click', function () {
    // [Fix v1.1.1] 手机端点击穿透：打开面板的这次触控（含幽灵点击）会落在刚显示的遮罩上 → 面板刚开即关。
    // 打开后 350ms 内的遮罩点击一律忽略（覆盖“双击放大”判定窗口）。
    if (Date.now() - _openGuard < 350) return;
    hidePanel();
  });
  // 右侧抽屉（贴边，左缘大圆角）
  var ps = 'position:fixed;z-index:10000;top:0;bottom:0;right:0;width:' + (isM ? '100vw' : '400px') + ';background:var(--sl-bg);border-radius:' + (isM ? '0' : '24px 0 0 24px') + ';box-shadow:-24px 0 64px rgba(20,20,24,0.22);font-family:' + CAT.font + ';color:' + CAT.text + ';display:none;flex-direction:column;overflow:hidden;max-width:100vw;';
  var h = '<div id="sl_panel" style="' + ps + '">';
  // 品牌行（几何猫头 呼吸动画 + 状态点）
  h += '<div id="sl_panel_header" style="display:flex;align-items:center;gap:10px;padding:14px 18px;padding:calc(14px + env(safe-area-inset-top)) 18px;flex-shrink:0;">';
  h += '<span id="sl_panel_cat" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;color:' + CAT.accent + ';">' + catSVG('healthy', 30) + '</span>';
  h += '<div style="flex:1;min-width:0;"><div style="font-weight:800;font-size:15px;letter-spacing:0.3px;color:' + CAT.text + ';">偷懒小猫</div><div style="font-size:10px;color:' + CAT.sub + ';margin-top:1px;">小猫的生图插件 ' + ((typeof window !== 'undefined' && window.SILLYLAB_VERSION) ? window.SILLYLAB_VERSION : '') + '</div></div>';
  h += '<span id="sl_head_status" style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:' + CAT.sub + ';padding:4px 9px;border-radius:999px;background:' + CAT.bg + ';"><span style="width:7px;height:7px;border-radius:50%;background:' + CAT.green + ';box-shadow:0 0 0 3px ' + CAT.green + '22;"></span><span id="sl_head_status_txt">空闲</span></span>';
  h += '<button id="sl_close_panel" style="border:none;background:none;cursor:pointer;font-size:15px;color:' + CAT.sub + ';padding:6px 8px;border-radius:10px;">✕</button>';
  h += '</div>';
  h += '<div id="sl_panel_body" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 18px 20px;padding:4px 18px calc(20px + env(safe-area-inset-bottom));min-height:0;position:relative;"></div></div>';
  _panelEl = jQuery(h).appendTo('body');
  jQuery('#sl_close_panel').on('click', function () { hidePanel(); });
}

// ── 分层导航：push / pop 子页（带滑动动画） ──
export function pushPage(renderFn, title, opts) {
  opts = opts || {};
  var key = opts.key || title || '';
  var body = jQuery('#sl_panel_body');
  if (!body.length) return;
  // 同 key 页面已打开 → 刷新而非叠加（主题切换等场景）
  if (key) {
    var topNow = _pageStack.length ? _pageStack[_pageStack.length - 1] : null;
    if (topNow && topNow.key === key) {
      try { renderFn(topNow.el.find('.sl_page_body')); } catch (e) { slLog('子页刷新异常: ' + e.message); }
      topNow.renderFn = renderFn;
      return;
    }
  }
  var pg = jQuery('<div class="sl-page" style="position:absolute;inset:0;background:' + CAT.bg + ';z-index:20;overflow-y:auto;padding-bottom:20px;display:flex;flex-direction:column;"></div>');
  var head = '<div style="position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;padding:10px 2px 12px;background:' + CAT.bg + ';">';
  head += '<button class="sl_page_back" style="border:none;background:none;cursor:pointer;font-size:13px;color:' + CAT.accent + ';font-weight:700;padding:6px 10px 6px 2px;border-radius:10px;">← 返回</button>';
  head += '<span style="font-weight:800;font-size:14px;color:' + CAT.text + ';">' + (title || '') + '</span>';
  if (opts.right) head += '<span style="flex:1;"></span>' + opts.right;
  head += '</div><div class="sl_page_body" style="padding:0 2px;"></div>';
  pg.html(head).appendTo(body);
  // 动画：旧页轻微后退，新页右侧推入
  body.find('.sl-page').not(pg).css('transform', 'translateX(-24px)').css('opacity', '0.35');
  pg.css('transform', 'translateX(36px)').css('opacity', '0');
  requestAnimationFrame(function () { pg.css('transition', 'transform .26s cubic-bezier(.32,.72,.28,1), opacity .26s ease').css('transform', 'translateX(0)').css('opacity', '1'); });
  // [BugFix v3.1] 返回按钮改为 body 级事件委托：一次绑定永久有效（页面刷新/重建不再失效）
  body.off('click', '.sl_page_back').on('click', '.sl_page_back', function () { popPage(); });
  _pageStack.push({ el: pg, renderFn: renderFn, key: key });
  try { renderFn(pg.find('.sl_page_body')); } catch (e) { slLog('子页渲染异常: ' + e.message); }
}
export function popPage() {
  var body = jQuery('#sl_panel_body');
  if (!_pageStack.length || !body.length) return;
  var top = _pageStack.pop();
  top.el.css('transition', 'transform .2s ease, opacity .2s ease').css('transform', 'translateX(44px)').css('opacity', '0');
  setTimeout(function () { if (top.el && top.el.length) top.el.remove(); }, 220);
  var prev = _pageStack.length ? _pageStack[_pageStack.length - 1].el : null;
  if (prev) { prev.css('transition', 'transform .2s ease, opacity .2s ease').css('transform', 'translateX(0)').css('opacity', '1').css('pointer-events', 'auto'); }
}
// 供紧凑条刷新头部状态点
export function setHeadStatus(text, color) {
  try {
    jQuery('#sl_head_status_txt').text(text);
    jQuery('#sl_head_status').css('color', color || CAT.sub);
    jQuery('#sl_head_status').find('span:first').css('background', color || CAT.green).css('box-shadow', '0 0 0 3px ' + (color || CAT.green) + '22');
  } catch (e) {}
}

// ── 全局样式（极简 + 猫动画） ──
export function buildUI(extSettings) {
  slLog('=^_^= SnowCat UI v2.7 start');
  var knownThemes = THEME_ORDER;
  if (settings.uiTheme && knownThemes.indexOf(settings.uiTheme) === -1) { settings.uiTheme = '雪白猫'; try { saveSettings(); } catch (e) {} }
  applyTheme(settings.uiTheme || '雪白猫');
  if (!document.getElementById('sl_global_style')) {
    var s = document.createElement('style'); s.id = 'sl_global_style';
    var css = [];
    css.push('@keyframes slCatBlink{0%,90%,100%{transform:scaleY(1)}93%{transform:scaleY(0.1)}}');
    css.push('@keyframes slCatZzz{0%{opacity:0;transform:translate(0,2px) scale(.8)}30%{opacity:.9}100%{opacity:0;transform:translate(9px,-12px) scale(1.2)}}');
    css.push('@keyframes slCatPaw{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}');
    css.push('@keyframes slCatTail{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(12deg)}}');
    css.push('@keyframes slCatBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}');
    css.push('@keyframes slFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}');
    css.push('.sl-cat-anim .sl-cat-paw{transform-origin:center;animation:slCatPaw 0.9s ease-in-out infinite}');
    css.push('.sl-cat-anim .sl-cat-tail{transform-origin:14px 46px;animation:slCatTail 1.2s ease-in-out infinite}');
    css.push('.sl-cat-anim .sl-cat-zzz{animation:slCatZzz 2.2s ease-in-out infinite}');
    css.push('.sl-cat-anim.sl-cat-healthy .sl-cat-eyes,.sl-cat-anim.sl-cat-idle .sl-cat-eyes{animation:slCatBlink 4s ease-in-out infinite;transform-origin:50% 60%}');
    css.push('#sl_panel_cat svg{animation:slCatBreath 3.2s ease-in-out infinite}');
    css.push('#sl_panel_body>*{animation:slFadeUp .24s ease both}');
    css.push('#sl_panel{transition:none}');
    css.push('#sl_panel .sl-cell{transition:background .15s ease}');
    css.push('#sl_panel .sl-cell:hover{background:var(--sl-bg)}');
    css.push('#sl_panel .sl-cell:active{opacity:0.7}');
    css.push('#sl_panel button,#sl_compact button,#sl_compact,#sl_panel{-webkit-tap-highlight-color:transparent!important}');
    css.push('#sl_panel button,#sl_compact button,#sl_compact{touch-action:manipulation}');
    css.push('#sl_panel{-webkit-overflow-scrolling:touch}');
    css.push('#sl_panel input,#sl_panel select,#sl_panel textarea{border-radius:12px!important;border:1px solid var(--sl-line)!important;background:var(--sl-card)!important;color:var(--sl-text)!important;font-size:12.5px}');
    css.push('#sl_panel input:focus,#sl_panel select:focus,#sl_panel textarea:focus{border-color:var(--sl-accent)!important;box-shadow:0 0 0 3px rgba(255,159,10,0.12)!important;outline:none!important}');
    css.push('#sl_panel select{appearance:none;-webkit-appearance:none;padding-right:30px!important;cursor:pointer;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27%3E%3Cpath d=%27M1 1l4 4 4-4%27 stroke=%27%2398989f%27 stroke-width=%271.8%27 fill=%27none%27 stroke-linecap=%27round%27/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right 12px center!important}');
    css.push('#sl_panel_body::-webkit-scrollbar{width:6px}');
    css.push('#sl_panel_body::-webkit-scrollbar-thumb{background:var(--sl-line);border-radius:8px}');
    css.push('#sl_panel input[type=checkbox]{accent-color:var(--sl-accent)}');
    css.push('.sl-mask-in{animation:slFadeUp .2s ease both}');
    css.push('.sl-drawer-in{animation:slSlideIn .3s cubic-bezier(.32,.72,.28,1) both}');
    css.push('@keyframes slSlideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}');
    css.push('.sl-drawer-out{animation:slSlideOut .26s cubic-bezier(.55,.06,.68,.19) both}');
    css.push('@keyframes slSlideOut{from{transform:translateX(0)}to{transform:translateX(100%)}}');
    s.textContent = css.join(' ');
    document.head.appendChild(s);
  }
  compact.createCompactBar();
  createExpandedPanel();
  injectThemeStyle();
}
