// ── SillyImage Lab 主题系统 v2.6（MochiCat：五只猫五种气质，全部贴合小猫主题） ──
import { slLog } from '../log.js';
import { settings, saveSettings } from '../settings.js';

// ⓪ 雪白猫（默认 v2.7）：Apple 式极简亮色 · 猫眼琥珀点缀
var SNOW = { bg: '#f5f5f7', card: '#ffffff', accent: '#ff9f0a', accentHover: '#ff8a00', text: '#1d1d1f', sub: '#6e6e73', mute: '#aeaeb2', line: '#e8e8ea', green: '#30d158', red: '#ff3b30', yellow: '#ffcc00', radius: '16px', borderRadiusBtn: '12px', borderRadiusInput: '10px', btnPadding: '9px 18px', inputPadding: '9px 12px', shadow: '0 1px 3px rgba(20,20,24,0.05),0 8px 24px rgba(20,20,24,0.05)', btnShadow: '0 4px 14px rgba(255,159,10,0.28)', borderStyle: '1px solid', font: '-apple-system,BlinkMacSystemFont,PingFang SC,Noto Sans SC,Microsoft YaHei,sans-serif', backdropFilter: 'none' };

// 主题导出顺序 = 外观页色卡顺序
export var CAT_THEMES = {
  '雪白猫': SNOW,
  '墨黑夜猫': { bg: '#111214', card: '#1d1e23', accent: '#ff9f0a', accentHover: '#ffb340', text: '#f2f2f4', sub: '#98989f', mute: '#5f6067', line: '#2a2b31', green: '#32d74b', red: '#ff453a', yellow: '#ffd60a', radius: '16px', borderRadiusBtn: '12px', borderRadiusInput: '10px', btnPadding: '9px 18px', inputPadding: '9px 12px', shadow: '0 1px 3px rgba(0,0,0,0.3),0 10px 28px rgba(0,0,0,0.35)', btnShadow: '0 4px 16px rgba(255,159,10,0.3)', borderStyle: '1px solid', font: '-apple-system,BlinkMacSystemFont,PingFang SC,Noto Sans SC,Microsoft YaHei,sans-serif', backdropFilter: 'none' },
  '奶油麻薯猫': { // 默认：奶油+蜜桃+可可 · 软糯
    bg: '#fff4ec', card: '#ffffff', accent: '#ffa06b', accentHover: '#ff8a4d', text: '#4a3426', sub: '#a98d7b', mute: '#d4c0ae', line: '#f6e7d9', green: '#63bd8d', red: '#ef7a7a', yellow: '#f0bd5e',
    radius: '20px', borderRadiusBtn: '14px', borderRadiusInput: '12px', btnPadding: '9px 18px', inputPadding: '9px 12px',
    shadow: '0 10px 30px rgba(200,140,90,0.13)', btnShadow: '0 6px 18px rgba(255,160,107,0.40)', borderStyle: '1px solid', font: 'PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif', backdropFilter: 'none'
  },
  '焦糖布丁猫': { // 暖焦糖+奶黄+深棕 · 复古温馨
    bg: '#fff2d9', card: '#fffdf7', accent: '#f59e3d', accentHover: '#e78f2b', text: '#5c3f20', sub: '#a88a5f', mute: '#d3bb92', line: '#f5e5c8', green: '#6fae6a', red: '#e56b6b', yellow: '#eab94f',
    radius: '18px', borderRadiusBtn: '13px', borderRadiusInput: '11px', btnPadding: '9px 18px', inputPadding: '9px 12px',
    shadow: '0 10px 28px rgba(180,130,60,0.14)', btnShadow: '0 6px 16px rgba(245,158,61,0.38)', borderStyle: '1px solid', font: 'PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif', backdropFilter: 'none'
  },
  '云朵棉花猫': { // 淡蓝紫+白+薰衣草 · 轻盈
    bg: '#eef1fd', card: 'rgba(255,255,255,0.86)', accent: '#7c8cf8', accentHover: '#96a3fb', text: '#33395c', sub: '#7f86ab', mute: '#b0b6d5', line: 'rgba(255,255,255,0.95)', green: '#57b58c', red: '#ea7373', yellow: '#f0ae54',
    radius: '20px', borderRadiusBtn: '14px', borderRadiusInput: '12px', btnPadding: '9px 18px', inputPadding: '9px 12px',
    shadow: '0 12px 36px rgba(100,110,200,0.13)', btnShadow: '0 6px 18px rgba(124,140,248,0.35)', borderStyle: '1px solid', font: 'PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif', backdropFilter: 'blur(14px)'
  },
  '抹茶拿铁猫': { // 抹茶绿+奶油 · 清新
    bg: '#f0f5e7', card: '#ffffff', accent: '#7fb069', accentHover: '#6da25a', text: '#33452c', sub: '#8a9b7e', mute: '#bfcbb4', line: '#e4edda', green: '#58a97c', red: '#e5777b', yellow: '#e8bc55',
    radius: '20px', borderRadiusBtn: '14px', borderRadiusInput: '12px', btnPadding: '9px 18px', inputPadding: '9px 12px',
    shadow: '0 10px 30px rgba(110,150,95,0.13)', btnShadow: '0 6px 18px rgba(127,176,105,0.38)', borderStyle: '1px solid', font: 'PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif', backdropFilter: 'none'
  },
  '星空夜猫': { // 深空蓝紫+星光 · 暗色
    bg: '#1e2230', card: 'rgba(40,46,66,0.92)', accent: '#8fa7ff', accentHover: '#a9bbff', text: '#e8ecff', sub: '#9aa4c8', mute: '#66708f', line: 'rgba(143,167,255,0.25)', green: '#6fd3a2', red: '#f08a8a', yellow: '#f2cf6b',
    radius: '20px', borderRadiusBtn: '14px', borderRadiusInput: '12px', btnPadding: '9px 18px', inputPadding: '9px 12px',
    shadow: '0 12px 36px rgba(0,0,0,0.4)', btnShadow: '0 6px 18px rgba(143,167,255,0.35)', borderStyle: '1px solid', font: 'PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif', backdropFilter: 'none'
  }
};

