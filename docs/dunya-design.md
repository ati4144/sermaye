# Dünya Paketi — Dinamik Ekonomi v4 (Sermaye)

> 4 kilitli tasarım kararı (13 Ekim 2026, kullanıcı onayı): **Kalibrasyon + senaryo modu** · **Build-time paket** · **Gündem ağırlıkları** · **Analist paneli + motor**. Durum: KİLİTLİ. Kader/Yatırım dokümanları düzeyinde referanstır.

## 1. Vizyon & kullanıcı isteği

İstek: *'Mimari ölçeklenebilir olmalı, özellikle ekonomi tarafı. Geçmiş için gerçek verilerin olduğu veri setleri olmalı ve akışlar buna göre ilerlemeli. Gelecek için güncel veriler ışığında bir forecast yapmalı; güncel haberlere göre değişebilir, dinamik olmalı — sabit bir akış olmamalı.'*

Cevap: **sürümlü Dünya Paketi (WorldPack) + rejim motoru + gündem katmanı + senaryo zaman çizelgesi + saf-oku forecast**. Motorun determinizm sözleşmesi (aynı tohum → birebir aynı dünya; replay; ileride ortak oda) BOZULMAZ: gerçek veri ve "gündem" motora yalnızca **statik, sürümlenmiş veri** olarak girer. Paket uygulama ile birlikte dağıtılır (build-time derleme); hiçbir zaman oyun anında internet okuması yoktur. Dinamizm **durum-bağımlı olasılıklardan** doğar: aynı olay kataloğu, rejim ve gündeme göre farklı sıklıkta ateşlenir; aynı ülke, rejimine göre farklı drift/volatiliteyle evrilir.

**Ölçeklenebilirlik sözü**: yeni ülke/veri seti/senaryo = pakete veri satırı. Motor kodu değişmez; `tools/build-worldpack.mjs` ham veri setlerini (`tools/data/raw/*.json`, gerçek kaynaklı) derleyip `src/engine/data/worldpack.ts`'yi üretir.

## 2. Mimari — Dünya Paketi katmanı

```
tools/data/raw/*.json          gerçek veri setleri (yıllık getiriler, altın, kriz zaman çizelgeleri, boğa/ayı istatistikleri) + kaynak URL'leri
        │  npm run build:worldpack   (Node; Math.pow serbest — motorun dışında)
        ▼
src/engine/data/worldpack.ts   derlenmiş, tipli, salt-okunur paket (motor sabiti; balance.ts ile aynı sözleşme)
        │
src/engine/world.ts            faz 0.9 rejim evrimi + faz 0.95 senaryo vuruşları + rejim/gündem erişimcileri
src/engine/forecast.ts         saf-oku MC konileri (state'e YAZMAZ, ana rng'ye DOKUNMAZ)
```

Paket içeriği (WorldPack):

```ts
interface WorldPack {
  id: string; version: number; generatedLabel: string;   // 'default@1', '2026-10'
  regimes: Record<RegimeId, RegimeDef>;                  // 5 rejim tanımı (aşağıda)
  countries: Record<string, CountryPackEntry>;           // 10 ülke: geçiş matrisi + rejim paramları
  assets: Record<string, AssetPackEntry>;                // altın/konut/tarla/araç: rejim paramları
  worldMatrix: number[][]; worldExitP: number[];         // küresel rejim makinesi
  agenda: { topics: Record<string, number>;              // güncel gündem anlık görüntüsü (0..1)
            eventWeights: Record<string, Record<string, number>>;  // konu → eventId → çarpan
            driftTilts: Record<string, Record<string, number>>;    // konu → marketId → aylık drift eki
            regimeShifts: Record<string, Partial<Record<RegimeId, number>>> }; // konu → rejim → ağırlık kayması (kriz tetikler)
  scenarios: ScenarioDef[];                              // gerçek tarihsel senaryolar (aşağıda)
}
```

