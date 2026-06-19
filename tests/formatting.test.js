const fs = require('fs');
const os = require('os');
const path = require('path');
const HeadlessRemoteClient = require('vim-driver/dist/HeadlessRemoteClient');
const Server = require('vim-driver/dist/Server');

const HOST = '127.0.0.1';
const PORT = 1337;
const FIXTURES_DIR = `${__dirname}/fixtures`;
const VIMRC = `${__dirname}/vimrc`;
const FORMAT_FIXTURE_LANE = process.env.PRETTIER_FORMATTING_FIXTURE_LANE || 'all';
const QUARANTINED_FORMATTING_FIXTURES = new Set(['foo.lua', 'foo.rb']);
const tempProjectRoots = [];

const isSelectedFormattingFixture = file => {
  if (FORMAT_FIXTURE_LANE === 'known-passing') {
    return !QUARANTINED_FORMATTING_FIXTURES.has(file);
  }

  if (FORMAT_FIXTURE_LANE === 'quarantined') {
    return QUARANTINED_FORMATTING_FIXTURES.has(file);
  }

  if (FORMAT_FIXTURE_LANE === 'all') {
    return true;
  }

  throw new Error(`Unknown PRETTIER_FORMATTING_FIXTURE_LANE: ${FORMAT_FIXTURE_LANE}`);
};

const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;

const vimExecutable = [
  process.env.VIM_EXECUTABLE || 'vim',
  '-Nu',
  shellQuote(VIMRC),
  '-n',
  '-i NONE',
].join(' ');

let server;
let remote;

jest.setTimeout(15000);

const getBufferContents = async remote =>
  (await remote.call('getline', [1, '$'])).join('\n');

const vimString = value => `'${value.replace(/'/g, "''")}'`;

const removeDirectorySync = dir => {
  if (!fs.existsSync(dir)) {
    return;
  }

  fs.readdirSync(dir).forEach(entry => {
    const entryPath = path.join(dir, entry);

    if (fs.lstatSync(entryPath).isDirectory()) {
      removeDirectorySync(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  });

  fs.rmdirSync(dir);
};

const cleanupTempProjects = () => {
  while (tempProjectRoots.length > 0) {
    removeDirectorySync(tempProjectRoots.pop());
  }
};

const writeFakePrettierExecutable = prettierPath => {
  fs.writeFileSync(
    prettierPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      "  printf '3.0.3\\n'",
      'fi',
      'exit 0',
    ].join('\n') + '\n'
  );
  fs.chmodSync(prettierPath, 0o755);
};

const createProjectLocalPrettierFixture = extension => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vim-prettier-local-'));
  const binDir = path.join(root, 'node_modules', '.bin');
  const sourceDir = path.join(root, 'src', 'nested');
  const prettierPath = path.join(binDir, 'prettier');
  const sourcePath = path.join(sourceDir, `index.${extension}`);

  tempProjectRoots.push(root);
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  writeFakePrettierExecutable(prettierPath);
  fs.writeFileSync(
    sourcePath,
    extension === 'php' ? "<?php\n$foo = 'bar';\n" : "const foo = 'bar';\n"
  );

  return { root, prettierPath, sourcePath };
};

const setVimCwd = dir =>
  remote.execute(`execute 'cd' fnameescape(${vimString(dir)})`);

const resolveConfigFlags = config =>
  remote.eval(`prettier#resolver#config#resolve(${config}, 0, 1, 1)`);

const expectNoPluginFlags = flags => {
  expect(flags).not.toContain('--plugin=');
};

const countPluginFlags = flags => (flags.match(/--plugin=/g) || []).length;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitUntil = (condition, timeout = 2000) => {
  return new Promise(resolve => {
    let isTimedOut = false;
    let timeoutId = null;

    const check = () => {
      const promise = condition();
      promise.then(result => {
        if (!isTimedOut && result === true) {
          clearTimeout(timeoutId);
          resolve();
        } else if (!isTimedOut) {
          check();
        }
      });
    };

    timeoutId = setTimeout(() => {
      isTimedOut = true;
      resolve();
    }, timeout);
  });
};

