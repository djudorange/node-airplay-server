#!/usr/bin/env node

'use strict';

var airplay = require('../');

var server = airplay.createServer();

server.on('error', function(error) {
  console.log('error', error);
});

server.on('play', function(data) {
  console.log('play', data);
  var body =
    '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      + '<plist version="1.0">\n'
      + '<dict>\n'
      + '\t<key>category</key>\n'
      + '\t<string>video</string>\n'
      + '\t<key>state</key>\n'
      + '\t<string>loading</string>\n'
      + '</dict>\n'
      + '</plist>\n';
  server.sendEvent(body);
});

server.on('stop', function(data) {
  console.log('stop', data);
});

server.on('rate', function(data) {
  console.log('rate', data);
});

server.start();
