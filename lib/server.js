'use strict';

var util = require('util');
var events = require('events');
var mdns = require('mdns');
var http = require('http');
var dgram = require('dgram');
var net = require('net');
var fs = require('fs');
var crypto = require('crypto');

// private key sign. see shairport
try {
  var rsaPrivate = fs.readFileSync('airtunes.pem', 'ascii');
  var signer = crypto.createSign('RSA-SHA1');
  var r = signer.update('this is a test. this is a test. this is a test.');
  var result = signer.sign(rsaPrivate, 'hex');
  console.log('result', result);
} catch (ex) {
  console.error("see shairport for the private key", ex);
}

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
  var mac = 'AC:81:12:A1:84:07'; // todo: change to real mac address

  var txtRecord = {
    deviceid: mac,
    features: '0x39f7',
    model: 'AppleTV3,1',
    srcvers: '130.14'
  };
  this.mdnsAirPlay = mdns.createAdvertisement(mdns.tcp('airplay'), airPlayPort, {
    txtRecord: txtRecord,
    name: mdnsName
  });
  this.mdnsAirPlay.start();

  txtRecord = {
    txtvers: '1',
    ch: '2',
    cn: '0,1,2,3',
    da: 'true',
    et: '0,3,5',
    md: '0,1,2',
    pw: 'false',
    sv: 'false',
    sr: '44100',
    ss: '16',
    tp: 'UDP',
    vn: '65537',
    vs: '130.14',
    am: 'AppleTV3,1',
    sf: '0x4'
  };
  this.mdnsAirTunes = mdns.createAdvertisement(mdns.tcp('raop'), airTunesPort, {
    txtRecord: txtRecord,
    name: mac.replace(/:/g, '') + '@' + mdnsName
  });
  this.mdnsAirTunes.start();

  this.httpServer = http.createServer(this._onAirPlayHttpRequest.bind(this));
  this.httpServer.listen(airPlayPort);

  this.httpServer = http.createServer(this._onAirTunesHttpRequest.bind(this));
  this.httpServer.listen(airTunesPort);
};

Server.prototype._onAirPlayHttpRequest = function(req, res) {
  console.log('_onAirPlayHttpRequest', req);
  this.emit('connection', {});
};

Server.prototype._onAirTunesHttpRequest = function(req, res) {
  console.log('_onAirTunesHttpRequest', req);
  this.emit('connection', {});
};
