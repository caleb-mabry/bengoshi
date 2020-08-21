// Just a few supporting functions to reduce code redundancy
const fs = require("fs");
const softVersion = "1.1.0";
var clients = [];
var players = 0;

// Handles old AO1.X "encryption"
function fantaDecrypt(data, key) {
    var bytes = Buffer.from(data, "hex");
    if (bytes.length == 1 || bytes.length != (data.length / 2)) // Shitty heuristic, this will return the input if the input isnt all hex characters
        return data; // This allows "detection" of encrypted packets
    var cleartext = "";
    bytes.forEach((byte) => {
        cleartext += String.fromCharCode(byte ^ ((key & 0xFFFF) >> 8));
        key = ((byte + key) * 53761) + 32618 // more fantacrypt constants
        key &= 0xFFFF;
    });
    return cleartext;
}

function fantaEncrypt(data, key) {
    var crypt = "";
    for(var i = 0; i < data.length; i++){
        var char = data.charCodeAt(i) ^ ((key & 0xFFFF) >> 8);
        crypt += char.toString(16).toUpperCase();
        key = ((char + key) * 53761) + 32618;
        key &= 0xFFFF;
    }
    return crypt;
}

// Returns if a socket is connected or not
function isConnected(socketName) {
    clients.forEach((client) => {
        if (client.name === socketName)
            return true;
    });
    return false;
}

// Send a FantaPacket to every client (within a room)
function broadcast(header, data, room) {
    clients.forEach((client) => {
        if (client.room == room) {
            send(client.socket, header, data, client.websocket);
        }
    });
}

// Turns a header and array into a FantaPacket
function packetBuilder(header, packetContents) {
    var packet = header + "#";
    packetContents.forEach((datum) => {
        if(datum != undefined)
            packet += datum.toString() + "#";
        else
            packet += "#";
    });
    packet += "%";
    return packet;
}

// Send a FantaPacket to a client
function send(socket, header, data, ws) {
    socket.write(packetBuilder(header, data));
}

function recalculateIds(){
    for(var i = 0; i < clients.length; i++){
        clients[i].id = i;
    }
    players = clients.length;
}

// Disconnects a client
function cleanup(client, protocol) {
    protocol.rooms[client.room].taken[client.char] = 0;
    clients.splice(client.id, 1);
    recalculateIds();
}

// Ban a player, update the config
function ban(client, config) {
    client.socket.end();
    config.bans.push({
        ip: client.socket.remoteAddress,
        hwid: client.hardware
    });
    fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
}

module.exports = {
    fantaDecrypt: fantaDecrypt,
    fantaEncrypt: fantaEncrypt,
    isConnected: isConnected,
    broadcast: broadcast,
    send: send,
    cleanup: cleanup,
    ban: ban,
    softVersion: softVersion,
    packetBuilder: packetBuilder,
    clients: clients,
    players: players
};