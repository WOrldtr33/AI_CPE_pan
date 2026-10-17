// Speech is a brief oral rendering; the full answer remains available on screen.
export const voiceProfiles={female:{voice:'Cherry',pitch:.985,label:'晴声'},male:{voice:'Ethan',pitch:.99,label:'和声'}};
export function plainSpeech(text){return text.replace(/```[\s\S]*?```/g,'详细内容可以看屏幕。').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/[*#`_]/g,'').replace(/^\s*[-|]+\s*$/gm,'').replace(/^\s*(?:[-+>] |\d+[.)、]\s*)/gm,'').replace(/\|/g,'，').replace(/[ \t]+/g,' ').replace(/\n+/g,'。').replace(/。+/g,'。').trim();}
export function speechFallback(text){
 const plain=plainSpeech(text);if(plain.length<=140)return plain;
 const sentences=plain.split(/(?<=[。！？!?；;])|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
 const priority=sentences.filter(s=>/失败|无法|未连接|未联网|尚未|待确认|需要.{0,8}确认|不能|异常|错误/.test(s));
 const selected=[...new Set([...(priority.length?[priority[0]]:[]),sentences[0],...sentences.slice(1)])];let out='';
 for(const s of selected){if(out.length+s.length<=140)out+=s;else if(!out)out=s.slice(0,130)+'。';if(out.length>80)break;}
 return out+(plain.length>out.length+30?'详细信息可以看屏幕。':'');
}
export function faithfulSpeech(summary,source){
 if(typeof summary!=='string'||!summary.trim()||summary.length>180)return false;
 if(/[*#`|]|https?:\/\//.test(summary))return false;
 const numbers=summary.match(/\d+(?:\.\d+)?/g)||[];if(numbers.some(n=>!source.includes(n)))return false;
 if(/待确认|尚未执行|需要.{0,8}确认|等待.{0,8}确认/.test(source)&&!/待|未执行|需要.{0,8}确认|请.{0,8}确认/.test(summary))return false;
 if(/失败|无法|未连接|未联网|不能确认|尚未核实|结果待核实/.test(source)&&!/失败|无法|未|没|待|不能|不确定/.test(summary))return false;
 return true;
}
