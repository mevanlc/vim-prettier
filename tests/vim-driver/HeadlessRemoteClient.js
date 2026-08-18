'use strict';

const RemoteClient = require('./RemoteClient');
const VimProcess = require('./VimProcess');
const { createLogger } = require('./Logger');

const DEFAULT_EXEC = 'vim';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;
const DEFAULT_CONNECT_TIMEOUT = 10000;

const Logger = createLogger('vim-driver');
let nextClientId = 0;

class HeadlessRemoteClient {
  constructor(opts = {}) {
    nextClientId += 1;
    this._id = `vim-prettier-test-${process.pid}-${nextClientId}`;
    this._opts = opts;
    this._subscribers = [];
    this._remoteAssignmentSubscribers = [];
  }

  getId() {
    return this._id;
  }

  isConnected() {
    const remote = this._remote;
    return remote != null ? remote.isConnected() : false;
  }

  connect(server) {
    return new Promise((resolve, reject) => {
      if (this._remote != null) {
        Logger.warn(`Failed to connect to server. Client ${this._id} is already connected to a server.`);
        reject('HeadlessRemoteClient is already connected.');
        return;
      }

      const subscription = server.subscribe({
        onConnect: remote => {
          if (settled) {
            return;
          }
          if (remote.getId() === this._id) {
            cleanup();
            this._assignRemote(remote);
            resolve(this);
          }
        },
      });

      let settled = false;
      let processSubscription;
      let timeout;
      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        subscription.unsubscribe();
        if (processSubscription) {
          processSubscription.unsubscribe();
        }
      };

      const fail = async error => {
        if (settled) {
          return;
        }
        cleanup();
        if (this._vimProcess != null) {
          await this._vimProcess.kill();
          this._vimProcess = null;
        }
        reject(error);
      };

      const opts = this._opts;
      this._vimProcess = new VimProcess(this._id, {
        executable: opts.executable != null ? opts.executable : DEFAULT_EXEC,
        host: opts.host != null ? opts.host : DEFAULT_HOST,
        port: opts.port != null ? opts.port : DEFAULT_PORT,
      });
      processSubscription = this._vimProcess.subscribe({
        onError: error => {
          fail(error);
        },
        onExit: (code, signal) => {
          fail(new Error(`Vim process exited before connecting: code=${code}, signal=${signal}`));
        },
      });
      timeout = setTimeout(() => {
        const output = this._vimProcess != null ? this._vimProcess.getOutput() : '';
        const outputMessage = output ? `\nEditor output:\n${output}` : '';
        fail(new Error(`Timed out connecting HeadlessRemoteClient ${this._id}${outputMessage}`));
      }, opts.connectTimeout != null ? opts.connectTimeout : DEFAULT_CONNECT_TIMEOUT);
    });
  }

  async call(name, arglist) {
    this._assertConnected('call');
    return this._remote.call(name, arglist);
  }

  async edit(path) {
    this._assertConnected('edit');
    return this._remote.edit(path);
  }

  async eval(string) {
    this._assertConnected('eval');
    return this._remote.eval(string);
  }

  async execute(command) {
    this._assertConnected('execute');
    return this._remote.execute(command);
  }

  async close() {
    try {
      if (this._remote != null) {
        await this._remote.close();
      }
    } finally {
      if (this._vimProcess != null) {
        await this._vimProcess.kill();
        this._vimProcess = null;
      }
      this._unassignRemote();
    }
    return this;
  }

  async send(payload) {
    this._assertConnected('send');
    return this._remote.send(payload);
  }

  subscribe(subscriber) {
    const subscribers = this._subscribers;
    subscribers.push(subscriber);

    let remoteSubscription;
    if (this._remote != null) {
      remoteSubscription = this._remote.subscribe(subscriber);
    }

    const remoteAssignmentObserver = this._subscribeRemoteAssignment({
      onAssign: remote => {
        if (remoteSubscription) {
          remoteSubscription.unsubscribe();
        }
        remoteSubscription = remote.subscribe(subscriber);
      },
      onUnassign: () => {
        if (remoteSubscription) {
          remoteSubscription.unsubscribe();
          remoteSubscription = null;
        }
      },
    });

    return {
      unsubscribe: () => {
        const index = subscribers.indexOf(subscriber);
        if (index !== -1) {
          subscribers.splice(index, 1);
        }

        remoteAssignmentObserver.unsubscribe();

        if (remoteSubscription) {
          remoteSubscription.unsubscribe();
        }
      },
    };
  }

  _assertConnected(action) {
    if (this._remote == null) {
      const msg = `HeadlessRemoteClient ${this._id} not connected. Failed to ${action}.`;
      Logger.error(msg);
      throw msg;
    }
  }

  _assignRemote(remote) {
    this._remote = remote;
    this._remoteAssignmentSubscribers.forEach(subscriber => {
      if (subscriber.onAssign) {
        subscriber.onAssign(remote);
      }
    });
    this._subscribers.forEach(subscriber => {
      if (subscriber.onConnect) {
        subscriber.onConnect();
      }
    });
  }

  _unassignRemote() {
    if (this._remote == null) {
      return;
    }

    const remote = this._remote;
    this._remote = null;
    this._remoteAssignmentSubscribers.forEach(subscriber => {
      if (subscriber.onUnassign) {
        subscriber.onUnassign(remote);
      }
    });
  }

  _subscribeRemoteAssignment(subscriber) {
    const subscribers = this._remoteAssignmentSubscribers;
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
}

module.exports = HeadlessRemoteClient;
