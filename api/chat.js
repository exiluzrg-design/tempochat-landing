<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TempoChat</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; background:#0b0b0c; color:#e8e8ec; font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji"; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 24px; }
    header { padding: 24px 0 8px; }
    h1 { font-size: 1.6rem; margin: 0 0 6px; }
    p.lead { margin: 0 0 16px; color:#bdbdc2; }
    .card { background:#141417; border:1px solid #202025; border-radius:14px; padding:16px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
    .row { display:flex; gap:8px; }
    input[type="text"] { flex:1; background:#0e0e10; color:#e8e8ec; border:1px solid #2a2a2f; border-radius:10px; padding:12px 12px; }
    button { background:#22c55e; color:#0b0b0c; border:0; border-radius:10px; padding:12px 14px; font-weight:600; cursor:pointer; }
    button.secondary { background:#27272a; color:#e8e8ec; }
    button:disabled { opacity:.6; cursor:not-allowed; }
    #chat { margin-top:16px; display:flex; flex-direction:column; gap:10px; max-height:55vh; overflow:auto; padding-right:4px; }
    .msg { padding:10px 14px; border-radius:12px; max-width: 80%; line-height:1.35; }
    .user { align-self:flex-end; background:#1d4ed8; color:#f0f6ff; }
    .assistant { align-self:flex-start; background:#242427; color:#e8e8ec; border:1px solid #2b2b30; }
    footer { padding: 14px 0; color:#9a9aa1; font-size:.9rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>TempoChat</h1>
      <p class="lead">Hola, ¿cómo andás? Esta charla dura 10 minutos, así que arrancá con lo que tengas en mente.</p>
    </header>

    <div class="card" id="step-name">
      <div class="row">
        <input id="name" type="text" placeholder="Decime tu nombre (ej: Tito)" />
        <button id="start">Empezar</button>
      </div>
      <p style="margin:10px 0 0; color:#9a9aa1; font-size:.95rem">Primero tu nombre y ya entramos.</p>
    </div>

    <div class="card" id="chat-card" style="display:none;">
      <div id="chat"></div>
      <div class="row" style="margin-top:12px;">
        <input id="text" type="text" placeholder="Escribí tu mensaje..." />
        <button id="send">Enviar</button>
      </div>
    </div>

    <footer>
      Demo Etapa 1 — UI sin backend (mañana lo conectamos).
    </footer>
  </div>

  <script>
    const $name = document.getElementById('name');
    const $start = document.getElementById('start');
    const $stepName = document.getElementById('step-name');
    const $chatCard = document.getElementById('chat-card');
    const $chat = document.getElementById('chat');
    const $text = document.getElementById('text');
    const $send = document.getElementById('send');

    let who = 'amigo';

    function add(role, text) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.textContent = text;
      $chat.appendChild(div);
      $chat.scrollTop = $chat.scrollHeight;
    }

    function mockReply(userText) {
      // “Psicólogo directo” (mock, sin API)
      const t = userText.toLowerCase();
      if (t.includes('infiel') || t.includes('enga')) {
        return "Uhh, te la mandaste. No está bien y lo sabés. O lo decís y te bancás la tormenta, o lo callás y cargás la mochila vos solo. Pensalo en serio y hacete cargo.";
      }
      if (t.includes('ansiedad') || t.includes(
