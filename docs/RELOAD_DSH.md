# 注册到当前 DSH 与多插件重载

以下以 DSH 源码入口 `/path/to/deepseek-harness`，profile 为 `web`，监听 `127.0.0.1:3080`，反向代理 `https://dsh.example.com` 为例。请将示例路径与域名替换为自己的配置。

`reload-dsh` 通过 DSH 自带的插件管理命令注册本地目录：

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add file:/path/to/dsh-ai-meter --ignore-scripts
```

构建在注册前由重载脚本执行。DSH 根据包的 `dsh.bundle.patch` 把插件加入 profile 的 `dsh.profile.bundles`；本项目的 `cordis.patch.yml` 注册 `ai-meter` row。当前源码版 DSH 启动自定义 profile 的命令为 `pnpm dsh --profile web --host 127.0.0.1 --port 3080 --no-open`，不要把 `--profile` 放到 `dsh web` 子命令之后。

## 常用命令

```sh
reload-dsh                              # 重建、测试、注册、重启上次选择的插件
reload-dsh --list                        # 配置清单、选择状态、profile 注册状态
reload-dsh --plugins cangzhi,ai-meter    # 同时加载藏知和 AI Meter
reload-dsh --plugins ai-meter           # 仅加载 AI Meter（限本脚本管理范围）
reload-dsh --enable ai-meter             # 在当前选择上增加一个插件
reload-dsh --disable ai-meter            # 在当前选择上禁用一个插件
reload-dsh --all                         # 加载清单内全部插件
reload-dsh --none                        # 禁用清单内全部插件，保留其他 bundle
reload-dsh --plugins ai-meter --dry-run # 只看计划，不构建、不写配置、不重启
```

成功后选择写回配置；下次直接执行 `reload-dsh` 会沿用。也接受完整包名，例如 `--plugins dsh-cangzhi,dsh-ai-meter`。`--enable` / `--disable` 可重复或传逗号分隔列表；同时指定时 disable 优先。

按需使用：

```sh
reload-dsh --skip-tests                 # 仍构建，跳过测试
reload-dsh --no-build --skip-tests      # 已完成验证时，只刷新安装快照并重启
reload-dsh --no-restart                 # 只更新注册；下次完整重启加载新代码
reload-dsh --show-login                 # 启动成功后在当前终端显示一次性授权 URL
reload-dsh --config /absolute/config.json --list
```

默认不把授权 token 打印到输出；启动日志保存在私有文件中。`--no-restart` 不主动停止进程，但启用 live patch reload 的宿主可能观察到 profile 变化。

## 插件清单

- 已安装脚本：`~/.local/bin/reload-dsh`（Python 3，Linux，标准库）。
- 本机配置：`~/.config/dsh/reload.json`。
- 可维护源码：[reload-dsh.py](../scripts/reload-dsh.py)。
- 初始模板：[reload-dsh.example.json](../scripts/reload-dsh.example.json)。

添加第三个插件时，在 `plugins` 对象增加一项，不用修改启动脚本：

```json
{
  "third-plugin": {
    "package": "dsh-third-plugin",
    "path": "/absolute/path/dsh-third-plugin",
    "build": [["npm", "run", "build"]],
    "test": [["npm", "test"]]
  }
}
```

然后执行 `reload-dsh --enable third-plugin`。没有测试命令时可写 `"test": []`。`build` / `test` 都是 **argv 数组的数组**，不会经 shell 执行；多个命令写多个数组。可在参数中使用 `{dshSource}` 和 `{pluginDir}`。所有构建命令都收到 `DSH_SOURCE` 环境变量，在该插件目录中运行。

藏知沿用原脚本的 DSH `tsdown` preset、client ID 重写、语法检查和回归测试；AI Meter 使用本项目的 npm build/typecheck/test。配置保留原有 browse 目录选择插件及 `directory-picker` 禁用检查。此模板面向本机 web profile；其他部署需按实际环境调整 `requiredPackages` 和 `requiredDisabledRows`。

## 重载与恢复

1. 先完成选中插件的全部构建和测试。失败时不修改 profile，也不停止原服务。
2. 备份完整 profile，包括配置、依赖和安装快照。
3. 移除并重新添加选中插件的 `file:` 依赖，避免 pnpm 继续使用旧快照；最终只调整清单内包的 bundle 启用状态。
4. 验证 DSH 组合配置，保留不在清单内的 bundle 及原有用户 patch。
5. 仅停止 PID 文件中启动时间、进程组、命令与源码工作目录均匹配的进程，再按指定 profile 启动。
6. 使用本机启动 URL 完成带 Cookie 的 HTTP 就绪检查；成功后保存选择。

注册失败恢复旧 profile；重启失败也会恢复旧 profile，并在原实例曾运行时尝试重新启动。备份目录默认在 `$XDG_RUNTIME_DIR/dsh-web-backup-*`，包含原 profile 和失败快照；没有该变量时使用 `/tmp/dsh-<uid>`。这些是运行时备份，不是长期历史存档。源码目录里的构建产物不在 profile 回滚范围内。

未选插件的依赖保留，只从本脚本管理的 bundle 列表中关闭。如果绕过脚本手工运行 `dsh plugin add/update`，DSH 自带 reconciliation 可能重新启用已安装 bundle；再次运行脚本会恢复保存的选择。CLI 配置包含可执行程序路径，应只编辑可信的本地配置。

修改仓库中的脚本后，同步到本机：

```sh
install -m 755 scripts/reload-dsh.py ~/.local/bin/reload-dsh
```

旧 Bash 脚本已保留为 `~/.local/bin/reload-dsh.bak-20260909-221828`。新脚本不再处理缺少启动时间的旧 `/tmp/dsh-web.pid`，避免误杀复用的 PID；当前实例使用 `/run/user/1000/dsh-web.pid`。

## 验证

```sh
python3 -m unittest discover -s tests -p 'test_reload_dsh.py' -v
```

测试覆盖精确/增量选择、未管理 bundle 保留、参数校验、PID 复用、带 name 行的组合配置、原子配置写入、dry-run 无副作用、启动参数顺序、Cookie 就绪检查和失败回滚。

## 本机验收（2026-09-09）

当前保存选择为 `cangzhi,ai-meter`，两个 bundle 已注册到运行中的 `web` profile。真实 Chromium 浏览器验证 Settings → AI Usage 七个平台卡片返回、手动刷新成功、无页面异常。OpenCode Go 正常取数；Codex 返回了额度状态；其余账号的未配置/查询失败仍按平台独立显示，未替用户更改凭据。

本次还修复了 AI Meter 的三个实机 RPC 适配点：显式传入可选参数位置、在 Typert descriptor 声明 `acceptsUndefined`，以及解包 `RemoteResult` 成功/失败分支。27 项插件测试、2 项浏览器回归、10 项重载脚本测试通过；藏知沿用原有 112 项测试并通过。
