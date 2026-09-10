#!/usr/bin/env python3
"""Build selected local DSH plugins, register them, and restart an owned Web process."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


class ReloadError(Exception):
    pass


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def redact(text):
    return re.sub(r'(token=)[^\s&"\']+', r'\1[REDACTED]', text)


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='Examples:\n  reload-dsh --list\n  reload-dsh --plugins cangzhi,ai-meter\n  reload-dsh --disable ai-meter\n  reload-dsh --enable ai-meter --dry-run\n\nSuccessful selections are saved. Unmanaged profile plugins are preserved.')
    p.add_argument('--config', default=os.environ.get('RELOAD_DSH_CONFIG', str(Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home()/'.config')))/'dsh/reload.json')))
    group = p.add_mutually_exclusive_group()
    group.add_argument('--plugins', help='Exact comma-separated managed plugin IDs to load')
    group.add_argument('--all', action='store_true', help='Load every configured local plugin')
    group.add_argument('--none', action='store_true', help='Disable all managed plugins; keep other profile bundles')
    p.add_argument('--enable', action='append', default=[], help='Enable an ID (repeatable or comma-separated)')
    p.add_argument('--disable', action='append', default=[], help='Disable an ID (repeatable or comma-separated)')
    p.add_argument('--list', action='store_true', help='Show configured selection and registered bundles')
    p.add_argument('--dry-run', action='store_true', help='Print the plan without build, install, config writes or restart')
    p.add_argument('--skip-tests', action='store_true', help='Build normally but skip plugin tests')
    p.add_argument('--no-build', action='store_true', help='Reuse existing build outputs; tests still run unless skipped')
    p.add_argument('--no-restart', action='store_true', help='Register selection only; do not stop/start DSH')
    p.add_argument('--show-login', action='store_true', help='Print the local one-time login URL after startup')
    return p


def select_plugins(config, args):
    plugins = config['plugins']
    aliases = {key: key for key in plugins}
    aliases.update({value['package']: key for key, value in plugins.items()})
    def ids(values):
        result = []
        for value in values:
            for item in value.split(','):
                item = item.strip()
                if item not in aliases:
                    raise ReloadError(f'Unknown plugin: {item!r}; use --list')
                result.append(aliases[item])
        return result
    selected = set(ids(config.get('enabled', [])))
    if args.plugins is not None:
        selected = set(ids([args.plugins]))
    if args.all:
        selected = set(plugins)
    if args.none:
        selected = set()
    selected.update(ids(args.enable))
    selected.difference_update(ids(args.disable))
    return [key for key in plugins if key in selected]


def validate(config):
    for key in ('dshSource', 'profile', 'plugins', 'server'):
        if key not in config:
            raise ReloadError(f'Missing config field: {key}')
    if not re.fullmatch(r'[A-Za-z0-9_-]+', config['profile']):
        raise ReloadError('Invalid profile name')
    packages = []
    for key, plugin in config['plugins'].items():
        if not re.fullmatch(r'[A-Za-z0-9_-]+', key):
            raise ReloadError(f'Invalid plugin ID: {key}')
        packages.append(plugin['package'])
        if not Path(plugin['path']).is_absolute():
            raise ReloadError(f'Plugin path must be absolute: {key}')
        for phase in ('build', 'test'):
            commands = plugin.get(phase, [])
            if not isinstance(commands, list) or any(not isinstance(cmd, list) or not cmd or any(not isinstance(a, str) for a in cmd) for cmd in commands):
                raise ReloadError(f'{key}.{phase} must be an array of argv arrays')
    if len(set(packages)) != len(packages):
        raise ReloadError('Duplicate plugin package')
    server = config['server']
    if server['host'] not in ('127.0.0.1', 'localhost', '::1'):
        raise ReloadError('This launcher expects a loopback host behind a trusted reverse proxy')
    if not isinstance(server['port'], int) or not 1 <= server['port'] <= 65535:
        raise ReloadError('Invalid server port')


def profile_selection(manifest, config, selected):
    # Change only our own bundle entries, retaining every unmanaged entry and its order.
    managed = {p['package'] for p in config['plugins'].values()}
    profile = manifest.setdefault('dsh', {}).setdefault('profile', {})
    wanted = [config['plugins'][key]['package'] for key in selected]
    existing = profile.get('bundles', [])
    profile['bundles'] = [name for name in existing if name not in managed or name in wanted]
    profile['bundles'].extend(name for name in wanted if name not in profile['bundles'])
    return manifest


def process_info(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()
        return {'start': fields[19], 'group': int(fields[2]), 'state': fields[0],
                'command': Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')}
    except (OSError, IndexError):
        return None


def owned_process(pid_file, source):
    if not pid_file.exists():
        return None
    parts = pid_file.read_text().split()
    if not parts or not parts[0].isdigit():
        raise ReloadError(f'Invalid PID file: {pid_file}')
    pid = int(parts[0])
    info = process_info(pid)
    if not info or info['state'] == 'Z':
        return None
    if len(parts) != 2 or info['start'] != parts[1]:
        raise ReloadError(f'PID {pid} identity is not verifiable; refusing to stop it')
    if info['group'] != pid or 'dsh' not in info['command'] or 'web' not in info['command']:
        raise ReloadError(f'PID {pid} is not an owned DSH Web process group')
    if Path(f'/proc/{pid}/cwd').resolve() != source.resolve():
        raise ReloadError(f'PID {pid} belongs to another source checkout')
    return pid


def port_open(server):
    try:
        with socket.create_connection((server['host'], server['port']), timeout=.5):
            return True
    except OSError:
        return False


def stop(pid_file, source):
    pid = owned_process(pid_file, source)
    if pid is None:
        pid_file.unlink(missing_ok=True)
        return
    print(f'==> Stopping owned DSH process group {pid}', flush=True)
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pid_file.unlink(missing_ok=True)
        return
    for _ in range(40):
        # Inspect the entire group: pnpm may exit before its server child does.
        members = [p for p in Path('/proc').iterdir() if p.name.isdigit()]
        if not any((i := process_info(int(p.name))) and i['group'] == pid and i['state'] != 'Z' for p in members):
            break
        time.sleep(.25)
    else:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    pid_file.unlink(missing_ok=True)


def run(argv, cwd, env, capture=False):
    print(f'  ({cwd}) {shlex.join(argv)}', flush=True)
    if capture:
        result = subprocess.run(argv, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode:
            print(redact(result.stderr[-4000:]), file=sys.stderr)
            raise ReloadError(f'Command failed ({result.returncode}): {argv[0]}')
        return result.stdout
    result = subprocess.run(argv, cwd=cwd, env=env)
    if result.returncode:
        raise ReloadError(f'Command failed ({result.returncode}): {argv[0]}')


def verify_dump(dump, config, selected):
    for key in selected:
        package = re.escape(config['plugins'][key]['package'])
        if not re.search(r'^\s*name:\s*[\'\"]?' + package + r'[\'\"]?\s*$', dump, re.M):
            raise ReloadError(f'Plugin absent from composed profile: {key}')
    for package in config.get('requiredPackages', []):
        if not re.search(r'^\s*name:\s*[\'\"]?' + re.escape(package) + r'[\'\"]?\s*$', dump, re.M):
            raise ReloadError(f'Required profile plugin is missing: {package}')
    blocks = re.split(r'(?m)^[ \t]*- id:[ \t]*', dump)[1:]
    rows = {block.splitlines()[0].strip(" '\""): block for block in blocks}
    for row in config.get('requiredDisabledRows', []):
        if row not in rows or not re.search(r'(?m)^[ \t]+disabled:[ \t]*true[ \t]*$', rows[row]):
            raise ReloadError(f'Required disabled row is not disabled: {row}')


def launch(config, source, env, pid_file, log_file, show_login):
    server = config['server']
    if port_open(server):
        raise ReloadError(f'Port {server["port"]} is still occupied; no unowned process will be killed')
    argv = ['pnpm', 'dsh', '--profile', config['profile'], '--host', server['host'], '--port', str(server['port']), '--no-open']
    if server.get('trustedHost'):
        argv += ['--trusted-host', server['trustedHost']]
    with log_file.open('w') as log:
        child = subprocess.Popen(argv, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT,
                                 stdin=subprocess.DEVNULL, start_new_session=True, close_fds=True)
    os.chmod(log_file, 0o600)
    info = process_info(child.pid)
    if not info:
        raise ReloadError('DSH launcher exited before recording its PID')
    pid_file.write_text(f'{child.pid} {info["start"]}\n')
    os.chmod(pid_file, 0o600)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor())
    for _ in range(120):
        if child.poll() is not None:
            break
        log = log_file.read_text(errors='replace')
        urls = re.findall(r'^dsh web: (http://[^\s]+)', log, re.M)
        if urls and port_open(server):
            url = urls[-1]
            expected = f'http://{server["host"]}:{server["port"]}/?token='
            if url.startswith(expected):
                try:
                    with opener.open(url, timeout=2) as response:
                        if 200 <= response.status < 400:
                            print(f'==> DSH ready: http://{server["host"]}:{server["port"]} (PID {child.pid})')
                            if server.get('trustedHost'):
                                print(f'    Proxy: https://{server["trustedHost"]}')
                            print(f'    Log: {log_file}')
                            if show_login:
                                print(f'    One-time login: {url}')
                            return
                except OSError:
                    pass
        time.sleep(.5)
    stop(pid_file, source)
    print(redact('\n'.join(log_file.read_text(errors='replace').splitlines()[-60:])), file=sys.stderr)
    raise ReloadError('DSH failed readiness checks; see its private log')


def execute(config, selected, args, config_path):
    source = Path(config['dshSource'])
    dsh_home = Path(os.environ.get('DSH_HOME', config.get('dshHome', str(Path.home()/'.dsh'))))
    profile_dir = dsh_home/'profiles'/config['profile']
    if not (source/'package.json').is_file() or not (profile_dir/'package.json').is_file():
        raise ReloadError('DSH source/profile is missing; initialize the profile first')
    manifest = read_json(profile_dir/'package.json')
    print(f'Profile: {config["profile"]} | DSH: {source}')
    if args.list:
        active = manifest.get('dsh', {}).get('profile', {}).get('bundles', [])
        for key, p in config['plugins'].items():
            print(f'{key:16} selected={str(key in selected):5} registered={str(p["package"] in active):5} {p["path"]}')
        print(f'Config: {config_path}')
        return
    print('Selected: ' + (', '.join(selected) or '(none; unmanaged plugins stay enabled)'))
    for key in selected:
        plugin = config['plugins'][key]
        directory = Path(plugin['path'])
        if read_json(directory/'package.json')['name'] != plugin['package']:
            raise ReloadError(f'Package name mismatch: {key}')
        for phase in ('build', 'test'):
            if (phase == 'build' and args.no_build) or (phase == 'test' and args.skip_tests):
                continue
            for command in plugin.get(phase, []):
                argv = [arg.replace('{dshSource}', str(source)).replace('{pluginDir}', str(directory)) for arg in command]
                if args.dry_run:
                    print(f'  {key} {phase}: {shlex.join(argv)}')
    if args.dry_run:
        print('Would refresh file: snapshots and preserve unmanaged bundles.')
        print('Would save selection: ' + ', '.join(selected))
        print('Would ' + ('skip restart.' if args.no_restart else f'restart owned DSH on {config["server"]["port"]} after verification.'))
        return
    runtime = Path(os.environ.get('XDG_RUNTIME_DIR', f'/tmp/dsh-{os.getuid()}'))
    runtime.mkdir(parents=True, exist_ok=True)
    if runtime.stat().st_uid != os.getuid():
        raise ReloadError('Runtime directory belongs to another user')
    os.chmod(runtime, 0o700)
    pid_file, log_file = runtime/f'dsh-{config["profile"]}.pid', runtime/f'dsh-{config["profile"]}.log'
    with (runtime/'reload-dsh.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReloadError('Another reload-dsh is running')
        current = owned_process(pid_file, source)
        if not args.no_restart and port_open(config['server']) and current is None:
            raise ReloadError('Port is occupied by an unowned process; refusing to restart')
        env = dict(os.environ, DSH_SOURCE=str(source), DSH_HOME=str(dsh_home))
        for key in selected:
            plugin = config['plugins'][key]
            print(f'==> Build/check {key}', flush=True)
            for phase in ('build', 'test'):
                if (phase == 'build' and args.no_build) or (phase == 'test' and args.skip_tests):
                    continue
                for command in plugin.get(phase, []):
                    run([arg.replace('{dshSource}', str(source)).replace('{pluginDir}', plugin['path']) for arg in command], plugin['path'], env)
        backup = Path(tempfile.mkdtemp(prefix=f'dsh-{config["profile"]}-backup-', dir=runtime))
        shutil.copytree(profile_dir, backup/'profile', symlinks=True)
        shutil.copy2(config_path, backup/'reload.json')
        print(f'==> Profile backup: {backup}', flush=True)
        stopped = False
        try:
            for key in selected:
                plugin = config['plugins'][key]
                dependencies = read_json(profile_dir/'package.json').get('dependencies', {})
                if plugin['package'] in dependencies:
                    run(['pnpm', 'dsh', 'plugin', '--profile', config['profile'], 'remove', plugin['package']], source, env)
                run(['pnpm', 'dsh', 'plugin', '--profile', config['profile'], 'add', f'file:{plugin["path"]}', '--ignore-scripts'], source, env)
            write_json(profile_dir/'package.json', profile_selection(read_json(profile_dir/'package.json'), config, selected))
            dump = run(['pnpm', '--silent', 'dsh', '--profile', config['profile'], '--dump-config'], source, env, capture=True)
            verify_dump(dump, config, selected)
            print('==> Selected bundles and required profile plugins verified', flush=True)
            if not args.no_restart:
                stop(pid_file, source)
                stopped = True
                launch(config, source, env, pid_file, log_file, args.show_login)
            config['enabled'] = selected
            write_json(config_path, config)
        except BaseException as failure:
            print(f"Reload failed: {redact(str(failure))}", file=sys.stderr)
            # Keep the failing state for diagnosis and restore exact previous snapshots.
            if stopped:
                stop(pid_file, source)
            shutil.move(str(profile_dir), str(backup/'failed-profile'))
            shutil.copytree(backup/'profile', profile_dir, symlinks=True)
            shutil.copy2(backup/'reload.json', config_path)
            print(f'==> Restored previous profile; failed snapshot retained at {backup}', file=sys.stderr)
            if stopped and current is not None:
                try:
                    launch(config, source, env, pid_file, log_file, False)
                except Exception as e:
                    print(f'Previous DSH restart failed: {e}', file=sys.stderr)
            raise
        print('==> Saved selection: ' + (', '.join(selected) or '(none)'))


def main():
    args = parser().parse_args()
    path = Path(args.config).expanduser().resolve()
    try:
        config = read_json(path)
        validate(config)
        execute(config, select_plugins(config, args), args, path)
    except (ReloadError, OSError, ValueError, KeyError) as e:
        print(f'ERROR: {redact(str(e))}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Interrupted.', file=sys.stderr)
        return 130
    return 0


if __name__ == '__main__':
    sys.exit(main())
