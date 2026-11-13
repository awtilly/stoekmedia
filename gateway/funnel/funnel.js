/* Gateway Security · customer funnel preview. Nothing here sends data anywhere: answers stay in this browser tab. */
(function(){
"use strict";
var SEG={
  office:{label:"Office and commercial",prop:"Office or commercial building",
    line:"If you manage a commercial building in St. Louis and you're still chasing your security company for reports, we want to walk your site with you and put the plan in writing.",
    head:"If you manage a commercial building in St. Louis, start here.",
    hook:"Still chasing your security company for reports?",g1:"Security for St. Louis Commercial Buildings",q:"commercial security guard company st louis",aud:"property and facility managers in St. Louis",sample:{sites:"2 buildings, lobby desk 7am to 7pm weekdays",pain:2}},
  retail:{label:"Retail and mixed-use",prop:"Retail or mixed-use property",
    line:"If you run a store or mixed-use property in St. Louis and you hear about call-offs after the shift starts, we want to walk your site with you and put the plan in writing.",
    head:"If you run a store or mixed-use property in St. Louis, start here.",
    hook:"Hearing about call-offs after the shift was supposed to start?",g1:"Security for St. Louis Retail Properties",q:"retail security guards st louis",aud:"store and operations managers in St. Louis",sample:{sites:"1 center, evenings and weekends",pain:1}},
  health:{label:"Healthcare",prop:"Medical facility",
    line:"If you manage a medical facility in St. Louis and you're tired of meeting a new officer every few weeks, we want to walk your site with you and put the plan in writing.",
    head:"If you manage a medical facility in St. Louis, start here.",
    hook:"Still meeting a new officer at your front desk every few weeks?",g1:"Security for St. Louis Medical Facilities",q:"medical facility security officers st louis",aud:"practice and facility managers in St. Louis",sample:{sites:"1 clinic, front desk 6am to 10pm",pain:0}}
};
var DEFAULT_HEAD="If you manage security for a St. Louis property, start here.";
var PAINS=[
 {opt:"A different officer every few weeks",short:"a different officer every few weeks",reply:"You said a different officer every few weeks. That usually means nobody at the post knows your building or your people. With us, you meet the officer for your front desk before they start."},
 {opt:"Call-offs you hear about late",short:"call-offs",reply:"You said call-offs. Your posts may be covered most nights, but you hear about the misses after the shift starts, which makes it hard to fix a gap before a tenant calls you. With us, a supervisor fills an open post."},
 {opt:"Reports you have to chase",short:"reports you have to chase",reply:"You said reports. If you have to ask for them, you find out what happened days late. With us, a report is in your inbox every morning."},
 {opt:"None, I'm comparing options",short:"comparing options",reply:"You said you're comparing options. The quickest way to compare is a walk of your site and a plan in writing, whoever you hire."},
 {opt:"No security company yet",short:"no security company yet",reply:"You said you don't have a security company yet. We'd start with a walk of your site and a plan in writing."}
];
var ASK=" Want 15 minutes to go over your site?";
var VIDEO=["I'm [first name], [title] at Gateway Security. St. Louis-built, family-run.","If you're responsible for security at a building, a store or a clinic in St. Louis, you probably already have a security company, and you're probably the one managing it.","Here's how it starts: a short call, then a walk of your site, an honest read on your setup, whoever you hire.","Then a proposal in person, and a written plan."];

var qs=new URLSearchParams(location.search);
function store(k,v){try{if(v===undefined)return JSON.parse(sessionStorage.getItem(k)||"null");sessionStorage.setItem(k,JSON.stringify(v))}catch(e){return null}}
var segKey=SEG[qs.get("s")]?qs.get("s"):((store("gw-seg"))||null);
if(SEG[qs.get("s")])store("gw-seg",qs.get("s"));
var ch=qs.get("c")||store("gw-ch")||"";if(qs.get("c"))store("gw-ch",qs.get("c"));
var $=function(id){return document.getElementById(id)};
function el(tag,attrs,kids){var e=document.createElement(tag);if(attrs)for(var k in attrs){if(k==="text")e.textContent=attrs[k];else if(k==="on")for(var ev in attrs.on)e.addEventListener(ev,attrs.on[ev]);else e.setAttribute(k,attrs[k]);}(kids||[]).forEach(function(c){if(c)e.appendChild(typeof c==="string"?document.createTextNode(c):c)});return e}
function sample(k){var s=SEG[k||"office"];return{name:"Dana",prop:s.prop,sites:s.sample.sites,pain:s.sample.pain,contract:"In about 4 months",email:"dana@sample-property.example",company:"Sample Property Group",phone:"314-555-0142",sample:true}}
function answers(){return store("gw-answers")||sample(segKey)}
function slots(){var out=[],d=new Date(),days=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],mon=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],times=["10:00 am","2:30 pm","9:00 am"],add=[1,1,2];for(var i=0;i<3;i++){var x=new Date(d.getTime());x.setDate(x.getDate()+add[i]);while(x.getDay()===0||x.getDay()===6)x.setDate(x.getDate()+1);out.push(days[x.getDay()]+", "+mon[x.getMonth()]+" "+x.getDate()+" at "+times[i])}return out}
var page=document.body.getAttribute("data-page");

