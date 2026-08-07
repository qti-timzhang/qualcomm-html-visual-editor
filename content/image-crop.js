// image-crop.js — PPT 风格图片裁剪
// 实现原理：用 clip-path (inset) 裁剪图片，不破坏原图数据
// 进入裁剪模式后，图片外层套一个 overflow:hidden 的容器，用拖动手柄调整裁剪区域
window.HVE_ImageCrop = (function () {

  let cropState = null; // 当前裁剪会话

  // ========== 公共 API ==========

  function isCropping() {
    return cropState !== null;
  }

  /**
   * 对选中的 <img> 进入裁剪模式
   */
  function startCrop(imgEl) {
    if (!imgEl || imgEl.tagName !== 'IMG') {
      if (window.HVE_Core) window.HVE_Core.showToast('请先选中一张图片', 'info');
      return;
    }
    if (isCropping()) finishCrop(false); // 取消上一次未完成的裁剪

    const rect = imgEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      if (window.HVE_Core) window.HVE_Core.showToast('图片尚未加载完成，请稍后再试', 'info');
      return;
    }

    // 读取图片当前的 clip-path inset 值（如已裁剪过）
    const existing = parseExistingClip(imgEl);

    cropState = {
      imgEl,
      originalClip: imgEl.style.clipPath || '', // 保存原始值，取消时还原
      // 裁剪偏移（相对于图片自身宽高的比例，0~1）
      top:    existing.top,
      right:  existing.right,
      bottom: existing.bottom,
      left:   existing.left,
      // 图片渲染尺寸（用于换算）
      w: rect.width,
      h: rect.height,
    };

    renderCropOverlay();
    attachKeyboardListener();

    if (window.HVE_Core) window.HVE_Core.showToast('裁剪模式 ✂️  — 拖动手柄调整，Enter 确认，Esc 取消', 'info');
  }

  /**
   * 完成或取消裁剪
   * @param {boolean} apply  true=应用，false=取消
   */
  function finishCrop(apply) {
    if (!cropState) return;

    if (apply) {
      applyClip();
      if (window.HVE_Core) window.HVE_Core.showToast('裁剪已应用 ✓', 'success');
    } else {
      // 取消：还原进入裁剪前的原始 clip-path
      cropState.imgEl.style.clipPath = cropState.originalClip;
    }

    destroyCropOverlay();
    detachKeyboardListener();
    cropState = null;

    // 恢复选中状态
    if (apply && window.HVE_Selector) {
      // 重新选中，让 resize handle 回到正确位置
      const img = document.querySelector('[data-hve-selected]');
      if (img) setTimeout(() => window.HVE_Selector.select(img), 0);
    }
  }

  /**
   * 将裁剪结果应用到 img 元素
   */
  function applyClip() {
    const { imgEl, top, right, bottom, left } = cropState;
    const topPct    = (top    * 100).toFixed(2) + '%';
    const rightPct  = (right  * 100).toFixed(2) + '%';
    const bottomPct = (bottom * 100).toFixed(2) + '%';
    const leftPct   = (left   * 100).toFixed(2) + '%';

    const oldClip = imgEl.style.clipPath || '';
    imgEl.style.clipPath = `inset(${topPct} ${rightPct} ${bottomPct} ${leftPct})`;

    if (window.HVE_History) {
      window.HVE_History.record({
        type: 'style',
        element: imgEl,
        before: { style: { clipPath: oldClip } },
        after:  { style: { clipPath: imgEl.style.clipPath } },
        description: '裁剪图片'
      });
    }
  }

  // ========== 解析已有裁剪值 ==========

  function parseExistingClip(imgEl) {
    const clip = imgEl.style.clipPath;
    if (!clip) return { top: 0, right: 0, bottom: 0, left: 0 };
    // 匹配 inset(T R B L) 格式，值可以是 px 或 %
    const m = clip.match(/inset\(\s*([^)]+)\s*\)/);
    if (!m) return { top: 0, right: 0, bottom: 0, left: 0 };
    const parts = m[1].trim().split(/\s+/);
    const rect = imgEl.getBoundingClientRect();
    function toRatio(val, dim) {
      if (val.endsWith('%')) return parseFloat(val) / 100;
      if (val.endsWith('px')) return parseFloat(val) / dim;
      return 0;
    }
    return {
      top:    toRatio(parts[0] || '0', rect.height),
      right:  toRatio(parts[1] || '0', rect.width),
      bottom: toRatio(parts[2] || '0', rect.height),
      left:   toRatio(parts[3] || '0', rect.width),
    };
  }

  // ========== 覆盖层渲染 ==========

  let overlayEl = null;

  function renderCropOverlay() {
    destroyCropOverlay();

    const { imgEl, top, right, bottom, left, w, h } = cropState;
    const imgRect = imgEl.getBoundingClientRect();

    // 遮罩层：覆盖整个视口，接收点击（Esc / 取消）
    overlayEl = document.createElement('div');
    overlayEl.setAttribute('data-hve-editor', 'true');
    overlayEl.setAttribute('data-hve-crop-overlay', 'true');
    // 透明遮罩本身不拦截鼠标事件，否则会挡住工具栏
    overlayEl.style.pointerEvents = 'none';

    // 四个暗色遮罩（裁剪区域之外）
    const dimTop    = makeRegion('top');
    const dimRight  = makeRegion('right');
    const dimBottom = makeRegion('bottom');
    const dimLeft   = makeRegion('left');

    // 裁剪窗口（亮色区域，中间）——本身不需要接收事件，子手柄单独绑定
    const cropWindow = document.createElement('div');
    cropWindow.setAttribute('data-hve-crop-window', 'true');
    cropWindow.style.cssText = `
      position:fixed;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.8), 0 0 0 2px rgba(0,0,0,0.4);
      pointer-events:none;
    `;
    // 三分线（类似相机取景框）
    for (let i = 1; i <= 2; i++) {
      const hLine = document.createElement('div');
      hLine.style.cssText = `position:absolute;left:0;right:0;top:${(i/3*100).toFixed(1)}%;height:1px;background:rgba(255,255,255,0.4);pointer-events:none;`;
      const vLine = document.createElement('div');
      vLine.style.cssText = `position:absolute;top:0;bottom:0;left:${(i/3*100).toFixed(1)}%;width:1px;background:rgba(255,255,255,0.4);pointer-events:none;`;
      cropWindow.appendChild(hLine);
      cropWindow.appendChild(vLine);
    }

    // 八个调整手柄
    const handleDefs = [
      { id:'n',  cursor:'n-resize',  style:'top:-5px;left:50%;transform:translateX(-50%);width:28px;height:10px;border-radius:3px 3px 0 0;' },
      { id:'s',  cursor:'s-resize',  style:'bottom:-5px;left:50%;transform:translateX(-50%);width:28px;height:10px;border-radius:0 0 3px 3px;' },
      { id:'w',  cursor:'w-resize',  style:'left:-5px;top:50%;transform:translateY(-50%);width:10px;height:28px;border-radius:3px 0 0 3px;' },
      { id:'e',  cursor:'e-resize',  style:'right:-5px;top:50%;transform:translateY(-50%);width:10px;height:28px;border-radius:0 3px 3px 0;' },
      { id:'nw', cursor:'nw-resize', style:'top:-5px;left:-5px;width:14px;height:14px;border-radius:3px 0 0 0;' },
      { id:'ne', cursor:'ne-resize', style:'top:-5px;right:-5px;width:14px;height:14px;border-radius:0 3px 0 0;' },
      { id:'sw', cursor:'sw-resize', style:'bottom:-5px;left:-5px;width:14px;height:14px;border-radius:0 0 0 3px;' },
      { id:'se', cursor:'se-resize', style:'bottom:-5px;right:-5px;width:14px;height:14px;border-radius:0 0 3px 0;' },
    ];
    handleDefs.forEach(def => {
      const h = document.createElement('div');
      h.setAttribute('data-hve-crop-handle', def.id);
      // pointer-events:all 让手柄从父级的 none 中独立出来，可以被鼠标点击
      h.style.cssText = `
        position:absolute;background:white;
        box-shadow:0 1px 4px rgba(0,0,0,0.35);
        cursor:${def.cursor};${def.style}
        pointer-events:all;
      `;
      h.addEventListener('mousedown', onHandleMouseDown);
      cropWindow.appendChild(h);
    });

    // 底部操作栏
    const bar = document.createElement('div');
    bar.setAttribute('data-hve-crop-bar', 'true');
    bar.style.pointerEvents = 'all'; // 从父级 none 中独立，让按钮可点击
    bar.innerHTML = `
      <button data-crop-action="reset" title="重置裁剪">↺ 重置</button>
      <div style="display:flex;gap:6px;">
        <button data-crop-action="cancel" style="background:transparent;border:1px solid rgba(255,255,255,0.4);color:white;">取消</button>
        <button data-crop-action="apply" style="background:#D97706;border:1px solid #B45309;color:white;">✓ 应用</button>
      </div>
    `;
    bar.addEventListener('click', onBarClick);

    overlayEl.appendChild(dimTop);
    overlayEl.appendChild(dimRight);
    overlayEl.appendChild(dimBottom);
    overlayEl.appendChild(dimLeft);
    overlayEl.appendChild(cropWindow);
    overlayEl.appendChild(bar);
    document.body.appendChild(overlayEl);

    updateOverlayPositions();
  }

  function makeRegion(side) {
    const el = document.createElement('div');
    el.setAttribute('data-hve-crop-dim', side);
    el.style.cssText = `
      position:fixed;
      background:rgba(0,0,0,0.5);
      pointer-events:none;
    `;
    return el;
  }

  /**
   * 根据当前 cropState 重新计算并更新所有 overlay 元素的位置
   */
  function updateOverlayPositions() {
    if (!overlayEl || !cropState) return;
    const { imgEl, top, right, bottom, left, w, h } = cropState;
    const imgRect = imgEl.getBoundingClientRect();

    const iLeft   = imgRect.left;
    const iTop    = imgRect.top;
    const iW      = imgRect.width;
    const iH      = imgRect.height;

    // 裁剪窗口的视口坐标
    const cLeft   = iLeft  + left   * iW;
    const cTop    = iTop   + top    * iH;
    const cRight  = iLeft  + (1 - right)  * iW;
    const cBottom = iTop   + (1 - bottom) * iH;
    const cW      = cRight  - cLeft;
    const cH      = cBottom - cTop;

    // 暗色遮罩
    const dimTop    = overlayEl.querySelector('[data-hve-crop-dim="top"]');
    const dimRight  = overlayEl.querySelector('[data-hve-crop-dim="right"]');
    const dimBottom = overlayEl.querySelector('[data-hve-crop-dim="bottom"]');
    const dimLeft   = overlayEl.querySelector('[data-hve-crop-dim="left"]');

    dimTop.style.cssText    += `left:${iLeft}px;top:${iTop}px;width:${iW}px;height:${top*iH}px;`;
    dimBottom.style.cssText += `left:${iLeft}px;top:${cBottom}px;width:${iW}px;height:${bottom*iH}px;`;
    dimLeft.style.cssText   += `left:${iLeft}px;top:${cTop}px;width:${left*iW}px;height:${cH}px;`;
    dimRight.style.cssText  += `left:${cRight}px;top:${cTop}px;width:${right*iW}px;height:${cH}px;`;

    // 裁剪窗口
    const cropWindow = overlayEl.querySelector('[data-hve-crop-window]');
    cropWindow.style.left   = cLeft   + 'px';
    cropWindow.style.top    = cTop    + 'px';
    cropWindow.style.width  = cW      + 'px';
    cropWindow.style.height = cH      + 'px';

    // 操作栏位置（裁剪窗口正下方，视口内）
    const bar = overlayEl.querySelector('[data-hve-crop-bar]');
    if (bar) {
      let barTop = cBottom + 8;
      if (barTop + 44 > window.innerHeight - 8) barTop = cTop - 52;
      bar.style.top  = Math.max(8, barTop) + 'px';
      bar.style.left = (cLeft + cW / 2) + 'px';
    }
  }

  function destroyCropOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.remove();
    overlayEl = null;
  }

  // ========== 手柄拖动 ==========

  let dragHandle = null;
  let dragStart  = null;

  function onHandleMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    dragHandle = e.currentTarget.getAttribute('data-hve-crop-handle');
    dragStart  = { x: e.clientX, y: e.clientY, ...cropState };
    document.addEventListener('mousemove', onHandleMouseMove, true);
    document.addEventListener('mouseup',   onHandleMouseUp,   true);
  }

  function onHandleMouseMove(e) {
    if (!dragHandle || !dragStart || !cropState) return;
    e.preventDefault();

    const { imgEl } = cropState;
    const imgRect = imgEl.getBoundingClientRect();
    const iW = imgRect.width;
    const iH = imgRect.height;

    const dx = (e.clientX - dragStart.x) / iW;
    const dy = (e.clientY - dragStart.y) / iH;

    const MIN_SIZE = 0.05; // 最小裁剪区域 5%

    let { top, right, bottom, left } = dragStart;

    if (dragHandle.includes('n')) top    = clamp(top    + dy, 0, 1 - bottom - MIN_SIZE);
    if (dragHandle.includes('s')) bottom = clamp(bottom - dy, 0, 1 - top    - MIN_SIZE);
    if (dragHandle.includes('w')) left   = clamp(left   + dx, 0, 1 - right  - MIN_SIZE);
    if (dragHandle.includes('e')) right  = clamp(right  - dx, 0, 1 - left   - MIN_SIZE);

    cropState.top    = top;
    cropState.right  = right;
    cropState.bottom = bottom;
    cropState.left   = left;

    // 实时预览
    const topPct    = (top    * 100).toFixed(2) + '%';
    const rightPct  = (right  * 100).toFixed(2) + '%';
    const bottomPct = (bottom * 100).toFixed(2) + '%';
    const leftPct   = (left   * 100).toFixed(2) + '%';
    imgEl.style.clipPath = `inset(${topPct} ${rightPct} ${bottomPct} ${leftPct})`;

    // 更新 overlay 位置
    redrawDimRegions();
    updateOverlayPositions();
  }

  function onHandleMouseUp(e) {
    document.removeEventListener('mousemove', onHandleMouseMove, true);
    document.removeEventListener('mouseup',   onHandleMouseUp,   true);
    dragHandle = null;
    dragStart  = null;
  }

  // 重绘遮罩（先清空位置再重算，避免 cssText 追加叠加）
  function redrawDimRegions() {
    ['top','right','bottom','left'].forEach(side => {
      const el = overlayEl?.querySelector(`[data-hve-crop-dim="${side}"]`);
      if (el) el.style.cssText = 'position:fixed;background:rgba(0,0,0,0.5);pointer-events:none;';
    });
  }

  // ========== 背景点击 / 按钮 / 键盘 ==========

  function onOverlayBgClick(e) {
    // 此函数已不再使用（overlay 设为 pointer-events:none），保留以备将来使用
  }

  function onBarClick(e) {
    const btn = e.target.closest('[data-crop-action]');
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.cropAction;
    if (action === 'apply')  finishCrop(true);
    if (action === 'cancel') finishCrop(false);
    if (action === 'reset')  resetCrop();
  }

  function resetCrop() {
    if (!cropState) return;
    cropState.top = cropState.right = cropState.bottom = cropState.left = 0;
    cropState.imgEl.style.clipPath = '';
    redrawDimRegions();
    updateOverlayPositions();
    if (window.HVE_Core) window.HVE_Core.showToast('裁剪已重置', 'info');
  }

  function attachKeyboardListener() {
    document.addEventListener('keydown', onCropKeyDown, true);
  }

  function detachKeyboardListener() {
    document.removeEventListener('keydown', onCropKeyDown, true);
  }

  function onCropKeyDown(e) {
    if (!isCropping()) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      finishCrop(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finishCrop(false); // finishCrop(false) 内部会还原 originalClip
    }
  }

  // ========== 工具 ==========

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  return { startCrop, finishCrop, isCropping };
})();
