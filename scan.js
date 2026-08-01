/* =====================================================================
   Crypto SMC FUTURES Scanner → Telegram  (ChoCh + BoS READY · LONG + SHORT · M15)
   Fork dari scanner spot (scan.js) → data Binance SPOT via data-api.binance.vision (host kebal-blokir
   datacenter → gratis 24/7 di GitHub; fapi & Bybit diblok). Eksekusi di BINANCE PERP (basis spot↔perp ≈ 0).
   Beda dari spot: (1) data host = vision spot; (2) TANPA filter halal (futures sengaja
   di luar filter, sesuai keputusan); (3) sisi SHORT ditambah (mirror penuh long);
   (4) tiap sinyal bawa REKOMENDASI LEVERAGE AMAN (MMR-aware, sama kayak sizing calculator).
   v1 = SINYAL-ONLY (track record menyusul di step berikutnya).
   Jalan di GitHub Actions, dipicu cron. Notif cuma buat READY BARU (anti-spam via state.json).
   ===================================================================== */
const fs = require('fs');

// ---------- KONFIG ----------
const BASE        = 'https://data-api.binance.vision';   // mirror data publik Binance SPOT (kebal-blokir datacenter)
const TF          = '15m';                                // interval Binance
const TF_MS       = 15*60*1000;
const LIMIT       = 700;
const SWING_LEN   = 50;
const INTERNAL_LEN= 5;
const MAX_BARS    = 25;
const CONFLUENCE  = true;
const MIN_VOL     = 3e6;       // volume 24h minimal (USDT) = 3 juta (samain spot).
const MIN_TP      = 10;        // plafon adaptive floor (10→9→8→7)
const MIN_TP_FLOOR= 7;         // lantai bawah adaptive floor
const MIN_RR      = 1;         // R:R minimal
const OB_EXTEND_BELOW = 5;
const MAX_FRESH   = 5;         // gerbang kesegaran (barsSince <= 5)
const SL_BUFFER   = 0.5;       // SL Opsi 3
const CONC        = 5;

// --- Leverage aman (MMR-aware, PERSIS sizing calculator) ---
const LEV_CEILING = 25;        // backstop leverage (nutup max mayoritas alt; jarang kepentok, cuma ngerem SL <1%)
const LIQ_BUFFER  = 1.5;       // likuidasi minimal 1.5× lebih jauh dari SL
const MMR         = 0.5;       // maintenance margin rate (%) — perkiraan konservatif

// Perp Level Checker (di-host di GitHub Pages) — link "Cek sizing" per sinyal. Ganti kalau host di URL lain.
const CHECKER_URL = 'https://mumtaz-7.github.io/taz-screening-futures/SMS_Perp_Level_Checker.html';

const STATE_FILE  = __dirname + '/state.json';
const TG_TOKEN    = process.env.TELEGRAM_TOKEN;
const TG_CHAT     = process.env.TELEGRAM_CHAT_ID;
const TG_CHAT_UPDATES = process.env.TELEGRAM_CHAT_ID_UPDATES || TG_CHAT;   // channel terpisah buat UPDATE STATUS (fallback ke channel utama kalau belum di-set)

// ---- TRACK RECORD ----
const JOURNAL_FILE = __dirname + '/journal.json';
const STATS_FILE   = __dirname + '/stats.json';
const RETEST_WIN   = 25;          // jendela retest (bar) buat fill limit
const MAX_HOLD_DAYS= 9;           // open > 9 hari & belum resolve → expired
const TRACK_LIMIT  = 1000;        // candle khusus tracking (~10,4 hari M15)
const TERMINAL     = ['win','loss','void','expired'];
const round = x => x==null ? null : Math.round(x*100)/100;

const STABLE_BASES = new Set(["USDC","FDUSD","TUSD","BUSD","DAI","USDP","UST","USTC","EUR","GBP","AEUR","USD1","XUSD","PYUSD","EURI","TRY","BRL","ARS","ZAR","BIDR","IDRT","NGN","UAH","RUB","PLN","RON","JPY","MXN","COP","CZK"]);
const LEVERAGE_TAGS = ["UP","DOWN","BULL","BEAR"];   // buang leveraged token spot (BTCUPUSDT dll)
const TOKENIZED_GRP = 'TRD_GRP_261';   // grup permission bStocks (tokenized stock: AAPLB/TSLAB/NVDAB dll) — DIBUANG (anomali, ngikut jam bursa)

