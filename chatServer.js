var protobuf = require('protobufjs');
var net = require('net');
var jwt = require('jsonwebtoken');
var tokenSecret = require('./config.js').tokenSecret;

var MongoClient = require('mongodb').MongoClient;

var DAO = require('./dao/imDao.js');
var config = require('./config.js');

var HOST = '127.0.0.1';
var PORT = 6969; //聊天端口

var mongoHost = config.mongo.host;
var mongoPort = config.mongo.port;
var mongoDB = config.mongo.db;
var mongourl = 'mongodb://' + mongoHost + ':' + mongoPort + '/' + mongoDB;

var clientList = [];


//创建chat-TCP服务器
net.createServer(function(sock) {

	//当获得连接时,输出信息
	console.log('CONNECTED: ' + sock.remoteAddress + ':' + sock.remotePort);

	sock.on('data', function(data) {
		//心跳包检测
		if (data == '0') {
			for (var i = 0; i < clientList.length; i++) {
				if (clientList[i].sock === sock) {
					clientList[i].time = Math.floor(Date.now()/1000);
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

			var clientMessage = root.lookup('IM.ClientToChatServer');
			var message = clientMessage.decode(data);

			//检验消息合法性
			if (!message.timestamp || !message.token || !message.type || !message.toId || !message.content) {
				protobuf.load('./IM.Message.proto', function(err, root) {
					if (err) {
						console.log(err);
						return ;
					}

					var serverMessage = root.lookup('IM.ChatServerToClient');
					var backMessage = serverMessage.create({
						timestamp: message.timestamp,
						type: 6,
						fromId: 0,
						content: 2
					});

					sock.write(serverMessage.encode(backMessage).finish());
				});
			}

			//解析token
			var userId = verifyToken(message.token, function(err, userId) {
				if (err) {
					protobuf.load('./IM.Message.proto', function(err, root) {
						if (err) {
							console.log(err);
							return ;
						}

						var serverMessage = root.lookup('IM.ChatServerToClient');
						var backMessage = serverMessage.create({
							timestamp: message.timestamp,
							type: 6,
							fromId: 0,
							content: 2
						});

						sock.write(serverMessage.encode(backMessage).finish());
					});
					return ;
				}

				//更新tcp连接数组
				var tag = false;
				for (var i = 0; i < clientList.length; i++) {
					if (clientList[i].userId === userId) {
						clientList[i].time = Math.floor(Date.now()/1000);
						tag = true;
					}
				}
				if (!tag) {
					clientList.push({
						time: Math.floor(Date.now()/1000),
						sock: sock,
						userId: userId
					});
					//写入mongodb
					MongoClient.connect(mongourl, function(err, db) {
						var col = db.collection('tcps');
						col.insert({
							userId: userId,
							id: ctrlId,
						}, function (err, result) {
							if(err) {
								console.log(err);
								return;
							}

							return result;
						});
					});
				}
			});
		});
	});

	sock.on('close', function(data) {
		console.log('CLOSED: ' + sock.remoteAddress + ' ' + sock.remotePort);
	});
}).listen(PORT, HOST);

//创建tcp客户端连接ctrl服务器
var ctrlServer = new net.Socket();
ctrlServer.connect(config.ctrlServer.PORT,config.ctrlServer.HOST, function() {});
var ctrlId = -1;

ctrlServer.on('data', function(data) {
	//第一次连接获取id
	if (ctrlId == -1) {
		ctrlId = data;
		return ;
	}

	//接收来自ctrlServer的信息
	protobuf.load('./IM.Message.proto', function(err, root) {
		if (err) {
			console.log(err);
			return ;
		}

		var Message = root.lookup('IM.CtrlServerToChatServer');
		var message = clientMessage.decode(data);
		//检验消息合法性
		if (!message.timestamp || !message.type || !message.fromId || !message.toId || !message.content) {
			return ;
		}

		//找到用户并发送信息
		sendMessageToUser(message.timestamp, message.fromId, message.type, message.content, message.toId);
	});
});

//验证token
function verifyToken(token, callback) {
	jwt.verify(token, tokenSecret, function (err, decoded) {
		var error = null;
		if (err) {
				error = {
				msg: "token无效",
				code: 400
			}
			callback && callback(error, null);
			return ;
		}

		if(!decoded || !decoded.userId) {
			error = {
				msg: "token无效",
				code: 400
			}
			callback && callback(error, null);
			return ;
		}

		callback && callback(error, decoded.userId);
	});
}

//发送信息给单人
function sendMessageToUser(timestamp, fromId, type, content, toId) {
	var tag = false;
	//在当前tcp服务器寻找用户
	for (var i = 0;i < clientList.length; i++) {
		if (clientList[i].userId == toId) {
			protobuf.load('./IM.Message.proto', function(err, root) {
				if (err) {
					console.log(err);
					return ;
				}

				var serverMessage = root.lookup('IM.ChatServerToClient');
				var message = serverMessage.create({
					timestamp: timestamp,
					type: type,
					fromId: fromId,
					content: content
				});

				clientList[i].write(serverMessage.encode(message).finish());
				tag = true;
			});
		}
	};

	//若在当前服务器找不到用户则转发至ctrlServer
	if(!tag) {
		protobuf.load('./IM.Message.proto', function(err, root) {
			if (err) {
				console.log(err);
				return ;
			}

			var serverMessage = root.lookup('IM.ChatServerToCtrlServer');
			var message = serverMessage.create({
				timestamp: timestamp,
				type: type,
				fromId: fromId,
				toId: toId,
				content: content
			});

			if (ctrlServer) {
				ctrlServer.write(serverMessage.encode(message).finish());
			}
		});
	}
}

//发送信息给多人
function sendMessageToGroup(timestamp, fromId, type, content, groupId) {
	//获取群组用户
	DAO.getGroupUsers(groupId, function(err, data) {
		if (err) {
			console.log(err);
			callback && callback(err, data);
		}

		//对群组每个用户都推送信息
		for (var i = 0; i < data.length; i++) {
			sendMessageToUser(timestamp, fromId, type, content, data[i].id);
		}
	});
}