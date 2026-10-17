// ── SillyImage Lab 辅助 API 调用 ──
import { slLog, slErr } from '../log.js';
import { settings } from '../settings.js';

// ══════════════════════════════════════════════════════════════
// ── v1.13.5 思考强度选项已删除：辅助 AI 一律「关闭思考」 ──
//   实测（同一套破限 + 明确成人内容，每档 n=10）：
//     off → 拒绝 0/10 ｜ low → 拒绝 4/10 ｜ high → 拒绝 9/10
//   档位越高越容易被拒，画面质量却没有肉眼可见的提升 —— 性价比为负，直接砍掉选项。
// ⚠️ 协议：DeepSeek 服务端默认 thinking=enabled + effort=high，
//    所以「把 thinking 参数删掉」= 开到 high，**不是**关掉 —— 必须显式 disabled。
// ══════════════════════════════════════════════════════════════
var OUT_MAXTOKENS = 16384;

function applyThinking(body) {
    body.thinking = { type: 'disabled' };
    delete body.reasoning_effort;
    return body;
}

// ── CoT（思维链）剥离 ──
// DeepSeek 把思考放在独立的 reasoning_content 字段（正常不会混进 content）；
// 但有些网关会把思考合并进正文，或模型自己带 <thinking> 标记 → 统一剥掉，
// 别让思考污染 ---PROFILE--- / ---IMAGES--- 的解析。
export function stripCoT(text) {
    var t = String(text || '');
    if (!t) return t;
    t = t.replace(/<(thought|thinking|reasoning)>[\s\S]*?<\/\1\s*>/gi, '');
    t = t.replace(/<(thought|thinking|reasoning)\s*\/>/gi, '');
    t = t.replace(/(^|\n)[ \t]*(思考过程|推理过程|分析过程|Thought process)[ \t]*[：:][\s\S]*?(?=\n[ \t]*---|\n\n|$)/gi, '\n');
    var p = t.search(/---\s*PROFILE\s*---/);
    if (p > 0) t = t.slice(p);
    var reEnd = /---\s*END\s*---/g, mm, lastIdx = -1;
    while ((mm = reEnd.exec(t)) !== null) lastIdx = mm.index + mm[0].length;
    if (lastIdx > 0) t = t.slice(0, lastIdx);
    return t.trim();
}

async function _post(endpoint, headers, body, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    try {
        return await fetch(endpoint, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
        throw new Error(e && e.name === 'AbortError' ? '辅助API请求超时(' + timeoutMs + 'ms)' : (e ? e.message : 'fetch失败'));
    } finally { clearTimeout(timer); }
}

export async function auxApiCall(systemPrompt, userMessage, maxTokens, temperature, forceModel) {
    var model = forceModel || settings.auxModel;
    if (!settings.auxUrl || !model) {
        slLog('auxApiCall: auxUrl或model未配置');
        throw new Error('辅助API未配置');
    }
    var endpoint = settings.auxUrl.replace(/\/+$/, '');
    if (!/\/chat\/completions$/.test(endpoint)) endpoint += '/chat/completions';
    slLog('auxApiCall →', endpoint, 'model:', model);

    var headers = { 'Content-Type': 'application/json' };
    if (settings.auxKey) headers['Authorization'] = 'Bearer ' + settings.auxKey;

    var messages = Array.isArray(systemPrompt) ? systemPrompt : [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }];

    var mt = Math.max(Number(maxTokens) || 0, OUT_MAXTOKENS);
    var body = {
        messages: messages,
        max_tokens: mt,
        temperature: temperature != null ? temperature : 0.3,
        stream: false,
        model: model
    };
    applyThinking(body);

    var timeoutMs = (settings.cTimeout || 180) * 1000;
    var response = await _post(endpoint, headers, body, timeoutMs);
    slLog('auxApiCall 响应状态:', response.status, '| max_tokens=' + mt);

    if (!response.ok) {
        var errorText = await response.text().catch(function () { return ''; });
        // 网关不认 thinking 字段时的兜底：去掉该字段重试一次。
        // ⚠️ 只有「不接受 thinking 参数的网关」会走到这里；对 DeepSeek 官方来说去掉参数 = 开到 high，
        //    所以日志里必须标出来，不能让这件事悄悄发生。
        if (/thinking|reasoning|parameter|invalid|unknown/i.test(errorText)) {
            slErr('辅助API拒绝参数, 去掉 thinking 字段重试（⚠️ 若对端是 DeepSeek 官方，这等于开到 high）:', errorText.slice(0, 200));
            delete body.thinking;
            delete body.reasoning_effort;
            response = await _post(endpoint, headers, body, timeoutMs);
            slLog('auxApiCall 降级重试响应状态:', response.status);
            if (!response.ok) {
                var errorText2 = await response.text().catch(function () { return ''; });
                slErr('auxApiCall失败(降级后):', response.status, errorText2.slice(0, 500));
                throw new Error('HTTP ' + response.status + ': ' + errorText2.slice(0, 300));
            }
        } else {
            slErr('auxApiCall失败:', response.status, errorText.slice(0, 500));
            throw new Error('HTTP ' + response.status + ': ' + errorText.slice(0, 300));
        }
    }

    var data = await response.json();
    var choice = data && data.choices && data.choices[0];
    var msg = (choice && choice.message) || {};
    var reasoning = (msg.reasoning_content || msg.reasoning || '');
    var finish = (choice && choice.finish_reason) || '';
    var content = stripCoT(msg.content || '');
    slLog('auxApiCall 返回: finish=' + finish + ', content_len=' + content.length + ', reasoning_len=' + reasoning.length);

    if (!content && finish === 'length') {
        slErr('⚠️ 输出被max_tokens截断: content为空');
    }
    if (!content && !reasoning && finish === 'stop') {
        slErr('⚠️ 模型主动输出空内容 (finish=stop, 无reasoning), 响应前300字: ' + JSON.stringify(data).slice(0, 300));
    }
    return content;
}
