(()=>{
"use strict";
var DOC=document,WN=navigator,HTM=DOC.documentElement;
function qs(name){var m=location.search.match(new RegExp("[?&]"+name+"=([^&]*)"));return m?decodeURIComponent(m[1]):"";}
function cookie(name){var m=DOC.cookie.match("(?:^|; )"+name+"=([^;]*)");return m?decodeURIComponent(m[1]):"";}
function setCookie(name,val,days){var d=new Date();d.setTime(d.getTime()+(days||7)*864e5);DOC.cookie=name+"="+encodeURIComponent(val)+"; expires="+d.toUTCString()+"; path=/; SameSite=Lax";}
function clearCookie(name){DOC.cookie=name+"=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax";}
function netInfo(){try{var c=WN.connection||WN.mozConnection||WN.webkitConnection||null;if(!c)return null;return{et:c.effectiveType||"unknown",save:c.saveData===true,down:c.downlink||0,rtt:c.rtt||0};}catch(e){return null;}}
function uaInfo(){
  var ua=WN.userAgent||"",low=ua.toLowerCase();
  var textUA=/curl\/|curl |wget\/|aria2|httpie|lynx|w3m|elinks|links2|python-requests|python-urllib|okhttp|http\.rb|powershell|zsh_c|bot\b|spider|crawler|slurp|\-bot|googlebot|bingbot|duckduckbot|facebookexternalhit|telegrambot|twitterbot|archive-org_/i.test(low);
  var uad=WN.userAgentData,plat=uad?((uad.platform||"")+"|"+(uad.mobile?"mobile":"desktop")):(WN.platform||"unknown");
  return{ua:low,text:!!textUA,plat:plat,mobile:!!(uad?uad.mobile:(/mobi|android|iphone|ipad/i.test(low)))};
}
var ENT={"amp":"&","lt":"<","gt":">","quot":'"',"apos":"'","#39":"'","nbsp":" ","copy":"\u00A9","reg":"\u00AE","trade":"\u2122","mdash":"\u2014","ndash":"\u2013","hellip":"\u2026","times":"\u00D7","middot":"\u00B7"};
function decodeEntities(s){return String(s).replace(/&(amp|lt|gt|quot|apos|#39|nbsp|copy|reg|trade|mdash|ndash|hellip|times|middot);/g,function(m,n){return ENT[n]||m;}).replace(/&#x([0-9a-fA-F]+);/g,function(m,n){try{return String.fromCodePoint(parseInt(n,16));}catch(e){return m;}}).replace(/&#(\d+);/g,function(m,n){try{return String.fromCharCode(+n);}catch(e){return m;}});}
function stripHTML(html){
  var s=String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<noscript[\s\S]*?<\/noscript>/gi," ").replace(/<svg[\s\S]*?<\/svg>/gi," ").replace(/<!--[\s\S]*?-->/g," ");
  s=s.replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|div|h[1-6]|section|article|li|pre|details|summary|header|footer|dl|dt|dd|ol|ul|tr|hgroup)>/gi,"\n").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ");
  s=decodeEntities(s).replace(/[ \t]+/g," ").replace(/\n\s*\n\s*\n+/g,"\n\n").replace(/^\s+|\s+$/g,"");
  return s;
}
// Response headers only. A HEAD keeps this at ~0 bytes; the previous version
// re-fetched the whole document with cache:"no-store" on every load, so the
// browser downloaded a second copy of the page (and re-ran the whole Worker
// HTML rewrite) before the tty had even rendered. The body is only pulled when
// ?raw=1 actually needs the server's markup, and the in-memory document is used
// as the fallback.
async function fetchHeaders(){
  var hd={status:0,"content-type":DOC.contentType||"","content-length":"",date:"",server:"","cf-ray":""};
  try{
    var r=await fetch(location.href,{method:"HEAD",cache:"no-store",headers:{"accept":"text/html"}});
    hd.status=r.status;
    hd["content-type"]=r.headers.get("content-type")||hd["content-type"];
    hd["content-length"]=r.headers.get("content-length")||"";
    hd.date=r.headers.get("date")||"";
    hd.server=r.headers.get("server")||"";
    hd["cf-ray"]=r.headers.get("cf-ray")||"";
  }catch(e){hd.err=String(e);}
  if(!hd["content-length"]){
    try{
      var t=WN.performance&&WN.performance.getEntriesByType("navigation")[0];
      if(t&&t.transferSize)hd["content-length"]=String(t.transferSize);
      else hd["content-length"]=String(DOC.documentElement.outerHTML.length);
    }catch(e2){}
  }
  return hd;
}
async function fetchBody(){
  try{
    var r=await fetch(location.href,{cache:"no-store",headers:{"accept":"text/html"}});
    return new TextDecoder().decode(await r.arrayBuffer());
  }catch(e){return DOC.documentElement.outerHTML;}
}
async function fetchHandlers(){
  var hd=await fetchHeaders();
  if(qs("raw")||cookie("htp_tty")==="raw")hd._body=await fetchBody();
  else hd._body=DOC.documentElement.outerHTML;
  return hd;
}
async function probe(){
  var mode="";
  if(qs("raw"))mode="raw";
  else if(qs("plain"))mode="plain";
  else if(qs("tty"))mode="plain";
  else if(qs("full"))mode="full";
  var ck=cookie("htp_tty");
  if(!mode&&(ck==="raw"||ck==="plain"||ck==="full"))mode=ck;
  var ua=uaInfo(),net=netInfo();
  var hd=await fetchHandlers();
  var reason="browser ("+(net?"effectiveType "+net.et:"no conn api")+")",auto=false;
  if(!mode){
    if(ua.text){mode="raw";reason="user-agent "+(WN.userAgent||"").slice(0,36);auto=true;}
    else if(net&&(net.save||net.et==="slow-2g"||net.et==="2g"||net.down<1.2)){mode="plain";reason="weak link (effectiveType "+net.et+(net.save?", saveData":"")+(net.down?", "+net.down+" Mb/s":"")+")";auto=true;}
    else mode="full";
  }
  if(auto||(mode==="raw"||mode==="plain"))setCookie("htp_tty",mode,7);
  else if(mode==="full"&&!qs("full"))clearCookie("htp_tty");
  return{mode:mode,reason:reason,ua:ua,net:net,hd:hd,sig:qs("raw")||qs("plain")||qs("tty")||qs("full"),ck:ck,auto:auto};
}
function app(txt,cls){var term=DOC.getElementById("terminal");if(!term)return;var s=DOC.createElement("span");if(cls)s.className=cls;s.textContent=txt;term.appendChild(s);term.appendChild(DOC.createElement("br"));term.scrollTop=term.scrollHeight;}
function report(r){
  app("[conn] direct handshake \u2014 mode: "+r.mode+(r.auto?" (auto)":"")+" \u2014 "+r.reason,"cyan");
  app("      ua: "+((WN.userAgent||"").slice(0,52)||"?")+" \u00B7 plat: "+r.ua.plat,"dim");
  app("      net: effectiveType="+(r.net?r.net.et:"-")+(r.net&&r.net.save?", saveData":"")+(r.net?", "+r.net.down+" Mb/s / "+r.net.rtt+" ms":"")+((DOC.hidden===undefined)?"":"")+" \u00B7 cookie htp_tty="+(r.ck||"none"),"dim");
  app("      GET "+location.pathname+location.search+" \u2192 HTTP "+r.hd.status+" \u00B7 content-type "+(r.hd["content-type"]||"-")+" \u00B7 content-length "+(r.hd["content-length"]||"-")+" bytes","dim");
  if(r.mode==="full")app("      [full] ascii banner + terminal render live. force ?raw=1 / ?plain=1 / ?tty=1 / cookie htp_tty to switch.","dim");
  if(r.mode==="plain")app("      [plain] heavy layers stripped, text kept raw \u2014 ?full=1 or cookie htp_tty=full restores.","dim");
  if(r.mode==="raw")app("      [raw] body replaced with curl-style text dump \u2014 ?full=1 or cookie htp_tty=full restores.","dim");
}
function applyRaw(r){
  var pre=DOC.createElement("pre");
  pre.className="raw-curl";
  pre.textContent=
    "HTTP/1.1 "+(r.hd.status||200)+" "+((r.hd.status===200?"OK":""))+"\n"+
    "content-type: "+(r.hd["content-type"]||"-")+"\n"+
    "content-length: "+(r.hd["content-length"]||"-")+"\n"+
    (r.hd.date?("date: "+r.hd.date+"\n"):"")+
    (r.hd.server?("server: "+r.hd.server+"\n"):"")+
    (r.hd["cf-ray"]?("cf-ray: "+r.hd["cf-ray"]+"\n"):"")+
    "x-content-text: extracted plain text (script-tags stripped, entities decoded)\n"+
    "\n"+
    stripHTML(r.hd._body||"");
  DOC.body.replaceChildren(pre);
  HTM.classList.add("raw-mode");
  HTM.classList.remove("plain-mode");
  HTM.setAttribute("data-conn-mode","raw");
}
async function main(){
  HTM.classList.add("js-on");
  var r=await probe();
  HTM.setAttribute("data-conn-mode",r.mode);
  if(r.mode==="raw"){applyRaw(r);console.log("[wire] raw mode",r);return;}
  if(r.mode==="plain"){HTM.classList.add("plain-mode");HTM.classList.remove("raw-mode");}
  report(r);
  console.log("[wire] handshake",r);
  WN.__htpWire=function(){probe().then(function(x){if(x.mode!==r.mode&&r.mode==="raw")return;report(x);});};
}
if(DOC.readyState==="loading")DOC.addEventListener("DOMContentLoaded",main);else main();
})();