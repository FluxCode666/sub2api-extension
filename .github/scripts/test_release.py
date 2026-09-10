import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


prepare = module('prepare-release')
publish = module('publish-release')


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.directory.name)
        self.env = patch.dict(os.environ, {
            'GITHUB_REF_TYPE': 'tag', 'RELEASE_TAG': 'v0.6.0',
            'GITHUB_REPOSITORY': 'FluxCode666/sub2api-extension',
            'GITHUB_OUTPUT': 'output', 'GITHUB_STEP_SUMMARY': 'summary',
            'RELEASE_IMAGE': 'ghcr.io/fluxcode666/sub2api-extension',
            'APP_DIGEST': 'sha256:' + 'a' * 64,
            'GITHUB_SHA': 'c' * 40, 'IS_LATEST': 'true', 'IS_PRERELEASE': 'false',
        })
        self.env.start()
        Path('CHANGELOG.md').write_text('# Changelog\n\n## [0.6.0] - 2026-09-09\n\n新增管理员更新功能。\n\n## [0.5.0]\n旧内容\n')
        Path('release-assets').mkdir()
        for arch in ('amd64', 'arm64'):
            Path(f'release-assets/sub2api-extension_linux_{arch}.tar.gz').write_bytes(b'archive')
        Path('release-assets/checksums.txt').write_text('checksums\n')

    def tearDown(self):
        self.env.stop()
        os.chdir(self.previous)
        self.directory.cleanup()

    def test_notes_and_latest(self):
        with patch.object(prepare, 'github', side_effect=[None, {'tag_name': 'v0.5.0'}]):
            prepare.main()
        self.assertIn('latest=true', Path('output').read_text())
        self.assertIn('新增管理员更新功能', Path('release-notes.md').read_text())
        self.assertNotIn('旧内容', Path('release-notes.md').read_text())

    def test_older_release_does_not_replace_latest(self):
        with patch.object(prepare, 'github', side_effect=[None, {'tag_name': 'v0.10.0'}]):
            prepare.main()
        self.assertIn('latest=false', Path('output').read_text())

    def test_prerelease_is_never_latest(self):
        os.environ['RELEASE_TAG'] = 'v0.7.0-rc.1'
        Path('CHANGELOG.md').write_text('## [v0.7.0-rc.1]\n预发布验证\n')
        with patch.object(prepare, 'github', return_value=None):
            prepare.main()
        self.assertIn('latest=false', Path('output').read_text())
        self.assertIn('prerelease=true', Path('output').read_text())

    def test_branch_invalid_tag_missing_notes_and_public_version_fail(self):
        for tag in ('v01.0.0', 'v1.0.0;id', 'v1.0.0-01', 'main'):
            os.environ['RELEASE_TAG'] = tag
            with self.assertRaises(RuntimeError):
                prepare.main()
        os.environ['RELEASE_TAG'] = 'v0.6.0'
        os.environ['GITHUB_REF_TYPE'] = 'branch'
        with self.assertRaises(RuntimeError):
            prepare.main()
        os.environ['GITHUB_REF_TYPE'] = 'tag'
        with patch.object(prepare, 'github', return_value={'draft': False}), self.assertRaises(RuntimeError):
            prepare.main()
        Path('CHANGELOG.md').write_text('# Empty')
        with patch.object(prepare, 'github', return_value=None), self.assertRaises(RuntimeError):
            prepare.main()

    def test_manifest_and_assets_are_uploaded_before_publish(self):
        with patch.object(publish.subprocess, 'run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = '{"isDraft":true}'
            publish.main()
        commands = [call.args[0] for call in run.call_args_list]
        upload_index = next(i for i, args in enumerate(commands) if 'upload' in args)
        publish_index = next(i for i, args in enumerate(commands) if '--draft=false' in args)
        self.assertLess(upload_index, publish_index)
        manifest = json.loads(Path('release-manifest.json').read_text())
        self.assertEqual(manifest['version'], 'v0.6.0')
        self.assertEqual(manifest['digest'], 'sha256:' + 'a' * 64)

    def test_missing_digest_never_publishes(self):
        os.environ['APP_DIGEST'] = ''
        with patch.object(publish.subprocess, 'run') as run, self.assertRaises(RuntimeError):
            publish.main()
        run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
