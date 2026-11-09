/* plan.js —— 按你的真实买法逐期精确结算（不抽样）
 *   双色球：每期把 ABC 号码池（超过 15 码就截取前 15 码）全部红球组合买满 + 蓝球买 1 个
 *   大乐透：每期把 ABC 号码池（超过 15 码截前 15 码）全部前区组合买满 + 后区买 1 组
 * 计数用组合恒等式，不逐注枚举：池内命中 k 个开奖号时，恰好命中 j 个的注数 = C(k,j)·C(u-k,K-j)
 * 用法：node tools/plan.js [--cap=15] [--first=500] [--second=15] [--first2=500] [--second2=10]
 */
const fs = require('fs'), path = require('path');
const V = require(path.join(__dirname, '..', 'vmax.js'));
const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const m = new RegExp('--' + k + '=([^\\s]+)').exec(process.argv.join(' ')); return m ? m[1] : d; };
const CAP = Number(arg('cap', 15));
const F1 = Number(arg('first', 500)) * 1e4, S1 = Number(arg('second', 15)) * 1e4;    // 双色球一/二等估价
const F2 = Number(arg('first2', 500)) * 1e4, S2 = Number(arg('second2', 10)) * 1e4;  // 大乐透一/二等估价
function C(n, k) { if (k < 0 || k > n) return 0; k = Math.min(k, n - k); let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }

function ssqMoney(j, bh) {          // j=命中红球数, bh=蓝球是否命中
  if (j === 6) return bh ? F1 : S1;
  if (j === 5) return bh ? 3000 : 200;
  if (j === 4) return bh ? 200 : 10;
  if (j === 3) return bh ? 10 : 0;
  return bh ? 5 : 0;
}
function dltMoney(j, c) {           // j=命中前区数, c=命中后区数（官方七奖级）
  return { 5: [5000, S2, F2], 4: [150, 300, 5000], 3: [5, 15, 150],
           2: [0, 5, 15], 1: [0, 0, 5], 0: [0, 0, 5] }[j][c];
}

function sim(game) {
  const g = V.GAMES[game], K = g.numPick, key = g.frontKey;
  const hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', game + '.json'), 'utf8')).data;
  let n = 0, skipped = 0, cost = 0, prize = 0, walk = 0, trough = 0, dry = 0, maxDry = 0;
  const tiers = {}; let coverAll = 0, yearlyCost = {}, yearlyPrize = {};
  for (let i = 1; i < hist.length; i++) {
    let pool = V.poolOf(hist[i - 1], game, 'ABC').pool;
    if (pool.length < K) { skipped++; continue; }
    if (pool.length > CAP) pool = pool.slice(0, CAP);            // 超过上限只买前 CAP 个
    const u = pool.length, act = hist[i][key];
    const inPool = {}; pool.forEach(x => inPool[x] = 1);
    const k = act.filter(x => inPool[x]).length;
    const tickets = C(u, K);
    const c0 = tickets * 2; cost += c0; n++;

    let w = 0;
    if (game === 'ssq') {
      const bluePick = hist[i - 1].blue;                          // 蓝球取上期蓝（简单固定买法）
      const bh = hist[i].blue === bluePick ? 1 : 0;
      for (let j = 0; j <= Math.min(K, k); j++) {
        const cnt = C(k, j) * C(u - k, K - j);
        if (!cnt) continue;
        const m = ssqMoney(j, bh);
        w += cnt * m;
        if (m > 0) tiers[j + '红' + (bh ? '+蓝' : '')] = (tiers[j + '红' + (bh ? '+蓝' : '')] || 0) + cnt;
      }
      if (k === 6) coverAll++;
    } else {
      const backPick = hist[i - 1].backs;                         // 后区取上期两个号
      const cc = hist[i].backs.filter(x => backPick.indexOf(x) >= 0).length;
      for (let j = 0; j <= Math.min(K, k); j++) {
        const cnt = C(k, j) * C(u - k, K - j);
        if (!cnt) continue;
        const m = dltMoney(j, cc);
        w += cnt * m;
        if (m > 0) tiers[j + '前区+' + cc + '后区'] = (tiers[j + '前区+' + cc + '后区'] || 0) + cnt;
      }
      if (k === 5) coverAll++;
    }
    prize += w; walk += w - c0; trough = Math.min(trough, walk);
    dry = w > 0 ? 0 : dry + 1; maxDry = Math.max(maxDry, dry);
    const yx = (hist[i].date || '').slice(0, 4);
    yearlyCost[yx] = (yearlyCost[yx] || 0) + c0; yearlyPrize[yx] = (yearlyPrize[yx] || 0) + w;
  }
  const years = Object.keys(yearlyCost).filter(y => y >= '2005');
  const yc = years.reduce((a, y) => a + yearlyCost[y], 0) / years.length;
  const yp = years.reduce((a, y) => a + yearlyPrize[y], 0) / years.length;
  return { 彩种: g.name, 期数: n, 跳过: skipped, 每期注数上限: C(Math.min(CAP, 33), K),
    每期成本: C(Math.min(CAP, 33), K) * 2, 总投入: cost, 总奖金: prize, 净: prize - cost,
    回收率: prize / cost, 全覆盖期数: coverAll, 全奖: tiers, 最深浮亏: -trough, 最长空窗: maxDry,
    年均投入: yc, 年均奖金: yp, 年数: years.length, 池不足期: skipped };
}