Paket sürümü `GameState.world.packId`'de taşınır (yalnızca provenance). Paket sayıları `balance.ts` gibi **motor sabitidir**: bilinçli bir paket güncellemesi devam eden v4 kayıtlarının geleceğini kaydırır (bugün balance düzeltmesinin yaptığı şey); replay paritesi uygulama-içi, sürüm-içindedir.

## 3. Rejim motoru (durum-bağımlı dinamik)

5 rejim (id sabit, sayılar paketten):

| id | ad | drift çarpanı | vol çarpanı | tipik süre |
|---|---|---|---|---|
| `boom` | Patlama | ×1.6 | ×1.25 | ~2 yıl |
| `growth` | Büyüme | ×1.0 | ×1.0 | ~4 yıl (nötr — mevcut davranış) |
| `slowdown` | Yavaşlama | ×0.5 | ×0.9 | ~2 yıl |
| `stagnation` | Durgunluk | ×0.0 | ×1.15 | ~3 yıl |
| `crisis` | Kriz | ×−1.0 (negatif ek) | ×1.6 | ~1.5 yıl |

`growth` **kimlik rejimidir** (×1.0/×1.0, sıfır ek) — rejimsiz motor davranışıyla örtüşür.

- **Faz 0.9** (yalnız `s.world !== null`): önce küresel rejim, sonra `COUNTRY_IDS` sırasıyla her ülke — her makine **tam 2 çekiş**: 1 float (çıkış olasılığı) + 1 weightedIndex (hedef satır). Draw-then-decide: geçiş olmasa bile hedef çekilir. Küresel + 10 ülke = **+22 çekiş/tick** (dünya katmanı açıkken).
- **Faz 1 etki**: `driftEff = baseDrift/12 × mult + driftAddM`, `volEff = baseVol/√12 × volMult` (ülkeler küresel rejim `driftAddM` ekini de alır). Varlık piyasaları (altın/konut/tarla/araç) kendi rejim paramlarıyla evrilir: krizde altın ×2, konut ×0.3 gibi (gerçek veriden kalibre).
- **Olay olasılıkları nefes alır**: `pEff = clamp(def.p × rejimÇarpanı × gündemÇarpanı, 0, 0.95)`. GLOBAL/ASSET kapsamı küresel rejimden, COUNTRY kapsamı o ülkenin rejiminden çarpan alır. Çekiş SAYISI değişmez — yalnız eşit eşiği dinamiktir (world:null → tüm çarpanlar 1 → bit-parite).
- Rejim değişimi `eventLog`'a **`regime_change`** olarak yazılır (countryId + LogEntry.regimeId; ACK yok, kuyruğa girmez — Geçmiş'te manşet görünümü).

## 4. Gündem katmanı (güncel haber → deterministik etki)

Paket, derleme anındaki **gündem anlık görüntüsünü** taşır: konu ağırlıkları (ör. Ekim 2026: `enflasyon: 0.8, jeopolitik: 0.6, yapay_zeka: 0.7, faiz_indirimi: 0.5`). Oyun anında internet yok; "güncellik" uygulama güncellemesiyle gelen yeni paket anlık görüntüsüdür (OTA dahil).

Etki mekanizmaları (hepsi salt veri):
1. **Olay çarpanları**: `agenda.eventWeights[topic][eventId] × topicWeight` — sıcak konu, ilgili olayları sıklaştırır.
2. **Drift eğimleri**: `agenda.driftTilts[topic][marketId]` — enflasyon sıcakken altın drift'i +0.002/ay gibi.
3. **Rejim kaydırmaları** (formül, çekişsiz): konu ağırlıkları, ülke geçiş matrisi satırlarını kaydırır — jeopolitik 0.6 iken crisis kolonu genişler. Dinamik akışın çekilişsiz omurgası.
4. Senaryo vuruşları gündemi yeniden yazabilir (`setAgenda`).

Gündem kartı Panel'de konu çipleri olarak görünür; manşet üretimi yok (metin i18n'de, konu id'lerinden).

