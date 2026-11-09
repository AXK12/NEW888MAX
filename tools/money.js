/* money.js —— 「这池子真金白银买，要花多少、能回多少」
 *
 *   node tools/money.js [--mode=ABC] [--first=500] [--second=15]
 *
 * 算法：逐期把 T-1 期算出的号码池整体做成复式（前区/红球全包），
 *       蓝球分两种打法：只买 1 个 / 全包 16 个（大乐透对应 1 组 / 66 组全买）。
 *       每期用真实开奖号结算奖金，累加得到"回收率"。
 * 蓝球未按当期预测：买 1 个蓝球时，命中真蓝球的注数按 1/16 计期望（客观随机）。
 * 浮动奖只能估价：默认一等 500 万/注、二等 15 万/注（实际会因中奖注数被平分，可能更低）。
 */
const fs = require('fs'), path = require('path');
const V = require(path.join(__dirname, '..', 'vmax.js'));
const ROOT = path.join(__dirname, '..');

function arg(k, d) { const m = new RegExp('--' + k + '=([^\\s]+)').exec(process.argv.join(' ')); return m ? m[1] : d; }
function comb(n, k) { if (k < 0 || k > n) return 0; k = Math.min(k, n - k); let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }

const MODE = arg('mode', 'ABC');
const RAND = arg('random', '0') === '1';   // 用同尺寸随机池做对照（检验回收率是不是算法带来的）
const FIRST = Number(arg('first', 500)) * 1e4;
const SECOND = Number(arg('second', 15)) * 1e4;
const SSQ_RED_MAX = 20;      // 双色球红球复式上限 20 个（辽宁福彩：红球 7~20 个、蓝球 2~16 个）
const DLT_CARD_CAP = 20000;  // 大乐透单张基本投注金额上限（元）

/* 奖级金额：双色球 [红球命中数][蓝球是否命中] */
function ssqMoney(j, blueHit) {
  if (j === 6) return blueHit ? FIRST : SECOND;
  if (j === 5) return blueHit ? 3000 : 200;
  if (j === 4) return blueHit ? 200 : 10;
  if (j === 3) return blueHit ? 10 : 0;
  return blueHit ? 5 : 0;
}
/* 大乐透 [前区命中 j][后区命中 c] —— 官方七奖级 */
function dltMoney(j, c) {
  return { 5: [5000, SECOND, FIRST], 4: [150, 300, 5000], 3: [5, 15, 150],
           2: [0, 5, 15], 1: [0, 0, 5], 0: [0, 0, 5] }[j][c];
}
/* 随机单注返奖率自检（用来确认奖级表没抄错） */
function selfCheck() {
  const p6 = j => comb(6, j) * comb(27, 6 - j) / comb(33, 6);
  const p5 = j => comb(5, j) * comb(30, 5 - j) / comb(35, 5);
  const wb = c => comb(2, c) * comb(10, 2 - c) / 66;
  let a = 0, b = 0;
  for (let j = 0; j <= 6; j++) a += p6(j) * (ssqMoney(j, 1) / 16 + ssqMoney(j, 0) * 15 / 16);
  for (let j = 0; j <= 5; j++) for (let c = 0; c <= 2; c++) b += p5(j) * wb(c) * dltMoney(j, c);
  console.log('自检：随机单注期望奖金 双色球 ' + a.toFixed(3) + ' 元（返奖率 ' + (a / 2 * 100).toFixed(1) +
    '%）、大乐透 ' + b.toFixed(3) + ' 元（' + (b / 2 * 100).toFixed(1) + '%）　官方口径约 49%~51%\n');
}

/* 一个前区组合在不同蓝球打法下的注数与[命中蓝球注数, 未命中注数] */
function blueSplit(game, blue) {
  const total = game === 'ssq' ? 16 : 66;
  if (game === 'ssq') return blue >= 16 ? [1, 15, 16] : [blue / 16, blue - blue / 16, blue];
  return [blue / 66, 0, blue];                 // 大乐透按后区命中分布单独算，见 gameMoney
}
function dltBackDist(blue) {                   // 买 blue 组后区时，命中 c 个的期望注数
  const out = [];
  for (let c = 0; c <= 2; c++) out[c] = blue * comb(2, c) * comb(10, 2 - c) / 66;
  return out;
}

const q = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