export var CAT = CAT_THEMES['雪白猫'];

export var TEXT_THEMES = { '默认': { font: 'inherit', lineHeight: '1.6', color: 'inherit', bg: 'transparent', fontSize: 'inherit' }, '暖纸阅读': { font: 'Noto Serif SC, SimSun, serif', lineHeight: '2.0', color: '#4a3728', bg: '#fef9f2', fontSize: '15px' }, '深夜模式': { font: 'inherit', lineHeight: '1.7', color: '#d0d0d0', bg: '#1a1a1e', fontSize: '14px' }, '紧凑模式': { font: 'Noto Sans SC, sans-serif', lineHeight: '1.4', color: '#1a1a1a', bg: 'transparent', fontSize: '13px' } };

export var THEME_ORDER = ['雪白猫', '墨黑夜猫', '奶油麻薯猫', '抹茶拿铁猫', '星空夜猫'];
export var THEME_ICONS = { '雪白猫': '🐱', '墨黑夜猫': '🐈‍⬛', '奶油麻薯猫': '🍮', '抹茶拿铁猫': '🍵', '星空夜猫': '🌙' };

export function applyTheme(n) {
  if (typeof CAT_THEMES === 'undefined') return;
  CAT = CAT_THEMES[n] || CAT_THEMES['奶油麻薯猫'];
  if (!CAT) CAT = CAT_THEMES['奶油麻薯猫'];
  var r = document.documentElement;
  r.style.setProperty('--sl-accent', CAT.accent);
  r.style.setProperty('--sl-accent-hover', CAT.accentHover || CAT.accent);
  r.style.setProperty('--sl-line', CAT.line);
  r.style.setProperty('--sl-card', CAT.card);
  r.style.setProperty('--sl-radius', CAT.radius);
  r.style.setProperty('--sl-border', CAT.borderStyle + ' ' + CAT.line);
  r.style.setProperty('--sl-shadow', CAT.shadow);
  r.style.setProperty('--sl-font', CAT.font);
  r.style.setProperty('--sl-bg', CAT.bg);
  r.style.setProperty('--sl-text', CAT.text);
  r.style.setProperty('--sl-sub', CAT.sub);
  r.style.setProperty('--sl-green', CAT.green);
  r.style.setProperty('--sl-accent-soft', CAT.accent + '26');
  if (CAT.backdropFilter && CAT.backdropFilter !== 'none') r.style.setProperty('--sl-backdrop', CAT.backdropFilter);
  else r.style.removeProperty('--sl-backdrop');
  syncThemeToDOM();
  try { injectThemeStyle(); } catch (e) {}   // v3.0 修复：切主题时刷新纹理/装饰样式
}

