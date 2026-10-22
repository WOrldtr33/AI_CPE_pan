import { setTimeout as delay } from 'node:timers/promises';

export class ModelApi {
  constructor({ apiKey, baseUrl, requestTimeoutMs = 60000, fetchImpl = fetch, onEvent = () => {} }) {
    Object.assign(this, { apiKey, baseUrl, requestTimeoutMs, fetchImpl, onEvent });
  }
  async request(path, body, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const combined = AbortSignal.any([AbortSignal.timeout(this.requestTimeoutMs), ...(signal ? [signal] : [])]);
      let response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
          method: body ? 'POST' : 'GET', redirect: 'error', signal: combined,
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        // 请求可能已被服务端处理，网络异常不盲目重发。
        throw new Error(signal?.aborted ? 'CALL_CANCELLED' : combined.aborted ? 'AI_REQUEST_TIMEOUT' : 'AI_NETWORK_ERROR');
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt === 0) {
          this.onEvent({ event: 'api_retry', status: response.status });
          await delay(750, undefined, { signal });
          continue;
        }
        throw new Error(`AI_HTTP_${response.status}${response.status === 401 ? '：Key 无效或无权限' : response.status === 402 ? '：余额不足' : ''}`);
      }
      try { return await response.json(); }
      catch { throw new Error(signal?.aborted ? 'CALL_CANCELLED' : combined.aborted ? 'AI_REQUEST_TIMEOUT' : 'AI_INVALID_JSON'); }
    }
  }
  async models(signal) {
    const data = await this.request('models', undefined, signal);
    if (!Array.isArray(data.data)) throw new Error('AI_INVALID_MODEL_LIST');
    return data.data.map(item => item.id);
  }
  async complete(messages, tools, settings, signal) {
    const started = Date.now();
    // 大目录通过兼容查询入口提供全部 section，避免超过模型的工具数量限制。
    const advertised = tools.length > 128 && tools.some(tool => tool.function.name === 't830_query')
      ? tools.filter(tool => !tool.function.name.startsWith('t830_get_')) : tools;
    if (advertised.length > 128) throw new Error('AI_TOOL_LIMIT');
    const data = await this.request('chat/completions', {
      model: settings.model, messages, tools: advertised, stream: false, max_tokens: settings.maxTokens,
      thinking: { type: settings.thinking === 'off' ? 'disabled' : 'enabled' },
      ...(settings.thinking === 'off' ? {} : { reasoning_effort: settings.thinking }),
    }, signal);
    const choice = data.choices?.[0];
    if (!choice?.message || choice.message.role !== 'assistant') throw new Error('AI_INVALID_RESPONSE');
    this.onEvent({ event: 'model_response', model: settings.model, ms: Date.now() - started, usage: data.usage, finishReason: choice.finish_reason });
    if (choice.finish_reason === 'length') throw new Error('AI_OUTPUT_LIMIT：回答或工具参数被截断，请提高输出上限或关闭思考。');
    return { message: choice.message, usage: data.usage };
  }
}
