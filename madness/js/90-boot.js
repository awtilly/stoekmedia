/* ── Boot ── */
const params = new URLSearchParams(window.location.search);
const tabParam = params.get("tab");
let urlRoom = sanitizeRoomCode(params.get("room")); // "" (falsy) for junk => lobby

// Home-screen shortcuts (manifest.json) open ./?tab=... with no room param.
// Fall back to the most recently used room so they land in the right tournament.
if(!urlRoom && tabParam){
  const recent = getRecentRooms()[0];
  if(recent) urlRoom = sanitizeRoomCode(recent.code);
}

if(urlRoom){
  roomId = urlRoom;
  if(!params.get("room")){
    const url = new URL(window.location);
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url);
  }
  loadState();
  if(!S.bracket) S.bracket = {South:Array(15).fill(null), East:Array(15).fill(null), Midwest:Array(15).fill(null), West:Array(15).fill(null), ff:Array(3).fill(null)};
  if(!S.bracketRegion) S.bracketRegion = "South";
  if(!S.games) S.games = [];
  syncGames();
  checkAdminSession();
  connectToRoom(roomId);
  if (tabParam && ['live','bracket','leaderboard','draft'].includes(tabParam)) {
    S.phase = tabParam;
  }
  render();
} else {
  if (tabParam === 'live') {
    // No room known at all: render the app shell first, otherwise refreshLiveScores()
    // finds no #c element and the page stays blank.
    loadState();
    S.phase = 'live';
    render();
    startLiveRefresh();
  } else {
    renderLobby();
  }
}

/* ── Service Worker & Install Banner ── */
// Inside a Capacitor shell (see docs/ios-app-store-plan.md) the web code is bundled in the app:
// WKWebView has no service worker for the capacitor:// scheme and "install" makes no sense.
const isNativeShell = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());

if('serviceWorker' in navigator && !isNativeShell){
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if(!newSW) return;
      newSW.addEventListener('statechange', () => {
        if(newSW.state === 'activated' && navigator.serviceWorker.controller){
          showUpdateBanner();
        }
      });
    });
  }).catch(err => console.warn('SW registration failed:', err));
}

function showUpdateBanner(){
  if(document.getElementById('update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'update-banner';
  banner.innerHTML = `<span>A new version is available.</span><button class="btn-install" onclick="location.reload()">Refresh</button><button class="btn-dismiss" onclick="this.parentElement.remove()">&times;</button>`;
  document.body.appendChild(banner);
}

let deferredInstallPrompt = null;
const INSTALL_DISMISS_KEY = 'mm4_install_dismissed';
const INSTALL_DISMISS_DAYS = 14;

function installBannerDismissed(){
  try {
    const ts = Number(localStorage.getItem(INSTALL_DISMISS_KEY));
    return ts > 0 && Date.now() - ts < INSTALL_DISMISS_DAYS * 86400 * 1000;
  } catch(e){ return false; }
}

function isStandalone(){
  return isNativeShell
    || window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function showInstallBanner(){
  if(isStandalone()) return;
  if(installBannerDismissed()) return;
  if(document.getElementById('install-banner')) return;

  const isIOS = isIOSDevice();
  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.className = 'install-banner';
  banner.innerHTML = `
    <img class="install-banner-icon" src="icons/icon-192.png" alt="App icon">
    <div class="install-banner-text">
      Install March Madness Draft
      <small>${isIOS ? 'Tap Share then "Add to Home Screen"' : 'Add to your home screen for quick access'}</small>
    </div>
    ${isIOS ? '' : '<button class="btn-install" onclick="installApp()">Install</button>'}
    <button class="btn-dismiss" onclick="dismissInstallBanner(true)">&times;</button>`;
  document.body.appendChild(banner);
  repositionInstallBanner();
}

function dismissInstallBanner(remember){
  const banner = document.getElementById('install-banner');
  if(banner) banner.remove();
  // Remember an explicit dismissal so the banner does not come back on every visit.
  if(remember){ try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch(e){} }
}

function repositionInstallBanner(){
  const banner = document.getElementById('install-banner');
  if(!banner) return;
  const bottomNav = document.querySelector('.bottom-nav');
  if(bottomNav && window.innerWidth <= 700){
    banner.style.bottom = bottomNav.offsetHeight + 'px';
    banner.style.paddingBottom = '14px';
  } else {
    banner.style.bottom = '';
    banner.style.paddingBottom = '';
  }
}

async function installApp(){
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const result = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  dismissInstallBanner();
  if(result.outcome === 'accepted') showToast('App installed!');
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  dismissInstallBanner();
  showToast('App installed!');
});

// On iOS, show the banner after a short delay since there's no beforeinstallprompt
if(isIOSDevice() && !isStandalone()){
  setTimeout(showInstallBanner, 2000);
}
