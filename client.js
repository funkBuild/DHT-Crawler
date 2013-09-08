var Buffer = require('buffer').Buffer;
var dgram = require('dgram');
var log = require('util').log;

var message = new Buffer("d1:ad2:id20:abcdefghij0123456789e1:q4:ping1:t2:aa1:y1:qe");
var client = dgram.createSocket("udp4");
client.send(message, 0, message.length, 6881, "router.utorrent.com", function(err, bytes) {
  client.close();
});