function run(game, blue) {
  const g = V.GAMES[game], K = g.numPick, key = g.frontKey;
  const hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', game + '.json'), 'utf8')).data;
  const s = { 有池期: 0, 能成票期: 0, 超上限期: 0, 成本: 0, 奖金: 0, 浮动: 0, 注数: 0,
    一等: 0, 二等: 0, 无奖期: 0, 最长无奖: 0, run: 0, costs: [], 池: [], 最深浮亏: 0, walk: 0 };

  for (let i = 1; i < hist.length; i++) {
    let poolArr;
    if (RAND) {
      const size = V.poolOf(hist[i - 1], game, MODE).pool.length;      // 池大小分布与算法完全一致
      const all = []; for (let x = 1; x <= g.numMax; x++) all.push(x);
      poolArr = [];
      for (let t = 0; t < size && all.length; t++) poolArr.push(all.splice(Math.floor(Math.random() * all.length), 1)[0]);
    } else poolArr = V.poolOf(hist[i - 1], game, MODE).pool;
    const res = { pool: poolArr };
    const u = res.pool.length;
    if (u < K) continue;
    s.有池期++; s.池.push(u);
    const reds = game === 'ssq' ? Math.min(u, SSQ_RED_MAX) : u;
    if (reds < K) continue;
    const frontCombos = comb(reds, K);
    const per = game === 'ssq' ? blue : blue;
    const tickets = frontCombos * per;
    s.能成票期++;
    const cost = tickets * 2;
    s.成本 += cost; s.costs.push(cost); s.注数 += tickets;
    if (game === 'ssq' ? u > SSQ_RED_MAX : cost > DLT_CARD_CAP) s.超上限期++;

    const act = hist[i][key], seen = {};
    res.pool.forEach(x => seen[x] = 1);
    const k = act.filter(x => seen[x]).length;

    let win = 0, fl = 0, one = 0, two = 0;
    /* 池大于单票上限时：从 u 个池号里能上的只有 reds 个，等价于从池中随机取 6(或5) 个，
       因此"恰好命中 j 个"的期望注数 = 票数 × C(k,j)C(u-k,K-j)/C(u,K)（两步抽样 = 一步抽样，精确成立） */
    const frontTickets = comb(reds, K);
    for (let j = 0; j <= Math.min(K, k); j++) {
      const cnt = frontTickets * comb(k, j) * comb(u - k, K - j) / comb(u, K);
      if (!cnt) continue;
      if (game === 'ssq') {
        const [hit, miss] = blueSplit('ssq', blue);
        win += cnt * (hit * ssqMoney(j, 1) + miss * ssqMoney(j, 0));
        if (j === 6) { one += cnt * hit; two += cnt * miss; fl += cnt * (hit * FIRST + miss * SECOND); }
      } else {
        const dist = dltBackDist(blue);
        for (let c = 0; c <= 2; c++) {
          const n = cnt * dist[c];
          win += n * dltMoney(j, c);
          if (j === 5 && c === 2) { one += n; fl += n * FIRST; }
          if (j === 5 && c === 1) { two += n; fl += n * SECOND; }
        }
      }
    }
    s.奖金 += win; s.浮动 += fl; s.一等 += one; s.二等 += two;
    s.run = win > 0 ? 0 : s.run + 1; s.最长无奖 = Math.max(s.最长无奖, s.run);
    if (win === 0) s.无奖期++;
    s.walk += win - cost; s.最深浮亏 = Math.min(s.最深浮亏, s.walk);
  }
  s.costs.sort((a, b) => a - b);
  return s;
}

