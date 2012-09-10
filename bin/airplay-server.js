#!/usr/bin/env node

'use strict';

var airplay = require('../');

var server = airplay.createServer();
server.on('connection', function(client) {
  console.log(client);
});
server.on('play', function(data) {
  console.log('play', data);
});
server.on('stop', function(data) {
  console.log('stop', data);
});
server.on('rate', function(data) {
  console.log('rate', data);
});
server.start();
