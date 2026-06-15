/**
 * Echo Pet —— 桌宠窗口
 * 真实频谱（KV） + 本地动画兜底
 */

const STORAGE_KEY = 'echo-pet:playback';
const SPECTRUM_KEY = 'echo-pet:spectrum';

export function activateWindow(ctx) {
  const container = ctx.container;

  let floatEnabled = true;
  let musicReactionEnabled = true;
  let idleTimer = null;
  let pollTimer = null;
  let animTimer = null;
  let lastTrackTitle = '';
  let animFrameId = null;

  const FaceState = { NORMAL:'normal', SQUINT:'squint', SLEEPY:'sleepy' };
  let currentFace = FaceState.NORMAL;
  let faceTimer = null;
  let isBlushVisible = false;
  let isPlaying = false;

  // ── 拖拽（CSS transform 零延迟）──
  let isDragging = false, isMouseDown = false;
  let startCX = 0, startCY = 0, winSX = 0, winSY = 0, dragDX = 0, dragDY = 0;

  // ── 平滑移动 ──
  let isMoving = false, roamEnabled = true;
  let tgtX = null, tgtY = null;
  let moveSpeed = 180;
  let moveRafId = null;
  let moveLastTick = 0, moveDX = 0, moveDY = 0;
  let winPos = { x: 0, y: 0 };
  let roamTimer = null;

  container.innerHTML = `
    <canvas id="pet-particles"></canvas>
    <div id="pet-bubble" class="hidden"><span id="pet-bubble-text"></span></div>
    <div id="pet-character">
      <img id="pet-img" alt="pet" draggable="false" />
      <canvas id="pet-face-overlay"></canvas>
    </div>
    <div id="pet-music-bars" class="hidden">
      <div class="bar"></div><div class="bar"></div><div class="bar"></div>
      <div class="bar"></div><div class="bar"></div><div class="bar"></div>
      <div class="bar"></div><div class="bar"></div><div class="bar"></div>
      <div class="bar"></div><div class="bar"></div><div class="bar"></div>
      <div class="bar"></div><div class="bar"></div><div class="bar"></div>
      <div class="bar"></div><div class="bar"></div><div class="bar"></div>
      <div class="bar"></div><div class="bar"></div>
    </div>
    <div id="pet-context-menu" class="hidden">
      <div class="pm-item" data-action="toggle-float">浮动动画 <span id="pm-float-status">✓</span></div>
      <div class="pm-item" data-action="toggle-music">音乐律动 <span id="pm-music-status">✓</span></div>
      <div class="pm-sep"></div>
      <div class="pm-item" data-action="dismiss">收起菜单</div>
    </div>
  `;

  const canvas = container.querySelector('#pet-particles');
  const charDiv = container.querySelector('#pet-character');
  const petImg = container.querySelector('#pet-img');
  const faceCanvas = container.querySelector('#pet-face-overlay');
  const faceCtx = faceCanvas.getContext('2d');
  const bubble = container.querySelector('#pet-bubble');
  const bubbleText = container.querySelector('#pet-bubble-text');
  const musicBars = container.querySelector('#pet-music-bars');
  const ctxMenu = container.querySelector('#pet-context-menu');
  const barEls = musicBars.querySelectorAll('.bar');

  const LINES_IDLE = ['来听首歌吧～ 🎵','今天心情怎么样？ 😊','这首不错哦！','陪你一起听～ 💕','Echo Music 真好听！','有点困了…… zzz','哇，这首好嗨！ 🎶'];
  const SQUINT_LINES = ['唔～ 好嘛好嘛～ 😊','嘻嘻，再摸摸头～ 💕','嘿嘿～ 痒痒的～'];

  // ── 加载图片 ──
  (async function() {
    try {
      const r = await ctx.fs.getFileUrl(ctx.descriptor.directory+'/assets/character.webp');
      if (r.ok || r?.url) petImg.src = r.url;
    } catch(_){}
  })();

  function showBubble(text, ms=2500) { bubbleText.textContent = text; bubble.classList.remove('hidden'); clearTimeout(bubble._timer); bubble._timer = setTimeout(()=>bubble.classList.add('hidden'), ms); }

  // ── Canvas（脸红） ──
  const FACE = { lx:0.32, ly:0.45, rx:0.60, ry:0.45, br:0.045 };
  function resizeFC() { const c=charDiv.getBoundingClientRect(); faceCanvas.width=c.width; faceCanvas.height=c.height; }
  function drawFace() {
    faceCtx.clearRect(0,0,faceCanvas.width,faceCanvas.height);
    if(!isBlushVisible) return;
    const r=petImg.getBoundingClientRect(), c=charDiv.getBoundingClientRect();
    const ir={x:r.left-c.left, y:r.top-c.top, w:r.width, h:r.height};
    if(ir.w<=0) return;
    const lc={x:ir.x+FACE.lx*ir.w, y:ir.y+FACE.ly*ir.h}, rc={x:ir.x+FACE.rx*ir.w, y:ir.y+FACE.ry*ir.h}, br=ir.w*FACE.br;
    faceCtx.save(); faceCtx.globalAlpha=0.25; faceCtx.fillStyle='#ff8fa3';
    faceCtx.beginPath(); faceCtx.ellipse(lc.x,lc.y,br,br*0.7,0,0,Math.PI*2); faceCtx.fill();
    faceCtx.beginPath(); faceCtx.ellipse(rc.x,rc.y,br,br*0.7,0,0,Math.PI*2); faceCtx.fill();
    faceCtx.restore();
  }
  function renderLoop(){ resizeFC(); drawFace(); animFrameId=requestAnimationFrame(renderLoop); }

  function setFace(f,dur){ currentFace=f; if(faceTimer)clearTimeout(faceTimer); if(dur)faceTimer=setTimeout(()=>{currentFace=FaceState.NORMAL;},dur); }

  function doSquint() {
    setFace(FaceState.SQUINT, 800); isBlushVisible=true;
    setTimeout(()=>{isBlushVisible=false;}, 1200);
    let c=0; const si=setInterval(()=>{petImg.style.transform=`scale(1.05) rotate(${c%2===0?6:-4}deg)`; if(++c>=6){clearInterval(si);petImg.style.transform='';}},80);
    showBubble(SQUINT_LINES[Math.floor(Math.random()*SQUINT_LINES.length)], 1800);
  }

  // ── 粒子 ──
  function startParticles() {
    const c=canvas.getContext('2d'); let pts=[], running=true;
    function resize(){ canvas.width=innerWidth; canvas.height=innerHeight; } resize();
    for(let i=0;i<30;i++)pts.push({x:Math.random()*canvas.width,y:Math.random()*canvas.height,vx:(Math.random()-0.5)*0.3,vy:(Math.random()-0.5)*0.3,r:Math.random()*2+0.5,a:Math.random()*0.25+0.08});
    function frame(){if(!running)return;c.clearRect(0,0,canvas.width,canvas.height);for(const p of pts){p.x+=p.vx;p.y+=p.vy;if(p.x<0)p.x=canvas.width;if(p.x>canvas.width)p.x=0;if(p.y<0)p.y=canvas.height;if(p.y>canvas.height)p.y=0;c.beginPath();c.arc(p.x,p.y,p.r,0,Math.PI*2);c.fillStyle=`rgba(255,255,255,${p.a})`;c.fill();}requestAnimationFrame(frame);}
    frame(); addEventListener('resize',resize); return ()=>{running=false;};
  }

  // ── CSS ──
  ctx.css.inject(`
    *{margin:0;padding:0;box-sizing:border-box;user-select:none}
    html,body{width:100%;height:100%;overflow:hidden;background:transparent}
    #pet-particles{position:fixed;inset:0;pointer-events:none;z-index:0}
    #pet-bubble{position:absolute;top:10%;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.95);color:#333;padding:5px 10px;border-radius:10px;font-size:12px;font-weight:500;text-align:center;max-width:150px;line-height:1.4;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:10;pointer-events:none;transition:opacity 0.25s,transform 0.25s}
    #pet-bubble.hidden{opacity:0;transform:translateX(-50%) translateY(6px)}
    #pet-character{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;pointer-events:none}
    #pet-img{width:auto;max-width:180px;max-height:240px;object-fit:contain;pointer-events:auto;transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1),filter 0.3s;cursor:grab}
    #pet-img:active{cursor:grabbing}
    #pet-face-overlay{position:absolute;inset:0;pointer-events:none;z-index:2}
    @keyframes petFloat{0%,100%{transform:translateY(0)scale(1)rotate(0deg)}25%{transform:translateY(-4px)scale(1.01)rotate(0.5deg)}50%{transform:translateY(-8px)scale(1.02)rotate(0deg)}75%{transform:translateY(-4px)scale(1.01)rotate(-0.5deg)}}
    .pet-floating{animation:petFloat 3s ease-in-out infinite}
    @keyframes petWiggle{0%,100%{transform:rotate(0deg)scale(1.05)}20%{transform:rotate(-4deg)scale(1.08)}40%{transform:rotate(3deg)scale(1.06)}60%{transform:rotate(-2deg)scale(1.07)}80%{transform:rotate(1deg)scale(1.05)}}
    .pet-wiggle{animation:petWiggle 0.5s ease-in-out}
    #pet-music-bars{position:absolute;bottom:5%;left:50%;transform:translateX(-50%);display:flex;align-items:flex-end;gap:2px;height:30px;z-index:5;width:360px;justify-content:center}
    #pet-music-bars.hidden{display:none}
    #pet-music-bars .bar{width:3px;border-radius:1px;background:linear-gradient(180deg,#ff6b9d,#c44dff);height:4px;transition:height 0.08s}
    #pet-context-menu{position:fixed;z-index:100;background:rgba(255,255,255,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:10px;padding:4px;min-width:120px;box-shadow:0 8px 32px rgba(0,0,0,0.18);border:1px solid rgba(0,0,0,0.06)}
    #pet-context-menu.hidden{display:none}
    .pm-item{padding:7px 14px;font-size:12px;color:#333;border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.12s}
    .pm-item:hover{background:rgba(0,0,0,0.06)}
    .pm-sep{height:1px;background:rgba(0,0,0,0.08);margin:4px 8px}
    @media(prefers-color-scheme:dark){#pet-bubble{background:rgba(40,40,50,0.95);color:#eee}#pet-context-menu{background:rgba(40,40,50,0.92);border-color:rgba(255,255,255,0.06)}.pm-item{color:#ddd}.pm-item:hover{background:rgba(255,255,255,0.08)}.pm-sep{background:rgba(255,255,255,0.08)}}
  `, { id: 'echo-pet-anim' });

  // ── 音乐律动 ──
  function updateBars() {
    const sv = latestSpec?.barVals;
    if (sv && sv.length === barEls.length) {
      for (let i = 0; i < barEls.length; i++) {
        barEls[i].style.height = Math.max(3, Math.round(4 + sv[i] * 26)) + 'px';
      }
    }
  }

  function startMusicAnimation() { stopMusicAnimation(); animTimer = setInterval(updateBars, 100); }
  function stopMusicAnimation() { if (animTimer) { clearInterval(animTimer); animTimer = null; } barEls.forEach(b => b.style.height = '4px'); }

  // ── 轮询 ──
  let latestSpec = null;
  async function pollPlayback() {
    try {
      const data = await ctx.storage.get(STORAGE_KEY);
      if (!data) return;
      const spec = await ctx.storage.get(SPECTRUM_KEY);
      if (spec) latestSpec = spec;
      const trackChanged = data.trackTitle && data.trackTitle !== lastTrackTitle;
      isPlaying = !!data.isPlaying;
      if (trackChanged) { lastTrackTitle = data.trackTitle; if (isPlaying) showBubble(`正在播放: ${data.trackTitle} 🎵`, 3000); }
      if (isPlaying && musicReactionEnabled) { musicBars.classList.remove('hidden'); startMusicAnimation(); }
      else { musicBars.classList.add('hidden'); stopMusicAnimation(); }
    } catch (_) {}
  }
  pollTimer = setInterval(pollPlayback, 200);
  setTimeout(pollPlayback, 500);

  // ── 闲置 ──
  idleTimer = setInterval(() => {
    if (Math.random() > 0.5) showBubble(LINES_IDLE[Math.floor(Math.random() * LINES_IDLE.length)]);
    if (currentFace === FaceState.NORMAL && Math.random() > 0.6) setFace(FaceState.SLEEPY, 1500);
  }, 8000 + Math.random() * 6000);

  // ═══ 拖拽（CSS transform 视觉位移 + 松手一次性 IPC）═══
  petImg.addEventListener('mousedown', async (e) => {
    e.preventDefault(); isMouseDown = true; isDragging = false;
    startCX = e.clientX; startCY = e.clientY;
    try {
      const b = await ctx.window.getBounds();
      if (b) { winSX = b.x; winSY = b.y; }
    } catch (_) { winSX = 0; winSY = 0; }
    document.body.style.transition = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    dragDX = e.clientX - startCX; dragDY = e.clientY - startCY;
    if (Math.abs(dragDX) > 2 || Math.abs(dragDY) > 2) isDragging = true;
    if (!isDragging) return;
    document.body.style.transform = `translate(${dragDX}px,${dragDY}px)`;
  });

  document.addEventListener('mouseup', () => {
    if (!isMouseDown) return; isMouseDown = false;
    if (isDragging) {
      const fx = winSX + dragDX, fy = winSY + dragDY;
      ctx.window.move({ x: fx, y: fy }).catch(() => {});
      winPos.x = fx; winPos.y = fy;
      document.body.style.transform = '';
      document.body.style.transition = 'transform 0.12s ease-out';
      setTimeout(() => showBubble(
        ['呼～ 这里不错！', '就放这里吧～', '嗯，这个位置挺好～'][Math.floor(Math.random() * 3)], 1500
      ), 200);
    } else {
      doSquint();
    }
    isDragging = false;
  });

  // ═══ 平滑移动 ═══
  function initPosition() { ctx.window.getBounds().then(b => { if (b) { winPos.x = b.x; winPos.y = b.y; } }); }
  initPosition();

  function moveTo(x, y) {
    tgtX = x; tgtY = y;
    ctx.window.getBounds().then(b => {
      if (b) { winPos.x = b.x; winPos.y = b.y; }
      if (!isMoving) startMoving();
    });
  }

  function startMoving() {
    isMoving = true; moveLastTick = performance.now();
    if (floatEnabled) charDiv.classList.remove('pet-floating');
    clearRoamTimer(); moveTick();
  }

  function moveTick() {
    if (!isMoving || tgtX === null || tgtY === null) { stopMoving(); return; }
    const now = performance.now();
    const dt = Math.min((now - moveLastTick) / 1000, 0.05);
    moveLastTick = now;
    const dx = tgtX - winPos.x, dy = tgtY - winPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 3) {
      winPos.x = tgtX; winPos.y = tgtY;
      ctx.window.move({ x: Math.round(winPos.x), y: Math.round(winPos.y) }).catch(() => {});
      stopMoving(); return;
    }
    const step = moveSpeed * dt;
    const ratio = Math.min(step / dist, 1);
    winPos.x += dx * ratio; winPos.y += dy * ratio;
    moveDX = dx; moveDY = dy;
    const margin = 30;
    const maxX = (screen.availWidth || 1920) - 200;
    const maxY = (screen.availHeight || 1080) - 360;
    let bounced = false;
    if (winPos.x < margin) { winPos.x = margin; bounced = true; }
    if (winPos.y < margin) { winPos.y = margin; bounced = true; }
    if (winPos.x > maxX) { winPos.x = maxX; bounced = true; }
    if (winPos.y > maxY) { winPos.y = maxY; bounced = true; }
    if (bounced) {
      tgtX = Math.max(margin, Math.min(maxX, winPos.x + (dx > 0 ? -200 : 200) * (0.5 + Math.random() * 0.5)));
      tgtY = Math.max(margin, Math.min(maxY, winPos.y + (dy > 0 ? -150 : 150) * (0.5 + Math.random() * 0.5)));
      showBubble('呀，没路了～', 1200);
    }
    ctx.window.move({ x: Math.round(winPos.x), y: Math.round(winPos.y) }).catch(() => {});
    moveRafId = requestAnimationFrame(moveTick);
  }

  function stopMoving() {
    isMoving = false; tgtX = null; tgtY = null;
    if (moveRafId) { cancelAnimationFrame(moveRafId); moveRafId = null; }
    if (floatEnabled) charDiv.classList.add('pet-floating');
    scheduleRoam();
  }

  function setMoveSpeed(s) { moveSpeed = Math.max(40, Math.min(3000, s)); }

  function scheduleRoam() {
    clearRoamTimer(); if (!roamEnabled || isMoving) return;
    roamTimer = setTimeout(() => {
      if (!roamEnabled || isMoving) return;
      const margin = 40;
      const maxX = (screen.availWidth || 1920) - 280;
      const maxY = (screen.availHeight || 1080) - 440;
      moveTo(margin + Math.random() * (maxX - margin), margin + Math.random() * (maxY - margin));
    }, 5000 + Math.random() * 10000);
  }

  function clearRoamTimer() { if (roamTimer) { clearTimeout(roamTimer); roamTimer = null; } }

  ctx.window.moveTo = moveTo; ctx.window.stopMove = stopMoving;
  ctx.window.setMoveSpeed = setMoveSpeed;
  ctx.window.setRoam = function(e) { roamEnabled = e; if (e) scheduleRoam(); else clearRoamTimer(); };

  setTimeout(() => { if (roamEnabled) scheduleRoam(); }, 3000);

  // ── 悬停 ──
  petImg.addEventListener('mouseenter',()=>{charDiv.classList.add('pet-wiggle');petImg.style.transform='scale(1.08) rotate(-3deg)';});
  petImg.addEventListener('mouseleave',()=>{charDiv.classList.remove('pet-wiggle');petImg.style.transform='';});

  // ── 右键菜单 ──
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); ctxMenu.classList.remove('hidden'); ctxMenu.style.left = e.clientX + 'px'; ctxMenu.style.top = e.clientY + 'px'; const r = ctxMenu.getBoundingClientRect(); if (r.right > innerWidth) ctxMenu.style.left = (innerWidth - r.width - 5) + 'px'; if (r.bottom > innerHeight) ctxMenu.style.top = (innerHeight - r.height - 5) + 'px'; container.querySelector('#pm-float-status').textContent = floatEnabled ? '✓' : ''; container.querySelector('#pm-music-status').textContent = musicReactionEnabled ? '✓' : ''; });
  document.addEventListener('click', (e) => { if (!ctxMenu.contains(e.target)) ctxMenu.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ctxMenu.classList.add('hidden'); });
  ctxMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.pm-item'); if (!item) return; ctxMenu.classList.add('hidden'); const action = item.dataset.action;
    if (action === 'toggle-float') { floatEnabled = !floatEnabled; charDiv.classList.toggle('pet-floating', floatEnabled); showBubble(floatEnabled ? '飘起来啦～ ✨' : '让我站一会儿'); }
    else if (action === 'toggle-music') { musicReactionEnabled = !musicReactionEnabled; if (!musicReactionEnabled) { stopMusicAnimation(); musicBars.classList.add('hidden'); } showBubble(musicReactionEnabled ? '跟着音乐摇摆！ 🎶' : '让我安静会儿 🤫'); }
    container.querySelector('#pm-float-status').textContent = floatEnabled ? '✓' : ''; container.querySelector('#pm-music-status').textContent = musicReactionEnabled ? '✓' : '';
  });

  // ── 清理 ──
  ctx.dispose(() => {
    clearInterval(idleTimer); clearInterval(pollTimer); clearInterval(animTimer);
    if (faceTimer) clearTimeout(faceTimer); if (animFrameId) cancelAnimationFrame(animFrameId);
    if (moveRafId) cancelAnimationFrame(moveRafId); clearRoamTimer();
    stopMoving(); stopParticles();
  });
}