console.log('买法：每期把 ABC 号码池' + (CAP ? '（上限 ' + CAP + ' 码）' : '') + '全包 + 蓝球/后区各 1 注'
  + '　浮动奖估价：双色球一等 ' + F1 / 1e4 + '万/二等 ' + S1 / 1e4 + '万，大乐透一等 ' + F2 / 1e4 + '万/二等 ' + S2 / 1e4 + '万\n');
['ssq', 'dlt'].forEach(function (game) {
  const r = sim(game);
  const wan = x => (x / 1e4).toFixed(1) + ' 万';
  console.log('【' + r.彩种 + '】可投 ' + r.期数 + ' 期（池不足 ' + r.池不足期 + ' 期跳过）　每期 '
    + r.每期注数上限.toLocaleString() + ' 注 = ' + r.每期成本.toLocaleString() + ' 元');
  console.log('  全历史：投入 ' + (r.总投入 / 1e8).toFixed(2) + ' 亿　奖金 ' + (r.总奖金 / 1e8).toFixed(2) + ' 亿　净 '
    + (r.净 >= 0 ? '+' : '-') + (Math.abs(r.净) / 1e8).toFixed(2) + ' 亿　回收率 ' + (r.回收率 * 100).toFixed(1) + '%');
  console.log('  折算到近年（' + r.年数 + ' 个完整年度）：年均投入 ' + wan(r.年均投入) + '　年均奖金 ' + wan(r.年均奖金)
    + '　年均净 ' + (r.年均奖金 - r.年均投入 >= 0 ? '+' : '-') + wan(Math.abs(r.年均奖金 - r.年均投入)));
  console.log('  池子完整覆盖当期开奖号码：' + r.全覆盖期数 + ' 期（' + (r.全覆盖期数 / r.期数 * 100).toFixed(2) + '%）　累计最深浮亏 '
    + wan(r.最深浮亏) + '　最长连续不回本 ' + r.最长空窗 + ' 期');
  const top = Object.entries(r.全奖).sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log('  中奖注数分布（Top6）：' + top.map(x => x[0] + ' ' + x[1].toLocaleString() + ' 注').join('；'));
  const g = V.GAMES[game];
  const N = g.numMax, K2 = g.numPick, tot = C(N, K2);
  let evFix = 0, evFloat = 0, pFirst = 0, realizedFloat = 0;
  if (game === 'ssq') {
    for (let j = 0; j <= K2; j++) {
      const pj = C(K2, j) * C(N - K2, K2 - j) / tot;
      evFloat += pj * (j === 6 ? (F1 + 15 * S1) / 16 : 0);
      evFix += pj * ((j === 5 ? 3000 + 15 * 200 : 0) / 16 + (j === 4 ? 200 + 15 * 10 : 0) / 16
        + (j === 3 ? 10 : 0) / 16 + (j <= 2 ? 5 : 0) / 16);
    }
    pFirst = (1 / tot) * (1 / 16);
    realizedFloat = (r.全奖['6红+蓝'] || 0) * F1 + (r.全奖['6红'] || 0) * S1;
  } else {
    for (let j = 0; j <= K2; j++) {
      const pj = C(K2, j) * C(N - K2, K2 - j) / tot;
      for (let c = 0; c <= 2; c++) {
        const pc = C(2, c) * C(10, 2 - c) / 66, m = dltMoney(j, c);
        if (m === F2 || m === S2) evFloat += pj * pc * m; else evFix += pj * pc * m;
      }
    }
    pFirst = (1 / tot) * (1 / 66);
    realizedFloat = (r.全奖['5前区+2后区'] || 0) * F2 + (r.全奖['5前区+1后区'] || 0) * S2;
  }
  const tickets = r.总投入 / 2, expFirst = tickets * pFirst;
  console.log('  理论对照：随机单注期望奖金 ' + (evFix + evFloat).toFixed(3) + ' 元 = 固定奖 ' + evFix.toFixed(3)
    + ' + 浮动奖 ' + evFloat.toFixed(3) + ' → 期望回收率 ' + ((evFix + evFloat) / 2 * 100).toFixed(1)
    + '%（浮动奖占期望收益的 ' + (evFloat / (evFix + evFloat) * 100).toFixed(0) + '%）');
  console.log('  本买法累计 ' + tickets.toLocaleString() + ' 注 ⇒ 一等奖理论次数 ' + expFirst.toFixed(2)
    + '，一次都不中的概率 ' + (Math.exp(-expFirst) * 100).toFixed(0) + '%；实测浮奖奖金 '
    + (realizedFloat / 1e4).toFixed(0) + ' 万 / 总奖金 ' + (r.总奖金 / 1e4).toFixed(0) + ' 万');
  console.log('  扣掉一二等奖后本买法实测固定奖回收率 ' + ((r.总奖金 - realizedFloat) / r.总投入 * 100).toFixed(1)
    + '%（理论固定奖占比 ' + (evFix / (evFix + evFloat) * 100).toFixed(0) + '%）');
  console.log('');
});
console.log('一等奖概率对照：双色球 1/17,721,088（6红全中再中蓝）、大乐透 5+2 = 1/21,425,712（官方口径）。');
