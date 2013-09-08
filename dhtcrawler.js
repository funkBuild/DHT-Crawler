var Buffer = require('buffer').Buffer;
var dgram = require('dgram');
var log = require('util').log;
var bencode = require('dht-bencode');
var eyes = require('eyes');
var date = new Date;
// Mongo
var mongo = require('mongodb'),
  Server = mongo.Server,
  Db = mongo.Db;

var server = new Server('localhost', 27017, {auto_reconnect: true});
var db = new Db('torrent', server);

db.open(function(err, db) {
  if(!err) {
    console.log("We are connected");
  }
});

// Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
  var rest = this.slice((to || from) + 1 || this.length);
  this.length = from < 0 ? this.length + from : from;
  return this.push.apply(this, rest);
};



var torrentHashs = [];
var sybils = [];
var lastCount = 0;

setInterval ( function(){
	db.collection('torrents', function(err, collection) {
		var totalCount = collection.count(function(err, count) {
                	var delta = count - lastCount;
			log("Keys per minute - " + delta);
			lastCount = count;
                });
		
	});

}, 60000 );

log("creating sybil");
for(var port = 6881; port < (6881+15); port++){
	sybils.push( new Sybil(randomId(), port).start() );
}

function randomId(){
	var result = new Buffer(20);
	for(var x = 0; x < 20; x++){
		result[x] = Math.floor(Math.random()*127);
	}

	return result;
}

function portToBinary(port){
	port = parseInt(port);
	result = []
	result.push( String.fromCharCode((port >> 8) & 0xff ) );
	result.push( String.fromCharCode(port & 0xff ) );
	//eyes.inspect(result.join(''));
	return result.join('');
}

function ipToBinary(ip){
	arr = ip.split('.');
	result = []
	arr.forEach(function(num){
		result.push( String.fromCharCode(parseInt(num)) );
	});
	return result.join('');
}

function binaryToIp(ip){
	var result = [];
	result.push( ip.charCodeAt(0));
	result.push( ip.charCodeAt(1));
	result.push( ip.charCodeAt(2));
	result.push( ip.charCodeAt(3));
	return result.join('.')
}

function binaryToPort(ip){
	var result = (ip.charCodeAt(4)& 0xFF)<<8 ;
	result += (ip.charCodeAt(5)& 0xFF);

	return result;
}

function addTorrentHash(hash){
	buffer = hash;
	hash = hash.toString();

	if(torrentHashs.indexOf(hash) != -1){
		//log("Duplicate Hash - " + torrentHashs.length);
		return;
	}

	db.collection('torrents', function(err, collection) {
		var doc = {'infoHash': buffer};
		collection.insert(doc);
		torrentHashs.push(hash);
		if(torrentHashs.length > 5000) torrentHashs.remove(0);
	});
	
	return;
}


