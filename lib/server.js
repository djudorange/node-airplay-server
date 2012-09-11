'use strict';

var util = require('util');
var events = require('events');
var mdns = require('mdns');
var http = require('http');
var net = require('net');
var fs = require('fs');
var express = require('express');
var bplist = require('bplist-parser');
var streamBuffers = require("stream-buffers");

var HTTP_RESPONSE = 1;

exports.createServer = function() {
  return new Server();
};

function Server() {
  events.EventEmitter.call(this);
}
util.inherits(Server, events.EventEmitter);

Server.prototype.start = function() {
  var self = this;
  var airPlayPort = 7000;
  var airTunesPort = 49152;
  var mdnsName = 'nodeAirPlay';
  this.mac = '29:CF:DA:D4:2C:94'; // todo: change to real mac address
  this.features = 0x29ff;
  this.model = 'AppleTV2,1';
  this.srcvers = '130.14';

  var txtRecord = {
    features: '0x' + this.features.toString(16),
    deviceid: this.mac,
    model: this.model,
    rhd: '4.4',
    srcvers: this.srcvers
  };
  this.mdnsAirPlay = mdns.createAdvertisement(mdns.tcp('airplay'), airPlayPort, {
    txtRecord: txtRecord,
    name: mdnsName
  });
  this.mdnsAirPlay.start();

  txtRecord = {
    et: '0,3,5',
    ek: '1',
    cn: '0,1,2,3',
    da: 'true',
    tp: 'UDP',
    pw: 'false',
    sf: '0x4',
    am: 'AppleTV3,1',
    txtvers: '1',
    vn: '65537',
    md: '0,1,2',
    vs: '130.14',
    sv: 'false',
    ch: '2',
    sr: '44100',
    rhd: '4.4',
    ss: '16'
  };
  this.mdnsAirTunes = mdns.createAdvertisement(mdns.tcp('raop'), airTunesPort, {
    txtRecord: txtRecord,
    name: this.mac.replace(/:/g, '') + '@' + mdnsName
  });
  this.mdnsAirTunes.start();

  this.sendEventCallbackQueue = [];

  this.app = express();
  this.app.use(airPlayBodyParser());
  this.app.use(this.app.router);
  this.app.get('/server-info', this._onServerInfo.bind(this));
  this.app.post('/play', this._onPlay.bind(this));
  this.app.post('/stop', this._onStop.bind(this));
  this.app.post('/rate', this._onRate.bind(this));
  this.app.use(function(req, res) {
    console.log('unknown request', req);
  });
  this.httpServer = http.createServer(this.app);
  this.httpServer.listen(airPlayPort);
  this.httpServer.on('upgrade', function(req, socket, head) {
    self.ptthHttpParser = http.parsers.alloc();
    self.ptthHttpParser.reinitialize(HTTP_RESPONSE);
    self.ptthHttpParser.socket = socket;
    self.ptthHttpParser.incoming = null;
    self.ptthHttpParser.onIncoming = function(req, shouldKeepAlive) {
      var currentCallback = self.sendEventCallbackQueue[0];
      self.sendEventCallbackQueue = self.sendEventCallbackQueue.slice(1);
      return currentCallback(null, req, shouldKeepAlive);
    };

    self.ptthSocket = socket;
    self.ptthSocket.on('data', function(data) {
      var ret = self.ptthHttpParser.execute(data, 0, data.length);
      if (ret instanceof Error) {
        self.emit('error', ret);
      }
    });
    self.appleSessionId = req.headers['x-apple-session-id'];
    if (req.url === '/reverse') {
      var switchProtocol =
        'HTTP/1.1 101 Switching Protocols\r\n'
          + 'Date: Mon, 10 Sep 2012 14:49:04 GMT\r\n'
          + 'Upgrade: PTTH/1.0\r\n'
          + 'Connection: Upgrade\r\n'
          + '\r\n';
      self.ptthSocket.write(switchProtocol, 'ascii');
    }
  });
};

Server.prototype.sendEvent = function(body, callback) {
  callback = callback || function() {};
  this.sendEventCallbackQueue.push(callback);
  var str =
    'POST /event HTTP/1.1\r\n'
      + 'Content-Type: text/x-apple-plist+xml\r\n'
      + 'Content-Length: ' + body.length + '\r\n'
      + 'X-Apple-Session-ID: ' + this.appleSessionId + '\r\n'
      + '\r\n'
      + body;
  this.ptthSocket.write(str, 'ascii');
};

Server.prototype._onServerInfo = function(req, res) {
  console.log('serverInfo');
  var str =
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
      + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      + "<plist version=\"1.0\">"
      + "<dict>"
      + "<key>deviceid</key><string>" + this.mac + "</string>"
      + "<key>features</key><integer>" + this.features + "</integer>"
      + "<key>model</key><string>" + this.model + "</string>"
      + "<key>protovers</key><string>1.0</string>"
      + "<key>pw</key><string>0</string>"
      + "<key>srcvers</key><string>" + this.srcvers + "</string>"
      + "</dict>"
      + "</plist>";
  res.setHeader('Content-Type', 'text/x-apple-plist+xml');
  return res.end(str);
};

Server.prototype._onRate = function(req, res) {
  this.emit('rate', req.query);
  return res.end();
};

Server.prototype._onPlay = function(req, res) {
  this.emit('play', req.body);
  return res.end();
};

Server.prototype._onStop = function(req, res) {
  this.emit('stop', req.body);
  return res.end();
};

function airPlayBodyParser() {
  return function(req, res, next) {
    if (req.headers['content-type'] == 'application/x-apple-binary-plist') {
      var body = new streamBuffers.WritableStreamBuffer();
      req.on('data', function(data) {
        body.write(data);
      });
      req.on('end', function(data) {
        req.body = body.getContents();
        if (req.body) {
          req.body = bplist.parseBuffer(req.body);
        }
        next();
      });
    } else {
      req.body = '';
      req.on('data', function(data) {
        req.body += data.toString('utf8');
      });
      req.on('end', function(data) {
        if (data) {
          req.body += data.toString('utf8');
        }
        var lines = req.body.split('\n');
        var values = {};
        lines
          .filter(function(l) { return l; })
          .forEach(function(l) {
            var token = l.indexOf(':');
            var name = l.substr(0, token).trim();
            values[name] = l.substr(token).trim();
          });
        req.body = values;
        next();
      });
    }
  };
}
