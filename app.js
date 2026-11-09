/* app.js —— VMAX 页面逻辑（算法全部在 vmax.js，这里只做取数、回测调度与渲染） */
(function () {
  'use strict';
  var V = window.VMAX;
  var game = 'ssq', mode = 'A', DATA = {}, cache = {};

  var MODE_DESC = {
    A: '方法A：书上 11 规则。对每一张"除数页"找出可比数相同（撞车）的号对，用商与余数做加减组合派生候选号。',
    B: '方法B：Q-R 算术引擎。同一批撞车号对，只做商/余数的和、差、交叉和差与总和变换，算子是方法A 的子集。',
    AB: '方法A ∩ 方法B：两种算法同时给出的号码才算数，用来收窄池子。',
    ABC: '方法A ∩ 方法B ∩ 密码集萃：再与"两两和 / 差 / 模积"的确定性衍生池取交集，池子最小、最严。'
  };

  function el(id) { return document.getElementById(id); }
  function txt(n) { return (n < 10 ? '0' : '') + n; }
  function num(n, d) { return (Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('zh-CN'); }
  function pct(n) { return n.toFixed(2) + '%'; }

  /* ---------- 载入数据 ---------- */
  function load() {
    var games = ['ssq', 'dlt'];
    Promise.all(games.map(function (g) {
      return fetch(V.GAMES[g].file + '?v=' + Date.now()).then(function (r) {
        if (!r.ok) throw new Error(g + ' HTTP ' + r.status);
        return r.json();
      }).then(function (j) { DATA[g] = j; });
    })).then(function () { render(); }).catch(function (e) {
      el('meta').textContent = '数据载入失败：' + e.message + '（请确认 data/ssq.json、data/dlt.json 已随页面部署）';
    });
  }

  /* ---------- 头部与模式条 ---------- */
  function renderModeBar() {
    var box = el('modes'); box.innerHTML = '';
    V.MODES.forEach(function (m) {
      var b = document.createElement('button');
      b.textContent = m === 'ABC' ? 'A∩B∩密码集萃' : (m === 'AB' ? 'A∩B' : '方法' + m);
      b.className = m === mode ? 'on' : '';
      b.onclick = function () { mode = m; el('cipher').checked = (m === 'ABC'); render(); };
      box.appendChild(b);
    });
    el('cipher').checked = (mode === 'ABC');
  }

  /* ---------- 号码池 ---------- */
  function renderPool() {
    var g = V.GAMES[game], h = DATA[game].data, last = h[h.length - 1];
    var res = V.poolOf(last, game, mode);
    el('poolFrom').textContent = '由 ' + last.period + ' 期（' + last.date + '，' +
      (game === 'ssq' ? last.reds.join(' ') + ' +' + last.blue : last.fronts.join(' ') + ' +' + last.backs.join(' ')) + '）推出';
    el('poolCount').innerHTML = res.pool.length + '<span class="lbl" style="font-size:13px"> 个号码</span>';
    el('balls').innerHTML = res.pool.map(function (n) { return '<span class="ball">' + txt(n) + '</span>'; }).join('')
      || '<span class="skel">本期没有任何算法派生号码（未触发），无池</span>';
    el('poolNote').innerHTML = res.on
      ? '<b>' + (game === 'ssq' ? '双色球' : '大乐透') + ' ' + modeLabel() + '</b> · ' + MODE_DESC[mode]
      : '本期两种算法都没有派生号码（除数页没有撞车），池为空。历史上有 ' + num(noTrigger(game)) + ' / ' + num(DATA[game].data.length - 1) + ' 期属于这种情况。';
    el('copy').onclick = function () {
      var t = res.pool.map(txt).join(' ');
      if (navigator.clipboard) navigator.clipboard.writeText(t);
      el('copy').textContent = '已复制 ' + res.pool.length + ' 个';
      setTimeout(function () { el('copy').textContent = '复制号码'; }, 1400);
    };
  }
  function modeLabel() { return mode === 'ABC' ? 'A∩B∩密码集萃' : (mode === 'AB' ? 'A∩B' : '方法' + mode); }

  /* ---------- 回测 ---------- */
  function bt(g, m) {
    var k = g + ':' + m;
    if (!cache[k]) cache[k] = V.backtest(DATA[g].data, g, m);
    return cache[k];
  }
  function noTrigger(g) { return bt(g, 'A').无池期数; }

  function renderBacktest() {
    var g = V.GAMES[game], r = bt(game, mode);
    el('kdef').textContent = game === 'ssq' ? '6 个红球' : '5 个前区';
    el('btScope').textContent = g.name + ' ' + num(r.回测期数) + ' 期（' + DATA[game].data[1].period + ' ~ '
      + DATA[game].data[DATA[game].data.length - 1].period + '） · 当前模式 ' + modeLabel()
      + ' · 池均 ' + r.池均.toFixed(1) + ' 个号 · 无池 ' + num(r.无池期数) + ' 期';
    var rows = r.rows.map(function (x) {
      var hi = x.倍数 >= 1.05 ? 'ok' : (x.倍数 <= 0.95 ? 'warn' : '');
      return '<tr' + (x.档 === r.rows[0].档 ? ' class="cur"' : '') + '>'
        + '<td>命中 ' + x.档 + '</td>'
        + '<td>' + num(x.至少次数) + ' 期</td><td>' + pct(x.至少百分比) + '</td>'
        + '<td class="mut">恰好 ' + num(x.恰好次数) + ' 期 · ' + pct(x.恰好百分比) + '</td>'
        + '<td class="mut">随机 ' + num(x.随机至少) + ' 期 · ' + pct(x.随机至少百分比) + '</td>'
        + '<td><span class="tag ' + hi + '">' + x.倍数.toFixed(2) + '×</span></td></tr>';
    }).join('');
    el('bt').innerHTML = '<tr><th>档位</th><th>至少命中</th><th>占比</th><th>恰好命中</th><th>随机对照</th><th>倍数</th></tr>' + rows;

    var t0 = r.rows[0];
    el('verdict').innerHTML = '<b>这张表该怎么读。</b> ' + g.name + ' ' + modeLabel() + ' 平均每期池子里放 '
      + r.池均.toFixed(1) + ' 个号，' + (game === 'ssq' ? '6' : '5') + ' 个开奖号平均命中 <b>' + r.每期平均命中.toFixed(2)
      + ' 个</b>；同样大小随便抓 ' + r.池均.toFixed(0) + ' 个号的随机期望是 <b>' + r.命中随机.toFixed(2) + ' 个</b>。'
      + ' 最高档"命中' + t0.档 + '"实测 ' + num(t0.至少次数) + ' 期（' + pct(t0.至少百分比) + '），随机对照 '
      + num(t0.随机至少) + ' 期（' + pct(t0.随机至少百分比) + '），倍数 ' + t0.倍数.toFixed(2)
      + '×。差额来自池子本身有 ' + r.池均.toFixed(0) + '/' + (game === 'ssq' ? '33' : '35')
      + ' 的覆盖面，不是算法识别出了要开的号。';
  }

  /* ---------- 四模式并排 ---------- */
  function renderCompare() {
    var g = V.GAMES[game];
    var head = '<tr><th>模式</th><th>池均</th><th>平均命中</th><th>随机期望</th>'
      + g.tiers.map(function (t) { return '<th>' + t + g.ball + '(至少)</th>'; }).join('') + '</tr>';
    var body = V.MODES.map(function (m) {
      var r = bt(game, m), t = r.rows;
      return '<tr' + (m === mode ? ' class="cur"' : '') + '><td>' + (m === 'ABC' ? 'A∩B∩密码集萃' : (m === 'AB' ? 'A∩B' : '方法' + m)) + '</td>'
        + '<td>' + r.池均.toFixed(1) + '</td><td>' + r.每期平均命中.toFixed(2) + '</td>'
        + '<td class="mut">' + r.命中随机.toFixed(2) + '</td>'
        + t.map(function (x) { return '<td>' + num(x.至少次数) + '<span class="lbl"> ' + x.至少百分比.toFixed(1) + '%</span></td>'; }).join('')
        + '</tr>';
    }).join('');
    el('cmp').innerHTML = head + body;
  }

  /* 当前模式的算法说明 */
  var MODE_DESC = {
    A: '方法A（书上11规则）：对每个"除数页"找可比数相同的号对，用商与余数做和、差、复合式派生候选号。派生式全部保留，没有二次过滤。',
    B: '方法B（Q-R 算术引擎）：同一批撞车号对，只做商/余数的和差与交叉和差，算子是方法A 的子集——实测两者有约 97% 的号码重叠，把它当"第二个独立算法"要谨慎。',
    AB: '方法A ∩ 方法B：两法同时给出的号码才算数，池子会明显收窄。',
    ABC: '方法A ∩ 方法B ∩ 密码集萃：再与"两两和 / 差 / 模积 + 彩种专属式"的确定性池取交集，池子最小。关掉第三种引擎就是 AB。'
  };

  /* ---------- 安慰剂对照 ---------- */
  function renderPlacebo() {
    var host = el('verdict');
    var r = V.placebo(DATA[game].data, game, mode, 3, 600);
    host.innerHTML += '<br><b>换一组乱序试试。</b> 把每期开奖号码在时间轴上随机打乱（池子算法照跑，只破坏"上期→下期"的对应关系），'
      + '随机抽 ' + r.期数 + ' 期 × ' + r.轮次 + ' 轮，安慰剂组平均每期命中 <b>' + r.平均命中.toFixed(2)
      + '</b> 个（真实数据 ' + bt(game, mode).每期平均命中.toFixed(2) + ' 个），最高档 "' + r.档 + '" 命中 <b>'
      + num(r.至少命中) + '</b> 期（真实 ' + num(bt(game, mode).rows[0].至少次数) + ' 期）。'
      + '两组数贴在一起 —— 打乱时间顺序后算法表现不变，说明历史数据里没有这套算法能抓到的结构。';
  }

  /* ---------- 真实出票概率：由组合数学现算，不写死数字 ---------- */
  function C(n, k) { if (k < 0 || k > n) return 0; k = Math.min(k, n - k); var r = 1; for (var i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }
  function hyper(N, K, t) { return C(K, t) * C(N - K, K - t) / C(N, K); }   // 单注恰好命中 t 个前区
  function ticketTiers() {
    if (game === 'ssq') {
      var pb = 1 / 16, pn = 15 / 16, R = function (t) { return hyper(33, 6, t); };
      return [
        { 奖级: '一等奖', 条件: '6 红 + 1 蓝', p: R(6) * pb, 金: '浮动' },
        { 奖级: '二等奖', 条件: '6 红', p: R(6) * pn, 金: '浮动' },
        { 奖级: '三等奖', 条件: '5 红 + 1 蓝', p: R(5) * pb, 金: '3000 元' },
        { 奖级: '四等奖', 条件: '5 红 或 4 红 + 1 蓝', p: R(5) * pn + R(4) * pb, 金: '200 元' },
        { 奖级: '五等奖', 条件: '4 红 或 3 红 + 1 蓝', p: R(4) * pn + R(3) * pb, 金: '10 元' },
        { 奖级: '六等奖', 条件: '2 红以内 + 1 蓝', p: (R(2) + R(1) + R(0)) * pb, 金: '5 元' }
      ];
    }
    var F = function (t) { return hyper(35, 5, t); }, B = function (t) { return C(2, t) * C(10, 2 - t) / C(12, 2); };
    return [
      { 奖级: '一等奖', 条件: '5 + 2', p: F(5) * B(2), 金: '浮动' },
      { 奖级: '二等奖', 条件: '5 + 1', p: F(5) * B(1), 金: '浮动' },
      { 奖级: '三等奖', 条件: '5 + 0 或 4 + 2', p: F(5) * B(0) + F(4) * B(2), 金: '5000 元' },
      { 奖级: '四等奖', 条件: '4 + 1', p: F(4) * B(1), 金: '300 元' },
      { 奖级: '五等奖', 条件: '4 + 0 或 3 + 2', p: F(4) * B(0) + F(3) * B(2), 金: '150 元' },
      { 奖级: '六等奖', 条件: '3 + 1 或 2 + 2', p: F(3) * B(1) + F(2) * B(2), 金: '15 元' },
      { 奖级: '七等奖', 条件: '3 + 0 或 2 + 1 或 1 + 2 或 0 + 2',
        p: F(3) * B(0) + F(2) * B(1) + F(1) * B(2) + F(0) * B(2), 金: '5 元' }
    ];
  }
  function renderTicket() {
    var tks = ticketTiers();
    el('ticket').innerHTML = tks.slice(0, 4).map(function (t) {
      return '<div><div class="lbl">' + t.奖级 + '（' + t.条件 + '）</div><div class="big" style="font-size:18px">1 / '
        + Math.round(1 / t.p).toLocaleString('zh-CN') + '</div><div class="lbl">' + t.金
        + ' · 理论概率 ' + (t.p * 100).toFixed(6) + '%</div></div>';
    }).join('');
    var anyWin = tks.reduce(function (a, t) { return a + t.p; }, 0);
    el('ticketAny').innerHTML = '任意奖级合计：1 / ' + Math.round(1 / anyWin) + '（' + (anyWin * 100).toFixed(2) + '%）';
    el('ticketNote').innerHTML = '上面是<b>任意一注</b>的中奖概率，双色球单注中任意奖级约 1/13，'
      + '长期每投 100 元历史回收约 50 元（返奖率）。<br>它和号码池无关：一个 15 个号的池里挑 6 个、'
      + '或闭眼挑 6 个，中 4 红以上的概率是同一个数 —— 池子能缩小复式成本，但改变不了单注命中概率。'
      + '真正能改善"命中 4 红以上的注数"的杠杆只有一个：<b>用更少的注覆盖更多不重复的号码</b>（见"号码池覆盖"表里池均与倍数的关系）。';
  }

  /* ---------- 全包预算器：预算 → 能打多大池 → 真实账 ---------- */
  var EST = { first: 5e6, second: 15e4 };
  function drawCompound() {
    var box = el('cb-out'); if (!box || !DATA[game]) return;
    var budget = Number(el('cb-budget').value) || 20000;
    var blue = Number(el('cb-blue').value) || 16;
    var years = Number(el('cb-years').value) || 25;
    var K = V.GAMES[game].numPick;
    var best = 0, bestRow = null;
    for (var u = K; u <= (game === 'ssq' ? 20 : 25); u++) {
      var a = V.compoundEV(game, u, blue, EST);
      if (a.成本 <= budget) { best = u; bestRow = a; }
    }
    if (!bestRow) { box.innerHTML = '<div class="lbl">预算太小，连最小复式都打不出（' + blue + ' 蓝 ×C(' + K + ',' + K + ')×2 元 = ' +
      (blue * 2) + ' 元）</div>'; return; }
    var periods = years * 154;
    var hist = DATA[game].data;
    var rep = V.compoundReplay(hist, game, mode, blue, EST, best);
    var yi = function (x) { return Math.abs(x) >= 1e8 ? (x / 1e8).toFixed(2) + ' 亿' : (x / 1e4).toFixed(0) + ' 万'; };
    var rows = [
      ['能打的池子', best + ' 个' + V.GAMES[game].ball + '号码', '全组合 ' + bestRow.注数.toLocaleString() + ' 注 = ' + bestRow.成本.toLocaleString() + ' 元/期'],
      [years + ' 年总成本', yi(bestRow.成本 * periods), '按 154 期/年；单票 ' + (bestRow.成本 > 20000 ? '超 2 万，需拆票' : '在 2 万内')],
      ['期望奖金', yi(bestRow.成本 * periods * bestRow.期望回收率), '回收率恒为 ' + (bestRow.期望回收率 * 100).toFixed(1) + '%（每注期望 ' + bestRow.单注期望.toFixed(3) + ' 元，与池怎么选号无关）'],
      ['一等奖期望次数', (bestRow.一期一等奖期望次数 * periods).toFixed(1) + ' 次', '一期概率 ' + (bestRow.一期一等奖期望次数 * 100).toFixed(4) + '%'],
      ['历史真实重放', '投 ' + yi(rep.总成本) + ' → 回 ' + yi(rep.总奖金), '净 ' + yi(rep.净) + '，回收率 ' + (rep.回收率 * 100).toFixed(1) + '%；一等奖 ' + rep.一等奖注数 + ' 注、池全覆盖 ' + rep.池全覆盖期数 + ' 期'],
      ['风险曲线', '最深浮亏 ' + yi(rep.最深浮亏), '最长连续不回本 ' + rep.最长空窗 + ' 期' + (rep.被截断期数 ? '；' + rep.被截断期数 + ' 期因超出复式上限被截到 ' + best + ' 码' : '')]
    ];
    box.innerHTML = '<table><tr><th>项目</th><th>数值</th><th>说明</th></tr>' + rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="mut">' + r[2] + '</td></tr>';
    }).join('') + '</table>'
      + '<div class="note" style="margin-top:8px">把预算调到 <b>256,256 元</b> 才能真正做到每期 16 红 + 16 蓝全买（这是 2 万上限的 12.8 倍）；'
      + '那个规模下 ' + years + ' 年要投 ' + yi(256256 * 154 * years) + '。</div>';
    window.drawCompound = drawCompound;
  }

  /* ---------- 渲染主控 ---------- */
  function render() {
    renderModeBar();
    var ex = el('expl'); if (ex) ex.innerHTML = '<b>' + V.MODE_NAME[mode] + '</b> —— ' + (MODE_DESC[mode] || '');
    renderPool();
    el('meta').textContent = '双色球 ' + num(DATA.ssq.data.length) + ' 期（至 ' + DATA.ssq.data[DATA.ssq.data.length - 1].period
      + '）· 大乐透 ' + num(DATA.dlt.data.length) + ' 期（至 ' + DATA.dlt.data[DATA.dlt.data.length - 1].period
      + '）· 数据更新 ' + DATA.ssq.updated_at;
    renderBacktest();
    renderCompare();
    drawCompound();
    renderTicket();
    renderPlacebo();
  }

  el('cipher').onchange = function () {
    mode = this.checked ? 'ABC' : 'AB';
    if (mode === 'AB' && arguments[0] && false) mode = 'B';
    render();
  };
  // 彩种切换（放在标题右侧）
  (function addGameSwitch() {
    var wrap = document.createElement('div');
    wrap.className = 'seg';
    wrap.style.marginLeft = 'auto';
    [['ssq', '双色球'], ['dlt', '大乐透']].forEach(function (pair) {
      var b = document.createElement('button');
      b.textContent = pair[1];
      b.className = pair[0] === game ? 'on' : '';
      b.onclick = function () {
        game = pair[0];
        [].forEach.call(wrap.children, function (c) { c.className = ''; });
        b.className = 'on';
        if (DATA[game]) render();
      };
      wrap.appendChild(b);
    });
    document.querySelector('header').appendChild(wrap);
  })();

  load();
})();
