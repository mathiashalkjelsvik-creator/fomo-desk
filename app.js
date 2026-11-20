// app.js - plain JS, no framework, no build step (STEP 10). Token arrives once as #t=..., kept in localStorage.
(function(){
  const m = location.hash.match(/[#&]t=([^&]+)/);
  if (m) { localStorage.setItem("desk_token", m[1]); history.replaceState(null, "", location.pathname); }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