// ---------- NETWORK ----------
async function apiGet(path, params){
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const r = await fetch(BASE + path + qs);
  if(!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
  return r.json();
}
// Binance kline: udah oldest-first. Buang candle terakhir kalau belum tutup (closeTime idx 6 di masa depan) → act-on-close.
function parseKlines(raw, now){
  const rows = (raw.length && raw[raw.length-1][6] > now) ? raw.slice(0, -1) : raw;
  return rows.map(k => ({t:k[0], o:+k[1], h:+k[2], l:+k[3], c:+k[4]}));
}

// ---------- ENGINE LUXALGO (dua arah — parity screener futures) ----------
function computeLeg(c, t, size, prev){
  if(t < size) return prev;
  const hAgo = c[t-size].h, lAgo = c[t-size].l;
  let maxR = -Infinity, minR = Infinity;
  for(let k = t-size+1; k <= t; k++){ if(c[k].h > maxR) maxR = c[k].h; if(c[k].l < minR) minR = c[k].l; }
  if(hAgo > maxR) return 0;
  if(lAgo < minR) return 1;
  return prev;
}
const ATR_LEN = 200;
function luxStructure(c, swingLen, confluence){
  const n = c.length;
  const sH = {level:NaN,crossed:false,idx:-1}, sL = {level:NaN,crossed:false,idx:-1};
  const iH = {level:NaN,crossed:false,idx:-1}, iL = {level:NaN,crossed:false,idx:-1};
  let swingTrend = 0, internalTrend = 0, legS = 0, legI = 0;
  let trailTop = c[0].h, trailBot = c[0].l;
  const events = [];
  const pHigh = new Array(n), pLow = new Array(n);
  const obsBear = [], obsBull = [];
  let atr = 0, trSum = 0;
  for(let t = 0; t < n; t++){
    const tr = t > 0 ? Math.max(c[t].h-c[t].l, Math.abs(c[t].h-c[t-1].c), Math.abs(c[t].l-c[t-1].c)) : (c[t].h-c[t].l);
    if(t < ATR_LEN){ trSum += tr; atr = trSum/(t+1); } else { atr = (atr*(ATR_LEN-1)+tr)/ATR_LEN; }
    const highVol = (c[t].h - c[t].l) >= 2*atr;
    pHigh[t] = highVol ? c[t].l : c[t].h;
    pLow[t]  = highVol ? c[t].h : c[t].l;
    if(c[t].h > trailTop) trailTop = c[t].h;
    if(c[t].l < trailBot) trailBot = c[t].l;
    const pS = legS; legS = computeLeg(c, t, swingLen, legS);
    if(legS !== pS && t >= swingLen){
      if(legS === 1){ sL.level = c[t-swingLen].l; sL.crossed = false; sL.idx = t-swingLen; trailBot = sL.level; }
      else          { sH.level = c[t-swingLen].h; sH.crossed = false; sH.idx = t-swingLen; trailTop = sH.level; }
    }
    const pI = legI; legI = computeLeg(c, t, INTERNAL_LEN, legI);
    if(legI !== pI && t >= INTERNAL_LEN){
      if(legI === 1){ iL.level = c[t-INTERNAL_LEN].l; iL.crossed = false; iL.idx = t-INTERNAL_LEN; }
      else          { iH.level = c[t-INTERNAL_LEN].h; iH.crossed = false; iH.idx = t-INTERNAL_LEN; }
    }
    if(t > 0){
      const cl = c[t].c, clp = c[t-1].c, o = c[t].o, h = c[t].h, l = c[t].l;
      let bull = true, bear = true;
      if(confluence){ const up = h - Math.max(cl,o), m = Math.min(cl,o) - l; bull = up > m; bear = up < m; }
      // BULL internal break
      if(!isNaN(iH.level) && clp <= iH.level && cl > iH.level && !iH.crossed && iH.level !== sH.level && bull){
        const tag = internalTrend === -1 ? 'CHoCH' : 'BOS'; internalTrend = 1; iH.crossed = true;
        let obTP = null;
        for(const ob of obsBear){ const bot = Math.min(ob.barHigh, ob.barLow); if(bot > trailTop && (obTP === null || bot < obTP)) obTP = bot; }
        events.push({idx:t, dir:'bull', tag, level:iH.level, strongLow:trailBot, weakHigh:trailTop, swingTrend,
                     internalLow: isNaN(iL.level) ? null : iL.level, obTP});
        if(iH.idx >= 0){ let minL = Infinity, mi = iH.idx;
          for(let k = iH.idx; k < t; k++){ if(pLow[k] < minL){ minL = pLow[k]; mi = k; } }
          obsBull.unshift({barHigh:pHigh[mi], barLow:pLow[mi], idx:mi});
          if(obsBull.length > 100) obsBull.pop();
        }
      }
      // BEAR internal break
      if(!isNaN(iL.level) && clp >= iL.level && cl < iL.level && !iL.crossed && iL.level !== sL.level && bear){
        const tag = internalTrend === 1 ? 'CHoCH' : 'BOS'; internalTrend = -1; iL.crossed = true;
        let obTP = null;
        for(const ob of obsBull){ const top = Math.max(ob.barHigh, ob.barLow); if(top < trailBot && (obTP === null || top > obTP)) obTP = top; }
        events.push({idx:t, dir:'bear', tag, level:iL.level, strongLow:trailBot, weakHigh:trailTop, swingTrend,
                     internalHigh: isNaN(iH.level) ? null : iH.level, obTP});
        if(iL.idx >= 0){ let maxH = -Infinity, mi = iL.idx;
          for(let k = iL.idx; k < t; k++){ if(pHigh[k] > maxH){ maxH = pHigh[k]; mi = k; } }
          obsBear.unshift({barHigh:pHigh[mi], barLow:pLow[mi], idx:mi});
          if(obsBear.length > 100) obsBear.pop();
        }
      }
      if(!isNaN(sH.level) && clp <= sH.level && cl > sH.level && !sH.crossed){ swingTrend = 1; sH.crossed = true; }
      if(!isNaN(sL.level) && clp >= sL.level && cl < sL.level && !sL.crossed){ swingTrend = -1; sL.crossed = true; }
    }
    for(let i2 = obsBear.length-1; i2 >= 0; i2--){ if(c[t].h > obsBear[i2].barHigh) obsBear.splice(i2,1); }
    for(let i2 = obsBull.length-1; i2 >= 0; i2--){ if(c[t].l < obsBull[i2].barLow) obsBull.splice(i2,1); }
  }
  return {swingTrend, internalTrend, trailBot, trailTop, events};
}

function fibRetrLong(price, sl, wh){ const r = wh - sl; return r > 0 ? (wh - price)/r : null; }
function fibRetrShort(price, sh, wl){ const r = sh - wl; return r > 0 ? (price - wl)/r : null; }
function slOpt3Long(entry, internalLow, strongLow){
  const lo = (internalLow != null && internalLow < entry) ? internalLow : strongLow;
  const sl = lo - SL_BUFFER*(entry - lo);
  return (sl > 0 && sl < entry) ? sl : (strongLow > 0 && strongLow < entry ? strongLow : entry*0.5);
}
function slOpt3Short(entry, internalHigh, strongHigh){
  const hi = (internalHigh != null && internalHigh > entry) ? internalHigh : strongHigh;
  const sl = hi + SL_BUFFER*(hi - entry);
  return (sl > entry) ? sl : (strongHigh > entry ? strongHigh : entry*1.5);
}
// leverage aman MMR-aware (identik sizing calculator mode auto)
function maxSafeLeverage(slPct){
  if(slPct == null || slPct <= 0) return null;
  const raw = Math.floor(1 / ((slPct/100)*LIQ_BUFFER + MMR/100));
  return Math.max(1, Math.min(LEV_CEILING, raw));
}
function liqInfo(slPct, lev){
  const liqDist = 100/lev - MMR;   // % dari entry (perkiraan isolated)
  return { liqDist: Math.round(liqDist*10)/10, mult: slPct>0 ? Math.round(liqDist/slPct*10)/10 : null };
}

// READY only, dua arah. Return objek sinyal lengkap + dir + lev.
function analyze(c){
  const n = c.length; if(n < SWING_LEN*4 + 20) return null;
  const st = luxStructure(c, SWING_LEN, CONFLUENCE);
  const price = c[n-1].c, strongLow = st.trailBot, weakHigh = st.trailTop, strongHigh = st.trailTop, weakLow = st.trailBot;

  const finish = (dir, pick, inval) => {
    const slPct = pick.slPct, gainPct = pick.gainPct, rr = gainPct/slPct;
    const lev = maxSafeLeverage(slPct);
    const li = liqInfo(slPct, lev);
    return { dir, setup:pick.setup, entry:pick.entry, sl:pick.sl, tp:pick.tp, tpSrc:pick.tpSrc,
      slPct, gainPct, rr, barsSince:pick.barsSince, evIdx:pick.evIdx, inval, lev, liqDist:li.liqDist, liqMult:li.mult, price };
  };

  if(st.swingTrend === 1 && price > strongLow){
    // ===== LONG =====
    const ok = ev => { const bearAfter = st.events.some(e => e.dir==='bear' && e.idx>ev.idx);
      return st.internalTrend===1 && !bearAfter && (n-1-ev.idx)<=MAX_BARS && ev.level>strongLow && weakHigh>ev.level; };
    const build = (ev, setup, sl, tp, tpSrc) => ({ setup, entry:ev.level, sl, tp, tpSrc,
      slPct:(ev.level-sl)/ev.level*100, gainPct:(tp-ev.level)/ev.level*100, barsSince:n-1-ev.idx, evIdx:ev.idx, inval:ev.internalLow });
    let choch=null, bos=null;
    const chs = st.events.filter(e => e.dir==='bull' && e.tag==='CHoCH');
    if(chs.length){ const ev = chs[chs.length-1]; if(ok(ev)){
      const entry=ev.level, eq=(strongLow+weakHigh)/2, cr=fibRetrLong(entry,strongLow,weakHigh);
      let tp, tpSrc;
      if(cr!=null && cr>0.618 && eq>entry){ tp=eq; tpSrc='EQ'; }
      else { const whGain=(weakHigh-entry)/entry*100;
        if(whGain<OB_EXTEND_BELOW && ev.obTP!=null && ev.obTP>weakHigh){ tp=ev.obTP; tpSrc='OB'; } else { tp=weakHigh; tpSrc='WH'; } }
      choch = build(ev,'ChoCh', slOpt3Long(entry,ev.internalLow,strongLow), tp, tpSrc); } }
    const bss = st.events.filter(e => e.dir==='bull' && e.tag==='BOS');
    if(bss.length){ const ev = bss[bss.length-1]; if(ok(ev)){
      const useOB=(ev.obTP!=null && ev.obTP>weakHigh);
      bos = build(ev,'BoS', slOpt3Long(ev.level,ev.internalLow,strongLow), useOB?ev.obTP:weakHigh, useOB?'OB':'WH'); } }
    if(!choch && !bos) return null;
    const pick = (choch && bos) ? (bos.evIdx>choch.evIdx?bos:choch) : (choch||bos);
    return finish('LONG', pick, pick.inval);
  } else if(st.swingTrend === -1 && price < strongHigh){
    // ===== SHORT (mirror) =====
    const ok = ev => { const bullAfter = st.events.some(e => e.dir==='bull' && e.idx>ev.idx);
      return st.internalTrend===-1 && !bullAfter && (n-1-ev.idx)<=MAX_BARS && ev.level<strongHigh && weakLow<ev.level; };
    const build = (ev, setup, sl, tp, tpSrc) => ({ setup, entry:ev.level, sl, tp, tpSrc,
      slPct:(sl-ev.level)/ev.level*100, gainPct:(ev.level-tp)/ev.level*100, barsSince:n-1-ev.idx, evIdx:ev.idx, inval:ev.internalHigh });
    let choch=null, bos=null;
    const chs = st.events.filter(e => e.dir==='bear' && e.tag==='CHoCH');
    if(chs.length){ const ev = chs[chs.length-1]; if(ok(ev)){
      const entry=ev.level, eq=(strongHigh+weakLow)/2, cr=fibRetrShort(entry,strongHigh,weakLow);
      let tp, tpSrc;
      if(cr!=null && cr>0.618 && eq<entry){ tp=eq; tpSrc='EQ'; }
      else { const wlGain=(entry-weakLow)/entry*100;
        if(wlGain<OB_EXTEND_BELOW && ev.obTP!=null && ev.obTP<weakLow){ tp=ev.obTP; tpSrc='OB'; } else { tp=weakLow; tpSrc='WL'; } }
      choch = build(ev,'ChoCh', slOpt3Short(entry,ev.internalHigh,strongHigh), tp, tpSrc); } }
    const bss = st.events.filter(e => e.dir==='bear' && e.tag==='BOS');
    if(bss.length){ const ev = bss[bss.length-1]; if(ok(ev)){
      const useOB=(ev.obTP!=null && ev.obTP<weakLow);
      bos = build(ev,'BoS', slOpt3Short(ev.level,ev.internalHigh,strongHigh), useOB?ev.obTP:weakLow, useOB?'OB':'WL'); } }
    if(!choch && !bos) return null;
    const pick = (choch && bos) ? (bos.evIdx>choch.evIdx?bos:choch) : (choch||bos);
    return finish('SHORT', pick, pick.inval);
  }
  return null;
}

// ---------- TELEGRAM ----------
function fmt(x){ const a = Math.abs(x); return a >= 1000 ? x.toFixed(2) : (+x.toPrecision(6)).toString(); }
function isExtended(a){ return a.price != null && (a.dir==='LONG' ? a.price >= a.tp : a.price <= a.tp); }
async function notify(fresh, ready){
  if(!TG_TOKEN || !TG_CHAT){ console.log('TELEGRAM_TOKEN / CHAT_ID kosong — skip kirim.'); return; }
  const cap = 25;
  const shown = fresh.slice(0, cap);
  let msg = `▸ <b>${fresh.length} Sinyal Futures Ready baru</b> · <b>M15</b>\n\n`;
  for(const k of shown){ const s = k.split('::')[0], a = ready[s];
    const arrow = a.dir==='LONG' ? '▲ LONG' : '▼ SHORT';
    const tv  = `https://www.tradingview.com/chart/?symbol=BINANCE:${s}.P`;
    const chk = `${CHECKER_URL}?sym=${s}`;
    if(isExtended(a)){
      msg += `<b>${s}</b> · ${arrow} · ${a.setup} · <i>Extended</i>\n`;
      msg += `<i>harga sudah lewat TP — watchlist, bukan entry.</i>\n`;
      msg += `• <a href="${tv}">Buka chart</a>\n\n`;
      continue;
    }
    const src   = a.tpSrc==='OB' ? ' · OB' : a.tpSrc==='EQ' ? ' · EQ' : '';
    const inval = a.inval != null ? ` · inval ${fmt(a.inval)}` : '';
    msg += `<b>${s}</b> · ${arrow} · ${a.setup}\n`;
    msg += `• Entry : <code>${fmt(a.entry)}</code>\n`;
    msg += `• TP +${a.gainPct.toFixed(1)}%${src} : <code>${fmt(a.tp)}</code>\n`;
    msg += `• SL −${a.slPct.toFixed(1)}%${inval} : <code>${fmt(a.sl)}</code>\n`;
    msg += `• R:R ${a.rr.toFixed(2)} · Lev ${a.lev}×\n`;
    msg += `• <a href="${tv}">Buka chart</a> · <a href="${chk}">Cek sizing</a>\n\n`;
  }
  if(fresh.length > cap) msg += `…+${fresh.length - cap} lagi\n\n`;
  msg += `— Bukan sinyal buy/sell. Verifikasi di chart (LuxAlgo swing=50, internal=5) dulu.\n`;
  msg += `<i>Not Financial Advice · Do Your Own Research.</i>`;
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({chat_id: TG_CHAT, text: msg, parse_mode: 'HTML', disable_web_page_preview: true})
  });
  console.log('telegram sendMessage:', r.status);
}

