'use strict';

const { createLogger } = require('./Logger');

const Logger = createLogger('vim-driver');

class RequestManager {
  constructor(id, socket) {
    this._onData = rawData => {
      this._buffer += rawData.toString();

      let newlineIndex = this._buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const rawMessage = this._buffer.slice(0, newlineIndex);
        this._buffer = this._buffer.slice(newlineIndex + 1);
        newlineIndex = this._buffer.indexOf('\n');

        if (rawMessage === '') {
          continue;
        }

        let message;
        try {
          message = JSON.parse(rawMessage);
        } catch (error) {
          this._rejectPendingRequests(error);
          continue;
        }
        const messageId = message[0];
        const resolver = this._pendingRequests[messageId];

        if (resolver == null) {
          Logger.error(`client ${this._id} received an unknown message: ${rawMessage}`);
          continue;
        }

        delete this._pendingRequests[messageId];

        const messagePayload = message[1];
        Logger.debug(`client: ${this._id}, message-in: ${rawMessage}`);
        resolver.resolve(messagePayload);
      }
    };

    this._onClose = () => {
      this._rejectPendingRequests(new Error(`client ${this._id} socket closed`));
      this._removeListeners();
    };

    this._onEnd = () => {
      this._rejectPendingRequests(new Error(`client ${this._id} socket ended`));
    };

    this._onError = error => {
      this._rejectPendingRequests(error);
    };

    this._id = id;
    this._socket = socket;
    this._buffer = '';
    this._pendingRequests = {};
    this._nextRequestId = 0;
    this._addListeners();
  }

  send(payload) {
    return new Promise((resolve, reject) => {
      this._nextRequestId += 1;
      const requestId = `${this._id}-${this._nextRequestId}`;

      this._pendingRequests[requestId] = { resolve, reject };

      const rawMessage = JSON.stringify([requestId, payload]);
      Logger.debug(`client: ${this._id}, message-out: ${rawMessage}`);
      this._socket.write(rawMessage + '\n', error => {
        if (error) {
          delete this._pendingRequests[requestId];
          reject(error);
        }
      });
    });
  }

  _addListeners() {
    this._socket.addListener('data', this._onData);
    this._socket.addListener('close', this._onClose);
    this._socket.addListener('end', this._onEnd);
    this._socket.addListener('error', this._onError);
  }

  _removeListeners() {
    this._socket.removeListener('data', this._onData);
    this._socket.removeListener('close', this._onClose);
    this._socket.removeListener('end', this._onEnd);
    this._socket.removeListener('error', this._onError);
  }

  _rejectPendingRequests(error) {
    const pendingRequests = this._pendingRequests;
    this._pendingRequests = {};
    Object.keys(pendingRequests).forEach(requestId => {
      pendingRequests[requestId].reject(error);
    });
  }

  destroy() {
    this._rejectPendingRequests(new Error(`client ${this._id} request manager destroyed`));
    this._removeListeners();
  }
}

module.exports = RequestManager;
