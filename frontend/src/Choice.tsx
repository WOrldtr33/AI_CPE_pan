import {useEffect,useId,useRef,useState} from 'react';
import {Icon} from './Icon';
export function Choice({label,value,options,onChange,disabled=false}:{label:string;value:string;options:{value:string;label:string}[];onChange:(value:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),id=useId();
 useEffect(()=>{const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 useEffect(()=>{if(open)root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();},[open]);
 return <div className={`choice ${open?'open':''}`} ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}if(open&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'));const index=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}}}>
 <button type="button" ref={button} className="choice-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={()=>setOpen(!open)}><span>{options.find(o=>o.value===value)?.label||'尚未读取'}</span><Icon name="chevron" size={14}/></button>
 {open&&<div className="choice-menu" role="listbox" id={id} aria-label={label}>{options.map(option=><button type="button" role="option" aria-selected={value===option.value} key={option.value} onClick={()=>{onChange(option.value);setOpen(false);button.current?.focus();}}>{option.label}{value===option.value&&<Icon name="check" size={14}/>}</button>)}</div>}
 </div>;
}
