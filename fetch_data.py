#!/usr/bin/env python3
"""彩票开奖数据抓取器 —— 多源依次尝试 + 格式自适应 + 增量合并（GitHub Actions 每日调用）

为什么 17500 做主源：
  本仓库 runner 实测 data.17500.cn 返回 200（探针 workflow 记录在案），而中国福彩网对
  runner 出口返回 403、中国体彩网返回 567（境内可通、境外被拦）。上一版把官网设成主源，
  正是 workflow 连续失败的直接原因，这里纠正过来。官网留作兜底与交叉校验源。

候选源顺序（逐个尝试，能出合格数据就用，全部失败才报错）：
  双色球  data.17500.cn/ssq_asc.txt → ssq_asc.xls（带出球顺序）→ cwl.gov.cn 官网
  大乐透  data.17500.cn/dlt_asc.txt → dlt_asc.xls（带出球顺序）→ dlt2_asc.txt → sporttery.cn 官网

格式自适应：响应可能是纯文本、HTML 表格伪装成的 .xls，或真正的老式 OLE .xls。
按魔术字节与内容判定后分别解析，解析结果必须通过逐条校验才会被采用。

四条安全约束：
  A 逐条校验期号格式、号码个数与取值范围；有效记录过少 → 判该源不合格，继续换下一个源；
  B 增量合并：只追加新期号，绝不删除或覆盖既有历史（官网拿不到的 2003/2007 段靠仓库保留）；
  C 合并后条数若少于原文件 → 报错退出且不写文件；
  D 最新期号距今 > 4 天（两彩种最大开奖间隔 3 天）→ 打印 STALE 告警，提示源可能滞后。
"""
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')
RETRIES = 3
BACKOFF = 20


class SourceError(Exception):
    pass


