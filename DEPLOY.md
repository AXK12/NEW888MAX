# VMAX 部署说明

三种方式，任选一种。所有情况下，Pages 上的入口都是：

**<https://AXK12.github.io/axk8899880/vmax.html>**

---

## 方式一：交给我推（最省事，需要你给一个短期 token）

我需要一枚 **Fine-grained Personal Access Token**，只在推完这一次后由你**立刻撤销**：

1. 打开 <https://github.com/settings/personal-access-tokens/new>
2. 设置：
   - Token name：`qwenwork-vmax`
   - Expiration：**1 天**（不要选 No expiration）
   - Scope of repositories：**Only select repositories** → 选 `AXK12/axk8899880`
   - Permissions → Repository permissions → **Contents: Read and write**（其它一律 Read-only）
3. Generate token，把 token 字符串发我

我拿到后会做的事：clone 仓库 → 提交 VMAX 文件（含改好的 `fetch_data.py` 与 workflow）→ push →
手动触发一次 workflow 验证数据能更新 → 把 commit 链接和 Actions 运行结果发你。**推完你立即去 Revoke。**

安全边界：这枚 token 只能读写这一个仓库、只能有效期 1 天、不含删除权限、拿不到你的账号其它仓库。

---

## 方式二：你自己在网页上传（无需 token，2 分钟）

1. 打开 <https://github.com/AXK12/axk8899880>
2. 点 **Add file → Upload files**
3. 把 `VMAX.zip` 解压后的文件按下面结构拖进去（GitHub 会自动建子目录，注意不要多套一层文件夹）：

```
vmax.html                     ← 页面
vmax.js · app.js              ← 引擎与渲染
fetch_data.py                 ← 覆盖原文件（改官方数据源 + 增量合并 + 校验）
data/ssq.json · data/dlt.json ← 覆盖（已更新到最新一期）
.github/workflows/update-data.yml ← 覆盖
tools/backtest.js · tests/equivalence.js · README.md
```

4. Commit message 填 `VMAX：官方数据源 + 全历史回测`，点 **Commit changes**
5. 打开 **Actions** 标签页确认 `每日更新开奖数据` 变绿
   - 若它报 `resource not accessible by integration` 或 push 步骤红叉：
     **Settings → Actions → General → Workflow permissions → 选 "Read and write permissions" → Save**
     然后回到 Actions 点 **Re-run jobs**。新仓库这里默认可能只给读权限，是最容易卡住的一步。
6. 访问 `https://AXK12.github.io/axk8899880/vmax.html`（Pages 已开启，通常 1 分钟内生效）

> 提示：`vmax.html` 与包里的 `index.html` 内容相同。仓库根已有自己的 `index.html`，
> **不要用它覆盖首页**，只放 `vmax.html` 即可（或在首页加一个入口链接）。

---

## 方式三：你本地有 git

```bash
git clone https://github.com/AXK12/axk8899880.git
cd axk8899880
unzip ~/Downloads/VMAX.zip      # 把包内文件按上面的结构铺进仓库
git add -A
git commit -m "VMAX：官方数据源 + 全历史回测"
git push
```

---

## 推完之后建议先跑这两步验证

```bash
node tests/equivalence.js        # 期望：✓ 8/8 模式与原页面完全等价
node tools/backtest.js           # 期望：命中表与页面显示一致
```

## 已知遗留（本次没动，等你发话再改）

`pro.html` 里那几个失效项（AC 阈值输入框、目标池 11 个勾选框、"上限100注"实际 10000、
`applyTargetFilter` 运算符写反、天平杀红绕过、自动分析不带 `蓝球-2`、写死的回测数字）
**没有**在本次包里改动 —— VMAX 是新建页面，你的 `pro.html` / `index.html` 保持原样。
需要同步修 pro.html 的话说一声，改动我已经想清楚，可单独提交。
