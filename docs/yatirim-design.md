# Varlık Kataloğu — Yatırım Sistemi v3 (Sermaye)

> 5 açılı tasarım paneli × 3 jüri elemesi sentezi, Ekim 2026. Durum: KİLİTLİ — §10 kararları 13 Ekim 2026'da kullanıcı tarafından onaylandı; kader-design.md düzeyinde referanstır.

## 1. Vizyon & kullanıcı isteği

İstek: *'Yatırım ile ilgili detaylar çok dar; ev, tarla, araba vb. tüm yatırım kaynaklarına ulaşılabilir olmalı; arayüzler bunları izlemek için uygun hale gelmeli.'*

Cevap: **birleşik fiyat motoru, ayrık pozisyon rafları**. 10 ülke endeksi mevcut kurallarıyla dokunulmaz kalır; yeni sınıflar (altın, daire, tarla, araç; sonra tahvil/mevduat/işletme/kripto/vakıf) aynı motor disiplininde yaşar: sınıf endeksi `CountryState` şekli, aynı `normal12` çekişi, aynı clamp. Kesirli sınıflar mevcut `holdings` haritasına, tapulu sınıflar yeni `properties` rafına oturur. **Erişim sınırsız** — her sınıf her ay alınıp satılır, pazar yeri/ilan kapısı yok (jüri dealbreaker'ı). Sınıf farkı getiride değil **sürtünmede**: komisyon merdiveni, ani-satış indirimi, bilet, kira/bakım akışı, olay kuyruğu.

Demir kurallar (jüri dealbreaker'ları — dokümanda ihlali yok):

1. **v2 replay paritesi kutsal**: `BUY.countryId`, `GameState.countries`, actionLog geçmişi asla yeniden adlandırılmaz/yazılmaz; yeni türler append-only. Eski kayıtlarda yeni çekiş yalnız `assets != null` kapısı ardında.
2. **Yeni rng streami yok, aksiyon-zamanı çekiş yok**: her yeni çekiş ana akımda sabit slotta (ülkelerden sonra, katalog sırası). Fiyat state'ten gelir; spread çekişi yok, alım önizlemesi kesindir.
3. **Dünya saflığı**: varlık endeksleri sahiplikten bağımsız her tick evrilir (faz 1–2 yalnız dünya durumu — paylaşılan dünya sunucusu ön koşulu); faz 2.5 sıfır-çekiş, kader dünyaya yazamaz.
4. **Koşullu çekiş yok**: satış süreleri deterministik geri sayım; alıcı-olasılık çekişi yok; amortisman drift'e gömülü; motorda sqrt/pow yok — katsayılar katalog sabiti.

## 2. Varlık sınıfları kataloğu

Ortak fiyat modeli: **birim fiyat = `startPrice` × `index/100`**; endeks `r = clamp(driftM + Σmods + volM×z, ±MAX_RETURN)` ile evrilir. Gelir faz 4'te `units × fiyat × yieldNetM` (negatif = gider).

| Sınıf (id) | Tür | Bilet | Fiyat modeli (yıllık) | Getiri | Akışkanlık | Komisyon | MVP? |
|---|---|---|---|---|---|---|---|
| Borsa — 10 ülke | kesirli | ~10$+ | mevcut A/B/C %5–12 / %14–34 (dokunulmaz) | fiyat | anlık | %0,5/1,0/1,75 | mevcut |
| Gram Altın (`gold`) | kesirli | ~10$ | %3,5 / %15; kriz olaylarında +şok (§4) | fiyat | anlık, indirimsiz | %0,75 | **EVET** |
| Daire (`house`) | tapu | 120.000$ | %3,5 / %7 | kira net %0,20/ay → ~%5,9/yıl | ani satış −%8 | %2 | **EVET** |
| Tarla (`farm`) | tapu | 25.000$/dönüm | %2,5 / %5 (en düşük) | hasat net %0,35/ay → ~%6,7/yıl | ani satış −%12 | %1,5 | **EVET** |
| Klasik Araç (`car`) | tapu | 40.000$ | %3 / %9 | bakım −%0,15/ay → ~%1,2/yıl | ani satış −%10 | %5 (mezat) | **EVET** |
| Devlet Tahvili (`bond`) | kesirli | 100$ | %0,5 / %6; κcpi −0,8 (faz 3) | kupon %4,2/yıl | anlık | %0,25 | Faz 3 |
| Vadeli Mevduat (`deposit`) | kilitli | 1.000$ | vol ~0; faiz 0,002+1,1×CPI₁₂ | ~%4,9/yıl | vadeye dek kilitli | %0 | ✅ v9'da sevk (CPI+spread dikişiyle) |
| İşletme (`business`) | tapu | 60–250k | %4 / %20 | kira %0,8/ay, olay zincirli | escrow 6 ay / ani −%20 | %3–5 | Faz 4 |
| Kripto (`crypto`) | kesirli | ~10$ | %8 / %70, crash-wired | — | anlık | %1 | Faz 4 |
| Vakıf (`foundation`) | saf sink | 500k+ | — | —; kader kaçışları + epilog | geri satılamaz | — | Faz 4 |

TR lezzeti i18n'de: 'Kuyumcudan gram altın', 'Şehirde 2+1 — kiraya ver', 'Toprak baba malı', '67 model — garajdaki tutku'. Yeni sınıf = katalog satırı + i18n anahtarı (kader-design §5 deseni). Bilet merdiveni 100.000$ başlangıca göre: tarla ilk hedef, araç yıllık birikim, daire 1–2 yıllık dönüm noktası, villa/vakıf geç oyun.

> **v9 notu (2026-10-30):** Vadeli mevduat sevk edildi — tablodaki parametre-katalogu yerine **deterministik dikiş**: oran açılışta `annualCpiRate + vade primi` (%1,5/%2,5/%3,5) olarak kilitlenir (senaryo yayı + rejim eğimi bedavaya biner), faiz asla state'e yazılmaz (`accruedDepositInterest` türetmesi), vade faz 4c'te açlık kontrolünden önce krediler (escrow kuralı), erken bozumda faizin tamamı yanar. Ayrıntılar: `src/engine/deposits.ts` + `deposits.test.ts`.

## 3. Motor tasarımı

### 3.1 GameState v3 (types.ts)

```ts
export interface AssetDef {            // src/engine/data/assets.ts — serileştirilmez
  id: string; kind: 'FRACTIONAL' | 'DEED'; category: 'METAL'|'REAL_ESTATE'|'LAND'|'VEHICLE'|...;
  grade: RiskGrade;                    // rozet/renk dili
  startPrice: number;                  // $/ünite @ tick 0
  baseDrift: number; baseVol: number;  // yıllık
  yieldNetM: number;                   // aylık net gelir (negatif = gider)
  fee: number; quickDiscount: number;  // çift yön / ani satış indirimi (kesirli: 0)
}
export interface AssetMarketState {    // CountryState şekli birebir
  id: string; index: number;           // 100 başlar; fiyat = startPrice × index/100
  mods: ActiveModifier[]; indexHistory: number[]; lastEventTick: Record<string, number>;
}
export interface AssetPosition {       // DEED sınıfı başına tek pozisyon (anahtar = classId, sayaç yok)
  classId: string; units: number;      // tam sayı
  avgCost: number;                     // round4, Holding kalıbı
  firstBuyTick: number; rentCollected: number;   // kümülatif kira (UI, roundCash)
}
// GameState v3 ekleri: assets: { activeIds: string[]; markets: Record<string, AssetMarketState> } | null;
//                      properties: Record<string, AssetPosition>;  (iterasyon daima sıralı-id)
```

- **Kesirli raf (altın)**: `holdings['gold'] = {units, avgCost}` — Holding tipi aynen; netWorth/likidasyon döngüleri `COUNTRY_IDS` + kesirli activeIds ile genişler (v2 kayıtta liste boş → bit-düzey v2).
- **`activeIds` state'te donuk** (INIT anında katalog snapshot'ı): faz 3'te tahvil eklemek eski v3 kayıtlarını bozmaz; eski kayıtlara `ACTIVATE_ASSET {assetId}` (sıfır çekiş, INIT kalıbı) ile açılır.
- ID uzayları ayrı: `ASSET_IDS ∩ COUNTRY_IDS = ∅` (lint). Altın asla ülke kataloğuna girmez — ülke olay döngüsü, grade makinesi, 'en iyi 3 ülke' özeti değişmez.

### 3.2 Çekiş sırası — determinizm sözleşmesi

sim.ts determinizm bloğuna eklenen madde:

> **Çekiş bütçesi (v3):** tick = 10×12 ülke çekişi **+ 12 × |s.assets?.activeIds ?? ∅| varlık çekişi (yalnız assets != null)** + faz-2 olay aday çekişleri (GLOBAL → ülke → **ASSET**; ASSET adayları yalnız assets != null) + yaşam çekişleri. Faz 2.5 ve **tüm aksiyon işleyicileri sıfır çekiştir**. MVP aktif kayıtta sabit 120 + 48 = 168 çekiş/tick (olay adayları hariç).

Faz sırası (sabit): **1** evolveMarkets (dokunulmaz) → **1b** evolveAssetMarkets (yalnız assets != null; activeIds katalog sırasıyla her varlık tam 12 çekiş, ülke formülü birebir; sahiplikten bağımsız dünya durumu) → **2** ülke olayları (dokunulmaz; GLOBAL olayların varlık efekt satırları mevcut çekişle ateşlenir, ek çekiş yok) → **2b** ASSET-scope olaylar (activeIds × katalog sırası, uygun aday başına tam 1 float, draw-then-decide, kota `MAX_ASSET_PER_TICK=1`; yalnız assets != null) → **2.5** kader (dokunulmaz) → **3** yaşam (dokunulmaz) → **4** nakit akışı → **5** değerleme.

**Faz 4 iç sırası:** (a) varlık geliri/gideri: kesirli activeIds + properties sıralı-id üzerinden `cash += roundCash(units × fiyat × (yieldNetM + Σ yieldMods))`; araç negatif (bakım); rentCollected güncellenir; sıfır çekiş. Kader livingCost çarpanı yalnız (b)'yi çarpar. (b) yaşam maliyeti — mevcut formül aynen. (c) escrow olgunlaşması (faz 2). (d) `cash < 0` → zorunlu likidasyon.

**Likidasyon merdiveni** (`liquidateToRaise` genişletmesi; v2 kayıtta 1. ve 3. adım boş → bit-düzey v2): (1) **kesirli varlıklar** (altın) pro-rata — nakde en yakın; (2) **ülkeler** pro-rata (mevcut kod); (3) **tapular: araç → tarla → konut** ('en son ev satılır'), her adımda açığı kapatan en az tam ünite, hasılat = `units×fiyat×(1−fee)×(1−quickDiscount−DISTRESS_PENALTY)`; aşım bilinçli, her satış Geçmiş'e **'zorunlu satış'** etiketiyle loglanır.

**Faz 5 — netWorth v3** = cash + Σ ülke + Σ kesirli (units×fiyat) + Σ tapu (units×fiyat, indirimsiz endeks fiyatı). peakNetWorth/iflas eşiği otomatik genişler: mülk iflastan korur ama nakit açığı fire-sale üretir — 'varlıklı ama nakitsiz' gerilimi bilinçli.

### 3.3 Aksiyon yüzeyi (append-only)

```ts
| { type: 'INIT_ASSETS' }                                 // null → katalogtan markets (index 100, history [100]); SIFIR çekiş (rng.s değişmez — testli); aktifken ASSETS_ACTIVE throw
| { type: 'BUY_ASSET'; assetId: string; amount: number }  // amount = ÜST LİMİT
| { type: 'SELL_ASSET'; assetId: string; units: number }  // DEED: tam sayı; ani satış indirimi uygulanır
```

- Mevcut `BUY`/`SELL` (`countryId` alan adıyla) **asla değişmez** — eski actionLog'un ve replay arşivinin ta kendisi.
- Kesirli BUY_ASSET: mevcut `buy()` birebir (`units = amount×(1−fee)/fiyat`, round4; INSUFFICIENT_CASH, INVALID_AMOUNT). Ayrık: `units = floor(amount×(1−fee)/fiyat)`; 0 → **TOO_SMALL** (durum değişmez); pozitifse yalnız gerçek maliyet `roundCash(units×fiyat/(1−fee)) <= amount` tahsil edilir, fark cebte kalır; avgCost ağırlıklı ortalama.
- Kesirli SELL_ASSET: mevcut `sell()` birebir. Ayrık: tam sayı doğrulaması (INVALID_UNITS), `proceeds = units×fiyat×(1−fee)×(1−quickDiscount)` — ani satış. Sabırlı satış (escrow) faz 2'de ayrı `LIST_ASSET`/`CANCEL_LISTING` türleriyle.
- `assetFeeFor(s, assetId) = def.fee × (s.fate?.mods.fee ?? 1)` — kader fee modu (diaspora ağı, kurnazlık) tapu/kuyumcu ücretlerine doğal yayar; tek formül.
- Yeni hata kodları: `ASSETS_INACTIVE`, `ASSETS_ACTIVE`, `TOO_SMALL`. **Hiçbir yeni aksiyon çekiş yapmaz**; UI ünite stepper'ı tutarı hesaplayıp yine BUY_ASSET {amount} gönderir.

### 3.4 v2 → v3 migrasyon (kayıpsız)

- `SCHEMA_VERSION = 3`; `migrateState`: `v < 3 → { ...st, schemaVersion: 3, assets: null, properties: {} }` — fate'in null-inert kalıbının tekrarı; gameStore persist version SCHEMA_VERSION'a bağlı, otomatik.
- v2 kayıtlar aynı stream'lerinde oynar: 1b/2b/4a assets null'da atlanır (aritmetik no-op) → `(v2 initial, actionLog)` çiftleri v3 altında **bit-bit aynı**; mevcut golden ailesi (`1b9d3a91`) **geçerli kalır, resetlenmez**.
- Eski kayıtta yeni ekonomi **asla otomatik başlamaz**; oyuncu Yatırım/Panel banner'ından **INIT_ASSETS** ile tek dokunuşta, sıfır çekişle açar. Yeni oyunlarda createNewGame katalogtan kurar (çekişsiz; initial state içinde).
- Aktive kaydın geleceği v2'den bilinçli sapar: parite sözleşmesi v3-kendi içinde — `(v3 initial, actionLog)` birebir; yeni golden fixture'lar eklenir. Sürüm notu: 'piyasa genişledi'.

### 3.5 Katalog, balance, lint

```ts
// balance.ts += 
ASSETS: { MAX_ASSET_PER_TICK: 1, DISTRESS_PENALTY: 0.05,
  GOLD:  { startPrice: 100,     drift: 0.035, vol: 0.15, fee: 0.0075, yieldNetM: 0,       quickDiscount: 0    },
  HOUSE: { startPrice: 120_000, drift: 0.035, vol: 0.07, fee: 0.02,   yieldNetM: 0.002,   quickDiscount: 0.08 },
  FARM:  { startPrice: 25_000,  drift: 0.025, vol: 0.05, fee: 0.015,  yieldNetM: 0.0035,  quickDiscount: 0.12 },
  CAR:   { startPrice: 40_000,  drift: 0.03,  vol: 0.09, fee: 0.05,   yieldNetM: -0.0015, quickDiscount: 0.10 } }
```

- `assets.ts`: ASSETS kataloğu + `ASSET_IDS` (katalog sırası = çekiş sırasının tek kaynağı) + `assetDef(id)` — countries.ts deseni.
- ESLint/test: (1) ASSET_IDS ∩ COUNTRY_IDS = ∅; (2) properties/markets'te Object.keys insertion-sırası iterasyonu yasak; (3) `BUY.countryId` alan adını donduran tip testi; (4) motor yasakları (sqrt/pow/random/Date) yeni dosyalarda da; (5) ASSET-scope olayların marketEvents() ülke döngüsüne sızmadığı testi.

## 4. Olay sistemi genişletmesi

- `EventScope += 'ASSET'` (appliesTo = assetId); `EventEffect.target` çözümlemesi applyEffects'te genişler: 'GLOBAL' | 'SELF' | ülkeId (önce countries) | assetId (sonra assets.markets).
- `ActiveModifier += yieldDelta?, liqDelta?` (varsayılan 0; eski kayıtlar etkilenmez): **yieldDelta** o ay kira/hasata eklenir (kuraklıkta hasat durur), **liqDelta** ani-satış indirimine puan puan eklenir (krizde konut 'donar', UI'da satış satırı kırmızıya döner).
- GLOBAL etkiler ülkelerde kalır; evrensel etki assetId'lerin tek tek listelenmesiyle (veri satırı, kod değil).

MVP olayları (sayılar katalog sabiti; hepsi non-choice, mevcut ACK akışı):

| id | hedef | p/tick | cd | etki |
|---|---|---|---|---|
| `kuraklik` | farm | 0,006 | 24 | şok ×0,92 + yieldDelta −0,0035 × 3 ay |
| `konut_baloni` | house | 0,004 | 60 | şok ×1,15 + driftDelta +0,008 × 6 ay |
| `konut_cokusu` | house (koşul: endeks > 150) | 0,010 | 60 | şok ×0,78 + liqDelta +0,03 × 3 ay (donma) |
| `mezat_yukselisi` | car | 0,004 | 48 | şok ×1,15 |

Mevcut küresel olaylara veri satırı (ek çekiş YOK — altının kriz karakteri MVP'den): `global_recession` += gold ×1,04 + drift +0,003 × 9; `rate_hike_cycle` += gold ×0,97; `oil_shock` += farm drift +0,002 × 6.

## 5. UI tasarımı

- **Yatırım sekmesi**: üstte 4-pill SegmentedControl — **Borsa · Değerli · Emlak · Araç** (her pill flex:1, tek satır; yatay sayfa scroll'u yok; seçim localStorage per-viewer kolaylık). **Borsa**: mevcut CountryRow + trade sheet birebir (altın ayrı uzayda → sıfır değişiklik). **Değerli**: AssetRow (CountryRow aynası: ad, gram fiyat, sparkline, pozisyon/K-Z) → mevcut tutar-girişli sheet BUY_ASSET'e map. **Emlak/Araç**: iki bölge — 'Piyasa': ListingRow (ad+açıklama, birim fiyat, sınıf endeksi sparkline'ı, rozetler: getiri 'Kira ≈ %0,20/ay', gider 'Bakım −%0,15/ay', likidite 'Ani satış −%8'); 'Sahip Oldukların': OwnedRow ('Daire ×2', MoneyText değer, K/Z renkli, 'Kira +240 $/ay', kümülatif 'Toplam kira: 9.360 $').
- **Alım sheet'i (ayrık)**: +/− ünite stepper, birim fiyat, 'toplam 121.000 $ (komisyon dahil)', min 1 ünite. **Satış sheet'i**: net önizleme açık — '−%8 indirim + %2 komisyon → eline geçen 108.240 $'; donma ayında satır kırmızı.
- **Varlık detay sheet'i (izlemenin kalbi)**: LineChart — sınıf endeksinin firstBuyTick dilimi **alış fiyatına ölçekli** ('senin evin' grafiği); Nakit Akışı kartı (kira +, bakım −, NET, kümülatif); 'Alış 120.000 → Şimdi 128.400'. Yatırım ekranında sayı serbest (kader ekranının sayı-yasağı buraya işlemez).
- **Legacy banner**: assets === null → Yatırım + Panel'de tek satır: 'Bu kayıt eski ekonomide başladı — ev, tarla, altın eklemek için güncelle' → INIT_ASSETS; sonrası kaybolur.
- **Panel**: net worth altında **AllocationBar** (Nakit · Borsa · Altın · Emlak · Araç; theme token assetColors) + legend (% + değer); 'Kira: +Z $/ay (net)' satırı. Piyasa Özeti aynen.
- **Geçmiş**: alım/satım (assets.log.*) + **'Zorunlu satış'** etiketi (fire-sale görünürlüğü). Aylık kira loglanmaz — yalnız kümülatif.
- **i18n** (tr önce, en eş ağaç): assets.<id>.{name,desc,unit}; assets.categories.*; ui.invest.segments.{stocks,precious,realty,auto}; ui.invest.{owned,market,monthlyCashflow,totalRent,quickSale,proceeds}; assets.log.{bought,sold,forcedSale}; ui.errors.{ASSETS_INACTIVE,ASSETS_ACTIVE,TOO_SMALL}. Motor yalnız id üretir.
- **Mobil**: tek sütun, sheet'ler mevcut bottom-sheet kalıbı; yeni bileşenler (SegmentedControl, ListingRow, OwnedRow, AllocationBar) mevcut dilin klonları; rozet ≤ 2/satır.

## 6. Yaşam & kader bağlantıları

**MVP (sıfır yeni mekanizma):** kader fee modu tüm varlık ücretlerine çarpar (gurbet_kusu 'diaspora ağı' tapu/kuyumcu masrafını da keser). **Miras**: tapular + altın varise aynen geçer; veraset vergisi genişletilmiş liquidateToRaise'den ödenir → 'vergi için tarla satmak' anlatısı kodsuz doğar. Kader koşul predikatları saf okuma (faz 3: ownsAsset('farm'), landShare > 0.4 — 'toprak kaderi'); kader dünyaya yazamaz, parasız hareket etmez.

**Faz 2 kancaları (mevcut RESOLVE/EventOption/condition seam'lerinden; faz 2.5'e ve kader rng'sine sıfır dokunuş):** `SET_ROLE` (home/rental) — oturulan ev Yatırım'da pozisyon değil Aile ekranında **'Yuva' kartı** (K/Z yok); homeRelief = min(evDeğeri×0.0022, worthBefore×0.003) yaşam maliyetinden düşer, kader livingCost çarpanı relief'ten SONRA (lanet ev alarak atlanamaz). `EventOption.grantAsset` — kader hediyesi daima maliyetli opsiyona bağlı (gk_memleket_evi %4 NW → gizli varyant; düğün altını). `ab_tarla_rehni` (mülkü ver / %10 NW öde / inat). `eve_cikma` LIFE olayı (evlilik+6 ay; marriedTick + lifeFlags, şema v3.1). 'Zorunlu satış' bildirimi ACK'lı olay olarak ≤ 1/tick (MVP'de yalnız Geçmiş etiketi).

## 7. Denge hedefleri (sayısal)

- **Getiri merdiveni** (beklenen yıllık): araç ~%1,2 < altın %3,5 < konut ~%5,9 < tarla ~%6,7 < hisse A %5–7 (vol %14–16) < B/C %6–12 (vol %18–34). Hisse dışı üstünlük sürtünmeyle fiyatlanır: konut round-trip %4 + ani satış −%8 + konsantrasyon; tarla −%12 + kuraklık kuyruğu; araç %5 mezat.
- **Sharpe guard (yayın kapısı)**: 10k tohum × 720 tick soak — all-property medyan 10 yıl CAGR'ı all-C hisse bandının **%90–110'unda**; taşarsa tek satır (HOUSE.drift 0.035→0.03 veya yieldNetM 0.002→0.0015).
- **Zorunlu satış**: etkin indirim = quickDiscount + 0,05 → araç %15, tarla %17, konut %13; soak'ta yıllık medyan ≤ 0,5; fire-sale sarmalı izlenir.
- **Altın**: MVP'de kriz korelasyonu yalnız olay satırlarıyla (recession'da +%4); sistematik β + enflasyon faz 3 — MVP kopyası mütevazı drift ile dürüst.
- **Nakit akışı**: 4 daire ≈ +960 $/ay net kira ('emekli maaşı'); LIVING değişmez; iflas eşiğini mülk aşar, nakit açığı merdiveni tetikler. **Enflasyon MVP'de yok** — reel/nominal ayrımı faz 3.

## 8. Faz planı & test stratejisi

**MVP (tek sürüm):** şema v3 + migrateState + INIT_ASSETS (yeni oyunlarda aktif); 4 sınıf + ASSET_IDS; faz 1b/2b/4a/4d/5; BUY_ASSET/SELL_ASSET (floor/TOO_SMALL/gerçek maliyet); likidasyon merdiveni + 'zorunlu satış' etiketi; assetFeeFor; 4 ASSET olay + 3 veri satırı; yieldDelta/liqDelta; UI (SegmentedControl, ListingRow, OwnedRow, stepper sheet'leri, detay sheet'i, AllocationBar, kira satırı, legacy banner, Geçmiş etiketleri); tr/en anahtarlar; test paketi + lint.

**Faz 2 — likidite + yaşam:** LIST_ASSET/CANCEL_LISTING escrow (pendingSales[] + dueTick; faz 4c'de tahsil; proceeds netWorth'a dahil; bekleyen satış kira getirmez); SET_ROLE + homeRelief + Yuva kartı; grantAsset/ab_tarla_rehni/eve_cikma; 'zorunlu satış' bildirimi; konut kademeleri (daire/villa 400k) + araç modelleri; nakit akışı defteri.

**Faz 3 — makro omurga:** zWORLD/zCPI faktörleri (faz 1a'da sabit slot, yalnız assets != null — v2 kayıtlar yine dokunulmaz); ülke volünde **β bölmesi** (β: A 0,5/B 0,6/C 0,7; volIdioFactor = √(1−β²) katalog literal'i; marjinal dağılım korunur, kriz eş-günlemesi bedelsiz); CPI durumu + endeksli yaşam maliyeti + THRESHOLD × cpi/100 eriyen iflas eşiği; tahvil (kupon, κcpi); Nominal/Gerçek toggle (UI türetmesi); kriz soak'u (zWORLD < −2 kuyruğunda altın medyanı > 0, ülke < 0). **Not (2026-10-18):** Faz 3'ün CPI yarısının **deterministik kısmı v8 Vatan katmanında sevk edildi** (`src/engine/residency.ts`: ülke CPI kataloğu + senaryo yay üstüne yazımları + rejim eğimi, `livingClampFor` endeksli sepet, eriyen eşik; stokastik zCPI/β/tahvil bu fazda kaldı — bkz. docs/roadmap.md v8 sevk notu).

**Faz 4 — pazar yeri + sınıflar:** teklif makinesi (kira alımda tekliften sabitlenir — 'yüksek kiralı daire avı'; teklifler faz 1b'de zaman-kapılı sabit slotta, aksiyon-zamanı çekiş asla yok); dükkan, mevduat, kripto, vakıf sink; bölge dedikoduları (olay metniyle). **Faz 5:** paylaşılan dünya ayrıştırma denetimi.

**NOT (kasıtlı yok):** mortgage/kredi; alıcı-olasılık çekişi; ülke drift'lerinin reel yazımı; pazar yerinin MVP'ye girmesi; per-ülke fee; bölgesel alt-piyasalar.

**Test stratejisi (sıra önemli):** (1) **v2 parite İLK GÜN** — mevcut golden'lar v3 kodunda aynı hash (golden bump'tan ÖNCE, ayrı PR); (2) INIT_ASSETS çizimsizliği (rng.s öncesi/sonrası eşit; ASSETS_ACTIVE throw); (3) çekiş sayacı (168 + adaylar; assets null = v2 bütçesi); (4) v3 golden — BUY/SELL_ASSET kesirli+ayrık karışık 600 tick (TOO_SMALL, kısıtlı nakit, tam sayı, kısmi likidasyon kenarları), replay bit-parite; (5) migrasyon — v2 fixture alanları bit-bit, inert replay aynı; (6) soak 10k×720 — NaN, Sharpe bandı, fire-sale sıklığı; (7) olay saflığı — ASSET'in ülke döngüsüne sızması, GLOBAL'in yalnız hedefli satırla assets'e dokunduğu; (8) i18n parite + ID çakışma + BUY.countryId dondurma; (9) make-golden tek komut script'i.

## 9. Riskler

| Risk | Önlem |
|---|---|
| Konut Sharpe üstünlüğü (~0,8 vs hisse A ~0,4) — 'ev faresi' metaı | Sürtünme (round-trip %4, −%8, konsantrasyon) + §7 soak bandı yayın kapısı; tek satır ayar |
| Ayrık yuvarlama kenarları (floor komisyonu, avgCost, TOO_SMALL) | Birim test paket 4; her nakit akışı roundCash, avgCost round4 |
| Zorunlu satış sarmalı (kriz donması + miras vergisi aynı varyşta) | Merdiven (en son ev) + 'zorunlu satış' etiketi; soak sıklık sayacı; gerekirse faz 2 vergi taksidi |
| Migration UX: banner görülmezse 'kayıtımda ev yok' | Yatırım + Panel'de iki yerde; release note 'piyasa genişledi' |
| BUY.countryId rename'i tüm arşivi kırar | Tip dondurma testi + lint; yeni türler append-only |
| Golden kırılganlığı (balance ince ayarı) | v2 golden'a dokunulmaz; v3 fixture'lar make-golden'dan |
| Olay yoğunluğu (ayda 3 piyasa olayı) | MAX_ASSET_PER_TICK=1 + cooldown; FAST_FORWARD pendingEvents'te durur; akış hissi soak'ta |
| UI kalabalığı (10 ülke + 4 sınıf + tapular) | 4-segment IA; rozet ≤ 2/satır; ilk kullanılabilirlik testi telefon genişliğinde |
| Dünya saflığı: ASSET GLOBAL şokunun ülkeye sızması | marketEvents filtre testi + lint (paket 7) |

**Kaynak tasarımlardan çöpe atılanlar:** sim'in countries→assets rename'ı + actionLog'da countryId→assetId çevirisi (replay arşivini yok eder); ux'in altını COUNTRY_IDS'e 'au' olarak eklemesi (ülke olay havuzu + GLOBAL şokları altına eşit işler) ve BUY_ASSET spread çekişi (aksiyon-zamanı rng — yasak); balance'in 6 ay/4 teklif pazar yeri MVP'si (erişimi daraltır — isteğin tersi) ve altınsız MVP; life'ın kader kancaları + SET_ROLE + grantAsset MVP sıkıştırması (faz 2'ye taşındı); escrow + pazar yeri + makro faktörün aynı sürümde birleşmesi (her biri ayrı faz); otomatik sessiz aktivasyon ve 'eski kayıtlar asla alamaz' uçları (INIT_ASSETS seçildi); alıcı-olasılık çekişli satış (deterministik indirim/geri sayım seçildi).

## 10. Kilitli kararlar (13 Ekim 2026 — kullanıcı onayı)

1. **Eski kayıt açılışı: Banner + oyuncu onaylı INIT_ASSETS** — v2 replay birebir korunur, mevcut golden hash geçerli kalır.
2. **Araç sınıfı: yalnız klasik/koleksiyon** — günlük araç faz 2'de yaşam varlığı olarak gelir.
3. **Bilet ölçeği: ONAY** — tarla 25.000$ / araç 40.000$ / daire 120.000$.
4. **Faz 3 makro katmanı: EVET** — zWORLD β bölmesi + CPI, faz 3'te.

Panelin baştan kilitledikleri: kira otomatik nakde akar; ayrık alım BUY_ASSET {amount} + motor floor (BUY_UNITS türü yok); MVP likidite = ani-satış indirimi, escrow faz 2; altın holdings kalıbıyla kesirli; v2 golden koruması ilk gün testi; kader/yaşam kancaları faz 2'de mevcut seam'lerden; sayı gösterme kuralı (kader ekranında yasak, yatırım ekranında serbest).