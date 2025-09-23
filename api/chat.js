<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TempoChat — charlas privadas en 10 minutos</title>
  <meta name="description" content="Sesiones privadas de 10 minutos, sin registro, 24/7 y con memoria de conversación. Privacidad real y foco en lo que necesitás ahora." />
  <style>
    :root{ --bg:#0b0b0c; --panel:#141417; --panel-2:#101013; --text:#e8e8ec; --muted:#a7a7b2; --line:#222227; --brand:#2f81f7; }
    *{ box-sizing:border-box }
    html,body{ margin:0; padding:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif }
    .wrap{ max-width:1080px; margin:0 auto; padding:24px }
    header{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 0; border-bottom:1px solid var(--line) }
    .brand{ display:flex; align-items:center; gap:10px }
    .logo{ width:28px; height:28px; border-radius:8px; background:linear-gradient(135deg,var(--brand),#7aa5ff) }

    .hero{ padding:28px 0 }
    .hero h1{ font-size:clamp(28px,4vw,44px); line-height:1.1; margin:0 0 10px }
    .hero p{ color:var(--muted); margin:0 0 18px }

    .chat{ display:flex; flex-direction:column; height:460px; margin-top:12px }
    .chatlog{ flex:1; overflow:auto; border:1px solid var(--line); border-radius:12px; padding:10px; background:var(--panel-2) }
    .msg{ max-width:80%; padding:10px 14px; border-radius:14px; margin:6px 0; line-height:1.45 }
    .user{ background:#2b2b34; margin-left:auto; border-bottom-right-radius:4px }
    .assistant{ background:#1b1b20; margin-right:auto; border-bottom-left-radius:4px }
    .system{ color:var(--muted); text-align:center; margin:4px 0 }
    .typing{ display:none; color:var(--muted); margin:6px 0 }
    .row{ display:flex; gap:8px; margin-top:10px }
    input,button{ font:inherit }
    .row input{ flex:1; background:#121216; color:var(--text); border:1px solid var(--line); border-radius:12px; padding:10px }
    .row button{ background:var(--brand); color:#fff; border:none; border-radius:12px; padding:10px 14px; cursor:pointer }
    .error{ color:#ff7a7a; font-size:13px; margin-top:6px; display:none }
    .timer{ font-size:14px; color:var(--muted); margin:6px 0; text-align:center }

    .nudge{ display:none; gap:8px; justify-content:center; margin:6px 0 }
    .ghost{ background:transparent; border:1px solid var(--line); color:var(--text) }

    .closing-banner{ position:fixed; left:0; right:0; bottom:20px; margin:0 auto; max-width:1080px; background:#1b1b20; border:1px solid var(--line); border-radius:12px; padding:10px 14px; color:var(--muted); text-align:center; display:none; box-shadow:0 8px 24px rgba(0,0,0,.3); }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand"><div class="logo"></div><strong>TempoChat</strong></div>
    </header>

    <section class="hero">
      <h1>Charlas privadas de 10 minutos</h1>
      <p>Un espacio breve y seguro para ordenar ideas y salir con un próximo paso claro.</p>
    </section>

    <section>
      <div class="chat">
        <div class="chatlog" id="chatlog">
          <div class="system">Bienvenido a la demo. Tenés 10 minutos para conversar. Empezá escribiendo abajo 👇</div>
        </div>
        <div class="timer" id="timer">Tiempo restante: 10:00</div>

        <div class="nudge" id="nudge">
          <button class="btn" id="addTime">Agregar 5′</button>
          <button class="btn ghost" id="wrapUp">Vamos cerrando</button>
        </div>

        <div class="typing" id="typing">⏳ escribiendo…</div>
        <div class="error" id="error"></div>
        <div class="row">
          <input id="msg" placeholder="Escribí acá…" />
          <button id="send">Enviar</button>
        </div>
      </div>
    </section>
  </div>

  <div id="closingBanner" class="closing-banner">Cierre en curso… generando conclusión final</div>

  <script>
    // --------- sessionId siempre presente ----------
    function sidGet(){ return localStorage.getItem('tempochat.sid') || ''; }
    function sidSet(v){ if(v) localStorage.setItem('tempochat.sid', v); }
    (function ensureSid(){
      if (!sidGet()) {
        const sid = (crypto?.randomUUID?.() || 'sid-' + Math.random().toString(36).slice(2));
        sidSet(sid);
      }
    })();

    // --------- elementos y estado ----------
    let currentReqId = 0;
    const $ = (id) => document.getElementById(id);
    const chatlog = $('chatlog'), typing=$('typing'), errorBox=$('error');
    const input = $('msg'), btn=$('send');
    const timerEl=$('timer'), nudge=$('nudge');
    const btnAddTime=$('addTime'), btnWrap=$('wrapUp');
    const closingBanner=$('closingBanner');

    let sessionSeconds=600, interval, askedAtNine=false;
    let closing=false, retriedAfter410=false;

    let autosendTimer=null;
    const AUTOSEND_MS=1700, AUTOSEND_MIN_CHARS=6, AUTOSEND_ENDING=/[.!?…)]$/;

    // Mensaje de apertura simple
    const OPENING_PROMPT = 'Arranquemos. Tenés 10 minutos, contame qué tenés en mente.';

    // --------- helpers ----------
    function fmt(t){ const m=Math.floor(t/60),s=String(t%60).padStart(2,'0'); return `${m}:${s}`; }
    function updateTimer(){ timerEl.textContent=`Tiempo restante: ${fmt(sessionSeconds)}`; }
    function setTyping(on){ typing.style.display=on?'block':'none'; }
    function showError(msg){ errorBox.style.display='block'; errorBox.textContent=String(msg); }
    function clearError(){ errorBox.style.display='none'; errorBox.textContent=''; }
    function addMessage(role,text){ const d=document.createElement('div'); d.className='msg '+role; d.textContent=String(text||''); chatlog.appendChild(d); chatlog.scrollTop=chatlog.scrollHeight; }
    function setClosing(on){ closing=on; closingBanner.style.display=on?'block':'none'; input.disabled=on; btn.disabled=on; nudge.style.display='none'; }

    // --------- red ----------
    async function send(text){
      const reqId=++currentReqId; clearError(); setTyping(true);
      let sessionId=sidGet();
      if(!sessionId){ sessionId=crypto?.randomUUID?.()||'sid-'+Math.random().toString(36).slice(2); sidSet(sessionId); }
      const controller=new AbortController(); const to=setTimeout(()=>controller.abort(),30000);
      try{
        const res=await fetch('/api/chat',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text, sessionId }), signal:controller.signal });
        const raw=await res.text(); let json; try{json=JSON.parse(raw);}catch{json={raw};}
        if(reqId===currentReqId) setTyping(false);
        if(json?.sessionId) sidSet(json.sessionId);
        if(!res.ok){ addMessage('assistant','Hubo un problema técnico. Probemos de nuevo.'); return; }
        const reply=json.message||json.assistant||json.reply||json.output||raw||'¿Seguimos?';
        addMessage('assistant',reply);
      }catch(e){
        if(reqId===currentReqId) setTyping(false);
        addMessage('assistant','Se cortó la conexión, pero sigamos: ¿qué tenés en mente?');
      }finally{ clearTimeout(to); }
    }

    // --------- cierre ----------
    async function requestClose(source){
      if(closing) return;
      setClosing(true); clearInterval(interval);
      try{
        if(source==='manual'){ addMessage('user','Hagamos un cierre.'); }
        else{ addMessage('assistant','⏳ La sesión terminó. Preparando un cierre automático...'); }
        await send('Generá un cierre breve con la conclusión principal y una reflexión de lo charlado.');
      }finally{ closingBanner.style.display='none'; }
    }

    // --------- timer ----------
    function startTimer(){
      clearInterval(interval); updateTimer(); askedAtNine=false; retriedAfter410=false;
      interval=setInterval(async ()=>{
        sessionSeconds=Math.max(sessionSeconds-1,0);
        updateTimer();
        if(sessionSeconds===60 && !askedAtNine){
          askedAtNine=true;
          nudge.style.display='flex';
          addMessage('assistant','Queda 1 minuto. ¿Sumamos 5 minutos o preferís cerrar con una conclusión/reflexión?');
        }
        if(sessionSeconds===0){ await requestClose('timeout'); }
      },1000);
    }

    function resetUI(){
      chatlog.innerHTML='<div class="system">Bienvenido a la demo. Tenés 10 minutos para conversar. Empezá escribiendo abajo 👇</div>';
      sessionSeconds=600; updateTimer(); setTyping(false); clearError();
      input.disabled=false; btn.disabled=false; closingBanner.style.display='none';
      closing=false; nudge.style.display='none';
    }

    async function hardResetSession(){ resetUI(); startTimer(); }

    // --------- autosend ----------
    function scheduleAutosend(){
      if(autosendTimer) clearTimeout(autosendTimer);
      autosendTimer=setTimeout(()=>{
        const v=input.value.trim();
        if(!v) return;
        if(v.length>=AUTOSEND_MIN_CHARS||AUTOSEND_ENDING.test(v)){
          addMessage('user',v);
          input.value=''; send(v);
        }
      },AUTOSEND_MS);
    }

    // --------- eventos ----------
    btn.addEventListener('click',()=>{ const v=input.value.trim(); if(!v)return; addMessage('user',v); input.value=''; send(v); });
    input.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); const v=input.value.trim(); if(!v)return; addMessage('user',v); input.value=''; send(v);} else{ scheduleAutosend(); } });
    input.addEventListener('input',scheduleAutosend);

    btnAddTime.addEventListener('click',()=>{
      if(closing) return;
      nudge.style.display='none';
      sessionSeconds=Math.max(sessionSeconds,1)+5*60;
      updateTimer();
      addMessage('system','Se agregaron 5 minutos. Seguimos conversando y cierro automáticamente al finalizar.');
    });
    btnWrap.addEventListener('click',()=>requestClose('manual'));

    // --------- arranque ----------
    (async function boot(){
      await hardResetSession();
      await send(OPENING_PROMPT);
      input.focus();
    })();
  </script>
</body>
</html>
