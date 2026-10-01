// A small stand-in for the Supabase endpoints QB Brain uses (auth + players + player_data + delete_my_account),
// with the same ownership rules as supabase/schema.sql. Used only by the automated tests.
const http=require('http'), crypto=require('crypto');
function start(port){
  const db={users:[], tokens:{}, refresh:{}, players:[], data:[]};
  const id=()=>crypto.randomUUID(), now=()=>Math.floor(Date.now()/1000);
  const issue=u=>{ const at='at_'+id(), rt='rt_'+id(); db.tokens[at]=u.id; db.refresh[rt]=u.id;
    return {access_token:at, token_type:'bearer', expires_in:3600, expires_at:now()+3600, refresh_token:rt, user:{id:u.id,email:u.email}}; };
  const srv=http.createServer((req,res)=>{
    const send=(code,body,extra)=>{ res.writeHead(code,Object.assign({'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,authorization,content-type,prefer','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'},extra||{})); res.end(body===undefined?'':JSON.stringify(body)); };
    if(req.method==='OPTIONS') return send(204);
    let raw=''; req.on('data',d=>raw+=d); req.on('end',()=>{
      const u=new URL(req.url,'http://x'), body=raw?JSON.parse(raw):null, p=u.pathname;
      if(p==='/__test/state') return send(200,{users:db.users.length,players:db.players,data:db.data.map(d=>({player_id:d.player_id,kind:d.kind,upd:d.upd}))});
      if(p==='/__test/expire'){ db.tokens={}; return send(200,{ok:true}); }
      if(req.headers.apikey!=='test-anon') return send(401,{message:'No API key found in request'});
      const bearer=(req.headers.authorization||'').replace(/^Bearer /,''), uid=db.tokens[bearer];
      // ---- auth
      if(p==='/auth/v1/signup'){ if(db.users.some(x=>x.email===body.email)) return send(422,{code:422,msg:'User already registered'});
        if(!body.password || body.password.length<8) return send(422,{code:422,msg:'Password should be at least 8 characters.'});
        const usr={id:id(),email:body.email,pw:body.password}; db.users.push(usr); return send(200,issue(usr)); }
      if(p==='/auth/v1/token'){
        if(u.searchParams.get('grant_type')==='password'){ const usr=db.users.find(x=>x.email===body.email&&x.pw===body.password); return usr?send(200,issue(usr)):send(400,{error:'invalid_grant',error_description:'Invalid login credentials'}); }
        const owner=db.refresh[body.refresh_token]; if(!owner) return send(400,{error:'invalid_grant',error_description:'Invalid Refresh Token'});
        delete db.refresh[body.refresh_token]; return send(200,issue(db.users.find(x=>x.id===owner))); }
      if(p==='/auth/v1/recover') return send(200,{});
      if(p==='/auth/v1/logout'){ delete db.tokens[bearer]; return send(204); }
      if(!uid) return send(401,{code:'PGRST301',message:'JWT expired'});
      const mine=pid=>db.players.some(x=>x.id===pid&&x.parent_id===uid);
      const eq=k=>{ const v=u.searchParams.get(k); return v&&v.startsWith('eq.')?v.slice(3):null; };
      // ---- rest
      if(p==='/rest/v1/players'){
        if(req.method==='GET') return send(200,db.players.filter(x=>x.parent_id===uid).map(({parent_id,...r})=>r));
        if(req.method==='POST'){ if(db.players.filter(x=>x.parent_id===uid).length>=8) return send(400,{message:'An account can have up to 8 players.'});
          const row={id:id(),parent_id:uid,nickname:body.nickname,band:body.band||null,created_at:new Date().toISOString()}; db.players.push(row); const {parent_id,...out}=row; return send(201,[out]); }
        const pid=eq('id'); if(!pid||!mine(pid)) return send(200,[]);
        if(req.method==='PATCH'){ Object.assign(db.players.find(x=>x.id===pid),{nickname:body.nickname,band:body.band}); return send(204); }
        if(req.method==='DELETE'){ db.players=db.players.filter(x=>x.id!==pid); db.data=db.data.filter(d=>d.player_id!==pid); return send(204); }
      }
      if(p==='/rest/v1/player_data'){
        if(req.method==='GET'){ const pid=eq('player_id'); return send(200,db.data.filter(d=>d.player_id===pid&&mine(pid)).map(d=>({kind:d.kind,data:d.data,upd:d.upd}))); }
        if(req.method==='POST'){ for(const r of [].concat(body)){ if(!mine(r.player_id)) return send(403,{message:'new row violates row-level security policy'}); }
          [].concat(body).forEach(r=>{ const i=db.data.findIndex(d=>d.player_id===r.player_id&&d.kind===r.kind); if(i>=0) db.data[i]=r; else db.data.push(r); }); return send(201); }
      }
      if(p==='/rest/v1/rpc/delete_my_account'){ const pids=db.players.filter(x=>x.parent_id===uid).map(x=>x.id);
        db.players=db.players.filter(x=>x.parent_id!==uid); db.data=db.data.filter(d=>!pids.includes(d.player_id)); db.users=db.users.filter(x=>x.id!==uid); return send(204); }
      send(404,{message:'not found: '+req.method+' '+p});
    });
  });
  return new Promise(r=>srv.listen(port,()=>r(srv)));
}
module.exports={start};
if(require.main===module) start(+(process.argv[2]||8790)).then(()=>console.log('mock cloud on',process.argv[2]||8790));
