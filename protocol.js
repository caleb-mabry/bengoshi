// All the packet handling and game state (that is not user-specific) takes place here
const fs = require("fs");
const util = require("./util.js");
const cmds = require("./commands.js");
var config = JSON.parse(fs.readFileSync("./config.json"));

// Game state
// TODO: Room state objects
var rooms = [];

// Initialize rooms
var evidenceLists = [];
if (!fs.existsSync("./evidence.json"))
    fs.writeFileSync("./evidence.json", "[]");
else
    evidenceLists = JSON.parse(fs.readFileSync("./evidence.json"));

var initEvidence = evidenceLists.length != config.rooms.length;
if (initEvidence)
    evidenceLists = [];
for (var i = 0; i < config.rooms.length; i++) {
    if (initEvidence)
        evidenceLists.push([]);
    rooms[i] = JSON.parse(JSON.stringify(config.rooms[i])); // Deep copy
    rooms[i].evidence = evidenceLists[i];
    rooms[i].taken = Array.apply(null, Array(config.characters.length)).map(Number.prototype.valueOf, 0);
    rooms[i].song = "~stop.mp3";
}

function reloadConf(){
    config = JSON.parse(fs.readFileSync("./config.json"));
}

// This function is called on an interval, per room, to loop music.
function loopMusic(room) {
    util.broadcast("MC", [rooms[room].song, -1], room);
}

// Finds room by name
function isRoom(name) {
    for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].name == name)
            return i;
    }
    return -1;
}

