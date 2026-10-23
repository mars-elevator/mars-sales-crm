/* MARS CRM v89 incremental cloud sync (non-destructive bootstrap).
   Requires existing Supabase Auth and owner-scoped RLS.
   Does not sync file blobs, photos over 200 KiB, deletes or conflicts.
*/
(function(){
'use strict';
const targets=[
 ['companies','mars_crm_companies'],
 ['fairs','mars_crm_fairs_v1'],
 ['fair_cards','mars_crm_fair_cards_v1'],
 ['trip_plans','mars_crm_trip_plans']
];
let running=false;
const parse=k=>{try{const x=JSON.parse(localStorage.getItem(k)||'[]');return Array.isArray(x)?x:[]}catch{return []}};
async function request(session,method,path,data){
 const headers=cloudHeaders(session.access_token,{'Content-Type':'application/json'});
 const opts={method,headers};if(data!==undefined)opts.body=JSON.stringify(data);
 return cloudFetch('/rest/v1/'+path,opts);
}
async function sync(){
 if(running||!window.marsSecurityUnlocked)return;
 const session=await ensureCloudSession();if(!session?.user?.id)return;
 running=true;
 let up=0,down=0,conflict=0,large=0;
 try{
 for(const [kind,key] of targets){
   const local=parse(key), byId=new Map(local.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
   const cloud=await request(session,'GET','mars_crm_sync_records?select=record_id,payload&kind=eq.'+encodeURIComponent(kind)+'&owner_id=eq.'+encodeURIComponent(session.user.id)+'&is_deleted=eq.false&limit=1000');
   const remoteIds=new Set();let changed=false;
   for(const row of (cloud||[])){
     const id=String(row.record_id), payload=row.payload;
     remoteIds.add(id);
     if(!byId.has(id)&&payload&&typeof payload==='object'){local.push(payload);byId.set(id,payload);down++;changed=true;}
     else if(byId.has(id)&&JSON.stringify(byId.get(id))!==JSON.stringify(payload)){conflict++;}
   }
   // Persist received records. Never replace existing local records.
   if(changed){try{localStorage.setItem(key,JSON.stringify(local))}catch(e){console.warn('Depolama dolu, kayıt aktarılmadı',key,e);throw e;}}
   for(const x of local){
     if(!x||x.id==null||remoteIds.has(String(x.id)))continue;
     const raw=JSON.stringify(x);
     if(raw.length>200000){large++;continue;}
     try{await request(session,'POST','mars_crm_sync_records',{
       owner_id:session.user.id,kind,record_id:String(x.id),payload:x,is_deleted:false
     });up++;remoteIds.add(String(x.id));}
     catch(e){ // unique violation means another device uploaded concurrently; never overwrite
       if(String(e?.message||'').includes('duplicate')||e?.status===409){conflict++;continue;}throw e;
     }
   }
 }
 if(down){try{if(typeof window.render==='function')window.render();if(typeof window.mars84RenderFairs==='function')window.mars84RenderFairs();if(typeof window.mars84RenderCards==='function')window.mars84RenderCards();}catch(e){console.warn(e)}}
 const status=document.getElementById('mars85SyncStatus');
 if(status){status.hidden=false;status.textContent='Ek kayıt eşitleme: '+up+' gönderildi, '+down+' alındı'+(conflict?' · '+conflict+' farklı kayıt korunuyor':'')+(large?' · '+large+' büyük kayıt aktarılmadı':'');}
 }catch(e){console.warn('v89 senkronizasyon hatası:',e);const status=document.getElementById('mars85SyncStatus');if(status){status.hidden=false;status.textContent='Ek veri eşitleme hatası: '+e.message;}}
 finally{running=false;}
}
window.mars89SyncExtra=sync;
setInterval(sync,25000);
window.addEventListener('online',sync);
setTimeout(sync,4000);
})();