/* ---------- hub: the ads ---------- */
if(page==="hub"){
  var cur=segKey||"office";
  var draw=function(){
    var tabs=$("tabs");tabs.textContent="";
    Object.keys(SEG).forEach(function(k){tabs.appendChild(el("button",{type:"button","class":"tab","aria-pressed":String(k===cur),text:SEG[k].label,on:{click:function(){cur=k;draw()}}}))});
    var s=SEG[cur],ads=$("ads");ads.textContent="";
    var href=function(c){return "start/?s="+cur+"&c="+c};
    var who=function(sub){return el("div",{"class":"who"},[el("div",{"class":"logo",text:"G"}),el("div",null,[el("strong",{text:"Gateway Security"}),el("small",{text:sub})])])};
    ads.appendChild(el("div",{"class":"adwrap fade"},[el("h2",{text:"Facebook and Instagram"}),el("a",{"class":"ad",href:href("meta")},[who("Sponsored"),el("div",{"class":"blackcard",text:s.line}),el("div",{"class":"bar"},[el("span",{text:"Gateway Security · St. Louis"}),el("span",{"class":"go",text:"Learn more"})])])]));
    ads.appendChild(el("div",{"class":"adwrap fade"},[el("h2",{text:"Google Search"}),el("a",{"class":"ad search",href:href("google")},[el("div",{"class":"query",text:s.q}),el("div",{"class":"sm",text:"Sponsored · Gateway Security"}),el("div",{"class":"t",text:s.g1+" | Get a Second Opinion"}),el("div",{"class":"d",text:s.hook+" We walk your site with you and put the plan in writing."})])]));
    ads.appendChild(el("div",{"class":"adwrap fade"},[el("h2",{text:"LinkedIn"}),el("a",{"class":"ad",href:href("linkedin")},[who("Promoted · shown to "+s.aud),el("div",{"class":"post",text:s.hook}),el("div",{"class":"blackcard",text:s.line}),el("div",{"class":"bar"},[el("span",{text:"Gateway Security · St. Louis"}),el("span",{"class":"go",text:"Learn more"})])])]));
  };
  draw();
}

