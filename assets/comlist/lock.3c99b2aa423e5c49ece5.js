

(function(){
  function b64d(s){var bin=atob(s);var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
  var REMEMBER_KEY="garden-pass", REMEMBER_MS=30*86400000;
  function recall(){try{var r=JSON.parse(localStorage.getItem(REMEMBER_KEY)||"null");if(r&&r.p&&r.exp>Date.now())return r.p;localStorage.removeItem(REMEMBER_KEY);}catch(e){}return "";}
  function remember(p){try{localStorage.setItem(REMEMBER_KEY,JSON.stringify({p:p,exp:Date.now()+REMEMBER_MS}));}catch(e){}}
  function forget(){try{localStorage.removeItem(REMEMBER_KEY);}catch(e){}}
  async function unlock(saved){
    var pass=typeof saved==="string"?saved:document.getElementById("lockpass").value;
    try{
      var km=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);
      var key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b64d(ENC.salt),iterations:ENC.it,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["decrypt"]);
      var pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64d(ENC.iv)},key,b64d(ENC.ct));
      var payload=JSON.parse(new TextDecoder().decode(pt));
      DATA=payload.contacts;
      DAILY_TASKS=payload.dailyTasks;
      window.FIELD_PROGRESS=payload.fieldProgress||null;
      if(typeof CALENDAR_AVAILABILITY!=="undefined")CALENDAR_AVAILABILITY=payload.calendarAvailability||null;
      window.PASSPHRASE=pass;
      if(typeof initializeSavedState === "function") await initializeSavedState(pass,DAILY_TASKS.date);
      if(typeof saved!=="string"&&document.getElementById("lockremember").checked)remember(pass);
      document.getElementById("lockgate").style.display="none";
      renderEvents(); setView("today");
      if(typeof refreshEventsFromApi === "function") refreshEventsFromApi();
      if(typeof refreshRegisteredPeople === "function") refreshRegisteredPeople();
    }catch(e){ if(typeof saved==="string"){forget();return;} document.getElementById("lockerr").textContent="パスフレーズが違います"; }
  }
  document.getElementById("lockbtn").addEventListener("click",function(){unlock();});
  document.getElementById("lockpass").addEventListener("keydown",function(e){if(e.key==="Enter")unlock();});
  var remembered=recall(); if(remembered) window.addEventListener("load",function(){unlock(remembered);});
})();
