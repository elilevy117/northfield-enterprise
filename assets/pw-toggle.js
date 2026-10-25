// Adds a Show/Hide button to every password field on the page.
(function(){
  var css='.pwt{position:relative;display:block}.pwt>input{padding-right:64px!important}.pwt>.pwt-b{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;padding:8px 10px;border-radius:8px;font:600 13px "Public Sans",system-ui,sans-serif;color:#11345D;cursor:pointer}.pwt>.pwt-b:hover{background:#EEF2F7}';
  var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  function wire(i){
    if(i.dataset.pwt||i.closest('.pw'))return;i.dataset.pwt='1';
    var w=document.createElement('span');w.className='pwt';i.parentNode.insertBefore(w,i);w.appendChild(i);
    var b=document.createElement('button');b.type='button';b.className='pwt-b';b.textContent='Show';b.setAttribute('aria-label','Show password');
    b.onclick=function(){var on=i.type==='password';i.type=on?'text':'password';b.textContent=on?'Hide':'Show';b.setAttribute('aria-label',on?'Hide password':'Show password');i.focus()};
    w.appendChild(b);
  }
  function scan(){document.querySelectorAll('input[type=password]').forEach(wire)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