/* ---------- landing page and form ---------- */
if(page==="start"){
  var s=SEG[segKey];
  $("headline").textContent=s?s.head:DEFAULT_HEAD;
  var cap=$("cap"),play=$("play"),vt;
  play.addEventListener("click",function(){var i=0;play.hidden=true;cap.textContent="“"+VIDEO[0]+"”";clearInterval(vt);vt=setInterval(function(){i++;if(i>=VIDEO.length){clearInterval(vt);cap.textContent="Video 1 runs about two and a half minutes.";play.hidden=false;return}cap.textContent="“"+VIDEO[i]+"”"},3400)});
  var a=store("gw-answers")||{};if(a.sample)a={};if(s&&!a.prop)a.prop=s.prop;
  var step=0;
  var PROPS=["Office or commercial building","Retail or mixed-use property","Medical facility","Something else"];
  var CONS=["In the next 3 months","In about 4 months","Later than that","No contract","Not sure"];
  function radios(name,legend,list,get,set){var fs=el("fieldset",null,[el("legend",{text:legend})]);list.forEach(function(o,n){var r=el("input",{type:"radio",name:name,id:name+n});r.checked=get()===(typeof o==="string"?o:n);r.addEventListener("change",function(){set(typeof o==="string"?o:n)});fs.appendChild(el("label",{"class":"opt","for":name+n},[r,typeof o==="string"?o:o.opt]))});return fs}
  function text(id,type,lab,key,ph,main){var i=el("input",{type:type,id:id,value:a[key]||"",placeholder:ph||"",autocomplete:"off"});i.addEventListener("input",function(){a[key]=i.value});return [el("label",{"for":id,"class":main?"main":"sm",text:lab}),i]}
  var Q=[
    function(){return{c:text("f-name","text","What's your first name?","name","",true),ok:function(){return (a.name||"").trim()}}},
    function(){return{c:[radios("prop",(a.name?a.name+", what":"What")+" kind of property?",PROPS,function(){return a.prop},function(v){a.prop=v})],note:s?"We filled this in from the ad you came from. Change it if it's wrong.":"",ok:function(){return a.prop}}},
    function(){return{c:text("f-sites","text","How many sites, and what hours need coverage?","sites","Rough is fine",true),ok:function(){return (a.sites||"").trim()}}},
    function(){return{c:[radios("pain","Which sounds most like your setup?",PAINS,function(){return a.pain},function(v){a.pain=v})],ok:function(){return a.pain!=null}}},
    function(){return{c:[radios("con","When does your current contract come up?",CONS,function(){return a.contract},function(v){a.contract=v})],ok:function(){return a.contract}}},
    function(){return{c:[el("div",{"class":"main",style:"font-family:var(--serif);font-weight:700;font-size:24px",text:"Where should we reach you?"})].concat(text("f-email","email","Email","email"),text("f-co","text","Company","company"),text("f-ph","tel","Phone","phone")),ok:function(){return (a.email||"").trim()&&(a.phone||"").trim()}}}
  ];
  function drawForm(){
    var box=$("form");box.textContent="";var cur=Q[step](),last=step===Q.length-1;
    var warn=el("p",{"class":"warn",role:"status"});
    var f=el("form",{"class":"card fade",novalidate:""},[el("div",{"class":"count",text:"Question "+(step+1)+" of "+Q.length}),el("div",{"class":"prog"},[el("i",{style:"width:"+Math.round((step+1)/Q.length*100)+"%"})]),el("div",{"class":"q"},cur.c),cur.note?el("p",{"class":"sm",text:cur.note}):null,warn,el("div",{"class":"row"},[el("button",{type:"button","class":"btn line",text:"Back",on:{click:function(){if(step>0){step--;drawForm()}else{box.textContent="";$("open").hidden=false}}}}),el("button",{type:"submit","class":"btn",text:last?"Send":"Next"})])]);
    f.addEventListener("submit",function(e){e.preventDefault();if(!cur.ok()){warn.textContent=last?"Add an email and a phone number so we can reach you.":"Answer this one to continue.";return}if(last){store("gw-answers",a);store("gw-booked",null);location.href="../thanks/"}else{step++;drawForm()}});
    box.appendChild(f);var first=f.querySelector("input");if(first&&first.type!=="radio")first.focus();f.scrollIntoView({block:"nearest"});
  }
  $("open").addEventListener("click",function(){clearInterval(vt);$("open").hidden=true;step=0;drawForm()});
}

