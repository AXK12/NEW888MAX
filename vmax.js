/* vmax.js —— VMAX 内核（浏览器页面与命令行回测共用同一份实现）
 *
 * 只保留 4 种取号模式，其它过滤条件与开关已全部删除：
 *   A    方法A（书上 11 规则）
 *   B    方法B（Q-R 算术引擎）
 *   AB   方法A ∩ 方法B
 *   ABC  方法A ∩ 方法B ∩ 密码集萃   ← 「第三种引擎开 / 关」就是 AB ↔ ABC
 *
 * 命中口径（一句话）：用 T-1 期开出的号码算出号码池，数 T 期开出的 6 个红球
 * （大乐透为 5 个前区）里有几个落在池内，即为"本期命中 6 / 5 / 4 红"。
 *
 * 「随机对照」不是装饰：号码池越大，命中数自然越高。该列按每期真实池均算
 * "纯随机抓同样多个号能命中的期望期数"，两者接近就说明涨的是池子不是本事。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.VMAX = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  var GAMES = {
    ssq: { name: '双色球', numMax: 33, numPick: 6, backMax: 16, backPick: 1,
           frontKey: 'reds', backKey: 'blue', ball: '红', tiers: [6, 5, 4],
           file: 'data/ssq.json',
           prize: [[4, 10, '六等奖：中蓝球'], [5, 200, '五等奖：4 红 / 3 红+蓝'], [6, 200, '四等奖：5 红 / 4 红+蓝']],
           note: '六奖级；三等 5红+蓝=3000，二等 6红=浮动，一等 6红+蓝=浮动' },
    dlt: { name: '大乐透', numMax: 35, numPick: 5, backMax: 12, backPick: 2,
           frontKey: 'fronts', backKey: 'backs', ball: '前区', tiers: [5, 4, 3],
           file: 'data/dlt.json',
           prize: [[3, 5, '七等奖：3 前区 或 2前+2后'], [4, 150, '五等奖：4 前区 或 3前+2后'], [5, 5000, '三等奖：5 前区 或 4前+2后']],
           note: '官方规则第十五条：共七个奖级；奖池≥8亿时三至七等奖上浮（6666/380/200/18/7）' }
  };
  var MODES = ['A', 'B', 'AB', 'ABC'];
  var MODE_NAME = { A: '方法A', B: '方法B', AB: '方法A ∩ 方法B', ABC: '方法A ∩ 方法B ∩ 密码集萃' };

  /* ================= 取号 ================= */
  function calcPage(divisor, nums) {                 // 带余除法 + 可比数 cp = num - r + q
    return nums.map(function (n, i) {
      if (!n) return { idx: i, num: n, q: 0, r: 0, cp: null };
      var q = Math.floor(divisor / n), r = divisor % n;
      return { idx: i, num: n, q: q, r: r, cp: n - r + q };
    });
  }
  function collisions(rows) {                         // cp 相同 = 撞车
    var m = {};
    rows.forEach(function (it) { if (it.cp !== null) (m[it.cp] = m[it.cp] || []).push(it); });
    return Object.keys(m).filter(function (cp) { return m[cp].length >= 2; })
      .map(function (cp) { return { cp: +cp, entries: m[cp] }; });
  }
  function deriveA(en, max) {                         // 方法A：书上11规则
    var o = {}, q = en.map(function (e) { return e.q; }), r = en.map(function (e) { return e.r; }), cp = en[0].cp;
    function add(v) { if (v >= 1 && v <= max) o[Math.round(v)] = 1; }
    for (var i = 0; i < q.length; i++) for (var j = i + 1; j < q.length; j++) {
      add(q[i] + q[j]); add(Math.abs(q[i] - q[j])); add(r[i] + r[j]); add(Math.abs(r[i] - r[j]));                 // 规则1
      var qq = q[i] + q[j], rr = r[i] + r[j];
      add(qq + rr); add(Math.abs(qq - rr)); add(qq + rr - cp);
      add(Math.abs(qq + rr + cp) <= max ? qq + rr + cp : Math.abs(qq + rr - cp));   // 规则2:复合（原实现的三元式）
      add(q[i] + r[j]); add(Math.abs(q[i] - r[j])); add(r[i] + q[j]); add(Math.abs(r[i] - q[j]));                  // 交叉
      if (q[i] === r[j] && r[i] === q[j]) { var c = q[i], d = q[j]; add(c); add(d); add(c + d); add(Math.abs(c - d)); }  // 规则3
    }
    add(cp);                                                                                                      // 可比数本身
    en.forEach(function (e) {                                                                                     // 规则4
      if (e.q === e.r) { add(e.num); add(e.q); add(e.q + e.q); add(e.num + e.q); add(Math.abs(e.num - e.q)); }
    });
    if (r.every(function (x) { return x === 0; })) q.forEach(add);                                                // 规则7
    var sq = q.reduce(function (a, b) { return a + b; }, 0), sr = r.reduce(function (a, b) { return a + b; }, 0);
    add(sq); add(sr); add(sq + sr); add(Math.abs(sq - sr)); add(sq + sr - cp);
    return Object.keys(o).map(Number);
  }
  function deriveB(en, max) {                          // 方法B：Q-R 算术引擎
    var o = {}, q = en.map(function (e) { return e.q; }), r = en.map(function (e) { return e.r; }), cp = en[0].cp;
    function add(v) { if (v >= 1 && v <= max) o[Math.round(v)] = 1; }
    for (var i = 0; i < q.length; i++) for (var j = i + 1; j < q.length; j++) {
      add(q[i] + q[j]); add(Math.abs(q[i] - q[j])); add(r[i] + r[j]); add(Math.abs(r[i] - r[j]));
      var s = q[i] + q[j], d = r[i] + r[j];
      add(s + d); add(Math.abs(s - d)); add(s + d - r[0]);
      add(q[i] + r[j]); add(Math.abs(q[i] - r[j])); add(r[i] + q[j]); add(Math.abs(r[i] - q[j]));
    }
    if (r.every(function (x) { return x === 0; })) q.forEach(add);
    add(cp);
    var sum = q.reduce(function (a, b) { return a + b; }, 0) + r.reduce(function (a, b) { return a + b; }, 0);
    add(sum - cp); add(sum + cp);
    return Object.keys(o).map(Number);
  }
  function deriveCipher(F, B, max, game) {              // 第三种引擎：密码集萃（和 / 差 / 模积 + 彩种专属）
    var o = {};
    function add(v) { if (v >= 1 && v <= max) o[v] = 1; }
    for (var i = 0; i < F.length; i++) for (var j = i + 1; j < F.length; j++) {
      add(F[i] + F[j]); add(F[j] - F[i]);   // 原实现不取绝对值：负差自然被范围过滤掉
      var m = (F[i] * F[j]) % max; add(m === 0 ? max : m);
    }
    if (game === 'ssq') { if (B.length) add(Math.min(2 * B[0], max)); }
    else for (var k = 0; k < F.length; k++) if (F[k] !== 1) o[F[k]] = 1;
    return Object.keys(o).map(Number).sort(function (a, b) { return a - b; });
  }
  function uniq(a) { var s = {}, o = []; a.forEach(function (n) { if (!s[n]) { s[n] = 1; o.push(n); } }); return o; }
  function and(x, y) { var s = {}; y.forEach(function (n) { s[n] = 1; }); return x.filter(function (n) { return s[n]; }); }

  /* 号码池：除数页 = 总和页 + 每个号码的"减 X 页"；双色球只用红球切片撞车 */
  function poolOf(prev, game, mode) {
    var g = GAMES[game];
    var F = prev[g.frontKey].slice();
    var B = game === 'ssq' ? [prev[g.backKey]] : prev[g.backKey].slice();
    var all = F.concat(B), FL = F.length;                   // 前区 = all 的前 FL 个位置（与原页面 slice 等价）
    var total = all.reduce(function (a, b) { return a + b; }, 0);
    var divisors = [total];
    F.forEach(function (f) { divisors.push(total - f); });
    if (game === 'dlt') B.forEach(function (b) { divisors.push(total - b); });
    var A = {}, Bk = {};
    divisors.forEach(function (div) {
      collisions(calcPage(div, all)).forEach(function (c) {
        var en = c.entries.filter(function (e) { return e.idx < FL; });     // 只取前区位置，蓝/后区同号不会误入
        if (en.length < 2) return;
        deriveA(en, g.numMax).forEach(function (n) { A[n] = 1; });
        deriveB(en, g.numMax).forEach(function (n) { Bk[n] = 1; });
      });
    });
    // —— 首页（总和页）专属三规则，仅作用于方法A，与原页面一致 ——
    var homeFront = calcPage(total, all).filter(function (e) { return e.idx < FL; });   // 先切片再撞车
    var homeColl = collisions(homeFront);
    if (homeColl.length > 0) {
      homeColl.forEach(function (col) {                                                  // 规则5
        col.entries.forEach(function (e) { if (e.q === col.cp) A[col.cp] = 1; });
      });
      var qrMap = {};                                                                    // 规则8
      homeFront.forEach(function (e) { var k = e.q + e.r; (qrMap[k] = qrMap[k] || []).push(e); });
      Object.keys(qrMap).forEach(function (k) { if (qrMap[k].length >= 2 && +k >= 1 && +k <= g.numMax) A[k] = 1; });
      var sumR = homeFront.reduce(function (acc, e) { return acc + e.r; }, 0);            // 规则11
      if (sumR >= 1 && sumR <= g.numMax) A[sumR] = 1;
    }
    var a = Object.keys(A).map(Number).sort(function (x, y) { return x - y; });
    var b = Object.keys(Bk).map(Number).sort(function (x, y) { return x - y; });
    var c = deriveCipher(F, B, g.numMax, game);
    if (mode === 'A')  return { pool: uniq(a),  on: a.length > 0, detail: { A: a, B: b, cipher: c } };
    if (mode === 'B')  return { pool: uniq(b),  on: b.length > 0, detail: { A: a, B: b, cipher: c } };
    if (mode === 'AB') return { pool: uniq(and(a, b)), on: a.length > 0 && b.length > 0, detail: { A: a, B: b, cipher: c } };
    return { pool: uniq(and(and(a, b), c)), on: a.length > 0 && b.length > 0, detail: { A: a, B: b, cipher: c } };
  }

  /* ================= 随机对照 ================= */
  function comb(n, k) { if (k < 0 || k > n) return 0; k = Math.min(k, n - k); var r = 1; for (var i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }
  var _cache = {};
  // 池均 u、抓 K 个号、号码域 N：纯随机至少覆盖 t 个的概率（逐期按当期真实 u 算，池均方差大时不能用平均池均折算）
  function randProb(N, K, u, t) {           // 恰好覆盖 t 个的概率
    if (u - t < 0 || u - t > N - K) return 0;
    return comb(K, t) * comb(N - K, u - t) / comb(N, u);
  }
  function randAtLeast(N, K, u, t) {
    if (u <= 0) return t <= 0 ? 1 : 0;
    var key = N + ':' + K + ':' + u + ':' + t;
    if (_cache[key] !== undefined) return _cache[key];
    var lo = 0;
    for (var h = 0; h < t; h++) {
      if (u - h >= 0 && u - h <= N - K) lo += comb(K, h) * comb(N - K, u - h) / comb(N, u);
    }
    return (_cache[key] = Math.max(0, Math.min(1, 1 - lo)));
  }

  /* ================= 回测 ================= */
  // history: 升序开奖数组；sample: 只回测最近 N 期（缺省全量）
  function backtest(history, game, mode, sample) {
    var g = GAMES[game], N = g.numMax, K = g.numPick;
    var start = sample ? Math.max(1, history.length - sample) : 1;
    var n = 0, on = 0, poolSum = 0, hitSum = 0;
    var realTier = {}, randTier = {};
    for (var t = 0; t <= K; t++) { realTier[t] = 0; randTier[t] = 0; }
    for (var i = start; i < history.length; i++) {
      var res = poolOf(history[i - 1], game, mode);
      var u = res.pool.length, act = history[i][g.frontKey], seen = {};
      res.pool.forEach(function (x) { seen[x] = 1; });
      var h = act.filter(function (x) { return seen[x]; }).length;
      realTier[h]++;
      for (var t2 = 0; t2 <= K; t2++) randTier[t2] += randAtLeast(N, K, u, t2) - (t2 < K ? randAtLeast(N, K, u, t2 + 1) : 0);
      poolSum += u; hitSum += h; n++; if (res.on) on++;
    }
    var rows = g.tiers.map(function (t) {                 // 命中"恰好 t 个"与"至少 t 个"
      var exactR = realTier[t] || 0, geR = 0;
      for (var x = t; x <= K; x++) geR += (realTier[x] || 0);
      var geRand = 0;
      for (var y = t; y <= K; y++) geRand += (randTier[y] || 0);
      return {
        档: t + g.ball, 恰好次数: exactR, 恰好百分比: exactR / n * 100,
        至少次数: geR, 至少百分比: geR / n * 100,
        随机至少: geRand, 随机至少百分比: geRand / n * 100,
        倍数: geRand > 0 ? geR / geRand : 0
      };
    });
    var avgPool = poolSum / n;
    return { 彩种: g.name, 模式: mode, 模式名: MODE_NAME[mode], 回测期数: n,
             有池期数: on, 无池期数: n - on,
             池均: avgPool, 每期平均命中: hitSum / n,
             命中随机: avgPool * K / N, 命中期望_随机: avgPool * K / N,
             rows: rows };
  }

  /* 安慰剂对照：算法照跑，但把"哪期对上哪期开奖"随机打乱，看结果是否还一样 */
  function placebo(history, game, mode, rounds, sample) {
    rounds = rounds || 5;
    var acc = [], t0 = (GAMES[game].tiers || [])[0];
    for (var r = 0; r < rounds; r++) {
      // 必须深拷贝：history.slice() 只复制一层，直接交换 h2[i].reds 会把原始数据本身打乱，
      // 之后的正常回测就会跑在被污染的数据上（表现为切换模式数字越切越偏）
      var tf = GAMES[game].frontKey, bf = GAMES[game].backKey;
      var h2 = history.map(function (d) {
        var c = {}; for (var k in d) c[k] = Array.isArray(d[k]) ? d[k].slice() : d[k];
        return c;
      });
      for (var i = h2.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t1 = h2[i][tf]; h2[i][tf] = h2[j][tf]; h2[j][tf] = t1;
        var o1 = h2[i][bf]; h2[i][bf] = h2[j][bf]; h2[j][bf] = o1;
      }
      acc.push(backtest(h2, game, mode, sample));
    }
    var avg = function (f) { return acc.reduce(function (a, b) { return a + f(b); }, 0) / acc.length; };
    return { 平均命中: avg(function (x) { return x.每期平均命中; }), 命中随机: avg(function (x) { return x.命中随机; }),
             池均: avg(function (x) { return x.池均; }),
             至少命中: Math.round(avg(function (x) { return x.rows[0].至少次数; })),
             随机至少: avg(function (x) { return x.rows[0].随机至少; }),
             期数: acc[0].回测期数, 轮次: rounds, 档: t0 + GAMES[game].ball };
  }

  /* ================= 全包预算器（按"每期把号码池全买 + 蓝球全买"的买法算账） ================= */
  // 官方奖级金额：双色球六档；大乐透七档（三等奖 5000 元）。一/二等奖为均分浮动奖，只能估价。
  function money(game, j, b, est) {
    if (game === 'ssq') {
      if (j === 6) return b ? est.first : est.second;
      if (j === 5) return b ? 3000 : 200;
      if (j === 4) return b ? 200 : 10;
      if (j === 3) return b ? 10 : 0;
      return b ? 5 : 0;
    }
    return { 5: [5000, est.second, est.first], 4: [150, 300, 5000], 3: [5, 15, 150],
             2: [0, 5, 15], 1: [0, 0, 5], 0: [0, 0, 5] }[j][b];
  }
  /** 随机单注的期望奖金（超几何 × 官方奖级）——所有买法的公共基准 */
  function evPerTicket(game, est) {
    var K = game === 'ssq' ? 6 : 5, N = game === 'ssq' ? 33 : 35, tot = comb(N, K), e = 0;
    for (var j = 0; j <= K; j++) {
      var pj = comb(K, j) * comb(N - K, K - j) / tot;
      if (game === 'ssq') e += pj * ((1 / 16) * money(game, j, 1, est) + (15 / 16) * money(game, j, 0, est));
      else {
        for (var c = 0; c <= 2; c++) e += pj * (comb(2, c) * comb(10, 2 - c) / 66) * money(game, j, c, est);
      }
    }
    return e;
  }
  /**
   * 池全买的账（可证的线性性）：期望奖金 = 注数 × 单注期望，与池子怎么选号无关。
   * 池的作用只体现在"中大奖的次数分布"：一等奖期望次数 = 红球组合数 × 池含全部开奖号的概率。
   */
  function compoundEV(game, u, blue, est) {
    var K = game === 'ssq' ? 6 : 5, N = game === 'ssq' ? 33 : 35;
    var frontCombos = comb(u, K);
    var tickets = frontCombos * blue, cost = tickets * 2;
    // 池含全部 K 个开奖号的概率 = C(N-K, u-K)/C(N,u)；再乘蓝球/后区押中比例
    var pCover = u >= K ? comb(N - K, u - K) / comb(N, u) : 0;
    var evFirst = pCover * (game === 'ssq' ? blue / 16 : blue / 66);
    return { 池码数: u, 蓝球或后区数: blue, 注数: tickets, 成本: cost,
      单注期望: evPerTicket(game, est), 期望奖金: tickets * evPerTicket(game, est),
      期望回收率: evPerTicket(game, est) / 2, 一期一等奖期望次数: evFirst,
      每期中头奖概率: evFirst, 池全覆盖概率: pCover };
  }
  /** 逐期重放：把历史每期的池真买一遍，按当期真实结果结钱（浮奖按估价计） */
  function compoundReplay(hist, game, mode, blue, est, cap) {
    var K = game === 'ssq' ? 6 : 5, key = (game === 'ssq' ? 'reds' : 'fronts');
    var n = 0, cost = 0, win = 0, first = 0, second = 0, cover = 0, cut = 0, deep = 0, walk = 0, dry = 0, maxDry = 0;
    for (var i = 1; i < hist.length; i++) {
      var pool = poolOf(hist[i - 1], game, mode).pool;
      if (pool.length < K) continue;
      if (cap && pool.length > cap) { pool = pool.slice(0, cap); cut++; }
      var u = pool.length, act = hist[i][key], seen = {};
      pool.forEach(function (x) { seen[x] = 1; });
      var k = act.filter(function (x) { return seen[x]; }).length;
      var tickets = comb(u, K) * blue, c = tickets * 2, w = 0, bh;
      if (game === 'ssq') bh = (blue >= 16) ? 1 : (hist[i].blue === hist[i - 1].blue ? 1 : 0);
      else bh = (blue >= 66) ? 2 : hist[i].backs.filter(function (x) { return hist[i - 1].backs.indexOf(x) >= 0; }).length;
      for (var j = 0; j <= Math.min(K, k); j++) {
        var cnt = comb(k, j) * comb(u - k, K - j);
        if (!cnt) continue;
        w += cnt * money(game, j, bh, est);
        if (game === 'ssq' ? (j === 6 && bh === 1) : (j === 5 && bh === 2)) first += cnt;
        else if (game === 'ssq' ? (j === 6) : (j === 5 && bh === 1)) second += cnt;
      }
      if (k === K) cover++;
      n++; cost += c; win += w; walk += w - c; deep = Math.min(deep, walk);
      dry = w > 0 ? 0 : dry + 1; maxDry = Math.max(maxDry, dry);
    }
    return { 期数: n, 被截断期数: cut, 总成本: cost, 总奖金: win, 净: win - cost,
      回收率: cost ? win / cost : 0, 每期均成本: n ? cost / n : 0, 一等奖注数: first, 二等奖注数: second,
      池全覆盖期数: cover, 最深浮亏: -deep, 最长空窗: maxDry };
  }

  return { GAMES: GAMES, MODES: MODES, MODE_NAME: MODE_NAME,
           poolOf: poolOf, backtest: backtest, placebo: placebo, randAtLeast: randAtLeast, comb: comb,
           money: money, compoundEV: compoundEV, compoundReplay: compoundReplay, evPerTicket: evPerTicket };
}));
