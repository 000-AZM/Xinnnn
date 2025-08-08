// ===== Replace this with your Firebase config =====
const firebaseConfig = {
  apiKey: "AIzaSyCGN7t5FjDeJ-ewm7S_9z0VJrRSggTaJ2Q",
  authDomain: "coin-base-by-hector.firebaseapp.com",
  projectId: "coin-base-by-hector",
  // ... rest
};
// =================================================

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

/* ----------------- Helpers & UI init ----------------- */
document.addEventListener('DOMContentLoaded', function() {
  M.AutoInit();
});

/* Simple routing: shows sections by id */
function showSection(id) {
  document.querySelectorAll('main .section').forEach(s => s.style.display='none');
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
  // close profile edit by default
  if (id === 'profile') { /* nothing */ }
}

/* ---------- Auth UI handlers ---------- */
const authScreen = document.getElementById('auth-screen');
const appPages = document.getElementById('app-pages');

document.getElementById('show-signup').addEventListener('click', e=>{
  e.preventDefault();
  document.getElementById('signup-panel').style.display='block';
});
document.getElementById('show-login').addEventListener('click', e=>{
  e.preventDefault();
  document.getElementById('signup-panel').style.display='none';
});

document.getElementById('btn-signup').addEventListener('click', async ()=>{
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const age = parseInt(document.getElementById('signup-age').value || 0,10);

  if (!email.endsWith('@xinn.lab')) {
    return M.toast({html: 'Signup email must end with @xinn.lab'});
  }
  try {
    const created = await auth.createUserWithEmailAndPassword(email, password);
    const user = created.user;
    await user.updateProfile({ displayName: name });
    // create user doc
    await db.collection('users').doc(user.uid).set({
      displayName: name,
      email,
      bio: '',
      age: age || null,
      friends: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      theme: 'light'
    });
    M.toast({html: 'Account created!'});
  } catch (err) {
    console.error(err);
    M.toast({html: err.message});
  }
});

document.getElementById('btn-login').addEventListener('click', async ()=>{
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    M.toast({html: err.message});
  }
});

/* auth state */
let currentUser = null;
auth.onAuthStateChanged(async user=>{
  if (user) {
    currentUser = user;
    authScreen.style.display = 'none';
    appPages.style.display = 'block';
    // show feed by default
    showSection('feed');
    // load profile sidebar and user doc
    loadUserProfile(user.uid);
    listenPosts(); // realtime posts
    loadFriendRequests(); // realtime requests
    loadFriendsList();
    populateChatsList();
    document.getElementById('settings-email').innerText = user.email;
    document.getElementById('nav-profile-link').href = '#profile';
    window.location.hash = '#feed';
  } else {
    currentUser = null;
    authScreen.style.display = 'block';
    appPages.style.display = 'none';
    window.location.hash = '';
  }
});

/* Logout */
document.getElementById('btn-logout').addEventListener('click', async ()=>{
  await auth.signOut();
  M.toast({html:'Logged out'});
});

/* Change password (basic) */
document.getElementById('btn-change-pass').addEventListener('click', async ()=>{
  const newPass = prompt('Enter new password (min 6 chars)');
  if (!newPass) return;
  try {
    await auth.currentUser.updatePassword(newPass);
    M.toast({html:'Password changed'});
  } catch (err) {
    M.toast({html: err.message});
  }
});

/* Theme apply */
document.getElementById('apply-theme').addEventListener('click', async ()=>{
  const val = document.querySelector('input[name="theme"]:checked').value;
  document.body.classList.toggle('dark-theme', val==='dark');
  if (auth.currentUser) {
    await db.collection('users').doc(auth.currentUser.uid).update({theme: val});
  }
});

