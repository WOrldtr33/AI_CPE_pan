import { readFile, writeFile } from 'node:fs/promises';
import { reads, writes, toolName } from '../src/catalog.mjs';
import { writeProfiles } from '../src/write-profiles.mjs';
const root = new URL('../', import.meta.url);
const sections = [
  '# T830 接口接入清单',
  '',
  '此清单由 `node scripts/catalog.mjs` 生成。分类是开发范围，**不是实机成功声明**。查询无 SIM 状态与验证蜂窝上网是两回事。',
  '',
  '## 已封装只读接口',
  '',
  '| API | 分组 | section | MCP 工具 | 功能及前提 |',
  '|---|---|---|---|---|',
  ...reads.map(
    (d) =>
      `| ${d.api} | ${d.group} | ${d.key} | ${toolName(d)} | ${d.description}；${d.condition} |`,
  ),
  '',
  '## 已封装写接口（默认关闭）',
  '',
  `只在 T830_ENABLE_WRITES=1 时注册。${writes.filter((d) => writeProfiles[d.key]).length} 项已接入写前检查、提交和回读验证；其余写工具只提交一次，不回读。sample 仅供自动测试，不是推荐配置。`,
  '',
  '| API | 分组 | MCP 工具 | 功能 | 后续回读 section |',
  '|---|---|---|---|---|',
  ...writes.map(
    (d) =>
      `| ${d.api} | ${d.group} | ${toolName(d)} | ${d.description} | ${d.readback} |`,
  ),
  '',
];
const md = await readFile(new URL('docs/api/API_DOC.md', root), 'utf8');
const done = new Set([...reads, ...writes].map((d) => d.api));
const missing = [...md.matchAll(/^### (\d+)\. (.+)$/gm)].filter((m) => !done.has(Number(m[1])));
if (missing.length) {
  sections.push(
    '## 文档中尚未封装的接口',
    '',
    '| API | 名称 |',
    '|---|---|',
    ...missing.map((m) => `| ${m[1]} | ${m[2].trim()} |`),
  );
} else {
  sections.push('## 文档覆盖', '', 'API_DOC.md 中的编号接口都已注册。写工具默认不注册。`file exec` 只接受文档中的 tar 检查和 sysupgrade 恢复参数。');
}
sections.push(
  '',
  '写接口仅封装文档中明确的参数子集：APN 认证目前仅 none；WiFi 加密仅 schema 所列模式。不声称覆盖全部设备功能。',
  '',
);
await writeFile(new URL('docs/api/API_CATALOG.md', root), sections.join('\n'));
console.log(`catalog: ${reads.length} read, ${writes.length} write`);
