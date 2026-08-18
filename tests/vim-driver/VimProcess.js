'use strict';

const { spawn } = require('child_process');
const path = require('path');

class VimProcess {
  constructor(id, opts) {
    this._subscribers = [];
    this._exited = false;
    this._output = '';

    const commands = [];

    const sourcePath = path.join(__dirname, './VimDriverClient.vim');
    commands.push(`source ${sourcePath}`);

    if (id != null) {
      commands.push(`let g:vim_driver_client_id = '${id}'`);
    }

    commands.push(`call VimDriverClient#open('${opts.host}', ${opts.port})`);

    const shellCommand = `${opts.executable} -c ":${commands.join('|')}"`;
    this._process = spawn(shellCommand, { detached: true, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this._process.stdout.addListener('data', data => {
      this._appendOutput(data);
    });
    this._process.stderr.addListener('data', data => {
      this._appendOutput(data);
    });
    this._process.addListener('error', error => {
      this._subscribers.forEach(subscriber => {
        if (subscriber.onError) {
          subscriber.onError(error);
        }
      });
    });
    this._process.addListener('exit', (code, signal) => {
      this._exited = true;
      this._subscribers.forEach(subscriber => {
        if (subscriber.onExit) {
          subscriber.onExit(code, signal);
        }
      });
    });
  }

  subscribe(subscriber) {
    const subscribers = this._subscribers;
    subscribers.push(subscriber);
    return {
      unsubscribe: () => {
        const index = subscribers.indexOf(subscriber);
        if (index !== -1) {
          subscribers.splice(index, 1);
        }
      },
    };
  }

  getOutput() {
    return this._output;
  }

  _appendOutput(data) {
    this._output = `${this._output}${data.toString()}`.slice(-4000);
  }

  async kill() {
    return new Promise(resolve => {
      const child = this._process;
      if (this._exited || child.killed) {
        resolve(this);
        return;
      }
      let resolved = false;
      let killTimeout;
      const finish = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        clearTimeout(killTimeout);
        child.removeListener('close', finish);
        child.removeListener('exit', finish);
        resolve(this);
      };
      const onClose = () => {
        finish();
      };
      child.addListener('close', onClose);
      child.addListener('exit', onClose);
      try {
        global.process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        child.kill();
      }
      killTimeout = setTimeout(() => {
        try {
          global.process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          child.kill('SIGKILL');
        }
        finish();
      }, 2000);
    });
  }
}

module.exports = VimProcess;
