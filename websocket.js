const WebSocket = require('ws') //引入ws模块
const TaskScheduler = require('./utils/schedule');
const { notification: NotificationModel } =  require('./models');

// 创建websocket服务端对象，端口号为9998
// 为ws创建一个接口,就是连接websocket的链接
const wss = new WebSocket.Server({ 
    port:9998
});

// 导出监听方法
module.exports.listener = () =>{
    // 监听到后，触发connection事件
    // 对客户端连接事件进行监听,只要有WebSocket连接到该服务器，就会触发'connection'事件
    // ws代表的是客户端的连接的socket对象;req对象可以用来获取客户端的信息，如ip、端口号
    let scheduleTask = null;
    const searchNotification = async (toName) => {
        const data = await NotificationModel.count({where: {toName, read: 0}});
        return data;
    }
    wss.on('connection',(ws, req)=>{
        console.log('socket连接成功');
        
        // 若要获取所有已连接的客户端信息，则可以使用server.clients数据集
        ws.on('message',async (msg)=>{
            console.log('客户端发送给服务器', msg)
            if (msg && JSON.parse(msg)) {
                let { toName, timeSchedule } = JSON.parse(msg);
                const data = await searchNotification(toName);
                ws.send(JSON.stringify(data));
                // 连接成功后开启定时任务，定时查询回复信息，然后传回给前端
                scheduleTask = new TaskScheduler(timeSchedule, async () => {
                    const data = await searchNotification(toName);
                    ws.send(JSON.stringify(data));
                });
                scheduleTask.start();
            }
        })
        // 监听要关闭连接的函数
        ws.on('close',function close(){
            // 关闭逻辑
            scheduleTask && scheduleTask.stop();
            console.log('WebSocket连接已关闭')
        });
    })
}
