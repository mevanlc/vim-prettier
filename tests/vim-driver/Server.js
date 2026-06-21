'use strict';

const net = require('net');

const identifyClient = require('./identifyClient');
const { createLogger } = require('./Logger');
const RemoteClient = require('./RemoteClient');

const Logger = createLogger('vim-driver');

class Server {
  constructor() {
    this._onClose = () => {
      this._pendingIdentifications.forEach(identification => identification.cancel());
      this._pendingIdentifications.length = 0;
      this._subscribers.forEach(subscriber => {
        if (subscriber.onClose != null) {
          subscriber.onClose();
        }
      });
    };

    this._onConnection = socket => {
      const pendingIdentifications = this._pendingIdentifications;

      let abort;
      const abortPromise = new Promise(resolve => {
        abort = resolve;
      });

      const cancel = {
        cancel: () => {
          abort();
        },
      };
      pendingIdentifications.push(cancel);

      const removePendingIdentifcation = () => {
        const index = pendingIdentifications.indexOf(cancel);
        if (index !== -1) {
          pendingIdentifications.splice(index, 1);
        }
      };

      identifyClient(socket, abortPromise).then(
        ([identifiedSocket, id]) => {
          Logger.debug(`client connected as: ${id}`);
          this._onIdentification(identifiedSocket, id);
          removePendingIdentifcation();
        },
        err => {
          Logger.error('client identification error:\n' + err);
          removePendingIdentifcation();
          socket.destroy();
        }
      );
    };

    this._onIdentification = (socket, id) => {
      const remote = new RemoteClient(id, socket);
      remote.subscribe({
        onClose: () => {
          this._removeRemote(remote);
        },
      });
      this._addRemote(remote);
    };

    this._onError = error => {
      Logger.error(error.message);
      this._subscribers.forEach(subscriber => {
        if (subscriber.onError != null) {
          subscriber.onError(error);
        }
      });
    };

    this._pendingIdentifications = [];
    this._remotes = [];
    this._server = net.createServer();
    this._subscribers = [];
    this._addServerListeners(this._server);
  }

  close() {
    return new Promise(resolve => {
      this._remotes.map(remote => remote.close());
      this._remotes.length = 0;
      this._server.close(() => resolve(this));
    });
  }

  isListening() {
    return this._server.listening;
  }

  listen(host, port) {
    return new Promise((resolve, reject) => {
      if (this._server.listening) {
        reject('server already open');
        return;
      }
      this._server.listen({ host, port }, () => {
        Logger.info(`server is listening on: ${host}:${port}`);
        resolve(this);
      });
    });
  }

  subscribe(subscriber) {
    const subscribers = this._subscribers;
    this._subscribers.push(subscriber);
    return {
      unsubscribe: () => {
        const index = subscribers.indexOf(subscriber);
        if (index !== -1) {
          subscribers.splice(index, 1);
        }
      },
    };
  }

  _addServerListeners(server) {
    server.addListener('close', this._onClose);
    server.addListener('connection', this._onConnection);
    server.addListener('error', this._onError);
  }

  _addRemote(remote) {
    this._remotes.push(remote);
    this._subscribers.forEach(subscriber => {
      if (subscriber.onConnect != null) {
        subscriber.onConnect(remote);
      }
    });
  }

  _removeRemote(remote) {
    const index = this._remotes.indexOf(remote);
    if (index !== -1) {
      this._remotes.splice(index, 1);
    }
  }
}

module.exports = Server;
