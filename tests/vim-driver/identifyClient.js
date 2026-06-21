'use strict';

const identifyClient = (socket, abort) =>
  new Promise((resolve, reject) => {
    let buffer = '';
    let resolved = false;
    let settled = false;

    const removeListeners = () => {
      socket.removeListener('data', onData);
      socket.removeListener('close', onClose);
      socket.removeListener('end', onEnd);
      socket.removeListener('error', onError);
    };

    const fail = error => {
      if (settled) {
        return;
      }
      settled = true;
      removeListeners();
      reject(error);
    };

    const onData = rawData => {
      buffer += rawData.toString();
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const rawMessage = buffer.slice(0, newlineIndex);
      const remaining = buffer.slice(newlineIndex + 1);

      if (remaining !== '') {
        fail(new Error('received unexpected client identification'));
        return;
      }

      let message;
      try {
        message = JSON.parse(rawMessage);
      } catch (error) {
        fail(error);
        return;
      }
      const messageId = message[0];
      const messagePayload = message[1];
      const clientId = messagePayload && messagePayload.id;

      if (messageId !== '$id' || clientId == null) {
        fail(new Error('received unexpected client identification'));
      } else {
        settled = true;
        resolved = true;
        removeListeners();
        resolve([socket, clientId]);
      }
    };

    const onClose = () => {
      fail(new Error('pending client identification socket closed'));
    };

    const onEnd = () => {
      fail(new Error('pending client identification socket ended'));
    };

    const onError = error => {
      fail(error);
    };

    socket.addListener('data', onData);
    socket.addListener('close', onClose);
    socket.addListener('end', onEnd);
    socket.addListener('error', onError);

    abort.then(() => {
      if (resolved) {
        return;
      }
      fail(new Error('pending client identification was aborted'));
    });
  });

module.exports = identifyClient;
