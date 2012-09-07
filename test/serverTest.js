'use strict';

var airplay = require('../');
var assert = require('chai').assert;

suite('Server', function() {
  test('should start', function(done) {
    var server = airplay.createServer();
    server.on('connection', function(client) {
      console.log(client);
      assert.ok(client);
      done();
    });
    server.start();
  });
});
