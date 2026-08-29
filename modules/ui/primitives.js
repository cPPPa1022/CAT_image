// ── SillyImage Lab v2.7 设计积木（SnowCat 极简版） ──
import { CAT, sbtn, esc } from './theme.js';

// 极简卡：白底/16px 圆角/无边框/极浅影/大留白
export function card(extra) {
  return 'background:' + CAT.card + ';border-radius:16px;box-shadow:0 1px 3px rgba(20,20,24,0.05),0 8px 24px rgba(20,20,24,0.04);padding:16px;margin-bottom:12px;box-sizing:border-box;' + (extra || '');
}

// 分组标题（列表顶部小字）
export function groupTitle(text) {
  return '<div style="font-size:10.5px;font-weight:800;letter-spacing:1.2px;color:' + CAT.mute + ';margin:14px 4px 6px;text-transform:uppercase;">' + esc(text) + '</div>';
}

// 分组行（cell）：图标圆底 + 标题 + 副标题/值 + chevron
export function cell(icon, title, sub, value, extra) {
  var h = '<div class="sl-cell" style="display:flex;align-items:center;gap:11px;padding:11px 8px;border-radius:12px;cursor:pointer;"' + (extra ? ' ' + extra : '') + '>';
  h += '<span style="width:32px;height:32px;border-radius:10px;background:' + CAT.bg + ';display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">' + icon + '</span>';
  h += '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;color:' + CAT.text + ';">' + esc(title) + '</div>';
  if (sub) h += '<div style="font-size:10.5px;color:' + CAT.sub + ';margin-top:1px;">' + esc(sub) + '</div>';
  h += '</div>';
  if (value) h += '<span style="font-size:11px;color:' + CAT.sub + ';flex-shrink:0;">' + value + '</span>';
  h += '<span style="color:' + CAT.mute + ';font-size:13px;flex-shrink:0;">›</span></div>';
  return h;
}

// 兼容旧名
export var cardHead = function (icon, title, hint) {
  var h = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><span style="width:32px;height:32px;border-radius:10px;background:' + CAT.bg + ';display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">' + icon + '</span><div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:13.5px;color:' + CAT.text + ';">' + esc(title) + '</div>';
  if (hint) h += '<div style="font-size:10.5px;color:' + CAT.mute + ';margin-top:1px;">' + esc(hint) + '</div>';
  return h + '</div></div>';
};
export var secTitle = cardHead;

export function lbl() {
  return 'display:block;font-size:10.5px;color:' + CAT.sub + ';letter-spacing:0.3px;margin-bottom:6px;font-weight:600;';
}

export function chip(bg, color, extra) {
  return 'display:inline-flex;align-items:center;gap:4px;font-size:10px;line-height:1;padding:4.5px 9px;border-radius:999px;background:' + (bg || CAT.bg) + ';color:' + (color || CAT.sub) + ';white-space:nowrap;' + (extra || '');
}

export function btnMain(extra) {
  return 'display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:' + CAT.btnPadding + ';border:none;border-radius:' + CAT.borderRadiusBtn + ';background:' + CAT.accent + ';color:#fff;cursor:pointer;font-size:12.5px;font-weight:700;box-shadow:' + CAT.btnShadow + ';transition:all 0.18s ease;' + (extra || '');
}
export function btnGhost(extra) {
  return 'display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:' + CAT.btnPadding + ';border:1px solid ' + CAT.line + ';border-radius:' + CAT.borderRadiusBtn + ';background:' + CAT.card + ';color:' + CAT.text + ';cursor:pointer;font-size:12.5px;font-weight:600;transition:all 0.18s ease;' + (extra || '');
}
export function btnSm(extra) {
  return 'display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:8px 14px;border:none;border-radius:' + CAT.borderRadiusBtn + ';background:' + CAT.accent + ';color:#fff;cursor:pointer;font-size:11.5px;font-weight:700;box-shadow:' + CAT.btnShadow + ';transition:all 0.18s ease;' + (extra || '');
}
export function btnDanger(extra) {
  return 'display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:8px 14px;border:none;border-radius:' + CAT.borderRadiusBtn + ';background:' + CAT.red + ';color:#fff;cursor:pointer;font-size:11.5px;font-weight:700;transition:all 0.18s ease;' + (extra || '');
}

// 开关
export function switchHTML(id, checked, label, hint) {
  var h = '<label style="display:flex;align-items:center;gap:12px;cursor:pointer;padding:4px 0;"><span style="position:relative;display:inline-block;width:42px;height:25px;flex-shrink:0;"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + ' style="opacity:0;width:0;height:0;position:absolute;"><span style="position:absolute;inset:0;border-radius:999px;background:' + (checked ? CAT.accent : CAT.line) + ';transition:all .2s ease;"></span><span style="position:absolute;top:3px;left:' + (checked ? '19px' : '3px') + ';width:19px;height:19px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.2);transition:all .2s ease;"></span></span><span style="flex:1;"><span style="display:block;font-size:13px;font-weight:600;color:' + CAT.text + ';">' + esc(label) + '</span>';
  if (hint) h += '<span style="display:block;font-size:10.5px;color:' + CAT.mute + ';margin-top:1px;">' + esc(hint) + '</span>';
  return h + '</span></label>';
}

// 空态（大猫）
export function empty(msg, icon) {
  return '<div style="text-align:center;padding:36px 16px;color:' + CAT.sub + ';font-size:12px;line-height:1.9;">' + (icon ? '<div style="font-size:44px;margin-bottom:10px;line-height:1;">' + icon + '</div>' : '') + esc(msg) + '</div>';
}
