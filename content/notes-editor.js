// notes-editor.js — 演讲者备注侧边栏编辑器
window.HVE_NotesEditor = (function () {
  let panel = null;
  let isOpen = false;
  let currentSlide = null;

  function getSlideForElement(el) {
    // 向上找最近的 .slide 容器
    return el ? el.closest('.slide') : null;
  }

  function getNotes(slide) {
    if (!slide) return '';
    const aside = slide.querySelector('.slide-notes');
    return aside ? aside.textContent : '';
  }

  function setNotes(slide, text) {
    if (!slide) return;
    let aside = slide.querySelector('.slide-notes');
    if (!aside) {
      aside = document.createElement('aside');
      aside.className = 'slide-notes';
      aside.setAttribute('aria-hidden', 'true');
      slide.appendChild(aside);
    }
    const old = aside.textContent;
    aside.textContent = text;
    if (window.HVE_History && old !== text) {
      window.HVE_History.record({
        type: 'notes', element: aside,
        before: { notes: old },
        after:  { notes: text },
        description: '编辑演讲者备注'
      });
    }
  }

  function open() {
    if (panel) close();

    const selected = window.HVE_Selector?.getSelected();
    currentSlide = getSlideForElement(selected);

    panel = document.createElement('div');
    panel.setAttribute('data-hve-editor', 'true');
    panel.setAttribute('data-hve-notes-panel', 'true');

    const notes = getNotes(currentSlide);

    panel.innerHTML = `
      <div class="hve-notes-header">
        <span>演讲者备注</span>
        <button data-notes-action="close">✕</button>
      </div>
      <div class="hve-notes-hint" style="${currentSlide ? 'display:none' : ''}">请先选中幻灯片中的元素</div>
      <textarea class="hve-notes-textarea" placeholder="在此输入演讲者备注，仅在演讲者模式下可见…" ${!currentSlide ? 'disabled' : ''}></textarea>
      <div class="hve-notes-footer">
        <button data-notes-action="open-presenter">▶ 开启演讲者模式 (P)</button>
      </div>
    `;

    // 设置备注内容（用 .value 避免 </textarea> 注入破坏 HTML 结构）
    const textarea = panel.querySelector('.hve-notes-textarea');
    textarea.value = getNotes(currentSlide);
    textarea.addEventListener('input', () => {
      setNotes(currentSlide, textarea.value);
    });

    panel.querySelector('[data-notes-action="close"]').addEventListener('click', close);
    panel.querySelector('[data-notes-action="open-presenter"]').addEventListener('click', () => {
      if (window.QualcommDeck?.openPresenter) {
        window.QualcommDeck.openPresenter();
      } else {
        // 模拟按下 P 键触发模板内置的演讲者模式
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
        window.HVE_Core?.showToast('正在开启演讲者模式…', 'info');
      }
    });

    document.body.appendChild(panel);
    isOpen = true;
    textarea.focus();
  }

  function close() {
    if (panel && panel.parentNode) panel.remove();
    panel = null;
    isOpen = false;
  }

  function toggle() {
    if (isOpen) close(); else open();
  }

  // 选中元素变化时更新备注内容
  document.addEventListener('hve-element-selected', (e) => {
    if (!isOpen || !panel) return;
    const newSlide = getSlideForElement(e.detail?.element);
    if (newSlide !== currentSlide) {
      currentSlide = newSlide;
      const textarea = panel.querySelector('.hve-notes-textarea');
      if (textarea) {
        textarea.value = getNotes(currentSlide);
        textarea.disabled = !currentSlide;
      }
      const hint = panel.querySelector('.hve-notes-hint');
      if (hint) hint.style.display = currentSlide ? 'none' : 'block';
    }
  });

  return { toggle, isOpen: () => isOpen, open, close };
})();
