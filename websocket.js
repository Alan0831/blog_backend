const WebSocket = require('ws') //引入ws模块
const { notification: NotificationModel } =  require('./models');
// 创建websocket服务端对象，端口号为9998
// 为ws创建一个接口,就是连接websocket的链接
const wss = new WebSocket.Server({ 
    port:9998
})
// 导出监听方法
module.exports.listener = () =>{
    // 监听到后，触发connection事件
    // 对客户端连接事件进行监听,只要有WebSocket连接到该服务器，就会触发'connection'事件
    // ws代表的是客户端的连接的socket对象;req对象可以用来获取客户端的信息，如ip、端口号
    wss.on('connection',(ws, req)=>{
        console.log('socket连接成功');
        
        // 若要获取所有已连接的客户端信息，则可以使用server.clients数据集
        ws.on('message',async (msg)=>{
            console.log('客户端发送给服务器', msg)
            let toName = msg && JSON.parse(msg).toName;
            console.log(toName)
            // 当客户端连接成功后会发送一条消息给服务器，服务器监听到消息后返回给客户端
            const data = await NotificationModel.count({where: {toName, read: 0}});
            ws.send(JSON.stringify(data));
        })
        // 监听要关闭连接的函数
        ws.on('close',function close(){
            // 关闭逻辑
            console.log('WebSocket连接已关闭')
        })
    })
}