// ADAPTIVE FLOOR (10→9→8→7)
function pickFloor(gains){
  if(!gains || !gains.length) return null;
  return Math.min(MIN_TP, Math.floor(Math.max.apply(null, gains)));
}

// ---------- TRACK RECORD ENGINE (act-on-close · dua arah) ----------
// LONG: fill saat harga retest TURUN ke entry; SL saat low<=sl; TP saat high>=tp.
// SHORT: fill saat harga retest NAIK ke entry; SL saat high>=sl; TP saat low<=tp.
// same-bar SL+TP = loss (SL dicek dulu). Sinyal dari candle tutup (signalTime=close) → mulai candle berikutnya (anti look-ahead).
function evalTrade(tr, candles){
  if(TERMINAL.includes(tr.status)) return tr;
  const isL = tr.dir === 'LONG';
  const ageDays = (Date.now() - tr.signalTime) / 86400000;
  const start = candles.findIndex(c => c.t >= tr.signalTime);
  if(start < 0) return ageDays > MAX_HOLD_DAYS ? {...tr, status:'void', voidReason:'ga-retest'} : tr;
  // cari fill; kalau TP kesentuh DULUAN sebelum retest → void (setup basi)
  let fill = -1;
  for(let i = start; i < candles.length && (i-start) < RETEST_WIN; i++){
    if(isL){ if(candles[i].l <= tr.entry){ fill = i; break; } if(candles[i].h >= tr.tp) return {...tr, status:'void', voidReason:'tp-duluan', resolvedTime:candles[i].t}; }
    else   { if(candles[i].h >= tr.entry){ fill = i; break; } if(candles[i].l <= tr.tp) return {...tr, status:'void', voidReason:'tp-duluan', resolvedTime:candles[i].t}; }
  }
  if(fill < 0){
    if((candles.length - start) >= RETEST_WIN || ageDays > MAX_HOLD_DAYS) return {...tr, status:'void', voidReason:'ga-retest'};
    return {...tr, status:'pending'};
  }
  // resolusi dari bar fill
  for(let i = fill; i < candles.length; i++){
    if(isL){
      if(candles[i].l <= tr.sl) return {...tr, status:'loss', R:-1, fillTime:candles[fill].t, resolvedTime:candles[i].t};
      if(candles[i].h >= tr.tp){ const RR=(tr.tp-tr.entry)/(tr.entry-tr.sl); return {...tr, status:'win', R:round(RR), fillTime:candles[fill].t, resolvedTime:candles[i].t}; }
    } else {
      if(candles[i].h >= tr.sl) return {...tr, status:'loss', R:-1, fillTime:candles[fill].t, resolvedTime:candles[i].t};
      if(candles[i].l <= tr.tp){ const RR=(tr.entry-tr.tp)/(tr.sl-tr.entry); return {...tr, status:'win', R:round(RR), fillTime:candles[fill].t, resolvedTime:candles[i].t}; }
    }
  }
  if(ageDays > MAX_HOLD_DAYS) return {...tr, status:'expired', fillTime:candles[fill].t};
  return {...tr, status:'open', fillTime:candles[fill].t};
}

