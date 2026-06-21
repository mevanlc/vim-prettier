const fs = require('fs');
const os = require('os');
const path = require('path');
const HeadlessRemoteClient = require('./vim-driver/HeadlessRemoteClient');
const Server = require('./vim-driver/Server');

const HOST = '127.0.0.1';
const PORT = Number(process.env.VIM_DRIVER_PORT || 10000 + (process.pid % 50000));
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = `${__dirname}/fixtures`;
const VIMRC = `${__dirname}/vimrc`;
const FORMAT_FIXTURE_LANE = process.env.PRETTIER_FORMATTING_FIXTURE_LANE || 'all';
const CORE_FORMATTING_FIXTURES = new Set([
  'foo.css',
  'foo.graphql',
  'foo.html',
  'foo.js',
  'foo.json',
  'foo.less',
  'foo.md',
  'foo.scss',
  'foo.ts',
  'foo.vue',
  'foo.yaml',
]);
const QUARANTINED_FORMATTING_FIXTURES = new Set(['foo.lua', 'foo.rb']);
const tempProjectRoots = [];

const isSelectedFormattingFixture = file => {
  if (FORMAT_FIXTURE_LANE === 'known-passing') {
    return !QUARANTINED_FORMATTING_FIXTURES.has(file);
  }

  if (FORMAT_FIXTURE_LANE === 'quarantined') {
    return QUARANTINED_FORMATTING_FIXTURES.has(file);
  }

  if (FORMAT_FIXTURE_LANE === 'core') {
    return CORE_FORMATTING_FIXTURES.has(file);
  }

  if (FORMAT_FIXTURE_LANE === 'all') {
    return true;
  }

  throw new Error(`Unknown PRETTIER_FORMATTING_FIXTURE_LANE: ${FORMAT_FIXTURE_LANE}`);
};

const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;

const vimExecutable = [
  process.env.VIM_EXECUTABLE || 'vim',
  process.env.VIM_EXECUTABLE_ARGS || '',
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

const vimStringExpr = value =>
  value
    .split('"')
    .map(vimString)
    .join(' . nr2char(34) . ');

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

const writeFakePrettierExecutable = (prettierPath, options = {}) => {
  const script = [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    "  printf '3.0.3\\n'",
    '  exit 0',
    'fi',
  ];

  if (options.expectedStdinFilepath) {
    script.push(
      `expected_stdin_filepath=${shellQuote(options.expectedStdinFilepath)}`,
      'found_stdin_filepath=0',
      'for arg in "$@"; do',
      '  if [ "$arg" = "--stdin-filepath=$expected_stdin_filepath" ]; then',
      '    found_stdin_filepath=1',
      '  fi',
      'done',
      'if [ "$found_stdin_filepath" != "1" ]; then',
      "  printf '%s\\n' 'missing expected stdin filepath' >&2",
      '  exit 2',
      'fi'
    );
  }

  if (Object.prototype.hasOwnProperty.call(options, 'formattedOutput')) {
    if (options.delaySeconds) {
      script.push(`sleep ${options.delaySeconds}`);
    }

    script.push(
      'cat >/dev/null',
      `printf '%s\\n' ${shellQuote(options.formattedOutput)}`
    );
  } else if (options.stderr) {
    if (options.delaySeconds) {
      script.push(`sleep ${options.delaySeconds}`);
    }

    script.push(
      'cat >/dev/null',
      `printf '%s\\n' ${shellQuote(options.stderr)} >&2`,
      `exit ${options.exitCode || 1}`
    );
  } else {
    if (options.delaySeconds) {
      script.push(`sleep ${options.delaySeconds}`);
    }

    script.push('cat >/dev/null');
  }

  script.push('exit 0');

  fs.writeFileSync(prettierPath, script.join('\n') + '\n');
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

const createShellSafetyPrettierFixture = () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vim-prettier shell "quote" ')
  );
  const binDir = path.join(root, 'node_modules', '.bin');
  const sourceDir = path.join(root, 'src with spaces');
  const prettierPath = path.join(binDir, 'prettier');
  const sourcePath = path.join(sourceDir, 'index "quote".js');

  tempProjectRoots.push(root);
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  writeFakePrettierExecutable(prettierPath, {
    expectedStdinFilepath: sourcePath,
    formattedOutput: 'const formatted = true;',
  });
  fs.writeFileSync(sourcePath, 'const formatted=false\n');

  return { root, prettierPath, sourcePath };
};

