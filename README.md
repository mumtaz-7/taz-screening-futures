# Crypto SMC FUTURES Scanner → Telegram (24/7)

Scanner otomatis yang jalan di **GitHub Actions**, cari **ChoCh + BoS READY dua arah (LONG + SHORT)**, dan kirim **notifikasi Telegram** cuma buat setup **baru** (anti-spam). Tiap sinyal bawa **rekomendasi leverage aman** (identik dengan sizing calculator).

- Data: **`data-api.binance.vision`** — mirror data publik Binance **SPOT** (host yang kebal-blokir IP datacenter).
- Eksekusi: **Binance PERP**. Level dari data spot ≈ perp (satu exchange, basis ≈ 0), jadi copy-paste-ready. Konfirmasi di chart perp sebelum entry.
- Setup dinotif: **ChoCh/BoS READY, M15**, min volume 24h **3 juta USDT**, adaptive floor gain **10→7%**, R:R ≥ 1, fresh ≤ 5 bar.
- **TANPA filter halal** — futures sengaja di luar filter. Terpisah dari sistem spot.
- v1 = **sinyal-only** (track record menyusul).

> **Kenapa data spot Binance, bukan perp langsung?** Endpoint perp Binance (`fapi.binance.com`) **geo-block server GitHub Actions** (HTTP 451), dan Bybit (`api.bybit.com`) juga nolak IP GitHub (HTTP 403). Satu-satunya sumber gratis yang jalan 24/7 dari GitHub adalah `data-api.binance.vision` (data spot). Karena eksekusi lo di Binance perp — satu exchange dengan sumber data — basis spot↔perp nyaris nol, jadi level sinyal langsung kepake. Screener & sizing calculator (jalan di browser lo, IP rumah) juga pakai data Binance yang sama.

> Ini alat verifikasi, BUKAN sinyal buy/sell. Selalu konfirmasi di chart (LuxAlgo swing=50, internal=5) sebelum entry. Leverage yang ditampilkan = plafon aman terhadap SL, bukan anjuran pakai penuh. Sizing tetap dari risk-per-trade. NFA · DYOR.

---

## Terpisah dari bot spot

Repo, channel Telegram, dan state INI HARUS TERPISAH dari scanner spot:
- Bot spot = long-only, filter halal, modal gaji (bersih).
- Bot futures = dua arah, pakai leverage, di luar filter halal.
Kedua bot kebetulan pakai host data yang sama (`data-api.binance.vision`), tapi secret/channel/state/repo tetap dipisah.

---

## Langkah setup (sekali, ~15–30 menit)

### 1) Bikin bot + channel Telegram BARU (khusus futures)
1. Chat **@BotFather** → `/newbot` → dapet **TOKEN**.
2. Bikin **channel/grup Telegram baru** khusus futures → tambahkan bot sebagai admin.
3. Ambil **CHAT ID**: forward 1 pesan channel ke **@userinfobot** (id channel diawali `-100`).

### 2) Repo GitHub (`taz-screening-futures`, Public)
Upload ke root: `scan.js`, `state.json`, `.github/workflows/scan.yml`.

### 3) Secrets
Repo → **Settings → Secrets and variables → Actions**:
- `TELEGRAM_TOKEN` = token BotFather
- `TELEGRAM_CHAT_ID` = chat/channel id futures

### 4) Tes
Tab **Actions** → **crypto-scan-futures** → **Run workflow** → cek log: jumlah pair discan + notif Telegram.

### 5) Cron tiap ~15 menit (cron-job.org)
`POST` ke `https://api.github.com/repos/<user>/taz-screening-futures/actions/workflows/scan.yml/dispatches`
header `Authorization: Bearer <GitHub PAT>` (scope `workflow`), `Accept: application/vnd.github+json`, body `{"ref":"main"}`, interval 15 menit.

---

## Kalau update kode (re-deploy)

Buka `scan.js` di repo → Edit → paste versi baru → Commit → **Actions → Run workflow**. Secret/repo/cron nggak perlu diubah.

---

## Isi notifikasi

```
SYMBOL · ▲ LONG / ▼ SHORT · ChoCh/BoS
• Entry : ...
• TP +x.x% · OB/EQ : ...
• SL −x.x% · inval ... : ...
• R:R : ...
• Lev aman : Nx  (liq −xx% · Nx di belakang SL)
• Buka chart   (link BINANCE:SYMBOL.P di TradingView)
```
`Lev aman` = `min(25, floor(1/(SL_frac × 1.5 + 0.5%)))` — MMR-aware, likuidasi ≥ 1.5× lebih jauh dari SL. Backstop 25×. Ubah `LEV_CEILING` / `LIQ_BUFFER` / `MMR` di KONFIG `scan.js`.

## Catatan jujur
- **`data-api.binance.vision`** proven jalan 24/7 dari GitHub runner (bot spot lo pakai host yang sama). Kalau suatu saat kena masalah, fallback: VPS region SG/EU.
- **Data spot, trade perp.** Basis Binance spot↔perp ≈ 0 (satu exchange), jauh lebih kecil dari lintas-exchange. Tetap konfirmasi level di chart perp.
- **Cron GitHub sering telat.** Target 15m, realita bisa mundur.
- **Anti-spam.** `state.json` (kunci `SYM::DIR::setup`); tiap run cuma kirim yang baru, di-commit balik.
- **Leverage = plafon aman, bukan ukuran posisi.** Sizing dari risk-per-trade × SL di sizing calculator / journal.

## Tes lokal (Node 18+)
```
node test_scan.js
```
Nguji logika dua arah + parser kline (tanpa jaringan). Harusnya `SEMUA PASS`.

## Ubah setting
KONFIG di atas `scan.js`: `MIN_VOL`, `MAX_BARS`, `MIN_TP`, `MIN_TP_FLOOR`, `MIN_RR`, `MAX_FRESH`, `LEV_CEILING`, `LIQ_BUFFER`, `MMR`.
