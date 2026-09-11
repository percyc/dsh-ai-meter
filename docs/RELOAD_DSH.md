# DSH 日常启动与插件开发重载

命令入口为 `~/.local/bin/reload-dsh`，配置位于 `~/.config/dsh/reload.json`。可维护源码为 [reload-dsh.py](../scripts/reload-dsh.py)，配置结构见 [模板](../scripts/reload-dsh.example.json)。`reload-dsh --help` 和 `reload-dsh start --help` 显示中文说明。

## 日常命令

```sh
reload-dsh start       # 用保存的默认组合启动，不构建、不测试、不安装
reload-dsh restart     # 用默认组合重启，不构建、不测试、不安装
reload-dsh status      # 查看受管进程、监听端口和访问地址，不显示 token
reload-dsh login       # 查看当前运行实例的本机及域名登录链接，不重启
reload-dsh logs        # 查看最近 80 行日志，隐藏 token；日志可能来自历史实例
reload-dsh plugins     # 查看全部 profile 插件、来源及默认选择
```

本机默认启用 `cangzhi`、`ai-meter`、`better-sidebar`。前两项为本地源码插件，better-sidebar 为已安装的 npm 插件，当前固定在 0.19.0。启动和重载不会自动下载或升级 npm 插件；缺少安装时会报错。插件列表展示 profile 配置状态，不声称所有客户端组件已经激活。

`start` 遇到正在运行的受管服务只报告状态，不修改选择或默认组合。要切换组合请用 `restart`。端口被其他进程占用时不会擅自杀进程。

`login` 核对 PID、进程启动时间、工作目录、监听端口和日志时间；服务未运行或无法确认日志归属时只报错，不会自动启动。链接含登录 token，不要分享。

## 选择插件

```sh
reload-dsh start --plugins better-sidebar
reload-dsh restart --plugins cangzhi,ai-meter
reload-dsh restart --without ai-meter
reload-dsh restart --no-plugins
reload-dsh restart --without ai-meter --save-default
```

不带参数使用配置中的 `enabled`。`--plugins` 精确选择清单内插件，支持完整包名；`--without` 从默认组合排除，可重复或使用逗号分隔。两者互斥。`--all` 选择清单内全部插件，`--no-plugins` 关闭清单内插件，但保留 DSH 基础及其他清单外 bundle。

显式子命令的组合默认只影响本次运行，只有加 `--save-default` 且操作成功才写回 `enabled`。临时组合会留在 profile 中供当前进程使用；下一次不带选择参数的 `start`（服务停止后）或 `restart` 会恢复默认组合。直接绕过脚本运行 DSH 则使用 profile 当时的组合。

## 开发操作与兼容参数

```sh
reload-dsh reload                       # 构建、测试、刷新本地插件快照并重启
reload-dsh reload --plugins ai-meter    # 本次仅选择用量插件进行开发重载
reload-dsh reload --skip-tests          # 跳过测试，仍构建
reload-dsh reload --no-build            # 跳过构建，仍测试并重新注册
reload-dsh reload --no-restart          # 注册但不主动重启，live 配置可能热加载
reload-dsh restart --show-login         # 仅重启后显示链接
reload-dsh start --dry-run              # 只显示计划
```

构建/测试只运行所选本地插件的 argv 命令。npm 插件只检查已有安装。`--no-build`、`--skip-tests`、`--no-restart` 仅用于 `reload`；查看命令拒绝与选择或修改参数混用。

兼容旧命令：裸 `reload-dsh` 仍执行完整开发重载并保存选择；`--list` 等同于 `plugins`，`--none` 等同于 `--no-plugins`，保留 `--enable`/`--disable`。旧 `reload-dsh --show-login` **仍会完整重载**；只查看当前链接请用 `reload-dsh login`。

## 配置与恢复

`plugins` 中本地插件省略 `source` 或填写 `local`，需要绝对 `path`、可选 `build`/`test` 命令数组。npm 插件使用 `{"package":"dsh-better-sidebar","source":"npm"}`，无需源码目录。

所选插件必须出现在组合配置中；未选中的受管插件不作为必需项检查。`requiredPackages` 用于目录选择器等常驻基础插件，`requiredDisabledRows` 保留原有禁用规则。better-sidebar 已纳入统一选择，不再无条件强制启用。

修改 profile 前备份完整安装和配置，重启流程先停止已验证归属的服务，避免 live 配置提前切换旧进程。失败恢复 profile 和默认配置，原来运行的服务会尝试恢复。备份位于 `$XDG_RUNTIME_DIR/dsh-web-backup-*`，未配置时为 `/tmp/dsh-<uid>`。构建产物不在 profile 回滚范围内；运行时备份不是长期存档。

源码修改后同步到本机：

```sh
install -m 755 scripts/reload-dsh.py ~/.local/bin/reload-dsh
python3 -m unittest discover -s tests -p 'test_reload_dsh.py' -v
```

验证覆盖选择规则、只读命令、进程身份、旧日志拒绝、token 隐藏、已运行 start 无操作、restart 不安装、临时与默认组合、npm 不重建及失败恢复。
