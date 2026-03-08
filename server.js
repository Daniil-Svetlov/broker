const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Абсолютный путь к папке public для Mac
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

let currentPrice = 0.65420;

setInterval(() => {
    currentPrice += (Math.random() - 0.5) * 0.00012;
    io.emit('price_update', {
        time: Math.floor(Date.now() / 1000),
        value: parseFloat(currentPrice.toFixed(5))
    });
}, 1000);

io.on('connection', (socket) => 
{
    console.log('User connected');
    socket.on('make_trade', (data) => 
    {
        const { type, amount, time } = data;
        const entryPrice = currentPrice;
        setTimeout(() => {
            const exitPrice = currentPrice;
            const isWin = type === 'higher' ? exitPrice > entryPrice : exitPrice < entryPrice;
            socket.emit('trade_result', {
                result: isWin ? "WIN" : "LOSS",
                profit: isWin ? (amount * 0.85) : -amount
            });
        }, time * 1000);
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log('🚀 LUMIT ONLINE: http://localhost:3000');
});