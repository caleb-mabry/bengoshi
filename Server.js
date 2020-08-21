const net = require("net");
const crypto = require("crypto");
const fs = require("fs");
require("./import.js");
if (!fs.existsSync("./config.json")) {
    while (true); // Hang, tsuimporter.js will close the process
}
var config = JSON.parse(fs.readFileSync("./config.json"));
const cmds = require("./commands.js");
const protocol = require("./protocol.js");
const util = require("./util.js");

var currentID = 0;

function reloadConf(){
    config = JSON.parse(fs.readFileSync("./config.json"));
    protocol.reloadConf();
}

// Server Listener
net.createServer((socket) => {
    reloadConf();
    util.players = util.clients.length;

    config.bans.forEach((ban) => {
        if (ban.ip == socket.remoteAddress) {
            socket.end();
        }
    });

    var socketName = socket.remoteAddress + ":" + socket.remotePort;
    var client;
    socket.write("decryptor#34#%");

    client = {
        oocmute: false,
        cemute: false,
        mute: false,
        room: 0,
        name: socketName,
        socket: socket,
        id: util.clients.length
    };
    util.clients.push(client);

    if (config.mods.includes(socket.remoteAddress))
        client.moderator = true;

    socket.on("data", (data) => {
        if (data.length == 0)
            return;
        var packetContents;
        
        packetContents = data.toString("utf-8").split("#");

        if (packetContents == null)
            return;
        if (packetContents[0] == "") // for some reason random packets start with a #
            packetContents.shift();
        var header = util.fantaDecrypt(packetContents[0], 5);
        packetContents.shift();
        packetContents.pop();

        if (protocol.PacketHandler[header] == undefined) {
            console.log("Unimplemented packet: " + header);
            console.log(packetContents);
            console.log(socketName);
            return;
        }

        protocol.PacketHandler[header](packetContents, socket, client);
    });

    socket.on('error', (e) => {
        console.log(e);
    });

    socket.on('close', () => {
        util.cleanup(client, protocol);
    });
}).listen(config.port);

process.on('uncaughtException', function (err) {
    console.error(err);
});

// Master server advertiser
if (!config.private) {
    var client = new net.Socket();
    client.connect(config.msport, config.msip, () => {
        console.log("Master server connection established");
        client.write(util.packetBuilder("SCC", [`${config.port}&1`, config.name, config.description, `bengoshi v${util.softVersion}`]));
    });
}