import { mkdir, writeFile } from 'node:fs/promises';
import { redact } from './t830.mjs';

// 固定项目目录，避免从其他工作目录启动时把测试结果散落到外面。
export async function writeReport(path, content) {
  const directory = new URL('../reports/', import.meta.url);
  const target = new URL(path, directory);
  if (!target.href.startsWith(directory.href)) throw new Error('INVALID_REPORT_PATH');
  await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, redactJsonReport(path, content));
}

// 设备结果中的配置密码在交互中明文显示；JSON 报告落盘前统一按字段名隐藏。
function redactJsonReport(path, content) {
  if (!path.endsWith('.json') || typeof content !== 'string') return content;
  let parsed;
  try { parsed = JSON.parse(content); } catch { return content; }
  return JSON.stringify(redact(parsed), null, 2);
}
