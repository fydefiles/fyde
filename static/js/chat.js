(() => {
  const form = document.getElementById('chat-form'); if (!form) return;
  const log = document.getElementById('chat-log'), input = document.getElementById('chat-message'), status = document.getElementById('chat-status');
  let busy = false;
  const element = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const card = (container, title, detail, url) => { const e = element(url ? 'a' : 'div', '', 'chat-card'); if (url) e.href = url; e.append(element('strong', title), element('span', detail)); container.append(e); return e; };
  const choice = (container, turn, title, detail, data) => { const e = element('button', '', 'chat-card'); e.type = 'button'; e.dataset.turn = turn; Object.assign(e.dataset, data); e.append(element('strong', title), element('span', detail)); container.append(e); };
  function render(turn) {
    document.getElementById('chat-welcome')?.remove();
    const article = element('article', '', 'chat-exchange'); article.dataset.turn = turn.id;
    const user = element('div', '', 'chat-user'); user.append(element('span','You','chat-speaker'),element('p',turn.message));
    const assistant = element('div','','chat-assistant'); assistant.append(element('span','✳ Fyde','chat-speaker'),element('p',turn.reply));
    const cards = element('div','','chat-cards'), result = turn.result;
    (result.files || []).forEach(file => {
      if (result.kind === 'clarify') choice(cards,turn.id,file.title,`${file.name} · v${file.number} · ${file.state}`,{version:file.id});
      else if (result.kind === 'received') {
        const download = element('form','','chat-card'); download.method='post'; download.action=file.download_url;
        const csrf = element('input'); csrf.type='hidden'; csrf.name='csrfmiddlewaretoken'; csrf.value=form.elements.csrfmiddlewaretoken.value;
        const button=element('button','Download file ↓','text-button');download.append(element('strong',`${file.title} · v${file.number}`),csrf,button);cards.append(download);
      } else card(cards,file.title,`${file.name} · v${file.number} · ${file.state}`,file.url);
    });
    (result.contacts || []).forEach(c=>choice(cards,turn.id,c.name,`${c.relationship || ''} · ${c.endpoint}`,{contact:c.id}));
    (result.policies || []).forEach(p=>choice(cards,turn.id,p.name,`From ${p.from}`,{policy:p.id}));
    (result.transfers || []).forEach(t=>card(cards,t.title,t.message || `${t.state.replaceAll('_',' ')} · View receipt ↗`,t.url));
    if (result.kind === 'policy_draft') card(cards,'Review automatic sharing','Choose the scope once →',`/app/setup/?step=permissions&contact_id=${encodeURIComponent(result.contact_id)}&matter_id=${encodeURIComponent(result.matter_id)}`);
    if (result.remaining_versions?.length) choice(cards,turn.id,'Send next batch',`${result.remaining_versions.length} files remain`,{remaining:'true'});
    assistant.append(cards);article.append(user,assistant);log.append(article); log.scrollTop=log.scrollHeight;
  }
  async function send(text, selected) {
    if(busy) return; busy=true; form.setAttribute('aria-busy','true'); status.textContent='Checking files and permissions…';
    const payload={message:text,operation_id:form.elements.operation_id.value,channel:form.elements.channel.value}; if(selected)payload.choice=selected;
    try {
      const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':form.elements.csrfmiddlewaretoken.value},body:JSON.stringify(payload)});
      const result=await response.json(); if(!response.ok)throw new Error(result.message || 'Message could not be processed.');
      render(result); input.value=''; form.elements.operation_id.value=crypto.randomUUID();status.textContent='';
    }catch(error){status.textContent=error.message || 'Connection lost. Your message is still here; retry when connected.';}
    finally{busy=false;form.removeAttribute('aria-busy');input.focus({preventScroll:true});}
  }
  log.scrollTop=log.scrollHeight;
  form.addEventListener('submit',e=>{e.preventDefault();if(input.value.trim())send(input.value.trim());});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}});
  document.addEventListener('click',e=>{const prompt=e.target.closest('[data-prompt]');if(prompt){input.value=prompt.dataset.prompt;input.focus();return;}
    const button=e.target.closest('button[data-turn]');if(!button)return;
    const selected={turn_id:button.dataset.turn}; if(button.dataset.version)selected.version_id=button.dataset.version;if(button.dataset.contact)selected.contact_id=button.dataset.contact;if(button.dataset.policy)selected.policy_id=button.dataset.policy;if(button.dataset.remaining)selected.remaining=true;
    send(button.dataset.remaining?'Send the next batch':`Use ${button.querySelector('strong')?.textContent || 'this choice'}`,selected);
  });
})();
