// equivalence.js —— 证明 VMAX 的四种取号模式与原 pro.html 逐期输出完全一致
// 用法：
//   node tests/equivalence.js                       # 假定同级目录有 pro.html
//   node tests/equivalence.js ../axk8899880/pro.html # 指定原页面位置
const fs = require('fs'), path = require('path');
const V = require('../vmax.js');
const ref = process.argv[2] || path.join(__dirname, '..', 'pro.html');
if (!fs.existsSync(ref)) {
  console.log('跳过：未找到 pro.html。等价校验需要原页面文件：node tests/equivalence.js <pro.html 路径>');
  process.exit(0);
}
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} };
global.window = global;
let src = fs.readFileSync(ref, 'utf8').replace(/\r\n/g, '\n').match(/<script>([\s\S]*)<\/script>/)[1];
src = src.slice(0, src.indexOf('// ==================== UI HELPERS'))
          .replace('setTimeout(preloadHistoricalData, 500);', '');
(0, eval)(src + ';global.OLD = predict;');

const ROOT = path.join(__dirname, '..');
const data = {};
['ssq', 'dlt'].forEach(function (g) {
  data[g] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', g + '.json'), 'utf8')).data;
});
global.CACHED_SSQ = data.ssq; global.CACHED_DLT = data.dlt;
(0, eval)('buildHistoricalFrontSets();');

const S = function (a) { return [...new Set(a)].sort(function (x, y) { return x - y; }); };
const MAP = { A: 'front_a', B: 'front_b', ABS: 'front_consensus', ABC: 'front_consensus_3' };
MAP.AB = MAP.ABS;
const N = Number(process.env.N || 250);
let diffs = 0, ok = 0;

['ssq', 'dlt'].forEach(function (g) {
  const h = data[g];
  V.MODES.forEach(function (m) {
    let bad = 0;
    for (let i = Math.max(1, h.length - N); i < h.length; i++) {
      const prev = h[i - 1];
      const old = OLD(prev[g === 'ssq' ? 'reds' : 'fronts'],
        g === 'ssq' ? [prev.blue] : prev.backs, g === 'ssq',
        g === 'ssq' && i > 1 ? h[i - 2].blue : null);
      const mine = V.poolOf(prev, g, m).pool;
      if (JSON.stringify(S(old[MAP[m]])) !== JSON.stringify(S(mine))) bad++;
    }
    console.log((bad ? '✗ ' : '✓ ') + g + ' 模式 ' + m + '：' + N + ' 期' + (bad ? ' 不一致 ' + bad + ' 期' : ' 完全一致'));
    diffs += bad; if (!bad) ok++;
  });
});
console.log('\n' + (diffs === 0 ? '✓ ' + ok + '/8 模式与原页面完全等价' : '✗ 共 ' + diffs + ' 期不一致，VMAX 与原算法已偏离'));
process.exit(diffs === 0 ? 0 : 1);
