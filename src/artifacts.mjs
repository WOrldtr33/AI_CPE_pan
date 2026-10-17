import { mkdir, writeFile } from 'node:fs/promises';

// 固定项目目录，避免从其他工作目录启动时把测试结果散落到外面。
export async function writeReport(path, content) {
  const directory = new URL('../reports/', import.meta.url);
  const target = new URL(path, directory);
  if (!target.href.startsWith(directory.href)) throw new Error('INVALID_REPORT_PATH');
  await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, content);
}
