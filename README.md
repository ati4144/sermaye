# Sermaye 🏛️

*(English note: Sermaye is a Turkish-language deterministic financial life-simulation game. The docs and the game itself are in Turkish.)*

Deterministik Türkçe finansal yaşam simülasyonu. Ailenin adını yaz, vatanını seç, kaderini mühürle — sonra 40 yıl boyunca maaşını, giderlerini, varlıklarını ve enflasyonu yönet. Aynı hamleler her zaman aynı sonucu verir: motor tamamen deterministik (sıfır rastgelelik), altın-hash'lerle sabitlenmiş.

## Oyna

- **Web**: [GitHub Pages](https://ati4144.github.io/sermaye/) *(yayınlandığında)*
- **Android APK**: EAS `preview` derlemesi *(ilk sürüm notlarında)*

> ⚠️ **Kayıtlar origin'e bağlıdır** (tarayıcıda `localStorage`, Android'de AsyncStorage). Web'de adres değişirse kayıtlar taşınmaz.

## Özellikler

- **v2–v7**: kader sistemi (mühürlü kader + anlık kader), yatırım kataloğu (altın, konut, tarla, döviz…), dünya katmanı (rejimler, senaryolar, gündem), gider kalemleri, maaş & işsizlik, nesil/takvim
- **v8 Vatan & Enflasyon**: oyun başında 10 ülkeden vatan seçimi → gösterim para birimi otomatik → o ülkenin TÜFE'si varlık fiyatlarını ve yaşam sepetini endeksler (Türkiye'de %40/yıl!), iflas eşiği enflasyonla erir
- Çoklu kayıt yuvası, nesil devralma (miras), Türkçe/İngilizce arayüz
- **Gizlilik**: oyun çalışırken tek bir ağ çağrısı yapmaz. Tüm veri cihazında kalır.

## Geliştirme

```bash
npm install
npx expo start        # Metro dev server (w: web, a: android)
npm test              # vitest — 262 test (altın-hash pariteleri dahil)
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint
```

- Bağımlılık eklerken daima `npx expo install <paket>` — SDK-uyumlu sürümü çözer.
- Motor sözleşmesi: `src/engine/` USD-bazlı ve cihazdan bağımsızdır; hiçbir UI ayarı motora sızamaz. Motor testlerindeki altın hash'ler bilinçli değişim olmadan kıpırdamaz.

### Web derleme & dağıtım

```bash
npm run export:web    # dist/ üretir (kök yollarla, yerel test için)
npm run serve:web     # dist/ statik sunucu — file:// ile açılmaz
npm run deploy:web    # /sermaye baseUrl ile export + gh-pages'e gönderir
```

`deploy:web`, `public/404.html` ile birlikte derin-link yenilemelerini app köküne geri yönlendirir (durum `localStorage`'da olduğu için koşu kurtulur).

### Android (EAS)

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview   # APK + kurulum sayfası/QR
```

`preview` profili APK üretir (yan yükleme için). `production` (AAB) profili gelecekteki Play listesi için hazır ama henüz derlenmez. **Keystore'u ilk derlemeden sonra `npx eas-cli@latest credentials -p android` ile indirip sakla** — kaybedilirse `com.sermaye.game` kimliği güncellenemez.

## Ops notları

- **8081'de yetim Metro**: portu tutan eski süreç `Get-NetTCPConnection -LocalPort 8081 | Select OwningProcess` → `Stop-Process -Id <pid>` ile temizlenir.
- **HMR "unknown module" hatası**: sayfayı yeniden yükle (Metro'yı değil). Bilinen, zararsız.
- Web derlemede `market.ts ↔ events/apply.ts` require-cycle uyarısı görünür — bilinen, zararsız, dağıtım kaynaklı değildir.

## Yol haritası

Detaylar [`docs/roadmap.md`](docs/roadmap.md) — M1 Dağıtım ✅, sıradaki: M2 Kader içerik → M4 stokastik makro (zCPI/β/tahvil) → M5 pazar yeri → M6 cila → M7 ortak dünya.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
