// yrndWA POS köprüsü — POS sayfasına "yrndWA" düğmesi ve paneli ekler.
// Panel API'si arka plan betiği üzerinden (anahtarla) çağrılır; POS işlemleri page.js'e (sayfa ortamı) iletilir.
(() => {
  if (window.__tndrwaContent) return;
  window.__tndrwaContent = true;

  // ---------- page.js ile köprü ----------
  let seq = 0;
  const waiting = new Map();
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "tndrwa-page") return;
    const w = waiting.get(e.data.id);
    if (!w) return;
    if (e.data.progress) return w.onProgress?.(e.data.progress);
    waiting.delete(e.data.id);
    if (e.data.error) w.reject(new Error(e.data.error));
    else w.resolve(e.data.result);
  });
  function page(cmd, args = [], onProgress) {
    const id = `t${Date.now()}_${++seq}`;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, onProgress });
      window.postMessage({ source: "tndrwa-ext", id, cmd, args }, location.origin);
    });
  }
  const api = (method, path, body) =>
    new Promise((resolve, reject) =>
      chrome.runtime.sendMessage({ type: "api", method, path, body }, (r) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!r) return reject(new Error("Eklenti yanıt vermedi."));
        if (r.status >= 400 || r.error) return reject(new Error(r.data?.error || r.error || `HTTP ${r.status}`));
        resolve(r.data);
      }),
    );
  const store = {
    get: (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k]))),
    set: (k, v) => new Promise((r) => chrome.storage.local.set({ [k]: v }, r)),
  };

  // ---------- arayüz ----------
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;font-family:system-ui,Segoe UI,Arial,sans-serif";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .fab{background:#25D366;color:#fff;border:0;border-radius:999px;padding:10px 16px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;font-size:14px}
      .badge{background:#dc2626;border-radius:999px;padding:1px 7px;margin-left:6px;font-size:12px}
      .panel{display:none;position:absolute;right:0;bottom:52px;width:380px;max-height:70vh;overflow:auto;background:#fff;color:#111;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);padding:12px;font-size:13px}
      .panel.open{display:block}
      h3{margin:0 0 6px;font-size:15px}
      .muted{color:#64748b;font-size:12px}
      button.b{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:13px}
      button.p{background:#f97316;color:#fff;border-color:#f97316}
      button:disabled{opacity:.5;cursor:default}
      .row{border:1px solid #e2e8f0;border-radius:8px;padding:8px;margin:6px 0}
      .warn{background:#fef3c7;border-radius:8px;padding:8px;margin:6px 0;color:#92400e}
      .err{background:#fee2e2;border-radius:8px;padding:8px;margin:6px 0;color:#991b1b}
      .ok{background:#dcfce7;border-radius:8px;padding:8px;margin:6px 0;color:#166534}
      select{width:100%;padding:6px;border-radius:8px;border:1px solid #cbd5e1;margin:4px 0}
      ul{margin:4px 0 0;padding-left:18px}
    </style>
    <div class="panel" id="panel">
      <h3>yrndWA · WhatsApp siparişleri</h3>
      <div id="link" class="muted">Bağlanıyor…</div>
      <label class="muted" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="optSubmit"> Sorun yoksa "Sipariş Oluştur"a da bas</label>
      <label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="optAuto"> Yeni siparişleri kendiliğinden gir (bu pencere POS'a ayrılmış olmalı)</label>
      <div id="msg"></div>
      <div id="orders"></div>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:10px 0">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="b" id="menu">Menüyü panele gönder</button>
        <button class="b" id="cust">Müşterileri panele gönder</button>
        <button class="b" id="refresh">Yenile</button>
      </div>
      <p class="muted">Menü ve müşteriler POS'tan yalnız okunur. Sipariş POS'a doldurulur; sorun varsa (eşleşmeyen ürün, tutar farkı, uygulanamayan indirim) oluşturulmaz, personele bırakılır.</p>
    </div>
    <button class="fab" id="fab">yrndWA<span class="badge" id="count" style="display:none">0</span></button>`;
  document.documentElement.appendChild(host);
  const $ = (id) => shadow.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const tl = (k) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
  const show = (cls, html) => ($("msg").innerHTML = html ? `<div class="${cls}">${html}</div>` : "");
  $("fab").onclick = () => $("panel").classList.toggle("open");

  let cafe = null;
  let cafeAt = "";
  let orders = [];
  let busy = false;
  // Ayarlar: "Sipariş Oluştur"a da bas (varsayılan açık), yeni siparişleri kendiliğinden gir (varsayılan kapalı)
  const opts = { submit: true, auto: false };
  // Otomatik modda sorun çıkan siparişler tekrar denenmez (personel elle tamamlar ya da "POS'a doldur" ile yeniden dener)
  let skipped = {};
  (async () => {
    const saved = (await store.get("tndrwaOpts")) || {};
    Object.assign(opts, saved);
    skipped = (await store.get("tndrwaSkip")) || {};
    $("optSubmit").checked = opts.submit;
    $("optAuto").checked = opts.auto;
  })();
  const saveOpts = () => store.set("tndrwaOpts", { ...opts });

  // Açık ekranın işletmesi (POS'ta işletmeler arası geçişte değişir; adres değişince yeniden okunur)
  async function ensureCafe() {
    // İşletme, adres değişmeden de (Menü → İşletme ⇄) değişebilir: her yenilemede yeniden okunur
    if (!cafe || cafeAt !== location.pathname || Date.now() - (ensureCafe.at || 0) > 10000) {
      ensureCafe.at = Date.now();
      cafe = await page("cafeInfo");
      cafeAt = location.pathname;
    }
    return cafe;
  }

  // Otomatik müşteri sorgusu: panel yeni siparişin telefonunu ister, POS'a bağlı işletmelerin kayıtlarında aranır, bulunan ad/adresler panele gider
  let lookingUp = false;
  let linkedBrands = [];
  const priceNote = (r) => (r.pricesUpdated?.length || r.choicesUpdated ? ` ${r.pricesUpdated.length} ürün fiyatı${r.choicesUpdated ? ` ve ${r.choicesUpdated} seçenek ücreti` : ""} POS'a göre düzeltildi.` : "");

  // Otomatik eşitleme: POS açılınca ve açık kaldıkça, bağlı her işletmenin menüsü (30 dk'da bir) ve müşterileri (6 saatte bir) panele gider
  const MENU_EVERY = 30 * 60 * 1000;
  const CUSTOMERS_EVERY = 6 * 60 * 60 * 1000;
  let syncing = false;
  async function autoSync() {
    if (syncing || busy || !linkedBrands.length) return;
    syncing = true;
    try {
      const last = (await store.get("tndrwaSyncAt")) || {};
      for (const b of linkedBrands) {
        if (!b.posCafeId || busy) continue;
        const at = last[b.posCafeId] || {};
        if (Date.now() - (at.menu || 0) > MENU_EVERY) {
          try {
            const menu = await page("readMenu", [b.posCafeId]);
            const r = await api("POST", "/api/pos-ext/snapshot", menu);
            at.menu = Date.now();
            const note = priceNote(r);
            if (note) show("ok", `${esc(b.name)}: menü POS'tan güncellendi.${note}`);
          } catch {
            /* sonraki turda */
          }
        }
        if (Date.now() - (at.customers || 0) > CUSTOMERS_EVERY) {
          try {
            let batch = 0;
            let queue = Promise.resolve();
            await page("readCustomers", [b.posCafeId], (p) => {
              const n = batch++;
              queue = queue.then(() => api("POST", "/api/pos-ext/customers", { cafeId: b.posCafeId, batch: n, of: p.done ? n + 1 : n + 2, customers: p.customers }));
            });
            await queue;
            at.customers = Date.now();
          } catch {
            /* sonraki turda */
          }
        }
        last[b.posCafeId] = at;
        await store.set("tndrwaSyncAt", last);
      }
    } finally {
      syncing = false;
    }
  }
  async function runLookups(phones, brands) {
    if (lookingUp || busy) return;
    lookingUp = true;
    try {
      const cafeIds = [...new Set(brands.map((b) => b.posCafeId).filter(Boolean))];
      const customers = await page("lookupCustomers", [phones, cafeIds]);
      await api("POST", "/api/pos-ext/lookups", { phones, customers });
    } catch {
      /* sonraki yenilemede yeniden denenir */
    } finally {
      lookingUp = false;
    }
  }

  async function refresh() {
    try {
      const r = await api("GET", "/api/pos-ext/orders");
      orders = r.orders;
      linkedBrands = r.brands;
      if (r.lookups?.length) runLookups(r.lookups, r.brands);
      let here = null;
      try {
        here = await ensureCafe();
      } catch {
        /* sipariş ekranı dışındaki sayfalarda işletme okunamayabilir */
      }
      const linked = here && r.brands.find((b) => b.posCafeId === here.cafeId);
      if (here && !linked) {
        const brands = await api("GET", "/api/pos-ext/brands");
        const free = brands.filter((b) => !b.posCafeId);
        // İşletme adında geçen marka önceden seçilir (ör. "Suadiye | Yerinde Pide" → Yerinde Pide); yoksa seçim zorunlu
        const norm = (s) => String(s || "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
        // Periyodik yenileme listeyi yeniden çizer: kullanıcının seçimi korunur
        const prevSel = shadow.getElementById("brand")?.value;
        const guess = free.find((b) => String(b.id) === prevSel) || (prevSel === undefined ? free.find((b) => norm(here.cafeName).includes(norm(b.name))) : null);
        $("link").innerHTML = `Bu işletme (<b>${esc(here.cafeName || here.cafeId)}</b>) bir markaya bağlı değil.${free.length ? ` Bağlamak için markayı seçip "Menüyü panele gönder"e basın:<select id="brand"><option value="">— Marka seçin —</option>${free.map((b) => `<option value="${b.id}"${guess && guess.id === b.id ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select>` : " Bütün markalar başka işletmelere bağlı."}`;
      } else {
        $("link").innerHTML = here ? `Açık işletme: <b>${esc(here.cafeName || "POS")}</b> → <b>${esc(linked.name)}</b>` : `Bağlı markalar: ${r.brands.map((b) => esc(b.name)).join(", ") || "yok"}`;
      }
      renderOrders();
    } catch (err) {
      $("link").innerHTML = `<span style="color:#dc2626">${esc(err.message)}</span>${/anahtar|ayar|adres/i.test(err.message) ? ' <a href="#" id="opts">Ayarlar</a>' : ""}`;
      const o = shadow.getElementById("opts");
      if (o) o.onclick = (e) => (e.preventDefault(), chrome.runtime.sendMessage({ type: "options" }));
    }
  }

  function renderOrders() {
    $("count").style.display = orders.length ? "inline" : "none";
    $("count").textContent = String(orders.length);
    if (!orders.length) return ($("orders").innerHTML = '<p class="muted">POS\'a yazılmayı bekleyen WhatsApp siparişi yok.</p>');
    $("orders").innerHTML = orders
      .map(
        (o) => `<div class="row"><b>${esc(o.brand.name)} · WA #${o.id}</b> · ${esc(o.customer.name || "İsimsiz")} · ${tl(o.totalKurus)}${o.discountKurus ? ` (ödenecek ${esc(o.payableText)})` : ""}
        <div class="muted">${o.lines.map((l) => `${l.quantity}× ${esc(l.name)}${l.pos ? "" : " ⚠"}`).join(", ")}</div>
        <div class="muted">${esc(o.payment.label)} · ${esc(o.address)}</div>
        <button class="b p" data-fill="${o.id}" style="margin-top:6px">POS'a doldur</button></div>`,
      )
      .join("");
    shadow.querySelectorAll("[data-fill]").forEach((b) => (b.onclick = () => fill(Number(b.dataset.fill))));
  }

  function alarm(text) {
    document.title = `⚠ ${text}`;
    try {
      const ctx = new AudioContext();
      [880, 660, 880].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.value = 0.15;
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.25);
        o.stop(ctx.currentTime + i * 0.25 + 0.2);
      });
    } catch {
      /* ses izni yoksa yalnız görsel uyarı */
    }
  }

  // Otomatik mod kesicisi: art arda 2 sipariş takılırsa (blokaj ya da hata) otomatik mod kendini kapatır; arayüz değiştiğinde onlarca sipariş tek tek takılmasın
  let failStreak = 0;
  const AUTO_MAX_FAILS = 2;
  async function autoFailed(id, why) {
    if (++failStreak < AUTO_MAX_FAILS || !opts.auto) return;
    opts.auto = false;
    $("optAuto").checked = false;
    await saveOpts();
    const text = `Art arda ${failStreak} sipariş POS'a yazılamadı (son: WA #${id}, ${why}). Otomatik mod kapatıldı; siparişleri elle girin, sorun giderilince modu yeniden açın.`;
    alarm("Otomatik mod kapandı");
    show("err", `<b>Otomatik mod kapandı.</b> ${esc(text)}`);
    api("POST", "/api/pos-ext/alert", { kind: "auto", text }).catch(() => undefined);
  }

  async function fill(id, auto = false) {
    if (busy) return;
    const order = orders.find((o) => o.id === id);
    if (!order) return;
    if (!auto && skipped[id]) {
      delete skipped[id];
      await store.set("tndrwaSkip", skipped);
    }
    busy = true;
    shadow.querySelectorAll("button").forEach((b) => (b.disabled = true));
    show("muted", `WA #${id} için ${esc(order.brand.posCafeName || order.brand.name)} sipariş ekranı hazırlanıyor…`);
    try {
      // İşletme değişimi POS sayfasını baştan yükler: iş yarıda kalmasın diye not düşülür, yüklenince kaldığı yerden sürer
      if (await page("needsSwitch", [order.brand.posCafeId])) {
        await store.set("tndrwaResume", { id, auto, at: Date.now() });
        show("muted", `İşletme ${esc(order.brand.posCafeName || order.brand.name)} olarak değiştiriliyor…`);
        await page("switchCafe", [order.brand.posCafeName || order.brand.name, order.brand.posCafeId]);
        cafe = null;
      }
      await store.set("tndrwaResume", null);
      // Doğru işletmenin Paket ekranı: sipariş listesindeysek açılır, başka işletmenin ekranındaysak durulur
      await page("openPaketFor", [order.brand.posCafeName || order.brand.name, order.brand.posCafeId]);
      const here = await page("cafeInfo");
      if (here.cafeId !== order.brand.posCafeId) throw new Error(`Açık ekran ${here.cafeName || "başka bir işletme"} için. Bu sipariş ${order.brand.posCafeName || order.brand.name} işletmesine yazılmalı: sipariş listesine dönüp tekrar "POS'a doldur" deyin.`);
      show("muted", `WA #${id} dolduruluyor…`);
      // "Sipariş Oluştur" sonrası POS başka sayfaya geçer (sayfa yenilenebilir): POS numarası sonradan okunabilsin diye önceden not düşülür
      await store.set("tndrwaPending", { id, cafeId: order.brand.posCafeId, at: Date.now() });
      const r = await page("fillOrder", [order, { submit: opts.submit }]);
      const list = r.warnings.length ? `<ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
      const who = r.customer === "created" ? "yeni müşteri eklendi" : "kayıtlı müşteri seçildi";
      if (r.posRef) {
        await api("POST", `/api/pos-ext/orders/${id}/done`, { cafeId: order.brand.posCafeId, posRef: r.posRef });
        show(r.warnings.length ? "warn" : "ok", `WA #${id} POS'ta <b>${esc(r.posRef)}</b> olarak oluşturuldu (${who}), panele işlendi.${list}`);
        refresh();
        if (auto) failStreak = 0;
      } else if (r.submitted) {
        if (auto) failStreak = 0;
        await store.set("tndrwaPending", { id, cafeId: order.brand.posCafeId, at: Date.now() });
        show("warn", `WA #${id} oluşturuldu; POS numarası sipariş listesinden okunacak.${list}`);
      } else {
        await store.set("tndrwaPending", { id, cafeId: order.brand.posCafeId, at: Date.now() });
        if (r.blockers.length) {
          skipped[id] = Date.now();
          await store.set("tndrwaSkip", skipped);
          alarm(`WA #${id} POS'a eksik yazıldı`);
          show("err", `WA #${id} dolduruldu ama <b>oluşturulmadı</b>, kontrol gerekiyor (${who}):${list}<b>Düzeltip "Sipariş Oluştur"a basın.</b>`);
          if (auto) await autoFailed(id, r.blockers[0]);
        } else {
          show("ok", `WA #${id} dolduruldu (${who}${r.posTotal !== null ? `, POS toplamı ${r.posTotal.toFixed(2)} TL` : ""}).<br><b>Kontrol edip "Sipariş Oluştur"a basın.</b>${list}`);
        }
      }
    } catch (err) {
      if (auto) {
        skipped[id] = Date.now();
        await store.set("tndrwaSkip", skipped);
        alarm(`WA #${id} POS'a yazılamadı`);
        show("err", `WA #${id}: ${esc(err.message)}`);
        await autoFailed(id, err.message);
        return;
      }
      show("err", `WA #${id}: ${esc(err.message)}`);
    } finally {
      busy = false;
      shadow.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  }

  // "Sipariş Oluştur"dan sonra sipariş listesinde WA#<id> notlu siparişin POS numarası panele yazılır
  async function watchCreated() {
    const pending = await store.get("tndrwaPending");
    if (!pending || Date.now() - pending.at > 30 * 60 * 1000 || !/orderlist|order-list|orders/.test(location.pathname)) return;
    try {
      const posRef = await page("findCreated", [pending.id]);
      if (!posRef) return;
      await api("POST", `/api/pos-ext/orders/${pending.id}/done`, { cafeId: pending.cafeId, posRef });
      await store.set("tndrwaPending", null);
      show("ok", `WA #${pending.id} POS'ta ${esc(posRef)} olarak kaydedildi, panele işlendi.`);
      refresh();
    } catch {
      /* sonraki turda yeniden denenir */
    }
  }

  // Otomatik mod: sipariş listesindeyken (ya da boş Paket ekranında) sıradaki siparişi kendiliğinden gir
  async function autoTick() {
    if (!opts.auto || busy) return;
    if (!/\/app\/(orderlist|all-orders|tables|order\/Paket)/.test(location.pathname)) return;
    await refresh();
    // POS'a girilmiş ama numarası henüz okunmamış sipariş (30 dk) tekrar girilmez
    const pending = await store.get("tndrwaPending");
    const next = orders.find((o) => !skipped[o.id] && !(pending && pending.id === o.id && Date.now() - pending.at < 30 * 60 * 1000));
    if (next) await fill(next.id, true);
  }

  $("optSubmit").onchange = (e) => ((opts.submit = e.target.checked), saveOpts());
  $("optAuto").onchange = (e) => {
    opts.auto = e.target.checked;
    if (opts.auto && !opts.submit) {
      opts.submit = true;
      $("optSubmit").checked = true;
    }
    saveOpts();
    show(opts.auto ? "warn" : "muted", opts.auto ? "Otomatik mod açık: yeni WhatsApp siparişleri bu pencerede kendiliğinden girilecek. Bu pencereyi başka iş için kullanmayın." : "Otomatik mod kapalı.");
  };
  $("refresh").onclick = refresh;
  $("menu").onclick = async () => {
    try {
      $("menu").disabled = true;
      const sel = shadow.getElementById("brand");
      if (sel && !sel.value) throw new Error("Önce bu işletmenin hangi markaya ait olduğunu seçin.");
      if (sel && !confirm(`"${sel.options[sel.selectedIndex].text}" markası bu POS işletmesine bağlanacak. Doğru mu?`)) return;
      show("muted", "POS menüsü okunuyor…");
      const menu = await page("readMenu");
      const r = await api("POST", "/api/pos-ext/snapshot", { ...menu, ...(sel ? { brandId: Number(sel.value) } : {}) });
      show(r.requiredMissing ? "warn" : "ok", `Menü gönderildi: POS'ta ${r.products} ürün. WhatsApp'taki ${r.checked} ürünün ${r.ok} tanesi sorunsuz eşleşti${r.issues ? `, ${r.issues} uyarı (${r.requiredMissing} zorunlu seçenek eksik) — ayrıntılar panelde POS sayfasında` : ""}.${priceNote(r)}`);
      refresh();
    } catch (err) {
      show("err", esc(err.message));
    } finally {
      $("menu").disabled = false;
    }
  };
  $("cust").onclick = async () => {
    try {
      $("cust").disabled = true;
      cafe = null;
      await ensureCafe();
      let batch = 0;
      let sent = 0;
      let queue = Promise.resolve();
      show("muted", "POS müşterileri okunuyor…");
      await page("readCustomers", [], (p) => {
        const b = batch++;
        queue = queue.then(async () => {
          await api("POST", "/api/pos-ext/customers", { cafeId: cafe.cafeId, batch: b, of: p.done ? b + 1 : b + 2, customers: p.customers });
          sent += p.customers.length;
          show("muted", `${sent} müşteri gönderildi…`);
        });
      });
      await queue;
      show("ok", `${sent} POS müşterisi panele gönderildi (yeni olanlar eklendi, adresler tamamlandı).`);
    } catch (err) {
      show("err", esc(err.message));
    } finally {
      $("cust").disabled = false;
    }
  };

  // Durum takibi: POS'a girilmiş siparişlerin POS'taki durumu dakikada bir okunur (kuryeye verildi / teslim / iptal), panele gider
  let tracking = false;
  async function trackTick() {
    if (tracking) return;
    tracking = true;
    try {
      const { orders: list } = await api("GET", "/api/pos-ext/tracking");
      if (!list.length) return;
      const events = await page("trackStatuses", [list]);
      const rank = { NEW: 0, PREPARING: 1, ON_THE_WAY: 2, DELIVERED: 3, CANCELLED: 3 };
      const updates = events.filter((e) => rank[e.event] > rank[list.find((o) => o.id === e.id)?.status ?? "NEW"]).map(({ id, event }) => ({ id, event }));
      if (updates.length) await api("POST", "/api/pos-ext/tracking", { updates });
    } catch {
      /* sonraki turda */
    } finally {
      tracking = false;
    }
  }
  // Arayüz erken uyarısı: POS açıkken eklentinin dayandığı parçalar yoklanır; eksik varsa panele uyarı gider, otomatik mod kapanır
  let uiChecking = false;
  async function uiCheck() {
    if (uiChecking || busy) return;
    uiChecking = true;
    try {
      let r = await page("selfCheck");
      if (r.skipped) return;
      if (r.missing.length) {
        await new Promise((res) => setTimeout(res, 10000)); // ekran yeni açıldıysa yüklenmesini bekle, sonra bir daha bak
        if (busy) return;
        const r2 = await page("selfCheck");
        if (r2.skipped) return;
        r = { ...r2, missing: r.missing.filter((m) => r2.missing.includes(m)) };
      }
      if (!r.missing.length) {
        await api("POST", "/api/pos-ext/alert", { kind: "ui", clear: true });
        return;
      }
      const text = `Ekranda (${r.path}) bulunamayan parça: ${r.missing.join(", ")}. Suitable arayüzü değişmiş olabilir; siparişleri elle girin, haber verin.`;
      await api("POST", "/api/pos-ext/alert", { kind: "ui", text });
      alarm("POS arayüzü değişmiş olabilir");
      show("err", `<b>POS arayüzü değişmiş olabilir.</b> ${esc(text)}`);
      if (opts.auto) {
        opts.auto = false;
        $("optAuto").checked = false;
        await saveOpts();
        show("err", `<b>POS arayüzü değişmiş olabilir; otomatik mod kapatıldı.</b> ${esc(text)}`);
      }
    } catch {
      /* sonraki turda */
    } finally {
      uiChecking = false;
    }
  }
  setTimeout(uiCheck, 25000);
  setInterval(uiCheck, 5 * 60 * 1000);
  setTimeout(trackTick, 10000);
  setInterval(trackTick, 60000);
  setTimeout(autoSync, 20000); // açılışta (arayüz yüklendikten sonra)
  setInterval(autoSync, 5 * 60 * 1000);
  (async () => {
    await refresh();
    // İşletme değişiminden sonra yeniden yüklendiyse yarıda kalan doldurmayı sürdür (1 dk içinde)
    const resume = await store.get("tndrwaResume");
    if (resume && Date.now() - resume.at < 60000) {
      await store.set("tndrwaResume", null);
      $("panel").classList.add("open");
      await new Promise((r) => setTimeout(r, 1500));
      await refresh();
      if (orders.some((o) => o.id === resume.id)) await fill(resume.id, resume.auto);
    }
  })();
  setInterval(() => (opts.auto ? autoTick() : refresh()), 15000);
  setInterval(watchCreated, 2000);
})();
