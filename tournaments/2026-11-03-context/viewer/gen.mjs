import fs from 'fs';
const T='/mnt/project-files/design-tournament/';
const lanes={base:'/home/user/ccp_xstate/workflows/quick-fix.json',A:T+'A-minimalist/build/workflows/quick-fix.json',B:T+'B-event-sourcing/build/workflows/quick-fix.json',C:T+'C-provenance/build/workflows/quick-fix.json',D:T+'D-wildcard/build/workflows/quick-fix.json',E:T+'E-control/build/workflows/quick-fix.json'};
const short=e=>e.replace(/^done\((\w+)\)$/,'$1 done').replace(/^error\((\w+)\)$/,'$1 error').replace('github.check_run.completed','check failed').replace('github.check_suite.completed','CI suite done').replace('github.pull_request.synchronize','push').replace('github.pull_request.closed','PR closed').replace(/^after:.*/,'timeout').replace('ci.observed','CI observed').replace('pr.head.observed','head observed').replace('always','auto').replace('onDone','inner done').replace('pr.pushed','pr.pushed').replace(/^pr$/,'push (pr)');
const out={};
for(const [k,f] of Object.entries(lanes)){
 const j=JSON.parse(fs.readFileSync(f));const states=[],edges=[];let raw=0;
 const walk=(s,parent)=>{for(const [id,v] of Object.entries(s.states||{})){
  const inv=v.invoke?(Array.isArray(v.invoke)?v.invoke:[v.invoke]):[];
  states.push({id,parent,final:v.type==='final',needs:v.meta?.needs||[],invoke:inv.map(i=>i.src)});
  const add=(ev,t)=>{for(const x of (Array.isArray(t)?t:[t])){if(x==null)continue;raw++;const to=typeof x==='string'?x:x.target;const g=x.guard?(typeof x.guard==='string'?x.guard:x.guard.type):'';edges.push({from:id,to:to||null,ev:short(ev),g})}};
  for(const [ev,t] of Object.entries(v.on||{}))add(ev,t);
  if(v.always)add('always',v.always);
  for(const [ev,t] of Object.entries(v.after||{}))add('after:'+ev,t);
  for(const i of inv){if(i.onDone)add('done('+i.src+')',i.onDone);if(i.onError)add('error('+i.src+')',i.onError)}
  if(v.onDone)add('onDone',v.onDone);
  if(v.states)walk(v,id);
 }};
 walk(j,null);
 const lines=fs.readFileSync(f,'utf8').split('\n').length;
 out[k]={initial:j.initial,context:Object.keys(j.context||{}),states,edges,raw,lines};
}
fs.writeFileSync('data.json',JSON.stringify(out));
for(const [k,v] of Object.entries(out))console.log(k,v.states.length,'states',v.raw,'transitions',v.lines,'lines');
