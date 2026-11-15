import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, onSnapshot, query, orderBy, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";
import { firebaseConfig, VAPID_KEY, NOTIFY_WEBHOOK } from "./firebase-config.js";

const STORES = [
  "C971 Atatürk Cd.", "C963 Anıt", "C974 Larende", "C981 Ahmet Özcan",
  "U957 Diş Hastanesi", "D578 Çaybaşı", "C990 Uzunharmanlar", "D031 Gazanfer"
];
const SIGN = "Kolay gelsin, iyi çalışmalar.";

// Ana sayfadaki butonlar (6 adet). Yeni buton eklemek için bir satır eklemek yeterli.
const BUTTONS = [
  { key: "asansor", label: "Asansör Servis", subject: "Asansör Arızası Servis Hk.",
    body: s => `Merhaba Berna Hanım,\n${s}\n\nMağazamızın asansöründe arıza vardır servis konusunda desteklerinizi rica ederiz.\n\n${SIGN}` },
  { key: "appstore", label: "Hatalı App Store", subject: "Hatalı App Store Hk.",
    body: s => `Merhaba Berna Hanım,\n\n${s}\n\nMağazamızdan alınan App Store ürünü kullanılamamaktadır kontrol edip dönüş sağlayabilir misiniz?\n\n${SIGN}` },
  { key: "gplay", label: "Hatalı Google Play", subject: "Hatalı Google Play Hk.",
    body: s => `Merhaba Berna Hanım,\n\n${s}\n\nMağazamızdan alınan Google Play ürünü kullanılamamaktadır kontrol edip dönüş sağlayabilir misiniz?\n\n${SIGN}` },
  { key: "yatay", label: "Yatay Dolap Arızası", subject: "Yatay Dolap Arızası Hk.",
    body: s => `Merhaba Berna Hanım,\n${s}\n\nMağazamızın yatay dolap arızası vardır, servis konusunda desteklerinizi rica ediyorum.\n\n${SIGN}` },
  { key: "adet", label: "Adet Toplatma", special: "adet" },
  { key: "kasa", label: "Kasa Hata Formu", subject: "Kasa Hata Formu",
    body: s => `Merhaba Elif Hanım,\n${s}\n\nKasa hata formunu paylaşabilir misiniz?\n\n${SIGN}` },
];

const $ = id => document.getElementById(id);
const toast = (m) => { const t = $("toast"); t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2600); };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- Firebase ----------
const configured = !firebaseConfig.apiKey.startsWith("YOUR");
let db = null, app = null;
if (configured) { app = initializeApp(firebaseConfig); db = getFirestore(app); }

let mails = JSON.parse(localStorage.getItem("gd_mails") || "{}");
let reports = [];
let swReg = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then(r => swReg = r).catch(() => {});
}

async function loadMails() {
  if (!db) return;
  try {
    const s = await getDoc(doc(db, "settings", "mails"));
    if (s.exists()) { mails = s.data(); localStorage.setItem("gd_mails", JSON.stringify(mails)); }
  } catch (e) { console.warn(e); }
}

// ---------- Sayfa yönetimi ----------
const stack = [];
function show(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("show"));
  $(id).classList.add("show");
  window.scrollTo(0, 0);
}
function go(id) { stack.push(document.querySelector(".page.show").id); show(id); }
document.addEventListener("click", e => { if (e.target.matches("[data-back]")) show(stack.pop() || "home"); });

// ---------- Mail ----------
function openMail(btn, store) {
  const to = (mails[btn.key] || "").trim();
  if (!to) { toast("Bu buton için mail adresi tanımlı değil (/admin)"); return; }
  location.href = `mailto:${to}?subject=${encodeURIComponent(btn.subject)}&body=${encodeURIComponent(btn.body(store))}`;
}

