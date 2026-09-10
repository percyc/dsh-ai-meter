import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('reload_dsh', Path(__file__).parents[1]/'scripts/reload-dsh.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class ReloadTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((Path(__file__).parents[1]/'scripts/reload-dsh.example.json').read_text())

    def select(self, *args):
        return r.select_plugins(self.config, r.parser().parse_args(args))

    def test_selection_modes_and_package_alias(self):
        self.assertEqual(self.select(), ['cangzhi', 'ai-meter'])
        self.assertEqual(self.select('--plugins', 'dsh-ai-meter'), ['ai-meter'])
        self.assertEqual(self.select('--disable', 'ai-meter'), ['cangzhi'])
        self.assertEqual(self.select('--none', '--enable', 'ai-meter'), ['ai-meter'])
        self.assertEqual(self.select('--all', '--disable', 'cangzhi'), ['ai-meter'])

    def test_unknown_id_fails_before_any_work(self):
        with self.assertRaises(r.ReloadError):
            self.select('--plugins', 'ai-metre')

    def test_bundle_switch_preserves_other_plugins_and_settings(self):
        m = {'dsh': {'profile': {'bundles': ['base', 'dsh-cangzhi', 'foreign', 'dsh-ai-meter'], 'patchReload': 'live'}}, 'dependencies': {'dsh-cangzhi':'file:/test'}}
        result = r.profile_selection(m, self.config, ['ai-meter'])
        self.assertEqual(result['dsh']['profile']['bundles'], ['base', 'foreign', 'dsh-ai-meter'])
        self.assertEqual(result['dsh']['profile']['patchReload'], 'live')
        self.assertIn('dsh-cangzhi', result['dependencies'])
        self.assertEqual(r.profile_selection(result, self.config, [])['dsh']['profile']['bundles'], ['base', 'foreign'])

    def test_duplicate_packages_and_shell_string_commands_rejected(self):
        self.config['plugins']['ai-meter']['package'] = 'dsh-cangzhi'
        with self.assertRaises(r.ReloadError):
            r.validate(self.config)
        self.config['plugins']['ai-meter']['package'] = 'dsh-ai-meter'
        self.config['plugins']['ai-meter']['build'] = ['npm run build']
        with self.assertRaises(r.ReloadError):
            r.validate(self.config)

    def test_invalid_pid_identity_never_stopped(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'pid'; path.write_text('123 100\n')
            with patch.object(r, 'process_info', return_value={'start':'200', 'state':'S'}):
                with self.assertRaises(r.ReloadError):
                    r.owned_process(path, Path(d))

    def test_config_dump_accepts_quoted_package_names(self):
        self.config['requiredPackages'] = []
        self.config['requiredDisabledRows'] = ['directory-picker']
        dump = "- id: directory-picker\n  name: picker-auto\n  disabled: true\n- id: ai-meter\n  name: 'dsh-ai-meter'\n"
        r.verify_dump(dump, self.config, ['ai-meter'])
        with self.assertRaises(r.ReloadError):
            r.verify_dump(dump.replace('disabled: true','disabled: false'), self.config, ['ai-meter'])

    def test_atomic_configuration_and_token_redaction(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'config.json'; r.write_json(path, self.config)
            self.assertEqual(r.read_json(path), self.config)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(r.redact('http://localhost/?token=private-value&x=1'), 'http://localhost/?token=[REDACTED]&x=1')

    def test_dry_run_has_no_subprocess_or_config_writes(self):
        args = r.parser().parse_args(['--dry-run'])
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); source = root/'source'; source.mkdir(); (source/'package.json').write_text('{}')
            profile = root/'home/profiles/web'; profile.mkdir(parents=True); (profile/'package.json').write_text('{}')
            self.config.update(dshSource=str(source), dshHome=str(root/'home'))
            config = root/'config.json'; r.write_json(config, self.config)
            before = config.read_bytes()
            with patch.dict(r.os.environ, {'DSH_HOME':str(root/'home')}), patch.object(r, 'run') as run, patch.object(r, 'write_json') as write:
                r.execute(self.config, [], args, config)
                run.assert_not_called();write.assert_not_called()
            self.assertEqual(config.read_bytes(), before)

    def test_launcher_places_profile_before_app_arguments_and_accepts_auth_cookies(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); pid_file = root/'pid'; log_file = root/'log'
            child = MagicMock(pid=123); child.poll.return_value = None
            def spawn(argv, **kwargs):
                self.assertEqual(argv[:4], ['pnpm', 'dsh', '--profile', 'web'])
                self.assertTrue(kwargs['start_new_session'])
                kwargs['stdout'].write('dsh web: http://127.0.0.1:3080/?token=test-token\n')
                kwargs['stdout'].flush()
                return child
            opener = MagicMock(); opener.open.return_value.__enter__.return_value.status = 200
            with patch.object(r.subprocess, 'Popen', side_effect=spawn), patch.object(r, 'process_info', return_value={'start':'100'}), patch.object(r, 'port_open', side_effect=[False, True]), patch.object(r.urllib.request, 'build_opener', return_value=opener) as factory:
                r.launch(self.config, root, {}, pid_file, log_file, False)
                self.assertTrue(any(isinstance(item, r.urllib.request.HTTPCookieProcessor) for item in factory.call_args.args))
                self.assertEqual(pid_file.read_text(), '123 100\n')

    def test_registration_failure_restores_profile_and_selection(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); source = root/'source'; source.mkdir(); (source/'package.json').write_text('{}')
            profile = root/'home/profiles/web'; profile.mkdir(parents=True)
            original = {'dsh':{'profile':{'bundles':['base','dsh-cangzhi']}}}
            r.write_json(profile/'package.json', original)
            config_path = root/'config.json'; self.config.update(dshSource=str(source), dshHome=str(root/'home'))
            r.write_json(config_path, self.config)
            args = r.parser().parse_args(['--none', '--no-build', '--skip-tests', '--no-restart'])
            with patch.dict(r.os.environ, {'DSH_HOME':str(root/'home'), 'XDG_RUNTIME_DIR':str(root/'runtime')}), patch.object(r, 'run', side_effect=r.ReloadError('fixture dump failure')), patch.object(r.shutil, 'move', wraps=r.shutil.move) as move:
                with self.assertRaisesRegex(r.ReloadError, 'fixture dump failure'):
                    r.execute(self.config, [], args, config_path)
                move.assert_called_once()
            self.assertEqual(r.read_json(profile/'package.json'), original)
            self.assertEqual(r.read_json(config_path)['enabled'], ['cangzhi','ai-meter'])


if __name__ == '__main__':
    unittest.main()
