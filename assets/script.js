(function(){
  var t=document.querySelector('.nav-toggle'),m=document.getElementById('menu');
  if(t&&m){t.addEventListener('click',function(){var o=m.classList.toggle('open');t.setAttribute('aria-expanded',o)})}
  var els=document.querySelectorAll('.reveal');
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
    els.forEach(function(el){io.observe(el)});
  }else{els.forEach(function(el){el.classList.add('in')})}
  var c=document.getElementById('cookie'),ok=document.getElementById('cookie-ok'),seen=false;
  try{seen=localStorage.getItem('acella-cookie')==='1'}catch(e){}
  if(c&&!seen){c.style.display='block'}
  if(ok){ok.addEventListener('click',function(){c.style.display='none';try{localStorage.setItem('acella-cookie','1')}catch(e){}})}
  var f=document.getElementById('contact-form');
  if(f){f.addEventListener('submit',function(ev){
    ev.preventDefault();
    var d=new FormData(f);
    if(!d.get('nome')||!d.get('email')||!d.get('msg')){alert('Preencha nome, e-mail e mensagem.');return}
    var body='Nome: '+d.get('nome')+'\nEmpresa: '+d.get('empresa')+'\nE-mail: '+d.get('email')+'\nTelefone: '+d.get('tel')+'\nInteresse: '+d.get('interesse')+'\n\n'+d.get('msg');
    var el=document.getElementById('form-msg');el.style.display='block';
    window.location.href='mailto:'+f.dataset.to+'?subject='+encodeURIComponent('Contato pelo site – '+d.get('nome'))+'&body='+encodeURIComponent(body);
  })}
})();
