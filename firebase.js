// ============================================================
// FIREBASE SDK
// ============================================================
import { initializeApp }                        from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword,
         signOut, onAuthStateChanged }           from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache,
         doc, getDoc, setDoc }                  from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';
import { getMessaging, getToken, onMessage }     from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging.js';

const firebaseConfig = {
  apiKey: "AIzaSyDPDQhBk0kEqd3enRzYLyd6PLgrxrLN09A",
  authDomain: "ca-inter-tracker.firebaseapp.com",
  projectId: "ca-inter-tracker",
  storageBucket: "ca-inter-tracker.firebasestorage.app",
  messagingSenderId: "122441200674",
  appId: "1:122441200674:web:419b41297f7cd29b59c67b"
};

const fbApp  = initializeApp(firebaseConfig);
const fbAuth = getAuth(fbApp);
// initializeFirestore with persistent cache (replaces deprecated enableIndexedDbPersistence)
const fbDb   = initializeFirestore(fbApp, { localCache: persistentLocalCache() });
const fbMsg  = getMessaging(fbApp);

const VAPID_KEY = "BErIvS56hL1TwGEo_gZPIcEKl7JbIczzu11IudC062CnLsUvrxGKoDfuB-IBg8rkWWLA4ZJfNTnXwKFpySa0qf4";

// Make available globally
window._fbAuth = fbAuth;
window._fbDb   = fbDb;
window._signInWithEmailAndPassword = signInWithEmailAndPassword;
window._signOut = signOut;
window._onAuthStateChanged = onAuthStateChanged;
window._doc    = doc;
window._getDoc = getDoc;
window._setDoc = setDoc;

window._fbMsg = fbMsg;
window._getToken = getToken;
window._onMessage = onMessage;
window._VAPID_KEY = VAPID_KEY;

// FIX: Call init() directly from the module script to guarantee no race conditions with DOMContentLoaded.
init();

// FIX: onAuthStateChanged is called from inside the module script to avoid race conditions.
  // Firebase auth state is the single gate — fires on page load automatically
  let _topBarInterval = null;
  onAuthStateChanged(fbAuth, async (user) => {
    if (user) {
      currentUser = user;
      const emailEl = document.getElementById('settings-user-email');
      if (emailEl) emailEl.textContent = user.email;
      await loadData();
      applyTheme(data.settings.theme);
      hideLoginScreen();
      updateTopBar();
      renderAll();
      // Auto-fullscreen if the user has it enabled
      if (data.settings.alwaysFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(()=>{});
      }
      // FIX: Clear previous interval before creating a new one to avoid leaks on re-login
      if (_topBarInterval) clearInterval(_topBarInterval);
      _topBarInterval = setInterval(updateTopBar, 60000);
      checkWeeklyBackupNudge();
      archiveDoneReminders();
      setTimeout(checkAndShowWelcome, 400);
      initNotifications();
    } else {
      currentUser = null;
      // Load defaults for theme before showing login
      try {
        // Use plain fallback key — no user UID available when logged out
        const raw = localStorage.getItem('jgsuffu_inter_data');
        data = raw ? JSON.parse(raw) : defaultData();
        normalizeData();
      } catch(e) { data = defaultData(); }
      applyTheme(data.settings.theme);
      showLoginScreen();
    }
  });
