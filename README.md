# Crypto SMC FUTURES Scanner → Telegram (24/7)

Scanner otomatis untuk **Binance USDT-M Perpetual**, jalan di **GitHub Actions**, cari **ChoCh + BoS READY dua arah (LONG + SHORT)**, dan kirim **notifikasi Telegram** cuma buat setup **baru** (anti-spam). Tiap sinyal bawa **rekomendasi leverage aman** (identik dengan sizing calculator).

- Data: `fapi.binance.com` (USDT-M Futures).
- Setup dinotif: **ChoCh/BoS READY, M15**, min volume 24h **3 juta USDT**, adaptive floor gain **10→7%**, R:R ≥ 1, fresh ≤ 5 bar.
- **TANPA filter halal** — futures sengaja di luar filter (sesuai keputusan). Terpisah total dari sistem spot.
- v1 = **sinyal-only** (track record menyusul).

> Ini alat verifikasi, BUKAN sinyal buy/sell. Selalu konfirmasi di chart (LuxAlgo swing=50, internal=5) sebelum entry. Leverage yang ditampilkan = plafon aman terhadap SL, bukan anjuran pakai penuh. Sizing tetap dari risk-per-trade. NFA · DYOR.

---

## Kenapa dipisah dari bot spot

Repo, channel Telegram, dan state INI HARUS TERPISAH dari scanner spot. Alasannya:
- Bot spot = long-only, filter halal, modal gaji (bersih).
- Bot futures = dua arah, pakai leverage, di luar filter halal.
Jangan campur secret/channel/state keduanya.

---

## Langkah setup (sekali, ~15–30 menit)

### 1) Bikin bot + channel Telegram BARU (khusus futures)
1. Chat **@BotFather** → `/newbot` → dapet **TOKEN** (boleh bot baru, atau pakai bot yang sudah ada).
2. Bikin **channel/grup Telegram baru** khusus futures (biar notif futures nggak campur spot). Tambahkan bot sebagai admin (kalau channel).
3. Ambil **CHAT ID**:
   - Channel: forward satu pesan channel ke **@userinfobot**, atau buka `https://api.telegram.org/bot<TOKEN>/getUpdates` → cari `"chat":{"id":-100...}` (channel id diawali `-100`).
   - Chat pribadi: chat **@userinfobot** → dia balas `Id: 123456789`.

### 2) Bikin repo GitHub BARU (terpisah dari spot)
1. Buat repo baru, saran nama **`taz-screening-futures`**, set **Public** (Actions gratis unlimited).
2. Upload isi folder ini ke **root repo**:
   ```
   scan.js
   state.json
   .github/workflows/scan.yml
   ```
   > File workflow harus di path `.github/workflows/scan.yml`.

### 3) Masukin secret (JANGAN taruh di kode)
Repo → **Settings → Secrets and variables → Actions → New repository secret**:
- `TELEGRAM_TOKEN` = token BotFather
- `TELEGRAM_CHAT_ID` = chat/channel id futures

### 4) Nyalain & tes
1. Tab **Actions** → enable kalau diminta.
2. Pilih **crypto-scan-futures** → **Run workflow** → tunggu ~1–2 menit.
3. Cek log: jumlah perp discan + (kalau ada READY baru) notif masuk Telegram.

### 5) Cron tiap ~15 menit (cron-job.org)
Sama seperti bot spot: bikin job di cron-job.org yang nge-`POST` ke
`https://api.github.com/repos/<user>/taz-screening-futures/actions/workflows/scan.yml/dispatches`
dengan header `Authorization: Bearer <GitHub PAT>` dan body `{"ref":"main"}`, interval 15 menit.
(GitHub PAT butuh scope `actions:write` / `workflow`.)

---

## Isi notifikasi

Tiap sinyal:
```
SYMBOL · ▲ LONG / ▼ SHORT · ChoCh/BoS
• Entry : ...
• TP +x.x% · OB/EQ : ...
• SL −x.x% · inval ... : ...
• R:R : ...
• Lev aman : Nx  (liq −xx% · Nx di belakang SL)
• Buka chart
```
`Lev aman` = `min(25, floor(1/(SL_frac × 2 + 0.5%)))` — MMR-aware, likuidasi ≥ 2× lebih jauh dari SL. Backstop 25× (bukan plafon ketat) → leverage ngalir ngikut SL untuk SL normal, cuma kepentok pas SL <1%. Ubah `LEV_CEILING` / `LIQ_BUFFER` / `MMR` di KONFIG `scan.js` kalau mau.

## Catatan jujur
- **Cron GitHub sering telat.** Target 15m, realita bisa mundur. Kalau butuh presisi, lapis dengan auto-scan di HTML screener.
- **Geo-block (HTTP 451).** Kalau runner IP-nya keblok Binance Futures, pindah ke VPS region SG/EU. Kode sama, tinggal `node scan.js` + cron.
- **Anti-spam.** `state.json` nyimpen READY terakhir (kunci `SYM::DIR::setup`); tiap run cuma kirim yang baru, lalu di-commit balik.
- **Leverage = plafon aman, bukan ukuran posisi.** Sizing beneran dihitung di sizing calculator / journal futures dari risk-per-trade × SL.

## Tes lokal (Node 18+)
```
node test_scan.js
```
Nguji logika dua arah (tanpa jaringan). Harusnya `PASS` semua.

## Ubah setting
Semua di atas `scan.js` (KONFIG): `MIN_VOL`, `MAX_BARS`, `MIN_TP`, `MIN_TP_FLOOR`, `MIN_RR`, `MAX_FRESH`, `LEV_CEILING`, `LIQ_BUFFER`, `MMR`.