export function injectThemeStyle() {
  var id = 'sl_theme_overrides';
  var el = document.getElementById(id);
  if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
  var rules = '';
  var th = settings.uiTheme || '奶油麻薯猫';
  if (th === '雪白猫' || th === '墨黑夜猫') { rules = ''; } else if (th === '星空夜猫') {
    // 星空背景：星光点阵
    rules += '#sl_panel_body{background-image:radial-gradient(1px 1px at 20% 30%,rgba(255,255,255,0.5) 0,transparent 100%),radial-gradient(1px 1px at 70% 15%,rgba(255,255,255,0.4) 0,transparent 100%),radial-gradient(1.5px 1.5px at 85% 60%,rgba(143,167,255,0.5) 0,transparent 100%),radial-gradient(1px 1px at 40% 80%,rgba(255,255,255,0.35) 0,transparent 100%)}'
    + '#sl_panel_header{background:linear-gradient(120deg,rgba(143,167,255,0.12),rgba(30,34,48,0))!important}';
  } else if (th === '抹茶拿铁猫') {
    rules += '#sl_panel_body{background:radial-gradient(120% 90% at 85% 0%,rgba(127,176,105,0.12),transparent 55%)}'
    + '#sl_compact{background:linear-gradient(160deg,#ffffff,#f6f9ef)!important}';
  } else if (th === '云朵棉花猫') {
    rules += '#sl_compact,#sl_panel_body>div{backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}'
    + '#sl_panel_header{background:linear-gradient(120deg,rgba(124,140,248,0.14),rgba(255,255,255,0))!important}'
    + '#sl_panel{background:#eef1fd!important}';
  } else if (th === '焦糖布丁猫') {
    rules += '#sl_panel_body{background:radial-gradient(120% 90% at 85% 0%,rgba(245,158,61,0.12),transparent 55%)}'
    + '#sl_compact{background:linear-gradient(160deg,#fffdf7,#fff6e2)!important}';
  } else {
    // 奶油麻薯猫：奶油渐晕+猫爪点阵
    rules += '#sl_panel_body{background:radial-gradient(120% 80% at 80% 0%,rgba(255,160,107,0.10),transparent 55%),radial-gradient(100% 70% at 0% 100%,rgba(255,220,190,0.18),transparent 60%)}'
    + '#sl_compact{background:linear-gradient(160deg,#ffffff 0%,#fff7f0 100%)!important}';
  }
  el.textContent = rules;
}

function syncThemeToDOM() {
  try {
    var t = TEXT_THEMES[settings.enhancedTheme] || TEXT_THEMES['默认'];
    if (document.getElementById('sl_global_text_style')) return;
    var s = document.createElement('style');
    s.id = 'sl_global_text_style';
    s.textContent = '.sl_enhanced,.sl_enhanced *{font-family:' + (t.font || 'inherit') + ';line-height:' + (t.lineHeight || '1.6') + ';color:' + (t.color || 'inherit') + ';background:' + (t.bg || 'transparent') + ';font-size:' + (t.fontSize || 'inherit') + '}';
    document.head.appendChild(s);
  } catch (e) {}
}

export function getCatStatusFace(s) {
  return ({ idle: '=^_^=', queuing: '^_^', busy: '*o*', error: '>_<' }[s] || '=^_^=');
}

export function toast(t, m) {
  try {
    if (typeof toastr !== 'undefined') {
      var faces = { success: '=^_^=', info: '(=^_^=)', warning: '(T_T)', error: '(x_x)' };
      toastr[t]((faces[t] || '=^_^=') + ' ' + m);
    } else console.log('[sillab]', t, m);
  } catch (e) { console.log('[sillab]', t, m); }
}

export function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function escAttr(s) {
  if (!s) return '';
  return ('' + s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sbtn(c) {
  return 'padding:' + (CAT.btnPadding || '8px 16px') + ';border:none;border-radius:' + (CAT.borderRadiusBtn || CAT.radius) + ';background:' + c + ';color:#fff;cursor:pointer;font-size:12px;font-weight:600;box-shadow:' + (CAT.btnShadow || 'none') + ';transition:all 0.2s cubic-bezier(0.34,1.56,0.64,1);';
}

export function fi() {
  return 'width:100%;padding:' + (CAT.inputPadding || '8px 10px') + ';border:' + CAT.borderStyle + ' ' + CAT.line + ';border-radius:' + (CAT.borderRadiusInput || '8px') + ';background:' + CAT.card + ';font-size:12px;color:' + CAT.text + ';box-sizing:border-box;outline:none;transition:all 0.2s ease;';
}
