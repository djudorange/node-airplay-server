#!/usr/bin/env node

'use strict';

var airplay = require('../');

var server = airplay.createServer();
server.on('connection', function(client) {
  console.log(client);
});
server.start();
