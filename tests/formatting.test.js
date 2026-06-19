const fs = require('fs');
const path = require('path');
const HeadlessRemoteClient = require('vim-driver/dist/HeadlessRemoteClient');
const Server = require('vim-driver/dist/Server');

const HOST = '127.0.0.1';
const PORT = 1337;
const FIXTURES_DIR = `${__dirname}/fixtures`;
const VIMRC = `${__dirname}/vimrc`;
const FORMAT_FIXTURE_LANE = process.env.PRETTIER_FORMATTING_FIXTURE_LANE || 'all';
const QUARANTINED_FORMATTING_FIXTURES = new Set(['foo.lua', 'foo.rb']);

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
}

// run formatting tests in all fixtures
fs.readdirSync(FIXTURES_DIR).forEach(file => assertFormatting(file));
