(() => {
  const form=document.getElementById('setup-upload'); if(!form)return;
  form.addEventListener('submit',async event=>{
    const files=[...form.elements.file.files];if(!files.length)return;event.preventDefault();
    const button=form.querySelector('button[type=submit]'),list=document.getElementById('upload-results');button.disabled=true;list.replaceChildren();
    for(let index=0;index<files.length;index++){
      const row=document.createElement('li');row.textContent=`${index+1}/${files.length} · Uploading ${files[index].name}…`;list.append(row);
      const data=new FormData(form);data.delete('file');data.append('file',files[index]);
      try{const response=await fetch(form.action,{method:'POST',headers:{Accept:'application/json'},body:data});const result=await response.json();const file=result.files?.[0];if(!response.ok||!file?.ok)throw new Error(file?.message || 'Upload was not accepted.');row.textContent=`${files[index].name} · uploaded privately · safety checks pending`;}
      catch(error){row.textContent=`${files[index].name} · ${error.message}`;row.className='error';}
    }
    button.disabled=false;const refresh=document.createElement('a');refresh.href=location.href;refresh.textContent='Refresh file list →';list.append(refresh);
  });
})();
