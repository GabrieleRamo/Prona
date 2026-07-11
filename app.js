/* Prona — real-estate portal for Albania. Korter-style UX, original implementation.
   Storage: localStorage (swap `Store` for a real API when hosting with a backend). */
"use strict";

/* ================= config ================= */
const CITIES = {
  tirana:  {name:"Tirana",   center:[19.8187,41.3245], zoom:14},
  durres:  {name:"Durrës",   center:[19.4510,41.3160], zoom:14},
  vlore:   {name:"Vlorë",    center:[19.4890,40.4600], zoom:14},
  shkoder: {name:"Shkodër",  center:[19.5150,42.0680], zoom:14},
  sarande: {name:"Sarandë",  center:[20.0100,39.8750], zoom:14.5},
  elbasan: {name:"Elbasan",  center:[20.0822,41.1125], zoom:14},
  fier:    {name:"Fier",     center:[19.5561,40.7239], zoom:14},
  korce:   {name:"Korçë",    center:[20.7808,40.6186], zoom:14},
  berat:   {name:"Berat",    center:[19.9520,40.7050], zoom:14},
  lezhe:   {name:"Lezhë",    center:[19.6431,41.7836], zoom:14},
  pogradec:{name:"Pogradec", center:[20.6525,40.9025], zoom:14},
  himare:  {name:"Himarë",   center:[19.7447,40.1017], zoom:14.5},
};
const COUNTRY_VIEW = {center:[19.9,41.05], zoom:6.6};
const DEALS  = {sale:"Në shitje", rent:"Qira afatgjatë", daily:"Qira ditore"};
const PTYPES = {apartment:"Apartament", house:"Shtëpi", commercial:"Njësi tregtare", plot:"Truall", parking:"Parkim"};
const FEATURES = ["Ballkon","Lozhë","Tarracë","Kuzhinë e hapur","Dupleks","Dritare panoramike","Dhomë veshjeje","Dy banjo","I mobiluar","Vend parkimi","Ashensor","Ndërtim i ri"];
const ACC_LABELS = {owner:"Pronar",agent:"Agjent",agency:"Agjenci"};
const TILE_OSM  = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_SAT  = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const NOMINATIM = "https://nominatim.openstreetmap.org";

const fmt  = n=>Math.round(n).toLocaleString("en-US");
const esc  = s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $    = (sel,root=document)=>root.querySelector(sel);
const $$   = (sel,root=document)=>[...root.querySelectorAll(sel)];

/* ================= storage layer ================= */
const MEM={}; let LS_OK=true;
try{ localStorage.setItem("__t","1"); localStorage.removeItem("__t"); }catch(e){ LS_OK=false; }
const Store = {
  read(key,fallback){
    try{ const raw=LS_OK?localStorage.getItem(key):MEM[key]; return JSON.parse(raw)??fallback; }
    catch(e){ return fallback; }
  },
  write(key,val){
    const raw=JSON.stringify(val);
    if(LS_OK){ try{localStorage.setItem(key,raw);}catch(e){MEM[key]=raw;LS_OK=false;} }
    else MEM[key]=raw;
  },
  users(){ return this.read("prona_users",[]); },
  saveUsers(u){ this.write("prona_users",u); },
  session(){ return this.read("prona_session",null); },
  setSession(s){ if(s)this.write("prona_session",s); else if(LS_OK)localStorage.removeItem("prona_session"); else delete MEM.prona_session; },
  userListings(){ return this.read("prona_listings",[]); },
  saveUserListings(l){ this.write("prona_listings",l); },
};
/* Remote API layer — used automatically when the site runs on its Node backend
   (server.js). Falls back to localStorage when hosted as static files only. */
const Remote={enabled:false,user:null,listings:[],payments:{provider:"demo"}};
async function apiCall(path,method="GET",body){
  const r=await fetch(path,{method,credentials:"same-origin",
    headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw Object.assign(new Error(j.error||"Kërkesa dështoi"),{needsVerify:!!j.needsVerify,needsPlan:!!j.needsPlan});
  return j;
}
async function initRemote(){
  try{
    const j=await apiCall("/api/state");
    Remote.enabled=true; Remote.user=j.user; Remote.listings=j.listings||[];
    Remote.payments=j.payments||{provider:"demo"};
  }catch(e){ Remote.enabled=false; }
}
async function hashPass(p){
  try{
    const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("prona:"+p));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
  }catch(e){ let h=0;for(const c of "prona:"+p)h=(h*31+c.charCodeAt(0))>>>0;return "x"+h; }
}
const currentUser=()=>{
  if(Remote.enabled) return Remote.user;
  const s=Store.session(); return s?Store.users().find(u=>u.email===s.email):null;
};
/* wallet helpers — server-side when the backend runs, browser-local otherwise */
const balanceOf=u=>Math.round(((u&&u.balance)||0)*100)/100;
const userIsAdmin=u=>!!u&&(Remote.enabled?!!u.isAdmin:(Store.users()[0]&&Store.users()[0].email===u.email));
function localCredit(email,amount,type,note){
  const users=Store.users(); const u=users.find(x=>x.email===email); if(!u)return null;
  u.balance=Math.round((((u.balance)||0)+amount)*100)/100;
  u.transactions=u.transactions||[];
  u.transactions.unshift({amount,type,note,at:Date.now(),balance:u.balance});
  u.transactions=u.transactions.slice(0,100);
  Store.saveUsers(users); return u;
}

/* ================= seed listings ================= */
function svgThumb(seed,sat){
  let s=(seed*2654435761)%2147483647||7; const rnd=()=>((s=s*48271%2147483647)/2147483647);
  let bars="",x=6; const n=5+Math.round(rnd()*3);
  for(let i=0;i<n&&x<212;i++){
    const w=18+rnd()*26,hh=22+rnd()*66,tone=["#dedad0","#d3cec1","#c8c2b2"][Math.floor(rnd()*3)];
    const main=i===Math.floor(n/2);
    bars+=`<rect x="${x}" y="${112-hh}" width="${w}" height="${hh}" rx="1.5" fill="${main?"#c62f2c":tone}"/>`;
    if(main)for(let wy=112-hh+6;wy<104;wy+=9)bars+=`<rect x="${x+4}" y="${wy}" width="${w-8}" height="3" fill="#fff" opacity=".35"/>`;
    x+=w+5;
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 118"><rect width="240" height="118" fill="${sat?"#e6e2d8":"#edeae3"}"/><rect y="100" width="240" height="18" fill="#e0dcd2"/>${bars}</svg>`;
  return "data:image/svg+xml,"+encodeURIComponent(svg);
}
function seedListings(){
  const mk=(i,city,dealType,propertyType,title,price,area,living,beds,rooms,floor,floors,dx,dy,feats,agent)=>({
    id:"seed-"+i, owner:null, seeded:true, status:"published",
    accountType:agent?"agent":"owner", dealType, propertyType,
    title, city, complex:"", street:"", houseNo:"",
    lng:CITIES[city].center[0]+dx, lat:CITIES[city].center[1]+dy,
    floor, floorsTotal:floors, bedrooms:beds, rooms,
    totalArea:area, livingArea:living, terraceArea:0,
    features:feats, promoBid:[2,9,13,20].includes(i)?(i%3)+1:0,
    description:"Banesë e ndritshme dhe funksionale në një nga lagjet më të mira të qytetit "+CITIES[city].name+". Pranë shkollave, kafeneve dhe transportit publik.",
    photos:[], youtube:"", price, currency:"EUR", noCommission:!agent,
    contactName:agent?"Arben Hoxha — City Estates":"Pronar privat", phone:"+355 69 000 00"+(i%10), whatsapp:i%2===0,
    createdAt:Date.now()-i*86400000,
  });
  return [
    mk(1,"tirana","sale","apartment","Apartament 2+1 në Rrugën e Kavajës",128000,78,52,2,3,5,9,.0028,.0053,["Ballkon","Ashensor"],false),
    mk(2,"tirana","sale","apartment","Apartament familjar 3+1 në Bllok",245000,124,86,3,4,7,11,-.0029,-.0049,["Dy banjo","Dritare panoramike","Ashensor"],true),
    mk(3,"tirana","sale","apartment","Garsoniere pranë liqenit të Parkut të Madh",64500,38,30,1,1,3,8,-.0081,-.0124,["Kuzhinë e hapur","I mobiluar"],false),
    mk(4,"tirana","rent","apartment","Apartament 1+1 i mobiluar, Pazari i Ri",550,55,40,1,2,4,6,.0075,.0023,["I mobiluar","Ballkon"],true),
    mk(5,"tirana","sale","house","Shtëpi me kopsht, Kodra e Diellit",310000,210,160,4,6,0,3,.0143,.0090,["Tarracë","Vend parkimi","Dy banjo"],true),
    mk(6,"tirana","rent","apartment","2+1 me tarracë, Komuna e Parisit",780,92,64,2,3,9,12,-.0152,-.0023,["Tarracë","Ashensor","I mobiluar"],false),
    mk(7,"tirana","sale","commercial","Njësi tregtare në rrugë, Don Bosko",96000,64,64,0,1,0,1,-.0110,.0075,[],true),
    mk(8,"tirana","daily","apartment","Garsoniere pranë Sheshit Skënderbej",42,36,28,1,1,6,10,.0018,.0032,["I mobiluar","Kuzhinë e hapur"],false),
    mk(9,"durres","sale","apartment","Apartament 2+1 buzë detit me ballkon",98000,85,58,2,3,8,14,.0040,-.0050,["Ballkon","Dritare panoramike"],true),
    mk(10,"durres","sale","apartment","1+1 pranë plazhit të Currilave",56000,52,38,1,2,3,7,-.0060,.0055,["Ballkon"],false),
    mk(11,"durres","rent","apartment","2+1 me qira afatgjatë, zona e portit",420,74,50,2,3,5,9,.0055,.0030,["I mobiluar"],false),
    mk(12,"durres","daily","apartment","Apartament plazhi, për 4 persona",55,60,45,2,2,2,6,-.0025,-.0018,["I mobiluar","Ballkon"],true),
    mk(13,"vlore","sale","apartment","2+1 në Lungomare, pamje nga deti",125000,88,60,2,3,6,12,-.0035,-.0080,["Dritare panoramike","Ballkon","Ashensor"],true),
    mk(14,"vlore","sale","apartment","3+1 sipër Kuzum Babait",139000,118,82,3,4,4,8,.0048,.0025,["Dy banjo","Tarracë"],false),
    mk(15,"vlore","daily","apartment","Garsoniere te Marina, për pushime",48,40,32,1,1,5,10,-.0052,.0060,["I mobiluar","Kuzhinë e hapur"],true),
    mk(16,"vlore","rent","house","Shtëpi e vogël me oborr, Plazhi i Vjetër",600,120,95,3,4,0,2,.0020,-.0045,["Tarracë","Vend parkimi"],false),
    mk(17,"shkoder","sale","apartment","2+1 pranë pedonales",52000,80,56,2,3,3,6,.0030,.0035,["Ballkon"],false),
    mk(18,"shkoder","sale","house","Shtëpi tradicionale guri për rikonstruksion",78000,180,140,4,5,0,2,-.0045,-.0028,[],false),
    mk(19,"shkoder","rent","apartment","1+1 te bulevardi Rozafa",280,58,42,1,2,2,5,.0012,-.0050,["I mobiluar"],true),
    mk(20,"sarande","sale","apartment","2+1 me pamje nga Joni",115000,76,55,2,3,7,9,.0035,.0022,["Dritare panoramike","Ballkon"],true),
    mk(21,"sarande","sale","plot","Truall ndërtimi mbi gji, 480 m²",86000,480,0,0,0,0,0,-.0048,-.0018,[],false),
    mk(22,"sarande","daily","apartment","Apartament në shëtitore, 50 m nga deti",65,64,48,2,2,3,7,.0010,-.0035,["I mobiluar","Ballkon"],true),
  ].map(l=>{
    if(!l.photos.length) l.photos=[svgThumb(parseInt(l.id.replace(/\D/g,""))||1)];
    l.bathrooms=l.features.includes("Dy banjo")?2:(l.propertyType==="plot"||l.propertyType==="parking"?0:1);
    return l;
  });
}
function allListings(){ return [...seedListings(),...(Remote.enabled?Remote.listings:Store.userListings())]; }
const getListing=id=>allListings().find(l=>l.id===id);

/* ================= tiles online? ================= */
let TILES_ONLINE=null;
function checkTiles(){
  return new Promise(res=>{
    if(TILES_ONLINE!==null) return res(TILES_ONLINE);
    const img=new Image(); let done=false;
    const finish=v=>{ if(!done){done=true;TILES_ONLINE=v;res(v);} };
    img.onload=()=>finish(true); img.onerror=()=>finish(false);
    setTimeout(()=>finish(false),3500);
    img.src="https://tile.openstreetmap.org/6/35/23.png?"+Date.now();
  });
}

/* ================= map factory ================= */
const gj=f=>({type:"FeatureCollection",features:f});
function buildStyle(online){
  const merged={buildings:[],roads:[],water:[],green:[]};
  for(const k in GEO.cities) for(const l in merged) merged[l].push(...GEO.cities[k][l].features);
  const sources={
    buildings:{type:"geojson",data:gj(merged.buildings)},
  };
  const layers=[];
  if(online){
    sources.osm={type:"raster",tiles:[TILE_OSM],tileSize:256,attribution:"© OpenStreetMap contributors"};
    sources.sat={type:"raster",tiles:[TILE_SAT],tileSize:256,attribution:"Imagery © Esri"};
    layers.push(
      // desaturated basemap for the calm, korter-like look
      {id:"base-streets",type:"raster",source:"osm",paint:{"raster-saturation":-0.85,"raster-contrast":-0.06,"raster-brightness-min":0.06}},
      {id:"base-sat",type:"raster",source:"sat",layout:{visibility:"none"}},
    );
  } else {
    sources.boundary={type:"geojson",data:GEO.country.boundary};
    sources.croads={type:"geojson",data:GEO.country.roads};
    sources.cwater={type:"geojson",data:GEO.country.water};
    sources.green={type:"geojson",data:gj(merged.green)};
    sources.water={type:"geojson",data:gj(merged.water)};
    sources.roads={type:"geojson",data:gj(merged.roads)};
    const soft={"line-cap":"round","line-join":"round"};
    layers.push(
      {id:"sea",type:"background",paint:{"background-color":"#e4ecf0"}},
      {id:"land",type:"fill",source:"boundary",paint:{"fill-color":"#f2f0eb"}},
      {id:"border",type:"line",source:"boundary",paint:{"line-color":"#c4bfb2","line-width":1,"line-dasharray":[3,2]}},
      {id:"cwater",type:"fill",source:"cwater",paint:{"fill-color":"#c3d9e4"}},
      {id:"croads-p",type:"line",source:"croads",layout:soft,filter:["==",["get","m"],0],maxzoom:13,paint:{"line-color":"#dfdacd","line-width":["interpolate",["linear"],["zoom"],6,.4,11,1.8]}},
      {id:"croads-m",type:"line",source:"croads",layout:soft,filter:["==",["get","m"],1],maxzoom:13,paint:{"line-color":"#eed9ab","line-width":["interpolate",["linear"],["zoom"],6,.9,11,2.6]}},
      {id:"green",type:"fill",source:"green",minzoom:11,paint:{"fill-color":"#d9e5cf","fill-opacity":.7}},
      {id:"water-line",type:"line",source:"water",layout:soft,minzoom:11,filter:["==",["get","a"],0],paint:{"line-color":"#c3d9e4","line-width":2.5}},
      {id:"water-fill",type:"fill",source:"water",minzoom:11,filter:["==",["get","a"],1],paint:{"fill-color":"#c3d9e4"}},
      {id:"roads-minor-case",type:"line",source:"roads",layout:soft,minzoom:13.5,filter:["==",["get","c"],3],paint:{"line-color":"#e2ddd2","line-gap-width":["interpolate",["linear"],["zoom"],14,1.4,16,4],"line-width":1}},
      {id:"roads-minor",type:"line",source:"roads",layout:soft,minzoom:12,filter:["==",["get","c"],3],paint:{"line-color":"#ffffff","line-width":["interpolate",["linear"],["zoom"],13,1,16,4]}},
      {id:"roads-mid-case",type:"line",source:"roads",layout:soft,minzoom:13,filter:["==",["get","c"],2],paint:{"line-color":"#ddd8cc","line-gap-width":["interpolate",["linear"],["zoom"],13,1.8,16,6],"line-width":1}},
      {id:"roads-mid",type:"line",source:"roads",layout:soft,minzoom:11,filter:["==",["get","c"],2],paint:{"line-color":"#ffffff","line-width":["interpolate",["linear"],["zoom"],13,1.6,16,6]}},
      {id:"roads-major-case",type:"line",source:"roads",layout:soft,minzoom:12.5,filter:["==",["get","c"],1],paint:{"line-color":"#e4cf9a","line-gap-width":["interpolate",["linear"],["zoom"],13,2.4,16,8],"line-width":1}},
      {id:"roads-major",type:"line",source:"roads",layout:soft,minzoom:11,filter:["==",["get","c"],1],paint:{"line-color":"#faeec7","line-width":["interpolate",["linear"],["zoom"],13,2.4,16,8]}},
      {id:"bld-2d",type:"fill",source:"buildings",minzoom:12.5,
        paint:{"fill-color":["interpolate",["linear"],["zoom"],13,"#eae6dd",16,"#e4e0d5"],"fill-outline-color":"#d3cec1","fill-opacity":["interpolate",["linear"],["zoom"],12.5,0,13.2,1]}},
    );
  }
  layers.push({id:"bld-3d",type:"fill-extrusion",source:"buildings",minzoom:12.5,layout:{visibility:"none"},
    paint:{"fill-extrusion-color":"#d8d3c7","fill-extrusion-height":["get","h"],"fill-extrusion-opacity":.92}});
  return {version:8,sources,layers};
}
/* real OSM house numbers (addr:housenumber), shown at high zoom like korter */
let ALL_NUMS=null;
function houseNums(){
  if(!ALL_NUMS){
    ALL_NUMS=[];
    for(const k in GEO.cities) if(GEO.cities[k].nums) ALL_NUMS.push(...GEO.cities[k].nums);
  }
  return ALL_NUMS;
}
function attachHouseNumbers(map){
  let pool=[];
  const update=()=>{
    pool.forEach(m=>m.remove()); pool=[];
    if(map.getZoom()<16.3) return;
    const b=map.getBounds(), w=b.getWest(), e=b.getEast(), s=b.getSouth(), n=b.getNorth();
    let shown=0;
    for(const [lng,lat,num] of houseNums()){
      if(lng<w||lng>e||lat<s||lat>n) continue;
      const el=document.createElement("span");
      el.className="hnum"; el.textContent=num;
      pool.push(new maplibregl.Marker({element:el,anchor:"center"}).setLngLat([lng,lat]).addTo(map));
      if(++shown>=280) break;
    }
  };
  map.on("moveend",update); map.on("zoomend",update);
}
function createMap(container,online,opts={}){
  const map=new maplibregl.Map({
    container, style:buildStyle(online),
    center:opts.center||COUNTRY_VIEW.center, zoom:opts.zoom??COUNTRY_VIEW.zoom,
    minZoom:5.5, maxZoom:19, attributionControl:false, antialias:true,
  });
  if(opts.nav!==false) map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),"bottom-right");
  attachHouseNumbers(map);
  map.setBasemap=mode=>{ // "streets" | "sat"
    if(!online) return;
    map.setLayoutProperty("base-streets","visibility",mode==="streets"?"visible":"none");
    map.setLayoutProperty("base-sat","visibility",mode==="sat"?"visible":"none");
  };
  map.set3d=on=>{
    map.setLayoutProperty("bld-3d","visibility",on?"visible":"none");
    if(!online) map.setLayoutProperty("bld-2d","visibility",on?"none":"visible");
    map.easeTo({pitch:on?58:0,bearing:on?-14:0,duration:800});
  };
  return map;
}
function basemapControls(map,online,wrap){
  const box=document.createElement("div"); box.className="map-controls";
  let html="";
  if(online) html+=`<div class="toggle" role="group" aria-label="Harta bazë"><button data-bm="streets" class="on" type="button">Harta</button><button data-bm="sat" type="button">Sateliti</button></div>`;
  html+=`<div class="toggle" role="group" aria-label="Mënyra e pamjes"><button data-d="2" class="on" type="button">2D</button><button data-d="3" type="button">3D</button></div>`;
  box.innerHTML=html; wrap.appendChild(box);
  $$("[data-bm]",box).forEach(b=>b.addEventListener("click",()=>{
    $$("[data-bm]",box).forEach(x=>x.classList.toggle("on",x===b)); map.setBasemap(b.dataset.bm);
  }));
  $$("[data-d]",box).forEach(b=>b.addEventListener("click",()=>{
    $$("[data-d]",box).forEach(x=>x.classList.toggle("on",x===b)); map.set3d(b.dataset.d==="3");
  }));
  if(!online){
    const n=document.createElement("div"); n.className="offline-note";
    n.textContent="Pamje offline: harta e plotë e rrugëve dhe sateliti për gjithë Shqipërinë ngarkohen kur faqja hostohet. Po shfaqen të dhënat OSM të integruara (5 qendra qytetesh).";
    wrap.appendChild(n);
  }
  const a=document.createElement("div"); a.className="attr";
  a.textContent="© OpenStreetMap contributors"+(online?" · Imagery © Esri":"")+" · MapLibre GL";
  wrap.appendChild(a);
}

