import { mkdir,writeFile } from 'node:fs/promises';
import { demoHistory } from '../src/dashboard-demo.mjs';
await mkdir(new URL('../.media-state/',import.meta.url),{recursive:true});
await writeFile(new URL('../.media-state/dashboard-demo.json',import.meta.url),JSON.stringify({source:'demo',unit:'bytes_per_second',points:demoHistory()}));
console.log('演示流量已生成：.media-state/dashboard-demo.json（不向设备发送流量）');