const createAsyncPrettierFixture = (files, options = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vim-prettier-async-'));
  const binDir = path.join(root, 'node_modules', '.bin');
  const sourceDir = path.join(root, 'src');
  const prettierPath = path.join(binDir, 'prettier');
  const sourcePaths = {};

  tempProjectRoots.push(root);
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  writeFakePrettierExecutable(prettierPath, options);

  Object.keys(files).forEach(file => {
    const sourcePath = path.join(sourceDir, file);
    fs.writeFileSync(sourcePath, files[file]);
    sourcePaths[file] = sourcePath;
  });

  return { root, prettierPath, sourcePaths };
};

const createConfigDiscoveryFixture = configFileName => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vim-prettier-config-'));
  const sourceDir = path.join(root, 'src', 'nested');
  const sourcePath = path.join(sourceDir, 'index.js');

  tempProjectRoots.push(root);
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(sourcePath, "const configDiscovery = 'value';\n");

  if (configFileName) {
    fs.writeFileSync(path.join(root, configFileName), 'export default {};\n');
  }

  return { root, sourcePath };
};

const setVimCwd = dir =>
  remote.execute(`execute 'cd' fnameescape(${vimStringExpr(dir)})`);

const editFile = file =>
  remote.execute(`execute 'edit' fnameescape(${vimStringExpr(file)})`);

const resolveConfigFlags = config =>
  remote.eval(`prettier#resolver#config#resolve(${config}, 0, 1, 1)`);

const isDefaultConfigPresent = () =>
  remote.eval('prettier#IsConfigPresent(g:prettier#autoformat_config_files)');

const expectNoPluginFlags = flags => {
  expect(flags).not.toContain('--plugin=');
};

