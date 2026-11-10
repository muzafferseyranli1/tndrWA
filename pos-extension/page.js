// yrndWA POS köprüsü — POS sayfasının kendi ortamında (MAIN world) çalışır.
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
  function findCafe(strict = false) {
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
      if (!byProp && p && typeof p === "object" && (isId(p.cafeId) || isId(p.selectedCafe))) byProp = { cafeId: isId(p.cafeId) ? p.cafeId : p.selectedCafe, cafeName: "" };
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    const ls = localStorage.getItem("suitable_connection_cafe_id");
    return byProp || byData || (!strict && isId(ls) ? { cafeId: ls, cafeName: "" } : null);
  }
  async function cafeInfo() {
    // Sayfa yeni açıldıysa POS arayüzü yüklenene kadar beklenir; tarayıcıda kalan eski işletme kimliği (localStorage) yalnız son çaredir
    const found = (await waitFor(() => findCafe(true), 4000, 200)) || findCafe();
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
  // Paket (WhatsApp) fiyatı: kanal fiyatı "delivery"; yoksa ürünün/porsiyonun kendi fiyatı
  const paketPrice = (x) => Number(x?.channelPrices?.delivery) || Number(x?.price) || 0;
  async function cafeNameOf(cafeId) {
    try {
      const d = (await firebase.firestore().collection("cafe").doc(cafeId).get()).data() || {};
      return norm(d.name || d.title || d.cafeName || "");
    } catch {
      return "";
    }
  }

  /** POS menüsü: açık işletmenin ya da verilen işletmenin (otomatik eşitleme) */
  async function readMenu(forCafeId) {
    const { cafeId, cafeName } = forCafeId ? { cafeId: forCafeId, cafeName: await cafeNameOf(forCafeId) } : await cafeInfo();
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
          price: paketPrice(d),
          variants: (d.variants || []).map((v) => ({ name: norm(v.name).slice(0, 100), price: paketPrice(v) })).slice(0, 50),
          options: (d.options || [])
            .filter((o) => o && o.name)
            .map((o) => ({
              name: norm(o.name).slice(0, 200),
              min: Math.max(0, Number(o.minSelection) || 0),
              max: Math.max(0, Number(o.maxSelection) || 0),
              items: (o.items || []).filter((i) => i && i.name).map((i) => ({ name: norm(i.name).slice(0, 200), price: paketPrice(i) })).slice(0, 200),
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

  async function readCustomers(reqId, forCafeId) {
    const { cafeId } = forCafeId ? { cafeId: forCafeId } : await cafeInfo();
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

  /** Telefonla müşteri arama (otomatik sorgu): verilen işletmelerin POS müşteri kayıtlarında phone1/phone2 eşleşenler. */
  async function lookupCustomers(phones, cafeIds) {
    const db = firebase.firestore();
    const out = [];
    for (const p of phones) {
      const d = String(p).replace(/\D/g, "");
      const local = d.startsWith("90") ? d.slice(2) : d.replace(/^0/, "");
      if (local.length < 10) continue;
      const variants = [`+90${local}`, `90${local}`, `0${local}`, local];
      for (const cafeId of cafeIds) {
        for (const field of ["phone1", "phone2"]) {
          try {
            const s = await db.collection("cafe").doc(cafeId).collection("customers").where(field, "in", variants).limit(20).get();
            for (const doc of s.docs) {
              const x = doc.data();
              out.push({ name: norm(x.fullName).slice(0, 200) || null, phones: [x.phone1, x.phone2].filter(Boolean).map(String).slice(0, 5), addresses: (x.addresses || []).map(addressText).filter((t) => t.length >= 5).slice(0, 30) });
            }
          } catch {
            /* izin yoksa o işletme atlanır */
          }
        }
      }
    }
    return out;
  }

  /**
   * Durum takibi (salt okuma): POS'a girilmiş siparişlerin POS kaydı (cafe/{id}/intOrders, fiş no + "WA#id" notu) okunur.
   * İptal (1500/1600) → CANCELLED, teslim zamanı → DELIVERED, kapandı (900) → DELIVERED, kuryeye verildi → ON_THE_WAY.
   */
  async function trackStatuses(list) {
    const db = firebase.firestore();
    const out = [];
    // İşletme başına tek sorgu: izlenen en eski siparişten 6 saat öncesinden bu yana POS siparişleri (fiş no günlük tekrarlandığı için notla eşlenir)
    const byCafe = new Map();
    for (const o of list) byCafe.set(o.posCafeId, Math.min(byCafe.get(o.posCafeId) ?? Infinity, new Date(o.posAt).getTime() - 6 * 60 * 60 * 1000));
    const docs = new Map();
    for (const [cafeId, since] of byCafe) {
      try {
        const s = await db.collection("cafe").doc(cafeId).collection("intOrders").where("time", ">=", since).limit(1000).get();
        docs.set(cafeId, s.docs.map((d) => d.data()));
      } catch {
        docs.set(cafeId, []);
      }
    }
    for (const o of list) {
      try {
        const receipt = String(o.posRef).replace(/^#/, "");
        const tag = new RegExp(`(^|\\s)WA#${o.id}(?!\\d)`);
        const doc = (docs.get(o.posCafeId) || []).find((x) => tag.test(x.note || "") && String(x.receiptNo || "") === receipt) || (docs.get(o.posCafeId) || []).find((x) => tag.test(x.note || ""));
        if (!doc) continue;
        const st = Number(doc.status);
        const event = st === 1500 || st === 1600 || doc.cancelledAt || doc.cancelTime ? "CANCELLED" : doc.deliverTime || st === 900 ? "DELIVERED" : doc.handoverTime ? "ON_THE_WAY" : null;
        if (event) out.push({ id: o.id, event, status: st });
      } catch {
        /* okunamayan atlanır, sonraki turda yeniden */
      }
    }
    return out;
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

  // Adresten mahalle adı: "Sahrayıcedit mh", "Suadiye Mah.", "Caferağa Mahallesi"
  const mahalleOf = (addr) => (norm(addr).match(/([A-Za-zÇĞİÖŞÜçğıöşü0-9.]+)\s+(mahallesi|mahalle|mah\.?|mh\.?)(?=[\s,]|$)/i) || [])[1] || "";

  /** Formdaki (son) adres bloğunu WhatsApp adresiyle doldurur: başlık, sokak, açıklama, mahalle (il/ilçe şubenin varsayılanı). */
  async function fillAddressBlock(form, order, warn) {
    const last = (ph) => [...form.querySelectorAll("input")].filter((i) => i.placeholder === ph).pop();
    const addr = norm(order.address);
    if (last("Başlık")) setValue(last("Başlık"), "WhatsApp");
    if (last("Sokak")) setValue(last("Sokak"), addr.slice(0, 150));
    if (last("Adres 1")) setValue(last("Adres 1"), addr.slice(0, 250));
    const mah = mahalleOf(addr);
    const mahSelect = await waitFor(() => [...form.querySelectorAll("select")].filter((s) => [...s.options].some((o) => /MAHALLE/i.test(o.text))).pop(), 3000);
    if (mah && mahSelect) {
      const opt = [...mahSelect.options].find((o) => key(o.text).startsWith(key(mah)));
      if (opt) setValue(mahSelect, opt.value);
      else warn(`Mahalle POS listesinde bulunamadı (${mah}); müşteri kaydında mahalleyi seçin.`);
    } else warn(mah ? "Mahalle listesi yüklenemedi; müşteri kaydında mahalleyi seçin." : "Adreste mahalle bulunamadı; müşteri kaydında mahalleyi kontrol edin.");
  }

  /** Kayıtlı müşteriye WhatsApp adresini yeni adres olarak ekler ("Adres" penceresi → "Yeni Adres Ekle" → form → "Kaydet"). */
  async function addAddress(addrDlg, order, warn) {
    const btn = buttonByText("Yeni Adres Ekle", addrDlg);
    if (!btn) return false;
    btn.click();
    const form = await waitFor(() => [...document.querySelectorAll(".modal.show")].find((m) => visible(m) && buttonByText("Kaydet", m) && [...m.querySelectorAll("input")].some((i) => i.placeholder === "Sokak")), 3000);
    if (!form) {
      warn("Müşteriye yeni adres eklenemedi (adres formu açılmadı); adresi elle ekleyin.");
      return false;
    }
    await fillAddressBlock(form, order, warn);
    await sleep(300);
    buttonByText("Kaydet", form).click();
    const closed = await waitFor(() => !visible(form) || !document.body.contains(form), 4000);
    if (!closed) {
      const why = lastToastError();
      buttonByText("İptal", form)?.click();
      warn(`Müşteriye yeni adres kaydedilemedi${why ? ` (${why})` : ""}; adresi elle ekleyin.`);
      return false;
    }
    return true;
  }

  const addrDlgNow = () => [...document.querySelectorAll(".modal.show")].find((m) => visible(m) && /^Adres/.test(norm(m.innerText)) && [...m.querySelectorAll("button")].some((b) => /Devam|Yeni Adres Ekle/i.test(b.innerText)));

  /**
   * Seçili müşteri için "Adres" penceresinde WhatsApp adresini seçer; kayıtlı adreslerde yoksa yeni adres olarak ekler.
   * Pencere kapandıysa sipariş ekranındaki adres satırına ("Adres Ekle" / seçili adres) tıklayıp yeniden açar.
   */
  async function resolveAddress(order, warn, words, score) {
    const reopen = async () => {
      let dlg = addrDlgNow();
      if (dlg) return dlg;
      const chip = [...document.querySelectorAll(".customer-address-button, button, div")].find((el) => visible(el) && (/^Adres Ekle$/.test(norm(el.innerText)) || /customer-address-button/.test(el.className || "")) && clickable(el));
      chip?.click();
      return waitFor(addrDlgNow, 2500);
    };
    const bestIn = (dlg) => {
      // Adres kartları BUTTON elemanı ("Ev SUADİYE MAHALLESİ, …"); kapatma, "Yeni Adres Ekle", "Düzenle" ve "… Adresle Devam" düğmeleri hariç
      const cards = [...dlg.querySelectorAll("*")].filter((el) => clickable(el) && !/btn-close/.test(el.className || "") && norm(el.innerText).length > 5 && norm(el.innerText).length < 300 && !/Yeni Adres Ekle|Düzenle|Kayıtlı adres yok|Devam/i.test(el.innerText));
      const inner = cards.filter((el) => !cards.some((o) => o !== el && el.contains(o)));
      return (inner.length ? inner : cards).map((el) => ({ el, s: score(el.innerText) })).sort((a, b) => b.s - a.s)[0];
    };
    let dlg = await waitFor(addrDlgNow, 2000);
    if (!dlg) dlg = await reopen();
    if (!dlg) return { ok: false, diag: "Adres penceresi açılmadı" };
    let added = false;
    for (let attempt = 0; attempt < 3 && dlg; attempt++) {
      const best = bestIn(dlg);
      if (best && best.s > 0) {
        best.el.click();
        await sleep(300);
        const go = [...dlg.querySelectorAll("button")].find((b) => visible(b) && /Devam/i.test(b.innerText) && !b.disabled);
        if (go) go.click();
        else buttonByText("Kapat", dlg)?.click();
        await waitFor(() => !visible(dlg) || !document.body.contains(dlg), 2500);
        return { ok: true };
      }
      if (added || !order.address || !words.length) break;
      if (!(await addAddress(dlg, order, warn))) return { ok: false, diag: "yeni adres eklenemedi" };
      added = true;
      // Kaydet sonrası pencere kapanmış olabilir: adres satırından yeniden aç
      dlg = await waitFor(addrDlgNow, 2500);
      if (!dlg) dlg = await reopen();
    }
    const seen = dlg ? norm(dlg.innerText).slice(0, 140) : "pencere kapalı";
    if (dlg) buttonByText("Kapat", dlg)?.click();
    return { ok: false, diag: `adres penceresi: ${seen}` };
  }

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
    const words = key(order.address).split(" ").filter((w) => w.length >= 4).slice(0, 4);
    const score = (t) => words.filter((w) => key(t).includes(w)).length;
    const rows = [...modal.querySelectorAll("div")].filter((d) => pretty(d.innerText || "").includes(local) && [...d.querySelectorAll("button")].some(isPick));
    const innerRows = rows.filter((d) => !rows.some((o) => o !== d && d.contains(o)));
    // Aynı numarayla birden çok kayıt olabilir: adresi WhatsApp adresine benzeyen, yoksa adresi olan kayıt seçilir
    // Arama artık diğer işletmelerin müşterilerini de gösteriyor (satırda "Suadiye | Yerinde Tandır" etiketi): önce bu işletmenin kayıtları
    const here = norm((await cafeInfo().catch(() => null))?.cafeName || "");
    const otherCafe = (t) => /\S+\s\|\s\S+/.test(t) && !(here && norm(t).includes(here));
    const row = (innerRows.length ? innerRows : rows)
      .map((d) => {
        const t = norm(d.innerText);
        // "Kayıtlı adres yok" yazısı adres sayılmaz; "N sipariş" sayısı asıl kaydı ayırt eder (aynı numarayla boş kayıtlar olabiliyor)
        return { d, o: otherCafe(d.innerText) ? 1 : 0, s: score(d.innerText), a: /Kayıtlı adres yok/i.test(t) ? 0 : 1, n: Number((t.match(/(\d+)\s*sipariş/i) || [])[1]) || 0, len: t.length };
      })
      .sort((a, b) => a.o - b.o || b.s - a.s || b.a - a.a || b.n - a.n || a.len - b.len)[0]?.d;
    let diag = "";
    if (row) {
      [...row.querySelectorAll("button")].find(isPick).click();
      await waitFor(() => !customerModal(), 3000);
      // Müşteri yalnız başka işletmede kayıtlıysa POS sorar: "Bu işletmede devam et" (bilgileri bu işletmeye kopyalanır)
      const elsewhere = await waitFor(() => [...document.querySelectorAll(".modal.show")].find((m) => visible(m) && /Başka İşletmede Kayıtlı/i.test(m.innerText || "")), 1500);
      if (elsewhere) {
        const stay = [...elsewhere.querySelectorAll("button")].find((b) => visible(b) && /Bu işletmede devam/i.test(norm(b.innerText)));
        if (!stay) throw new Error('"Müşteri Başka İşletmede Kayıtlı" penceresinde "Bu işletmede devam et" bulunamadı; müşteriyi elle seçin.');
        stay.click();
        await waitFor(() => !visible(elsewhere) || !document.body.contains(elsewhere), 3000);
      }
      // Yeni POS arayüzü: müşteri seçilince "Adres" penceresi açılır; WhatsApp adresine en çok benzeyen kayıtlı adres seçilir, yoksa müşteriye yeni adres olarak eklenir
      const addrResult = await resolveAddress(order, warn, words, score);
      if (addrResult.ok) return "found";
      diag = addrResult.diag;
      // Seçilen adres WhatsApp adresinden farklı olabilir: kapı/no ya da sokak geçmiyorsa uyar
      const picked = [...document.querySelectorAll(".customer-address-button")].find((b) => visible(b) && /selected/.test(b.className)) || [...document.querySelectorAll(".customer-address-button")].find(visible);
      const chip = picked ? norm(`${picked.getAttribute("title") || ""} ${picked.innerText || ""}`) : norm([...document.querySelectorAll("button,div")].filter((el) => visible(el) && /MAHALLES|Mah\.|Sok|Cad/i.test(el.innerText || "") && (el.innerText || "").length < 160).map((el) => el.innerText).sort((a, b) => a.length - b.length)[0]);
      if (order.address && words.length && !words.some((w) => key(chip).includes(w))) warn(`Siparişe adres seçilemedi (POS'taki adres: "${chip || "yok"}"${diag ? `; ${diag}` : ""}). WhatsApp adresi: ${order.address}`);
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
    const mah = mahalleOf(addr);
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
  // Başlık: ilk satır (seçim yapılınca alt satıra seçilenler yazılır: "Extra Malzeme (Opsiyonel)" + "Domates -Ex, …")
  const titleKey = (t) => key(norm(String(t || "").split("\n")[0]).replace(/\(opsiyonel\)/i, "").replace(/\*\s*$/, ""));
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
    const needsDialog = !!p.variant || p.options.some((g) => g.choices.length);
    // Yeni POS arayüzü: karta tıklamak ürünü varsayılan porsiyonla doğrudan ekler; porsiyon/seçenek penceresi kartın ⋮ (variant-dropdown-toggle) düğmesiyle açılır
    const cardEl = card.closest(".product-card") || card;
    const toggle = cardEl.querySelector(".variant-dropdown-toggle");
    if (needsDialog && toggle) toggle.click();
    else card.click();
    const dlg = await waitFor(productModal, needsDialog ? 3000 : 1200);
    if (!dlg && needsDialog && cartLines().length > before) {
      // Pencere açılmadan eklendi: porsiyon/seçenek seçilemedi demektir; personel düzeltmeli
      const what = [p.variant ? `porsiyon "${p.variant}"` : "", ...p.options.flatMap((g) => g.choices.map((c) => `"${g.group}: ${c}"`))].filter(Boolean).join(", ");
      warn(`${line.name}: seçim penceresi açılmadı, ${what} seçilemedi; elle düzeltin`);
    }
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
    // Sepetteki satır doğru porsiyonla mı eklendi ("Kavurma / Kaşar - 1,5 Pors.")
    if (p.variant) {
      const added = lastLineOf(p.productName);
      const title = norm(added?.querySelector(".oi-name")?.innerText || added?.innerText || "");
      if (added && /\s-\s/.test(title) && !key(title).includes(key(p.variant))) warn(`${line.name}: sepette "${title}" görünüyor, porsiyon "${p.variant}" olmalı`);
    }
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

  // Siparişi oluşturmaya engel OLMAYAN uyarılar (yalnız bilgi); diğer her uyarı otomatik "Sipariş Oluştur"u durdurur
  const INFO_ONLY = [/^Mahalle POS listesinde bulunamadı/, /^Adreste mahalle bulunamadı/, /^Mahalle listesi yüklenemedi/];

  /**
   * Siparişi Paket ekranına doldurur. opts.submit: sorun yoksa "Sipariş Oluştur"a basar ve POS numarasını okur.
   * Sorun (engel) varsa oluşturmaz; sipariş doldurulmuş halde personele kalır.
   */
  async function fillOrder(order, opts = {}) {
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
    // İndirimli siparişte POS kendi kampanyasını (ör. ödeme tipine bağlı %15) uygulamış olabilir: POS toplamı ödenecek tutara eşitse sorun yok
    const payable = (order.totalKurus - (order.discountKurus || 0)) / 100;
    const same = (a, b) => Math.abs(a - b) <= 0.009;
    if (posTotal === null) warn("POS toplamı okunamadı. Tutarı kontrol edin.");
    else if (order.discountKurus > 0 && !same(posTotal, payable)) {
      if (same(posTotal, waTotal)) warn(`WhatsApp'ta indirim var (${order.discountNote}): müşteri ${order.payableText} ödeyecek. POS'ta indirim uygulanmadı; uygulayın.`);
      else warn(`Tutar farkı: POS ${posTotal.toFixed(2)} TL, WhatsApp ödenecek ${payable.toFixed(2)} TL (indirimsiz ${waTotal.toFixed(2)} TL). Kontrol edin.`);
    } else if (!order.discountKurus && !same(posTotal, waTotal)) warn(`Tutar farkı: POS ${posTotal.toFixed(2)} TL, WhatsApp ${waTotal.toFixed(2)} TL. Kontrol edin.`);
    const blockers = warnings.filter((w) => !INFO_ONLY.some((re) => re.test(w)));
    let submitted = false;
    let posRef = null;
    if (opts.submit && !blockers.length) {
      const btn = buttonByText("Sipariş Oluştur");
      if (!btn || btn.disabled) {
        blockers.push('"Sipariş Oluştur" düğmesi etkin değil.');
        warnings.push(blockers[blockers.length - 1]);
      } else {
        btn.click();
        submitted = await waitFor(() => !/\/app\/order\/Paket/.test(location.pathname), 8000);
        if (!submitted) {
          const why = lastToastError();
          blockers.push(`Sipariş oluşturulamadı${why ? `: ${why}` : ""}. Ekranı kontrol edin.`);
          warnings.push(blockers[blockers.length - 1]);
        } else {
          posRef = await waitFor(() => findCreated(order.id), 8000);
          if (!posRef) warnings.push("Sipariş oluşturuldu ama POS numarası okunamadı; sipariş listesinde görünce panele işlenecek.");
        }
      }
    }
    return { customer: who, posTotal, warnings, blockers, submitted: !!submitted, posRef };
  }

  /**
   * Sipariş listesinden doğru işletmenin Paket ekranını açar: "Paket Sipariş Oluştur" → (birden çok işletme varsa)
   * "Siparişin alınacağı işletmeyi seçin" penceresinde işletmeyi seç → "Sipariş Ekranını Aç".
   */
  // Menü → İşletme ⇄ → "İşletme Değiştir" penceresinden işletme seçer (masa ekranı kapalı, tek Paket düğmeli hesaplarda)
  async function switchCafe(cafeName, cafeId) {
    const menuBtn = [...document.querySelectorAll("button")].find((b) => visible(b) && /^Menü$/i.test(norm(b.innerText)));
    if (!menuBtn) throw new Error('İşletme değiştirilemedi: "Menü" düğmesi bulunamadı. İşletmeyi Menü → İşletme ⇄ ile elle seçin.');
    menuBtn.click();
    const item = await waitFor(() => [...document.querySelectorAll("a,button,div")].find((el) => visible(el) && /İşletme Değiştir/i.test(el.getAttribute("title") || "")), 2000);
    if (!item) throw new Error("İşletme değiştirilemedi: menüde işletme satırı bulunamadı. İşletmeyi elle seçin.");
    item.click();
    const modal = await waitFor(() => [...document.querySelectorAll(".modal.show")].find((m) => visible(m) && /İşletme Değiştir/i.test(m.innerText || "")), 3000);
    if (!modal) throw new Error('"İşletme Değiştir" penceresi açılmadı. İşletmeyi elle seçin.');
    const want = key(cafeName);
    const clean = (t) => key(norm(t).replace(/Şu anki/i, ""));
    const opts = [...modal.querySelectorAll("*")].filter((el) => clickable(el) && el.tagName !== "BUTTON" && norm(el.innerText) && norm(el.innerText).length < 90);
    const opt = opts.find((el) => clean(el.innerText) === want) || opts.find((el) => clean(el.innerText).includes(want) || (want && want.includes(clean(el.innerText))));
    const close = () => buttonByText("Vazgeç", modal)?.click();
    if (!opt) {
      close();
      throw new Error(`"İşletme Değiştir" penceresinde "${cafeName}" bulunamadı. İşletmeyi elle seçin.`);
    }
    opt.click();
    await sleep(300);
    const go = [...modal.querySelectorAll("button")].find((b) => visible(b) && /İşletmeye Geç/i.test(norm(b.innerText)));
    if (!go) {
      close();
      throw new Error('"Bu İşletmeye Geç" düğmesi bulunamadı.');
    }
    go.click();
    const ok = await waitFor(() => findCafe()?.cafeId === cafeId, 8000, 200);
    if (!ok) throw new Error(`İşletme "${cafeName}" olarak değiştirilemedi. Elle seçip tekrar deneyin.`);
    await sleep(800);
  }

  /** Paket ekranı açılmadan önce Menü'den işletme değiştirmek gerekiyor mu (masa ekranı kapalı, tek "Paket Servis" düğmeli hesap, başka işletme açık). */
  function needsSwitch(cafeId) {
    if (/\/app\/order\/Paket/.test(location.pathname)) return false;
    // "Paket Sipariş Oluştur" ya da üstteki "Paket Servis" düğmesi işletme seçme penceresini açıyorsa Menü'den değiştirmeye gerek yok
    if (paketButton()) return false;
    return !!cafeId && findCafe()?.cafeId !== cafeId;
  }

  // Paket siparişi açan düğme: sipariş listesindeki "Paket Sipariş Oluştur" ya da üst menüdeki "Suitable Yemek / Paket Servis"
  const paketButton = () =>
    [...document.querySelectorAll("button")].find((b) => visible(b) && /Paket Sipariş Oluştur/i.test(norm(b.innerText))) ||
    [...document.querySelectorAll("button")].find((b) => visible(b) && (/Paket Servis/i.test(norm(b.innerText)) || /Paket Servis siparişi/i.test(b.getAttribute("title") || "")));

  async function openPaketFor(cafeName, cafeId) {
    if (/\/app\/order\/Paket/.test(location.pathname)) return "already";
    const btn = paketButton();
    if (!btn) throw new Error('"Paket Sipariş Oluştur" düğmesi bulunamadı. POS\'ta sipariş listesine dönüp tekrar deneyin.');
    btn.click();
    const modal = await waitFor(() => [...document.querySelectorAll(".modal.show")].find((m) => visible(m) && /işletmeyi seçin/i.test(m.innerText || "")) || (/\/app\/order\/Paket/.test(location.pathname) ? "nav" : null), 3000);
    if (modal && modal !== "nav") {
      const want = key(cafeName);
      const clean = (t) => key(norm(t).replace(/Ana İşletme|Şu anki/gi, ""));
      const opts = [...modal.querySelectorAll("*")].filter((el) => clickable(el) && el.tagName !== "BUTTON" && norm(el.innerText) && norm(el.innerText).length < 90 && !buttonByText(norm(el.innerText), modal));
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
  // POS'un sipariş listesi verisi (React durumu): notu "WA#<id>" ile başlayan siparişin fiş numarası (receiptNo → "#002")
  function findCreatedInData(orderId) {
    const tagRe = new RegExp(`(^|\\s)WA#${orderId}(?!\\d)`);
    const rootEl = document.getElementById("root");
    const ck = rootEl && Object.keys(rootEl).find((k) => k.startsWith("__reactContainer"));
    if (!ck) return null;
    const stack = [rootEl[ck]];
    const seen = new Set();
    let found = null;
    const look = (v, depth) => {
      if (found || !v || typeof v !== "object" || depth > 3 || seen.has(v)) return;
      seen.add(v);
      if (typeof v.note === "string" && tagRe.test(v.note) && (v.receiptNo || v.orderNo)) {
        found = `#${String(v.receiptNo || v.orderNo).replace(/^#/, "")}`;
        return;
      }
      const vals = Array.isArray(v) ? v.slice(0, 300) : Object.keys(v).slice(0, 300).filter((k) => !k.startsWith("_") && !["return", "child", "sibling", "stateNode", "products"].includes(k)).map((k) => v[k]);
      for (const x of vals) look(x, depth + 1);
    };
    for (let n = 0; stack.length && n < 50000 && !found; n++) {
      const f = stack.pop();
      if (!f) continue;
      for (let st = f.memoizedState, i = 0; st && i < 40 && !found; st = st.next, i++) {
        try {
          look(st.memoizedState, 0);
        } catch {
          /* okunamayan durum atlanır */
        }
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return found;
  }

  function findCreated(orderId) {
    const fromData = findCreatedInData(orderId);
    if (fromData) return fromData;
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
  /**
   * Arayüz kendi kendine kontrolü (salt okuma): bulunduğu ekranda eklentinin dayandığı parçalar var mı?
   * Suitable arayüzü değişince siparişe dokunmadan önce haber vermek için. Pencere açıkken ya da ekran yüklenmemişken atlanır.
   */
  function selfCheck() {
    const path = location.pathname;
    const open = [...document.querySelectorAll(".modal.show")].some(visible);
    if (open) return { path, missing: [], skipped: "pencere açık" };
    const has = (sel) => [...document.querySelectorAll(sel)].some(visible);
    const missing = [];
    if (/\/app\/order\/Paket/.test(path)) {
      if (!document.querySelector(".order-container, .order-left-col, .order-item-card, [class*='order-']")) return { path, missing: [], skipped: "ekran yüklenmedi" };
      if (!buttonByText("Sipariş Oluştur")) missing.push('"Sipariş Oluştur" düğmesi');
      if (!has(".order-quick-action-btn")) missing.push("sepet hızlı işlem düğmeleri (sipariş notu)");
      if (!buttonByText("Kredi Kartı") && !buttonByText("Nakit")) missing.push("ödeme düğmeleri");
      if (![...document.querySelectorAll("input")].some((i) => i.placeholder === "Ürün Ara" && visible(i))) missing.push("ürün arama kutusu");
    } else if (/\/app\/(tables|orderlist|all-orders)/.test(path)) {
      if (!buttonByText("Menü")) return { path, missing: [], skipped: "ekran yüklenmedi" };
      if (!paketButton()) missing.push("Paket sipariş düğmesi");
    } else return { path, missing: [], skipped: "bu ekran izlenmiyor" };
    return { path, missing };
  }

  const commands = { cafeInfo, selfCheck, readMenu, readCustomers, lookupCustomers, trackStatuses, fillOrder, findCreated, openPaketFor, needsSwitch, switchCafe };
  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.data?.source !== "tndrwa-ext") return;
    const { id, cmd, args = [] } = e.data;
    const fn = commands[cmd];
    if (!fn) return post({ id, error: `Bilinmeyen komut: ${cmd}` });
    try {
      post({ id, result: await fn(...(cmd === "readCustomers" ? [id] : []), ...args) });
    } catch (err) {
      post({ id, error: String(err && err.message ? err.message : err) });
    }
  });
})();
