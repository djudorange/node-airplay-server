#!/usr/bin/env node

'use strict';

var airplay = require('../');

var server = airplay.createServer();

var playInterval = null;
var defaultVideoPlayback = {
  readyToPlay: true,
  duration: 25,
  loadedTimeRangesDuration: 25,
  loadedTimeRangesStart: 0.0,
  position: 0.0,
  seekableTimeRangesDuration: 25,
  seekableTimeRangesStart: 0.0,
  rate: 0.0
};

server.on('error', function(error) {
  console.log('error', error);
});

server.on('play', function(data) {
  console.log('play', data);
  server.sendEvent({
    category: 'video',
    state: 'loading'
  });

  setTimeout(function() {
    console.log('readyToPlay');
    server.videoPlayback = server.videoPlayback || defaultVideoPlayback;
    server.videoPlayback.rate = 1.0;
    server.sendEvent({
      category: 'video',
      state: 'paused'
    });
    server.sendEvent({
      category: 'video',
      state: 'playing'
    });

    playInterval = setInterval(function() {
      server.videoPlayback.position = parseFloat(server.videoPlayback.position) + (parseFloat(server.videoPlayback.rate) / 10);
      if (server.videoPlayback.position > server.videoPlayback.duration) {
        server.videoPlayback.position = parseFloat(server.videoPlayback.duration);
        server.sendEvent({
          category: 'video',
          state: 'paused'
        });
      }
    }, 100);
  }, 3000);
});

server.on('stop', function(data) {
  console.log('stop', data);
  clearInterval(playInterval);
});

server.on('scrub', function(data) {
  server.videoPlayback = server.videoPlayback || defaultVideoPlayback;
  server.videoPlayback.position = parseFloat(data.position);
  console.log('scrub position', server.videoPlayback.position);
});

server.on('rate', function(data) {
  console.log('rate', data);
  server.videoPlayback = server.videoPlayback || defaultVideoPlayback;
  server.videoPlayback.rate = parseFloat(data.value);
  if (server.videoPlayback.rate == 0) {
    server.sendEvent({
      category: 'video',
      state: 'paused'
    });
  } else {
    server.sendEvent({
      category: 'video',
      state: 'playing'
    });
  }
});

server.start();
