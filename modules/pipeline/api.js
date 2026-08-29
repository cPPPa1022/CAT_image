// ── SillyImage Lab 辅助 API 调用 ──
import { slLog, slErr } from '../log.js';
import { settings } from '../settings.js';
// 模块级：记录API是否支持thinking参数(false=不支持,不再发送)
var THINKING_DISABLED = true;
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

    var messages;
    if (Array.isArray(systemPrompt)) {
        messages = systemPrompt;
    } else {
        messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }];
    }

    var body = {
        messages: messages,
        max_tokens: maxTokens || 8192,
        temperature: temperature != null ? temperature : 0.3,
        stream: false,
        model: model
    };
    // 推理模型默认思考会吃光max_tokens(实测reasoning 1.3万+字符后content为0), 禁用thinking
    // 若API不支持该参数(400)则自动降级不带, 并用模块级标记记住
    if (THINKING_DISABLED !== false) body.thinking = { type: 'disabled' };

    var response;
    var timeoutMs = (settings.cTimeout || 180) * 1000;
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
    try {
        response = await fetch(endpoint, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: controller.signal });
    } catch (e) {
        clearTimeout(timer);
        throw new Error(e && e.name === 'AbortError' ? '辅助API请求超时(' + timeoutMs + 'ms)' : (e ? e.message : 'fetch失败'));
    }
    clearTimeout(timer);
    slLog('auxApiCall 响应状态:', response.status, 'thinking=' + (body.thinking ? 'disabled' : 'off'));
    if (!response.ok) {
        var errorText = await response.text().catch(function() { return ''; });
        // 降级：API不认识thinking参数 → 去掉重试一次
        if (body.thinking && errorText && /thinking|parameter|invalid|unknown/i.test(errorText)) {
            slErr('API不支持thinking参数, 降级重试:', errorText.slice(0, 200));
            THINKING_DISABLED = false;
            delete body.thinking;
            var ctrl2 = new AbortController();
            var timer2 = setTimeout(function() { ctrl2.abort(); }, timeoutMs);
            try {
                response = await fetch(endpoint, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctrl2.signal });
            } catch (e2) { clearTimeout(timer2); throw new Error(e2 && e2.name === 'AbortError' ? '辅助API降级重试超时' : (e2 ? e2.message : 'fetch失败')); }
            clearTimeout(timer2);
            slLog('auxApiCall 降级重试响应状态:', response.status);
            if (!response.ok) {
                var errorText2 = await response.text().catch(function() { return ''; });
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
    var content = (msg.content || '').trim();
    var reasoning = (msg.reasoning_content || '');
    var finish = (choice && choice.finish_reason) || '';
    slLog('auxApiCall 返回: finish_reason=' + finish + ', content_len=' + content.length + ', reasoning_len=' + reasoning.length + ', refusal=' + (msg.refusal ? '有' : '无'));
    if (!content && finish === 'length') {
        slErr('⚠️ 输出被max_tokens截断: reasoning耗尽了token, content为空');
    }
    if (!content && !reasoning && finish === 'stop') {
        slErr('⚠️ 模型主动输出空内容 (finish=stop, 无reasoning), 响应前300字: ' + JSON.stringify(data).slice(0, 300));
    }
    return content;
}

