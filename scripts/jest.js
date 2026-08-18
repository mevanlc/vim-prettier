#!/usr/bin/env node

// Node 25 exposes experimental webstorage globals whose lazy getters throw
// unless Node is started with a storage path. Jest 29 copies globals when the
// node environment starts, so remove them before Jest loads.
delete globalThis.localStorage;
delete globalThis.sessionStorage;

require('jest/bin/jest');
