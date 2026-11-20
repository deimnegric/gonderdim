import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, onSnapshot, query, orderBy, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";
import { firebaseConfig, VAPID_KEY, NOTIFY_WEBHOOK } from "./firebase-config.js";
import * as cfg from "./firebase-config.js";
const SEND_URL = cfg.N8N_SEND_WEBHOOK || "", SEND_SECRET = cfg.N8N_SECRET || "";

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

// Her butonun kendi soft rengi (siyah zeminde gözü yormayan pastel tonlar)
const TONES = { asansor: "#e0b89c", appstore: "#a8c3a4", gplay: "#9dbbd0", yatay: "#d8c796", adet: "#c5a9cc", kasa: "#dca5a5" };
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
const isAdmin = () => {
  const f = localStorage.getItem("gd_admin");
  if (f === "1") return true;
  if (f === "0") return false;
  return "Notification" in window && Notification.permission === "granted";
};

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
  const admin = isAdmin();
  const pending = reports.filter(r => r.status === "pending").length;
  const list = admin ? BUTTONS : BUTTONS.filter(b => b.special === "adet");
  $("tiles").classList.toggle("single", !admin);
  $("tiles").innerHTML = list.map((b, idx) => {
    const badge = (b.special === "adet" && admin && pending > 0) ? `<span class="badge">${pending}</span>` : "";
    const label = admin ? b.label : "Adet Bildirimi Gönder";
    return `<button class="tile" data-key="${b.key}" style="--c:${TONES[b.key] || "#a8bfa5"};--i:${idx}">${esc(label)}${badge}</button>`;
  }).join("");
  if ("setAppBadge" in navigator) { (admin && pending ? navigator.setAppBadge(pending) : navigator.clearAppBadge()).catch(() => {}); }
}
function openTile(key) {
  const b = BUTTONS.find(x => x.key === key);
  if (b.special === "adet") { if (isAdmin()) { renderAdetList(); go("adetPage"); } else { initTalep(); go("talepPage"); } return; }
  $("storeTitle").textContent = b.label;
  $("storeList").innerHTML = STORES.map((s, si) => {
    const [kod, ...rest] = s.split(" ");
    return `<button class="store" data-store="${esc(s)}" style="--i:${si}"><b>${esc(kod)}</b> ${esc(rest.join(" "))}</button>`;
  }).join("");
  $("storeList").dataset.key = b.key;
  go("storePage");
}
function flyPlane(el) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = el.getBoundingClientRect();
  const p = document.createElement("div"); p.className = "fly";
  p.innerHTML = '<svg viewBox="0 0 48 48" width="34" height="34"><path d="M4 22 L44 6 L30 42 L22 28 Z" fill="#fbf6e9" stroke="#3a352c" stroke-width="3" stroke-linejoin="round"/><path d="M22 28 L44 6" stroke="#3a352c" stroke-width="3" stroke-linecap="round"/></svg>';
  p.style.left = (r.left + r.width / 2 - 17) + "px"; p.style.top = (r.top + r.height / 2 - 17) + "px";
  document.body.appendChild(p);
  p.animate([
    { transform: "translate(0,0) rotate(0) scale(.5)", opacity: 0 },
    { transform: "translate(8px,-12px) rotate(-8deg) scale(1.1)", opacity: 1, offset: .25 },
    { transform: "translate(150px,-130px) rotate(-18deg) scale(.7)", opacity: 0 }
  ], { duration: 560, easing: "cubic-bezier(.3,.7,.3,1)" }).onfinish = () => p.remove();
}
const withPop = (el, fn) => { if (el.dataset.busy) return; el.dataset.busy = "1"; el.classList.add("pop"); flyPlane(el); setTimeout(() => { delete el.dataset.busy; el.classList.remove("pop"); fn(); }, 320); };
$("tiles").addEventListener("click", e => {
  const t = e.target.closest(".tile"); if (!t) return;
  withPop(t, () => openTile(t.dataset.key));
});
$("storeList").addEventListener("click", e => {
  const s = e.target.closest(".store"); if (!s) return;
  withPop(s, () => openMail(BUTTONS.find(x => x.key === $("storeList").dataset.key), s.dataset.store));
});
let logoTaps = [];
$("logoBtn").addEventListener("click", () => {
  const n = Date.now(); logoTaps = logoTaps.filter(t => n - t < 2500); logoTaps.push(n);
  stack.length = 0;
  if (logoTaps.length >= 5) { logoTaps = []; renderAdmin(); show("adminPage"); return; }
  show("home"); history.replaceState(null, "", location.pathname + location.search);
});