// ---------- Ana sayfa ----------
function renderTiles() {
  const pending = reports.filter(r => r.status === "pending").length;
  $("tiles").innerHTML = BUTTONS.map(b => {
    const badge = (b.special === "adet" && pending > 0) ? `<span class="badge">${pending}</span>` : "";
    return `<button class="tile" data-key="${b.key}">${esc(b.label)}${badge}</button>`;
  }).join("");
  if ("setAppBadge" in navigator) { (pending ? navigator.setAppBadge(pending) : navigator.clearAppBadge()).catch(() => {}); }
}
$("tiles").addEventListener("click", e => {
  const t = e.target.closest(".tile"); if (!t) return;
  const b = BUTTONS.find(x => x.key === t.dataset.key);
  if (b.special === "adet") { renderAdetList(); go("adetPage"); return; }
  $("storeTitle").textContent = b.label;
  $("storeList").innerHTML = STORES.map(s => {
    const [kod, ...rest] = s.split(" ");
    return `<button class="store" data-store="${esc(s)}"><b>${esc(kod)}</b> ${esc(rest.join(" "))}</button>`;
  }).join("");
  $("storeList").dataset.key = b.key;
  go("storePage");
});
$("storeList").addEventListener("click", e => {
  const s = e.target.closest(".store"); if (!s) return;
  openMail(BUTTONS.find(x => x.key === $("storeList").dataset.key), s.dataset.store);
});

// ---------- /admin ----------
function renderAdmin() {
  $("mailFields").innerHTML = BUTTONS.map(b => `<label>${esc(b.label)}</label><input data-mk="${b.key}" type="text" inputmode="email" placeholder="ornek@firma.com" value="${esc(mails[b.key] || "")}">`).join("");
}
$("saveMails").addEventListener("click", async () => {
  const m = {};
  document.querySelectorAll("[data-mk]").forEach(i => m[i.dataset.mk] = i.value.trim());
  mails = m; localStorage.setItem("gd_mails", JSON.stringify(m));
  if (db) { try { await setDoc(doc(db, "settings", "mails"), m); toast("Kaydedildi"); } catch { toast("Firebase'e yazılamadı"); } }
  else toast("Bu cihaza kaydedildi (Firebase ayarlı değil)");
});
$("notifBtn").addEventListener("click", enablePush);

async function enablePush() {
  try {
    if (!db || !VAPID_KEY) { toast("firebase-config.js içinde VAPID_KEY gerekli"); return; }
    if (!(await isSupported())) { toast("Bu tarayıcı push desteklemiyor"); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Bildirim izni verilmedi"); return; }
    const reg = swReg || await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    await setDoc(doc(db, "tokens", token.slice(-40)), { token, at: serverTimestamp() });
    toast("Bildirimler açıldı");
  } catch (e) { console.error(e); toast("Bildirim açılamadı"); }
}

// ---------- /talep : mağaza bildirimi ----------
const photos = [null, null];
function compress(file, max = 900, q = 0.6) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = img.width * k; c.height = img.height * k;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", q));
    };
    img.onerror = rej; img.src = url;
  });
}
const photoHTML = (i, n) => n ? `<img src="${n}"><input type="file" accept="image/*" capture="environment">`
  : `<span>+ Fotoğraf ${i + 1}</span><input type="file" accept="image/*" capture="environment">`;
// innerHTML yenilense de çalışsın diye olay delegasyonu
document.addEventListener("change", async e => {
  const box = e.target.closest("#ph1,#ph2"); if (!box || !e.target.files) return;
  const f = e.target.files[0]; if (!f) return;
  const i = box.id === "ph1" ? 0 : 1;
  try { photos[i] = await compress(f); box.innerHTML = photoHTML(i, photos[i]); } catch { toast("Fotoğraf okunamadı"); }
});
const only = (id, re) => $(id).addEventListener("input", e => e.target.value = e.target.value.replace(re, ""));
only("fKod", /\D/g); only("fAdet", /\D/g);
only("fSkt", /[^\d\s.\/-]/g);
only("fProb", /[^A-Za-zÇĞİÖŞÜçğıöşü\s]/g);
only("eKod", /\D/g); only("eAdet", /\D/g);

