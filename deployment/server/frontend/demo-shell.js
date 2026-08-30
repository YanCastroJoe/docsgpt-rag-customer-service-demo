(() => {
  if (!window.location.pathname.startsWith('/agents/shared/')) return;

  const questions = [
    '质量问题退货时，运费由谁承担？',
    '普通商品退货退款通常要多久？',
    '换货时同款商品缺货怎么办？',
  ];

  const replaceCopy = () => {
    const replacements = new Map([
      ['企业知识库客服助手_V3', '企业售后知识库 Agent'],
      ['DocsGPT 如何帮助您？', '请输入售后问题，例如：质量问题退货运费由谁承担？'],
      ['DocsGPT 使用 GenAI, 请使用来源审核关键信息.', '回答仅依据当前演示知识库；请通过来源核验关键信息。'],
      ['基于FAQ精简版V3知识库的RAG客服Agent，强化知识边界拒答并禁止无依据扩写。', '面向电商售后场景，检索 FAQ 知识库并生成带来源回答；超出知识边界时明确拒答。'],
      ['by Demo', '公开演示环境'],
    ]);

    document.querySelectorAll('h1, h2, p, div').forEach((node) => {
      const next = replacements.get(node.textContent.trim());
      if (next) node.textContent = next;
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
        <span><strong>企业售后知识库 Agent</strong><small>检索知识库并生成带来源的客服回答</small></span>
      </div>
      <div class="rag-demo-actions">
        <span class="rag-demo-health">知识库已连接</span>
        <a class="rag-demo-diagnostics" href="/ops/">评测与诊断</a>
      </div>`;
    document.body.append(header);
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
    panel.setAttribute('aria-label', '常用问题');
    panel.innerHTML = `<p>你可以直接提问，也可以从常用问题开始：</p><div class="rag-suggestion-list"></div>`;
    const list = panel.querySelector('.rag-suggestion-list');
    questions.forEach((question) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rag-suggestion';
      button.textContent = question;
      button.addEventListener('click', () => {
        input.value = question;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
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
