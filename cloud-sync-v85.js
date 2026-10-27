/* MARS CRM v85 - authenticated cross-device sync, no private keys or user data in published code */
(function(){
 'use strict';
 const sets=[
  {kind:'fair',key:'mars_crm_fairs_v1'},
  {kind:'card',key:'mars_crm_fair_cards_v1'},
  {kind:'expense',key:'mars_crm_local_expenses_v2'}
 ];
 const state={busy:false,ready:false,lastError:'',lastOK:null};
 const nativeSet=Storage.prototype.setItem;
 Storage.prototype.setItem=function(key,value){
   if(this===localStorage && sets.some(c=>c.key===key)){
     try{
       const prev=JSON.parse(this.getItem(key)||'[]');
       const next=JSON.parse(value);
       if(Array.isArray(prev)&&Array.isArray(next)){
         const old=new Map(prev.filter(r=>r?.id).map(r=>[String(r.id),r]));
         const stamped=next.map(r=>{if(!r?.id)return r;const earlier=old.get(String(r.id));
           if(earlier && JSON.stringify({...earlier,updatedAt:undefined})!==JSON.stringify({...r,updatedAt:undefined}))return {...r,updatedAt:new Date().toISOString()};
           return r;});
         value=JSON.stringify(stamped);
       }
     }catch(e){}
   }
   return nativeSet.call(this,key,value);
 };
 const el=()=>document.getElementById('mars85SyncStatus');
 function status(msg,fail=false){const e=el();if(!e)return;e.hidden=false;e.textContent=msg;e.style.color=fail?'#9a3412':'#285348';clearTimeout(status.timer);status.timer=setTimeout(()=>{if(!fail)e.hidden=true},6500)}
 function local(key){try{const x=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(x)?x:[]}catch{return []}}
 function write(key,rows){nativeSet.call(localStorage,key,JSON.stringify(rows))}
 const enc=encodeURIComponent;
 async function session(){if(!window.marsSecurityUnlocked||!window.marsCloudUser)return null;return typeof ensureCloudSession==='function'?await ensureCloudSession():null}
 function hdr(s,extra={}){return cloudHeaders(s.access_token,{...extra})}
 async function getRemote(s,kind){
  const url='/rest/v1/mars_crm_sync_records?select=record_id,payload,updated_at,is_deleted&kind=eq.'+enc(kind)+'&owner_id=eq.'+enc(s.user.id)+'&limit=5000';
  const a=await cloudFetch(url,{headers:hdr(s)});return Array.isArray(a)?a:[];
 }
 async function putRemote(s,kind,records){
  if(!records.length)return;
  const batch=records.map(r=>({owner_id:s.user.id,kind,record_id:String(r.id),payload:r.payload||{},is_deleted:!!r.is_deleted,updated_at:new Date().toISOString()}));
  for(let i=0;i<batch.length;i+=35){
    await cloudFetch('/rest/v1/mars_crm_sync_records?on_conflict=owner_id,kind,record_id',{
      method:'POST',headers:hdr(s,{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify(batch.slice(i,i+35))
    });
  }
 }
 function rowStamp(row){return Date.parse(row?.updatedAt||row?.createdAt||row?.savedAt||'')||0}
 async function syncKind(s,kind,key){
  const remote=await getRemote(s,kind);
  const map=new Map(remote.map(r=>[r.record_id,r]));
  const orig=local(key);
  const localMap=new Map(orig.filter(x=>x?.id).map(x=>[String(x.id),x]));
  const tombKey='mars_v85_known_'+kind;
  const known=JSON.parse(localStorage.getItem(tombKey)||'[]');
  // Mark explicitly removed records that this device previously saw; never delete a record simply because it's absent on a fresh device.
  const deleted=new Set(known.filter(id=>!localMap.has(id)));
  const changes=[];
  async function cardPayload(item){
    if(kind!=='card'||!String(item.photo||'').startsWith('data:'))return item;
    const filekey='cardphoto|'+item.id;
    const blob=await (await fetch(item.photo)).blob();
    if(blob.size>24*1024*1024)throw Error('Kartvizit fotoğrafı çok büyük.');
    await uploadBlob(s,filekey,blob);
    const copy={...item,photo:'',photoCloudKey:filekey};
    return copy;
  }
  async function restored(payload){
    if(kind!=='card'||!payload?.photoCloudKey||payload?.photo)return payload;
    try{const blob=await downloadBlob(s,payload.photoCloudKey);
      const photo=await new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>bad(r.error);r.readAsDataURL(blob)});return {...payload,photo};
    }catch(e){console.warn('Kartvizit görseli okunamadı',e);return payload}
  }
  for(const id of deleted){const r=map.get(id);if(!r||!r.is_deleted)changes.push({id,is_deleted:true});}
  for(const [id,item] of localMap){
    const r=map.get(id);
    if(r?.is_deleted){localMap.delete(id);continue;}
    if(!r){changes.push({id,payload:await cardPayload(item)});continue;}
    const remoteTime=Date.parse(r.updated_at)||0;
    const localTime=rowStamp(item);
    if(localTime&&localTime>remoteTime+1000) changes.push({id,payload:await cardPayload(item)});
    else localMap.set(id,{...item,...(await restored(r.payload))});
  }
  for(const r of remote){if(r.is_deleted||deleted.has(r.record_id)){localMap.delete(r.record_id);continue;}if(!localMap.has(r.record_id))localMap.set(r.record_id,await restored(r.payload))}
  await putRemote(s,kind,changes);
  write(key,[...localMap.values()]);
  localStorage.setItem(tombKey,JSON.stringify([...localMap.keys()]));
 }
 async function openDB(dbname,storename){
  return new Promise((resolve,reject)=>{let req=indexedDB.open(dbname,1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(storename))req.result.createObjectStore(storename,{keyPath:'key'})}});
 }
 async function dbRows(dbname,storename){
  const db=await openDB(dbname,storename);
  return new Promise((resolve,reject)=>{const t=db.transaction(storename,'readonly'),r=t.objectStore(storename).getAll();r.onsuccess=()=>{db.close();resolve(r.result||[])};r.onerror=()=>{db.close();reject(r.error)}});
 }
 async function dbPut(dbname,storename,item){
  const db=await openDB(dbname,storename);
  return new Promise((resolve,reject)=>{const t=db.transaction(storename,'readwrite');t.objectStore(storename).put(item);t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)}});
 }
 async function dbGet(dbname,storename,key){
  const db=await openDB(dbname,storename);
  return new Promise((resolve,reject)=>{const t=db.transaction(storename,'readonly'),r=t.objectStore(storename).get(key);r.onsuccess=()=>{db.close();resolve(r.result||null)};r.onerror=()=>{db.close();reject(r.error)}});
 }
 function storagePath(owner,key){return owner+'/files/'+encodeURIComponent(key)}
 async function uploadBlob(s,key,blob){
  const path=storagePath(s.user.id,key);
  const res=await fetch(marsSupabaseUrl()+'/storage/v1/object/mars-crm-private/'+path,{
    method:'POST',headers:hdr(s,{'Content-Type':blob.type||'application/octet-stream','x-upsert':'true'}),body:blob
  });
  if(!res.ok)throw Error('Belge yükleme: '+res.status+' '+(await res.text()).slice(0,180));
  return path;
 }
 async function downloadBlob(s,key){
  const path=storagePath(s.user.id,key);
  const res=await fetch(marsSupabaseUrl()+'/storage/v1/object/authenticated/mars-crm-private/'+path,{headers:hdr(s)});
  if(!res.ok)throw Error('Belge indirme: '+res.status);
  return await res.blob();
 }
 async function syncFiles(s){
  const configs=[{db:'mars_crm_receipts_v1',store:'receipts',kind:'receipt_file'},{db:'mars_crm_trip_archive_db',store:'files',kind:'trip_file'}];
  for(const cfg of configs){
    let rows=await dbRows(cfg.db,cfg.store);
    const remote=await getRemote(s,cfg.kind);
    const map=new Map(remote.filter(x=>!x.is_deleted).map(x=>[x.record_id,x]));
    const localKeys=new Set(rows.map(x=>x.key));
    const uploads=[];
    for(const row of rows){
      if(!row.key||!row.blob||map.has(row.key))continue;
      if(row.blob.size>24*1024*1024){console.warn('Büyük dosya bulut senkron dışında:',row.filename);continue;}
      await uploadBlob(s,row.key,row.blob);
      uploads.push({id:row.key,payload:{filename:row.filename||'',mime:row.mime||row.blob.type||'',savedAt:row.savedAt||''}});
    }
    await putRemote(s,cfg.kind,uploads);
    for(const [key,r] of map){
      if(localKeys.has(key))continue;
      try{
        const blob=await downloadBlob(s,key);
        await dbPut(cfg.db,cfg.store,{key,blob,filename:r.payload?.filename||'Belge',mime:r.payload?.mime||blob.type,savedAt:r.payload?.savedAt||r.updated_at});
      }catch(e){console.warn('Bulut dosya indirme hatası:',key,e)}
    }
  }
 }
 async function sync(){
  if(state.busy)return;
  const s=await session();if(!s)return;
  state.busy=true;status('Bulut eşitleniyor…');
  try{
    // Existing trip archive metadata uses crm_trips. Pull that first, do not create duplicate trip identities.
    if(typeof syncArchiveFromCloud==='function')await syncArchiveFromCloud();
    for(const d of sets)await syncKind(s,d.kind,d.key);
    await syncFiles(s);
    state.ready=true;state.lastError='';state.lastOK=Date.now();status('Telefon ve masaüstü verileri eşitlendi ✓');
    try{window.mars84RenderFairs?.();window.mars84RenderCards?.();window.mars80Refresh?.();window.renderTravelArchive?.()}catch(e){}
  }catch(e){state.lastError=String(e.message||e);console.error('MARS bulut senkron hatası:',e);status('Bulut eşitleme bekliyor: '+state.lastError,true)}
  finally{state.busy=false;}
 }
 window.mars85SyncNow=sync;
 // One Supabase login unlocks reports and receipts. Idle lock remains enabled.
 window.marsSecureAction=function(action){if(!window.marsSecurityUnlocked){window.marsScreenLock?.();return;}return action()};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync().catch(console.warn)});
 window.addEventListener('online',()=>sync().catch(console.warn));
 setInterval(()=>sync().catch(console.warn),25000);
 setTimeout(()=>sync().catch(console.warn),1500);
})();
