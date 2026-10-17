import { readFile, writeFile } from 'node:fs/promises';
import { reads, writes, toolName } from '../src/catalog.mjs';
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
  '只在 T830_ENABLE_WRITES=1 时注册。11 项已接入写前检查、提交和回读验证；模拟测试覆盖全部，实机仅完成 UPnP 修改和恢复。sample 仅供自动测试，不是推荐配置。',
  '',
  '| API | 分组 | MCP 工具 | 功能 | 后续回读 section |',
  '|---|---|---|---|---|',
  ...writes.map(
    (d) =>
      `| ${d.api} | ${d.group} | ${toolName(d)} | ${d.description} | ${d.readback} |`,
  ),
  '',
  '## 文档中本轮未封装的接口',
  '',
  '不将文档出现等同于设备实际可用。以下保留范围与原因，后续按需扩展。',
  '',
  '| API | 名称 | 状态／原因 |',
  '|---|---|---|',
];
const md = await readFile(new URL('docs/api/API_DOC.md', root), 'utf8');
const done = new Set([...reads, ...writes].map((d) => d.api));
for (const m of md.matchAll(/^### (\d+)\. (.+)$/gm)) {
  const n = Number(m[1]);
  if (done.has(n)) continue;
  let why = '本轮未封装；需补齐字段/枚举、变更影响及回读恢复验证';
  if ([4, 5, 6].includes(n))
    why = '认证基础设施：已内部实现登录；未作为业务工具暴露登录凭据或退出会话';
  if ((n >= 45 && n <= 48) || n >= 130)
    why = '固件升级、重启、恢复或任意命令/文件操作：不纳入基础批量测试';
  if (n >= 51 && n <= 57)
    why = 'SIM 选择或 PIN/PUK 操作：需实际 SIM 场景，避免消耗验证次数';
  if (n >= 117 && n <= 127)
    why = '短信/电话本：不纳入当前网络诊断基础范围；本地存储读取可后续独立评估';
  if (n === 110 || n === 111) why = '开发者认证/提权：不封装';
  if (n === 100 || n === 115 || n === 26 || n === 27)
    why = '主动诊断/扫描任务：需独立任务生命周期与目标约束，暂不当作无副作用查询';
  if (n === 116) why = '需要对应 Ping/Traceroute 任务上下文，随任务接口后续接入';
  if (n === 129) why = '日志导出：需确认生成文件的行为及日志敏感字段';
  sections.push(`| ${n} | ${m[2].trim()} | ${why} |`);
}
sections.push(
  '',
  '写接口仅封装文档中明确的参数子集：APN 认证目前仅 none；WiFi 加密仅 schema 所列模式。不声称覆盖全部设备功能。',
  '',
);
await writeFile(new URL('docs/api/API_CATALOG.md', root), sections.join('\n'));
console.log(`catalog: ${reads.length} read, ${writes.length} write`);
