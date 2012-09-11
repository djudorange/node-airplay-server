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
var HttpParser = require('./httpParser');

var HTTP_REQUEST = 0;
var HTTP_RESPONSE = 1;

exports.createServer = function() {
  return new Server();
};

function Server() {
  events.EventEmitter.call(this);
}
util.inherits(Server, events.EventEmitter);

Server.prototype.start = function(opts) {
  var self = this;
  opts = opts || {};
  var airPlayPort = opts.airPlayPort || 7000;
  var airTunesPort = opts.airTunesPort || 49152;
  var mdnsName = opts.name || 'nodeAirPlay';
  this.mac = opts.macAddress || '29:CF:DA:D4:2C:94'; // todo: change to real mac address
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
  this.videoPlayback = null;

  this.airPlayApp = express();
  this.airPlayApp.use(airPlayBodyParser());
  this.airPlayApp.use(this.airPlayApp.router);
  this.airPlayApp.get('/server-info', this._onServerInfo.bind(this));
  this.airPlayApp.get('/playback-info', this._onGetPlaybackInfo.bind(this));
  this.airPlayApp.get('/scrub', this._onGetScrub.bind(this));
  this.airPlayApp.post('/scrub', this._onPostScrub.bind(this));
  this.airPlayApp.post('/play', this._onPlay.bind(this));
  this.airPlayApp.post('/stop', this._onStop.bind(this));
  this.airPlayApp.post('/rate', this._onRate.bind(this));
  this.airPlayApp.put('/setProperty', this._onSetProperty.bind(this));
  this.airPlayApp.post('/getProperty', this._onGetProperty.bind(this));
  this.airPlayApp.use(function(req, res) {
    console.log('unknown request', req);
    res.writeHead(404, {
      'Content-Length': 0
    });
    return res.end();
  });
  this.airPlayServer = http.createServer(this.airPlayApp);
  console.log('listening', airPlayPort);
  this.airPlayServer.listen(airPlayPort);
  this.airPlayServer.on('upgrade', function(req, socket, head) {
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

  this.airTunesServer = net.createServer(function(c) {
    var parser = new HttpParser(function(req) {
      console.log('HttpParser req', req);
    });
    c.on('data', function(data) {
      parser.write(data);
    });
    c.on('end', function() {
      parser.end();
    });
  });
  console.log('listening', airTunesPort);
  this.airTunesServer.listen(airTunesPort);
};

Server.prototype.sendEvent = function(opts, callback) {
  callback = callback || function() {};
  var body =
    '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      + '<plist version="1.0">\n'
      + '<dict>\n'
      + '\t<key>category</key>\n'
      + '\t<string>' + opts.category + '</string>\n'
      + '\t<key>state</key>\n'
      + '\t<string>' + opts.state + '</string>\n'
      + '</dict>\n'
      + '</plist>\n';
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

Server.prototype._onSetProperty = function(req, res) {
  var propertyName = Object.keys(req.query)[0];
  console.log('setProperty', propertyName, req.body);
  res.writeHead(404, {
    'Content-Length': 0
  });
  return res.end();
};

Server.prototype._onGetProperty = function(req, res) {
  var propertyName = Object.keys(req.query)[0];
  console.log('getProperty', propertyName);
  res.writeHead(404, {
    'Content-Length': 0
  });
  return res.end();
};

Server.prototype._onGetScrub = function(req, res) {
  var str;
  if (this.videoPlayback) {
    str =
    'duration: ' + this.videoPlayback.duration + '\n'
      + 'position: ' + this.videoPlayback.position + '\n';
  } else {
    str =
    'duration: 0.0\n'
      + 'position: 0.0\n';
  }
  res.setHeader('Content-Length', str.length);
  res.setHeader('Content-Type', 'text/parameters');
  return res.end(str);
};

Server.prototype._onPostScrub = function(req, res) {
  this.emit('scrub', req.query);
  res.setHeader('Content-Length', 0);
  return res.end();
};

Server.prototype._onGetPlaybackInfo = function(req, res) {
  var str;

  if (this.videoPlayback) {
    str =
    '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      + '<plist version="1.0">\n'
      + '<dict>\n'
      + '\t<key>duration</key>\n'
      + '\t<real>' + this.videoPlayback.duration + '</real>\n'
      + '\t<key>loadedTimeRanges</key>\n'
      + '\t<array>\n'
      + '\t\t<dict>\n'
      + '\t\t<key>duration</key>\n'
      + '\t\t<real>' + this.videoPlayback.loadedTimeRangesDuration + '</real>\n'
      + '\t\t<key>start</key>\n'
      + '\t\t<real>' + this.videoPlayback.loadedTimeRangesStart + '</real>\n'
      + '\t\t</dict>\n'
      + '\t</array>\n'
      + '\t<key>playbackBufferEmpty</key>\n'
      + '\t<true/>\n'
      + '\t<key>playbackBufferFull</key>\n'
      + '\t<false/>\n'
      + '\t<key>playbackLikelyToKeepUp</key>\n'
      + '\t<false/>\n'
      + '\t<key>position</key>\n'
      + '\t<real>' + this.videoPlayback.position + '</real>\n'
      + '\t<key>rate</key>\n'
      + '\t<real>' + this.videoPlayback.rate + '</real>\n'
      + '\t<key>readyToPlay</key>\n'
      + '\t<true/>\n'
      + '\t<key>seekableTimeRanges</key>\n'
      + '\t<array>\n'
      + '\t\t<dict>\n'
      + '\t\t<key>duration</key>\n'
      + '\t\t<real>' + this.videoPlayback.seekableTimeRangesDuration + '</real>\n'
      + '\t\t<key>start</key>\n'
      + '\t\t<real>' + this.videoPlayback.seekableTimeRangesStart + '</real>\n'
      + '\t\t</dict>\n'
      + '\t</array>\n'
      + '</dict>\n'
      + '</plist>\n';
  } else {
    str =
    '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      + '<plist version="1.0">\n'
      + '<dict>\n'
      + '\t<key>duration</key>\n'
      + '\t<real>0.0</real>\n'
      + '\t<key>loadedTimeRanges</key>\n'
      + '\t<array/>\n'
      + '\t<key>playbackBufferEmpty</key>\n'
      + '\t<true/>\n'
      + '\t<key>playbackBufferFull</key>\n'
      + '\t<false/>\n'
      + '\t<key>playbackLikelyToKeepUp</key>\n'
      + '\t<false/>\n'
      + '\t<key>position</key>\n'
      + '\t<real>0.0</real>\n'
      + '\t<key>rate</key>\n'
      + '\t<real>0.0</real>\n'
      + '\t<key>readyToPlay</key>\n'
      + '\t<false/>\n'
      + '\t<key>seekableTimeRanges</key>\n'
      + '\t<array/>\n'
      + '</dict>\n'
      + '</plist>\n';
  }
  res.setHeader('Content-Length', str.length);
  res.setHeader('Content-Type', 'text/x-apple-plist+xml');
  return res.end(str);
};

Server.prototype._onPostFpSetup = function(req, res) {
  console.log('fp-setup');
  var hexy = require('hexy');
  console.log(hexy.hexy(req.body, {
    format: 'twos'
  }));
};

Server.prototype._onServerInfo = function(req, res) {
  console.log('serverInfo');
  var str =
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
      + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      + "<plist version=\"1.0\">\n"
      + "<dict>\n"
      + "\t<key>deviceid</key>\n"
      + "\t<string>" + this.mac + "</string>\n"
      + "\t<key>features</key>\n"
      + "\t<integer>" + this.features + "</integer>\n"
      + "\t<key>model</key>\n"
      + "\t<string>" + this.model + "</string>\n"
      + "\t<key>protovers</key>\n"
      + "\t<string>1.0</string>\n"
      + "\t<key>pw</key>\n"
      + "\t<string>0</string>\n"
      + "\t<key>srcvers</key>\n"
      + "\t<string>" + this.srcvers + "</string>\n"
      + "</dict>\n"
      + "</plist>\n";
  res.setHeader('Content-Length', str.length);
  res.setHeader('Content-Type', 'text/x-apple-plist+xml');
  return res.end(str);
};

Server.prototype._onRate = function(req, res) {
  this.emit('rate', req.query);
  res.setHeader('Content-Length', 0);
  return res.end();
};

Server.prototype._onPlay = function(req, res) {
  this.emit('play', req.body);
  res.setHeader('Content-Length', 0);
  return res.end();
};

Server.prototype._onStop = function(req, res) {
  this.emit('stop', req.body);
  res.setHeader('Content-Length', 0);
  return res.end();
};

function airPlayBodyParser() {
  return function(req, res, next) {
    if (req.headers['content-type'] == 'application/x-apple-binary-plist') {
      req.body = new streamBuffers.WritableStreamBuffer();
      req.on('data', function(data) {
        req.body.write(data);
      });
      req.on('end', function(data) {
        req.body = req.body.getContents();
        if (req.body) {
          req.body = bplist.parseBuffer(req.body);
        }
        next();
      });
    } else if (req.headers['content-type'] == 'application/octet-stream') {
      req.body = new streamBuffers.WritableStreamBuffer();
      req.on('data', function(data) {
        req.body.write(data);
      });
      req.on('end', function(data) {
        req.body = req.body.getContents();
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
