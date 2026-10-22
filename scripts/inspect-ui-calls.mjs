import { readFile } from 'node:fs/promises';

// 只读：在厂商网页静态代码中定位 UBUS 方法的封装函数及其调用处，输出调用上下文供核对参数契约。
const source = await readFile(new URL('../tmp/device-ui-write-fix.js', import.meta.url), 'utf8');
const methods = process.argv.slice(2);
const width = Number(process.env.CONTEXT || 900);
for (const method of methods) {
  const wrapper = new RegExp(`(?:async function |const )(\\w+)(?:\\(\\w*\\)\\{|=async\\(?\\w*\\)?=>\\{)[^]{0,200}?"${method}"`, 'g');
  const names = [...new Set([...source.matchAll(wrapper)].map(match => match[1]))];
  console.log(`##### ${method}: wrappers ${JSON.stringify(names)}`);
  for (const name of names) {
    const calls = [...source.matchAll(new RegExp(`[^\\w.$]${name.replace('$', '\\$')}\\(`, 'g'))].slice(1, 4);
    for (const call of calls) console.log(`--- ${name} @${call.index}\n${source.slice(Math.max(0, call.index - width), call.index + 300)}\n`);
  }
}