function show(game, label, blue) {
  const s = run(game, blue);
  const yi = x => (x / 1e8).toFixed(2);
  console.log('\n【' + label + '】');
  console.log('  可投期数 ' + s.能成票期 + ' 期，其中 ' + s.超上限期 + ' 期超过单票规则上限（要拆成多张票或先缩池）');
  console.log('  单期注数：中位 ' + Math.round(q(s.costs, .5) / 2).toLocaleString() + ' 注 · 单期金额：中位 ' +
    Math.round(q(s.costs, .5)).toLocaleString() + ' 元 / 平均 ' + Math.round(s.成本 / s.能成票期).toLocaleString() +
    ' 元 / 最贵 ' + Math.round(s.costs[s.costs.length - 1]).toLocaleString() + ' 元');
  console.log('  一年（' + 154 + ' 期）按平均额买：' + Math.round(s.成本 / s.能成票期 * 154 / 1e4).toLocaleString() + ' 万元');
  console.log('  全历史：投入 ' + yi(s.成本) + ' 亿 · 奖金 ' + yi(s.奖金) + ' 亿（浮动奖占 ' + yi(s.浮动) +
    ' 亿）· 净 ' + (s.奖金 - s.成本 >= 0 ? '+' : '-') + yi(Math.abs(s.奖金 - s.成本)) + ' 亿');
  console.log('  回收率 ' + (s.奖金 / s.成本 * 100).toFixed(1) + '%　累计最深浮亏 ' + yi(-s.最深浮亏) + ' 亿');
  console.log('  一等奖注数 ' + Math.round(s.一等) + '　二等奖注数 ' + Math.round(s.二等) +
    '　颗粒无收期 ' + (s.无奖期 / s.能成票期 * 100).toFixed(1) + '%　最长连续不中 ' + s.最长无奖 + ' 期');
}

selfCheck();
const hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ssq.json'), 'utf8')).data;
const sizes = [];
for (let i = 1; i < hist.length; i++) sizes.push(V.poolOf(hist[i - 1], 'ssq', MODE).pool.length);
console.log((RAND ? '【对照组】同尺寸随机池' : '算法池') + '　取号模式 ' + MODE + '　浮动估价：一等 ' + FIRST / 1e4 + ' 万/注、二等 ' + SECOND / 1e4 + ' 万/注');
console.log('双色球红球池：中位 ' + q(sizes, .5) + ' 码、平均 ' + (sizes.reduce((a, b) => a + b) / sizes.length).toFixed(1) +
  ' 码、最大 ' + Math.max(...sizes) + ' 码；超过 20 码（红球复式上限）的期数 ' + sizes.filter(x => x > 20).length +
  ' / ' + sizes.length + '（' + (sizes.filter(x => x > 20).length / sizes.length * 100).toFixed(1) + '%）');
console.log('  参考：15 码=C(15,6)=' + comb(15, 6).toLocaleString() + ' 注=' + (comb(15, 6) * 2).toLocaleString() +
  ' 元；17 码=' + comb(17, 6).toLocaleString() + ' 注=' + (comb(17, 6) * 2).toLocaleString() +
  ' 元；20 码=' + comb(20, 6).toLocaleString() + ' 注=' + (comb(20, 6) * 2).toLocaleString() + ' 元');
show('ssq', '双色球 · 红球池全包 + 蓝球 1 个', 1);
show('ssq', '双色球 · 红球池全包 + 蓝球全包 16 个', 16);

const dh = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/dlt.json'), 'utf8')).data;
const ds = [];
for (let i = 1; i < dh.length; i++) ds.push(V.poolOf(dh[i - 1], 'dlt', MODE).pool.length);
console.log('\n大乐透前区池：中位 ' + q(ds, .5) + ' 码、平均 ' + (ds.reduce((a, b) => a + b) / ds.length).toFixed(1) +
  ' 码、最大 ' + Math.max(...ds) + ' 码');
show('dlt', '大乐透 · 前区池全包 + 后区 1 组', 1);
show('dlt', '大乐透 · 前区池全包 + 后区全包 66 组', 66);
function breakeven(game, blue) {
  const s = run(game, blue);
  const fixed = s.奖金 - s.浮动;
  const n1 = s.一等, n2 = s.二等;
  if (!n1) return null;
  const need = (s.成本 - fixed - n2 * SECOND) / n1;
  return { 一等注数: n1, 需要每注: need };
}
console.log('');
[['双色球·蓝全包16', 'ssq', 16], ['双色球·蓝1个', 'ssq', 1], ['大乐透·后区全包', 'dlt', 66], ['大乐透·后区1组', 'dlt', 1]].forEach(function (x) {
  const b = breakeven(x[1], x[2]);
  if (b) console.log('回本临界点　' + x[0] + '：历史一等奖 ' + Math.round(b.一等注数) + ' 注，'
    + '需要一等奖平均每注 ' + Math.round(b.需要每注 / 1e4).toLocaleString() + ' 万元/注 才能不亏（而一/二等奖是当期所有中奖注均分的浮动奖，并设单注上限，实际到不了这个数）');
});
console.log('\n这组数字回答"买满要多少钱、能回多少"；判断算法有没有预测力，看页面里的随机对照与安慰剂列。\n');
