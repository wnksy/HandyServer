const crypto = require("crypto");
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const logger = require('morgan');

const privateKey  = fs.readFileSync('ssl/key.pem');
const certificate = fs.readFileSync('ssl/cert.pem');
const credentials = { key: privateKey, cert: certificate };

const app = express();
const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);

/*
// This was an attempt to use a recent version of Socket.IO (>= 3).
// Unfortunately, I still couldn't get it working and resorted to
// just use Socket.IO 2.
// The Arduino client is apparently based on that version.
//const { Server } = require("socket.io");
const io = new Server(httpsServer, {
    allowEIO3: true,
    cookie: {
        name: "io",
        httpOnly: false,
        path: "/"
    }
});
*/
const io = require("socket.io")(httpsServer, { });

const scriptStoragePath = path.join(os.tmpdir(), 'hs')

var client = null;
var pendingResponses = {};
var cmdToApiId = {};
var apiIdToCmd = {};


app.use(logger('dev'));
app.use(express.text({
    type: [
        'text/plain',
        'text/csv'
    ]
}));
app.use(express.json({
    type: [
        'application/json',
        'application/funscript'
    ],
    limit: '10MB' // max script size
}));

function getServerTime() {
    return Math.floor(new Date().getTime());
}

function getCommandApiId(cmd) {
    // Generate a unique Api ID for the command and cache it
    // (no need to differentiate between clients, since we only support 1)
    let id = cmdToApiId[cmd];
    if (id == undefined) {
        id = crypto.randomBytes(8).toString('hex');
        cmdToApiId[cmd] = id;
        apiIdToCmd[id] = cmd;
    }
    return id;
}

function ioResponseTimeoutHandler(socket, cmd) {
    let pendingResponse = pendingResponses[cmd];
    pendingResponses[cmd] = undefined;

    // Remove event handler for response
    // (normally, it gets removed automatically when it runs)
    socket.removeAllListeners(pendingResponse.apiId);

    // Invoke callback with null argument to indicate timeout
    pendingResponse.callback(null);
}

function sendMessage(socket, event, msg) {
    console.debug('Sending message: ' + event + ' = ' + JSON.stringify(msg));
    socket.emit(event, msg);
}

function ioSendCommand(socket, cmd, obj, callback) {
    const apiId = getCommandApiId(cmd);
    obj.cmd = cmd;
    obj.timeout = 5000;
    obj.api = apiId;
    
    socket.once(apiId, (msg) => handleClientMessage(socket, apiId, msg));
    
    let reqTimestamp = getServerTime();
    let timer = setTimeout(ioResponseTimeoutHandler, obj.timeout, socket, cmd);
    pendingResponses[cmd] = { callback, timer, apiId, reqTimestamp };

    sendMessage(socket, 'toMachine', obj);
}

function handleClientMessage(socket, event, msg) {
    console.debug('Received message: ' + event + ' = ' + JSON.stringify(msg));
    if (event == 'toServer') {
        // Machine sent us a message
        switch (msg.cmd) {
            case 'shtp':
                sendMessage(socket, 'toMachine', {
                    cmd: msg.cmd,
                    serverTime: ''+getServerTime(), // Must be sent as a string!
                    msgNr: msg.msgNr
                });
                break;
        }
    } else {
        // Machine responded to our message
        let resTimestamp = getServerTime();

        const cmd = apiIdToCmd[event];
        if (cmd != undefined) {
            const pendingResponse = pendingResponses[cmd];
            if (pendingResponse != undefined) {
                let elapsed = resTimestamp - pendingResponse.reqTimestamp;

                // Response no longer pending
                pendingResponses[cmd] = undefined;
                clearTimeout(pendingResponse.timer);
                // Invoke callback with response message
                pendingResponse.callback(msg);
            } else {
                console.warn('Received response to "' + cmd + '" but command is not pending (timed out?)');
            }
        } else {
            console.warn('Unexpected event: ' + event);
        }
    }
}

function sendJsonNotConnectedResponse(res) {
    res.json({ success: false, error: 'not connected' });
}

function sendJsonTimeoutResponse(res) {
    res.json({ success: false, error: 'timeout' });
}

function sendJsonResponse(res, obj) {
    obj.connected = (client != null);
    res.json(obj);
}

function funscriptToCsv(obj) {
    if (!obj.actions || !Array.isArray(obj.actions))
        return null;
    
    const csv = obj.actions.map((x) => x.at + ',' + x.pos).join('\r\n');
    return csv;
}

io.on('connection', (socket) => {
    console.log('client connected');
    client = socket;

    socket.on('toServer', (msg) => handleClientMessage(socket, 'toServer', msg));

    socket.on('disconnect', () => {
        client = null;
        console.log('client disconnected');
    });
});

