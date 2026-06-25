const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

app.use(express.static(path.join(__dirname, 'public')));

// Цены криптовалют
let prices = {
    'BTC/USDT': 96000,
    'ETH/USDT': 3400,
    'LUMIT/OTC': 1.08542
};

// База пользователей (в реальном проекте - база данных)
let users = {};

let binanceWs = null;
let reconnectTimeout = null;
let isConnecting = false;

// Подключение к Binance
function connectBinance() {
    if (isConnecting) return;
    isConnecting = true;
    
    const streams = ['btcusdt@trade', 'ethusdt@trade'];
    const url = `wss://stream.binance.com:9443/stream?streams=${streams.join('/')}`;
    
    console.log('🔄 Подключение к Binance...');
    
    if (binanceWs) {
        binanceWs.terminate();
    }
    
    binanceWs = new WebSocket(url);

    binanceWs.on('open', () => {
        console.log('✅ Binance WebSocket подключен');
        isConnecting = false;
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
    });

    binanceWs.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            if (message.data && message.data.s && message.data.p) {
                const symbol = message.data.s;
                const price = parseFloat(message.data.p);
                
                if (symbol === 'BTCUSDT' && price > 0) {
                    prices['BTC/USDT'] = price;
                } else if (symbol === 'ETHUSDT' && price > 0) {
                    prices['ETH/USDT'] = price;
                }
            }
        } catch (err) {
            // Игнорируем ошибки парсинга
        }
    });

    binanceWs.on('error', (err) => {
        console.error('❌ Binance ошибка:', err.message);
        isConnecting = false;
    });

    binanceWs.on('close', () => {
        console.log('⚠️ Binance отключен. Переподключение...');
        isConnecting = false;
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(() => {
                connectBinance();
            }, 5000);
        }
    });

    binanceWs.on('ping', () => {
        binanceWs.pong();
    });
}

connectBinance();

// Генератор для LUMIT
setInterval(() => {
    prices['LUMIT/OTC'] += (Math.random() - 0.5) * 0.0002;
}, 1000);

// Отправка обновлений
setInterval(() => {
    const dataToSend = {
        time: Math.floor(Date.now() / 1000),
        pairs: {
            'BTC/USDT': parseFloat(prices['BTC/USDT'].toFixed(2)),
            'ETH/USDT': parseFloat(prices['ETH/USDT'].toFixed(2)),
            'LUMIT/OTC': parseFloat(prices['LUMIT/OTC'].toFixed(5))
        }
    };
    
    io.emit('price_update', dataToSend);
}, 1000);