/* ---------- thank-you and booking ---------- */
if(page==="thanks"){
  var t=answers(),p=PAINS[t.pain]||PAINS[3];
  $("hello").textContent="Thanks, "+t.name+". Expect a call within 5 minutes.";
  $("reply").textContent=p.reply+ASK;
  var drawSlots=function(){var b=store("gw-booked"),box=$("slots");box.textContent="";slots().forEach(function(x){box.appendChild(el("button",{type:"button","class":"slot","aria-pressed":String(b===x),text:x,on:{click:function(){store("gw-booked",x);drawSlots()}}}))});
    $("slotlabel").textContent=b?"You're booked: "+b:"Or pick a time that suits you:";
    $("booked").hidden=!b;if(b)$("booked").textContent="Booked. We've sent a confirmation with a short video on how we work.";};
  drawSlots();
  if(t.sample)$("samplenote").hidden=false;
}

/* ---------- every message the buyer gets ---------- */
if(page==="messages"){
  var m=answers(),mp=PAINS[m.pain]||PAINS[3],b=store("gw-booked")||slots()[0];
  var L=function(t){return el("span",{"class":"lnk",text:t})};
  var steps=[
   {when:"Under a minute after the form",kind:"Text",body:[mp.reply+ASK+" ",L("Pick a time")]},
   {when:"Same minute",kind:"Email",subj:"Your security setup, "+m.name,body:["Hi "+m.name+",\n\n"+mp.reply+"\n\nHere's a short video on how we work: ",L("Watch (2½ minutes)"),"\n\nIf it's easier than waiting for our call, ",L("pick a time here"),".\n\nGateway Security, St. Louis"]},
   {when:"Within 5 minutes · if they miss our call",kind:"Voicemail",body:["Hi "+m.name+", it's (salesperson) with Gateway Security here in St. Louis. You sent us "+m.sites+" and said "+mp.short+" sounded most like yours. That's what we'd look at first on a walk. I'll try you again this afternoon, or call me at this number."]},
   {when:"Right after the missed call",kind:"Text",body:["Sorry we missed you, "+m.name+". No need to call back. ",L("Pick a time"),", or reply here with what works."]},
   {when:"When they book",kind:"Text",body:["You're set for "+b+". Before we talk, here's how Gateway works, in two and a half minutes: ",L("Watch the video"),"\n\nReply with your site count and we'll come ready."]},
   {when:"The day before the call",kind:"Text",body:["Hi "+m.name+", a reminder that we're talking tomorrow: "+b+". If that no longer works, reply and we'll move it."]},
   {when:"If they haven't booked · next day",kind:"Text",body:["Hi "+m.name+", Gateway Security here. Still happy to look at "+mp.short+" with you. ",L("Pick a time"),", or reply with a day that works."]},
   {when:"If they still haven't booked · later that week",kind:"Email",subj:"Should we close this out?",body:["Hi "+m.name+",\n\nWe don't want to keep nudging if the timing is wrong. If "+(m.contract&&m.contract.indexOf("month")>-1?"your contract coming up "+m.contract.toLowerCase():"a later date")+" is the better time, reply with a month and we'll check in then.\n\nGateway Security, St. Louis"]},
   {when:"After the site walk · with the proposal invite",kind:"Text",body:["Thanks for walking the site with us, "+m.name+". Before we sit down with the proposal, this covers what's in it and the questions most people ask: ",L("Watch Video 2")]},
   {when:"A month after the start · before the 30-day review",kind:"Text",body:["You're about a month in with us, "+m.name+". Here's what we'll cover at the review, so it takes twenty minutes: ",L("Watch Video 3"),"\n\nReply with the one thing you'd most like changed."]}
  ];
  var th=$("thread");
  steps.forEach(function(x){var cls=x.kind==="Email"?"kind email":x.kind==="Voicemail"?"kind vm":"kind";var body=el("div",{"class":x.kind==="Email"?"mail":"bubble"},(x.subj?[el("b",{"class":"subj",text:x.subj})]:[]).concat(x.body));th.appendChild(el("div",{"class":"step"},[el("div",{"class":"when"},[el("span",{"class":cls,text:x.kind}),x.when]),body]))});
  $("who").textContent=m.sample?"Shown with sample answers. Fill in the form to see them with your own.":"Written from the answers "+m.name+" just gave.";
}
})();