app.get('/:connectionKey/getVersion', (req, res) => {
    if (client == null)
        return sendJsonNotConnectedResponse(res);

    ioSendCommand(client, 'getVersion', {}, (ioRes) => {
        if (ioRes != null) {
            sendJsonResponse(res, ioRes);
        } else {
            sendJsonTimeoutResponse(res);
        }
    });
});
app.get('/:connectionKey/getSettings', (req, res) => {
    if (client == null)
        return sendJsonNotConnectedResponse(res);

    ioSendCommand(client, 'getSettings', {}, (ioRes) => {
        if (ioRes != null) {
            sendJsonResponse(res, ioRes);
        } else {
            sendJsonTimeoutResponse(res);
        }
    });
});
app.get('/:connectionKey/getStatus', (req, res) => {
    if (client == null)
        return sendJsonNotConnectedResponse(res);

    ioSendCommand(client, 'getStatus', {}, (ioRes) => {
        if (ioRes != null) {
            sendJsonResponse(res, ioRes);
        } else {
            sendJsonTimeoutResponse(res);
        }
    });
});
app.get('/:connectionKey/setMode', (req, res) => {
    const mode = req.query.mode;
    if (mode == undefined)
        return res.sendStatus(400);
    if (client == null)
        return sendJsonNotConnectedResponse(res);

    ioSendCommand(client, 'setMode', { mode }, (ioRes) => {
        if (ioRes != null) {
            sendJsonResponse(res, ioRes);
        } else {
            sendJsonTimeoutResponse(res);
        }
    });
});
app.get('/:connectionKey/setSpeed', (req, res) => {
    const type = req.query.type || 'mm/s';
    const speed = req.query.speed;
    if (speed == undefined)
        return res.sendStatus(400);
    if (client == null)
        return sendJsonNotConnectedResponse(res);

    ioSendCommand(client, 'setSpeed', { speed, type }, (ioRes) => {
        if (ioRes != null) {
            sendJsonResponse(res, ioRes);
        } else {
            sendJsonTimeoutResponse(res);
        }
    });
});
app.get('/:connectionKey/setStroke', (req, res) => {
    const type = req.query.type || 'mm';
    const stroke = req.query.stroke;
    if (stroke == undefined)
        return res.sendStatus(400);
    if (client == null)
        return sendJsonNotConnectedResponse(res);

    ioSendCommand(client, 'setStroke', { stroke, type }, (ioRes) => {
        if (ioRes != null) {
            sendJsonResponse(res, ioRes);
        } else {
            sendJsonTimeoutResponse(res);
        }
    });
});
app.get('/:connectionKey/syncPrepare', (req, res) => {
    const url = req.query.url;
    const name = req.query.name;
    const size = req.query.size;
    if (url == undefined)
        return res.sendStatus(400);
    if (client == null)
        return sendJsonNotConnectedResponse(res);

    ioSendCommand(client, 'syncPrepare', { url, name, size }, (ioRes) => {
        if (ioRes != null) {
            sendJsonResponse(res, ioRes);
        } else {
            sendJsonTimeoutResponse(res);
        }
    });
});
app.get('/:connectionKey/syncPlay', (req, res) => {
    const play = req.query.play;
    let serverTime = req.query.serverTime || getServerTime();
    if (typeof(serverTime) != 'number')
        return res.sendStatus(400);
    serverTime = ''+serverTime; // Must be sent as a string
    const time = req.query.time || 0;
    if (play == undefined)
        return res.sendStatus(400);
    if (client == null)
        return sendJsonNotConnectedResponse(res);

    ioSendCommand(client, 'syncPlay', { play, serverTime, time }, (ioRes) => {
        if (ioRes != null) {
            sendJsonResponse(res, ioRes);
        } else {
            sendJsonTimeoutResponse(res);
        }
    });
});
app.get('/:connectionKey/syncOffset', (req, res) => {
    const offset = req.query.offset;
    if (offset == undefined)
        return res.sendStatus(400);
    if (client == null)
        return sendJsonNotConnectedResponse(res);

    ioSendCommand(client, 'syncOffset', { offset }, (ioRes) => {
        if (ioRes != null) {
            sendJsonResponse(res, ioRes);
        } else {
            sendJsonTimeoutResponse(res);
        }
    });
});

// These are not part of the official API, they allow storing a script and
// let the Handy retrieve it.
app.post('/:connectionKey/script/upload', (req, res) => {
    const type = req.query.type;
    if (!type)
        return res.sendStatus(400);
    if (type != 'funscript' && type != 'csv')
        return res.sendStatus(400);

    //console.debug(req.body);

    let data = undefined;
    if (type == 'funscript') {
        // Convert to CSV
        data = funscriptToCsv(req.body);
    }
    else
        data = req.body;

    fs.mkdir(scriptStoragePath, { recursive: true }, (err) => {
        if (err) {
            console.error(err);
            return res.sendStatus(500);
        }

        const filepath = path.join(scriptStoragePath, 'script.csv');
        fs.writeFile(filepath, data, (err) => {
            if (err) {
                console.error(err);
                return res.sendStatus(500);
            }
    
            console.debug('Written ' + filepath);
            res.sendStatus(200);
        });    
    });
});
app.get('/:connectionKey/script/download', (req, res) => {
    options = {
        root: scriptStoragePath
    }
    res.sendFile('script.csv', options);
});


httpServer.listen(80);
httpsServer.listen(443);
