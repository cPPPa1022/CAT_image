// ── SillyImage Lab 档案导出 ──
import { settings, getSTContext, escapeHtml, saveSettings } from './settings.js';
import { getCharacterName, getChatId, getProfiles } from './pipeline/profile.js';

export function exportProfiles(mode) {
    var profiles = getProfiles();
    if (!profiles || !profiles.charName) { toastr.error('未检测到当前角色'); return; }
    var cast = profiles.root[profiles.charName].cast || {};
    var dynamics = profiles.chat.dynamics || {};
    var presentList = profiles.chat.present || [];
    var npcs = profiles.chat.npcs || {};
    var chatId = getChatId();
    var now = new Date().toLocaleString();
    var lines = [];
    var sep = '══════════════════════════════════';
    lines.push(sep);
    lines.push('  SillyImage Lab — 角色档案导出');
    lines.push(sep);
    lines.push('');
    lines.push('角色：' + profiles.charName);
    lines.push('聊天ID：' + chatId);
    lines.push('导出时间：' + now);
    lines.push('类型：' + (mode === 'cast' ? '角色卡档案（亘古不变）' : '角色卡档案 + 聊天档案'));
    lines.push('');
    lines.push('── 角色卡档案（亘古不变） ──');
    if (Object.keys(cast).length) {
        for (var ck in cast) {
            var cv = cast[ck];
            lines.push('  ■ ' + ck);
            if (cv.static) lines.push('    ' + cv.static);
            
        }
    } else { lines.push('  （未生成）'); }
    if (mode !== 'cast') {
        lines.push('');
        lines.push('── 聊天档案（随上下文变化） ──');
        if (Object.keys(dynamics).length) {
            for (var dk in dynamics) {
                if (dynamics[dk]) { lines.push('  ■ ' + dk); lines.push('    ' + dynamics[dk]); }
            }
        }
        if (presentList.length) { lines.push(''); lines.push('  当前场景角色：' + presentList.join('、')); }
        if (Object.keys(npcs).length) {
            lines.push('');
            lines.push('  NPC列表：');
            for (var n in npcs) {
                var npc = npcs[n];
                lines.push('    ■ ' + n + '（出现' + (npc.appearances || 1) + '次）');
                if (npc.static) lines.push('      ' + npc.static);
                if (npc.dynamic) lines.push('      ' + npc.dynamic);
            }
        }
    }
    var text = lines.join('\n');
    var filename = mode === 'cast' ? '角色卡档案_' + profiles.charName + '.txt' : '角色卡聊天档案_' + profiles.charName + '_' + chatId.slice(0, 16) + '.txt';
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success(mode === 'cast' ? '档案导出好啦喵~ 📥' : '全部档案导出好啦喵~ 📥✨');
}
