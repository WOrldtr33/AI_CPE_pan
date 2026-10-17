const clip = (text, length) => typeof text === 'string' ? text.slice(0, length) : '';

export function historyNote(messages) {
  const lines = [];
  const names = new Map();
  for (const message of messages) {
    if (message.role === 'user') lines.push(`用户：${clip(message.content, 300)}`);
    if (message.role === 'assistant') {
      if (message.tool_calls?.length) for (const call of message.tool_calls) names.set(call.id, call.function.name);
      else lines.push(`答复：${clip(message.content, 450)}`);
    }
    if (message.role === 'tool') {
      try {
        const result = JSON.parse(message.content);
        lines.push(`历史工具 ${names.get(message.tool_call_id) || 'unknown'}：${JSON.stringify({ status: result.status, error: result.error, observedAt: result.observedAt, reading: result.reading, assetId: result.assetId || result.asset?.id, capturedAt: result.capturedAt || result.asset?.createdAt, text: clip(result.text, 450), data: result.data, diagnosticSummary: result.diagnosticSummary }).slice(0, 800)}`);
      } catch { lines.push('历史工具结果无法摘要。'); }
    }
  }
  return lines.join('\n');
}

// 按完整用户轮次裁剪，绝不拆开当前工具请求及其回复；使用摘录摘要，不生成新结论。
export function compactHistory(messages, summary, limit, keepTurns = 2) {
  const users = messages.flatMap((m, i) => m.role === 'user' ? [i] : []);
  const boundary = users.at(-(keepTurns + 1));
  if (boundary === undefined || boundary <= 1) return { messages, summary, changed: false };
  const older = messages.slice(1, boundary);
  const next = `${summary}\n${historyNote(older)}`.trim().slice(-Math.min(12000, Math.floor(limit * 0.3)));
  return { messages: [messages[0], ...messages.slice(boundary)], summary: next, changed: true };
}

export function persistentContext(messages, summary) {
  // 会话落盘只保存完整的用户/最终回答；工具历史变为摘要，推理过程不落盘。
  const complete = [];
  let input;
  for (const message of messages.slice(1)) {
    if (message.role === 'user') input = message;
    else if (message.role === 'assistant' && !message.tool_calls?.length && input) {
      complete.push(input, { role: 'assistant', content: message.content }); input = undefined;
    }
  }
  return { summary: `${summary}\n${historyNote(messages.filter(m => m.role !== 'system' && m.role !== 'user' && !(m.role === 'assistant' && !m.tool_calls?.length)))}`.trim().slice(-12000), messages: complete.slice(-8) };
}
