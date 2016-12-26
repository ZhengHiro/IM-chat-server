module.exports = {
	//@Mysql
	//params: host, user, database, password
	mysql: {
		host: "im.cxyehqjrmkan.ap-northeast-1.rds.amazonaws.com",
		user: "root",
		database: "im_db",
		password: "rootroot"
	},

	ctrlServer: {
		HOST: '127.0.0.1',
		PORT: 7000
	},

	mongo: {
		host: '127.0.0.1',
		port: 27017,
		db: 'test'
	},
	
	tokenSecret: "bskjdhkzj"
}
