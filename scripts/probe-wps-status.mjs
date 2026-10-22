import { setTimeout as delay } from 'node:timers/promises';
import { connectTools } from '../src/agent-mcp.mjs';

// 只读：轮询主网络两个频段的 WPS 运行状态，观察是否自行结束。
const seconds = Number(process.argv[2] || 180);
const mcp = await connectTools(['wps_run'], process.env);
try {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await delay(10000)) {
    const row = [];
    for (const name of ['2.4G', '5G']) {
      const info = (await mcp.call('t830_get_wps_run', { name, obj: 'host' })).data?.host?.[name]?.WPS_info;
      row.push(`${name}=${info?.WscStatus}/${info?.WscResult}`);
    }
    console.log(new Date().toISOString(), row.join(' '));
  }
} finally { await mcp.close(); }
