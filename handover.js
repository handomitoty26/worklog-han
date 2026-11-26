// 관리일지 인계 공유(인계함) — 켜졌을 때만 서버와 인계를 주고받는 추가 모듈(끄면 아무것도 하지 않음)
(function(root){"use strict";

const K={cfg:"handover_cfg_v1",cache:"handover_cache_v1",outbox:"handover_outbox_v1",shared:"handover_shared_v1",failed:"handover_failed_v1",bad:"handover_outbox_bad_v1"};
const LIM={body:2000,place:30,memo:200,name:40,cache:200,outbox:50,outboxWd:100,failed:50,listDays:14,unreadDays:7,keepDays:365,timeout:15000,tries:20,interval:600000,visibleGap:120000,rerun:3,popupDelay:1500,popTries:40,msg:80};
const URL_RE=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,200}\/exec$/;
const CF_RE=/^[0-9a-f]{8}$/;
const CODE_RE=/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;
const HID_RE=/^[A-Za-z0-9]{4,40}$/;
const SID_RE=/^S\d{2,4}$/;
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const TIME_RE=/^([01]\d|2[0-3]):[0-5]\d$/;
const STAMP_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;
const DAY_MS=864e5, KST=9*3600e3;
const GUIDE="공유한 인계는 사감 모두와 운영자(시트)가 봅니다. 학생 이름은 꼭 필요할 때만 쓰세요.";
const READ_FAIL="못 보낸 인계를 읽지 못했습니다 — 최근 인계는 말로 전달하세요";
const CSS=[
".tool.t-ho{background:#0f766e;color:#fff;position:relative}",
".ho-badge{display:none;min-width:20px;height:20px;padding:0 6px;margin-left:6px;border-radius:10px;background:#dc2626;color:#fff;font-size:12px;font-weight:800;line-height:20px;text-align:center}",
".ho-badge.show{display:inline-block}",
".ho-tag{margin-left:6px;font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px}",
".ho-ok{background:#dcfce7;color:#166534}",
".ho-wait{background:#dbeafe;color:#1e40af}",
".ho-warn{background:#fef3c7;color:#92400e}",
".ho-bad{background:#fee2e2;color:#991b1b}",
".ho-card{border:1px solid var(--line,#e5e7eb);border-radius:12px;padding:12px;margin-bottom:10px;background:#fff}",
".ho-card.unread{border:2px solid #0f766e;background:#f0fdfa}",
".ho-meta{font-size:12px;color:var(--sub,#64748b);margin-bottom:6px}",
".ho-body{white-space:pre-wrap;word-break:break-word;font-size:15px;color:var(--ink,#0f172a)}",
".ho-acks{font-size:12px;color:var(--sub,#64748b);margin-top:6px}",
".ho-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}",
".ho-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px}",
".ho-status{flex:1;font-size:13px;color:var(--sub,#64748b)}",
".ho-filter{display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:10px;cursor:pointer}",
".ho-box{border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:13px}",
".ho-box.warn{background:#fef3c7;color:#92400e}",
".ho-box.bad{background:#fee2e2;color:#991b1b}",
".ho-empty{text-align:center;color:var(--sub,#64748b);padding:24px 0;font-size:14px}",
".ho-pop-text{font-size:17px;font-weight:700;text-align:center;padding:8px 0}"
].join("\n");

// ── 순수 함수(시험에서 바로 부름) ──
function okMs(n){return Number.isFinite(n)&&n>=0&&n<=8e15;}
function isStr(x){return typeof x==="string";}
function isObj(x){return !!x&&typeof x==="object"&&!Array.isArray(x);}
function parseJson(s){if(!isStr(s))return undefined;try{return JSON.parse(s);}catch(e){return undefined;}}
function cut(s,n){if(!isStr(s))return "";if(s.length<=n)return s;let t=s.slice(0,n);const c=t.charCodeAt(t.length-1);if(c>=0xd800&&c<=0xdbff)t=t.slice(0,-1);return t;}
function normCode(s){return isStr(s)?s.replace(/[\s-]/g,"").toUpperCase():"";}
function validUrl(u){return isStr(u)&&URL_RE.test(u);}
function validCode(c){return isStr(c)&&CODE_RE.test(c);}
function fnv(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return (h>>>0).toString(16).padStart(8,"0");}
function cfOf(url,code){return fnv(url+"\n"+code);}
function parseCfg(raw){const def={enabled:false,url:"",code:"",place:""};const c=parseJson(raw);if(!isObj(c))return def;
  const url=validUrl(c.url)?c.url:"";const code=validCode(c.code)?c.code:"";
  return {enabled:c.enabled===true&&!!url&&!!code,url,code,place:cut(isStr(c.place)?c.place:"",LIM.place)};}
function ready(cfg){return !!cfg&&!!cfg.url&&!!cfg.code;}
function kstStamp(ms){return new Date(ms+KST).toISOString().slice(0,19)+"+09:00";}
function kstDay(ms){return new Date(ms+KST).toISOString().slice(0,10);}
function validDate(s){if(!isStr(s)||!DATE_RE.test(s))return false;const d=new Date(s+"T00:00:00Z");return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;}
function dayAdd(s,n){return new Date(Date.parse(s+"T00:00:00Z")+n*DAY_MS).toISOString().slice(0,10);}
function stampMs(s){return isStr(s)&&STAMP_RE.test(s)?Date.parse(s):NaN;}
function meOk(me){return isObj(me)&&isStr(me.id)&&SID_RE.test(me.id)&&isStr(me.name)&&me.name.length>=1&&me.name.length<=LIM.name;}

// 공유 전에 서버가 받지 않을 기록을 미리 거름 — 문제 없으면 ""
function preShareCheck(rec,now){
  if(!isObj(rec)||!isStr(rec.id)||!HID_RE.test(rec.id)||!isStr(rec.body)||!rec.body.trim())return "공유할 수 없는 기록입니다 — 공유 체크를 끄세요";
  if(rec.body.length>LIM.body)return "공유는 2000자까지입니다 — 줄이거나 공유 체크를 끄세요";
  const DM="공유는 14일 전부터 내일 날짜까지입니다 — 날짜를 고치거나 공유 체크를 끄세요";
  if(!validDate(rec.date))return DM;
  const diff=Math.round((Date.parse(rec.date+"T00:00:00Z")-Date.parse(kstDay(now)+"T00:00:00Z"))/DAY_MS);
  if(diff<-LIM.listDays||diff>1)return DM;
  if(!isStr(rec.time)||!TIME_RE.test(rec.time))return "공유하려면 시각을 00:00 모양으로 적어 주세요 — 시각을 고치거나 공유 체크를 끄세요";
  return "";
}

// 서버 응답 판정: ok·net·auth·reject(다시 보내도 안 됨)·retry(나중에 다시)
function judge(res,shapeOk){
  if(!res||res.kind!=="resp")return {k:"net"};
  const b=res.body;if(res.status!==200||!isObj(b))return {k:"retry",msg:"서버 응답이 이상합니다"};
  if(b.ok===true){let good=false;try{good=meOk(b.me)&&(!shapeOk||!!shapeOk(b));}catch(e){}
    return good?{k:"ok",body:b,me:{id:b.me.id,name:b.me.name}}:{k:"retry",msg:"서버 응답이 이상합니다"};}
  if(b.error==="auth")return {k:"auth"};
  if(b.error==="bad"||b.error==="forbidden")return {k:"reject",err:b.error,msg:cut((isStr(b.message)?b.message.trim():"")||"서버가 받지 않았습니다",LIM.msg)};
  if(b.error==="busy")return {k:"retry",msg:"서버가 바쁩니다"};
  return {k:"retry",msg:"서버 오류"};
}

function cleanAck(a){
  if(!isObj(a)||!isStr(a.sid)||!SID_RE.test(a.sid)||(a.kind!=="ack"&&a.kind!=="done")||!isStr(a.at)||!STAMP_RE.test(a.at))return null;
  if(!isStr(a.name)||a.name.length>LIM.name||!isStr(a.memo)||a.memo.length>LIM.memo)return null;
  return {sid:a.sid,name:a.name,kind:a.kind,at:a.at,memo:a.kind==="done"?a.memo:""};
}
function cleanItem(x){
  if(!isObj(x)||!isStr(x.id)||!HID_RE.test(x.id)||!isStr(x.at)||!STAMP_RE.test(x.at)||!isStr(x.sid)||!SID_RE.test(x.sid)||!isStr(x.body)||x.body.length>LIM.body)return null;
  if(!validDate(x.date)||!isStr(x.time)||!TIME_RE.test(x.time)||!isStr(x.place)||x.place.length>LIM.place||!isStr(x.name)||x.name.length>LIM.name)return null;
  const acks=[],seen=new Set();
  if(Array.isArray(x.acks))for(const a of x.acks.slice(0,500)){const c=cleanAck(a);if(!c)continue;const k=c.sid+"|"+c.kind;if(seen.has(k))continue;seen.add(k);acks.push(c);}
  return {id:x.id,at:x.at,date:x.date,time:x.time,place:x.place,sid:x.sid,name:x.name,body:x.body,acks};
}
function cleanList(items){
  if(!Array.isArray(items))return [];
  const out=[],seen=new Set();
  for(const x of items.slice(0,1000)){const c=cleanItem(x);if(!c||seen.has(c.id))continue;seen.add(c.id);out.push(c);}
  out.sort((a,b)=>a.at<b.at?1:a.at>b.at?-1:0);
  return out.slice(0,LIM.cache);
}

// 다른 연결(주소·코드)에서 만든 보낼 항목인지 — 같은 사감 번호면 내 것으로 봄
function isForeign(x,cf,me){return x.cf!==cf&&!(x.me&&me&&x.me===me.id);}

// 받아 둔 목록 + 아직 못 보낸 내 항목을 합친 화면용 목록
function mergeView(cache,box,cf,me,now){
  const from=kstStamp(now-LIM.listDays*DAY_MS);
  let items=(cache&&Array.isArray(cache.items)?cache.items:[]).filter(it=>it.at>=from).map(it=>Object.assign({},it,{acks:it.acks.map(a=>Object.assign({},a))}));
  for(const x of (Array.isArray(box)?box:[])){
    if(isForeign(x,cf,me))continue;
    const d=x.data;
    if(x.op==="withdraw"){items=items.filter(it=>it.id!==x.id);continue;}
    if(x.op==="post"){if(items.some(it=>it.id===x.id))continue;
      items.push({id:x.id,at:kstStamp(x.at),date:d.date,time:d.time,place:d.place.trim(),sid:me?me.id:"",name:me?me.name:"나",body:d.body,acks:[],pending:true});continue;}
    if(x.op==="ack"){const it=items.find(i=>i.id===x.id);const sid=me?me.id:"";
      if(it&&!it.acks.some(a=>a.sid===sid&&a.kind===d.kind))it.acks.push({sid,name:me?me.name:"나",kind:d.kind,at:kstStamp(x.at),memo:d.kind==="done"?(d.memo||""):"",pending:true});}
  }
  items.sort((a,b)=>a.at<b.at?1:a.at>b.at?-1:0);
  return items;
}
function isUnread(it,me,now){
  if(!me||it.pending||it.sid===me.id)return false;
  if(!(stampMs(it.at)>=now-LIM.unreadDays*DAY_MS))return false;
  if(it.acks.some(a=>a.kind==="done"))return false;
  if(it.acks.some(a=>a.sid===me.id))return false;
  return true;
}

// 보낼 목록 한 항목의 모양 검사
function validOx(x){
  if(!isObj(x)||!isStr(x.id)||!HID_RE.test(x.id)||!isStr(x.cf)||!CF_RE.test(x.cf)||!isObj(x.data)||x.data.id!==x.id)return false;
  if(!Number.isInteger(x.tries)||x.tries<0||!okMs(x.at))return false;
  if(!(x.me===null||(isStr(x.me)&&SID_RE.test(x.me))))return false;
  if(x.firstFail!==undefined&&!okMs(x.firstFail))return false;
  if(x.msg!==undefined&&!isStr(x.msg))return false;
  if(x.att!==undefined&&x.att!==true)return false;
  const d=x.data;
  if(x.op==="post")return x.oid==="p:"+x.id&&isStr(d.body)&&isStr(d.date)&&isStr(d.time)&&isStr(d.place);
  if(x.op==="ack")return (d.kind==="ack"||d.kind==="done")&&x.oid===`a:${x.id}:${d.kind}`&&(d.memo===undefined||isStr(d.memo));
  if(x.op==="withdraw")return x.oid==="w:"+x.id;
  return false;
}

// 브라우저에서 쓰는 환경(시험에서는 가짜 환경을 넣음)
function browserEnv(win){
  const ls=()=>win.localStorage;
  return {
    store:{get:k=>ls().getItem(k),set:(k,v)=>ls().setItem(k,v),remove:k=>ls().removeItem(k)},
    fetch:(u,o)=>win.fetch(u,o), now:()=>Date.now(),
    setTimeout:(f,ms)=>win.setTimeout(f,ms),clearTimeout:t=>win.clearTimeout(t),setInterval:(f,ms)=>win.setInterval(f,ms),clearInterval:t=>win.clearInterval(t),
    AbortController:win.AbortController||null, doc:win.document||null,
    confirm:m=>win.confirm(m),alert:m=>win.alert(m),prompt:(m,d)=>win.prompt(m,d),
    notify:m=>{if(typeof win.toast==="function")win.toast(m);else win.alert(m);},
    locks:win.navigator&&win.navigator.locks&&typeof win.navigator.locks.request==="function"?win.navigator.locks:null,
    listen:f=>{win.addEventListener("storage",f);return ()=>{win.removeEventListener("storage",f);};},
    showOv:id=>{if(typeof win.showOv==="function")win.showOv(id);else{const e=win.document.getElementById(id);if(e)e.classList.add("show");}},
    closeOv:id=>{if(typeof win.closeOv==="function")win.closeOv(id);else{const e=win.document.getElementById(id);if(e)e.classList.remove("show");}}
  };
}

function create(env){
  const S={cfg:null,on:false,gen:0,runCf:"",started:false,timer:null,timers:new Set(),visH:null,kindH:null,addH:null,tseq:0,stOff:null,inflight:new Set(),syncing:null,syncGen:-1,again:false,
    lastOk:0,lastErr:"",lastFetchAt:0,cache:null,me:null,authBlocked:"",popupShown:false,popTries:0,localFail:new Set(),onlyUnread:false,alerted:false};

  // ── 저장소: 읽기 실패(undefined)와 없음(null)을 구분, 쓰기는 다시 읽어 확인 ──
  function rd(k){try{const v=env.store.get(k);return v==null?null:v;}catch(e){return undefined;}}
  function wr(k,v){try{env.store.set(k,v);return env.store.get(k)===v;}catch(e){return false;}}
  function rm(k){try{env.store.remove(k);return env.store.get(k)==null;}catch(e){return false;}}
  function readCfg(){return parseCfg(rd(K.cfg));}
  function loadCfg(){S.cfg=readCfg();return S.cfg;}
  function say(m){try{env.notify(m);}catch(e){}}
  function ask(m){try{return !!env.confirm(m);}catch(e){return false;}}
  function alertMsg(m){try{env.alert(m);}catch(e){}}
  function alertOnce(m){if(S.alerted)return;S.alerted=true;alertMsg(m);}

  function loadCache(){const c=parseJson(rd(K.cache));if(!isObj(c)||c.cf!==S.runCf||!meOk(c.me))return null;
    return {cf:c.cf,me:{id:c.me.id,name:c.me.name},items:cleanList(c.items),at:okMs(c.at)?c.at:0};}
  function saveCache(){if(!S.cache)return;S.cache.me=S.me;if(!wr(K.cache,JSON.stringify(S.cache)))rm(K.cache);}
  // 저장 공간이 모자랄 때 가장 덜 중요한 받아 둔 목록부터 비움(일지·보낼 목록 저장을 위해 — 꺼져 있어도 지우기만 함)
  function freeSpace(){S.cache=null;return rm(K.cache);}
  function wrKeep(k,v){return wr(k,v)||(freeSpace()&&wr(k,v));}

  // ── 보낼 목록(outbox): 바꾸는 길은 editOutbox 하나 ──
  function peekOutbox(){const a=parseJson(rd(K.outbox));if(!Array.isArray(a))return [];const seen=new Set(),out=[];
    for(const x of a){if(validOx(x)&&!seen.has(x.oid)){seen.add(x.oid);out.push(x);}}return out;}
  function readOutbox(){
    const raw=rd(K.outbox);if(raw===undefined){alertOnce(READ_FAIL);return null;}if(raw===null)return [];
    const arr=parseJson(raw);const good=[],bad=[];
    if(!Array.isArray(arr))bad.push(raw);
    else{const seen=new Set();for(const x of arr){if(validOx(x)&&!seen.has(x.oid)){seen.add(x.oid);good.push(x);}
      else{let s;try{s=JSON.stringify(x);}catch(e){s=undefined;}bad.push(s===undefined?String(x):s);}}}
    if(!bad.length)return good;
    const prevRaw=rd(K.bad);if(prevRaw===undefined){alertOnce(READ_FAIL);return null;}
    let prev=prevRaw===null?[]:parseJson(prevRaw);if(!Array.isArray(prev))prev=[{at:0,raw:prevRaw}];
    const now=env.now();const next=prev.concat(bad.map(r=>({at:now,raw:r})));
    if(!wrKeep(K.bad,JSON.stringify(next))||!writeBox(good)){alertOnce(READ_FAIL);return null;}
    say("못 보낸 인계 일부가 깨져 따로 보관했습니다 — 최근 인계는 말로 전달하세요");
    return good;
  }
  function writeBox(arr){return arr.length?wrKeep(K.outbox,JSON.stringify(arr)):rm(K.outbox);}
  function editOutbox(fn){const box=readOutbox();if(box===null)return {ok:false,changed:false};let next;
    try{next=fn(box.slice());}catch(e){return {ok:false,changed:false};}
    if(next==null)return {ok:true,changed:false};if(!writeBox(next))return {ok:false,changed:false};return {ok:true,changed:true};}
  function oxAdd(x){let res="fail";const r=editOutbox(box=>{if(box.some(y=>y.oid===x.oid)){res="dup";return null;}
      if(box.filter(y=>y.op!=="withdraw").length>=LIM.outbox){res="full";return null;}
      box.push(x);res="ok";return box;});
    return r.ok?res:"fail";}
  // 보내기 시작 표식 — 표식 없이 남은 공유는 서버에 간 적이 없으므로 취소할 때 목록에서 그냥 지움
  function markAtt(oid){let ok=false;const r=editOutbox(box=>{const y=box.find(z=>z.oid===oid);if(!y)return null;ok=true;if(y.att)return null;y.att=true;return box;});
    return r.ok&&ok;}
  function oxRemove(oid){return editOutbox(box=>{const i=box.findIndex(x=>x.oid===oid);if(i<0)return null;box.splice(i,1);return box;});}
  function bump(oid,msg){editOutbox(box=>{const x=box.find(y=>y.oid===oid);if(!x)return null;x.tries+=1;if(x.firstFail===undefined)x.firstFail=env.now();x.msg=cut(String(msg||""),LIM.msg);return box;});}

  // ── 공유됨 표시·서버가 받지 않은 목록 ──
  function readShared(){const raw=rd(K.shared);if(raw===undefined)return null;const m=Object.create(null);const o=parseJson(raw);
    if(isObj(o))for(const k of Object.keys(o)){if(HID_RE.test(k)&&Number.isFinite(o[k]))m[k]=o[k];}return m;}
  function markShared(id){const m=readShared();if(!m)return false;const lim=env.now()-LIM.keepDays*DAY_MS;
    for(const k of Object.keys(m))if(!(m[k]>=lim))delete m[k];m[id]=env.now();return wrKeep(K.shared,JSON.stringify(m));}
  function unmarkShared(id){const m=readShared();if(!m||!(id in m))return;delete m[id];if(Object.keys(m).length)wr(K.shared,JSON.stringify(m));else rm(K.shared);}
  function readFailed(){const raw=rd(K.failed);if(raw===undefined)return null;const a=parseJson(raw);if(!Array.isArray(a))return [];
    return a.filter(x=>isObj(x)&&isStr(x.op)&&isStr(x.id)&&isStr(x.msg)&&isStr(x.snip));}
  function addFailed(x,msg){const f=readFailed();if(!f)return false;let src=x.op==="post"?x.data.body:"";
    if(x.op!=="post"&&S.cache){const it=S.cache.items.find(i=>i.id===x.id);if(it)src=it.body;}
    const snip=cut(String(src||"").replace(/\s+/g," ").trim(),40);
    // 가득 차면 옛 기록을 밀어내지 않고 실패로 돌려줌 — 원래 항목은 보낼 목록에 남음
    if(f.length>=LIM.failed)return false;
    f.push({op:x.op,id:x.id,kind:x.op==="ack"?x.data.kind:"",snip,msg:cut(String(msg||""),LIM.msg),at:env.now()});
    return wr(K.failed,JSON.stringify(f));}
  function clearFailed(){return rm(K.failed);}

  // ── 서버 호출(시간 제한 15초, 끄면 중단) ──
  function call(snap,op,data){return new Promise(resolve=>{let done=false,ctl=null,t=null;
    const stop=()=>{try{if(ctl)ctl.abort();}catch(e){}fin({kind:"net"});};
    const fin=r=>{if(done)return;done=true;try{env.clearTimeout(t);}catch(e){}S.inflight.delete(stop);resolve(r);};
    try{
      S.inflight.add(stop);
      if(env.AbortController)ctl=new env.AbortController();
      t=env.setTimeout(stop,LIM.timeout);
      const p=env.fetch(snap.url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({op,code:snap.code,data}),
        cache:"no-store",credentials:"omit",redirect:"follow",signal:ctl?ctl.signal:undefined});
      Promise.resolve(p).then(r=>r.text().then(t2=>({kind:"resp",status:r.status,body:parseJson(t2)}))).then(fin,()=>fin({kind:"net"}));
    }catch(e){fin({kind:"net"});}
  });}

  function snapNow(){return {gen:S.gen,cf:S.runCf,url:S.cfg.url,code:S.cfg.code,place:S.cfg.place};}
  // 다른 창에서 끄기·지우기·코드 변경을 했으면 여기서 멈춤(설정을 읽지 못할 때는 하던 대로 — 끈 것과 구별)
  function still(snap){if(!S.on||S.gen!==snap.gen)return false;const raw=rd(K.cfg);if(raw===undefined)return true;
    const c=parseCfg(raw);if(c.enabled&&cfOf(c.url,c.code)===snap.cf)return true;apply();return false;}
  function learnMe(me){
    if(S.me&&S.me.id===me.id&&S.me.name===me.name)return;
    if((!S.me||S.me.id!==me.id)&&peekOutbox().some(x=>x.cf!==S.runCf&&x.me===me.id))S.again=true;
    S.me={id:me.id,name:me.name};
    if(S.cache)saveCache();
  }

  function cacheAdd(x){if(!S.cache||!S.me)return;const d=x.data;if(S.cache.items.some(i=>i.id===d.id))return;
    S.cache.items.unshift({id:d.id,at:kstStamp(env.now()),date:d.date,time:d.time,place:d.place.trim(),sid:S.me.id,name:S.me.name,body:d.body,acks:[]});
    S.cache.items=S.cache.items.slice(0,LIM.cache);saveCache();}
  function cacheAck(x){if(!S.cache||!S.me)return;const d=x.data;const it=S.cache.items.find(i=>i.id===d.id);
    if(!it||it.acks.some(a=>a.sid===S.me.id&&a.kind===d.kind))return;
    it.acks.push({sid:S.me.id,name:S.me.name,kind:d.kind,at:kstStamp(env.now()),memo:d.kind==="done"?(d.memo||"").trim():""});saveCache();}
  function cacheDrop(id){if(!S.cache)return;const n=S.cache.items.length;S.cache.items=S.cache.items.filter(i=>i.id!==id);if(S.cache.items.length!==n)saveCache();}
  // 공유됨 표시를 남기지 못하면 보낼 목록에서 지우지 않음(다음에 다시 보내면 서버는 같은 글로 받음)
  function onSent(x){
    if(x.op==="post"){if(!markShared(x.id)){say("저장 공간 부족 — 공유 표시를 남기지 못해 나중에 다시 확인합니다");return false;}oxRemove(x.oid);cacheAdd(x);}
    else if(x.op==="ack"){oxRemove(x.oid);cacheAck(x);}
    else{unmarkShared(x.id);oxRemove(x.oid);cacheDrop(x.id);}
    return true;
  }

  // 보낼 목록을 앞에서부터 하나씩 보냄 — 같은 인계 번호는 앞 항목이 막히면 뒤도 멈춤
  async function sendAll(snap){
    const tried=new Set(),skip=new Set();let rejected=0;
    for(;;){
      if(!still(snap))return "stale";
      const box=readOutbox();if(box===null)return "local";
      let x=null;
      for(const y of box){if(tried.has(y.oid)||skip.has(y.id))continue;if(isForeign(y,snap.cf,S.me)){skip.add(y.id);continue;}x=y;break;}
      if(!x)break;
      tried.add(x.oid);
      if(x.op==="post"&&!x.att&&!markAtt(x.oid)){skip.add(x.id);continue;}
      const j=judge(await call(snap,x.op,x.data),null);
      if(!still(snap))return "stale";
      if(j.k==="net")return "net";
      if(j.k==="auth")return "auth";
      if(j.k==="ok"){learnMe(j.me);if(!onSent(x))skip.add(x.id);continue;}
      if(j.k==="reject"){
        if(x.op==="withdraw"&&j.err==="bad"){oxRemove(x.oid);unmarkShared(x.id);cacheDrop(x.id);continue;}
        rejected++;
        if(addFailed(x,j.msg))oxRemove(x.oid);else{bump(x.oid,j.msg);skip.add(x.id);}
        continue;
      }
      bump(x.oid,j.msg);skip.add(x.id);S.lastErr=j.msg;
    }
    if(rejected&&still(snap))say("서버가 받지 않은 인계가 있습니다 — 인계함에서 확인하세요");
    return "done";
  }
  async function fetchList(snap){
    const j=judge(await call(snap,"list",{}),b=>Array.isArray(b.items));
    if(!still(snap))return;
    if(j.k==="ok"){learnMe(j.me);S.cache={cf:snap.cf,me:S.me,items:cleanList(j.body.items),at:env.now()};saveCache();
      S.lastOk=env.now();S.lastErr="";S.authBlocked="";refreshUI();schedulePopup();return;}
    if(j.k==="auth"){onAuth();return;}
    S.lastErr=j.k==="net"?"연결 안 됨":(j.msg||"서버 오류");refreshUI();
  }
  function onAuth(){S.authBlocked=S.runCf;S.cache=null;S.me=null;rm(K.cache);S.lastErr="개인 코드를 확인하세요";refreshUI();}
  // 코드가 막힌 동안은 보내지 않고 목록만 물어봄 — 다시 통하면 그때 보냄
  async function syncOnce(snap){
    if(!S.authBlocked){
      const r=await sendAll(snap);
      if(r==="stale"||!still(snap))return;
      if(r==="auth"){onAuth();return;}
      if(r==="net"){S.lastErr="연결 안 됨";refreshUI();return;}
    }
    const was=S.authBlocked;
    await fetchList(snap);
    if(was&&!S.authBlocked&&still(snap))S.again=true;
  }
  function runLocked(fn){
    const L=env.locks;if(!L)return Promise.resolve().then(fn);
    let ran=false;
    try{return Promise.resolve(L.request("handover-sync",()=>{ran=true;return fn();})).catch(()=>{if(!ran)return fn();});}
    catch(e){return Promise.resolve().then(fn);}
  }
  function sync(){
    if(!S.on)return Promise.resolve();
    if(S.syncing&&S.syncGen===S.gen){S.again=true;return S.syncing;}
    S.lastFetchAt=env.now();
    const gen=S.gen;
    const p=(async()=>{await null;let n=0;
      try{do{S.again=false;if(!S.on||S.gen!==gen)break;
          await runLocked(()=>(S.on&&S.gen===gen)?syncOnce(snapNow()):undefined);n++;
        }while(S.again&&n<=LIM.rerun&&S.on&&S.gen===gen);
      }catch(e){}finally{if(S.syncing===p)S.syncing=null;}
    })();
    S.syncing=p;S.syncGen=gen;
    return p;
  }

  // ── 켜기·끄기 ──
  function start(){if(S.started)return;S.started=true;apply();}
  function apply(){const cfg=loadCfg();const cf=cfg.enabled?cfOf(cfg.url,cfg.code):"";
    if(S.on&&cf!==S.runCf)teardown();
    if(cfg.enabled&&!S.on)turnOn(cf);else if(S.on)refreshUI();
    updateSettingsStatus();}
  function turnOn(cf){S.on=true;S.gen++;S.runCf=cf;S.authBlocked="";S.lastErr="";S.cache=loadCache();S.me=S.cache?S.cache.me:null;S.lastOk=S.cache?S.cache.at:0;
    buildUI();
    S.timer=env.setInterval(()=>{sync();},LIM.interval);
    if(env.doc){S.visH=()=>{try{if(env.doc.visibilityState==="visible"&&env.now()-S.lastFetchAt>LIM.visibleGap)sync();}catch(e){}};env.doc.addEventListener("visibilitychange",S.visH);}
    if(env.listen){try{S.stOff=env.listen(e=>{try{if(!e||e.key===null||e.key===K.cfg)apply();}catch(x){}});}catch(e){S.stOff=null;}}
    refreshUI();sync();}
  function teardown(){S.on=false;S.gen++;
    if(S.timer!=null){try{env.clearInterval(S.timer);}catch(e){}S.timer=null;}
    S.timers.forEach(t=>{try{env.clearTimeout(t);}catch(e){}});S.timers.clear();
    if(S.visH&&env.doc){try{env.doc.removeEventListener("visibilitychange",S.visH);}catch(e){}}S.visH=null;
    if(S.stOff){try{S.stOff();}catch(e){}S.stOff=null;}
    abortAll();
    S.cache=null;S.me=null;S.runCf="";S.lastErr="";S.authBlocked="";S.lastOk=0;S.again=false;S.popTries=0;
    removeUI();}
  function abortAll(){[...S.inflight].forEach(f=>{try{f();}catch(e){}});S.inflight.clear();}
  function later(fn,ms){const t=env.setTimeout(()=>{S.timers.delete(t);try{fn();}catch(e){}},ms);S.timers.add(t);return t;}

  // ── 설정 ──
  function saveCfg(o){
    o=isObj(o)?o:{};const cur=readCfg();const url=isStr(o.url)?o.url.trim():"";
    if(!validUrl(url))return "웹 앱 주소가 맞지 않습니다 — https://script.google.com/macros/s/…/exec 모양이어야 합니다";
    let code=normCode(o.code);if(!code){if(!cur.code)return "개인 코드를 적어 주세요";code=cur.code;}
    if(code.length!==12)return "개인 코드는 12자입니다(줄표는 빼도 됩니다)";
    if(!CODE_RE.test(code))return "개인 코드에 쓰지 않는 글자가 있습니다(영문 I·O, 숫자 0·1은 없습니다)";
    const place=isStr(o.place)?o.place.trim():"";if(place.length>LIM.place)return "근무지는 30자까지입니다";
    const cfOld=ready(cur)?cfOf(cur.url,cur.code):"",cfNew=cfOf(url,code);
    if(cfOld&&cfOld!==cfNew&&peekOutbox().length&&!ask("아직 보내지 못한 인계가 있을 수 있습니다 — 연결을 바꾸면 인계함에서 [지금 연결로 보내기]를 눌러야 보내집니다. 바꿀까요?"))return "바꾸지 않았습니다";
    if(!wr(K.cfg,JSON.stringify({enabled:cur.enabled,url,code,place})))return "설정을 저장하지 못했습니다(저장 공간)";
    if(cfOld!==cfNew){abortAll();S.tseq++;rm(K.cache);}
    apply();return "저장했습니다";
  }
  function setEnabled(on){const cur=readCfg();if(on&&!ready(cur))return "주소와 개인 코드를 먼저 저장하세요";
    const v=JSON.stringify({enabled:!!on,url:cur.url,code:cur.code,place:cur.place});
    if(on){if(!wr(K.cfg,v))return "설정을 저장하지 못했습니다(저장 공간)";apply();return "켰습니다";}
    // 끄기는 저장보다 먼저 멈춤 — 저장 공간이 없으면 받아 둔 목록을 비우고, 그래도 안 되면 설정을 지움
    if(S.on)teardown();
    if(rd(K.cfg)==null||wrKeep(K.cfg,v)){apply();return "껐습니다";}
    if(rm(K.cfg)){apply();return "껐습니다 — 저장 공간이 부족해 설정을 지웠습니다(다시 켜려면 주소·코드를 다시 적으세요)";}
    updateSettingsStatus();return "끄지 못했습니다(저장 공간) — 지금은 멈췄지만 앱을 다시 열면 켜집니다";}
  function clearSettings(){const n=peekOutbox().length;
    if(!ask("인계 공유 설정(주소·개인 코드)을 지울까요?"+(n?` 아직 보내지 못한 인계 ${n}건은 남겨 두지만, 다시 설정하기 전까지 보내지 않습니다.`:"")))return "";
    if(!rm(K.cfg))return "설정을 지우지 못했습니다(저장 공간)";
    abortAll();S.tseq++;rm(K.cache);apply();return "지웠습니다";}
  async function testConnection(){const cfg=readCfg();if(!ready(cfg))return "주소와 개인 코드를 먼저 저장하세요";
    const j=judge(await call({url:cfg.url,code:cfg.code},"list",{}),b=>Array.isArray(b.items));
    if(j.k==="ok")return `${j.me.name} 님으로 연결됨`;
    if(j.k==="net")return "연결 안 됨 — 인터넷과 웹 앱 주소(배포 권한 ‘모든 사용자’)를 확인하세요";
    if(j.k==="auth"){if(S.on&&cfOf(cfg.url,cfg.code)===S.runCf)onAuth();return "개인 코드를 확인하세요 — 코드가 틀렸거나 중지된 사감입니다";}
    if(j.k==="retry"&&j.msg==="서버가 바쁩니다")return "서버가 바쁩니다 — 잠시 뒤 다시 시험하세요";
    return "서버 응답이 이상합니다 — 운영자에게 알려 주세요";}

  // ── 이전 연결에서 멈춘 항목 ──
  function foreignItems(){return S.on?peekOutbox().filter(x=>isForeign(x,S.runCf,S.me)):[];}
  function adoptForeign(){if(!S.on||!S.me)return "연결을 확인한 뒤 다시 누르세요";const n=foreignItems().length;if(!n)return "";
    if(!ask(`이전 연결에서 못 보낸 인계 ${n}건을 지금 연결(${S.me.name} 님)로 보낼까요?`))return "";
    const cf=S.runCf,me=S.me;const r=editOutbox(box=>box.map(x=>isForeign(x,cf,me)?Object.assign({},x,{cf,me:me.id}):x));
    if(!r.ok)return "보내기 예약 실패 — 다시 시도하거나 말로 전달하세요";
    refreshUI();sync();return "";}
  function dropForeign(){if(!S.on)return "";const n=foreignItems().length;if(!n)return "";
    if(!ask(`이전 연결에서 만든 인계 ${n}건을 버릴까요? 서버로 보내지 않고 지웁니다.`))return "";
    const cf=S.runCf,me=S.me;const r=editOutbox(box=>box.filter(x=>!isForeign(x,cf,me)));
    if(!r.ok)return "지우지 못했습니다(저장 공간)";
    refreshUI();return "";}

  // ── 사용자 동작 ──
  function ack(id,kind,memo){if(!S.on||!isStr(id)||!HID_RE.test(id)||(kind!=="ack"&&kind!=="done"))return "";let m="";
    if(kind==="done"){m=String(memo==null?"":memo).trim();if(m.length>LIM.memo){m=cut(m,LIM.memo);say("메모는 200자까지라 뒤를 잘랐습니다");}}
    const r=oxAdd({oid:`a:${id}:${kind}`,op:"ack",id,cf:S.runCf,me:S.me?S.me.id:null,data:{id,kind,memo:m},at:env.now(),tries:0});
    if(r==="fail"||r==="full")return "확인 예약 실패 — 다시 시도하거나 말로 전달하세요";
    refreshUI();sync();return "";}
  // 서버에 간 적 없는 공유(보내기 시작 표식·시도·공유됨 기록이 모두 없음)는 목록에서 지우기만 하고, 나머지는 취소를 덧붙임
  function withdraw(id){if(!S.on||!isStr(id)||!HID_RE.test(id))return "";
    const sh=readShared();const known=!sh||!!sh[id]||!!(S.cache&&S.cache.items.some(i=>i.id===id));
    let res="fail";
    const r=editOutbox(box=>{const p=box.find(x=>x.oid==="p:"+id);
      if(p&&!known&&!p.att&&p.tries===0&&p.firstFail===undefined){res="ok";return box.filter(x=>x.id!==id);}
      if(box.some(x=>x.oid==="w:"+id)){res="dup";return null;}
      if(box.length>=LIM.outboxWd){res="full";return null;}
      box.push({oid:"w:"+id,op:"withdraw",id,cf:S.runCf,me:S.me?S.me.id:null,data:{id},at:env.now(),tries:0});res="ok";return box;});
    if(!r.ok||res==="full"){const m="공유 취소 예약 실패 — 다시 시도하거나 말로 전달하세요";alertMsg(m);return m;}
    refreshUI();sync();return "";}
  function share(rec){if(!S.on)return "";const id=isObj(rec)&&isStr(rec.id)?rec.id:"";
    const fail=m=>{if(id)S.localFail.add(id);refreshUI();alertMsg(m);return m;};
    const m=preShareCheck(rec,env.now());if(m)return fail(m);
    const r=oxAdd({oid:"p:"+rec.id,op:"post",id:rec.id,cf:S.runCf,me:S.me?S.me.id:null,
      data:{id:rec.id,date:rec.date,time:rec.time,place:(S.cfg&&S.cfg.place)||"",body:rec.body},at:env.now(),tries:0});
    if(r==="full")return fail("못 보낸 인계가 50건이라 더 예약할 수 없습니다 — 인터넷 연결을 확인하고, 이 인계는 말로 전달하세요");
    if(r==="fail")return fail("공유 예약 실패 — 다시 시도하거나 말로 전달하세요");
    S.localFail.delete(rec.id);refreshUI();sync();return "";}
  function beforeAdd(rec){if(!S.on||!env.doc||!isObj(rec)||rec.kind!=="인계사항")return null;const chk=byId("ho-share-chk");if(!chk)return null;
    if(!chk.checked){chk.checked=true;return null;}
    const m=preShareCheck(rec,env.now());return m?{block:true,msg:m}:{share:true};}
  function isShared(id){if(!S.on||!isStr(id))return false;
    if(peekOutbox().some(x=>x.op==="post"&&x.id===id))return true;
    const m=readShared();if(m&&m[id])return true;
    return !!(S.cache&&S.me&&S.cache.items.some(i=>i.id===id&&i.sid===S.me.id));}

  // ── 표시 ──
  function tagCtx(){return {box:peekOutbox(),failed:new Set((readFailed()||[]).filter(f=>f.op==="post").map(f=>f.id)),shared:readShared()||Object.create(null),
    mine:new Set(S.cache&&S.me?S.cache.items.filter(i=>i.sid===S.me.id).map(i=>i.id):[])};}
  function tagOf(id,ctx){
    if(ctx.failed.has(id))return ["못 보냄(형식)","ho-bad"];
    if(S.localFail.has(id))return ["못 보냄","ho-bad"];
    if(ctx.box.some(x=>x.op==="withdraw"&&x.id===id))return ["공유 취소 중","ho-wait"];
    const p=ctx.box.find(x=>x.op==="post"&&x.id===id);
    if(p){if(isForeign(p,S.runCf,S.me))return ["보내기 멈춤 — 인계함 확인","ho-warn"];if(p.tries>LIM.tries)return ["보내는 중 — 문제 있음","ho-warn"];return ["보내는 중","ho-wait"];}
    if(ctx.shared[id]||ctx.mine.has(id))return ["📨 공유됨","ho-ok"];
    return null;
  }
  function view(){return S.on?mergeView(S.cache,peekOutbox(),S.runCf,S.me,env.now()):[];}
  function unreadCount(){if(!S.on||!S.me)return 0;const now=env.now();return view().filter(it=>isUnread(it,S.me,now)).length;}

  // ── 화면 조각(서버 글은 textContent로만) ──
  function byId(id){try{return env.doc?env.doc.getElementById(id):null;}catch(e){return null;}}
  function isShown(id){const e=byId(id);return !!e&&e.classList.contains("show");}
  function val(id){const e=byId(id);return e?String(e.value||""):"";}
  function setVal(id,v){const e=byId(id);if(e)e.value=v;}
  function setMsg(m){S.tseq++;const e=byId("ho-set-msg");if(e)e.textContent=m||"";}
  // 연결 시험 — 기다리는 사이 다른 설정 문구(저장·켜기·끄기·지우기·창 다시 열기)가 나왔으면 늦게 온 결과는 버림
  function runTest(){setMsg("연결 시험 중…");const my=S.tseq;const done=m=>{if(S.tseq===my)setMsg(m);};
    return testConnection().then(done,()=>done("연결 시험 실패"));}
  function el(tag,attrs,kids){const d=env.doc;const n=d.createElement(tag);
    if(attrs)for(const k of Object.keys(attrs)){const v=attrs[k];
      if(v==null||v===false)continue;
      if(k==="class")n.className=v;
      else if(k==="style")n.style.cssText=v;
      else if(k==="checked"||k==="value")n[k]=v;
      else if(k.slice(0,2)==="on"&&typeof v==="function")n.addEventListener(k.slice(2),function(ev){try{v.call(n,ev);}catch(e){}});
      else n.setAttribute(k,String(v));}
    if(kids!=null)for(const c of (Array.isArray(kids)?kids:[kids])){if(c==null||c===false)continue;n.appendChild(isStr(c)?d.createTextNode(c):c);}
    return n;}
  function btn(text,cls,fn,small){return el("button",{type:"button",class:"btn "+cls,style:small?"flex:0 0 auto;height:38px;font-size:14px;padding:0 14px":null,onclick:fn},[text]);}
  function ensureStyle(){if(byId("ho-style"))return;(env.doc.head||env.doc.body).appendChild(el("style",{id:"ho-style"},[CSS]));}
  function buildUI(){if(!env.doc)return;try{ensureStyle();
    if(!byId("ho-btn")){const b=el("button",{type:"button",id:"ho-btn",class:"tool t-ho",onclick:()=>open()},["📨 인계함",el("span",{id:"ho-badge",class:"ho-badge"})]);
      const fs=byId("fs-btn");if(fs&&fs.parentNode)fs.parentNode.insertBefore(b,fs);else{const tb=env.doc.querySelector(".toolbar");if(tb)tb.appendChild(b);}}
    const slot=byId("ho-share-slot");
    if(slot&&!byId("ho-share-wrap"))slot.appendChild(el("label",{id:"ho-share-wrap",class:"hint",style:"display:none;align-items:center;gap:8px;cursor:pointer;margin-bottom:10px"},
      [el("input",{type:"checkbox",id:"ho-share-chk",checked:true,style:"width:20px;height:20px;margin:0"}),"📨 다른 사감과 공유"]));
    const k=byId("jr-kind");if(k&&!S.kindH){S.kindH=()=>{try{updateShareSlot();}catch(e){}};k.addEventListener("change",S.kindH);}
    // 일지 추가 창을 열 때마다 공유 체크를 기본(켜짐)으로 — [취소]로 닫아도 끈 체크가 다음 인계에 남지 않게
    const ab=byId("jr-add-btn");if(ab&&!S.addH){S.addH=()=>{try{const c=byId("ho-share-chk");if(c)c.checked=true;}catch(e){}};ab.addEventListener("click",S.addH);}
    updateShareSlot();}catch(e){}}
  function updateShareSlot(){const w=byId("ho-share-wrap");if(!w)return;const k=byId("jr-kind");w.style.display=S.on&&k&&k.value==="인계사항"?"flex":"none";}
  function removeUI(){if(!env.doc)return;try{
    for(const id of ["ho-inbox","ho-pop"])if(isShown(id))env.closeOv(id);
    for(const id of ["ho-btn","ho-share-wrap","ho-inbox","ho-pop","ho-style"]){const e=byId(id);if(e&&e.parentNode)e.parentNode.removeChild(e);}
    env.doc.querySelectorAll(".ho-tag").forEach(e=>{if(e.parentNode)e.parentNode.removeChild(e);});
    const k=byId("jr-kind");if(k&&S.kindH)k.removeEventListener("change",S.kindH);S.kindH=null;
    const ab=byId("jr-add-btn");if(ab&&S.addH)ab.removeEventListener("click",S.addH);S.addH=null;
    updateSettingsStatus();}catch(e){}}
  function decorate(box){if(!S.on||!env.doc)return;box=box||byId("jr-list");if(!box)return;const ctx=tagCtx();
    box.querySelectorAll(".log-item[data-id]").forEach(item=>{
      item.querySelectorAll(".ho-tag").forEach(t=>{if(t.parentNode)t.parentNode.removeChild(t);});
      const tg=tagOf(item.getAttribute("data-id"),ctx);if(!tg)return;
      const top=item.querySelector(".top");const host=(top&&top.querySelector(":scope > span:first-child"))||top||item;
      host.appendChild(el("span",{class:"ho-tag "+tg[1]},[tg[0]]));});}
  function refreshUI(){if(!S.on||!env.doc)return;try{
    const b=byId("ho-badge");if(b){const n=unreadCount();b.textContent=n>99?"99+":String(n);b.className=n>0?"ho-badge show":"ho-badge";}
    decorate();if(isShown("ho-inbox"))renderInbox();updateShareSlot();updateSettingsStatus();}catch(e){}}
  function fmtStamp(at){return at.slice(5,10)+" "+at.slice(11,16);}
  function fmtHM(ms){return okMs(ms)&&ms>0?kstStamp(ms).slice(11,16):"";}
  function statusText(){
    if(S.authBlocked)return "개인 코드를 확인하세요 — 설정에서 코드를 다시 적어 주세요";
    if(S.lastErr)return `마지막 받음 ${fmtHM(S.lastOk)||"없음"} — ${S.lastErr}`;
    if(S.lastOk)return `받음 ${fmtHM(S.lastOk)}`;
    return "받는 중…";
  }
  function ensureInbox(){if(byId("ho-inbox"))return;
    const ov=el("div",{class:"ov",id:"ho-inbox"},[el("div",{class:"modal"},[
      el("div",{class:"m-head"},[el("h3",null,["📨 인계함"]),el("button",{type:"button",class:"x",onclick:()=>env.closeOv("ho-inbox")},["✕"])]),
      el("div",{class:"m-body",id:"ho-in-body"})])]);
    ov.addEventListener("click",e=>{if(e.target===ov){try{env.closeOv("ho-inbox");}catch(x){}}});
    env.doc.body.appendChild(ov);}
  function failLabel(f){return f.op==="post"?"인계":f.op==="ack"?(f.kind==="done"?"조치 완료":"확인"):"공유 취소";}
  function renderInbox(){const body=byId("ho-in-body");if(!body)return;const top=body.scrollTop;body.textContent="";
    body.appendChild(el("div",{class:"ho-bar"},[el("div",{class:"ho-status"},[statusText()]),btn("새로 받기","btn-s",()=>{sync();},true)]));
    body.appendChild(el("label",{class:"ho-filter"},[el("input",{type:"checkbox",checked:S.onlyUnread,style:"width:20px;height:20px;margin:0",
      onchange:function(){S.onlyUnread=!!this.checked;renderInbox();}}),"확인 안 한 것만"]));
    const fr=foreignItems();
    if(fr.length)body.appendChild(el("div",{class:"ho-box warn"},[el("div",null,[`이전 연결에서 만든 못 보낸 인계 ${fr.length}건이 멈춰 있습니다.`]),
      el("div",{class:"ho-acts"},[btn("지금 연결로 보내기","btn-p",()=>report(adoptForeign()),true),btn("버리기","btn-r",()=>report(dropForeign()),true)])]));
    const fl=readFailed()||[];
    if(fl.length)body.appendChild(el("div",{class:"ho-box bad"},[el("div",{style:"font-weight:800;margin-bottom:4px"},[`서버가 받지 않은 것 ${fl.length}건 — 말로 전달하세요`])]
      .concat(fl.slice().reverse().map(f=>el("div",null,[`${failLabel(f)} 「${f.snip}」: ${f.msg}`])))
      .concat([el("div",{class:"ho-acts"},[btn("목록 지우기","btn-s",()=>{clearFailed();refreshUI();},true)])])));
    const now=env.now();let items=view().map(it=>({it,u:isUnread(it,S.me,now)}));
    if(S.onlyUnread)items=items.filter(x=>x.u);
    if(!items.length)body.appendChild(el("div",{class:"ho-empty"},[S.onlyUnread?"확인 안 한 인계가 없습니다.":"최근 14일 인계가 없습니다."]));
    else for(const x of items)body.appendChild(card(x.it,x.u));
    body.scrollTop=top;}
  function card(it,unread){const me=S.me;const mine=!!me&&it.sid===me.id;
    const meta=[it.place,it.name,it.date?`${it.date.slice(5)} ${it.time}`:fmtStamp(it.at)].filter(Boolean).join(" · ")+(it.pending?" · 보내는 중":"");
    const kids=[el("div",{class:"ho-meta"},[meta]),el("div",{class:"ho-body"},[it.body])];
    const acks=it.acks.filter(a=>a.kind==="ack").map(a=>a.name);
    if(acks.length)kids.push(el("div",{class:"ho-acks"},["확인: "+acks.join(", ")]));
    for(const a of it.acks)if(a.kind==="done")kids.push(el("div",{class:"ho-acks"},[`조치 완료: ${a.name} ${fmtStamp(a.at)}`+(a.memo?` (${a.memo})`:"")]));
    const acts=[];
    if(me&&!mine&&!it.acks.some(a=>a.sid===me.id))acts.push(btn("확인했어요","btn-p",()=>report(ack(it.id,"ack")),true));
    if(me&&!it.pending&&!it.acks.some(a=>a.sid===me.id&&a.kind==="done"))acts.push(btn("조치 완료","btn-g",()=>{
      const m=env.prompt("조치 내용을 적어 주세요(선택 — 비워 두어도 됩니다, 200자까지)","");if(m==null)return;report(ack(it.id,"done",String(m)));},true));
    if(mine&&!it.pending)acts.push(btn("공유 취소","btn-r",()=>{if(!ask("이 인계를 사감 모두에게서 거둘까요? 관리일지 기록은 그대로 둡니다."))return;withdraw(it.id);},true));
    if(acts.length)kids.push(el("div",{class:"ho-acts"},acts));
    return el("div",{class:"ho-card"+(unread?" unread":"")},kids);}
  function report(m){if(m)say(m);}
  function open(){if(!S.on||!env.doc)return;ensureStyle();ensureInbox();renderInbox();env.showOv("ho-inbox");sync();}

  // ── 첫 받기 뒤 한 번만 뜨는 알림 ──
  function schedulePopup(){if(S.popupShown)return;S.popupShown=true;if(env.doc&&unreadCount()>0)later(tryPopup,LIM.popupDelay);}
  function tryPopup(){if(!S.on||!env.doc)return;
    if(isShown("ov-todonotify")){if(S.popTries++<LIM.popTries)later(tryPopup,LIM.popupDelay);return;}
    const n=unreadCount();if(isShown("ho-inbox")||!n)return;ensurePop(n);env.showOv("ho-pop");}
  function ensurePop(n){let ov=byId("ho-pop");
    if(!ov){ov=el("div",{class:"ov",id:"ho-pop"},[el("div",{class:"modal sm"},[
        el("div",{class:"m-head"},[el("h3",null,["📨 인계"]),el("button",{type:"button",class:"x",onclick:()=>env.closeOv("ho-pop")},["✕"])]),
        el("div",{class:"m-body"},[el("div",{class:"ho-pop-text",id:"ho-pop-text"})]),
        el("div",{class:"m-foot"},[btn("인계함 열기","btn-p",()=>{env.closeOv("ho-pop");open();}),btn("나중에","btn-s",()=>env.closeOv("ho-pop"))])])]);
      ov.addEventListener("click",e=>{if(e.target===ov){try{env.closeOv("ho-pop");}catch(x){}}});
      env.doc.body.appendChild(ov);}
    const t=byId("ho-pop-text");if(t)t.textContent=`확인 안 한 인계 ${n}건`;}

  // ── 설정 화면(데이터 관리 창 안) ──
  function fill(){const c=readCfg();setVal("ho-url",c.url);setVal("ho-place",c.place);setVal("ho-code","");}
  function renderSettings(){if(!env.doc)return;const host=byId("ho-settings");if(!host)return;
    if(!byId("ho-url")){host.textContent="";
      const field=(label,input,extra)=>el("div",{class:"field"},[el("label",null,[label]),input,extra||null]);
      host.appendChild(el("div",{class:"sec-t"},["📨 인계 공유"]));
      host.appendChild(el("div",{class:"hint"},[GUIDE]));
      host.appendChild(field("웹 앱 주소",el("input",{type:"url",id:"ho-url",autocomplete:"off",spellcheck:"false",placeholder:"https://script.google.com/macros/s/…/exec"})));
      host.appendChild(field("개인 코드",el("input",{type:"password",id:"ho-code",autocomplete:"new-password",spellcheck:"false"}),
        el("div",{id:"ho-code-hint",style:"font-size:12px;color:#64748b;margin-top:4px"})));
      host.appendChild(field("근무지(선택)",el("input",{type:"text",id:"ho-place",maxlength:"30",placeholder:"예: 태하관 1층"})));
      host.appendChild(el("div",{class:"row2"},[
        btn("설정 저장","btn-p",()=>{const m=saveCfg({url:val("ho-url"),code:val("ho-code"),place:val("ho-place")});if(m==="저장했습니다")setVal("ho-code","");setMsg(m);updateSettingsStatus();}),
        btn("연결 시험","btn-s",()=>{runTest();})]));
      host.appendChild(el("label",{class:"hint",style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin:10px 0"},[
        el("input",{type:"checkbox",id:"ho-on",style:"width:20px;height:20px;margin:0",onchange:function(){setMsg(setEnabled(!!this.checked));updateSettingsStatus();}}),"인계 공유 켜기"]));
      host.appendChild(el("div",{class:"hint",id:"ho-set-status"}));
      host.appendChild(el("div",{class:"hint",id:"ho-set-msg",style:"font-weight:700"}));
      host.appendChild(btn("설정 지우기","btn-r",()=>{const m=clearSettings();fill();if(m)setMsg(m);updateSettingsStatus();},true));}
    fill();setMsg("");updateSettingsStatus();}
  function updateSettingsStatus(){if(!env.doc)return;try{
    const st=byId("ho-set-status");
    if(st){let t;if(!S.on)t="꺼짐";else if(S.authBlocked)t="개인 코드를 확인하세요";
      else if(S.me)t=S.lastErr?`${S.me.name} 님 — ${S.lastErr}`:`${S.me.name} 님으로 연결됨`;else t=S.lastErr||"연결 확인 중";
      st.textContent="상태: "+t;}
    const c=readCfg();
    const h=byId("ho-code-hint");if(h)h.textContent=c.code?"저장됨 — 바꿀 때만 새로 적으세요":"운영자에게 받은 12자 코드";
    const o=byId("ho-on");if(o)o.checked=c.enabled;}catch(e){}}

  const safe=(fn,d)=>function(){try{return fn.apply(null,arguments);}catch(e){return d;}};
  const safeP=fn=>function(){try{return Promise.resolve(fn.apply(null,arguments)).catch(()=>{});}catch(e){return Promise.resolve();}};
  const api={version:1,start:safe(start),beforeAdd:safe(beforeAdd,null),share:safe(share,""),isShared:safe(isShared,false),withdraw:safe(withdraw,""),
    decorate:safe(decorate),renderSettings:safe(renderSettings),open:safe(open),sync:safeP(sync),freeSpace:safe(freeSpace,false)};
  if(env.test)api._t={S,tagOf,tagCtx,unreadCount,view,saveCfg,setEnabled,clearSettings,testConnection,runTest,setMsg,adoptForeign,dropForeign,ack,readOutbox,readFailed,readShared,foreignItems,statusText,peekOutbox};
  return api;
}

const pure={okMs,isStr,isObj,parseJson,cut,normCode,validUrl,validCode,fnv,cfOf,parseCfg,ready,kstStamp,kstDay,validDate,dayAdd,stampMs,meOk,preShareCheck,judge,cleanAck,cleanItem,cleanList,isForeign,mergeView,isUnread,validOx};
if(typeof module!=="undefined"&&module.exports)module.exports={create,pure,LIM,K,browserEnv};
else if(root){try{root.Handover=create(browserEnv(root));}catch(e){}}
})(typeof window!=="undefined"?window:null);
