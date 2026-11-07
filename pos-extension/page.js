// tndrWA POS köprüsü — POS sayfasının kendi ortamında (MAIN world) çalışır.
// POS'un oturumuyla menüyü/müşterileri YALNIZ OKUR; siparişi POS'un ekranını kullanarak doldurur
// (veritabanına doğrudan yazmaz). "Sipariş Oluştur"a personel basar.
(() => {
  if (window.__tndrwaPage) return;
  window.__tndrwaPage = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const key = (s) => norm(s).toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]+/g, " ").trim();
  // Sabit konumlu (fixed) pencerelerde offsetParent boş olur: görünürlüğü kutu ve stile göre ölç
  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const propsOf = (el) => {
    const k = Object.keys(el).find((x) => x.startsWith("__reactProps"));
    return k ? el[k] : null;
  };
  const clickable = (el) => !!propsOf(el)?.onClick;
  async function waitFor(fn, ms = 4000, step = 100) {
    for (let t = 0; t < ms; t += step) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return fn();
  }
  function setValue(el, v) {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }
  const buttonByText = (text, root = document) => [...root.querySelectorAll("button")].find((b) => visible(b) && norm(b.innerText) === text);
  const lastToastError = () => {
    const t = [...document.querySelectorAll("div,span,p")].filter((el) => visible(el) && /yapmalısınız|zorunlu|hata|geçersiz|bulunamadı/i.test(el.innerText || "") && (el.innerText || "").length < 160);
    return t.length ? norm(t[t.length - 1].innerText) : "";
  };

  // ---------- şube ----------
  /** Seçili şube: React ağacında selectedCafe (ref), cafeId (prop) ya da şube verisi (operationalCafeId + cafeName). */
  function findCafe() {
    const isId = (v) => typeof v === "string" && /^[A-Za-z0-9]{15,40}$/.test(v);
    const rootEl = document.getElementById("root");
    const ck = rootEl && Object.keys(rootEl).find((k) => k.startsWith("__reactContainer"));
    const stack = ck ? [rootEl[ck]] : [];
    let byProp = null;
    let byData = null;
    for (let seen = 0; stack.length && seen < 100000; seen++) {
      const f = stack.pop();
      if (!f) continue;
      for (let st = f.memoizedState, i = 0; st && i < 40; st = st.next, i++) {
        const v = st.memoizedState;
        if (v && typeof v === "object") {
          if (v.current && isId(v.current.selectedCafe)) return { cafeId: v.current.selectedCafe, cafeName: byData?.cafeName || "" };
          if (!byData && isId(v.operationalCafeId)) byData = { cafeId: v.operationalCafeId, cafeName: typeof v.cafeName === "string" ? v.cafeName : "" };
        }
      }
      const p = f.memoizedProps;
      if (!byProp && p && typeof p === "object" && isId(p.cafeId)) byProp = { cafeId: p.cafeId, cafeName: "" };
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    const ls = localStorage.getItem("suitable_connection_cafe_id");
    return byProp || byData || (isId(ls) ? { cafeId: ls, cafeName: "" } : null);
  }
  async function cafeInfo() {
    const found = findCafe();
    if (!found) throw new Error("POS şubesi bulunamadı. Sayfayı yenileyip tekrar deneyin.");
    const cafeId = found.cafeId;
    let cafeName = found.cafeName || "";
    if (cafeName) return { cafeId, cafeName };
    try {
      const d = (await firebase.firestore().collection("cafe").doc(cafeId).get()).data() || {};
      cafeName = d.name || d.title || d.cafeName || "";
    } catch {
      /* ad okunamazsa başlıktan */
    }
    if (!cafeName) cafeName = norm([...document.querySelectorAll("div,span")].find((el) => /ŞUBE|ŞUBESİ/.test(el.innerText || "") && (el.innerText || "").length < 60)?.innerText);
    return { cafeId, cafeName };
  }

  // ---------- okuma ----------
  async function readMenu() {
    const { cafeId, cafeName } = await cafeInfo();
    const db = firebase.firestore();
    const cats = await db.collection("cafe").doc(cafeId).collection("menu").get();
    const products = [];
    for (const c of cats.docs) {
      const cat = c.data();
      const ps = await c.ref.collection("products").get();
      for (const p of ps.docs) {
        const d = p.data();
        products.push({
          id: p.id,
          name: norm(d.name).slice(0, 200) || p.id,
          category: norm(cat.name).slice(0, 200),
          sku: d.sku ? String(d.sku).slice(0, 100) : null,
          active: d.isActive !== false && d.active !== false && cat.isActive !== false,
          price: Number(d.price) || 0,
          variants: (d.variants || []).map((v) => ({ name: norm(v.name).slice(0, 100), price: Number(v.price) || 0 })).slice(0, 50),
          options: (d.options || [])
            .filter((o) => o && o.name)
            .map((o) => ({
              name: norm(o.name).slice(0, 200),
              min: Math.max(0, Number(o.minSelection) || 0),
              max: Math.max(0, Number(o.maxSelection) || 0),
              items: (o.items || []).filter((i) => i && i.name).map((i) => ({ name: norm(i.name).slice(0, 200), price: Number(i.price) || 0 })).slice(0, 200),
            }))
            .slice(0, 50),
        });
      }
    }
    return { cafeId, cafeName, products };
  }

  function addressText(a) {
    const street = [norm(a.street), a.aptNo ? `No:${norm(a.aptNo)}` : "", a.floor ? `Kat:${norm(a.floor)}` : "", a.doorNo ? `D:${norm(a.doorNo)}` : ""].filter(Boolean).join(" ");
    return [norm(a.neighborhood), street, norm(a.buildingName), norm(a.address), [norm(a.district), norm(a.city)].filter(Boolean).join("/")].filter(Boolean).join(", ");
  }

  async function readCustomers(reqId) {
    const { cafeId } = await cafeInfo();
    const col = firebase.firestore().collection("cafe").doc(cafeId).collection("customers");
    let last = null;
    let total = 0;
    for (let page = 0; page < 500; page++) {
      let q = col.orderBy(firebase.firestore.FieldPath.documentId()).limit(1000);
      if (last) q = q.startAfter(last);
      const s = await q.get();
      if (s.empty) break;
      last = s.docs[s.docs.length - 1];
      const customers = s.docs.map((d) => {
        const x = d.data();
        return { name: norm(x.fullName).slice(0, 200) || null, phones: [x.phone1, x.phone2].filter(Boolean).map(String).slice(0, 5), addresses: (x.addresses || []).map(addressText).filter((t) => t.length >= 5).slice(0, 30) };
      });
      total += customers.length;
      post({ id: reqId, progress: { page, customers, done: s.size < 1000 } });
      if (s.size < 1000) break;
    }
    return { total, cafeId };
  }

  // ---------- sipariş doldurma ----------
  const cartRoot = () => [...document.querySelectorAll("div")].filter((d) => visible(d) && /Toplam Tutar/.test(d.innerText || "") && /Sipariş Oluştur/.test(d.innerText || "")).sort((a, b) => a.innerText.length - b.innerText.length)[0];
  const cartTotal = () => {
    const el = [...document.querySelectorAll("*")].find((e) => visible(e) && norm(e.innerText).startsWith("Toplam Tutar") && e.children.length <= 3);
    const m = el && norm(el.innerText).match(/([\d.,]+)\s*$/);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  };
  // Sepet satırı: .order-item-card (ad .oi-name "Ürün - Porsiyon", adet .oi-count-num, artır .oi-plus, menü .oi-menu-btn)
  const cartLines = () => [...document.querySelectorAll(".order-item-card")].filter(visible);
  const lineName = (card) => norm(card.querySelector(".oi-name")?.innerText);
  const lastLineOf = (productName) => cartLines().filter((c) => key(lineName(c)).startsWith(key(productName))).pop();
  const customerModal = () => [...document.querySelectorAll("div")].filter((d) => visible(d) && /Müşteri Seç/.test(d.innerText || "") && /Yeni Müşteri/.test(d.innerText || "") && d.querySelector("input")).sort((a, b) => a.innerText.length - b.innerText.length)[0];

  async function chooseCustomer(order, warn) {
    let modal = customerModal();
    if (!modal) {
      const btn = [...document.querySelectorAll("button")].find((b) => visible(b) && /Müşteri Seç/.test(b.innerText));
      if (btn) {
        btn.click();
        modal = await waitFor(customerModal, 3000);
      }
    }
    if (!modal) throw new Error("Müşteri seçme penceresi açılamadı. Paket ekranında yeni bir sipariş açın.");
    const digits = (order.customer.phone || "").replace(/\D/g, "");
    const local = digits.startsWith("90") ? digits.slice(2) : digits;
    if (!local) throw new Error("Siparişte müşteri telefonu yok; müşteriyi elle seçin.");
    const search = [...modal.querySelectorAll("input")].find((i) => /Telefon veya isim/i.test(i.placeholder || ""));
    setValue(search, local);
    await sleep(1200);
    const pretty = (s) => s.replace(/\D/g, "");
    const isPick = (b) => /^Seç(\s|$)/.test(norm(b.innerText));
    const rows = [...modal.querySelectorAll("div")].filter((d) => pretty(d.innerText || "").includes(local) && [...d.querySelectorAll("button")].some(isPick));
    const row = rows.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (row) {
      [...row.querySelectorAll("button")].find(isPick).click();
      await waitFor(() => !customerModal(), 3000);
      // Seçilen adres WhatsApp adresinden farklı olabilir: kapı/no ya da sokak geçmiyorsa uyar
      const chip = norm([...document.querySelectorAll("button,div")].filter((el) => visible(el) && /MAHALLES|Mah\.|Sok|Cad/i.test(el.innerText || "") && (el.innerText || "").length < 160).map((el) => el.innerText).sort((a, b) => a.length - b.length)[0]);
      const words = key(order.address).split(" ").filter((w) => w.length >= 4).slice(0, 4);
      if (order.address && words.length && !words.some((w) => key(chip).includes(w))) warn(`Kayıtlı müşterinin POS adresi WhatsApp adresinden farklı olabilir. WhatsApp adresi: ${order.address}`);
      return "found";
    }
    // Yeni müşteri: ad, telefon, adres (il/ilçe şubenin varsayılanı; mahalle adresten tahmin edilir)
    const tab = [...modal.querySelectorAll("*")].find((el) => norm(el.innerText) === "Yeni Müşteri" && clickable(el)) || [...modal.querySelectorAll("*")].find((el) => norm(el.innerText) === "Yeni Müşteri");
    tab.click();
    await sleep(600);
    modal = customerModal() || modal;
    const byLabel = (txt, sel = "input") => {
      const lab = [...modal.querySelectorAll("label")].find((l) => norm(l.innerText) === txt);
      for (let n = lab, d = 0; n && d < 4; d++, n = n.parentElement) {
        const el = n.querySelector(sel);
        if (el) return el;
      }
      return null;
    };
    const byPh = (ph) => [...modal.querySelectorAll("input")].find((i) => i.placeholder === ph);
    setValue(byLabel("Ad Soyad"), order.customer.name || "WhatsApp Müşterisi");
    setValue(modal.querySelector('input[name="phone"]'), local);
    const title = [...modal.querySelectorAll("input")].find((i) => i.placeholder === "Başlık");
    if (title) setValue(title, "WhatsApp");
    const addr = norm(order.address);
    if (byPh("Sokak")) setValue(byPh("Sokak"), addr.slice(0, 150));
    if (byPh("Adres 1")) setValue(byPh("Adres 1"), addr.slice(0, 250));
    const mah = (addr.match(/([A-Za-zÇĞİÖŞÜçğıöşü0-9.]+)\s+mah/i) || [])[1];
    const mahSelect = await waitFor(() => [...(customerModal() || modal).querySelectorAll("select")].find((s) => [...s.options].some((o) => /MAHALLE/i.test(o.text))), 3000);
    if (mah && mahSelect) {
      const opt = [...mahSelect.options].find((o) => key(o.text).startsWith(key(mah)));
      if (opt) setValue(mahSelect, opt.value);
      else warn(`Mahalle POS listesinde bulunamadı (${mah}); müşteri kaydında mahalleyi seçin.`);
    } else warn(mah ? "Mahalle listesi yüklenemedi; müşteri kaydında mahalleyi seçin." : "Adreste mahalle bulunamadı; müşteri kaydında mahalleyi kontrol edin.");
    await sleep(300);
    buttonByText("Ekle", modal)?.click();
    const closed = await waitFor(() => !customerModal(), 4000);
    if (!closed) throw new Error(`Yeni müşteri kaydedilemedi${lastToastError() ? `: ${lastToastError()}` : ""}. Formu tamamlayıp "Ekle"ye basın, sonra yeniden "POS'a doldur" deyin.`);
    return "created";
  }

  const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  // Ürün penceresi: .modal.show; grup başlığı .new-option-title ("Porsiyon*"), seçim .new-option-item (seçili: --selected)
  const productModal = () => [...document.querySelectorAll(".modal.show")].find((m) => visible(m) && buttonByText("Ekle", m) && m.querySelector(".new-option-title, .new-option-item"));
  const titleKey = (t) => key(norm(t).replace(/\(opsiyonel\)/i, "").replace(/\*\s*$/, ""));
  function optionSections(modal) {
    const titles = [...modal.querySelectorAll(".new-option-title")];
    const items = [...modal.querySelectorAll(".new-option-item")];
    return titles.map((t, i) => ({ el: t, title: titleKey(t.innerText), items: items.filter((it) => after(t, it) && (!titles[i + 1] || after(it, titles[i + 1]))) }));
  }
  const itemName = (it) => norm(it.querySelector(".new-option-item-name")?.innerText || norm(it.innerText).split("₺")[0]);
  async function pick(modal, groupName, choiceName) {
    let sec = optionSections(modal).find((x) => x.title === key(groupName));
    if (!sec || !sec.items.length) {
      // Kapalı (açılır) grup: başlığa tıkla, yeniden tara
      const head = [...modal.querySelectorAll("button,div")].find((el) => clickable(el) && titleKey(el.innerText) === key(groupName));
      if (head) {
        head.click();
        await sleep(400);
        sec = optionSections(modal).find((x) => x.title === key(groupName));
      }
    }
    const item = sec?.items.find((it) => key(itemName(it)) === key(choiceName));
    if (!item) return false;
    if (!item.classList.contains("new-option-item--selected")) item.click();
    await sleep(150);
    return true;
  }

  async function addLine(line, warn) {
    const p = line.pos;
    const search = [...document.querySelectorAll("input")].find((i) => i.placeholder === "Ürün Ara" && visible(i));
    if (!search) throw new Error("Ürün arama kutusu bulunamadı.");
    setValue(search, p.productName);
    const card = await waitFor(() => [...document.querySelectorAll("*")].filter((el) => visible(el) && clickable(el) && key(norm(el.innerText).split("₺")[0]) === key(p.productName)).sort((a, b) => a.innerText.length - b.innerText.length)[0], 3000);
    if (!card) {
      warn(`POS'ta bulunamadı, elle ekleyin: ${line.quantity}× ${line.name}`);
      return false;
    }
    const before = cartLines().length;
    const totalBefore = cartTotal();
    card.click();
    const dlg = await waitFor(productModal, 3000);
    if (dlg) {
      if (p.variant && !(await pick(dlg, "Porsiyon", p.variant))) warn(`${line.name}: porsiyon "${p.variant}" seçilemedi`);
      for (const g of p.options) for (const c of g.choices) if (!(await pick(dlg, g.group, c))) warn(`${line.name}: "${g.group}" içinde "${c}" seçilemedi`);
      buttonByText("Ekle", dlg).click();
      const ok = await waitFor(() => !visible(dlg) || !document.body.contains(dlg), 2500);
      if (!ok) {
        const why = lastToastError();
        buttonByText("Kapat", dlg)?.click();
        await sleep(300);
        warn(`Eklenemedi, elle ekleyin: ${line.quantity}× ${line.name}${why ? ` (${why})` : ""}`);
        return false;
      }
    }
    await waitFor(() => cartLines().length > before || cartTotal() !== totalBefore, 2500);
    // Adet: son eklenen satırın "+" düğmesi
    if (line.quantity > 1) {
      const card2 = lastLineOf(p.productName);
      const plus = card2?.querySelector(".oi-plus");
      if (plus) {
        for (let i = 1; i < line.quantity; i++) {
          plus.click();
          await sleep(250);
        }
        const count = Number(norm(card2.querySelector(".oi-count-num")?.innerText));
        if (count && count !== line.quantity) warn(`${line.name}: adet ${count} görünüyor, ${line.quantity} olmalı`);
      } else warn(`${line.name}: adet ${line.quantity} yapılamadı, elle düzeltin`);
    }
    if (line.note) await lineNote(p.productName, line.note, warn);
    return true;
  }

  async function lineNote(productName, text, warn) {
    const target = lastLineOf(productName)?.querySelector(".oi-menu-btn");
    if (!target) return warn(`Ürün notu eklenemedi (${productName}): ${text}`);
    target.click();
    const item = await waitFor(() => [...document.querySelectorAll("*")].find((el) => visible(el) && norm(el.innerText) === "Ürüne Not Ekle" && el.children.length === 0), 2000);
    if (!item) return warn(`Ürün notu eklenemedi (${productName}): ${text}`);
    (clickable(item) ? item : item.closest("a,button,li,div")).click();
    const ta = await waitFor(() => [...document.querySelectorAll("textarea")].find(visible), 2000);
    if (!ta) return warn(`Ürün notu eklenemedi (${productName}): ${text}`);
    setValue(ta, text.slice(0, 200));
    buttonByText("Kaydet")?.click();
    await sleep(400);
  }

  async function orderNote(text, warn) {
    // Sepet üstündeki hızlı işlemler: .order-quick-action-btn (kalem = Sipariş Detayları)
    const target = [...document.querySelectorAll(".order-quick-action-btn")].find((b) => visible(b) && b.querySelector(".fa-edit, .fa-pen-to-square"));
    if (!target) return warn(`Sipariş notu yazılamadı: ${text}`);
    target.click();
    const dlg = await waitFor(() => [...document.querySelectorAll("div")].filter((d) => visible(d) && /^Sipariş Detayları/.test(norm(d.innerText)) && /Kaydet/.test(d.innerText)).sort((a, b) => a.innerText.length - b.innerText.length)[0], 2000);
    if (!dlg) return warn(`Sipariş notu yazılamadı: ${text}`);
    // "Paket Teslimat / Gel Al" anahtarına DOKUNULMAZ (açılırsa Gel Al olur)
    const ta = dlg.querySelector("textarea");
    setValue(ta, text.slice(0, 100));
    buttonByText("Kaydet", dlg).click();
    await sleep(400);
  }

  async function payment(pay, warn) {
    const direct = pay.sub && buttonByText(pay.sub);
    if (direct) return direct.click();
    const main = buttonByText(pay.button);
    if (!main) return warn(`Ödeme şekli seçilemedi (${pay.label}); elle seçin.`);
    main.click();
    if (pay.sub) {
      const sub = await waitFor(() => buttonByText(pay.sub) || [...document.querySelectorAll("*")].find((el) => visible(el) && clickable(el) && norm(el.innerText) === pay.sub), 1500);
      if (sub) sub.click();
      else warn(`Yemek çeki türü seçilemedi (${pay.sub}); elle seçin.`);
    }
  }

  async function fillOrder(order) {
    const warnings = [];
    const warn = (w) => warnings.push(w);
    if (!/\/app\/order\/Paket/.test(location.pathname)) throw new Error("Önce POS'ta Paket sipariş ekranını açın.");
    if (cartLines().length) throw new Error("Sepet boş değil. Yeni bir Paket siparişi açıp tekrar deneyin.");
    const who = await chooseCustomer(order, warn);
    for (const line of order.lines) {
      if (!line.pos) {
        warn(`POS karşılığı yok, elle ekleyin: ${line.quantity}× ${line.name}${line.note ? ` (${line.note})` : ""}`);
        continue;
      }
      await addLine(line, warn);
    }
    const search = [...document.querySelectorAll("input")].find((i) => i.placeholder === "Ürün Ara" && visible(i));
    if (search) setValue(search, "");
    const note = [`WA#${order.id}`, order.note, order.discountKurus > 0 ? `İndirim ${order.discountNote}` : ""].filter(Boolean).join(" · ");
    await orderNote(note, warn);
    await payment(order.payment, warn);
    await sleep(300);
    const posTotal = cartTotal();
    const waTotal = order.totalKurus / 100;
    if (posTotal !== null && Math.abs(posTotal - waTotal) > 0.009) warn(`Tutar farkı: POS ${posTotal.toFixed(2)} TL, WhatsApp ${waTotal.toFixed(2)} TL. Kontrol edin.`);
    if (order.discountKurus > 0) warn(`WhatsApp'ta indirim var (${order.discountNote}): müşteri ${order.payableText} ödeyecek. POS'ta indirimi uygulayın.`);
    return { customer: who, posTotal, warnings };
  }

  /**
   * Sipariş listesinden doğru işletmenin Paket ekranını açar: "Paket Sipariş Oluştur" → (birden çok işletme varsa)
   * "Siparişin alınacağı işletmeyi seçin" penceresinde işletmeyi seç → "Sipariş Ekranını Aç".
   */
  async function openPaketFor(cafeName) {
    if (/\/app\/order\/Paket/.test(location.pathname)) return "already";
    const btn = [...document.querySelectorAll("button")].find((b) => visible(b) && /Paket Sipariş Oluştur/i.test(norm(b.innerText)));
    if (!btn) throw new Error('"Paket Sipariş Oluştur" düğmesi bulunamadı. POS\'ta sipariş listesine dönüp tekrar deneyin.');
    btn.click();
    const modal = await waitFor(() => [...document.querySelectorAll(".modal.show")].find((m) => visible(m) && /işletmeyi seçin/i.test(m.innerText || "")) || (/\/app\/order\/Paket/.test(location.pathname) ? "nav" : null), 3000);
    if (modal && modal !== "nav") {
      const want = key(cafeName);
      const clean = (t) => key(norm(t).replace(/Ana İşletme/i, ""));
      const opts = [...modal.querySelectorAll("*")].filter((el) => clickable(el) && norm(el.innerText) && norm(el.innerText).length < 90 && !buttonByText(norm(el.innerText), modal));
      const inner = opts.filter((el) => !opts.some((o) => o !== el && el.contains(o)));
      const pool = inner.length ? inner : opts;
      const opt = pool.find((el) => clean(el.innerText) === want) || pool.find((el) => clean(el.innerText).includes(want) || (want && want.includes(clean(el.innerText))));
      if (!opt) throw new Error(`İşletme seçim penceresinde "${cafeName}" bulunamadı. İşletmeyi elle seçip ekranı açın, sonra tekrar "POS'a doldur" deyin.`);
      opt.click();
      await sleep(300);
      const open = [...modal.querySelectorAll("button")].find((b) => visible(b) && /Sipariş Ekranını Aç/i.test(norm(b.innerText)));
      if (!open) throw new Error('"Sipariş Ekranını Aç" düğmesi bulunamadı.');
      open.click();
    }
    const ok = await waitFor(() => /\/app\/order\/Paket/.test(location.pathname), 5000);
    if (!ok) throw new Error("Paket sipariş ekranı açılamadı.");
    await waitFor(() => customerModal() || document.querySelector(".order-list"), 6000);
    return "opened";
  }

  // Sipariş listesinde (Sipariş Oluştur sonrası) WA#<id> notlu satırın POS numarası
  function findCreated(orderId) {
    const tag = `WA#${orderId}`;
    // POS numarası "#002"; not içindeki "WA#…" sayılmaz
    const refRe = /(?<![A-Za-z])#(\d{2,})(?!\d)/g;
    const row = [...document.querySelectorAll("div,tr")]
      .filter((d) => visible(d) && (d.innerText || "").includes(tag) && [...(d.innerText || "").matchAll(refRe)].length)
      .sort((a, b) => a.innerText.length - b.innerText.length)[0];
    const m = row && [...row.innerText.matchAll(refRe)][0];
    return m ? `#${m[1]}` : null;
  }

  // ---------- köprü ----------
  function post(msg) {
    window.postMessage({ source: "tndrwa-page", ...msg }, location.origin);
  }
  const commands = { cafeInfo, readMenu, readCustomers, fillOrder, findCreated, openPaketFor };
  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.data?.source !== "tndrwa-ext") return;
    const { id, cmd, args = [] } = e.data;
    const fn = commands[cmd];
    if (!fn) return post({ id, error: `Bilinmeyen komut: ${cmd}` });
    try {
      post({ id, result: await fn(...args, ...(cmd === "readCustomers" ? [id] : [])) });
    } catch (err) {
      post({ id, error: String(err && err.message ? err.message : err) });
    }
  });
})();