const assertFormatting = (file) => {
  const filename = path.basename(file);
  const formattingTest = isSelectedFormattingFixture(file) ? test : test.skip;

  formattingTest(`Prettier formats ${filename} file with :Prettier command`, async () => {
    await remote.edit(`${FIXTURES_DIR}/${file}`);

    const lines = await getBufferContents(remote);

    // run sync formatting
    await remote.execute('Prettier');

    const updatedLines = await getBufferContents(remote);

    // we now check that we have indeed formatted the code
    expect(updatedLines).not.toBe(lines);

    // check snapshot
    expect(updatedLines).toMatchSnapshot();
  });

  formattingTest(`Prettier formats ${filename} file with :PrettierAsync command`, async () => {
    await remote.edit(`${FIXTURES_DIR}/${file}`);

    const lines = await getBufferContents(remote);

    // run async formatting
    await remote.execute('PrettierAsync');

    const unmodifiedLines = await getBufferContents(remote);

    // async should not happen immediatly so content should still remain the same
    expect(unmodifiedLines).toBe(lines);

    // we now will wait until prettier has finally updated the content async
    await waitUntil(async () => (await getBufferContents(remote)) !== lines);

    const updatedLines = await getBufferContents(remote);

    // we now check that we have indeed formatted the code
    expect(lines).not.toBe(updatedLines);

    // check snapshot
    expect(updatedLines).toMatchSnapshot();
  });
};

beforeAll(async () => {
  server = new Server();
  await server.listen(HOST, PORT);
});

afterAll(async () => {
  await server.close();
});

// should ensure that we cache original fixture contents and
// restore it on the afterEach
beforeEach(async () => {
  remote = new HeadlessRemoteClient({
    executable: vimExecutable,
    host: HOST,
    port: PORT,
  });
  await remote.connect(server);
});

afterEach(async () => {
  try {
    if (remote.isConnected()) {
      try {
        const filename = await remote.call('expand', ['%:p']);

        if (filename) {
          // restore the file
          await remote.execute('earlier 1d | noautocmd | write');
        }
      } catch (e) {
      } finally {
        await remote.close();
      }
    }
  } finally {
    cleanupTempProjects();
  }
});

//test('PrettierVersion returns pluggin version', async () => {
//  const result = await remote.execute('PrettierVersion');
//  expect(result).toMatchSnapshot();
//});

