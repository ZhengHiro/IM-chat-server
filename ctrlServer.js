var protobuf = require('protobufjs');
var net = require('net');

var MongoClient = require('mongodb').MongoClient;

var config = require('./config.js');

var HOST = config.ctrlServer.HOST;
var PORT = config.ctrlServer.PORT;

var mongoHost = config.mongo.host;
var mongoPort = config.mongo.port;
var mongoDB = config.mongo.db;
var mongourl = 'mongodb://' + mongoHost + ':' + mongoPort + '/' + mongoDB;

var serverList = [];
var serverIndex = 0;

//创建ctrl-TCP服务器
net.createServer(function(sock) {

	//将tcp服务器加入列表
	serverList.push({
		sock: sock,
		time: Math.floor(Date.now()/1000),
		serverIndex: serverIndex
	});
	sock.write(serverIndex+'');
	serverIndex++;

	//当获得连接时,输出信息
	console.log('CONNECTED: ' + sock.remoteAddress + ':' + sock.remotePort);

	sock.on('data', function(data) {
		//心跳包检测
		if (data == '0') {
			for (var i = 0; i < serverList.length; i++) {
				if (serverList[i].sock === sock) {
					serverList[i].time = Math.floor(Date.now()/1000);
					return ;
				}
			}
			return ;
		}

		protobuf.load('./IM.Message.proto', function(err, root) {
			if (err) {
				console.log(err);
				return ;
			}

			var Message = root.lookup('IM.ChatServerToCtrlServer');
			var message = Message.decode(data);

			//检验消息合法性
			if (!message.timestamp || !message.fromId || !message.type || !message.toId || !message.content) {
				return ;
			}

			//在mongodb中寻找用户所在tcp服务器
			MongoClient.connect(mongourl, function(err, db) {
				var col = db.collection('tcps');
				col.find({userId: message.toId}, function (err, result) {
					if (err) {
						console.log(err);
						return ;
					}

					protobuf.load('./IM.Message.proto', function(err, root) {
						if (err) {
							console.log(err);
							return ;
						}

						var MessageToChat = root.lookup('IM.CtrlServerToChatServer');
						var message = MessageToChat.create({
							timestamp: message.timestamp,
							type: type,
							fromId: fromId,
							toId: toId,
							content: content
						});

						for (var i = 0; i < serverList.length; i++) {
							if (serverList[i].serverIndex == result[0].id) {
								serverList[i].sock.write(MessageToChat.encode(message).finish());
							}
						};
					});
				});
			});
		});
	});

	sock.on('close', function(data) {
		console.log('CLOSED: ' + sock.remoteAddress + ' ' + sock.remotePort);
	});
}).listen(PORT, HOST);