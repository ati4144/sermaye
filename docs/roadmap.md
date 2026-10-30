# Sermaye — Geliştirme Yol Haritası

Oluşturuldu: 2026-10-14 · Proje durumu: **v9, tüm kapılar yeşil** (297/297 vitest, tsc, expo lint, web export, jsdom smoke) · M3 sevk edildi (2026-10-15) · v7 Gelir & Takvim sevk edildi (2026-10-17) · v8 Vatan & Enflasyon sevk edildi (2026-10-18) · **v9 Vadeli Mevduat sevk edildi (2026-10-30, M5'ten öne çekildi)**

Bu doküman, tasarım dokümanlarındaki (kader/yatirim/dunya) faz planlarını tek bir sıralamaya dizer: her kilometre taşı bir çalışma birimi, belli kabul kriterleriyle.

---

## 0. Mevcut durum (v9)

| Katman | Sürüm | İçerik |
|---|---|---|
| Kader (kader) | v2 MVP | 5 kader, anket + mühürlü açılış, faz 2.5 kader vuruşları, miras/intikal; v6 varlık kancaları (`gk_memleket_evi`, `ab_tarla_rehni`, `eve_cikma` beşibirliği) |
| Yatırım (varlıklar) | v3 | Altın (kesirli) + daire/tarla/klasik araç/**villa** (tapu), 4 ASSET olayı, likidasyon merdiveni; v6 `ACTIVATE_ASSET` opt-in (healAssets donmuş anlık görüntü) |
| Dünya (dünya) | v4 | 4 rejim + aylık geçiş, gündem paketi '2026-10', 3 senaryo (1973 stagflasyon, 2008 GFC, 1990 Japonya), analist koni tahmini |
| Gider (masraflar) | v5 | Yaşam tarzı kalem setleri (4 kademe), nakit akışı kartı, kalem CRUD |
| Yuva & escrow | v6 | `LIST_ASSET`/`CANCEL_LISTING` (6 ay escrow, proceeds ilanda kilitli), `SET_ROLE` + homeRelief, Yuva kartı, zorunlu satış bildirimi |
| Gelir & Takvim | v7 | Aylık maaş katmanı (oyun başında sorulur, SET_SALARY ile elle düzenlenir, yıllık zam gözden geçirmesi), sağlık-kapılı işsizlik (histererez 35/50), **sıfır çekiş**; takvim tarihi saf türetme (`gameYearMonth`: panel "Ekim 2026", Geçmiş "Eki 2026") |
| Vatan & Enflasyon | v8 | Ev ülkesi seçimi (oyun başında sorulur; 10 ülke), ülke CPI kataloğu + senaryo yay üstüne yazımları + rejim eğimi (**sıfır çekiş**), varlık drift'ine nominal enflasyon eki, kümülatif TÜFE ile endeksli yaşam sepeti + eriyen iflas eşiği |
| Vadeli Mevduat | v9 | 3/6/12 ay vadeli (CPI + vade primi açılışta kilitli, **sıfır çekiş**), türetilmiş faiz (state'te yalnız anapara+oran+vade), faz 4c'te escrow ön-örnekli vade kredisi, erken bozumda faiz yanar, en fazla 4 eşzamanlı |
| Para birimi | UI | USD/TL/EUR/GBP/JPY/CHF/CNY/INR/AED/BRL/NGN gösterim katmanı (motor USD kalır); ülke seçimi görüntü para birimi varsayılanı, ayarlar override |

**Altın kurallar (her adımda geçerli):**
1. Legacy golden `1b9d3a91` (v2) **asla kıpırdamaz** — test tam olarak `{assets, properties, world, expenses, home, pendingSales, income, residency}` soyup `schemaVersion→2` normalleştirir.
2. v3 `5e13babd`, v5 (`adb1362` / `449da977` / `9aefb4a`), v6 (`1da84d4f` / `d252d31a`), v7 (`2e81a393`) ve v8 (`f8deb445` / `fc78708d`) yalnızca **bilinçli** denge değişikliğinde hareket eder; commit mesajında nedeni yazılır.
3. Çekiş bütçesi sözleşmesi (sim.ts docblock) bozulmaz; aksiyon-zamanı rng yoktur.
4. Her teslimde: vitest + `tsc --noEmit` + `expo lint` + web export + (değişiklik varsa) golden bilinçli bump.
5. `holdings` paylaşımlı kayıttır (ülkeler + kesirli varlıklar) — UI asla anahtarlarının ülke id'si olduğunu varsaymaz.

**v7 sevk notu (2026-10-17):** gelir katmanı kullanıcı isteğiyle yola çıktı ("kişinin aylık geliri olmalı" + "hangi tarihte olduğumuz görünmeli"). Katman tamamen **çekişsiz**: maaş kredisi faz 4a-pre'te (levy tabanı `worthBefore` krediden SONRA — bilinçli, sim.ts yorumunda), işsizlik geçişleri faz 3.5'te saf sağlık koşulu + histererez (JOB_LOSS 35 / JOB_RETURN 50), miras varisi yeniden işe alır (maaş hanedanın konumu olarak kalır). Takvim = `gameYearMonth` saf türetmesi (state yazısı yok; çaplar: Güncel Ekim 2026, 1973→Ekim 1973, 2008→Eylül 2008, Japonya→**Aralık 1989** Nikkei zirvesi). UI: oyun başı maaş sorusu → `SET_SALARY` (elle her an), yıllık "Zam Ayı" gözden geçirmesi (render-türetmeli, SET_SALARY imleci damgalar), eski kayıtlarda INIT_INCOME banner'ı, CashflowCard'ta Maaş satırı / dim İşsiz satırı. **Bilinçli golden hareketleri:** v6 çifti `11921228`→`adf87bdb` / `a8dae17f`→`2a6f1018` (yalnızca `"income":null` anahtarı state JSON'una girdi — nakit yolu birebir); v2/v3/v5 beş golden pre-run `income=null` ile **hareketsiz**; yeni v7 tam-durum golden `e7705c77` (maaşlı kiracı yolu, 120 ay). Geçmiş görünürlüğü: `enqueueLifeNotice` (kuyruğa alır VE log yazar — `job_loss`/`job_return`; ACK'in asla log yazmaması desenine çözüm).

**v8 sevk notu (2026-10-18):** vatan katmanı kullanıcı isteğiyle yola çıktı ("oyuna giren kişi hangi ülkede olduğunu seçecek; para birimi buna göre; o ülkenin enflasyonu varlıkları etkilesin"). Kapsam kararı: **varlıklar + yaşam maliyeti** — varlık drift'ine aylık CPI nominal ek olarak girer (`assetDriftVol`'de korunan sonda-ekleme, asla `+0`, rejim çarpanına tabi değil), yaşam **sepeti** kümülatif TÜFE ile endekslenir (`livingClampFor` motor+UI paylaşımlı dikiş — taban VE `LIVING.MAX` tavanı endekslenir; servet vergisi bilinçli olarak endekslenmez çünkü tabanı olan `worth` varlık fiyatları üzerinden zaten kendini endeksler — çifte sayma), iflas eşiği `THRESHOLD × cpiMult` ile erir, maaş **nominal kalır** (v7 zam ayı enflasyon savunması), ülke borsa endeksleri CPI geçirmez. Enflasyon kaynakları: `HOME_INFLATION` ülke kataloğu (tr .40, ng .18, in .055 …) × `REGIME_TILT` (yalnız katalog hızlarına) ?? senaryo yay üstüne yazımları (yay-pencere kapısız: `beatCursor < beats.length` — yoksa 1973 ABD %6,5'i 50. yılda ×25 bileşikler; yay sonunda katalog döner: Volcker sonrası ~.025). Katman **tamamen çekişsiz** — rng'ye hiç dokunulmaz; `cpi: 1` inert yolları IEEE-754 `x*1 === x` ile bayt-birebir. Göç yok: `INIT_RESIDENCY` yalnız eski kayıtların banner'ından (cpi 100'den bugünden başlar — geçmiş yok sayılır). UI: oyun başı ülke adımı (dönemden sonra, maaştan önce; kartta para birimi + `≈%40/yıl` çipi; Devam `setCurrency` varsaylar), panel çipi `Türkiye · TÜFE 148`, CashflowCard tahmininde `Enflasyon ×1,48` dim satırı, Zam Ayı'nda TÜFE ipucu, Geçmiş'te `residency_init`. Para birimi kataloğuna 4 yeni (INR/AED/BRL/NGN — sona eklendi, sıra pinleri durur). **Bilinçli golden hareketleri:** v6 çifti `adf87bdb`→`e22685cd` / `2a6f1018`→`cd6e3fe4` ve v7 `e7705c77`→`15e97c19` (üçü de yalnızca version 8 + `"residency":null` anahtarı — mekanik, nakit yolu birebir); v2/v3/v5 beş golden pre-run `residency=null` ile **hareketsiz**; yeni v8 tam-durum golden'lar `45bafa91` (us kiracı, cpi 129.0107 @120 ay) + `2ab8644` (tr yüksek enflasyon, cpi 1060.0144 — yay üstüne yazımı + katalog karışımı).

**v9 sevk notu (2026-10-30):** vadeli mevduat kullanıcı isteğiyle yola çıktı ("parayı vadeliye yatırma olsun") ve M5'ten öne çekildi (kullanıcı kararı; hisseler için "gerçek aylık seriler" kararı da alındı — M4/v10). Tasarım: **sıfır çekiş** tesisat katmanı — `deposits: DepositState[]` hep-dizi (INIT yok, soruman katmanı değil), oran açılışta `depositRateFor = annualCpiRate + SPREAD_BY_TERM` (%1,5/%2,5/%3,5) olarak **kilitlenir** (senaryo yayı + rejim eğimi bedavaya biner; 1973 us açılışı %10; residency yoksa saf prim), faiz **asla yazılmaz** (`accruedDepositInterest` türetmesi — UI "şu ana kadar" + netWorth aynı dikiş), vade `collectDueDeposits` faz 4c'te `collectDueSales`'ten hemen sonra, açlık çekirdek kontrolünden ÖNCE krediler (escrow kuralı: vadesi dolan mevduat o ayı kurtarır). Akış satırına koşullu `interest?` anahtarı (maaş deseni — öbür aylar bayt-özdeş). Bozma cezası tek kural: anapara döner, **faizin tamamı yanar** ("vade önemli" dersi). Muhafızlar: INVALID_TERM / TOO_SMALL (≥500$) / DEPOSIT_LIMIT (≤4 eşzamanlı) / INSUFFICIENT_CASH / DEPOSIT_NOT_FOUND. Worth-nötrlük: açılış anı netWorth değişmez (nakit→alacak) + hiçbir olay koşulu nakit okumaz → 120 ay rng ikizi birebir. Miras bayt-örnekli (varis vadesi doldurur). UI: Yatırım → Mevduat segmenti + `DepositSheet` (vade çipleri motor oranını gösterir, vade-sonu önizlemesi hipotetik-state), panelde iki-adımlı Boz, PortfolioCard "Vadeli mevduat", CashflowCard "Mevduat faizi" (yalnız vade ayında), Geçmiş'te `deposit_{opened,matured,broken}`. **Bilinçli golden hareketleri:** beş tam-durum golden yalnızca version 9 + `"deposits":[]` anahtarı (mekanik, nakit yolu birebir): v6 `e22685cd`→`1da84d4f` / `cd6e3fe4`→`d252d31a`, v7 `15e97c19`→`2e81a393`, v8 `45bafa91`→`f8deb445` / `a96a0027`→`fc78708d`; v2/v3/v5 beş golden pre-run `deposits=[]` ile **hareketsiz**; yeni v9 tam-durum golden `12305545` (çift vadeli yolu: 50k/12ay t0 + 20k/6ay t1, ikisi de t13'e kadar krediler).

---

## 1. Kilometre taşları

### M1 — Dağıtım: EAS APK + Web Export *(eski adı M7)*
**Amaç:** oyunu dev sunucusundan çıkarıp gerçek cihazda oynanabilir yapmak. Motor riski sıfır.

- `eas.json` profilleri (preview/production), `app.json` sürüm + ikon + splash
- EAS build → imzalı **APK** (Android) — Expo hesabı + ilk build ayarlanır
- **Statik web export** (`npx expo export --platform web`) — tek bağlantıyla tarayıcıda oynanabilir sürüm
- Cihazda smoke test: yeni oyun → 12 ay → kaydet/kapat/aç → devam
- Ops notları README'ye: port 8081'de yetim Metro süreci temizliği, HMR "unknown module" → sayfa yenile

**Kabul:** APK telefondan kurulup oynanıyor; web export statik hostta açılıyor; her iki yüzeyde kayıt kalıcılığı doğrulanmış.
**Efor:** 1 oturum (+ build kuyruk bekleme). **Golden etkisi:** yok.

### M2 — Kader Faz 2: içerik derinliği
**Amaç:** tekrar oynanabilirliği artırmak — kalıcı seam'lerin üstüne saf içerik.

- Oyun sonu **epilogları** + harcanmamış kader sonları (unspent-fate endings)
- **3–4 yeni kader** (MVP 5 → 8-9)
- Sayaç-kapılı **alternatif sonlar**
- Varis devri **CHOICE olayı** (RESOLVE_EVENT seam'i — yeni aksiyon türü yok)
- Dönen alamet (omen) satırları

**Kabul:** her yeni kader nötr yoldan erişilebilirlik testini geçer; epiloglar kader kartındaki seçimleri referans verir; yeni golden'lar poke edilmiş bilinçli olarak.
**Efor:** 1–2 oturum. **Golden etkisi:** v5 golden'ları büyük olasılıkla hareket eder (faz 2.5 vuruşları) — bilinçli bump + gerekçe.

### M3 — Yatırım Faz 2: Yuva & escrow (likidite + yaşam) — ✅ SEVK EDİLDİ 2026-10-15
**Amaç:** varlıkları yaşam simülasyonuna bağlamak; satışta ani-indirim cezasına gerçek alternatif.

Sevk edilen kapsam (şema v6, 206/206 vitest + tsc + lint + web export):

- `LIST_ASSET` / `CANCEL_LISTING` — **escrow** (`pendingSales[]` + `dueTick`, ESCROW_MONTHS=6, faz 4c tahsilatı defisit kontrolünden ÖNCE; bekleyen satış kira getirmez, merdiven escrow'u görmez)
- `SET_ROLE` + **homeRelief** (clamp SONRA relief, kader çarpanı en sona) + Yuva kartı (Aile sekmesi) + HomeRoleSheet ("Evine Taşın")
- Kader kancaları: `grantAsset`/`takeAsset` kelime dağarcığı, `gk_memleket_evi`, `ab_tarla_rehni`, `eve_cikma` beşibirliği (evlilik+6. ay)
- Konut kademesi **villa** (~400k, katalog sırası en sonda; `ACTIVATE_ASSET` opt-in ile eski kayıtlara çekiş enjeksiyonu YOK)
- "Zorunlu satış" bildirimi (yalnız L1/L3 varlık satışları, ≤1/tick; L2/ülkeler sessiz)
- UI: AssetTradeSheet'e 'İlanla' modu + bekleyen satış bölümü; AssetRow "İlanda"; PortfolioCard "Bekleyen satış"; CashflowCard "Yuva indirimi" (motor formülüyle paylaşılan `homeReliefFor`)

**Bilinçli golden hareketleri (2026-10-15):** v3 `991e4659`→`5e13babd`, v5 `e9dd173c`→`adb1362` / `1a34f2d8`→`449da977` / `7a40a255`→`9aefb4a` (villa piyasası yeni oyunda yaratılıştan aktif → faz 1b'de +12 çekiş/ay); yeni v6 tam-durum golden'ları `11921228` (kiracı yolu) + `a8dae17f` (düğün-altını yolu). **`1b9d3a91` (v2) hareket etmedi** — kader içeriği yalnız `requireAll`-kilitli kaderlere eklendi (RANDOM koşular nötr; fate.test'te çit testi).

**M3'ten M6'ya devredildi:** günlük araç modelleri (klasik olmayan) — kullanıcı kararı 2026-10-14.

**Kabul (sağlandı):** escrow süresi/net gelir motor testleri (yuva.test 34 test); Yuva indirimi gider paritesi mutabakat testi; yeni UI telefon genişliğinde (web export).

### M4 — Makro omurga: CPI + tahvil + β *(Yatırım Faz 3 ∪ Dünya Faz 2)*
**Amaç:** oyunun en büyük sistem eksiği — enflasyonun gerçek hissi ve tahvil sınıfı.

> **Not (2026-10-18):** M4'ün **deterministik yarısı v8'de sevk edildi** — CPI durumu + endeksli yaşam maliyeti + eriyen iflas eşiği artık `residency.ts`'te (kullanıcı kararıyla öne çekildi). M4'te kalan: stokastik taraf.

- **zWORLD/zCPI** faktörleri (faz 1a'da sabit slot, yalnız aktif katmanlarda — v2 kayıtlar dokunulmaz) — *CPI artık deterministik katalog/yay/yay eğimiyle işliyor; stokastik zCPI bileşeni burada*
- Ülke volünde **β bölmesi** (A 0,5 / B 0,6 / C 0,7; idiyosenkratik vol √(1−β²) — marjinal dağılım korunur)
- ~~**CPI durumu** + endeksli yaşam maliyeti + iflas eşiğinin CPI ile erimesi~~ — ✅ v8'de sevk (`residency.ts`, `livingClampFor`, `cpiMult`lenmiş eşik)
- **Tahvil** (kuponlu, κcpi endeksli) — yeni varlık sınıfı
- **Nominal/Gerçek** toggle (UI türetmesi) — *TÜFE endeksi state'te olduğundan ucuz*
- Kriz soak'u (zWORLD < −2 kuyruğunda altın medyanı > 0)
- Dünya Faz 2'den: **gündem rotasyonu** (aylık çekişsiz kayma) + yeni senaryolar (**1997 Asya**, **2020 COVID**) + ülke bazlı gündem

**Kabul:** soak 10k×720 — Sharpe bantları, NaN yok; nominal↔gerçek toggle tüm para yüzeylerinde tutarlı; CPI paritesi belgelenir (hangi golden'lar neden hareket etti).
**Efor:** 2–3 oturum (en ağır sistem işi). **Golden etkisi:** v5 setinin tamamı bilinçli hareket eder; v2/v3 dokunulmaz.

### M5 — Pazar yeri & yeni sınıflar *(Yatırım Faz 4)*
**Amaç:** uç oyun derinliği — teklif makinesi ve yeni ekonomik sınıflar.

- **Teklif makinesi** (yüksek kiralı daire avı: teklif kira alımında sabitlenir; teklifler faz 1b'de zaman-kapılı sabit slotta)
- **Dükkan, ~~mevduat~~, kripto, vakıf** sink'leri — *mevduat v9'da sevk edildi (2026-10-30, plan dışı öne çekme — bkz. §0 v9 notu)*
- Bölge dedikoduları (olay metniyle)

**Kabul:** teklif zaman-kapısı çekiş sözleşmesi testleri; her yeni sınıfın soak bandı.
**Efor:** 2–3 oturum. **Golden etkisi:** aktif katman golden'ları bilinçli.

### M6 — Kader Faz 3 + cila paketi
**Amaç:** his ve erişilebilirlik.

- **Kinks** (0–2 pasif minör özellik), hanedan seviyesinde kader modları (okunur UI), satın alınabilir kader yeniden atımı (log'lanmış aksiyon)
- **Günlük araç modelleri** (klasik olmayan; M3'ten devir — kullanıcı kararı 2026-10-14): hızlı amortisman + düzenli bakım gideri, escrow ile aynı tapu mekaniği
- Onboarding/ilk oyun rehberi, istatistik ekranı (hanedan geçmişi, nesil özetleri), başarımlar
- Kayıt yedekleme (JSON dışa/içe aktarma — bulut yokken tek güvence)
- Ses/haptik dokunuşlar, paylaşım kartı (sonuç özeti)

**Efor:** 1–2 oturum. **Golden etkisi:** çoğunlukla yok (UI katmanı).

### M7 — Ortak dünya *(Dünya Faz 3 + Kader Faz 4 — uzun vade)*
Sunucu yönlendirmeli ortak dünya: paket + senaryo oda kurulumunda donar (hash tohuma girer), gündem ortak akar; kader durumu oyuncu-blok'una taşınır. **Ayrı bir proje olarak değerlendirilir** — altyapı kararları (backend, hesap) gerektirir.

---

## 2. Sürekli bakım (backlog, sıra bağımsız)

- **Denge pass'leri:** her M sonrası soak + oynanış testi; tek satır ayarlar balance.ts'te
- **i18n parite:** locales.test dinamik kapsam testi her yeni anahtarla büyür
- **Playtest notları:** gerçek telefon kullanımından gelen UX borcu buraya düşer
- **Expo SDK güncellemeleri:** periyodik bakım (şu an ~57.0.27 → ~57.0.28 yayınlanmış, `npx expo install --check`)

## 3. Sıralama gerekçesi

1. **M1 önce** çünkü oyun şu an yalnızca dev sunucusunda yaşıyor; APK + web, her şeyden önce oynanabilirliği kalıcı kılar ve gerçek cihaz playtest'i M2+ önceliklerini besler.
2. **M2 (içerik) M3'ten önce** çünkü kalıcı seam'ler üstüne düşük riskli içerik, tekrar oynanabilirliği en ucuza büyütür.
3. **M4 (makro) M3'ten sonra** çünkü CPI yaşam maliyetine dokunır — escrow/Yuva (M3) oturmadan endeksleme eklemek iki değişkeni aynı anda oynatır.
4. **M5–M6** sistem olgunlaştıkça uç derinlik + cila; **M7** mimari sıçrama olduğu için en sona.