// Every FantaPacket is interpreted here
PacketHandler = {
    // Hardware ID
    "HI": (packetContents, socket, client) => {
        config.bans.forEach((ban) => {
            if (ban.hwid == packetContents[0])
                socket.end();
        });
        var hardware = packetContents[0];
        client.hardware = hardware;
        util.send(socket, "ID", [hardware, "bengoshi", "v" + util.softVersion]);
        if (util.players >= config.maxPlayers)
            socket.close();
        util.send(socket, "PN", [util.players, config.maxPlayers]);
        util.send(socket, "FL", ["fastloading", "noencryption", "yellowtext", "websockets", "customobjections", "deskmod", "flipping"]);
        // No more encrypted packets after this
        // TODO: AO1 support
    },
    // Client software version info
    "ID": (packetContents, socket, client) => {
        client.software = packetContents[0];
        client.version = packetContents[1];
    },
    // Char/Music list lengths request
    "askchaa": (packetContents, socket, client) => {
        util.send(socket, "SI", [config.characters.length, evidenceLists[0].length, config.songs.length]);
    },
    // Request chars
    "RC": (packetContents, socket, client) => {
        util.send(socket, "SC", config.characters);
    },
    // Request music
    "RM": (packetContents, socket, client) => {
        var songNames = [];
        config.rooms.forEach((room) => {
            if (room.private) {
                if (client.moderator)
                    songNames.push(room.name);
            } else
                songNames.push(room.name);
        });
        config.songs.forEach((song) => {
            songNames.push(song.name);
        });
        util.send(socket, "SM", songNames);
    },
    // Request data (taken chars, oppass, loading done)
    "RD": (packetContents, socket, client) => {
        util.send(socket, "CharsCheck", rooms[client.room].taken);
        util.send(socket, "OPPASS", ["42"]);
        util.send(socket, "DONE", []);
        util.send(socket, "CT", ["Server", config.motd]); // Send MOTD
        util.send(socket, "LE", rooms[client.room].evidence); // Send evidence
        util.send(socket, "MC", [rooms[client.room].song, -1]); // Send song
        util.send(socket, "BN", [rooms[client.room].background]); // Send background
        if (client.software == "TNLIB") {
            util.send(socket, "CT", ["Dear TNC User", "Consider using the vanilla client."]);
        }
    },
    // Change character
    "CC": (packetContents, socket, client) => {
        if (rooms[client.room].taken[packetContents[1]] == -1)
            return;
        if (client.char != undefined)
            rooms[client.room].taken[client.char] = 0;
        rooms[client.room].taken[packetContents[1]] = -1;
        client.char = packetContents[1];
        delete client.pos;
        util.send(socket, "PV", [client.id, "CID", client.char]); // Char pick success
    },
    // Keepalive heartbeat
    "CH": (packetContents, socket, client) => {
        util.send(socket, "CHECK", []);
    },
    // IC chat
    // TODO: Filtering
    "MS": (packetContents, socket, client) => {
        if (client.mute) {
            util.send(socket, "CT", ["Server", "You are muted!"]);
            return;
        }
        if(client.pos != undefined){
            if(packetContents[5] != client.pos)
                packetContents[12] = 1; // sprite flip
            packetContents[5] = client.pos;
        }
        util.broadcast("MS", packetContents, client.room);
    },
    // OOC Chat
    "CT": (packetContents, socket, client) => {
        if (client.oocmute) {
            util.send(socket, "CT", ["Server", "You are muted!"]);
            return;
        }
        var input = packetContents[1];
        if (input.charAt(0) == "/") {
            var args = input.split(" ");
            var cmd = args[0];
            args.shift();
            cmds.parseCmd(cmd, args, socket, client, config, rooms);
            return;
        }
        util.broadcast("CT", packetContents, client.room);
    },
    // Music change
    // Some music items are used to change areas, however
    // And some are purely decorative (category titles)
    // All of that is handled here
    "MC": (packetContents, socket, client) => {
        var exists = false;
        var time = 0;
        config.songs.forEach((song) => {
            if (song.name == packetContents[0]) {
                if (song.category)
                    return;
                exists = true;
                time = Math.floor(song.length * 1000);
            }
        });
        if (exists) {
            rooms[client.room].song = packetContents[0];
            util.broadcast("MC", packetContents, client.room);
            clearInterval(rooms[client.room].roomInterval);
            if (rooms[client.room].song != "~stop.mp3" && time > 0)
                rooms[client.room].roomInterval = setInterval(loopMusic, time, client.room);
        }
        if (!exists) {
            var newRoom = isRoom(packetContents[0]);
            if (newRoom == client.room)
                return;
            if (newRoom != -1) {
                if (rooms[newRoom].taken[client.char] == -1) {
                    var newChar = rooms[client.room].taken.indexOf(0);
                    if (newChar == -1) {
                        util.send(socket, "CT", ["Server", "That room is full!"]);
                        return;
                    }
                    client.char = newChar;
                    util.send(socket, "PV", [client.id, "CID", client.char]);
                    util.send(socket, "CT", ["Server", "Your character was taken, so you have been assigned to " + config.characters[newChar]]);
                }
                rooms[client.room].taken[client.char] = 0;
                rooms[newRoom].taken[client.char] = -1;
                client.room = newRoom;
                util.send(socket, "CT", ["Server", "You moved to room number " + client.room + ", " + packetContents[0]]);
                util.send(socket, "BN", [rooms[client.room].background]);
                util.send(socket, "LE", rooms[client.room].evidence);
                util.send(socket, "MC", [rooms[client.room].song, -1]);
                util.send(socket, "CharsCheck", rooms[client.room].taken);
                util.players++;
            }
        }
    },
    // Call mod
    // TODO: Implement this lol
    "ZZ": (packetContents, socket, client) => {

    },
    // CE/WT
    // TODO: Rate limiting
    // TODO: Check player position
    "RT": (packetContents, socket, client) => {
        if (client.cemute) {
            util.send(socket, "CT", ["Server", "You are muted!"]);
            return;
        }
        if (rooms[client.room].CELock)
            return;
        util.broadcast("RT", packetContents, client.room);
    },
    // Judge HP bars
    // TODO: Check player position
    "HP": (packetContents, socket, client) => {
        util.broadcast("HP", packetContents, client.room);
    },
    // Add evidence
    "PE": (packetContents, socket, client) => {
        var evidence = packetContents[0] + "&" + packetContents[1] + "&" + packetContents[2];
        evidenceLists[client.room].push(evidence);
        fs.writeFileSync("./evidence.json", JSON.stringify(evidenceLists));
        util.broadcast("LE", evidenceLists[client.room], client.room);
    },
    // Remove evidence
    "DE": (packetContents, socket, client) => {
        evidenceLists[client.room].splice(packetContents[0], 1);
        fs.writeFileSync("./evidence.json", JSON.stringify(evidenceLists));
        util.broadcast("LE", evidenceLists[client.room], client.room);
    },
    // Edit evidence
    "EE": (packetContents, socket, client) => {
        var id = packetContents[0];
        packetContents.shift();
        evidenceLists[client.room][id] = packetContents[0] + "&" + packetContents[1] + "&" + packetContents[2];
        fs.writeFileSync("./evidence.json", JSON.stringify(evidenceLists));
        util.broadcast("LE", evidenceLists[client.room], client.room);
    },
    // Free character
    "FC": (packetContents, socket, client) => {
        rooms[client.room].taken[client.char] = 0;
    },
    // Slow load char list
    "askchar2": (packetContents, socket, client) => {
        var charList = [];
        for (var i = 0; i < Math.min(10, config.characters.length); i++) {
            charList.push(i);
            charList.push(config.characters[i] + "&&0&&&0&");
        }
        util.send(socket, "CI", charList);
    },
    // Slow load character batch request
    "AN": (packetContents, socket, client) => {
        var charList = [];
        var startAt = packetContents[0];
        startAt *= 10;
        for (var i = startAt; i < Math.min(startAt + 10, config.characters.length); i++) {
            charList.push(i);
            charList.push(config.characters[i] + "&&0&&&0&");
        }
        util.send(socket, "CI", charList);
        if (i == config.characters.length) {
            var songList = [];
            for (var i = 0; i < Math.min(10, config.songs.length); i++) {
                songList.push(i);
                songList.push(config.songs[i].name);
            }
            util.send(socket, "EM", songList);
        }
    },
    // Slow load music batch request
    "AM": (packetContents, socket, client) => {
        var songList = [];
        var startAt = packetContents[0];
        startAt *= 10;
        for (var i = startAt; i < Math.min(startAt + 10, config.songs.length); i++) {
            songList.push(i);
            songList.push(config.songs[i].name);
        }
        if (startAt > config.songs.length) {
            util.send(socket, "CharsCheck", rooms[client.room].taken);
            util.send(socket, "OPPASS", ["42"]);
            util.send(socket, "DONE", []);
            util.send(socket, "CT", ["Server", config.motd]); // Send MOTD
            util.send(socket, "LE", rooms[client.room].evidence); // Send evidence
            util.send(socket, "MC", [rooms[client.room].song, -1]); // Send song
            util.send(socket, "BN", [rooms[client.room].background]); // Send background
        }
        else{
            util.send(socket, "EM", songList);
        }
    },
    // AO1.x Disconnect, don't need to do anything
    "DC": (packetContents, socket, client) => {
        
    }
};

module.exports = {
    PacketHandler: PacketHandler,
    rooms: rooms,
    reloadConf: reloadConf
};