## 5. Senaryo modu (gerçek tarih oynanır)

```ts
interface ScenarioDef {
  id: string; startYear: number;               // 'gfc_2008', 2008 — gösterim + çapa
  initialRegimes: { world: RegimeId; countries: Record<string, RegimeId> };
  initialAgenda: Record<string, number>;
  timeline: ScenarioBeat[];                    // ay ofsetiyle sıralı
}
interface ScenarioBeat {
  atTick: number;                              // oyun başından ay
  setRegime?: { world?: RegimeId; countries?: Record<string, RegimeId> };
  setAgenda?: Record<string, number>;
  fireEvents?: { eventId: string; countryId?: string }[];  // katalog olayı, olasılıksız, deterministik
  newsId?: string;                             // i18n scenarios.<id>.news.<n> manşeti
}
```

- **Faz 0.95** (yalnız `s.world` + senaryolu koşu; sıfır çekiş): `tick === timeline[cursor].atTick` → vuruş uygula, `scenarioCursor++`. `fireEvents` mevcut `fireMarketEvent`'ten geçer (şok/kuyruk semanticsi aynen).
- Yeni oyun: `createNewGame({ scenarioId })` — paketten başlangıç rejimleri/gündemi kurar (çekişsiz initial state). Replay güvenli: senaryo kimliği + imleç `WorldState`'te.
- MVP senaryoları (gerçek veri setlerinden derlenir): **1970'ler stagflasyon** (73/79 petrol şokları, altın $35→$850), **2008 Küresel Finansal Krizi** (Lehman ayı, küresel crisis, 2009 toparlanma vuruşu), **1990 Japonya** (balon patlaması, kayıp onyıl — jp uzun stagnation). Normal oyun = güncel çağ paketi (senaryosuz).

## 6. Forecast — Analist katmanı

`forecast.ts`: `forecastCone(s, marketId, horizon=12, paths=96)` → ay ay `{p10, p50, p90}` endeks konileri.

- **Saf okuma**: `s`'ye yazmaz; ana `s.rng`'ye DOKUNMAZ. Konz çizgisi taze bir mulberry32'den üretilir, tohum = `(seed, tick, marketId)` karışımı (imul-tabanli hash) → aynı durum = aynı koni, her çağrıda.
- **Model**: Monte Carlo — yol başına mevcut endeks/mod'larla başla, her ay rejim zincirini paket matrisiyle örnekle (scratch rng), drift/vol = rejim paramları + aktif mod'lar (kalan ay söner), z = normal12. Yüzdelikler sıralamayla (sayı sort — deterministik).
- **Analist dürüstlüğü**: koni, ana akımdan BAĞIMSIZ bir akılla üretilir → gerçek gelecek koninin içinde/ dışında olabilir. Bilgi ≠ kesinlik; UI açıkça 'tahmindir' der. Motorun geleceği zaten aynı rejim matrisinden akar — panel ile gerçeklik aynı model ailesini paylaşır, aynı yazıyı okumaz.

## 7. Şema v4 & parite sözleşmesi

- `SCHEMA_VERSION = 4`; `GameState` **sonuna** `world: WorldState | null` (JSON anahtar sırası migrate spread ile korunur).
- `WorldState { packId, scenarioId|null, regime, countryRegimes, agenda, scenarioCursor }` — tam serileştirilebilir.
- `migrateState`: `v < 4 → { ...st, world: null }` — fate ve assets kalıbının tekrarı. **world:null = tamamen inert**: 0 çekiş, 0 davranış değişimi → v1/v2/v3 kayıtları bit-parite.
- Eski kayıtta yeni katman asla kendiliğinden başlamaz: Yatırım/Panel banner'ı → **`INIT_WORLD`** (sıfır çekiş; WORLD_ACTIVE throw; 'world_init' log). Sonrası bilinçli sapma (INIT_ASSETS kalıbı).
- **Golden stratejisi**: legacy `1b9d3a91` testin normalizasyonu `{assets:null, properties:{}, world:null, schemaVersion→2}`'ye genişler (mekanik, sözleşme maddesi güncellenir); v3 `991e4659` koşusu world:null ile yeniden üretilir (aynı hash KALMALI — dünyasız akışın ta kendisi); **v4 golden ailesi yeni eklenir** (world açık, senaryosuz + senaryolu iki fixture).
- Yeni oyunlar world açılır → aynı tohum v3'ten ayrılır (bilinçli; v2→v3'le aynı karara).

