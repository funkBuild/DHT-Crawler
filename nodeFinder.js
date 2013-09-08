var Buffer = require('buffer').Buffer;
var dgram = require('dgram');
var log = require('util').log;
var bencode = require('dht-bencode');
var eyes = require('eyes');
var date = new Date;

var torrentFetcher = require('./torrentFetcher.js').torrentFetcher;

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



function hexStringToBinary(string){
	var result = new Buffer(20);
	for(var x = 0; x < string.length; x+=2){
		result[x/2] = ( hexCharToBinary(string[x]) << 4) + hexCharToBinary(string[x + 1]) ;
	}
	
	return result;
}


function hexCharToBinary(char){
	var arr = "0123456789abcdef";
	return arr.indexOf(char);
}

function distance(firstId, secondId){	//accepts two equal buffers and XOR's them
	var result = new Buffer(firstId.length);
	for(var x = 0; x < firstId.length; x++){
		result[x] = firstId[x] ^ secondId[x];
	
	}
	return result.readUInt32BE(16);
};



var finders = [];
var fetchers = true;
var lastCount = 0;



log("creating Finder");
var find = new Finder(randomId(), 6900).start();


function randomId(){
	var result = new Buffer(20);
	for(var x = 0; x < 20; x++){
		result[x] = Math.floor(Math.random()*127);
	}

	return result;
}

function portToBinary(port){
	result = new Buffer(2);
	
	result[0] = (port >> 8) & 0xff;
	result[1] = port & 0xff;

	return result;
}

function ipToBinary(ip){
	arr = ip.split('.');
	result = new Buffer(4)
	for(var x=0;x<4;x++){
		result[x] = parseInt(arr[x]);
	}
	return result;
}

function peerToBinary(ip, port){
 	var result = new Buffer(6);
	ipToBinary(ip).copy(result, 0, 0);
	portToBinary(port).copy(result, 4 ,0);

	return result;

}

function binaryToIp(ip){
	var result = [];
	result.push( ip[0]);
	result.push( ip[1]);
	result.push( ip[2]);
	result.push( ip[3]);

	return result.join('.')
}

function binaryToPort(ip){

	var result = ip[4]<<8;
	result += ip[5] ;

	return result;
}

function Finder(id, port){
	var peers = [];
	var pendingPings = [];
	var id = id;
	var contactedPeers = [];
	var collectedPeers = [];

	var torrentHash = hexStringToBinary("d27275cd1cc5dc5b142cf724c7751ec79ddabdd7"); //buffer containing the binary id
	
	var ping, bootstrap;

	var sock = dgram.createSocket("udp4", function (msg, rinfo) {
	  //try{
		  var compactPeer = peerToBinary(rinfo.address, rinfo.port);
		  //console.log(compactPeer);
		  var data = bencode.bdecode( msg );

		  processMessage( data, compactPeer );
	  //} catch(e) {
	//	log("ERROR: Something fucked up :: " + e);
	//	console.log(msg);
		//log(msg.length);
	  //}

	});
	
	sock.bind(port, '0.0.0.0');

	this.start = function(){
		log("Finder started");
		bootstrap();
		ping = setInterval ( ping, 25 );
		bootstrap = setInterval ( bootstrap, 1000 );
	}
	
	function stop(){
		sock.close();
		clearInterval(ping);
		clearInterval(bootstrap);
	}

	function queryPeers(peer){
		var message = new Buffer("d1:ad2:id20:"+ id +"6:target20:00000000000000000000e1:q9:find_node1:t2:aa1:y1:qe"); //target is hash of the current torrent
		torrentHash.copy(message, 43, 0);

		ipAddress = binaryToIp(peer.peerString);
		port = binaryToPort(peer.peerString);
	
		sock.send(message, 0, message.length, port, ipAddress, function(err, bytes) {});

	}

	function queryForTorrent(peer){  //ask for peers for the torrent
		var message = new Buffer("d1:ad2:id20:"+ id +"9:info_hash20:00000000000000000000e1:q9:get_peers1:t2:aa1:y1:qe"); //target is hash of the current torrent
		torrentHash.copy(message, 46, 0);
		//console.log(message.toString());

		ipAddress = binaryToIp(peer.peerString);
		port = binaryToPort(peer.peerString);
	
		sock.send(message, 0, message.length, port, ipAddress, function(err, bytes) {
		});

	}

	function saveTorrentPeers(newPeers){
		//console.log(collectedPeers.length);
		newPeers.forEach(function(peer){

				//if(currentPeer.toString() != peer.toString()) {
					collectedPeers.push(peer);
				//}
			
		});

		
		if(collectedPeers.length > 300 && fetchers ) {
				new torrentFetcher(collectedPeers, torrentHash);
				stop();
				//console.log(fetchers);
		};

	}

	function addPeer(id, compactPeer){
		//console.log(id);
		try{
		var newPeer = true;
		peers.forEach(function(peer){
			if(peer.id.toString() == id.toString()) {
				peer.alive = true;
				throw BreakException;
			}
		});
		} catch(e) {
			newPeer = false;
		}

		if(newPeer){
			//console.log("Peers - " + peers.length );
			var peer = {
			   'id': id,
			   'peerString': compactPeer,
			   'lastContact': date.getTime(),
			   'alive' : true
			};
			peers.push(peer);
			//Get more peers from the new peer
			queryForTorrent(peer);
		}

	}

	function pingPeers(peers){
		if(pendingPings > 200) return;
		//peerList = peers.toString('binary');

		for(var x = 0; x+6 < peers.length; x+=6){
			var peer = peers.slice(x, x+6);
			
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
		if(pendingPings.length > 0) return;
		var message = new Buffer("d1:ad2:id20:"+ id +"6:target20:00000000000000000000e1:q9:find_node1:t2:aa1:y1:qe"); //target is hash of the current torrent
		torrentHash.copy(message, 43, 0);

		

		if(peers.length < 5){
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
				//console.log(msg);
		if('r' in msg){
			if('nodes' in msg.r){
				//find node response message
				
				pingPeers(msg.r.nodes);

			} else if('values' in msg.r){
				//response containing compact peer id's
				saveTorrentPeers(msg.r.values);

			} else {
				//ping response message

				addPeer(msg.r.id, compactPeer);

			}
		} else {
			//not a response message
			
			if("q" in msg){
				if(msg.q == "get_peers"){
					//do nothing, we don't want to collect these
					//addTorrentHash(msg.a.info_hash);
				};

				if(msg.q == "ping"){

					pingReply(msg, compactPeer);
					
				}
			}

		}
	};
};