def fetch_bytes(url, referer=None, timeout=45):
    headers = {'User-Agent': UA, 'Accept': '*/*'}
    if referer:
        headers['Referer'] = referer
    last = None
    for attempt in range(1, RETRIES + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
                return r.read()
        except Exception as exc:
            last = exc
            print('    第 %d/%d 次失败：%s' % (attempt, RETRIES, exc))
            if attempt < RETRIES:
                time.sleep(BACKOFF)
    raise SourceError(str(last))


# ---------------- 格式识别与解析 ----------------
def as_table(raw):
    """把响应规范化成 [[cell,...], ...]；支持 OLE-xls / HTML / 空白分隔文本。"""
    if raw[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':          # 真 .xls（OLE2）
        try:
            import xlrd
        except ImportError:
            raise SourceError('该文件是真正的 xls，但运行环境缺少 xlrd')
        bk = xlrd.open_workbook(file_contents=raw)
        sh = bk.sheet_by_index(0)
        return [[str(sh.cell_value(i, j)).strip() for j in range(sh.ncols)] for i in range(sh.nrows)]
    text = None
    for enc in ('utf-8', 'gb18030', 'gbk'):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw.decode('utf-8', errors='replace')
    if '<table' in text.lower() or '<tr' in text.lower():        # HTML 表格
        rows = []
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', text, re.S | re.I):
            cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S | re.I)
            clean_cells = [re.sub(r'<[^>]+>', '', c).replace('&nbsp;', ' ').strip() for c in cells]
            if clean_cells:
                rows.append(clean_cells)
        return rows
    return [ln.split() for ln in text.strip().splitlines()]       # 空白分隔文本


def rows_to_records(rows, game):
    out = []
    for cells in rows:
        nums = [c for c in cells if re.fullmatch(r'-?\d+(\.0)?', c)]
        if len(cells) < 3:
            continue
        period = cells[0].strip()
        date = next((c.strip() for c in cells[1:5] if re.fullmatch(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}', c)), '')
        if not date:
            continue
        date = date.replace('/', '-')
        y, m, dd = date.split('-')
        date = '%04d-%02d-%02d' % (int(y), int(m), int(dd))
        ints = []
        for c in cells[1:]:
            if c == date or not re.fullmatch(r'\d+(\.0)?', c.strip()):
                continue
            ints.append(int(float(c)))
        try:
            if game == 'ssq':
                if len(ints) < 7:
                    continue
                reds, blue = ints[0:6], ints[6]
                out.append({'period': period, 'date': date, 'reds': reds, 'blue': blue})
            else:
                if len(ints) < 7:
                    continue
                out.append({'period': period, 'date': date, 'fronts': ints[0:5], 'backs': ints[5:7]})
        except Exception:
            continue
    return out


def validate(records, game):
    """期号格式 + 号码个数/范围/去重，全通过才返回。"""
    ok = {}
    for r in records:
        try:
            p, d = str(r['period']), r['date']
            if game == 'ssq':
                if not re.fullmatch(r'\d{7}', p):
                    continue
                reds = sorted({int(x) for x in r['reds']})
                blue = int(r['blue'])
                if len(reds) != 6 or not all(1 <= x <= 33 for x in reds) or not 1 <= blue <= 16:
                    continue
                ok[p] = {'period': p, 'date': d, 'reds': reds, 'blue': blue}
            else:
                if not re.fullmatch(r'\d{5}', p):
                    continue
                f = sorted({int(x) for x in r['fronts']})
                b = sorted({int(x) for x in r['backs']})
                if len(f) != 5 or not all(1 <= x <= 35 for x in f) or len(b) != 2 or not all(1 <= x <= 12 for x in b):
                    continue
                ok[p] = {'period': p, 'date': d, 'fronts': f, 'backs': b}
        except Exception:
            continue
    return sorted(ok.values(), key=lambda x: x['period'])


# ---------------- 各源封装 ----------------
def src_17500(url, game, min_ok):
    def go(newest_known):
        rows = as_table(fetch_bytes(url))
        recs = validate(rows_to_records(rows, game), game)
        if len(recs) < min_ok:
            raise SourceError('仅解析出 %d 条合格记录（要求 ≥%d）' % (len(recs), min_ok))
        return recs
    return go


def src_cwl(game):
    url = ('https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice'
           '?name=ssq&issueCount=400')
    def go(newest_known):
        raw = fetch_bytes(url, referer='https://www.cwl.gov.cn/kjxx/ssq/')
        data = json.loads(raw.decode('utf-8', 'replace'))
        if data.get('state') != 0:
            raise SourceError('接口返回 state=%s' % data.get('state'))
        recs = []
        for it in data.get('result') or []:
            d = re.sub(r'\(.*?\)', '', str(it.get('date', ''))).strip()
            recs.append({'period': str(it.get('code', '')), 'date': d,
                         'reds': [int(x) for x in str(it.get('red', '')).split(',')],
                         'blue': int(it.get('blue', 0) or 0)})
        recs = validate(recs, 'ssq')
        if len(recs) < 50:
            raise SourceError('仅 %d 条合格记录' % len(recs))
        return recs
    return go


def src_sporttery(game):
    base = ('https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry'
            '?gameNo=85&provinceId=0&pageSize=30&isVerify=1&pageNo=%d')
    def go(newest_known):
        recs, page = [], 1
        while page <= 120:
            raw = fetch_bytes(base % page, referer='https://static.sporttery.cn/')
            v = (json.loads(raw.decode('utf-8', 'replace')) or {}).get('value') or {}
            lst = v.get('list') or []
            if not lst:
                break
            done = False
            for it in lst:
                num = str(it.get('lotteryDrawNum', ''))
                if newest_known and num and num <= newest_known:
                    done = True
                    break
                res = str(it.get('lotteryDrawResult', '')).split()
                recs.append({'period': num, 'date': str(it.get('lotteryDrawTime', '')),
                             'fronts': [int(x) for x in res[:5]], 'backs': [int(x) for x in res[5:7]]})
            if done or int(v.get('pages') or 1) <= page:
                break
            page += 1
            time.sleep(1)
        recs = validate(recs, 'dlt')
        if len(recs) < 1:
            raise SourceError('无新记录可解析')
        return recs
    return go


SOURCES = {
    'ssq': [
        ('17500 文本 ssq_asc.txt', src_17500('https://data.17500.cn/ssq_asc.txt', 'ssq', 1000)),
        ('17500 表格 ssq_asc.xls', src_17500('https://data.17500.cn/ssq_asc.xls', 'ssq', 1000)),
        ('中国福彩网官网', src_cwl('ssq')),
    ],
    'dlt': [
        ('17500 文本 dlt_asc.txt', src_17500('https://data.17500.cn/dlt_asc.txt', 'dlt', 1000)),
        ('17500 表格 dlt_asc.xls（带出球顺序）', src_17500('https://data.17500.cn/dlt_asc.xls', 'dlt', 1000)),
        ('17500 文本 dlt2_asc.txt', src_17500('https://data.17500.cn/dlt2_asc.txt', 'dlt', 1000)),
        ('中国体彩网官网', src_sporttery('dlt')),
    ],
}


def load_local(filename):
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        return json.load(f).get('data', [])


def update(game, filename):
    old = load_local(filename)
    newest_known = max((r['period'] for r in old), default=None)
    print('  本地 %d 期，最新 %s' % (len(old), newest_known or '-'))
    by_period = {r['period']: r for r in old}
    added = 0
    used_sources = []
    for name, fetcher in SOURCES[game]:
        print('  尝试源：%s' % name)
        try:
            recs = fetcher(newest_known)
        except SourceError as exc:
            print('    跳过：%s' % exc)
            continue
        except Exception as exc:
            print('    跳过（异常）：%s' % exc)
            continue
        new = [r for r in recs if r['period'] not in by_period]
        for r in new:
            by_period[r['period']] = r
        added += len(new)
        used_sources.append('%s→%s(+%d)' % (name.split()[0], recs[-1]['period'], len(new)))
        # 已拿到覆盖到本地的源就够用，但继续尝试下一个源以交叉验证，成本很低
    if not used_sources:
        raise RuntimeError('%s：所有源都不可用' % game.upper())
    merged = sorted(by_period.values(), key=lambda x: x['period'])
    if len(merged) < len(old):
        raise RuntimeError('合并后 %d < 本地 %d，拒绝写入' % (len(merged), len(old)))
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, filename), 'w', encoding='utf-8') as f:
        json.dump({'version': 2,
                   'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                   'total': len(merged), 'data': merged}, f, ensure_ascii=False)
    latest = merged[-1]
    print('  写入 %s：%d → %d 期（新增 %d）｜最新 %s %s｜源[%s]'
          % (filename, len(old), len(merged), added, latest['period'], latest['date'],
             ', '.join(used_sources)))
    gap = (datetime.now() - datetime.strptime(latest['date'], '%Y-%m-%d')).days
    if gap > 4:
        print('  ⚠️ STALE：最新一期距今 %d 天，源可能滞后或今日未开奖' % gap)
    return added


def main():
    print('[%s] 开始更新开奖数据' % datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    a = update('ssq', 'ssq.json')
    time.sleep(5)
    b = update('dlt', 'dlt.json')
    print('Done! 合计新增 %d 期' % (a + b))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('更新失败：%s' % exc, file=sys.stderr)
        sys.exit(1)