## 8. Olay sistemi & yaşam bağlantıları

- Katalog (id'ler, cooldown'lar, etkiler) DOKUNULMAZ; dinamizm eşit eşiğindedir (§3). `balance.WORLD.P_CLAMP = 0.95`.
- `LogEntry` append-only alanlar: `regimeId?`, `newsId?` (asset alanları kalıbı). Geçmiş ekranı `regime_change`/`world_news`/`assets_init` dallarıyla yakalar — `eventDef()` asla bilinmeyen id'ye çağrılmaz (ASSET_LOG_EVENTS dersi).
- Yaşam/kader sıfır değişiklik: faz 2.5/3 dokunulmaz. Miras `world`'ü aynen devralır (dünya durumu hanedanın malıdır).

## 9. UI tasarımı

- **Yeni oyun**: senaryo seçici — 'Güncel Çağ (2026)' + 3 senaryo kartı (ad, yıl, tek cümle, başlangıç rejim rozetleri). Normal seçim default.
- **Yatırım (her segment)**: satır/sheet başında **rejim rozeti** (renkli nokta + ad, `world.regimes.<id>`); sheet içinde **Analist bloğu**: 6/12 ay p10–p50–p90 endeks aralığı + 'tahmindir' dipnotu. Ülke + varlık satırlarında.
- **Panel**: net worth altında **Dünya kartı** — küresel rejim adı + süresi ('Kriz, 8. ay'), gündem konu çipleri (ağırlık çubuğu), senaryo adı (varsa). Legacy kayıtta **'Dünya ekonomisi güncellendi'** banner'ı → INIT_WORLD.
- **Geçmiş**: rejim değişimleri ve senaryo manşetleri kart görünümü (events.regime_change.*, scenarios.<id>.news.<n>).
- **i18n** (tr önce, en eş ağaç): `world.regimes.*`, `world.agenda.*`, `ui.analyst.*`, `ui.world.*`, `ui.newGame.scenario*`, `scenarios.<id>.{name,desc,news.*}`, `ui.errors.WORLD_ACTIVE`.

## 10. Veri hattı (build-time, ölçeklenebilirlik)

1. **Ham veri setleri** `tools/data/raw/*.json` — gerçek yıllık nominal getiriler (10 ülke, var olan aralık), altın yıllık fiyatları, kriz zaman çizelgeleri (tarih/derinlik/süre), boğa-ayı istatistikleri; her satırda `sources[]`. Araştırma ajanları web kaynaklı toplar (FRED/Dünya Bankası/borsa endeks geçmişi); yaklaşımlar `approx: true` ile işaretlenir, gizli taşınmaz.
2. **Derleyici** `tools/build-worldpack.mjs` (`npm run build:worldpack`) — getiri serilerinden yıl sınıflaması (kriz/durgun/yavaş/büyüme/patlama eşikleri) → ülke başına rejim drift/vol çarpanları + 5×5 geçiş matrisi; altın serisinden varlık rejim paramları; kriz çizelgesinden senaryo timeline'ları; gündem anlık görüntüsü elle kürasyon (config). Çıktı: `src/engine/data/worldpack.ts` (tipli literal; motor JSON import etmez).
3. Motor yalnız derlenmiş paketi okur; ham veri koda girmez. Yeni veri = dosya + yeniden derleme.

## 11. Test stratejisi