function computeStats(journal){
  const done = journal.filter(t => t.status==='win' || t.status==='loss');
  const agg = list => { const n=list.length; if(!n) return {n:0, win:null, er:null, avgWin:null};
    const wins=list.filter(t=>t.status==='win');
    const er=list.reduce((s,t)=>s+t.R,0)/n, avgWin=wins.length?wins.reduce((s,t)=>s+t.R,0)/wins.length:null;
    return {n, wins:wins.length, losses:n-wins.length, win:Math.round(wins.length/n*1000)/10, er:round(er), avgWin:round(avgWin)}; };
  return {
    updatedAt:new Date().toISOString(),
    all:agg(done),
    LONG:agg(done.filter(t=>t.dir==='LONG')), SHORT:agg(done.filter(t=>t.dir==='SHORT')),
    ChoCh:agg(done.filter(t=>t.setup==='ChoCh')), BoS:agg(done.filter(t=>t.setup==='BoS')),
    open:journal.filter(t=>t.status==='open').length, pending:journal.filter(t=>t.status==='pending').length,
    void:journal.filter(t=>t.status==='void').length, expired:journal.filter(t=>t.status==='expired').length,
    totalSignals:journal.length
  };
}

async function notifyUpdates(updates){
  if(!TG_TOKEN || !TG_CHAT_UPDATES){ console.log('TG kosong — skip update.'); return; }
  let msg = `▸ <b>Update Posisi Futures</b> · <b>M15</b>\n\n`;
  for(const t of updates){
    const arrow = t.dir==='LONG' ? '▲ LONG' : '▼ SHORT';
    msg += `<b>${t.symbol}</b> · ${arrow} · ${t.setup}\n`;
    if(t.status==='open'){
      const src = t.tpSrc==='OB' ? ' · OB' : t.tpSrc==='EQ' ? ' · EQ' : '';
      msg += `• Status : ● Entry kefill — posisi jalan\n`;
      msg += `• Entry : <code>${fmt(t.entry)}</code>\n`;
      msg += `• TP +${t.gainPct.toFixed(1)}%${src} : <code>${fmt(t.tp)}</code>\n`;
      msg += `• SL −${t.slPct.toFixed(1)}% : <code>${fmt(t.sl)}</code>\n`;
    } else if(t.status==='win'){ msg += `• Status : ✓ TP kena · WIN +${t.R}R\n• Entry <code>${fmt(t.entry)}</code> → TP <code>${fmt(t.tp)}</code>\n`;
    } else if(t.status==='loss'){ msg += `• Status : ✗ SL kena · LOSS -1R\n• Entry <code>${fmt(t.entry)}</code> → SL <code>${fmt(t.sl)}</code>\n`;
    } else if(t.status==='void'){ const why=t.voidReason==='tp-duluan'?'harga ke TP duluan sebelum entry':'harga nggak retest ke entry'; msg += `• Status : ○ Void — ${why}\n`; }
    msg += `\n`;
  }
  msg += `<i>Auto-tracking track record · bukan aba-aba entry/exit.</i>`;
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({chat_id: TG_CHAT_UPDATES, text: msg, parse_mode:'HTML', disable_web_page_preview:true})
  });
  console.log('telegram update:', r.status, `(${updates.length} posisi)`);
}

