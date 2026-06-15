/**
 * Echo Pet —— EchoMusic 桌宠插件
 * 主插件：ctx.audio.spectrum.subscribe() + 播放状态 → KV
 */

const STORAGE_KEY = 'echo-pet:playback';
const SPECTRUM_KEY = 'echo-pet:spectrum';
const PLUGIN_ID = 'echo-pet';
const WINDOW_ID = 'pet-main';

export async function activate(ctx) {
  // ─── 打开桌宠窗口 ───
  async function openPetWindow() {
    try { const r = await window.electron?.plugins?.windows?.show(PLUGIN_ID, WINDOW_ID); if (!r || r.ok) console.log('[Pet] OK'); } catch(_) {}
  }
  setTimeout(openPetWindow, 500);
  setTimeout(openPetWindow, 2000);

  // ─── 播放状态 → KV ───
  async function syncNow() {
    try {
      await ctx.storage.set(STORAGE_KEY, { trackTitle: ctx.player.currentTrack?.title||'', isPlaying:!!ctx.player.isPlaying, updatedAt:Date.now() });
    } catch(_) {}
  }
  ctx.events.onTrackChange(() => { syncNow(); setTimeout(syncNow,500); });
  ctx.events.onPlaybackChange(() => syncNow());
  try { syncNow(); } catch(_) {}

  // ─── 音频频谱 → KV ───
  // 参考 spectrum-visualizer 插件，使用主插件 ctx.audio.spectrum.subscribe()
  let unsubSpec = null;
  let lastSync = 0;

  if (ctx.audio?.spectrum?.subscribe) {
    unsubSpec = ctx.audio.spectrum.subscribe(
      { fps:24, binCount:64, fftSize:1024, smoothing:0.7, minFrequency:20, maxFrequency:20000, scale:'log' },
      (frame) => {
        if (!frame?.bins || frame.bins.length===0) return;
        const now = Date.now();
        if (now - lastSync < 120) return; // 节流 120ms
        lastSync = now;

        const bins = frame.bins;
        const lowEnd = Math.min(10, bins.length);
        let sum = 0;
        for (let i=0;i<lowEnd;i++) sum += bins[i];
        const energy = Math.min(1, (sum/lowEnd) / 255);

        // 取部分 bin 用于 12 条可视化
        const barVals = [];
        const step = Math.max(1, Math.floor(bins.length/20));
        for (let i=0;i<20;i++) {
          const idx = Math.min(i*step, bins.length-1);
          barVals.push(Math.min(1, (bins[idx]||0)/255));
        }

        ctx.storage.set(SPECTRUM_KEY, { energy, barVals, updatedAt:now }).catch(()=>{});
      },
    );
  }

  // ─── 设置面板 ───
  const { defineComponent, h, ref, onMounted } = ctx.vue;
  const SettingsPanel = defineComponent({
    setup() {
      const visible = ref(true);
      const charImg = ref('');

      // 加载角色图片
      (async () => {
        try {
          const r = await ctx.fs.getFileUrl(ctx.descriptor.directory + '/assets/character.png');
          if (r?.url) charImg.value = r.url;
        } catch(_) {}
      })();

      const togglePet = async () => {
        visible.value = !visible.value;
        try {
          if (visible.value) { await window.electron?.plugins?.windows?.show(PLUGIN_ID, WINDOW_ID); ctx.toast.success('桌宠已显示'); }
          else { await window.electron?.plugins?.windows?.hide(PLUGIN_ID, WINDOW_ID).catch(()=>{}); ctx.toast.info('桌宠已隐藏'); }
        } catch(_) { ctx.toast.danger('操作失败'); }
      };

      return () => h('div',{style:'display:flex;flex-direction:column;gap:18px;'},[
        // ── 头部卡片：角色形象 + 信息 ──
        h('div',{
          style:'display:flex;align-items:center;gap:16px;padding:18px;background:var(--color-bg-elevated);border:1px solid var(--border-subtle);border-radius:14px;'
        },[
          // 角色头像
          h('div',{
            style:'width:64px;height:64px;border-radius:14px;overflow:hidden;flex-shrink:0;background:linear-gradient(135deg,#ffe0ec,#e8d5ff);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(196,77,255,0.12);'
          },[
            charImg.value
              ? h('img',{src:charImg.value,style:'width:100%;height:100%;object-fit:contain;'})
              : h('span',{style:'font-size:28px;',innerHTML:'🐱'})
          ]),
          // 信息区
          h('div',{style:'flex:1;min-width:0;'},[
            h('div',{style:'display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;'},[
              h('h3',{style:'margin:0;font-size:16px;font-weight:700;'},'echo pet'),
            ]),
            h('p',{style:'margin:4px 0 0;font-size:13px;color:var(--color-text-secondary);line-height:1.5;'},'桌宠——听歌的时候有个萌妹陪你,人物形象由栀设计提供'),
          ]),
        ]),

        // ── 显示开关 ──
        h('label',{
          style:'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-elevated);border:1px solid var(--border-subtle);border-radius:10px;cursor:pointer;transition:box-shadow 0.2s;'
        },[
          h('span',{style:'font-size:14px;font-weight:500;'},'显示桌宠'),
          h('input',{
            type:'checkbox',checked:visible.value,onInput:togglePet,
            style:'accent-color:var(--color-primary);width:18px;height:18px;cursor:pointer;'
          }),
        ]),

        // ── 使用提示 ──
        h('div',{
          style:'padding:12px 16px;border-radius:10px;background:var(--color-bg-elevated);border:1px solid var(--border-subtle);font-size:12px;color:var(--color-text-secondary);line-height:1.7;'
        },[
          h('strong',{},'💡 提示：'),' 按住角色拖拽移动窗口，点击触发撒娇互动。播放音乐时频谱条跟随真实音频律动，右键可开关浮动动画与音乐律动。'
        ]),
      ]);
    },
  });
  // 加载角色图作为设置图标
  let icon = '🐱';
  try {
    const r = await ctx.fs.getFileUrl(ctx.descriptor.directory + '/assets/character.png');
    if (r?.url) icon = r.url;
  } catch(_) {}

  ctx.ui.settings.define({ title:'echo pet', component:SettingsPanel, icon });
  ctx.toast.success(`${ctx.manifest.name} 已上线！`);
}

export function deactivate(ctx) {
  try { window.electron?.plugins?.windows?.close(PLUGIN_ID, WINDOW_ID); } catch(_) {}
  ctx.toast.info('桌宠已离线～');
}