1. **Parite İLK GÜN**: world:null koşusu v3 koduyla aynı hash (legacy + v3 golden'ları, normalizasyon genişletilmiş) — v4 golden eklemeden ÖNCE.
2. **Çekiş bütçesi**: world açık = v3 bütçe + 22/tick; world null = v3 bütçesi (sayaç testi).
3. **INIT_WORLD çizimsizliği** (rng.s öncesi/sonrası; WORLD_ACTIVE throw; log kaydı).
4. **Rejim evrimi determinizmi**: aynı tohum → birebir JSON; p=1'e çakılmış pakette N ay içinde geçiş kesin; growth-kimlik paketi = dünyasız akışla aynı endeks (çekiş kayması hariç — ayrı test: kimlik paramları + sabit rejim → aylık getiriler aynı formül).
5. **Olay eşiği dinamiği**: kriz rejiminde crisis_c tetik sıklığı > growth (1000-tick frekans testi); çarpan clamp'i.
6. **Senaryo**: başlangıç rejimleri kurulur; vuruş tam atTick'te bir kez uygulanır (imleç ilerler); fireEvents pendingEvents'e girer; replay bit-parite; senaryolu golden.
7. **Forecast**: aynı durum iki çağrı aynı koni; p10≤p50≤p90; çağrı sonrası state JSON'u (rng dahil) birebir; horizon sınırları.
8. **Serileştirme/migrasyon**: v3 fixture → world:null inert replay; JSON round-trip; bozuk world şekline karşı ?? guard'ları.
9. **Soak**: 10k tohum × 720 tick — NaN yok; rejim konak süreleri makul bantta (kriz medyan ≤ 30 ay); endeks dağılımı dünyasız soaktan ölçüleceği gibi sapar ama patlamaz.

## 12. Fazlar

- **MVP (bu sürüm, v4)**: şema + migrate + INIT_WORLD; paket v1 (araştırma verisinden elle derlenmiş sayılar + derleyici iskeleti); rejim motoru (0.9) + senaryo vuruşları (0.95); gündem (çarpan/eğim/kaydırma); forecast + analist UI; 3 senaryo + seçici; Panel Dünya kartı + banner; Geçmiş manşetleri; tr/en; test paketi; lint.
- **Faz 2**: gündem rotasyonu (aylık çekişsiz kayma + paket güncellemeleri), tahvil/CPI (yatırım-design Faz 3 omurgasıyla birleşir), senaryo genişletme (1997 Asya, 2020 COVID), ülke bazlı gündem.
- **Faz 3**: ortak oda — paket + senaryo oda kurulumunda donar (hash tohuma girer), gündem ortak akar; canlı paket yenileme (internetli mod, snapshot hash).

## 13. Kilitli kararlar (13 Ekim 2026 — kullanıcı onayı)

1. **Geçmiş verinin rolü: Kalibrasyon + senaryo modu** — gerçek seriler parametreleri kalibre eder; seçilebilir tarihsel senaryolar gerçek olay çizelgesini oynatır; normal oyun güncel çağ paketiyle akar.
2. **Veri kaynağı: Build-time paket** — sürümlü JSON uygulamaya gömülür; internetsiz deterministik; güncelleme uygulama güncellemesiyle.
3. **Haber mekanizması: Gündem ağırlıkları** — sürümlü konu ağırlıkları olay olasılıklarını, drift'i ve rejim geçişlerini deterministik kaydırır; gerçek başlık parse'ı yok.
4. **Forecast: Analist paneli + motor** — p10/p50/p90 konileri UI'da 'Analist Görünümü' olarak görünür (yanılabilir) ve aynı rejim katmanı gerçek dinamikleri belirler.

Panelin baştan kilitledikleri: world null-inert (INIT_WORLD ile oyuncu onaylı açılış); growth kimlik rejimi; +22 çekiş yalnız world açıkken; forecast scratch-rng (ana akıma sıfır dokunuş); golden'lar normalizasyon genişletmesiyle korunur, v4 ailesi yeni; olay kataloğu ve yaşam/kader kodu dokunulmaz; ham veri asla motora girmez.