// ---------- /admin ----------
function renderAdmin() {
  $("adminToggle").textContent = isAdmin() ? "Bu cihaz: ADMIN (normal kullanıcı yap)" : "Bu cihaz: normal kullanıcı (admin yap)";
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
$("adminToggle").addEventListener("click", () => {
  localStorage.setItem("gd_admin", isAdmin() ? "0" : "1");
  renderAdmin(); renderTiles(); toast(isAdmin() ? "Bu cihaz admin oldu" : "Bu cihaz normal kullanıcı oldu");
});

async function enablePush() {
  try {
    if (!db || !VAPID_KEY) { toast("firebase-config.js içinde VAPID_KEY gerekli"); return; }
    if (!(await isSupported())) { toast("Bu tarayıcı push desteklemiyor"); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Bildirim izni verilmedi"); return; }
    const reg = swReg || await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    await setDoc(doc(db, "tokens", token.slice(-40)), { token, at: serverTimestamp() });
    localStorage.setItem("gd_admin", "1"); renderAdmin(); renderTiles();
    toast("Bildirimler açıldı – bu cihaz admin oldu");
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
const photoHTML = (i, n) => n ? `<img src="${n}"><input type="file" accept="image/*">`
  : `<span>+ Fotoğraf ${i + 1}</span><input type="file" accept="image/*">`;
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
    if (SEND_URL) {
      e.target.disabled = true; toast("Taslak hazırlanıyor…");
      try {
        const res = await fetch(SEND_URL, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: SEND_SECRET, to, subject: "Adet toplatma hk.", body: adetBody(r), img1: r.img1 || "", img2: r.img2 || "" }) });
        if (!res.ok) throw new Error(res.status);
        await updateDoc(doc(db, "reports", id), { status: "approved", approvedAt: serverTimestamp() });
        toast("Taslak hazır – Gmail açılıyor, kontrol edip gönder"); setTimeout(() => { location.href = "https://mail.google.com/mail/u/0/#drafts"; }, 1400);
      } catch (err) { console.error(err); toast("Taslak oluşturulamadı, tekrar dene"); }
      e.target.disabled = false; return;
    }
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
    if (!first && isAdmin()) {
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

// ---------- Açılış: kuantum matris – "GÖNDERDİM" şifresi çözülür, ekran şeritler hâlinde yırtılır ----------
function playIntro() {
  const root = document.documentElement;
  if (!root.classList.contains("intro")) { const o = $("intro"); if (o) o.remove(); return; }
  try { sessionStorage.setItem("gd_intro", "1"); } catch {}
  const ov = $("intro"), canvas = $("introCanvas");
  let raf = 0, finished = false, released = false;
  const finish = () => {
    if (finished) return; finished = true; cancelAnimationFrame(raf);
    root.classList.remove("intro"); ov.remove();
  };
  try {
    const ctx = canvas.getContext("2d");
    // ---- Ayarlar (renkleri buradan değiştir) ----
    const PHRASE = "GÖNDERDİM";
    const DURATION = 2800;            // ms
    const TEAR_START = 0.66;          // ekranın yırtılmaya başladığı an (0–1)
    const BANDS = 10;                 // yatay şerit sayısı
    const BG = "#111313";
    const C_DECODE = "#9dbbd0";       // çözülürken harf rengi (orijinal neon: #00F0FF)
    const C_DONE = "#a8c3a4";         // çözülünce renk (orijinal neon: #CCFF00)
    const C_HUD_TXT = "#9dbbd0", C_HUD_BAR = "#a8c3a4";
    const FONT = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
    const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*<>";

    const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); addEventListener("resize", resize);

    function hud(w, h, p, alpha) {
      if (alpha <= 0.02) return;
      ctx.save(); ctx.globalAlpha = alpha;
      const barW = Math.min(300, w * 0.62), x = (w - barW) / 2, y = h - 42;
      ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(x, y, barW, 2);
      ctx.fillStyle = C_HUD_BAR; ctx.fillRect(x, y, barW * p, 2.5);
      ctx.font = `700 10px ${FONT}`; ctx.fillStyle = C_HUD_TXT;
      ctx.textAlign = "left"; ctx.fillText("GÖNDERDİM // AÇILIYOR", x, y - 8);
      ctx.textAlign = "right"; ctx.fillStyle = C_HUD_BAR; ctx.fillText(`${Math.round(p * 100)}%`, x + barW, y - 8);
      ctx.restore();
    }
    function render(w, h, p) {
      const tearP = p > TEAR_START ? easeInOutCubic((p - TEAR_START) / (1 - TEAR_START)) : 0;
      const decodeP = Math.min(1, p / 0.6);
      let text = "";
      for (let n = 0; n < PHRASE.length; n++) text += (n / PHRASE.length < decodeP) ? PHRASE[n] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      const bandH = h / BANDS;
      for (let b = 0; b < BANDS; b++) {
        const dir = b % 2 === 0 ? 1 : -1, shiftX = tearP * w * 1.1 * dir;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, b * bandH, w, bandH + 0.6); ctx.clip();
        ctx.translate(shiftX, 0);
        ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
        ctx.font = `800 ${Math.min(64, w * 0.125)}px ${FONT}`;
        ctx.fillStyle = decodeP >= 1 ? C_DONE : C_DECODE;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(text, w / 2, h / 2);
        hud(w, h, p, 1 - tearP * 1.5);
        ctx.restore();
      }
    }
    ov.addEventListener("pointerdown", finish);   // dokununca atla
    const start = performance.now();
    const tick = now => {
      const p = Math.min(1, (now - start) / DURATION), w = innerWidth, h = innerHeight;
      ctx.clearRect(0, 0, w, h);
      if (!released) ov.style.background = "transparent";      // ilk kare çizildi, arka planı canvas taşır
      render(w, h, p);
      if (p >= TEAR_START && !released) {                      // yırtılma başlayınca butonlar altında belirmeye başlar
        released = true; root.classList.remove("intro"); ov.style.pointerEvents = "none";
      }
      if (p < 1) raf = requestAnimationFrame(tick); else finish();
    };
    raf = requestAnimationFrame(tick);
    setTimeout(finish, DURATION + 1500);                       // her durumda bitir
  } catch (e) { console.warn(e); finish(); }
}
playIntro();
