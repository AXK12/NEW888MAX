// page-smoke.js —— 用 DOM 桩在 node 里跑一遍 vmax.html 的实际渲染路径
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
const store={};
function node(id){ if(!store[id]) store[id]={id,innerHTML:'',textContent:'',value:'',checked:true,disabled:false,style:{},
  classList:{add(){},remove(){},contains(){return false}},children:[],
  appendChild(c){this.children.push(c)},addEventListener(){},onclick:null,className:''}; return store[id]; }
const timers=[];
const ctx={console,setTimeout:(f)=>{timers.push(f);return 1},clearTimeout(){},Math,JSON,Date,Promise,Number,String,Object,Array,Set,RegExp,Error,parseInt,parseFloat,isFinite,encodeURIComponent,
 document:{getElementById:node,querySelector:()=>node('_header'),querySelectorAll:()=>[],createElement:()=>node('_tmp'),addEventListener(){}},
 navigator:{clipboard:{writeText:()=>Promise.resolve()}},
 fetch:(u)=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT,String(u).split('?')[0])),'utf8'))})};
ctx.window=ctx;ctx.self=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,'vmax.js'),'utf8'),ctx);
const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
try{ vm.runInContext(app,ctx); }catch(e){ console.log('✗ app.js 执行抛错:',e.message);}
const flush=()=>{while(timers.length){try{timers.shift()()}catch(e){console.log('定时器抛错:',e.message)}}};
try{flush()}catch(e){console.log('✗ 渲染抛错:',e.message)}
setTimeout(()=>{try{flush()}catch(e){console.log('✗ 渲染抛错:',e.message)}
 const need=['meta','poolCount','balls','bt','cmp','verdict','ticket','ticketNote','expl','poolFrom','poolNote','btScope','kdef','cmp'];
 const empty=need.filter(k=>!store[k]||!String(store[k].innerHTML||store[k].textContent).length);
 console.log('\n渲染检查');
 console.log('  未填充的节点:', empty.join(', ')||'无');
 console.log('  标题栏:', (store.meta&&store.meta.textContent||'').slice(0,86));
 console.log('  号码池:', (store.poolCount&&store.poolCount.innerHTML||'').replace(/<[^>]+>/g,'').trim());
 console.log('  奖级概率块:', (store.ticket&&store.ticket.innerHTML||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,130));
 console.log('  结论块长度:', (store.verdict&&store.verdict.innerHTML||'').length,'字符');
 console.log('  对比表行数:', ((store.cmp&&store.cmp.innerHTML||'').match(/<tr/g)||[]).length);
 console.log('  回测表行数:', ((store.bt&&store.bt.innerHTML||'').match(/<tr/g)||[]).length);
 console.log(empty.length? '\n✗ 页面有节点未被填充':'\n✓ vmax.html 渲染链路完整（池/回测/对比/奖级/结论均已填充）');
 process.exit(empty.length?1:0);
},1600);
