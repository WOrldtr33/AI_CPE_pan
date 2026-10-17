const clean=(s:string)=>s.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/\*\*|__|`/g,'').trim();
export function AnswerView({text}:{text:string}){
 let lead=true;
 const lines=text.split('\n'),blocks=[];for(let i=0;i<lines.length;i++){
  let line=lines[i].trim();if(!line)continue;
  if(line.startsWith('```')){const code=[];while(++i<lines.length&&!lines[i].startsWith('```'))code.push(lines[i]);blocks.push(<pre className="answer-code" key={i}>{code.join('\n')}</pre>);continue;}
  if(/^\|?[\s:|-]+\|[\s:|-]+$/.test(line))continue;
  if(line.includes('|')&&(line.startsWith('|')||lines[i+1]?.includes('---'))){const cells=line.split('|').map(clean).filter(Boolean);if(cells.length>=2){blocks.push(<div className="answer-fact" key={i}><span>{cells[0]}</span><strong>{cells.slice(1).join(' · ')}</strong></div>);continue;}}
  const heading=/^#{1,6}\s+(.+)/.exec(line);if(heading){blocks.push(<h3 className="answer-caption" key={i}>{clean(heading[1])}</h3>);continue;}
  const bullet=/^(?:[-*+]\s+|\d+[.、)]\s*)(.*)/.exec(line);if(bullet){blocks.push(<div className="answer-point" key={i}><i/><span>{clean(bullet[1])}</span></div>);continue;}
  line=clean(line);blocks.push(<p className={lead?'answer-lead':'answer-detail'} key={i}>{line}</p>);lead=false;
 }
 return <article className="answer-note"><span className="answer-mark" aria-hidden="true"/>{blocks}</article>;
}
