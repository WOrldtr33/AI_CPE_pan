import {useCallback,useEffect,useRef,useState} from 'react';
import {device,VoiceSession} from './device';

// One microphone/session belongs to the page, independently of the chat panel.
export function useHomeVoice(connected:boolean,onEvent:(event:any)=>void){
 const callback=useRef(onEvent);callback.current=onEvent;
 const session=useRef<VoiceSession|undefined>(undefined),mounted=useRef(true),attempted=useRef(false),desired=useRef(localStorage.getItem('sky-voice-standby')!=='off');
 const [running,setRunning]=useState(false),[starting,setStarting]=useState(false);
 const ensure=useCallback(async()=>{
  if(session.current)return;
  setStarting(true);callback.current({type:'voice_starting'});
  const current=new VoiceSession(event=>{if(session.current!==current||!mounted.current)return;if(event.type==='ended'){session.current=undefined;setRunning(false);setStarting(false);}callback.current(event);});
  session.current=current;
  try{await current.start();if(session.current===current&&mounted.current){setRunning(true);callback.current({type:'voice_ready'});}}
  catch(error){if(session.current===current&&mounted.current){session.current=undefined;setRunning(false);callback.current({type:'error',error});}}
  finally{if(mounted.current&&(!session.current||session.current===current))setStarting(false);}
 },[]);
 const stop=useCallback(()=>{desired.current=false;localStorage.setItem('sky-voice-standby','off');session.current?.stop();session.current=undefined;setRunning(false);setStarting(false);callback.current({type:'voice_stopped'});},[]);
 const toggle=useCallback(()=>{if(session.current){stop();return;}desired.current=true;attempted.current=true;localStorage.setItem('sky-voice-standby','on');void device.unlockAudio().catch(()=>{});void ensure();},[ensure,stop]);
 useEffect(()=>{if(connected&&desired.current&&!attempted.current){attempted.current=true;void ensure();}},[connected,ensure]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;session.current?.stop();session.current=undefined;};},[]);
 return{running,starting,toggle,stop};
}
