var net = require('net');
var eyes = require('eyes');
var bencode = require('dht-bencode');
var fs = require('fs');
var crypto = require('crypto');

// Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
  var rest = this.slice((to || from) + 1 || this.length);
  this.length = from < 0 ? this.length + from : from;
  return this.push.apply(this, rest);
};

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

exports.torrentFetcher = torrentFetcher;

function torrentFetcher(peers, infohash){  //peers is array of compact peers, infohash is a buffer
	console.log("Fetcher started with "+ peers.length +" peers");
	
	nodeFetcher(peers, infohash, function(result, peers){
		console.log("Result = " + result);
		console.log("Peers = " + peers.length);
		if(result) return true;
		else {	
			if(peers.length == 1) {
				console.log("Out of peers, exiting without success");
				return false;
			}
			else {
				peers.remove(0);		
				return torrentFetcher(peers, infohash);
			}
		}

	})
}



function nodeFetcher(peers, infohash, callback){
	var host = binaryToIp(peers[0]);
	var port = binaryToPort(peers[0]);
	var infohash = infohash;
	var peers = peers;

	console.log(host + " : " + port);

	var firstPacket = true;
	var torrentFile = new Buffer(0);
	var partialData = undefined;
	var result = false;


	//hexStringToBinary(infohash);

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

	function randomId(){
		var result = new Buffer(20);
		for(var x = 0; x < 20; x++){
			result[x] = Math.floor(Math.random()*255);
		}

		return result;
	}

	function getDataOffset(data){
		 for(var x = 0; x < data.length; x++){
			if(String.fromCharCode(data[x-1]) == 'e' && String.fromCharCode(data[x]) == 'e'){
			 	return x+1;
			}
		
		 }
		return -1;

	}

	function extensionHandshake(){
		var payload = new Buffer("d1:ei1e1:md11:ut_metadatai3ee13:metadata_sizei17426e1:pi51413e4:reqqi512e11:upload_onlyi1e1:v17:Transmission 2.33ee");
	
		var messageId = new Buffer([20]);
		var extendedId = new Buffer([0]);

		var length = new Buffer(4);
		length.writeUInt32BE(payload.length + messageId.length + extendedId.length, 0);

		client.write(length);
		client.write(messageId);
		client.write(extendedId);
		client.write(payload);


	};

	function metadataRequest(piece){
		var payload = new Buffer("d8:msg_typei0e5:piecei" + piece + "ee");
	
		var messageId = new Buffer([20]);
		var extendedId = new Buffer([3]); // metadata extension ID

		var length = new Buffer(4);
		length.writeUInt32BE(payload.length + messageId.length + extendedId.length, 0);

		client.write(length);
		client.write(messageId);
		client.write(extendedId);
		client.write(payload);
	}

	function writeMetaData(dictionary, data){
		dictionary = bencode.bdecode( dictionary );

		if(dictionary.piece == 0){
			torrentFile = new Buffer(dictionary.total_size);
			torrentFile.fill(0);
			data.copy(torrentFile, 0, 0, data.length);
		} else {
			var offset = dictionary.piece * 16384;
			console.log(torrentFile.slice(16380, 16390) );
		
			data.copy(torrentFile, offset, 0, data.length);
			console.log(torrentFile.slice(16380, 16390) );
		}

		if( data.length == 16384 ) { 
			setTimeout(metadataRequest(dictionary.piece + 1), 100);
		} else {
			//console.log( torrentFile.length );
			//file is complete, save it to filesystem
			//console.log(torrentFile.toString());

			var shasum = crypto.createHash('sha1');
			shasum.update(torrentFile);
			if( shasum.digest('hex') == infohash){
				console.log('Sucessfully got torrent metadata');
				fs.writeFile("./torrents/" + infohash + ".torrent", torrentFile , function(err) {
				    if(err) {
					console.log(err);
				    } else {
					console.log("The file was saved!");
					result = true;
				    }
				    client.end();
				}); 
			}

		
		}

	}

	var client = new net.Socket();
	client.setTimeout(20000);
	// timeout function

	client.connect(port, host, function() {

	    console.log('CONNECTED TO: ' + host + ':' + port);
	
	    // Write the BT header
	    var header = new Buffer( String.fromCharCode(19) + 'BitTorrent protocol' ), flagBytes = new Buffer(8);

	    flagBytes.fill(0);
	    flagBytes[5] = 0x10;	// Set the extension bit

	    //console.log(flagBytes);

	    client.write(header);	//Shit needs to be written as individual buffers to avoid funky string encoding
	    client.write(flagBytes);
	    client.write(infohash);
	    client.write(randomId());

	});

	// Add a 'data' event handler for the client socket
	// data is what the server sent to this socket
	client.on('data', function(data) {

	   if(firstPacket){
		firstPacket = false;   //discard the first packet (handshake)
		console.log('got handshake');
	   } else {
		console.log(data.toString());
		if(partialData != undefined){
			var oldData = data;
			data = new Buffer( data.length + partialData.length );
			partialData.copy(data);
			oldData.copy(data, partialData.length, 0 );
			partialData = undefined;

		   };
		   do{
			   if(data.length < 6) return;
	

			   var length = data.readUInt32BE(0);
			   if(length > data.length){
				//console.log("got partial data");
				partialData = data;
				return;

			   }
			   
				console.log(length);
				console.log(data.length);
			    
			   
			   var payload = data.slice(4, length+4);

			   //check if we have another packet in the same buffer
			   if(data.length > length + 4){
				data = data.slice(length+4, data.length);
			   }else{
				data = new Buffer(0);
			   }

			   var messageId = payload.readInt8(0);
			   //console.log("\n\n\n");


			    if(messageId == 20){
				var extensionId = payload.readInt8(1);
				//console.log("ExtensionID = " + extensionId);

				if(extensionId == 0) {
					extensionHandshake();
					setTimeout(metadataRequest(0), 50);
				} else if(extensionId == 3) {
					var dictionary = payload.slice( 2 , getDataOffset(payload) ).toString() ;
					var metadata = payload.slice( getDataOffset(payload), payload.length );

					writeMetaData(dictionary, metadata);
				}

	
			    }
			    
			    //console.log(data.slice(0,6));
			    //console.log(length, data.length);
			    //console.log(data.toString());
		   } while(data.length > 4);
	   }
	});

	// Add a 'close' event handler for the client socket
	client.on('close', function() {
	    //console.log('Connection closed');
	    callback(result, peers);
	});

	client.on('error', function(exception) {
	  //console.log('SOCKET ERROR');
	  client.destroy();
	})

	client.on('timeout', function(exception) {
	  //console.log('SOCKET ERROR');
	  client.destroy();
	})

};
