'use strict';

var binary = require('binary');
var net = require('net');
var fs = require('fs');
var parsley = require('parsley');
var events = require("events");
var streamBuffers = require("stream-buffers");

exports.createServer = function(connectionHandler) {
  return new Server(connectionHandler);
};

var Server = function(connectionHandler) {
  var self = this;
  this.connectionHandler = connectionHandler;

  this.tcpServer = net.createServer(function(c) {
    c.packetParser = binary()
      .loop(function(end) {
        this
          .word32lu('payloadSize')
          .word16lu('payloadType')
          .word16lu('unknown')
          .word64lu('timestamp')
          .buffer('restOfHeader', 112)
          .tap(function(vars) {
            this.buffer('payload', vars.payloadSize);
            this.tap(function(vars) {
              if (vars.payloadType === 1) {
                console.log('codec data');
                console.log(require('hexy').hexy(vars.payload, {
                  format: 'twos'
                }));
              } else if (vars.payloadType === 0) {
                console.log('writing video', vars.payload.length);
                fs.appendFileSync("video.mov", vars.payload, 'binary');
              }
            });
          });
      });
    c.mode = 'http';
    c.writeResponse = function(c, req, options, body) {
      var headerStr = 'HTTP/1.0 200 OK\r\n';
      options.headers = options.headers || {};
      if (body) {
        options.headers['Content-Length'] = body.length;
      }
      Object.keys(options.headers).forEach(function(headerKey) {
        headerStr += headerKey + ": " + options.headers[headerKey] + "\r\n";
      });
      headerStr += "\r\n";
      c.write(new Buffer(headerStr));
      if (body) {
        c.write(body);
      }
    };

    c.parsleyParser = parsley(new events.EventEmitter(), function(req) {
      req.on('headers', function() {
        c.parsleyParser._shouldKeepAlive = true;
        req.body = new streamBuffers.WritableStreamBuffer();
        if (req.method === 'GET') {
          if (req.url === '/stream.xml') {
            c.writeResponse(c, req, {},
              '<?xml version="1.0" encoding="UTF-8"?>' +
              '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"' +
              '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
              '<plist version="1.0">' +
              ' <dict>' +
              '  <key>height</key>' +
              '  <integer>720</integer>' +
              '  <key>overscanned</key>' +
              '  <true/>' +
              '  <key>refreshRate</key>' +
              '  <real>0.016666666666666666</real>' +
              '  <key>version</key>' +
              '  <string>130.14</string>' +
              '  <key>width</key>' +
              '  <integer>1280</integer>' +
              ' </dict>' +
              '</plist>');
          } else {
            throw new Error("Unhandled GET URL '" + req.url + "'");
          }
        } else if (req.method === 'POST') {
          if (req.url === '/stream') {
            // handled in rawEnd
          } else {
            throw new Error("Unhandled POST URL '" + req.url + "'");
          }
        } else {
          throw new Error("Unhandled method '" + req.method + "'");
        }
      });
      req.on('rawBody', function(data) {
        req.body.write(data);
      });
      req.on('rawEnd', function(data) {
        if (data) {
          req.body.write(data);
        }
        req.body = req.body.getContents();
        if (req.method === 'POST') {
          if (req.url === '/stream') {
            c.mode = 'data';
          }
        }
      });
    });
    c.on('data', function(data) {
      if (c.mode === 'http') {
        for (var i = 0; i < data.length; i++) {
          if (c.mode === 'http') {
            c.parsleyParser.execute(new Buffer([data[i]]), 0, 1);
          } else {
            c.packetParser.write(new Buffer([data[i]]));
          }
        }
      } else if (c.mode === 'data') {
        c.packetParser.write(data);
      } else {
        throw new Error("Invalid mode '" + c.mode + "'");
      }
    });
  });
};

Server.prototype.listen = function(port) {
  this.tcpServer.listen(port);
};
