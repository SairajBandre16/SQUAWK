// Accounts: Google or email sign-in through Firebase Auth, and one Firestore document per spotter (users/{uid}).
// The SDK loads only when a project is configured, so Squawk runs the same without it.
import { firebaseConfig } from './firebase-config.js';

const V = 'https://www.gstatic.com/firebasejs/12.19.0/';
export const cloudOn = !!firebaseConfig.apiKey;
let A = null, F = null, auth = null, db = null, boot = null;

function load() {
  return boot || (boot = (async () => {
    const [app, a, f] = await Promise.all([import(V + 'firebase-app.js'), import(V + 'firebase-auth.js'), import(V + 'firebase-firestore.js')]);
    A = a; F = f;
    const fb = app.initializeApp(firebaseConfig);
    auth = a.getAuth(fb); db = f.initializeFirestore(fb, { ignoreUndefinedProperties: true });
    try { await a.getRedirectResult(auth); } catch (e) { /* a redirect sign-in that failed shows up as signed out */ }
  })());
}

/** Calls cb(user or null) now and on every change. user is { uid, name, email, photo }. */
export async function onUser(cb) {
  if (!cloudOn) return;
  try { await load(); } catch (e) { return; }
  A.onAuthStateChanged(auth, u => cb(u && { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' }));
}

export async function signInGoogle() {
  await load(); const p = new A.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
  try { await A.signInWithPopup(auth, p); }
  catch (e) { if (/popup-blocked|operation-not-supported/.test(e.code)) await A.signInWithRedirect(auth, p); else throw e; }
}
export async function signInEmail(email, pw, create) {
  await load(); await (create ? A.createUserWithEmailAndPassword : A.signInWithEmailAndPassword)(auth, email, pw);
}
export async function resetPassword(email) { await load(); await A.sendPasswordResetEmail(auth, email); }
export async function signOut() { await load(); await A.signOut(auth); }

/** Friendly text for an auth error. */
export function authError(e) {
  const c = e?.code || '';
  return /invalid-credential|wrong-password|user-not-found|invalid-login/.test(c) ? 'That email and password don\'t match an account.'
    : /email-already-in-use/.test(c) ? 'There\'s already an account with that email. Sign in instead.'
    : /weak-password/.test(c) ? 'Use a password of at least 6 characters.'
    : /invalid-email/.test(c) ? 'That doesn\'t look like an email address.'
    : /popup-closed|cancelled-popup/.test(c) ? ''
    : /too-many-requests/.test(c) ? 'Too many tries. Wait a minute and try again.'
    : /network-request-failed/.test(c) ? 'You look offline. Check your connection and try again.'
    : /unauthorized-domain|operation-not-allowed|api-key|configuration-not-found/.test(c) ? 'Sign-in isn\'t set up for this site yet.'
    : 'Sign-in didn\'t work just now. Try again.';
}

const plain = o => JSON.parse(JSON.stringify(o));
/**
 * Merges the stored log with this device's copy in one transaction and writes the result back,
 * so two devices spotting at once both keep their catches. The profile (name, picture) is last-edit-wins by its `at`.
 * Returns { log, profile }: the merged log and the newest profile.
 */
export async function syncLog(uid, local, merge, prof) {
  await load(); const ref = F.doc(db, 'users', uid);
  return F.runTransaction(db, async t => {
    const s = await t.get(ref), d = s.exists() ? s.data() : {}, m = merge(d.log || null, local);
    const up = !!prof && (prof.at || 0) > (d.profile?.at || 0);
    t.set(ref, up ? { log: plain(m), profile: plain(prof), at: F.serverTimestamp() } : { log: plain(m), at: F.serverTimestamp() }, { mergeFields: up ? ['log', 'profile', 'at'] : ['log', 'at'] });
    return { log: m, profile: up ? prof : d.profile || null };
  });
}
