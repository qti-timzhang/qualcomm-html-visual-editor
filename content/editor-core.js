// editor-core.js — 编辑器主控逻辑 v2
window.HVE_Core = (function () {
  let isActive = false;
  let statusIndicator = null;

  // ========== 自动保存 ==========
  let autoSaveTimer   = null;
  let autoSaveObserver = null;
  const AUTO_SAVE_DELAY = 1500; // ms，最后一次变更后多久自动保存

  function startAutoSave() {
    stopAutoSave();
    autoSaveObserver = new MutationObserver((mutations) => {
      if (!isActive) return;
      if (!window.HVE_FileManager?.hasFileHandle()) return;
      // 过滤掉编辑器自身元素产生的变化，避免无限循环
      const hasRealChange = mutations.some(m => {
        const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        return target && !target.closest('[data-hve-editor]');
      });
      if (!hasRealChange) return;
      clearTimeout(autoSaveTimer);
      setAutoSaveStatus('pending');
      autoSaveTimer = setTimeout(async () => {
        if (!window.HVE_Serializer || !window.HVE_FileManager) return;
        try {
          // 保存期间暂停观察，避免 serialize() 的 DOM 操作再次触发
          autoSaveObserver.disconnect();
          const html = window.HVE_Serializer.serialize();
          await window.HVE_FileManager.saveFile(html);
          setAutoSaveStatus('saved');
        } catch (e) {
          setAutoSaveStatus('idle');
        } finally {
          // 恢复观察
          autoSaveObserver.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, characterData: false,
            attributeFilter: ['style', 'src', 'href']
          });
        }
      }, AUTO_SAVE_DELAY);
    });
    autoSaveObserver.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, characterData: false,
      attributeFilter: ['style', 'src', 'href']
    });
  }

  function stopAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    if (autoSaveObserver) { autoSaveObserver.disconnect(); autoSaveObserver = null; }
    setAutoSaveStatus('idle');
  }

  // 'idle' | 'pending' | 'saved'
  function setAutoSaveStatus(state) {
    if (!statusIndicator) return;
    const dot = statusIndicator.querySelector('.hve-status-dot');
    const label = statusIndicator.querySelector('.hve-status-label');
    if (!dot || !label) return;
    if (state === 'pending') {
      dot.style.background = '#FBBF24';
      label.textContent = ' Visual Editor · 保存中…';
    } else if (state === 'saved') {
      dot.style.background = '#4ADE80';
      label.textContent = ' Visual Editor · 已保存';
      // 2 秒后恢复默认文字
      setTimeout(() => {
        if (label) label.textContent = ' Visual Editor';
      }, 2000);
    } else {
      dot.style.background = '#4ADE80';
      label.textContent = ' Visual Editor';
    }
  }

  function enable() {
    if (isActive) return;
    isActive = true;

    // 启动各模块
    if (window.HVE_Selector) window.HVE_Selector.activate();
    if (window.HVE_DragMove) window.HVE_DragMove.activate();
    if (window.HVE_TextEdit) window.HVE_TextEdit.activate();
    if (window.HVE_TableEdit) window.HVE_TableEdit.activate();
    if (window.HVE_ImageHandler) window.HVE_ImageHandler.activate();
    if (window.HVE_Toolbar) window.HVE_Toolbar.activate();
    if (window.HVE_InsertPanel) window.HVE_InsertPanel.activate();
    if (window.HVE_ContextMenu) window.HVE_ContextMenu.activate();
    if (window.HVE_AlignGuide) window.HVE_AlignGuide.activate();
    if (window.HVE_PageSorter) window.HVE_PageSorter.activate();

    document.addEventListener('keydown', onKeyDown, true);
    showStatusIndicator();
    startAutoSave();
    showWelcomeTip();
    notifyState(true);
    console.log('[HTML Visual Editor] ✅ 编辑模式已开启');
  }

  function disable() {
    if (!isActive) return;
    isActive = false;

    if (window.HVE_Selector) window.HVE_Selector.deactivate();
    if (window.HVE_DragMove) window.HVE_DragMove.deactivate();
    if (window.HVE_Resize) window.HVE_Resize.destroy();
    if (window.HVE_TextEdit) window.HVE_TextEdit.deactivate();
    if (window.HVE_TableEdit) window.HVE_TableEdit.deactivate();
    if (window.HVE_ImageHandler) window.HVE_ImageHandler.deactivate();
    if (window.HVE_Toolbar) window.HVE_Toolbar.deactivate();
    if (window.HVE_InsertPanel) window.HVE_InsertPanel.deactivate();
    if (window.HVE_ContextMenu) window.HVE_ContextMenu.deactivate();
    if (window.HVE_AlignGuide) window.HVE_AlignGuide.deactivate();
    if (window.HVE_PageSorter) window.HVE_PageSorter.deactivate();
    if (window.HVE_Canvas) window.HVE_Canvas.deactivate();
    if (window.HVE_PDFPaginator) window.HVE_PDFPaginator.deactivate();
    if (window.HVE_ChartTypo) window.HVE_ChartTypo.deactivate();

    document.removeEventListener('keydown', onKeyDown, true);
    stopAutoSave();
    hideStatusIndicator();
    notifyState(false);
    console.log('[HTML Visual Editor] ⛔ 编辑模式已关闭');
  }

  function toggle() {
    if (isActive) disable(); else enable();
  }

  function onKeyDown(e) {
    if (!isActive) return;

    // Ctrl+Z 撤销
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      if (window.HVE_TextEdit?.isEditing()) return; // 文本编辑中让浏览器处理
      e.preventDefault();
      if (window.HVE_History) window.HVE_History.undo();
      return;
    }
    // Ctrl+Y 或 Ctrl+Shift+Z 重做
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      if (window.HVE_TextEdit?.isEditing()) return;
      e.preventDefault();
      if (window.HVE_History) window.HVE_History.redo();
      return;
    }
    // Ctrl+S 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentFile();
      return;
    }
    // Delete / Backspace 删除选中元素（非编辑模式下）
    if ((e.key === 'Delete' || e.key === 'Backspace') && !window.HVE_TextEdit?.isEditing()) {
      const selectedEls = window.HVE_Selector?.getSelectedElements() || [];
      if (selectedEls.length > 0) {
        // 跳过锁定的元素
        const deletable = selectedEls.filter(el => !el.hasAttribute('data-hve-locked'));
        if (deletable.length === 0) {
          if (window.HVE_Core) window.HVE_Core.showToast('元素已锁定，无法删除 🔒', 'info');
          return;
        }
        e.preventDefault();
        for (const sel of deletable) {
          if (window.HVE_History) {
            const nextSibling = sel.nextElementSibling;
            window.HVE_History.record({
              type: 'dom', element: sel,
              before: {
                action: 'remove',
                html: sel.outerHTML,
                parentSelector: window.HVE_History.getUniqueSelector(sel.parentElement),
                nextSiblingSelector: nextSibling ? window.HVE_History.getUniqueSelector(nextSibling) : null
              },
              after: { action: 'remove' },
              description: deletable.length > 1 ? '批量删除元素' : '删除元素'
            });
          }
          sel.remove();
        }
        window.HVE_Selector.deselectAll();
      }
    }
    // Escape 取消选择（按优先级依次处理）
    if (e.key === 'Escape') {
      if (window.HVE_TextEdit?.isEditing()) {
        window.HVE_TextEdit.finishEditing();
      } else if (window.HVE_InsertPanel?.isPanelVisible?.()) {
        window.HVE_InsertPanel.hidePanel();
      } else if (window.HVE_Selector) {
        // 如果当前选中了子元素（如 td），先尝试向上选父级（如 table）
        const current = window.HVE_Selector.getSelected();
        if (current && current.parentElement && current.parentElement !== document.body) {
          const wentUp = window.HVE_Selector.selectParent();
          if (!wentUp) {
            window.HVE_Selector.deselectAll();
          }
        } else {
          window.HVE_Selector.deselectAll();
        }
      }
    }
    // Ctrl+D 复制元素
    if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !window.HVE_TextEdit?.isEditing()) {
      const selectedEls = window.HVE_Selector?.getSelectedElements() || [];
      if (selectedEls.length > 0) {
        e.preventDefault();
        const newEls = [];
        for (const sel of selectedEls) {
          const clone = sel.cloneNode(true);
          clone.removeAttribute('data-hve-selected');
          clone.removeAttribute('data-hve-multi-selected');
          clone.removeAttribute('data-hve-id');
          sel.parentNode.insertBefore(clone, sel.nextSibling);
          newEls.push(clone);
          // 记录历史
          if (window.HVE_History) {
            window.HVE_History.record({
              type: 'dom', element: clone,
              before: { action: 'insert' },
              after: {
                action: 'insert',
                html: clone.outerHTML,
                parentSelector: window.HVE_History.getUniqueSelector(clone.parentElement)
              },
              description: selectedEls.length > 1 ? '批量复制元素' : '复制元素'
            });
          }
        }
        // 选中复制出来的元素
        window.HVE_Selector.deselectAll();
        for (const el of newEls) {
          window.HVE_Selector.addToSelection(el);
        }
      }
    }

    // Ctrl+Shift+C 复制样式
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C' && !window.HVE_TextEdit?.isEditing()) {
      const sel = window.HVE_Selector?.getSelected();
      if (sel && window.HVE_ContextMenu) {
        e.preventDefault();
        window.HVE_ContextMenu.copyStyle(sel);
      }
    }

    // Ctrl+Shift+V 粘贴样式
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V' && !window.HVE_TextEdit?.isEditing()) {
      const selectedEls = window.HVE_Selector?.getSelectedElements() || [];
      if (selectedEls.length > 0 && window.HVE_ContextMenu?.getCopiedStyle()) {
        e.preventDefault();
        window.HVE_ContextMenu.pasteStyle(selectedEls);
      }
    }

    // 方向键微调位置 (Arrow: 1px, Shift+Arrow: 10px)
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !window.HVE_TextEdit?.isEditing()) {
      const selectedEls = window.HVE_Selector?.getSelectedElements() || [];
      if (selectedEls.length > 0) {
        // 检查是否锁定
        const hasLocked = selectedEls.some(el => el.hasAttribute('data-hve-locked'));
        if (hasLocked) return;

        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;

        for (const el of selectedEls) {
          const beforeTransform = el.style.transform || '';

          // 解析当前 translate 值
          const match = beforeTransform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
          let curTx = 0, curTy = 0;
          if (match) {
            curTx = parseFloat(match[1]) || 0;
            curTy = parseFloat(match[2]) || 0;
          }

          const newTx = curTx + dx;
          const newTy = curTy + dy;

          // 设置新的 translate
          const cleaned = beforeTransform.replace(/translate\([^)]+\)\s*/g, '').trim();
          const translateStr = `translate(${newTx}px, ${newTy}px)`;
          el.style.transform = cleaned ? `${translateStr} ${cleaned}` : translateStr;

          // 记录历史
          if (window.HVE_History) {
            window.HVE_History.record({
              type: 'move', element: el,
              before: { transform: beforeTransform },
              after: { transform: el.style.transform },
              description: '方向键微调'
            });
          }
        }

        // 更新 resize 手柄
        if (selectedEls.length === 1 && window.HVE_Resize) {
          window.HVE_Resize.attachTo(selectedEls[0]);
        }
      }
    }

    // Ctrl+L 锁定/解锁元素
    if ((e.ctrlKey || e.metaKey) && e.key === 'l' && !window.HVE_TextEdit?.isEditing()) {
      const selectedEls = window.HVE_Selector?.getSelectedElements() || [];
      if (selectedEls.length > 0 && window.HVE_ContextMenu) {
        e.preventDefault();
        window.HVE_ContextMenu.toggleLock(selectedEls);
      }
    }

    // Ctrl+G 组合元素 (PPT Group)
    if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey && !window.HVE_TextEdit?.isEditing()) {
      const selectedEls = window.HVE_Selector?.getSelectedElements() || [];
      if (selectedEls.length > 1) {
        e.preventDefault();
        groupElements(selectedEls);
      }
    }

    // Ctrl+Shift+G 取消组合
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G' && !window.HVE_TextEdit?.isEditing()) {
      const sel = window.HVE_Selector?.getSelected();
      if (sel && sel.hasAttribute('data-hve-group')) {
        e.preventDefault();
        ungroupElement(sel);
      }
    }

    // Ctrl+P 页面排序器（不用系统打印）
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P' && !window.HVE_TextEdit?.isEditing()) {
      e.preventDefault();
      if (window.HVE_PageSorter) window.HVE_PageSorter.toggleSorter();
    }
  }

  async function saveCurrentFile() {
    if (!window.HVE_Serializer || !window.HVE_FileManager) return;
    const html = window.HVE_Serializer.serialize();
    const success = await window.HVE_FileManager.saveFile(html);
    showToast(success ? '文件已保存 ✓' : '保存失败', success ? 'success' : 'error');
  }

  async function saveCurrentFileAs() {
    if (!window.HVE_Serializer || !window.HVE_FileManager) return;
    const html = window.HVE_Serializer.serialize();
    const success = await window.HVE_FileManager.saveFileAs(html);
    showToast(success ? '文件已保存 ✓' : '保存失败', success ? 'success' : 'error');
  }

  function showWelcomeTip() {
    const tip = document.createElement('div');
    tip.setAttribute('data-hve-editor', 'true');
    tip.style.cssText = `
      position:fixed;bottom:72px;left:50%;transform:translateX(-50%);
      z-index:2147483647;
      background:#FFFDF9;border:1px solid #E8E5E0;
      border-radius:16px;
      box-shadow:0 8px 32px rgba(45,43,40,0.14),0 2px 8px rgba(45,43,40,0.08);
      padding:16px 20px;min-width:300px;max-width:380px;
      font-family:'SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      animation:hve-panel-in 0.25s cubic-bezier(0.4,0,0.2,1);
    `;
    tip.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <span style="font-size:18px;">✏️</span>
        <span style="font-size:14px;font-weight:600;color:#2D2B28;">编辑模式已开启</span>
        <button data-hve-welcome-close style="margin-left:auto;width:22px;height:22px;border:none;background:transparent;border-radius:6px;cursor:pointer;font-size:14px;color:#9C8E82;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:7px;font-size:12px;color:#5D534A;line-height:1.5;">
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <span style="background:#FEF3C7;color:#D97706;border-radius:5px;padding:1px 7px;font-weight:600;font-size:11px;flex-shrink:0;margin-top:1px;">自动保存</span>
          <span>先按 <kbd style="background:#F0EDE8;border:1px solid #E0DDD8;border-radius:4px;padding:1px 5px;font-size:11px;">Ctrl+S</kbd> 完成首次授权，之后每次编辑停止 1.5 秒自动覆盖保存源文件</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <span style="background:#F0EDE8;color:#7A6F65;border-radius:5px;padding:1px 7px;font-weight:600;font-size:11px;flex-shrink:0;margin-top:1px;">操作提示</span>
          <span>单击选中 · 双击编辑文字 · 拖拽移动 · <kbd style="background:#F0EDE8;border:1px solid #E0DDD8;border-radius:4px;padding:1px 5px;font-size:11px;">Ctrl+Z</kbd> 撤销</span>
        </div>
      </div>
    `;
    document.body.appendChild(tip);

    const close = () => {
      tip.style.opacity = '0';
      tip.style.transform = 'translateX(-50%) translateY(6px)';
      tip.style.transition = 'all 0.25s ease';
      setTimeout(() => tip.remove(), 250);
    };

    tip.querySelector('[data-hve-welcome-close]').addEventListener('click', close);
    // 4 秒后自动消失
    setTimeout(close, 4000);
  }

  function showStatusIndicator() {
    if (statusIndicator) return;
    statusIndicator = document.createElement('div');
    statusIndicator.setAttribute('data-hve-editor', 'true');
    statusIndicator.setAttribute('data-hve-status', 'true');
    statusIndicator.innerHTML = '<span class="hve-status-dot"></span><span class="hve-status-label"> Visual Editor</span>';
    statusIndicator.title = '点击关闭编辑模式';
    statusIndicator.addEventListener('click', () => disable());
    document.body.appendChild(statusIndicator);
  }

  function hideStatusIndicator() {
    if (statusIndicator && statusIndicator.parentNode) {
      statusIndicator.parentNode.removeChild(statusIndicator);
    }
    statusIndicator = null;
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.setAttribute('data-hve-editor', 'true');
    const colors = {
      success: { bg: 'linear-gradient(135deg,#D97706,#B45309)', shadow: 'rgba(217,119,6,0.3)' },
      error: { bg: 'linear-gradient(135deg,#DC2626,#B91C1C)', shadow: 'rgba(220,38,38,0.3)' },
      info: { bg: 'linear-gradient(135deg,#2563EB,#1D4ED8)', shadow: 'rgba(37,99,235,0.3)' }
    };
    const c = colors[type] || colors.success;
    toast.style.cssText = `
      position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;
      background:${c.bg};color:white;padding:12px 24px;border-radius:12px;
      font:14px/1.4 'SF Pro Text',-apple-system,sans-serif;font-weight:500;
      box-shadow:0 4px 16px ${c.shadow};
      animation:hve-toast-in 0.3s cubic-bezier(0.4,0,0.2,1);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-8px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function notifyState(active) {
    try {
      chrome.runtime?.sendMessage({ type: 'EDITOR_STATE_CHANGED', active });
    } catch (e) { /* ignore */ }
  }

  function getState() { return isActive; }

  /**
   * 组合多个元素（PPT Ctrl+G）
   * 用一个 div 包裹选中的元素，成为一个整体
   */
  function groupElements(elements) {
    if (elements.length < 2) return;

    // 找公共父元素
    const parent = elements[0].parentElement;
    const allSameParent = elements.every(el => el.parentElement === parent);
    if (!allSameParent) {
      showToast('只能组合同一层级的元素', 'info');
      return;
    }

    // 创建组合容器
    const group = document.createElement('div');
    group.setAttribute('data-hve-group', 'true');
    group.style.cssText = 'position:relative;';

    // 找最早出现的元素位置，将组合容器插入到那里
    const sortedByDOM = [...elements].sort((a, b) => {
      const aIdx = Array.from(parent.children).indexOf(a);
      const bIdx = Array.from(parent.children).indexOf(b);
      return aIdx - bIdx;
    });

    // 记录历史（组合前）
    const beforeHTML = sortedByDOM.map(el => el.outerHTML);
    const firstElNextSibling = sortedByDOM[0].nextSibling;

    // 插入组合容器
    parent.insertBefore(group, sortedByDOM[0]);

    // 将元素移入组合容器
    for (const el of sortedByDOM) {
      el.removeAttribute('data-hve-selected');
      el.removeAttribute('data-hve-multi-selected');
      el.removeAttribute('data-hve-select-label');
      group.appendChild(el);
    }

    // 记录历史
    if (window.HVE_History) {
      window.HVE_History.record({
        type: 'dom', element: group,
        before: { action: 'group', childrenHTML: beforeHTML, parentSelector: window.HVE_History.getUniqueSelector(parent) },
        after: { action: 'group', html: group.outerHTML, parentSelector: window.HVE_History.getUniqueSelector(parent) },
        description: '组合元素'
      });
    }

    // 选中组合
    window.HVE_Selector?.deselectAll();
    window.HVE_Selector?.select(group);

    showToast(`已组合 ${elements.length} 个元素 ✓ (⌘⇧G 取消组合)`, 'success');
  }

  /**
   * 取消组合（PPT Ctrl+Shift+G）
   * 将组合容器内的子元素释放到父级
   */
  function ungroupElement(group) {
    if (!group || !group.hasAttribute('data-hve-group')) return;

    const parent = group.parentElement;
    const children = [...group.children];

    if (children.length === 0) return;

    // 记录历史
    if (window.HVE_History) {
      window.HVE_History.record({
        type: 'dom', element: group,
        before: { action: 'ungroup', html: group.outerHTML, parentSelector: window.HVE_History.getUniqueSelector(parent) },
        after: { action: 'ungroup', childrenCount: children.length },
        description: '取消组合'
      });
    }

    // 将子元素释放到父级（替换 group 容器）
    const nextSib = group.nextSibling;
    for (const child of children) {
      parent.insertBefore(child, nextSib);
    }
    group.remove();

    // 选中释放出来的元素
    window.HVE_Selector?.deselectAll();
    for (const child of children) {
      window.HVE_Selector?.addToSelection(child);
    }

    showToast(`已取消组合 ✓`, 'success');
  }

  // 监听来自 popup / background 的消息
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      switch (msg.type) {
        case 'ENABLE_EDITOR':
          enable();
          sendResponse({ success: true });
          break;
        case 'DISABLE_EDITOR':
          disable();
          sendResponse({ success: true });
          break;
        case 'TOGGLE_EDITOR':
          toggle();
          sendResponse({ success: true, active: isActive });
          break;
        case 'QUERY_STATE':
          sendResponse({
            active: isActive,
            fileName: window.HVE_FileManager?.getFileName() || document.title
          });
          break;
        case 'SAVE_FILE':
          (async () => {
            try {
              await saveCurrentFile();
              sendResponse({ success: true });
            } catch (err) {
              sendResponse({ success: false, error: err.message });
            }
          })();
          return true; // 保持消息通道开放以支持异步 sendResponse
        case 'SAVE_FILE_AS':
          (async () => {
            try {
              await saveCurrentFileAs();
              sendResponse({ success: true });
            } catch (err) {
              sendResponse({ success: false, error: err.message });
            }
          })();
          return true;
        case 'OPEN_FILE':
          (async () => {
            try {
              const result = await window.HVE_FileManager?.openFile();
              if (result) {
                // 先关闭编辑器
                disable();
                // 使用 DOMParser 解析新内容，替换 head 和 body 而不销毁 content scripts
                const parser = new DOMParser();
                const newDoc = parser.parseFromString(result.content, 'text/html');
                // 替换 head 内容
                document.head.innerHTML = newDoc.head.innerHTML;
                // 替换 body 内容
                document.body.innerHTML = newDoc.body.innerHTML;
                // 复制 body 属性
                Array.from(newDoc.body.attributes).forEach(attr => {
                  document.body.setAttribute(attr.name, attr.value);
                });
                // 清除历史
                if (window.HVE_History) window.HVE_History.clear();
                // 重新启用编辑器
                setTimeout(() => enable(), 300);
              }
              sendResponse({ success: true });
            } catch (err) {
              sendResponse({ success: false, error: err.message });
            }
          })();
          return true;
        case 'HVE_UPDATE_PROPERTIES': {
          // 侧边栏属性面板修改了属性，应用到选中元素
          const sel = window.HVE_Selector?.getSelected();
          if (sel && msg.data) {
            const { prop, value } = msg.data;
            if (prop && value !== undefined) {
              if (window.HVE_History) {
                window.HVE_History.record({
                  type: 'style', element: sel,
                  before: { style: { [prop]: sel.style[prop] || '' } },
                  after: { style: { [prop]: value } },
                  description: '侧边栏修改属性'
                });
              }
              sel.style[prop] = value;
              // 更新工具栏和 resize
              if (window.HVE_Toolbar) window.HVE_Toolbar.show(sel);
              if (window.HVE_Resize) window.HVE_Resize.attachTo(sel);
            }
          }
          sendResponse({ success: true });
          break;
        }
      }
      return true;
    });
  }

  return { enable, disable, toggle, getState, showToast, groupElements, ungroupElement };
})();