const countPluginFlags = flags => (flags.match(/--plugin=/g) || []).length;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeoutAfter = (promise, ms) => {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
};
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
        const filename = await timeoutAfter(remote.call('expand', ['%:p']), 5000);

        if (filename) {
          // restore the file
          await timeoutAfter(remote.execute('earlier 1d | noautocmd | write'), 5000);
        }
      } catch (e) {
      }
    }
  } finally {
    await timeoutAfter(remote.close(), 5000).catch(() => {});
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

  test('Prettier config overrides do not mutate buffer filetype defaults', async () => {
    await remote.edit(`${FIXTURES_DIR}/foo.css`);
    await remote.execute('let b:prettier_test_original_args = deepcopy(b:prettier_ft_default_args)');

    try {
      await remote.execute(
        "call prettier#Prettier(0, 1, line('$'), 0, {'singleQuote': 'false'})"
      );

      const defaultsUnchanged = await remote.eval(
        'b:prettier_ft_default_args ==# b:prettier_test_original_args'
      );

      expect(defaultsUnchanged).toBe(1);
    } finally {
      await remote.execute('unlet b:prettier_test_original_args');
    }
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

    test.each([
      ['PHP', 'foo.php'],
      ['XML', 'foo.xml'],
      ['Svelte', 'foo.svelte'],
    ])('injects bundled %s plugin for bundled Prettier', async (_name, fixture) => {
      await setVimCwd(__dirname);
      await remote.edit(`${FIXTURES_DIR}/${fixture}`);

      const resolvedPath = await remote.eval(
        'prettier#resolver#executable#getPath()'
      );
      const bundledPluginPath = await remote.eval(
        "get(b:prettier_ft_default_args, 'bundledPlugins', [''])[0]"
      );
      const flags = await resolveConfigFlags('b:prettier_ft_default_args');

      expect(resolvedPath).toBe(path.join(REPO_ROOT, 'node_modules', '.bin', 'prettier'));
      expect(bundledPluginPath).toContain(path.join(REPO_ROOT, 'node_modules'));
      expect(flags).toContain(`--plugin='${bundledPluginPath}'`);
      expect(countPluginFlags(flags)).toBe(1);
    });

    test.each([
      ['PHP', 'php'],
      ['XML', 'xml'],
      ['Svelte', 'svelte'],
    ])('does not inject bundled %s plugin for project-local Prettier', async (_name, extension) => {
      const project = createProjectLocalPrettierFixture(extension);

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

  describe('Prettier config file discovery', () => {
    test('detects modern config names from the buffer project tree', async () => {
      const project = createConfigDiscoveryFixture('prettier.config.mjs');

      await setVimCwd(__dirname);
      await editFile(project.sourcePath);

      const cwd = await remote.eval('getcwd()');
      const isConfigPresent = await isDefaultConfigPresent();

      expect(path.resolve(cwd)).toBe(path.resolve(__dirname));
      expect(path.resolve(cwd)).not.toBe(path.resolve(project.root));
      expect(isConfigPresent).toBe(1);
    });

    test('does not detect missing config from the buffer project tree', async () => {
      const project = createConfigDiscoveryFixture();

      await setVimCwd(__dirname);
      await editFile(project.sourcePath);

      const isConfigPresent = await isDefaultConfigPresent();

      expect(isConfigPresent).toBe(0);
    });
  });

  describe('Prettier command shell safety', () => {
    test('shellescapes stdin filepath for paths containing spaces and quotes', async () => {
      const project = createShellSafetyPrettierFixture();

      await editFile(project.sourcePath);

      const flags = await resolveConfigFlags('{}');
      const expectedPath = await remote.eval(
        "shellescape(simplify(expand('%:p')))"
      );

      expect(flags).toContain(`--stdin-filepath=${expectedPath}`);
      expect(flags).not.toContain(`--stdin-filepath="${project.sourcePath}"`);
    });

    test('builds argv args without shellescaping paths containing spaces and quotes', async () => {
      const project = createShellSafetyPrettierFixture();
      const pluginPath = path.join(project.root, 'plugin path', 'prettier-plugin-example.js');

      await editFile(project.sourcePath);

      const args = await remote.eval(
        `prettier#resolver#config#resolve_args({'plugins': ${vimString(pluginPath)}}, 0, 1, 1)`
      );

      expect(args).toContain(`--stdin-filepath=${project.sourcePath}`);
      expect(args).toContain(`--plugin=${pluginPath}`);
      expect(args).not.toContain(`--stdin-filepath='${project.sourcePath}'`);
      expect(args).not.toContain(`--plugin='${pluginPath}'`);
    });

    test('builds command argv while preserving shell-string fallback', async () => {
      const project = createShellSafetyPrettierFixture();

      await editFile(project.sourcePath);

      const command = await remote.eval(
        `prettier#command#build(${vimString(project.prettierPath)}, {}, 0, 1, 1)`
      );
      const shellExecutable = await remote.eval(
        `shellescape(${vimString(project.prettierPath)})`
      );
      const shellFilepath = await remote.eval(
        "shellescape(simplify(expand('%:p')))"
      );

      expect(command.argv[0]).toBe(project.prettierPath);
      expect(command.argv).toContain(`--stdin-filepath=${project.sourcePath}`);
      expect(command.shell).toContain(shellExecutable);
      expect(command.shell).toContain(`--stdin-filepath=${shellFilepath}`);
    });

    test(':Prettier runs a project-local executable from a shell-escaped path', async () => {
      const project = createShellSafetyPrettierFixture();

      await setVimCwd(__dirname);
      await editFile(project.sourcePath);

      const resolvedPath = await remote.eval(
        'prettier#resolver#executable#getPath()'
      );

      expect(resolvedPath).toBe(project.prettierPath);

      await remote.execute('Prettier');

      expect(await getBufferContents(remote)).toBe('const formatted = true;');
    });
  });

  describe('Prettier async safety', () => {
    test(':PrettierAsync updates the buffer without writing to disk', async () => {
      const project = createAsyncPrettierFixture(
        { 'manual.js': 'const formatted=false\n' },
        { formattedOutput: 'const formatted = true;' }
      );
      const sourcePath = project.sourcePaths['manual.js'];

      await editFile(sourcePath);
      await remote.execute('PrettierAsync');
      await waitUntil(async () => (await getBufferContents(remote)) === 'const formatted = true;');

      expect(await getBufferContents(remote)).toBe('const formatted = true;');
      expect(fs.readFileSync(sourcePath, 'utf8')).toBe('const formatted=false\n');
    });

    test('runs async jobs independently per buffer', async () => {
      const project = createAsyncPrettierFixture(
        {
          'one.js': 'const one=false\n',
          'two.js': 'const two=false\n',
        },
        { delaySeconds: 1, formattedOutput: 'const formatted = true;' }
      );

      await remote.execute('set hidden');
      await editFile(project.sourcePaths['one.js']);
      const firstBuffer = await remote.eval('bufnr("%")');
      await remote.execute('PrettierAsync');
      await editFile(project.sourcePaths['two.js']);
      await remote.execute('PrettierAsync');

      await waitUntil(async () => (await getBufferContents(remote)) === 'const formatted = true;', 3000);
      expect(await getBufferContents(remote)).toBe('const formatted = true;');

      await remote.execute(`execute 'buffer' ${firstBuffer}`);
      await waitUntil(async () => (await getBufferContents(remote)) === 'const formatted = true;', 3000);
      expect(await getBufferContents(remote)).toBe('const formatted = true;');
    });

    test('does not replace a buffer changed after async formatting starts', async () => {
      const project = createAsyncPrettierFixture(
        { 'stale.js': 'const stale=false\n' },
        { delaySeconds: 1, formattedOutput: 'const formatted = true;' }
      );

      await editFile(project.sourcePaths['stale.js']);
      await remote.execute('PrettierAsync');
      await remote.execute("call setline(1, 'const userEdit = true;')");
      await sleep(1500);

      expect(await getBufferContents(remote)).toBe('const userEdit = true;');

      await remote.execute('PrettierAsync');
      await waitUntil(async () => (await getBufferContents(remote)) === 'const formatted = true;', 3000);
      expect(await getBufferContents(remote)).toBe('const formatted = true;');
    });

    test('resets async job state after ignored empty output', async () => {
      const project = createAsyncPrettierFixture(
        { 'ignored.js': 'const ignored=false\n' },
        { delaySeconds: 1 }
      );
      const sourcePath = project.sourcePaths['ignored.js'];

      await editFile(sourcePath);
      await remote.execute('PrettierAsync');
      await sleep(1500);
      writeFakePrettierExecutable(project.prettierPath, {
        formattedOutput: 'const formatted = true;',
      });
      await remote.execute('PrettierAsync');
      await waitUntil(async () => (await getBufferContents(remote)) === 'const formatted = true;');

      expect(await getBufferContents(remote)).toBe('const formatted = true;');
    });

    test('opens quickfix and resets async job state after parser errors', async () => {
      const project = createAsyncPrettierFixture(
        { 'broken.js': 'const broken =\n' },
        { stderr: 'stdin: SyntaxError: Unexpected token (1:15)' }
      );

      await editFile(project.sourcePaths['broken.js']);
      await remote.execute('let g:prettier#quickfix_auto_focus = 0');
      await remote.execute('PrettierAsync');
      await waitUntil(async () => Number(await remote.eval('len(getqflist())')) > 0);

      expect(await remote.eval('getqflist()[0].text')).toBe('Unexpected token');

      writeFakePrettierExecutable(project.prettierPath, {
        formattedOutput: 'const formatted = true;',
      });
      await remote.execute('PrettierAsync');
      await waitUntil(async () => (await getBufferContents(remote)) === 'const formatted = true;');

      expect(await getBufferContents(remote)).toBe('const formatted = true;');
      await remote.execute('let g:prettier#quickfix_auto_focus = 1');
    });
  });
}

// run formatting tests in all fixtures
fs.readdirSync(FIXTURES_DIR).forEach(file => assertFormatting(file));
