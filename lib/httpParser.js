'use strict';

var util = require("util");
var events = require("events");

var HttpParser = module.exports = function(requestHandler) {
  this.requestHandler = requestHandler;
  this._currentRequest = function() {};
  util.inherits(this._currentRequest, events.EventEmitter);
  this._currentRequest.state = 'locationLine';
  this._currentRequest.headerBuffer = '';
  this._currentRequest.headers = {};
};

HttpParser.prototype.write = function(data) {
  var m;
  var doMore = true;

  this._currentRequest.headerBuffer += data.toString('utf8');

  while (doMore) {
    doMore = false;
    switch (this._currentRequest.state) {
    case 'locationLine':
      m = this._currentRequest.headerBuffer.match(/(.*) (.*) (.*)\/(.*)\r\n/m);
      if (m) {
        this._currentRequest.headerBuffer = this._currentRequest.headerBuffer.substr(m[0].length);
        this._currentRequest.method = m[1];
        this._currentRequest.url = m[2];
        this._currentRequest.protocol = m[3];
        this._currentRequest.protocolVersion = m[4];
        this._currentRequest.state = 'headerLines';
        doMore = true;
      }
      break;
    case 'headerLines':
      m = this._currentRequest.headerBuffer.match(/(.*?):(.*)\r\n/m);
      if (m) {
        this._currentRequest.headers[m[1].toLowerCase()] = m[2];
        doMore = true;
      }

      m = this._currentRequest.headerBuffer.match(/\r\n/m);
      if (m) {
        this._currentRequest.state = 'body';
        this.requestHandler(this._currentRequest);
      }
      break;
    case 'body':
      this._currentRequest.emit('data', data);
      break;
    }
  }
};

HttpParser.prototype.end = function() {

};