function initTalep() {
  $("storeOpts").innerHTML = STORES.map(s => `<option value="${esc(s)}">`).join("");
  $("fStore").value = localStorage.getItem("gd_store") || "";
  if (!configured) toast("Firebase ayarı yapılmadan bildirim gönderilemez");
  renderTalepArchive();
}
$("sendAdet").addEventListener("click", async () => {
  if (!db) { toast("Firebase ayarlı değil"); return; }
  const d = { store: $("fStore").value.trim(), kod: $("fKod").value.trim(), ad: $("fAd").value.trim(),
    skt: $("fSkt").value.trim(), pno: $("fPno").value.trim(), prob: $("fProb").value.trim(), adet: $("fAdet").value.trim() };
  if (!d.store || !d.kod || !d.ad || !d.adet) { toast("Mağaza, ürün kodu, ürün adı ve adet zorunlu"); return; }
  if (!photos[0] && !photos[1]) { toast("En az 1 fotoğraf ekle"); return; }
  $("sendAdet").disabled = true;
  try {
    await addDoc(collection(db, "reports"), { ...d, img1: photos[0] || "", img2: photos[1] || "", status: "pending", createdAt: serverTimestamp() });
    localStorage.setItem("gd_store", d.store);
    if (NOTIFY_WEBHOOK) fetch(NOTIFY_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Yeni adet toplatma", body: `${d.store} – ${d.ad}` }) }).catch(() => {});
    ["fKod", "fAd", "fSkt", "fPno", "fProb", "fAdet"].forEach(i => $(i).value = "");
    photos[0] = photos[1] = null;
    $("ph1").innerHTML = photoHTML(0, null); $("ph2").innerHTML = photoHTML(1, null);
    toast("Gönderildi – onay bekleniyor");
  } catch (e) { console.error(e); toast("Gönderilemedi"); }
  $("sendAdet").disabled = false;
});

function fmt(ts) {
  const d = ts?.toDate ? ts.toDate() : null; if (!d) return "…";
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
const tagOf = r => `<span class="tag ${r.status === "approved" ? "ok" : ""}">${r.status === "approved" ? "Onaylandı" : "Gönderildi – onay bekleniyor"}</span>`;

function renderTalepArchive() {
  const el = $("archive");
  if (!configured) { el.innerHTML = `<p class="sub">Firebase ayarlanınca burada görünür.</p>`; return; }
  if (!reports.length) { el.innerHTML = `<p class="sub">Henüz bildirim yok.</p>`; return; }
  el.innerHTML = reports.map(r => `
    <div class="item">
      <div class="top"><span><b>${esc(r.store)}</b></span><span>${fmt(r.createdAt)}</span></div>
      ${tagOf(r)}<p>${esc(r.ad)} – ${esc(r.adet)} adet</p>
    </div>`).join("");
}

// ---------- Adet toplatma (ana sayfa butonu): gelen bildirimler ----------
function renderAdetList() {
  const el = $("adetList");
  if (!configured) { el.innerHTML = `<p class="sub">Firebase ayarlanınca burada görünür.</p>`; return; }
  if (!reports.length) { el.innerHTML = `<p class="sub">Henüz bildirim yok.</p>`; return; }
  el.innerHTML = reports.map(r => `
    <div class="item" data-id="${r.id}">
      <div class="top"><span><b>${esc(r.store)}</b></span><span>${fmt(r.createdAt)}</span></div>
      ${tagOf(r)}
      <div class="imgs">${r.img1 ? `<img src="${r.img1}">` : ""}${r.img2 ? `<img src="${r.img2}">` : ""}</div>
      <p><b>Ürün kodu:</b> ${esc(r.kod)}</p><p><b>Ürün adı:</b> ${esc(r.ad)}</p>
      <p><b>SKT:</b> ${esc(r.skt)} &nbsp; <b>PNO:</b> ${esc(r.pno)}</p>
      <p><b>Problem:</b> ${esc(r.prob)} &nbsp; <b>Adet:</b> ${esc(r.adet)}</p>
      <div class="acts"><button data-act="edit">Düzenle</button><button data-act="share">Görselleri paylaş</button><button class="go" data-act="ok">${r.status === "approved" ? "Tekrar maile aktar" : "Onayla"}</button></div>
      <div class="acts"><button data-act="del">Sil</button></div>
    </div>`).join("");
}
function adetBody(r) {
  return `Merhaba Berna Hanım,\n\nAşağıdaki ürün için adet toplatılması konusunda destek rica ediyorum.\n\n` +
    `Mağaza: ${r.store}\nÜrün kodu: ${r.kod}\nÜrün adı: ${r.ad}\nSKT: ${r.skt}\nPNO: ${r.pno}\nÜrün problemi: ${r.prob}\nAdet: ${r.adet}\n\n` +
    `(Ürün görselleri ektedir.)\n\n${SIGN}`;
}
function dataURLtoFile(u, name) {
  const [h, b] = u.split(","); const bin = atob(b); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new File([a], name, { type: h.match(/:(.*?);/)[1] });
}
async function shareImages(r) {
  const files = [r.img1 && dataURLtoFile(r.img1, "gorsel1.jpg"), r.img2 && dataURLtoFile(r.img2, "gorsel2.jpg")].filter(Boolean);
  const to = (mails.adet || "").trim();
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: "Adet toplatma hk.", text: (to ? `Alıcı: ${to}\n\n` : "") + adetBody(r) }); } catch {}
    return;
  }
  files.forEach(f => { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); });
  toast("Görseller indirildi, maile ekle");
}
$("adetList").addEventListener("click", async e => {
  const act = e.target.dataset.act; if (!act) return;
  const id = e.target.closest(".item").dataset.id; const r = reports.find(x => x.id === id);
  if (act === "share") return shareImages(r);
  if (act === "edit") {
    $("eStore").value = r.store; $("eKod").value = r.kod; $("eAd").value = r.ad; $("eSkt").value = r.skt;
    $("ePno").value = r.pno; $("eProb").value = r.prob; $("eAdet").value = r.adet;
    $("editDlg").dataset.id = id; $("editDlg").showModal(); return;
  }
  if (act === "del") { if (confirm("Bu bildirim silinsin mi?")) await deleteDoc(doc(db, "reports", id)); return; }
  if (act === "ok") {
    const to = (mails.adet || "").trim();
    if (!to) { toast("Adet toplatma için mail adresi tanımlı değil (/admin)"); return; }
    await updateDoc(doc(db, "reports", id), { status: "approved", approvedAt: serverTimestamp() });
    location.href = `mailto:${to}?subject=${encodeURIComponent("Adet toplatma hk.")}&body=${encodeURIComponent(adetBody(r))}`;
    if (r.img1 || r.img2) setTimeout(() => toast("Görselleri eklemek için 'Görselleri paylaş' butonunu kullan"), 1500);
  }
});
$("eCancel").addEventListener("click", () => $("editDlg").close());
$("eSave").addEventListener("click", async () => {
  const id = $("editDlg").dataset.id;
  await updateDoc(doc(db, "reports", id), { store: $("eStore").value.trim(), kod: $("eKod").value.trim(), ad: $("eAd").value.trim(),
    skt: $("eSkt").value.trim(), pno: $("ePno").value.trim(), prob: $("eProb").value.trim(), adet: $("eAdet").value.trim() });
  $("editDlg").close(); toast("Güncellendi");
});

// ---------- Canlı dinleme ----------
let first = true;
function listen() {
  if (!db) return;
  onSnapshot(query(collection(db, "reports"), orderBy("createdAt", "desc")), snap => {
    if (!first) {
      snap.docChanges().forEach(c => {
        if (c.type === "added" && c.doc.data().createdAt) notify("Yeni adet toplatma", `${c.doc.data().store} – ${c.doc.data().ad}`);
      });
    }
    first = false;
    reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTiles(); renderTalepArchive();
    if ($("adetPage").classList.contains("show")) renderAdetList();
  }, e => console.warn(e));
}
function notify(title, body) {
  if (Notification.permission === "granted" && swReg) swReg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png" });
}

// ---------- Başlangıç: /talep ve /admin yönlendirmesi ----------
const route = location.hash.replace("#", "");
renderTiles();
if (route === "talep") { initTalep(); show("talepPage"); }
else if (route === "admin") { renderAdmin(); show("adminPage"); }
loadMails().then(() => { if (route === "admin") renderAdmin(); listen(); });
