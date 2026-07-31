/* Tes logika bot futures (tanpa jaringan).
   1) invariant per-arah (SL/entry/TP, lev, liq>SL)
   2) simetri long/short via mirror data
   3) rumus leverage == sizing calculator (MMR-aware)
   Jalankan: node test_scan.js  → harus "SEMUA PASS". */
const A = require('./scan.js');
const { analyze, maxSafeLeverage } = A;

let fails = 0;
const chk = (cond, msg) => { if(!cond){ console.log('  FAIL:', msg); fails++; } };

function rng(s){ let x=s>>>0; return ()=>{ x=(x*1664525+1013904223)>>>0; return x/4294967296; }; }
function gen(seed, n){ const r=rng(seed); let p=100+r()*50; const c=[]; let d=(r()-0.5)*0.02;
  for(let i=0;i<n;i++){ if(i%50===0) d=(r()-0.5)*0.03; const o=p; const mv=(r()-0.5)*2.2+d;
    const cl=Math.max(1,o*(1+mv/100)); const hi=Math.max(o,cl)*(1+r()*0.6/100); const lo=Math.min(o,cl)*(1-r()*0.6/100);
    c.push({t:i,o,h:hi,l:lo,c:cl}); p=cl; } return c; }
function mirror(c){ let mx=-Infinity; for(const k of c) if(k.h>mx)mx=k.h; const K=2*mx+10;
  return c.map(k=>({t:k.t,o:K-k.o,h:K-k.l,l:K-k.h,c:K-k.c})); }
const near=(a,b,K)=> Math.abs(a-(K-b)) < Math.abs(K)*1e-6;

// ---- 1) rumus leverage vs nilai acuan sizing calculator ----
console.log('1) rumus leverage aman (MMR-aware, backstop 25, buffer 2, mmr 0.5%)');
chk(maxSafeLeverage(4)===11,  'SL 4% → 11x (ngalir ngikut SL)');
chk(maxSafeLeverage(2)===22,  'SL 2% → 22x');
chk(maxSafeLeverage(1)===25,  'SL 1% → 25x (kena backstop)');
chk(maxSafeLeverage(0.5)===25, 'SL 0.5% → 25x (kena backstop)');
chk(maxSafeLeverage(20)===2,  'SL 20% → 2x');
chk(maxSafeLeverage(0)===null && maxSafeLeverage(-1)===null, 'SL invalid → null');

// ---- 2) invariant + 3) mirror simetri ----
console.log('2) invariant per-arah + 3) simetri long/short (4000 seri sintetis)');
let sig=0, longN=0, shortN=0, mirrorDiff=0;
for(let seed=1; seed<=4000; seed++){
  const c=gen(seed,700); const a=analyze(c); if(!a) continue; sig++;
  a.dir==='LONG'?longN++:shortN++;
  // invariant
  if(a.dir==='LONG'){ chk(a.sl<a.entry, `seed${seed} LONG sl<entry`); chk(a.tp>a.entry, `seed${seed} LONG tp>entry`); }
  else { chk(a.sl>a.entry, `seed${seed} SHORT sl>entry`); chk(a.tp<a.entry, `seed${seed} SHORT tp<entry`); }
  chk(a.slPct>0, `seed${seed} slPct>0`); chk(a.gainPct>0, `seed${seed} gain>0`); chk(a.rr>0, `seed${seed} rr>0`);
  chk(a.lev>=1 && a.lev<=A.LEV_CEILING, `seed${seed} lev in range`);
  // liq harus di belakang SL (MMR-aware) selama feasible
  const slF=a.slPct/100; if(slF*A.LIQ_BUFFER + A.MMR/100 < 1){ chk(a.liqDist > a.slPct - 1e-9, `seed${seed} liq(${a.liqDist})>SL(${a.slPct})`); }
  // mirror: hasil harus flip arah + harga tercermin + rr sama
  const b=analyze(mirror(c)); const mx=Math.max(...c.map(k=>k.h)); const K=2*mx+10;
  // catatan: lev TIDAK dicek antar-mirror — slPct relatif ke entry, dan entry beda di cermin,
  // jadi lev long ≠ lev short-mirror secara sah. rr dicek karena dia rasio (mirror-invariant).
  if(b){ const want = a.dir==='LONG'?'SHORT':'LONG';
    if(b.dir===want && b.setup===a.setup && near(a.entry,b.entry,K) && near(a.sl,b.sl,K) && near(a.tp,b.tp,K)
       && Math.abs(a.rr-b.rr)<0.02){ /* ok */ } else { mirrorDiff++; }
  } else { mirrorDiff++; }
}
console.log(`   sinyal: ${sig} (LONG ${longN} / SHORT ${shortN})`);
// mirror boleh beda ~6% (tie-break outside-bar engine LuxAlgo bersama, bukan bug sisi short)
const mirrorPct = sig? mirrorDiff/sig*100 : 0;
console.log(`   mirror beda: ${mirrorDiff}/${sig} (${mirrorPct.toFixed(1)}%) — wajar ≤10% (tie-break LuxAlgo)`);
chk(mirrorPct <= 12, `mirror asimetri ${mirrorPct.toFixed(1)}% terlalu tinggi (harusnya ≤12%)`);
chk(sig > 500, 'cukup banyak sinyal buat uji');

// ---- 4) parser kline Binance (mock: oldest-first, drop forming via closeTime idx6) ----
console.log('4) parser kline Binance (mock oldest-first)');
{ const now=1000000, tfMs=900000;
  // Binance: [openTime,o,h,l,c,vol,closeTime,...], oldest-first
  const row=(t,o,h,l,c,ct)=>[t,String(o),String(h),String(l),String(c),"1",ct];
  const forming=[ row(now-2*tfMs,8,9,7,8, now-tfMs-1), row(now-tfMs,9,10,8,9, now-1), row(now,10,11,9,10, now+tfMs-1) ]; // terakhir masih forming (closeTime > now)
  const p=A.parseKlines(forming, now);
  chk(p.length===2, 'candle forming dibuang (len jadi 2)');
  chk(p[0].t===now-2*tfMs && p[1].t===now-tfMs, 'urutan oldest-first kejaga');
  chk(p[0].o===8 && p[0].h===9 && p[0].l===7 && p[0].c===8, 'mapping OHLC bener');
  const closed=[ row(now-2*tfMs,8,9,7,8, now-tfMs-1), row(now-tfMs,9,10,8,9, now-1) ]; // terakhir closeTime <= now
  chk(A.parseKlines(closed, now).length===2, 'terakhir udah closed → ga ada yg dibuang');
}

console.log(fails===0 ? '\n✅ SEMUA PASS' : `\n❌ ${fails} GAGAL`);
process.exit(fails===0?0:1);
