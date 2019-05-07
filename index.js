var https = require('https');
var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser');
var socket = require('socket.io');
var mysql = require('mysql');

var config = require('./config.json');

const con = mysql.createConnection({
    host: config.db_host,
    user: config.db_user,
    password: config.db_password,
    database: config.db_database,
    port: config.db_port
});

con.connect(function(err) {
    if (err) throw err;
    console.log("Connected!");
});

// App setup
var app = express();

// app.use(function(req, res, next) {
//   res.header("Access-Control-Allow-Origin", "*");
//   res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
//   next();
// });

app.use(express.static(__dirname + '/public'));

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))
// parse application/json
app.use(bodyParser.json())


var server;
if(fs.existsSync('./sslcert/fullchain.pem') && fs.existsSync('./sslcert/privkey.pem')){
    // create the https server
    const SSLCertificates = {
        cert: fs.readFileSync('./sslcert/fullchain.pem'),
        key: fs.readFileSync('./sslcert/privkey.pem')
    };
    server = https.createServer(SSLCertificates, app).listen(4440, function(){
        console.log('listening to https requests on port 4440');
    });
}else{
    server = app.listen(4440, function(){
        console.log('listening to http requests on port 4440');
    });
}


app.get('/', (req, res) => {
    res.sendFile('/index.html');
});

// get users
app.get('/users', (req, res) => {
	var sqlSel = "SELECT ID, name FROM Users ORDER BY name ASC";
    con.query(sqlSel, function (err, result) {
        if (err) throw err;
        res.status(200).send(JSON.parse(JSON.stringify(result)));
    });
});

// get channels
app.get('/channels', (req, res) => {
	var sqlSel = "SELECT ID, name FROM instant_messaging_channels ORDER BY name ASC";
    con.query(sqlSel, function (err, result) {
        if (err) throw err;
        res.status(200).send(JSON.parse(JSON.stringify(result)));
    });
});

// get messages for channel
app.post('/messages', (req, res) => {
    console.log("req,body.channel_id=" + req.body.channel_id);
    var channelID = req.body.channel_id;
	var sqlSel = "SELECT im.id, im.user_id, im.channel_id, im.message, im.created_at, DATE_FORMAT(im.created_at, '%D %M %Y %H:%m') AS time, u.name AS user_name FROM instant_messages AS im JOIN users AS u WHERE im.user_id = u.id AND im.channel_id = '" + channelID + "' ORDER BY im.created_at ASC";
    con.query(sqlSel, function (err, result) {
        if (err) throw err;
        res.status(200).send(JSON.parse(JSON.stringify(result)));
    });
});





// Keep track of who is connected
var connectedUsers = {};

// Socket setup
var io = socket(server);
io.on('connection', function(socket){
    var userID = socket.handshake.query['userID'];
    var socketID = socket.id;

    console.log('userID', userID, 'made socket connection', socketID);
    connectedUsers[userID] = socketID;
    console.log(connectedUsers);

    // Emit message to all users including this one
    socket.on('chat', function(data){

        // Calculate who this message is destined for from the channel name
        var fields = data.channel_id.split('-');
        var destination = fields[0] == userID ? fields[1] : fields[0];
        // Now establish if this user is connected & therefore should 'see' the message
        var seen = !(destination in connectedUsers) ? 0 : 1 ;

        console.log(destination);
        console.log(seen);

        var sql = "INSERT INTO instant_messages (user_id, channel_id, message, seen, created_at, updated_at) VALUES ('" + data.user_id + "', '" + data.channel_id + "', '" + data.message + "', " + seen + ", NOW(), NOW())";
        con.query(sql, function (err, result) {
            if (err) throw err;
            console.log("1 record inserted");
        });

        var currentDate = new Date();
        currentTime = currentDate.getHours() + ":" + (currentDate.getMinutes()<10?'0':'') + currentDate.getMinutes();
        data.time = currentTime;

        // emit to all sockets including this one
        io.sockets.emit('chat', data);
    });

    // Emit message to all users except this one
    socket.on('typing', function(data){
        // emit to all sockets except this one
        socket.broadcast.emit('typing', data);
    });

    // Disconnection
    socket.on('disconnect', function(){
        console.log('userID', userID, 'socket disconnected', socketID);
        delete connectedUsers[userID];
        console.log(connectedUsers);
    });
});
