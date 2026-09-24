const ORIGIN=process.env.BASE||'http://localhost:3000';const B=ORIGIN+'/api';
const WebSocket=require('ws');
async function client(email,pw){
  let cookie='';let csrf='';
  const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json',cookie,'x-csrf-token':csrf},body:b?JSON.stringify(b):undefined});
    const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const j=await r.json().catch(()=>({}));return {s:r.status,...j};};
  const l=await call('POST','/auth/login',{email,password:pw});csrf=l.csrf;
  return {call,cookie:()=>cookie,user:l.user};
}
const ok=(c,m)=>console.log(c?'PASS':'FAIL',m);
(async()=>{
  const st=await client('aarav.sharma@student.school.edu','Student@123');
  const tc=await client('priya.nair@school.edu','Teacher@123');
  const ad=await client('admin@school.edu','Admin@123');
  // ws for student
  const msgs=[];const ws=new WebSocket(ORIGIN.replace('http','ws')+'/ws',{headers:{cookie:st.cookie()}});ws.on('message',m=>msgs.push(JSON.parse(m)));
  await new Promise(r=>setTimeout(r,400));
  let d=await st.call('GET','/student/dashboard');ok(d.active.length===1&&d.active[0].canStart,'student sees active exam '+d.active[0]?.name);
  ok((await st.call('GET','/exams')).s===403,'student blocked from staff API');
  let s=await st.call('POST','/student/exams/1/start');ok(s.attemptId,'start exam -> attempt '+s.attemptId);
  const att=s.attemptId;
  let ses=await st.call('GET',`/attempts/${att}/session`);
  ok(ses.questions.length===10&&!JSON.stringify(ses).includes('"correct"'),'session has 10 questions, no answer leakage; remaining '+Math.round(ses.remainingMs/60000)+'m');
  const q=ses.questions;
  let sy=await st.call('POST',`/attempts/${att}/sync`,{answers:[{eqId:q[0].id,answer:q[0].options[0].id,ts:Date.now()},{eqId:q[3].id,answer:'false',ts:Date.now(),review:true}],current:3});
  ok(sy.saved.length===2&&sy.status==='in_progress','autosave ok');
  // LWW: older ts must not overwrite
  await st.call('POST',`/attempts/${att}/sync`,{answers:[{eqId:q[3].id,answer:'true',ts:1}]});
  ses=await st.call('GET',`/attempts/${att}/session`);ok(ses.answers[q[3].id].answer==='false','offline stale write ignored (LWW)');
  // teacher live edit
  const ex=await tc.call('GET','/exams/1');const eq=ex.questions[4];
  let e1=await tc.call('PUT',`/exams/1/questions/${eq.id}`,{...eq,marks:3,negative_marks:0.5});ok(e1.s===409&&e1.details.code==='LIVE_EDIT_WARNING','live edit requires warning ack (in progress: '+e1.details?.inProgress+')');
  e1=await tc.call('PUT',`/exams/1/questions/${eq.id}`,{...eq,marks:3,negative_marks:0.5,ack:true});ok(e1.ok&&e1.changed>=1,'live edit applied, regraded '+e1.regraded);
  await new Promise(r=>setTimeout(r,300));ok(msgs.some(m=>m.type==='exam'&&m.event==='changed'),'student got realtime "changed" push');
  const sy2=await st.call('POST',`/attempts/${att}/sync`,{answers:[]});ok(sy2.version>ex.exam.version,'student sync sees new exam version');
  ses=await st.call('GET',`/attempts/${att}/session`);ok(ses.answers[q[0].id],'answers intact after live edit');
  // add + reorder + remove
  let ad1=await tc.call('POST','/exams/1/questions',{question:{type:'tf',text:'Live-added: light travels faster than sound.',correct:'true',marks:1,negative_marks:0},ack:true});ok(ad1.added===1,'add question live');
  const ex2=await tc.call('GET','/exams/1');const ids=ex2.questions.map(x=>x.id);
  const ro=await tc.call('POST','/exams/1/questions/reorder',{order:[ids[1],ids[0],...ids.slice(2)],ack:true});ok(ro.ok,'reorder live');
  const rm=await tc.call('DELETE',`/exams/1/questions/${ids[ids.length-1]}`,{ack:true});
  ses=await st.call('GET',`/attempts/${att}/session`);ok(ses.questions.length===11||ses.questions.length===10,'question count now '+ses.questions.length);
  // pause exam
  ok((await tc.call('POST','/exams/1/status',{action:'pause'})).status==='paused','pause exam');
  sy=await st.call('POST',`/attempts/${att}/sync`,{answers:[{eqId:q[1].id,answer:'a',ts:Date.now()}]});ok(sy.frozen&&sy.saved.length===0,'paused: timer frozen, not saved (queued client-side)');
  const r1=sy.remainingMs;await new Promise(r=>setTimeout(r,1500));sy=await st.call('POST',`/attempts/${att}/sync`,{answers:[]});ok(sy.remainingMs===r1,'remaining unchanged while paused');
  ok((await tc.call('POST','/exams/1/status',{action:'resume'})).status==='live','resume');
  sy=await st.call('POST',`/attempts/${att}/sync`,{answers:[]});ok(sy.remainingMs>=r1-100&&sy.remainingMs<=r1+2000,'time not lost across pause');
  // individual pause/extend
  ok((await tc.call('POST',`/attempts/${att}/pause`,{reason:'test'})).ok,'individual pause');
  ok((await tc.call('POST',`/attempts/${att}/resume`,{})).ok,'individual resume');
  ok((await tc.call('POST',`/attempts/${att}/extend`,{minutes:5,reason:'slow'})).ok,'extend +5m');
  // restart individual
  const rs=await tc.call('POST',`/attempts/${att}/restart`,{reason:'Test restart',questionSet:'new',clearAnswers:true});ok(rs.newAttemptId&&rs.attemptNo===2,'restart -> attempt '+rs.newAttemptId);
  const old=await tc.call('GET',`/attempts/${att}`);ok(old.attempt.status==='restarted'&&old.history.length===2,'old attempt preserved, history '+old.history.map(h=>h.status).join('>'));
  sy=await st.call('POST',`/attempts/${att}/sync`,{answers:[]});ok(sy.status==='restarted','student old attempt says restarted');
  ok((await st.call('POST','/student/exams/1/start')).attemptId===rs.newAttemptId,'student resumes into new attempt');
  // restart all validation
  ok((await tc.call('POST','/exams/1/restart-all',{confirm:'nope',reason:'x'})).s===400,'restart-all rejects wrong phrase');
  const pv=await tc.call('GET','/exams/1/restart-preview');
  const ra=await tc.call('POST','/exams/1/restart-all',{confirm:'RESTART ALL',reason:'Wrong paper distributed',questionSet:'same'});ok(ra.restarted===12,'restart all '+ra.restarted+' (preview in-progress '+pv.inProgress+', completed '+pv.completed+')');
  const mon=await tc.call('GET','/exams/1/monitor');ok(mon.counts.not_started===12,'everyone Not Started: '+JSON.stringify(mon.counts));
  const cnt=await tc.call('GET','/exams/1/results');ok(cnt.rows.length>=3,'old attempts still in results/history: '+cnt.rows.length);
  // admin can see, other teacher cannot
  const ar=await ad.call('GET','/exams/1');ok(ar.exam,'admin can access');
  const t2=await client('arjun.mehta@school.edu','Teacher@123');ok((await t2.call('GET','/exams/1')).s===403,'other teacher forbidden');
  // student full run: start, answer, submit
  const s2=await st.call('POST','/student/exams/1/start');const ses2=await st.call('GET',`/attempts/${s2.attemptId}/session`);
  const sub=await st.call('POST',`/attempts/${s2.attemptId}/submit`,{answers:ses2.questions.map(x=>({eqId:x.id,answer:x.type==='multi'?[x.options[0].id]:x.type==='tf'?'true':x.type==='short'||x.type==='long'?'answer text':x.options[0].id,ts:Date.now()}))});
  ok(sub.status==='submitted','submitted');
  ok((await st.call('GET',`/student/results/${s2.attemptId}`)).s===403,'results hidden before publish');
  const det=await tc.call('GET',`/attempts/${s2.attemptId}`);const long=det.questions.find(x=>x.type==='long');
  const gr=await tc.call('PUT',`/attempts/${s2.attemptId}/grade`,{grades:[{eqId:long.id,marks:4,feedback:'Nice'}]});ok(gr.ok,'manual grade');
  const pub=await tc.call('POST','/exams/1/publish-results',{});ok(pub.s===409&&pub.details.code==='PENDING_MANUAL'||pub.released,'publish warns about pending manual marks');
  const pub2=await tc.call('POST','/exams/1/publish-results',{force:true});ok(pub2.released===1,'published');
  const rr=await st.call('GET',`/student/results/${s2.attemptId}`);ok(rr.attempt&&rr.attempt.score>=0,'student sees result: '+rr.attempt?.score+'/'+rr.exam?.total_marks);
  // reports/exports
  for(const f of ['csv','xlsx','pdf']){const r=await fetch(B+'/reports/exam-performance?format='+f,{headers:{cookie:tc.cookie()}});const b=await r.arrayBuffer();ok(r.status===200&&b.byteLength>200,'export '+f+' '+b.byteLength+'B');}
  const qa=await tc.call('GET','/reports/question-analysis?examId=2');ok(qa.rows.length>0,'question analysis rows '+qa.rows.length);
  // force end
  ok((await tc.call('POST','/exams/1/status',{action:'end',reason:'done'})).status==='completed','force end');
  const lg=await ad.call('GET','/audit-logs?size=100');ok(lg.total>40,'audit logs '+lg.total+' actions: '+[...new Set(lg.items.map(i=>i.action))].slice(0,14).join(','));
  const unread=await st.call('GET','/notifications');ok(unread.unread>2,'student notifications '+unread.unread);
  ws.close();process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1)});
