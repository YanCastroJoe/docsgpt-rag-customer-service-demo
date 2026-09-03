(() => {
  if (!window.location.pathname.startsWith('/agents/shared/')) return;

  const suggestions = [
    { label: '退货运费', question: '质量问题退货时，运费由谁承担？' },
    { label: '退款时效', question: '普通商品退货退款通常要多久？' },
    { label: '换货处理', question: '换货时同款商品缺货怎么办？' },
    { label: '申请材料', question: '质量问题售后需要提供什么凭证？' },
  ];

  const replaceCopy = () => {
    const replacements = new Map([
      ['企业知识库客服助手_V3', '售后智能助手'],
      ['DocsGPT 如何帮助您？', '请输入你的问题'],
      ['DocsGPT 使用 GenAI, 请使用来源审核关键信息.', 'AI 生成内容仅供参考，重要信息请以平台规则为准。'],
      ['基于FAQ精简版V3知识库的RAG客服Agent，强化知识边界拒答并禁止无依据扩写。', '我可以解答退换货、退款规则和物流政策；暂时无法查询具体订单状态。'],
      ['by Demo', '在线服务'],
    ]);

    document.querySelectorAll('h1, h2, p, div').forEach((node) => {
      const next = replacements.get(node.textContent.trim());
      if (next && node.children.length === 0) node.textContent = next;
    });

    const input = document.querySelector('#message-input');
    if (input) input.placeholder = replacements.get('DocsGPT 如何帮助您？');

    const legacyHeading = [...document.querySelectorAll('h2')]
      .find((heading) => heading.parentElement?.className?.includes('absolute top-5'));
    if (legacyHeading?.parentElement) legacyHeading.parentElement.dataset.ragLegacyHeading = 'true';
  };

  const markLayout = () => {
    const logo = document.querySelector('a[href="/"]');
    const sidebar = logo?.closest('div.fixed');
    if (sidebar) sidebar.dataset.ragSidebar = 'true';

    const input = document.querySelector('#message-input');
    let main = input;
    while (main && !(typeof main.className === 'string' && main.className.includes('lg:ml-72'))) {
      main = main.parentElement;
    }
    if (main) main.dataset.ragMain = 'true';
    return input;
  };

  const ensureHeader = () => {
    if (document.querySelector('.rag-demo-header')) return;
    const header = document.createElement('header');
    header.className = 'rag-demo-header';
    header.innerHTML = `
      <div class="rag-demo-brand">
        <span class="rag-demo-mark" aria-hidden="true">R</span>
        <span><strong>售后智能助手</strong><small>退换货、退款与物流政策</small></span>
      </div>
      <div class="rag-demo-actions">
        <span class="rag-demo-health"><i></i><span><strong>服务正常</strong><small>边界增强V3 · 固定快照 2026-08-07</small></span></span>
        <a class="rag-demo-ops-link" href="/ops/">诊断台</a>
      </div>`;
    document.body.append(header);
  };

  const fillQuestion = (input, question) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    valueSetter?.call(input, question);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: question }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  };

  const ensureSuggestions = (input) => {
    if (!input || document.querySelector('.rag-suggestions')) return;
    let inputSection = input.parentElement;
    while (inputSection && !(typeof inputSection.className === 'string' && inputSection.className.includes('w-full px-2'))) {
      inputSection = inputSection.parentElement;
    }
    if (!inputSection?.parentElement) return;

    const panel = document.createElement('section');
    panel.className = 'rag-suggestions';
    panel.setAttribute('aria-label', '常见售后问题');
    panel.innerHTML = '<p>猜你想问</p><div class="rag-suggestion-list"></div>';
    const list = panel.querySelector('.rag-suggestion-list');
    suggestions.forEach((suggestion) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rag-suggestion';
      button.innerHTML = `<small>${suggestion.label}</small><span>${suggestion.question}</span>`;
      button.addEventListener('click', () => fillQuestion(input, suggestion.question));
      list.append(button);
    });
    inputSection.parentElement.insertBefore(panel, inputSection);
  };

  let scheduled = false;
  const enhance = () => {
    scheduled = false;
    document.body.classList.add('rag-public-demo');
    const input = markLayout();
    replaceCopy();
    ensureHeader();
    ensureSuggestions(input);
  };
  const scheduleEnhance = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(enhance);
  };

  scheduleEnhance();
  new MutationObserver(scheduleEnhance).observe(document.documentElement, { childList: true, subtree: true });
})();
