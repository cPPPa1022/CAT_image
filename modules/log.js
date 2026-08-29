// ── SillyImage Lab 日志系统 ──
var logLines = [];
var MAX_LOG = 500;

export function slLog(msg) {
    var args = Array.prototype.slice.call(arguments);
    var line = '[' + new Date().toLocaleTimeString() + '] ' + args.join(' ');
    logLines.push(line);
    if (logLines.length > MAX_LOG) logLines.shift();
    console.log(line);
}

export function slErr(msg) {
    var args = Array.prototype.slice.call(arguments);
    var line = '[ERR ' + new Date().toLocaleTimeString() + '] ' + args.join(' ');
    logLines.push(line);
    if (logLines.length > MAX_LOG) logLines.shift();
    console.error(line);
}

export function slLogDump() { return logLines.join('\n'); }
export function getLogCount() { return logLines.length; }
export function slClearLogs() { logLines = []; slLog('日志已清空'); }
