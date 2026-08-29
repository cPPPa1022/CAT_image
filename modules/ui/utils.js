// ── SillyImage Lab UI 工具函数 ──
// [AI-Fix] 原 ui.js 与 theme.js 重复定义了 toast/esc/escAttr/sbtn/fi，这里统一复用 theme.js 实现
export { toast, esc, escAttr, sbtn, fi } from './theme.js';

export function chkProf() { try { var s = JSON.parse(localStorage.sillab_settings); var pf = s.profiles || {}; var cn = Object.keys(pf)[0]; if (!cn || !pf[cn]) return false; var cast = pf[cn].cast || {}; var keys = Object.keys(cast); if (keys.length === 0) return !!(pf[cn].meta && (pf[cn].meta.cardType === '世界观卡' || pf[cn].meta.cardType === '混合型卡')); for (var i = 0; i < keys.length; i++) { if (cast[keys[i]] && cast[keys[i]].static && cast[keys[i]].static.length > 10) return true; } return false; } catch (e) { return false; } }