if (FORMAT_FIXTURE_LANE === 'all') {
  test('Prettier config version detection works inside vim-driver execute', async () => {
    await remote.edit(`${FIXTURES_DIR}/foo.js`);
    await expect(
      remote.execute('call prettier#resolver#config#resolve({}, 0, 1, 1)')
    ).resolves.toBeDefined();
  });

  describe('Prettier config plugins flags', () => {
    test('ignores empty string plugin config', async () => {
      const flags = await resolveConfigFlags(`{'plugins': ''}`);

      expectNoPluginFlags(flags);
    });

    test('ignores empty list plugin config', async () => {
      const flags = await resolveConfigFlags(`{'plugins': []}`);

      expectNoPluginFlags(flags);
    });

    test('adds a string plugin path', async () => {
      const pluginPath = '/tmp/prettier-plugin-example.js';
      const flags = await resolveConfigFlags(
        `{'plugins': ${vimString(pluginPath)}}`
      );

      expect(flags).toContain(`--plugin='${pluginPath}'`);
      expect(countPluginFlags(flags)).toBe(1);
    });

    test('adds a list of plugin paths', async () => {
      const pluginPaths = [
        '/tmp/prettier-plugin-one.js',
        '/tmp/prettier-plugin-two.js',
      ];
      const flags = await resolveConfigFlags(
        `{'plugins': [${pluginPaths.map(vimString).join(', ')}]}`
      );

      expect(flags).toContain(`--plugin='${pluginPaths[0]}'`);
      expect(flags).toContain(`--plugin='${pluginPaths[1]}'`);
      expect(countPluginFlags(flags)).toBe(2);
    });

    test('ignores invalid plugin config type', async () => {
      const flags = await resolveConfigFlags(`{'plugins': 1}`);

      expectNoPluginFlags(flags);
    });

    test('shellescapes plugin paths containing spaces', async () => {
      const pluginPath = path.join(
        FIXTURES_DIR,
        'plugin path',
        'prettier-plugin-example.js'
      );
      const flags = await resolveConfigFlags(
        `{'plugins': ${vimString(pluginPath)}}`
      );

      expect(flags).toContain(`--plugin='${pluginPath}'`);
      expect(countPluginFlags(flags)).toBe(1);
    });

    test('falls back to restored global plugin config', async () => {
      const pluginPath = '/tmp/prettier-plugin-global.js';

      await remote.execute(
        'let g:prettier_test_plugins = deepcopy(g:prettier#config#plugins)'
      );

      try {
        await remote.execute(
          `let g:prettier#config#plugins = ${vimString(pluginPath)}`
        );

        const flags = await resolveConfigFlags('{}');

        expect(flags).toContain(`--plugin='${pluginPath}'`);
        expect(countPluginFlags(flags)).toBe(1);
      } finally {
        await remote.execute(
          'let g:prettier#config#plugins = g:prettier_test_plugins | unlet g:prettier_test_plugins'
        );
      }
    });
  });

  describe('Prettier config project-local Prettier behavior', () => {
    test('finds project-local Prettier from the buffer tree before Vim cwd', async () => {
      const project = createProjectLocalPrettierFixture('js');

      await setVimCwd(__dirname);
      await remote.edit(project.sourcePath);

      const cwd = await remote.eval('getcwd()');
      const resolvedPath = await remote.eval(
        'prettier#resolver#executable#getPath()'
      );

      expect(path.resolve(cwd)).toBe(path.resolve(__dirname));
      expect(path.resolve(cwd)).not.toBe(path.resolve(project.root));
      expect(resolvedPath).toBe(project.prettierPath);
    });

    test('continues past nested node_modules without Prettier', async () => {
      const project = createProjectLocalPrettierFixture('js');
      const nestedPackageDir = path.join(project.root, 'packages', 'app');
      const nestedSourceDir = path.join(nestedPackageDir, 'src');
      const nestedSourcePath = path.join(nestedSourceDir, 'index.js');

      fs.mkdirSync(path.join(nestedPackageDir, 'node_modules'), {
        recursive: true,
      });
      fs.mkdirSync(nestedSourceDir, { recursive: true });
      fs.writeFileSync(nestedSourcePath, "const nested = 'value';\n");

      await setVimCwd(__dirname);
      await remote.edit(nestedSourcePath);

      const resolvedPath = await remote.eval(
        'prettier#resolver#executable#getPath()'
      );

      expect(resolvedPath).toBe(project.prettierPath);
    });

    test('keeps user-defined Prettier path precedence over buffer-local Prettier', async () => {
      const project = createProjectLocalPrettierFixture('js');
      const overrideDir = path.join(project.root, 'override-bin');
      const overridePath = path.join(overrideDir, 'prettier');

      fs.mkdirSync(overrideDir);
      writeFakePrettierExecutable(overridePath);

      await remote.execute(
        `let g:prettier#exec_cmd_path = ${vimString(overridePath)}`
      );

      try {
        await setVimCwd(__dirname);
        await remote.edit(project.sourcePath);

        const resolvedPath = await remote.eval(
          'prettier#resolver#executable#getPath()'
        );

        expect(resolvedPath).toBe(overridePath);
      } finally {
        await remote.execute('let g:prettier#exec_cmd_path = 0');
      }
    });

    test('does not inject bundled PHP plugin for project-local Prettier', async () => {
      const project = createProjectLocalPrettierFixture('php');

      await setVimCwd(__dirname);
      await remote.edit(project.sourcePath);

      const resolvedPath = await remote.eval(
        'prettier#resolver#executable#getPath()'
      );
      const hasBundledPlugins = await remote.eval(
        "exists('b:prettier_ft_default_args') && has_key(b:prettier_ft_default_args, 'bundledPlugins') && len(b:prettier_ft_default_args.bundledPlugins) > 0"
      );
      const bundledPluginPath = await remote.eval(
        "get(b:prettier_ft_default_args, 'bundledPlugins', [''])[0]"
      );
      const flags = await resolveConfigFlags('b:prettier_ft_default_args');

      expect(resolvedPath).toBe(project.prettierPath);
      expect(hasBundledPlugins).toBe(1);
      expect(flags).not.toContain(bundledPluginPath);
      expectNoPluginFlags(flags);
    });
  });
}

// run formatting tests in all fixtures
fs.readdirSync(FIXTURES_DIR).forEach(file => assertFormatting(file));