/* ================= geocoding ================= */
async function geocode(q){
  try{
    const r=await fetch(`${NOMINATIM}/search?format=json&countrycodes=al&limit=6&q=${encodeURIComponent(q)}`,{headers:{"Accept-Language":"en"}});
    if(!r.ok) throw 0;
    return (await r.json()).map(x=>({label:x.display_name,lng:+x.lon,lat:+x.lat}));
  }catch(e){
    const ql=q.toLowerCase();
    return Object.values(CITIES).filter(c=>c.name.toLowerCase().includes(ql))
      .map(c=>({label:c.name+", Albania",lng:c.center[0],lat:c.center[1]}));
  }
}
async function reverseGeocode(lng,lat){
  try{
    const r=await fetch(`${NOMINATIM}/reverse?format=json&lon=${lng}&lat=${lat}&zoom=18`,{headers:{"Accept-Language":"en"}});
    if(!r.ok) throw 0;
    const j=await r.json(); const a=j.address||{};
    return {street:a.road||"", houseNo:a.house_number||"", label:j.display_name||""};
  }catch(e){ return null; }
}

/* ================= subscription plans & lead tracking ================= */
const PLANS={
  free:{name:"Falas",listings:15,photos:15,price:0,perks:["15 prona aktive","15 foto për pronë","Verified Badge","Publikim në hartë","Kontakt direkt me blerësit"]},
  pro:{name:"Pro",listings:40,photos:30,price:1400,perks:["40 prona aktive","30 foto për pronë","Pro Badge","Statistika të detajuara","Prioritet në mbështetje"]},
  premium:{name:"Premium",listings:"∞",photos:Infinity,price:3900,perks:["Prona pa limit","Statistika të detajuara","Premium Badge","Dukshmëri e zgjeruar e agjencisë"]},
};
function planOf(u){
  if(!u)return "free";
  if(Remote.enabled)return u.plan||"free";
  return (u.plan&&(!u.planExpiresAt||u.planExpiresAt>Date.now()))?u.plan:"free";
}
function track(id,type){
  try{
    if(Remote.enabled){ apiCall("/api/track","POST",{id,type}).catch(()=>{}); return; }
    const listings=Store.userListings(); const l=listings.find(x=>x.id===id);
    if(!l)return;
    const k={view:"v",phone:"p",whatsapp:"w"}[type]; if(!k)return;
    l.stats=l.stats||{v:0,p:0,w:0}; l.stats[k]++;
    const day=new Date().toISOString().slice(0,10);
    l.statsDaily=l.statsDaily||{}; l.statsDaily[day]=l.statsDaily[day]||{v:0,p:0,w:0}; l.statsDaily[day][k]++;
    Store.saveUserListings(listings);
  }catch(e){}
}

/* ================= favorites & saved searches ================= */
function mutateLocalUser(fn){
  const users=Store.users(); const s=Store.session();
  const u=s&&users.find(x=>x.email===s.email); if(!u)return null;
  fn(u); Store.saveUsers(users); return u;
}
const getFavs=()=>{const u=currentUser();return (u&&u.favorites)||[];};
async function toggleFav(id){
  const u=currentUser();
  if(!u){authModal("login");return null;}
  if(Remote.enabled){
    const j=await apiCall("/api/favorites/toggle","POST",{id});
    Remote.user={...Remote.user,favorites:j.favorites}; return j.favorites;
  }
  const nu=mutateLocalUser(x=>{
    x.favorites=x.favorites||[];
    const i=x.favorites.indexOf(id);
    i>=0?x.favorites.splice(i,1):x.favorites.push(id);
  });
  return nu?nu.favorites:[];
}
const getSearches=()=>{const u=currentUser();return (u&&u.savedSearches)||[];};
async function addSearch(name,params){
  if(Remote.enabled){
    const j=await apiCall("/api/searches","POST",{name,params});
    Remote.user={...Remote.user,savedSearches:j.savedSearches};
  } else mutateLocalUser(u=>{
    u.savedSearches=u.savedSearches||[];
    u.savedSearches.push({id:"s-"+Date.now(),name,params,createdAt:Date.now(),lastSeenAt:Date.now()});
  });
}
async function removeSearch(id){
  if(Remote.enabled){
    const j=await apiCall("/api/searches/"+id,"DELETE");
    Remote.user={...Remote.user,savedSearches:j.savedSearches};
  } else mutateLocalUser(u=>{u.savedSearches=(u.savedSearches||[]).filter(s=>s.id!==id);});
}
async function markSearchSeen(id){
  if(Remote.enabled){
    const j=await apiCall("/api/searches/"+id,"PUT",{});
    Remote.user={...Remote.user,savedSearches:j.savedSearches};
  } else mutateLocalUser(u=>{const s=(u.savedSearches||[]).find(x=>x.id===id);if(s)s.lastSeenAt=Date.now();});
}
function searchMatches(params,l){
  return l.status==="published"
    &&(!params.deal||l.dealType===params.deal)
    &&(!params.city||l.city===params.city)
    &&(!params.ptype||l.propertyType===params.ptype)
    &&(!params.beds||l.bedrooms>=params.beds)
    &&(!params.baths||(l.bathrooms||0)>=params.baths)
    &&(!params.priceMin||l.price>=params.priceMin)
    &&(!params.priceMax||l.price<=params.priceMax)
    &&(!params.areaMin||l.totalArea>=params.areaMin)
    &&(!params.areaMax||l.totalArea<=params.areaMax)
    &&(!params.q||params.q.toLowerCase().split(/\s+/).every(w=>(l.title+" "+l.street+" "+l.description).toLowerCase().includes(w)));
}
const searchNewCount=s=>allListings().filter(l=>!l.seeded&&l.createdAt>s.lastSeenAt&&searchMatches(s.params,l)).length;
const totalNewMatches=()=>getSearches().reduce((n,s)=>n+searchNewCount(s),0);

