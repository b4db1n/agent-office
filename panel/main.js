(()=>{var T="openchamber.sdk",f=1;var _t=`
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [data-oc-scrolling] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [data-oc-scrolling] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [data-oc-scrolling]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [data-oc-scrolling] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;function go(e){let o=e.documentElement;if(o.hasAttribute("data-oc-scrollbar-activity"))return;o.setAttribute("data-oc-scrollbar-activity","");let s=new WeakMap;e.addEventListener("scroll",(a)=>{let i=a.target===e?o:a.target;if(!(i instanceof Element))return;if(!i.hasAttribute("data-oc-scrolling"))i.setAttribute("data-oc-scrolling","");let l=s.get(i);if(l!==void 0)clearTimeout(l);s.set(i,setTimeout(()=>{s.delete(i),i.removeAttribute("data-oc-scrolling")},1000))},{capture:!0,passive:!0})}var Cn=`(${go.toString()})(document);`;var Et=128,St=65536;var Ne=128;var Le=65536;var Tt=8000,ft=192000,At=120000;var Io=(e)=>{let o=[],s=0,a=0;return{push:(i)=>{o.push(i),a+=i.length;while(a-s>e&&o.length>1){let l=o.shift();a-=l?.length??0,s=0}},pull:(i)=>{let l=0;while(l<i.length&&o.length>0){let m=o[0],A=Math.min(i.length-l,m.length-s);if(i.set(m.subarray(s,s+A),l),l+=A,s+=A,s>=m.length)o.shift(),a-=m.length,s=0}i.fill(0,l)},clear:()=>{o.length=0,s=0,a=0},get size(){return a-s}}};var yo=/^[a-z][a-z0-9-]{0,39}$/;var xo=(e)=>Object(e)===e&&!Array.isArray(e),Ot=(e,o)=>Object.keys(e).every((s)=>o.includes(s)),bo=(e)=>String(e)===e&&e.length>=1&&e.length<=60,Co=(e)=>String(e)===e&&e.length>=1&&e.length<=80,ko=(e)=>{if(!Array.isArray(e)||e.length>4)return!1;let o=new Set;for(let s of e){if(!xo(s)||!yo.test(s.id)||!bo(s.label))return!1;if(s.disabled!==void 0&&s.disabled!==!0&&s.disabled!==!1)return!1;if(o.has(s.id))return!1;if(o.add(s.id),s.kind==="button"){if(!Ot(s,["kind","id","label","disabled"]))return!1;continue}if(s.kind!=="select"||!Ot(s,["kind","id","label","value","options","disabled"]))return!1;if(!Co(s.value)||!Array.isArray(s.options)||s.options.length<1||s.options.length>16)return!1;let a=new Set;for(let i of s.options){if(!xo(i)||!Ot(i,["value","label"])||!Co(i.value)||!bo(i.label)||a.has(i.value))return!1;a.add(i.value)}if(!a.has(s.value))return!1}return!0};var Uo=["{id}","{segment}","{segments+}"];var Or=new Set(Uo);var Mo=["turn-finished","turn-failed","permission-asked","question-asked","turn-started","session-created","session-archived","session-deleted"];var Rr=new Set(Mo);var Pe=20000000,we=256;var ht=(e)=>("bytes"in e)?e.bytes.byteLength:e.content.length,vo=(e,o)=>{if(e.path!==o.path||e.readOnly!==o.readOnly)return!1;if(e.encoding==="text"||o.encoding==="text")return e.encoding==="text"&&o.encoding==="text"&&e.content===o.content;if(e.bytes.byteLength!==o.bytes.byteLength)return!1;for(let s=0;s<e.bytes.byteLength;s+=1)if(e.bytes[s]!==o.bytes[s])return!1;return!0};var No=/^[A-Za-z0-9_-]{1,80}$/;var Lo=["left","right","top","bottom"];var Po=(e,o=0,s={remaining:16000})=>{if(--s.remaining<0||o>=32)return!1;if(e===null)return!0;let a=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let i of a)if(!Po(i,o+1,s))return!1;return!0},Rt=(e)=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every((o)=>/^(0|[1-9]\d*)$/.test(o)&&Number(o)<e.length)&&e.every(Rt);if(Object(e)===e){let o=Object.getPrototypeOf(e);return(o===null||o===Object.prototype)&&Object.values(e).every(Rt)}return String(e)===e||Number.isFinite(e)},mt=(e)=>{try{if(String(e.id)!==e.id||!No.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!Lo.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!Po(e.data)||!Rt(e.data))return!1;return JSON.stringify(e.data).length<=16000}catch{return!1}};var wo=/^[0-9a-f]{7,64}$/i,Do=(e)=>wo.test(e),gt=255,Go=(e,o,s)=>({openCommit:(a)=>Do(a)?e({channel:T,v:f,type:"open-commit",id:o(),payload:{sha:a}}):s("Commit id must be 7 to 64 hex characters."),openWalkthrough:({base:a})=>{let i=a.trim();if(!i||i.length>gt)return s(`Base must contain 1 to ${gt} characters.`);return e({channel:T,v:f,type:"open-walkthrough",id:o(),payload:{base:i}})}});var xt=2000;var Ho=["file","directory","other","missing"],bt=(e)=>Boolean(e&&"sessionId"in e),Ct=(e)=>Boolean(e&&"sent"in e&&!("sessionId"in e));var De=500,Ge=32000,Xo=16000,Vo=128,Fo=200,Bo=2000,Ko=16000,jo=80,Wo=200,zo=16000;var Jo=2000;var yt=20000,$e=1024,He=2000000;var Xe=64000,Ve=8000,kt=4000;var Ut=960000;var Yo=999,Qo=1e4,he=500,Zo=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],qo=["stopped","starting","ready","failed"],kn=new Set(Zo),en=(e)=>kn.has(e),tn=(e)=>e&&en(e)?e:"HOST_REJECTED",ce=(e)=>{if(e===void 0)return!1;if(e===null||e===!0||e===!1)return!0;if(String(e)===e)return!0;if(Number(e)===e)return Number.isFinite(e);if(Array.isArray(e))return e.every(ce);if(Object(e)===e)return Object.values(e).every(ce);return!1},on=(e)=>ce(e)&&JSON.stringify(e).length<=zo,$o=(e)=>e?.trim().slice(0,Wo)??"",le=(e)=>{let o=e.id.trim().slice(0,Vo),s=e.title.trim().slice(0,Fo),a=e.url.trim().slice(0,Bo),i=e.text?.trim().slice(0,Ko),l=e.author?.trim().slice(0,jo),m=e.kind==="pull"?"pull":"issue",A={providerId:e.providerId.trim(),id:o,title:s||o,url:a,kind:m};if(i)A.text=i;if(l)A.author=l;if(m==="pull"){let K=$o(e.branches?.head),V=$o(e.branches?.base);if(K&&V)A.branches={head:K,base:V}}if(on(e.data))A.data=e.data;return A},Mt=(e)=>{let o=le(e);if(e.projectId)o.projectId=e.projectId;if(e.navigation)o.navigation=e.navigation;if(e.worktree)o.worktree=e.worktree;return o},vt=(e)=>{let o={text:e.text.trim().slice(0,Xo)};if(e.send)o.send=!0;return o},Nt=(e)=>{if(e===null||!Number.isFinite(e))return null;return Math.min(Yo,Math.max(0,Math.round(e)))},Lt=(e)=>{if(!Number.isFinite(e))return 0;return Math.min(Qo,Math.max(0,Math.ceil(e)))};var de=(e)=>e.length>0&&e.length<=$e&&!e.includes("\x00")&&!e.includes("\\");var Fe=(e)=>{if(!e.startsWith("/")||e.includes("\x00")||e.includes("\\")||e.includes("://"))return!1;if(e.length>Jo)return!1;return!e.split("/").some((s)=>s==="."||s==="..")},Un=new Set(qo),Pt=(e)=>Boolean(e&&"status"in e&&Un.has(String(e.status))&&!("body"in e)),Be=(e)=>Boolean(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),wt=(e)=>Boolean(e&&"content"in e&&String(e.content)===e.content),Dt=(e)=>Boolean(e&&"written"in e&&e.written===!0),Gt=(e)=>Boolean(e&&"entries"in e&&Array.isArray(e.entries)),Mn=new Set(Ho),$t=(e)=>Boolean(e&&"kind"in e&&"size"in e&&Mn.has(String(e.kind))&&Number.isFinite(e.size)),Ht=(e)=>Boolean(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),vn=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","service-event","status-control-event","popover-closed","file-open","file-snapshot","file-saved","generate-late","microphone-audio","microphone-ended"]),Nn=(e)=>Object(e)===e?e:null,It=(e)=>String(e)===e&&e.length>0,Ln=(e)=>{if(!It(e.id))return null;if(e.ok===!0){let o={channel:T,v:f,type:"result",id:e.id,ok:!0};if(Object(e.payload)===e.payload)o.payload=e.payload;return o}if(e.ok===!1&&It(e.error))return{channel:T,v:f,type:"result",id:e.id,ok:!1,error:e.error,code:tn(It(e.code)?e.code:void 0)};return null},Xt=(e)=>{let o=Nn(e);if(!o||o.channel!==T||o.v!==f)return null;if(o.type==="result")return Ln(o);if(!vn.has(String(o.type))||Object(o.payload)!==o.payload)return null;return o};var nn=(e)=>("key"in e)&&("metaKey"in e)&&("ctrlKey"in e),Pn=(e)=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s";class u extends Error{code;constructor(e,o){super(o);this.name="HostRequestError",this.code=e}}var rn=()=>Promise.reject(new u("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),Ke=()=>Promise.reject(new u("BAD_PATH",`File path must be 1 to ${$e} characters without NUL or backslash.`)),je=(e)=>{if(e===void 0)return;if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new u("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0},S=(e)=>(e.value+=1,`oc-${e.value}`),Vt=(e={})=>{let o=e.target??("window"in globalThis?window:null);if(!o)throw new u("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let s=e.acceptSource??((t)=>t===o.parent),a=e.requestTimeoutMs??yt,i=new Set,l=new Set,m=new Set,A=new Set,K=new Set,V=new Set,Z=new Set,Y=new Set,xe=new Set,be=new Set,Ce=new Set,ne=new Set,at=[],Ee=null,Se=null,ye=new Set,ke=new Set,Te=null,fe=null,ct=!1,re=new Map,se=new Map,ie=new Map,F=!1,E={value:0},_=null,j=null,Ae=!1,Oe=!1,po=null,D=null,uo=(t)=>{if(!t)return null;return{sessionId:t.id,phase:t.busy?"started":"completed"}},N=(t)=>{o.parent.postMessage(t,"*")},_o=()=>{if(F||o.parent===o||ne.size===0||_?.features?.lateGenerateResults!==!0)return;N({channel:T,v:f,type:"generate-late-listen"})},g=(t,n)=>{for(let p of t)try{p(n)}catch(d){console.error(d)}},Eo=(t)=>{if(!(t instanceof MessageEvent))return;if(!s(t.source))return;let n=Xt(t.data);if(!n)return;if(n.type==="workspace"){let d=se.get(n.payload.subscriptionId);if(d)g([d],n.payload.snapshot);return}if(n.type==="shells"){let d=ie.get(n.payload.subscriptionId);if(d)g([d],n.payload.snapshot);return}if(n.type==="microphone-audio"){D?.queue.push(n.payload.samples);return}if(n.type==="microphone-ended"){let d=D;if(!d)return;D=null,d.release(),g(d.endedListeners,n.payload.reason);return}if(n.type==="ready"){if(_=n.payload,j=uo(n.payload.session),g(i,n.payload),g(l,n.payload.directory),g(m,n.payload.session),j)g(A,j);if(g(K,n.payload.connection),g(V,n.payload.settings),g(Z,n.payload.item),n.payload.block)g(Y,n.payload.block);_o();return}if(n.type==="service-event"){g(xe,n.payload);return}if(n.type==="generate-late"){if(ne.size===0)at.push(n.payload);else g(ne,n.payload);return}if(n.type==="directory"){if(_)_={..._,directory:n.payload.directory};g(l,n.payload.directory);return}if(n.type==="session"){if(_)_={..._,session:n.payload.session};if(!n.payload.session)j=null;else if(j?.sessionId!==n.payload.session.id)j=uo(n.payload.session);g(m,n.payload.session);return}if(n.type==="session-lifecycle"){j=n.payload,g(A,n.payload);return}if(n.type==="connection"){if(_)_={..._,connection:n.payload.connection};g(K,n.payload.connection);return}if(n.type==="settings"){if(_)_={..._,settings:n.payload.settings};g(V,n.payload.settings);return}if(n.type==="item"){if(_)_={..._,item:n.payload.item};g(Z,n.payload.item);return}if(n.type==="status-control-event"){g(be,n.payload);return}if(n.type==="popover-closed"){g(Ce,n.payload);return}if(n.type==="action"){let d=(R)=>{if(!F)N({channel:T,v:f,type:"action-result",id:n.id,payload:R})},h=Se;if(!h){d({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>h(n.payload)).then(()=>d({ok:!0}),(R)=>{let I=(R instanceof Error?R.message:String(R)).trim();d({ok:!1,error:(I||"Action failed.").slice(0,he)})});return}if(n.type==="file-open"){let d=n.payload;if(fe&&vo(fe,d))return;fe=d,g(ye,n.payload);return}if(n.type==="file-saved"){g(ke,n.payload.version);return}if(n.type==="file-snapshot"){let d=(I)=>{if(!F)N({channel:T,v:f,type:"file-snapshot-result",id:n.id,payload:I})},h=(I)=>d({error:(I.trim()||"Could not read the edited file.").slice(0,he)}),R=Te;if(!R){h("This extension does not edit files.");return}Promise.resolve().then(()=>R(n.payload.purpose)).then((I)=>{if(ht(I)>Pe){h(`The file is over ${Pe} ${"bytes"in I?"bytes":"characters"}.`);return}if(I.version.length>we){h(`The snapshot version is over ${we} characters.`);return}d({snapshot:"bytes"in I?{bytes:I.bytes,version:I.version}:{content:I.content,version:I.version}})},(I)=>h(I instanceof Error?I.message:String(I)));return}if(n.type==="resolve"){let d=(R)=>{N({channel:T,v:f,type:"resolve-result",id:n.id,payload:R})},h=Ee;if(!h){d({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>h(n.payload)).then((R)=>d({item:R?le(R):null}),(R)=>{let I=(R instanceof Error?R.message:String(R)).trim();d({error:(I||"Command failed.").slice(0,he)})});return}let p=re.get(n.id);if(!p)return;if(clearTimeout(p.timer),re.delete(n.id),n.ok){p.resolve(n.payload);return}p.reject(new u(n.code,n.error))};o.addEventListener("message",Eo),N({channel:T,v:f,type:"hello"});let M=(t,n=a)=>{if(F||o.parent===o)return Promise.reject(new u("HOST_UNAVAILABLE","No host frame. This page is not in an iframe."));return new Promise((p,d)=>{let h=setTimeout(()=>{re.delete(t.id),d(new u("HOST_TIMEOUT","Host did not answer in time."))},n);re.set(t.id,{resolve:p,reject:d,timer:h}),N(t)})},k=(t)=>M(t).then(()=>{return}),b={channel:T,v:f},lt=(t)=>{if(!F&&o.parent!==o)N(t)},So=()=>lt({...b,type:"file-save"}),dt=()=>{if(!F&&o.parent!==o)N({...b,type:"microphone-close",id:S(E)})},xn=async()=>{if(D)throw new u("HOST_REJECTED","The microphone is already open in this frame.");if(_?.features?.microphone!==!0)throw new u("UNSUPPORTED","This OpenChamber cannot share the microphone with extensions.");let t=globalThis.AudioContext;if(typeof t!=="function")throw new u("UNSUPPORTED","This frame has no Web Audio.");let n=new t;if(n.sampleRate<Tt||n.sampleRate>ft)throw n.close().catch(()=>{return}),new u("UNSUPPORTED",`Audio at ${n.sampleRate} Hz is not supported.`);let p=n.state==="suspended"?n.resume().catch(()=>{return}):void 0,d=Io(Math.round(n.sampleRate/4)),h=n.createScriptProcessor(1024,1,1);h.onaudioprocess=(X)=>d.pull(X.outputBuffer.getChannelData(0));let R=n.createMediaStreamDestination();h.connect(R);let I=new Set,ae={queue:d,endedListeners:I,release:()=>{h.onaudioprocess=null,h.disconnect(),d.clear();for(let X of R.stream.getTracks())X.stop();n.close().catch(()=>{return})}};D=ae;try{let X=await M({...b,type:"microphone-open",id:S(E),payload:{sampleRate:n.sampleRate}},At);if(!X||!("opened"in X)||X.opened!==!0)throw new u("HOST_REJECTED","Host did not open the microphone.");if(await p,D!==ae)throw new u("DISCONNECTED","The microphone closed while it was opening.")}catch(X){if(D===ae)D=null;throw ae.release(),dt(),X}return{stream:R.stream,close:()=>{if(D!==ae)return;D=null,ae.release(),dt()},onEnded:(X)=>(I.add(X),()=>{I.delete(X)})}},To=(t)=>{if(!nn(t)||!Pn(t))return;t.preventDefault(),So()},fo=(t)=>{if(!nn(t)||t.key!=="Escape"||_?.surface!=="popover"||!_.popover)return;t.preventDefault(),Ro(_.popover.id,"escape").catch(()=>{return})},Ue=()=>{let t=_?.surface==="popover"?_.popover:void 0;if(!t)return;let n=Ae||Oe;if(po===n)return;po=n,mo(t.id,n).catch(()=>{return})},Me=()=>{if(_?.surface!=="popover"||Ae)return;Ae=!0,Ue()},Ao=(t)=>{if(_?.surface!=="popover"||t.relatedTarget!==null||!Ae)return;Ae=!1,Ue()},Oo=()=>{if(_?.surface!=="popover"||Oe)return;Oe=!0,Ue()},ho=()=>{if(_?.surface!=="popover"||!Oe)return;Oe=!1,Ue()},B=(t,n=1024)=>{if(!t.trim()||t.length>n)throw new u("HOST_REJECTED",`Identity must contain 1 to ${n} characters.`)},pt=async(t)=>{if(t.kind!=="projects")B(t.projectId);let n=await M({...b,type:"workspace-read",id:S(E),payload:t});if(!n||!("kind"in n)||!("state"in n)||n.kind!==t.kind)throw new u("HOST_REJECTED","Host did not return workspace data.");return n},ut=async(t,n)=>{if(t.kind!=="projects")B(t.projectId);let p=S(E);se.set(p,n);try{await k({...b,type:"workspace-subscribe",id:S(E),payload:{subscriptionId:p,query:t}})}catch(d){if(se.delete(p),!F)N({...b,type:"workspace-unsubscribe",id:S(E),payload:{subscriptionId:p}});throw d}return()=>{if(!se.delete(p)||F)return;N({...b,type:"workspace-unsubscribe",id:S(E),payload:{subscriptionId:p}})}},bn=async(t,n)=>{if(t.kind==="session")B(t.sessionId);if(t.kind==="project")B(t.projectId);let p=S(E);ie.set(p,n);try{await k({...b,type:"shells-subscribe",id:S(E),payload:{subscriptionId:p,scope:t}})}catch(d){if(ie.delete(p),!F)N({...b,type:"shells-unsubscribe",id:S(E),payload:{subscriptionId:p}});throw d}return()=>{if(!ie.delete(p)||F)return;N({...b,type:"shells-unsubscribe",id:S(E),payload:{subscriptionId:p}})}},ve=async(t)=>{if("key"in t&&(t.key.length===0||t.key.length>Et))throw new u("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(t.op==="set"&&!ce(t.value))throw new u("HOST_REJECTED","Storage values must be JSON.");if(t.op==="set"&&new TextEncoder().encode(JSON.stringify(t.value)).length>St)throw new u("HOST_REJECTED","Storage value exceeds 64 KiB.");if(t.scope==="device"&&_?.features?.deviceStorage!==!0)throw new u("UNSUPPORTED","This host does not support device storage.");let n=await M({...b,type:"storage",id:S(E),payload:t});if(!n||!("storage"in n)||n.op!==t.op)throw new u("HOST_REJECTED","Host did not return storage data.");return n},Ro=(t,n)=>_?.features?.popovers!==!0&&!(_?.surface==="popover"&&_.popover?.id===t)?Promise.reject(new u("UNSUPPORTED","This host does not support popovers.")):k({...b,type:"popover-close",id:S(E),payload:n?{id:t,reason:n}:{id:t}}),mo=(t,n)=>_?.features?.popovers!==!0&&!(_?.surface==="popover"&&_.popover?.id===t)?Promise.reject(new u("UNSUPPORTED","This host does not support popovers.")):k({...b,type:"popover-anchor",id:S(E),payload:{id:t,active:n}});return o.addEventListener("keydown",fo,!0),o.addEventListener("pointerover",Me),o.addEventListener("pointermove",Me),o.addEventListener("pointerout",Ao),o.addEventListener("focus",Oo),o.addEventListener("blur",ho),{onAction:(t)=>(Se=t,()=>{if(Se===t)Se=null}),listProjects:async()=>{let t=await pt({kind:"projects"});if(t.kind!=="projects")throw new u("HOST_REJECTED","Expected projects.");return t},listWorktrees:async(t)=>{let n=await pt({kind:"worktrees",projectId:t});if(n.kind!=="worktrees")throw new u("HOST_REJECTED","Expected worktrees.");return n},listSessions:async(t)=>{let n=await pt({kind:"sessions",projectId:t});if(n.kind!=="sessions")throw new u("HOST_REJECTED","Expected sessions.");return n},onProjects:(t)=>ut({kind:"projects"},(n)=>{if(n.kind==="projects")t(n)}),onWorktrees:(t,n)=>ut({kind:"worktrees",projectId:t},(p)=>{if(p.kind==="worktrees")n(p)}),onSessions:(t,n)=>ut({kind:"sessions",projectId:t},(p)=>{if(p.kind==="sessions")n(p)}),onRunningShells:(t,n)=>bn(t,n),readShellOutput:async(t,n)=>{B(t,Ne);let p=n?.cursor;if(p!==void 0&&(!Number.isInteger(p)||p<0))throw new u("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let d=n?.tailBytes;if(d!==void 0&&(!Number.isInteger(d)||d<1||d>Le))throw new u("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${Le}.`);let R=await M({...b,type:"shell-output",id:S(E),payload:{shellId:t,cursor:p,tailBytes:d}});if(!R||typeof R.output!=="string"||!Number.isFinite(R.cursor))throw new u("HOST_REJECTED","Host did not return shell output.");return R},stopShell:async(t)=>{if(B(t,Ne),(await M({...b,type:"shell-stop",id:S(E),payload:{shellId:t}}))?.stopped!==!0)throw new u("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async(t)=>{B(t),await k({...b,type:"open-session",id:S(E),payload:{sessionId:t}})},storage:{get:async(t,n)=>{let p=je(n),d={op:"get",key:t};if(p)d.scope=p;let h=await ve(d);return h.op==="get"&&h.found?h.value:void 0},set:async(t,n,p)=>{let d=je(p),h={op:"set",key:t,value:n};if(d)h.scope=d;await ve(h)},delete:async(t,n)=>{let p=je(n),d={op:"delete",key:t};if(p)d.scope=p;await ve(d)},keys:async(t)=>{let n=je(t),p={op:"keys"};if(n)p.scope=n;let d=await ve(p);if(d.op!=="keys")throw new u("HOST_REJECTED","Expected storage keys.");return d.keys}},onReady:(t)=>{if(i.add(t),_)t(_);return()=>{i.delete(t)}},onDirectory:(t)=>{if(l.add(t),_)t(_.directory);return()=>{l.delete(t)}},onSession:(t)=>{if(m.add(t),_)t(_.session);return()=>{m.delete(t)}},onSessionLifecycle:(t)=>{if(A.add(t),j)t(j);return()=>{A.delete(t)}},onConnection:(t)=>{if(K.add(t),_)t(_.connection);return()=>{K.delete(t)}},onSettings:(t)=>{if(V.add(t),_)t(_.settings);return()=>{V.delete(t)}},onItem:(t)=>{if(Z.add(t),_)t(_.item);return()=>{Z.delete(t)}},onBlock:(t)=>{if(Y.add(t),_?.block)t(_.block);return()=>{Y.delete(t)}},onServiceEvent:(t)=>(xe.add(t),()=>{xe.delete(t)}),onStatusControl:(t)=>(be.add(t),()=>{be.delete(t)}),onPopoverClosed:(t)=>(Ce.add(t),()=>{Ce.delete(t)}),setStatusControls:(t)=>{if(_?.features?.statusControls!==!0)return Promise.reject(new u("UNSUPPORTED","This host does not support status controls."));if(!ko(t))return Promise.reject(new u("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options."));return k({...b,type:"status-controls",id:S(E),payload:{controls:t}})},openPopover:(t)=>{if(_?.features?.popovers!==!0)return Promise.reject(new u("UNSUPPORTED","This host does not support popovers."));if(!mt(t))return Promise.reject(new u("HOST_REJECTED","Popover requests need bounded geometry and JSON data."));return k({...b,type:"popover-open",id:S(E),payload:t})},closePopover:Ro,setPopoverAnchorActive:mo,onResolve:(t)=>(Ee=t,()=>{if(Ee===t)Ee=null}),toast:(t)=>{let n=t.message.trim();if(!n||n.length>De)return Promise.reject(new u("HOST_REJECTED",`Toast message must contain 1 to ${De} characters.`));if(t.copy&&t.copy!==!0&&(!t.copy.text.length||t.copy.text.length>Ge))return Promise.reject(new u("HOST_REJECTED",`Toast copy text must contain 1 to ${Ge} characters.`));return k({channel:T,v:f,type:"toast",id:S(E),payload:{...t,message:n}})},openUrl:(t)=>k({channel:T,v:f,type:"open-url",id:S(E),payload:{url:t}}),...Go(k,()=>S(E),(t)=>Promise.reject(new u("HOST_REJECTED",t))),answerBlock:(t)=>k({channel:T,v:f,type:"block-answer",id:S(E),payload:{text:t.trim().slice(0,xt)}}),openSurface:(t)=>k({channel:T,v:f,type:"open-surface",id:S(E),payload:{surfaceId:t}}),writeClipboard:(t)=>k({channel:T,v:f,type:"clipboard-write",id:S(E),payload:{text:t}}),compose:(t)=>k({channel:T,v:f,type:"compose",id:S(E),payload:t}),attach:(t)=>k({channel:T,v:f,type:"attach",id:S(E),payload:le(t)}),startSession:async(t)=>{if(t.projectId!==void 0)B(t.projectId);let n=t.worktree;if(n&&n!==!0)if(n.kind==="existing")B(n.directory);else{if(n.name!==void 0)B(n.name,200);if(n.baseBranch!==void 0)B(n.baseBranch,200)}let p=await M({channel:T,v:f,type:"start-session",id:S(E),payload:Mt(t)},e.requestTimeoutMs??180000);if(!bt(p))throw new u("HOST_REJECTED","Host did not return a session.");return p},prompt:(t)=>M({channel:T,v:f,type:"prompt",id:S(E),payload:vt(t)}).then((n)=>{if(!Ct(n))throw new u("HOST_REJECTED","Host did not return a prompt result.");return n}),sessionLink:(t)=>k({channel:T,v:f,type:"session-link",id:S(E),payload:le(t)}),close:()=>k({channel:T,v:f,type:"close",id:S(E)}),oauthStart:()=>k({channel:T,v:f,type:"oauth-start",id:S(E)}),oauthDisconnect:()=>k({channel:T,v:f,type:"oauth-disconnect",id:S(E)}),request:(t)=>(Fe(t.path)?M({channel:T,v:f,type:"request",id:S(E),payload:t}):rn()).then((n)=>{if(!Be(n))throw new u("HOST_REJECTED","Host request result was empty.");return n}),serviceRequest:(t)=>(Fe(t.path)?M({channel:T,v:f,type:"service-request",id:S(E),payload:t}):rn()).then((n)=>{if(!Be(n))throw new u("HOST_REJECTED","Host service request result was empty.");return n}),serviceStatus:()=>M({channel:T,v:f,type:"service-status",id:S(E)}).then((t)=>{if(!Pt(t))throw new u("HOST_REJECTED","Host did not return service status.");return t}),readFile:(t)=>(de(t)?M({channel:T,v:f,type:"file-read",id:S(E),payload:{path:t}}):Ke()).then((n)=>{if(!wt(n))throw new u("HOST_REJECTED","Host did not return file content.");return n}),writeFile:(t,n)=>{if(!de(t))return Ke();if(n.length>He)return Promise.reject(new u("FILE_TOO_LARGE",`Content is over ${He} characters.`));return M({channel:T,v:f,type:"file-write",id:S(E),payload:{path:t,content:n}}).then((p)=>{if(!Dt(p))throw new u("HOST_REJECTED","Host did not confirm the write.");return p})},listDir:(t)=>(de(t)?M({channel:T,v:f,type:"file-list",id:S(E),payload:{path:t}}):Ke()).then((n)=>{if(!Gt(n))throw new u("HOST_REJECTED","Host did not return directory entries.");return n}),stat:(t)=>(de(t)?M({channel:T,v:f,type:"file-stat",id:S(E),payload:{path:t}}):Ke()).then((n)=>{if(!$t(n))throw new u("HOST_REJECTED","Host did not return file status.");return n}),generate:(t)=>{let n=t.prompt.trim(),p=t.system?.trim();if(n.length===0||n.length>Xe)return Promise.reject(new u("HOST_REJECTED",`Prompt must be 1 to ${Xe} characters.`));if(p!==void 0&&(p.length===0||p.length>Ve))return Promise.reject(new u("HOST_REJECTED",`System prompt must be 1 to ${Ve} characters.`));let d=t.maxOutputTokens===void 0?void 0:Math.min(kt,Math.max(1,Math.floor(t.maxOutputTokens)));if(d!==void 0&&!Number.isFinite(d))return Promise.reject(new u("HOST_REJECTED","maxOutputTokens must be a number."));let h={prompt:n};if(p!==void 0)h.system=p;if(d!==void 0)h.maxOutputTokens=d;return M({channel:T,v:f,type:"generate",id:S(E),payload:h},e.requestTimeoutMs??Ut).then((R)=>{if(!Ht(R))throw new u("HOST_REJECTED","Host did not return generated text.");return R})},onLateGenerateResult:(t)=>{ne.add(t);for(let n of at.splice(0))g([t],n);return _o(),()=>{ne.delete(t)}},openMicrophone:xn,setBadge:(t)=>k({channel:T,v:f,type:"badge",id:S(E),payload:{count:Nt(t)}}),setHeight:(t)=>k({channel:T,v:f,type:"resize",id:S(E),payload:{height:Lt(t)}}),onFileOpen:(t)=>{if(ye.add(t),!ct)ct=!0,o.addEventListener("keydown",To,!0);if(fe)t(fe);return()=>{ye.delete(t)}},onFileSnapshot:(t)=>(Te=t,()=>{if(Te===t)Te=null}),onFileSaved:(t)=>(ke.add(t),()=>{ke.delete(t)}),reportFileChange:(t)=>lt({...b,type:"file-change",payload:{dirty:t.dirty,edited:t.edited}}),requestFileSave:So,reportFileUnsupported:()=>lt({...b,type:"file-unsupported"}),dispose:()=>{for(let t of se.keys())N({...b,type:"workspace-unsubscribe",id:S(E),payload:{subscriptionId:t}});se.clear();for(let t of ie.keys())N({...b,type:"shells-unsubscribe",id:S(E),payload:{subscriptionId:t}});if(ie.clear(),D)dt(),D.release(),D=null;if(F=!0,Ee=null,Se=null,Te=null,ye.clear(),ke.clear(),ct)o.removeEventListener("keydown",To,!0);o.removeEventListener("message",Eo),o.removeEventListener("keydown",fo,!0),o.removeEventListener("pointerover",Me),o.removeEventListener("pointermove",Me),o.removeEventListener("pointerout",Ao),o.removeEventListener("focus",Oo),o.removeEventListener("blur",ho);for(let t of re.values())clearTimeout(t.timer),t.reject(new u("HOST_UNAVAILABLE","Host client was disposed."));re.clear(),i.clear(),l.clear(),m.clear(),A.clear(),K.clear(),V.clear(),Z.clear(),Y.clear(),xe.clear(),be.clear(),Ce.clear(),ne.clear(),at.length=0}}};var sn=["browser.open","browser.snapshot","browser.click","browser.type","browser.select","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize","browser.close"];var Xr=new Set(sn);var an=["none","agent","user"];var Fr=new Set(an);var wn=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],Dn=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],cn=(e,o)=>{o.style.colorScheme=e.mode;for(let[s,a]of wn)o.style.setProperty(s,e.tokens[a]);for(let[s,a,i]of Dn){let l=e.tokens[i]??"";o.style.setProperty(s,l),o.style.setProperty(a,l)}o.style.setProperty("font-family",e.tokens.font),o.style.setProperty("font-size",e.tokens.fontSize??"0.875rem"),o.style.setProperty("line-height","1.45"),o.style.setProperty("color",e.tokens.foreground)},Ft=(e,o)=>{if(cn(e.theme,o),o.dataset)o.dataset.ocSurface=e.surface,o.dataset.ocTheme=e.theme.mode};var Gn={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},x=(e,o)=>`var(--${e}, var(--oc-${Gn[e]}, ${o}))`,z=x("surface-background","transparent"),ze=x("surface-elevated","transparent"),pe=x("surface-elevated-foreground","inherit"),G=x("surface-foreground","inherit"),C=x("surface-muted-foreground","gray"),$n=x("surface-muted","transparent"),q=x("interactive-border","currentColor"),L=x("interactive-hover","transparent"),ee=x("interactive-active","transparent"),Bt=x("interactive-selection","transparent"),Kt=x("interactive-selection-foreground","inherit"),W=x("primary","currentColor"),jt=x("primary-text","inherit"),Wt=x("error-text","inherit"),Hn=x("font-sans","inherit"),zt=x("font-mono","monospace"),un=x("radius","9px"),Jt=`calc(${un} - 2px)`,ln=`calc(${un} - 4px)`,y=(e,o,s="transparent")=>`color-mix(in srgb, ${e} ${o}%, ${s})`,dn=`background-image: linear-gradient(${L}, ${L});`,Yt=(e,o="0.5px")=>`box-shadow: inset 0 0 0 ${o} ${e}, var(--oc-sdk-field-lift);`,Qt="border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);",pn="box-shadow: var(--oc-sdk-lit);",Zt=`inset 0 0.5px 0 0 ${y(G,8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`,Xn=`
:root {
  --oc-sdk-edge: ${y(G,16)};
  --oc-sdk-field-bg: ${ze};
  --oc-sdk-raised-bg: ${z};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${y(G,14)};
  --oc-sdk-field-bg: ${y(z,50,ze)};
  --oc-sdk-raised-bg: ${ze};
  --oc-sdk-field-lift: ${Zt};
  --oc-sdk-raised-lift: ${Zt};
  --oc-sdk-lit: ${Zt};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`,We=(e)=>{let o=x(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${o}; --oc-sdk-tone-text: ${x(`${e}-text`,"inherit")}; }`},c=(e)=>`calc(${e}rem / 14)`,Vn=`
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${c(8)}; height: ${c(32)}; padding: 0 ${c(12)}; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: ${c(6)}; height: ${c(28)}; padding: 0 ${c(10)}; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: ${c(4)}; height: ${c(24)}; padding: 0 ${c(8)}; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: ${c(14)}; height: ${c(14)}; }

.oc-sdk-field { display: flex; flex-direction: column; gap: ${c(4)}; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: ${c(32)}; padding: 0 ${c(10)}; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: ${c(8)} ${c(10)}; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: ${c(34)}; padding-right: ${c(34)}; }
.oc-sdk-search-icon { position: absolute; left: ${c(11)}; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: ${c(6)}; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: ${c(24)}; height: ${c(24)}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: ${c(4)}; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: ${c(6)}; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: ${c(28)}; padding: 0 ${c(10)}; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: ${c(2)}; min-width: ${c(160)}; max-width: calc(100vw - ${c(16)}); max-height: min(${c(320)}, calc(100vh - ${c(16)})); overflow: auto; padding: ${c(4)}; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: ${c(2)} ${c(2)} ${c(4)}; }
.oc-sdk-popup-search .oc-sdk-input { height: ${c(28)}; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: ${c(8)}; width: 100%; padding: ${c(6)} ${c(8)}; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: ${c(14)}; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: ${c(8)}; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: ${c(8)}; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: ${c(14)}; height: ${c(14)}; margin-top: ${c(3)}; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: ${c(36)}; height: ${c(20)}; --oc-sdk-thumb-travel: ${c(16)}; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: ${c(2)}; left: ${c(2)}; width: ${c(16)}; height: ${c(16)}; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: ${c(2)}; padding: ${c(2)}; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: ${c(6)}; height: ${c(28)}; padding: 0 ${c(10)}; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: ${c(1)} ${c(6)}; font-size: ${c(11)}; font-weight: 500; line-height: ${c(16)}; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: ${c(8)}; width: 100%; padding: ${c(6)} ${c(8)}; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: ${c(64)}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: ${c(16)} ${c(8)}; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${c(4)}; padding: ${c(40)} ${c(16)}; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: ${c(12)}; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: ${c(8)}; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: ${c(16)}; height: ${c(16)}; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: ${c(12)}; height: ${c(12)}; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: ${c(12)}; padding: ${c(8)} ${c(12)}; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: ${c(2)}; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: ${c(8)}; width: 100%; margin: ${c(8)} 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: ${c(4)} 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: ${c(4)}; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: ${c(6)}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: ${c(2)}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: ${c(8)} 0; }

/* Under a finger the controls reach the app's touch sizes: rows and options 44px like its sheets, every other
   control at least 36px. Inputs keep 16px text, below which iOS zooms the page on focus. */
@media (pointer: coarse) {
  .oc-sdk-btn, .oc-sdk-input { height: ${c(40)}; }
  .oc-sdk-btn[data-size="sm"], .oc-sdk-btn[data-size="xs"], .oc-sdk-trigger, .oc-sdk-tab, .oc-sdk-popup-search .oc-sdk-input { height: ${c(36)}; }
  .oc-sdk-input, .oc-sdk-popup-search .oc-sdk-input { font-size: max(16px, 0.875rem); }
  .oc-sdk-search-clear { width: ${c(36)}; height: ${c(36)}; right: 0; }
  .oc-sdk-row, .oc-sdk-option { min-height: ${c(44)}; }
  .oc-sdk-check { min-height: ${c(36)}; padding: ${c(8)} 0; }
}
`,_n=`${Xn}
.oc-sdk { color: ${G}; font-family: ${Hn}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${dn} }
.oc-sdk-mono { font-family: ${zt}; }
.oc-sdk-muted { color: ${C}; }
${We("success")}${We("warning")}${We("error")}${We("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${W}; --oc-sdk-tone-text: ${jt}; }

.oc-sdk-btn { border-radius: ${Jt}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${ln}; }
.oc-sdk-btn[data-variant="default"] { color: ${jt}; background: ${y(W,10,z)}; border-color: ${y(W,12)}; ${pn} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${y(W,16,z)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${y(W,22,z)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${$n}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${L}, ${L}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${ee}, ${ee}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${pe}; ${Qt} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${L}, ${L}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${ee}, ${ee}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${L}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${ee}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${x("status-error","red")}; color: ${Wt}; background: ${y("var(--oc-sdk-tone)",7,z)}; border-color: ${y("var(--oc-sdk-tone)",12)}; ${pn} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${y("var(--oc-sdk-tone)",9,z)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${y("var(--oc-sdk-tone)",11,z)}; box-shadow: none; }

.oc-sdk-field-note { color: ${C}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${Wt}; }
.oc-sdk-input { border-radius: ${Jt}; background: var(--oc-sdk-field-bg); color: ${pe}; ${Yt("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${C}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${L}, ${L}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${Yt(y(G,26),"1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${Yt(x("status-error","red"),"1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${zt}; }

.oc-sdk-search-icon { color: ${C}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${W}; }
.oc-sdk-search-clear { border-radius: ${ln}; color: ${C}; }
.oc-sdk-search-clear:hover { background: ${L}; color: ${G}; }

.oc-sdk-trigger { border-radius: ${Jt}; background: var(--oc-sdk-raised-bg); color: ${pe}; ${Qt} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${L}, ${L}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${ee}, ${ee}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${C}; }
.oc-sdk-trigger-chevron { color: ${C}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${pe}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${ze}; background-clip: padding-box; color: ${pe}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${L}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${Bt}; color: ${Kt}; }
.oc-sdk-option-check { color: ${G}; }
.oc-sdk-option[data-destructive="true"] { color: ${Wt}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${y(x("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${C}; }
.oc-sdk-popup-empty { color: ${C}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${q}; border-radius: 4px; color: ${G}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${y(G,60,q)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${q}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${z}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${W}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${dn} }
.oc-sdk-check-desc { color: ${C}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${y(G,4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${C}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${G}; }
.oc-sdk-tab[aria-selected="true"] { color: ${Kt}; background: ${Bt}; border-color: ${q}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${pe}; background: var(--oc-sdk-raised-bg); ${Qt} }
.oc-sdk-tab-count { color: ${C}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${y(G,6)}; color: ${C}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${y("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${L}; }
.oc-sdk-row[aria-selected="true"] { background: ${Bt}; color: ${Kt}; }
.oc-sdk-row-lead { font-family: ${zt}; color: ${C}; }
.oc-sdk-row-sub { color: ${C}; }
.oc-sdk-row-meta { color: ${C}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${C}; }

.oc-sdk-empty-body { color: ${C}; }

.oc-sdk-spinner { color: ${C}; }
.oc-sdk-spinner-ring { border-color: ${q}; border-top-color: ${W}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${y("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${C}; }

.oc-sdk-separator { color: ${C}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${y(q,40)}; }

.oc-sdk-progress-label { color: ${C}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${y(G,6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${W}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${x("status-success","currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${x("success-text","inherit")}; }

.oc-sdk-text a { color: ${jt}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${y(q,60)}; }
`,v=`
${_t}
${Vn}
${_n}`;var eo=Object.freeze({READY:"ready",CHOOSE_LEAD:"choose-lead",NO_CANDIDATES:"no-candidates"}),Wn=new Set(["primary","all",void 0,null,""]);function me(e){if(typeof e==="string"){let o=e.trim();return o===""?null:o}if(e&&typeof e==="object")return me(e.id??e.name??e.key??e.agent);return null}function zn(e){if(!e||typeof e!=="object")return[];let o=Array.isArray(e)?e.map((i)=>[me(i),i]):Object.entries(e).map(([i,l])=>[me(i)??me(l),l]),s=new Set,a=[];for(let[i,l]of o){if(i===null||s.has(i))continue;s.add(i),a.push({id:i,agent:l&&typeof l==="object"?l:{}})}return a}function Jn(e){let o=e&&typeof e==="object"?e:{};if(o.hidden===!0)return!1;if(o.subagentOnly===!0||o.subagent===!0)return!1;if(o.mode!==void 0&&!Wn.has(o.mode))return!1;return!0}function to(e,o){let a=zn(e).filter((l)=>Jn(l.agent)).map((l)=>l.id),i=me(o);if(i!==null&&a.includes(i))return{selected:i,available:a,nextAction:eo.READY};if(a.length===0)return{selected:null,available:a,nextAction:eo.NO_CANDIDATES};return{selected:null,available:a,nextAction:eo.CHOOSE_LEAD}}var oo=["Set up Agent Office in this project. Use the installed Agent Office companion. If it is unavailable, explain how to install it before making changes.","","1. DISCOVERY (read only)","   - Inspect the live OpenCode agent and model lists in this directory. Show the current Office settings and their sources.","   - Identify a lead candidate (a visible, top-level-capable agent) plus optional implementer and reviewer agents.","   - If no lead is selected or its ID is missing, offer an available primary agent or preview an optional starter lead. Do not silently substitute one.","   - Record what already exists so you do not duplicate it.","","2. PREVIEW (no writes)","   - Run the installer in preview mode. Show exact paths, skipped existing definitions, the proposed lead, and lower-cost specialist models from the host catalog.","   - Ask the user to select the lead and specialist model, or explicitly keep the host default.","   - Wait for confirmation before writing anything.","","3. SETUP (idempotent)","   - Apply only the approved project settings and missing optional templates. Never overwrite an existing definition or change global defaults.","   - Preview a second time and verify existing files are unchanged.","   - Persist the lead id exactly as validated. Re-running must produce the same result with no duplicates.","","4. SMOKE (verify)","   - Dispatch one small agreed task through Agent Office using the selected lead and a real specialist. Have the lead verify the resulting file or check.","   - Inspect the team under that root. Report the actual parent/child relationship, observed models, and verification result; distinguish missing evidence from success.","   - Report the files touched and the checks run. Do not commit unless explicitly asked."].join(`
`);var no=["Problem: In a sample project, two agents use the same display name.","Proposed change: Show the role beside each name.","Acceptance test: Create two example agents named Helper. Confirm that their roles distinguish them."].join(`

`);function En(e){if(!e.trim()||e.length>3000)throw Error("Use a synthetic example of 1–3,000 characters.");if(/(?:\bses_[\w-]+|\/(?:Users|home|private|var|tmp)\/|[A-Z]:\\|~\/|(?:ghp_|github_pat_|sk-)[\w-]+|BEGIN .*PRIVATE KEY)/i.test(e))throw Error("Remove local paths, session IDs and credentials before opening a public draft.");let o=new URL("https://github.com/b4db1n/agent-office/issues/new");return o.searchParams.set("title","Agent Office improvement"),o.searchParams.set("body",e),o.href}function Sn(e,o,s){if(!s||!o||e?.state!=="ready")return[];let a=e.sessions.filter((l)=>!l.archivedAt&&l.projectId===o),i=new Map(a.map((l)=>[l.id,l]));if(!i.has(s))return[];return a.filter((l)=>{let m=new Set,A=l;while(A&&!m.has(A.id)){if(A.id===s)return!0;m.add(A.id),A=i.get(A.parentId)}return!1})}var H=Vt(),fn=document.querySelector("#root");if(!fn)throw Error("Agent Office page has no root element.");var Ie=fn,An=["lead","leadModel","specialistModel","agentModels","language","appearance","notifications","visibleControls","parallelism","budget"],r={ready:null,surface:"panel",view:"office",directory:null,projectId:null,rootId:null,rootTitle:"",snapshot:null,snapshotState:"loading",snapshotError:"",drafts:new Map,talkDraft:"",inspect:null,inspectState:"idle",inspectError:"",settingsScope:"project",contribText:no},so=null,et=0,tt=0,te=null,nt=0,qe=0,ot=0,_e=new Map;function On(e){return typeof e==="object"&&e!==null&&!Array.isArray(e)}function Q(e,o){H.toast({kind:e,message:o}).catch(()=>{return})}function rt(e){if(e&&typeof e==="object"){let{code:o,message:s}=e;if(typeof o==="string"){if(o==="NO_SERVICE")return"The Agent Office service is off. Allow it in Settings → Extensions.";if(o==="SERVICE_FAILED")return"The Agent Office service stopped. Try again.";if(o==="NOT_GRANTED")return"OpenChamber did not grant that permission.";if(o==="HOST_TIMEOUT")return"OpenChamber did not answer. Try again.";if(o==="UNSUPPORTED")return"This OpenChamber surface cannot do that."}if(typeof s==="string"&&s.trim().length>0&&s.length<240)return s.trim()}return"That did not work. Try again."}async function hn(e,o){let s=await H.serviceRequest({method:o===void 0?"GET":"POST",path:e,...o===void 0?{}:{body:JSON.stringify(o)}}),a={};try{a=JSON.parse(s.body||"{}")}catch{a={}}let i=On(a)?a:{};if(s.status<200||s.status>=300||i.ok===!1){let l=Error(typeof i.message==="string"?i.message:"The Agent Office service refused that.");throw l.code=typeof i.code==="string"?i.code:void 0,l}return i}function ge(e){return e.replace(/\/+$/,"")}function Yn(e,o){let s=ge(o),a=e.find((l)=>ge(l.directory)===s);if(a)return a.id;return e.filter((l)=>s.startsWith(`${ge(l.directory)}/`)).sort((l,m)=>ge(m.directory).length-ge(l.directory).length)[0]?.id??null}function O(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function io(e){if(e.activity==="waiting-permission"||e.activity==="waiting-question")return"waiting";if(e.activity==="running"||e.activity==="retrying")return"running";if(e.outcome==="failed")return"failed";return e.unread||e.outcome==="completed"?"ready":"idle"}function Rn(e){if(e.activity==="waiting-permission")return"Waiting (permission)";if(e.activity==="waiting-question")return"Waiting (question)";if(e.activity==="running")return"Running";if(e.activity==="retrying")return"Retrying";if(e.outcome==="failed")return"Failed";if(e.unread||e.outcome==="completed")return"Reply ready";return e.activity==="unknown"?"Status unknown":"Idle"}function Qn(e){let o=e.trim().split(/\s+/).filter(Boolean);if(o.length===0)return"?";if(o.length===1)return o[0].slice(0,2).toUpperCase();return(o[0][0]+o[o.length-1][0]).toUpperCase()}function st(){return JSON.stringify([r.directory,r.rootId])}async function Zn(){let e=st(),o=nt;if(r.talkDraft=r.drafts.get(e)??"",r.drafts.has(e))return;let s=`draft:talk:${e}`;try{let a=await H.storage.get(s);if(typeof a==="string"&&o===nt&&e===st()&&!r.drafts.has(e))r.talkDraft=a,U()}catch{}}async function qn(){let e=`draft:talk:${st()}`;try{await H.storage.set(e,r.talkDraft)}catch{}}async function oe(){if(!r.directory){r.inspect=null,r.inspectState="idle",r.inspectError="No project directory selected.",U();return}let e=++ot;r.inspectState="loading",r.inspectError="",U();try{let o=await hn("/inspect",{directory:r.directory});if(e!==ot)return;r.inspect=o,r.inspectState="ready"}catch(o){if(e!==ot)return;r.inspectState="error",r.inspectError=rt(o)}U()}async function er(){if(!r.directory){Q("error","Open a project first.");return}let e={};for(let o of An){if(!_e.has(o))continue;let s=document.getElementById(`setting-${o}`);if(!s)continue;let a=s.value;if(!a.trim())e[o]=null;else if(o==="notifications")e[o]=a==="true";else if(o==="parallelism"||o==="budget"){let i=Number(a);e[o]=Number.isFinite(i)&&a.trim()!==""?i:a}else if(o==="agentModels"||o==="visibleControls"){let i=a.trim();if(i.startsWith("{")||i.startsWith("["))try{e[o]=JSON.parse(i)}catch{e[o]=a}else e[o]=a}else e[o]=a}try{await hn("/settings",{directory:r.directory,scope:r.settingsScope,values:e}),_e.clear(),Q("success",`Settings saved (${r.settingsScope}).`),await oe()}catch(o){Q("error",rt(o))}}function mn(e){if(r.view=e,e==="settings"&&!r.inspect&&r.directory)oe();U()}function tr(){if(qe)cancelAnimationFrame(qe);qe=requestAnimationFrame(()=>{qe=0;let e=Math.ceil(Ie.getBoundingClientRect().height);H.setHeight(Math.min(480,Math.max(24,e))).catch(()=>{return})})}async function ao(e){if(!e)return;try{await H.openSession(e)}catch{Q("error","Open this chat from the sidebar.")}}async function or(){try{await H.writeClipboard(oo),Q("success","Setup prompt copied.")}catch{Q("error","Could not copy. Select and copy manually.")}}function nr(){let e=document.getElementById("contrib-text"),o=e?e.value:r.contribText;r.contribText=o;try{H.openUrl(En(o)).catch((s)=>Q("error",rt(s)))}catch(s){Q("error",rt(s))}}function rr(){r.contribText=no,r.view="office",U()}function gn(e,o){if(e===r.rootId)return r.rootTitle=o,!1;return++nt,r.rootId=e,r.rootTitle=o,r.talkDraft="",Zn(),!0}async function it(e=!1){let o=r.directory;if(!o){r.projectId=null,r.snapshot=null,r.snapshotState="error",r.snapshotError="No project folder is open.",U();return}let s=++tt;try{let a=await H.listProjects();if(s!==tt)return;if(a.state!=="ready"){r.snapshotState="loading",r.snapshotError="OpenChamber is still loading the project list.",U();return}let i=Yn(a.projects,o);if(!i){r.projectId=null,r.snapshot=null,r.snapshotState="error",r.snapshotError="This folder is not a registered OpenChamber project.",U();return}if(!e&&so===i&&te){r.projectId=i,U(),oe();return}let l=++et;if(te)te(),te=null;so=i,r.projectId=i,r.snapshot=null,r.snapshotState="loading",r.snapshotError="",U();let m=await H.onSessions(i,(A)=>{if(l!==et)return;if(A.kind!=="sessions")return;r.snapshot=A,r.snapshotState=A.state==="ready"?"ready":A.state==="loading"?"loading":"error",r.snapshotError=A.state==="error"?"OpenChamber could not read the session list.":"",U()});if(l!==et){m();return}te=m,oe()}catch{if(s!==tt)return;r.snapshotState="loading",r.snapshotError="OpenChamber did not send the session list.",U()}}function sr(){let e=to(r.inspect?.agents??[],r.inspect?.settings.lead),o=lo(),s=[["Project",!!r.directory,r.directory?"Current project selected.":"Open a project to scope the Office."],["Session access",r.snapshotState==="ready",r.snapshotState==="ready"?"Live updates connected.":"Approve session access to see the team."],["Local service",r.inspectState==="ready",r.inspectState==="ready"?"OpenCode answered.":"Allow the service and opencode executable in Extensions."],["Lead",!!e.selected,e.selected||`Choose ${e.available.join(" or ")||"a starter lead"} in Settings to receive work.`],["Models",!!r.inspect?.models.length,`${r.inspect?.models.length??0} available. Choose the lead and specialist models in Settings.`],["Chat command",r.inspect?.plugin===!0,r.inspect?.plugin?"/office is available.":"Use Ask Office lead, or preview the companion plugin for /office."]];return`
    <div class="ao-shell">
      <h2 class="ao-title">Agent Office</h2>
      <p class="ao-sub">${O(r.directory??"No project directory")}</p>
      <div class="ao-card">
        <div class="ao-checklist">
          ${s.map(([a,i,l])=>`
            <div class="ao-check ${i?"ok":""}">
              <span class="dot"></span>
               <span>${O(a)}: ${O(l)}</span>
            </div>`).join("")}
        </div>
         <div class="ao-row">
           <button class="ao-btn" data-view="settings">Settings</button>
           <button class="ao-btn" data-view="office">Open Office</button>
          <button class="ao-btn primary" data-action="copySetup">Copy setup prompt</button>
          <button class="ao-btn" data-action="refresh">Refresh</button>
        </div>
        <div>${o.filter((a)=>io(a)==="waiting"||io(a)==="ready").map((a)=>`<button class="ao-btn" data-session="${O(a.id)}">${O(a.agent||a.title)} · ${O(Rn(a))}</button>`).join("")}</div>
        <details><summary>Read setup prompt</summary><pre class="ao-pre">${O(oo)}</pre></details>
      </div>
    </div>
  `}function ir(){let e=lo(),o=e.length===0?`<div class="ao-empty">${r.snapshotState==="ready"?"No team visible under this chat.":"Waiting for project sessions…"}</div>`:`<div class="ao-grid">
          ${e.map((a)=>`
            <button id="agent-${O(a.id)}" class="ao-agent" data-tone="${io(a)}" data-session="${O(a.id)}">
              <span class="ao-avatar" aria-hidden="true">${O(Qn(a.agent||a.title))}</span>
              <div class="ao-row" style="justify-content:space-between;">
                <span class="ao-agent-name">${O(a.agent||a.title)}</span>
                <span class="ao-agent-state">${O(Rn(a))}</span>
              </div>
              <div class="ao-agent-detail">${O(a.title)}</div>
               <div class="ao-agent-detail ao-muted">${O(a.tool?[a.tool.name,a.tool.target].filter(Boolean).join(" · "):"")}</div>
            </button>`).join("")}
        </div>`,s=O(r.talkDraft);return`
    <div class="ao-shell">
      <div>
        <h2 class="ao-title">Agent Office</h2>
        <p class="ao-sub">${O(r.rootTitle||r.directory||"No session")}</p>
      </div>
      ${o}
      <div class="ao-card">
        <div class="ao-field">
          <label for="talk-draft">Talk (opens session, never sends)</label>
          <textarea id="talk-draft" class="ao-textarea" rows="3">${s}</textarea>
        </div>
        <div class="ao-row">
          ${r.rootId?'<button class="ao-btn primary" data-action="talkOpen">Open selected session</button>':""}
          <button class="ao-btn" data-action="refresh">Refresh</button>
        </div>
      </div>
    </div>
  `}function ar(){let e=r.inspect,o=An.map((i)=>{let l=e?.[r.settingsScope],m=_e.get(i)??(On(l)?l[i]:void 0),A=typeof m==="string"?m:m===null||m===void 0?"":JSON.stringify(m,null,2),K=i==="agentModels"||i==="visibleControls",V=i==="lead"?to(e?.agents??[],null).available:["leadModel","specialistModel"].includes(i)?e?.models??[]:i==="notifications"?["true","false"]:null,Z=V?`<select id="setting-${i}" class="ao-input"><option value="">Inherit default</option>${V.map((Y)=>`<option value="${O(Y)}" ${Y===A?"selected":""}>${O(Y)}</option>`).join("")}</select>`:K?`<textarea id="setting-${i}" class="ao-textarea">${O(A)}</textarea>`:`<input id="setting-${i}" class="ao-input" value="${O(A)}" />`;return`<div class="ao-field"><label for="setting-${i}">${O(i)}</label>${Z}<small>Effective: ${O(JSON.stringify(e?.settings[i])??"Host default")} · ${O(e?.sources[i]??"host")}</small></div>`}).join(""),s=(e?.agents??[]).map((i)=>`<tr><td>${O(i.id)}</td><td>${O(i.mode??"")}</td><td>${i.hidden?"yes":"no"}</td></tr>`).join(""),a=(e?.models??[]).map((i)=>`<li>${O(i)}</li>`).join("");return`
    <div class="ao-shell">
      <div>
        <h2 class="ao-title">Settings</h2>
        <p class="ao-sub">${r.inspectState==="loading"?"Loading…":r.inspectError?O(r.inspectError):"Effective configuration"}</p>
      </div>
      <div class="ao-card">
        <div class="ao-row">
          <span class="ao-muted">Scope:</span>
          <button class="ao-btn ${r.settingsScope==="global"?"primary":""}" data-scope="global">Global</button>
          <button class="ao-btn ${r.settingsScope==="project"?"primary":""}" data-scope="project">Project</button>
          <button class="ao-btn primary" data-action="saveSettings">Save</button>
          <button class="ao-btn" data-action="refreshInspect">Refresh</button>
        </div>
        <div class="ao-field-grid" style="display:grid;gap:8px;">
          ${o}
        </div>
      </div>
      <div class="ao-card">
        <h3 class="ao-title" style="font-size:13px;">Agents</h3>
        <table class="ao-table">
          <thead><tr><th>id</th><th>mode</th><th>hidden</th></tr></thead>
          <tbody>${s||'<tr><td colspan="3" class="ao-muted">None</td></tr>'}</tbody>
        </table>
      </div>
      <div class="ao-card">
        <h3 class="ao-title" style="font-size:13px;">Models</h3>
        <ul>${a||'<li class="ao-muted">None</li>'}</ul>
        <h3 class="ao-title" style="font-size:13px;margin-top:8px;">Model origin / sources</h3>
        <pre class="ao-pre">${O(JSON.stringify(r.inspect?.sources??{},null,2))}</pre>
        <h3 class="ao-title" style="font-size:13px;margin-top:8px;">Project</h3>
        <pre class="ao-pre">${O(JSON.stringify(r.inspect?.project??null,null,2))}</pre>
        <h3 class="ao-title" style="font-size:13px;margin-top:8px;">Global</h3>
        <pre class="ao-pre">${O(JSON.stringify(r.inspect?.global??null,null,2))}</pre>
        <p class="ao-muted">Plugin: ${O(r.inspect?.plugin)}</p>
      </div>
    </div>
  `}function cr(){return`
    <div class="ao-shell">
      <div>
        <h2 class="ao-title">Contribution preview</h2>
        <p class="ao-sub">Edit the synthetic text. Nothing is sent until you click "Open GitHub issue draft".</p>
      </div>
      <div class="ao-card">
        <textarea id="contrib-text" class="ao-textarea">${O(r.contribText)}</textarea>
        <div class="ao-row">
          <button class="ao-btn primary" data-action="openIssueDraft">Open GitHub issue draft</button>
          <button class="ao-btn" data-action="cancelContribute">Cancel</button>
        </div>
      </div>
    </div>
  `}function Tn(){let e=["office","settings","contribute"].map((s)=>`
    <button class="ao-tab" aria-pressed="${r.view===s}" data-view="${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</button>`).join(""),o="";if(r.view==="settings")o=ar();else if(r.view==="contribute")o=cr();else o=ir();return`
    <div class="ao-shell">
      <div class="ao-tabs">${e}</div>
      ${o}
    </div>
  `}var ro=null;function U(){if(ro=document.activeElement&&document.activeElement.id?document.activeElement.id:null,r.surface==="status")Ie.innerHTML=r.view==="status"?sr():'<button data-view="status" class="ao-btn">Back to Work Status</button>'+Tn();else Ie.innerHTML=Tn();if(ro){let e=document.getElementById(ro);if(e&&typeof e.focus==="function")e.focus()}if(r.surface==="status")tr()}var co={setView:(e)=>mn(e),refresh:()=>{it(!0)},refreshInspect:()=>{oe()},openSession:(e)=>{ao(e)},talkInput:(e)=>{r.talkDraft=e,r.drafts.set(st(),e),qn()},talkOpen:()=>{if(r.rootId)ao(r.rootId)},copySetup:()=>{or()},setScope:(e)=>{_e.clear(),r.settingsScope=e==="project"?"project":"global",U()},saveSettings:()=>{er()},openIssueDraft:()=>{nr()},cancelContribute:()=>{rr()}};H.onReady((e)=>{Ft(e,document.documentElement),r.ready=e;let o=e.surface==="status"?"status":"panel";if(r.surface!==o)r.view=o==="status"?"status":"office";r.surface=o;let s=r.directory;In(e.directory);let a=gn(e.session?.id??null,e.session?.title??"");if(U(),a||r.directory!==s)it();if(r.surface==="status")oe()});H.onSession((e)=>{let o=r.rootTitle,s=gn(e?.id??null,e?.title??"");if(s||r.rootTitle!==o)U();if(s)it()});H.onDirectory((e)=>{if(e===r.directory)return;In(e),U(),it(),oe()});function In(e){if(e===r.directory)return;et++,tt++,ot++,nt++,te?.(),te=null,so=null,r.directory=e,r.snapshot=null,r.projectId=null,_e.clear(),r.inspect=null,r.inspectState="idle",r.snapshotState="loading",r.rootId=null,r.talkDraft="",r.rootTitle=""}function lo(){return Sn(r.snapshot,r.projectId,r.rootId)}Ie.addEventListener("input",(e)=>{let o=e.target;if(o.id?.startsWith("setting-"))_e.set(o.id.slice(8),o.value);if(e.target instanceof HTMLTextAreaElement&&e.target.id==="talk-draft")co.talkInput(e.target.value);if(e.target instanceof HTMLTextAreaElement&&e.target.id==="contrib-text")r.contribText=e.target.value});Ie.addEventListener("click",(e)=>{let o=e.target.closest("[data-view]")?.dataset.view;if(o==="office"||o==="settings"||o==="status"||o==="contribute")mn(o);let s=e.target.closest("[data-action],[data-scope]");if(s?.dataset.scope)co.setScope(s.dataset.scope);let a=s?.dataset.action;if(a&&["copySetup","refresh","refreshInspect","saveSettings","openIssueDraft","cancelContribute","talkOpen"].includes(a))co[a]();let i=e.target.closest("[data-session]")?.dataset.session;if(i&&lo().some((l)=>l.id===i))ao(i)});U();})();
