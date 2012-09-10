'use strict';

var util = require('util');
var events = require('events');
var mdns = require('mdns');
var http = require('http');
var dgram = require('dgram');
var net = require('net');
var fs = require('fs');
var crypto = require('crypto');
var express = require('express');
var bplist = require('bplist-parser');
var streamBuffers = require("stream-buffers");

exports.createServer = function() {
  return new Server();
};

function Server() {
  events.EventEmitter.call(this);
}
util.inherits(Server, events.EventEmitter);

Server.prototype.start = function() {
  var airPlayPort = 7000;
  var airTunesPort = 49152;
  var mdnsName = 'nodeAirPlay';
  this.mac = '29:CF:DA:D4:2C:94'; // todo: change to real mac address
  this.features = 0x29ff;
  this.model = 'AppleTV2,1';
  this.srcvers = '130.14';

  var txtRecord = {
    features: '0x'+this.features.toString(16),
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

  this.app = express();
  this.app.use(airPlayBodyParser());
  this.app.use(this.app.router);
  this.app.get('/server-info', this._onServerInfo.bind(this));
  this.app.post('/reverse', this._onReverse.bind(this));
  this.app.post('/play', this._onPlay.bind(this));
  this.app.post('/stop', this._onStop.bind(this));
  this.app.post('/rate', this._onRate.bind(this));
  this.app.post('/getProperty', this._onGetProperty.bind(this));
  this.app.use(function(req, res) {
    console.log('unknown request', req);
  });
  this.httpServer = http.createServer(this.app);
  this.httpServer.listen(airPlayPort);
  this.httpServer.on('upgrade', function() {
    console.log('upgrade', arguments);
  });
};

Server.prototype._onServerInfo = function(req, res) {
  console.log('_onServerInfo');
  var str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
    + "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n"
    + "<plist version=\"1.0\">"
    + "<dict>"
    + "<key>deviceid</key><string>" + this.mac + "</string>"
    + "<key>features</key><integer>" + this.features + "</integer>"
    + "<key>model</key><string>" + this.model + "</string>"
    + "<key>protovers</key><string>1.0</string>"
    + "<key>pw</key><string>0</string>"
    + "<key>srcvers</key><string>" + this.srcvers+"</string>"
    + "</dict>"
    + "</plist>";
  res.setHeader('Content-Type', 'text/x-apple-plist+xml');
  return res.end(str);
};

Server.prototype._onGetProperty = function(req, res) {
  var propertyName = Object.keys(req.query)[0];
  console.log('_onGetProperty', propertyName);
  res.setHeader('Content-Type', 'text/x-apple-plist+xml');
  var str = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
              + '<plist version="1.0">'
              + '  <dict>'
              + '    <key>errorCode</key>'
              + '    <integer>0</integer>'
              + '    <key>value</key>'
              + '    <array>'
              + '      <dict>'
              + '        <key>bytes</key> <integer>1818336</integer>'
              + '        <key>c-duration-downloaded</key> <real>70</real>'
              + '        <key>c-duration-watched</key> <real>18.154102027416229</real>'
              + '        <key>c-frames-dropped</key> <integer>0</integer>'
              + '        <key>c-observed-bitrate</key> <real>14598047.302367469</real>'
              + '        <key>c-overdue</key> <integer>0</integer>'
              + '        <key>c-stalls</key> <integer>0</integer>'
              + '        <key>c-start-time</key> <real>0.0</real>'
              + '        <key>c-startup-time</key> <real>0.27732497453689575</real>'
              + '        <key>cs-guid</key> <string>B475F105-78FD-4200-96BC-148BAB6DAC11</string>'
              + '        <key>date</key> <date>2012-03-16T15:31:24Z</date>'
              + '        <key>s-ip</key> <string>213.152.6.89</string>'
              + '        <key>s-ip-changes</key> <integer>0</integer>'
              + '        <key>sc-count</key> <integer>7</integer>'
              + '        <key>uri</key> <string>http://devimages.apple.com/iphone/samples/bipbop/gear1/prog_index.m3u8</string>'
              + '      </dict>'
              + '    </array>'
              + '  </dict>'
              + '</plist>';
  return res.end(str);
};

Server.prototype._onReverse = function(req, res) {
  this.emit('reverse', req.body);
  console.log('revvvv!!!!!');
  return res.end();
};

Server.prototype._onRate = function(req, res) {
  this.emit('rate', req.query);
  return  res.end();
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
      req.on('data', function (data) {
        body.write(data);
      });
      req.on('end', function (data) {
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
            var value = l.substr(token).trim();
            values[name] = value;
          });
        req.body = values;
        next();
      });  
    } 
  };
}