/* ================= language (SQ default, EN overlay) ================= */
let LANG=Store.read("prona_lang","sq");
const I18N={
"Blej":"Buy","Qira":"Rent","Ditore":"Daily","Rreth Nesh":"About Us","Na Kontaktoni":"Contact Us",
"+ Shto pronë":"+ Add property","Hyr":"Log in","Dil":"Log out","Admin":"Admin",
"Në shitje":"For sale","Qira afatgjatë":"Long-term rent","Qira ditore":"Daily rent",
"Të gjitha llojet e pronave":"All property types","Gjithë Shqipëria":"All Albania",
"Kërkim i avancuar":"Advanced search","Dhoma gjumi":"Bedrooms","Banjo":"Bathrooms",
"Të gjitha":"Any","Çmimi min (€)":"Min price (€)","Çmimi max (€)":"Max price (€)",
"Sipërfaqja min (m²)":"Min area (m²)","Sipërfaqja max (m²)":"Max area (m²)","Kati min":"Min floor",
"Renditja":"Sort","Më të rejat":"Newest first","Çmimi ↑":"Price ↑","Çmimi ↓":"Price ↓","Sipërfaqja ↓":"Area ↓","€/m² ↑":"€/m² ↑",
"🔔 Ruaj kërkimin":"🔔 Save search","Pastro filtrat":"Clear filters",
"Ballkon":"Balcony","Ashensor":"Elevator","I mobiluar":"Furnished","Vend parkimi":"Parking space","Tarracë":"Terrace","Ndërtim i ri":"New construction","Pa komision":"No commission",
"Harta":"Map","Sateliti":"Satellite","Lista":"List","← Gjithë Shqipëria":"← All Albania",
"Rreth pronës":"About this property","Vendndodhja":"Location","Kontakti":"Contact",
"Shfaq telefonin":"Show phone","Ndaje në WhatsApp":"Share on WhatsApp","♡ Ruaj":"♡ Save","♥ E ruajtur":"♥ Saved",
"Prona të ngjashme":"Similar properties","Marrëveshja":"Deal","Lloji":"Type","Kati":"Floor","Dhoma":"Rooms",
"Sipërfaqja totale":"Total area","Sipërfaqja e banimit":"Living area","Tarraca":"Terrace","Sipërfaqja":"Area",
"Shiko detajet →":"View details →","E promovuar":"Promoted","Shpallja juaj":"Your listing",
"Po publikoni si":"You are listing as","Pronar":"Owner","Agjent":"Agent","Agjenci":"Agency",
"Lloji i marrëveshjes":"Deal type","Lloji i pronës":"Property type","Apartament":"Apartment","Shtëpi":"House","Njësi tregtare":"Commercial","Truall":"Plot of land","Parkim":"Parking",
"Adresa":"Address","Qyteti":"City","Rruga":"Street","Numri i shtëpisë":"House number","Kërko adresën":"Search address",
"Shto pronën tuaj":"Add your property","Ndrysho shpalljen":"Edit listing",
"Foto dhe video":"Photos & video","Çmimi dhe kushtet":"Price & terms","Kontaktet":"Contacts","Promovimi":"Promotion",
"Çmimi":"Price","Monedha":"Currency","Emri i kontaktit":"Contact name","Telefoni":"Phone",
"Publiko shpalljen":"Publish listing","Publiko dhe promovo":"Publish and promote","Ruaj si draft":"Save as draft","Pastro formularin":"Clear form","Ruaj ndryshimet":"Save changes",
"Çmimi ditor i promovimit":"Daily promotion price","Pozicioni në kategori":"Position in category",
"Bilanci":"Balance","Bilanci aktual":"Current balance","Rimbush":"Top up","Historiku":"History",
"Ende pa transaksione.":"No transactions yet.","Paguaj me kriptomonedhë":"Pay with cryptocurrency","Shto fonde (pagesë demo)":"Add funds (demo payment)",
"Pronat e mia":"My properties","Të preferuarat":"Favorites","Kërkimet e ruajtura":"Saved searches",
"Ndrysho":"Edit","Fshi":"Delete","Shiko":"View","Publiko":"Publish","Hap":"Open",
"Paneli i administratorit":"Admin panel","Përdorues":"Users","Shpallje":"Listings","Të publikuara":"Published","Të promovuara":"Promoted","Të ardhura nga promovimi":"Promotion revenue",
"Shpalljet e përdoruesve":"User listings","Përdoruesit":"Users","Pezullo":"Suspend","Aktivizo":"Activate",
"Qytetet":"Cities","Shpalljet":"Listings","Informacion":"Information","Shto pronë":"Add property",
"Bilanci & promovimi":"Balance & promotion","Kushtet e përdorimit":"Terms of use","Politika e privatësisë":"Privacy policy",
"Emri i plotë":"Full name","Fjalëkalimi":"Password","Lloji i llogarisë":"Account type","Regjistrohu":"Sign up",
"Krijo llogari":"Create an account","Keni harruar fjalëkalimin?":"Forgot your password?",
"Verifikoni email-in":"Verify your email","Kodi i verifikimit":"Verification code","Verifiko":"Verify","Ridërgo kodin":"Resend code",
"Rivendos fjalëkalimin":"Reset password","Dërgo kodin":"Send code","Fjalëkalimi i ri":"New password","Kodi":"Code",
"Dërgo mesazhin":"Send message","Mesazhi":"Message","Emri juaj":"Your name",
"Veçoritë e planimetrisë":"Layout features","Përshkrimi":"Description","Kompleks banimi":"Residential complex",
"Kate në ndërtesë":"Floors in building","Sipërfaqja totale, m²":"Total area, m²","Sipërfaqja e banimit, m²":"Living area, m²","Sipërfaqja e tarracës, m²":"Terrace area, m²",
"Lidhje YouTube":"YouTube link","Ky numër është në WhatsApp":"This number is on WhatsApp",
};
function translateDOM(root){
  if(LANG!=="en"||!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let n;
  while((n=walker.nextNode())){
    const t=n.nodeValue.trim();
    if(t&&I18N[t]) n.nodeValue=n.nodeValue.replace(t,I18N[t]);
  }
  if(root.querySelectorAll) root.querySelectorAll("input[placeholder],textarea[placeholder]").forEach(i=>{
    const p=i.getAttribute("placeholder"); if(I18N[p])i.setAttribute("placeholder",I18N[p]);
  });
}
new MutationObserver(muts=>{
  if(LANG!=="en")return;
  muts.forEach(m=>m.addedNodes.forEach(node=>{
    if(node.nodeType===1)translateDOM(node);
    else if(node.nodeType===3){const t=node.nodeValue.trim();if(t&&I18N[t])node.nodeValue=node.nodeValue.replace(t,I18N[t]);}
  }));
}).observe(document.documentElement,{childList:true,subtree:true});

/* ================= theme ================= */
function applyTheme(t){ document.documentElement.dataset.theme=t; }
function initTheme(){
  const saved=Store.read("prona_theme",null);
  applyTheme(saved||(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"));
}
function toggleTheme(){
  const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
  applyTheme(next); Store.write("prona_theme",next); renderHeader();
}
initTheme();

/* ================= footer ================= */
function footerHTML(){
  return `<footer class="site-footer">
    <div class="foot-grid">
      <div class="foot-brand">
        <span class="logo foot-logo"><svg class="mark" viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" rx="22" fill="var(--accent)"/><path d="M26 52 L48 30 L70 52" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48" cy="62" r="8" fill="#fff"/></svg><b>prona</b></span>
        <div class="foot-social">
          <a href="https://www.instagram.com/prona.albania/" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg></a>
          <a href="https://www.linkedin.com/company/prona-al/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="7.5" y1="10" x2="7.5" y2="17"/><circle cx="7.5" cy="6.7" r="0.9" fill="currentColor" stroke="none"/><path d="M11.5 17v-4.2c0-1.6 1-2.6 2.3-2.6s2.2 1 2.2 2.6V17"/></svg></a>
          <a href="#" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M14 8.5h-1.5c-.8 0-1.5.7-1.5 1.5v2h3l-.4 3h-2.6v6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
        </div>
      </div>
      <div class="foot-col"><b>Qytetet</b>
        ${["tirana","durres","vlore","shkoder","sarande"].map(k=>`<button type="button" data-foot-city="${k}">Prona në ${CITIES[k].name}</button>`).join("")}
      </div>
      <div class="foot-col"><b>Shpalljet</b>
        <button type="button" data-foot-deal="sale">Në shitje</button>
        <button type="button" data-foot-deal="rent">Qira afatgjatë</button>
        <button type="button" data-foot-deal="daily">Qira ditore</button>
        <button type="button" data-foot-go="#/add">Shto pronë</button>
      </div>
      <div class="foot-col"><b>Informacion</b>
        <button type="button" data-foot-go="#/about">Rreth Nesh</button>
        <button type="button" data-foot-go="#/contact">Na Kontaktoni</button>
        <button type="button" data-foot-go="#/plans">Planet për agjenci</button>
        <button type="button" data-foot-go="#/balance">Bilanci & promovimi</button>
        <button type="button" data-foot-go="#/terms">Kushtet e përdorimit</button>
        <button type="button" data-foot-go="#/privacy">Politika e privatësisë</button>
      </div>
    </div>
    <div class="foot-bottom">
      <span>© 2026 Prona · Të gjitha të drejtat e rezervuara</span>
      <span>Të dhënat e hartës © OpenStreetMap contributors</span>
      <span>Imazhet satelitore © Esri</span>
    </div>
  </footer>`;
}
function attachFooter(container){
  if(!container) return;
  container.insertAdjacentHTML("beforeend",footerHTML());
  $$("[data-foot-city]",container).forEach(b=>b.addEventListener("click",()=>{
    ROUTE_DEAL="sale"; location.hash="#/"; render();
    setTimeout(()=>{const s=$("#citySel"); if(s){s.value=b.dataset.footCity; s.dispatchEvent(new Event("change"));}},60);
  }));
  $$("[data-foot-deal]",container).forEach(b=>b.addEventListener("click",()=>{
    ROUTE_DEAL=b.dataset.footDeal; location.hash="#/"; render();
  }));
  $$("[data-foot-go]",container).forEach(b=>b.addEventListener("click",()=>location.hash=b.dataset.footGo));
}

/* ================= header / shell ================= */
let ROUTE_DEAL="sale";
function renderHeader(){
  const u=currentUser();
  $("#header").innerHTML=`
    <button class="logo" data-go="#/"><svg class="mark" viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" rx="22" fill="var(--accent)"/><path d="M26 52 L48 30 L70 52" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48" cy="62" r="8" fill="#fff"/></svg><b>prona</b><span>prona të paluajtshme · Shqipëri</span></button>
    <nav class="hnav" aria-label="Kryesore">
      <button data-deal="sale">Blej</button>
      <button data-deal="rent">Qira</button>
      <button data-deal="daily">Ditore</button>
      <button data-page="#/about" ${location.hash.startsWith("#/about")?'class="current"':""}>Rreth Nesh</button>
      <button data-page="#/contact" ${location.hash.startsWith("#/contact")?'class="current"':""}>Na Kontaktoni</button>
    </nav>
    <div class="header-right">
      <button class="lang" id="langBtn" type="button" title="${LANG==="sq"?"Switch to English":"Kalo në shqip"}">${LANG==="sq"?"EN":"SQ"}</button>
      <button class="theme-btn" id="themeBtn" type="button" title="${document.documentElement.dataset.theme==="dark"?"Modaliteti i çelët":"Modaliteti i errët"}" aria-label="Ndrysho temën">${document.documentElement.dataset.theme==="dark"?"☀️":"🌙"}</button>
      <button class="btn primary" data-go="#/add">+ Shto pronë</button>
      ${u?`<button class="icon-btn" data-go="#/favorites" title="Të preferuarat" aria-label="Të preferuarat">♥${getFavs().length?`<span class="icon-count">${getFavs().length}</span>`:""}</button>
           <button class="icon-btn" data-go="#/searches" title="Kërkimet e ruajtura" aria-label="Kërkimet e ruajtura">🔔${totalNewMatches()?`<span class="icon-count new">${totalNewMatches()}</span>`:""}</button>
           ${userIsAdmin(u)?`<button class="btn" data-go="#/admin">Admin</button>`:""}
           <button class="btn balance-chip" data-go="#/balance" title="Bilanci dhe rimbushja">€${balanceOf(u).toFixed(2)}</button>
           <button class="user-chip" data-go="#/my"><span class="avatar">${esc(u.name[0].toUpperCase())}</span>${esc(u.name.split(" ")[0])}</button>
           <button class="btn ghost" id="logoutBtn">Dil</button>`
         :`<button class="btn" id="loginBtn">Hyr</button>`}
    </div>`;
  $$("#header [data-go]").forEach(b=>b.addEventListener("click",()=>location.hash=b.dataset.go));
  $$("#header [data-deal]").forEach(b=>{
    b.classList.toggle("current",location.hash.length<4&&b.dataset.deal===ROUTE_DEAL);
    b.addEventListener("click",()=>{ROUTE_DEAL=b.dataset.deal;location.hash="#/";render();});
  });
  $$("#header [data-page]").forEach(b=>b.addEventListener("click",()=>location.hash=b.dataset.page));
  const lg=$("#langBtn"); if(lg)lg.addEventListener("click",()=>{LANG=LANG==="sq"?"en":"sq";Store.write("prona_lang",LANG);render();});
  const tb=$("#themeBtn"); if(tb) tb.addEventListener("click",toggleTheme);
  const lb=$("#loginBtn"); if(lb) lb.addEventListener("click",()=>authModal("login"));
  const lo=$("#logoutBtn"); if(lo) lo.addEventListener("click",async()=>{
    if(Remote.enabled){try{await apiCall("/api/logout","POST",{});}catch(e){} Remote.user=null; Remote.listings=Remote.listings.filter(l=>l.status==="published");}
    else Store.setSession(null);
    toast("Dolët nga llogaria");renderHeader();render();
  });
}
function toast(msg){
  $$(".toast").forEach(t=>t.remove());
  const t=document.createElement("div"); t.className="toast"; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),2600);
}

/* ================= auth modal ================= */
function authModal(mode){
  const root=$("#modal-root");
  const isLogin=mode==="login";
  root.innerHTML=`<div class="modal-back"><div class="modal modal-wrap">
    <button class="close-x" aria-label="Close">×</button>
    <h2>${isLogin?"Hyr":"Krijo llogari"}</h2>
    <p class="lede">${isLogin?"Mirë se u ktheve — hyni për të menaxhuar shpalljet tuaja.":"Pronarët, agjentët dhe agjencitë mund të publikojnë prona në Prona."}</p>
    <form id="authForm">
      ${isLogin?"":`<div class="frow"><label for="a-name">Emri i plotë</label><input id="a-name" type="text" required autocomplete="name"></div>
      <div class="frow"><label>Lloji i llogarisë</label><div class="choice-row" id="a-type">
        <button type="button" class="choice on" data-v="owner">Pronar</button>
        <button type="button" class="choice" data-v="agent">Agjent</button>
        <button type="button" class="choice" data-v="agency">Agjenci</button></div></div>`}
      <div class="frow"><label for="a-email">Email</label><input id="a-email" type="email" required autocomplete="email"></div>
      <div class="frow"><label for="a-pass">Fjalëkalimi</label><input id="a-pass" type="password" required minlength="6" autocomplete="${isLogin?"current-password":"new-password"}"><span class="err" id="a-err"></span></div>
      <button class="btn primary" style="width:100%;justify-content:center" type="submit">${isLogin?"Hyr":"Regjistrohu"}</button>
    </form>
    <p class="switch-auth">${isLogin?`Nuk keni llogari? <button type="button" id="swapAuth">Regjistrohu</button><br><button type="button" id="forgotPw" style="margin-top:6px">Keni harruar fjalëkalimin?</button>`:`Keni llogari? <button type="button" id="swapAuth">Hyr</button>`}</p>
  </div></div>`;
  const close=()=>root.innerHTML="";
  $(".close-x",root).addEventListener("click",close);
  $(".modal-back",root).addEventListener("click",e=>{if(e.target.classList.contains("modal-back"))close();});
  $("#swapAuth",root).addEventListener("click",()=>authModal(isLogin?"register":"login"));
  const fp=$("#forgotPw",root); if(fp)fp.addEventListener("click",()=>{ if(Remote.enabled)resetModal(); else toast("Rivendosja e fjalëkalimit punon kur faqja hostohet me serverin e saj"); });
  let accType="owner";
  const tp=$("#a-type",root);
  if(tp)$$(".choice",tp).forEach(c=>c.addEventListener("click",()=>{$$(".choice",tp).forEach(x=>x.classList.remove("on"));c.classList.add("on");accType=c.dataset.v;}));
  $("#authForm",root).addEventListener("submit",async e=>{
    e.preventDefault();
    const email=$("#a-email",root).value.trim().toLowerCase();
    const rawPass=$("#a-pass",root).value;
    const errEl=$("#a-err",root); errEl.parentElement.classList.remove("invalid");
    if(Remote.enabled){
      try{
        const payload=isLogin?{email,password:rawPass}
          :{email,password:rawPass,name:$("#a-name",root).value.trim(),type:accType};
        const j=await apiCall(isLogin?"/api/login":"/api/register","POST",payload);
        Remote.user=j.user;
        const st=await apiCall("/api/state"); Remote.listings=st.listings||[];
        close(); toast(isLogin?"Mirë se u ktheve, "+j.user.name.split(" ")[0]:"Llogaria u krijua"); renderHeader(); render();
        if(!isLogin&&!j.user.verified) verifyModal(j.devCode);
      }catch(err){ errEl.textContent=err.message; errEl.parentElement.classList.add("invalid"); }
      return;
    }
    const pass=await hashPass(rawPass);
    const users=Store.users();
    if(isLogin){
      const u=users.find(x=>x.email===email&&x.pass===pass);
      if(!u){errEl.textContent="Email ose fjalëkalim i gabuar.";errEl.parentElement.classList.add("invalid");return;}
      Store.setSession({email}); close(); toast("Mirë se u ktheve, "+u.name.split(" ")[0]); renderHeader(); render();
    } else {
      if(users.some(x=>x.email===email)){errEl.textContent="Ky email është i regjistruar — provoni të hyni.";errEl.parentElement.classList.add("invalid");return;}
      const name=$("#a-name",root).value.trim()||"User";
      users.push({name,email,pass,type:accType,createdAt:Date.now()});
      Store.saveUsers(users); Store.setSession({email});
      close(); toast("Llogaria u krijua"); renderHeader(); render();
    }
  });
}

/* ================= verify & reset modals ================= */
function verifyModal(devCode){
  const root=$("#modal-root");
  root.innerHTML=`<div class="modal-back"><div class="modal modal-wrap">
    <button class="close-x" aria-label="Mbyll">×</button>
    <h2>Verifikoni email-in</h2>
    <p class="lede">${devCode?`Modalitet demo (pa shërbim email-i): kodi juaj është <b style="font-size:16px">${esc(devCode)}</b>`:"Ju dërguam një kod 6-shifror në email. Shkruajeni më poshtë."}</p>
    <form id="vForm">
      <div class="frow"><label for="v-code">Kodi i verifikimit</label><input id="v-code" type="text" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"><span class="err" id="v-err"></span></div>
      <button class="btn primary" style="width:100%;justify-content:center" type="submit">Verifiko</button>
    </form>
    <p class="switch-auth"><button type="button" id="vResend">Ridërgo kodin</button></p>
  </div></div>`;
  const close=()=>root.innerHTML="";
  $(".close-x",root).addEventListener("click",close);
  $("#vResend",root).addEventListener("click",async()=>{
    try{const j=await apiCall("/api/verify","POST",{resend:true});
      if(j.devCode)$(".lede",root).innerHTML=`Modalitet demo: kodi juaj është <b style="font-size:16px">${esc(j.devCode)}</b>`;
      else toast("Kodi u ridërgua në email");
    }catch(err){toast(err.message);}
  });
  $("#vForm",root).addEventListener("submit",async e=>{
    e.preventDefault();
    const errEl=$("#v-err",root); errEl.parentElement.classList.remove("invalid");
    try{
      const j=await apiCall("/api/verify","POST",{code:$("#v-code",root).value.trim()});
      Remote.user=j.user; close(); toast("Email-i u verifikua"); renderHeader();
    }catch(err){errEl.textContent=err.message;errEl.parentElement.classList.add("invalid");}
  });
}
function resetModal(){
  const root=$("#modal-root");
  root.innerHTML=`<div class="modal-back"><div class="modal modal-wrap">
    <button class="close-x" aria-label="Mbyll">×</button>
    <h2>Rivendos fjalëkalimin</h2>
    <p class="lede" id="r-lede">Shkruani email-in tuaj — ju dërgojmë një kod rivendosjeje.</p>
    <form id="rForm">
      <div class="frow"><label for="r-email">Email</label><input id="r-email" type="email" required></div>
      <div class="frow" id="r-step2" style="display:none"><label for="r-code">Kodi</label><input id="r-code" type="text" maxlength="6">
        <label for="r-pass" style="margin-top:8px">Fjalëkalimi i ri</label><input id="r-pass" type="password" minlength="6"><span class="err" id="r-err"></span></div>
      <button class="btn primary" style="width:100%;justify-content:center" type="submit" id="r-submit">Dërgo kodin</button>
    </form>
  </div></div>`;
  const close=()=>root.innerHTML="";
  $(".close-x",root).addEventListener("click",close);
  let step=1;
  $("#rForm",root).addEventListener("submit",async e=>{
    e.preventDefault();
    const email=$("#r-email",root).value.trim();
    const errEl=$("#r-err",root); if(errEl)errEl.parentElement.classList.remove("invalid");
    try{
      if(step===1){
        const j=await apiCall("/api/reset/request","POST",{email});
        step=2; $("#r-step2",root).style.display=""; $("#r-submit",root).textContent="Rivendos fjalëkalimin";
        $("#r-lede",root).innerHTML=j.devCode?`Modalitet demo: kodi juaj është <b style="font-size:16px">${esc(j.devCode)}</b>`:"Kontrolloni email-in për kodin, pastaj vendosni fjalëkalimin e ri.";
      } else {
        await apiCall("/api/reset/confirm","POST",{email,code:$("#r-code",root).value.trim(),password:$("#r-pass",root).value});
        close(); toast("Fjalëkalimi u ndryshua — hyni me të riun"); authModal("login");
      }
    }catch(err){ if(errEl){errEl.textContent=err.message;errEl.parentElement.classList.add("invalid");} else toast(err.message); }
  });
}

/* ================= views ================= */
let activeMap=null;
function destroyMap(){ if(activeMap){try{activeMap.remove();}catch(e){}activeMap=null;} }

/* ---------- listing view ---------- */
async function viewListing(){
  const online=await checkTiles();
  const v=$("#view");
  v.innerHTML=`
    <div class="filters">
      <div class="seg" id="dealSeg" role="group" aria-label="Lloji i marrëveshjes">
        ${Object.entries(DEALS).map(([k,l])=>`<button data-v="${k}" ${k===ROUTE_DEAL?'class="on"':""} type="button">${k==="sale"?"Blej":k==="rent"?"Qira":"Ditore"}</button>`).join("")}
      </div>
      <div class="search-box"><input id="qInput" type="search" placeholder="Kërko: lagje, rrugë, kompleks…" aria-label="Kërko prona"></div>
      <select class="sel" id="typeSel"><option value="">Të gjitha llojet e pronave</option>${Object.entries(PTYPES).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select>
      <select class="sel" id="citySel"><option value="">Gjithë Shqipëria</option>${Object.entries(CITIES).map(([k,c])=>`<option value="${k}">${c.name}</option>`).join("")}</select>
      <button class="btn adv-btn" id="advBtn" type="button">Kërkim i avancuar <span class="adv-badge" id="advBadge" hidden></span></button>
      <span class="count" id="countNote"></span>
    </div>
    <div class="adv-panel" id="advPanel" hidden>
      <div class="adv-grid">
        <div class="frow"><label for="bedsSel">Dhoma gjumi</label>
          <select class="sel" id="bedsSel"><option value="0">Të gjitha</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option></select></div>
        <div class="frow"><label for="bathsSel">Banjo</label>
          <select class="sel" id="bathsSel"><option value="0">Të gjitha</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option></select></div>
        <div class="frow"><label for="priceMin">Çmimi min (€)</label><input class="sel" id="priceMin" type="number" min="0" placeholder="p.sh. 50000"></div>
        <div class="frow"><label for="priceMax">Çmimi max (€)</label><input class="sel" id="priceMax" type="number" min="0" placeholder="p.sh. 150000"></div>
        <div class="frow"><label for="areaMin">Sipërfaqja min (m²)</label><input class="sel" id="areaMin" type="number" min="0" placeholder="p.sh. 50"></div>
        <div class="frow"><label for="areaMax">Sipërfaqja max (m²)</label><input class="sel" id="areaMax" type="number" min="0" placeholder="p.sh. 120"></div>
        <div class="frow"><label for="floorMin">Kati min</label><input class="sel" id="floorMin" type="number" min="0" placeholder="p.sh. 2"></div>
        <div class="frow"><label for="sortSel">Renditja</label>
          <select class="sel" id="sortSel"><option value="new">Më të rejat</option><option value="price-asc">Çmimi ↑</option><option value="price-desc">Çmimi ↓</option><option value="area-desc">Sipërfaqja ↓</option><option value="ppm-asc">€/m² ↑</option></select></div>
      </div>
      <div class="adv-feats" id="advFeats" role="group" aria-label="Veçoritë">
        ${["Ballkon","Ashensor","I mobiluar","Vend parkimi","Tarracë","Ndërtim i ri","Pa komision"].map(f=>`<button type="button" class="choice" data-feat="${f}">${f}</button>`).join("")}
      </div>
      <div class="adv-actions">
        <button class="btn" id="saveSearchBtn" type="button">🔔 Ruaj kërkimin</button>
        <button class="btn ghost" id="clearFilters" type="button">Pastro filtrat</button>
      </div>
    </div>
    <div class="split">
      <section class="listing"><h1 id="listTitle"></h1><p class="sub" id="listSub"></p><div class="cards" id="cards"></div></section>
      <div class="map-wrap"><div class="mapbox" id="listMap"></div><button class="back-country" id="backCountry" type="button">← Gjithë Shqipëria</button></div>
    </div>
    <button class="view-switch" id="viewSwitch" type="button">Harta</button>`;
  attachFooter($(".listing",v));

  let deal=ROUTE_DEAL, ptype="", city="", beds=0, baths=0, sort="new", activeId=null, popup=null;
  let q="", priceMin=0, priceMax=0, areaMin=0, areaMax=0, floorMin=0, featsSel=new Set();
  const priceLabel=l=>l.dealType==="sale"?`€${fmt(l.price)}`:l.dealType==="rent"?`€${fmt(l.price)}/muaj`:`€${fmt(l.price)}/natë`;
  const matchesQ=l=>{
    if(!q) return true;
    const hay=(l.title+" "+l.street+" "+l.complex+" "+l.description+" "+CITIES[l.city].name+" "+l.contactName).toLowerCase();
    return q.toLowerCase().split(/\s+/).every(w=>hay.includes(w));
  };
  const visible=()=>allListings().filter(l=>l.status==="published"&&l.dealType===deal
      &&(!ptype||l.propertyType===ptype)&&(!city||l.city===city)
      &&(!beds||l.bedrooms>=beds)&&(!baths||(l.bathrooms||0)>=baths)
      &&(!priceMin||l.price>=priceMin)&&(!priceMax||l.price<=priceMax)
      &&(!areaMin||l.totalArea>=areaMin)&&(!areaMax||l.totalArea<=areaMax)
      &&(!floorMin||(l.floor||0)>=floorMin)
      &&[...featsSel].every(f=>f==="Pa komision"?l.noCommission:l.features.includes(f))
      &&matchesQ(l))
    .sort((a,b)=>((b.promoBid||0)-(a.promoBid||0))
      ||(sort==="price-asc"?a.price-b.price
        :sort==="price-desc"?b.price-a.price
        :sort==="area-desc"?b.totalArea-a.totalArea
        :sort==="ppm-asc"?(a.totalArea?a.price/a.totalArea:1e12)-(b.totalArea?b.price/b.totalArea:1e12)
        :b.createdAt-a.createdAt));
  const activeAdvCount=()=>[beds,baths,priceMin,priceMax,areaMin,areaMax,floorMin].filter(Boolean).length+featsSel.size;

  destroyMap();
  const map=activeMap=createMap("listMap",online);
  basemapControls(map,online,$(".map-wrap",v));

  const pins={}, cityPins={};
  function rebuildPins(){
    Object.values(pins).forEach(p=>p.marker.remove()); for(const k in pins)delete pins[k];
    visible().forEach(l=>{
      const el=document.createElement("button");
      el.className="price-pin"+(l.dealType==="sale"?"":" rent"); el.type="button";
      el.textContent=l.dealType==="sale"?(l.price>=1e6?"€"+(l.price/1e6).toFixed(1)+"M":"€"+Math.round(l.price/1000)+"k"):priceLabel(l);
      el.addEventListener("click",e=>{e.stopPropagation();select(l,false);});
      const marker=new maplibregl.Marker({element:el,anchor:"bottom",offset:[0,-4]}).setLngLat([l.lng,l.lat]).addTo(map);
      pins[l.id]={marker,el};
    });
    updatePinVis();
  }
  for(const key in CITIES){
    const el=document.createElement("button"); el.className="city-pin"; el.type="button";
    el.addEventListener("click",()=>{ $("#citySel").value=key; city=key; refresh(); map.flyTo({center:CITIES[key].center,zoom:CITIES[key].zoom,duration:1500}); });
    cityPins[key]={el,marker:new maplibregl.Marker({element:el,anchor:"center"}).setLngLat(CITIES[key].center).addTo(map)};
  }
  let clusterMarkers=[];
  function updatePinVis(){
    const z=map.getZoom(), cityMode=z>=10.5, clusterMode=cityMode&&z<13.4, vis=visible();
    clusterMarkers.forEach(m=>m.remove()); clusterMarkers=[];
    for(const id in pins) pins[id].el.style.display=(cityMode&&!clusterMode)?"":"none";
    if(clusterMode){
      // group nearby pins into count bubbles; singles keep their price pin
      const cells={};
      vis.forEach(l=>{
        const p=map.project([l.lng,l.lat]);
        const k=Math.round(p.x/72)+"_"+Math.round(p.y/72);
        (cells[k]=cells[k]||[]).push(l);
      });
      for(const k in cells){
        const list=cells[k];
        if(list.length===1){ if(pins[list[0].id])pins[list[0].id].el.style.display=""; continue; }
        const lng=list.reduce((s,l)=>s+l.lng,0)/list.length, lat=list.reduce((s,l)=>s+l.lat,0)/list.length;
        const el=document.createElement("button"); el.className="cluster-pin"; el.type="button";
        el.textContent=list.length;
        el.setAttribute("aria-label",list.length+" shpallje këtu — kliko për të zmadhuar");
        el.addEventListener("click",()=>map.flyTo({center:[lng,lat],zoom:Math.min(z+1.8,14.5),duration:700}));
        clusterMarkers.push(new maplibregl.Marker({element:el}).setLngLat([lng,lat]).addTo(map));
      }
    }
    const per={};
    vis.forEach(l=>{ (per[l.city]=per[l.city]||[]).push(l); });
    for(const key in cityPins){
      const list=per[key], el=cityPins[key].el;
      if(!cityMode&&list){
        const min=Math.min(...list.map(l=>l.price));
        el.innerHTML=`<b>${CITIES[key].name}</b><span>${list.length} shpallje · nga ${deal==="sale"?"€"+fmt(min):"€"+fmt(min)+(deal==="rent"?"/muaj":"/natë")}</span>`;
        el.style.display="";
      } else el.style.display="none";
    }
    $("#backCountry").style.display=cityMode?"block":"none";
  }
  map.on("zoom",updatePinVis);
  map.on("moveend",updatePinVis);
  $("#backCountry").addEventListener("click",()=>{ city=""; $("#citySel").value=""; refresh(); if(popup)popup.remove(); map.flyTo({...COUNTRY_VIEW,pitch:0,bearing:0,duration:1500}); });

  function popHTML(l){
    return `<div class="pop-body"><p class="eyebrow">${CITIES[l.city].name} · ${DEALS[l.dealType]}</p>
      <h3>${priceLabel(l)}</h3><p class="dev">${esc(l.title)}</p>
      <div class="pop-stats">
        <div><span>Lloji</span><b>${PTYPES[l.propertyType]}</b></div>
        <div><span>Sipërfaqja</span><b>${l.totalArea} m²</b></div>
        ${l.bedrooms?`<div><span>Dhoma gjumi</span><b>${l.bedrooms}</b></div>`:""}
        ${l.floorsTotal?`<div><span>Kati</span><b>${l.floor||"–"}/${l.floorsTotal}</b></div>`:""}
      </div></div><button class="pop-link" data-id="${l.id}">Shiko detajet →</button>`;
  }
  function select(l,fly){
    activeId=l.id;
    $$(".card").forEach(el=>el.classList.toggle("active",el.dataset.id===l.id));
    Object.values(pins).forEach(p=>p.el.classList.remove("active"));
    if(pins[l.id])pins[l.id].el.classList.add("active");
    if(popup)popup.remove();
    popup=new maplibregl.Popup({offset:30}).setLngLat([l.lng,l.lat]).setHTML(popHTML(l)).addTo(map);
    const link=$(".pop-link"); if(link)link.addEventListener("click",()=>location.hash="#/property/"+l.id);
    if(fly){
      if(window.matchMedia("(max-width:880px)").matches)setMobile(true);
      map.flyTo({center:[l.lng,l.lat],zoom:Math.max(map.getZoom(),15),duration:1300});
    } else {
      const card=$(`.card[data-id="${l.id}"]`); if(card)card.scrollIntoView({block:"nearest",behavior:"smooth"});
    }
  }

  function renderCards(){
    const vis=visible(), cardsEl=$("#cards");
    $("#countNote").textContent=`${vis.length} shpallje`;
    $("#listTitle").textContent=`${DEALS[deal]}${ptype?" · "+PTYPES[ptype]:""} ${city?"në "+CITIES[city].name:"në Shqipëri"}`;
    $("#listSub").textContent=vis.length?`nga €${fmt(Math.min(...vis.map(l=>l.price)))}${deal==="rent"?"/muaj":deal==="daily"?"/natë":""}`:"";
    cardsEl.innerHTML=vis.length?"":`<p class="empty">Asnjë pronë nuk përputhet me këto filtra. Zgjeroni kërkimin — ose <b>shtoni shpalljen e parë</b>.</p>`;
    vis.forEach(l=>{
      const el=document.createElement("div"); el.className="card"+(l.id===activeId?" active":""); el.dataset.id=l.id;
      el.setAttribute("role","button"); el.tabIndex=0;
      const faved=getFavs().includes(l.id);
      el.innerHTML=`<span class="thumb-wrap"><img class="thumb" loading="lazy" src="${l.photos[0]||svgThumb(1)}" alt="">
        <button class="fav-btn ${faved?"on":""}" type="button" aria-label="${faved?"Hiq nga të preferuarat":"Shto te të preferuarat"}">♥</button></span>
        <span class="card-info"><span class="price">${priceLabel(l)} ${l.dealType==="sale"&&l.totalArea?`<small>€${fmt(l.price/l.totalArea)}/m²</small>`:""}</span>
        <span class="name">${esc(l.title)}</span>
        <span class="dev">${esc(l.contactName)}</span>
        <span class="tags">${(l.promoBid||0)>0?'<span class="tag promo">E promovuar</span>':""}${l.ownerPlan==="premium"?'<span class="tag premium">PREMIUM</span>':l.ownerPlan==="pro"?'<span class="tag pro">PRO</span>':'<span class="tag verified">VERIFIED</span>'}<span class="tag city">${CITIES[l.city].name}</span><span class="tag">${PTYPES[l.propertyType]}</span>
        ${l.bedrooms?`<span class="tag">${l.bedrooms} dhoma</span>`:""}<span class="tag">${l.totalArea} m²</span></span></span>`;
      el.addEventListener("click",e=>{if(!e.target.closest(".fav-btn"))select(l,true);});
      el.addEventListener("keydown",e=>{if(e.key==="Enter")select(l,true);});
      el.querySelector(".fav-btn").addEventListener("click",async e=>{
        e.stopPropagation();
        const favs=await toggleFav(l.id); if(!favs)return;
        e.target.classList.toggle("on",favs.includes(l.id));
        renderHeader();
      });
      cardsEl.appendChild(el);
    });
  }
  function refresh(){ renderCards(); rebuildPins(); }

  $$("#dealSeg button").forEach(b=>b.addEventListener("click",()=>{ $$("#dealSeg button").forEach(x=>x.classList.toggle("on",x===b)); deal=ROUTE_DEAL=b.dataset.v; renderHeader(); refresh(); }));
  $("#typeSel").addEventListener("change",e=>{ptype=e.target.value;refresh();});
  $("#citySel").addEventListener("change",e=>{
    city=e.target.value; refresh();
    if(city)map.flyTo({center:CITIES[city].center,zoom:CITIES[city].zoom,duration:1500});
  });
  $("#bedsSel").addEventListener("change",e=>{beds=+e.target.value;refresh();});
  $("#bathsSel").addEventListener("change",e=>{baths=+e.target.value;refresh();});
  $("#sortSel").addEventListener("change",e=>{sort=e.target.value;renderCards();});
  let qTimer=null;
  $("#qInput").addEventListener("input",e=>{clearTimeout(qTimer);qTimer=setTimeout(()=>{q=e.target.value.trim();refresh();},250);});
  const advBtn=$("#advBtn"), advPanel=$("#advPanel"), advBadge=$("#advBadge");
  const syncBadge=()=>{const n=activeAdvCount();advBadge.hidden=!n;advBadge.textContent=n;};
  advBtn.addEventListener("click",()=>{advPanel.hidden=!advPanel.hidden;advBtn.classList.toggle("on",!advPanel.hidden);});
  [["priceMin",v=>priceMin=v],["priceMax",v=>priceMax=v],["areaMin",v=>areaMin=v],["areaMax",v=>areaMax=v],["floorMin",v=>floorMin=v]]
    .forEach(([id,set])=>{let t=null;$("#"+id).addEventListener("input",e=>{clearTimeout(t);t=setTimeout(()=>{set(Math.max(0,+e.target.value||0));refresh();syncBadge();},300);});});
  $$("#advFeats .choice").forEach(b=>b.addEventListener("click",()=>{
    const f=b.dataset.feat;
    featsSel.has(f)?featsSel.delete(f):featsSel.add(f);
    b.classList.toggle("on",featsSel.has(f));
    refresh();syncBadge();
  }));
  $("#saveSearchBtn").addEventListener("click",async()=>{
    if(!currentUser()){authModal("login");return;}
    const parts=[deal==="sale"?"Blej":deal==="rent"?"Qira":"Ditore"];
    if(ptype)parts.push(PTYPES[ptype]); if(city)parts.push(CITIES[city].name);
    if(beds)parts.push(beds+"+ dhoma"); if(priceMax)parts.push("deri €"+fmt(priceMax));
    if(q)parts.push("\""+q+"\"");
    const name=prompt("Emri i kërkimit:",parts.join(" · "));
    if(name===null)return;
    try{
      await addSearch(name||parts.join(" · "),{deal,city,ptype,beds,baths,priceMin,priceMax,areaMin,areaMax,q});
      toast("Kërkimi u ruajt — do të shihni njoftim kur të shtohen prona që përputhen");
      renderHeader();
    }catch(err){toast(err.message);}
  });
  $("#clearFilters").addEventListener("click",()=>{
    beds=baths=priceMin=priceMax=areaMin=areaMax=floorMin=0;featsSel.clear();q="";
    $("#qInput").value="";$("#bedsSel").value="0";$("#bathsSel").value="0";
    ["priceMin","priceMax","areaMin","areaMax","floorMin"].forEach(id=>$("#"+id).value="");
    $$("#advFeats .choice").forEach(b=>b.classList.remove("on"));
    refresh();syncBadge();
  });
  const setMobile=m=>{document.body.classList.toggle("map-view",m);$("#viewSwitch").textContent=m?"Lista":"Harta";if(m)map.resize();};
  $("#viewSwitch").addEventListener("click",()=>setMobile(!document.body.classList.contains("map-view")));

  // apply a saved search opened from the searches page
  const savedParams=sessionStorage.getItem("prona_apply_search");
  if(savedParams){
    sessionStorage.removeItem("prona_apply_search");
    try{
      const p=JSON.parse(savedParams);
      deal=p.deal||deal; ptype=p.ptype||""; city=p.city||""; beds=p.beds||0; baths=p.baths||0;
      priceMin=p.priceMin||0; priceMax=p.priceMax||0; areaMin=p.areaMin||0; areaMax=p.areaMax||0; q=p.q||"";
      $$("#dealSeg button").forEach(x=>x.classList.toggle("on",x.dataset.v===deal));
      $("#typeSel").value=ptype; $("#citySel").value=city; $("#bedsSel").value=String(beds); $("#bathsSel").value=String(baths);
      $("#qInput").value=q;
      if(priceMin)$("#priceMin").value=priceMin; if(priceMax)$("#priceMax").value=priceMax;
      if(areaMin)$("#areaMin").value=areaMin; if(areaMax)$("#areaMax").value=areaMax;
      $("#advPanel").hidden=false; $("#advBtn").classList.add("on");
      if(city)map.flyTo({center:CITIES[city].center,zoom:CITIES[city].zoom,duration:1200});
    }catch(e){}
  }
  refresh();
}

/* ---------- detail view ---------- */
async function viewDetail(id){
  const l=getListing(id);
  const v=$("#view");
  if(!l){v.innerHTML=`<div class="detail"><p class="empty">Shpallja nuk u gjet.</p></div>`;return;}
  const online=await checkTiles();
  const priceLabel=l.dealType==="sale"?`€${fmt(l.price)}`:l.dealType==="rent"?`€${fmt(l.price)} / muaj`:`€${fmt(l.price)} / natë`;
  const photos=l.photos.length?l.photos:[svgThumb(1)];
  v.innerHTML=`<div class="detail">
    <div class="crumbs"><button data-go="#/">Prona</button> › <button data-go="#/">${DEALS[l.dealType]}</button> › <span>${CITIES[l.city].name}</span></div>
    <div class="detail-grid">
      <div>
        <div class="gallery">
          <img class="main-photo" id="mainPhoto" src="${photos[0]}" alt="${esc(l.title)}">
          ${photos.length>1?`<div class="strip">${photos.map((p,i)=>`<img loading="lazy" src="${p}" data-i="${i}" class="${i===0?"sel-photo":""}" alt="">`).join("")}</div>`:""}
        </div>
        <h2 class="section-title">Rreth pronës</h2>
        <div class="panel-box">
          <div class="spec-list">
            <div><span>Marrëveshja</span><b>${DEALS[l.dealType]}</b></div>
            <div><span>Lloji</span><b>${PTYPES[l.propertyType]}</b></div>
            ${l.floorsTotal?`<div><span>Kati</span><b>${l.floor||"–"} nga ${l.floorsTotal}</b></div>`:""}
            ${l.rooms?`<div><span>Dhoma</span><b>${l.rooms}</b></div>`:""}
            ${l.bedrooms?`<div><span>Dhoma gjumi</span><b>${l.bedrooms}</b></div>`:""}
            ${l.bathrooms?`<div><span>Banjo</span><b>${l.bathrooms}</b></div>`:""}
            <div><span>Sipërfaqja totale</span><b>${l.totalArea} m²</b></div>
            ${l.livingArea?`<div><span>Sipërfaqja e banimit</span><b>${l.livingArea} m²</b></div>`:""}
            ${l.terraceArea?`<div><span>Tarraca</span><b>${l.terraceArea} m²</b></div>`:""}
          </div>
          ${l.features.length?`<div class="feat-chips">${l.features.map(f=>`<span class="tag">${esc(f)}</span>`).join("")}</div>`:""}
          ${l.description?`<p style="font-size:13.5px;line-height:1.6;margin:14px 0 0;color:var(--ink-soft)">${esc(l.description)}</p>`:""}
          ${l.youtube?`<p style="margin:12px 0 0"><a href="${esc(l.youtube)}" target="_blank" rel="noopener" style="font-size:13px;color:var(--accent);font-weight:600">▶ Tur me video</a></p>`:""}
        </div>
        <h2 class="section-title">Vendndodhja</h2>
        <div class="mini-map"><div class="mapbox" id="miniMap"></div></div>
      </div>
      <div class="detail-side">
        <div class="panel-box">
          <p class="eyebrow" style="font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--accent);margin:0 0 4px">${CITIES[l.city].name}${l.street?` · ${esc(l.street)}${l.houseNo?" "+esc(l.houseNo):""}`:""}</p>
          <h2>${esc(l.title)}</h2>
          <div class="big-price">${priceLabel} ${l.dealType==="sale"&&l.totalArea?`<small>· €${fmt(l.price/l.totalArea)}/m²</small>`:""}</div>
          ${l.noCommission?`<p style="margin:8px 0 0"><span class="pill-note">Pa komision për ${l.dealType==="sale"?"blerësin":"qiramarrësin"}</span></p>`:""}
        </div>
        <div class="panel-box">
          <b style="font-size:13.5px">Kontakti</b>
          <div class="contact-row">
            <span class="avatar">${esc((l.contactName||"P")[0].toUpperCase())}</span>
            <span class="who"><b>${esc(l.contactName)}</b><span>${l.accountType==="owner"?"Pronar i pronës":l.accountType==="agency"?"Agjenci":"Agjent imobiliar"}</span></span>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn primary" id="showPhone" style="flex:1;justify-content:center">Shfaq telefonin</button>
            ${l.whatsapp?`<a class="btn" style="justify-content:center" href="https://wa.me/${esc(l.phone.replace(/\D/g,""))}" target="_blank" rel="noopener">WhatsApp</a>`:""}
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn" id="favDetail" style="flex:1;justify-content:center">${getFavs().includes(l.id)?"♥ E ruajtur":"♡ Ruaj"}</button>
            <button class="btn" id="shareWa" style="flex:1;justify-content:center">Ndaje në WhatsApp</button>
          </div>
        </div>
        <div class="panel-box" id="similarBox" style="display:none">
          <b style="font-size:13.5px">Prona të ngjashme</b>
          <div id="similarList" style="display:flex;flex-direction:column;gap:8px;margin-top:10px"></div>
        </div>
      </div>
    </div>
  </div>`;
  $$("[data-go]",v).forEach(b=>b.addEventListener("click",()=>location.hash=b.dataset.go));
  $$(".strip img",v).forEach(im=>im.addEventListener("click",()=>{
    $("#mainPhoto").src=photos[+im.dataset.i];
    $$(".strip img",v).forEach(x=>x.classList.toggle("sel-photo",x===im));
  }));
  track(l.id,"view");
  $("#showPhone").addEventListener("click",e=>{e.target.textContent=l.phone;e.target.classList.remove("primary");track(l.id,"phone");});
  const waLink=$$(".panel-box a[href^='https://wa.me/']",v)[0];
  if(waLink)waLink.addEventListener("click",()=>track(l.id,"whatsapp"));
  $("#favDetail").addEventListener("click",async e=>{
    const favs=await toggleFav(l.id); if(!favs)return;
    e.target.textContent=favs.includes(l.id)?"♥ E ruajtur":"♡ Ruaj"; renderHeader();
  });
  $("#shareWa").addEventListener("click",()=>{
    const priceTxt=l.dealType==="sale"?`€${fmt(l.price)}`:`€${fmt(l.price)}${l.dealType==="rent"?"/muaj":"/natë"}`;
    const url=location.origin.startsWith("http")?location.origin+"/#/property/"+l.id:location.href;
    window.open("https://wa.me/?text="+encodeURIComponent(`${l.title} — ${priceTxt}, ${l.totalArea} m² · ${CITIES[l.city].name}\n${url}`),"_blank","noopener");
  });
  /* photo lightbox */
  $("#mainPhoto").style.cursor="zoom-in";
  $("#mainPhoto").addEventListener("click",()=>{
    let idx=photos.indexOf($("#mainPhoto").getAttribute("src")); if(idx<0)idx=0;
    const lb=document.createElement("div"); lb.className="lightbox"; lb.setAttribute("role","dialog");
    lb.innerHTML=`<button class="lb-x" aria-label="Mbyll">×</button>
      ${photos.length>1?`<button class="lb-prev" aria-label="E mëparshme">‹</button><button class="lb-next" aria-label="Tjetra">›</button>`:""}
      <img src="${photos[idx]}" alt=""><span class="lb-count">${idx+1} / ${photos.length}</span>`;
    document.body.appendChild(lb);
    const img=lb.querySelector("img"), cnt=lb.querySelector(".lb-count");
    const show=i=>{idx=(i+photos.length)%photos.length;img.src=photos[idx];cnt.textContent=(idx+1)+" / "+photos.length;};
    const closeLb=()=>{lb.remove();document.removeEventListener("keydown",onKey);};
    const onKey=e=>{if(e.key==="Escape")closeLb();if(e.key==="ArrowLeft")show(idx-1);if(e.key==="ArrowRight")show(idx+1);};
    document.addEventListener("keydown",onKey);
    lb.querySelector(".lb-x").addEventListener("click",closeLb);
    lb.addEventListener("click",e=>{if(e.target===lb)closeLb();});
    const pv=lb.querySelector(".lb-prev"), nx=lb.querySelector(".lb-next");
    if(pv)pv.addEventListener("click",()=>show(idx-1));
    if(nx)nx.addEventListener("click",()=>show(idx+1));
  });
  /* similar properties */
  const similar=allListings().filter(x=>x.status==="published"&&x.id!==l.id&&x.city===l.city&&x.dealType===l.dealType)
    .sort((a,b)=>Math.abs(a.price-l.price)-Math.abs(b.price-l.price)).slice(0,3);
  if(similar.length){
    $("#similarBox").style.display="";
    similar.forEach(s=>{
      const b=document.createElement("button"); b.className="sim-row"; b.type="button";
      const pt=s.dealType==="sale"?`€${fmt(s.price)}`:`€${fmt(s.price)}${s.dealType==="rent"?"/muaj":"/natë"}`;
      b.innerHTML=`<img loading="lazy" src="${s.photos[0]||svgThumb(2)}" alt=""><span><b>${pt}</b><i>${esc(s.title)}</i></span>`;
      b.addEventListener("click",()=>{location.hash="#/property/"+s.id;});
      $("#similarList").appendChild(b);
    });
  }
  destroyMap();
  const map=activeMap=createMap("miniMap",online,{center:[l.lng,l.lat],zoom:15.5,nav:true});
  basemapControls(map,online,$(".mini-map",v));
  const el=document.createElement("div"); el.className="draft-pin"; el.style.cursor="default";
  new maplibregl.Marker({element:el,anchor:"bottom"}).setLngLat([l.lng,l.lat]).addTo(map);
  attachFooter($(".detail",v));
}

/* ---------- add / edit property ---------- */
async function viewAdd(editId){
  const u=currentUser();
  const v=$("#view");
  if(!u){
    v.innerHTML=`<div class="form-page"><div class="form-shell" style="text-align:center;padding-top:60px">
      <h1>Shto pronën tuaj</h1>
      <p class="lede">Pronarët, agjentët dhe agjencitë mund të publikojnë në Prona.<br>Hyni ose krijoni një llogari falas për të vazhduar.</p>
      <button class="btn primary" id="goLogin">Hyr / Regjistrohu</button></div></div>`;
    $("#goLogin").addEventListener("click",()=>authModal("login"));
    return;
  }
  const online=await checkTiles();
  const editing=editId?(Remote.enabled?Remote.listings:Store.userListings()).find(l=>l.id===editId&&l.owner===u.email):null;
  const d=editing||{
    dealType:"sale",propertyType:"apartment",accountType:u.type||"owner",
    city:"tirana",complex:"",street:"",houseNo:"",lng:null,lat:null,
    floor:"",floorsTotal:"",bedrooms:"",rooms:"",bathrooms:"",totalArea:"",livingArea:"",terraceArea:"",
    features:[],description:"",photos:[],youtube:"",price:"",currency:"EUR",noCommission:false,
    contactName:u.name,phone:"",whatsapp:false,promoBid:0,
  };
  v.innerHTML=`<div class="form-page"><div class="form-shell">
    <h1>${editing?"Ndrysho shpalljen":"Shto pronën tuaj"}</h1>
    <p class="lede">Plotësoni të dhënat më poshtë — shpallja shfaqet në hartë menjëherë pas publikimit.</p>

    <div class="fsection"><h2><span class="num">1</span>Shpallja juaj</h2>
      <div class="frow"><label>Po publikoni si</label><div class="choice-row" id="f-acc">
        ${["owner","agent","agency"].map(t=>`<button type="button" class="choice ${d.accountType===t?"on":""}" data-v="${t}">${ACC_LABELS[t]}</button>`).join("")}</div></div>
      <div class="frow"><label>Lloji i marrëveshjes</label><div class="choice-row" id="f-deal">
        ${Object.entries(DEALS).map(([k,l])=>`<button type="button" class="choice ${d.dealType===k?"on":""}" data-v="${k}">${l}</button>`).join("")}</div></div>
      <div class="frow"><label>Lloji i pronës</label><div class="choice-row" id="f-type">
        ${Object.entries(PTYPES).map(([k,l])=>`<button type="button" class="choice ${d.propertyType===k?"on":""}" data-v="${k}">${l}</button>`).join("")}</div></div>
    </div>

    <div class="fsection"><h2><span class="num">2</span>Adresa</h2>
      <div class="grid2">
        <div class="frow"><label for="f-city">Qyteti</label><select id="f-city">${Object.entries(CITIES).map(([k,c])=>`<option value="${k}" ${d.city===k?"selected":""}>${c.name}</option>`).join("")}</select></div>
        <div class="frow"><label for="f-complex">Kompleks banimi <span style="font-weight:400;color:var(--ink-faint)">(opsionale)</span></label><input id="f-complex" type="text" value="${esc(d.complex)}" placeholder="p.sh. Tirana Garden Building"></div>
      </div>
      <div class="frow"><label for="f-search">Kërko adresën</label>
        <input id="f-search" type="text" placeholder="Shkruani rrugën ose vendin, p.sh. Rruga Myslym Shyri 12" autocomplete="off">
        <div class="addr-results" id="f-results"></div>
        <span class="hint">${online?"Kërkon në bazën e adresave OpenStreetMap për Shqipërinë.":"Kërkimi i adresave punon me shërbimin e hartës kur faqja hostohet — në këtë pamje paraprake gjen vetëm emrat e qyteteve."}</span></div>
      <div class="grid2">
        <div class="frow"><label for="f-street">Rruga</label><input id="f-street" type="text" value="${esc(d.street)}"></div>
        <div class="frow"><label for="f-houseno">Numri i shtëpisë</label><input id="f-houseno" type="text" value="${esc(d.houseNo)}"></div>
      </div>
      <div class="frow"><label>Vendndodhja e saktë — tërhiqni shënjuesin mbi ndërtesën tuaj</label>
        <div class="pick-map"><div class="mapbox" id="pickMap"></div><div class="pick-hint" id="pickHint">Klikoni hartën ose tërhiqni shënjuesin për të shënuar ndërtesën e saktë.</div></div>
        <span class="err" id="loc-err">Vendosni vendndodhjen në hartë që blerësit ta gjejnë pronën.</span></div>
    </div>

    <div class="fsection" id="aboutSec"><h2><span class="num">3</span>Rreth pronës</h2>
      <div class="grid3">
        <div class="frow" data-only="apartment,commercial,parking"><label for="f-floor">Kati</label><input id="f-floor" type="number" min="0" max="60" value="${esc(d.floor)}"></div>
        <div class="frow" data-only="apartment,house,commercial,parking"><label for="f-floors">Kate në ndërtesë</label><input id="f-floors" type="number" min="1" max="60" value="${esc(d.floorsTotal)}"></div>
        <div class="frow" data-only="apartment,house"><label for="f-rooms">Dhoma</label><input id="f-rooms" type="number" min="1" max="20" value="${esc(d.rooms)}"></div>
        <div class="frow" data-only="apartment,house"><label for="f-beds">Dhoma gjumi</label><input id="f-beds" type="number" min="0" max="15" value="${esc(d.bedrooms)}"></div>
        <div class="frow" data-only="apartment,house,commercial"><label for="f-baths">Banjo</label><input id="f-baths" type="number" min="0" max="10" value="${esc(d.bathrooms)}"></div>
        <div class="frow"><label for="f-total">Sipërfaqja totale, m²</label><input id="f-total" type="number" min="1" max="100000" value="${esc(d.totalArea)}"><span class="err">Shkruani sipërfaqen totale.</span></div>
        <div class="frow" data-only="apartment,house"><label for="f-living">Sipërfaqja e banimit, m²</label><input id="f-living" type="number" min="1" max="10000" value="${esc(d.livingArea)}"></div>
        <div class="frow" data-only="apartment,house"><label for="f-terrace">Sipërfaqja e tarracës, m²</label><input id="f-terrace" type="number" min="0" max="1000" value="${esc(d.terraceArea)}"></div>
      </div>
      <div class="frow" data-only="apartment,house"><label>Veçoritë e planimetrisë</label>
        <div class="check-grid" id="f-feats">${FEATURES.map(f=>`<label><input type="checkbox" value="${f}" ${d.features.includes(f)?"checked":""}>${f}</label>`).join("")}</div></div>
      <div class="frow"><label for="f-desc">Përshkrimi</label>
        <textarea id="f-desc" rows="4" placeholder="Çfarë e bën këtë pronë një ofertë të mirë? Shkruani në çdo gjuhë.">${esc(d.description)}</textarea></div>
    </div>

    <div class="fsection"><h2><span class="num">4</span>Foto dhe video</h2>
      <div class="photo-drop" id="photoDrop">Klikoni për të shtuar foto, ose tërhiqini këtu<br><span style="font-size:11px;color:var(--ink-faint)">Shtoni të paktën 3 foto — e para bëhet fotoja kryesore.</span></div>
      <input type="file" id="photoInput" accept="image/*" multiple style="display:none">
      <div class="photo-grid" id="photoGrid"></div>
      <div class="frow" style="margin-top:12px"><label for="f-youtube">Lidhje YouTube <span style="font-weight:400;color:var(--ink-faint)">(opsionale)</span></label>
        <input id="f-youtube" type="url" value="${esc(d.youtube)}" placeholder="https://www.youtube.com/watch?v=…"></div>
    </div>

    <div class="fsection"><h2><span class="num">5</span>Çmimi dhe kushtet</h2>
      <div class="grid2">
        <div class="frow"><label for="f-price" id="priceLabel"></label><input id="f-price" type="number" min="1" value="${esc(d.price)}"><span class="err">Shkruani çmimin.</span></div>
        <div class="frow"><label for="f-currency">Monedha</label><select id="f-currency"><option value="EUR" ${d.currency==="EUR"?"selected":""}>EUR €</option><option value="ALL" ${d.currency==="ALL"?"selected":""}>ALL Lek</option></select></div>
      </div>
      <div class="frow"><label style="display:flex;align-items:center;gap:8px;color:var(--ink);font-weight:500;cursor:pointer"><input type="checkbox" id="f-nocomm" ${d.noCommission?"checked":""} style="width:16px;height:16px;accent-color:var(--accent)"><span id="noCommLabel"></span></label></div>
    </div>

    <div class="fsection"><h2><span class="num">6</span>Kontaktet</h2>
      <div class="grid2">
        <div class="frow"><label for="f-cname">Emri i kontaktit</label><input id="f-cname" type="text" value="${esc(d.contactName)}"><span class="err">Si duhet t'ju drejtohen blerësit?</span></div>
        <div class="frow"><label for="f-phone">Telefoni</label><input id="f-phone" type="tel" value="${esc(d.phone)}" placeholder="+355 69 123 4567"><span class="err">Shtoni një numër telefoni.</span></div>
      </div>
      <div class="frow"><label style="display:flex;align-items:center;gap:8px;color:var(--ink);font-weight:500;cursor:pointer"><input type="checkbox" id="f-wa" ${d.whatsapp?"checked":""} style="width:16px;height:16px;accent-color:var(--accent)">Ky numër është në WhatsApp</label></div>
    </div>

    <div class="fsection promo-section"><h2><span class="num">7</span>Promovimi <span style="font-weight:400;font-size:11px;color:var(--ink-faint)">(opsionale)</span></h2>
      <div class="promo-banner">Prona të reja shtohen çdo ditë. Promovoni tuajën për t'u dalluar — edhe një ofertë minimale ditore e rendit shpalljen tuaj mbi të gjitha shpalljet falas në kategorinë e saj.</div>
      <div class="promo-grid">
        <div class="promo-box"><span>Çmimi ditor i promovimit</span>
          <div class="promo-input"><input id="f-promo" type="number" min="0" max="100" step="1" value="${esc(d.promoBid||0)}" aria-label="Çmimi ditor i promovimit në euro"><b>€/ditë</b></div></div>
        <div class="promo-arrow" aria-hidden="true">⇄</div>
        <div class="promo-box"><span>Pozicioni në kategori</span><b class="promo-pos" id="promoPos">–</b></div>
      </div>
      <p class="form-note" style="margin-top:10px">Ofertat më të larta renditen më lart. Krahasoheni vetëm me shpalljet e të njëjtit lloj marrëveshjeje dhe qytet. Dita e parë tarifohet nga bilanci kur publikoni; më pas tarifimi vazhdon ditë pas dite dhe ndalon automatikisht nëse bilanci mbaron. Bilanci juaj: <b>€${balanceOf(u).toFixed(2)}</b> — <a href="#/balance" style="color:var(--accent);font-weight:600">rimbush</a>.</p>
    </div>

    <div class="form-actions">
      <button class="btn primary" id="publishBtn" style="flex:1;justify-content:center">${editing?"Ruaj ndryshimet":"Publiko shpalljen"}</button>
      <button class="btn" id="draftBtn">Ruaj si draft</button>
      ${editing?"":`<button class="btn ghost" id="clearBtn">Pastro formularin</button>`}
    </div>
    <p class="form-note">Duke publikuar konfirmoni se keni të drejtën ta reklamoni këtë pronë. Kur faqja punon me serverin e saj (node server.js), shpalljet ndahen me të gjithë vizitorët; në një host vetëm statik ato mbeten në shfletuesin tuaj.</p>
  </div></div>`;

  /* --- state & choice groups --- */
  const state={...d, features:[...d.features], photos:[...d.photos]};
  const bindChoices=(sel,key,after)=>{ $$(sel+" .choice").forEach(c=>c.addEventListener("click",()=>{
    $$(sel+" .choice").forEach(x=>x.classList.remove("on")); c.classList.add("on"); state[key]=c.dataset.v; if(after)after();
  }));};
  const syncTypeFields=()=>{
    $$("#aboutSec [data-only]").forEach(el=>{
      el.style.display=el.dataset.only.split(",").includes(state.propertyType)?"":"none";
    });
    $("#priceLabel").textContent=state.dealType==="sale"?"Çmimi":"Çmimi i qirasë"+(state.dealType==="rent"?" në muaj":" për natë");
    $("#noCommLabel").textContent="Pa komision nga "+(state.dealType==="sale"?"blerësi":"qiramarrësi");
  };
  bindChoices("#f-acc","accountType");
  bindChoices("#f-deal","dealType",syncTypeFields);
  bindChoices("#f-type","propertyType",syncTypeFields);
  syncTypeFields();

  /* --- pick map --- */
  destroyMap();
  const startCenter=state.lng?[state.lng,state.lat]:CITIES[state.city].center;
  const map=activeMap=createMap("pickMap",online,{center:startCenter,zoom:state.lng?16:CITIES[state.city].zoom});
  basemapControls(map,online,$(".pick-map",v));
  const pinEl=document.createElement("div"); pinEl.className="draft-pin";
  const pin=new maplibregl.Marker({element:pinEl,anchor:"bottom",draggable:true});
  const setPin=async(lng,lat,doReverse)=>{
    state.lng=+lng.toFixed(6); state.lat=+lat.toFixed(6);
    pin.setLngLat([lng,lat]); if(!pin._map)pin.addTo(map);
    $("#pickHint").textContent=`Shënuar në ${state.lat}, ${state.lng}`+(online?" — po kontrollohet adresa…":"");
    $("#loc-err").parentElement.classList.remove("invalid");
    if(doReverse&&online){
      const r=await reverseGeocode(lng,lat);
      if(r){ if(r.street&&!$("#f-street").value)$("#f-street").value=r.street;
        if(r.houseNo&&!$("#f-houseno").value)$("#f-houseno").value=r.houseNo;
        $("#pickHint").textContent=r.label?r.label.split(",").slice(0,3).join(", "):`Shënuar në ${state.lat}, ${state.lng}`; }
    }
  };
  if(state.lng)setPin(state.lng,state.lat,false);
  map.on("click",e=>setPin(e.lngLat.lng,e.lngLat.lat,true));
  pin.on("dragend",()=>{const p=pin.getLngLat();setPin(p.lng,p.lat,true);});
  $("#f-city").addEventListener("change",e=>{ state.city=e.target.value; map.flyTo({center:CITIES[state.city].center,zoom:CITIES[state.city].zoom,duration:1200}); });

  /* --- address search --- */
  let searchTimer=null;
  $("#f-search").addEventListener("input",e=>{
    clearTimeout(searchTimer);
    const q=e.target.value.trim(); const box=$("#f-results");
    if(q.length<3){box.style.display="none";return;}
    searchTimer=setTimeout(async()=>{
      const res=await geocode(q+", "+CITIES[state.city].name);
      box.innerHTML=res.length?res.map((r,i)=>`<button type="button" data-i="${i}">${esc(r.label)}</button>`).join(""):`<button type="button" disabled>Asnjë përputhje — vendosni shënjuesin manualisht në hartë.</button>`;
      box.style.display="block";
      $$("button[data-i]",box).forEach(b=>b.addEventListener("click",()=>{
        const r=res[+b.dataset.i]; box.style.display="none"; e.target.value=r.label.split(",")[0];
        map.flyTo({center:[r.lng,r.lat],zoom:17,duration:1200}); setPin(r.lng,r.lat,true);
      }));
    },450);
  });

  /* --- promotion: live position preview --- */
  const promoInput=$("#f-promo");
  function updatePromoPos(){
    const bid=Math.max(0,+promoInput.value||0);
    state.promoBid=bid;
    const rivals=allListings().filter(l=>l.status==="published"&&l.dealType===state.dealType
      &&l.city===state.city&&(!editing||l.id!==editing.id));
    // new listings rank first within their bid tier, so you sit below higher bids only
    const place=1+rivals.filter(l=>(l.promoBid||0)>bid).length;
    $("#promoPos").textContent=`${place} nga ${rivals.length+1}`;
    $("#publishBtn").textContent=editing?"Ruaj ndryshimet":(bid>0?"Publiko dhe promovo":"Publiko shpalljen");
  }
  promoInput.addEventListener("input",updatePromoPos);
  updatePromoPos();

  /* --- features --- */
  $$("#f-feats input").forEach(cb=>cb.addEventListener("change",()=>{
    state.features=$$("#f-feats input:checked").map(x=>x.value);
  }));

  /* --- photos --- */
  const grid=$("#photoGrid");
  const photoLimit=PLANS[planOf(currentUser())].photos;
  const renderPhotos=()=>{
    grid.innerHTML=state.photos.map((p,i)=>`<div class="ph"><img src="${p}" alt="Photo ${i+1}">
      ${i===0?'<span class="main-badge">MAIN</span>':""}<button class="rm" data-i="${i}" type="button" aria-label="Hiq foton">×</button></div>`).join("");
    $$(".rm",grid).forEach(b=>b.addEventListener("click",()=>{state.photos.splice(+b.dataset.i,1);renderPhotos();}));
  };
  renderPhotos();
  const addFiles=files=>{
    [...files].filter(f=>f.type.startsWith("image/")).forEach(f=>{
      if(state.photos.length>=photoLimit){toast(`Plani juaj lejon deri në ${photoLimit} foto për pronë. Kaloni në një plan më të lartë për më shumë.`);return;}
      const img=new Image();
      img.onload=()=>{
        const scale=Math.min(1,1280/img.width);
        const cv=document.createElement("canvas");
        cv.width=img.width*scale; cv.height=img.height*scale;
        cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
        state.photos.push(cv.toDataURL("image/jpeg",.78)); renderPhotos();
        URL.revokeObjectURL(img.src);
      };
      img.src=URL.createObjectURL(f);
    });
  };
  $("#photoDrop").addEventListener("click",()=>$("#photoInput").click());
  $("#photoInput").addEventListener("change",e=>addFiles(e.target.files));
  $("#photoDrop").addEventListener("dragover",e=>{e.preventDefault();});
  $("#photoDrop").addEventListener("drop",e=>{e.preventDefault();addFiles(e.dataTransfer.files);});

  /* --- validate & save --- */
  const invalid=(id,bad)=>{const el=$(id).closest(".frow");el.classList.toggle("invalid",bad);return bad;};
  function collect(){
    state.complex=$("#f-complex").value.trim(); state.street=$("#f-street").value.trim(); state.houseNo=$("#f-houseno").value.trim();
    state.floor=+$("#f-floor").value||0; state.floorsTotal=+$("#f-floors").value||0;
    state.rooms=+$("#f-rooms").value||0; state.bedrooms=+$("#f-beds").value||0; state.bathrooms=+$("#f-baths").value||0;
    state.totalArea=+$("#f-total").value||0; state.livingArea=+$("#f-living").value||0; state.terraceArea=+$("#f-terrace").value||0;
    state.description=$("#f-desc").value.trim(); state.youtube=$("#f-youtube").value.trim();
    state.price=+$("#f-price").value||0; state.currency=$("#f-currency").value; state.noCommission=$("#f-nocomm").checked;
    state.contactName=$("#f-cname").value.trim(); state.phone=$("#f-phone").value.trim(); state.whatsapp=$("#f-wa").checked;
  }
  function validate(){
    collect();
    let bad=false;
    bad=invalid("#f-total",!state.totalArea)||bad;
    bad=invalid("#f-price",!state.price)||bad;
    bad=invalid("#f-cname",!state.contactName)||bad;
    bad=invalid("#f-phone",!state.phone)||bad;
    if(!state.lng){$("#loc-err").parentElement.classList.add("invalid");bad=true;}
    if(state.floorsTotal&&state.floor>state.floorsTotal){invalid("#f-floor",true);bad=true;}
    if(state.livingArea&&state.livingArea>state.totalArea){invalid("#f-living",true);bad=true;}
    return !bad;
  }
  async function save(status){
    const title=(()=>{
      const t=PTYPES[state.propertyType], inStreet=state.street?" · "+state.street:"";
      if(state.propertyType==="apartment"&&state.bedrooms) return `${PTYPES.apartment} ${state.bedrooms}+1${inStreet}`;
      return `${t}${inStreet} · ${state.totalArea} m²`;
    })();
    const rec={...state,id:editing?editing.id:"u-"+Date.now(),owner:u.email,seeded:false,status,title,
      createdAt:editing?editing.createdAt:Date.now()};
    if(Remote.enabled){
      const j=editing?await apiCall("/api/listings/"+editing.id,"PUT",rec)
                     :await apiCall("/api/listings","POST",rec);
      if(editing){const i=Remote.listings.findIndex(x=>x.id===editing.id);Remote.listings[i]=j.listing;}
      else Remote.listings.push(j.listing);
      if(j.user)Remote.user=j.user; // balance may have changed (promotion charge)
      renderHeader();
      return j.listing;
    }
    // local mode: charge the first promotion day from the browser wallet
    const startingPromo=status==="published"&&state.promoBid>0&&!(editing&&editing.promoBid>0&&editing.status==="published");
    if(startingPromo){
      if(balanceOf(currentUser())<state.promoBid)
        throw new Error(`Bilanci juaj (€${balanceOf(currentUser()).toFixed(2)}) nuk mbulon ditën e parë të promovimit (€${state.promoBid}). Rimbusheni te faqja e Bilancit.`);
      localCredit(u.email,-state.promoBid,"promotion","Promovim ditor · "+title);
      renderHeader();
    }
    const listings=Store.userListings();
    if(editing){const i=listings.findIndex(x=>x.id===editing.id);listings[i]=rec;}
    else listings.push(rec);
    Store.saveUserListings(listings);
    return rec;
  }
  $("#publishBtn").addEventListener("click",async()=>{
    if(!validate()){toast("Ju lutemi korrigjoni fushat e theksuara");window.scrollTo?$(".form-page").scrollTo({top:0,behavior:"smooth"}):0;return;}
    if(state.photos.length<3&&!confirm("Shpalljet me të paktën 3 foto shikohen shumë më tepër. Të publikohet gjithsesi?"))return;
    try{
      const rec=await save("published");
      toast(editing?"Shpallja u përditësua":"Shpallja u publikua");
      location.hash="#/property/"+rec.id;
    }catch(err){
      if(err.needsVerify){verifyModal();return;}
      if(err.needsPlan){toast(err.message);setTimeout(()=>location.hash="#/plans",1600);return;}
      toast(err.message||"Nuk u ruajt — provoni përsëri");
    }
  });
  $("#draftBtn").addEventListener("click",async()=>{
    collect();
    if(!state.totalArea&&!state.price&&!state.lng){toast("Asgjë për të ruajtur ende");return;}
    try{ await save("draft"); toast("U ruajt te draftet"); location.hash="#/my"; }
    catch(err){toast(err.message||"Nuk u ruajt — provoni përsëri");}
  });
  const cb=$("#clearBtn"); if(cb)cb.addEventListener("click",()=>{if(confirm("Të pastrohet i gjithë formulari?"))viewAdd();});
}

/* ---------- favorites page ---------- */
function viewFavorites(){
  destroyMap();
  const u=currentUser(); const v=$("#view");
  if(!u){v.innerHTML=`<div class="myprops"><div class="inner"><p class="empty">Hyni për të parë të preferuarat.</p></div></div>`;return;}
  const favs=allListings().filter(l=>getFavs().includes(l.id)&&l.status==="published");
  v.innerHTML=`<div class="myprops"><div class="inner">
    <h1 style="font-size:20px;margin:0 0 4px">Të preferuarat</h1>
    <p style="font-size:13px;color:var(--ink-soft);margin:0 0 18px">${favs.length?favs.length+" prona të ruajtura":"Klikoni ♥ te një shpallje për ta ruajtur këtu."}</p>
    <div class="cards" id="favCards"></div>
  </div></div>`;
  const grid=$("#favCards");
  favs.forEach(l=>{
    const el=document.createElement("button"); el.className="card"; el.type="button";
    const priceTxt=l.dealType==="sale"?`€${fmt(l.price)}`:l.dealType==="rent"?`€${fmt(l.price)}/muaj`:`€${fmt(l.price)}/natë`;
    el.innerHTML=`<img class="thumb" loading="lazy" src="${l.photos[0]||svgThumb(1)}" alt="">
      <span class="card-info"><span class="price">${priceTxt}</span><span class="name">${esc(l.title)}</span>
      <span class="tags"><span class="tag city">${CITIES[l.city].name}</span><span class="tag">${l.totalArea} m²</span></span></span>`;
    el.addEventListener("click",()=>location.hash="#/property/"+l.id);
    grid.appendChild(el);
  });
  attachFooter($(".myprops .inner",v));
}

/* ---------- saved searches page ---------- */
function viewSearches(){
  destroyMap();
  const u=currentUser(); const v=$("#view");
  if(!u){v.innerHTML=`<div class="myprops"><div class="inner"><p class="empty">Hyni për të parë kërkimet e ruajtura.</p></div></div>`;return;}
  const searches=getSearches();
  v.innerHTML=`<div class="myprops"><div class="inner">
    <h1 style="font-size:20px;margin:0 0 4px">Kërkimet e ruajtura</h1>
    <p style="font-size:13px;color:var(--ink-soft);margin:0 0 18px">${searches.length?"Njoftoheni kur shtohen prona të reja që përputhen me kërkimin tuaj.":"Hapni kërkimin e avancuar dhe klikoni \"Ruaj kërkimin\"."}</p>
    <div id="searchRows"></div>
  </div></div>`;
  const rows=$("#searchRows");
  searches.forEach(s=>{
    const fresh=searchNewCount(s);
    const row=document.createElement("div"); row.className="prop-row";
    row.innerHTML=`<div class="info" style="padding-left:6px"><b>${esc(s.name)} ${fresh?`<span class="tag promo">${fresh} të reja</span>`:""}</b>
      <span>Ruajtur më ${new Date(s.createdAt).toLocaleDateString("sq-AL")}</span></div>
      <div class="actions"><button class="btn" data-a="open">Hap</button><button class="btn ghost" data-a="del">Fshi</button></div>`;
    row.querySelector('[data-a="open"]').addEventListener("click",async()=>{
      await markSearchSeen(s.id); renderHeader();
      ROUTE_DEAL=s.params.deal||"sale"; location.hash="#/";
      sessionStorage.setItem("prona_apply_search",JSON.stringify(s.params));
      render();
    });
    row.querySelector('[data-a="del"]').addEventListener("click",async()=>{
      if(!confirm("Ta fshini këtë kërkim?"))return;
      await removeSearch(s.id); viewSearches(); renderHeader();
    });
    rows.appendChild(row);
  });
  attachFooter($(".myprops .inner",v));
}

/* ---------- admin panel ---------- */
async function viewAdmin(){
  destroyMap();
  const u=currentUser(); const v=$("#view");
  if(!userIsAdmin(u)){v.innerHTML=`<div class="myprops"><div class="inner"><p class="empty">Vetëm administratori ka qasje këtu.</p></div></div>`;return;}
  let data;
  if(Remote.enabled){
    try{ data=await apiCall("/api/admin/overview"); }
    catch(e){v.innerHTML=`<div class="myprops"><div class="inner"><p class="empty">${esc(e.message)}</p></div></div>`;return;}
  } else {
    const users=Store.users(), listings=Store.userListings();
    data={
      users:users.map(x=>({name:x.name,email:x.email,type:x.type,banned:!!x.banned,verified:true,balance:x.balance||0,listings:listings.filter(l=>l.owner===x.email).length,createdAt:x.createdAt})),
      listingsCount:listings.length,
      publishedCount:listings.filter(l=>l.status==="published").length,
      promotedCount:listings.filter(l=>l.promoBid>0).length,
      revenue:users.flatMap(x=>x.transactions||[]).filter(t=>t.type==="promotion").reduce((s,t)=>s-t.amount,0),
    };
  }
  const userListings=(Remote.enabled?Remote.listings:Store.userListings()).filter(l=>!l.seeded);
  v.innerHTML=`<div class="myprops"><div class="inner" style="max-width:1000px">
    <h1 style="font-size:20px;margin:0 0 14px">Paneli i administratorit</h1>
    <div class="admin-stats">
      <div class="stat"><span>Përdorues</span><b>${data.users.length}</b></div>
      <div class="stat"><span>Shpallje</span><b>${data.listingsCount}</b></div>
      <div class="stat"><span>Të publikuara</span><b>${data.publishedCount}</b></div>
      <div class="stat"><span>Të promovuara</span><b>${data.promotedCount}</b></div>
      <div class="stat"><span>Të ardhura nga promovimi</span><b>€${fmt(data.revenue)}</b></div>
    </div>
    <h2 class="section-title">Shpalljet e përdoruesve</h2>
    <div id="admListings">${userListings.length?"":'<p class="empty">Ende asnjë shpallje nga përdoruesit.</p>'}</div>
    <h2 class="section-title">Përdoruesit</h2>
    <div id="admUsers"></div>
  </div></div>`;
  const lrows=$("#admListings");
  userListings.forEach(l=>{
    const row=document.createElement("div"); row.className="prop-row";
    row.innerHTML=`<img loading="lazy" src="${l.photos[0]||svgThumb(2)}" alt="">
      <div class="info"><b>${esc(l.title)}</b><span>${esc(l.owner||"")} · ${CITIES[l.city]?CITIES[l.city].name:l.city} · €${fmt(l.price)} · ${l.status}</span></div>
      <div class="actions"><button class="btn" data-a="view">Shiko</button><button class="btn ghost" data-a="del">Fshi</button></div>`;
    row.querySelector('[data-a="view"]').addEventListener("click",()=>location.hash="#/property/"+l.id);
    row.querySelector('[data-a="del"]').addEventListener("click",async()=>{
      if(!confirm("Ta fshini këtë shpallje si administrator?"))return;
      try{
        if(Remote.enabled){await apiCall("/api/admin/listings/"+l.id,"DELETE");Remote.listings=Remote.listings.filter(x=>x.id!==l.id);}
        else Store.saveUserListings(Store.userListings().filter(x=>x.id!==l.id));
        toast("Shpallja u fshi"); viewAdmin();
      }catch(err){toast(err.message);}
    });
    lrows.appendChild(row);
  });
  const urows=$("#admUsers");
  data.users.forEach(x=>{
    const row=document.createElement("div"); row.className="prop-row";
    row.innerHTML=`<div class="info" style="padding-left:6px"><b>${esc(x.name)} ${x.banned?'<span class="tag draft">PEZULLUAR</span>':""}</b>
      <span>${esc(x.email)} · ${esc(x.type)} · ${x.listings} shpallje · €${x.balance.toFixed(2)}</span></div>
      <div class="actions">${x.email===u.email?"":`<button class="btn ghost" data-a="ban">${x.banned?"Aktivizo":"Pezullo"}</button>`}</div>`;
    const bb=row.querySelector('[data-a="ban"]');
    if(bb)bb.addEventListener("click",async()=>{
      if(!confirm((x.banned?"Ta aktivizoni":"Ta pezulloni")+" këtë përdorues?"))return;
      try{
        if(Remote.enabled)await apiCall("/api/admin/ban/"+encodeURIComponent(x.email),"POST",{});
        else mutateLocalUser(()=>{const us=Store.users();const t=us.find(z=>z.email===x.email);if(t)t.banned=!t.banned;Store.saveUsers(us);});
        toast("U përditësua"); viewAdmin();
      }catch(err){toast(err.message);}
    });
    urows.appendChild(row);
  });
}

/* ---------- subscription plans page ---------- */
function viewPlans(){
  destroyMap();
  const u=currentUser(); const v=$("#view");
  const cur=planOf(u);
  v.innerHTML=`<div class="myprops"><div class="inner" style="max-width:860px">
    <h1 style="font-size:20px;margin:0 0 4px">Planet për agjenci dhe pronarë</h1>
    <p style="font-size:13px;color:var(--ink-soft);margin:0 0 20px">Publikimi bazë është gjithmonë falas. Planet me pagesë hapin më shumë shpallje aktive dhe statistika — paguhen nga bilanci juaj, muaj pas muaji, pa kontrata.</p>
    <div class="plan-grid">
      ${Object.entries(PLANS).map(([k,p])=>`
      <div class="plan-card ${k==="pro"?"popular":""} ${cur===k?"current":""}">
        ${k==="pro"?'<span class="plan-flag">Më i zgjedhuri</span>':""}
        <h3>${p.name}</h3>
        <div class="plan-price">${p.price?`${fmt(p.price)} L<small>/muaj</small>`:"0 L"}</div>
        <ul>${p.perks.map(x=>`<li>${x}</li>`).join("")}</ul>
        ${cur===k?`<button class="btn" disabled style="width:100%;justify-content:center">Plani aktual</button>`
          :k==="free"?`<button class="btn" data-plan-cancel style="width:100%;justify-content:center">${u&&u.planCancelled?"Anulohet në skadim":"Kalo në Falas"}</button>`
          :`<button class="btn primary" data-plan="${k}" style="width:100%;justify-content:center">Zgjidh ${p.name}</button>`}
      </div>`).join("")}
    </div>
    ${u&&cur!=="free"&&u.planExpiresAt?`<p style="font-size:12px;color:var(--ink-faint);margin-top:14px">Plani juaj ${PLANS[cur].name} ${u.planCancelled?"përfundon":"rinovohet automatikisht"} më ${new Date(u.planExpiresAt).toLocaleDateString("sq-AL")}. ${u.planCancelled?"":"Mund ta anuloni kurdo — mbetet aktiv deri në skadim."}</p>`:""}
    <p style="font-size:12px;color:var(--ink-faint)">Pagesa bëhet nga <a href="#/balance" style="color:var(--accent);font-weight:600">bilanci juaj</a> (PayPal, kriptomonedhë). Nëse bilanci nuk mjafton në rinovim, plani kthehet automatikisht në Falas — shpalljet ekzistuese nuk fshihen.</p>
  </div></div>`;
  $$("[data-plan]",v).forEach(b=>b.addEventListener("click",async()=>{
    if(!u){authModal("login");return;}
    const k=b.dataset.plan;
    if(!confirm(`Të aktivizohet plani ${PLANS[k].name} për ${fmt(PLANS[k].price)} L/muaj nga bilanci juaj?`))return;
    try{
      if(Remote.enabled){
        const j=await apiCall("/api/plan","POST",{plan:k}); Remote.user=j.user;
      } else {
        if(balanceOf(currentUser())<PLANS[k].price){toast(`Bilanci nuk mjafton (${fmt(PLANS[k].price)} L nevojiten). Rimbusheni te Bilanci.`);return;}
        localCredit(u.email,-PLANS[k].price,"subscription",`Plani ${PLANS[k].name} · 30 ditë`);
        mutateLocalUser(x=>{x.plan=k;x.planExpiresAt=Date.now()+30*86400000;x.planCancelled=false;});
      }
      toast(`Plani ${PLANS[k].name} u aktivizua`); renderHeader(); viewPlans();
    }catch(err){toast(err.message);}
  }));
  const pc=$("[data-plan-cancel]",v);
  if(pc)pc.addEventListener("click",async()=>{
    if(!u||cur==="free")return;
    if(!confirm("Plani mbetet aktiv deri në skadim dhe pastaj kalon në Falas. Të vazhdohet?"))return;
    try{
      if(Remote.enabled){const j=await apiCall("/api/plan/cancel","POST",{});Remote.user=j.user;}
      else mutateLocalUser(x=>{x.planCancelled=true;});
      toast("Rinovimi u anulua"); viewPlans();
    }catch(err){toast(err.message);}
  });
  attachFooter($(".myprops .inner",v));
}

/* ---------- balance & top-up ---------- */
function viewBalance(){
  const u=currentUser(); const v=$("#view");
  destroyMap();
  if(!u){v.innerHTML=`<div class="myprops"><div class="inner"><p class="empty">Hyni për të menaxhuar bilancin tuaj.</p></div></div>`;return;}
  const paypalLive=Remote.enabled&&Remote.payments.provider==="paypal";
  const cryptoLive=Remote.enabled&&!!Remote.payments.crypto;
  const tx=(u.transactions||[]);
  v.innerHTML=`<div class="myprops"><div class="inner" style="max-width:640px">
    <h1 style="font-size:20px;margin:0 0 4px">Bilanci</h1>
    <p style="font-size:13px;color:var(--ink-soft);margin:0 0 18px">Bilanci juaj paguan promovimin ditor të shpalljeve. Rimbusheni, vendosni një ofertë në një shpallje dhe ajo renditet më lart në kategorinë e saj.</p>
    <div class="panel-box" style="margin-bottom:14px;text-align:center">
      <span style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-faint);font-weight:600">Bilanci aktual</span>
      <div class="big-price" id="balNow">€${balanceOf(u).toFixed(2)}</div>
    </div>
    <div class="panel-box" style="margin-bottom:14px">
      <b style="font-size:13.5px">Rimbush</b>
      <div style="display:flex;gap:10px;margin:12px 0;align-items:center">
        <div class="promo-input" style="justify-content:flex-start"><input id="topupAmt" type="number" min="1" max="10000" step="1" value="10" aria-label="Shuma e rimbushjes në euro"><b>€</b></div>
        <div class="choice-row">${[5,10,25,50].map(a=>`<button type="button" class="choice" data-amt="${a}">€${a}</button>`).join("")}</div>
      </div>
      <div id="payArea">
        ${paypalLive?`<div id="ppButtons"></div><p class="form-note">Pagesat përpunohen nga PayPal (${esc(Remote.payments.env)}) — pagesa kapet dhe verifikohet në server para se bilanci juaj të kreditohet.</p>`:""}
        ${cryptoLive?`<div class="crypto-box">
            <div class="crypto-coins" aria-hidden="true"><span class="coin">₿ BTC</span><span class="coin">Ξ ETH</span><span class="coin">₮ USDT</span><span class="coin">◎ SOL</span></div>
            <button class="btn" id="cryptoPay" style="width:100%;justify-content:center">Paguaj me kriptomonedhë</button>
            <div id="cryptoStatus" class="form-note" style="display:none"></div>
            <p class="form-note">Hapet arka e sigurt e Coinbase Commerce — zgjidhni monedhën (BTC, ETH, USDT, SOL), paguani nga çdo portofol, pastaj kthehuni këtu dhe klikoni "Kontrollo pagesën". Bilanci kreditohet vetëm pasi pagesa konfirmohet në zinxhir.</p>
          </div>`:""}
        ${!paypalLive&&!cryptoLive?`<button class="btn primary" id="demoTopup" style="width:100%;justify-content:center">Shto fonde (pagesë demo)</button>
           <p class="form-note">Modalitet demo — nuk lëvizin para reale. Kur faqja punon me çelësat tuaj API (PAYPAL_CLIENT_ID / PAYPAL_SECRET për PayPal, COINBASE_COMMERCE_API_KEY për kripto: BTC, ETH, USDT, SOL), këtu shfaqen metodat reale të pagesës automatikisht.</p>`:""}
      </div>
      <p class="err" id="payErr" style="display:none;font-size:12px;color:var(--accent);margin:8px 0 0"></p>
    </div>
    <div class="panel-box">
      <b style="font-size:13.5px">Historiku</b>
      ${tx.length?`<div style="margin-top:10px">${tx.map(t=>`
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:7px 0;border-bottom:1px solid var(--line-soft)">
          <span style="color:var(--ink-soft)">${esc(t.note||t.type)}</span>
          <span style="font-variant-numeric:tabular-nums;font-weight:650;color:${t.amount<0?"var(--ink)":"var(--ok)"}">${t.amount<0?"−":"+"}€${Math.abs(t.amount).toFixed(2)}</span>
        </div>`).join("")}</div>`
      :`<p style="font-size:12.5px;color:var(--ink-faint);margin:8px 0 0">Ende pa transaksione.</p>`}
    </div>
  </div></div>`;
  $$(".choice[data-amt]",v).forEach(b=>b.addEventListener("click",()=>{$("#topupAmt").value=b.dataset.amt;}));
  const amt=()=>Math.max(1,Math.round(+$("#topupAmt").value||0));
  const fail=m=>{const e=$("#payErr");e.textContent=m;e.style.display="block";};
  const done=()=>{toast("Bilanci u rimbush");renderHeader();viewBalance();};

  if(paypalLive){
    const mount=()=>{
      window.paypal.Buttons({
        style:{layout:"horizontal",color:"gold",tagline:false,height:44},
        createOrder:async()=>{const j=await apiCall("/api/pay/create-order","POST",{amount:amt()});return j.orderId;},
        onApprove:async data=>{
          try{const j=await apiCall("/api/pay/capture","POST",{orderId:data.orderID});Remote.user=j.user;done();}
          catch(err){fail(err.message);}
        },
        onError:()=>fail("PayPal nuk mundi ta përfundojë pagesën — provoni përsëri."),
      }).render("#ppButtons");
    };
    if(window.paypal) mount();
    else{
      const s=document.createElement("script");
      s.src=`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(Remote.payments.clientId)}&currency=EUR`;
      s.onload=mount; s.onerror=()=>fail("Nuk u ngarkua PayPal — kontrolloni lidhjen dhe rifreskoni.");
      document.head.appendChild(s);
    }
  }
  if(cryptoLive){
    let pendingCode=null;
    const st=$("#cryptoStatus"), btn=$("#cryptoPay");
    const setSt=m=>{st.style.display="block";st.textContent=m;};
    btn.addEventListener("click",async()=>{
      try{
        if(!pendingCode){
          const j=await apiCall("/api/pay/crypto/create","POST",{amount:amt()});
          pendingCode=j.code;
          window.open(j.url,"_blank","noopener");
          btn.textContent="Kontrollo pagesën";
          setSt("Arka e Coinbase Commerce u hap në një dritare të re. Pasi të paguani, klikoni \"Kontrollo pagesën\".");
        } else {
          const j=await apiCall("/api/pay/crypto/check","POST",{code:pendingCode});
          if(j.status==="credited"){Remote.user=j.user;pendingCode=null;done();}
          else setSt("Pagesa ende s'është konfirmuar në zinxhir (statusi: "+j.status+"). Provoni përsëri pas ~1 minute.");
        }
      }catch(err){fail(err.message);}
    });
  }
  const demoBtn=$("#demoTopup");
  if(demoBtn){
    demoBtn.addEventListener("click",async()=>{
      try{
        if(Remote.enabled){const j=await apiCall("/api/pay/demo-topup","POST",{amount:amt()});Remote.user=j.user;}
        else localCredit(u.email,amt(),"topup","Rimbushje demo (pa pagesë reale)");
        done();
      }catch(err){fail(err.message);}
    });
  }
}

/* ---------- my properties ---------- */
function viewMy(){
  const u=currentUser(); const v=$("#view");
  destroyMap();
  if(!u){v.innerHTML=`<div class="myprops"><div class="inner"><p class="empty">Hyni për të parë shpalljet tuaja.</p></div></div>`;return;}
  const mine=(Remote.enabled?Remote.listings:Store.userListings()).filter(l=>l.owner===u.email).sort((a,b)=>b.createdAt-a.createdAt);
  const plan=planOf(u);
  v.innerHTML=`<div class="myprops"><div class="inner">
    <h1 style="font-size:20px;margin:0 0 4px">Pronat e mia</h1>
    <p style="font-size:13px;color:var(--ink-soft);margin:0 0 6px">${mine.length?`${mine.length} shpallje · keni hyrë si ${esc(u.email)}`:"Nuk keni shtuar ende asnjë pronë."}</p>
    <p style="font-size:12.5px;margin:0 0 18px">Plani: <b>${PLANS[plan].name}</b> · ${mine.filter(l=>l.status==="published").length}/${PLANS[plan].listings} shpallje aktive · <a href="#/plans" style="color:var(--accent);font-weight:600">${plan==="free"?"përmirëso planin":"menaxho planin"}</a></p>
    <div id="rows"></div>
    <button class="btn primary" data-go="#/add">+ Shto pronë</button>
  </div></div>`;
  const rows=$("#rows");
  mine.forEach(l=>{
    const s=l.stats||{v:0,p:0,w:0};
    const row=document.createElement("div"); row.className="prop-row";
    row.innerHTML=`<img src="${l.photos[0]||svgThumb(3)}" alt="">
      <div class="info"><b>${esc(l.title)}</b>
        <span>${CITIES[l.city].name} · ${DEALS[l.dealType]} · €${fmt(l.price)}${l.dealType==="rent"?"/muaj":l.dealType==="daily"?"/natë":""} ${l.status==="draft"?'· <span class="tag draft">DRAFT</span>':""} ${(l.promoBid||0)>0?`· <span class="tag promo">Promovuar €${l.promoBid}/ditë</span>`:""}</span>
        <span class="lead-stats" title="Shikime · Telefonata të shfaqura · Klikime WhatsApp">👁 ${fmt(s.v||0)} · 📞 ${fmt(s.p||0)} · 💬 ${fmt(s.w||0)}
          ${plan!=="free"?`<button class="stats-toggle" type="button" data-stats="${l.id}">statistika ↓</button>`:`<a href="#/plans" class="stats-teaser">statistika ditore me Pro →</a>`}</span>
        <span class="stats-panel" id="stats-${esc(l.id)}" hidden></span></div>
      <div class="actions">
        ${l.status==="draft"?`<button class="btn" data-a="publish">Publiko</button>`:`<button class="btn" data-a="view">Shiko</button>`}
        <button class="btn" data-a="edit">Ndrysho</button>
        <button class="btn ghost" data-a="del">Fshi</button></div>`;
    row.querySelector('[data-a="edit"]').addEventListener("click",()=>location.hash="#/add?edit="+l.id);
    const del=row.querySelector('[data-a="del"]');
    del.addEventListener("click",async()=>{
      if(!confirm("Ta fshini këtë shpallje përgjithmonë?"))return;
      try{
        if(Remote.enabled){await apiCall("/api/listings/"+l.id,"DELETE");Remote.listings=Remote.listings.filter(x=>x.id!==l.id);}
        else Store.saveUserListings(Store.userListings().filter(x=>x.id!==l.id));
        viewMy(); toast("Shpallja u fshi");
      }catch(err){toast(err.message||"Nuk u fshi dot");}
    });
    const vb=row.querySelector('[data-a="view"]'); if(vb)vb.addEventListener("click",()=>location.hash="#/property/"+l.id);
    const pb=row.querySelector('[data-a="publish"]'); if(pb)pb.addEventListener("click",async()=>{
      try{
        if(Remote.enabled){
          const j=await apiCall("/api/listings/"+l.id,"PUT",{...l,status:"published"});
          const i=Remote.listings.findIndex(x=>x.id===l.id); Remote.listings[i]=j.listing;
        } else {
          const all=Store.userListings(); const i=all.findIndex(x=>x.id===l.id); all[i].status="published";
          Store.saveUserListings(all);
        }
        viewMy(); toast("Shpallja u publikua");
      }catch(err){toast(err.message||"Nuk u publikua dot");}
    });
    const st=row.querySelector("[data-stats]");
    if(st)st.addEventListener("click",()=>{
      const panel=row.querySelector(".stats-panel");
      if(!panel.hidden){panel.hidden=true;st.textContent="statistika ↓";return;}
      const daily=l.statsDaily||{};
      const days=[...Array(14)].map((_,i)=>{
        const d=new Date(Date.now()-(13-i)*86400000).toISOString().slice(0,10);
        return {d,...(daily[d]||{v:0,p:0,w:0})};
      });
      const max=Math.max(1,...days.map(x=>x.v));
      panel.innerHTML=`<span class="stats-bars">${days.map(x=>
        `<i title="${x.d}: ${x.v} shikime, ${x.p} tel, ${x.w} WA"><b style="height:${Math.round(x.v/max*34)+2}px"></b><u>${x.d.slice(8)}</u></i>`).join("")}</span>
        <span class="stats-note">Shikime në 14 ditët e fundit · gjithsej: ${fmt((l.stats||{}).v||0)} shikime, ${fmt((l.stats||{}).p||0)} telefonata, ${fmt((l.stats||{}).w||0)} WhatsApp</span>`;
      panel.hidden=false; st.textContent="statistika ↑";
    });
    rows.appendChild(row);
  });
  $$("[data-go]",v).forEach(b=>b.addEventListener("click",()=>location.hash=b.dataset.go));
  attachFooter($(".myprops .inner",v));
}

/* ---------- static pages (terms & privacy) ---------- */
function viewStatic(kind){
  destroyMap();
  const v=$("#view");
  if(kind==="about"){
    v.innerHTML=`<div class="static-page"><div class="inner">
      <h1>Rreth Nesh</h1>
      <p><b>Prona</b> është portali i pronave të paluajtshme për të gjithë Shqipërinë — nga Tirana dhe Durrësi deri në Vlorë, Shkodër e Sarandë.</p>
      <p>Misioni ynë është i thjeshtë: t'i bëjmë blerjen, shitjen dhe qiradhënien e pronave transparente dhe të lehta. Çdo shpallje shfaqet në hartë reale me vendndodhje të saktë, që blerësit të dinë gjithmonë se çfarë dhe ku po shohin.</p>
      <h2>Çfarë ofrojmë</h2>
      <ul>
        <li><b>Hartë reale të Shqipërisë</b> — me pamje rrugësh dhe satelitore, ndërtesa reale dhe numra shtëpish nga OpenStreetMap.</li>
        <li><b>Publikim falas</b> — pronarët, agjentët dhe agjencitë publikojnë shpallje pa pagesë.</li>
        <li><b>Promovim me ofertë ditore</b> — kush dëshiron më shumë dukshmëri, vendos një ofertë ditore dhe renditet më lart në kategorinë e vet.</li>
        <li><b>Kontakt i drejtpërdrejtë</b> — blerësit kontaktojnë direkt me pronarin ose agjentin, me telefon ose WhatsApp.</li>
      </ul>
      <h2>Për agjentët dhe agjencitë</h2>
      <p>Krijoni një llogari si agjent ose agjenci dhe menaxhoni të gjitha shpalljet tuaja nga një vend i vetëm — me statistika bilanci dhe promovim fleksibël sipas buxhetit tuaj.</p>
    </div></div>`;
    attachFooter($(".static-page .inner",v));
    return;
  }
  if(kind==="contact"){
    v.innerHTML=`<div class="static-page"><div class="inner">
      <h1>Na Kontaktoni</h1>
      <p>Keni pyetje për një shpallje, llogarinë tuaj apo bashkëpunim? Na shkruani — përgjigjemi brenda një dite pune.</p>
      <div class="panel-box" style="margin:16px 0">
        <div class="spec-list">
          <div><span>Email</span><b><a href="mailto:info@prona.al" style="color:var(--accent)">info@prona.al</a></b></div>
          <div><span>Telefon</span><b>+355 4 000 0000</b></div>
          <div><span>Adresa</span><b>Tiranë, Shqipëri</b></div>
          <div><span>Orari</span><b>Hën–Pre, 09:00–18:00</b></div>
        </div>
      </div>
      <div class="fsection"><h2 style="font-size:14.5px;font-weight:700;margin:0 0 14px">Dërgoni një mesazh</h2>
        <div class="grid2">
          <div class="frow"><label for="c-name">Emri juaj</label><input id="c-name" type="text"></div>
          <div class="frow"><label for="c-email">Email</label><input id="c-email" type="email"></div>
        </div>
        <div class="frow"><label for="c-msg">Mesazhi</label><textarea id="c-msg" rows="5" placeholder="Shkruani mesazhin tuaj këtu…"></textarea></div>
        <button class="btn primary" id="c-send" type="button">Dërgo mesazhin</button>
        <p class="form-note">Butoni hap programin tuaj të email-it me mesazhin të plotësuar — zëvendësoni adresën info@prona.al me email-in tuaj real para publikimit.</p>
      </div>
    </div></div>`;
    $("#c-send").addEventListener("click",()=>{
      const body=encodeURIComponent(($("#c-msg").value||"")+"\n\n— "+($("#c-name").value||"")+" ("+($("#c-email").value||"")+")");
      location.href="mailto:info@prona.al?subject="+encodeURIComponent("Mesazh nga faqja Prona")+"&body="+body;
    });
    attachFooter($(".static-page .inner",v));
    return;
  }
  const terms=kind==="terms";
  v.innerHTML=`<div class="static-page"><div class="inner">
    <h1>${terms?"Kushtet e përdorimit":"Politika e privatësisë"}</h1>
    ${terms?`
    <p>Duke përdorur Prona, ju pranoni këto kushte. Ky tekst është një shabllon fillestar — para publikimit zyrtar, rishikojeni me një këshilltar ligjor.</p>
    <h2>1. Shpalljet</h2>
    <p>Përdoruesit mund të publikojnë shpallje vetëm për prona që kanë të drejtë t'i reklamojnë. Shpalljet duhet të përmbajnë të dhëna të vërteta për çmimin, sipërfaqen dhe vendndodhjen.</p>
    <h2>2. Llogaritë</h2>
    <p>Ju përgjigjeni për ruajtjen e fjalëkalimit tuaj dhe për veprimtarinë në llogarinë tuaj. Prona mund të pezullojë llogari që shkelin këto kushte.</p>
    <h2>3. Promovimi dhe pagesat</h2>
    <p>Promovimi i shpalljeve tarifohet nga bilanci juaj sipas ofertës ditore që keni zgjedhur. Tarifimi ndalon automatikisht kur bilanci mbaron. Rimbushjet përpunohen nga PayPal.</p>
    <h2>4. Përgjegjësia</h2>
    <p>Prona është platformë ndërmjetësimi dhe nuk është palë në transaksionet mes blerësve dhe shitësve. Verifikoni gjithmonë pronën dhe dokumentacionin para çdo pagese.</p>`
    :`
    <p>Ky tekst është një shabllon fillestar — para publikimit zyrtar, rishikojeni me një këshilltar ligjor dhe përshtateni me legjislacionin shqiptar për mbrojtjen e të dhënave.</p>
    <h2>Çfarë të dhënash mbledhim</h2>
    <p>Emrin, adresën e email-it dhe numrin e telefonit që jepni kur krijoni llogari ose publikoni shpallje, si dhe të dhënat e shpalljeve tuaja (adresa, fotot, çmimi).</p>
    <h2>Si i përdorim</h2>
    <p>Për të shfaqur shpalljet tuaja, për t'ju mundësuar hyrjen në llogari dhe për të përpunuar rimbushjet e bilancit. Nuk i shesim të dhënat tuaja palëve të treta.</p>
    <h2>Pagesat</h2>
    <p>Pagesat përpunohen nga PayPal; ne nuk ruajmë të dhëna kartash. Shërbimet e hartës (OpenStreetMap, Esri) marrin kërkesat e nevojshme teknike për të shfaqur hartën.</p>
    <h2>Të drejtat tuaja</h2>
    <p>Mund të kërkoni në çdo kohë fshirjen e llogarisë dhe të të dhënave tuaja duke na kontaktuar.</p>`}
  </div></div>`;
  attachFooter($(".static-page .inner",v));
}

/* ================= router ================= */
function render(){
  document.body.classList.remove("map-view");
  const h=location.hash;
  if(h.startsWith("#/property/")) viewDetail(h.slice(11));
  else if(h.startsWith("#/add")){ const m=h.match(/edit=([^&]+)/); viewAdd(m?decodeURIComponent(m[1]):undefined); }
  else if(h.startsWith("#/my")) viewMy();
  else if(h.startsWith("#/favorites")) viewFavorites();
  else if(h.startsWith("#/searches")) viewSearches();
  else if(h.startsWith("#/admin")) viewAdmin();
  else if(h.startsWith("#/balance")) viewBalance();
  else if(h.startsWith("#/plans")) viewPlans();
  else if(h.startsWith("#/terms")) viewStatic("terms");
  else if(h.startsWith("#/privacy")) viewStatic("privacy");
  else if(h.startsWith("#/about")) viewStatic("about");
  else if(h.startsWith("#/contact")) viewStatic("contact");
  else viewListing();
  renderHeader();
}
window.addEventListener("hashchange",render);
renderHeader();
initRemote().finally(render);
