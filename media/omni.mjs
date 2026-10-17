// 适配Qwen Omni协议，解析流式结果，将音频包装为WAV

// Qwen Omni 的 SSE(评估模型预测音频准确度的数学指标) 与 PCM(音频编码格式) 输出适配；与 Agent 的决策模型、工具上下文隔离。
export function pcmWav(pcm, sampleRate = 24000) {
  if (!pcm.length || pcm.length % 2) throw new Error('MEDIA_OMNI_INVALID_AUDIO');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function parseOmni(bytes) {
  let text = '', finish, done = false; const audio = [];
  for (const event of bytes.toString('utf8').replace(/\r\n/g, '\n').split('\n\n')) {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    if (data === '[DONE]') { done = true; break; }
    let chunk; try { chunk = JSON.parse(data); } catch { throw new Error('MEDIA_OMNI_INVALID_STREAM'); }
    if (chunk.error) throw new Error('MEDIA_OMNI_STREAM_ERROR');
    const choice = chunk.choices?.[0]; if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') text += delta.content;
    if (delta.audio?.data) {
      if (typeof delta.audio.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(delta.audio.data) || delta.audio.data.length % 4) throw new Error('MEDIA_OMNI_INVALID_AUDIO');
      audio.push(Buffer.from(delta.audio.data, 'base64'));
    }
  }
  if (finish === 'length') throw new Error('MEDIA_OMNI_OUTPUT_LIMIT');
  if (!done || finish !== 'stop') throw new Error('MEDIA_OMNI_INCOMPLETE_STREAM');
  if (text.length > 16000) throw new Error('MEDIA_OMNI_OUTPUT_LIMIT');
  return { text: text.trim(), pcm: Buffer.concat(audio) };
}

export function omniInput(asset) {
  if (asset.bytes.length * 4 / 3 > 9 * 1024 * 1024) throw new Error('MEDIA_OMNI_INPUT_LIMIT');
  const data = `data:${asset.meta.mime};base64,${asset.bytes.toString('base64')}`;
  return asset.meta.kind === 'audio' ? { type: 'input_audio', input_audio: { data, format: 'wav' } }
    : { type: 'image_url', image_url: { url: data } };
}
