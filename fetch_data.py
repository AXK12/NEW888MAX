#!/usr/bin/env python3
"""彩票开奖数据抓取脚本 - GitHub Actions 自动运行

数据源（官方，替代已失效的 data.17500.cn）：
  双色球 SSQ -> 中国福彩网  www.cwl.gov.cn
  大乐透 DLT -> 中国体彩网  webapi.sporttery.cn

策略：增量合并。以仓库里 data/*.json 的既有历史为基准，只追加接口返回的
新期号，绝不删除或覆盖已有记录，因此抓取接口某天不可用也不会损坏历史数据。
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')
RETRIES = 4
BACKOFF = 15          # 秒，逐次翻倍
MAX_DLT_PAGES = 120   # 大乐透翻页上限（防御死循环）


def http_json(url, referer, timeout=30):
    """带重试的 JSON 拉取；返回 dict。全部重试失败则抛异常。"""
    headers = {
        'User-Agent': UA,
        'Referer': referer,
        'Accept': 'application/json, text/plain, */*',
    }
    last_err = None
    wait = BACKOFF
    for attempt in range(1, RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode('utf-8', errors='replace')
            # 官网被 WAF 拦截时会返回 HTML 兜底页，此时按失败处理而不是脏数据
            head = raw.lstrip()[:1]
            if head not in ('{', '['):
                raise ValueError('响应不是 JSON（疑似被防火墙拦截）')
            return json.loads(raw)
        except Exception as exc:                      # noqa: BLE001
            last_err = exc
            print('  第 %d/%d 次请求失败: %s' % (attempt, RETRIES, exc))
            if attempt < RETRIES:
                print('  %d 秒后重试...' % wait)
                time.sleep(wait)
                wait *= 2
    raise RuntimeError('请求 %s 连续 %d 次失败: %s' % (url, RETRIES, last_err))


def load_local(name):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        return json.load(f).get('data', [])


def save(name, records):
    os.makedirs(DATA_DIR, exist_ok=True)
    payload = {
        'version': 2,
        'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total': len(records),
        'data': records,
    }
    with open(os.path.join(DATA_DIR, name), 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)


def merge(old_records, new_records):
    """既有记录优先，只补充新期号，按期号升序返回。"""
    by_period = {r['period']: r for r in old_records}
    added = 0
    for r in new_records:
        if r['period'] not in by_period:
            by_period[r['period']] = r
            added += 1
    records = sorted(by_period.values(), key=lambda r: r['period'])
    return records, added


# ---------------------------------------------------------------- 双色球
def _parse_ssq(body):
    if body.get('state') != 0:
        raise RuntimeError('福彩接口返回异常: %s' % body.get('message'))
    out = []
    for item in body.get('result') or []:
        code = str(item.get('code', '')).strip()
        reds = [int(x) for x in str(item.get('red', '')).split(',') if x.isdigit()]
        blues = [int(x) for x in str(item.get('blue', '')).split(',') if x.isdigit()]
        date = re.sub(r'\(.*?\)', '', str(item.get('date', ''))).strip()
        # 结构校验：期号 7 位 + 6 个红球(1-33) + 1 个蓝球(1-16)
        if not re.fullmatch(r'\d{7}', code):
            continue
        if len(reds) != 6 or not all(1 <= n <= 33 for n in reds):
            continue
        if len(blues) != 1 or not 1 <= blues[0] <= 16:
            continue
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
            continue
        out.append({'period': code, 'date': date, 'reds': reds, 'blue': blues[0]})
    if len(out) < 5:
        raise RuntimeError('双色球解析结果过少（%d 期），判定接口异常，放弃写入' % len(out))
    return out


def fetch_ssq(newest_known=None):
    """先按小窗口只取最近若干期；若本地数据缺口比窗口还大（长期断更），
    再退化为抓取接口能提供的全量范围（2013 年起）。"""
    url = ('https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice'
           '?name=ssq&issueCount=%d')
    rows = _parse_ssq(http_json(url % 200, referer='https://www.cwl.gov.cn/kjxx/ssq/'))
    oldest_fetched = min(r['period'] for r in rows)
    if newest_known and oldest_fetched > newest_known:
        # 说明本地比窗口更旧，缺口大，拉全量补
        print('  检测到数据缺口大于 200 期，改抓全量范围')
        full = ('https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice'
                '?name=ssq&pageNo=1&pageSize=100')
        rows = _parse_ssq(http_json(full, referer='https://www.cwl.gov.cn/kjxx/ssq/'))
    return rows


# ---------------------------------------------------------------- 大乐透
def fetch_dlt(newest_known=None):
    """接口按期号倒序返回。日常只需第 1 页：一旦碰到本地已有的最新期号即可停止。
    本地没有数据时（首次重建）才翻到底。"""
    base = ('https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry'
            '?gameNo=85&provinceId=0&pageSize=30&isVerify=1&pageNo=%d')
    out = []
    page = 1
    reached_known = False
    while page <= MAX_DLT_PAGES and not reached_known:
        body = http_json(base % page, referer='https://static.sporttery.cn/')
        value = (body or {}).get('value') or {}
        if value.get('errorCode') not in (None, '0'):
            raise RuntimeError('体彩接口返回异常: %s' % value.get('errorMessage'))
        rows = value.get('list') or []
        if not rows:
            break
        for item in rows:
            num = str(item.get('lotteryDrawNum', '')).strip()
            result = str(item.get('lotteryDrawResult', '')).split()
            date = str(item.get('lotteryDrawTime', '')).strip()
            if newest_known and num and num <= newest_known:
                reached_known = True      # 后面都是本地已有的更老期号
                break
            if not re.fullmatch(r'\d{5}', num) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
                continue
            try:
                balls = [int(x) for x in result]
            except ValueError:
                continue
            # 结构校验：5 前区(1-35) + 2 后区(1-12)
            if len(balls) != 7:
                continue
            fronts, backs = balls[:5], balls[5:]
            if not all(1 <= n <= 35 for n in fronts) or not all(1 <= n <= 12 for n in backs):
                continue
            out.append({'period': num, 'date': date, 'fronts': fronts, 'backs': backs})
        total_pages = int(value.get('pages') or 1)
        if page >= total_pages:
            break
        page += 1
        time.sleep(1)
    if not reached_known and len(out) < 10:
        raise RuntimeError('大乐透解析结果过少（%d 期），判定接口异常，放弃写入' % len(out))
    return out



def main():
    print('[%s] 开始更新开奖数据' % datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

    ssq_old = load_local('ssq.json')
    ssq_new = fetch_ssq(newest_known=max((r['period'] for r in ssq_old), default=None))
    ssq_merged, ssq_added = merge(ssq_old, ssq_new)
    print('双色球: 历史 %d 期 -> %d 期，新增 %d 期（最新 %s %s）'
          % (len(ssq_old), len(ssq_merged), ssq_added,
             ssq_merged[-1]['period'] if ssq_merged else '-',
             ssq_merged[-1]['date'] if ssq_merged else ''))

    dlt_old = load_local('dlt.json')
    dlt_new = fetch_dlt(newest_known=max((r['period'] for r in dlt_old), default=None))
    dlt_merged, dlt_added = merge(dlt_old, dlt_new)
    print('大乐透: 历史 %d 期 -> %d 期，新增 %d 期（最新 %s %s）'
          % (len(dlt_old), len(dlt_merged), dlt_added,
             dlt_merged[-1]['period'] if dlt_merged else '-',
             dlt_merged[-1]['date'] if dlt_merged else ''))

    # 任一彩种出现数据倒退，直接失败，绝不写坏文件
    if len(ssq_merged) < len(ssq_old) or len(dlt_merged) < len(dlt_old):
        raise RuntimeError('合并后记录数减少，中止写入')

    save('ssq.json', ssq_merged)
    save('dlt.json', dlt_merged)
    print('Done! 新增合计 %d 期' % (ssq_added + dlt_added))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:                      # noqa: BLE001
        print('更新失败: %s' % exc, file=sys.stderr)
        sys.exit(1)