function Sybil(id, port){
	var peers = [];
	var pendingPings = [];
	var id = id;
	var contactedPeers = [];

	var sock = dgram.createSocket("udp4", function (msg, rinfo) {
	  //log(msg.toString());
	  try{
		  var compactPeer = ipToBinary(rinfo.address) + portToBinary(rinfo.port);
		  var data = bencode.bdecode( msg );

		  processMessage( data, compactPeer );
	  } catch(e) {
		log("ERROR: Something fucked up :: " + e);
	  }

	});
	
	sock.bind(port, '0.0.0.0');

	this.start = function(){
		log("Sybil started");
		bootstrap();
		setInterval ( ping, 25 );
		setInterval ( bootstrap, 1000 );
		setInterval ( keepAlive, 60000 );
		setInterval ( hopId, 3*60*1000 );  //hop every 1 minutes
	}
	
	function hopId(){
		id = randomId();
		peers = peers.splice(0, 20);
		contactedPeers = [];
		//log("New ID is " + id);
		//log("Have " + peers.length + " peers and " + torrentHashs.length + " torrent hashes" );
	}

	function keepAlive(){
		var currentTime = date.getTime();
		var needsUpdate = ""

		for(var x=0; x < peers.length; x++){
			peer = peers[x]
			if(peer.alive == false) { peers.remove(x); log('removed peer') }
			else if(currentTime - peer.lastContact > 1*60*1000) {   //15 minutes keep alive
				log('checking if peer is alive');
		 		needsUpdate += peer.peerString;
				peer.alive = false;
			}
		};

		pingPeers(needsUpdate);

	}

	function queryPeers(peer){
		var message = new Buffer("d1:ad2:id20:"+ id +"6:target20:" + id + "e1:q9:find_node1:t2:aa1:y1:qe");

		ipAddress = binaryToIp(peer.peerString);
		port = binaryToPort(peer.peerString);
	
		sock.send(message, 0, message.length, port, ipAddress, function(err, bytes) {
		});

	}

	function addPeer(id, compactPeer){
		try{
		var newPeer = true;
		peers.forEach(function(peer){
			if(peer.id == id) {
				peer.alive = true;
				throw BreakException;
			}
		});
		} catch(e) {
			newPeer = false;
		}

		if(newPeer){
		
			var peer = {
			   'id': id.toString(),
			   'peerString': compactPeer,
			   'lastContact': date.getTime(),
			   'alive' : true
			};
			peers.push(peer);
			//Get more peers from the new peer
			if(peers.length < 100) queryPeers(peer);
		}

	}

	function pingPeers(peers){
		if(pendingPings > 200) return;
		peerList = peers.toString('binary');

		for(var x = 0; x < peerList.length; x+=6){
			var peer = peerList.substr(x, 6);
			if(peer.length == 6 && pendingPings.indexOf(peer) == -1 && contactedPeers.indexOf(peer) == -1){
				pendingPings.push(peer);
				contactedPeers.push(peer);
			}
		
		}


	}

	
	function ping(){
		if(pendingPings.length == 0) return;

		peer = pendingPings[0];
		pendingPings.remove(0);

		//eyes.inspect(peer);

		ipAddress = binaryToIp(peer);
		port = binaryToPort(peer);

		//log("Sent ping to " + ipAddress + ":" + port);

		var message = new Buffer("d1:ad2:id20:" + id + "e1:q4:ping1:t2:aa1:y1:qe");

		sock.send(message, 0, message.length, port, ipAddress, function(err, bytes) {
		});

	}

	function bootstrap(){
		if(pendingPings.length > 0) return
		var message = new Buffer("d1:ad2:id20:"+ id +"6:target20:" + id + "e1:q9:find_node1:t2:aa1:y1:qe");
		

		if(peers.length < 10){
			sock.send(message, 0, message.length, 6881, "router.utorrent.com", function(err, bytes) {
			});
		} else {
			peer = peers[ Math.floor(Math.random()*(peers.length-1)) ]; //Take a random peer in the list
			ipAddress = binaryToIp(peer.peerString);
			port = binaryToPort(peer.peerString);

			sock.send(message, 0, message.length, port, ipAddress, function(err, bytes) {
			});
		}
	}

	function pingReply(msg, peer){
		//send a ping reply
		ipAddress = binaryToIp(peer);
		port = binaryToPort(peer);

		var message = new Buffer("d1:rd2:id20:"+ id + "e1:t2:aa1:y1:re");
		
		sock.send(message, 0, message.length, port, ipAddress, function(err, bytes) {});
		//add as a known good peer and then query for more nodes
		addPeer(msg.a.id, peer);

	}


	function processMessage(msg, compactPeer){
		if('r' in msg){
			if('nodes' in msg.r){
				//find node response message
				
				pingPeers(msg.r.nodes);

			} else {
				//ping response message
				//log(msg.r.id);
				addPeer(msg.r.id, compactPeer);

			}
		} else {
			//not a response message
			
			if("q" in msg){
				if(msg.q == "get_peers"){
					addTorrentHash(msg.a.info_hash);
					
					
				};

				if(msg.q == "ping"){
					pingReply(msg, compactPeer);
					
				}
			}

		}
	};
};




