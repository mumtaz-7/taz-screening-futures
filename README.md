# Crypto SMC FUTURES Scanner → Telegram (24/7)

Scanner otomatis untuk **Bybit USDT Perpetual (linear)**, jalan di **GitHub Actions**, cari **ChoCh + BoS READY dua arah (LONG + SHORT)**, dan kirim **notifikasi Telegram** cuma buat setup **baru** (anti-spam). Tiap sinyal bawa **rekomendasi leverage aman** (identik dengan sizing calculator).

- Data: `api.bybit.com` v5 (`category=linear`).
- Setup dinotif: **ChoCh/BoS READY, M15**, min volume 24h **3 juta USDT** (turnover24h), adaptive floor gain **10→7%**, R:R ≥ 1, fresh ≤ 5 bar.
- **TANPA filter halal** — futures sengaja di luar filter (sesuai keputusan). Terpisah total dari sistem spot.
- v1 = **sinyal-only** (track record menyusul).

> Kenapa Bybit, bukan Binance? Binance Futures (`fapi`) **geo-block server GitHub Actions** (HTTP 451), jadi bot nggak bisa jalan gratis di sana. API publik Bybit kejangkau dari runner GitHub. Trading pun pindah ke Bybit biar wallet CEX kepisah total dari dunia spot. Screener & sizing calculator juga sudah dialihkan ke Bybit.

> Ini alat verifikasi, BUKAN sinyal buy/sell. Selalu konfirmasi di chart (LuxAlgo swing=50, internal=5) sebelum entry. Leverage yang ditampilkan = plafon aman terhadap SL, bukan anjuran pakai penuh. Sizing tetap dari risk-per-trade. NFA · DYOR.

---

## Terpisah total dari bot spot

Repo, channel Telegram, dan state INI HARUS TERPISAH dari scanner spot:
- Bot spot = long-only, filter halal, data Binance spot (`data-api.binance.vision`), modal gaji (bersih).
- Bot futures = dua arah, pakai leverage, data **Bybit**, di luar filter halal.
Jangan campur secret/channel/state keduanya.

---

## Langkah setup (sekali, ~15–30 menit)

### 1) Bikin bot + channel Telegram BARU (khusus futures)
1. Chat **@BotFather** → `/newbot` → dapet **TOKEN**.
2. Bikin **channel/grup Telegram baru** khusus futures → tambahkan bot sebagai admin.
3. Ambil **CHAT ID**: forward 1 pesan channel ke **@userinfobot** (id channel diawali `-100`).

### 2) Bikin repo GitHub BARU (terpisah dari spot)
1. Repo baru, saran nama **`taz-screening-futures`**, set **Public**.
2. Upload ke root repo: `scan.js`, `state.json`, dan `.github/workflows/scan.yml` (workflow harus tepat di path itu).

### 3) Masukin secret
Repo → **Settings → Secrets and variables → Actions → New repository secret**:
- `TELEGRAM_TOKEN` = token BotFather
- `TELEGRAM_CHAT_ID` = chat/channel id futures

### 4) Nyalain & tes
1. Tab **Actions** → enable kalau diminta.
2. Pilih **crypto-scan-futures** → **Run workflow** → tunggu ~1–2 menit.
3. Cek log: jumlah perp Bybit discan + (kalau ada READY baru) notif masuk Telegram.

### 5) Cron tiap ~15 menit (cron-job.org)
Bikin job cron-job.org yang `POST` ke
`https://api.github.com/repos/<user>/taz-screening-futures/actions/workflows/scan.yml/dispatches`
dengan header `Authorization: Bearer <GitHub PAT>` (scope `workflow`), `Accept: application/vnd.github+json`, dan body `{"ref":"main"}`, interval 15 menit.

---

## Kalau update kode (re-deploy)

Ganti isi `scan.js` di repo (Edit file → paste versi baru → Commit), lalu **Actions → Run workflow** buat tes. Secret, repo, dan cron nggak perlu diubah.

---

## Isi notifikasi

```
SYMBOL · ▲ LONG / ▼ SHORT · ChoCh/BoS
• Entry : ...
• TP +x.x% · OB/EQ : ...
• SL −x.x% · inval ... : ...
• R:R : ...
• Lev aman : Nx  (liq −xx% · Nx di belakang SL)
• Buka chart   (link BYBIT:SYMBOL.P di TradingView)
```
`Lev aman` = `min(25, floor(1/(SL_frac × 2 + 0.5%)))` — MMR-aware, likuidasi ≥ 2× lebih jauh dari SL. Backstop 25× → leverage ngalir ngikut SL, kepentok cuma pas SL <1%. Ubah `LEV_CEILING` / `LIQ_BUFFER` / `MMR` di KONFIG `scan.js`.

## Catatan jujur
- **Bybit publik market API** (`/v5/market/*`) nggak butuh API key & umumnya kejangkau dari GitHub runner. Kalau suatu saat kena blok (retCode/HTTP aneh), fallback: pindah ke VPS region SG/EU (kode sama, tinggal `node scan.js` + cron).
- **Cron GitHub sering telat.** Target 15m, realita bisa mundur. Kalau butuh presisi, lapis dengan auto-scan di HTML screener.
- **Anti-spam.** `state.json` nyimpen READY terakhir (kunci `SYM::DIR::setup`); tiap run cuma kirim yang baru, lalu di-commit balik.
- **Leverage = plafon aman, bukan ukuran posisi.** Sizing beneran dihitung di sizing calculator / journal futures dari risk-per-trade × SL.

## Tes lokal (Node 18+)
```
node test_scan.js
```
Nguji logika dua arah + parser kline Bybit (tanpa jaringan). Harusnya `SEMUA PASS`.

## Ubah setting
Semua di atas `scan.js` (KONFIG): `MIN_VOL`, `MAX_BARS`, `MIN_TP`, `MIN_TP_FLOOR`, `MIN_RR`, `MAX_FRESH`, `LEV_CEILING`, `LIQ_BUFFER`, `MMR`.