/* ------------- Profile load & edit ------------- */
async function loadUserProfile(uidToLoad) {
  // If no uid specified, load current user
  const uid = uidToLoad || (currentUser && currentUser.uid);
  if (!uid) return;
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) return;
  const data = doc.data();
  // Sidebar
  document.getElementById('sidebar-name').innerText = data.displayName || 'No name';
  document.getElementById('sidebar-bio').innerText = data.bio || '';
  document.getElementById('sidebar-age').innerText = data.age || '';
  // Profile page
  document.getElementById('profile-displayName').innerText = data.displayName || '';
  document.getElementById('profile-bio').innerText = data.bio || '';
  document.getElementById('profile-age').innerText = data.age || '';
  // store for edit
  window._loadedProfile = { uid, data };
  renderProfileActions(uid);
}

/* render profile actions depending on owner or visitor */
function renderProfileActions(profileUid) {
  const actions = document.getElementById('profile-actions');
  actions.innerHTML = '';
  const editForm = document.getElementById('profile-edit-form');
  editForm.style.display = 'none';

  if (currentUser.uid === profileUid) {
    // owner view
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.innerText = 'Edit profile';
    btn.addEventListener('click', ()=>{
      // show edit fields
      const p = window._loadedProfile.data;
      document.getElementById('edit-name').value = p.displayName || '';
      document.getElementById('edit-bio').value = p.bio || '';
      document.getElementById('edit-age').value = p.age || '';
      M.updateTextFields();
      editForm.style.display = 'block';
    });
    actions.appendChild(btn);
    // Save and cancel
    document.getElementById('save-profile').onclick = async ()=>{
      const newName = document.getElementById('edit-name').value;
      const newBio = document.getElementById('edit-bio').value;
      const newAge = parseInt(document.getElementById('edit-age').value || 0,10);
      await db.collection('users').doc(currentUser.uid).update({
        displayName: newName,
        bio: newBio,
        age: newAge || null
      });
      await currentUser.updateProfile({displayName: newName});
      M.toast({html:'Profile updated'});
      editForm.style.display='none';
      loadUserProfile(currentUser.uid);
    };
    document.getElementById('cancel-edit').onclick = ()=>{ editForm.style.display='none'; };
  } else {
    // visitor: show friend button or message
    const fromId = currentUser.uid;
    const toId = profileUid;
    // check friend status
    db.collection('users').doc(currentUser.uid).get().then(doc=>{
      const friends = (doc.data() && doc.data().friends) || [];
      if (friends.includes(profileUid)) {
        const chatBtn = document.createElement('button'); chatBtn.className='btn'; chatBtn.innerText='Message'; 
        chatBtn.addEventListener('click', ()=> openChatWith(profileUid));
        actions.appendChild(chatBtn);
      } else {
        const reqBtn = document.createElement('button'); reqBtn.className='btn'; reqBtn.innerText='Send Friend Request';
        reqBtn.addEventListener('click', async ()=>{
          await db.collection('friendRequests').add({
            fromId, toId, status:'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          M.toast({html:'Friend request sent'});
        });
        actions.appendChild(reqBtn);
      }
    });
  }
}

/* ------------- Posts & Feed ------------- */
document.getElementById('btn-post').addEventListener('click', async ()=>{
  const txt = document.getElementById('post-content').value.trim();
  if (!txt) return M.toast({html:'Write something first'});
  const p = {
    authorId: currentUser.uid,
    authorName: currentUser.displayName || currentUser.email,
    content: txt,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    likeCount: 0,
    likes: {}
  };
  await db.collection('posts').add(p);
  document.getElementById('post-content').value='';
  M.updateTextFields();
  M.toast({html:'Posted'});
});

/* Listen posts in realtime ordered by latest */
let postsUnsub = null;
function listenPosts() {
  if (postsUnsub) postsUnsub();
  postsUnsub = db.collection('posts').orderBy('createdAt','desc').onSnapshot(snap=>{
    const container = document.getElementById('posts-list');
    container.innerHTML = '';
    snap.forEach(doc=>{
      const d = doc.data();
      const id = doc.id;
      const card = renderPostCard(id, d);
      container.appendChild(card);
    });
  });
}

function renderPostCard(id, data) {
  const card = document.createElement('div');
  card.className = 'card';
  const author = data.authorName || 'Unknown';
  const created = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toLocaleString() : '';
  const likeCount = data.likeCount || 0;
  card.innerHTML = `
    <div class="card-content">
      <span class="card-title">${author}</span>
      <p class="post-meta">${created}</p>
      <p>${escapeHtml(data.content)}</p>
      <p style="margin-top:1rem">
        <a class="like-btn" data-id="${id}"><i class="material-icons">thumb_up</i> <span class="like-count">${likeCount}</span></a>
      </p>
    </div>
  `;
  // like button handler
  card.querySelector('.like-btn').addEventListener('click', async ()=>{
    const postRef = db.collection('posts').doc(id);
    await db.runTransaction(async tx=>{
      const doc = await tx.get(postRef);
      if (!doc.exists) return;
      const likes = doc.data().likes || {};
      const uid = currentUser.uid;
      let likeCount = doc.data().likeCount || 0;
      if (likes[uid]) {
        delete likes[uid];
        likeCount = Math.max(0, likeCount-1);
      } else {
        likes[uid] = true;
        likeCount = (likeCount||0)+1;
      }
      tx.update(postRef, { likes, likeCount });
    });
  });
  return card;
}

/* ------------- Friend Requests & Friends ------------- */
function loadFriendRequests() {
  const list = document.getElementById('friend-requests-list');
  db.collection('friendRequests')
    .where('toId','==', currentUser.uid)
    .where('status','==','pending')
    .onSnapshot(snap=>{
      list.innerHTML = '';
      snap.forEach(doc=>{
        const d = doc.data(); const id = doc.id;
        const el = document.createElement('div');
        el.innerHTML = `<div><strong>${d.fromId}</strong> sent request — <a href="#" data-id="${id}" class="accept">Accept</a> | <a href="#" data-id="${id}" class="decline">Decline</a></div>`;
        list.appendChild(el);

        el.querySelector('.accept').addEventListener('click', async (ev)=>{
          ev.preventDefault();
          // accept: add each other to friends arrays
          const req = d;
          await db.collection('friendRequests').doc(id).update({status:'accepted'});
          const batch = db.batch();
          const fromRef = db.collection('users').doc(req.fromId);
          const toRef = db.collection('users').doc(req.toId);
          batch.update(fromRef, { friends: firebase.firestore.FieldValue.arrayUnion(req.toId) });
          batch.update(toRef, { friends: firebase.firestore.FieldValue.arrayUnion(req.fromId) });
          await batch.commit();
          M.toast({html:'Friend request accepted'});
        });
        el.querySelector('.decline').addEventListener('click', async (ev)=>{
          ev.preventDefault();
          await db.collection('friendRequests').doc(id).update({status:'declined'});
          M.toast({html:'Request declined'});
        });
      });
    });
}

/* load current user's friends list */
async function loadFriendsList() {
  db.collection('users').doc(currentUser.uid).onSnapshot(doc=>{
    const data = doc.data() || {};
    const friends = data.friends || [];
    const container = document.getElementById('friends-list');
    container.innerHTML = '';
    if (friends.length === 0) {
      container.innerHTML = '<li class="collection-item">No friends yet</li>';
      return;
    }
    friends.forEach(async uid=>{
      const udoc = await db.collection('users').doc(uid).get();
      const u = udoc.data();
      const li = document.createElement('li');
      li.className = 'collection-item';
      li.innerHTML = `<span>${u.displayName || u.email}</span><a class="secondary-content" href="#" data-uid="${uid}">Message</a>`;
      container.appendChild(li);
      li.querySelector('a').addEventListener('click', (ev)=>{
        ev.preventDefault();
        openChatWith(uid);
      });
    });
  });
}

/* Search users and show add friend button */
document.getElementById('search-user').addEventListener('input', async function() {
  const q = this.value.trim();
  const container = document.getElementById('search-results');
  container.innerHTML = '';
  if (!q) return;
  // naive search: query users where displayName >= q
  const snap = await db.collection('users').orderBy('displayName').startAt(q).endAt(q+'\uf8ff').limit(10).get();
  snap.forEach(doc=>{
    const d = doc.data();
    const uid = doc.id;
    const card = document.createElement('div');
    card.innerHTML = `<div><strong>${d.displayName}</strong> (${d.email}) <button class="btn btn-small add" data-uid="${uid}">Send Request</button></div>`;
    container.appendChild(card);
    card.querySelector('.add').addEventListener('click', async ()=>{
      await db.collection('friendRequests').add({
        fromId: currentUser.uid, toId: uid, status:'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      M.toast({html:'Friend request sent'});
    });
  });
});

/* ------------- Chat system ------------- */
async function populateChatsList() {
  // show friends for quick chat
  const fl = document.getElementById('chat-friend-list');
  fl.innerHTML = '';
  const udoc = await db.collection('users').doc(currentUser.uid).get();
  const friends = (udoc.data() && udoc.data().friends) || [];
  for (const uid of friends) {
    const fdoc = await db.collection('users').doc(uid).get();
    const f = fdoc.data();
    const li = document.createElement('li');
    li.className = 'collection-item';
    li.innerHTML = `<div>${f.displayName || f.email}<a href="#" class="secondary-content open-chat" data-uid="${uid}"><i class="material-icons">chat</i></a></div>`;
    fl.appendChild(li);
  }
  fl.querySelectorAll('.open-chat').forEach(btn=>{
    btn.addEventListener('click', (ev)=>{
      ev.preventDefault();
      const uid = btn.getAttribute('data-uid');
      openChatWith(uid);
    });
  });
}

let currentChatId = null;
let messagesUnsub = null;
async function openChatWith(otherUid) {
  // create deterministic chatId for two members
  const members = [currentUser.uid, otherUid].sort();
  const chatId = members.join('_');
  currentChatId = chatId;
  const chatDocRef = db.collection('chats').doc(chatId);
  const chatDoc = await chatDocRef.get();
  if (!chatDoc.exists) {
    await chatDocRef.set({ members, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
  // show chat UI
  document.getElementById('no-chat').style.display='none';
  document.getElementById('chat-window').style.display='block';
  const otherDoc = await db.collection('users').doc(otherUid).get();
  const other = otherDoc.data();
  document.getElementById('chat-with-name').innerText = other.displayName || other.email;
  // listen messages
  if (messagesUnsub) messagesUnsub();
  messagesUnsub = chatDocRef.collection('messages').orderBy('createdAt').onSnapshot(snap=>{
    const box = document.getElementById('messages');
    box.innerHTML = '';
    snap.forEach(doc=>{
      const m = doc.data();
      const el = document.createElement('div');
      el.style.margin = '4px 0';
      el.innerHTML = `<strong>${m.from === currentUser.uid ? 'You' : other.displayName}:</strong> ${escapeHtml(m.text)} <div style="font-size:.8rem;color:#666">${m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().toLocaleString() : ''}</div>`;
      box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
  });
  // send message
  document.getElementById('send-msg').onclick = async ()=>{
    const text = document.getElementById('chat-input').value.trim();
    if (!text) return;
    await chatDocRef.collection('messages').add({
      from: currentUser.uid, text, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('chat-input').value='';
    M.updateTextFields();
  };
}

/* ------------- Utility functions ------------- */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Navigation hash handling */
window.addEventListener('hashchange', ()=>{
  const hash = window.location.hash.replace('#','') || 'feed';
  showSection(hash);
  if (hash === 'profile') loadUserProfile(currentUser.uid);
  if (hash === 'friends') { loadFriendsList(); populateChatsList(); }
  if (hash === 'chat') populateChatsList();
});

/* Initialize to feed when loaded */
if (window.location.hash) {
  const h = window.location.hash.replace('#','');
  setTimeout(()=> showSection(h), 200);
} else {
  setTimeout(()=> showSection('feed'), 200);
}
