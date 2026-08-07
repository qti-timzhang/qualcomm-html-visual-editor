(() => {
  let slides = [];
  let current = 0;

  // ── DOM refs ──
  const currentFrame   = document.getElementById('current-frame');
  const nextFrame      = document.getElementById('next-frame');
  const notesContent   = document.getElementById('notes-content');
  const slideCounter   = document.getElementById('slide-counter');
  const timerDisplay   = document.getElementById('timer-display');
  const btnTimerToggle = document.getElementById('btn-timer-toggle');
  const btnTimerReset  = document.getElementById('btn-timer-reset');
  const btnPrev        = document.getElementById('btn-prev');
  const btnNext        = document.getElementById('btn-next');

  // ── Timer ──
  let timerSeconds = 0;
  let timerInterval = null;
  let timerRunning = false;

  function formatTime(s) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  btnTimerToggle.addEventListener('click', () => {
    if (timerRunning) {
      clearInterval(timerInterval);
      timerRunning = false;
      btnTimerToggle.textContent = '继续';
    } else {
      timerInterval = setInterval(() => {
        timerSeconds++;
        timerDisplay.textContent = formatTime(timerSeconds);
      }, 1000);
      timerRunning = true;
      btnTimerToggle.textContent = '暂停';
    }
  });

  btnTimerReset.addEventListener('click', () => {
    clearInterval(timerInterval);
    timerRunning = false;
    timerSeconds = 0;
    timerDisplay.textContent = '00:00';
    btnTimerToggle.textContent = '开始';
  });

  // I5: 窗口关闭时清理 timer，防止 interval 泄漏
  window.addEventListener('beforeunload', () => {
    clearInterval(timerInterval);
    clearTimeout(saveTimer);
  });

  // ── 注入主页面 CSS ──
  function injectCSS(cssText) {
    if (!cssText) return;
    const existing = document.getElementById('hve-presenter-deck-css');
    if (existing) { existing.textContent = cssText; return; }
    const style = document.createElement('style');
    style.id = 'hve-presenter-deck-css';
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  // ── Slide rendering（C4：用 DOMParser 代替 innerHTML 避免事件处理器 XSS）──
  function renderSlideIntoFrame(frame, slideHtml) {
    if (!slideHtml) {
      frame.innerHTML = '<div style="width:100%;height:100%;display:grid;place-items:center;color:#555;font-size:13px;">无幻灯片</div>';
      return;
    }
    const containerW = frame.offsetWidth  || frame.clientWidth  || 640;
    const containerH = (frame.offsetHeight > 20 ? frame.offsetHeight : null)
                    || (frame.clientHeight > 20 ? frame.clientHeight : null)
                    || Math.round(containerW * 9 / 16);
    const scale = Math.max(Math.min(containerW / 1600, containerH / 900), 0.001);

    // DOMParser 解析后 adoptNode，脚本不会执行，事件处理器属性也不会触发
    const parsed = new DOMParser().parseFromString(
      `<div id="_wrap">${slideHtml}</div>`, 'text/html'
    );
    const wrap = document.createElement('div');
    wrap.className = 'slide-scale-wrap';
    wrap.style.cssText = `width:1600px;height:900px;transform:scale(${scale});transform-origin:top left;position:absolute;top:0;left:0;`;
    const content = parsed.getElementById('_wrap');
    while (content && content.firstChild) {
      wrap.appendChild(document.adoptNode(content.firstChild));
    }
    // 强制 .slide 元素填满 1600×900，cqw 单位才能正确计算
    const slideEl = wrap.querySelector('.slide');
    if (slideEl) {
      slideEl.style.cssText = (slideEl.getAttribute('style') || '') +
        ';width:1600px!important;height:900px!important;min-width:1600px!important;aspect-ratio:unset!important;overflow:hidden!important;position:relative!important;';
    }
    frame.innerHTML = '';
    frame.style.height = containerH + 'px';
    frame.appendChild(wrap);
  }

  function updateUI() {
    if (slides.length === 0) return;
    const cur  = slides[current] || { html: '', notes: '' };
    const next = slides[current + 1] || null;
    requestAnimationFrame(() => {
      renderSlideIntoFrame(currentFrame, cur.html);
      renderSlideIntoFrame(nextFrame, next ? next.html : '');
    });
    notesContent.value = cur.notes || '';
    slideCounter.textContent = `${current + 1} / ${slides.length}`;
  }

  // ── 向主窗口发消息（C2：使用 'null' 作为 targetOrigin，blob/file 页面 origin 均为 'null'）──
  function notifyMain(data) {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(data, '*'); // file:// origin 无法预测，保持 '*' 但加接收端校验
    }
  }

  function goTo(index) {
    if (slides.length === 0) return;
    current = Math.max(0, Math.min(slides.length - 1, index));
    updateUI();
    notifyMain({ type: 'slide-change', current, total: slides.length });
  }

  // ── 接收主窗口消息（C3：校验消息来源为 null origin）──
  window.addEventListener('message', (e) => {
    // blob: 和 file:// 的 origin 均为 'null'，拒绝其他来源
    if (e.origin !== 'null') return;
    const { type } = e.data || {};
    if (type === 'deck-data') {
      injectCSS(e.data.css);
      slides  = e.data.slides;
      current = e.data.current || 0;
      updateUI();
    } else if (type === 'slide-change') {
      current = e.data.current;
      updateUI();
    }
  });

  // 告知主窗口已就绪
  notifyMain({ type: 'presenter-ready' });

  // ── 底部按钮 & 键盘 ──
  btnPrev.addEventListener('click', () => goTo(current - 1));
  btnNext.addEventListener('click', () => goTo(current + 1));

  document.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); goTo(current + 1); }
    if (['ArrowLeft',  'PageUp'       ].includes(e.key)) { e.preventDefault(); goTo(current - 1); }
    if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    if (e.key === 'End')  { e.preventDefault(); goTo(slides.length - 1); }
  });

  // ── 备注编辑 → 回传主窗口保存 ──
  let saveTimer = null;
  notesContent.addEventListener('input', () => {
    slides[current] = slides[current] || { html: '', notes: '' };
    slides[current].notes = notesContent.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      notifyMain({ type: 'save-notes', index: Math.floor(current), notes: notesContent.value });
      const hint = document.getElementById('notes-saved-hint');
      if (hint) { hint.style.opacity = '1'; setTimeout(() => { hint.style.opacity = '0'; }, 1200); }
    }, 600);
  });

  window.addEventListener('resize', updateUI);
  window.HVEPresenter = { goTo };
})();
