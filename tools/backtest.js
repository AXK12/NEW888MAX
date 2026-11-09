#!/usr/bin/env node
/* tools/backtest.js —— 命令行复现页面里的回测表（与浏览器共用 vmax.js，结果必然一致）
 *
 *   node tools/backtest.js                 # 两个彩种、四种模式，全历史
 *   node tools/backtest.js --game=ssq      # 只看双色球
 *   node tools/backtest.js --last=365      # 只看最近 365 期（样本外检查）
 *   node tools/backtest.js --placebo=9     # 追加 9 轮打乱开奖顺序的安慰剂对照
 */
const fs = require('fs');
const path = require('path');
const V = require(path.join(__dirname, '..', 'vmax.js'));

const args = {};
process.argv.slice(2).forEach(function (a) {
  var m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});
const ROOT = path.join(__dirname, '..');
const games = args.game ? String(args.game).split(',') : ['ssq', 'dlt'];
const last = args.last ? parseInt(args.last, 10) : 0;
const pad = function (s, n) { return String(s) + ' '.repeat(Math.max(0, n - String(s).length)); };
const padL = function (s, n) { return ' '.repeat(Math.max(0, n - String(s).length)) + String(s); };

console.log('\nVMAX 回测　口径：用 T-1 期号码算池，统计池覆盖 T 期开奖号码的个数（4 个以下不计）\n');

games.forEach(function (g) {
  var file = path.join(ROOT, 'data', g + '.json');
  if (!fs.existsSync(file)) { console.log('缺少 ' + file); return; }
  var data = JSON.parse(fs.readFileSync(file, 'utf8')).data;
  var meta = V.GAMES[g];
  var use = last ? data.slice(Math.max(0, data.length - last - 1)) : data;
  console.log('== ' + meta.name + '　' + data.length + ' 期（' + data[0].period + ' ~ ' + data[data.length - 1].period + '）'
    + (last ? '　本次取最近 ' + (use.length - 1) + ' 期' : '') + ' ==');
  console.log(pad('模式', 20) + padL('池均', 7) + padL('平均命中', 9) + padL('随机期望', 9)
    + meta.tiers.map(function (t) { return padL('≥' + t + meta.ball, 16); }).join(''));

  V.MODES.forEach(function (m) {
    var r = V.backtest(use, g, m, 0);
    console.log(pad(r.模式名, 20) + padL(r.池均.toFixed(1), 7) + padL(r.每期平均命中.toFixed(2), 9)
      + padL(r.命中期望_随机.toFixed(2), 9)
      + r.rows.map(function (x) {
          return padL(x.至少次数 + '期/' + x.至少百分比.toFixed(1) + '%', 16);
        }).join(''));
  });

  if (last) {   // 号码池里恰好命中的分布，便于看"恰好"口径
    V.MODES.forEach(function (m) {
      var r = V.backtest(use, g, m, 0);
      console.log('   ' + m + ' 恰好分布: ' + Object.keys(r.分布).sort(function (a, b) { return b - a; })
        .map(function (k) { return k + '个:' + r.分布[k]; }).join('  '));
    });
  }

  if (args.placebo) {
    var rounds = parseInt(args.placebo, 10) || 5;
    console.log('   -- 安慰剂对照（打乱开奖号码的时间顺序 ' + rounds + ' 轮）--');
    V.MODES.forEach(function (m) {
      var p = V.placebo(use, g, m, rounds, last || use.length);
      console.log('   ' + pad(m, 4) + '命中' + p.档 + ' 实测 '
        + padL(V.backtest(use, g, m, 0).rows[0].至少次数, 5) + ' 期　vs 安慰剂 '
        + padL(p.至少命中, 5) + ' 期　（平均命中 ' + V.backtest(use, g, m, 0).每期平均命中.toFixed(2)
        + ' vs ' + p.平均命中.toFixed(2) + '）');
    });
  }

  console.log('   数据快照 updated_at: '
    + JSON.parse(fs.readFileSync(file, 'utf8')).updated_at + '　最新期: '
    + data[data.length - 1].period + ' ' + data[data.length - 1].date + '\n');
});

console.log('说明：随机期望=每期按当期真实池均算的超几何期望。实测与随机期望贴合，即说明命中数由池子大小决定。\n');