// ---------- MAIN ----------
async function main(){
  // universe: spot USDT trading (data-api.binance.vision), TANPA filter halal (futures)
  const info = await apiGet('/api/v3/exchangeInfo');
  const valid = new Set();
  for(const s of info.symbols){
    if(s.quoteAsset !== 'USDT' || s.status !== 'TRADING' || !s.isSpotTradingAllowed) continue;
    if(STABLE_BASES.has(s.baseAsset) || LEVERAGE_TAGS.some(t => s.baseAsset.endsWith(t))) continue;
    if((s.permissionSets||[]).some(ps => ps.includes(TOKENIZED_GRP))) continue;   // buang tokenized stock (bStocks)
    valid.add(s.symbol);
  }
  const tick = await apiGet('/api/v3/ticker/24hr');
  const liquid = tick.filter(x => valid.has(x.symbol) && parseFloat(x.quoteVolume) >= MIN_VOL).map(x => x.symbol);

  const ready = {}; let i = 0;
  async function worker(){
    while(i < liquid.length){ const sym = liquid[i++];
      try{
        const raw = await apiGet('/api/v3/klines', {symbol: sym, interval: TF, limit: LIMIT});
        const c = parseKlines(raw, Date.now());   // drop forming candle (act-on-close)
        const a = analyze(c);
        if(a && a.gainPct >= MIN_TP_FLOOR && a.rr >= MIN_RR && a.barsSince <= MAX_FRESH)
          ready[sym] = {...a, signalTime: c[c.length-1].t + TF_MS};
      }catch(e){}
    }
  }
  await Promise.all(Array.from({length: CONC}, worker));

  // ADAPTIVE FLOOR
  { const floor = pickFloor(Object.values(ready).map(a => a.gainPct));
    if(floor != null){ for(const sym of Object.keys(ready)){ if(ready[sym].gainPct < floor) delete ready[sym]; }
      console.log(`adaptive floor: ${floor}% (${Object.keys(ready).length} lolos)`); } }

  let prev = [];
  try{ prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).ready || []; }catch(e){}
  // journal di-load DULU buat dedup: sinyal yg udah punya trade AKTIF jangan di-notif/journal lagi
  let journal = [];
  try{ journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8')); }catch(e){}
  const hasActive = (sym,dir,setup) => journal.some(t => t.symbol===sym && t.dir===dir && t.setup===setup && !TERMINAL.includes(t.status));
  // kunci = SIMBOL::DIR::setup → arah / setup berubah dianggap sinyal baru
  const curr  = Object.keys(ready).map(s => `${s}::${ready[s].dir}::${ready[s].setup}`).sort();
  const fresh = curr.filter(k => {
    if(prev.includes(k)) return false;                       // masih READY dari run sebelumnya
    const sym=k.split('::')[0], a=ready[sym]; if(!a) return false;
    if(isExtended(a)) return true;                            // Extended = radar, ga di-track, biarin lolos notif
    return !hasActive(sym, a.dir, a.setup);                   // skip kalau udah ada trade AKTIF utk sym+dir+setup
  });
  const nL = Object.values(ready).filter(a=>a.dir==='LONG').length, nS = Object.values(ready).filter(a=>a.dir==='SHORT').length;
  console.log(`scan: ${liquid.length} perp · ${curr.length} READY (L ${nL}/S ${nS}) · ${fresh.length} baru → ${fresh.join(', ') || '-'}`);
  if(fresh.length) await notify(fresh, ready);   // fresh = SYM::DIR::setup; notify baca simbol dari [0], detail dari ready
  fs.writeFileSync(STATE_FILE, JSON.stringify({ready: curr, at: new Date().toISOString()}, null, 2));

  // ---------- TRACK RECORD ----------
  // 1) catat sinyal BARU (status pending). Extended (radar) TIDAK di-track.
  const ids = new Set(journal.map(t => t.id));
  const justCreated = new Set();   // lahir run ini → tunda evaluasi fill ke run berikutnya (window entry + anti look-ahead)
  for(const k of fresh){ const sym=k.split('::')[0], a=ready[sym]; if(!a) continue;
    if(isExtended(a)) continue;
    const id = `${sym}::${a.dir}::${a.setup}::${a.signalTime}`;
    if(ids.has(id)) continue; ids.add(id); justCreated.add(id);
    journal.push({ id, symbol:sym, dir:a.dir, setup:a.setup, entry:a.entry, sl:a.sl, tp:a.tp, tpSrc:a.tpSrc,
      slPct:round(a.slPct), gainPct:round(a.gainPct), rr:round(a.rr), lev:a.lev, signalTime:a.signalTime,
      status:'pending', createdAt:Date.now() });
  }
  // 2) update trade belum kelar (fetch klines dalam → cek fill/TP/SL)
  const alive = journal.filter(t => !TERMINAL.includes(t.status) && !justCreated.has(t.id));
  const symsNeeded = [...new Set(alive.map(t => t.symbol))];
  const cache = {}; let ti2 = 0;
  async function trackWorker(){ while(ti2 < symsNeeded.length){ const sym = symsNeeded[ti2++];
    try{ const raw = await apiGet('/api/v3/klines', {symbol:sym, interval:TF, limit:TRACK_LIMIT}); cache[sym] = parseKlines(raw, Date.now()); }catch(e){ cache[sym] = null; } } }
  await Promise.all(Array.from({length: CONC}, trackWorker));
  const updates = [];
  for(let j = 0; j < journal.length; j++){ const t = journal[j];
    if(TERMINAL.includes(t.status)) continue;
    if(justCreated.has(t.id)) continue;   // baru lahir → cek fill mulai run berikutnya
    if(!cache[t.symbol]) continue;
    const before = t.status;
    const after  = evalTrade(t, cache[t.symbol]);
    after.notified = Array.isArray(after.notified) ? after.notified : (Array.isArray(t.notified) ? t.notified : []);
    journal[j] = after;
    // notif sekali per status transisi ke open/win/loss/void (expired di-skip)
    if(after.status !== before && ['open','win','loss','void'].includes(after.status) && !after.notified.includes(after.status)){
      after.notified.push(after.status); updates.push(after);
    }
  }
  if(updates.length) await notifyUpdates(updates);
  // 3) hitung stats + simpan
  const stats = computeStats(journal);
  fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journal, null, 1));
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  console.log(`journal: ${journal.length} sinyal · resolved ${stats.all.n} (win ${stats.all.win}%) · open ${stats.open} · pending ${stats.pending}`);
}

if(require.main === module){ main().catch(e => { console.error(e); process.exit(1); }); }
module.exports = { analyze, luxStructure, computeLeg, maxSafeLeverage, liqInfo, pickFloor, parseKlines,
  evalTrade, computeStats, round, MIN_TP, MIN_TP_FLOOR, MIN_RR, MAX_FRESH, LEV_CEILING, LIQ_BUFFER, MMR };