io.on('connection', (socket) => {
    console.log('👤 Клиент подключен:', socket.id);
    
    // Создаем демо-счет для нового пользователя
    if (!users[socket.id]) {
        users[socket.id] = {
            balance: 10000.00,  // Демо-баланс $10,000
            trades: [],
            activeTrades: [],
            totalProfit: 0,
            totalLoss: 0,
            winRate: 0
        };
        console.log(`💰 Создан демо-счет для ${socket.id}: $10,000`);
    }
    
    // Отправляем начальный баланс
    socket.emit('balance_update', {
        balance: users[socket.id].balance,
        totalProfit: users[socket.id].totalProfit,
        totalLoss: users[socket.id].totalLoss,
        winRate: users[socket.id].winRate
    });
    
    // Отправляем текущие цены
    socket.emit('price_update', {
        time: Math.floor(Date.now() / 1000),
        pairs: {
            'BTC/USDT': parseFloat(prices['BTC/USDT'].toFixed(2)),
            'ETH/USDT': parseFloat(prices['ETH/USDT'].toFixed(2)),
            'LUMIT/OTC': parseFloat(prices['LUMIT/OTC'].toFixed(5))
        }
    });
    
    // Обработка сделки
    socket.on('make_trade', (data) => {
        const user = users[socket.id];
        
        if (!user) {
            socket.emit('trade_error', { message: 'Пользователь не найден' });
            return;
        }
        
        const amount = parseFloat(data.amount);
        const time = parseInt(data.time);
        
        // Проверка баланса
        if (amount > user.balance) {
            socket.emit('trade_error', { message: 'Недостаточно средств' });
            return;
        }
        
        // Проверка корректности данных
        if (amount <= 0 || time <= 0) {
            socket.emit('trade_error', { message: 'Некорректные данные' });
            return;
        }
        
        const startPrice = prices[data.pair] || 0;
        const tradeId = `${socket.id}_${Date.now()}`;
        
        // Списываем сумму со счета
        user.balance -= amount;
        
        const trade = {
            id: tradeId,
            pair: data.pair,
            type: data.type,
            amount: amount,
            startPrice: startPrice,
            startTime: Date.now(),
            expirationTime: time * 1000,
            status: 'active'
        };
        
        user.activeTrades.push(trade);
        
        console.log(`💰 Сделка от ${socket.id}:`, {
            pair: data.pair,
            type: data.type,
            amount: `$${amount}`,
            startPrice: startPrice,
            expiration: `${time}s`
        });
        
        // Отправляем подтверждение открытия сделки
        socket.emit('trade_opened', {
            tradeId: tradeId,
            pair: data.pair,
            type: data.type,
            amount: amount,
            startPrice: startPrice,
            expirationTime: time
        });
        
        // Обновляем баланс
        socket.emit('balance_update', {
            balance: user.balance,
            totalProfit: user.totalProfit,
            totalLoss: user.totalLoss,
            winRate: user.winRate
        });
        
        // Закрываем сделку по истечении времени
        setTimeout(() => {
            const endPrice = prices[data.pair] || 0;
            let isWin = false;
            
            // Определяем победу
            if (data.type === 'higher') {
                isWin = endPrice > startPrice;
            } else if (data.type === 'lower') {
                isWin = endPrice < startPrice;
            }
            
            // Рассчитываем профит (85% при выигрыше)
            const profit = isWin ? amount * 1.85 : 0;
            const netProfit = profit - amount;
            
            // Обновляем баланс
            user.balance += profit;
            
            if (isWin) {
                user.totalProfit += netProfit;
            } else {
                user.totalLoss += amount;
            }
            
            // Сохраняем историю
            trade.status = isWin ? 'win' : 'loss';
            trade.endPrice = endPrice;
            trade.endTime = Date.now();
            trade.profit = netProfit;
            
            user.trades.push(trade);
            
            // Удаляем из активных
            user.activeTrades = user.activeTrades.filter(t => t.id !== tradeId);
            
            // Рассчитываем винрейт
            const totalTrades = user.trades.length;
            const winTrades = user.trades.filter(t => t.status === 'win').length;
            user.winRate = totalTrades > 0 ? ((winTrades / totalTrades) * 100).toFixed(1) : 0;
            
            console.log(`${isWin ? '✅' : '❌'} Сделка закрыта ${socket.id}:`, {
                result: isWin ? 'WIN' : 'LOSS',
                startPrice: startPrice.toFixed(5),
                endPrice: endPrice.toFixed(5),
                profit: `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`
            });
            
            // Отправляем результат
            socket.emit('trade_result', {
                tradeId: tradeId,
                result: isWin ? 'WIN' : 'LOSS',
                profit: netProfit,
                startPrice: startPrice.toFixed(5),
                endPrice: endPrice.toFixed(5),
                pair: data.pair
            });
            
            // Обновляем баланс
            socket.emit('balance_update', {
                balance: user.balance,
                totalProfit: user.totalProfit,
                totalLoss: user.totalLoss,
                winRate: user.winRate
            });
            
        }, time * 1000);
    });
    
    // Получение истории сделок
    socket.on('get_history', () => {
        const user = users[socket.id];
        if (user) {
            socket.emit('trade_history', {
                trades: user.trades.slice(-20).reverse(), // Последние 20 сделок
                activeTrades: user.activeTrades
            });
        }
    });
    
    // Сброс демо-счета
    socket.on('reset_demo', () => {
        users[socket.id] = {
            balance: 10000.00,
            trades: [],
            activeTrades: [],
            totalProfit: 0,
            totalLoss: 0,
            winRate: 0
        };
        
        socket.emit('balance_update', {
            balance: 10000.00,
            totalProfit: 0,
            totalLoss: 0,
            winRate: 0
        });
        
        socket.emit('demo_reset', { message: 'Демо-счет сброшен' });
        console.log(`🔄 Демо-счет сброшен для ${socket.id}`);
    });
    
    socket.on('disconnect', (reason) => {
        console.log('👋 Клиент отключен:', socket.id, '- причина:', reason);
        // Можно сохранить данные пользователя в базу данных
    });

    socket.on('error', (error) => {
        console.error('❌ Socket ошибка:', error);
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════╗
║   🚀 LUMIT TRADING ENGINE              ║
╠════════════════════════════════════════╣
║   📡 http://localhost:${PORT}          ║
║   💹 Binance: BTC/USDT, ETH/USDT       ║
║   💎 LUMIT/OTC (симуляция)             ║
║   💰 Демо-баланс: $10,000              ║
╚════════════════════════════════════════╝
    `);
});

// Корректное завершение
process.on('SIGINT', () => {
    console.log('\n⚠️ Завершение работы...');
    if (binanceWs) {
        binanceWs.close();
    }
    io.close();
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});

process.on('uncaughtException', (err) => {
    console.error('❌ Необработанная ошибка:', err);
});
